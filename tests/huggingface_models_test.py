"""Repository validation, incomplete downloads, persistence and unsupported architectures."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import huggingface_models as hf
import model_manager as manager


class HuggingFaceTests(unittest.TestCase):
    def test_only_model_repositories_are_accepted(self):
        self.assertEqual(hf.repository_from_url('https://huggingface.co/Trelis/whisper-hinglish-preview/tree/main'), 'Trelis/whisper-hinglish-preview')
        for value in ('https://evil.example/owner/model', 'http://huggingface.co/owner/model', 'https://user@huggingface.co/owner/model', 'owner/../model', 'datasets/model', 'spaces/model', 'https://huggingface.co/owner/model?token=secret'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                hf.repository_from_url(value)

    def inspect(self, config, filenames, languages=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, 'config.json')
            path.write_text(json.dumps(config))
            info = SimpleNamespace(sha='pinned-revision', card_data={'language':languages}, siblings=[SimpleNamespace(rfilename=name, size=10) for name in filenames])
            with patch.object(hf, 'HfApi') as api, patch.object(hf, 'hf_hub_download', return_value=str(path)):
                api.return_value.model_info.return_value = info
                return hf.inspect_repository('owner/model', directory)

    def test_custom_model_coverage_comes_from_declared_card_data_not_tokenizer_presence(self):
        files = ['config.json', 'model.safetensors', 'tokenizer.json']
        self.assertEqual(self.inspect({'model_type':'whisper'}, files, ['ta','fr','bad-code','ta'])['languages'], ['fr','ta'])
        self.assertEqual(self.inspect({'model_type':'whisper'}, files, 'en')['languages'], ['en'])
        self.assertIsNone(self.inspect({'model_type':'whisper'}, files)['languages'])

    def test_rejects_non_whisper_and_pickle_only_before_downloading_weights(self):
        for config, files in (({'model_type': 'llama'}, ['config.json', 'model.safetensors', 'tokenizer.json']),
                              ({'model_type': 'whisper'}, ['config.json', 'pytorch_model.bin', 'tokenizer.json'])):
            with self.assertRaises(ValueError):
                self.inspect(config, files)

    def test_only_required_assets_are_downloaded_at_a_pinned_revision(self):
        entry = self.inspect({'model_type': 'whisper'}, ['config.json', 'model.safetensors', 'tokenizer.json', 'train_logs.json', 'run.py', 'pytorch_model.bin'])
        self.assertEqual(entry['revision'], 'pinned-revision')
        self.assertEqual(entry['files'], ['config.json', 'model.safetensors', 'tokenizer.json'])
        self.assertEqual(entry['engine'], 'transformers')
        converted = self.inspect({}, ['config.json', 'model.bin', 'tokenizer.json'])
        self.assertEqual(converted['engine'], 'faster-whisper')

    def test_download_failure_is_persisted_as_uninstalled_and_can_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            entry = {'id': 'hf:owner/model', 'name': 'owner/model', 'repository': 'owner/model', 'revision': 'sha', 'engine': 'transformers', 'bytes': 10, 'files': ['config.json', 'model.safetensors']}
            service = manager.ModelManager(cache_dir=directory)
            try:
                with patch.object(manager, 'inspect_repository', return_value=entry), patch.object(manager, 'download_repository', side_effect=RuntimeError('connection lost')):
                    job = service.import_url('owner/model')
                    service.close()
                self.assertEqual(service.catalogue()['jobs'][0]['status'], 'failed')
                self.assertEqual(service.active_model, 'base')
                with self.assertRaisesRegex(ValueError, 'Download'):
                    service.start_job(entry['id'], 'activate')
                restored = manager.ModelManager(cache_dir=directory)
                try:
                    self.assertEqual(restored.normalize(entry['id']), entry['id'])
                    self.assertFalse(next(row for row in restored.catalogue()['models'] if row['id'] == entry['id'])['downloaded'])
                finally:
                    restored.close()
            finally:
                service.close()


if __name__ == '__main__':
    unittest.main()
