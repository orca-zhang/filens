/** Optional research binding. Format parsing lives in the shared WASM core. */
export interface FormatDetection {
  format: string | null;
  container: string | null;
  evidence: string;
  reason: string;
  bytesRead: number;
  fileBytes: number;
}

export async function createFormatDetector(wasm: BufferSource | WebAssembly.Module) {
  const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
  let memory: WebAssembly.Memory;
  let source: Uint8Array | undefined;
  const trapped = () => { throw new Error('Format detector trapped.'); };
  const imports = {
    filens: {
      read_at(offset: number, target: number, length: number) {
        const start = offset >>> 0;
        const bytes = source!.subarray(start, start + (length >>> 0));
        new Uint8Array(memory.buffer, target >>> 0, bytes.length).set(bytes);
        return bytes.length;
      }
    },
    wasi_snapshot_preview1: {
      // The detector never writes stdio; these are Rust panic/abort paths only.
      fd_write: trapped,
      proc_exit: trapped,
      environ_sizes_get(count: number, size: number) {
        const view = new DataView(memory.buffer);
        view.setUint32(count >>> 0, 0, true);
        view.setUint32(size >>> 0, 0, true);
        return 0;
      },
      environ_get() { return 0; },
      random_get(pointer: number, length: number) {
        const bytes = new Uint8Array(memory.buffer, pointer >>> 0, length >>> 0);
        // WASI requests here are small hash-map seeds; chunk for the Web Crypto limit.
        for (let start = 0; start < bytes.length; start += 65536) {
          globalThis.crypto.getRandomValues(bytes.subarray(start, start + 65536));
        }
        return 0;
      },
    }
  };
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory as WebAssembly.Memory;
  const detect = instance.exports.filens_detect as (size: number) => number;
  if (!(memory instanceof WebAssembly.Memory) || typeof detect !== 'function') {
    throw new TypeError('Invalid format detector WASM exports.');
  }
  const decoder = new TextDecoder();
  return {
    detect(bytes: Uint8Array): FormatDetection {
      if (bytes.byteLength > 0xffff_ffff) throw new RangeError('Format detection source exceeds 4 GiB.');
      if (source) throw new Error('Format detector cannot be called reentrantly.');
      source = bytes;
      try {
        const pointer = detect(bytes.byteLength) >>> 0;
        if (!pointer) throw new Error('Format detection failed to read its source.');
        const record = new DataView(memory.buffer, pointer, 40);
        const string = (offset: number) => {
          const length = record.getUint32(offset + 4, true);
          return length ? decoder.decode(new Uint8Array(memory.buffer, record.getUint32(offset, true), length)) : null;
        };
        return { format: string(0), container: string(8), evidence: string(16)!, reason: string(24)!,
          bytesRead: record.getUint32(32, true), fileBytes: record.getUint32(36, true) };
      } finally {
        source = undefined;
      }
    },
    /** Diagnostics only; sampled bytes rather than whole files enter WASM memory. */
    get memoryBytes() { return memory.buffer.byteLength; }
  };
}
