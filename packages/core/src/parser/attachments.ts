import { openZipArchive } from './zip';
import { PREVIEW_CONTAINER_LIMITS, readPreviewContainerEntry } from '../preview/containers';
import { inferExtensionFromName } from '../preview/formats';
import type { PreviewAttachment, PreviewContainerContext, SourceDescriptor } from '../preview/types';

/** Only embedded payloads are indexed. Images, styles and external links are
 * handled by the document renderer, and are never treated as attachments. */
export async function readOfficeAttachments(bytes: Uint8Array, context: PreviewContainerContext, signal?: AbortSignal): Promise<PreviewAttachment[]> {
  const zip = await openZipArchive(bytes, { signal, maxEntryBytes: PREVIEW_CONTAINER_LIMITS.maxEntryBytes });
  signal?.throwIfAborted();
  if (zip.size > PREVIEW_CONTAINER_LIMITS.maxEntries) throw new Error('Document contains too many package entries.');
  return [...zip.values()].filter(entry => !entry.directory && /^(word|xl|ppt)\/embeddings\/[^/]+$/i.test(entry.name)).map(entry => {
    const readRaw: NonNullable<PreviewAttachment['readRaw']> = async readSignal => {
      signal?.throwIfAborted();
      const activeSignal = readSignal ?? signal;
      const data = await readPreviewContainerEntry(() => entry.bytes(undefined, activeSignal), entry.size, context, activeSignal);
      return { source: data, name: attachmentFilename(entry.name), size: data.byteLength };
    };
    return {
      id: entry.name,
      name: attachmentFilename(entry.name),
      size: entry.size,
      readRaw,
      read: async readSignal => {
        const raw = await readRaw(readSignal);
        return unwrapOfficeAttachment(raw.source as Uint8Array, raw.name!);
      }
    };
  });
}

export function attachmentFilename(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'attachment.bin';
}

/** OLE Package objects wrap the original payload in an Ole10Native stream.
 * Native Office OLE objects instead remain valid compound files themselves. */
export async function unwrapOfficeAttachment(bytes: Uint8Array, name: string): Promise<SourceDescriptor> {
  const compound = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte);
  if (compound) {
    const cfb = await import('cfb');
    const file = cfb.read(bytes, { type: 'array' });
    const native = cfb.find(file, '\u0001Ole10Native');
    if (native) return readOle10Native(new Uint8Array(native.content), name);
    const packaged = cfb.find(file, 'Package');
    if (packaged) return describeAttachment(new Uint8Array(packaged.content), name);
    const extension = cfb.find(file, 'WordDocument') ? 'doc'
      : cfb.find(file, 'Workbook') || cfb.find(file, 'Book') ? 'xls'
      : cfb.find(file, 'PowerPoint Document') ? 'ppt' : undefined;
    if (extension) return { source: bytes, name: replaceExtension(name, extension), extension };
  }
  return describeAttachment(bytes, name);
}

async function readOle10Native(bytes: Uint8Array, fallbackName: string): Promise<SourceDescriptor> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6) throw new Error('The embedded OLE attachment is truncated.');
  const total = view.getUint32(0, true);
  if (total > bytes.length - 4) throw new Error('The embedded OLE attachment is truncated.');
  const end = Math.min(bytes.length, total + 4);
  let offset = 6;
  const string = (): string => {
    const stop = bytes.indexOf(0, offset);
    if (stop < offset || stop >= end) throw new Error('Invalid embedded OLE filename.');
    const value = new TextDecoder().decode(bytes.subarray(offset, stop));
    offset = stop + 1;
    return value;
  };
  const label = string();
  string(); // Original path; never used for filesystem or network access.
  offset += 4; // Reserved flags.
  string(); // Temporary path.
  if (offset + 4 > end) throw new Error('The embedded OLE attachment is truncated.');
  const size = view.getUint32(offset, true);
  offset += 4;
  if (size > end - offset) throw new Error('The embedded OLE attachment is truncated.');
  return describeAttachment(bytes.slice(offset, offset + size), attachmentFilename(label || fallbackName));
}

function replaceExtension(name: string, extension: string): string {
  return `${name.replace(/\.[^.]*$/, '')}.${extension}`;
}

async function describeAttachment(bytes: Uint8Array, name: string): Promise<SourceDescriptor> {
  let extension = inferExtensionFromName(name);
  if (extension === 'bin' || !name.includes('.')) {
    const signature = new TextDecoder().decode(bytes.subarray(0, 5));
    if (signature === '%PDF-') extension = 'pdf';
    else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const zip = await openZipArchive(bytes);
      extension = zip.has('word/document.xml') ? 'docx' : zip.has('xl/workbook.xml') ? 'xlsx'
        : zip.has('ppt/presentation.xml') ? 'pptx' : 'zip';
    } else if ([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07].every((byte, index) => bytes[index] === byte)) extension = 'rar';
    else if ([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((byte, index) => bytes[index] === byte)) extension = '7z';
    else if (bytes[0] === 0x1f && bytes[1] === 0x8b) extension = 'gz';
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) extension = 'png';
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) extension = 'jpg';
    if (extension && extension !== 'bin') name = replaceExtension(name, extension);
  }
  return { source: bytes, name, extension, size: bytes.byteLength };
}
