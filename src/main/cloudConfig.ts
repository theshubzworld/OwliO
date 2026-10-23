import fs from 'fs';
import path from 'path';
import type { CloudConfig } from '../shared/cloud';

export function validateCloudConfig(value: unknown): CloudConfig {
  const config = value as Partial<CloudConfig>;
  if (
    !config ||
    Object.keys(config).some(
      (key) => !['supabaseUrl', 'publishableKey'].includes(key)
    ) ||
    typeof config.supabaseUrl !== 'string' ||
    typeof config.publishableKey !== 'string'
  )
    throw Error('Invalid cloud configuration.');
  const url = new URL(config.supabaseUrl);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('Cloud configuration needs an HTTPS project origin.');
  const key = config.publishableKey.trim();
  let anon = false;
  if (/^sb_publishable_[a-zA-Z0-9_-]{12,}$/.test(key)) anon = true;
  else {
    try {
      anon =
        JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
          .role === 'anon';
    } catch {}
  }
  if (!anon || key.length > 4096)
    throw Error(
      'Use a Supabase publishable key, never a secret or service-role key.'
    );
  return { supabaseUrl: url.origin, publishableKey: key };
}
export function loadCloudConfig(): CloudConfig | undefined {
  // This file contains public project identifiers only. Never read arbitrary URLs from renderer IPC.
  const file = path.resolve(__dirname, '../../cloud-config.json');
  if (!fs.existsSync(file)) return;
  return validateCloudConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
}
