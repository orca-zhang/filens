import type { PreviewResourceResolver, PreviewSource } from '@filens/core';

export function normalizeResourceResolverResult(
  result: Awaited<ReturnType<PreviewResourceResolver>>,
  contentType: string,
  objectUrls?: string[]
): { source?: string; warnings: string[] } {
  const resolved = unpackResourceResolverResult(result);
  return { source: normalizeResolvedPreviewSource(resolved.source, contentType, objectUrls), warnings: resolved.warnings };
}

export function unpackResourceResolverResult(
  result: Awaited<ReturnType<PreviewResourceResolver>>
): { source?: PreviewSource; warnings: string[] } {
  if (!result) {
    return { warnings: [] };
  }
  const isSource = (value: unknown): value is PreviewSource => typeof value === 'string' || value instanceof Blob
    || ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
  if (isSource(result)) return { source: result, warnings: [] };
  return {
    source: isSource(result.source) ? result.source : undefined,
    warnings: result.warnings ?? []
  };
}

export function normalizeResolvedPreviewSource(source: PreviewSource | undefined, contentType: string, objectUrls?: string[]): string | undefined {
  if (!source) {
    return undefined;
  }
  if (typeof source === 'string') {
    return source;
  }
  if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    objectUrls?.push(url);
    return url;
  }
  if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) {
    const bytes = ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source);
    if (!objectUrls) return bytesToDataUrl(bytes, contentType);
    // Blob snapshots exactly the view, without a JS Base64 string or a second decode.
    // SharedArrayBuffer-backed views need a regular ArrayBuffer for BlobPart.
    const part = bytes.buffer instanceof ArrayBuffer
      ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
    return normalizeResolvedPreviewSource(new Blob([part], { type: contentType }), contentType, objectUrls);
  }
  return undefined;
}

export function gltfResourceContentType(uri: string): string {
  const normalized = uri.split('?')[0]?.toLowerCase() ?? uri.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.ktx2')) return 'image/ktx2';
  return 'application/octet-stream';
}

export function objResourceContentType(uri: string): string {
  const normalized = uri.split('?')[0]?.toLowerCase() ?? uri.toLowerCase();
  if (normalized.endsWith('.mtl')) return 'text/plain';
  return gltfResourceContentType(uri);
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').split(/[?#]/)[0] ?? '';
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

export function joinResourcePath(base: string, path: string): string {
  if (!base || /^[a-z]+:\/\//i.test(path) || /^[a-z]:[\\/]/i.test(path) || path.startsWith('/')) {
    return path.replace(/\\/g, '/');
  }
  const parts: string[] = [];
  for (const part of `${base}/${path}`.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  const native = (bytes as Uint8Array & { toBase64?(): string }).toBase64;
  if (native) return `data:${contentType};base64,${native.call(bytes)}`;
  if (typeof Buffer !== 'undefined') return `data:${contentType};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`;
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 0x8000) {
    chunks.push(Reflect.apply(String.fromCharCode, null, bytes.subarray(start, start + 0x8000)));
  }
  return `data:${contentType};base64,${btoa(chunks.join(''))}`;
}

interface ModelTextureResourceOptions {
  resourceBasePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function resolveModelTextureUrl(
  url: string,
  options: ModelTextureResourceOptions,
  warnings: string[],
  objectUrls: string[],
  defaultFormat: string,
  formatLabel: string
): string {
  const resourceResolver = options.resourceResolver;
  if (!resourceResolver) {
    return url;
  }
  if (options.signal?.aborted) {
    throw new DOMException('3D preview aborted.', 'AbortError');
  }
  const baseDir = dirname(options.resourceBasePath ?? '');
  const requestedPath = url.replace(/\\/g, '/');
  const candidates = [
    joinResourcePath(baseDir, requestedPath),
    requestedPath,
    requestedPath.split('/').pop() ?? requestedPath
  ];

  for (const candidate of candidates) {
    const resolved = resourceResolver({
      family: 'model3d',
      sourceFormat: options.sourceFormat ?? defaultFormat,
      source: candidate,
      relation: 'texture',
      name: candidate.split(/[\\/]/).pop() ?? candidate
    });
    if (resolved && !(resolved instanceof Promise)) {
      const normalized = normalizeResourceResolverResult(resolved, objResourceContentType(candidate));
      warnings.push(...normalized.warnings);
      if (normalized.source) {
        const dataUrl = normalizeResolvedPreviewSource(normalized.source, objResourceContentType(candidate));
        if (!dataUrl) {
          warnings.push(`${formatLabel} texture "${requestedPath}" resolved to an unsupported source type; default loader lookup was used.`);
          return url;
        }
        if (dataUrl.startsWith('blob:')) {
          objectUrls.push(dataUrl);
        }
        return dataUrl;
      }
    }
  }

  warnings.push(`${formatLabel} texture "${requestedPath}" could not be resolved; default loader lookup was used.`);
  return url;
}
