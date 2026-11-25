import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument, TextLayer } from 'pdfjs-dist';
import { createPdfPreviewDriver } from '../src';

const { renderText, cancelText } = vi.hoisted(() => ({
  renderText: vi.fn<() => Promise<void>>(async () => {}), cancelText: vi.fn()
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
  TextLayer: vi.fn(function (options: { container: HTMLElement; textContentSource: { items: Array<{ str: string }> } }) {
    return {
      async render() {
        await renderText();
        for (const item of options.textContentSource.items) {
          const span = document.createElement('span');
          span.textContent = item.str;
          options.container.append(span);
        }
      },
      cancel: cancelText
    };
  })
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const content = { items: [{ str: 'Selectable text' }], styles: { f1: { fontFamily: 'serif' } } };

function open(pageCount = 1, getTextContent = vi.fn(async () => content), signal?: AbortSignal) {
  const host = document.body.appendChild(document.createElement('div'));
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() })), getTextContent
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
      expect(vi.mocked(TextLayer).mock.calls[0][0]).toMatchObject({ viewport: { scale: 1 }, textContentSource: content });
      expect(host.querySelector<HTMLElement>('.pdfv-text-layer')?.style.getPropertyValue('--total-scale-factor')).toBe('1');
      expect(page.getTextContent).toHaveBeenCalledTimes(1);
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

  it('does not delay first paint or restore text extracted before zoom or destruction', async () => {
    let finish!: (value: typeof content) => void;
    const getTextContent = vi.fn(() => new Promise<typeof content>(resolve => { finish = resolve; }));
    const { host, session, load } = open(1, getTextContent);
    try {
      await load;
      expect(session.getState().loading).toBe(false);
      expect(host.querySelector('canvas[data-rendered="true"]')).not.toBeNull();
      const oldText = finish;
      session.setScale?.(2);
      oldText(content);
      await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledTimes(2));
      expect(host.querySelector('.pdfv-text-layer')).toBeNull();
      finish(content);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')).not.toBeNull());
      expect(vi.mocked(TextLayer).mock.calls[0][0]).toMatchObject({ viewport: { scale: 2 } });
      session.setScale?.(3);
      await vi.waitFor(() => expect(getTextContent).toHaveBeenCalledTimes(3));
      const staleText = finish;
      session.destroy(); staleText(content);
      await Promise.resolve(); await Promise.resolve();
      expect(host.childElementCount).toBe(0);
      expect(TextLayer).toHaveBeenCalledTimes(1);
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
