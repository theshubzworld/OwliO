"""Full Whisper checkpoints, including Trelis's dedicated Hinglish token."""
from types import SimpleNamespace
import re
import numpy as np
from flex_backend import has_audio_signal


class TransformersWhisper:
    def __init__(self, path, device="auto", model_id=None):
        try:
            import torch
            from transformers import WhisperProcessor, WhisperForConditionalGeneration
        except ImportError as error:
            raise RuntimeError("This model needs PyTorch and Transformers. Start the server with a Python runtime containing the speech dependencies.") from error
        self.torch = torch
        self.model_id = (model_id or str(path)).lower().removeprefix('hf:')
        self.device = "cuda" if device != "cpu" and torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.processor = WhisperProcessor.from_pretrained(path, local_files_only=True, trust_remote_code=False)
        self.network = WhisperForConditionalGeneration.from_pretrained(
            path, torch_dtype=self.dtype, local_files_only=True, trust_remote_code=False,
            use_safetensors=True, low_cpu_mem_usage=True, attn_implementation="sdpa").to(self.device).eval()
        self.model = SimpleNamespace(device=self.device, compute_type="float16" if self.device == "cuda" else "float32")

    def transcribe(self, audio, language="en", initial_prompt=None, **kwargs):
        if not isinstance(audio, np.ndarray):
            from faster_whisper.audio import decode_audio
            audio = decode_audio(audio, sampling_rate=16000)
        tokenizer = self.processor.tokenizer
        mixed = language in ("hinglish", "hi-en", "english-hinglish")
        # These checkpoints were trained with English decoder tokens for Roman Hindi.
        # Keep Trelis's separate Hindi + mixedcode protocol when its token is present.
        roman_checkpoint = getattr(self, 'model_id', '') in (
            'mayank-dubey-ai/whisper-large-v3-turbo-hinglish',
            'oriserve/whisper-hindi2hinglish-apex',
        )
        lang = ('en' if roman_checkpoint else 'hi' if '<|mixedcode|>' in self.processor.tokenizer.get_vocab() else None) if mixed else language
        prefix = None
        vocab = tokenizer.get_vocab()
        english_only = '<|en|>' not in vocab and not any(re.fullmatch(r'<\|[a-z]{2,3}\|>', token) for token in vocab)
        if english_only and lang not in (None, 'en'):
            raise ValueError('This English-only Whisper checkpoint supports English only.')
        if lang and not english_only:
            token = f"<|{lang}|>"
            if token not in vocab:
                raise ValueError(f"This model does not support language {lang!r}.")
            prefix = [tokenizer.convert_tokens_to_ids("<|startoftranscript|>"), vocab[token]]
            if mixed and "<|mixedcode|>" in vocab:
                prefix.append(vocab["<|mixedcode|>"])
            prefix += [tokenizer.convert_tokens_to_ids("<|transcribe|>"), tokenizer.convert_tokens_to_ids("<|notimestamps|>")]
        prompt_tokens = []
        max_positions = getattr(getattr(self.network, 'config', None), 'max_target_positions', 448)
        if initial_prompt and initial_prompt.strip():
            prompt_tokens = self.processor.get_prompt_ids(initial_prompt.strip()).tolist()
            # Keep the start-of-previous token and the most recent vocabulary hints.
            limit = max_positions // 2 - 1
            if len(prompt_tokens) > limit:
                prompt_tokens = prompt_tokens[:1] + prompt_tokens[-(limit - 1):]
        texts = []
        # Whisper accepts at most 30 seconds per encoder pass. Small overlap preserves words at boundaries.
        chunk_size, overlap = 30 * 16000, 16000
        with self.torch.inference_mode():
            for start in range(0, len(audio), chunk_size - overlap):
                chunk = audio[start:start + chunk_size]
                if not has_audio_signal(chunk):
                    continue
                features = self.processor.feature_extractor(chunk, sampling_rate=16000, return_tensors="pt").input_features.to(self.device, self.dtype)
                generate = {"max_new_tokens": min(440, max_positions - len(prompt_tokens) - len(prefix or [0]*4)), "return_timestamps": False, "do_sample": False}
                if prefix:
                    # Transformers bypasses prompt_ids when decoder_input_ids is
                    # supplied, so include context tokens in the explicit prefix.
                    generate["decoder_input_ids"] = self.torch.tensor([prompt_tokens + prefix], device=self.device)
                elif not english_only:
                    generate.update(language=None, task="transcribe")
                if prompt_tokens and not prefix:
                    generate["prompt_ids"] = self.torch.tensor(prompt_tokens, device=self.device)
                output = self.network.generate(input_features=features, **generate)
                text = tokenizer.decode(output[0], skip_special_tokens=True).strip()
                # Remove the identical word sequence decoded on both sides of an overlap.
                if texts:
                    previous, current = texts[-1].split(), text.split()
                    for count in range(min(25, len(previous), len(current)), 0, -1):
                        if [word.casefold().strip('.,!?') for word in previous[-count:]] == [word.casefold().strip('.,!?') for word in current[:count]]:
                            text = " ".join(current[count:])
                            break
                if text:
                    texts.append(text)
                if start + chunk_size >= len(audio):
                    break
        return [SimpleNamespace(text=text) for text in texts], SimpleNamespace(language=lang)
