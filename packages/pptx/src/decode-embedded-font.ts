/** Extract single-face SFNT or EOT data from an internal PowerPoint font part. */
export async function decodeEmbeddedPptxFont(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array | undefined> {
  if (bytes.length < 12 || signal.aborted) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if ([0x00010000, 0x4f54544f, 0x74727565].includes(view.getUint32(0))) return bytes;
  if (bytes.length < 96 || view.getUint16(34, true) !== 0x504c) return undefined;
  const version = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const end = bytes.length - view.getUint32(4, true);
  if (view.getUint32(0, true) !== bytes.length || end >= bytes.length || end < 96
    || ![0x10000, 0x20001, 0x20002].includes(version)
    || view.getUint16(32, true) & 0x0202 || flags & 0x80) return undefined;

  let offset = 80;
  for (let i = 0; i < 4; i++) {
    if (offset + 4 > end) return undefined;
    offset += 4 + view.getUint16(offset + 2, true);
  }
  if (offset > end || version !== 0x10000 && (offset + 4 > end || view.getUint16(offset + 2, true))) return undefined;
  const payload = bytes.subarray(end);
  const encrypted = !!(flags & 0x10000000);
  if (flags & 4) {
    const { decompressMtxFont } = await import('./embedded-font-worker');
    return decompressMtxFont(payload, encrypted, signal);
  }
  return encrypted ? payload.map(byte => byte ^ 0x50) : payload;
}
