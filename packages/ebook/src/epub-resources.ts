import type { PreviewResourceResolver, PreviewSource, ZipEntry } from '@filens/core';
import { rewriteCssResources } from './css-resources';
import { bytesToDataUrl, createFrameResourceUrl, needsInlineFrameResources } from './frame-resource-url';

export function resolveArchivePath(base: string, href: string): string {
  const path = href.split(/[?#]/, 1)[0]!;
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* Tolerate literal percent signs in older books. */ }
  const parts: string[] = [];
  for (const part of `${decoded.startsWith('/') ? '' : base + '/'}${decoded}`.replace(/\\/g, '/').split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export async function createEpubResources(
  zip: Map<string, ZipEntry>,
  manifest: Iterable<{ href: string; mediaType: string }>,
  packageDir: string,
  createUrl: (blob: Blob) => string,
  signal: AbortSignal | undefined,
  resourceResolver: PreviewResourceResolver | undefined,
  warnings: string[]
) {
  const urls = new Map<string, string>(), mediaTypes = new Map<string, string>();
  const resolved = new Map<string, string | undefined>(), htmlPaths = new Set<string>();
  for (const item of manifest) {
    const path = resolveArchivePath(packageDir, item.href);
    if (/^(?:application\/xhtml\+xml|text\/html)$/.test(item.mediaType)) { htmlPaths.add(path); continue; }
    mediaTypes.set(path, item.mediaType);
  }

  async function materialize(path: string, stylesheet: boolean, ancestors: Set<string>): Promise<string | undefined> {
    checkAborted(signal);
    if (ancestors.has(path)) {
      const warning = `Skipped circular EPUB stylesheet import: ${path}.`;
      if (!warnings.includes(warning)) warnings.push(warning);
      return 'data:text/css,';
    }
    if (urls.has(path)) return urls.get(path);
    if (htmlPaths.has(path) || /\.(?:xhtml|html?)$/i.test(path)) return undefined;
    const key = `${stylesheet ? 'stylesheet' : 'resource'}:${path}`;
    if (resolved.has(key)) return resolved.get(key);
    // Inflate only resources a chapter or stylesheet references. Keep URLs,
    // rather than another copy of every expanded asset in the manifest.
    const file = zip.get(path);
    let source: PreviewSource | undefined = file ? await file.bytes() : undefined;
    checkAborted(signal);
    let type = mediaTypes.get(path) || contentType(path);
    if (!file && resourceResolver) {
      const result = await resourceResolver({ family: 'ebook', sourceFormat: 'epub', source: path,
        relation: stylesheet ? 'stylesheet' : 'resource', name: path.split('/').pop() ?? path });
      checkAborted(signal);
      if (result && typeof result === 'object' && !(result instanceof Blob) && !(result instanceof ArrayBuffer) && !ArrayBuffer.isView(result)) {
        source = result.source;
      } else source = result || undefined;
    }
    let url: string | undefined;
    if (typeof source === 'string') url = source;
    else if (source !== undefined) {
      if (source instanceof Blob && source.type) type = source.type;
      if (type.split(';', 1)[0] === 'text/css' || stylesheet) {
        const bytes = source instanceof Blob ? await source.arrayBuffer() : source instanceof ArrayBuffer
          ? source : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        checkAborted(signal);
        const next = new Set(ancestors); next.add(path);
        const css = await rewrite(decodeCss(bytes, type), dirname(path), next);
        checkAborted(signal);
        url = createFrameResourceUrl(css, 'text/css;charset=utf-8', createUrl);
      } else if (source instanceof Blob && !needsInlineFrameResources()) {
        url = createUrl(source.type ? source : new Blob([source], { type }));
      } else if (file || source instanceof Blob) {
        const bytes = source instanceof Blob ? await source.arrayBuffer() : source instanceof ArrayBuffer
          ? source : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        checkAborted(signal);
        url = createFrameResourceUrl(bytes, type, createUrl);
      } else {
        const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
        url = bytesToDataUrl(bytes, type);
      }
    }
    checkAborted(signal);
    resolved.set(key, url);
    if (file && url) urls.set(path, url);
    return url;
  }

  async function resolve(value: string, base: string, stylesheet = false, ancestors = new Set<string>()): Promise<string | undefined> {
    checkAborted(signal);
    const href = value.trim();
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return undefined;
    const path = resolveArchivePath(base, href);
    const url = await materialize(path, stylesheet, ancestors);
    if (!url) return undefined;
    const suffix = href.match(/[?#].*$/)?.[0] ?? '';
    // Blob/data resources have no query variants; fragments still select SVG views.
    return url + (/^(?:blob|data):/i.test(url) ? suffix.match(/#.*/)?.[0] ?? '' : suffix);
  }

  async function rewrite(css: string, base: string, ancestors = new Set<string>()): Promise<string> {
    return rewriteCssResources(css, (value, stylesheet) => resolve(value, base, stylesheet, ancestors));
  }

  checkAborted(signal);
  return { resolve, rewriteCss: rewrite };
}

function dirname(path: string): string { return path.slice(0, Math.max(0, path.lastIndexOf('/'))); }
function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Ebook preview aborted.', 'AbortError');
}

function decodeCss(bytes: ArrayBuffer | Uint8Array, type: string): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bom = view[0] === 0xff && view[1] === 0xfe ? 'utf-16le' : view[0] === 0xfe && view[1] === 0xff ? 'utf-16be'
    : view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf ? 'utf-8' : undefined;
  const header = type.match(/;\s*charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const charset = new TextDecoder('ascii').decode(view.subarray(0, 128)).match(/^@charset "([^"\r\n]+)";/)?.[1];
  const encoding = bom ?? header ?? charset ?? 'utf-8';
  try { return new TextDecoder(encoding).decode(view); } catch { return new TextDecoder().decode(view); }
}

function contentType(path: string): string {
  const types: Record<string, string> = { css: 'text/css', otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2',
    avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' };
  return types[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
