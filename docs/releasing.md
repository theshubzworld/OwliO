# Publishing Owlio

Owlio has two public entry points: a small product website hosted with GitHub Pages, and versioned GitHub Releases that carry the Windows installer and release notes.

## Publish the website once

1. Push the site and workflow to the repository's `main` branch.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Open **Actions → Publish Owlio website** and confirm the first run succeeds.
5. Confirm the landing page, Terms and Privacy Notice at `https://theshubzworld.github.io/OwliO/`.

Later pushes that change `docs/` or the Pages workflow automatically rebuild the site. The Pages workflow reads only the `docs/` website and policy files.

## Publish a Windows release

1. Set the repository to public only after reviewing the source, licence notices, policy text and public-facing contact address.
2. Build the installer from a clean checkout with the intended public cloud configuration. Do not commit `cloud-config.json`, API keys, signing credentials or database credentials. Follow [the Windows installer guide](development.md#windows-installer) and [account service setup](accounts-analytics.md).
3. Verify the installer version, Windows x64 target, required login and current legal documents. Compute a SHA-256 checksum for the final `.exe`.
4. In **GitHub → Releases → Draft a new release**, create the matching version tag (for example `v1.0.23`) from `main`.
5. Attach `Owlio-Setup-<version>.exe` and paste its SHA-256 checksum into the release notes. Add a concise user-facing summary, supported Windows platform, sign-in/terms requirement, and known issues.
6. Publish the release. The landing-page download button resolves to GitHub's latest published release automatically.

The current installer is unsigned, so Windows may show a SmartScreen prompt. Do not describe the app as signed unless a valid code-signing certificate was used and the published installer was verified.

## Suggested release notes

```markdown
## Owlio <version>

### Highlights
- ...

### Requirements
- Windows x64
- Owlio account, current Terms and Privacy Notice acceptance, and required basic usage reporting

### Download
- `Owlio-Setup-<version>.exe` — SHA-256: `<checksum>`

### Notes
- Installer is unsigned; Windows SmartScreen may display a prompt.
- Local speech models are downloaded after installation.
```

Keep release notes factual and list user-visible changes. Avoid publishing account data, secrets, local paths, debug logs or unreviewed policy drafts.
