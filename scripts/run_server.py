"""Launch the speech server with an explicitly configured Python runtime."""
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = root / "server-runtime.json"
runtime = os.getenv("OWLIO_PYTHON")
models = os.getenv("OWLIO_MODEL_CACHE")
if config.is_file():
    cfg = json.loads(config.read_text(encoding="utf-8"))
    if not runtime:
        runtime = cfg.get("python")
    if not models:
        models = cfg.get("models")
owned_runtime = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
runtime = runtime or (str(owned_runtime) if owned_runtime.is_file() else sys.executable)
if not Path(runtime).is_file():
    raise SystemExit("Configured speech Python was not found. Update server-runtime.json or OWLIO_PYTHON.")
env = dict(os.environ)
if models:
    env["OWLIO_MODEL_CACHE"] = models
raise SystemExit(subprocess.call([runtime, str(root / "server.py")], cwd=root, env=env))
