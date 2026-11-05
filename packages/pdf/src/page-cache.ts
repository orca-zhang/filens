// Keep only a few recently painted first pages, never PDF documents/workers.
// A content digest plus the exact viewport prevents stale files and blurry zooms.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 4;
const TTL_MS = 30_000;

interface CachedPage {
  canvas: HTMLCanvasElement;
  bytes: number;
  timer: ReturnType<typeof setTimeout>;
}

export class PdfPageCache {
  private readonly pages = new Map<string, CachedPage>();
  private bytes = 0;
  private listening = false;

  read(key: string, target: HTMLCanvasElement): boolean {
    const page = this.pages.get(key);
    if (!page || page.canvas.width !== target.width || page.canvas.height !== target.height) return false;
    try {
      const context = target.getContext('2d');
      if (!context) return false;
      context.drawImage(page.canvas, 0, 0);
    } catch {
      this.remove(key);
      return false;
    }
    this.pages.delete(key);
    this.pages.set(key, page);
    clearTimeout(page.timer);
    page.timer = setTimeout(() => this.remove(key), TTL_MS);
    return true;
  }

  write(key: string, source: HTMLCanvasElement): void {
    const bytes = source.width * source.height * 4;
    if (!bytes || bytes > MAX_BYTES) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    try {
      const context = canvas.getContext('2d');
      if (!context) { canvas.width = canvas.height = 0; return; }
      context.drawImage(source, 0, 0);
    } catch {
      canvas.width = canvas.height = 0;
      return;
    }
    this.remove(key);
    while (this.pages.size && (this.pages.size >= MAX_ENTRIES || this.bytes + bytes > MAX_BYTES)) {
      this.remove(this.pages.keys().next().value!);
    }
    this.pages.set(key, { canvas, bytes, timer: setTimeout(() => this.remove(key), TTL_MS) });
    this.bytes += bytes;
    if (!this.listening && typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.clear);
      this.listening = true;
    }
  }

  readonly clear = (): void => {
    for (const key of this.pages.keys()) this.remove(key);
  };

  private remove(key: string): void {
    const page = this.pages.get(key);
    if (!page) return;
    clearTimeout(page.timer);
    page.canvas.width = page.canvas.height = 0;
    this.bytes -= page.bytes;
    this.pages.delete(key);
    if (!this.pages.size && this.listening) {
      window.removeEventListener('pagehide', this.clear);
      this.listening = false;
    }
  }
}

export const pdfPageCache = new PdfPageCache();

export async function pdfContentKey(input: string | Uint8Array, password?: string): Promise<string | undefined> {
  // URL contents can change; unlocked documents must not leave decrypted pixels
  // in a cache after closing. Unsupported/insecure contexts simply render normally.
  if (typeof input === 'string' || password !== undefined || !globalThis.crypto?.subtle) return undefined;
  try {
    const digest = await crypto.subtle.digest('SHA-256', input as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

export function pdfPageKey(content: string | undefined, viewport: { width: number; height: number }, canvas: HTMLCanvasElement): string | undefined {
  return content ? `${content}:${viewport.width}:${viewport.height}:${canvas.width}:${canvas.height}` : undefined;
}
