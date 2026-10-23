// This module runs only in the Edge Function. No server credential is sent to a client.
export function serverKey(get) {
  try {
    const keys = JSON.parse(get('SUPABASE_SECRET_KEYS') || '{}');
    const value = keys.default || Object.values(keys).find(key => typeof key === 'string' && key.startsWith('sb_secret_'));
    if (typeof value === 'string' && value.startsWith('sb_secret_')) return value;
  } catch { /* Older hosted runtimes expose the legacy service-role variable. */ }
  const legacy = get('SUPABASE_SERVICE_ROLE_KEY');
  if (typeof legacy === 'string' && legacy.length >= 32) return legacy;
  throw Error('Server credentials unavailable');
}
