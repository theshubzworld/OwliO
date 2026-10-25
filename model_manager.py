"""Bounded model catalogue and background downloads for the local dictation service."""
import os
import threading
import uuid
import json
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from faster_whisper import WhisperModel, utils
from faster_whisper.tokenizer import _LANGUAGE_CODES
from huggingface_hub import try_to_load_from_cache
from huggingface_models import repository_from_url, inspect_repository, download_repository
from flex_backend import FLEX_LANGUAGE_CODES, FLEX_ID, FLEX_REPO, cached_flex, download_flex, flex_directory
from speech_backends import BUILTIN_MODELS, runtime_error, load_engine

MODEL_IDS = ("tiny", "base", "small", "medium", "large-v3", "turbo")
MODEL_REPOS = {name: utils._MODELS[name] for name in MODEL_IDS}
LABELS = {name: "Whisper " + ("large v3" if name == "large-v3" else "large v3 turbo" if name == "turbo" else name) for name in MODEL_IDS}
DEFAULT_MODEL_CACHE = Path(__file__).resolve().parent / "models"


def _remove_dir(path):
    if not path:
        return
    p = Path(path)
    if not p.is_dir():
        return
    import stat
    def onerror(func, file_path, exc_info):
        try:
            os.chmod(file_path, stat.S_IWRITE)
            func(file_path)
        except Exception:
            pass
    try:
        shutil.rmtree(p, onerror=onerror)
    except Exception:
        pass


