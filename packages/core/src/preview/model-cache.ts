import type { PreviewSource } from './types';

interface ModelEntry {
  value: unknown;
  clone: (value: any) => unknown;
  bytes: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Recently parsed data only: callers always receive their own mutable model.
 * The byte budget is conservative accounting, not a measurement of JS heap size.
 * DOM, object URLs, workers and GPU objects must never be stored here. */
export class PreviewModelCache {
  private readonly entries = new Map<string, ModelEntry>();
  private bytes = 0;
  private listening = false;

  constructor(private readonly options = { maxBytes: 64 * 1024 * 1024, maxEntries: 4, idleMs: 30_000 }) {}

  get size(): number { return this.entries.size; }
  get accountedBytes(): number { return this.bytes; }

  get<T>(key: string | undefined): T | undefined {
    if (!key) return;
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expiresAt <= Date.now()) { this.remove(key); return; }
    let value: T;
    try { value = entry.clone(entry.value) as T; }
    catch { this.remove(key); return; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    clearTimeout(entry.timer);
    entry.expiresAt = Date.now() + this.options.idleMs;
    entry.timer = this.expire(key);
    return value;
  }

  put<T>(key: string | undefined, value: T, options: { bytes?: number; clone?: (value: T) => T } = {}): void {
    if (!key || this.options.maxEntries < 1 || this.options.idleMs <= 0) return;
    const bytes = options.bytes ?? estimatePreviewModelBytes(value, this.options.maxBytes);
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.options.maxBytes) return;
    if (!options.clone && typeof globalThis.structuredClone !== 'function') return;
    // Window.structuredClone requires its Window receiver in browsers. Never
    // store the bare native function and invoke it as an entry method.
    const clone = options.clone ?? ((model: T) => globalThis.structuredClone(model));
    let snapshot: T;
    try { snapshot = clone(value); } catch { return; }
    this.remove(key);
    while (this.entries.size && (this.entries.size >= this.options.maxEntries || this.bytes + bytes > this.options.maxBytes)) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(key, { value: snapshot, clone, bytes, expiresAt: Date.now() + this.options.idleMs, timer: this.expire(key) });
    this.bytes += bytes;
    if (!this.listening && typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.clear);
      this.listening = true;
    }
  }

  readonly clear = (): void => {
    for (const key of this.entries.keys()) this.remove(key);
  };

  private expire(key: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.remove(key), this.options.idleMs);
    // A frontend library imported in Node must not keep a CLI process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
    return timer;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.bytes -= entry.bytes;
    this.entries.delete(key);
    if (!this.entries.size && this.listening) {
      window.removeEventListener('pagehide', this.clear);
      this.listening = false;
    }
  }
}

export const previewModelCache = new PreviewModelCache();

/** Hash owned, stable bytes before transferring them to a parser worker. */
export async function previewContentKey(bytes: Uint8Array, scope: string, signal?: AbortSignal): Promise<string | undefined> {
  signal?.throwIfAborted();
  if (!globalThis.crypto?.subtle || typeof structuredClone !== 'function') return;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    signal?.throwIfAborted();
    return `${scope}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch (error) { if (signal?.aborted) throw error; return; }
}

/** Snapshot borrowed buffers before the first await. URL callers keep their normal reader. */
export async function snapshotPreviewBytes(source: PreviewSource, signal?: AbortSignal): Promise<Uint8Array | undefined> {
  signal?.throwIfAborted();
  if (typeof source === 'string') return;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  if (source instanceof ArrayBuffer) return new Uint8Array(source).slice();
  const bytes = new Uint8Array(await source.arrayBuffer());
  signal?.throwIfAborted();
  return bytes;
}

export function estimatePreviewModelBytes(value: unknown, limit = 64 * 1024 * 1024): number {
  const seen = new Set<object>(), pending: unknown[] = [value];
  let bytes = 0;
  while (pending.length && bytes <= limit) {
    const item = pending.pop();
    if (typeof item === 'string') { bytes += 24 + item.length * 2; continue; }
    if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'bigint') { bytes += 8; continue; }
    if (item == null) { bytes += 8; continue; }
    if (typeof item !== 'object') return Infinity;
    if (seen.has(item)) continue;
    seen.add(item);
    bytes += 64;
    if (ArrayBuffer.isView(item)) { pending.push(item.buffer); continue; }
    if (item instanceof ArrayBuffer) { bytes += item.byteLength; continue; }
    if (Array.isArray(item)) {
      bytes += item.length * 8;
      if (bytes > limit) return bytes;
      for (const child of item) pending.push(child);
      continue;
    }
    if (item instanceof Map) { for (const [key, child] of item) { bytes += 32; pending.push(key, child); } continue; }
    if (item instanceof Set) { for (const child of item) { bytes += 16; pending.push(child); } continue; }
    if (item instanceof Date) { bytes += 8; continue; }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return Infinity;
    for (const [key, child] of Object.entries(item)) { bytes += 24 + key.length * 2; pending.push(child); }
  }
  return bytes;
}
