async function w(i) {
  const l = i instanceof WebAssembly.Module ? i : await WebAssembly.compile(i);
  let o, a;
  const c = () => {
    throw new Error("Format detector trapped.");
  }, f = {
    filens: {
      read_at(r, n, e) {
        const t = r >>> 0, s = a.subarray(t, t + (e >>> 0));
        return new Uint8Array(o.buffer, n >>> 0, s.length).set(s), s.length;
      }
    },
    wasi_snapshot_preview1: {
      // The detector never writes stdio; these are Rust panic/abort paths only.
      fd_write: c,
      proc_exit: c,
      environ_sizes_get(r, n) {
        const e = new DataView(o.buffer);
        return e.setUint32(r >>> 0, 0, !0), e.setUint32(n >>> 0, 0, !0), 0;
      },
      environ_get() {
        return 0;
      },
      random_get(r, n) {
        const e = new Uint8Array(o.buffer, r >>> 0, n >>> 0);
        for (let t = 0; t < e.length; t += 65536)
          globalThis.crypto.getRandomValues(e.subarray(t, t + 65536));
        return 0;
      }
    }
  }, u = await WebAssembly.instantiate(l, f);
  o = u.exports.memory;
  const y = u.exports.filens_detect, b = new TextDecoder();
  return {
    detect(r) {
      if (r.byteLength > 4294967295) throw new RangeError("Format detection source exceeds 4 GiB.");
      if (a) throw new Error("Format detector cannot be called reentrantly.");
      a = r;
      try {
        const n = y(r.byteLength) >>> 0;
        if (!n) throw new Error("Format detection failed to read its source.");
        const e = new DataView(o.buffer, n, 40), t = (s) => {
          const d = e.getUint32(s + 4, !0);
          return d ? b.decode(new Uint8Array(o.buffer, e.getUint32(s, !0), d)) : null;
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
      return o.buffer.byteLength;
    }
  };
}
export {
  w as createFormatDetector
};