class ModelManager:
    def __init__(self, default="base", cache_dir=None, device="auto", compute_type="auto"):
        self.cache_dir = str(cache_dir or os.getenv("OWLIO_MODEL_CACHE") or DEFAULT_MODEL_CACHE)
        self._registry_path = Path(self.cache_dir, "custom-models.json")
        self._custom = {}
        self._lock = threading.RLock()
        self._load_registry()
        self.active_model = self.normalize(default)
        self.device, self.compute_type = device, compute_type
        self.engine = None
        self.loaded_model = None
        self._runtime = {"device": None, "compute_type": None}
        self.inference_lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-download")
        self._jobs = {}

    def _load_registry(self):
        with getattr(self, "_lock", threading.RLock()):
            if self._registry_path.is_file():
                try:
                    new_custom = {}
                    for entry in json.loads(self._registry_path.read_text(encoding="utf-8")):
                        try:
                            repo_url = entry.get("repository", "")
                            if entry.get("id") == "hf:" + repository_from_url(repo_url):
                                new_custom[entry["id"]] = entry
                        except Exception:
                            continue
                    self._custom = new_custom
                except Exception:
                    pass
            else:
                self._custom = {}

    def normalize(self, name):
        if name in (None, "", "whisper-1"):
            return getattr(self, "active_model", "base")
        name = {"large": "large-v3", "large-v3-turbo": "turbo"}.get(name, name)
        if name == 'hf:' + FLEX_REPO:
            name = FLEX_ID
        for builtin, entry in BUILTIN_MODELS.items():
            if str(name).removeprefix('hf:').lower() == entry['repository'].lower():
                name = builtin
        if name not in MODEL_IDS and name != FLEX_ID and name not in self._custom and name not in BUILTIN_MODELS:
            if ("hf:" + name) in self._custom:
                return "hf:" + name
            raise ValueError("Choose a supported speech model: " + ", ".join((*MODEL_IDS, FLEX_ID, *BUILTIN_MODELS)))
        return name

    def cached_path(self, name):
        name = self.normalize(name)
        if name == FLEX_ID:
            return cached_flex(self.cache_dir)
        if name in self._custom or name in BUILTIN_MODELS:
            entry = BUILTIN_MODELS.get(name) or self._custom[name]
            files = [try_to_load_from_cache(entry["repository"], file, revision=entry["revision"], cache_dir=self.cache_dir) for file in entry["files"]]
            if files and all(isinstance(file, str) and Path(file).is_file() for file in files):
                return str(Path(files[0]).parent)
            return None
        repo = MODEL_REPOS[name]
        model = try_to_load_from_cache(repo, "model.bin", cache_dir=self.cache_dir)
        config = try_to_load_from_cache(repo, "config.json", cache_dir=self.cache_dir)
        if isinstance(model, str) and isinstance(config, str) and Path(model).is_file() and Path(config).is_file():
            return str(Path(model).parent)
        return None

    def supported_languages(self, name=None):
        name = self.normalize(name)
        if name == FLEX_ID:
            return list(FLEX_LANGUAGE_CODES)
        if name in MODEL_IDS:
            return [code for code in _LANGUAGE_CODES if code != 'yue' or name in ('large-v3', 'turbo')]
        entry = BUILTIN_MODELS.get(name) or self._custom[name]
        if entry['repository'].lower() == 'trelis/whisper-hinglish-preview':
            return ['hi', 'en']
        return entry.get('languages')

    def catalogue(self):
        self._load_registry()
        rows = []
        for name in MODEL_IDS:
            cached = self.cached_path(name)
            rows.append({"id": name, "name": LABELS[name], "repository": MODEL_REPOS[name],
                         "languages": [code for code in _LANGUAGE_CODES if code != "yue" or name in ("large-v3", "turbo")], "downloaded": bool(cached), "bytes": Path(cached, "model.bin").stat().st_size if cached else None})
        with self._lock:
            custom = list(BUILTIN_MODELS.values()) + list(self._custom.values())
            jobs = [dict(job) for job in self._jobs.values()]
            runtime = dict(self._runtime)
            loaded_model, active_model = self.loaded_model, self.active_model
        rows.extend({key: entry[key] for key in ("id", "name", "repository", "engine", "bytes")} | {"languages":entry.get("languages"),"downloaded": bool(self.cached_path(entry["id"])),
                     "runtime_ready": runtime_error(entry['engine']) is None, "runtime_error": runtime_error(entry['engine'])} for entry in custom)
        rows.append({'id': FLEX_ID, 'name': 'Bodhan Flex · 27 languages', 'repository': FLEX_REPO,
                     'engine': 'bodhan-flex', 'downloaded': bool(self.cached_path(FLEX_ID)),
                     'bytes': 4890451120, 'languages': list(FLEX_LANGUAGE_CODES)})
        return {"service": "Owlio", "active_model": active_model, "loaded_model": loaded_model,
                "models": rows, "jobs": jobs, "runtime": runtime, "cache_directory": self.cache_dir}

    def delete_model(self, name):
        self._load_registry()
        name = self.normalize(name)
        with self.inference_lock:
            if self.engine is not None and self.loaded_model == name:
                previous = self.engine
                previous_model = getattr(previous, "model", None)
                if hasattr(previous_model, "unload_model"):
                    previous_model.unload_model()
                elif hasattr(previous, "network") and hasattr(previous, "torch"):
                    try:
                        previous.network.to("cpu")
                        previous.torch.cuda.empty_cache()
                    except Exception:
                        pass
                self.engine = None
                self.loaded_model = None

        with self._lock:
            if name in self._custom:
                entry = self._custom[name]
                repo = entry["repository"]
                cached = self.cached_path(name)
                hf_folder = Path(self.cache_dir) / ("models--" + repo.replace("/", "--"))
                _remove_dir(hf_folder)
                if cached:
                    _remove_dir(Path(cached).parent.parent if Path(cached).parent.name == "snapshots" else Path(cached))
                del self._custom[name]
                self._registry_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._registry_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(list(self._custom.values()), indent=2), encoding="utf-8")
                temporary.replace(self._registry_path)
            elif name == FLEX_ID:
                target_dir = Path(flex_directory(self.cache_dir))
                _remove_dir(target_dir)
            elif name in BUILTIN_MODELS:
                repo = BUILTIN_MODELS[name]['repository']
                _remove_dir(Path(self.cache_dir) / ('models--' + repo.replace('/', '--')))
            elif name in MODEL_IDS:
                repo = MODEL_REPOS[name]
                hf_folder = Path(self.cache_dir) / ("models--" + repo.replace("/", "--"))
                _remove_dir(hf_folder)
                cached = self.cached_path(name)
                if cached:
                    _remove_dir(Path(cached))

            self._jobs = {jid: j for jid, j in self._jobs.items() if j.get("model") != name}

            if self.active_model == name:
                self.active_model = "base"

        return {"success": True, "model": name}

    def load(self, name=None):
        name = self.normalize(name)
        with self.inference_lock:
            if self.engine is not None and self.loaded_model == name:
                return self.engine
            cached = self.cached_path(name)
            if not cached:
                raise ValueError(f"{LABELS.get(name, name)} is not downloaded. Open Settings → Local models and download it first.")
            entry = BUILTIN_MODELS.get(name) or self._custom.get(name)
            # Check missing dependencies before suspending a working model.
            if entry and runtime_error(entry['engine']):
                raise RuntimeError(runtime_error(entry['engine']))
            # Only one model needs CUDA memory. Restore the old engine if loading its replacement fails.
            previous = self.engine
            previous_model = getattr(previous, "model", None)
            released = hasattr(previous_model, "unload_model")
            if released:
                previous_model.unload_model()
            elif hasattr(previous, "network"):
                previous.network.to("cpu")
                previous.torch.cuda.empty_cache()
            try:
                if name == FLEX_ID:
                    from flex_backend import FlexEngine
                    engine = FlexEngine(cached, device=self.device)
                elif entry and entry['engine'] != 'faster-whisper':
                    engine = load_engine(entry['engine'], cached, self.device, model_id=name,
                                         repository=entry['repository'], languages=entry.get('languages'))
                else:
                    try:
                        from cuda_runtime import prepare_cuda
                        prepare_cuda(self.device)
                        engine = WhisperModel(cached, device=self.device, compute_type=self.compute_type, local_files_only=True)
                    except Exception as error:
                        print(f"[WHISPER] CUDA unavailable; using CPU int8: {error}", flush=True)
                        engine = WhisperModel(cached, device="cpu", compute_type="int8", local_files_only=True)
            except Exception as error:
                # Failed CUDA loads may leave allocator reservations until their traceback is released.
                import gc
                import traceback
                traceback.clear_frames(error.__traceback__)
                gc.collect()
                if previous and hasattr(previous, "torch"):
                    previous.torch.cuda.empty_cache()
                try:
                    if released:
                        previous_model.load_model()
                    elif hasattr(previous, "network"):
                        previous.torch.cuda.empty_cache()
                        previous.network.to(previous.device)
                except Exception as restore_error:
                    self.engine = self.loaded_model = None
                    raise RuntimeError(f"Model load failed: {error}. Previous model must reload: {restore_error}") from error
                raise
            with self._lock:
                self.engine = engine
                self.loaded_model = self.active_model = name
                self._runtime = {"device": getattr(getattr(engine, "model", None), "device", None),
                                 "compute_type": getattr(getattr(engine, "model", None), "compute_type", None)}
            return engine

    def start_job(self, name, action):
        name = self.normalize(name)
        if action not in ("download", "activate"):
            raise ValueError("Unsupported model action")
        if action == "activate" and not self.cached_path(name):
            raise ValueError("Download this model before switching to it.")
        with self._lock:
            for job in self._jobs.values():
                if job["model"] == name and job["action"] == action and job["status"] in ("queued", "inspecting", "downloading", "loading"):
                    return dict(job)
            # Avoid piling up downloads or multiple model loads.
            if any(job["status"] in ("queued", "inspecting", "downloading", "loading") for job in self._jobs.values()):
                raise ValueError("A model operation is already running. Wait for it to finish.")
            job = {"id": uuid.uuid4().hex, "model": name, "action": action, "status": "queued", "error": None}
            self._jobs[job["id"]] = job
            while len(self._jobs) > 20:
                self._jobs.pop(next(iter(self._jobs)))
            self._executor.submit(self._run_job, job)
            return dict(job)

    def import_url(self, url):
        repo = repository_from_url(url)
        if repo == FLEX_REPO:
            return self.start_job(FLEX_ID, 'download')
        for name, entry in BUILTIN_MODELS.items():
            if repo.lower() == entry['repository'].lower():
                return self.start_job(name, 'download')
        name = "hf:" + repo
        with self._lock:
            if name in self._custom:
                return self.start_job(name, "download")
            for job in self._jobs.values():
                if job["status"] in ("queued", "inspecting", "downloading", "loading"):
                    if job["model"] == name:
                        return dict(job)
                    raise ValueError("A model operation is already running. Wait for it to finish.")
            job = {"id": uuid.uuid4().hex, "model": name, "action": "download", "status": "queued", "error": None}
            self._jobs[job["id"]] = job
            while len(self._jobs) > 20:
                self._jobs.pop(next(iter(self._jobs)))
            self._executor.submit(self._import_job, job, repo)
            return dict(job)

    def _import_job(self, job, repo):
        try:
            with self._lock:
                job["status"] = "inspecting"
            entry = inspect_repository(repo, self.cache_dir)
            with self._lock:
                self._custom[entry["id"]] = entry
                self._registry_path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self._registry_path.with_suffix(".tmp")
                temporary.write_text(json.dumps(list(self._custom.values()), indent=2), encoding="utf-8")
                temporary.replace(self._registry_path)
            self._run_job(job)
        except Exception as error:
            with self._lock:
                job.update(status="failed", error=str(error))

    def download(self, name):
        """Shared setup/background path for every supported architecture."""
        name = self.normalize(name)
        if not self.cached_path(name):
            if name == FLEX_ID:
                download_flex(self.cache_dir)
            elif name in self._custom or name in BUILTIN_MODELS:
                download_repository(BUILTIN_MODELS.get(name) or self._custom[name], self.cache_dir)
            else:
                utils.download_model(MODEL_REPOS[name], cache_dir=self.cache_dir)
        if not self.cached_path(name):
            raise RuntimeError('Download did not produce a complete model. Please retry.')

    def _run_job(self, job):
        try:
            with self._lock:
                job["status"] = "downloading" if job["action"] == "download" else "loading"
            if job["action"] == "download":
                self.download(job['model'])
            else:
                self.load(job["model"])
            with self._lock:
                job["status"] = "ready"
        except Exception as error:
            with self._lock:
                job["status"] = "failed"
                job["error"] = str(error)

    def close(self):
        self._executor.shutdown(wait=True)
