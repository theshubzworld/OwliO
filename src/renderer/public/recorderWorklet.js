// Own implementation: 40 ms PCM packets at 16 kHz, silent output, session-tagged flushing.
class OwlioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.id = null;
    this.buffer = new Float32Array(640);
    this.length = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.id = data.id;
        this.length = 0;
        this.port.postMessage({ type: 'started', id: this.id });
      } else if (data.type === 'stop' && data.id === this.id) {
        this.flush();
        this.port.postMessage({ type: 'done', id: this.id });
        this.id = null;
      }
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({ type: 'chunk', id: this.id, samples }, [samples.buffer]);
    this.length = 0;
  }
  process(inputs, outputs) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    const input = inputs[0]?.[0];
    if (this.id !== null && input) {
      for (let offset = 0; offset < input.length;) {
        const count = Math.min(input.length - offset, this.buffer.length - this.length);
        this.buffer.set(input.subarray(offset, offset + count), this.length);
        this.length += count;
        offset += count;
        if (this.length === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('owlio-recorder', OwlioRecorderProcessor);
