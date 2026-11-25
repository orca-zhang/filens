import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocument, type TextLayer } from 'pdfjs-dist';
import { PdfPreviewSession } from '../src';
import { PDF_SEARCH_MATCH_LIMIT, findPdfText, highlightPdfText, indexPdfText } from '../src/search';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, getDocument: vi.fn(),
  TextLayer: vi.fn(function ({ container, textContentSource }: { container: HTMLElement; textContentSource: { items: Array<{ str: string }> } }) {
    const textDivs: HTMLElement[] = [], textContentItemsStr: string[] = [];
    return { textDivs, textContentItemsStr, cancel() {}, async render() {
      for (const item of textContentSource.items) {
        const span = document.createElement('span'); span.textContent = item.str;
        textDivs.push(span); textContentItemsStr.push(item.str); container.append(span);
      }
    } };
  })
}));

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function open(texts: string[]) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const pages = texts.map(text => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    getTextContent: vi.fn(async () => ({ items: text ? [{ str: text }] : [], styles: {} }))
  }));
  const destroy = vi.fn(async () => undefined), getPage = vi.fn(async (page: number) => pages[page - 1]);
  vi.mocked(getDocument).mockReturnValueOnce({ destroy, promise: Promise.resolve({ numPages: pages.length, destroy, getPage }) } as never);
  const host = document.body.appendChild(document.createElement('div'));
  const session = new PdfPreviewSession(host);
  await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'find.pdf' } });
  return { host, session, pages };
}

describe('PDF full-document search', () => {
  it('uses literal case-insensitive Unicode matches and preserves split-run offsets', () => {
    const index = indexPdfText([{ type: 'beginMarkedContent' }, { str: 'Hello' }, { str: '', hasEOL: true }, { str: '[世界] 😀 HELLO' }]);
    expect(index).toEqual({ text: 'Hello [世界] 😀 HELLO', offsets: [0, 5, 6] });
    expect(findPdfText(index.text, 'hello', 3, 10)).toEqual([{ pageIndex: 3, start: 0, end: 5 }, { pageIndex: 3, start: 14, end: 19 }]);
    expect(findPdfText(index.text, '[世界] 😀', 3, 10)).toEqual([{ pageIndex: 3, start: 6, end: 13 }]);
    expect(findPdfText(index.text, 'Hello [世界]', 3, 10)).toHaveLength(1);
    expect(findPdfText('.*+?^${}()|[]\\', '.*+?^${}()|[]\\', 0, 10)).toHaveLength(1);
    expect(findPdfText('xxxx', 'x', 0, 2)).toHaveLength(2);
  });

  it('highlights matches across text runs without interpreting document text as HTML', () => {
    const strings = ['Hello ', '<world>', ' 中文😀'];
    const textDivs = strings.map(text => { const span = document.createElement('span'); span.textContent = text; return span; });
    const layer = { textDivs, textContentItemsStr: strings } as TextLayer;
    const index = indexPdfText(strings.map(str => ({ str })));
    const matches = findPdfText(index.text, 'o <wo', 0, 10);
    highlightPdfText(layer, index.offsets, matches, matches[0]);
    expect(textDivs.map(div => div.textContent)).toEqual(strings);
    expect(textDivs.flatMap(div => [...div.querySelectorAll('mark.is-active')].map(mark => mark.textContent))).toEqual(['o ', '<wo']);
    expect(textDivs[1].querySelector('world')).toBeNull();
    highlightPdfText(layer, index.offsets, []);
    expect(textDivs.some(div => div.querySelector('mark'))).toBe(false);
    expect(textDivs.map(div => div.textContent)).toEqual(strings);
  });

  it('finds unrendered pages, counts all results, wraps navigation and copies state safely', async () => {
    const { session, host } = await open(Array.from({ length: 80 }, (_, index) => [1, 79].includes(index) ? 'Needle' : 'Other text'));
    try {
      await session.find('needle');
      expect(session.getState().search).toMatchObject({ total: 2, pagesScanned: 80, pageCount: 80, activeIndex: 0, searching: false, truncated: false });
      expect(session.getState().pageIndex).toBe(1);
      session.findNext(true);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="79"] mark.is-active')?.textContent).toBe('Needle'));
      expect(host.querySelectorAll('canvas').length).toBeLessThanOrEqual(2);
      session.findNext(); expect(session.getState().pageIndex).toBe(1);
      const snapshot = session.getState(); snapshot.search!.total = 900;
      expect(session.getState().search?.total).toBe(2);
      await session.find('');
      expect(session.getState().search).toMatchObject({ query: '', total: 0, activeIndex: -1 });
      expect(host.querySelector('mark')).toBeNull();
    } finally { session.destroy(); }
  });

  it('discards an old extraction after a newer query or document destruction', async () => {
    const { session, pages } = await open(['First page', 'old new']);
    let finish!: (value: { items: { str: string }[]; styles: {} }) => void;
    try {
      pages[1].getTextContent.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const old = session.find('old');
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
      await session.find('new');
      finish({ items: [{ str: 'old' }], styles: {} }); await old;
      expect(session.getState().search).toMatchObject({ query: 'new', total: 1, searching: false });
      let late!: typeof finish;
      pages[1].getTextContent.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
      const pending = session.find('old');
      await vi.waitFor(() => expect(late).toBeTypeOf('function'));
      session.destroy(); late({ items: [{ str: 'old' }], styles: {} }); await pending;
      expect(session.getState().search).toMatchObject({ query: '', total: 0, searching: false });
    } finally { session.destroy(); }
  });

  it('reports partial page failures separately from preview errors and keeps other results', async () => {
    const { session, pages } = await open(['First', 'bad', 'needle']);
    try {
      pages[1].getTextContent.mockRejectedValue(new Error('Damaged text'));
      await session.find('needle');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 3, error: 'PDF page 2: Damaged text', searching: false });
      expect(session.getState().error).toBeNull();
    } finally { session.destroy(); }
  });

  it('caps retained matches and distinguishes an exact limit from truncated results', async () => {
    const { session, pages } = await open(['']);
    try {
      pages[0].getTextContent.mockResolvedValue({ items: [{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + 1) }], styles: {} });
      await session.find('x');
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT, truncated: true, searching: false });
      pages[0].getTextContent.mockResolvedValue({ items: [{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT) }], styles: {} });
      await session.find('x');
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT, truncated: false });
    } finally { session.destroy(); }
  });
});
