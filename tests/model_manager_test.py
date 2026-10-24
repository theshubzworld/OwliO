import sys
import unittest
import tempfile
import threading
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model_manager as module


class ModelTests(unittest.TestCase):
    def test_catalogue_reports_documented_languages_without_loading_models(self):
        rows = {row['id']: row for row in self.manager.catalogue()['models']}
        for name in ('tiny', 'base', 'small', 'medium'):
            self.assertEqual(len(rows[name]['languages']), 99)
            self.assertNotIn('yue', rows[name]['languages'])
        for name in ('large-v3', 'turbo'):
            self.assertEqual(len(rows[name]['languages']), 100)
            self.assertIn('yue', rows[name]['languages'])
        self.assertEqual(len(rows['bodhan-flex']['languages']), 27)
        self.assertIn('bho', rows['bodhan-flex']['languages'])
        self.assertNotIn('fr', rows['bodhan-flex']['languages'])
        self.assertIsNone(self.manager.engine)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.manager = module.ModelManager(cache_dir=self.temp.name)
        self.cuda = patch('cuda_runtime.prepare_cuda')
        self.cuda.start()

    def tearDown(self):
        self.manager.close()
        self.cuda.stop()
        self.temp.cleanup()

    def test_complete_cache_required_and_no_implicit_download(self):
        model = Path(self.temp.name, 'model.bin')
        model.write_bytes(b'weights')
        with patch.object(module, 'try_to_load_from_cache', side_effect=lambda repo, file, **kw: str(Path(self.temp.name, file))), patch.object(module.utils, 'download_model') as download:
            self.assertIsNone(self.manager.cached_path('base'))
            with self.assertRaisesRegex(ValueError, 'not downloaded'):
                self.manager.load('base')
            download.assert_not_called()

    def test_failed_model_load_keeps_working_engine(self):
        previous = object()
        self.manager.engine, self.manager.loaded_model = previous, 'base'
        with patch.object(self.manager, 'cached_path', return_value=self.temp.name), patch.object(module, 'WhisperModel', side_effect=RuntimeError('out of memory')):
            with self.assertRaisesRegex(RuntimeError, 'memory'):
                self.manager.load('small')
        self.assertIs(self.manager.engine, previous)
        self.assertEqual(self.manager.loaded_model, 'base')

    def test_download_is_background_bounded_and_does_not_activate(self):
        entered, release = threading.Event(), threading.Event()
        def download(*args, **kwargs):
            entered.set()
            release.wait(5)
        with patch.object(self.manager, 'cached_path', side_effect=lambda name: self.temp.name if release.is_set() else None), patch.object(module.utils, 'download_model', side_effect=download):
            try:
                job = self.manager.start_job('tiny', 'download')
                self.assertTrue(entered.wait(2))
                self.assertEqual(self.manager.start_job('tiny', 'download')['id'], job['id'])
                with self.assertRaisesRegex(ValueError, 'already running'):
                    self.manager.start_job('small', 'download')
            finally:
                release.set()
                self.manager.close()
        self.assertEqual(self.manager.catalogue()['jobs'][0]['status'], 'ready')
        self.assertEqual(self.manager.active_model, 'base')

    def test_activation_requires_download_and_aliases_are_explicit(self):
        with patch.object(self.manager, 'cached_path', return_value=None):
            with self.assertRaisesRegex(ValueError, 'Download'):
                self.manager.start_job('small', 'activate')
        self.assertEqual(self.manager.normalize('large-v3-turbo'), 'turbo')
        with self.assertRaises(ValueError):
            self.manager.normalize('../../anything')

    def test_native_runtime_polling_is_safe_while_model_is_suspended(self):
        class NativeModel:
            suspended = False
            @property
            def compute_type(self):
                if self.suspended:
                    raise RuntimeError('No model replica is available in this thread')
                return 'float16'
            def unload_model(self):
                self.suspended = True
            def load_model(self):
                self.suspended = False
        native = NativeModel()
        Path(self.temp.name, 'model.bin').write_bytes(b'weights')
        self.manager.engine = SimpleNamespace(model=native)
        self.manager.loaded_model = 'base'
        self.manager._runtime = {'device': 'cuda', 'compute_type': 'float16'}
        def fails(*args, **kwargs):
            self.assertTrue(native.suspended)
            self.assertEqual(self.manager.catalogue()['runtime']['compute_type'], 'float16')
            raise RuntimeError('Out of memory')
        with patch.object(self.manager, 'cached_path', return_value=self.temp.name), patch.object(module, 'WhisperModel', side_effect=fails):
            with self.assertRaisesRegex(RuntimeError, 'memory'):
                self.manager.load('small')
        self.assertFalse(native.suspended)
        self.assertEqual(self.manager.loaded_model, 'base')


if __name__ == '__main__':
    unittest.main()
