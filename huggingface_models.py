"""Import supported speech repositories without executing repository code."""
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from huggingface_hub import HfApi, hf_hub_download, snapshot_download

REPO_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$")


def repository_from_url(value):
    if not isinstance(value, str) or len(value) > 300:
        raise ValueError("Enter a Hugging Face model URL or owner/model name.")
    value = value.strip()
    if "://" in value:
        url = urlsplit(value)
        if url.scheme != "https" or url.netloc != "huggingface.co" or url.query or url.fragment:
            raise ValueError("Use an HTTPS model URL on huggingface.co without a query or credentials.")
        value = url.path.strip("/")
        if value.endswith("/tree/main"):
            value = value[:-10]
    if not REPO_PATTERN.fullmatch(value) or ".." in value or value.split("/")[0] in ("datasets", "spaces"):
        raise ValueError("Use a model repository URL, for example https://huggingface.co/Trelis/whisper-hinglish-preview.")
    return value


def inspect_repository(repo, cache_dir):
    info = HfApi().model_info(repo, files_metadata=True)
    config_path = hf_hub_download(repo, "config.json", revision=info.sha, cache_dir=cache_dir)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    siblings = {file.rfilename: file for file in info.siblings}
    if "model.bin" in siblings and config.get("model_type") in (None, "Whisper", "whisper"):
        engine, weights = "faster-whisper", ["model.bin"]
    elif config.get("model_type") in ("whisper", "parakeet_tdt"):
        engine = "parakeet-tdt" if config['model_type'] == 'parakeet_tdt' else "transformers"
        if "model.safetensors" in siblings:
            weights = ["model.safetensors"]
        elif "model.safetensors.index.json" in siblings:
            index_path = hf_hub_download(repo, "model.safetensors.index.json", revision=info.sha, cache_dir=cache_dir)
            index = json.loads(Path(index_path).read_text(encoding="utf-8"))
            weights = sorted(set(index.get("weight_map", {}).values()))
            if not weights or any(not isinstance(file, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+\.safetensors", file) for file in weights):
                raise ValueError("Invalid safetensors weight index.")
            weights.append("model.safetensors.index.json")
        else:
            raise ValueError("This speech repository needs safetensors weights. Pick a safetensors version.")
    else:
        raise ValueError("Supported speech architectures: Whisper and Parakeet TDT (including Bark Pro). This repository is not compatible.")
    assets = [file for file in ("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
              "preprocessor_config.json", "processor_config.json", "special_tokens_map.json", "added_tokens.json", "normalizer.json",
              "vocab.json", "merges.txt", "vocabulary.json", "vocabulary.txt", "NOTICE", "LICENSE") if file in siblings]
    required = sorted(set(weights + assets + ["config.json"]))
    if any(file not in siblings for file in required):
        raise ValueError("The repository is missing a required weight file.")
    if not ("tokenizer.json" in siblings or ("vocab.json" in siblings and "merges.txt" in siblings)):
        raise ValueError("This repository does not include a supported speech tokenizer.")
    if engine == 'parakeet-tdt' and not {'processor_config.json', 'preprocessor_config.json'}.intersection(siblings):
        raise ValueError('This Parakeet repository is missing its processor configuration.')
    card = getattr(info, 'card_data', None) or {}
    declared = card.get('language', []) if hasattr(card, 'get') else []
    if isinstance(declared, str):
        declared = [declared]
    languages = sorted(set(code for code in declared if isinstance(code, str) and re.fullmatch(r'[a-z]{2,3}', code))) if isinstance(declared, list) else []
    return {"languages": languages or None, "id": "hf:" + repo, "name": repo, "repository": repo, "revision": info.sha,
            "engine": engine, "files": required, "bytes": sum(siblings[file].size or 0 for file in weights)}


def download_repository(entry, cache_dir):
    return snapshot_download(entry["repository"], revision=entry["revision"], cache_dir=cache_dir,
                             allow_patterns=entry["files"], max_workers=2)
