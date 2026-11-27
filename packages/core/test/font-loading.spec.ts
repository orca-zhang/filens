import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePreviewFonts } from '../src/preview/fonts';
import { analyzeLoadedPreviewFonts, bindPreviewFontLoading } from '../src/preview/font-loading';
import { createWebFontPacks } from '../src/preview/font-packs';
import { createPptxPreviewDriver } from '@filens/pptx';
import { readFixture } from './helpers';
import type { PreviewFontAsset, PreviewFontLoadingOptions, PreviewFontReference, PreviewFontRefresh, PreviewItemState, PreviewOptions, PreviewSession } from '../src/preview/types';

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const response = (byte = 1) => new Response(new Uint8Array([byte, 2, 3]));
let active: Set<FakeFace>;
let bindings: Array<ReturnType<typeof bindPreviewFontLoading>>;
let fetcher: ReturnType<typeof vi.fn>;
class FakeFace {
  status: FontFaceLoadStatus = 'unloaded';
  constructor(readonly family: string, readonly bytes: ArrayBuffer, readonly descriptors: FontFaceDescriptors) {}
  async load() { if (!new Uint8Array(this.bytes)[0]) throw new Error('Invalid font'); this.status = 'loaded'; return this; }
}

const loadHostFace = async (family: string) => {
  const face = await new FakeFace(family, new Uint8Array([1]).buffer, {}).load();
  active.add(face);
  return face;
};
const fontLoadEvent = (...fontfaces: FakeFace[]) => document.fonts.dispatchEvent(Object.assign(new Event('loadingdone'), { fontfaces }));

const asset = (family = 'Web Book', sources = ['https://first.example/font.woff2', 'https://second.example/font.woff2']): PreviewFontAsset => ({
  id: family, fontFamily: family, traits: { serif: true, style: 'text', weight: 400 }, sources: sources.map(url => ({ url }))
});
const config = (fonts = [asset()], options: PreviewFontLoadingOptions = {}): PreviewFontLoadingOptions => ({
  packs: [{ id: 'test', version: '1', fonts }], ...options
});
function session(options: PreviewFontLoadingOptions | boolean | undefined, refs: PreviewFontReference[] = [{ fontFamily: 'Missing Serif', text: 'Private text' }], extra: Pick<PreviewOptions, 'fontResolver'> = {}) {
  let references = refs;
  const handlers = new Map<string, Set<(value: any) => void>>();
  const state: PreviewItemState = { loading: false, error: null, family: 'paged', capabilities: {}, ...analyzePreviewFonts(refs, document, { substitute: true }) };
  const emit = (event = 'rendered') => handlers.get(event)?.forEach(handler => handler(state));
  const refresh = vi.fn(async (update: PreviewFontRefresh) => {
    references = update.references;
    Object.assign(state, analyzeLoadedPreviewFonts(update, document)); emit('statechange');
  });
  const value: PreviewSession = {
    load: async () => {}, destroy() {}, getState: () => state, getFontReferences: () => references, refreshFonts: refresh,
    on: (event, handler) => {
      let items = handlers.get(event); if (!items) handlers.set(event, items = new Set()); items.add(handler);
      return () => { items!.delete(handler); };
    }
  };
  const binding = bindPreviewFontLoading(value, document, { fontLoading: options, ...extra });
  bindings.push(binding);
  binding.reset();
  return { binding, refresh, state, emit };
}

