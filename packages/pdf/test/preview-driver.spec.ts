import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { webcrypto } from 'node:crypto';
import { createPdfPreviewDriver, createPdfPreviewRoutes } from '../src';
import { pdfPageCache } from '../src/page-cache';

const destroy = vi.fn(async () => undefined);
const render = vi.fn(() => ({ promise: Promise.resolve() }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    destroy,
    promise: Promise.resolve({
      numPages: 2,
      destroy,
      getPage: vi.fn(async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
        render
      }))
    })
  }))
}));

beforeAll(() => {
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  // These lifecycle tests mock PDF.js drawing; actual pixels are checked in Chromium.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

afterAll(() => {
  vi.restoreAllMocks();
});

describe('PDF preview driver', () => {
  it('reuses only matching painted pixels after validating each new document and releasing each worker', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const pdf = { numPages: 1, destroy, getPage: vi.fn(async () => page) };
    const sessions: ReturnType<ReturnType<typeof createPdfPreviewDriver>['createSession']>[] = [];
    const open = async (bytes: Uint8Array, password?: string) => {
      const session = createPdfPreviewDriver().createSession(document.createElement('div'));
      sessions.push(session);
      await session.load(bytes, { descriptor: { source: bytes, name: 'same-name.pdf', password } });
      return session;
    };
    try {
      vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(pdf), destroy } as never);
      const first = await open(new Uint8Array([1]));
      expect(render).toHaveBeenCalledTimes(1);
      first.destroy();
      expect(destroy).toHaveBeenCalledTimes(1);

      let release!: (value: unknown) => void;
      vi.mocked(getDocument).mockReturnValueOnce({ promise: new Promise(resolve => { release = resolve; }), destroy } as never);
      const reopening = open(new Uint8Array([1]));
      await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(2));
      expect(sessions.at(-1)!.getState().loading).toBe(true);
      release(pdf);
      const second = await reopening;
      expect(second.getState()).toMatchObject({ loading: false, pageCount: 1, error: null });
      expect(render).toHaveBeenCalledTimes(1);
      second.destroy();
      expect(destroy).toHaveBeenCalledTimes(2);

      vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(pdf), destroy } as never);
      (await open(new Uint8Array([2]))).destroy();
      expect(render).toHaveBeenCalledTimes(2);
      vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(pdf), destroy } as never);
      (await open(new Uint8Array([1]), 'secret')).destroy();
      expect(render).toHaveBeenCalledTimes(3);

      const failure = Promise.reject(new Error('Invalid PDF')); failure.catch(() => undefined);
      vi.mocked(getDocument).mockReturnValueOnce({ promise: failure, destroy } as never);
      await expect(open(new Uint8Array([1]))).rejects.toThrow('Invalid PDF');
      expect(sessions.at(-1)!.getState()).toMatchObject({ error: 'Invalid PDF', loading: false });
    } finally {
      for (const session of sessions) session.destroy();
      pdfPageCache.clear();
      vi.unstubAllGlobals();
    }
  });

  it('exposes attachment payloads and rejects reads after the parent PDF closes', async () => {
    const content = new TextEncoder().encode('PDF attachment text');
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getAttachments = vi.fn(async () => ({ attachment: { filename: 'C:\\temp\\notes.txt', content } }));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: async () => page, getAttachments }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      expect(getAttachments).not.toHaveBeenCalled();
      const attachments = await session.getAttachments!();
      expect(attachments).toMatchObject([{ name: 'notes.txt', size: content.length }]);
      expect(await attachments[0].read()).toMatchObject({ name: 'notes.txt', source: content });
      session.destroy();
      await expect(attachments[0].read()).rejects.toMatchObject({ name: 'AbortError' });
    } finally { session.destroy(); }
  });

  it('passes document passwords to PDF.js without trimming them', async () => {
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array([37, 80]), { descriptor: { source: new Uint8Array(), password: ' 密码🔐 ' } });
      expect(getDocument).toHaveBeenCalledWith({ data: new Uint8Array([37, 80]), password: ' 密码🔐 ' });
      expect(session.getState()).not.toHaveProperty('password');
    } finally { session.destroy(); }
  });

  it.each([[1, 'password_required'], [2, 'password_invalid']])('maps PDF.js password reason %s to %s', async (code, expected) => {
    const task = { promise: Promise.reject(Object.assign(new Error('Password needed'), { name: 'PasswordException', code })), destroy };
    // Observe the rejection before the asynchronous source read completes.
    task.promise.catch(() => undefined);
    vi.mocked(getDocument).mockReturnValueOnce(task as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await expect(session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } })).rejects.toMatchObject({ code: expected });
    } finally { session.destroy(); }
  });
  it('discovers renderer font identifiers after rendering without inventing original names or embedded provenance', async () => {
    const getTextContent = vi.fn(async () => ({ styles: { g_d0_f1: { fontFamily: 'serif', ascent: 0.8, descent: -0.2, vertical: false } } }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render, getTextContent };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().fonts).toMatchObject([{ fontId: 'g_d0_f1', fontFamily: 'serif', status: 'unknown', source: 'unknown' }]));
      expect(getTextContent).toHaveBeenCalledTimes(1);
      expect(session.getState().warnings).toEqual([]);
      session.destroy(); expect(session.getState().fonts).toEqual([]);
    } finally { session.destroy(); }
  });

  it('does not block the preview on slow font metadata or publish results from a replaced document', async () => {
    let resolve!: (value: unknown) => void;
    const getTextContent = vi.fn(() => new Promise(yes => { resolve = yes; }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render, getTextContent };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
      expect(session.getState().loading).toBe(false);
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
      resolve({ styles: { obsolete: { fontFamily: 'Old Serif' } } });
      await Promise.resolve(); await Promise.resolve();
      expect(session.getState().fonts).toEqual([]);
      expect(session.getState().title).toBe('current.pdf');
    } finally { session.destroy(); }
  });

  it('keeps a rendered PDF usable when optional font metadata extraction fails', async () => {
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render,
      getTextContent: vi.fn(async () => { throw new Error('Metadata failed'); }) };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().warnings).toContain('Font metadata is unavailable for PDF page 1.'));
      expect(session.getState()).toMatchObject({ loading: false, error: null });
    } finally { session.destroy(); }
  });

  it('exposes direct PDF routes and driver support', () => {
    const routes = createPdfPreviewRoutes();
    const pdfRoute = routes.find((route) => route.extensions.includes('pdf'));
    const driver = createPdfPreviewDriver();

    expect(pdfRoute).toMatchObject({
      targetFormat: 'pdf',
      family: 'paged',
      driverId: 'pdf'
    });
    expect(pdfRoute?.conversion).toBeUndefined();
    expect(driver.supports('pdf')).toBe(true);
    expect(driver.supports('.PDF')).toBe(true);
    expect(driver.supports('pptx')).toBe(false);
  });

  it('renders PDF pages into borderless canvases', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const session = createPdfPreviewDriver().createSession(host, {
      initialScale: 1,
      fit: 'contain',
      virtual: false
    });
    const renderedStates: unknown[] = [];

    session.on('rendered', (state) => {
      renderedStates.push(state);
    });

    await session.load(new Uint8Array([37, 80, 68, 70]), {
      descriptor: {
        source: new Uint8Array([37, 80, 68, 70]),
        name: 'sample.pdf',
        extension: 'pdf',
        contentType: 'application/pdf'
      }
    });

    const pages = host.querySelectorAll('canvas.pdfv-page');
    expect(pages).toHaveLength(2);
    expect(host.querySelector('iframe')).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);

    expect(session.getState()).toMatchObject({
      family: 'paged',
      loading: false,
      pageIndex: 0,
      pageCount: 2,
      capabilities: {
        paged: true,
        print: true
      }
    });
    expect(renderedStates).toHaveLength(1);

    session.destroy();
    expect(destroy).toHaveBeenCalled();
    host.remove();
  });

  it('renders only nearby pages, updates page controls and releases distant canvases', async () => {
    mockLayout();
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'long.pdf' } });
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(100);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    const first = host.querySelector('canvas')!;
    session.goToPage?.(50);
    await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="50"][data-rendered="true"]')).not.toBeNull());
    expect(session.getState().pageIndex).toBe(50);
    expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(3);
    expect(first.width).toBe(0);
    session.next?.(); expect(session.getState().pageIndex).toBe(51);
    session.prev?.(); expect(session.getState().pageIndex).toBe(50);
    session.goToPage?.(NaN); expect(session.getState().pageIndex).toBe(50);
    session.destroy();
  });

  it('renders every visible page at low zoom and supports scale and fit changes', async () => {
    mockLayout();
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host, { initialScale: 0.1 });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 20, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
    await vi.waitFor(() => {
      for (let index = 0; index < 8; index++) expect(host.querySelector(`canvas[data-page-index="${index}"][data-rendered="true"]`)).not.toBeNull();
    });
    session.setScale?.(2);
    await vi.waitFor(() => expect(host.querySelector('canvas')?.width).toBe(900));
    session.fit?.('width');
    await vi.waitFor(() => expect(host.querySelector('canvas')?.width).toBe(1600));
    session.setScale?.(NaN); expect(session.getState().scale).toBe(2);
    session.destroy();
  });

  it('waits for the first painted page but reveals it before other visible pages finish loading', async () => {
    mockLayout();
    let finishFirst!: () => void, finishSecond!: (value: unknown) => void;
    const firstDraw = new Promise<void>(resolve => { finishFirst = resolve; });
    const secondPage = new Promise(resolve => { finishSecond = resolve; });
    render.mockReturnValueOnce({ promise: firstDraw } as never);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getPage = vi.fn((number: number) => number === 2 ? secondPage : Promise.resolve(page));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 3, destroy, getPage }), destroy } as never);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { initialScale: 0.1 });
    const ready = vi.fn(); session.on('rendered', ready);
    try {
      const loading = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
      expect(ready).not.toHaveBeenCalled();
      expect(session.getState().loading).toBe(true);
      finishFirst(); await loading;
      expect(host.querySelector('canvas[data-page-index="0"][data-rendered="true"]')).not.toBeNull();
      expect(ready).toHaveBeenCalledTimes(1);
      expect(session.getState().loading).toBe(false);
      await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
      expect(host.querySelector('canvas[data-page-index="1"]')).toBeNull();
      finishSecond(page);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="1"][data-rendered="true"]')).not.toBeNull());
      expect(ready).toHaveBeenCalledTimes(1);
    } finally { finishFirst(); finishSecond(page); session.destroy(); }
  });

  it('keeps non-virtual previews loading until every page is painted', async () => {
    let finishLast!: () => void;
    const lastDraw = new Promise<void>(resolve => { finishLast = resolve; });
    render.mockReturnValueOnce({ promise: Promise.resolve() }).mockReturnValueOnce({ promise: lastDraw });
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { virtual: false });
    const ready = vi.fn(); session.on('rendered', ready);
    try {
      const loading = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
      expect(host.querySelector('canvas[data-page-index="0"][data-rendered="true"]')).not.toBeNull();
      expect(session.getState().loading).toBe(true);
      expect(ready).not.toHaveBeenCalled();
      finishLast(); await loading;
      expect(host.querySelector('canvas[data-page-index="1"][data-rendered="true"]')).not.toBeNull();
      expect(session.getState().loading).toBe(false);
      expect(ready).toHaveBeenCalledTimes(1);
    } finally { finishLast(); session.destroy(); }
  });

  it('matches full visibility scans at page edges, gaps and mixed heights using bounded layout reads', async () => {
    mockLayout();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { fit: 'none' });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 2048, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      const root = host.querySelector<HTMLElement>('.pdfv-preview')!;
      const slots = [...host.querySelectorAll<HTMLElement>('.pdfv-page-slot')];
      const starts: number[] = [];
      let top = 0;
      slots.forEach((slot, index) => {
        starts.push(top);
        const height = [80, 800, 1600][index % 3];
        slot.style.height = `${height}px`;
        top += height + 16;
      });
      const positions = new Map(slots.map((slot, index) => [slot, starts[index]]));
      const rects = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      rects.mockImplementation(function () {
        const start = positions.get(this as HTMLElement);
        const top = start === undefined ? 0 : start - root.scrollTop;
        const height = start === undefined ? 600 : parseFloat((this as HTMLElement).style.height);
        return { top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} };
      });
      // Exercise the driver's selection synchronously, before background frames
      // replace the deliberately mixed layout with real page dimensions.
      const selection = session as unknown as { visiblePages(): number[]; state: { loading: boolean; pageIndex: number } };
      for (const loading of [true, false]) for (const scroll of [0, 79.5, 80, 95.5, 96, ...[400, 1000, 2047].flatMap(index => [starts[index] - 600, starts[index], starts[index] + 80])]) {
        root.scrollTop = scroll;
        selection.state.loading = loading;
        selection.state.pageIndex = 19;
        const margin = loading ? 0 : 300;
        const expected: number[] = [];
        let active = 19, overlap = -1;
        for (let index = 0; index < slots.length; index++) {
          const start = starts[index] - scroll;
          const end = start + parseFloat(slots[index].style.height);
          if (end > -margin && start < 600 + margin) expected.push(index);
          const visible = Math.min(end, 600) - Math.max(start, 0);
          if (visible > overlap) { active = index; overlap = visible; }
        }
        rects.mockClear();
        expect(selection.visiblePages()).toEqual(expected);
        expect(selection.state.pageIndex).toBe(active);
        expect(rects.mock.calls.length).toBeLessThan(30);
      }
    } finally { session.destroy(); }
  });

  it('does not start PDF.js after a file read is aborted', async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const source = new Blob([]);
    Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) });
    const controller = new AbortController();
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    const pending = session.load(source, { descriptor: { source }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort(); release(new ArrayBuffer(0));
    await rejected;
    expect(getDocument).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ loading: false, error: null, pageCount: 0 });
    session.destroy();
  });

  it('cancels in-flight drawing and renders the current scale without an error', async () => {
    mockLayout();
    let reject!: (error: Error) => void;
    const cancel = vi.fn(() => reject(Object.assign(new Error('Cancelled'), { name: 'RenderingCancelledException' })));
    render.mockReturnValueOnce({ promise: new Promise<void>((_, fail) => { reject = fail; }), cancel } as never);
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host), errors = vi.fn();
    session.on('error', errors);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    session.setScale?.(2);
    await pending;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(host.querySelector('canvas[data-rendered="true"]')?.getAttribute('width')).toBe('900');
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });

  it('destroys a pending PDF.js loading task on abort without emitting an error', async () => {
    let reject!: (error: Error) => void;
    const task = { promise: new Promise((_, fail) => { reject = fail; }), destroy: vi.fn(async () => reject(new Error('Loading aborted'))) };
    vi.mocked(getDocument).mockReturnValueOnce(task as never);
    const controller = new AbortController(), errors = vi.fn();
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    session.on('error', errors);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() }, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalled());
    controller.abort(); await rejected;
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });

  it('ignores a stale page result after switching documents', async () => {
    let release!: (value: unknown) => void;
    const oldPage = new Promise(resolve => { release = resolve; });
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage: () => oldPage }), destroy } as never);
    const host = document.createElement('div'), session = createPdfPreviewDriver().createSession(host);
    const pending = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
    release({}); await pending;
    expect(session.getState()).toMatchObject({ title: 'current.pdf', pageCount: 2, error: null });
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(2);
    session.destroy();
  });

  it('ignores an old background page failure after a new document loads', async () => {
    mockLayout();
    let reject!: (error: Error) => void;
    const delayedPage = new Promise((_, fail) => { reject = fail; });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getPage = vi.fn((number: number) => number === 1 ? Promise.resolve(page) : delayedPage);
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 3, destroy, getPage }), destroy } as never);
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host), errors = vi.fn();
    session.on('error', errors);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
    reject(new Error('Old worker failed'));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(session.getState()).toMatchObject({ title: 'current.pdf', error: null, loading: false });
    expect(errors).not.toHaveBeenCalled();
    session.destroy();
  });
});

function mockLayout(): void {
  const offset = (element: HTMLElement) => {
    let top = 0;
    for (const sibling of Array.from(element.parentElement?.children ?? [])) {
      if (sibling === element) break;
      top += parseFloat((sibling as HTMLElement).style.height || '0') + 16;
    }
    return top;
  };
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return (this as HTMLElement).classList.contains('pdfv-preview') ? 800 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return (this as HTMLElement).classList.contains('pdfv-preview') ? 600 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function () { return offset(this as HTMLElement); });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const element = this as HTMLElement;
    const top = element.classList.contains('pdfv-page-slot') ? offset(element) - (element.parentElement?.scrollTop ?? 0) : 0;
    const height = element.classList.contains('pdfv-page-slot') ? parseFloat(element.style.height) : 600;
    return { top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} };
  });
}
