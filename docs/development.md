> Current configuration behavior: global Save settings; automatic speech dependencies; independent shared Writing AI; Gemini-only transliteration. Earlier benchmark/audit records describe the builds tested at that time.

# Owlio development guide

[← Back to Owlio](../README.md)

Windows dictation with an Electron/React dashboard and a .NET 8 helper for global shortcuts, text-field focus and clipboard insertion.

## Windows installer

`release-artifacts/1.0.26/Owlio-Setup-1.0.26.exe` installs the x64 desktop app with Owlio taskbar/tray icons and desktop/Start menu shortcuts. The installed executable is normally `%LOCALAPPDATA%\Programs\Owlio\Owlio.exe`. Packaging creates the installer without running it or updating an existing installation.

The installed app saves data under `%APPDATA%\Owlio`. First launch copies the existing development profile's settings, dictionary, snippets, history, recordings and Windows-protected credential key without deleting the source profile. Existing installed profiles are retained. Reopening Owlio brings the existing app forward instead of running a second shortcut helper.

A fresh profile opens guided setup. Choose local speech, cloud speech with a Groq key, or **Set up later**. Skipping starts no downloads; **Speech & models → Open guided setup** reopens the same flow. Existing profiles retain their settings and do not get forced through onboarding.

Local setup downloads Owlio's own portable Python and installs libraries without requiring system Python. Leave Package on **Automatic** or choose **Lightweight CPU** for Faster-Whisper, **Full CPU** for Transformers/Flex, or **NVIDIA GPU** for CUDA 12.8 under Advanced installation. The interface shows disk estimates, the current stage, download details, cancellation and retry. Components can also be installed separately under Speech & models. Full NVIDIA setup checks CUDA availability; it requires a compatible GPU and driver. Models are downloaded separately, and Bodhan Flex requires approved Hugging Face access and a read token. The token is passed to the download process in memory and is not saved.

Managed runtimes and their download cache live under `%APPDATA%\Owlio\local-speech`; models stay in its `models` folder. `%APPDATA%\Owlio\speech-runtime.json` connects the verified Python/model paths to the bundled server, using `http://127.0.0.1:17861/v1`. Setup verifies imports and model loading before replacing the connection. Repair installs a separate candidate rather than changing the active runtime's libraries. Failed setup retains the previous connection. Existing manually configured runtimes remain supported. Owlio stops only a server it started itself; startup diagnostics are in `speech-server.log`.

**Storage location** in first-run setup and Speech & models can replace that default with an `OwlioData` subfolder on a selected drive. **Advanced folders & free space** separately selects `Owlio-environments`, `Owlio-models` and `Owlio-downloads` under chosen parent folders. Native folder picking validates writable, distinct paths, including junction aliases. Choices are stored in `local-storage.json` beside the app's settings; the active connection in `speech-runtime.json` stays unchanged until setup succeeds. Runtime candidates are tracked under the selected environment folder, with compatibility for 1.0.2's candidate marker.

**Copy existing models** copies the connected runtime's cache to the chosen model location, with cancellable progress, retry of matching completed files and no overwriting of conflicting weights. It retains originals and never copies directory links or links outside the source cache. Rebuild the environment with local setup rather than moving Python's files. **Clear download cache** removes only Python archives and pip cache entries created by the installer, validating ownership and refusing links into other folders. It retains unknown files, installed libraries and models. Old environments/original models are intentionally retained; remove them manually only after verifying the new setup.

