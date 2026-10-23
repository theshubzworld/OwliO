import { store } from './store';
import { huggingFaceRepository, speechModelId } from '../shared/speechModels';

const pulls = new Map<string, { id: string; model: string; status: string; state: string; error?: string; completed?: number; total?: number }>();

function speechUrl() {
  return store.getSettings().localSttUrl.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1/models';
}
async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.detail || data.error || `Model service returned ${response.status}`);
  return data;
}
export async function getLocalModels() {
  const settings = store.getSettings();
  const [speech, formatting] = await Promise.allSettled([
    jsonRequest(speechUrl()).then(data => {
      if (data.service !== 'Owlio' || !Array.isArray(data.models)) throw new Error('Update or restart the Owlio speech server to manage models.');
      return data;
    }),
    jsonRequest(settings.localLlmUrl.replace(/\/+$/, '') + '/api/tags'),
  ]);
  return {
    speech: speech.status === 'fulfilled' ? { online: true, ...speech.value } : { online: false, error: speech.reason.message },
    formatting: formatting.status === 'fulfilled' ? { online: true, models: formatting.value.models || [] } : { online: false, error: 'Ollama is not running at the configured address. Built-in formatting is available.' },
    pulls: [...pulls.values()],
  };
}
export async function speechModelAction(model: string, action: string) {
  speechModelId(model);
  if (!['download', 'activate'].includes(action)) throw new Error('Choose a supported speech model.');
  return jsonRequest(speechUrl() + '/' + action, { model });
}
export async function deleteSpeechModel(model: unknown) {
  let val = typeof model === 'string' ? model.trim() : '';
  if (val && !val.startsWith('hf:') && val.includes('/')) {
    val = 'hf:' + val;
  }
  const id = speechModelId(val);
  return jsonRequest(speechUrl() + '/delete', { model: id });
}
export async function importSpeechModel(url: unknown) {
  return jsonRequest(speechUrl() + '/import', { url: huggingFaceRepository(url) });
}
export function pullFormattingModel(model: string) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/.test(model)) throw new Error('Enter a valid Ollama model name.');
  const running = [...pulls.values()].find(job => job.state === 'running');
  if (running) throw new Error('Wait for the current formatting model download.');
  const job: NonNullable<ReturnType<typeof pulls.get>> = { id: String(Date.now()), model, status: 'Connecting to Ollama…', state: 'running' };
  if (pulls.size >= 20) pulls.delete(pulls.keys().next().value!);
  pulls.set(job.id, job);
  const url = store.getSettings().localLlmUrl.replace(/\/+$/, '') + '/api/pull';
  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2 * 60 * 60 * 1000);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: controller.signal });
      if (!response.ok || !response.body) throw new Error('Ollama could not start the download. Check the model name and server.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let success = false;
      const consume = (line: string) => {
        if (!line.trim()) return;
        const data = JSON.parse(line);
        if (data.error) throw new Error(data.error);
        job.status = data.status || job.status;
        job.completed = data.completed;
        job.total = data.total;
        if (data.status === 'success') success = true;
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split('\n'); pending = lines.pop()!;
          lines.forEach(consume);
          if (done) { consume(pending); break; }
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (!success) throw new Error('Ollama stopped before confirming the download.');
      job.state = 'ready'; job.status = 'Downloaded';
    } catch (error) { job.state = 'failed'; job.error = error instanceof Error ? error.message : 'Download failed'; }
    finally { clearTimeout(timer); }
  })();
  return job;
}
