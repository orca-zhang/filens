import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument, TextLayer } from 'pdfjs-dist';
import { createPdfPreviewDriver } from '../src';

const { renderText, cancelText, updateText } = vi.hoisted(() => ({
  renderText: vi.fn<() => Promise<void>>(async () => {}), cancelText: vi.fn(), updateText: vi.fn()
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  AbortException: class extends Error { name = 'AbortException'; },
  getDocument: vi.fn(),
  TextLayer: vi.fn(function (options: { container: HTMLElement; textContentSource: ReadableStream<{ items: Array<{ str: string }> }> }) {
    const textDivs: HTMLElement[] = [], reader = options.textContentSource.getReader();
    return {
      textDivs,
      async render() {
        await renderText();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          for (const item of value.items) {
            const span = document.createElement('span');
            span.textContent = item.str;
            textDivs.push(span);
            options.container.append(span);
          }
        }
      },
      update: updateText,
      cancel() { cancelText(); void reader.cancel().catch(() => {}); }
    };
  })
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const content = { items: [{ str: 'Selectable text' }], styles: { f1: { fontFamily: 'serif' } } };

function open(pageCount = 1, streamTextContent = vi.fn(() => new ReadableStream<typeof content>({
  start(controller) { controller.enqueue(content); controller.close(); }
})), signal?: AbortSignal) {
  const host = document.body.appendChild(document.createElement('div'));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() })), streamTextContent
  };
  const destroy = vi.fn(async () => undefined);
  vi.mocked(getDocument).mockReturnValueOnce({ destroy, promise: Promise.resolve({
    numPages: pageCount, getPage: vi.fn(async () => page), destroy
  }) } as never);
  const session = createPdfPreviewDriver().createSession(host);
  const load = session.load(new Uint8Array([37, 80]), { descriptor: { source: new Uint8Array(), name: 'sample.pdf' }, signal });
  return { host, page, session, load };
}

