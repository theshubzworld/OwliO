# Gemini transliteration evaluation

Evaluated on 17 October 2026 using `gemini-3.1-flash-lite` through Vertex Express
and the existing encrypted isolated test-profile key. No Owlio app settings,
speech models or production formatting prompts were changed. Only test text was
sent to Google, including the saved Trelis transcript used in the local-model
evaluation. Audio and active-window context were not sent.

## Finding

Gemini gave substantially better results than the tested Bonsai 2B and
Hindi-to-Hinglish-Pro checkpoints on the difficult samples in this small suite.
It retained the long Trelis paragraph and the repeated longer variant, including
their existing English words and final markers, without the obvious omissions
or loops observed in the local-model tests. This is a promising optional cloud
path, not evidence of perfect accuracy on arbitrary dictation.

Examples from the revised prompt:

| Hindi input fragment | Gemini output |
| --- | --- |
| `report भेज देना` | `report bhej dena` |
| `राहुल ... WhatsApp ... भेजना` | `Rahul ... WhatsApp ... bhejna` |
| `मरीज` in the medical sentence | `mareez` |
| `शुभम, ऋषभ, क्षितिज और ज्ञानेश्वर` | `Shubham, Rishabh, Kshitij aur Gyaneshwar` |
| `file delete नहीं की, सिर्फ rename की है` | `file delete nahi ki, sirf rename ki hai` |

## Method and revisions

The suite contains 21 samples shared with the local model: short sentences,
negation, names, numbers, currency, technical identifiers, URLs, email, multiline
text, literal instructions as data, and a saved Trelis paragraph plus a doubled
version with markers.

The initial transliteration prompt made three clear mistakes: it deleted words
from an English-only sample, left Hindi words adjacent to identifiers, and
trimmed trailing spaces. Its examples included `मरीज` and `ऋषभ`, so success on
those examples in that initial pass was not a held-out spelling test.

The revised pass used a JSON text field explicitly treated as data, required
every Devanagari word to be converted, and replaced those spelling examples
with two unrelated short examples. English-only text bypassed the API, and the
input's leading/trailing whitespace was restored locally. No words were repaired
by local code, and no retries were used to select preferred answers.

Both passes used temperature 0, minimal thinking, a 4096-token output limit and
a 20-second request timeout. The existing cleanup formatter was not used:
transliteration must retain repetitions and wording that cleanup may remove.

## Revised results

- 21 samples: 20 API calls and one deterministic English-only bypass.
- All 21 retained existing Latin/numeric fragments in order, contained no Hindi
  letters, and retained the input's whitespace-delimited word count.
- Line counts were retained throughout. All nonletter structure matched in
  20/21: one response changed Hindi full stops `।` to periods despite the prompt.
- Spelling is not completely standardized: the list sample used `mareej`, while
  the medical sentence used `mareez`. Dictionary preferences may still matter.
- Both long paragraphs retained the expected clauses on manual inspection.
  Structural checks alone cannot establish semantic accuracy or guarantee the
  absence of substitutions on other inputs.
- Revised request times were about 0.75–1.66 seconds, including network latency.
  The first pass also had one roughly 7-second response. These measurements
  exclude speech recognition and paste time and do not establish a latency SLA.
- Saved test-profile configuration was hashed before and after and unchanged.

## Artifacts and reproduction

- Probe: `tests/gemini-romanization-live.cjs`.
- Baseline: `tests/.runtime/gemini-romanization-results.json`.
- Revised: `tests/.runtime/gemini-romanization-refined-results.json`.

```powershell
.\node_modules\electron\dist\electron.exe tests/gemini-romanization-live.cjs --refined
```

The probe requires the existing isolated `tests/.runtime/gemini-integration/profile`
with its Windows-encrypted Gemini key and Local State. It never prints or stores
the decrypted key. Raw reports and downloaded model weights remain ignored by Git.
Running the probe sends transcripts to Google and may use account quota or incur
provider charges.

Before integration, add explicit script/preservation validation, bypass text
that needs no transliteration, preserve boundary whitespace, and retain the raw
transcript when conversion fails. A dedicated setting should keep Romanization
separate from optional cleanup. No Firebase or account feature was added.

Current validation no longer requires equal whitespace-delimited word counts. Hindi compounds may expand into several Roman words; literal English, numbers, punctuation and line breaks remain protected. The historical results above describe the earlier validator. See [the pipeline audit resolution](../speech-pipeline-audit.md).
