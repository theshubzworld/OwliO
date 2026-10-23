import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes, randomUUID } from 'crypto';
import {
  EVENT_NAMES,
  metricProperties,
  metricModel,
  type MetricEvent,
  type MetricEventName
} from '../shared/telemetry';
import type { AnalyticsStatus, CloudConfig } from '../shared/cloud';
interface SavedAnalytics {
  enabled: boolean;
  installationId: string;
  token: string;
  registered: boolean;
  lastActiveDay?: string;
  queue: MetricEvent[];
  lastSentAt?: number;
}
export class AnalyticsService {
  private data: SavedAnalytics;
  private request?: AbortController;
  private timer?: ReturnType<typeof setInterval>;
  private pending = false;
  private accessAllowed = false;
  constructor(
    private file: string,
    private config: CloudConfig | undefined,
    private version: string,
    private network: typeof fetch = fetch
  ) {
    this.data = {
      enabled: false,
      installationId: randomUUID(),
      token: randomBytes(32).toString('hex'),
      registered: false,
      queue: []
    };
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (
          typeof saved.enabled !== 'boolean' ||
          !/^[0-9a-f-]{36}$/i.test(saved.installationId) ||
          !/^[0-9a-f]{64}$/.test(saved.token) ||
          !Array.isArray(saved.queue)
        )
          throw Error('Invalid metrics state');
        this.data = {
          ...this.data,
          ...saved,
          queue: saved.queue
            .filter(
              (event: MetricEvent) =>
                EVENT_NAMES.includes(event.event) &&
                typeof event.id === 'string' &&
                Number.isFinite(Date.parse(event.timestamp))
            )
            .slice(-200)
            .map((event: MetricEvent) => ({
              id: event.id,
              event: event.event,
              timestamp: event.timestamp,
              properties: metricProperties(event.properties)
            }))
        };
      }
    } catch {
      this.data.enabled = false;
      this.data.queue = [];
    }
  }
  status(): AnalyticsStatus {
    return {
      configured: !!this.config,
      enabled: this.data.enabled && this.accessAllowed,
      queued: this.data.queue.length,
      lastSentAt: this.data.lastSentAt
    };
  }
  setAccessAllowed(allowed: boolean) {
    this.accessAllowed = allowed;
    if (!allowed) {
      this.request?.abort();
      this.data.queue = [];
      try { this.save(); } catch { /* Access remains locked even if disk writes fail. */ }
    } else {
      this.active();
      void this.flush();
    }
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
  setEnabled(enabled: unknown): AnalyticsStatus {
    if (typeof enabled !== 'boolean')
      throw Error('Invalid basic usage reporting state.');
    if (enabled && !this.config)
      throw Error('Usage reporting is not configured for this build.');
    const previous = structuredClone(this.data);
    this.data.enabled = enabled;
    if (!enabled) {
      this.request?.abort();
      this.data.queue = [];
      this.data.installationId = randomUUID();
      this.data.token = randomBytes(32).toString('hex');
      this.data.registered = false;
      delete this.data.lastActiveDay;
      delete this.data.lastSentAt;
    }
    try {
      this.save();
    } catch {
      this.data = previous;
      throw Error('Could not save the required usage reporting state.');
    }
    if (enabled) {
      this.active();
      void this.flush();
    }
    return this.status();
  }
  start() {
    this.active();
    this.timer = setInterval(() => {
      this.active();
      void this.flush();
    }, 60000);
    this.timer.unref?.();
    void this.flush();
  }
  private active() {
    if (!this.accessAllowed || !this.data.enabled || !this.config) return;
    if (!this.data.registered) {
      this.capture('installation_registered');
      this.data.registered = true;
    }
    const day = new Date().toISOString().slice(0, 10);
    if (this.data.lastActiveDay !== day) {
      this.capture('app_opened');
      this.data.lastActiveDay = day;
    }
    try {
      this.save();
    } catch {
      /* Network reporting failures must not interrupt dictation. */
    }
  }
  capture(
    event: MetricEventName,
    properties: Record<string, unknown> = {}
  ): void {
    if (!this.accessAllowed || !this.data.enabled || !this.config || !EVENT_NAMES.includes(event))
      return;
    const platform =
      process.platform === 'win32'
        ? 'windows'
        : process.platform === 'darwin'
          ? 'macos'
          : process.platform === 'linux'
            ? 'linux'
            : 'other';
    const clean = metricProperties({
      ...properties,
      version: this.version,
      os: platform,
      ...(platform === 'windows' ? { windows_version: os.release() } : {}),
      ...(typeof properties.model === 'string'
        ? { model: metricModel(properties.model) }
        : {})
    });
    this.data.queue.push({
      id: randomUUID(),
      event,
      timestamp: new Date().toISOString(),
      properties: clean
    });
    this.data.queue = this.data.queue
      .filter((item) => Date.parse(item.timestamp) > Date.now() - 7 * 86400000)
      .slice(-200);
    try {
      this.save();
    } catch {
      /* No network dependency in the processing path. */
    }
  }
  async flush(): Promise<void> {
    if (
      this.pending ||
      !this.accessAllowed ||
      !this.data.enabled ||
      !this.config ||
      !this.data.queue.length
    )
      return;
    this.data.queue = this.data.queue.filter(
      (event) => Date.parse(event.timestamp) > Date.now() - 7 * 86400000
    );
    if (!this.data.queue.length) {
      try {
        this.save();
      } catch {}
      return;
    }
    this.pending = true;
    const controller = new AbortController();
    this.request = controller;
    const installationId = this.data.installationId,
      batch = this.data.queue.slice(0, 20);
    try {
      const response = await this.network(
        this.config.supabaseUrl + '/functions/v1/usage-events',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.publishableKey
          },
          body: JSON.stringify({
            installationId,
            token: this.data.token,
            events: batch
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000)
          ])
        }
      );
      if (
        response.ok &&
        this.accessAllowed &&
        this.data.enabled &&
        this.data.installationId === installationId
      ) {
        const ids = new Set(batch.map((event) => event.id));
        this.data.queue = this.data.queue.filter((event) => !ids.has(event.id));
        this.data.lastSentAt = Date.now();
        this.save();
      }
    } catch {
      /* Bounded queue retries in the background; never log request bodies. */
    } finally {
      if (this.request === controller) this.request = undefined;
      this.pending = false;
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.request?.abort();
  }
}