describe('PDF text selection', () => {
  it('shares extraction with font diagnostics and uses CSS scale on high-density displays', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const { host, page, session, load } = open();
    try {
      await load;
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')?.textContent).toBe('Selectable text'));
      expect(host.querySelector('canvas')?.width).toBe(1200);
      expect(vi.mocked(TextLayer).mock.calls[0][0]).toMatchObject({ viewport: { scale: 1 }, textContentSource: expect.any(ReadableStream) });
      expect(host.querySelector<HTMLElement>('.pdfv-text-layer')?.style.getPropertyValue('--total-scale-factor')).toBe('1');
      expect(page.streamTextContent).toHaveBeenCalledTimes(1);
      expect(session.getState().fonts).toMatchObject([{ fontId: 'f1', fontFamily: 'serif' }]);
    } finally { session.destroy(); }
  });

  it('releases offscreen text and restores it when navigating back without mounting every page', async () => {
    const { host, session, load } = open(100);
    try {
      await load;
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="0"] .pdfv-text-layer[data-rendered="true"]')).not.toBeNull());
      session.goToPage?.(50);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="50"] .pdfv-text-layer[data-rendered="true"]')).not.toBeNull());
      expect(host.querySelectorAll('.pdfv-text-layer')).toHaveLength(1);
      expect(cancelText).toHaveBeenCalledTimes(1);
      session.goToPage?.(0);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="0"] .pdfv-text-layer[data-rendered="true"]')).not.toBeNull());
      expect(host.querySelectorAll('.pdfv-text-layer')).toHaveLength(1);
      expect(cancelText).toHaveBeenCalledTimes(2);
    } finally { session.destroy(); }
  });

  it('keeps the unfinished text reader through zoom and cancels it on failed relayout or destruction', async () => {
    const reads: ReturnType<typeof vi.fn>[] = [];
    const streamTextContent = vi.fn(() => {
      const cancel = vi.fn();
      return new ReadableStream<typeof content>({
        start() { reads.push(cancel); },
        cancel
      }, { highWaterMark: 0 });
    });
    const { host, session, load } = open(1, streamTextContent);
    try {
      await load;
      expect(session.getState().loading).toBe(false);
      expect(host.querySelector('canvas[data-rendered="true"]')).not.toBeNull();
      expect(reads).toHaveLength(1);
      const firstLayer = host.querySelector('.pdfv-text-layer');
      session.setScale?.(2);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-rendered="true"]')?.getAttribute('width')).toBe('1200'));
      expect(updateText).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: expect.objectContaining({ scale: 2 }) }));
      expect(host.querySelector('.pdfv-text-layer')).toBe(firstLayer);
      expect(reads).toHaveLength(1);
      expect(reads[0]).not.toHaveBeenCalled();
      session.setScale?.(3);
      await vi.waitFor(() => expect(host.querySelector('canvas[data-rendered="true"]')?.getAttribute('width')).toBe('1800'));
      expect(host.querySelector('.pdfv-text-layer')).toBe(firstLayer);
      expect(reads).toHaveLength(1);
      updateText.mockImplementationOnce(() => { throw new Error('Cannot update text layout'); });
      session.setScale?.(4);
      await vi.waitFor(() => expect(reads).toHaveLength(2));
      expect(reads[0]).toHaveBeenCalledOnce();
      expect(firstLayer?.isConnected).toBe(false);
      expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')).toBeNull();
      expect(vi.mocked(TextLayer).mock.calls[1][0]).toMatchObject({ viewport: { scale: 4 } });
      session.destroy();
      expect(reads[1]).toHaveBeenCalledOnce();
      expect(host.childElementCount).toBe(0);
    } finally { session.destroy(); }
  });

  it('relayouts finished text while reusing the layer and extraction', async () => {
    const { host, page, session, load } = open();
    const selector = '.pdfv-text-layer[data-rendered="true"]';
    try {
      await load;
      await vi.waitFor(() => expect(host.querySelector(selector)).not.toBeNull());
      const layer = host.querySelector<HTMLElement>(selector);
      session.setScale?.(2);
      expect(layer?.style.getPropertyValue('--total-scale-factor')).toBe('2');
      await vi.waitFor(() => expect(updateText).toHaveBeenCalledWith(expect.objectContaining({ viewport: expect.objectContaining({ scale: 2 }) })));
      expect(host.querySelector(selector)).toBe(layer);
      expect(page.streamTextContent).toHaveBeenCalledOnce();
      expect(cancelText).not.toHaveBeenCalled();
    } finally { session.destroy(); }
  });

  it('cancels a pending text layer on abort and keeps cancellation out of document errors', async () => {
    let reject!: (reason: Error) => void;
    renderText.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const controller = new AbortController();
    const { host, session, load } = open(1, undefined, controller.signal);
    try {
      await load;
      await vi.waitFor(() => expect(TextLayer).toHaveBeenCalledTimes(1));
      controller.abort();
      expect(cancelText).toHaveBeenCalledTimes(1);
      reject(new DOMException('Cancelled', 'AbortError'));
      await Promise.resolve(); await Promise.resolve();
      expect(host.querySelector('.pdfv-text-layer')).toBeNull();
      expect(session.getState()).toMatchObject({ error: null, warnings: [] });
    } finally { session.destroy(); }
  });

  it('keeps the painted page usable and reports failed text-layer rendering', async () => {
    renderText.mockRejectedValueOnce(new Error('Text layout failed'));
    const { host, session, load } = open();
    try {
      await load;
      await vi.waitFor(() => expect(session.getState().warnings).toContain('Text selection is unavailable for PDF page 1.'));
      expect(host.querySelector('canvas[data-rendered="true"]')).not.toBeNull();
      expect(host.querySelector('.pdfv-text-layer')).toBeNull();
      expect(session.getState()).toMatchObject({ loading: false, error: null });
    } finally { session.destroy(); }
  });
});
