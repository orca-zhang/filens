import { gunzipSync } from 'fflate';

const maxInputBytes = 8 * 1024 * 1024;
const timeoutMs = 5000;
let modulePromise: Promise<WebAssembly.Module> | undefined;

async function loadMetafileModule(): Promise<WebAssembly.Module> {
  const { default: asset } = await import('./metafile-asset');
  const location = asset as string | (() => string);
  const response = await fetch(typeof location === 'function' ? location() : location);
  if (!response.ok) throw new Error('Could not load the metafile decoder.');
  const bytes = await response.arrayBuffer();
  return WebAssembly.compile(response.headers.get('content-type')?.split(';', 1)[0] === 'application/wasm+gzip'
    ? gunzipSync(new Uint8Array(bytes)) as Uint8Array<ArrayBuffer> : bytes);
}

interface DecoderExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  reserve_input(size: number): number;
  render_svg(): number;
  output_size(): number;
}

// This function is also serialized into the worker.
function convert(module: WebAssembly.Module, source: ArrayBuffer): ArrayBuffer | undefined {
  const wasm = new WebAssembly.Instance(module).exports as DecoderExports;
  const input = wasm.reserve_input(source.byteLength);
  if (!input) return undefined;
  new Uint8Array(wasm.memory.buffer, input, source.byteLength).set(new Uint8Array(source));
  const pointer = wasm.render_svg();
  if (pointer) return wasm.memory.buffer.slice(pointer, pointer + wasm.output_size()) as ArrayBuffer;
}

function runWorker(decode: typeof convert): void {
  self.onmessage = ({ data }: MessageEvent<{ module: WebAssembly.Module; source: ArrayBuffer }>) => {
    let image: ArrayBuffer | undefined;
    try { image = decode(data.module, data.source); } catch { /* A failed image has no preview. */ }
    self.postMessage(image, { transfer: image ? [image] : [] });
  };
}

/** One worker per document. The caller submits each distinct package part once. */
export function createMetafileDecoder(signal?: AbortSignal) {
  let worker: Worker | undefined;
  let workerUrl: string | undefined;
  let closed = false;
  const destroy = () => {
    closed = true;
    worker?.terminate();
    worker = undefined;
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = undefined;
  };
  return {
    destroy,
    async render(source: Uint8Array): Promise<Uint8Array | undefined> {
      if (closed || signal?.aborted || source.byteLength > maxInputBytes) return undefined;
      try {
        modulePromise ??= loadMetafileModule().catch(error => {
          modulePromise = undefined;
          throw error;
        });
        const module = await modulePromise;
        if (closed || signal?.aborted) return undefined;
        const bytes = Uint8Array.from(source).buffer;
        if (typeof Worker === 'undefined') {
          const image = convert(module, bytes);
          return image ? new Uint8Array(image) : undefined;
        }
        if (!worker) {
          workerUrl = URL.createObjectURL(new Blob([`(${runWorker.toString()})(${convert.toString()});`], { type: 'text/javascript' }));
          worker = new Worker(workerUrl);
        }
        const decoder = worker;
        return await new Promise(resolve => {
          const finish = (image?: ArrayBuffer) => {
            clearTimeout(deadline);
            signal?.removeEventListener('abort', cancel);
            decoder.onmessage = decoder.onerror = decoder.onmessageerror = null;
            resolve(image ? new Uint8Array(image) : undefined);
          };
          const cancel = () => { destroy(); finish(); };
          const deadline = setTimeout(cancel, timeoutMs);
          signal?.addEventListener('abort', cancel, { once: true });
          decoder.onmessage = ({ data }) => finish(data instanceof ArrayBuffer ? data : undefined);
          decoder.onerror = event => { event.preventDefault(); cancel(); };
          decoder.onmessageerror = cancel;
          try { decoder.postMessage({ module, source: bytes }, [bytes]); }
          catch { cancel(); }
        });
      } catch {
        destroy();
        return undefined;
      }
    }
  };
}
