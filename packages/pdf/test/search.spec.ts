import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocument, PagesMapper, type TextLayer } from 'pdfjs-dist';
import { PdfPreviewSession } from '../src';
import { PDF_SEARCH_MATCH_LIMIT, createPdfTextMatcher, highlightPdfText, indexPdfText, matchPdfTextRuns } from '../src/search';

const selectionLimit = vi.hoisted(() => ({ runs: Infinity }));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, getDocument: vi.fn(),
  PagesMapper: { instance: { getPageId: (pageNumber: number) => pageNumber } },
  AbortException: class extends Error { name = 'AbortException'; },
  TextLayer: vi.fn(function ({ container, textContentSource }: { container: HTMLElement; textContentSource: ReadableStream<{ items: Array<{ str: string }> }> }) {
    const textDivs: HTMLElement[] = [], textContentItemsStr: string[] = [];
    const reader = textContentSource.getReader();
    return { textDivs, textContentItemsStr, cancel() { void reader.cancel().catch(() => {}); }, async render() {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const item of value.items) {
          if (textDivs.length >= selectionLimit.runs) break;
          const span = document.createElement('span'); span.textContent = item.str;
          textDivs.push(span); textContentItemsStr.push(item.str); container.append(span);
        }
      }
    } };
  })
}));

afterEach(() => { selectionLimit.runs = Infinity; document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });

type TextRun = { str: string; hasEOL?: boolean };

function textStream(...chunks: TextRun[][]) {
  return new ReadableStream({ start(controller) {
    for (const items of chunks) controller.enqueue({ items });
    controller.close();
  } });
}

function heldText(...prefix: TextRun[]) {
  let pending!: ReadableStreamDefaultController<{ items: TextRun[] }>;
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) { pending = controller; controller.enqueue({ items: prefix }); },
    cancel
  }, { highWaterMark: 0 });
  return { stream, cancel,
    finish(...items: TextRun[]) { pending.enqueue({ items }); pending.close(); },
    fail(error: Error) { pending.error(error); }
  };
}

function findPdfText(text: string, query: string, pageIndex: number, limit: number) {
  return createPdfTextMatcher(query, pageIndex, limit)(text, true);
}

