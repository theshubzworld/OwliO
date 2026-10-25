"""Parakeet input, language and chunking contracts without downloading model weights."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
import numpy as np
from parakeet_backend import ParakeetEngine
import speech_backends


class ParakeetTests(unittest.TestCase):
    def engine(self, texts=('Hello world.',)):
        engine = ParakeetEngine.__new__(ParakeetEngine)
        engine.device, engine.dtype, engine.languages, engine.leading_samples = 'cpu', 'float32', ['en'], 4000
        engine.frame_samples = 1280
        engine.torch = SimpleNamespace(inference_mode=nullcontext)
        self.waves = []
        def process(wave, **kwargs):
            self.waves.append(wave)
            self.assertEqual(kwargs['sampling_rate'], 16000)
            return SimpleNamespace(to=lambda *args: {'input_features': 'features'})
        engine.processor = Mock(side_effect=process)
        engine.processor.batch_decode = Mock(side_effect=[[text] for text in texts])
        engine.processor.tokenizer = SimpleNamespace(all_special_ids=[], convert_ids_to_tokens=lambda ids: ['▁word'] * len(ids))
        engine.processor.blank_token_id = 8192
        engine.network = SimpleNamespace(generate=Mock(return_value=SimpleNamespace(sequences=np.array([[1, 2]]), durations=np.array([[0, 1]]))))
        return engine

    def test_silence_empty_and_language_mismatch_never_generate(self):
        engine = self.engine()
        for wave in (np.zeros(0, np.float32), np.zeros(16000, np.float32)):
            self.assertEqual(engine.transcribe(wave)[0], [])
        for lang in ('hi', 'hinglish', 'fr'):
            with self.assertRaisesRegex(ValueError, 'language'):
                engine.transcribe(np.ones(16000, np.float32), language=lang)
        engine.network.generate.assert_not_called()

    def test_padding_and_output_normalization_and_unsupported_prompt_arguments(self):
        engine = self.engine()
        segments, info = engine.transcribe(np.ones(16000, np.float32), language='en', initial_prompt='Do not echo this', beam_size=5, vad_filter=True)
        self.assertEqual([part.text for part in segments], ['Hello world.'])
        self.assertEqual(info.language, 'en')
        self.assertEqual(len(self.waves[0]), 20000)
        self.assertTrue(np.all(self.waves[0][:4000] == 0))
        engine.network.generate.assert_called_once_with(input_features='features')
        engine.processor.batch_decode.assert_called_once_with([[1, 2]], skip_special_tokens=True)

    def test_long_audio_is_bounded_and_intentional_repetition_survives_timed_overlap(self):
        engine = self.engine(['Repeated sentence. Repeated sentence.'])
        engine.network.generate.side_effect = [
            SimpleNamespace(sequences=np.array([[11]]), durations=np.array([[10]])),
            SimpleNamespace(sequences=np.array([[11, 11]]), durations=np.array([[40, 0]])),
        ]
        parts, _ = engine.transcribe(np.ones(30 * 16000, np.float32))
        self.assertEqual(parts[0].text, 'Repeated sentence. Repeated sentence.')
        engine.processor.batch_decode.assert_called_once_with([[11, 11]], skip_special_tokens=True)
        self.assertEqual(len(self.waves), 2)
        self.assertTrue(all(len(wave) <= 20 * 16000 + 4000 for wave in self.waves))

    def test_pause_cuts_preserve_every_sample_without_overlapping_or_losing_repeated_words(self):
        audio = np.ones(30 * 16000, np.float32)
        audio[18 * 16000:19 * 16000] = 0
        chunks = list(ParakeetEngine.chunks(audio))
        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0][1], chunks[1][0])
        self.assertTrue(18 * 16000 < chunks[0][1] < 19 * 16000)
        self.assertEqual(chunks[0][3], np.inf)
        self.assertEqual(chunks[1][2], -np.inf)

    def test_subword_tokens_are_trimmed_as_whole_words(self):
        engine = self.engine()
        engine.processor.tokenizer.convert_ids_to_tokens = lambda ids: ['▁tom', 'orrow', '▁morning']
        output = SimpleNamespace(sequences=np.array([[10, 20, 30]]), durations=np.array([[4, 10, 1]]))
        self.assertEqual(engine.timed_tokens(output, 1000, np.inf), [30])

    def test_exact_chunk_length_does_not_generate_an_overlap_only_tail(self):
        engine = self.engine()
        engine.transcribe(np.ones(20 * 16000, np.float32))
        engine.network.generate.assert_called_once()

    def test_invalid_audio_is_rejected(self):
        engine = self.engine()
        for wave in (np.ones((2, 20)), np.array([np.nan], np.float32)):
            with self.assertRaisesRegex(ValueError, 'finite, mono'):
                engine.transcribe(wave)

    def test_runtime_requirement_is_reported_without_importing_torch(self):
        with patch.object(speech_backends, 'version', return_value='5.5.3'):
            self.assertIn('5.19.0', speech_backends.runtime_error('parakeet-tdt'))
        with patch.object(speech_backends, 'version', return_value='5.19.0'):
            self.assertIsNone(speech_backends.runtime_error('parakeet-tdt'))
        with patch.object(speech_backends, 'version', side_effect=speech_backends.PackageNotFoundError):
            self.assertIn('Full speech', speech_backends.runtime_error('parakeet-tdt'))


if __name__ == '__main__':
    unittest.main()
