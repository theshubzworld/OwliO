<p align="center">
  <img src="assets/brand/readme-banner.png" alt="Owlio — Voice typing companion for Windows" width="100%">
</p>

<p align="center">
  <strong>Speak naturally. Watch your words appear anywhere on Windows.</strong><br>
  A fast, privacy-first desktop voice typing companion powered by local speech models.<br>
  Dictate effortlessly across 100+ global languages, regional dialects, and bilingual speech in any app.
</p>

<p align="center">
  <a href="https://github.com/theshubzworld/OwliO/releases/latest"><img src="https://img.shields.io/github/v/release/theshubzworld/OwliO?style=flat-square&color=682d49&label=Windows%20Release" alt="Latest Release"></a>
  <a href="https://theshubzworld.github.io/OwliO/"><img src="https://img.shields.io/badge/Website-Live%20Demo-f59e6c?style=flat-square" alt="Website"></a>
  <a href="#-supported-languages"><img src="https://img.shields.io/badge/Languages-100%2B%20Global-682d49?style=flat-square" alt="100+ Languages"></a>
  <a href="#-privacy-by-architecture"><img src="https://img.shields.io/badge/Privacy-100%25%20On--Device-15803d?style=flat-square" alt="Privacy First"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License"></a>
  <a href="#-contributing"><img src="https://img.shields.io/badge/PRs-Welcome-brightgreen?style=flat-square" alt="PRs Welcome"></a>
</p>

<p align="center">
  <a href="#-download">Download</a> &nbsp;•&nbsp;
  <a href="#-key-features">Features</a> &nbsp;•&nbsp;
  <a href="#-supported-languages">Languages</a> &nbsp;•&nbsp;
  <a href="#-how-it-works">How it Works</a> &nbsp;•&nbsp;
  <a href="#-privacy-by-architecture">Privacy</a> &nbsp;•&nbsp;
  <a href="#-contributing">Contributing</a> &nbsp;•&nbsp;
  <a href="https://theshubzworld.github.io/OwliO/">Official Site</a>
</p>

---

## ✨ Overview

**Owlio** is an open-source voice typing companion for Windows 10 and 11. Press a global shortcut, speak naturally into your microphone, and Owlio transcribes your thoughts directly into whichever text field currently has focus—whether you're writing code in VS Code, drafting an email in Outlook, chatting on Slack, or taking notes in Notion.

Owlio runs **local speech recognition models (Whisper, Bodhan Flex and Parakeet TDT)** directly on your PC’s CPU or NVIDIA GPU. Local dictation works offline after setup; speed depends on the model, recording length and hardware.

---

## ⚡ Key Features

- 🌐 **Works in Every Windows App**: Dictate anywhere you can type. Slack, Word, Notion, IDEs, Discord, Chrome, WhatsApp Desktop, terminal windows, and custom apps.
- 🔒 **100% On-Device AI Option**: Speech recognition runs entirely on your local hardware using OpenAI Whisper. Offline dictation after downloading your model; your voice recordings never leave your PC.
- 🚀 **Hardware Acceleration**: Choose lightweight CPU mode or lightning-fast NVIDIA GPU acceleration (CUDA 12.8 support).
- 🌍 **Over 100 Languages**: Automatic language detection across global languages (English, Spanish, French, German, Japanese, Mandarin, Arabic, and more), plus 27 regional Indic dialects and bilingual Hinglish.
- 🦉 **Your Companion, Your Way**: Customise your floating desk companion with multiple styles: Owl, Sleepy Cat, Little Cloud, Friendly Robot, Minimal Waveform, or Glowing Pebble.
- ✍️ **Intelligent AI Polish**: Keep pure verbatim speech with basic punctuation, or enable optional AI cleanup (via Gemini or Ollama) for smart formatting, disfluency removal, voice rewrites, and meeting summaries.
- 📝 **Scratchpad & Meeting Notetaker**: Long-form dictation recording, searchable history, local audio playback, and custom snippet triggers.

---

## 🌐 Supported Languages

Owlio was designed from the ground up for universal, multilingual communication. It preserves the natural script of whatever language you speak and detects language switches automatically.

