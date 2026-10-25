# Speech model notices

Model weights are downloaded separately and retain their own license terms.

Reviewed on 25 October 2026 against the publishers' live model cards, Hugging Face license metadata, and the primary license texts linked below. Declarations describe the named repositories; they do not establish rights in every training dataset or unrelated upstream component. Model licenses do not become the application license.

## Whisper and Hinglish checkpoints

The built-in converted [tiny](https://huggingface.co/Systran/faster-whisper-tiny), [base](https://huggingface.co/Systran/faster-whisper-base), [small](https://huggingface.co/Systran/faster-whisper-small), [medium](https://huggingface.co/Systran/faster-whisper-medium), [large-v3](https://huggingface.co/Systran/faster-whisper-large-v3), and [turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) repositories declare MIT. The [OpenAI Whisper project license](https://github.com/openai/whisper/blob/main/LICENSE) requires its copyright and permission notice in copies or substantial portions and includes a warranty disclaimer. Upstream model declarations must also be checked: for example, the current [OpenAI large-v3 model card](https://huggingface.co/openai/whisper-large-v3) declares Apache-2.0, while its converted Systran repository declares MIT. Do not assume every Whisper-related artifact has identical terms.

The publishers of [Mayank Hinglish turbo](https://huggingface.co/mayank-dubey-ai/whisper-large-v3-turbo-hinglish), [Oriserve Hindi2Hinglish Apex](https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex), and [Trelis Hinglish preview](https://huggingface.co/Trelis/whisper-hinglish-preview) declare Apache-2.0 in their model metadata. The [full Apache-2.0 terms](https://www.apache.org/licenses/LICENSE-2.0) allow commercial use, modification and distribution subject to conditions, including providing the license, retaining applicable attribution/NOTICE content, and marking modified files. The license includes a patent grant with termination conditions and does not grant general trademark rights.

Trelis credits [ARTPARK-IISc Whisper-Vaani Hindi](https://huggingface.co/ARTPARK-IISc/whisper-large-v3-vaani-hindi), whose model metadata declares Apache-2.0. Trelis identifies a non-commercial evaluation dataset separately; an evaluation dataset's license must not be confused with the publisher-declared model-weight license. This review does not independently validate the training-data provenance of these checkpoints.

## Bodhan Flex

Built with Bodhan Flex from Bodhan AI / AI4Bharat.

- [Model page and access request](https://huggingface.co/bodhan-ai/indic-transcribe-flex).
- Pinned revision: `ecba9bac9013c0340fe814b336897ee51ed80be9`.
- [Indic Open Model License v1.0, full publisher text](https://github.com/Bodhan-AI/bodhan-model-info/blob/main/licenses/indic-open-model-license/v1/Indic_Open_Model_License.md); the bundled copy is [MODEL_LICENSE.md](../vendor/bodhan_flex/MODEL_LICENSE.md).
- Section 1 grants broad royalty-free rights subject to the full license. Section 2 requires the attribution notice in the user-facing interface when the model or a derivative is made available to third parties, with prominence requirements.
- Section 3 generally requires written approval and a separate agreement for direct third-party hosted inference/fine-tuning access, with specified exclusions and exemptions. Section 4's open-release waiver has its own conditions; merely publishing an application does not automatically satisfy it.
- Section 5 requires distributed derivatives to retain the exact license; distributing the unmodified model also requires an unaltered license copy.
- Section 10 prohibits specified harmful uses. Section 14 requires a separate license for own-product use exceeding 500 million monthly active users or US$250 million annual revenue, except eligible public-interest entities.
- Section 16 preserves upstream obligations. The publisher identifies [NVIDIA Canary-1b-v2](https://huggingface.co/nvidia/canary-1b-v2), which declares CC-BY-4.0. Retain its attribution and license where applicable.

Owlio downloads Flex weights to the user's computer rather than operating a third-party hosted inference service. Each user still needs approved Hugging Face access. This describes Owlio's architecture, not a blanket exemption from license conditions. The separately bundled inference code carries Apache-2.0 headers; its code license is distinct from the model's custom weight license. See [the bundled loader notice](../vendor/bodhan_flex/NOTICE.md).

## Underdog Bark 3.0 Pro

- Publisher: ConwayResearch / Underdog.
- Model: https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro
- Pinned revision: `4b5c51e04aa8d16dda9ecdff71bc29f7360149e4`.
- License declared by the publisher: Creative Commons Attribution 4.0 (CC-BY-4.0).
- [Full CC-BY-4.0 legal terms](https://creativecommons.org/licenses/by/4.0/legalcode.en): commercial use and adaptation are allowed subject to conditions. When sharing the model or an adaptation, retain appropriate creator/copyright and license information, link the license, identify modifications, and do not impose additional legal or effective technological restrictions on the licensed rights. The license includes warranty disclaimers and does not grant all privacy, publicity or trademark rights.
- Derived from NVIDIA `parakeet-tdt-0.6b-v3`, through `moondream/parakeet-ultra`.
- Attribution notice: https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro/blob/4b5c51e04aa8d16dda9ecdff71bc29f7360149e4/NOTICE

Attribution: Underdog Bark 3.0 Pro, post-trained and compressed by Conway Research, derives from [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), copyright NVIDIA Corporation, through [Moondream Parakeet Ultra](https://huggingface.co/moondream/parakeet-ultra), copyright Moondream. These upstream model repositories declare CC-BY-4.0, as does the Bark publisher's notice.

Owlio downloads the original BF16 safetensors and tokenizer/processor assets together with `NOTICE`. It does not modify or redistribute those weights in the installer. Its Python adapter uses stock Transformers, converts the weights to FP32 for CPU or GPUs without BF16 support, adds the publisher's 0.25-second leading silence, and processes long recordings in overlapping chunks. These runtime choices are not separate publisher accuracy benchmarks.

Other imported checkpoints retain the license and attribution requirements of their respective publishers. The importer includes root `NOTICE` and `LICENSE` assets when available.

If a repository declares a standard license but does not provide a separate root license file, the absence of that file does not remove redistribution obligations. Anyone repackaging or redistributing model weights must supply the applicable license and attribution material. Owlio's installer does not bundle the model weights.
