<p align="center">
  <img src="assets/brand/readme-banner.png" alt="Owlio — Your voice. Your words. A little owl for your everyday writing." width="100%">
</p>

<p align="center">
  <strong>Speak naturally. Keep your words. Let the little owl handle the typing.</strong>
</p>

<p align="center">
  <a href="https://theshubzworld.github.io/OwliO/">Owlio website</a> &nbsp; · &nbsp;
  <a href="https://github.com/theshubzworld/OwliO/releases/latest">Download for Windows</a> &nbsp; · &nbsp;
  <a href="https://github.com/theshubzworld/OwliO">Source code</a> &nbsp; · &nbsp;
  <a href="docs/releasing.md">Release guide</a>
</p>

<p align="center">
  <kbd>Windows x64</kbd> &nbsp; <kbd>Local speech</kbd> &nbsp; <kbd>Hinglish ready</kbd>
</p>

<p align="center">
  <a href="#meet-owlio">Meet Owlio</a> &nbsp; · &nbsp;
  <a href="#get-started">Get started</a> &nbsp; · &nbsp;
  <a href="#make-it-yours">Make it yours</a> &nbsp; · &nbsp;
  <a href="docs/development.md">Development guide</a>
</p>

---

## Meet Owlio

**Current source version: 1.0.17.** Read the [1.0.17 release notes](docs/releases/1.0.17.md), or get the latest published Windows installer from [GitHub Releases](https://github.com/theshubzworld/OwliO/releases/latest).

The official app is free with required sign-in, acceptance of the current Terms of Use and Privacy Notice, and disclosed basic usage reporting. Review the [Terms of Use](docs/legal/terms-of-use.md) and [Privacy Notice](docs/legal/privacy-notice.md) before use.

Owlio is a Windows dictation app with a tiny owl companion. Select a supported text field, use your shortcut and speak. Owlio turns your voice into text and inserts it where you're writing.

Use downloaded speech models on your computer, choose optional AI cleanup, and keep Hindi-English speech in the script you prefer.

| A small companion | A useful writing workflow |
| :--- | :--- |
| **Your floating companion** | Choose the owl, sleepy cat, little cloud, friendly robot, mini waveform, glowing pebble or firefly. |
| **Your shortcut** | Custom shortcuts, hold-to-talk or press-to-toggle, and a shortcut test. |
| **Local speech models** | Whisper, compatible Hugging Face checkpoints and Bodhan Flex. |
| **A guided first run** | Download Owlio’s own Python, speech libraries and model—or choose cloud speech or set up later. |
| **Hindi in English letters** | Local models transcribe; optional Gemini conversion writes recognized Hindi in Roman letters and leaves English unchanged. |
| **Optional AI cleanup** | Basic punctuation works by default. Gemini powers AI cleanup, voice rewrites and meeting summaries. |
| **A place for your words** | Dictation history, playback, a Scratchpad, snippets and meeting notes. |

> **Official app:** Download the latest Windows installer from [GitHub Releases](https://github.com/theshubzworld/OwliO/releases/latest). The free official app requires sign-in, acceptance of the [Terms of Use](docs/legal/terms-of-use.md) and [Privacy Notice](docs/legal/privacy-notice.md), and basic usage reporting. No payment card is required.

## From voice to words

**Select a text field → use your shortcut → speak → finish dictation.**

The initial shortcut is **F8**. Saved custom shortcuts take precedence. Hold and release in hold-to-talk mode, or press twice in toggle mode. You can also click the owl's microphone control.

With Gemini Hindi conversion and list formatting enabled, a clear spoken list can become:

```text
Kal do kaam hain:
• Rahul ko call karna.
• Report bhejna.
```

*Illustrative output. Recognition and formatting depend on the model and how clearly the items are spoken.*

## Make it yours

| Open this tab | Adjust this |
| :--- | :--- |
| **Speech & models** | Speech provider, spoken language, local speech models, setup/repair and download folders. |
| **Text & style → Output & cleanup** | Hindi output, Basic or AI cleanup, and the shared Writing AI connection. |
| **Text & style → Writing style** | Natural, Professional, Casual or Technical tone; Gemini lists; punctuation, correction learning and saved writing rules. |
| **General settings** | Microphone, shortcut, floating bar appearance and recording retention. |
| **Account & privacy** | Required Google or email-link/code sign-in, versioned terms acceptance, basic usage reporting and administrator access controls. |
| **Dictionary** | Manual replacements and learned spelling suggestions you can accept or forget. |
| **Snippets** | Reusable text expanded from your saved trigger phrases. |
| **Scratchpad** | A draft space for typing or dictating. Select **Save draft** to keep your text. |

Writing rules live under **Writing style → Advanced writing preferences** and can target an app or language. Tone, structure and punctuation use **Save settings**; adding or deleting a rule is an explicit record action. Automatic lists require Gemini Writing AI.

**Save settings** applies all pending preferences across settings pages, including model selections and appearance. Downloads, setup/repair, vocabulary reviews and rule records are explicit actions. The speech and text pages preview speech → script → cleanup.

**General settings → Startup → Start Owlio when I sign in to Windows** launches the installed app after sign-in, including after a restart. It is off by default and applies with **Save settings**. Windows Startup settings remain authoritative; Owlio does not re-enable startup when opened. The dashboard opens on launch so sign-in or renewed terms acceptance can be completed when required.

Ollama is optional under **Text & style → Writing AI → Advanced Writing AI**. Choose an installed model and **Save settings**. Fetching lists installed models without downloading or selecting one; **Download** is an explicit action. Ollama supports voice rewrites and meeting summaries, which require a reachable installed model. Short dictation uses Basic punctuation or Gemini cleanup.

**General settings → Appearance** offers seven bar designs with a listening preview. Choose one and **Save settings**. Each design uses the same shortcut, microphone, controls and status messages. Owl is the default; animations respect reduced motion.

## Get started

The installed app needs Windows x64. **You do not need to install Python manually:** the first-run guide downloads a private runtime and the speech libraries you choose. Cloud speech skips local downloads. A compatible NVIDIA GPU and driver are needed only for the GPU package.

Building from source also needs Node.js with npm and the .NET 8 SDK. See the [development guide](docs/development.md#local-models) for advanced runtime and model details.

### Download the official app

Get the latest installer from [Owlio Releases](https://github.com/theshubzworld/OwliO/releases/latest). The official app requires an Owlio account and acceptance of the current Terms and Privacy Notice before use.

### Build from source

```powershell
git clone https://github.com/theshubzworld/OwliO.git
cd OwliO
npm ci
npm run build
npm start
```

Downloaded runtimes, models and API keys are not bundled in the repository. The official app's sign-in, usage reporting and agreement service use Owlio's hosted configuration. Source builds may require a local cloud configuration; see the [development guide](docs/development.md) and [example configuration](cloud-config.example.json).

### 2. Choose your setup

On the first launch, choose:

- **On this computer:** pick a speech package and model, then **Download and set up local speech**. Owlio installs Python, libraries and the model, verifies them and connects the local server.
- **With a cloud provider:** save a Groq API key; no local runtime is downloaded.
- **Set up later:** open the app without downloads. Return through **Speech & models → Open guided setup**.

Local packages include **Lightweight CPU** (Whisper without PyTorch), **Full CPU** (PyTorch/Transformers) and **Full NVIDIA GPU** (CUDA 12.8). The setup shows estimated space needs and progress, supports cancellation/retry, and offers separate Python, libraries and model buttons. After verification, test the microphone and finish setup.

Once connected, use **Speech model → Change speech model** to download and select models. Library requirements are handled automatically. Repair, storage and manual hardware/package overrides are under **Advanced local speech**.

Choose **Advanced storage → Storage location → Choose folder** during setup, or open **Speech & models → Advanced local speech**, to store large files on another drive. Owlio creates an `OwlioData` folder. Separate runtime/model/cache folders and space checks are advanced controls. Storage actions save immediately; connected files remain in use until replacement setup verifies successfully.

For an existing setup, choose the new location, use **Copy existing models**, then run local speech setup with the desired package/model to build and verify the new environment. Originals are kept, so copying temporarily needs extra space. **Clear download cache** removes installer downloads while keeping Python, installed libraries and model weights. Advanced manually configured runtimes are still supported in the [development guide](docs/development.md#local-models).

### 3. Set up your first dictation

1. Open Owlio from the tray icon and go to **General settings**.
2. Choose your microphone and shortcut, set your language under **Speech & models**, then **Save settings**.
3. Finish local or cloud setup under **Speech & models** if you skipped it. Additional models are available under **Speech model → Change speech model**.
4. Select a text field in another app and try your shortcut.

For Roman Hinglish, enable **Text & style → Hindi output → English letters**. Local models, including Bodhan Flex, use native transcription only. Flex still needs approved [Hugging Face access](https://huggingface.co/bodhan-ai/indic-transcribe-flex) for its first download; the read token is not saved.

## Multilingual Whisper dictation

Under **Speech & models → What language do you speak?**, select a language. Owlio keeps a compatible local model or selects a compatible downloaded model. If none is available, it selects a model and shows the download/setup action; downloading still requires that action. Choose **Save settings** to apply. The picker includes 100 Whisper languages and 12 additional Flex languages, plus automatic detection and Hinglish. Recognition retains the spoken language and script.

The language picker includes multilingual Whisper languages, additional languages supported by Bodhan Flex, automatic detection and Hinglish. Available languages depend on the selected model. English-only `.en` checkpoints are restricted to English; custom checkpoints need language metadata for automatic selection.

When a download is needed, Owlio defaults to Whisper small for the standard multilingual set, turbo for Cantonese, and Flex for languages outside Whisper's set. These are compatibility defaults, not per-language accuracy rankings. Automatic detection chooses a broad multilingual Whisper model; it does not guarantee accurate language switching within a recording. Cloud providers expose their configured model's language set.

Gemini Hindi conversion runs only with **Hindi** or **Hinglish** explicitly selected. It stays inactive for other languages and automatic detection, protecting Marathi, Nepali and other Devanagari languages from Hindi transliteration. Pick Hindi/Hinglish when you want Roman Hinglish. Writing rules can now target any language from the picker.

## Choose your cleanup

| Option | What it does | Connection |
| :--- | :--- | :--- |
| **Basic punctuation** | Capitalization and ending punctuation without another AI model. | Offline |
| **Gemini cleanup** | Fixes disfluencies and spoken self-corrections; optionally organizes lists. | Gemini |


Connect Gemini under **Text & style → Writing AI**, enter a Vertex API key, select **Gemini cleanup**, then **Save settings**. The same Writing AI handles voice rewrites and summaries independently of the speech provider. Fresh profiles use Basic cleanup and leave voice rewrites off. Cleanup failures preserve recognized words with basic punctuation.

To rewrite, select the exact text to change before speaking a command such as “make it formal,” “isko short karo,” or “इसको छोटा करो.” Owlio replaces that selection only if the selection and source text are still unchanged. Command-like speech without a selection stays ordinary dictation. **Cancel processing** on the floating bar stops pending dictation requests. Dictation recordings stop automatically at 12 minutes.

Meeting Notetaker records your microphone for up to two hours using bounded audio chunks. Voices heard only through headphones are not captured. Meeting transcription bypasses dictation cleanup and rewrite detection. Summary failures keep the transcript. With recording retention enabled, unfinished meeting chunks can be retried or discarded from **Notetaker → Unfinished recordings**; completed chunks do not need transcription again. The last unfinished chunk (up to one minute) can be lost if the window or app exits before it is saved. When retention is off, temporary meeting audio is deleted after processing/failure or on the next startup.

Failed dictations keep recognized words in history. With recording retention enabled, **Transcribe again** retries retained audio and copies recovered text for manual paste. Recovery never pastes into a field from an earlier session.

### Roman Hinglish from Hindi text

Under **Text & style → Hindi output**, choose **English letters**, enter your Vertex API key in Writing AI, then **Save settings**. This is the only supported transliteration path. It is off by default and shares its key with Gemini Writing AI.

The flow is **local speech → Hindi transcript → Gemini transliteration → selected cleanup → paste**. For transliteration with basic punctuation, choose **Basic punctuation** under Cleanup provider. Selecting Gemini cleanup as well makes a second API request. English-only or already Romanized text skips the transliteration request.

Only the transcript is sent for transliteration; local audio stays on the PC. Usage limits or charges may apply. Owlio checks for remaining Hindi letters, changed English text, numbers, punctuation, line breaks and alignment whitespace. Hindi compounds may expand into multiple Roman words. If conversion fails these checks, the original transcript is kept with a history warning. These checks cannot guarantee spelling or semantic accuracy. Original text remains available in history. Voice rewrites and meeting transcripts keep their existing behavior.

## Your data, clearly

- **Local recognition:** downloaded speech models process audio on this computer. Selecting Groq sends audio to Groq.
- **Gemini cleanup:** sends recognized text, relevant writing rules, approved spelling hints and a coarse app category. This formatter does not send audio, window titles, browser URLs or surrounding field text.
- **Spelling learning:** off by default for new profiles; when enabled, checks possible spelling corrections after a successful paste when the same field remains focused. Gemini checks receive candidate pairs; suggestions that aren't approved stay in Dictionary for review. This does not retrain speech models.
- **Saved data:** drafts and history stay in the local profile. Audio retention can be turned off. API keys use Windows encryption.

Voice rewrites send only the selected text and spoken command to the chosen Writing AI. See the [development guide](docs/development.md) for the full behavior and limits.

## Need a hand?

| If this happens | Try this |
| :--- | :--- |
| **The owl is hidden** | Select **Show floating bar** in the dashboard or tray menu. |
| **Your headphones disconnect** | Use **Windows default** or choose another microphone, then retry. |
| **The text wasn't inserted** | Check the history message, copy the saved text and paste into the intended field. |
| **AI cleanup is unavailable** | Basic punctuation keeps dictation usable. Check the provider and key in Text & style → Output & cleanup. |

Insertion and automatic correction learning depend on Windows permissions and the target app's text-field support. The [development guide](docs/development.md#dictation-and-shortcuts) covers recovery and testing.

## Build an installer

```powershell
npm run package
```

The output is written to `release-artifacts/<version>/`. The installer includes the desktop app, setup downloader, speech-server source, Windows helper and Owlio icons. Python, libraries and model weights are downloaded on demand after installation. Private settings are separate. See the [development guide](docs/development.md) for build requirements.

## Development

```powershell
npm run typecheck
```

See the [development guide](docs/development.md) for build and packaging steps.

Owlio's app metadata declares MIT. The bundled Bodhan Flex loader retains its original notices; its model terms are included in [MODEL_LICENSE.md](vendor/bodhan_flex/MODEL_LICENSE.md). Model weights are downloaded separately. [Loader attribution →](vendor/bodhan_flex/NOTICE.md)

---

<p align="center">
  <img src="assets/brand/owlio-icon-64.png" width="40" height="40" alt="Owlio owl">
  <br>
  <strong>A little owl. A lot less typing.</strong>
  <br>
  <sub>Owlio · Voice &amp; Meeting AI</sub>
</p>