### 1. Global Multilingual Whisper (100+ Languages)
Full speech recognition with automatic language detection, including:
- **Europe & Americas**: English, Spanish, French, German, Portuguese, Italian, Dutch, Russian, Polish, Ukrainian, Swedish, Turkish, Greek, Czech, Romanian, Danish, Finnish, Norwegian, Hungarian, etc.
- **Asia & Middle East**: Japanese, Mandarin Chinese, Cantonese, Korean, Arabic, Hebrew, Vietnamese, Thai, Indonesian, Malay, Persian, Tagalog, and more.

### 2. Regional Indic Languages & Dialects (via Bodhan Flex)
27 regional languages and dialects, including:
- Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Urdu, Kannada, Odia, Malayalam, Punjabi, Assamese, Maithili, Bhojpuri, Konkani, Kashmiri, Dogri, Sindhi, Sanskrit, Haryanvi, Chhattisgarhi, Rajasthani, and more.

### 3. Bilingual Hinglish & Script Transliteration
- Seamless code-switching: mix Hindi and English naturally in the same sentence.
- Choose whether to output recognized words in native Devanagari script (`कल शाम की मीटिंग`) or romanized English letters (`Kal shaam ki meeting`).

### English dictation with Underdog Bark 3.0 Pro

Select **Speech & models → Change speech model → Underdog Bark 3.0 Pro · English**. Set the spoken language to English (or automatic detection), then choose **Set up model** / **Download**. The model has about 1.25 GB of weights and needs a Full speech package. Choose the NVIDIA GPU package in Advanced local speech for CUDA acceleration; CPU execution is also supported. Setup builds a separate runtime and connects it only after the model loads successfully.

Bark Pro is English-only and preserves spoken fillers. Owlio's optional writing cleanup and dictionary replacements run afterward. Whisper vocabulary prompts do not apply to Parakeet decoding. Recordings are processed in bounded, overlapping chunks to limit memory use.

Advanced Hugging Face imports accept CTranslate2 Whisper, Transformers Whisper, and Transformers **Parakeet TDT** checkpoints with safetensors and processor/tokenizer assets. Native NeMo archives, Parakeet CTC, GGUF and other architectures require a separate backend and are rejected. Imported language coverage comes from the model card; it is never inferred from the model name. Repository Python code is not downloaded or executed.

Source: [Bark Pro model card](https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro). The recommended checkpoint is pinned to revision `4b5c51e04aa8d16dda9ecdff71bc29f7360149e4`; its CC-BY-4.0 attribution is documented in [speech model notices](docs/speech-model-notices.md) and downloaded with the weights.

---

## 📥 Download

