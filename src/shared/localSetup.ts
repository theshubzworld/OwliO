export const RUNTIME_PRESETS = [
  { id: 'whisper-cpu', name: 'Lightweight · CPU', detail: 'Whisper dictation without PyTorch. Good for getting started.', disk: 'Allow 1–2 GB plus your model.' },
  { id: 'full-cpu', name: 'Full speech · CPU', detail: 'Adds PyTorch and Transformers for Whisper, Bodhan Flex and Parakeet models such as Bark Pro.', disk: 'Allow 7 GB plus your model, including installation working space. Large models can be slow on CPU.' },
  { id: 'full-cuda', name: 'Full speech · NVIDIA GPU', detail: 'Adds PyTorch with CUDA 12.8. Requires a compatible NVIDIA GPU and driver.', disk: 'Allow 14 GB plus your model, including installation working space.' },
] as const;
export type RuntimePreset = typeof RUNTIME_PRESETS[number]['id'];
export function recommendedPreset(model: string, connected?: RuntimePreset): RuntimePreset {
  const full=model==='bodhan-flex'||model==='bark-pro'||model.startsWith('hf:');
  if (connected && (connected !== 'whisper-cpu' || !full)) return connected;
  return full ? 'full-cpu' : 'whisper-cpu';
}
export const SETUP_MODELS = [
  { id: 'tiny', name: 'Whisper tiny', size: 'About 75 MB', full: false },
  { id: 'base', name: 'Whisper base', size: 'About 145 MB', full: false },
  { id: 'small', name: 'Whisper small', size: 'About 500 MB', full: false },
  { id: 'turbo', name: 'Whisper large v3 turbo', size: 'About 1.6 GB', full: false },
  { id: 'bodhan-flex', name: 'Bodhan Flex · 27 languages', size: 'About 4.9 GB · Hugging Face access required', full: true },
  { id: 'bark-pro', name: 'Underdog Bark 3.0 Pro · English', size: 'About 1.25 GB · English only', full: true },
] as const;
export type SetupModel = typeof SETUP_MODELS[number]['id'] | `hf:${string}`;
export type SetupAction = 'python' | 'libraries' | 'model' | 'all' | 'check';
export type SetupRequest = { action: SetupAction; preset: RuntimePreset; model: SetupModel; language?:string; token?: string };
export type StorageTarget = 'root' | 'runtimes' | 'models' | 'cache';
export type StoragePaths = { root: string; runtimes: string; models: string; cache: string };
export type LocalSetupStatus = {
  state: 'idle' | 'running' | 'ready' | 'failed' | 'cancelled'; stage: string; message: string;
  preset?: RuntimePreset; model?: SetupModel; progress?: number; received?: number; total?: number;
  runtimeConfigured: boolean; managed: boolean; pythonInstalled: boolean; librariesInstalled: boolean;
  modelInstalled: boolean; runtimeFolder: string; modelFolder: string; error?: string; log: string[];
  revision?: number;
  startedAt?: number; finishedAt?: number; stageStartedAt?: number; lastActivityAt?: number;
  activity?: string; transferStartedAt?: number;
  storage?: StoragePaths; defaultStorage?: boolean; runtimeFreeBytes?: number; modelFreeBytes?: number; cacheFreeBytes?: number;
  connectedPython?: string; connectedModels?: string;
  connectedPreset?: RuntimePreset; connectedModel?: string;
};
