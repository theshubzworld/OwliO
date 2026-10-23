import { SPEECH_LANGUAGE_CODES } from './speechLanguages';
export const EVENT_NAMES = [
  'installation_registered',
  'app_opened',
  'setup_completed',
  'dictation_completed',
  'dictation_failed',
  'stage_completed',
  'stage_failed'
] as const;
export type MetricEventName = (typeof EVENT_NAMES)[number];
export type MetricProperties = Record<string, string | number | boolean>;
export interface MetricEvent {
  id: string;
  event: MetricEventName;
  timestamp: string;
  properties: MetricProperties;
}
const enums: Record<string, readonly string[]> = {
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
  language: SPEECH_LANGUAGE_CODES,
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
const bounds: Record<string, number> = {
  duration_ms: 600000,
  audio_seconds: 7200,
  words: 100000
};
// An allowlist, never a bag of context properties. Unknown fields are discarded.
export function metricProperties(
  input: Record<string, unknown>
): MetricProperties {
  const result: MetricProperties = {};
  for (const [key, values] of Object.entries(enums))
    if (typeof input[key] === 'string' && values.includes(input[key] as string))
      result[key] = input[key] as string;
  for (const [key, max] of Object.entries(bounds))
    if (
      typeof input[key] === 'number' &&
      Number.isFinite(input[key]) &&
      (input[key] as number) >= 0
    )
      result[key] = Math.min(max, Math.round(input[key] as number));
  if (
    typeof input.version === 'string' &&
    /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-z0-9.-]{1,30})?$/i.test(input.version)
  )
    result.version = input.version;
  if (
    typeof input.windows_version === 'string' &&
    /^\d{1,3}\.\d{1,3}(?:\.\d{1,6})?$/.test(input.windows_version)
  )
    result.windows_version = input.windows_version;
  if (typeof input.is_rewrite === 'boolean')
    result.is_rewrite = input.is_rewrite;
  return result;
}
export function metricModel(model: string): string {
  if (enums.model.includes(model)) return model;
  return /^(?:hf:)?(?:mayank-dubey-ai\/whisper-large-v3-turbo-hinglish|oriserve\/whisper-hindi2hinglish-apex|trelis\/whisper-hinglish-preview)$/i.test(
    model
  )
    ? 'hinglish-transformers'
    : 'custom';
}
