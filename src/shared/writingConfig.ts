export type WritingProvider = 'off' | 'gemini' | 'local';

export function writingProvider(settings: {writingProvider?: WritingProvider; formattingProvider?: string; provider: string}): WritingProvider {
  if (settings.writingProvider) return settings.writingProvider;
  return settings.formattingProvider === 'gemini' ? 'gemini' : 'off';
}
