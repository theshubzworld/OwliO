const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited with ${result.status}`);
}

(async () => {
  if (process.platform !== 'win32') throw Error('Build the Windows installer on Windows.');
  if (!process.env.npm_execpath) throw Error('Run npm run package from the project folder.');
  const output = path.join(root, 'release-artifacts', pkg.version);
  const installer = path.join(output, `Owlio-Setup-${pkg.version}.exe`);
  if (fs.existsSync(installer)) throw Error(`Installer already exists: ${installer}. Increase package.json version before packaging; existing installers will not be overwritten.`);
  const npm = script => run(process.execPath, [process.env.npm_execpath, 'run', script]);
  npm('typecheck');
  npm('build:main');
  const legal = require('../dist/shared/legal');
  if (!legal.LEGAL_REVIEWED || /draft/i.test(legal.TERMS_VERSION + legal.PRIVACY_VERSION)) throw Error('Terms of Use and Privacy Notice are drafts awaiting owner review. Review docs/legal before building a public installer.');
  // Never overwrite the helper executable that a running development app is using.
  const helper = path.join(root, 'release-artifacts', 'helper-build');
  run('dotnet', ['publish', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-o', helper], path.join(root, 'windows-helper'));
  npm('build:renderer');
  // Reject private keys or extra fields before cloud config enters an installer.
  const cloudConfig=path.join(root,'cloud-config.json');
  if(!fs.existsSync(cloudConfig)) throw Error('The official app requires cloud-config.json for mandatory sign-in.');
  require('../dist/main/cloudConfig').validateCloudConfig(JSON.parse(fs.readFileSync(cloudConfig,'utf8')));
  const files = await build({ projectDir: root, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
    config: { ...pkg.build, directories: { ...pkg.build.directories, output }, electronDist: path.join(root, 'node_modules/electron/dist'),
      extraResources: pkg.build.extraResources.filter(resource => resource.to !== 'windows-helper'),
      afterPack: async context => {
        // Serialize native-helper copies; retry transient Windows DLL scan/lock errors.
        const destination = path.join(context.appOutDir, 'resources/windows-helper');
        for (let attempt = 0; ; attempt++) {
          try { fs.cpSync(helper, destination, { recursive: true, force: true }); break; }
          catch (error) {
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } } });
  if (!fs.existsSync(installer)) throw Error('Installer was not produced.');
  console.log('Packaged:', files.join('\n'));
})().catch(error => { console.error(error.message); process.exit(1); });
