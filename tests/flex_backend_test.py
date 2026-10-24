"""Flex native-only routing, and long-audio handling without loading weights."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import flex_backend as flex
import model_manager


class FlexTests(unittest.TestCase):
    def engine(self):
        instance = flex.FlexEngine.__new__(flex.FlexEngine)
        instance.asr = object()
        return instance

    def test_all_27_documented_languages_route_to_native_transcription(self):
        import ast
        source = ast.parse((Path(__file__).resolve().parents[1]/'vendor/bodhan_flex/indic_transcribe.py').read_text(encoding='utf-8'))
        bundled = next(ast.literal_eval(node.value) for node in source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'LANGUAGES' for target in node.targets))
        self.assertEqual(set(flex.FLEX_LANGUAGE_CODES), set(bundled))
        self.assertEqual(len(flex.FLEX_LANGUAGE_CODES), 27)
        long_form = SimpleNamespace(transcribe_long=Mock(return_value='Native transcript'))
        with patch.dict(sys.modules, {'vendor.bodhan_flex.long_form': long_form}):
            for language in flex.FLEX_LANGUAGE_CODES:
                segments, _ = self.engine().transcribe(np.full(16000, .1, dtype=np.float32), language=language)
                self.assertEqual(segments[0].text, 'Native transcript')
                self.assertEqual(long_form.transcribe_long.call_args.kwargs, {'lang': language, 'mode': 'native'})

    def test_native_transcription_ignores_removed_output_preferences(self):
        long_form = SimpleNamespace(transcribe_long=Mock(return_value='kal meeting hai'))
        with patch.dict(sys.modules, {'vendor.bodhan_flex.long_form': long_form}):
            for mode in ('romanized', 'native', 'mixed'):
                audio = np.full(31*16000, 0.1, dtype=np.float32)
                segments, _ = self.engine().transcribe(audio, language='hinglish', output_mode=mode)
                self.assertEqual(segments[0].text, 'kal meeting hai')
                options = long_form.transcribe_long.call_args.kwargs
                self.assertEqual(options, {'lang': 'hi', 'mode': 'native'})
                self.assertEqual(len(long_form.transcribe_long.call_args.args[1]), len(audio))

    def test_silence_never_reaches_decoder_and_invalid_language_is_rejected(self):
        long_form = SimpleNamespace(transcribe_long=Mock())
        with patch.dict(sys.modules, {'vendor.bodhan_flex.long_form': long_form}):
            segments, _ = self.engine().transcribe(np.zeros(16000, dtype=np.float32))
            self.assertEqual(segments, [])
            long_form.transcribe_long.assert_not_called()
            with self.assertRaises(ValueError):
                self.engine().transcribe(np.ones(16000), language='unsupported')

    def test_catalogue_needs_complete_pinned_assets_and_download_does_not_import_repo_code(self):
        with tempfile.TemporaryDirectory() as directory:
            service = model_manager.ModelManager(cache_dir=directory)
            try:
                self.assertEqual(service.normalize('hf:' + flex.FLEX_REPO), flex.FLEX_ID)
                row = next(row for row in service.catalogue()['models'] if row['id'] == flex.FLEX_ID)
                self.assertFalse(row['downloaded'])
                with self.assertRaisesRegex(ValueError, 'Download'):
                    service.start_job(flex.FLEX_ID, 'activate')
                destination = flex.flex_directory(directory)
                destination.mkdir(parents=True)
                (destination/'model.safetensors').write_bytes(b'partial')
                (destination/'source.json').write_text(json.dumps({'repository': flex.FLEX_REPO, 'revision': flex.FLEX_REVISION}))
                self.assertIsNone(flex.cached_flex(directory))
                with patch.object(flex, 'snapshot_download') as download, patch.object(flex, 'cached_flex', return_value=str(destination)):
                    flex.download_flex(directory)
                args = download.call_args.kwargs
                self.assertEqual(args['revision'], flex.FLEX_REVISION)
                self.assertFalse(any(file.endswith('.py') for file in args['allow_patterns']))
            finally:
                service.close()


if __name__ == '__main__':
    unittest.main()
