export const BAR_DESIGNS = [
  { id: 'owl', name: 'Owlio owl', description: 'Your original little companion.' },
  { id: 'cat', name: 'Sleepy cat', description: 'Curled up at rest, all ears when you speak.' },
  { id: 'cloud', name: 'Little cloud', description: 'A soft cloud with a gentle listening bounce.' },
  { id: 'robot', name: 'Friendly robot', description: 'A tiny face that reacts to your voice.' },
  { id: 'waveform', name: 'Mini waveform', description: 'Clean sound waves, without a character.' },
  { id: 'pebble', name: 'Glowing pebble', description: 'A smooth pebble with a voice-responsive glow.' },
  { id: 'firefly', name: 'Firefly', description: 'A little light that wakes when you dictate.' },
] as const;

export type BarDesign = typeof BAR_DESIGNS[number]['id'];
export type BarState = 'idle' | 'starting' | 'listening' | 'processing' | 'pasted' | 'error';
export function normalizeBarDesign(value: unknown): BarDesign {
  return BAR_DESIGNS.find(design => design.id === value)?.id ?? 'owl';
}
