const HALF = 2147483648, QUARTER = 1073741824, THREE_QUARTERS = 3221225472, TOTAL = 32768;
export function encodeArithmetic(input, cdf) {
  let low = 0, high = 4294967295, pending = 0, previous = 0, byte = 0, bits = 0;
  const output = [];
  const bit = value => { byte = byte * 2 + value; if (++bits === 8) { output.push(byte); bits = byte = 0; } };
  const emit = value => { bit(value); while (pending) { bit(1 - value); pending--; } };
  for (const symbol of input) {
    const offset = previous * 257, range = high - low + 1;
    high = low + Math.floor(range * cdf[offset + symbol + 1] / TOTAL) - 1;
    low += Math.floor(range * cdf[offset + symbol] / TOTAL);
    for (;;) {
      if (high < HALF) emit(0);
      else if (low >= HALF) { emit(1); low -= HALF; high -= HALF; }
      else if (low >= QUARTER && high < THREE_QUARTERS) { pending++; low -= QUARTER; high -= QUARTER; }
      else break;
      low *= 2; high = high * 2 + 1;
    }
    previous = symbol;
  }
  pending++; emit(low < QUARTER ? 0 : 1);
  if (bits) output.push(byte * 2 ** (8 - bits));
  return Uint8Array.from(output);
}
export function decodeArithmetic(input, cdf, size) {
  const HALF = 2147483648, QUARTER = 1073741824, THREE_QUARTERS = 3221225472, TOTAL = 32768;
  if (cdf.length !== 256 * 257 || !Number.isSafeInteger(size) || size < 0 || size > 32_000_000) throw Error('Invalid model or output size');
  for (let row = 0; row < 256; row++) {
    if (cdf[row * 257] !== 0 || cdf[row * 257 + 256] !== TOTAL) throw Error('Invalid model endpoints');
    for (let i = 0; i < 256; i++) if (cdf[row * 257 + i] >= cdf[row * 257 + i + 1]) throw Error('Invalid model CDF');
  }
  let position = 0, low = 0, high = 4294967295, code = 0, previous = 0;
  const bit = () => { const value = position < input.length * 8 ? (input[position >>> 3] >>> (7 - position % 8)) & 1 : 0; position++; return value; };
  for (let i = 0; i < 32; i++) code = code * 2 + bit();
  const output = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const offset = previous * 257, range = high - low + 1;
    const scaled = Math.floor(((code - low + 1) * TOTAL - 1) / range);
    let left = 0, right = 256;
    while (left + 1 < right) { const middle = (left + right) >>> 1; if (cdf[offset + middle] <= scaled) left = middle; else right = middle; }
    output[i] = left;
    high = low + Math.floor(range * cdf[offset + left + 1] / TOTAL) - 1;
    low += Math.floor(range * cdf[offset + left] / TOTAL);
    for (;;) {
      if (high < HALF) { /* No interval offset. */ }
      else if (low >= HALF) { low -= HALF; high -= HALF; code -= HALF; }
      else if (low >= QUARTER && high < THREE_QUARTERS) { low -= QUARTER; high -= QUARTER; code -= QUARTER; }
      else break;
      low *= 2; high = high * 2 + 1; code = code * 2 + bit();
    }
    previous = left;
  }
  return output;
}
export function createLearnedReader(decode, modelBase64, packedBase64, layout, size, checksum) {
  let values;
  const from64 = text => typeof Uint8Array.fromBase64 === 'function' ? Uint8Array.fromBase64(text) : Uint8Array.from(atob(text), c => c.charCodeAt(0));
  return index => {
    if (!Number.isInteger(index) || index < 0 || index >= (values?.length ?? layout.length)) throw Error('Invalid asset index');
    if (!values) {
      const model = from64(modelBase64), bytes = decode(from64(packedBase64), new Uint16Array(model.buffer), size);
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) { let entry = i; for (let j = 0; j < 8; j++) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1; table[i] = entry; }
      let crc = -1; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
      if (((crc ^ -1) >>> 0) !== checksum) throw Error('Learned asset checksum mismatch');
      let offset = 0; values = [];
      for (const [kind, length] of layout) {
        const part = bytes.subarray(offset, offset + length); offset += length;
        if (kind === 2) values.push(URL.createObjectURL(new Blob([part], { type: 'application/wasm' })));
        else if (kind === 0) values.push(new TextDecoder('utf-8', { fatal: true }).decode(part));
        else if (kind === 1) { if (typeof part.toBase64 === 'function') { values.push(part.toBase64()); continue; } const pieces = []; for (let i = 0; i < part.length; i += 32768) pieces.push(String.fromCharCode(...part.subarray(i, i + 32768))); values.push(btoa(pieces.join(''))); }
        else throw Error('Invalid asset kind');
      }
      if (offset !== bytes.length) throw Error('Invalid asset layout');
      modelBase64 = packedBase64 = ''; layout = [];
    }
    return values[index];
  };
}
