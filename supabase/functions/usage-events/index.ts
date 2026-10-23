import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { validateUsageBatch } from '../_shared/usage-schema.mjs';
import { serverKey } from '../_shared/server-key.mjs';
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
interface UsageBatch {
  installationId: string;
  token: string;
  events: {
    id: string;
    event: string;
    timestamp: string;
    properties: Record<string, string | number | boolean>;
  }[];
}

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
const reply = (status: number) =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply(405);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return reply(415);
  // Bound actual bytes, including chunked requests; never log payloads or errors.
  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return reply(413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: UsageBatch;
    try {
      body = validateUsageBatch(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      return reply(400);
    }
    const credential = serverKey((name: string) => Deno.env.get(name));
    // A dedicated override is optional. The default is a domain-separated hash
    // of the injected backend credential, never a value bundled in the desktop.
    const secret = Deno.env.get('USAGE_RATE_SECRET') || hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('owlio:usage-rate:v1:' + credential)));
    if (!secret || secret.length < 32) return reply(503);
    const tokenHash = hex(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body.token)
      )
    );
    // This rotating rate-limit bucket is never an analytics property. No raw IP is stored.
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const bucket = hex(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(
          new Date().toISOString().slice(0, 10) + ':' + ip
        )
      )
    );
    const client = createClient(
      Deno.env.get('SUPABASE_URL')!,
      credential,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
        }
      }
    );
    const { data, error } = await client.rpc('owlio_ingest_usage', {
      install_id: body.installationId,
      credential_hash: tokenHash,
      network_bucket: bucket,
      batch: body.events
    });
    if (error) return reply(error.code === 'P0001' ? 429 : 503);

    // Optional mirror. Supabase remains authoritative; retries never duplicate accepted events.
    const posthogKey = Deno.env.get('POSTHOG_PROJECT_TOKEN');
    const posthogHost =
      Deno.env.get('POSTHOG_HOST') || 'https://us.i.posthog.com';
    const accepted = new Set(Array.isArray(data) ? data : []);
    if (
      posthogKey &&
      ['https://us.i.posthog.com', 'https://eu.i.posthog.com'].includes(
        posthogHost
      ) &&
      accepted.size
    ) {
      const mirror = fetch(posthogHost + '/batch/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4000),
        body: JSON.stringify({
          api_key: posthogKey,
          batch: body.events
            .filter((event) => accepted.has(event.id))
            .map((event) => ({
              event: 'owlio_' + event.event,
              timestamp: event.timestamp,
              properties: {
                ...event.properties,
                distinct_id: body.installationId,
                $insert_id: event.id,
                $process_person_profile: false,
                $geoip_disable: true
              }
            }))
        })
      })
        .then(() => {})
        .catch(() => {});
      EdgeRuntime.waitUntil(mirror);
    }
    return reply(204);
  } catch {
    return reply(503);
  }
});
