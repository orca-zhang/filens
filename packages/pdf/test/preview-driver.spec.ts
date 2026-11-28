import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getDocument, GlobalWorkerOptions, type PDFDataRangeTransport } from 'pdfjs-dist';
import { webcrypto } from 'node:crypto';
import { createPdfPreviewDriver, createPdfPreviewRoutes } from '../src';
import { pdfPageCache } from '../src/page-cache';
import type { PdfPageLayout } from '../src/page-layout';
import { budgetPdfRasters, PDF_MAX_RASTER_PIXELS, PDF_WINDOW_RASTER_PIXELS, sizePdfRaster } from '../src/page-raster';

const destroy = vi.fn(async () => undefined);
const render = vi.fn(() => ({ promise: Promise.resolve() }));
const workerSource = vi.hoisted(() => ({ value: 'pdf-worker.mjs' as string | (() => string) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ get default() { return workerSource.value; } }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AbortException: class extends Error { name = 'AbortException'; },
  AnnotationMode: { DISABLE: 0 },
  OPS: { dependency: 1 },
  PDFDataRangeTransport: class {
    constructor(readonly length: number) {}
    onDataRange() {}
  },
  TextLayer: vi.fn(function ({ textContentSource }: { textContentSource: ReadableStream }) {
    const reader = textContentSource.getReader();
    return {
      textDivs: [],
      async render() { while (!(await reader.read()).done) { /* Consume chunks for the font inventory. */ } },
      cancel() { void reader.cancel().catch(() => {}); }
    };
  }),
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
  workerSource.value = 'pdf-worker.mjs';
  // These lifecycle tests mock PDF.js drawing; actual pixels are checked in Chromium.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

afterAll(() => {
  vi.restoreAllMocks();
});

function streamPageText(read: () => Promise<unknown>) {
  return () => new ReadableStream({
    async pull(controller) {
      const content = await read() as object;
      controller.enqueue({ items: [], ...content });
      controller.close();
    }
  }, { highWaterMark: 0 });
}

describe('PDF preview driver', () => {
  it.each([
    ['https://example.test/demo.pdf', true, true],
    ['./demo.pdf', true, true],
    ['https://example.test/demo.pdf', false, false],
    ['blob:http://localhost/demo', true, false],
  ])('uses demand ranges for virtual HTTP(S) sources (%s, virtual %s)', async (source, virtual, ranges) => {
    const session = createPdfPreviewDriver().createSession(document.createElement('div'), { virtual });
    try {
      await session.load(source, { descriptor: { source } });
      const options = vi.mocked(getDocument).mock.calls[0][0];
      expect(options).toMatchObject({ url: source });
      if (ranges) expect(options).toMatchObject({ disableStream: true, disableAutoFetch: true });
      else {
        expect(options).not.toHaveProperty('disableStream');
        expect(options).not.toHaveProperty('disableAutoFetch');
      }
    } finally { session.destroy(); }
  });

  it.each([
    [128 * 1024, true, false], [128 * 1024 + 1, true, true], [128 * 1024 + 1, false, false],
  ])('selects local ranges for eligible Blob inputs (%s bytes, virtual %s)', async (size, virtual, ranges) => {
    const source = new Blob([new Uint8Array(size)]);
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(size));
    Object.defineProperty(source, 'arrayBuffer', { value: arrayBuffer });
    const session = createPdfPreviewDriver().createSession(document.createElement('div'), { virtual });
    try {
      await session.load(source, { descriptor: { source } });
      const options = vi.mocked(getDocument).mock.calls[0][0];
      if (ranges) {
        expect(options).toMatchObject({ range: { length: size }, disableStream: true, disableAutoFetch: true });
        expect(options).not.toHaveProperty('data');
        expect(arrayBuffer).not.toHaveBeenCalled();
      } else {
        expect(options).toHaveProperty('data.byteLength', size);
        expect(options).not.toHaveProperty('range');
        expect(arrayBuffer).toHaveBeenCalledOnce();
      }
    } finally { session.destroy(); }
  });

  it.each(['opening', 'rendered'] as const)('reports an unreadable local range while %s rather than hanging', async stage => {
    const source = new Blob([new Uint8Array(256 * 1024)]);
    const error = new DOMException('The local PDF can no longer be read.', 'NotReadableError');
    vi.spyOn(source, 'slice').mockImplementationOnce(() => { throw error; });
    if (stage === 'opening') {
      vi.mocked(getDocument).mockImplementationOnce(input => {
        queueMicrotask(() => (input as { range: PDFDataRangeTransport }).range.requestDataRange(0, 64 * 1024));
        return { promise: new Promise(() => {}), destroy } as never;
      });
    }
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    const report = vi.fn();
    session.on('error', report);
    try {
      const opened = session.load(source, { descriptor: { source } });
      if (stage === 'opening') await expect(opened).rejects.toMatchObject({ message: error.message });
      else {
        await opened;
        const { range } = vi.mocked(getDocument).mock.calls[0][0] as { range: PDFDataRangeTransport };
        range.requestDataRange(64 * 1024, 128 * 1024);
      }
      expect(session.getState()).toMatchObject({ loading: false, pageCount: 0, error: error.message });
      expect(report).toHaveBeenCalledOnce();
      expect(destroy).toHaveBeenCalledOnce();
    } finally { session.destroy(); }
  });

  it('resolves a deferred worker URL only when loading a PDF and supports reopening it', async () => {
    const resolve = vi.fn(() => 'blob:http://localhost/pdf-worker');
    workerSource.value = resolve;
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      expect(resolve).not.toHaveBeenCalled();
      for (let index = 0; index < 2; index++) {
        await session.load(new Uint8Array([37, 80]), { descriptor: { source: new Uint8Array(), name: 'sample.pdf' } });
        expect(GlobalWorkerOptions.workerSrc).toBe('blob:http://localhost/pdf-worker');
      }
      expect(resolve).toHaveBeenCalledTimes(2);
    } finally { session.destroy(); }
  });

  it('reuses only matching painted pixels after validating each new document and releasing each worker', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getMetadata = vi.fn(async () => ({ info: { EncryptFilterName: null } }));
    const pdf = { numPages: 1, destroy, getPage: vi.fn(async () => page), getMetadata };
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
      expect(getMetadata).toHaveBeenCalledTimes(3);

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

  it.each(['encrypted', 'unknown', 'unreadable'])('renders an %s PDF on each open without sharing its pixels', async state => {
    vi.stubGlobal('crypto', webcrypto);
    const read = vi.spyOn(pdfPageCache, 'read');
    const write = vi.spyOn(pdfPageCache, 'write');
    const getMetadata = vi.fn(async () => {
      if (state === 'unreadable') throw new Error('Invalid metadata');
      return { info: state === 'encrypted' ? { EncryptFilterName: 'Standard' } : {} };
    });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const pdf = { numPages: 1, getPage: async () => page, getMetadata };
    const source = new Uint8Array([1]);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      for (let i = 0; i < 2; i++) {
        vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(pdf), destroy } as never);
        await session.load(source, { descriptor: { source } });
        expect(session.getState()).toMatchObject({ loading: false, pageCount: 1, error: null });
      }
      expect(getMetadata).toHaveBeenCalledTimes(2);
      expect(render).toHaveBeenCalledTimes(2);
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally { session.destroy(); pdfPageCache.clear(); vi.unstubAllGlobals(); }
  });

  it('stops waiting for cache eligibility when the PDF is replaced', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const write = vi.spyOn(pdfPageCache, 'write');
    let finishMetadata!: (metadata: { info: { EncryptFilterName: null } }) => void;
    const getMetadata = vi.fn(() => new Promise(resolve => { finishMetadata = resolve; }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const pdf = { numPages: 1, getPage: async () => page, getMetadata };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve(pdf), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    const source = new Uint8Array([1]);
    const current = 'https://example.test/current.pdf';
    try {
      const pending = session.load(source, { descriptor: { source, name: 'old.pdf' } });
      await vi.waitFor(() => expect(getMetadata).toHaveBeenCalledOnce());
      await session.load(current, { descriptor: { source: current, name: 'current.pdf' } });
      await pending;
      finishMetadata({ info: { EncryptFilterName: null } });
      await Promise.resolve();
      expect(session.getState()).toMatchObject({ title: 'current.pdf', loading: false, error: null });
      expect(destroy).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
    } finally { session.destroy(); pdfPageCache.clear(); vi.unstubAllGlobals(); }
  });

  it.each([null, 'Standard'])('classifies attachments from a PDF with encryption filter %s', async filter => {
    const content = new TextEncoder().encode('PDF attachment text');
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getAttachments = vi.fn(async () => ({ attachment: { filename: 'C:\\temp\\notes.txt', content } }));
    const getMetadata = async () => ({ info: { EncryptFilterName: filter } });
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: async () => page, getAttachments, getMetadata }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      expect(getAttachments).not.toHaveBeenCalled();
      const attachments = await session.getAttachments!();
      expect(attachments).toMatchObject([{ name: 'notes.txt', size: content.length }]);
      const attachment = await attachments[0].read();
      expect(attachment).toMatchObject({ name: 'notes.txt', source: content });
      expect(attachment.sensitive).toBe(filter === null ? undefined : true);
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
    const readText = vi.fn(async () => ({ styles: { g_d0_f1: { fontFamily: 'serif', ascent: 0.8, descent: -0.2, vertical: false } } }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
      render, streamTextContent: streamPageText(readText) };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().fonts).toMatchObject([{ fontId: 'g_d0_f1', fontFamily: 'serif', status: 'unknown', source: 'unknown' }]));
      expect(readText).toHaveBeenCalledTimes(1);
      expect(session.getState().warnings).toEqual([]);
      session.destroy(); expect(session.getState().fonts).toEqual([]);
    } finally { session.destroy(); }
  });

  it('reads the rendered font name and provenance without enabling PDF.js font debugging or retaining bytes', async () => {
    const fonts = new Map([
      ['embedded', { name: 'ABCDEF+ReportSans', missingFile: false, mimetype: 'font/opentype', disableFontFace: false,
        get data(): never { throw new Error('Font bytes must not be read'); } }],
      ['fallback', { name: 'Helvetica-Bold', missingFile: true, mimetype: 'null' }],
      ['invalid', { name: 'InvalidPDFjsFont_serif_1', isInvalidPDFjsFont: true }]
    ]);
    const readText = vi.fn(async () => ({ styles: {
      embedded: { fontFamily: 'sans-serif' }, fallback: { fontFamily: 'sans-serif' }, invalid: { fontFamily: 'serif' }
    } }));
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
      render, streamTextContent: streamPageText(readText), commonObjs: fonts
    };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: async () => page }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      await vi.waitFor(() => expect(session.getState().fonts).toMatchObject([
        { fontId: 'embedded', fontFamily: 'ABCDEF+ReportSans', source: 'embedded', status: 'available', embedded: true },
        { fontId: 'fallback', fontFamily: 'Helvetica-Bold', source: 'unknown', status: 'unknown' },
        { fontId: 'invalid', fontFamily: 'serif', source: 'unknown', status: 'unknown' }
      ]));
      expect(session.getState().fonts?.[1].embedded).toBeUndefined();
      expect(vi.mocked(getDocument).mock.calls[0][0]).not.toHaveProperty('fontExtraProperties');
      expect(readText).toHaveBeenCalledOnce();
    } finally { session.destroy(); }
  });

  it('enriches a cached first-page inventory when an operator dependency arrives after zoom', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
    const font = { name: 'ABCDEF+ReportSans', missingFile: false, mimetype: 'font/opentype', disableFontFace: false };
    const readText = async () => ({ styles: { f1: { fontFamily: 'sans-serif' }, invisible: { fontFamily: 'serif' } } });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
      render, streamTextContent: streamPageText(readText) };
    const task = (page: unknown) => ({ promise: Promise.resolve({
      numPages: 1, destroy, getPage: async () => page, getMetadata: async () => ({ info: { EncryptFilterName: null } })
    }), destroy }) as never;
    vi.mocked(getDocument).mockReturnValueOnce(task({ ...page, commonObjs: new Map([['f1', font]]) }));
    let resolveFont: (() => void) | undefined;
    let ready = false;
    const commonObjs = {
      has: (id: string) => id === 'f1' && ready,
      get: vi.fn((_id: string, callback?: () => void) => { if (callback) resolveFont = callback; else return font; })
    };
    const getOperatorList = vi.fn(async () => ({ fnArray: [1], argsArray: [['f1']] }));
    vi.mocked(getDocument).mockReturnValueOnce(task({ ...page, commonObjs, getOperatorList }));
    const source = new Uint8Array([37, 80, 68, 70, 25]);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(source, { descriptor: { source } });
      await session.load(source, { descriptor: { source } });
      await vi.waitFor(() => expect(resolveFont).toBeTypeOf('function'));
      expect(render).toHaveBeenCalledOnce();
      expect(getOperatorList).toHaveBeenCalledWith({ annotationMode: 0 });
      expect(session.getState()).toMatchObject({ loading: false, fonts: [{ fontId: 'f1', fontFamily: 'sans-serif' }, { fontId: 'invisible', fontFamily: 'serif' }] });
      session.setScale?.(2);
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
      ready = true;
      resolveFont!();
      expect(session.getState().fonts?.[0]).toMatchObject({ fontFamily: 'ABCDEF+ReportSans', embedded: true });
      expect(getOperatorList).toHaveBeenCalledOnce();
      expect(commonObjs.get.mock.calls.map(([id]) => id)).toEqual(['f1', 'f1']);
      session.destroy();
      expect(session.getState().fonts).toEqual([]);
    } finally { session.destroy(); pdfPageCache.clear(); vi.unstubAllGlobals(); }
  });

  it('does not block the preview on slow font metadata or publish results from a replaced document', async () => {
    let resolve!: (value: unknown) => void;
    const readText = vi.fn(() => new Promise(yes => { resolve = yes; }));
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
      render, streamTextContent: streamPageText(readText) };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    const session = createPdfPreviewDriver().createSession(document.createElement('div'));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'old.pdf' } });
      await vi.waitFor(() => expect(readText).toHaveBeenCalledOnce());
      const resolveOld = resolve;
      expect(session.getState().loading).toBe(false);
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'current.pdf' } });
      resolveOld({ styles: { obsolete: { fontFamily: 'Old Serif' } } });
      await Promise.resolve(); await Promise.resolve();
      expect(session.getState().fonts).toEqual([]);
      expect(session.getState().title).toBe('current.pdf');
    } finally { session.destroy(); }
  });

  it('keeps a rendered PDF usable when optional font metadata extraction fails', async () => {
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render,
      streamTextContent: streamPageText(async () => { throw new Error('Metadata failed'); }) };
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

  it('bounds eager PDF canvas pixels and sides at the full displayed page size', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { initialScale: 1, fit: 'none', virtual: false });
    const page = (width: number, height: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale, scale }),
      render
    });
    const pages = [page(12_000, 16_000), page(18_000, 100)];
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 2, destroy, getPage: vi.fn(async index => pages[index - 1]) }), destroy
    } as never);
    try {
      const source = new Uint8Array();
      await session.load(source, { descriptor: { source, name: 'large-pages.pdf' } });
      const [tall, wide] = host.querySelectorAll<HTMLCanvasElement>('canvas.pdfv-page');
      expect(tall.width * tall.height).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(tall.width * tall.height).toBeGreaterThan(8_000_000);
      expect(tall.style.height).toBe('16000px');
      expect(wide.width).toBe(8192);
      expect(wide.style.width).toBe('18000px');
      expect(host.querySelector('.pdfv-page-detail')).toBeNull();
      expect(session.getState().capabilities.print).toBe(true);
    } finally { session.destroy(); }
  });

  it('shares bitmap pixels across visible PDF pages and uses spare space for nearby pages', () => {
    const full = PDF_MAX_RASTER_PIXELS;
    const current = { index: 1, pixels: full };
    const visible = [{ index: 2, pixels: full }, { index: 3, pixels: full }, { index: 4, pixels: 1 }];
    const spare = [{ index: 5, pixels: 100 }];
    const budgets = budgetPdfRasters(current, visible, spare);
    expect(budgets.get(1)).toBe(full);
    expect(budgets.get(4)).toBe(1);
    expect(budgets.has(5)).toBe(false);
    expect(budgets.get(2)).toBe(budgets.get(3));
    expect([...budgets.values()].reduce((sum, pixels) => sum + pixels, 0)).toBeLessThanOrEqual(PDF_WINDOW_RASTER_PIXELS);
    expect(budgetPdfRasters(current, [{ index: 2, pixels: 2 }], spare))
      .toEqual(new Map([[1, full], [2, 2], [5, 100]]));
  });

  it.each([[100_000, 0.01, 7, 1], [0.01, 100_000, 1, 7]])('caps narrow PDF rasters at seven pixels', (width, height, x, y) => {
    expect(sizePdfRaster(width, height, 2, 7)).toEqual({ width: x, height: y, limited: true });
  });

  it('cancels displaced PDF detail while keeping the whole-page raster', async () => {
    mockLayout();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { initialScale: 20, fit: 'none' });
    let rejectDetail!: (reason: Error) => void;
    const cancel = vi.fn(() => rejectDetail(new Error('Detail cancelled')));
    const pending = new Promise<void>((_, reject) => { rejectDetail = reject; });
    const startDetail = vi.fn(() => ({ promise: Promise.resolve() })).mockReturnValueOnce({ promise: pending, cancel } as never);
    const page = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
      render: ({ canvas }: { canvas: HTMLCanvasElement }) => canvas.classList.contains('pdfv-page-detail') ? startDetail() : render()
    };
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: Promise.resolve({ numPages: 1, destroy, getPage: vi.fn(async () => page) }), destroy
    } as never);
    try {
      const source = new Uint8Array();
      await session.load(source, { descriptor: { source } });
      await vi.waitFor(() => expect(startDetail).toHaveBeenCalledOnce());
      const base = host.querySelector<HTMLCanvasElement>('.pdfv-page')!;
      const before = host.querySelector<HTMLCanvasElement>('.pdfv-page-detail')!;
      const slot = host.querySelector<HTMLElement>('.pdfv-page-slot')!;
      const initial = slot.getBoundingClientRect();
      Object.defineProperty(slot, 'getBoundingClientRect', {
        value: () => ({ ...initial, x: -1600, left: -1600, right: 10400, width: 12000 })
      });
      host.querySelector('.pdfv-preview')!.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-detail:not([hidden])')).not.toBeNull());
      expect(cancel).toHaveBeenCalledOnce();
      expect(startDetail).toHaveBeenCalledTimes(2);
      expect([before.width, before.height]).toEqual([0, 0]);
      expect(host.querySelector('.pdfv-page')).toBe(base);
      expect(session.getState().error).toBeNull();
    } finally { session.destroy(); }
  });

  it('renders only nearby pages, updates page controls and releases distant canvases', async () => {
    mockLayout();
    const host = document.createElement('div'); document.body.append(host);
    const session = createPdfPreviewDriver().createSession(host);
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'long.pdf' } });
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(1);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    const first = host.querySelector('canvas')!;
    session.goToPage?.(50);
    await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="50"][data-rendered="true"]')).not.toBeNull());
    expect(session.getState().pageIndex).toBe(50);
    expect(host.querySelectorAll('.pdfv-page-slot').length).toBeLessThanOrEqual(3);
    expect(host.querySelector('.pdfv-page-slot[data-page-index="0"]')).toBeNull();
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

  it('keeps at most two visible paints in progress and uses a freed slot while a lookup is pending', async () => {
    mockLayout();
    let finishLookup!: (value: unknown) => void, finishDraw!: () => void;
    const lookup = new Promise(resolve => { finishLookup = resolve; });
    const drawing = new Promise<void>(resolve => { finishDraw = resolve; });
    const getViewport = ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale });
    const heldRender = vi.fn(() => ({ promise: drawing, cancel: finishDraw }));
    const page = { getViewport, render };
    const getPage = vi.fn((number: number) => number === 2 ? lookup
      : Promise.resolve(number === 3 ? { getViewport, render: heldRender } : page));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 8, destroy, getPage }), destroy } as never);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { initialScale: .1 });
    try {
      const source = new Uint8Array();
      await session.load(source, { descriptor: { source } });
      await vi.waitFor(() => expect(heldRender).toHaveBeenCalledOnce());
      expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2, 3]);
      finishDraw();
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="3"][data-rendered="true"]')).not.toBeNull());
      expect(host.querySelector('canvas[data-page-index="1"]')).toBeNull();
      finishLookup(page);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="1"][data-rendered="true"]')).not.toBeNull());
    } finally { finishLookup(page); finishDraw(); session.destroy(); }
  });

  it('counts a visible detail paint against the two-paint limit', async () => {
    mockLayout();
    let finishLookup!: (value: unknown) => void, finishDetail!: () => void;
    const lookup = new Promise(resolve => { finishLookup = resolve; });
    const detail = new Promise<void>(resolve => { finishDetail = resolve; });
    const getViewport = ({ scale }: { scale: number }) => ({ width: 12000 * scale, height: 180 * scale, scale });
    const page = { getViewport, render };
    const startDetail = vi.fn(() => ({ promise: detail, cancel: finishDetail }));
    const first = { getViewport, render: ({ canvas }: { canvas: HTMLCanvasElement }) =>
      canvas.classList.contains('pdfv-page-detail') ? startDetail() : render() };
    const getPage = vi.fn((number: number) => number === 2 ? lookup : Promise.resolve(number === 1 ? first : page));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 3, destroy, getPage }), destroy } as never);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { fit: 'none' });
    try {
      const source = new Uint8Array();
      await session.load(source, { descriptor: { source } });
      await vi.waitFor(() => expect(startDetail).toHaveBeenCalledOnce());
      expect(getPage.mock.calls.map(([number]) => number)).toEqual([1, 2]);
      finishDetail();
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="2"][data-rendered="true"]')).not.toBeNull());
      expect(host.querySelector('canvas[data-page-index="1"]')).toBeNull();
    } finally { finishLookup(page); finishDetail(); session.destroy(); }
  });

  it('renders the new window without waiting for an abandoned page request', async () => {
    mockLayout();
    let reject!: (reason: Error) => void;
    const pending = new Promise((_, fail) => { reject = fail; });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    const getPage = vi.fn((number: number) => number === 50 ? pending : Promise.resolve(page));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 100, destroy, getPage }), destroy } as never);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host);
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      session.goToPage?.(50);
      await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(50));
      session.goToPage?.(95);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="95"][data-rendered="true"]')).not.toBeNull());
      expect(host.querySelector('.pdfv-page-slot[data-page-index="49"]')).toBeNull();
      reject(new Error('Unavailable range'));
      await Promise.resolve();
      expect(session.getState()).toMatchObject({ pageIndex: 95, error: null });
    } finally { session.destroy(); }
  });

  it('prioritizes the visible page over a still-mounted neighbor with a pending page lookup', async () => {
    mockLayout();
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    let finish!: (value: typeof page) => void;
    const pending = new Promise<typeof page>(resolve => { finish = resolve; });
    const getPage = vi.fn((number: number) => number === 2 ? pending : Promise.resolve(page));
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 5, destroy, getPage }), destroy } as never);
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { fit: 'none' });
    try {
      const source = new Uint8Array();
      await session.load(source, { descriptor: { source } });
      await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(2));
      const neighbor = host.querySelector('.pdfv-page-slot[data-page-index="1"]')!;
      session.goToPage?.(2);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-page-index="2"][data-rendered="true"]')).not.toBeNull());
      expect(host.querySelector('.pdfv-page-slot[data-page-index="1"]')).toBe(neighbor);
      expect(neighbor.querySelector('canvas')).toBeNull();
      finish(page);
      await vi.waitFor(() => expect(neighbor.querySelector('canvas[data-rendered="true"]')).not.toBeNull());
    } finally { finish(page); session.destroy(); }
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

  it('matches full visibility scans at page edges, gaps and mixed heights without reading page elements', async () => {
    mockLayout();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createPdfPreviewDriver().createSession(host, { fit: 'none' });
    const page = { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }), render };
    vi.mocked(getDocument).mockReturnValueOnce({ promise: Promise.resolve({ numPages: 2048, destroy, getPage: vi.fn(async () => page) }), destroy } as never);
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      const root = host.querySelector<HTMLElement>('.pdfv-preview')!;
      const selection = session as unknown as {
        visiblePages(): { needed: Set<number>; visible: Set<number> };
        state: { loading: boolean; pageIndex: number };
        layout: PdfPageLayout;
      };
      const heights = Array.from({ length: 2048 }, (_, index) => [80, 800, 1600][index % 3]);
      const starts: number[] = [];
      let top = 0;
      heights.forEach((height, index) => {
        starts.push(top);
        selection.layout.measure(index, 600, height);
        top += height + 16;
      });
      const rects = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      for (const loading of [true, false]) for (const scroll of [0, 79.5, 80, 95.5, 96, ...[400, 1000, 2047].flatMap(index => [starts[index] - 600, starts[index], starts[index] + 80])]) {
        root.scrollTop = scroll;
        selection.state.loading = loading;
        selection.state.pageIndex = 19;
        const margin = loading ? 0 : 300;
        const needed = new Set<number>(), visible = new Set<number>();
        let active = 19, overlap = -1;
        for (let index = 0; index < heights.length; index++) {
          const start = starts[index] - scroll;
          const end = start + heights[index];
          if (end > -margin && start < 600 + margin) needed.add(index);
          const pixels = Math.min(end, 600) - Math.max(start, 0);
          if (pixels > 0) visible.add(index);
          if (pixels > overlap) { active = index; overlap = pixels; }
        }
        rects.mockClear();
        expect(selection.visiblePages()).toEqual({ needed, visible });
        expect(selection.state.pageIndex).toBe(active);
        expect(rects).not.toHaveBeenCalled();
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
    expect(host.querySelectorAll('.pdfv-page-slot')).toHaveLength(1);
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('pdfv-preview') ? 800 : 0; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('pdfv-preview') ? 600 : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return offset(this); });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const element = this;
    const top = element.classList.contains('pdfv-page-slot') ? offset(element) - (element.parentElement?.scrollTop ?? 0) : 0;
    const height = element.classList.contains('pdfv-page-slot') ? parseFloat(element.style.height) : 600;
    return { top, bottom: top + height, left: 0, right: 800, width: 800, height, x: 0, y: top, toJSON() {} };
  });
}
