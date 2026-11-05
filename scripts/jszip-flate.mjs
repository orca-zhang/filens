// Only JSZip's raw encoder is adapted. Its decoder and error semantics stay
// with the same inflate-only pako module used by TIFF.
import { Deflate as FflateDeflate } from 'fflate';
import pakoInflate from 'pako/lib/inflate.js';

export const Inflate = pakoInflate.Inflate;
export class Deflate {
  constructor(options = {}) {
    // Preserve JSZip's existing default for level 0 and negative levels.
    this.codec = new FflateDeflate(options.level > 0 ? { level: options.level } : {}, bytes => {
      if (bytes.length) this.onData(bytes);
    });
  }

  push(bytes, final) {
    this.codec.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), final);
  }
}
