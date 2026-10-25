"""Reviewed speech architectures and recommended checkpoints. No repository code is executed."""
from importlib.metadata import PackageNotFoundError, version

BARK_ID = 'bark-pro'
BARK_REPO = 'ConwayResearch/Underdog-Bark-3.0-Pro'
BUILTIN_MODELS = {
    BARK_ID: {
        'id': BARK_ID, 'name': 'Underdog Bark 3.0 Pro · English',
        'repository': BARK_REPO,
        'revision': '4b5c51e04aa8d16dda9ecdff71bc29f7360149e4',
        'engine': 'parakeet-tdt', 'languages': ['en'], 'bytes': 1254196636,
        'files': ['config.json', 'generation_config.json', 'model.safetensors',
                  'processor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'NOTICE'],
    },
}


def runtime_error(engine):
    """Inspect installed distributions without importing PyTorch during catalogue polling."""
    if engine == 'faster-whisper':
        return None
    packages = ['torch', 'transformers', 'safetensors']
    if engine == 'parakeet-tdt':
        packages += ['librosa', 'soundfile', 'soxr']
    try:
        installed = {package: version(package) for package in packages}
        if engine == 'parakeet-tdt':
            from packaging.version import Version
            if Version(installed['transformers']) < Version('5.19.0'):
                return 'Parakeet models need Transformers 5.19.0 or later. Install or repair the Full speech package.'
    except PackageNotFoundError:
        return 'This model needs a Full speech package. Install or repair it under local speech setup.'
    return None


def load_engine(engine, path, device, model_id=None, repository=None, languages=None):
    """Each supported architecture implements the local server's transcribe interface."""
    error = runtime_error(engine)
    if error:
        raise RuntimeError(error)
    if engine == 'transformers':
        from transformers_whisper import TransformersWhisper
        return TransformersWhisper(path, device=device, model_id=model_id)
    if engine == 'parakeet-tdt':
        from parakeet_backend import ParakeetEngine
        return ParakeetEngine(path, device=device, repository=repository, languages=languages)
    raise ValueError(f'Unsupported speech architecture: {engine}')