Python provenance: [Astral python-build-standalone releases](https://github.com/astral-sh/python-build-standalone/releases). The installer pins Windows x64 Python 3.11.17 and verifies its archive's SHA-256 before extraction. PyTorch/TorchAudio 2.8.0 use the [official CPU or CUDA 12.8 wheel indexes](https://pytorch.org/get-started/previous-versions/); remaining libraries use PyPI. Python, libraries and weights are downloaded after installation, keeping the EXE smaller.

To rebuild:

```powershell
npm run package
```

The installer does not include private settings, API keys, browser cookies or model weights.

Packaging publishes the Windows helper into `release-artifacts/helper-build` and uses the already installed Electron runtime. Each version gets a separate output folder under `release-artifacts`. This avoids overwriting a helper used by a running development app or older unpacked build. The package script runs type checking and builds the renderer/main code before creating the x64 NSIS installer.

## Run locally

```powershell
npm install
npm run build
npm start
```

Use guided setup or Speech & models to install an independent local runtime. For a developer-managed Python environment, `npm run server:install` installs `requirements.txt` into the current Python and `npm run server` starts the server; keep that terminal running.

Fresh profiles show the setup dashboard. Completed/existing profiles start with a minimized dashboard on the taskbar, a visible tray icon and a tiny handle above the taskbar. Click the tray icon to open the dashboard. Hover the handle to reveal the microphone, meeting notes and settings controls. Select your destination text field before dictating.

The floating bar keeps drawing in the background and is brought forward when dictation starts. Hidden bars and crashed/closed bar windows recover automatically. Use **Show floating bar** in the dashboard or tray menu to recreate a glitched idle bar without restarting the app; during dictation it brings the existing bar forward without interrupting the microphone.

Default/communications microphone routes follow Windows when devices change. If a selected physical microphone is unavailable, the recorder retries with Windows' default microphone. A microphone disconnected during a recording reports a clear error; retry dictation with the current input. The microphone list refreshes when devices connect/disconnect.

## Dictation and shortcuts

The initial shortcut is F8; saved custom settings take precedence. Hold and release in push-to-talk mode, or press twice in toggle mode. Clicking the floating microphone starts/stops dictation without taking focus from the destination window.

In General settings, use Record to capture a custom shortcut, or type one such as Ctrl+Win or Ctrl+Shift+Space. Test shortcut verifies the native press/release sequence without recording. Save general settings applies it. Esc cancels shortcut capture/testing.

When insertion fails, the bar says Not inserted or Check mic. Click it to see the cause. Recognized words that could not be inserted remain on the clipboard and are saved in history with the failure reason. Use Copy, select the intended text field and press Ctrl+V. Windows can still block insertion into an elevated application or a closed/unavailable field.

Voice rewrites require a nonempty captured selection. The model receives that exact selection, and the helper checks the original text and selection again before replacing it. A failed rewrite leaves the source untouched and saves the spoken instruction in history. Basic formatting preserves Technical style and terminal/editor casing. Snippets match recognized words before cleanup, and dictionary replacements use Unicode boundaries and literal replacement strings.

Every speech/text request has a deadline. Dictation cancellation propagates through provider requests; a timed-out native text-access request recycles the helper and ignores stale messages. Recovery history checkpoints capture audio before STT when retention is enabled, then save recognized words before optional formatting. Interrupted checkpoints reopen as failed/recoverable records. Transcribe again copies recovered words for manual paste and never reuses an old target.

Meeting capture streams 60-second WAV files to `meeting-captures/<id>` in the profile instead of uploading one large recording. Capture stops at two hours; ordinary dictation stops at 12 minutes. Chunks are fsynced and recorded in an atomic manifest, with completed transcription results saved for resumable retries. Stop flushes the partial tail. An abrupt window/app exit can lose the current, unsaved chunk (under one minute); completed chunks remain recoverable when retention is enabled. Non-retained temporary capture files are removed after failure/success or at startup. Interrupted partial transcripts are saved as clearly marked notes before non-retained audio is removed.

Notetaker exposes persistent errors, cancel processing, retry/discard for unfinished retained recordings, and full transcripts. It captures microphone input only. Meeting transcription bypasses dictation cleanup and command detection. Speech/text connection changes and model activation are blocked while recordings/recovery are active, so successive chunks cannot silently switch providers. Installed preferences and recordings live in the Owlio app-data folder.

## Local models

The bundled speech server uses Faster-Whisper (CTranslate2), with Whisper base selected initially. First-run setup offers tiny, base, small, turbo and Bodhan Flex, with the full catalogue available afterward. Speech & models → Speech model → Model details shows the loaded model and actual CPU/GPU compute mode; Change speech model lists downloaded models.

**Bodhan Flex** is selectable under Speech & models → Speech model → Change speech model. Select it and Save settings. All local models perform native transcription only; removed `localSttOutputMode` values are discarded when profiles load. The Flex backend ignores legacy output requests and always uses native mode. Gemini is the only transliteration path.

Flex runs locally using the full checkpoint on CUDA BF16, or CPU FP32. Long recordings split at natural pauses into at most 30-second pieces using Bodhan's supplied helper. Switching releases the previous model's GPU memory and restores it if loading fails. The reviewed loader is bundled under `vendor/bodhan_flex`; pinned weights and tokenizer files stay in the selected model cache. First-run setup accepts a temporary Hugging Face read token after model access is approved. Existing developer/server downloads can use `hf auth login`. Once downloaded, dictation does not require internet or cookies. Its repository URL is recognized by **Download URL** as a supported model-specific download.

Flex model source and terms: [bodhan-ai/indic-transcribe-flex](https://huggingface.co/bodhan-ai/indic-transcribe-flex). Original loader copyright notices are retained, with the model license under [MODEL_LICENSE.md](../vendor/bodhan_flex/MODEL_LICENSE.md). Model weights are not included in the installer.

Supported speech models: tiny, base, small, medium, large-v3 and turbo. The catalogue uses the repository mappings supplied by the installed Faster-Whisper version. Managed setup uses Owlio's permanent model folder; the developer server defaults to this project's `models` directory. Both use Hugging Face's cache layout. Set OWLIO_MODEL_CACHE to use another directory. Copied model snapshots are self-contained.

For a custom model, paste its public Hugging Face repository URL under **Advanced models → Custom Hugging Face model URL**, click **Download URL**, then select the downloaded model and click **Save settings**. The server checks compatibility first, pins the repository revision, and downloads only model weights and tokenizer/configuration files. It accepts Faster-Whisper checkpoints or full Transformers Whisper checkpoints with safetensors; repository Python code and pickle weights are never loaded. Failed downloads can be retried and are not marked installed until all required files exist.

The default URL is `https://huggingface.co/Trelis/whisper-hinglish-preview`. This is the normal full checkpoint, not a smaller distilled model. Its original weights take approximately 6.2 GB on disk. CUDA inference uses FP16, CPU inference FP32. Selecting Hinglish enables its `<|mixedcode|>` token: Hindi is normally written in Devanagari and English in Latin characters. GPU memory availability affects whether the full model can load.

Full checkpoints require PyTorch and Transformers. `npm run server` uses this project's `.venv` if present, otherwise the current Python; override it with `OWLIO_PYTHON`, or a local `server-runtime.json` containing `{"python":"absolute path to python.exe"}`. The configured runtime must contain the dependencies in `requirements.txt`. CTranslate2 4.6+ and cuDNN 9 are required for CUDA; the server registers PyTorch's CUDA DLL directory and checks dependencies before native inference, falling back to CPU if necessary. The runtime is separate from the permanent model folder. Reusing an existing compatible runtime does not modify its packages or models.

1. Select a speech model and click Download.
2. Wait for the download to finish, select the model, then Save settings.
3. Save validates that the selected model is downloaded. Recognition loads the selected model on the next dictation; load failures preserve the current selection/history for recovery.

Downloading does not switch the selected model. Downloads run in the background; loading a replacement temporarily blocks new dictation. Larger models require more memory and processing time. Downloads need internet access; recognition uses local downloaded weights.

Writing AI is independent of speech: `writingProvider` selects Gemini, Ollama or off for voice rewrites and meeting summaries. AI dictation cleanup uses Gemini exclusively; Basic punctuation is the offline fallback. Fresh profiles use Basic cleanup with Writing AI off and rewrites disabled. Ollama is opt-in under Advanced Writing AI and never runs for short dictation cleanup. Enabling local rewrites requires a reachable installed model; unavailable summaries retain transcripts.

Legacy/developer speech URL: http://localhost:8000/v1. Managed setup uses http://127.0.0.1:17861/v1. Save modified server addresses before managing models. Model management requires the bundled Owlio server; other transcription servers may support different model names or management APIs.

## Existing dashboard features

### Development: Gemini dictation cleanup

**Text & style → Writing AI** offers Gemini with a Vertex Express API key. Choose Basic or AI cleanup independently. Speech never chooses the Writing AI implicitly. The same encrypted key can also power the separate Gemini Hindi-to-Roman conversion stage.

Gemini receives the recognized dictation, cleanup instructions, relevant saved writing rules, approved spelling hints and a coarse app category; audio, window titles, browser addresses and surrounding text fields are not sent by this formatter. It preserves the selected writing script, applies spoken corrections, retains existing greetings and supports the chosen writing style. There is a six-second cleanup timeout and no automatic API retry. Network, quota, blocked, truncated and incompatible-script responses fall back to basic punctuation with a warning in dictation history. **Basic punctuation (offline)** bypasses formatting APIs. Removed cleanup providers migrate to Basic punctuation unless a Gemini connection is available. When Gemini cleanup is selected, voice rewrites also use Gemini (15-second deadline) and meeting summaries use Gemini (30-second deadline). Rewrites send the selected source and spoken command; summaries send the transcript. Ollama remains available for rewrites and meeting summaries. Rewrite prompts use the selected source rather than unrelated surrounding text.

This integration is staged and tested in a separate development profile. The installed Owlio app has not been updated with it.

### Development: faster recording startup

The floating bar prepares a reusable AudioContext and AudioWorklet without requesting microphone access. Each dictation acquires the current microphone, records 40 ms PCM chunks at 16 kHz and releases all microphone tracks when stopped. The worklet outputs silence and flushes the final partial chunk. The bar displays **Starting…** until the audio thread acknowledges capture; early key release cancels pending acquisition instead of starting a late recording. Microphone selection is cached and refreshed when settings change, avoiding a settings IPC round trip on each press. The audio context closes when the bar is disposed.

A local three-round comparison with the installed recorder on this laptop measured a median first audio chunk of **221 ms vs 441 ms**, from recorder start (not native keydown). Warm capture readiness was approximately **184–186 ms** for both: Windows microphone acquisition still contributes most of that startup time. The initial installed-recorder run was colder and took 433 ms to become ready / 727 ms to deliver its first chunk. Samples stayed transient and were neither saved nor uploaded. The installed app was not updated; these are development results, not a timing guarantee for every device.

### Development: correction learning and writing preferences

**Text & style → Writing style → Correction learning** controls automatic spelling learning, which is off by default for new profiles; **Text & style → Writing style → Punctuation & spacing** controls local cursor adjustments. After a successful ordinary dictation paste, the Windows helper can watch that exact focused field for up to 30 seconds. It first verifies the inserted text, isolates the dictation using the untouched prefix/suffix, and stops on focus changes, a new dictation or disabled learning. Password fields, unverified pastes, large/inaccessible documents, rewrites and failed deliveries do not teach vocabulary. UI Automation support varies by app; **Dictation → Correct this dictation** supplies an explicit fallback for entries up to 5,000 characters. It updates history, leaving text in other apps untouched.

Candidate extraction happens locally and rejects punctuation-only edits, obvious date/number changes, pure additions and broad rewrites. Up to four possible spelling corrections are sent to Gemini when Gemini cleanup is selected; the complete old/edited field and surrounding text are not sent to this classifier. Validated candidates become preferred spelling hints, **not global replacements**. Unapproved/offline/uncertain suggestions stay pending and unused. **Dictionary → Learned spellings** lets users accept or forget entries. This persistent memory does not retrain speech-model weights; with basic cleanup, learned hints cannot apply themselves.

**Text & style → Writing style → Your writing preferences** stores explicit rules, scoped to all apps or an exact Windows process name, and optionally a spoken language. Relevant rules and approved vocabulary go with AI cleanup; Gemini receives only a coarse app category, not the window title, URL or cursor text. Rules save immediately and can be disabled/deleted. Local punctuation adjusts spaces/casing only with reliable cursor ranges, preserves list/code structure and question/exclamation endings, and offers automatic/full/minimal final-period behavior. Automatic chat-period stripping yields to custom Gemini rules; explicit punctuation modes still apply.

Native disposable-field checks verified correction isolation and cancellation. An isolated live Gemini test learned **Jhon → John**, rejected **John → Sarah** as a spelling correction, then preserved the learned name in Romanized Hinglish and respected a saved no-em-dash rule (cleanup 0.8–0.9 seconds; spelling classification 1.4 seconds, outside dictation insertion). These finite examples do not guarantee every classifier or formatting response. The installed Owlio app remains unchanged.

**Text & style → Writing style → Cleanup & structure → Automatically organize lists and steps** is enabled by default for Gemini cleanup. Clear lists use plain-text bullets and ordered instructions use numbered lines; ordinary speech stays in paragraphs. Existing introductions, item order, language and details are preserved. Turn this option off and save to keep dictation as prose. Organization uses the same cleanup request, with no extra model or API call. List detection is performed by the model and may vary with how clearly the items are spoken; API failures retain the basic punctuation fallback.

Dictation history and audio playback, microphone selection/testing, meeting recordings and notes, usage insights, dictionary replacements, snippets, writing style and scratchpad remain available. The dashboard's warm, light styling follows the supplied visual references. No account, billing, calendar or connector features were added.

## Verification

Run `npm run typecheck` and `npm run build` before packaging. Internal test suites, smoke checks, recordings and benchmark reports are maintained locally and excluded from the public repository.

## Multilingual speech and automatic model selection (1.0.12)

`src/shared/speechLanguages.ts` holds 100 Whisper language codes, Flex's 27 documented codes, names and compatibility guards. Their union has 112 languages, plus automatic detection and Hinglish. Standard multilingual Whisper through large-v2 exposes 99 languages; large-v3/turbo adds Cantonese. Flex accepts all 27 languages through native transcription. Trelis Hinglish is limited to its documented Hindi/English coverage, and known `.en` checkpoints to English. [Official sources and coverage policy](model-evaluations/language-coverage.md).

Changing the local spoken language stages a compatible model: preserve the current compatible model, otherwise prefer compatible downloaded models. With no installed match, select small for Whisper languages, turbo for Cantonese, or Flex for additional Indic languages. Automatic detection selects broad Whisper coverage. Unknown custom checkpoints require explicit language metadata for automatic selection; tokenizer tokens alone do not establish trained coverage. Manual custom selection remains available with an unverified-coverage notice. Model downloads require an explicit action, and settings remain staged until saved.

Selection reads the model catalogue, disables Save while resolving, ignores stale results, and falls back to documented defaults if the server cannot report download status. First-run setup carries the staged language and model together so an old saved language cannot reject a newly selected Flex setup. Main-process validation checks downloaded status and declared custom coverage; the server rejects a known unsupported language before loading weights. English-only Transformers checkpoints omit multilingual generation arguments.

Local and cloud transcription omit the language field for automatic detection. The bundled server maps omitted/auto language to `None`; transcription endpoints preserve native script. Language-specific writing preferences share the language catalogue. Gemini Hindi transliteration is gated on explicit `hi` or `hinglish`, so automatic/Marathi/Nepali input does not enter Hindi conversion. AI cleanup checks actual Unicode letters before enabling Latin-only instructions, avoiding script changes for Tamil, Arabic and other non-Latin transcripts.

Validation covers persistence, model compatibility, transport parameters, backend routing, script-preserving cleanup and the multilingual UI. It does not constitute live recognition testing across all languages.

Internal speech pipeline audit reports and verification fixtures are maintained locally and excluded from the published source.