beforeEach(() => {
  active = new Set(); bindings = [];
  Object.defineProperty(document, 'fonts', { configurable: true, value: Object.assign(new EventTarget(), {
    add: vi.fn((face: FakeFace) => active.add(face)), delete: vi.fn((face: FakeFace) => active.delete(face)),
    forEach: (handler: (face: FakeFace) => void) => active.forEach(handler)
  }) });
  vi.stubGlobal('FontFace', FakeFace);
  fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher);
  const context = { font: '', measureText: () => ({ width: [...active].some(face => context.font.includes(`"${face.family}"`)) ? 140 : 100 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  bindings.forEach(binding => binding.destroy());
  delete (document as unknown as { fonts?: unknown }).fonts;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('host font readiness', () => {
  it('coalesces relevant faces without downloads and discards obsolete events', async () => {
    const view = session(undefined, [{ fontFamily: 'Host Book' }, { fontFamily: 'Host Sans' }]);
    fontLoadEvent(await loadHostFace('Unused Face'));
    await Promise.resolve();
    expect(view.refresh).not.toHaveBeenCalled();
    const first = await loadHostFace('Host Book');
    const second = await loadHostFace('Host Sans');
    fontLoadEvent(first); fontLoadEvent(second);
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(view.state.fonts?.map(font => [font.status, font.source])).toEqual([['available', 'environment'], ['available', 'environment']]);
    fontLoadEvent(await loadHostFace('Host Book'));
    view.binding.reset();
    await Promise.resolve();
    expect(view.refresh).toHaveBeenCalledTimes(1);
    view.binding.destroy();
    expect(active.has(first)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('restores an original host face and retains explicit aliases and leased fallbacks', async () => {
    const view = session(config([asset()], { preferLocal: false }), [
      { fontFamily: 'Missing Serif' }, { fontFamily: 'Explicit Serif' }
    ], { fontResolver: ({ fontFamily }) => fontFamily === 'Explicit Serif' ? 'Web Book' : undefined });
    view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(view.state.fonts?.map(font => font.resolvedFontFamily)).toEqual(['Web Book', 'Web Book']);
    fontLoadEvent(...active);
    await Promise.resolve();
    expect(view.refresh).toHaveBeenCalledTimes(1);
    const original = await loadHostFace('Missing Serif');
    const alternate = await loadHostFace('Explicit Serif');
    fontLoadEvent(original, alternate);
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'available', source: 'environment', resolvedFontFamily: undefined });
    expect(view.state.fonts?.[1]).toMatchObject({ status: 'substituted', source: 'application', resolvedFontFamily: 'Web Book' });
    active.delete(original);
    view.binding.refresh();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(3));
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'substituted', source: 'fallback', resolvedFontFamily: 'Web Book' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('activates a resolver alias when its host face becomes available later', async () => {
    const fontResolver = vi.fn(() => 'Late Alias');
    const view = session({ packs: [] }, [{ fontFamily: 'Requested Face' }], { fontResolver });
    view.emit();
    await vi.waitFor(() => expect(fontResolver).toHaveBeenCalledTimes(1));
    expect(view.refresh).not.toHaveBeenCalled();
    fontLoadEvent(await loadHostFace('Late Alias'));
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'substituted', source: 'application', resolvedFontFamily: 'Late Alias' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('clears a failed webfont warning when the host supplies the authored face', async () => {
    fetcher.mockResolvedValue(new Response('', { status: 404 }));
    const view = session(config([asset()], { preferLocal: false, maxAttempts: 1 }), [{ fontFamily: 'Missing Serif' }]);
    view.emit();
    await vi.waitFor(() => expect(view.state.warnings.some(warning => warning.includes('could not be loaded'))).toBe(true));
    fontLoadEvent(await loadHostFace('Missing Serif'));
    await vi.waitFor(() => expect(view.state.fonts?.[0]).toMatchObject({ status: 'available', source: 'environment' }));
    expect(view.state.warnings).toEqual([]);
  });
});

describe('background font packs and adaptive source routing', () => {
  it('keeps network use opt-in and manifests free of font payloads', async () => {
    session(undefined).emit(); session(false).emit(); await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] });
    expect(packs.find(pack => pack.id === 'carlito')?.fonts[0].sources?.[0].url).toContain('@fontsource/carlito@5.2.6/files/');
    expect(packs.every(pack => pack.fonts.every(font => !font.data))).toBe(true);
  });

  it('loads pinned Emoji and math faces for matching requests, including the authored Emoji weight', async () => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm/'] }).filter(pack =>
      ['noto-color-emoji', 'noto-emoji', 'stix-two-math', 'noto-sans-math'].includes(pack.id));
    const view = session({ packs, concurrency: 1, preferLocal: false }, [
      { fontFamily: 'Segoe UI Emoji', text: '👩🏽‍🚀' },
      { fontFamily: 'Cambria Math', text: '∑∫√𝛼πℝ⨌' },
      { fontFamily: 'Segoe UI Emoji', text: '😀', traits: { weight: 700 } },
      { fontFamily: 'Missing Sans', text: 'Regular text 😀 ∑' },
      { fontFamily: 'Wingdings', text: '\uf0fc' }
    ]);
    view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://fonts.example/npm/@fontsource/noto-color-emoji@5.3.2/files/noto-color-emoji-emoji-400-normal.woff2',
      'https://fonts.example/npm/@fontsource/stix-two-math@5.3.0/files/stix-two-math-latin-400-normal.woff2',
      'https://fonts.example/npm/@fontsource/noto-emoji@5.3.2/files/noto-emoji-emoji-700-normal.woff2'
    ]);
    expect(view.state.fonts?.map(font => [font.fontFamily, font.resolvedFontFamily, font.status])).toEqual([
      ['Segoe UI Emoji', 'Noto Color Emoji', 'substituted'], ['Cambria Math', 'STIX Two Math', 'substituted'],
      ['Segoe UI Emoji', 'Noto Emoji', 'substituted'], ['Missing Sans', undefined, 'missing'], ['Wingdings', undefined, 'missing']
    ]);
    view.binding.destroy();
    expect(active.size).toBe(0);
  });

  it('selects only needed regional subsets and leases an overlapping subset for a later preview', async () => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] }).filter(pack => pack.id === 'noto-sans-jp');
    const options = { packs, maxAttempts: 1 };
    const load = (value: string) => session(options, [{ fontFamily: 'Noto Sans JP', text: value, textComplete: true }]);
    fetcher.mockImplementation(async (url: string) => url.endsWith('unicode.json')
      ? Response.json({ '[1]': 'U+6F22', '[2]': 'U+5B57', '[3]': 'U+6F22,U+20B9F', latin: 'U+0000-00FF' }) : response());
    const first = load('A漢𠮟');
    first.emit();
    await vi.waitFor(() => expect(first.refresh).toHaveBeenCalledTimes(1));
    expect([...active].map(face => face.descriptors.unicodeRange)).toEqual(['U+6F22,U+20B9F', 'U+0000-00FF']);
    const second = load('漢字');
    second.emit();
    await vi.waitFor(() => expect(second.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([
      'unicode.json', 'noto-sans-jp-3-400-normal.woff2', 'noto-sans-jp-latin-400-normal.woff2', 'noto-sans-jp-2-400-normal.woff2'
    ]);
    first.binding.destroy();
    expect([...active].map(face => face.descriptors.unicodeRange)).toEqual(['U+6F22,U+20B9F', 'U+5B57']);
    second.binding.destroy();
    expect(active.size).toBe(0);
  });

  it('uses the full face and releases an incomplete batch if a selected subset fails', async () => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] }).filter(pack => pack.id === 'noto-sans-tc');
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith('unicode.json')) return Response.json({ '[1]': 'U+6F22', latin: 'U+0041' });
      return url.endsWith('noto-sans-tc-latin-400-normal.woff2') ? new Response('', { status: 404 }) : response();
    });
    const view = session({ packs, maxAttempts: 1 }, [{ fontFamily: 'Noto Sans TC', text: 'A漢', textComplete: true }]);
    view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([
      'unicode.json', 'noto-sans-tc-1-400-normal.woff2', 'noto-sans-tc-latin-400-normal.woff2', 'noto-sans-tc-chinese-traditional-400-normal.woff2'
    ]);
    expect([...active].map(face => face.descriptors.unicodeRange)).toEqual([undefined]);
    expect(view.state.fonts?.[0]?.status).toBe('available');
  });

  it.each([
    { text: '👩🏽‍🚀', textComplete: true }, { text: '🇯🇵', textComplete: true },
    { text: '❤️', textComplete: true }, { text: '😀', textComplete: false }
  ])('keeps a full Emoji face for $text when subset coverage is uncertain', async reference => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] }).filter(pack => pack.id === 'noto-emoji');
    const view = session({ packs }, [{ fontFamily: 'Noto Emoji', ...reference }]);
    view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['noto-emoji-emoji-400-normal.woff2']);
  });

  it('uses the full color face when SVG fonts are unavailable', async () => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] }).filter(pack => pack.id === 'noto-color-emoji');
    const view = session({ packs }, [{ fontFamily: 'Noto Color Emoji', text: '😀', textComplete: true }]);
    view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual(['noto-color-emoji-emoji-400-normal.woff2']);
  });

  it('cancels a pending subset index when the last preview closes', async () => {
    const packs = createWebFontPacks({ mirrors: ['https://fonts.example/npm'] }).filter(pack => pack.id === 'noto-emoji');
    const pending = deferred<Response>();
    fetcher.mockReturnValueOnce(pending.promise);
    const options = { packs, maxAttempts: 1 };
    const reference = { fontFamily: 'Noto Emoji', text: '😀', textComplete: true };
    const first = session(options, [reference]), second = session(options, [reference]);
    first.emit(); second.emit();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    first.binding.destroy();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    second.binding.destroy();
    await vi.waitFor(() => expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true));
    pending.resolve(Response.json({ '[9]': 'U+1F600' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(first.refresh).not.toHaveBeenCalled();
    expect(second.refresh).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not block first preview, then publishes the loaded family and relayout update', async () => {
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const view = session(config()); view.emit();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(view.refresh).not.toHaveBeenCalled(); expect(view.state.fonts?.[0].status).toBe('missing');
    pending.resolve(response());
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(view.state.fonts?.[0]).toMatchObject({ fontFamily: 'Missing Serif', resolvedFontFamily: 'Web Book', status: 'substituted' });
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('Private text');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: 'force-cache', credentials: 'omit', referrerPolicy: 'no-referrer' });
    view.emit(); await Promise.resolve(); expect(fetcher).toHaveBeenCalledTimes(1);
    view.binding.destroy(); expect(active.size).toBe(0);
  });

  it.each(['network', 'http', 'decode'])('switches mirrors immediately after a %s failure', async failure => {
    if (failure === 'network') fetcher.mockRejectedValueOnce(new Error('CORS/network'));
    else fetcher.mockResolvedValueOnce(failure === 'http' ? new Response('', { status: 503 }) : response(0));
    const view = session(config()); view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://first.example/font.woff2', 'https://second.example/font.woff2']);
    expect(view.state.fonts?.[0].status).toBe('substituted');
  });

  it('tries another compatible family after all routes for the best family fail', async () => {
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    const view = session(config([
      asset('Web Book', ['https://first.example/missing.woff2']), asset('Backup Book', ['https://backup.example/font.woff2'])
    ], { maxAttempts: 1 }));
    view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(view.state.fonts?.[0]).toMatchObject({ resolvedFontFamily: 'Backup Book', status: 'substituted' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out a non-cooperative source and ignores its late completion', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const view = session(config([asset()], { timeoutMs: 20 })); view.emit();
    await vi.advanceTimersByTimeAsync(21);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(view.refresh).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(response()); await vi.runAllTimersAsync();
    expect(active.size).toBe(1); expect(view.refresh).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff with a bounded attempt count and retains fallback warnings', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const times: number[] = [];
    fetcher.mockImplementation(async () => { times.push(Date.now()); return new Response('', { status: 503 }); });
    const view = session(config([asset('Web Book', ['https://first.example/font.woff2'])], { backoffMs: 100, maxAttempts: 3, budgetMs: 2000 }));
    view.emit(); await vi.runAllTimersAsync();
    expect(times.map(time => time - times[0])).toEqual([0, 100, 300]);
    expect(view.state.fonts?.[0].status).toBe('missing');
    expect(view.state.warnings.join(' ')).toContain('local fallback fonts remain active');
    expect(active.size).toBe(0);
  });

  it('honors Retry-After and avoids retrying a permanent missing asset within the budget', async () => {
    vi.useFakeTimers();
    fetcher.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    const first = session(config([asset('Web Book', ['https://first.example/font.woff2'])], { budgetMs: 2000 })); first.emit();
    await vi.advanceTimersByTimeAsync(999); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2); expect(first.refresh).toHaveBeenCalledTimes(1);
    fetcher.mockClear().mockResolvedValue(new Response('', { status: 404 }));
    const second = session(config([asset('Other Book', ['https://third.example/missing.woff2'])], { budgetMs: 2000 })); second.emit();
    await vi.runAllTimersAsync(); expect(fetcher).toHaveBeenCalledTimes(1); expect(second.state.fonts?.[0].status).toBe('missing');
  });

  it('reuses route health across documents with the same configuration', async () => {
    const options = config(); fetcher.mockRejectedValueOnce(new Error('Down'));
    const first = session(options); first.emit(); await vi.waitFor(() => expect(first.refresh).toHaveBeenCalled()); first.binding.destroy();
    const second = session(options); second.emit(); await vi.waitFor(() => expect(second.refresh).toHaveBeenCalled());
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://first.example/font.woff2', 'https://second.example/font.woff2', 'https://second.example/font.woff2']);
  });

  it('hedges a slow healthy route, cancels the loser and learns the faster mirror', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const options = config([asset()], { hedgeDelayMs: 25, timeoutMs: 500 });
    const first = session(options); first.emit();
    await vi.advanceTimersByTimeAsync(24); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.refresh).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    first.binding.destroy();
    const second = session(options); second.emit(); await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[2][0]).toBe('https://second.example/font.woff2');
    expect(second.refresh).toHaveBeenCalledTimes(1);
    pending.resolve(response()); await vi.runAllTimersAsync();
    expect(active.size).toBe(1);
  });

  it('loads distinct required weights even when a regular face becomes available first', async () => {
    const normal = { ...asset('Web Book'), descriptors: { weight: '400' }, traits: { serif: true, weight: 400 } };
    const bold = { ...asset('Web Book', ['https://first.example/bold.woff2']), id: 'bold', descriptors: { weight: '700' }, traits: { serif: true, weight: 700 } };
    const view = session(config([normal, bold], { concurrency: 1 }), [
      { fontFamily: 'Web Book', traits: { serif: true, weight: 400 } },
      { fontFamily: 'Web Book', traits: { serif: true, weight: 700 } }
    ]);
    view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledTimes(2); expect(active.size).toBe(2);
    expect([...active].map(face => face.descriptors.weight)).toEqual(['400', '700']);
  });

  it('prefers same-origin sources on a cold route', async () => {
    const font = asset('Web Book', ['https://remote.example/font.woff2', '/local-font.woff2']);
    const view = session(config([font])); view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0]).toBe(new URL('/local-font.woff2', document.baseURI).href);
  });

  it('learns a faster remote mirror over a slow same-origin route', async () => {
    vi.useFakeTimers();
    fetcher.mockReturnValueOnce(deferred<Response>().promise);
    const options = config([asset('Web Book', ['/local-font.woff2', 'https://remote.example/font.woff2'])], { hedgeDelayMs: 25 });
    const first = session(options); first.emit();
    await vi.advanceTimersByTimeAsync(25);
    expect(first.refresh).toHaveBeenCalled(); first.binding.destroy();
    const second = session(options); second.emit(); await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      new URL('/local-font.woff2', document.baseURI).href, 'https://remote.example/font.woff2', 'https://remote.example/font.woff2'
    ]);
    expect(second.refresh).toHaveBeenCalled();
  });

  it('honors source priority before cold-route preference and forwards host authorization', async () => {
    const font = asset('Web Book');
    font.sources = [{ url: '/local-font.woff2', priority: 1 }, {
      url: 'https://host.example/font.woff2', priority: 0, credentials: 'include', headers: { Authorization: 'Bearer test-token' }
    }];
    const view = session(config([font])); view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(fetcher.mock.calls[0][0]).toBe('https://host.example/font.woff2');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'include', headers: { Authorization: 'Bearer test-token' } });
    expect(JSON.stringify(view.state)).not.toContain('test-token');
  });

  it('shares inflight work and font faces until the last owner releases them', async () => {
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const options = config(), first = session(options), second = session(options);
    first.emit(); second.emit(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    first.binding.destroy(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
    pending.resolve(response()); await vi.waitFor(() => expect(second.refresh).toHaveBeenCalled());
    expect(first.refresh).not.toHaveBeenCalled(); expect(active.size).toBe(1);
    second.binding.destroy(); expect(active.size).toBe(0);
  });

  it('retains a loaded full face when another preview opens and the first one closes', async () => {
    const options = config();
    const reference = [{ fontFamily: 'Web Book', traits: { weight: 400 } }];
    const first = session(options, reference);
    first.emit(); await vi.waitFor(() => expect(first.refresh).toHaveBeenCalled());
    const second = session(options, reference);
    second.emit(); await vi.waitFor(() => expect(second.refresh).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledTimes(1);
    first.binding.destroy(); expect(active.size).toBe(1);
    second.binding.destroy(); expect(active.size).toBe(0);
  });

  it.each(['reset', 'abort', 'destroy'])('discards stale font work after %s', async action => {
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const controller = new AbortController(), view = session(config()); view.binding.reset(controller.signal); view.emit();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    if (action === 'reset') view.binding.reset(); else if (action === 'destroy') view.binding.destroy(); else controller.abort();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    pending.resolve(response()); await new Promise(resolve => setTimeout(resolve, 0));
    expect(view.refresh).not.toHaveBeenCalled(); expect(active.size).toBe(0);
  });

  it('limits simultaneous downloads and keeps exact pack family selection', async () => {
    const pending = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    pending.forEach(item => fetcher.mockReturnValueOnce(item.promise));
    const names = ['One', 'Two', 'Three'];
    const view = session(config(names.map(name => asset(name)), { concurrency: 2 }), names.map(fontFamily => ({ fontFamily })));
    view.emit(); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    pending[0].resolve(response()); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    pending[1].resolve(response()); pending[2].resolve(response());
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled()); expect(active.size).toBe(3);
  });

  it('cancels an oversized streamed response and falls through to another mirror', async () => {
    const cancel = vi.fn();
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel })));
    const view = session(config([asset()], { maxFontBytes: 1024 })); view.emit();
    await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(cancel).toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2); expect(active.size).toBe(1);
  });

  it('uses loaded FontFace provenance even when canvas is unavailable', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const view = session(config()); view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'substituted', resolvedFontFamily: 'Web Book' });
  });

  it('falls back without network requests when FontFace is unavailable', async () => {
    vi.stubGlobal('FontFace', undefined);
    const view = session(config()); view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(fetcher).not.toHaveBeenCalled(); expect(view.state.fonts?.[0].status).toBe('missing');
  });

  it('does not download for already available families, embedded declarations or unmapped SHX', async () => {
    active.add(new FakeFace('Local', new Uint8Array([1]).buffer, {}));
    const view = session(config(), [{ fontFamily: 'Local' }, { fontFamily: 'Embedded Serif', embedded: true }, { fontFamily: 'CAD Serif', fontFile: 'romans.shx' }]);
    view.emit(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled(); expect(view.refresh).not.toHaveBeenCalled();
  });

  it('keeps an unclassified family with only a numeric weight on local fallback', async () => {
    const view = session(config(), [{ fontFamily: 'Unclassified Opaque Face', traits: { weight: 600 } }]);
    view.emit(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).not.toHaveBeenCalled(); expect(view.refresh).not.toHaveBeenCalled();
  });

  it('applies an available host alias and requests relayout without downloading', async () => {
    active.add(new FakeFace('Local', new Uint8Array([1]).buffer, {}));
    const fontResolver = vi.fn(() => 'Local');
    const view = session(config([]), undefined, { fontResolver });
    view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(view.refresh.mock.calls[0][0]).toMatchObject({ loaded: [], relayout: true });
    expect(view.state.fonts?.[0]).toMatchObject({ resolvedFontFamily: 'Local', source: 'application', status: 'substituted' });
    expect(fetcher).not.toHaveBeenCalled(); expect(fontResolver).toHaveBeenCalledTimes(1);
  });

  it('loads host resolver byte assets with application provenance and no network', async () => {
    const font = { ...asset('Host Book'), data: new Uint8Array([1, 2, 3]), sources: [] };
    const fontResolver = vi.fn(() => ({ fontFamily: 'Host Book', assets: [font] }));
    const view = session(config([]), undefined, { fontResolver });
    view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'substituted', source: 'application', resolvedFontFamily: 'Host Book' });
    expect(fetcher).not.toHaveBeenCalled(); expect(fontResolver).toHaveBeenCalledTimes(1);
  });

  it('loads an explicit SHX host mapping while preserving the original file reference', async () => {
    const view = session(config([asset('Web CAD')]), [{ fontFile: 'romans.shx', resolvedFontFamily: 'Web CAD', source: 'application' }]);
    view.emit(); await vi.waitFor(() => expect(view.refresh).toHaveBeenCalled());
    expect(view.state.fonts?.[0]).toMatchObject({ status: 'substituted', source: 'application', fontFile: 'romans.shx', resolvedFontFamily: 'Web CAD' });
  });

  it('rebuilds PPTX text after fonts load while preserving navigation, zoom and scroll', async () => {
    const pending = deferred<Response>(); fetcher.mockReturnValueOnce(pending.promise);
    const font = { ...asset('Carlito'), traits: { serif: false, style: 'text' as const, script: 'latin' as const, weight: 400 } };
    const host = document.body.appendChild(document.createElement('div'));
    const viewer = createPptxPreviewDriver().createSession(host, { fontLoading: config([font], { preferLocal: false }), fit: 'none', initialScale: 1.2 });
    try {
      const source = await readFixture('fixtures-text-theme.pptx');
      await viewer.load(source, { descriptor: { source } });
      const before = host.querySelector('.pptxv-slide');
      expect(before).not.toBeNull();
      viewer.setScale?.(1.5);
      const state = viewer.getState(), scroll = host.querySelector<HTMLElement>('.pptxv-scroll-area')!;
      scroll.scrollTop = 123;
      pending.resolve(response());
      await vi.waitFor(() => expect(viewer.getState().fonts?.some(font => font.resolvedFontFamily === 'Carlito')).toBe(true));
      expect(host.querySelector('.pptxv-slide')).not.toBe(before);
      expect(viewer.getState()).toMatchObject({ pageIndex: (state as any).pageIndex, scale: 1.5 });
      expect(scroll.scrollTop).toBe(123);
      expect([...host.querySelectorAll<HTMLElement>('span')].some(span => span.style.fontFamily.includes('Carlito'))).toBe(true);
    } finally { viewer.destroy(); host.remove(); }
    expect(active.size).toBe(0);
  });
});
