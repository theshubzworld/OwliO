export interface AudioRecordResult {
  buffer: ArrayBuffer;
  durationSeconds: number;
  isTooShort: boolean;
  audioUrl?: string;
}

export interface RecordingStartupTiming {
  engineReadyMs: number;
  microphoneReadyMs: number;
  captureReadyMs: number;
  firstChunkMs?: number;
}

export interface AudioRecorderOptions {
  deviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface AudioMetrics {
  volume: number;
  rms: number;
  peak: number;
  db: number;
}

type Capture = { id: number; stream: MediaStream; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; buffers: Float32Array[]; totalSamples: number; pendingSamples: number; limitNotified: boolean; requestedAt: number; timing: RecordingStartupTiming; ready: boolean };

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private recorderNode: AudioWorkletNode | null = null;
  private enginePromise: Promise<void> | null = null;
  private capture: Capture | null = null;
  private stopping: Promise<AudioRecordResult> | null = null;
  private animationFrameId: number | null = null;
  private operation = 0;
  private disposed = false;
  private commands = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  public onVolumeChange: ((volume: number) => void) | null = null;
  public onAudioMetrics: ((metrics: AudioMetrics) => void) | null = null;
  public onMicrophoneChange: ((label: string) => void) | null = null;
  public onInputEnded: (() => void) | null = null;
  public onStartupTiming: ((timing: RecordingStartupTiming) => void) | null = null;
  public chunkSeconds = 0;
  public maxDurationSeconds = 720;
  public onChunk: ((buffer: ArrayBuffer) => void) | null = null;
  public onDurationLimit: (() => void) | null = null;

  constructor(private workletUrl = './recorderWorklet.js') {}

