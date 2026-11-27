import { analyzePreviewFonts, getPreviewFontWarnings } from './fonts';
import { classifyPreviewFont, rankPreviewFontCandidates } from './font-matching';
import { createWebFontPacks } from './font-packs';
import { fontFamilyKey, observeHostFontLoads, ownPreviewFontFace, readHostFontFamilies } from './host-fonts';
import { fontsourceSubsetIndexes, fontSubsetPoints, parseFontsourceSubsets, selectFontsourceSubsets, type FontsourceSubsetIndex } from './font-subsets';
import type {
  PreviewFontAsset, PreviewFontAssetSource,
  PreviewFontLoadingOptions, PreviewFontReference, PreviewFontRefresh, PreviewOptions, PreviewSession
} from './types';

const defaults: PreviewFontLoadingOptions = {};
const services = new WeakMap<Document, WeakMap<PreviewFontLoadingOptions, FontService>>();
const managedFamilies = new WeakMap<Document, Map<string, number>>();
const abortError = () => new DOMException('Font loading aborted.', 'AbortError');
const check = (signal: AbortSignal) => { if (signal.aborted) throw abortError(); };
const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(abortError()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

interface RouteHealth { latency?: number; failures: number; retryAt: number }
interface Entry { users: number; controller: AbortController; promise: Promise<FontFace>; face?: FontFace }
interface Lease { asset: PreviewFontAsset; release(): void }
type SubsetIndex = ReturnType<typeof parseFontsourceSubsets>;
interface SubsetRequest { users: number; controller: AbortController; promise: Promise<SubsetIndex> }
interface FontLoadWarning { message: string; resolvedBy?: string[] }

/** Shared per document/options: active-face leases, request deduplication and adaptive routing. */
class FontService {
  private entries = new Map<PreviewFontAsset, Entry>();
  private routes = new Map<string, RouteHealth>();
  private origins = new Map<string, number>();
  private subsetIndexes = new WeakMap<FontsourceSubsetIndex, SubsetIndex>();
  private subsetRequests = new WeakMap<FontsourceSubsetIndex, SubsetRequest>();
  private subsetAssets = new WeakMap<PreviewFontAsset, Map<string, PreviewFontAsset>>();
  readonly assets: readonly PreviewFontAsset[];
  constructor(private document: Document, readonly options: PreviewFontLoadingOptions) {
    this.assets = (options.packs ?? createWebFontPacks()).flatMap(pack => pack.fonts);
  }

  async acquire(asset: PreviewFontAsset, signal: AbortSignal): Promise<Lease> {
    check(signal);
    let entry = this.entries.get(asset);
    if (!entry) {
      const controller = new AbortController();
      entry = { users: 0, controller, promise: undefined! };
      const current = entry;
      current.promise = this.load(asset, controller.signal).then(face => {
        check(controller.signal);
        ownPreviewFontFace(face);
        this.document.fonts.add(face);
        this.trackManagedFace(asset, 1);
        current.face = face;
        return face;
      });
      this.entries.set(asset, entry);
    }
    entry.users++;
    const current = entry;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', release);
      if (--current.users === 0) {
        current.controller.abort();
        if (current.face) {
          this.document.fonts.delete(current.face);
          this.trackManagedFace(asset, -1);
        }
        if (this.entries.get(asset) === current) this.entries.delete(asset);
      }
    };
    signal.addEventListener('abort', release, { once: true });
    try { await waitFor(current.promise, signal); check(signal); return { asset, release }; }
    catch (error) { release(); throw error; }
  }

  private trackManagedFace(asset: PreviewFontAsset, delta: 1 | -1): void {
    let families = managedFamilies.get(this.document);
    if (!families) managedFamilies.set(this.document, families = new Map());
    const family = asset.fontFamily.toLowerCase();
    const count = (families.get(family) ?? 0) + delta;
    if (count) families.set(family, count);
    else families.delete(family);
  }

  async acquireSubsets(asset: PreviewFontAsset, reference: PreviewFontReference, signal: AbortSignal): Promise<Lease[] | undefined> {
    const manifest = fontsourceSubsetIndexes.get(asset);
    if (!manifest || this.entries.has(asset)) return undefined;
    const view = this.document.defaultView as (Window & typeof globalThis) | null;
    // The full Emoji face includes COLR, while the pinned slices only have SVG outlines.
    if (manifest.requiresSvg && !(view?.CSS ?? globalThis.CSS)?.supports?.('font-tech(color-SVG)')) return undefined;
    const points = fontSubsetPoints(reference);
    if (!points) return undefined;
    check(signal);
    const batch = new AbortController();
    const abort = () => batch.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(6000, bounded(this.options.budgetMs, 12000, 10, 60000) / 2));
    const leases: Lease[] = [];
    try {
      const index = await this.readSubsetIndex(manifest, batch.signal);
      const subsets = selectFontsourceSubsets(index, points);
      if (!subsets) return undefined;
      let assets = this.subsetAssets.get(asset);
      if (!assets) this.subsetAssets.set(asset, assets = new Map());
      for (const subset of subsets) {
        let part = assets.get(subset.name);
        if (!part) {
          const { weight, style } = asset.descriptors ?? {};
          const file = `files/${manifest.packageId}-${subset.name}-${weight}-${style}.woff2`;
          part = {
            id: `${asset.id}:${subset.name}`, fontFamily: asset.fontFamily, traits: asset.traits,
            coverage: subset.coverage, descriptors: { ...asset.descriptors, unicodeRange: subset.unicodeRange },
            sources: manifest.sources.map(source => ({ ...source, url: source.url.replace(/unicode\.json$/, file) }))
          };
          assets.set(subset.name, part);
        }
        leases.push(await this.acquire(part, batch.signal));
      }
      check(batch.signal);
      return leases;
    } catch {
      leases.forEach(lease => lease.release());
      check(signal);
      return undefined;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  private async readSubsetIndex(manifest: FontsourceSubsetIndex, signal: AbortSignal): Promise<SubsetIndex> {
    check(signal);
    const cached = this.subsetIndexes.get(manifest);
    if (cached) return cached;
    let request = this.subsetRequests.get(manifest);
    if (!request) {
      const controller = new AbortController();
      const deadline = Date.now() + Math.min(1500, bounded(this.options.timeoutMs, 4000, 10, 30000));
      const attempts = Math.floor(bounded(this.options.maxAttempts, 2, 1, 2));
      const promise = this.loadFromSources(manifest.sources, controller.signal, deadline, 256 * 1024, attempts,
        bytes => parseFontsourceSubsets(bytes)).then(index => {
        check(controller.signal);
        this.subsetIndexes.set(manifest, index);
        return index;
      });
      request = { users: 0, controller, promise };
      this.subsetRequests.set(manifest, request);
    }
    request.users++;
    try { return await waitFor(request.promise, signal); }
    finally {
      if (--request.users === 0) {
        request.controller.abort();
        this.subsetRequests.delete(manifest);
      }
    }
  }

  private async load(asset: PreviewFontAsset, signal: AbortSignal): Promise<FontFace> {
    const Constructor = this.document.defaultView?.FontFace ?? globalThis.FontFace;
    if (!Constructor || !this.document.fonts?.add) throw new Error('FontFace API unavailable.');
    const deadline = Date.now() + bounded(this.options.budgetMs, 12000, 10, 60000);
    const attempts = Math.floor(bounded(this.options.maxAttempts, 3, 1, 8));
    const limit = bounded(this.options.maxFontBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024);
    if (asset.data) {
      if (asset.data.byteLength > limit) throw new Error('Font exceeds size limit.');
      const bytes = asset.data instanceof Uint8Array ? asset.data.slice().buffer : asset.data.slice(0);
      return this.decode(Constructor, asset, bytes, signal, deadline);
    }
    return this.loadFromSources(asset.sources ?? [], signal, deadline, limit, attempts,
      (bytes, requestSignal) => this.decode(Constructor, asset, bytes, requestSignal, deadline));
  }

  private async loadFromSources<T>(
    configuredSources: readonly PreviewFontAssetSource[], signal: AbortSignal, deadline: number, limit: number, attempts: number,
    consume: (bytes: ArrayBuffer, signal: AbortSignal) => T | Promise<T>
  ): Promise<T> {
    const sources = configuredSources.flatMap(source => {
      try {
        const url = new URL(source.url, this.document.baseURI);
        return /^https?:$/i.test(url.protocol) ? [{ ...source, url: url.href }] : [];
      } catch { return []; }
    });
    let used = 0;
    while (used < attempts) {
      check(signal);
      if (!sources.length || Date.now() >= deadline) break;
      const now = Date.now();
      const healthy = sources.filter(source => this.health(source).retryAt <= now)
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || this.cost(a) - this.cost(b));
      if (!healthy.length) {
        const wait = Math.min(...sources.map(source => this.health(source).retryAt)) - now;
        if (wait >= deadline - now) break;
        await delay(wait, signal);
        continue;
      }
      const round = used + 1 < attempts ? healthy.slice(0, 2) : healthy.slice(0, 1);
      try {
        return await this.raceRoutes(round, signal, async (source, requestSignal) => {
          used++;
          return this.request(source, requestSignal, deadline, limit, consume);
        });
      } catch { check(signal); }
    }
    throw new Error('Font sources could not be loaded.');
  }

  private raceRoutes<T>(sources: PreviewFontAssetSource[], signal: AbortSignal, request: (source: PreviewFontAssetSource, signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false, started = 0, failed = 0;
      const routes: Array<{ source: PreviewFontAssetSource; controller: AbortController; started: number }> = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const abort = () => {
        if (settled) return;
        settled = true; clean(); routes.forEach(route => route.controller.abort()); reject(abortError());
      };
      const start = () => {
        if (settled || started >= sources.length) return;
        const source = sources[started++], controller = new AbortController();
        const route = { source, controller, started: Date.now() }; routes.push(route);
        request(source, controller.signal).then(result => {
          if (settled) return;
          settled = true; clean();
          for (const other of routes) if (other !== route) {
            if (!other.controller.signal.aborted) {
              // A cancelled slow route supplies a latency lower bound, not a failure.
              const health = this.health(other.source);
              health.latency = Math.max(health.latency ?? 0, Date.now() - other.started);
              this.origins.set(new URL(other.source.url).origin, health.latency);
            }
            other.controller.abort();
          }
          resolve(result);
        }, error => {
          if (settled) return;
          failed++;
          if (started < sources.length) { clearTimeout(timer); start(); }
          else if (failed === started) { settled = true; clean(); reject(error); }
        });
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      start();
      if (sources.length > 1) timer = setTimeout(start, bounded(this.options.hedgeDelayMs, 200, 0, 5000));
    });
  }

  private async request<T>(
    source: PreviewFontAssetSource, signal: AbortSignal, deadline: number, limit: number,
    consume: (bytes: ArrayBuffer, signal: AbortSignal) => T | Promise<T>
  ): Promise<T> {
    const started = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, Math.min(deadline - started, bounded(this.options.timeoutMs, 4000, 10, 30000)));
    let retryAfter = 0;
    try {
      const response = await waitFor(fetch(source.url, {
        signal: controller.signal, mode: 'cors', credentials: source.credentials ?? 'omit', headers: source.headers,
        cache: 'force-cache', referrerPolicy: 'no-referrer'
      }), controller.signal);
      if (!response.ok) {
        const value = response.headers.get('Retry-After');
        if (value) retryAfter = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now());
        if ([401, 403, 404, 410].includes(response.status)) retryAfter = Math.max(retryAfter || 0, 300000);
        void response.body?.cancel().catch(() => {});
        throw new Error('Font source returned an error.');
      }
      if (Number(response.headers.get('Content-Length')) > limit) { void response.body?.cancel().catch(() => {}); throw new Error('Font exceeds size limit.'); }
      const bytes = await waitFor(readBounded(response, limit, controller.signal), controller.signal);
      const result = await consume(bytes, controller.signal);
      check(signal);
      const health = this.health(source);
      const elapsed = Math.max(1, Date.now() - started);
      health.latency = health.latency === undefined ? elapsed : health.latency * 0.7 + elapsed * 0.3;
      this.origins.set(new URL(source.url).origin, health.latency);
      health.failures = 0; health.retryAt = 0;
      return result;
    } catch (error) {
      check(signal);
      const health = this.health(source);
      const base = bounded(this.options.backoffMs, 500, 1, 30000);
      const cap = bounded(this.options.maxBackoffMs, 30000, base, 300000);
      health.failures = Math.min(health.failures + 1, 10);
      health.retryAt = Date.now() + Math.max(Number.isFinite(retryAfter) ? retryAfter : 0,
        Math.min(cap, base * 2 ** (health.failures - 1)) * (0.75 + Math.random() * 0.5));
      throw error;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); controller.abort(); }
  }

  private async decode(Constructor: typeof FontFace, asset: PreviewFontAsset, bytes: ArrayBuffer, signal: AbortSignal, deadline: number) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.max(0, Math.min(deadline - Date.now(), bounded(this.options.timeoutMs, 4000, 10, 30000))));
    try {
      check(signal);
      const face = new Constructor(asset.fontFamily, bytes, { display: 'swap', ...asset.descriptors });
      await waitFor(face.load(), controller.signal);
      check(signal);
      return face;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }

  private health(source: PreviewFontAssetSource) {
    // Health is keyed by endpoint, credentials and headers; secrets never leave this object.
    const key = JSON.stringify([source.url, source.credentials, source.headers]);
    let health = this.routes.get(key);
    if (!health) this.routes.set(key, health = { failures: 0, retryAt: 0 });
    return health;
  }
  private cost(source: PreviewFontAssetSource) {
    const sameOrigin = new URL(source.url).origin === new URL(this.document.baseURI).origin;
    const health = this.health(source);
    return (health.latency ?? this.origins.get(new URL(source.url).origin) ?? (sameOrigin ? 500 : 1500)) + health.failures * 5000;
  }
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('Invalid font response size.');
    return bytes;
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Font exceeds size limit.');
      chunks.push(value);
    }
    if (!length) throw new Error('Empty font response.');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Start after first render. The owning driver must destroy this binding on teardown. */
