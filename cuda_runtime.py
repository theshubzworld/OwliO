"""Register Windows CUDA libraries before CTranslate2's native inference starts."""
import ctypes
import importlib.util
import os
from pathlib import Path

_dll_directories = []
_libraries = []
_checked = False


def prepare_cuda(device):
    global _checked
    if os.name != "nt" or device == "cpu" or _checked:
        return
    import ctranslate2
    if not ctranslate2.get_cuda_device_count():
        return
    version = tuple(int(part) for part in ctranslate2.__version__.split('.')[:2])
    if version < (4, 6):
        raise RuntimeError("CUDA speech recognition requires CTranslate2 4.6 or newer with cuDNN 9. Update the speech runtime dependencies.")
    torch = importlib.util.find_spec("torch")
    if torch and torch.origin:
        directory = Path(torch.origin).parent / "lib"
        if directory.is_dir():
            _dll_directories.append(os.add_dll_directory(str(directory)))
            os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")
    # Missing DLLs otherwise terminate the process during native inference, bypassing Python exceptions.
    for name in ("cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll", "cudnn_ops64_9.dll"):
        _libraries.append(ctypes.WinDLL(name))
    _checked = True
