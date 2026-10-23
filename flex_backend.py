"""The reviewed Bodhan Flex checkpoint, using native transcription only."""
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from huggingface_hub import snapshot_download

FLEX_LANGUAGE_CODES = ('as','bgc','bhb','bho','bn','brx','doi','en','gu','hi','hne','kn','kok','ks','mai','ml','mni','mr','ne','or','pa','sa','sat','sd','ta','te','ur')

FLEX_ID = 'bodhan-flex'
FLEX_REPO = 'bodhan-ai/indic-transcribe-flex'
FLEX_REVISION = 'ecba9bac9013c0340fe814b336897ee51ed80be9'
FLEX_FILES = ('config.json', 'generation_config.json', 'model.safetensors',
              'feature_extractor.safetensors', 'tokenizer_config.json',
              'tokenizer_multilingual.model', 'tokenizer_spl_tokens.model')


def has_audio_signal(audio, window=480):
    """Reject silence only when every 30 ms window is quiet, including the tail."""
    if not len(audio):
        return False
    count = len(audio) // window
    if count and np.any(np.mean(audio[:count * window].reshape(count, window) ** 2, axis=1) >= 0.003 ** 2):
        return True
    tail = audio[count * window:]
    return bool(len(tail) and np.mean(tail ** 2) >= 0.003 ** 2)


def flex_directory(cache_dir):
    return Path(cache_dir) / 'bodhan-ai' / 'indic-transcribe-flex'


def cached_flex(cache_dir):
    directory = flex_directory(cache_dir)
    source = directory / 'source.json'
    if not source.is_file() or not all((directory/file).is_file() for file in FLEX_FILES):
        return None
    provenance = json.loads(source.read_text(encoding='utf-8'))
    if provenance.get('repository') != FLEX_REPO or provenance.get('revision') != FLEX_REVISION:
        return None
    if (directory/'model.safetensors').stat().st_size != 4890451120:
        return None
    return str(directory)


def download_flex(cache_dir):
    # The model-specific Python loader is bundled and reviewed, never downloaded or executed from a custom URL.
    directory = flex_directory(cache_dir)
    snapshot_download(FLEX_REPO, revision=FLEX_REVISION, local_dir=str(directory), allow_patterns=list(FLEX_FILES))
    temporary = directory/'source.tmp'
    temporary.write_text(json.dumps({'repository': FLEX_REPO, 'revision': FLEX_REVISION}), encoding='utf-8')
    temporary.replace(directory/'source.json')
    if not cached_flex(cache_dir):
        raise RuntimeError('Flex download is incomplete. Retry the download.')


class FlexEngine:
    supports_hinglish = True

    def __init__(self, path, device='auto'):
        import torch
        from vendor.bodhan_flex.indic_transcribe import IndicTranscribe
        self.torch = torch
        self.device = 'cuda' if device != 'cpu' and torch.cuda.is_available() else 'cpu'
        dtype = torch.bfloat16 if self.device == 'cuda' else torch.float32
        self.asr = IndicTranscribe.from_pretrained(path, device=self.device, dtype=dtype)
        self.network = self.asr.model
        self.model = SimpleNamespace(device=self.device, compute_type='bfloat16' if self.device == 'cuda' else 'float32')

    def transcribe(self, audio, language='hinglish', output_mode=None, **kwargs):
        from vendor.bodhan_flex.long_form import transcribe_long
        lang = 'hi' if language in ('hinglish', 'hi-en', 'english-hinglish') else language
        if lang is not None and lang not in FLEX_LANGUAGE_CODES:
            raise ValueError('Choose one of the 27 documented Flex languages, Hinglish, or automatic detection.')
        if not isinstance(audio, np.ndarray):
            from faster_whisper.audio import decode_audio
            audio = decode_audio(audio, sampling_rate=16000)
        if not has_audio_signal(audio):
            return [], SimpleNamespace(language=lang)
        text = transcribe_long(self.asr, audio, lang=lang, mode='native')
        return [SimpleNamespace(text=text)], SimpleNamespace(language=lang)