export function bindPreviewFontLoading(session: PreviewSession, document: Document, options: PreviewOptions): {
  reset(signal?: AbortSignal, sourceFormat?: string): void; refresh(): void; destroy(): void;
} {
  const configuration = options.fontLoading === true ? defaults : options.fontLoading || undefined;
  if (!session.refreshFonts) return { reset() {}, refresh() {}, destroy() {} };
  let service: FontService | undefined;
  if (configuration) {
    let byOptions = services.get(document);
    if (!byOptions) services.set(document, byOptions = new WeakMap());
    service = byOptions.get(configuration);
    if (!service) byOptions.set(configuration, service = new FontService(document, configuration));
  }
  let controller = new AbortController(), destroyed = false, running = false, queued = false;
  const seen = new Set<string>(), leases: Lease[] = [], loaded: PreviewFontAsset[] = [];
  const mappings = new Map<string, Pick<PreviewFontReference, 'resolvedFontFamily' | 'source'>>();
  const hostAliases = new Map<string, string>();
  const changedFamilies = new Set<string>();
  let refreshRequested = false;
  let lastWarnings: FontLoadWarning[] = [];
  let removeAbort: (() => void) | undefined;
  let sourceFormat: string | undefined;
  const keyOf = (ref: PreviewFontReference) => JSON.stringify([ref.fontFamily, ref.fontFile, ref.styleName, ref.traits, ref.fontStyle]);
  const currentReferences = (state: ReturnType<PreviewSession['getState']>): readonly PreviewFontReference[] =>
    session.getFontReferences?.() ?? (state.fonts ?? []).map(font => ({ ...font, traits: font.classification }));
  // The canvas can detect a sibling's face before this preview owns a lease,
  // or find a different weight of the same family.
  const ignoreManagedFamily = (family: string) => managedFamilies.get(document)?.has(family.toLowerCase()) ?? false;
  const reset = (signal?: AbortSignal, format?: string) => {
    sourceFormat = format;
    removeAbort?.(); removeAbort = undefined;
    controller.abort(); controller = new AbortController();
    leases.splice(0).forEach(lease => lease.release()); loaded.length = 0; seen.clear();
    mappings.clear(); hostAliases.clear(); changedFamilies.clear(); refreshRequested = false; lastWarnings = [];
    running = false;
    if (signal) {
      const abort = () => { controller.abort(); leases.splice(0).forEach(lease => lease.release()); };
      signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
    }
  };
  const schedule = () => {
    if (queued || destroyed) return;
    queued = true;
    queueMicrotask(() => { queued = false; void run(); });
  };
  const run = async () => {
    if (destroyed || running || controller.signal.aborted) return;
    const state = session.getState();
    if (state.loading || state.error) return;
    const signal = controller.signal;
    const references = currentReferences(state);
    let hostRefresh = refreshRequested;
    if (!hostRefresh && changedFamilies.size) {
      const requestedFamilies = new Set(references.map(ref => fontFamilyKey(ref.fontFamily)));
      hostRefresh = references.some(ref => changedFamilies.has(fontFamilyKey(ref.fontFamily))
        || changedFamilies.has(fontFamilyKey(hostAliases.get(keyOf(ref))))
        || changedFamilies.has(fontFamilyKey(mappings.get(keyOf(ref))?.resolvedFontFamily ?? ref.resolvedFontFamily)))
        || (state.fonts ?? []).some(font => requestedFamilies.has(fontFamilyKey(font.fontFamily))
          && changedFamilies.has(fontFamilyKey(font.resolvedFontFamily)));
    }
    refreshRequested = false;
    changedFamilies.clear();
    const pending = service ? references.filter(ref => {
      const key = keyOf(ref);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }) : [];
    if (!pending.length && !hostRefresh) return;
    running = true;
    const warnings: FontLoadWarning[] = [], resolved = new Map<PreviewFontReference, PreviewFontReference>();
    const hostFonts = readHostFontFamilies(document.fonts);
    let index = 0;
    const worker = async () => {
      while (index < pending.length && !signal.aborted) {
        const ref = pending[index++];
        if (!(ref.fontFamily || ref.resolvedFontFamily) || ref.embedded || (ref.browserUnsupported || /\.shx$/i.test(ref.fontFile ?? '')) && !ref.resolvedFontFamily) continue;
        let assets = service!.assets;
        let request = ref;
        try {
          let choice;
          try { choice = options.fontResolver?.({ family: state.family, sourceFormat, fontFamily: ref.fontFamily, fontFile: ref.fontFile, styleName: ref.styleName, fontStyle: ref.fontStyle }); }
          catch { warnings.push({ message: `Font resolver failed for "${ref.fontFamily}"; pack and local fallbacks remain active.` }); }
          if (choice) {
            const family = typeof choice === 'string' ? choice : choice.fontFamily;
            if (family) {
              request = { ...ref, resolvedFontFamily: family, source: 'application' };
              hostAliases.set(keyOf(ref), family);
            }
            if (typeof choice !== 'string') {
              assets = [...choice.assets ?? [], ...assets];
              for (const message of choice.warnings ?? []) warnings.push({ message });
            }
          }
          const local = analyzePreviewFonts([request], document, { substitute: true, ignoreFamily: ignoreManagedFamily, availableFamilies: hostFonts }).fonts[0];
          const installed = loaded.filter(asset => asset.fontFamily === (local?.resolvedFontFamily ?? request.resolvedFontFamily ?? request.fontFamily));
          const classification = classifyPreviewFont(request.fontFamily ?? '', request.traits);
          const weight = classification.weight ?? 400;
          const hasFace = installed.some(asset => {
            if (asset.descriptors?.unicodeRange) return false;
            const weights = (asset.descriptors?.weight ?? String(asset.traits?.weight ?? 400)).split(/\s+/).map(Number);
            return weight >= weights[0] && weight <= (weights[1] ?? weights[0]) && (asset.descriptors?.style ?? 'normal').startsWith(ref.fontStyle ?? 'normal');
          });
          const needsFace = installed.length > 0 && !hasFace;
          if (hasFace || !needsFace && (local?.status === 'available' || request.source === 'application' && local?.status === 'substituted')) {
            if (request.resolvedFontFamily && request.resolvedFontFamily !== ref.resolvedFontFamily) resolved.set(ref, request);
            continue;
          }
          const desired = request.resolvedFontFamily ?? request.fontFamily!;
          assets = assets.filter(asset => (asset.descriptors?.style ?? 'normal') === (ref.fontStyle ?? 'normal'));
          const exact = assets.filter(asset => asset.fontFamily.toLowerCase() === desired.toLowerCase())
            .sort((a, b) => Math.abs((a.traits?.weight ?? 400) - (ref.traits?.weight ?? 400)) - Math.abs((b.traits?.weight ?? 400) - (ref.traits?.weight ?? 400)));
          if (!exact.length && !request.resolvedFontFamily && ['serif', 'monospace', 'style', 'script'].every(key => classification[key as keyof typeof classification] === undefined)) continue;
          const matches = rankPreviewFontCandidates({ ...request, fontFamily: desired }, assets);
          const selected = [...exact, ...matches.map(match => match.candidate as PreviewFontAsset).filter(asset => !exact.includes(asset))];
          if (request.resolvedFontFamily) selected.splice(0, selected.length, ...exact);
          if (!selected.length) continue;
          if (!needsFace && configuration?.preferLocal !== false && local?.status === 'substituted' && !exact.length) {
            const localCandidate = { fontFamily: local.resolvedFontFamily! };
            const ranked = rankPreviewFontCandidates(ref, [localCandidate, ...selected]);
            if (ranked[0]?.candidate === localCandidate) continue;
          }
          // Try the best compatible family, then a second pack if every mirror fails.
          const families = new Set<string>();
          for (const asset of selected.filter(asset => {
            const family = asset.fontFamily.toLowerCase();
            if (families.has(family)) return false;
            families.add(family); return true;
          }).slice(0, 2)) {
            try {
              const acquired = await service!.acquireSubsets(asset, ref, signal) ?? [await service!.acquire(asset, signal)];
              if (signal.aborted) { acquired.forEach(lease => lease.release()); break; }
              leases.push(...acquired); loaded.push(...acquired.map(lease => lease.asset));
              resolved.set(ref, { ...request, resolvedFontFamily: asset.fontFamily, source: request.source === 'application' ? 'application' : 'fallback' });
              break;
            } catch {
              if (signal.aborted) break;
            }
          }
          if (!signal.aborted && !resolved.has(ref)) warnings.push({
            message: `Font "${desired}" could not be loaded; local fallback fonts remain active.`,
            resolvedBy: [fontFamilyKey(desired), fontFamilyKey(ref.fontFamily)]
          });
        } catch {
          if (!signal.aborted) warnings.push({
            message: `Font "${ref.fontFamily}" could not be loaded; local fallback fonts remain active.`,
            resolvedBy: [fontFamilyKey(ref.fontFamily), fontFamilyKey(request.resolvedFontFamily)]
          });
        }
      }
    };
    try {
      if (pending.length) await Promise.all(Array.from({ length: Math.floor(bounded(configuration?.concurrency, 3, 1, 8)) }, worker));
      if (signal.aborted || destroyed) return;
      for (const [ref, choice] of resolved) mappings.set(keyOf(ref), { resolvedFontFamily: choice.resolvedFontFamily, source: choice.source });
      if (resolved.size || warnings.length) lastWarnings = warnings;
      if (resolved.size || warnings.length || hostRefresh) {
        const environment = readHostFontFamilies(document.fonts);
        const relayout = resolved.size > 0 || hostRefresh;
        if (relayout) { changedFamilies.clear(); refreshRequested = false; }
        const next = currentReferences(session.getState()).map(ref => {
          const key = keyOf(ref);
          const alias = hostAliases.get(key);
          if (alias && environment.has(fontFamilyKey(alias))) return { ...ref, resolvedFontFamily: alias, source: 'application' as const };
          const mapping = mappings.get(key);
          const requested = mapping ? { ...ref, ...mapping } : ref;
          if (requested.source === 'fallback' && !requested.browserUnsupported && !/\.shx$/i.test(requested.fontFile ?? '')
            && environment.has(fontFamilyKey(requested.fontFamily))) return { ...requested, resolvedFontFamily: undefined, source: undefined };
          return requested;
        });
        const messages = lastWarnings.filter(warning => !warning.resolvedBy?.some(family => environment.has(family)))
          .map(warning => warning.message);
        await session.refreshFonts!({ references: next, loaded: [...loaded], environment, warnings: [...new Set(messages)], relayout });
      }
    } catch { /* A font refresh must not turn a readable preview into an error. */ }
    finally { if (!signal.aborted) { running = false; schedulePending(); } }
  };
  const schedulePending = () => { if (service || refreshRequested || changedFamilies.size) schedule(); };
  const unsubscribes = [session.on('rendered', schedulePending), session.on('statechange', schedulePending),
    observeHostFontLoads(document.fonts, families => { families.forEach(family => changedFamilies.add(family)); schedule(); })];
  return {
    reset,
    refresh() { refreshRequested = true; schedule(); },
    destroy() { destroyed = true; unsubscribes.forEach(unsubscribe => unsubscribe()); reset(); }
  };
}

