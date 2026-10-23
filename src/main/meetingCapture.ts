import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

type Segment = { seconds: number; text?: string };
type Capture = { id: string; createdAt: number; retain: boolean; sealed: boolean; segments: Segment[] };
export const MAX_MEETING_SECONDS = 7200;

// Audio is written in small chunks. Interrupted retained captures can resume without
// retranscribing completed chunks. Non-retained processing files are removed on failure/startup.
export class MeetingCaptureStore {
  private active = new Set<string>();
  private locks = new Set<string>();
  private pendingCleanup = new Set<string>();
  constructor(private root: string) {}
  private directory(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid meeting recording.');
    return path.join(this.root, id);
  }
  private async read(id: string): Promise<Capture> {
    const value = JSON.parse(await fs.promises.readFile(path.join(this.directory(id), 'capture.json'), 'utf8')) as Capture;
    if (value.id !== id || !Array.isArray(value.segments) || value.segments.length > 122 || typeof value.retain !== 'boolean' || value.segments.some(s => !Number.isFinite(s.seconds) || s.seconds < 0 || s.seconds > 61 || (s.text !== undefined && (typeof s.text !== 'string' || s.text.length > 10000)))) throw new Error('Meeting recovery data is invalid.');
    return value;
  }
  private async write(value: Capture): Promise<void> {
    const file = path.join(this.directory(value.id), 'capture.json');
    const handle = await fs.promises.open(file + '.tmp', 'w', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.promises.rename(file + '.tmp', file);
  }
  private async unlock(id: string): Promise<void> {
    this.locks.delete(id);
    if (this.pendingCleanup.delete(id)) await this.failed(id);
  }
  async create(retain: boolean): Promise<string> {
    const id = randomUUID();
    await fs.promises.mkdir(this.directory(id), {recursive: true});
    await this.write({id, createdAt: Date.now(), retain, sealed: false, segments: []});
    this.active.add(id);
    return id;
  }
  async append(id: string, index: number, buffer: Buffer): Promise<void> {
    if (this.locks.has(id)) throw new Error('Wait for the current meeting operation.');
    this.locks.add(id);
    try {
      const capture = await this.read(id);
      if (capture.sealed || index !== capture.segments.length) throw new Error('Meeting chunks arrived out of order.');
      if (buffer.length < 44 || buffer.length > 44 + 61 * 32000 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE' || buffer.readUInt32LE(24) !== 16000 || buffer.readUInt16LE(22) !== 1 || buffer.readUInt16LE(34) !== 16 || buffer.readUInt32LE(40) !== buffer.length - 44) throw new Error('Invalid meeting audio chunk.');
      const seconds = (buffer.length - 44) / 32000;
      if (capture.segments.reduce((sum, s) => sum + s.seconds, 0) + seconds > MAX_MEETING_SECONDS + 1) throw new Error('The meeting recording reached its two-hour limit.');
      const file = path.join(this.directory(id), `${index}.wav`);
      // A prior interrupted manifest write may have left this exact chunk behind.
      const handle = await fs.promises.open(file, 'w', 0o600);
      try { await handle.writeFile(buffer); await handle.sync(); }
      finally { await handle.close(); }
      capture.segments.push({seconds});
      await this.write(capture);
    } finally { await this.unlock(id); }
  }
  async transcript(id: string, transcribe: (wav: Buffer) => Promise<string>, signal?: AbortSignal): Promise<{text: string; seconds: number}> {
    if (this.locks.has(id)) throw new Error('This meeting is already being processed.');
    this.locks.add(id);
    try {
      const capture = await this.read(id);
      if (!capture.segments.length) throw new Error('No meeting audio was captured.');
      capture.sealed = true;
      await this.write(capture);
      for (let i = 0; i < capture.segments.length; i++) {
        signal?.throwIfAborted();
        if (capture.segments[i].text !== undefined) continue;
        const wav = await fs.promises.readFile(path.join(this.directory(id), `${i}.wav`));
        const text = await transcribe(wav);
        signal?.throwIfAborted();
        if (text.length > 10000) throw new Error('The speech service returned an oversized meeting segment.');
        capture.segments[i].text = text;
        await this.write(capture);
      }
      return {text: capture.segments.map(s => s.text).filter(Boolean).join('\n'), seconds: capture.segments.reduce((sum, s) => sum + s.seconds, 0)};
    } finally { this.active.delete(id); await this.unlock(id); }
  }
  async progress(id: string): Promise<{text: string; seconds: number}> {
    const capture = await this.read(id);
    return {text: capture.segments.map(s => s.text).filter(Boolean).join('\n'), seconds: capture.segments.reduce((sum, s) => sum + (s.text === undefined ? 0 : s.seconds), 0)};
  }
  async failed(id: string): Promise<void> {
    this.active.delete(id);
    if (this.locks.has(id)) { this.pendingCleanup.add(id); return; }
    if (!(await this.read(id)).retain) await this.remove(id);
  }
  async list(): Promise<{id: string; createdAt: number; seconds: number}[]> {
    if (!fs.existsSync(this.root)) return [];
    const result = [];
    for (const id of await fs.promises.readdir(this.root)) {
      if (!/^[a-f0-9-]{36}$/.test(id) || this.active.has(id) || this.locks.has(id)) continue;
      try {
        const capture = await this.read(id);
        if (!capture.retain || !capture.segments.length) { await this.remove(id); continue; }
        result.push({id, createdAt: capture.createdAt, seconds: capture.segments.reduce((sum, s) => sum + s.seconds, 0)});
      } catch { /* An incomplete manifest is not a recoverable recording. */ }
    }
    return result.sort((a,b) => b.createdAt - a.createdAt);
  }
  async remove(id: string): Promise<void> {
    if (this.locks.has(id)) throw new Error('Finish processing this meeting before discarding it.');
    const directory = this.directory(id);
    if (!fs.existsSync(directory)) return;
    for (const name of await fs.promises.readdir(directory)) {
      if (/^(?:capture\.json(?:\.tmp)?|\d+\.wav)$/.test(name)) await fs.promises.unlink(path.join(directory, name));
    }
    await fs.promises.rmdir(directory);
    this.active.delete(id);
  }
}
