"""Launch the speech server with an explicitly configured Python runtime."""
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = root / "server-runtime.json"
runtime = os.getenv("OWLIO_PYTHON")
if not runtime and config.is_file():
    runtime = json.loads(config.read_text(encoding="utf-8")).get("python")
owned_runtime = root / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
runtime = runtime or (str(owned_runtime) if owned_runtime.is_file() else sys.executable)
if not Path(runtime).is_file():
    raise SystemExit("Configured speech Python was not found. Update server-runtime.json or OWLIO_PYTHON.")
raise SystemExit(subprocess.call([runtime, str(root / "server.py")], cwd=root))
