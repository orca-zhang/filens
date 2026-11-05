// A chapter iframe gets a distinct opaque origin when its host is sandboxed
// without allow-same-origin. It cannot read blob:null URLs created by the host.
export function needsInlineFrameResources(): boolean {
  return typeof window !== 'undefined' && window.origin === 'null';
}

export function createFrameResourceUrl(
  source: ArrayBuffer | Uint8Array | string,
  type: string,
  createUrl: (blob: Blob) => string
): string {
  if (needsInlineFrameResources()) {
    const bytes = typeof source === 'string' ? new TextEncoder().encode(source)
      : source instanceof ArrayBuffer ? new Uint8Array(source) : source;
    return bytesToDataUrl(bytes, type);
  }
  // Blob takes its own snapshot of the exact view. Shared buffers still need
  // a regular ArrayBuffer; ordinary media need no preliminary full copy.
  const part = source instanceof Uint8Array ? source.buffer instanceof ArrayBuffer
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source) : source;
  return createUrl(new Blob([part], { type }));
}

export function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  const native = (bytes as Uint8Array & { toBase64?(): string }).toBase64;
  if (native) return `data:${type};base64,${native.call(bytes)}`;
  if (typeof Buffer !== 'undefined') return `data:${type};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 0x8000) {
    chunks.push(Reflect.apply(String.fromCharCode, null, bytes.subarray(start, start + 0x8000)));
  }
  return `data:${type};base64,${btoa(chunks.join(''))}`;
}
