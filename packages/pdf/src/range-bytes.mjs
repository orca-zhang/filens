export class PdfRangeBytes {
  chunks = new Map();

  constructor(length, chunkSize) {
    this.length = length;
    this.chunkSize = chunkSize;
  }

  set(source, start) {
    const { length, chunkSize, chunks } = this;
    let offset = 0;
    while (offset < source.length) {
      const index = Math.floor(start / chunkSize);
      const within = start % chunkSize;
      const size = Math.min(chunkSize, length - index * chunkSize);
      const count = Math.min(source.length - offset, size - within);
      if (count <= 0) throw new RangeError('PDF bytes exceed the declared file length.');
      let chunk = chunks.get(index);
      if (!chunk) {
        chunk = new Uint8Array(size);
        chunks.set(index, chunk);
      }
      chunk.set(source.subarray(offset, offset + count), within);
      start += count;
      offset += count;
    }
  }

  byteAt(position) {
    return this.chunks.get(Math.floor(position / this.chunkSize))[position % this.chunkSize];
  }

  subarray(start, end) {
    const { chunkSize, chunks } = this;
    if (end <= start) return new Uint8Array(0);
    const first = Math.floor(start / chunkSize), last = Math.floor((end - 1) / chunkSize);
    if (first === last) return chunks.get(first).subarray(start % chunkSize, end - first * chunkSize);
    const bytes = new Uint8Array(end - start);
    let offset = 0;
    for (let index = first; index <= last; index++) {
      const base = index * chunkSize, chunk = chunks.get(index);
      const segment = chunk.subarray(Math.max(0, start - base), end - base);
      bytes.set(segment, offset);
      offset += segment.length;
    }
    return bytes;
  }
}
