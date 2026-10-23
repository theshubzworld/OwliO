# Releasing Owlio

## Publish the website

1. Enable GitHub Pages with **GitHub Actions** as the deployment source.
2. Push an update to `main` that changes `docs/` or `.github/workflows/pages.yml`.
3. Confirm the **Publish Owlio website** workflow completes and review the deployed site, Terms, and Privacy Notice.

## Publish a Windows release

1. Update the version in `package.json` and `package-lock.json`.
2. On Windows x64, prepare the private `cloud-config.json` locally and run `npm ci` followed by `npm run package`.
3. Confirm the installer version and target, then compute its SHA-256 checksum.
4. Create a GitHub Release for the matching `v<version>` tag from `main`.
5. Attach `Owlio-Setup-<version>.exe` and include the checksum, supported Windows platform, sign-in and terms requirements, and a concise summary.
6. Publish the release and verify the download link.

The installer is currently unsigned. Do not describe it as signed unless a valid signing certificate was used and the published installer was verified.
