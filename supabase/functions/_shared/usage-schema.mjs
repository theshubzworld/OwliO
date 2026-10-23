// Kept deliberately independent of SDKs so the same ingress rules run in tests.
export const eventNames = [
  'installation_registered',
  'app_opened',
  'setup_completed',
  'dictation_completed',
  'dictation_failed',
  'stage_completed',
  'stage_failed'
];
const enums = {
  provider: ['local', 'groq'],
  model: [
    'tiny',
    'base',
    'small',
    'medium',
    'large-v3',
    'turbo',
    'bodhan-flex',
    'hinglish-transformers',
    'custom'
  ],
  stage: [
    'speech',
    'romanization',
    'cleanup',
    'rewrite',
    'insertion',
    'meeting'
  ],
  outcome: ['success', 'fallback', 'failed', 'cancelled'],
  os: ['windows', 'macos', 'linux', 'other']
};
const limits = { duration_ms: 600000, audio_seconds: 7200, words: 100000 };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).every((key) => keys.includes(key)) &&
  keys.every((key) => Object.hasOwn(value, key));

export function validateUsageBatch(body, now = Date.now()) {
  if (
    !exact(body, ['installationId', 'token', 'events']) ||
    !uuid.test(body.installationId) ||
    typeof body.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(body.token) ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > 20
  )
    throw Error('Invalid usage batch');
  for (const event of body.events) {
    if (
      !exact(event, ['id', 'event', 'timestamp', 'properties']) ||
      !uuid.test(event.id) ||
      !eventNames.includes(event.event) ||
      typeof event.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(event.timestamp)) ||
      Date.parse(event.timestamp) < now - 7 * 86400000 ||
      Date.parse(event.timestamp) > now + 300000 ||
      !object(event.properties)
    )
      throw Error('Invalid usage event');
    for (const [key, value] of Object.entries(event.properties)) {
      let valid = false;
      if (Object.hasOwn(enums, key)) valid = enums[key].includes(value);
      else if (Object.hasOwn(limits, key))
        valid =
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= limits[key];
      else if (key === 'language')
        valid =
          typeof value === 'string' &&
          /^(?:[a-z]{2,3}|auto|hinglish)$/.test(value);
      else if (key === 'version')
        valid =
          typeof value === 'string' &&
          /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.-]{1,30})?$/i.test(value);
      else if (key === 'windows_version')
        valid =
          typeof value === 'string' &&
          /^\d{1,3}\.\d{1,3}(?:\.\d{1,6})?$/.test(value);
      else if (key === 'is_rewrite') valid = typeof value === 'boolean';
      if (!valid) throw Error('Invalid usage property');
    }
  }
  return body;
}
