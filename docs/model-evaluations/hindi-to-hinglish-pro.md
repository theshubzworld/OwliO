# Hindi-to-Hinglish-Pro evaluation

Evaluated locally on 17 October 2026. App code, selected speech model and saved
settings were not changed.

## Decision

Do not make this checkpoint the default Romanization step in Owlio. It is fast
and handles several short mixed-script sentences better than Bonsai 2B, but can
omit or invent content on conversational paragraphs. The original PyTorch
checkpoint also fails the longer transcript, so this is not confined to the
published CTranslate2 export.

## Model and execution

- Model: https://huggingface.co/Singla0009/Hindi-to-Hinglish-Pro
- Pinned revision: `255f2a99926eb210c72497573fb350277c13c09a`.
- Published CTranslate2 weights: 300,590,368 bytes, plus vocabulary/config.
- CTranslate2 4.8.3: CPU INT8 with four threads; NVIDIA RTX 4050 Laptop GPU
  INT8/FP16. Greedy decoding and beam size 4 were evaluated.
- Actual ByT5 UTF-8 byte tokenization was used. The model card's `list(text)`
  example is not equivalent to this tokenization for Devanagari.
- Reference: source SafeTensors checkpoint, PyTorch float32 on CPU, greedy
  decoding. No downloaded Python model code was executed.
- All runs were offline after the checkpoint download.

## Observations

| Input fragment | Observed output | Assessment |
| --- | --- | --- |
| `report भेज देना` | `report bhej dena` | Better than the tested Bonsai output `bhenge dena`. |
| `राहुल ... WhatsApp ... भेजना` | `Rahul ... WhatsApp ... bhejna` | Short test preserved the name and existing brand spelling. |
| `file delete नहीं की, सिर्फ rename की है` | `file delete nahi ki, sirf rename ki hai` | Negation retained in this sample. |
| `userId ... fetchUserProfile ... Ctrl+Win` | Existing identifiers retained | Short test passed. |
| `मरीज` | `maries` | Incorrect spelling in both CT2 and the source checkpoint. |
| `ऋषभ` | `oshabh` | Incorrect name in both CT2 and the source checkpoint. |
| Three lines of instructions, passed as one string | Only first line returned | Converting lines individually recovered all three in this sample. |
| Saved conversational Trelis transcript | Missing/repeated clauses; reference checkpoint also added unrelated words | Unacceptable for direct automatic paste. |

The extended CT2 set contained 21 samples. With line handling, the original
Latin/numeric fragments survived in order in 19/21. This is a limited structural
check, **not** an accuracy score: it cannot detect wrong Hindi words, omitted
Hindi clauses, or invented Roman Hindi. Punctuation and leading whitespace were
also changed in some samples.

GPU short-sentence timings after the first request were roughly 30–160 ms with
greedy decoding; the initial CPU set was roughly 47–264 ms. These are conversion
measurements on this machine, not audio recognition or end-to-end paste latency.
Cold Python/library initialization is excluded. Source-checkpoint CPU inference
took about 1.4–1.5 seconds for the three short reference examples and 4.7 seconds
for the saved paragraph.

Converting bounded Hindi-only spans copied Latin text, numbers, whitespace and
punctuation deterministically. However, the neural output then repeated Hindi
phrases; the saved paragraph gained 112 whitespace-separated words. Wider beam
search on full lines still dropped most of the paragraph. Neither workaround
established acceptable fidelity.

## Reproduce and inspect

Run the isolated probe with the existing speech environment:

```powershell
.\.venv\Scripts\python.exe -X utf8 tests/hinglish_pro_probe.py --device cuda --preserve-lines --extended
```

Additional switches: `--device cpu`, `--beam-size 4`, `--hindi-spans`.
The probe expects the pinned checkpoint under
`tests/.runtime/models/hinglish-pro/`. Raw reports are under
`tests/.runtime/hinglish-pro-*.json`, including
`hinglish-pro-pytorch-reference.json`. Downloaded weights and runtime reports
remain ignored by Git.

The Hugging Face model card declares MIT. The optional Akshar C++ runtime is
separately labeled noncommercial; it was not installed or used in this test.

Next evaluation candidate: the separate smaller Marian model, with the same
paragraph, name, punctuation and omission checks. No replacement has been
selected for production.
