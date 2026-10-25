"""Local Transformers Parakeet TDT inference, including Underdog Bark Pro."""
from types import SimpleNamespace
import numpy as np
from flex_backend import has_audio_signal
from speech_backends import BARK_REPO


class ParakeetEngine:
    @staticmethod
    def chunks(audio):
        """Prefer cuts inside pauses; use timed overlap for uninterrupted speech."""
        size, overlap, step = 20 * 16000, 4 * 16000, 160
        start, lower = 0, -np.inf
        while start < len(audio):
            end = min(start + size, len(audio))
            cut = None
            if end < len(audio):
                search = audio[end - 4 * 16000:end]
                energy = np.mean(search.reshape(-1, step) ** 2, axis=1)
                # At least 100 ms of quiet, cut at its centre and retain all samples.
                quiet = np.convolve((energy < .003 ** 2).astype(np.int32), np.ones(10, np.int32), mode='valid')
                candidates = np.flatnonzero(quiet == 10)
                if len(candidates):
                    cut = end - 4 * 16000 + (int(candidates[-1]) + 5) * step
            upper = np.inf if cut is not None or end == len(audio) else size - overlap / 2
            yield start, cut or end, lower, upper
            if end == len(audio):
                break
            start, lower = (cut, -np.inf) if cut is not None else (end - overlap, overlap / 2)

    def timed_tokens(self, output, lower, upper):
        ids = output.sequences[0].tolist()
        if lower == -np.inf and upper == np.inf:
            return ids
        if getattr(output, 'durations', None) is None:
            raise RuntimeError('This Parakeet runtime cannot return token timing. Repair the Full speech package.')
        durations = np.asarray(output.durations[0].tolist())
        positions = (np.cumsum(durations) - durations) * self.frame_samples - self.leading_samples
        tokenizer = self.processor.tokenizer
        ignored = set(tokenizer.all_special_ids) | {getattr(self.processor, 'blank_token_id', None)}
        groups = []
        for token, piece, position in zip(ids, tokenizer.convert_ids_to_tokens(ids), positions):
            if token in ignored:
                continue
            if not groups or piece.startswith(('▁', 'Ġ', ' ')):
                groups.append((position, []))
            groups[-1][1].append(token)
        # Keep whole words together: splitting subword IDs can splice unrelated word halves.
        return [token for position, word in groups if lower <= position < upper for token in word]

    def __init__(self, path, device='auto', repository=None, languages=None):
        import torch
        from transformers import AutoProcessor, ParakeetForTDT
        self.torch = torch
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA is unavailable. Choose the CPU speech package or update your NVIDIA driver.')
        self.device = 'cuda' if device != 'cpu' and torch.cuda.is_available() else 'cpu'
        self.dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float32) if self.device == 'cuda' else torch.float32
        self.languages = languages
        # The publisher evaluated Bark with 0.25 seconds of leading silence.
        self.leading_samples = 4000 if (repository or '').lower() == BARK_REPO.lower() else 0
        self.processor = AutoProcessor.from_pretrained(path, local_files_only=True, trust_remote_code=False)
        self.network = ParakeetForTDT.from_pretrained(
            path, dtype=self.dtype, local_files_only=True, trust_remote_code=False,
            use_safetensors=True, low_cpu_mem_usage=True).to(self.device).eval()
        self.frame_samples = self.processor.feature_extractor.hop_length * self.network.config.encoder_config.subsampling_factor
        if self.processor.feature_extractor.sampling_rate != 16000:
            raise ValueError('Only 16 kHz Parakeet processors are supported.')
        self.model = SimpleNamespace(device=self.device, compute_type=str(self.dtype).removeprefix('torch.'))

    def transcribe(self, audio, language=None, initial_prompt=None, **kwargs):
        if language not in (None, 'auto') and self.languages and language not in self.languages:
            raise ValueError('This Parakeet model does not support the selected language. Choose a compatible speech model.')
        if not isinstance(audio, np.ndarray):
            from faster_whisper.audio import decode_audio
            audio = decode_audio(audio, sampling_rate=16000)
        if audio.ndim != 1 or not np.isfinite(audio).all():
            raise ValueError('Speech audio must be finite, mono 16 kHz samples.')
        if not has_audio_signal(audio):
            return [], SimpleNamespace(language='en' if self.languages == ['en'] else language)
        tokens = []
        # Bound encoder attention memory for meeting-length audio. Overlap protects boundary words.
        with self.torch.inference_mode():
            for start, end, lower, upper in self.chunks(audio):
                chunk = audio[start:end]
                if has_audio_signal(chunk):
                    wave = np.concatenate([np.zeros(self.leading_samples, np.float32), chunk.astype(np.float32, copy=False)])
                    inputs = self.processor(wave, sampling_rate=16000, return_tensors='pt').to(self.device, self.dtype)
                    output = self.network.generate(**inputs)
                    tokens.extend(self.timed_tokens(output, lower, upper))
        # Whisper prompt/beam/VAD arguments have no equivalent in greedy TDT decoding.
        text = self.processor.batch_decode([tokens], skip_special_tokens=True)[0].strip() if tokens else ''
        return [SimpleNamespace(text=text)] if text else [], SimpleNamespace(language='en' if self.languages == ['en'] else language)
