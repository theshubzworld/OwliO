"""Verify the HTTP response contract without downloading or running a speech model."""
import io
import sys
import wave
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import server


class ResponseTests(unittest.TestCase):
    def test_bark_english_only_metadata_blocks_hinglish_before_loading(self):
        for language in ('hi', 'hinglish', 'fr'):
            with patch.object(server, 'load_whisper_model') as loader:
                response = self.client.post('/v1/audio/transcriptions', data={'model':'bark-pro','language':language}, files={'file':('test.wav',self.wav(10000),'audio/wav')})
            self.assertEqual(response.status_code, 400)
            loader.assert_not_called()

    def test_documented_language_mismatch_is_rejected_before_model_inference(self):
        with patch.object(server.model_manager, 'supported_languages', return_value=['hi','en']), patch.object(server, 'load_whisper_model') as loader:
            response = self.client.post('/v1/audio/transcriptions', data={'language':'ta'}, files={'file':('test.wav',self.wav(10000),'audio/wav')})
        self.assertEqual(response.status_code,400)
        self.assertIn('does not document support',response.json()['detail'])
        loader.assert_not_called()

    def setUp(self):
        self.client = TestClient(server.app)

    def wav(self, value):
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(int(value).to_bytes(2, "little", signed=True) * 16000)
        return output.getvalue()

    def request(self, response_format, value=10000):
        model = SimpleNamespace(transcribe=lambda *args, **kwargs: ([SimpleNamespace(text=" Hello world ")], None))
        with patch.object(server, "load_whisper_model", return_value=model):
            return self.client.post("/v1/audio/transcriptions", data={"response_format": response_format},
                                    files={"file": ("test.wav", self.wav(value), "audio/wav")})

    def test_text_is_plain_text(self):
        response = self.request("text")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/plain"))
        self.assertEqual(response.text, "Hello world")

    def test_json_contains_text(self):
        self.assertEqual(self.request("json").json(), {"text": "Hello world"})

    def test_sparse_non_silent_segment_reaches_model_despite_long_silence(self):
        output = io.BytesIO()
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(int(.03 * 32767).to_bytes(2, "little", signed=True) * 16000 + b'\0' * (119 * 32000))
        engine = SimpleNamespace(transcribe=lambda *args, **kwargs: ([SimpleNamespace(text="Preserved speech")], None))
        with patch.object(server, "load_whisper_model", return_value=engine) as loader:
            response = self.client.post('/v1/audio/transcriptions', data={'response_format': 'text'}, files={'file': ('sparse.wav', output.getvalue(), 'audio/wav')})
        self.assertEqual(response.text, 'Preserved speech')
        loader.assert_called_once()

    def test_silence_obeys_requested_format(self):
        response = self.request("text", 0)
        self.assertEqual(response.text, "")
        self.assertTrue(response.headers["content-type"].startswith("text/plain"))
        self.assertEqual(self.request("json", 0).json(), {"text": ""})

    def test_hinglish_is_preserved_for_transformers_but_compatible_with_faster_whisper(self):
        for custom, expected in ((True, 'hinglish'), (False, 'hi')):
            observed = {}
            def transcribe(*args, **kwargs):
                observed.update(kwargs)
                return [SimpleNamespace(text='कल meeting है')], None
            model = SimpleNamespace(transcribe=transcribe)
            if custom:
                model.processor = object()
            with patch.object(server, 'load_whisper_model', return_value=model):
                response = self.client.post('/v1/audio/transcriptions', data={'language': 'hinglish'}, files={'file': ('test.wav', self.wav(10000), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(observed['language'], expected)

    def test_flex_language_is_forwarded_but_legacy_transliteration_is_ignored(self):
        observed = {}
        def transcribe(*args, **kwargs):
            observed.update(kwargs)
            return [SimpleNamespace(text='kal meeting hai')], None
        model = SimpleNamespace(transcribe=transcribe, supports_hinglish=True, supports_output_modes=True)
        with patch.object(server, 'load_whisper_model', return_value=model):
            response = self.client.post('/v1/audio/transcriptions', data={'language': 'hinglish', 'output_mode': 'romanized', 'response_format': 'text'}, files={'file': ('test.wav', self.wav(10000), 'audio/wav')})
        self.assertEqual(response.text, 'kal meeting hai')
        self.assertEqual(observed['language'], 'hinglish')
        self.assertNotIn('output_mode', observed)

    def test_multilingual_and_auto_reach_transcription_without_translation(self):
        for language in ('ta', 'te', 'mr', 'ar', 'fr', 'ja', 'auto', None):
            observed = {}
            def transcribe(*args, **kwargs):
                observed.update(kwargs)
                return [SimpleNamespace(text='வணக்கம் مرحبا Bonjour こんにちは')], None
            data = {'response_format': 'text'}
            if language is not None:
                data['language'] = language
            with patch.object(server, 'load_whisper_model', return_value=SimpleNamespace(transcribe=transcribe)):
                response = self.client.post('/v1/audio/transcriptions', data=data, files={'file': ('test.wav', self.wav(10000), 'audio/wav')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(observed['language'], None if language in ('auto', None) else language)
            self.assertEqual(response.text, 'வணக்கம் مرحبا Bonjour こんにちは')
            self.assertNotIn('output_mode', observed)
            self.assertNotEqual(observed.get('task'), 'translate')


if __name__ == "__main__":
    unittest.main()
