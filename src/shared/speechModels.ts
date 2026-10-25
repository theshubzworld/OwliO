const builtins = new Set(['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo', 'bodhan-flex', 'bark-pro']);
const repoPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;

export function speechModelLabel(model: string): string {
  if(model==='bark-pro'||model.toLowerCase()==='hf:conwayresearch/underdog-bark-3.0-pro')return 'Underdog Bark 3.0 Pro';
  if(model==='bodhan-flex')return 'Bodhan Flex';
  return model.replace(/^hf:/,'');
}

export function huggingFaceRepository(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300) throw new Error('Enter a Hugging Face model URL or owner/model name.');
  let repo = value.trim();
  if (repo.includes('://')) {
    const url = new URL(repo);
    if (url.protocol !== 'https:' || url.host !== 'huggingface.co' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS model URL on huggingface.co without a query or credentials.');
    repo = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\/tree\/main$/, '');
  }
  if (!repoPattern.test(repo) || repo.includes('..') || ['datasets', 'spaces'].includes(repo.split('/')[0])) throw new Error('Enter a model repository, for example https://huggingface.co/Trelis/whisper-hinglish-preview.');
  return repo;
}

export function speechModelId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Choose a supported speech model.');
  if (builtins.has(value)) return value;
  if (value.startsWith('hf:') && huggingFaceRepository(value.slice(3)) === value.slice(3)) return value;
  throw new Error('Choose a supported, downloaded speech model.');
}
