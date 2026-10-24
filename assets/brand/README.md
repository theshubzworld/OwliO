# Owlio artwork

- `owlio-logo.png`: transparent logo with wordmark, 720 × 220.
- `owlio-logo.svg`: wordmark container with embedded PNG owl mark and editable text.
- `owlio-mark.png`: high-resolution transparent owl head.
- `owlio-mascot.png`: high-resolution transparent full owl mascot.
- `owlio.ico`: Windows app/taskbar icon, containing 16, 20, 24, 32, 40, 48, 64, 128 and 256 pixel images.
- `owlio-icon.png`: 256 pixel PNG used by the desktop tray and dashboard.
- `owlio-icon-{size}.png`: individual exports, up to 512 pixels.
- `owlio-brand-preview.png`: preview of the logo, mascot and small icons on light and dark surfaces.
- `readme-banner.png`: cream and plum repository header, using the existing Owlio wordmark. Regenerate with `electron scripts/render_readme.cjs`.

Artwork generated with the built-in `image_gen` tool. The exact prompts are saved in `generation-prompts.json`.
`scripts/create_owlio_assets.py` exports the supplied mark to PNG/ICO and writes the logo SVG.
`scripts/render_owlio_brand.cjs` exports the PNG wordmark and preview using Electron.

Original Owlio icon files remain in `assets/`.