/** A loaded FontFace is stronger provenance than a canvas-width heuristic. */
export function analyzeLoadedPreviewFonts(update: PreviewFontRefresh, document: Document) {
  const analysis = analyzePreviewFonts(update.references, document, { substitute: true, candidates: update.loaded, availableFamilies: update.environment });
  for (const font of analysis.fonts) {
    const family = font.resolvedFontFamily ?? font.fontFamily;
    if (font.source === 'environment' && update.environment?.has(fontFamilyKey(family))) continue;
    if (!update.loaded.some(candidate => candidate.fontFamily.toLowerCase() === family?.toLowerCase())) continue;
    font.status = font.resolvedFontFamily && font.resolvedFontFamily.toLowerCase() !== font.fontFamily?.toLowerCase() ? 'substituted' : 'available';
    font.source = update.references.find(ref => ref.fontFamily === font.fontFamily)?.source ?? 'application';
    if (font.status === 'substituted' && font.source === 'fallback') {
      const reference = update.references.find(ref => ref.fontFamily === font.fontFamily);
      const match = reference && rankPreviewFontCandidates(reference, update.loaded.filter(candidate => candidate.fontFamily === family))[0];
      font.substitutionReason = ['webfont', ...match?.reasons ?? []].join(', ');
      font.matchScore = match?.score; font.coverage = match?.coverage ?? 'unknown';
    }
  }
  analysis.warnings = [...new Set([...getPreviewFontWarnings(analysis.fonts), ...update.warnings])];
  return analysis;
}
