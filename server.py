import io
import os
import sys
import wave
import asyncio
import numpy as np
import av
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from model_manager import ModelManager, MODEL_IDS
from flex_backend import FLEX_ID, has_audio_signal
from faster_whisper import WhisperModel
import uvicorn

# Fix PyAV 19+ incompatibility where metadata_errors was removed from av.open
_orig_av_open = av.open
def _safe_av_open(*args, **kwargs):
    kwargs.pop("metadata_errors", None)
    return _orig_av_open(*args, **kwargs)
av.open = _safe_av_open

app = FastAPI(title="Owlio Local Speech Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("OWLIO_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,file://").split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "base").lower().strip()
if DEFAULT_MODEL not in (*MODEL_IDS, FLEX_ID, 'large', 'large-v3-turbo', 'whisper-1'):
    print(f"[WHISPER] Unsupported WHISPER_MODEL={DEFAULT_MODEL!r}; using 'base'.")
    DEFAULT_MODEL = "base"
DEVICE = os.getenv("WHISPER_DEVICE", "auto")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "auto")

model_manager = ModelManager(DEFAULT_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
MAX_AUDIO_BYTES = int(os.getenv("WHISPER_MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))

def load_whisper_model(name: str = None) -> WhisperModel:
    return model_manager.load(name)

@app.get("/")
def root():
    return {
        "status": "online",
        "service": "Owlio Local Speech Server",
        "default_model": model_manager.active_model,
        "available_models": list(MODEL_IDS) + [FLEX_ID],
        "endpoint": "/v1/audio/transcriptions"
    }


class ModelRequest(BaseModel):
    model: str


class ImportRequest(BaseModel):
    url: str


@app.post("/v1/models/import", status_code=202)
def import_model(request: ImportRequest):
    try:
        return model_manager.import_url(request.url)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/v1/models")
def models():
    return model_manager.catalogue()


@app.post("/v1/models/download", status_code=202)
def download_model(request: ModelRequest):
    try:
        return model_manager.start_job(request.model, "download")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/models/activate", status_code=202)
def activate_model(request: ModelRequest):
    try:
        return model_manager.start_job(request.model, "activate")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/v1/models/delete")
def delete_model(request: ModelRequest):
    try:
        return model_manager.delete_model(request.model)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {error}") from error

@app.post("/v1/audio/transcriptions")
@app.post("/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(None, alias="model"),
    language: str = Form(None),
    prompt: str = Form(None),
    response_format: str = Form(None)
):
    if file.content_type and not (file.content_type.startswith("audio/") or file.content_type in ("application/octet-stream", "application/wav")):
        raise HTTPException(status_code=415, detail="Only audio uploads are supported")
    audio_bytes = await file.read(MAX_AUDIO_BYTES + 1)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=f"Audio upload exceeds {MAX_AUDIO_BYTES} bytes")
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio upload is empty")

    # Direct fast path: 16kHz 16-bit mono WAV to float32 numpy array (zero container overhead)
    audio_input = None
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            if wf.getframerate() == 16000 and wf.getnchannels() == 1 and wf.getsampwidth() == 2:
                frames = wf.readframes(wf.getnframes())
                audio_input = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    except Exception:
        pass

    if audio_input is None:
        audio_input = io.BytesIO(audio_bytes)
    elif isinstance(audio_input, np.ndarray):
        if not has_audio_signal(audio_input):
            return PlainTextResponse("") if (response_format or "json").lower() == "text" else {"text": ""}

    # Handle language & Hinglish support
    lang_to_use = (language or "auto").lower().strip()
    initial_prompt = prompt

    def run_transcription():
        with model_manager.inference_lock:
            lang, speech_prompt = lang_to_use, initial_prompt
            supported = model_manager.supported_languages(model_name)
            language_code = 'hi' if lang in ('hinglish', 'hi-en', 'english-hinglish') else lang
            if language_code != 'auto' and supported and language_code not in supported:
                raise ValueError('The selected model does not document support for this language. Choose a compatible speech model.')
            active_model = load_whisper_model(model_name)
            if lang in ("hinglish", "hi-en", "english-hinglish") and not hasattr(active_model, "processor") and not getattr(active_model, 'supports_hinglish', False):
                lang = "hi"
                speech_prompt = speech_prompt or "Hindi and English conversation. Preserve the spoken words in their original language."
            segments, info = active_model.transcribe(
                audio_input,
                language=lang if lang != "auto" else None,
                initial_prompt=speech_prompt,
                beam_size=5,
                vad_filter=True,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()

    try:
        full_text = await asyncio.to_thread(run_transcription)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Local speech model failed: {error}") from error

    if (response_format or "json").lower() == "text":
        return PlainTextResponse(full_text)
    return {"text": full_text}

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8000"))
    print(f"[OWLIO] Local Speech Server running at http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)
