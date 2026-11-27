/// <reference types="vite/client" />
import decoder from '../vendor/libeot/libeot.wasm?url&inline';

export async function decompressMtxFont(payload: Uint8Array, encrypted: boolean, signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (signal.aborted) return undefined;
  // WebKit may still be fetching the Blob after the Worker constructor returns.
  const url = URL.createObjectURL(new Blob([`(${startDecoder.toString()})();`], { type: 'text/javascript' }));
  let worker: Worker | undefined;
  try {
    const decoderWorker = worker = new Worker(url);
    return await new Promise<Uint8Array | undefined>(resolve => {
      const finish = (data?: ArrayBuffer) => {
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
        resolve(data ? new Uint8Array(data) : undefined);
      };
      const abort = () => finish();
      const deadline = setTimeout(abort, 5000);
      signal.addEventListener('abort', abort, { once: true });
      decoderWorker.onmessage = ({ data }) => finish(data instanceof ArrayBuffer ? data : undefined);
      decoderWorker.onerror = event => { event.preventDefault(); finish(); };
      try {
        const source = Uint8Array.from(payload).buffer;
        decoderWorker.postMessage({ source, encrypted, decoder }, [source]);
      } catch { finish(); }
    });
  } finally {
    worker?.terminate();
    URL.revokeObjectURL(url);
  }
}

interface Decoder extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(length: number): number;
  decode(address: number, length: number, encrypted: number): number;
  decoded_size(): number;
}

// Serialized into a classic worker, so all runtime inputs arrive in its message.
function startDecoder() {
  self.onmessage = async ({ data }: MessageEvent<{ source: ArrayBuffer; encrypted: boolean; decoder: string }>) => {
    try {
      const wasm = Uint8Array.from(atob(data.decoder.slice(data.decoder.indexOf(',') + 1)), char => char.charCodeAt(0));
      let memory: WebAssembly.Memory;
      const unavailable = () => 52; // No WASI files or streams are available to the decoder.
      const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: {
        fd_close: unavailable, fd_seek: unavailable, fd_write: unavailable,
        random_get(address: number, length: number) {
          crypto.getRandomValues(new Uint8Array(memory.buffer, address, length));
          return 0;
        }
      } });
      const lib = instance.exports as Decoder;
      memory = lib.memory;
      lib._initialize();
      const address = lib.malloc(data.source.byteLength);
      if (!address) throw new Error('Embedded font allocation failed.');
      new Uint8Array(memory.buffer, address, data.source.byteLength).set(new Uint8Array(data.source));
      const output = lib.decode(address, data.source.byteLength, Number(data.encrypted));
      if (!output) throw new Error('Embedded font decoding failed.');
      const bytes = new Uint8Array(memory.buffer, output, lib.decoded_size()).slice().buffer;
      self.postMessage(bytes, { transfer: [bytes] });
    } catch { self.postMessage(null); }
  };
}
