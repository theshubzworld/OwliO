# Speech pipeline audit resolution

Reviewed against the supplied audit on 2026-10-21.

## Removals and retained features

| Feature | Resolution |
| --- | --- |
| OpenAI Whisper speech endpoint | Removed from runtime, settings and onboarding. Local speech and Groq remain. |
| Mock speech provider | Removed; production cannot insert generated sample dictation. |
| Groq/OpenAI cleanup and writing endpoints | Removed. Gemini is the sole cloud Writing AI. |
| Ollama short dictation cleanup | Removed. Explicit rewrites and meeting summaries remain available through Ollama. |
| Gemini Roman Hinglish | Retained. Already Romanized/English-only transcripts skip its network request, regardless of the speech model. |
| Correction learning | Retained as an optional feature; new profiles default off. Existing saved choices and vocabulary remain. Manual dictionary replacements remain deterministic. |
| DSP, signal gate, local speech engines, punctuation, dictionary, snippets, rewrites and meetings | Retained. |

Removed speech providers migrate to local setup. Removed writing providers migrate to Gemini when an existing Gemini key is available, otherwise to Basic punctuation with AI rewrites off. Ollama cleanup migrates to Basic punctuation. History, dictionary, snippets, speech model/language and Hindi-output preferences survive migration; retired OpenAI keys are dropped.

## Verified fixes

1. **Transformers prompt conditioning:** `initial_prompt` is tokenized and applied to every speech chunk. Explicit language/mixedcode decoder prefixes include those prompt tokens directly, because Transformers bypasses `prompt_ids` when `decoder_input_ids` is supplied. The generation budget now reserves space for the prompt and decoder prefix, preventing a new maximum-position error.
2. **Hinglish decoder routing:** Mayank and Oriserve checkpoints use English decoder tokens for Hinglish, as their model cards prescribe. Trelis retains Hindi plus its dedicated mixedcode token. Other custom checkpoints use transcription language detection for Hinglish rather than being forced to Hindi. Explicit native-language selections remain explicit.
3. **Romanization validation:** Removed equal-word-count enforcement. Hindi compounds can expand into multiple Roman words. Literal English/identifiers, digits, punctuation, newlines and alignment whitespace remain protected. Validation processes Hindi phrases separately to avoid whole-transcript regex backtracking. It also accepts English identifiers immediately adjacent to Hindi words.
4. **Rewrite intent:** Added Hindi and Hinglish edit-command recognition, including `isko short karo`, `points me banao`, `spelling theek karo`, `isko rephrase kar do`, and Devanagari equivalents. A selection is still required; model failures preserve it. Rewrite intent takes precedence over snippet expansion.
5. **Snippets:** Added case-insensitive boundary matching inside sentences, longest-trigger priority, trailing comma tolerance and optional leading um/uh/hmm for standalone triggers. Replacement text stays literal and is not recursively expanded.
6. **Dictionary:** Normalize source/transcript text to NFC; allow ZWJ/ZWNJ within a matched term and include joiners in word boundaries. Preserve combining-mark boundaries and literal replacement strings. Viramas and nuktas were already covered by Unicode marks; their mere presence was not itself the reported boundary bug.
7. **Conversational leakage:** Removed the dictation formatter paths responsible for the reported Llama preambles. Retained Ollama rewrites reject common commentary/thought/fence prefixes and leave the selection untouched on rejection.
8. **Automatic model selection:** Added verified Hindi/English coverage and installed-model ranking for Mayank and Oriserve. Other custom models participate using declared language metadata. Compatible installed current selections remain respected; unknown coverage is not guessed from a model's name.

## Evidence and limits

The reported latency, pricing, zero-CPU and OOM generalizations were not treated as measured facts. Provider removal is a simplification decision, not a universal speed benchmark. Learning reliability depends on the target app's UI Automation support; making it optional does not resolve every inaccessible field.

Romanization validation protects output structure, not semantic equivalence or phonetic spelling. Live recognition/accuracy checks with the affected model weights and paid provider calls were not performed in this change. Regression tests use simulated model/network responses and synthetic audio.

Validation: TypeScript type checking, renderer production build, 135 JavaScript tests and 28 Python tests. Coverage includes provider migration, cancellation/fallbacks, prompts across audio chunks, model decoder routing, compounds, protected identifiers, Hindi/Hinglish rewrites, snippets and Unicode dictionary boundaries.

Primary references:

- [Mayank Hinglish model card](https://huggingface.co/mayank-dubey-ai/whisper-large-v3-turbo-hinglish)
- [Oriserve Apex model card](https://huggingface.co/Oriserve/Whisper-Hindi2Hinglish-Apex)
- [Whisper generation API](https://huggingface.co/docs/transformers/model_doc/whisper)
- [Transformers 5.5.3 Whisper generation implementation](https://github.com/huggingface/transformers/blob/v5.5.3/src/transformers/models/whisper/generation_whisper.py)
