async function w(i) {
  const f = i instanceof WebAssembly.Module ? i : await WebAssembly.compile(i);
  let n, a;
  const c = () => {
    throw new Error("Format detector trapped.");
  }, y = {
    filens: {
      read_at(r, o, e) {
        const t = r >>> 0, s = a.subarray(t, t + (e >>> 0));
        return new Uint8Array(n.buffer, o >>> 0, s.length).set(s), s.length;
      }
    },
    wasi_snapshot_preview1: {
      // The detector never writes stdio; these are Rust panic/abort paths only.
      fd_write: c,
      proc_exit: c,
      environ_sizes_get(r, o) {
        const e = new DataView(n.buffer);
        return e.setUint32(r >>> 0, 0, !0), e.setUint32(o >>> 0, 0, !0), 0;
      },
      environ_get() {
        return 0;
      },
      random_get(r, o) {
        const e = new Uint8Array(n.buffer, r >>> 0, o >>> 0);
        for (let t = 0; t < e.length; t += 65536)
          globalThis.crypto.getRandomValues(e.subarray(t, t + 65536));
        return 0;
      }
    }
  }, u = await WebAssembly.instantiate(f, y);
  n = u.exports.memory;
  const d = u.exports.filens_detect;
  if (!(n instanceof WebAssembly.Memory) || typeof d != "function")
    throw new TypeError("Invalid format detector WASM exports.");
  const b = new TextDecoder();
  return {
    detect(r) {
      if (r.byteLength > 4294967295) throw new RangeError("Format detection source exceeds 4 GiB.");
      if (a) throw new Error("Format detector cannot be called reentrantly.");
      a = r;
      try {
        const o = d(r.byteLength) >>> 0;
        if (!o) throw new Error("Format detection failed to read its source.");
        const e = new DataView(n.buffer, o, 40), t = (s) => {
          const l = e.getUint32(s + 4, !0);
          return l ? b.decode(new Uint8Array(n.buffer, e.getUint32(s, !0), l)) : null;
        };
        return {
          format: t(0),
          container: t(8),
          evidence: t(16),
          reason: t(24),
          bytesRead: e.getUint32(32, !0),
          fileBytes: e.getUint32(36, !0)
        };
      } finally {
        a = void 0;
      }
    },
    /** Diagnostics only; sampled bytes rather than whole files enter WASM memory. */
    get memoryBytes() {
      return n.buffer.byteLength;
    }
  };
}
export {
  w as createFormatDetector
};
