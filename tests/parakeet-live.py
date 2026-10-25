"""Opt-in real GPU/API check: python tests/parakeet-live.py --cache PATH --audio PATH.

Downloads the pinned Bark checkpoint into the supplied cache. Uses no microphone,
cloud inference or user profile, and does not change the selected application model.
"""
import argparse
import io
import json
import os
import re
from pathlib import Path
import sys
import time
import wave
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cache', required=True)
parser.add_argument('--audio', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
os.environ['OWLIO_MODEL_CACHE'] = str(Path(args.cache).resolve())
os.environ['WHISPER_MODEL'] = 'base'

import torch
import transformers
from fastapi.testclient import TestClient
import server

manager = server.model_manager
manager.device = 'cuda'
client = TestClient(server.app)
print('Downloading/verifying pinned Bark assets…', flush=True)
manager.download('bark-pro')
audio = Path(args.audio).read_bytes()
def request(data, content=audio):
    start = time.perf_counter()
    response = client.post('/v1/audio/transcriptions', data={'model': 'bark-pro', **data}, files={'file': ('speech.wav', content, 'audio/wav')})
    elapsed = time.perf_counter() - start
    assert response.status_code == 200, response.text
    return response.text if data.get('response_format') == 'text' else response.json()['text'], elapsed

text, cold = request({'language': 'en', 'response_format': 'text'})
print('Cold transcript:', text, flush=True)
assert 'report' in text.casefold() and 'tomorrow' in text.casefold(), text
warm_text, warm = request({'language': 'en', 'response_format': 'json'})
assert warm_text == text
wrong = client.post('/v1/audio/transcriptions', data={'model': 'bark-pro', 'language': 'hinglish'}, files={'file': ('speech.wav', audio, 'audio/wav')})
assert wrong.status_code == 400, wrong.text
empty = io.BytesIO()
with wave.open(empty, 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(b'\0' * 32000)
silence, _ = request({'language': 'en', 'response_format': 'text'}, empty.getvalue())
assert silence == ''

# Synthetic meeting-length recording with speech on both sides of chunk boundaries.
with wave.open(io.BytesIO(audio), 'rb') as wav:
    assert (wav.getnchannels(), wav.getframerate(), wav.getsampwidth()) == (1, 16000, 2)
    frames = wav.readframes(wav.getnframes())
long_audio = io.BytesIO()
with wave.open(long_audio, 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes((frames + b'\0' * 16000) * 8)
long_text, long_time = request({'language': 'en', 'response_format': 'text'}, long_audio.getvalue())
assert long_text.casefold().count('report') == 8, long_text
# Add a quiet DC floor so the silence-cut detector cannot find a pause. This
# exercises timestamp ownership and whole-word trimming across the overlap.
continuous = io.BytesIO()
with wave.open(io.BytesIO(long_audio.getvalue()), 'rb') as wav:
    samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype=np.int16).astype(np.int32)
with wave.open(continuous, 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(16000)
    wav.writeframes(np.clip(samples + 400, -32768, 32767).astype(np.int16).tobytes())
continuous_text, _ = request({'language': 'en', 'response_format': 'text'}, continuous.getvalue())
assert continuous_text.casefold().count('report') == 8, continuous_text
assert re.findall('[a-z]+', continuous_text.casefold()) == re.findall('[a-z]+', text.casefold()) * 8, continuous_text
report = {
    'success': True, 'model': 'bark-pro', 'revision': '4b5c51e04aa8d16dda9ecdff71bc29f7360149e4',
    'torch': torch.__version__, 'transformers': transformers.__version__,
    'gpu': torch.cuda.get_device_name(0), 'runtime': manager.catalogue()['runtime'],
    'text': text, 'cold_seconds': cold, 'warm_seconds': warm,
    'long_audio_seconds': 8 * (len(frames) / 32000 + .5), 'long_seconds': long_time,
    'long_text': long_text, 'peak_cuda_allocated_bytes': torch.cuda.max_memory_allocated(),
    'continuous_text': continuous_text,
    'silence_empty': True, 'hinglish_rejected': True,
}
Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2), flush=True)
manager.close()
