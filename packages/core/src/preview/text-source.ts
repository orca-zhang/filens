import type { PreviewLoadContext, PreviewSource } from './types';

export interface DecodedPreviewText { text: string; encoding: string; warnings: string[] }

/** BOMs take precedence over an explicit MIME charset; undeclared legacy encodings are never guessed. */
export function decodePreviewText(bytes: Uint8Array, contentType?: string): DecodedPreviewText {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
    || (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)) {
    throw new Error('UTF-32 text previews are not supported.');
  }
  const charset = /charset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i.exec(contentType ?? '');
  const label = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be'
      : bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 'utf-8'
        : charset?.slice(1).find(Boolean)?.trim() ?? 'utf-8';
  let decoder: TextDecoder;
  try { decoder = new TextDecoder(label, { fatal: true }); }
  catch { throw new Error(`Unsupported text encoding: ${label}.`); }
  const encoding = decoder.encoding, warnings: string[] = [];
  let text: string;
  try { text = decoder.decode(bytes); }
  catch {
    text = new TextDecoder(encoding).decode(bytes);
    warnings.push(`Invalid ${encoding} text was decoded with replacement characters. Specify the source charset when opening a legacy text file.`);
  }
  let controls = 0;
  const sample = text.slice(0, 32_768);
  for (let index = 0; index < sample.length; index++) {
    const code = sample.charCodeAt(index);
    if (code < 9 || (code > 13 && code < 27) || (code > 27 && code < 32) || code === 127) controls++;
  }
  if (text.includes('\0') || controls > Math.max(2, sample.length / 100)) {
    throw new Error('This file contains binary data and cannot be displayed as text.');
  }
  return { text, encoding, warnings };
}

export async function readPreviewText(source: PreviewSource, context: PreviewLoadContext): Promise<DecodedPreviewText> {
  let contentType = context.descriptor.contentType;
  let bytes: Uint8Array;
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) throw new Error(`Failed to load text preview source: ${response.status} ${response.statusText}`.trim());
    if (!/charset\s*=/i.test(contentType ?? '')) contentType = response.headers.get('content-type') ?? contentType;
    bytes = new Uint8Array(await response.arrayBuffer());
  } else if (ArrayBuffer.isView(source)) {
    bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
  else if (source instanceof Blob) {
    if (!/charset\s*=/i.test(contentType ?? '')) contentType = source.type || contentType;
    bytes = new Uint8Array(await source.arrayBuffer());
  }
  else bytes = new TextEncoder().encode(String(source));
  context.signal?.throwIfAborted();
  return decodePreviewText(bytes, contentType);
}
