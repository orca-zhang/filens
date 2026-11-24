// The ABI is pinned to vendor/lzma/build-info.json. This reader contains no
// JavaScript evaluator: only static data is packed; ESM code stays ordinary JS.
export function createGroupedPackedAssetReader(createReader, decoderBase64, groups, mapping) {
  let decoderModule;
  const getDecoderModule = create => decoderModule ??= create();
  const readers = groups.map(([payload, layout, size, checksum]) =>
    createReader(decoderBase64, payload, layout, size, checksum, getDecoderModule));
  return index => {
    if (!Number.isInteger(index) || index < 0 || index >= mapping.length) throw new Error('Invalid packed preview assets.');
    const [group, local] = mapping[index];
    if (!Number.isInteger(group) || group < 0 || group >= readers.length) throw new Error('Invalid packed preview assets.');
    return readers[group](local);
  };
}

export function createPackedAssetReader(decoderBase64, packedBase64, layout, outputSize, checksum, getDecoderModule) {
  let values;
  const fromBase64 = value => {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(value);
    const binary = atob(value), bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  };
  const toBase64 = bytes => {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    }
    return btoa(parts.join(''));
  };
  const invalid = () => { throw new Error('Invalid packed preview assets.'); };
  return index => {
    if (!Number.isInteger(index) || index < 0 || index >= (values?.length ?? layout.length)) invalid();
    if (!values) {
      const input = fromBase64(packedBase64);
      if (input.length < 13 || !Number.isSafeInteger(outputSize) || outputSize <= 0 || outputSize >= 0x80000000) invalid();
      let total = 0;
      for (const [kind, size] of layout) {
        if (![0, 1, 2].includes(kind) || !Number.isInteger(size) || size < 0) invalid();
        total += size;
      }
      if (total !== outputSize) invalid();
      const inputLength = input.length - 13;
      let memory;
      const module = getDecoderModule
        ? getDecoderModule(() => new WebAssembly.Module(fromBase64(decoderBase64)))
        : new WebAssembly.Module(fromBase64(decoderBase64));
      const instance = new WebAssembly.Instance(module, { a: {
        a: invalid, b: () => {}, c: invalid, d: invalid,
        e: size => {
          try {
            memory.grow(Math.ceil((size >>> 0) / 65536) - memory.buffer.byteLength / 65536);
            return 1;
          } catch { return 0; }
        }
      } });
      const api = instance.exports;
      memory = api.f;
      api.g(); // __wasm_call_ctors
      const pointer = api.j(17 + inputLength + outputSize) >>> 0; // malloc
      if (!pointer) invalid();
      const urls = [];
      try {
        const source = pointer + 17, output = source + inputLength;
        const heap = new Uint8Array(memory.buffer);
        heap.set(input.subarray(0, 5), pointer + 12);
        heap.set(input.subarray(13), source);
        const code = api.h(source, inputLength, pointer + 12, output, outputSize, pointer);
        const summary = new DataView(memory.buffer, pointer, 12);
        if (code !== 0 || summary.getUint32(0, true) !== inputLength || summary.getUint32(4, true) !== outputSize ||
            ![1, 4].includes(summary.getUint32(8, true))) invalid();
        const bytes = new Uint8Array(memory.buffer, output, outputSize);
        const table = new Uint32Array(8 * 256);
        for (let value = 0; value < 256; value++) {
          let entry = value;
          for (let bit = 0; bit < 8; bit++) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
          table[value] = entry;
        }
        // Slice CRC-32 by eight bytes without relying on the host's byte order.
        for (let slice = 1; slice < 8; slice++) {
          for (let value = 0; value < 256; value++) {
            const entry = table[(slice - 1) * 256 + value];
            table[slice * 256 + value] = table[entry & 255] ^ (entry >>> 8);
          }
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let crc = -1, position = 0;
        for (; position + 8 <= bytes.length; position += 8) {
          const first = crc ^ view.getUint32(position, true), second = view.getUint32(position + 4, true);
          crc = table[1792 + (first & 255)] ^ table[1536 + ((first >>> 8) & 255)] ^
            table[1280 + ((first >>> 16) & 255)] ^ table[1024 + (first >>> 24)] ^
            table[768 + (second & 255)] ^ table[512 + ((second >>> 8) & 255)] ^
            table[256 + ((second >>> 16) & 255)] ^ table[second >>> 24];
        }
        for (; position < bytes.length; position++) crc = table[(crc ^ bytes[position]) & 255] ^ (crc >>> 8);
        if (((crc ^ -1) >>> 0) !== checksum) invalid();
        const text = new TextDecoder('utf-8', { fatal: true }), result = [];
        let offset = 0;
        for (const [kind, size] of layout) {
          if (!Number.isInteger(size) || size < 0 || offset + size > bytes.length) invalid();
          const part = bytes.subarray(offset, offset + size);
          if (kind === 2) {
            const url = URL.createObjectURL(new Blob([part], { type: 'application/wasm' }));
            urls.push(url);
            result.push(url);
          } else if (kind === 1) result.push(toBase64(part));
          else if (kind === 0) result.push(text.decode(part));
          else invalid();
          offset += size;
        }
        if (offset !== bytes.length) invalid();
        values = result;
        // Blob snapshots and strings own the assets now; release the decoder,
        // solid output and encoded payload after this call returns.
        decoderBase64 = packedBase64 = '';
        layout = [];
      } catch (error) {
        for (const url of urls) URL.revokeObjectURL(url);
        throw error;
      } finally { api.k(pointer); } // free
    }
    return values[index];
  };
}
