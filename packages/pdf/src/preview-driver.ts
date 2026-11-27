/// <reference types="vite/client" />

import {
  PreviewPasswordError,
  PreviewFindControls,
  bindPreviewTouchGestures,
  classifyPreviewFont,
  PREVIEW_CONTAINER_LIMITS,
  createPreviewContainerContext,
  readPreviewContainerEntry,
  waitForContainerTask,
  attachmentFilename,
  unwrapOfficeAttachment,
  type PreviewAttachment,
  type PagedPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewFontDiagnostic,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import { pdfContentKey, pdfPageCache, pdfPageKey } from './page-cache';
import { PDF_PAGE_GAP, PDF_SCROLL_HEIGHT, PdfPageLayout } from './page-layout';
import { budgetPdfRasters, PDF_DETAIL_RASTER_PIXELS, PDF_MAX_RASTER_PIXELS, sizePdfRaster, sizeVirtualPdfRaster } from './page-raster';
import { PDF_SEARCH_MATCH_LIMIT, createPdfTextMatcher, highlightPdfRanges, highlightPdfText, indexPdfText, matchPdfTextRuns, releasePdfTextHighlights,
  type PdfTextMatch, type PdfTextProgress } from './search';
import { createPdfBlobRange, PDF_RANGE_CHUNK_BYTES } from './blob-range';
import { createLocalPdfWorker, type LocalPdfWorker } from './local-worker';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};
type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type PdfTextStyles = PdfTextContent['styles'];
const VISIBLE_PDF_PAINTS = 2;
const PDF_SEARCH_CACHE_UNITS = 1024 * 1024;
const PDF_SEARCH_CACHE_PAGE_UNITS = 32 * 1024;
const PDF_SEARCH_CACHE_PAGES = 4096;

interface PdfRendererFont {
  name?: string;
  mimetype?: string;
  missingFile?: boolean;
  disableFontFace?: boolean;
  isInvalidPDFjsFont?: boolean;
  isType3Font?: boolean;
  charProcOperatorList?: Record<string, unknown>;
}

interface PageArea { left: number; top: number; right: number; bottom: number }
interface PageWindow { visible: ReadonlySet<number>; needed: ReadonlySet<number> }
type PageViewport = ReturnType<PDFPageProxy['getViewport']>;

interface PageSlot {
  index: number;
  element: HTMLDivElement;
  page?: PDFPageProxy;
  request?: AbortController;
  canvas?: HTMLCanvasElement;
  rasterBudget?: number;
  task?: RenderTask;
  detailViewport?: PageViewport;
  detail?: { area: PageArea; canvas: HTMLCanvasElement; task?: RenderTask };
  textRender?: { viewport: PageViewport; cachedPixels?: boolean; started?: boolean };
  textLayer?: TextLayer;
  textElement?: HTMLDivElement;
  textProgress?: PdfTextProgress;
  textOffsets?: number[];
  /** UTF-16 length when the selection layer contains the complete page text. */
  textLength?: number;
}

export { PDF_FORMAT_ROUTES, createPdfPreviewRoutes } from './routes';

