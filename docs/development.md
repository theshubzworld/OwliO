# Owlio development

## Requirements

- Windows x64 for running and packaging the desktop app.
- Node.js with npm for the app source and build tools.
- .NET 8 SDK for the Windows helper.
- Python is needed only when running the speech server separately during development.

## Install and run

```powershell
npm ci
npm run build
npm start
```

For a development launch that rebuilds the helper and app before opening Electron:

```powershell
npm run dev
```

## Build a Windows installer

On Windows x64, prepare the private cloud configuration locally, then run:

```powershell
npm run package
```

The installer is written to `release-artifacts/<version>/`. It includes the Owlio desktop app and Windows helper. Python speech libraries and model weights are downloaded by guided setup after installation. Installers are currently unsigned, so Windows may show a SmartScreen prompt.

Copy `cloud-config.example.json` to `cloud-config.json` and fill in the project URL and publishable key needed by your own configuration. Keep `cloud-config.json`, API secrets, and signing credentials out of Git.

## Speech runtime

The official installer downloads the private Python runtime and the selected speech libraries and model during setup. See the in-app **Speech & models** settings for model selection, setup, storage, and repair.

The bundled Bodhan Flex loader retains its upstream notices in [NOTICE.md](../vendor/bodhan_flex/NOTICE.md), with model terms in [MODEL_LICENSE.md](../vendor/bodhan_flex/MODEL_LICENSE.md). Model weights are downloaded separately and remain subject to their providers' terms.
