import { readPreviewFontEmbeddingFlags } from './font-metadata';
import { ownPreviewFontFace } from './host-fonts';

/** Register local document faces and release them with their owning preview. */
export function bindPreviewEmbeddedFonts(document: Document, signal: AbortSignal) {
  const Font = document.defaultView?.FontFace ?? globalThis.FontFace;
  const fontSet = document.fonts;
  if (!Font || !fontSet || signal.aborted) return undefined;
  const faces = new Set<FontFace>();
  signal.addEventListener('abort', () => {
    for (const face of faces) fontSet.delete(face);
    faces.clear();
  }, { once: true });
  return async (alias: string, bytes: Uint8Array, descriptors: FontFaceDescriptors): Promise<boolean> => {
    if (signal.aborted) return false;
    try {
      const flags = readPreviewFontEmbeddingFlags(bytes);
      if (flags === undefined || flags & 0x0202) return false; // Restricted embedding or bitmap-only embedding.
      const { buffer, byteOffset, byteLength } = bytes;
      const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, byteOffset, byteLength) : Uint8Array.from(bytes);
      const face = await new Font(alias, data, descriptors).load();
      if (signal.aborted) return false;
      ownPreviewFontFace(face);
      fontSet.add(face);
      faces.add(face);
      return true;
    } catch { return false; }
  };
}
