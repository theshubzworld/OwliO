# Documented speech-language coverage

Verified against publisher sources on 2026-10-17. This establishes supported language choices and model routing. It is not a live accuracy benchmark or a claim that every supported language performs equally well.

| Model family | Documented coverage used by Owlio | Source |
| --- | --- | --- |
| Multilingual Whisper tiny, base, small, medium, large-v2 | 99 languages; excludes Cantonese | [Whisper tokenizer](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py), [large-v3 model card](https://huggingface.co/openai/whisper-large-v3) |
| Whisper large-v3 and large-v3-turbo | 100 languages, including Cantonese | [large-v3](https://huggingface.co/openai/whisper-large-v3), [turbo](https://huggingface.co/openai/whisper-large-v3-turbo) |
| English-only Whisper `.en` checkpoints | English | [Whisper large-v3 model family's description of English-only variants](https://huggingface.co/openai/whisper-large-v3) |
| Trelis whisper-hinglish-preview | Hindi, English, Hindi–English code switching | [Publisher model card](https://huggingface.co/Trelis/whisper-hinglish-preview) |
| Bodhan Indic-Transcribe-Flex | 27 languages; native transcription in Owlio | [Publisher language table](https://huggingface.co/bodhan-ai/indic-transcribe-flex#supported-language-codes), checked against the bundled pinned loader |
| Other Hugging Face checkpoints | Declared model-card language metadata, when present | The individual checkpoint's publisher metadata; otherwise coverage remains unverified |

The public Flex model card was readable. Fetching its gated pinned-revision README without credentials was denied; the 27-code list was independently matched against Owlio's bundled loader, rather than assuming the public card described every pinned artifact. Model weights were not downloaded again for this review.

## Language sets

Whisper's 100-code set is:

```text
af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi
fo fr gl gu ha haw he hi hr ht hu hy id is it ja jw ka kk km kn ko la
lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt
ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk
ur uz vi yi yo yue zh
```

Exclude `yue` for Whisper models before large-v3. Owlio retains Whisper's `jw` language code for Javanese when sending decoding parameters.

Flex's 27 documented languages are:

| Language | Code | Language | Code | Language | Code |
| --- | --- | --- | --- | --- | --- |
| Assamese | as | Bengali | bn | Bhili | bhb |
| Bhojpuri | bho | Bodo | brx | Chhattisgarhi | hne |
| Dogri | doi | English (Indian) | en | Gujarati | gu |
| Haryanvi | bgc | Hindi | hi | Kannada | kn |
| Kashmiri | ks | Konkani | kok | Maithili | mai |
| Malayalam | ml | Manipuri | mni | Marathi | mr |
| Nepali | ne | Odia | or | Punjabi | pa |
| Sanskrit | sa | Santali | sat | Sindhi | sd |
| Tamil | ta | Telugu | te | Urdu | ur |

Flex adds 12 language choices beyond Whisper's 100: Bhili, Bhojpuri, Bodo, Chhattisgarhi, Dogri, Haryanvi, Kashmiri, Konkani, Maithili, Manipuri, Odia and Santali. Hinglish is a usage option mapped to Hindi decoding, not an additional language code. Owlio exposes 112 distinct languages plus Hinglish and automatic detection for local speech.

## Automatic selection

1. Keep the current downloaded model when its documented coverage includes the selected language.
2. Otherwise choose a compatible downloaded model. Hindi/Hinglish prefer Trelis, then Flex; other languages prefer Whisper small, base, turbo, tiny, medium, large-v3, then Flex. Other compatible declared custom models follow those presets. These priorities balance reuse and the app's defaults; they are not measured accuracy rankings.
3. If none is downloaded, keep a compatible pending choice; otherwise select Whisper small for its supported set, turbo for Cantonese, or Flex for the additional Indic languages. Show the required download/setup action without starting it automatically.
4. Automatic detection requires broad coverage for automatic selection (at least 99 documented languages), so it defaults to multilingual Whisper rather than a specialized Hindi/Indic checkpoint. Users can still manually select a narrower model and its own automatic detection.
5. Unknown custom checkpoints are not guessed from their architecture or tokenizer vocabulary. They require declared language metadata before automatic selection; metadata is a publisher claim, not an independent evaluation. Manual selection displays the uncertainty. Known model families override metadata with the verified matrix.

The picker, model details, setup validation and server use these boundaries. Invalid known combinations cannot be saved or decoded. Changing language and returning to the local provider reruns selection. Existing compatible models are retained even if another model might have higher accuracy, avoiding surprise downloads or loading substantially larger weights.

## Verification limits

Regression tests cover catalogue metadata, selection, unsupported-language rejection before model loading, all 27 Flex routing codes, custom declarations, original-script output, `.en` generation, first-run setup and settings persistence. Tests use stubbed inference; no live recognition comparison was performed across these languages. Automatic detection does not guarantee reliable mixed-language transcription. Local transliteration remains removed; Gemini Hindi conversion still requires an explicit Hindi/Hinglish selection.
