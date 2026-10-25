# Speech model notices

Model weights are downloaded separately and retain their own license terms.

## Underdog Bark 3.0 Pro

- Publisher: ConwayResearch / Underdog.
- Model: https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro
- Pinned revision: `4b5c51e04aa8d16dda9ecdff71bc29f7360149e4`.
- License declared by the publisher: Creative Commons Attribution 4.0 (CC-BY-4.0).
- Derived from NVIDIA `parakeet-tdt-0.6b-v3`, through `moondream/parakeet-ultra`.
- Attribution notice: https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro/blob/4b5c51e04aa8d16dda9ecdff71bc29f7360149e4/NOTICE

Owlio downloads the original BF16 safetensors and tokenizer/processor assets together with `NOTICE`. It does not modify or redistribute those weights in the installer. Its Python adapter uses stock Transformers, converts the weights to FP32 for CPU or GPUs without BF16 support, adds the publisher's 0.25-second leading silence, and processes long recordings in overlapping chunks. These runtime choices are not separate publisher accuracy benchmarks.

Other imported checkpoints retain the license and attribution requirements of their respective publishers. The importer includes root `NOTICE` and `LICENSE` assets when available.
