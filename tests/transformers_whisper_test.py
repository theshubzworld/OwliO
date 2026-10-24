"""Exercise language routing without downloading or loading model weights."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock
import unittest
import numpy as np
from transformers_whisper import TransformersWhisper


class TransformerLanguageTests(unittest.TestCase):
    def engine(self, vocab):
        engine = TransformersWhisper.__new__(TransformersWhisper)
        engine.device, engine.dtype = 'cpu', 'float32'
        engine.torch = SimpleNamespace(inference_mode=nullcontext, tensor=lambda value, **kwargs: value)
        feature = SimpleNamespace(to=lambda *args: 'features')
        tokenizer = SimpleNamespace(get_vocab=lambda: vocab, convert_tokens_to_ids=lambda value: 1, decode=lambda *args, **kwargs: 'Preserved transcript')
        engine.processor = SimpleNamespace(tokenizer=tokenizer, feature_extractor=lambda *args, **kwargs: SimpleNamespace(input_features=feature), get_prompt_ids=Mock(return_value=np.array([50, 51, 52])))
        engine.network = SimpleNamespace(generate=Mock(return_value=[[]]))
        return engine

    def test_english_only_checkpoint_does_not_receive_multilingual_generation_flags(self):
        for language in ('en', None):
            engine = self.engine({'<|startoftranscript|>':1, '<|transcribe|>':2})
            segments, _ = engine.transcribe(np.full(16000, .1, dtype=np.float32), language=language)
            self.assertEqual(segments[0].text, 'Preserved transcript')
            self.assertNotIn('language', engine.network.generate.call_args.kwargs)
            self.assertNotIn('task', engine.network.generate.call_args.kwargs)
        with self.assertRaisesRegex(ValueError, 'English only'):
            self.engine({}).transcribe(np.full(16000, .1), language='fr')

    def test_multilingual_generation_uses_explicit_language_or_transcription_detection(self):
        for language in ('ta', None):
            engine = self.engine({'<|en|>':10, '<|ta|>':20})
            engine.transcribe(np.full(16000, .1, dtype=np.float32), language=language)
            options = engine.network.generate.call_args.kwargs
            if language:
                self.assertEqual(options['decoder_input_ids'][0][1], 20)
            else:
                self.assertIsNone(options['language'])
                self.assertEqual(options['task'], 'transcribe')

    def test_initial_prompt_conditions_explicit_and_detected_languages_on_each_chunk(self):
        for language in ('ta', None, 'en'):
            engine = self.engine({'<|en|>':10, '<|ta|>':20} if language != 'en' else {})
            engine.transcribe(np.full(61 * 16000, .1), language=language, initial_prompt='  Owlio Kubernetes  ')
            engine.processor.get_prompt_ids.assert_called_once_with('Owlio Kubernetes')
            self.assertEqual(engine.network.generate.call_count, 3)
            for call in engine.network.generate.call_args_list:
                options = call.kwargs
                if language == 'ta':
                    self.assertEqual(options['decoder_input_ids'][0][:3], [50, 51, 52])
                    self.assertEqual(options['decoder_input_ids'][0][4], 20)
                    self.assertNotIn('prompt_ids', options)
                else:
                    self.assertEqual(options['prompt_ids'], [50, 51, 52])
                self.assertLessEqual(options['max_new_tokens'] + 7, 448)

    def test_hinglish_uses_checkpoint_protocol_without_forcing_unknown_models_to_hindi(self):
        for model_id, mixedcode, expected in (
            ('mayank-dubey-ai/whisper-large-v3-turbo-hinglish', False, 10),
            ('oriserve/whisper-hindi2hinglish-apex', False, 10),
            ('trelis/whisper-hinglish-preview', True, 20),
            ('owner/custom', False, None),
        ):
            vocab = {'<|en|>':10, '<|hi|>':20}
            if mixedcode:
                vocab['<|mixedcode|>'] = 30
            engine = self.engine(vocab)
            engine.model_id = model_id
            engine.transcribe(np.full(16000, .1), language='hinglish')
            options = engine.network.generate.call_args.kwargs
            if expected is None:
                self.assertNotIn('decoder_input_ids', options)
                self.assertIsNone(options['language'])
            else:
                self.assertEqual(options['decoder_input_ids'][0][1], expected)
                if mixedcode:
                    self.assertEqual(options['decoder_input_ids'][0][2], 30)

    def test_long_vocabulary_prompts_reserve_space_for_transcription(self):
        engine = self.engine({'<|en|>':10, '<|hi|>':20})
        engine.processor.get_prompt_ids.return_value = np.arange(500)
        engine.transcribe(np.full(16000, .1), language='hi', initial_prompt='vocabulary')
        options = engine.network.generate.call_args.kwargs
        prefix = options['decoder_input_ids'][0]
        self.assertEqual(prefix[0], 0)
        self.assertEqual(prefix[222], 499)
        self.assertEqual(len(prefix) + options['max_new_tokens'], 448)