  // Prepare only the audio engine. No microphone permission or capture occurs here.
  public async prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Recorder is closed'));
    if (this.enginePromise && this.audioContext?.state !== 'closed') return this.enginePromise;
    const context = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
    this.audioContext = context;
    this.enginePromise = (async () => {
      try {
        await context.audioWorklet.addModule(this.workletUrl);
        if (this.disposed) throw new Error('Recorder is closed');
        const node = new AudioWorkletNode(context, 'owlio-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = event => {
          const message = event.data;
          const capture = this.capture;
          if (message.type === 'chunk' && capture && capture.id === message.id && message.samples instanceof Float32Array) {
            let offset = 0;
            while (offset < message.samples.length && capture.totalSamples < this.maxDurationSeconds * 16000) {
              const remaining = this.chunkSeconds ? this.chunkSeconds * 16000 - capture.pendingSamples : message.samples.length;
              const count = Math.min(remaining, message.samples.length - offset, this.maxDurationSeconds * 16000 - capture.totalSamples);
              capture.buffers.push(message.samples.slice(offset, offset + count));
              capture.pendingSamples += count; capture.totalSamples += count; offset += count;
              if (this.chunkSeconds && capture.pendingSamples >= this.chunkSeconds * 16000) {
                const buffer = this.exportWAV(16000, capture.buffers, true);
                capture.buffers = []; capture.pendingSamples = 0;
                this.onChunk?.(buffer);
              }
            }
            if (capture.totalSamples >= this.maxDurationSeconds * 16000 && !capture.limitNotified) {
              capture.limitNotified = true;
              void Promise.resolve().then(() => this.onDurationLimit?.());
            }
            if (capture.timing.firstChunkMs === undefined) {
              capture.timing.firstChunkMs = performance.now() - capture.requestedAt;
              this.onStartupTiming?.({ ...capture.timing });
            }
          } else {
            const key = `${message.id}:${message.type}`;
            const command = this.commands.get(key);
            if (command) { clearTimeout(command.timer); this.commands.delete(key); command.resolve(); }
          }
        };
        node.connect(context.destination);
        // The worklet outputs silence; keeping the engine ready never plays the mic.
        this.recorderNode = node;
      } catch (error) {
        if (context.state !== 'closed') await context.close().catch(() => {});
        if (this.audioContext === context) { this.audioContext = null; this.enginePromise = null; }
        throw error;
      }
    })();
    return this.enginePromise;
  }

  private command(type: 'start' | 'stop', id: number): Promise<void> {
    const key = `${id}:${type === 'start' ? 'started' : 'done'}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.commands.delete(key); reject(new Error('Audio engine did not respond. Please retry dictation.')); }, 1500);
      this.commands.set(key, { resolve, reject, timer });
      this.recorderNode!.port.postMessage({ type, id });
    });
  }

  public async start(options?: string | AudioRecorderOptions): Promise<void> {
    if (this.disposed) throw new Error('Recorder is closed');
    if (this.capture && !this.stopping) throw new Error('Recording is already active');
    const operation = ++this.operation;
    const requestedAt = performance.now();
    if (this.stopping) await this.stopping;
    if (operation !== this.operation) throw new DOMException('Recording was cancelled', 'AbortError');
    if (this.capture) throw new Error('Recording is already active');
    const deviceId = typeof options === 'string' ? options : options?.deviceId;
    const echoCancellation = typeof options === 'object' && options?.echoCancellation !== undefined ? options.echoCancellation : true;
    const noiseSuppression = typeof options === 'object' && options?.noiseSuppression !== undefined ? options.noiseSuppression : true;
    const autoGainControl = typeof options === 'object' && options?.autoGainControl !== undefined ? options.autoGainControl : true;

    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const timing: RecordingStartupTiming = { engineReadyMs: 0, microphoneReadyMs: 0, captureReadyMs: 0 };
    try {
      const engine = this.prepare().then(() => { timing.engineReadyMs = performance.now() - requestedAt; });
      const audio: MediaTrackConstraints = { channelCount: 1, sampleRate: 16000, echoCancellation, noiseSuppression, autoGainControl };
      if (deviceId && deviceId !== 'default') audio.deviceId = deviceId === 'communications' ? { ideal: deviceId } : { exact: deviceId };
      const request = async () => {
        try { return await navigator.mediaDevices.getUserMedia({ audio }); }
        catch (error) {
          if (expired || operation !== this.operation) throw new DOMException('Recording was cancelled', 'AbortError');
          if (!deviceId || !['NotFoundError', 'OverconstrainedError', 'NotReadableError', 'AbortError'].includes((error as Error).name)) throw error;
          const { deviceId: _unavailable, ...defaultAudio } = audio;
          return navigator.mediaDevices.getUserMedia({ audio: defaultAudio });
        }
      };
      const media = request().then(result => {
        if (expired || operation !== this.operation) {
          result.getTracks().forEach(track => track.stop());
          throw new DOMException('Recording was cancelled', 'AbortError');
        }
        stream = result;
        timing.microphoneReadyMs = performance.now() - requestedAt;
      });
      await Promise.race([
        Promise.all([engine, media]),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { expired = true; reject(new Error('Microphone permission timed out. Check Windows microphone access.')); }, 8000); }),
      ]);
      clearTimeout(timeout);
      if (operation !== this.operation) throw new DOMException('Recording was cancelled', 'AbortError');
      const acquired = stream as unknown as MediaStream;
      const track = acquired.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('Microphone disconnected. Retry with the current microphone.');
      const context = this.audioContext!;
      if (context.state === 'suspended') await context.resume();
      if (operation !== this.operation) throw new DOMException('Recording was cancelled', 'AbortError');
      source = context.createMediaStreamSource(acquired);
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyser.connect(this.recorderNode!);
      this.capture = { id: operation, stream: acquired, source, analyser, buffers: [], totalSamples: 0, pendingSamples: 0, limitNotified: false, requestedAt, timing, ready: false };
      track.addEventListener('ended', () => { if (operation === this.operation && this.capture?.ready) this.onInputEnded?.(); });
      await this.command('start', operation);
      if (operation !== this.operation) throw new DOMException('Recording was cancelled', 'AbortError');
      this.capture!.ready = true;
      timing.captureReadyMs = performance.now() - requestedAt;
      this.onMicrophoneChange?.(track.label || 'Windows default microphone');
      this.onStartupTiming?.({ ...timing });
      this.monitorVolume();
    } catch (error) {
      expired = true;
      (stream as MediaStream | null)?.getTracks().forEach(track => track.stop());
      source?.disconnect(); analyser?.disconnect();
      if (this.capture?.id === operation && !this.stopping) this.capture = null;
      throw error;
    } finally { clearTimeout(timeout); }
  }

  private monitorVolume(): void {
    const capture = this.capture;
    if (!capture?.ready || capture.id !== this.operation) return;
    let volume = 0;
    let rms = 0;
    let peak = 0;
    let db = -100;

    if (typeof capture.analyser.getFloatTimeDomainData === 'function') {
      const timeData = new Float32Array(capture.analyser.fftSize || 256);
      capture.analyser.getFloatTimeDomainData(timeData);
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const val = timeData[i];
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
        sumSquares += val * val;
      }
      rms = Math.sqrt(sumSquares / timeData.length);
      db = 20 * Math.log10(Math.max(1e-5, rms));
      // Map -45 dB (noise floor) to -6 dB (peak speech) to 0.0 .. 1.0
      volume = Math.min(1, Math.max(0, (db - (-45)) / ((-6) - (-45))));
      if (peak > 0.02 && volume < 0.12) {
        volume = Math.min(1, 0.12 + (peak * 0.7));
      }
    } else if (typeof capture.analyser.getByteTimeDomainData === 'function') {
      const data = new Uint8Array(capture.analyser.fftSize || 256);
      capture.analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const norm = (data[i] - 128) / 128;
        const abs = Math.abs(norm);
        if (abs > peak) peak = abs;
        sumSquares += norm * norm;
      }
      rms = Math.sqrt(sumSquares / data.length);
      db = 20 * Math.log10(Math.max(1e-5, rms));
      volume = Math.min(1, Math.max(0, (db - (-45)) / ((-6) - (-45))));
    } else {
      // Test environment fallback
      const data = new Uint8Array(capture.analyser.frequencyBinCount || 32);
      capture.analyser.getByteFrequencyData?.(data);
      const average = data.reduce((sum, value) => sum + value, 0) / (data.length || 1);
      volume = Math.min(1, average / 128);
      rms = volume * 0.1;
      peak = volume;
      db = 20 * Math.log10(Math.max(1e-5, rms));
    }

    this.onVolumeChange?.(volume);
    this.onAudioMetrics?.({ volume, rms, peak, db });
    this.animationFrameId = requestAnimationFrame(() => this.monitorVolume());
  }

  public async stop(): Promise<AudioRecordResult> {
    ++this.operation; // Also cancels a microphone acquisition still in flight.
    if (this.stopping) return this.stopping;
    const capture = this.capture;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    if (!capture) return { buffer: new ArrayBuffer(0), durationSeconds: 0, isTooShort: true };
    capture.stream.getTracks().forEach(track => track.stop());
    capture.source.disconnect(); capture.analyser.disconnect();
    this.stopping = (async () => {
      try {
        // Keep receiving this session's chunks until the worklet flushes its tail.
        await this.command('stop', capture.id);
        const durationSeconds = capture.totalSamples / 16000;
        const buffer = durationSeconds < 0.25 ? new ArrayBuffer(0) : this.exportWAV(16000, capture.buffers, this.chunkSeconds > 0);
        return { buffer, durationSeconds, isTooShort: this.chunkSeconds ? durationSeconds < 0.25 : buffer.byteLength === 0 };
      } finally {
        if (this.capture === capture) this.capture = null;
        this.stopping = null;
      }
    })();
    return this.stopping;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop().catch(() => {});
    await this.enginePromise?.catch(() => {});
    this.recorderNode?.disconnect();
    if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close();
    this.audioContext = null; this.recorderNode = null; this.enginePromise = null;
  }

  private exportWAV(sampleRate: number, buffers: Float32Array[], allowSilence = false): ArrayBuffer {
    let recordedSamples = 0;
    let hasSignal = false;
    for (const buf of buffers) {
      recordedSamples += buf.length;
      if (!hasSignal) {
        for (let i = 0; i < buf.length; i++) {
          if (Math.abs(buf[i]) > 0.005) {
            hasSignal = true;
            break;
          }
        }
      }
    }

    // If microphone didn't record real speech or was muted, return empty buffer
    if (!recordedSamples || (!allowSilence && (recordedSamples < 1600 || !hasSignal))) {
      return new ArrayBuffer(0);
    }

    // Ensure at least 1.0 second of audio (16,000 samples) by padding with silence
    // This satisfies Whisper minimum length requirement when speaking short words
    const minSamples = allowSilence ? 0 : sampleRate; // streaming chunks retain their exact duration
    const totalSamples = Math.max(recordedSamples, minSamples);

    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    // Remaining samples are already 0.0 (silence)

    // Encode PCM 16-bit
    const buffer = new ArrayBuffer(44 + merged.length * 2);
    const view = new DataView(buffer);

    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + merged.length * 2, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, merged.length * 2, true);

    let index = 44;
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      index += 2;
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}
