import type { FillStyle, ParsedPresentation } from '../types';
import UTIF from 'utif';

type PictureTint = NonNullable<FillStyle['pictureTint']>;
type TintedPicture = { url: string; width: number; height: number };

export interface MediaResolver {
  getUrl(mediaId: string): string;
  getTintedPicture?(mediaId: string, tint: PictureTint): Promise<TintedPicture | undefined>;
}

export class MediaRegistry {
  private readonly cache = new Map<string, string>();
  private readonly tints = new Map<string, Promise<TintedPicture | undefined>>();
  private readonly tintedUrls = new Set<string>();
  private tintQueue = Promise.resolve();

  constructor(private readonly presentation: ParsedPresentation) {}

  getUrl(mediaId: string): string {
    const cached = this.cache.get(mediaId);
    if (cached) {
      return cached;
    }

    const media = this.presentation.media[mediaId];
    if (!media) {
      return '';
    }

    const { contentType, data } = media.preview ?? media;
    let url = '';
    const decodedTiffDataUrl = !media.preview && isTiffMedia(mediaId, contentType) ? decodeTiffToDataUrl(data) : undefined;
    if (decodedTiffDataUrl) {
      url = decodedTiffDataUrl;
    } else if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      // Blob snapshots the view's bytes; avoid an extra full media copy first.
      // Shared buffers still need an ordinary ArrayBuffer for the Blob API.
      const blobSource = data.buffer instanceof ArrayBuffer
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      url = URL.createObjectURL(new Blob([blobSource], { type: contentType }));
    } else {
      url = `data:${contentType};base64,${uint8ToBase64(data)}`;
    }

    this.cache.set(mediaId, url);
    return url;
  }

  getTintedPicture(mediaId: string, tint: PictureTint): Promise<TintedPicture | undefined> {
    const key = JSON.stringify([mediaId, tint.color, tint.alpha]);
    const cached = this.tints.get(key);
    if (cached) return cached;

    // Keep only one tint raster in progress per preview, even for a wide window.
    const task: Promise<TintedPicture | undefined> = this.tintQueue.then(async () => {
      if (this.tints.get(key) !== task || typeof URL.createObjectURL !== 'function') return;
      const source = this.getUrl(mediaId);
      if (!source) return;
      const picture = await tintPicture(source, tint);
      if (!picture || this.tints.get(key) !== task) return;
      const url = URL.createObjectURL(picture.blob);
      this.tintedUrls.add(url);
      return { url, width: picture.width, height: picture.height };
    }).catch(() => undefined);
    this.tintQueue = task.then(() => {});
    this.tints.set(key, task);
    return task;
  }

  destroy(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.cache.values()) {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      }
      for (const url of this.tintedUrls) URL.revokeObjectURL(url);
    }

    this.cache.clear();
    this.tintedUrls.clear();
    this.tints.clear();
  }
}

async function tintPicture(url: string, tint: PictureTint) {
  const image = document.createElement('img');
  image.src = url;
  await image.decode();
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return;
  const scale = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(8_388_608 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  try {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-atop';
    context.globalAlpha = tint.alpha;
    context.fillStyle = tint.color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
    if (blob) return { blob, width, height };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function isTiffMedia(mediaId: string, contentType: string): boolean {
  return /\.tiff?$/i.test(mediaId) || /^image\/tiff?$/i.test(contentType);
}

function decodeTiffToDataUrl(bytes: Uint8Array): string | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }

  try {
    const buffer = toExactArrayBuffer(bytes);
    const ifds = UTIF.decode(buffer);
    if (!ifds.length) {
      return undefined;
    }

    for (const ifd of ifds) {
      UTIF.decodeImage(buffer, ifd, ifds);
      // The slide shows one image; leave later TIFF pages compressed.
      if (Number(ifd.width) > 0 && Number(ifd.height) > 0 && ifd.data instanceof Uint8Array) break;
    }

    const page =
      ifds.find((entry) => Number(entry.width) > 0 && Number(entry.height) > 0 && entry.data instanceof Uint8Array) ??
      ifds.find((entry) => Number(entry.width) > 0 && Number(entry.height) > 0) ??
      ifds[0];
    const width = Number(page.width);
    const height = Number(page.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined;
    }

    const rgba = UTIF.toRGBA8(page);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    const imageData = context.createImageData(width, height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?(): string }).toBase64;
  if (native) return native.call(bytes);

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(Reflect.apply(String.fromCharCode, null, bytes.subarray(offset, offset + 32768)));
  }
  return btoa(chunks.join(''));
}