async function open(texts: (string | TextRun[][])[], sensitive = false) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const pages = texts.map(text => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    streamTextContent: vi.fn(() => typeof text === 'string' ? textStream(text ? [{ str: text }] : []) : textStream(...text))
  }));
  const destroy = vi.fn(async () => undefined), getPage = vi.fn(async (page: number) => pages[page - 1]);
  const pdf = { numPages: pages.length, destroy, getPage,
    _transport: undefined as { messageHandler: { sendWithStream(action: string, data: { pageIndex: number }): ReadableStream } } | undefined };
  vi.mocked(getDocument).mockReturnValueOnce({ destroy, promise: Promise.resolve(pdf) } as never);
  const host = document.body.appendChild(document.createElement('div'));
  const session = new PdfPreviewSession(host);
  await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'find.pdf', sensitive } });
  return { host, session, pages, getPage, pdf };
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

  it('updates active fragments in place and restores only previously marked runs', () => {
    const items = [{ str: 'Target' }, { str: '', hasEOL: true }, { str: 'phrase + Target phrase' },
      { str: ' untouched ' }, { str: 'Tail', hasEOL: true }];
    const strings = items.map(item => item.str);
    const textDivs = strings.map(text => { const span = document.createElement('span'); span.textContent = text; return span; });
    const layer = { textDivs, textContentItemsStr: strings } as TextLayer;
    const untouched = textDivs[3].firstChild;
    const { text, offsets } = indexPdfText(items);
    const matches = findPdfText(text, 'Target phrase', 0, 10);
    const marks = () => textDivs.flatMap(div => [...div.querySelectorAll('mark')]);
    expect(highlightPdfText(layer, offsets, matches, matches[0])?.textContent).toBe('Target');
    const first = marks();
    expect(first.map(mark => mark.classList.contains('is-active'))).toEqual([true, true, false]);
    expect(highlightPdfText(layer, offsets, matches, matches[1])).toBe(first[2]);
    expect(marks().every((mark, i) => mark === first[i])).toBe(true);
    expect(first.map(mark => mark.classList.contains('is-active'))).toEqual([false, false, true]);

    const tail = findPdfText(text, 'Tail ', 0, 10);
    expect(highlightPdfText(layer, offsets, tail, tail[0])?.textContent).toBe('Tail');
    expect(marks()).toHaveLength(1);
    highlightPdfText(layer, offsets, []);
    expect(marks()).toHaveLength(0);
    expect(textDivs[3].firstChild).toBe(untouched);
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

  it('opens mapped text streams for offscreen pages and loads page geometry when navigating to a hit', async () => {
    const { session, pages, getPage, pdf, host } = await open(['Opening', 'Other', 'Another', 'Far needle']);
    const pending = heldText();
    const sendWithStream = vi.fn((_action: string, { pageIndex }: { pageIndex: number }) => pages[pageIndex].streamTextContent());
    pdf._transport = { messageHandler: { sendWithStream }, pagesMapper: { getPageId: (number: number) => number + 10 } };
    vi.spyOn(PagesMapper.instance, 'getPageId');
    pages[3].streamTextContent.mockReturnValueOnce(pending.stream);
    getPage.mockClear();
    try {
      const search = session.find('missing');
      await vi.waitFor(() => expect(pending.stream.locked).toBe(true));
      expect(sendWithStream).toHaveBeenCalledWith('GetTextContent', expect.objectContaining({ pageId: 13, pageIndex: 3, filensSearch: true }),
        expect.objectContaining({ highWaterMark: 100 }));
      expect(PagesMapper.instance.getPageId).not.toHaveBeenCalled();
      expect(getPage).not.toHaveBeenCalledWith(4);
      await session.find('');
      await search;
      expect(pending.cancel).toHaveBeenCalledOnce();
      await session.find('needle');
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="3"] mark.is-active')?.textContent).toBe('needle'));
      expect(getPage).toHaveBeenCalledWith(4);
    } finally { session.destroy(); }
  });

  it.each([false, true])('publishes visible hits before a held page and keeps explicit match navigation (%s)', async navigated => {
    const { session, host, pages, getPage } = await open(['Opening', 'Earlier needle', 'Visible needle']);
    let resume!: () => void;
    const held = new Promise<typeof pages[number]>(resolve => { resume = () => resolve(pages[1]); });
    try {
      session.goToPage(2);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')?.textContent).toBe('Visible needle'));
      getPage.mockImplementation(index => index === 2 ? held : Promise.resolve(pages[index - 1]));
      const result = session.find('needle');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 2, searching: true }));
      expect(session.getState().pageIndex).toBe(2);
      expect(host.querySelector('mark.is-active')?.textContent).toBe('needle');
      if (navigated) session.findNext();
      resume();
      await result;
      expect(session.getState()).toMatchObject({ pageIndex: navigated ? 2 : 1,
        search: { total: 2, pagesScanned: 3, activeIndex: navigated ? 1 : 0, searching: false } });
      expect(pages[2].streamTextContent).toHaveBeenCalledOnce();
      session.findNext();
      expect(session.getState().pageIndex).toBe(navigated ? 1 : 2);
    } finally { resume(); session.destroy(); }
  });

  it('adds newly rendered visible pages in order while both search reads wait', async () => {
    const { session, host, pages, getPage } = await open(['Opening', 'Held needle', 'Blocked page', 'Second needle', 'Last needle']);
    let resume!: () => void;
    const held = new Promise<void>(resolve => { resume = resolve; });
    try {
      getPage.mockImplementation(async index => {
        if (index === 2 || index === 3) await held;
        return pages[index - 1];
      });
      const result = session.find('needle');
      await vi.waitFor(() => expect(getPage).toHaveBeenCalledWith(3));
      expect(session.getState().search).toMatchObject({ total: 0, pagesScanned: 1, searching: true });
      session.goToPage(4);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="4"] mark.is-active')?.textContent).toBe('needle'));
      session.findNext();
      session.goToPage(3);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-page-slot[data-page-index="3"] mark')?.textContent).toBe('needle'));
      expect(session.getState().search).toMatchObject({ total: 2, activeIndex: 1, pagesScanned: 3, searching: true });
      resume();
      await result;
      expect(session.getState().search).toMatchObject({ total: 3, activeIndex: 2, pagesScanned: 5, searching: false });
      expect(pages[3].streamTextContent).toHaveBeenCalledOnce();
      expect(pages[4].streamTextContent).toHaveBeenCalledOnce();
      session.findNext();
      expect(session.getState().pageIndex).toBe(1);
    } finally { resume(); session.destroy(); }
  });

  it('keeps the first 10,000 matches in document order when earlier results displace visible hits', async () => {
    const { session, host, pages, getPage } = await open(['x '.repeat(PDF_SEARCH_MATCH_LIMIT - 1), 'x x', 'Later x']);
    let resume!: () => void;
    const held = new Promise<typeof pages[number]>(resolve => { resume = () => resolve(pages[0]); });
    const later = heldText();
    try {
      session.goToPage(1);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')?.textContent).toBe('x x'));
      getPage.mockImplementation(index => index === 1 ? held : Promise.resolve(pages[index - 1]));
      pages[2].streamTextContent.mockReturnValueOnce(later.stream);
      const result = session.find('x');
      await vi.waitFor(() => expect(later.stream.locked).toBe(true));
      expect(session.getState().search).toMatchObject({ total: 2, pagesScanned: 1, searching: true });
      session.findNext();
      expect(host.querySelectorAll('mark')).toHaveLength(2);
      expect(host.querySelectorAll('mark')[1].classList.contains('is-active')).toBe(true);
      resume();
      await result;
      expect(session.getState()).toMatchObject({ pageIndex: 1,
        search: { total: PDF_SEARCH_MATCH_LIMIT, pagesScanned: 2, activeIndex: PDF_SEARCH_MATCH_LIMIT - 1, truncated: true, searching: false } });
      expect(host.querySelectorAll('mark')).toHaveLength(1);
      expect(host.querySelector('mark.is-active')?.textContent).toBe('x');
      expect(later.cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortException' }));
      expect(later.stream.locked).toBe(false);
    } finally { resume(); session.destroy(); }
  });

  it('waits for earlier pages when an offscreen page reaches the result limit first', async () => {
    const { session, pages, getPage } = await open(['Opening', 'First x', 'Later x']);
    let resume!: () => void;
    const held = new Promise<typeof pages[number]>(resolve => { resume = () => resolve(pages[1]); });
    try {
      getPage.mockImplementation(index => index === 2 ? held : Promise.resolve(pages[index - 1]));
      pages[2].streamTextContent.mockReturnValueOnce(textStream([{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + 1) }]));
      const result = session.find('x');
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ pageIndex: 2,
        search: { total: PDF_SEARCH_MATCH_LIMIT, pagesScanned: 2, truncated: true, searching: true } }));
      resume();
      await result;
      expect(session.getState()).toMatchObject({ pageIndex: 1,
        search: { total: PDF_SEARCH_MATCH_LIMIT, activeIndex: 0, pagesScanned: 3, truncated: true, searching: false } });
    } finally { resume(); session.destroy(); }
  });

  it.each(['replace', 'clear', 'destroy'])('cancels both pending text streams when asked to %s the search', async action => {
    const { session, pages } = await open(['First page', 'old new', 'Last page']);
    const streams = [heldText(), heldText()];
    try {
      for (const [i, { stream }] of streams.entries()) pages[i + 1].streamTextContent.mockReturnValueOnce(stream);
      const old = session.find('old');
      await vi.waitFor(() => expect(streams.every(({ stream }) => stream.locked)).toBe(true));
      if (action === 'destroy') session.destroy();
      else await session.find(action === 'replace' ? 'new' : '');
      await old;
      for (const { cancel, stream } of streams) {
        expect(cancel).toHaveBeenCalledOnce();
        expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortException' }));
        expect(stream.locked).toBe(false);
      }
      expect(session.getState().search).toMatchObject(action === 'replace'
        ? { query: 'new', total: 1, searching: false } : { query: '', total: 0, searching: false });
    } finally { session.destroy(); }
  });

  it('batches progress and settles when search is cleared during a page lookup', async () => {
    const { session, pages, getPage } = await open([...Array(40).fill('Other text'), 'Needle']);
    let rejectPage!: (error: Error) => void;
    const held = new Promise<never>((_, reject) => { rejectPage = reject; });
    const progress: number[] = [];
    session.on('statechange', state => { if (state.search?.searching) progress.push(state.search.pagesScanned); });
    try {
      vi.spyOn(performance, 'now').mockReturnValue(0);
      getPage.mockImplementation(index => index === 41 ? held : Promise.resolve(pages[index - 1]));
      const search = session.find('needle');
      await vi.waitFor(() => expect(progress).toEqual([0, 40]));
      expect(getPage).toHaveBeenCalledWith(41);
      await session.find('');
      await search;
      rejectPage(new Error('Late page error'));
      expect(session.getState().search).toMatchObject({ query: '', total: 0, searching: false });
      expect(session.getState().search?.error).toBeUndefined();
    } finally { session.destroy(); }
  });

  it('keeps matches and offsets across PDF text stream chunks', async () => {
    const { session, host, pages } = await open(['Other text', 'Hello world']);
    try {
      pages[1].streamTextContent.mockReturnValueOnce(textStream([{ str: 'Hello', hasEOL: true }], [{ str: 'world' }]));
      await session.find('lo world');
      expect(session.getState().search).toMatchObject({ total: 1, activeIndex: 0, pagesScanned: 2 });
      await vi.waitFor(() => expect(host.querySelector('mark.is-active')?.textContent).toBe('lo world'));
    } finally { session.destroy(); }
  });

  it('publishes hits from a pending search stream and preserves the selected hit on completion', async () => {
    const { session, pages } = await open(['Other text', 'Needle and needle Needle']);
    const held = heldText({ str: 'Needle and needle ' });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(held.stream);
      const search = session.find('needle');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ total: 2, pagesScanned: 1, searching: true }));
      session.findNext();
      expect(session.getState().search?.activeIndex).toBe(1);
      held.finish({ str: 'Needle' });
      await search;
      expect(session.getState().search).toMatchObject({ total: 3, pagesScanned: 2, activeIndex: 1, searching: false });
    } finally { session.destroy(); }
  });

  it('retains earlier hits when a pending page stream fails', async () => {
    const { session, pages } = await open(['Other text', 'Needle']);
    const held = heldText({ str: 'Needle' });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(held.stream);
      const search = session.find('needle');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 1, searching: true }));
      held.fail(new Error('Missing tail'));
      await search;
      expect(session.getState().search).toMatchObject({ total: 1, activeIndex: 0, pagesScanned: 2, searching: false,
        error: 'PDF page 2: Missing tail' });
      expect(held.stream.locked).toBe(false);
    } finally { session.destroy(); }
  });

  it('cancels a pending prefix after earlier results confirm the document-order limit', async () => {
    const { session, pages } = await open(['', '', 'x x']);
    const earlier = heldText(), later = heldText({ str: 'x x' });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(earlier.stream);
      pages[2].streamTextContent.mockReturnValueOnce(later.stream);
      const search = session.find('x');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ total: 2, pagesScanned: 1, searching: true }));
      session.findNext(true);
      session.findNext();
      earlier.finish({ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT - 1) });
      await search;
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT,
        activeIndex: PDF_SEARCH_MATCH_LIMIT - 1, pagesScanned: 3, truncated: true, searching: false });
      expect(later.cancel).toHaveBeenCalledOnce();
      expect(later.stream.locked).toBe(false);
    } finally { session.destroy(); }
  });

  it.each([false, true])('reopens offscreen text only for a sensitive PDF (%s)', async sensitive => {
    const { session, pages, getPage } = await open(['Opening page', [[{ str: 'Prefix', hasEOL: true }], [{ str: '世界 😀' }]]], sensitive);
    try {
      await session.find('missing');
      getPage.mockClear();
      await session.find('other absent');
      expect(pages[1].streamTextContent).toHaveBeenCalledTimes(sensitive ? 2 : 1);
      expect(getPage.mock.calls.filter(([page]) => page === 2)).toHaveLength(sensitive ? 1 : 0);
      await session.find('FIX 世界 😀');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 2, activeIndex: 0 });

      pages[1].streamTextContent.mockImplementation(() => textStream([{ str: 'Replacement text' }]));
      const destroy = vi.fn(async () => undefined);
      vi.mocked(getDocument).mockReturnValueOnce({ destroy, promise: Promise.resolve({ numPages: 2, destroy, getPage }) } as never);
      const source = new Uint8Array([1]);
      await session.load(source, { descriptor: { source } });
      await session.find('FIX 世界 😀');
      expect(session.getState().search).toMatchObject({ total: 0, pagesScanned: 2 });
      await session.find('Replacement');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 2 });
    } finally { session.destroy(); }
  });

  it('keeps a bounded set of short pages and does not reuse incomplete text', async () => {
    const shortPage = 'a'.repeat(32_768);
    const { session, pages } = await open(['Opening page', 'needle', shortPage + 'x', ...Array<string>(35).fill(shortPage)]);
    try {
      const cancelling = heldText({ str: 'incomplete' }), other = heldText();
      pages[1].streamTextContent.mockReturnValueOnce(cancelling.stream);
      pages[2].streamTextContent.mockReturnValueOnce(other.stream);
      const scan = session.find('absent');
      await vi.waitFor(() => expect(cancelling.stream.locked && other.stream.locked).toBe(true));
      await session.find('');
      await scan;
      expect(cancelling.cancel).toHaveBeenCalledOnce();

      await session.find('missing');
      await session.find('another missing term');
      expect(pages[1].streamTextContent).toHaveBeenCalledTimes(2);
      expect(pages[2].streamTextContent).toHaveBeenCalledTimes(3);
      expect(pages.slice(3).filter(page => page.streamTextContent.mock.calls.length === 1)).toHaveLength(31);
      await session.find('needle');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: pages.length });
    } finally { session.destroy(); }
  });

  it('caps entries even when the offscreen pages have no text', async () => {
    const { session, pages } = await open(['Opening page', ...Array<string>(4097).fill('')]);
    try {
      await session.find('missing');
      await session.find('still absent');
      expect(session.getState().search).toMatchObject({ total: 0, pagesScanned: 4098 });
      expect(pages[4096].streamTextContent).toHaveBeenCalledOnce();
      expect(pages[4097].streamTextContent).toHaveBeenCalledTimes(2);
    } finally { session.destroy(); }
  });

  it('finds text beyond a previous query cutoff', async () => {
    const { session } = await open(['Opening page', [[{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + 1) }], [{ str: 'late phrase' }]]]);
    try {
      await session.find('x');
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT, truncated: true });
      await session.find('late phrase');
      expect(session.getState().search).toMatchObject({ total: 1, truncated: false });
    } finally { session.destroy(); }
  });

  it('reuses complete selection runs across line breaks and matches a trailing separator', async () => {
    const { session, host, pages, getPage } = await open([[[{ str: 'Préfixe' }, { str: '', hasEOL: true }],
      [{ str: '世界 😀 tail', hasEOL: true }]]]);
    try {
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')).not.toBeNull());
      getPage.mockClear();
      await session.find('FIXE 世界 😀');
      expect(session.getState().search?.total).toBe(1);
      expect([...host.querySelectorAll('mark.is-active')].map(mark => mark.textContent)).toEqual(['fixe', '世界 😀']);
      await session.find('tail ');
      expect(session.getState().search?.total).toBe(1);
      expect(host.querySelector('mark.is-active')?.textContent).toBe('tail');
      expect(pages[0].streamTextContent).toHaveBeenCalledOnce();
      expect(getPage).not.toHaveBeenCalled();
    } finally { session.destroy(); }
  });

  it('shares pending selection runs with a replacement search and keeps offsets across the live boundary', async () => {
    const { host, session, pages } = await open(['Other page', 'Hello world']);
    const held = heldText({ str: 'Hello', hasEOL: true });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(held.stream);
      session.goToPage(1);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer')?.textContent).toBe('Hello'));
      const first = session.find('absent');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ searching: true, pagesScanned: 1 }));
      await session.find('');
      await first;
      expect(held.stream.locked).toBe(true);
      expect(held.cancel).not.toHaveBeenCalled();
      const second = session.find('lo world');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ searching: true, pagesScanned: 1 }));
      expect(pages[1].streamTextContent).toHaveBeenCalledOnce();
      held.finish({ str: 'world' });
      await second;
      expect(pages[1].streamTextContent).toHaveBeenCalledOnce();
      expect(session.getState().search).toMatchObject({ total: 1, activeIndex: 0, searching: false });
      expect([...host.querySelectorAll('mark.is-active')].map(mark => mark.textContent)).toEqual(['lo', 'world']);
      expect(held.stream.locked).toBe(false);
    } finally { session.destroy(); }
  });

  it('falls back to page text when pending selection is evicted without counting the same match twice', async () => {
    const { host, session, pages } = await open(['Other page', 'One needle', 'Final page']);
    const held = heldText({ str: 'One needle' });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(held.stream);
      session.goToPage(1);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer')?.textContent).toBe('One needle'));
      const search = session.find('needle');
      await vi.waitFor(() => expect(session.getState().search).toMatchObject({ total: 1, searching: true, pagesScanned: 2 }));
      expect(host.querySelector('mark.is-active')?.textContent).toBe('needle');
      session.goToPage(2);
      await search;
      expect(held.cancel).toHaveBeenCalledOnce();
      expect(pages[1].streamTextContent.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 3, searching: false });
    } finally { session.destroy(); }
  });

  it('stops a search at the confirmed limit while its shared selection reader stays pending', async () => {
    const { host, session, pages } = await open(['Other page', 'needle']);
    const held = heldText({ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + 1) });
    try {
      pages[1].streamTextContent.mockReturnValueOnce(held.stream);
      session.goToPage(1);
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer')?.textContent).toContain('x'));
      await session.find('x');
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT, truncated: true, searching: false });
      expect(pages[1].streamTextContent).toHaveBeenCalledOnce();
      expect(held.stream.locked).toBe(true);
      expect(held.cancel).not.toHaveBeenCalled();
    } finally { session.destroy(); }
  });

  it('searches past the PDF.js selection limit using the source stream', async () => {
    selectionLimit.runs = 1;
    const { session, host, pages } = await open([[[{ str: 'visible text' }, { str: 'offscreen result' }]]]);
    try {
      await vi.waitFor(() => expect(host.querySelector('.pdfv-text-layer[data-rendered="true"]')?.textContent).toBe('visible text'));
      await session.find('offscreen result');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 1 });
      expect(pages[0].streamTextContent).toHaveBeenCalledTimes(2);
    } finally { session.destroy(); }
  });

  it('yields while scanning rendered runs and respects cancellation', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 20);
    const controller = new AbortController();
    const scan = matchPdfTextRuns(['x'.repeat(8192), 'needle'], [0, 8192], 8198,
      createPdfTextMatcher('needle', 0, 10), 10, controller.signal);
    controller.abort();
    await expect(scan).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    { query: 'aa', chunks: ['xA', 'aa', 'aAA', 'aA'], offsets: [[1, 3], [3, 5], [5, 7], [7, 9]] },
    { query: 'ab', chunks: ['😀', 'a', '😀ab'], offsets: [[5, 7]] },
    { query: '😀a', chunks: ['x\uD83D', '\uDE00A\uD83D', '\uDE00a'], offsets: [[1, 4], [4, 7]] },
    { query: '\uD83D', chunks: ['x\uD83D', '\uDE00\uD83D'], offsets: [[3, 4]] }
  ])('preserves non-overlapping UTF-16 offsets across split chunks ($chunks)', ({ query, chunks, offsets }) => {
    const match = createPdfTextMatcher(query, 2, 100);
    for (const chunk of chunks) match(chunk);
    expect(match('', true)).toEqual(offsets.map(([start, end]) => ({ pageIndex: 2, start, end })));
  });

  it('reports partial page failures separately from preview errors and keeps other results', async () => {
    const { session, pages } = await open(['First', 'bad', 'needle']);
    try {
      pages[1].streamTextContent.mockReturnValueOnce(new ReadableStream({ start(controller) { controller.error(new Error('Damaged text')); } }));
      await session.find('needle');
      expect(session.getState().search).toMatchObject({ total: 1, pagesScanned: 3, error: 'PDF page 2: Damaged text', searching: false });
      expect(session.getState().error).toBeNull();
    } finally { session.destroy(); }
  });

  it.each([false, true])('distinguishes an exact result limit from overflow (%s)', async truncated => {
    const { session, pages } = await open(['', '']);
    try {
      pages[1].streamTextContent.mockReturnValueOnce(textStream([{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + Number(truncated)) }]));
      await session.find('x');
      expect(session.getState().search).toMatchObject({ total: PDF_SEARCH_MATCH_LIMIT, truncated, searching: false });
    } finally { session.destroy(); }
  });

  it('stops at a confirmed overflow without waiting for more text', async () => {
    const { session, pages } = await open(['', '', 'x']);
    const cancel = vi.fn(), pull = vi.fn();
    try {
      const stream = new ReadableStream({
        start(controller) { controller.enqueue({ items: [{ str: 'x '.repeat(PDF_SEARCH_MATCH_LIMIT + 1) }] }); },
        pull,
        cancel
      }, { highWaterMark: 0 });
      pages[1].streamTextContent.mockReturnValueOnce(stream);
      await session.find('x');
      expect(session.getState().search).toMatchObject({
        total: PDF_SEARCH_MATCH_LIMIT, pagesScanned: 2, searching: false, truncated: true
      });
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortException' }));
      expect(stream.locked).toBe(false);
    } finally { session.destroy(); }
  });
});
