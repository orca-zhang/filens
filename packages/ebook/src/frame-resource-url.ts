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
    const chunks: string[] = [];
    for (let start = 0; start < bytes.length; start += 0x8000) {
      chunks.push(String.fromCharCode(...bytes.subarray(start, start + 0x8000)));
    }
    return `data:${type};base64,${btoa(chunks.join(''))}`;
  }
  const part = source instanceof Uint8Array ? new Uint8Array(source) : source;
  return createUrl(new Blob([part], { type }));
}
