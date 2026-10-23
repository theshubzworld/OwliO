import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { isolatedPythonEnvironment } from './localSetup';

type Settings = { provider: string; localSttUrl: string; localSttModel: string };
type Options = { packaged: boolean; profile: string; resources: string; speechDirectory?: string };

export function managedSpeechUrl(settings: Settings): URL | undefined {
  if (settings.provider !== 'local') return;
  const url = new URL(settings.localSttUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/v1') return;
  return new URL('/v1/models', url);
}

export class SpeechServer {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private stopping = false;
  constructor(private options: Options) {}

  async ensure(settings: Settings): Promise<void> {
    if (this.stopping) return;
    if (!this.options.packaged) {
      try { if (!JSON.parse(fs.readFileSync(path.join(this.options.profile,'speech-runtime.json'),'utf8')).managed) return; }
      catch { return; }
    }
    const url = managedSpeechUrl(settings);
    if (!url) return;
    if (this.starting) return this.starting;
    this.starting = this.start(url, settings).finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async online(url: URL): Promise<boolean> {
    let response: Response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(1500) }); }
    catch { return false; }
    if (!response.ok) throw new Error('Another service occupies the configured speech address. Change the address in Advanced settings.');
    const data = await response.json() as { service?: string };
    if (data.service !== 'Owlio') throw new Error('The configured address is not the Owlio speech server. Change the address in Advanced settings.');
    return true;
  }

  private async start(url: URL, settings: Settings): Promise<void> {
    if (await this.online(url) || this.stopping) return;
    const configPath = path.join(this.options.profile, 'speech-runtime.json');
    if (!fs.existsSync(configPath)) throw new Error('Local speech needs setup. Open Settings → Local speech setup to download Python, speech libraries and a model.');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { python?: string; models?: string; device?: string; managed?: boolean };
    if (!config.python || !path.isAbsolute(config.python) || !fs.existsSync(config.python)) throw new Error('Your local Python runtime is missing. Open Settings → Local speech setup and repair it.');
    if (!config.models || !path.isAbsolute(config.models) || !fs.existsSync(config.models)) throw new Error('Your model folder is missing. Open Settings → Local speech setup and download a model.');
    const directory = this.options.speechDirectory || path.join(this.options.resources, 'speech');
    const script = path.join(directory, 'server.py');
    if (!fs.existsSync(script)) throw new Error('The installed speech server is missing. Reinstall Owlio.');
    let startupError: Error | undefined;
    if (!this.child) {
      const log = fs.openSync(path.join(this.options.profile, 'speech-server.log'), 'a');
      try {
        const child = spawn(config.python, [script], {
          cwd: directory, windowsHide: true, stdio: ['ignore', log, log],
          env: { ...(config.managed ? isolatedPythonEnvironment() : process.env), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', OWLIO_MODEL_CACHE: config.models, WHISPER_MODEL: settings.localSttModel, WHISPER_DEVICE: config.device || 'auto', PORT: url.port || '80' },
        });
        this.child = child;
        child.once('error', error => { startupError = error; if (this.child === child) this.child = undefined; });
        child.once('exit', code => { startupError = new Error(`Local speech server stopped (${code}). See speech-server.log in the Owlio settings folder.`); if (this.child === child) this.child = undefined; });
      } finally { fs.closeSync(log); }
    }
    const deadline = Date.now() + 120000;
    while (!this.stopping && Date.now() < deadline) {
      if (startupError) throw startupError;
      if (await this.online(url)) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!this.stopping) throw new Error('Local speech server did not start. See speech-server.log in the Owlio settings folder.');
  }

  async reload(): Promise<void> {
    await this.starting?.catch(()=>{});
    const child=this.child;this.child=undefined;
    if(!child?.pid)return;
    await new Promise<void>(resolve=>{
      const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('close',()=>resolve());killer.once('error',()=>{child.kill();resolve();});
    });
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    if (!child?.pid) return;
    // The Windows venv launcher can create a second Python process. Stop only our own tree.
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { child.kill(); });
    } else child.kill();
  }
}
