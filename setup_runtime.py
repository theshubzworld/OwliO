"""Owlio-owned runtime checks and model downloads. Commands are fixed; secrets arrive on stdin."""
import json
import os
import sys
from pathlib import Path


def main():
    command = sys.argv[1]
    request = json.loads(sys.stdin.read() or '{}')
    preset = request.get('preset', 'whisper-cpu')
    if preset not in ('whisper-cpu', 'full-cpu', 'full-cuda'):
        raise ValueError('Choose a supported speech package.')
    import fastapi, uvicorn, av, numpy, faster_whisper, ctranslate2, huggingface_hub, python_multipart
    import server  # Verify multipart routes and all server imports before marking libraries ready.
    features = {'core': True, 'full': False, 'cuda': False, 'python': sys.version.split()[0]}
    if preset != 'whisper-cpu':
        import torch, torchaudio, transformers, accelerate, safetensors, sentencepiece, soundfile
        from vendor.bodhan_flex.indic_transcribe import IndicTranscribe
        features.update(full=True, cuda=torch.cuda.is_available())
        if preset == 'full-cuda' and not features['cuda']:
            raise ValueError('CUDA is unavailable. Update your NVIDIA driver or choose Full speech · CPU.')
    if command == 'check':
        print(json.dumps(features), flush=True)
        return
    if command not in ('model', 'verify-model'):
        raise ValueError('Unsupported setup command.')
    model = request.get('model')
    if command == 'model' and model not in ('tiny', 'base', 'small', 'turbo', 'bodhan-flex'):
        raise ValueError('Choose a supported setup model.')
    if model == 'bodhan-flex' and not features['full']:
        raise ValueError('Bodhan Flex needs a Full speech package.')
    cache = Path(request['models']).resolve()
    if not cache.is_dir():
        raise ValueError('The model folder is missing.')
    os.environ['OWLIO_MODEL_CACHE'] = str(cache)
    # Keep access credentials in memory; they are never stored in the runtime or logs.
    token = request.get('token')
    if token:
        os.environ['HF_TOKEN'] = token
    from model_manager import ModelManager
    manager = ModelManager(model, cache_dir=str(cache), device='cuda' if preset == 'full-cuda' else 'cpu')
    model = manager.normalize(model)  # Rechecks also accept the existing catalogue and registered custom models.
    if command == 'model' and not manager.cached_path(model):
        if model == 'bodhan-flex':
            from flex_backend import download_flex
            download_flex(str(cache))
        else:
            from faster_whisper.utils import download_model
            download_model(model, cache_dir=str(cache))
    if not manager.cached_path(model):
        raise ValueError('The selected model download is incomplete.')
    # Validate loading before installing the new runtime configuration. No audio is recorded.
    if command == 'model':
        manager.load(model)
    print(json.dumps({**features, 'model': model, 'modelInstalled': True}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error)
        if '401' in message or '403' in message or 'gated' in message.lower():
            message = 'This model needs approved Hugging Face access and a read token. Request access, then retry.'
        token = os.environ.get('HF_TOKEN', '')
        if token:
            message = message.replace(token, '[redacted]')
        print(json.dumps({'error': message}), flush=True)
        sys.exit(1)