Pre-built Windows 64-bit installers are published on the official [GitHub Releases](https://github.com/theshubzworld/OwliO/releases/latest) page.

| File | Platform | Architecture | SHA-256 Checksum |
| :--- | :--- | :--- | :--- |
| **Owlio-Setup-1.0.21.exe (local build; not published yet)** | Windows 10 / 11 | x64 | `5D7FD3E86FE5DDEAAC432E8222CFFF112528F0C8C06FB2D161096CA1E631CA47` |

> **Note on Windows SmartScreen**: The installer is currently unsigned. If Windows SmartScreen displays a warning, click *More info* → *Run anyway*. You can verify the published SHA-256 hash above against your download.

---

## 🚀 How it Works

```
[ Your Voice ] ──> [ Floating Companion / Shortcut ] ──> [ Local Whisper (CPU/GPU) ] ──> [ Text Inserted in Active App ]
```

1. **Trigger**: Press your customizable shortcut (default: `Win + Space` or `F8`) or click the floating companion.
2. **Speak**: Talk naturally. The companion displays real-time soundwave feedback and listening status.
3. **Insert**: Release the shortcut or finish speaking. Owlio processes the audio locally and automatically types the formatted text into your cursor position.

---

## 🛠️ Guided Setup & Zero Prerequisites

You **do not need to install Python, PyTorch, or CUDA manually**.

On first launch, Owlio's interactive setup assistant handles everything in an isolated, private application directory:
1. **Lightweight CPU**: Whisper without PyTorch (~200 MB, minimal resource footprint).
2. **Full CPU**: Full PyTorch & Hugging Face Transformers models.
3. **NVIDIA GPU**: CUDA 12.8 GPU-accelerated transcription for sub-second recognition.
4. **Cloud Mode**: Connect your own Groq or Gemini API keys if you prefer zero local disk usage.

Speech models download on demand and can be stored on any drive you specify in **Settings → Advanced Storage**.

---

## 🛡️ Privacy by Architecture

- **Audio Stays on Your Machine**: When using local Whisper models, all audio processing occurs exclusively on your CPU or GPU. No voice recordings are ever sent to remote servers.
- **Local Profile Storage**: Dictation history, personal dictionary entries, drafts, and custom snippets live inside your private Windows user profile (`%APPDATA%/Owlio`).
- **Optional Cloud AI**: Cloud speech recognition (Groq) or AI writing polish (Gemini / Ollama) is strictly opt-in and uses your own API keys.
- **Disclosed Telemetry**: The official build includes basic reliability events (app launch, crash diagnostics) to maintain stability. Content such as audio, transcribed text, API keys, and email addresses are strictly excluded. Read our full [Privacy Notice](https://theshubzworld.github.io/OwliO/legal/privacy-notice.html).

---

## 💻 Building from Source

To build and run Owlio locally on your development machine:

### Prerequisites
- Windows 10 / 11 (x64)
- [Node.js](https://nodejs.org/) (v18 or v20 LTS recommended)
- [git](https://git-scm.com/)
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (for the Windows helper service)

### Clone & Run

```powershell
# 1. Clone the repository
git clone https://github.com/theshubzworld/OwliO.git
cd OwliO

# 2. Install dependencies
npm ci

# 3. Build the Electron application and TypeScript bundles
npm run build

# 4. Start Owlio in development mode
npm start
```

### Packaging the Installer

```powershell
npm run package
```
Packaged outputs will be created in `release-artifacts/<version>/`. See the [Development Guide](docs/development.md) for deeper architecture documentation.

---

## 🤝 Contributing

**Contributions are warmly welcome!** Owlio is an open-source community effort, and we'd love your help making desktop voice typing fast, private, and accessible for everyone around the world.

### Ways You Can Contribute
- 🌍 **Language Improvements**: Test speech accuracy in your native language, report transcription edge cases, or contribute language-specific writing rules.
- 🎨 **Companions & UI Design**: Design new desk companions, SVG animations, soundwave visualizers, or accessibility themes.
- ⚡ **Performance & Core**: Optimize Electron startup time, improve memory usage of the background speech server, or benchmark new quantized models.
- 📖 **Documentation & Guides**: Improve setup walkthroughs, translate guides, or write tutorials for Linux/macOS community ports.
- 🐛 **Bug Reports**: Found an issue with a specific text field or app? [Open an issue](https://github.com/theshubzworld/OwliO/issues) with reproduction steps!

### Submitting a Pull Request
1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/my-amazing-feature
   ```
2. Make your improvements with clean, readable code.
3. Run type verification and build:
   ```bash
   npm run typecheck
   npm run build
   ```
4. Commit your changes with clear, descriptive commit messages.
5. Push to your fork and submit a Pull Request! We review PRs actively and appreciate every contribution.

---

## 📄 License & Acknowledgements

- **Application Code**: Licensed under the [MIT License](LICENSE).
- **Open-Weights Models**: Third-party speech recognition checkpoints (OpenAI Whisper, Bodhan Flex, etc.) retain their respective open-source licenses and model weight terms.
- Bundled third-party components and notices are documented in [`vendor/`](vendor/).

---

<p align="center">
  <img src="assets/brand/owlio-icon-64.png" width="40" height="40" alt="Owlio icon">
  <br>
  <strong>Owlio</strong> · <em>Your voice. Your words. A little owl for your everyday writing.</em><br>
  <sub>Crafted for Windows with ❤️ by the open-source community.</sub>
</p>