export class PdfPreviewSession implements PreviewSession<PagedPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly pageTrack = document.createElement('div');
  private readonly container: HTMLDivElement;
  private readonly findControls: PreviewFindControls;
  private searchGeneration = 0;
  private searchController?: AbortController;
  private searchReader?: ReadableStreamDefaultReader<PdfTextContent>;
  private searchFrame?: number;
  private refreshVisibleSearch?: () => void;
  private searchNavigated = false;
  private matches: PdfTextMatch[] = [];
  private readonly pageMatches = new Map<number, PdfTextMatch[]>();
  private readonly searchPageText = new Map<number, string>();
  private searchTextUnits = 0;
  private document: PDFDocumentProxy | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private localWorker?: LocalPdfWorker;
  private loadController?: AbortController;
  private readonly pageSlots = new Map<number, PageSlot>();
  private visibleTextPages?: ReadonlySet<number>;
  private layout?: PdfPageLayout;
  private pageTargetScrollTop?: number;
  private loadGeneration = 0;
  private renderGeneration = 0;
  private rendering: Promise<void> | null = null;
  private refreshVisiblePaint?: () => void;
  private renderAgain = false;
  private animationFrame: number | null = null;
  private resizeObserver?: ResizeObserver;
  private removeAbortListener?: () => void;
  private dimensions = '';
  private contentKey?: string;
  private sensitive = false;
  private readonly virtual: boolean;
  private unbindTouch = () => {};
  private readonly containerContext;
  private state: PagedPreviewState;
  private pdfjs?: typeof import('pdfjs-dist');
  private readonly fonts = new Map<string, PreviewFontDiagnostic>();

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    this.containerContext = options.containerContext ?? createPreviewContainerContext();
    this.root = document.createElement('div');
    this.root.className = 'pdfv-preview';
    this.root.tabIndex = 0;
    this.container = document.createElement('div');
    this.container.className = 'pdfv-container';
    this.container.append(this.root);
    this.host.replaceChildren(this.container);
    this.virtual = options.virtual !== false;
    if (this.virtual) this.root.classList.add('pdfv-virtual');
    this.pageTrack.className = 'pdfv-page-track';
    this.root.addEventListener('scroll', this.scheduleRender, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.document && this.dimensions !== this.rootDimensions()) this.relayout();
      });
      this.resizeObserver.observe(this.root);
    }
    this.state = {
      loading: false,
      error: null,
      family: 'paged',
      warnings: [],
      capabilities: {
        paged: true,
        zoom: true,
        fit: true,
        print: !this.virtual,
        download: true,
        fullscreen: true,
        search: true
      },
      pageIndex: 0,
      pageCount: 0,
      scale: options.initialScale ?? 1,
      fit: options.fit ?? 'contain'
    };
    this.findControls = new PreviewFindControls(this.root, {
      state: () => this.state.search,
      find: query => this.find(query), reset: query => this.resetSearch(query), next: backward => this.findNext(backward),
      translate: message => this.options.translate?.(message) ?? message
    });
    this.findControls.element.classList.add('pdfv-search-controls');
    this.container.append(this.findControls.element);
  }

  refreshTranslations(): void { this.findControls.refreshTranslations(); }

  private reportSearch(notify = true): void {
    if (this.searchFrame !== undefined) cancelAnimationFrame(this.searchFrame);
    this.searchFrame = undefined;
    this.findControls.update();
    if (notify) this.emit('statechange', this.getState());
  }

  private resetSearch(query = '', notify = true): number {
    this.findControls.cancelPending();
    const generation = ++this.searchGeneration;
    this.refreshVisibleSearch = undefined;
    this.searchController?.abort();
    this.searchController = undefined;
    const reader = this.searchReader;
    this.searchReader = undefined;
    if (reader && this.pdfjs) void reader.cancel(new this.pdfjs.AbortException('PDF search cancelled.')).catch(() => {});
    this.matches = [];
    this.searchNavigated = false;
    this.pageMatches.clear();
    this.state.search = { query, searching: false, total: 0, activeIndex: -1, pagesScanned: 0, pageCount: this.document?.numPages ?? 0, truncated: false };
    for (const slot of this.pageSlots.values()) this.highlightPage(slot);
    this.reportSearch(notify);
    return generation;
  }

  async find(query: string): Promise<void> {
    this.findControls.setQuery(query);
    const generation = this.resetSearch(query), pdf = this.document;
    if (generation !== this.searchGeneration || !pdf || !query.trim()) return;
    const controller = new AbortController();
    this.searchController = controller;
    const search = this.state.search!;
    const current = () => generation === this.searchGeneration && pdf === this.document;
    search.searching = true;
    this.reportSearch();
    if (!current()) return;
    const progress = () => { this.searchFrame ??= requestAnimationFrame(() => this.reportSearch()); };
    const scanned = new Map<number, number>();
    let pageIndex = -1, scanningVisible = false, refresh = false;
    const active = () => current() && search.searching;
    const scanVisible = async () => {
      if (!active()) return;
      refresh = true;
      if (scanningVisible) return;
      scanningVisible = true;
      try {
        while (refresh) {
          refresh = false;
          for (const { index, runs, offsets, length } of this.visibleSearchText()) {
            if (!active()) return;
            // The ordered scan owns its current page, including any pending reader.
            if (index <= pageIndex || scanned.has(index)) continue;
            const limit = PDF_SEARCH_MATCH_LIMIT - this.searchMatchOffset(index) + 1;
            if (limit === 1 && search.truncated) continue;
            let found: PdfTextMatch[] | undefined;
            try {
              found = await matchPdfTextRuns(runs, offsets, length,
                createPdfTextMatcher(query, index, limit), limit, controller.signal);
            } catch {
              // The ordered scan can retry an unavailable preview result.
            }
            if (!active()) return;
            if (!found || index <= pageIndex || !this.visibleTextPages?.has(index)) continue;
            const before = this.searchMatchOffset(index), remaining = PDF_SEARCH_MATCH_LIMIT - before;
            scanned.set(index, found.length);
            search.pagesScanned++;
            this.mergeSearchMatches(found.slice(0, remaining), before);
            if (!active()) return;
            search.truncated ||= found.length > remaining;
            progress();
          }
        }
      } finally { scanningVisible = false; }
    };
    this.refreshVisibleSearch = () => { void scanVisible(); };
    await scanVisible();

    // Confirm results in document order, so provisional visible hits cannot displace earlier matches at the cap.
    let confirmed = 0;
    let deadline = performance.now() + 16;
    for (pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      if (!current()) return;
      const remaining = PDF_SEARCH_MATCH_LIMIT - confirmed;
      const cached = scanned.get(pageIndex);
      scanned.delete(pageIndex);
      let count = cached ?? 0;
      try {
        if (cached === undefined) {
          const found = await this.readSearchMatches(pdf, query, pageIndex, remaining + 1, controller.signal);
          if (!current()) return;
          count = found.length;
          this.mergeSearchMatches(found.slice(0, remaining), confirmed, confirmed === 0 && !this.searchNavigated);
        }
      } catch (error) {
        if (!current()) return;
        search.error = `PDF page ${pageIndex + 1}: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!current()) return;
      if (cached === undefined) search.pagesScanned++;
      confirmed += Math.min(count, remaining);
      if (count > remaining) { search.truncated = true; break; }
      if (!current()) return;
      progress();
      // Cached pages can resolve in one task. Give the browser time to process cancellation and paint.
      if (performance.now() >= deadline) {
        await new Promise(resolve => setTimeout(resolve, 0));
        deadline = performance.now() + 16;
      }
    }
    if (current()) {
      this.refreshVisibleSearch = undefined;
      this.searchController = undefined;
      search.searching = false;
      controller.abort();
      this.reportSearch();
    }
  }

  private visibleSearchText() {
    const ready: { index: number; runs: readonly string[]; offsets: readonly number[]; length: number }[] = [];
    for (const index of [...(this.visibleTextPages ?? [])].sort((a, b) => a - b)) {
      const slot = this.pageSlots.get(index);
      if (!slot?.textLayer || !slot.textOffsets || slot.textLength === undefined) continue;
      ready.push({ index, runs: slot.textLayer.textContentItemsStr, offsets: slot.textOffsets, length: slot.textLength });
    }
    return ready;
  }

  private searchMatchOffset(pageIndex: number): number {
    let first = 0, last = this.matches.length;
    while (first < last) {
      const middle = (first + last) >>> 1;
      if (this.matches[middle].pageIndex < pageIndex) first = middle + 1;
      else last = middle;
    }
    return first;
  }

  private mergeSearchMatches(added: PdfTextMatch[], before: number, selectFirst = false): void {
    if (!added.length) return;
    const search = this.state.search!;
    const active = search.activeIndex;
    const keep = PDF_SEARCH_MATCH_LIMIT - added.length;
    let trimmedPage = Infinity;
    while (this.matches.length > keep) {
      const page = trimmedPage = this.matches.at(-1)!.pageIndex;
      const matches = this.pageMatches.get(page)!;
      const removed = Math.min(matches.length, this.matches.length - keep);
      if (removed === matches.length) this.pageMatches.delete(page);
      else this.pageMatches.set(page, matches.slice(0, -removed));
      this.matches.length -= removed;
    }
    const page = added[0].pageIndex;
    this.matches.splice(before, 0, ...added);
    this.pageMatches.set(page, added);
    search.total = this.matches.length;
    const next = selectFirst ? 0 : active + (before <= active ? added.length : 0);
    if (selectFirst || next < 0 || next >= search.total) {
      this.selectSearchMatch(Math.max(0, Math.min(next, search.total - 1)));
      return;
    }
    search.activeIndex = next;
    for (const slot of this.pageSlots.values()) {
      if (slot.index === page || slot.index >= trimmedPage) this.highlightPage(slot);
    }
  }

  private async readSearchMatches(pdf: PDFDocumentProxy, query: string, index: number, limit: number, signal: AbortSignal): Promise<PdfTextMatch[]> {
    const cached = this.searchPageText.get(index);
    if (cached !== undefined) return createPdfTextMatcher(query, index, limit)(cached, true);
    const slot = this.pageSlots.get(index);
    if (slot?.textLength === 0) return [];
    const progress = slot?.textProgress, offsets = progress?.offsets ?? slot?.textOffsets;
    const length = progress?.length ?? slot?.textLength;
    if (length !== undefined && slot?.textLayer && offsets) {
      const found = await matchPdfTextRuns(slot.textLayer.textContentItemsStr, offsets, length,
        createPdfTextMatcher(query, index, limit), limit, signal, progress);
      if (found) return found;
    }

    const matchChunk = createPdfTextMatcher(query, index, limit);
    const page = await waitForContainerTask(pdf.getPage(index + 1), signal);
    signal.throwIfAborted();
    const AbortException = this.pdfjs?.AbortException ?? Error;
    const reader: ReadableStreamDefaultReader<PdfTextContent> = page.streamTextContent().getReader();
    this.searchReader = reader;
    // Keep complete text within the open document, without evicting earlier pages during a sequential scan.
    const capacity = this.sensitive || this.searchPageText.size >= PDF_SEARCH_CACHE_PAGES ? 0
      : Math.min(PDF_SEARCH_CACHE_PAGE_UNITS, PDF_SEARCH_CACHE_UNITS - this.searchTextUnits);
    let completeText = capacity ? '' : undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) {
          if (completeText !== undefined) {
            this.searchPageText.set(index, completeText);
            this.searchTextUnits += completeText.length;
          }
          return matchChunk('', true);
        }
        const { text } = indexPdfText(value.items);
        if (completeText !== undefined) completeText = completeText.length + text.length <= capacity ? completeText + text : undefined;
        const matches = matchChunk(text);
        if (matches.length === limit) {
          void reader.cancel(new AbortException('PDF search result limit reached.')).catch(() => {});
          return matches;
        }
      }
    } finally {
      if (this.searchReader === reader) this.searchReader = undefined;
      reader.releaseLock();
    }
  }

  findNext(backward = false): void {
    const search = this.state.search;
    if (!search || !this.matches.length) return;
    this.searchNavigated = true;
    this.selectSearchMatch((search.activeIndex + (backward ? -1 : 1) + this.matches.length) % this.matches.length);
    this.reportSearch();
  }

  private selectSearchMatch(index: number): void {
    this.state.search!.activeIndex = index;
    this.goToPage(this.matches[index].pageIndex);
    for (const slot of this.pageSlots.values()) this.highlightPage(slot);
  }

  private highlightPage(slot: PageSlot): void {
    if (!slot.textLayer || !slot.textOffsets || slot.textElement?.dataset.rendered !== 'true') return;
    const matches = this.pageMatches.get(slot.index) ?? [];
    const match = this.matches[this.state.search?.activeIndex ?? -1];
    const ranges = highlightPdfRanges(slot.textLayer, slot.textOffsets, matches, match);
    const active = ranges ? ranges.range : highlightPdfText(slot.textLayer, slot.textOffsets, matches, match);
    if (active) {
      const keepTarget = this.hasPageTarget();
      if (keepTarget && slot.index !== this.state.pageIndex) return;
      const root = this.root.getBoundingClientRect(), rect = active.getBoundingClientRect();
      const top = root.top + this.root.clientTop, left = root.left + this.root.clientLeft;
      const { clientWidth, clientHeight } = this.root;
      if (rect.top < top || rect.bottom > top + clientHeight) {
        const distance = rect.top - top - Math.max(0, (clientHeight - rect.height) / 2);
        this.scrollToTop(this.root.scrollTop + distance / (this.virtual ? this.scrollRatio() : 1), keepTarget);
      }
      if (rect.left < left || rect.right > left + clientWidth) {
        this.root.scrollLeft += rect.left - left - Math.max(0, (clientWidth - rect.width) / 2);
      }
    }
  }

  async getAttachments(): Promise<PreviewAttachment[]> {
    const pdf = this.document;
    if (!pdf) return [];
    const attachments: Record<string, { filename: string; content: Uint8Array }> | null = await pdf.getAttachments();
    if (pdf !== this.document || !attachments) return [];
    const entries = Object.entries(attachments);
    if (!entries.length) return [];
    if (entries.length > PREVIEW_CONTAINER_LIMITS.maxEntries) throw new Error('PDF contains too many attachments.');
    const sensitive = this.sensitive || !(await isUnencryptedPdf(pdf));
    if (pdf !== this.document) return [];
    const sourceFlags = sensitive ? { sensitive: true } : {};
    return entries.map(([id, attachment]) => {
      const readRaw: NonNullable<PreviewAttachment['readRaw']> = async signal => {
        if (pdf !== this.document) throw new DOMException('PDF preview closed.', 'AbortError');
        const bytes = await readPreviewContainerEntry(async () => attachment.content, attachment.content.byteLength, this.containerContext, signal);
        return { source: bytes, name: attachmentFilename(attachment.filename), size: bytes.byteLength, ...sourceFlags };
      };
      return {
        id, name: attachmentFilename(attachment.filename), size: attachment.content.byteLength, readRaw,
        read: async signal => {
          const raw = await readRaw(signal);
          return { ...await unwrapOfficeAttachment(raw.source as Uint8Array, raw.name!), ...sourceFlags };
        }
      };
    });
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const signal = context.signal;
    const generation = ++this.loadGeneration;
    this.removeAbortListener?.();
    const previous = this.releaseDocument();
    const controller = new AbortController();
    this.loadController = controller;
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      pageIndex: 0,
      pageCount: 0
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    const abort = () => {
      if (generation !== this.loadGeneration) return;
      this.loadGeneration++;
      void this.releaseDocument().catch(() => undefined);
      this.state.loading = false;
      this.state.pageIndex = this.state.pageCount = 0;
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener('abort', abort);

    let loadError: Error | undefined;
    const handleReadError = (error: Error) => {
      if (generation !== this.loadGeneration) return;
      // Wake the pending loader or close an already rendered document.
      loadError = error;
      if (this.state.loading) controller.abort();
      else this.failLoad(error);
    };
    try {
      await waitForContainerTask(previous, controller.signal);
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      const [input, pdfjs, { default: workerSource }] = await waitForContainerTask(Promise.all([
        toPdfSource(source, this.virtual),
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]), controller.signal);
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      // Hash before PDF.js transfers the owned input buffer to its worker.
      this.sensitive = Boolean(context.descriptor.sensitive || context.descriptor.password !== undefined);
      const contentKey = this.virtual && !this.sensitive && !(input instanceof Blob)
        ? await waitForContainerTask(pdfContentKey(input), controller.signal) : undefined;
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      const workerUrl = workerSource as string | (() => string);
      const pdfWorkerUrl = typeof workerUrl === 'function' ? workerUrl() : workerUrl;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        const worker = await createLocalPdfWorker(pdfjs.PDFWorker, pdfWorkerUrl, controller.signal, handleReadError);
        if (controller.signal.aborted || generation !== this.loadGeneration) {
          await worker?.close();
          controller.signal.throwIfAborted();
          return;
        }
        this.localWorker = worker;
        // Preloading keeps PDF.js's main-thread fallback usable if a local
        // browser or policy blocks the direct module worker.
        if (!worker) await waitForContainerTask(import(/* @vite-ignore */ pdfWorkerUrl), controller.signal);
        if (signal?.aborted) throw abortError();
        if (generation !== this.loadGeneration) return;
      }
      const sourceOptions = input instanceof Blob
        ? { range: createPdfBlobRange(pdfjs.PDFDataRangeTransport, input, controller.signal, handleReadError),
          rangeChunkSize: PDF_RANGE_CHUNK_BYTES }
        : typeof input === 'string' ? { url: input } : { data: input };
      const useRanges = input instanceof Blob || (this.virtual && typeof input === 'string'
        && /^https?:$/.test(new URL(input, window.location.href).protocol));
      const task = pdfjs.getDocument({
        ...sourceOptions,
        ...(this.localWorker ? { worker: this.localWorker.worker } : {}),
        // PDF.js only stops background downloads when both options are set.
        ...(useRanges ? { disableStream: true, disableAutoFetch: true } : {}),
        // Font provenance below depends on PDF.js having no standardFontDataUrl
        // or other external source of outline font bytes.
        password: context.descriptor.password
      });
      this.loadingTask = task;
      const pdf = await waitForContainerTask(task.promise, controller.signal);
      if (generation !== this.loadGeneration) return;

      this.document = pdf;
      this.pdfjs = pdfjs;
      this.state.pageCount = pdf.numPages;
      this.root.setAttribute('role', 'document');
      this.root.setAttribute('aria-label', context.descriptor.name ?? 'PDF preview');
      this.root.replaceChildren();
      const [first, unencrypted] = await waitForContainerTask(Promise.all([
        pdf.getPage(1),
        contentKey ? isUnencryptedPdf(pdf) : false
      ]), controller.signal);
      if (generation !== this.loadGeneration) return;
      this.contentKey = unencrypted ? contentKey : undefined;
      const viewport = first.getViewport({ scale: 1 });
      this.layout = new PdfPageLayout(pdf.numPages, viewport);
      if (this.virtual) this.root.append(this.pageTrack);
      this.mountPage(0).page = first;
      if (!this.virtual) for (let index = 1; index < pdf.numPages; index++) this.mountPage(index);
      this.scrollToTop(0, this.virtual);
      this.layoutPages();
      // Reveal the first painted page without waiting for the rest of a tall
      // viewport. Nearby pages continue through the normal rendering queue.
      // Non-virtual (print/export) previews still finish every page before ready.
      await waitForContainerTask(this.renderVisiblePages(this.virtual), controller.signal);
      if (generation !== this.loadGeneration) return;

      this.state.loading = false;
      this.state.error = null;
      this.unbindTouch = bindPreviewTouchGestures(this.root, {
        getScale: () => this.state.scale,
        setScale: scale => this.setScale(scale),
        enabled: () => !this.state.loading && !!this.document,
        minScale: this.options.minScale,
        maxScale: this.options.maxScale,
        signal
      });
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
      if (this.virtual) this.scheduleRender();
    } catch (error) {
      if (signal?.aborted) {
        abort();
        throw abortError();
      }
      if (generation !== this.loadGeneration) return;
      const normalizedError = loadError ?? ((error as { name?: string })?.name === 'PasswordException'
        ? new PreviewPasswordError((error as { code?: number }).code === 2 ? 'password_invalid' : 'password_required')
        : error instanceof Error ? error : new Error(String(error)));
      this.failLoad(normalizedError);
      throw normalizedError;
    }
  }

  private failLoad(error: Error): void {
    this.loadGeneration++;
    void this.releaseDocument().catch(() => undefined);
    this.state.loading = false;
    this.state.pageIndex = this.state.pageCount = 0;
    this.state.error = error.message;
    this.emit('error', error);
    this.emit('statechange', this.state);
  }

  destroy(): void {
    this.findControls.destroy();
    this.unbindTouch();
    this.loadGeneration += 1;
    this.removeAbortListener?.();
    this.root.removeEventListener('scroll', this.scheduleRender);
    this.resizeObserver?.disconnect();
    void this.releaseDocument().catch(() => undefined);
    if (this.container.parentElement === this.host) {
      this.host.replaceChildren();
    }
  }

  getState(): PagedPreviewState {
    return { ...this.state, search: this.state.search ? { ...this.state.search } : undefined, fonts: this.state.fonts?.map(font => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })), warnings: this.state.warnings.slice(), capabilities: { ...this.state.capabilities } };
  }

  goToPage(index: number): void {
    if (!Number.isFinite(index) || !this.layout?.count) return;
    const next = Math.max(0, Math.min(this.layout.count - 1, Math.trunc(index)));
    this.state.pageIndex = next;
    if (this.virtual) {
      const ratio = this.scrollRatio();
      this.scrollToTop(this.layout.offset(next) / ratio, true);
      if (ratio > 1) this.positionPageWindow();
    } else this.root.scrollTop = this.pageSlots.get(next)!.element.offsetTop;
    this.emit('statechange', this.getState());
    this.scheduleRender();
  }

  next(): void { this.goToPage(this.state.pageIndex + 1); }
  prev(): void { this.goToPage(this.state.pageIndex - 1); }

  setScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.state.scale) return;
    this.state.scale = scale;
    this.relayout();
  }

  fit(mode: PagedPreviewState['fit'] = 'contain'): void {
    this.state.fit = mode;
    this.relayout();
  }

  fullscreen(): Promise<void> | undefined { return this.host.requestFullscreen?.(); }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }

  private pageScale(width: number, height: number, containerWidth: number, containerHeight: number): number {
    const widthScale = containerWidth > 0 ? containerWidth / width : 1;
    const heightScale = containerHeight > 0 ? containerHeight / height : 1;
    if (this.state.fit === 'width') return widthScale * this.state.scale;
    if (this.state.fit === 'height') return heightScale * this.state.scale;
    if (this.state.fit === 'contain') return Math.min(widthScale, heightScale, 1) * this.state.scale;
    return this.state.scale;
  }

  private rootDimensions(): string { return `${this.root.clientWidth}:${this.root.clientHeight}`; }

  private layoutPages(): void {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    this.dimensions = `${width}:${height}`;
    this.layout?.resize((pageWidth, pageHeight) => this.pageScale(pageWidth, pageHeight, width, height));
    if (this.virtual) this.positionPageWindow();
    else for (const slot of this.pageSlots.values()) this.sizeSlot(slot);
  }

  private sizeSlot(slot: PageSlot): number {
    const { width, height } = this.layout!.size(slot.index);
    const scale = this.layout!.scaleFor(slot.index);
    const pageWidth = width * scale;
    slot.element.style.width = `${pageWidth}px`;
    slot.element.style.height = `${height * scale}px`;
    return pageWidth;
  }

  private scrollRatio(viewportHeight = this.root.clientHeight): number {
    return Math.max(1, ((this.layout?.totalHeight ?? 0) - viewportHeight) / Math.max(1, PDF_SCROLL_HEIGHT - viewportHeight));
  }

  private atScrollEnd(): boolean {
    const top = this.root.scrollTop;
    const limit = this.root.scrollHeight - this.root.clientHeight;
    return top > 0 && limit > 0 && top >= limit - 1;
  }

  private hasPageTarget(): boolean {
    const targetTop = this.pageTargetScrollTop;
    if (targetTop === undefined) return false;
    const scrollTop = this.root.scrollTop;
    if (scrollTop === targetTop) return true;
    const limit = Math.max(0, this.root.scrollHeight - this.root.clientHeight);
    if (targetTop > limit && Math.abs(scrollTop - limit) <= 0.5) return true;
    this.pageTargetScrollTop = undefined;
    return false;
  }

  private scrollToTop(top: number, keepTarget: boolean): void {
    this.root.scrollTop = top;
    this.pageTargetScrollTop = keepTarget ? this.root.scrollTop : undefined;
  }

  private restorePagePosition(index: number, offset: number, atEnd: boolean, keepTarget: boolean): void {
    const layout = this.layout!;
    const stickToEnd = atEnd && (!keepTarget || index === layout.count - 1);
    if (keepTarget) {
      offset = Math.max(1 - this.root.clientHeight, Math.min(offset, Math.max(0, layout.height(index) - 1)));
    }
    this.scrollToTop(stickToEnd ? this.root.scrollHeight : (layout.offset(index) + offset) / this.scrollRatio(), keepTarget);
    this.positionPageWindow();
  }

  private positionPageWindow(): void {
    const layout = this.layout;
    if (!layout) return;
    const width = this.root.clientWidth, height = this.root.clientHeight;
    const scrollTop = this.root.scrollTop;
    // Keep mounted pages at their normal scale when the scroll track is compressed.
    const origin = scrollTop * (1 - this.scrollRatio(height));
    let trackWidth = width;
    for (const slot of this.pageSlots.values()) {
      const pageWidth = this.sizeSlot(slot);
      slot.element.style.top = `${layout.offset(slot.index) + origin}px`;
      slot.element.style.left = `${Math.max(0, (width - pageWidth) / 2)}px`;
      trackWidth = Math.max(trackWidth, pageWidth);
    }
    this.pageTrack.style.width = `${trackWidth}px`;
    this.pageTrack.style.height = `${Math.min(layout.totalHeight, PDF_SCROLL_HEIGHT)}px`;
  }

  private mountPage(index: number, before: Element | null = null): PageSlot {
    const element = document.createElement('div');
    element.className = 'pdfv-page-slot';
    element.dataset.pageIndex = String(index);
    (this.virtual ? this.pageTrack : this.root).insertBefore(element, before);
    const slot = { index, element };
    this.pageSlots.set(index, slot);
    return slot;
  }

  private updatePageWindow(needed: ReadonlySet<number>, visible: ReadonlySet<number>): void {
    if (!this.virtual || !this.layout) return;
    this.visibleTextPages = visible;
    for (const [index, slot] of this.pageSlots) if (!needed.has(index)) {
      this.clearCanvas(slot);
      // PDF.js caches page proxies, so removing the canvas alone retains their drawing data.
      slot.page?.cleanup?.();
      slot.element.remove();
      this.pageSlots.delete(index);
    }
    let before = this.pageTrack.firstElementChild;
    for (const index of needed) {
      const slot = this.pageSlots.get(index);
      if (slot) before = slot.element.nextElementSibling;
      else this.mountPage(index, before);
    }
    this.positionPageWindow();
    this.budgetPageWindow(needed, visible);
    for (const slot of this.pageSlots.values()) {
      if (visible.has(slot.index)) this.startPageText(slot);
      else if (slot.textRender?.started && slot.textElement?.dataset.rendered !== 'true' && slot.textLength !== 0) {
        const { viewport, cachedPixels } = slot.textRender;
        // Invalidate this read before cancellation settles. Reuse the painted page on reentry.
        slot.textRender = slot.canvas?.dataset.rendered === 'true' ? { viewport, cachedPixels } : undefined;
        this.clearText(slot);
      }
      if (!slot.detail) continue;
      const visibleArea = this.visiblePageArea(slot);
      const { area } = slot.detail;
      if (!visibleArea || visibleArea.left < area.left || visibleArea.top < area.top
        || visibleArea.right > area.right || visibleArea.bottom > area.bottom) this.clearDetail(slot);
    }
    this.refreshVisibleSearch?.();
  }

  private budgetPageWindow(needed: ReadonlySet<number>, visible: ReadonlySet<number>): void {
    const layout = this.layout!, density = window.devicePixelRatio || 1;
    const current = visible.has(this.state.pageIndex) ? this.state.pageIndex : (visible.size ? visible : needed).values().next().value;
    const visibleRasters = [], nearbyRasters = [];
    let currentRaster: { index: number; pixels: number } | undefined;
    for (const index of needed) {
      const { width, height } = layout.size(index), scale = layout.scaleFor(index);
      const raster = sizePdfRaster(width * scale, height * scale, density);
      const demand = { index, pixels: raster.limited ? PDF_MAX_RASTER_PIXELS : raster.width * raster.height };
      if (index === current) currentRaster = demand;
      else if (visible.has(index)) visibleRasters.push(demand);
      else nearbyRasters.push(demand);
    }
    const budgets = budgetPdfRasters(currentRaster, visibleRasters, nearbyRasters);
    for (const slot of this.pageSlots.values()) {
      const budget = budgets.get(slot.index) ?? 0;
      const previous = slot.rasterBudget ?? 0;
      slot.rasterBudget = budget;
      const base = canvasPixels(slot.canvas);
      if (base > budget || (!budget && slot.request)) {
        this.clearCanvas(slot, true);
      } else if (slot.index === current && slot.canvas && budget > previous) {
        const canvas = slot.canvas;
        const plan = sizeVirtualPdfRaster(parseFloat(canvas.style.width), parseFloat(canvas.style.height), density, budget);
        if (canvas.width !== plan.raster.width || canvas.height !== plan.raster.height
          || Boolean(slot.detailViewport) !== plan.detail) this.clearCanvas(slot, true);
        else this.clearDetail(slot);
      } else if (base + canvasPixels(slot.detail?.canvas) > budget) {
        this.clearDetail(slot);
      }
    }
  }

  private relayout(): void {
    if (!this.layout) return;
    const index = this.state.pageIndex;
    const anchor = this.pageSlots.get(index)?.element;
    const atEnd = this.virtual && this.atScrollEnd();
    const keepTarget = this.hasPageTarget();
    const offset = this.virtual ? this.root.scrollTop * this.scrollRatio() - this.layout.offset(index)
      : this.root.scrollTop - (anchor?.offsetTop ?? 0);
    this.renderGeneration++;
    this.renderAgain = true;
    for (const slot of this.pageSlots.values()) this.clearCanvas(slot, true);
    this.layoutPages();
    if (this.virtual) this.restorePagePosition(index, offset, atEnd, keepTarget);
    else if (anchor) this.root.scrollTop = anchor.offsetTop + offset;
    for (const slot of this.pageSlots.values()) {
      if (!slot.textElement || !slot.page) continue;
      const scale = this.layout.scaleFor(slot.index);
      setTextLayerScale(slot.textElement, scale, slot.page.userUnit);
      const pending = slot.textRender;
      if (!pending || !slot.textLayer) continue;
      try {
        pending.viewport = slot.page.getViewport({ scale });
        slot.textLayer.update({ viewport: pending.viewport });
      } catch {
        slot.textRender = undefined;
        this.clearText(slot);
      }
    }
    this.emit('statechange', this.getState());
    this.scheduleRender();
  }

  private readonly scheduleRender = () => {
    if (this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = null;
      const generation = this.loadGeneration;
      void this.renderVisiblePages().catch(error => {
        if (generation !== this.loadGeneration) return;
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.state.error = normalized.message;
        this.emit('error', normalized);
        this.emit('statechange', this.getState());
      });
    });
  };

  private visiblePages(): PageWindow {
    const layout = this.layout;
    const needed = new Set<number>(), visible = new Set<number>();
    if (!layout) return { needed, visible };
    const height = this.root.clientHeight;
    if (!this.virtual || !height) {
      const pages = new Set(this.virtual ? [this.state.pageIndex] : this.pageSlots.keys());
      return { needed: pages, visible: pages };
    }
    const top = this.root.scrollTop * this.scrollRatio(height), bottom = top + height;
    // Finish the visible preview first; nearby pages can be prepared after loading settles.
    const margin = this.state.loading ? 0 : height / 2;
    let active = this.state.pageIndex, largestOverlap = -1;
    const first = Math.max(0, layout.firstAfter(top - margin) - 1);
    let start = layout.offset(first);
    for (let index = first; index < layout.count; index++) {
      const end = start + layout.height(index);
      if (end > top - margin && start < bottom + margin) needed.add(index);
      const overlap = Math.min(end, bottom) - Math.max(start, top);
      if (overlap > 0) visible.add(index);
      if (overlap > largestOverlap) { active = index; largestOverlap = overlap; }
      if (start >= bottom + margin) break;
      start = end + PDF_PAGE_GAP;
    }
    // Several page commands can share a native scroll position, especially near the end.
    const selected = this.state.pageIndex;
    if (this.hasPageTarget() && visible.has(selected)) return { needed, visible: new Set([selected, ...visible]) };
    this.pageTargetScrollTop = undefined;
    if (visible.has(layout.count - 1) && this.atScrollEnd()) active = layout.count - 1;
    if (active !== this.state.pageIndex) {
      this.state.pageIndex = active;
      this.emit('statechange', this.getState());
    }
    return { needed, visible };
  }

  private async renderVisiblePages(firstPageOnly = false): Promise<void> {
    this.renderAgain = true;
    if (this.rendering) {
      const { needed, visible } = this.visiblePages();
      this.updatePageWindow(needed, visible);
      const needsPaint = (index: number) => {
        const slot = this.pageSlots.get(index);
        return slot?.canvas?.dataset.rendered !== 'true' || (slot.detailViewport && !slot.detail && this.visiblePageArea(slot));
      };
      const target = this.state.pageIndex;
      const prioritizeTarget = this.hasPageTarget() && visible.has(target) && needsPaint(target);
      if (prioritizeTarget || [...visible].some(needsPaint)) {
        for (const slot of this.pageSlots.values()) {
          const lowerPriority = prioritizeTarget ? slot.index !== target : !visible.has(slot.index);
          if (lowerPriority && slot.detail?.task) this.clearDetail(slot);
          else if (lowerPriority && (slot.request || slot.task)) this.clearCanvas(slot, true);
        }
      }
      this.refreshVisiblePaint?.();
      return this.rendering;
    }
    const generation = this.loadGeneration;
    const pdf = this.document;
    if (!pdf) return;
    const rendering = (async () => {
      do {
        this.renderAgain = false;
        const epoch = this.renderGeneration;
        const { needed, visible } = this.visiblePages();
        this.updatePageWindow(needed, visible);
        const current = () => generation === this.loadGeneration && epoch === this.renderGeneration && !this.renderAgain;
        const foreground = visible.size ? visible : needed;
        if (this.virtual && !firstPageOnly && visible.size) {
          await this.paintVisiblePages(pdf, generation, epoch);
        } else {
          for (const index of foreground) {
            if (!current()) break;
            await this.renderPage(pdf, index, generation, epoch);
            if (firstPageOnly && this.pageSlots.get(index)?.canvas?.dataset.rendered === 'true') break;
          }
        }
        if (firstPageOnly) continue;
        for (const index of visible) {
          if (!current()) break;
          const slot = this.pageSlots.get(index);
          if (slot?.detailViewport && !slot.detail) await this.renderDetail(slot, slot.detailViewport);
        }
        for (const index of needed) {
          if (!current()) break;
          if (!foreground.has(index)) await this.renderPage(pdf, index, generation, epoch);
        }
      } while (this.renderAgain && generation === this.loadGeneration);
    })();
    this.rendering = rendering;
    try { await rendering; }
    finally { if (this.rendering === rendering) this.rendering = null; }
  }

  private async paintVisiblePages(pdf: PDFDocumentProxy, generation: number, epoch: number): Promise<void> {
    let started = new WeakSet<PageSlot>();
    const pending = new Set<PageSlot>();
    let wake: (() => void) | undefined, failure: { error: unknown } | undefined;
    const refresh = () => { started = new WeakSet(); wake?.(); };
    const settled = (slot: PageSlot) => { pending.delete(slot); wake?.(); };
    this.refreshVisiblePaint = refresh;
    try {
      while (generation === this.loadGeneration && epoch === this.renderGeneration) {
        if (failure) {
          for (const slot of pending) this.clearCanvas(slot, true);
          throw failure.error;
        }
        for (const index of this.visibleTextPages ?? []) {
          if (pending.size >= VISIBLE_PDF_PAINTS) break;
          const slot = this.pageSlots.get(index);
          if (!slot || !this.visibleTextPages?.has(index) || started.has(slot) || pending.has(slot)
            || slot.canvas || slot.rasterBudget === 0) continue;
          started.add(slot);
          pending.add(slot);
          void this.renderPage(pdf, index, generation, epoch, true).then(
            () => settled(slot), error => { failure ??= { error }; settled(slot); }
          );
        }
        if (!pending.size) return;
        // A viewport change can fill a free slot even while another page is waiting on PDF.js.
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
    } finally {
      if (this.refreshVisiblePaint === refresh) this.refreshVisiblePaint = undefined;
    }
  }

  private async renderPage(pdf: PDFDocumentProxy, index: number, generation: number, epoch: number,
    concurrent = false): Promise<void> {
    const slot = this.pageSlots.get(index);
    if (!slot || slot.canvas || slot.rasterBudget === 0) return;
    let page = slot.page;
    if (!page) {
      const request = new AbortController();
      slot.request = request;
      try { page = await waitForContainerTask(pdf.getPage(index + 1), request.signal); }
      catch (error) {
        if (request.signal.aborted) return;
        throw error;
      } finally { if (slot.request === request) slot.request = undefined; }
    }
    if (generation !== this.loadGeneration || epoch !== this.renderGeneration || this.pageSlots.get(index) !== slot || slot.rasterBudget === 0) return;
    slot.page = page;
    const base = page.getViewport({ scale: 1 });
    const layout = this.layout!, anchorIndex = this.state.pageIndex;
    const anchor = this.pageSlots.get(anchorIndex)?.element;
    const anchorTop = this.virtual ? layout.offset(anchorIndex) : (anchor?.offsetTop ?? 0);
    const logicalTop = this.root.scrollTop * this.scrollRatio();
    if (layout.measure(index, base.width, base.height)) {
      if (this.virtual) {
        const atEnd = this.atScrollEnd();
        const keepTarget = this.hasPageTarget();
        this.positionPageWindow();
        this.restorePagePosition(anchorIndex, logicalTop - anchorTop, atEnd, keepTarget);
        // Share the budget using the measured geometry before allocating a canvas.
        this.renderAgain = true;
        if (!concurrent) return;
        const { needed, visible } = this.visiblePages();
        if (generation !== this.loadGeneration || epoch !== this.renderGeneration) return;
        this.updatePageWindow(needed, visible);
        if (!visible.has(index) || this.pageSlots.get(index) !== slot || slot.rasterBudget === 0) return;
      } else {
        this.sizeSlot(slot);
        if (anchor) this.root.scrollTop += anchor.offsetTop - anchorTop;
      }
    }
    const scale = layout.scaleFor(index);
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const { raster, detail } = this.virtual
      ? sizeVirtualPdfRaster(viewport.width, viewport.height, outputScale, slot.rasterBudget ?? PDF_MAX_RASTER_PIXELS)
      : { raster: sizePdfRaster(viewport.width, viewport.height, outputScale), detail: false };
    const canvas = document.createElement('canvas');
    canvas.className = 'pdfv-page';
    canvas.dataset.pageIndex = String(index);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${index + 1}`);
    canvas.width = raster.width;
    canvas.height = raster.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    slot.canvas = canvas;
    slot.detailViewport = detail ? viewport : undefined;
    slot.element.insertBefore(canvas, slot.textElement ?? null);
    const cacheKey = index === 0 ? pdfPageKey(this.contentKey, viewport, canvas) : undefined;
    if (cacheKey && pdfPageCache.read(cacheKey, canvas)) {
      canvas.dataset.rendered = 'true';
      slot.textRender ??= { viewport, cachedPixels: true };
      this.startPageText(slot);
      return;
    }
    const transform = raster.limited ? [raster.width / viewport.width, 0, 0, raster.height / viewport.height, 0, 0] : undefined;
    const task = page.render({ canvas, viewport: transform ? viewport : page.getViewport({ scale: scale * outputScale }),
      transform, background: '#ffffff' });
    slot.task = task;
    try {
      await task.promise;
      if (slot.canvas === canvas) {
        if (cacheKey) pdfPageCache.write(cacheKey, canvas);
        canvas.dataset.rendered = 'true';
        slot.textRender ??= { viewport };
        this.startPageText(slot);
      }
    } catch (error) {
      if (slot.canvas === canvas) this.clearCanvas(slot);
      if (generation === this.loadGeneration && epoch === this.renderGeneration && (error as Error)?.name !== 'RenderingCancelledException') throw error;
    } finally { if (slot.task === task) slot.task = undefined; }
  }

  private clearCanvas(slot: PageSlot, keepText = false): void {
    this.clearDetail(slot);
    slot.detailViewport = undefined;
    // A pending reader belongs to the page, while its raster can be repainted independently.
    if (!keepText || !slot.textLayer || slot.textElement?.dataset.rendered === 'true') slot.textRender = undefined;
    slot.request?.abort();
    slot.request = undefined;
    if (!keepText) this.clearText(slot);
    slot.task?.cancel();
    slot.task = undefined;
    if (slot.canvas) {
      slot.canvas.width = slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = undefined;
    }
  }

  private clearText(slot: PageSlot): void {
    if (slot.textProgress) {
      slot.textProgress.state = 'unavailable';
      slot.textProgress.wake?.();
      slot.textProgress = undefined;
    }
    if (slot.textLayer) {
      releasePdfTextHighlights(slot.textLayer);
      slot.textLayer.cancel();
    }
    slot.textLayer = undefined;
    slot.textElement?.remove();
    slot.textElement = undefined;
    slot.textOffsets = undefined;
    slot.textLength = undefined;
  }

  private visiblePageArea(slot: PageSlot): PageArea | undefined {
    const root = this.root.getBoundingClientRect();
    const page = slot.element.getBoundingClientRect();
    const x = root.left + this.root.clientLeft - page.left, y = root.top + this.root.clientTop - page.top;
    const left = Math.max(0, x), top = Math.max(0, y);
    const right = Math.min(page.width, x + this.root.clientWidth), bottom = Math.min(page.height, y + this.root.clientHeight);
    if (right > left && bottom > top) return { left, top, right, bottom };
  }

  private async renderDetail(slot: PageSlot, viewport: PageViewport): Promise<void> {
    const visible = this.visiblePageArea(slot);
    const budget = Math.min(PDF_DETAIL_RASTER_PIXELS, (slot.rasterBudget ?? PDF_MAX_RASTER_PIXELS) - canvasPixels(slot.canvas));
    if (!slot.page || !visible || budget <= 0) return;
    const density = window.devicePixelRatio || 1;
    const visibleWidth = visible.right - visible.left, visibleHeight = visible.bottom - visible.top;
    const availableScale = Math.sqrt(budget / visibleWidth / visibleHeight) / density;
    const padding = Math.max(0, Math.min(0.25, (availableScale - 1) / 2));
    const padX = visibleWidth * padding, padY = visibleHeight * padding;
    const area = {
      left: Math.max(0, Math.floor(visible.left - padX)), top: Math.max(0, Math.floor(visible.top - padY)),
      right: Math.min(viewport.width, Math.ceil(visible.right + padX)),
      bottom: Math.min(viewport.height, Math.ceil(visible.bottom + padY))
    };
    const width = area.right - area.left, height = area.bottom - area.top;
    if (width <= 0 || height <= 0) return;
    const raster = sizePdfRaster(width, height, density, budget);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdfv-page-detail';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.hidden = true;
    canvas.width = raster.width;
    canvas.height = raster.height;
    Object.assign(canvas.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${width}px`, height: `${height}px` });
    slot.element.insertBefore(canvas, slot.textElement ?? null);
    const detail: NonNullable<PageSlot['detail']> = { area, canvas };
    slot.detail = detail;
    const sx = raster.width / width, sy = raster.height / height;
    try {
      detail.task = slot.page.render({ canvas, viewport, transform: [sx, 0, 0, sy, -area.left * sx, -area.top * sy], background: '#ffffff' });
      await detail.task.promise;
      if (slot.detail === detail) canvas.hidden = false;
    } catch {
      if (slot.detail === detail) this.clearDetail(slot);
    } finally { detail.task = undefined; }
  }

  private clearDetail(slot: PageSlot): void {
    const detail = slot.detail;
    if (!detail) return;
    slot.detail = undefined;
    detail.task?.cancel();
    detail.canvas.width = detail.canvas.height = 0;
    detail.canvas.remove();
  }

  private startPageText(slot: PageSlot): void {
    const { page, textRender } = slot;
    if (!page || !textRender || textRender.started || (this.virtual && !this.visibleTextPages?.has(slot.index))) return;
    textRender.started = true;
    const generation = this.loadGeneration;
    void this.renderPageText(page, slot, textRender.viewport,
      () => slot.textRender === textRender, generation, textRender.cachedPixels);
  }

  private async renderPageText(page: PDFPageProxy, slot: PageSlot, viewport: PageViewport,
    current: () => boolean, generation: number, cachedPixels = false): Promise<void> {
    const TextLayerConstructor = this.pdfjs?.TextLayer;
    if (!current() || !TextLayerConstructor || !page.streamTextContent) return;
    if (slot.textLength === 0) return;
    if (slot.textLayer && slot.textElement?.dataset.rendered === 'true') {
      try {
        setTextLayerScale(slot.textElement, viewport.scale, viewport.userUnit);
        slot.textLayer.update({ viewport });
        this.highlightPage(slot);
        return;
      } catch {
        this.clearText(slot);
      }
    }
    let reader: ReadableStreamDefaultReader<PdfTextContent>;
    try {
      reader = page.streamTextContent().getReader();
    } catch {
      if (current()) this.warn(`Font metadata is unavailable for PDF page ${slot.index + 1}.`);
      return;
    }
    const styles: PdfTextStyles = Object.create(null);
    const progress: PdfTextProgress = { offsets: [], length: 0 };
    const { offsets } = progress;
    slot.textProgress = progress;
    const AbortException = this.pdfjs?.AbortException ?? Error;
    let layer: TextLayer | undefined, cancelled = false, readFailed = false;
    const textContentSource = new ReadableStream<PdfTextContent>({
      async pull(controller) {
        try {
          // With no prefetch, PDF.js has already appended the previous chunk's runs.
          if (offsets.length !== layer?.textDivs.length) progress.state = 'unavailable';
          progress.wake?.();
          const { value, done } = await reader.read();
          if (cancelled) return;
          if (done) {
            reader.releaseLock();
            controller.close();
            return;
          }
          Object.assign(styles, value.styles);
          if (!progress.state) {
            const chunk = indexPdfText(value.items);
            for (const start of chunk.offsets) offsets.push(progress.length + start);
            progress.length += chunk.text.length;
          }
          controller.enqueue(value);
        } catch (error) {
          if (cancelled) return;
          readFailed = true;
          reader.releaseLock();
          controller.error(error);
        }
      },
      cancel(reason) {
        cancelled = true;
        // A PDF.js worker can close its sink before acknowledging cancellation.
        void reader.cancel(reason instanceof Error ? reason : new AbortException('PDF text selection cancelled.')).catch(() => {});
        reader.releaseLock();
      }
    }, { highWaterMark: 0 });
    const element = document.createElement('div');
    element.className = 'pdfv-text-layer';
    setTextLayerScale(element, viewport.scale, viewport.userUnit);
    slot.textElement = element;
    slot.element.append(element);
    try {
      layer = new TextLayerConstructor({ textContentSource, container: element, viewport });
      slot.textLayer = layer;
      await layer.render();
      if (!current()) return;
      this.recordFonts(page, styles);
      if (!current()) return;
      if (cachedPixels) void this.loadCachedPageFonts(page, styles,
        () => generation === this.loadGeneration && this.pageSlots.get(slot.index) === slot);
      if (!progress.state && offsets.length === layer.textDivs.length) {
        slot.textLength = progress.length;
        progress.state = 'complete';
      }
      if (!layer.textDivs.length) {
        element.remove();
        slot.textElement = slot.textLayer = undefined;
        return;
      }
      offsets.length = layer.textDivs.length;
      slot.textOffsets = offsets;
      element.dataset.rendered = 'true';
      this.highlightPage(slot);
      this.refreshVisibleSearch?.();
    } catch {
      if (!current()) return;
      if (layer) {
        releasePdfTextHighlights(layer);
        layer.cancel();
      }
      if (!textContentSource.locked) void textContentSource.cancel().catch(() => {});
      element.remove();
      slot.textElement = slot.textLayer = undefined;
      this.warn(`${readFailed ? 'Font metadata' : 'Text selection'} is unavailable for PDF page ${slot.index + 1}.`);
    } finally {
      if (slot.textProgress === progress) slot.textProgress = undefined;
      progress.state ??= 'unavailable';
      progress.wake?.();
    }
  }

  private recordFonts(page: PDFPageProxy, styles: PdfTextStyles): void {
    let changed = false;
    for (const [fontId, style] of Object.entries(styles)) {
      const previous = this.fonts.get(fontId);
      const font = page.commonObjs?.has(fontId) ? page.commonObjs.get(fontId) as PdfRendererFont | undefined : undefined;
      if (previous && !font) continue;
      const type3 = font?.isType3Font === true;
      const name = !font?.isInvalidPDFjsFont && typeof font?.name === 'string' && !(type3 && font.name === 'Type3')
        ? font.name.trim() : '';
      // PDF.js can clear data after binding. Its MIME type and missing-file flag
      // survive that cleanup; Type 3 fonts instead carry PDF glyph programs.
      const embedded = !font?.isInvalidPDFjsFont && (type3 ? Boolean(Object.keys(font?.charProcOperatorList ?? {}).length)
        : font?.missingFile === false && typeof font.mimetype === 'string' && font.mimetype.startsWith('font/'));
      const fontFamily = name || style.fontFamily;
      const source = embedded ? 'embedded' : 'unknown';
      const status = embedded && (type3 || font?.disableFontFace === false) ? 'available' : 'unknown';
      if (previous && previous.fontFamily === fontFamily && previous.source === source && previous.status === status) continue;
      this.fonts.set(fontId, {
        fontId, fontFamily, source, status,
        ...(embedded ? { embedded: true } : {}),
        classification: classifyPreviewFont(fontFamily.replace(/^[A-Z]{6}\+/, ''))
      });
      changed = true;
    }
    if (!changed) return;
    this.state.fonts = [...this.fonts.values()];
    this.emit('statechange', this.getState());
  }

  private async loadCachedPageFonts(page: PDFPageProxy, styles: PdfTextStyles, current: () => boolean): Promise<void> {
    const objects = page.commonObjs, engine = this.pdfjs;
    if (!objects || !engine || Object.keys(styles).every(id => objects.has(id))) return;
    try {
      // A fresh PDF.js worker has no painted font objects when a cached canvas
      // was reused. Fetch just this page's operators in the background.
      const operators = await page.getOperatorList({ annotationMode: engine.AnnotationMode.DISABLE });
      if (!current()) return;
      this.recordFonts(page, styles);
      if (!current()) return;
      const unresolved = new Set(Object.keys(styles).filter(id => !objects.has(id)));
      for (let index = 0; index < operators.fnArray.length && unresolved.size; index++) {
        if (operators.fnArray[index] !== engine.OPS.dependency) continue;
        for (const id of operators.argsArray[index]) {
          if (!unresolved.delete(id)) continue;
          const style = styles[id];
          objects.get(id, () => { if (current()) this.recordFonts(page, { [id]: style }); });
        }
      }
    } catch {
      // Keep diagnostics derived from text styles when metadata cannot be recovered.
    }
  }

  private warn(warning: string): void {
    this.state.warnings = [...new Set([...this.state.warnings, warning])];
    this.emit('warnings', this.state.warnings);
    this.emit('statechange', this.getState());
  }

  private releaseDocument(): Promise<void> {
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
    this.unbindTouch();
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.renderGeneration++;
    for (const slot of this.pageSlots.values()) this.clearCanvas(slot);
    this.pageSlots.clear();
    this.visibleTextPages = undefined;
    this.layout = undefined;
    this.pageTargetScrollTop = undefined;
    this.pageTrack.replaceChildren();
    this.pageTrack.removeAttribute('style');
    this.fonts.clear();
    this.state.fonts = [];
    this.rendering = null;
    this.refreshVisiblePaint = undefined;
    this.renderAgain = false;
    this.root.replaceChildren();
    const task = this.loadingTask, pdf = this.document, worker = this.localWorker;
    this.loadingTask = null;
    this.localWorker = undefined;
    this.document = null;
    this.contentKey = undefined;
    this.sensitive = false;
    this.searchPageText.clear();
    this.searchTextUnits = 0;
    this.findControls.close();
    this.resetSearch('', false);
    this.pdfjs = undefined;
    const destroying = task ? task.destroy() : pdf?.destroy() ?? Promise.resolve();
    return worker ? worker.close(destroying) : destroying;
  }
}

function canvasPixels(canvas?: HTMLCanvasElement): number { return canvas ? canvas.width * canvas.height : 0; }

function setTextLayerScale(element: HTMLElement, scale: number, userUnit = 1): void {
  element.style.setProperty('--total-scale-factor', String(scale * userUnit));
}

function abortError(): DOMException { return new DOMException('PDF loading was aborted.', 'AbortError'); }

async function isUnencryptedPdf(pdf: PDFDocumentProxy): Promise<boolean> {
  try {
    // PDF.js reports the active encryption handler here even when the user password is empty.
    const { info } = await pdf.getMetadata();
    return (info as { EncryptFilterName?: string | null }).EncryptFilterName === null;
  } catch {
    return false;
  }
}

export function createPdfPreviewDriver(): PreviewDriver<PagedPreviewState> {
  return {
    id: 'pdf',
    family: 'paged',
    supports: (format) => normalizeFormat(format) === 'pdf',
    createSession: (host, options) => new PdfPreviewSession(host, options)
  };
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}

async function toPdfSource(source: PreviewSource, virtual: boolean): Promise<string | Uint8Array | Blob> {
  if (typeof source === 'string') return source;
  if (source instanceof Blob) {
    return virtual && source.size > 2 * PDF_RANGE_CHUNK_BYTES && typeof FileReader === 'function'
      ? source : new Uint8Array(await source.arrayBuffer());
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
  }
  return new Uint8Array(source.slice(0));
}
