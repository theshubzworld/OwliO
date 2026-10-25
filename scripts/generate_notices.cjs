// Writes THIRD-PARTY-NOTICES.txt for the JavaScript and .NET code that ships inside the installer.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

// Bundled into the renderer by Vite, so they are not production npm dependencies.
const rendererPackages = ['react', 'react-dom', 'scheduler', 'lucide-react'];

function productionPackages() {
  const npm = process.env.npm_execpath;
  const args = ['ls', '--omit=dev', '--all', '--parseable'];
  const output = npm
    ? execFileSync(process.execPath, [npm, ...args], { cwd: root, encoding: 'utf8' })
    : execFileSync('npm', args, { cwd: root, encoding: 'utf8', shell: true });
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line.includes('node_modules'))
    .map(line => line.split(/node_modules[\\/]/).pop().replace(/\\/g, '/'));
}

function licenseText(dir) {
  const file = fs.readdirSync(dir).find(name => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(name));
  if (!file) throw Error(`No license file found for ${dir}. Add its notice manually before packaging.`);
  return fs.readFileSync(path.join(dir, file), 'utf8').trim();
}

const names = [...new Set([...rendererPackages, ...productionPackages()])].sort();
const sections = names.map(name => {
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  return `${pkg.name} ${pkg.version} (${pkg.license})\n${'-'.repeat(72)}\n${licenseText(dir)}`;
});

const header = `Owlio third-party notices
${'='.repeat(72)}

Owlio is licensed under the MIT License (see LICENSE.txt). The installer also
contains the third-party software listed below, which keeps its own license.

- Electron and Chromium: see LICENSE.electron.txt and LICENSES.chromium.html in
  the Owlio installation folder.
- .NET 8 runtime (self-contained in resources/windows-helper): Copyright (c)
  .NET Foundation and Contributors, MIT License. Notices for its components:
  https://github.com/dotnet/runtime/blob/main/THIRD-PARTY-NOTICES.TXT
- Bodhan Flex inference code (resources/speech/vendor/bodhan_flex): Apache
  License 2.0, see LICENSE-APACHE-2.0.txt and NOTICE.md in that folder.
- Speech model weights and Python libraries are downloaded after installation
  and keep their own licenses. See docs/speech-model-notices.md in the source
  repository: https://github.com/theshubzworld/OwliO

JavaScript packages
${'='.repeat(72)}`;

fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), `${header}\n\n${sections.join('\n\n\n')}\n`);
console.log(`Wrote THIRD-PARTY-NOTICES.txt (${names.length} packages).`);
