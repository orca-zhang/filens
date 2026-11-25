/// <reference types="vite/client" />

import {
  PreviewPasswordError,
  PreviewFindControls,
  bindPreviewTouchGestures,
  classifyPreviewFont,
  PREVIEW_CONTAINER_LIMITS,
  createPreviewContainerContext,
  readPreviewContainerEntry,
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
import { PDF_SEARCH_MATCH_LIMIT, findPdfText, highlightPdfText, indexPdfText, type PdfTextMatch } from './search';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

interface PageSlot {
  index: number;
  element: HTMLDivElement;
  width: number;
  height: number;
  page?: PDFPageProxy;
  canvas?: HTMLCanvasElement;
  task?: RenderTask;
  textLayer?: TextLayer;
  textElement?: HTMLDivElement;
  textOffsets?: number[];
  highlighted?: boolean;
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
  private readonly container: HTMLDivElement;
  private readonly findControls: PreviewFindControls;
  private searchGeneration = 0;
  private matches: PdfTextMatch[] = [];
  private readonly pageMatches = new Map<number, PdfTextMatch[]>();
  private document: PDFDocumentProxy | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private pages: PageSlot[] = [];
  private readonly activePages = new Set<PageSlot>();
  private loadGeneration = 0;
  private renderGeneration = 0;
  private rendering: Promise<void> | null = null;
  private renderAgain = false;
  private animationFrame: number | null = null;
  private resizeObserver?: ResizeObserver;
  private removeAbortListener?: () => void;
  private dimensions = '';
  private contentKey?: string;
  private readonly virtual: boolean;
  private unbindTouch = () => {};
  private readonly containerContext;
  private state: PagedPreviewState;
  private textLayerConstructor?: typeof TextLayer;
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

  private updateSearchControls(): void { this.findControls.update(); }

  private resetSearch(query = '', notify = true): number {
    this.findControls.cancelPending();
    const generation = ++this.searchGeneration;
    this.matches = [];
    this.pageMatches.clear();
    this.state.search = { query, searching: false, total: 0, activeIndex: -1, pagesScanned: 0, pageCount: this.document?.numPages ?? 0, truncated: false };
    for (const slot of this.activePages) this.highlightPage(slot);
    this.updateSearchControls();
    if (notify) this.emit('statechange', this.getState());
    return generation;
  }

  async find(query: string): Promise<void> {
    this.findControls.setQuery(query);
    const generation = this.resetSearch(query), pdf = this.document;
    if (generation !== this.searchGeneration || !pdf || !query.trim()) return;
    const search = this.state.search!;
    const current = () => generation === this.searchGeneration && pdf === this.document;
    search.searching = true;
    this.updateSearchControls(); this.emit('statechange', this.getState());
    for (let index = 0; index < pdf.numPages; index++) {
      if (!current()) return;
      try {
        const page = await pdf.getPage(index + 1);
        if (!current()) return;
        const content = await page.getTextContent();
        if (!current()) return;
        const remaining = PDF_SEARCH_MATCH_LIMIT - this.matches.length;
        const found = findPdfText(indexPdfText(content.items).text, query, index, remaining + 1);
        const kept = found.slice(0, remaining);
        if (kept.length) {
          this.pageMatches.set(index, kept); this.matches.push(...kept);
          search.total = this.matches.length;
          if (search.activeIndex < 0) { search.activeIndex = 0; this.goToPage(this.matches[0].pageIndex); }
          const slot = this.pages[index];
          if (slot) this.highlightPage(slot);
        }
        search.truncated = found.length > remaining;
      } catch (error) {
        if (!current()) return;
        search.error = `PDF page ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!current()) return;
      search.pagesScanned = index + 1;
      this.updateSearchControls(); this.emit('statechange', this.getState());
      if (search.truncated) break;
      // Yield between cached pages so typing/cancellation can interrupt a long search.
      if ((index + 1) % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (current()) { search.searching = false; this.updateSearchControls(); this.emit('statechange', this.getState()); }
  }

  findNext(backward = false): void {
    const search = this.state.search;
    if (!search || !this.matches.length) return;
    search.activeIndex = (search.activeIndex + (backward ? -1 : 1) + this.matches.length) % this.matches.length;
    this.goToPage(this.matches[search.activeIndex].pageIndex);
    for (const slot of this.activePages) this.highlightPage(slot);
    this.updateSearchControls(); this.emit('statechange', this.getState());
  }

  private highlightPage(slot: PageSlot): void {
    if (!slot.textLayer || !slot.textOffsets || slot.textElement?.dataset.rendered !== 'true') return;
    const matches = this.pageMatches.get(slot.index) ?? [];
    if (!matches.length && !slot.highlighted) return;
    highlightPdfText(slot.textLayer, slot.textOffsets, matches, this.matches[this.state.search?.activeIndex ?? -1]);
    slot.highlighted = matches.length > 0;
    const active = slot.textElement.querySelector<HTMLElement>('.pdfv-search-match.is-active');
    if (active) {
      const root = this.root.getBoundingClientRect(), rect = active.getBoundingClientRect();
      if (rect.top < root.top || rect.bottom > root.bottom) this.root.scrollTop += rect.top - root.top - this.root.clientHeight / 2;
      if (rect.left < root.left || rect.right > root.right) this.root.scrollLeft += (rect.left + rect.right - root.left - root.right) / 2;
    }
  }

  async getAttachments(): Promise<PreviewAttachment[]> {
    const pdf = this.document;
    if (!pdf) return [];
    const attachments: Record<string, { filename: string; content: Uint8Array }> | null = await pdf.getAttachments();
    if (pdf !== this.document || !attachments) return [];
    const entries = Object.entries(attachments);
    if (entries.length > PREVIEW_CONTAINER_LIMITS.maxEntries) throw new Error('PDF contains too many attachments.');
    return entries.map(([id, attachment]) => {
      const readRaw: NonNullable<PreviewAttachment['readRaw']> = async signal => {
        if (pdf !== this.document) throw new DOMException('PDF preview closed.', 'AbortError');
        const bytes = await readPreviewContainerEntry(async () => attachment.content, attachment.content.byteLength, this.containerContext, signal);
        return { source: bytes, name: attachmentFilename(attachment.filename), size: bytes.byteLength };
      };
      return {
        id, name: attachmentFilename(attachment.filename), size: attachment.content.byteLength, readRaw,
        read: async signal => {
          const raw = await readRaw(signal);
          return unwrapOfficeAttachment(raw.source as Uint8Array, raw.name!);
        }
      };
    });
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const signal = context.signal;
    const generation = ++this.loadGeneration;
    this.removeAbortListener?.();
    const previous = this.releaseDocument();
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

    try {
      await previous;
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      const [input, pdfjs, { default: workerSource }] = await Promise.all([
        toPdfSource(source),
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ]);
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      // Hash before PDF.js transfers the owned input buffer to its worker.
      const contentKey = this.virtual ? await pdfContentKey(input, context.descriptor.password) : undefined;
      if (signal?.aborted) throw abortError();
      if (generation !== this.loadGeneration) return;
      this.contentKey = contentKey;
      const workerUrl = workerSource as string | (() => string);
      const pdfWorkerUrl = typeof workerUrl === 'function' ? workerUrl() : workerUrl;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      if (typeof location !== 'undefined' && location.protocol === 'file:') {
        // WebKit can silently hang on a module worker importing another blob
        // from an opaque file: origin. Preload the same worker module locally;
        // PDF.js then uses its supported main-thread worker implementation.
        await import(/* @vite-ignore */ pdfWorkerUrl);
        if (signal?.aborted) throw abortError();
        if (generation !== this.loadGeneration) return;
      }
      const task = pdfjs.getDocument({
        ...(typeof input === 'string' ? { url: input } : { data: input }),
        password: context.descriptor.password
      });
      this.loadingTask = task;
      const pdf = await task.promise;
      if (generation !== this.loadGeneration) return;

      this.document = pdf;
      this.textLayerConstructor = pdfjs.TextLayer;
      this.state.pageCount = pdf.numPages;
      this.root.setAttribute('role', 'document');
      this.root.setAttribute('aria-label', context.descriptor.name ?? 'PDF preview');
      this.root.replaceChildren();
      const first = await pdf.getPage(1);
      if (generation !== this.loadGeneration) return;
      const viewport = first.getViewport({ scale: 1 });
      const fragment = document.createDocumentFragment();
      this.pages = Array.from({ length: pdf.numPages }, (_, index) => {
        const element = document.createElement('div');
        element.className = 'pdfv-page-slot';
        element.dataset.pageIndex = String(index);
        fragment.append(element);
        return { index, element, width: viewport.width, height: viewport.height, page: index === 0 ? first : undefined };
      });
      this.root.append(fragment);
      this.root.scrollTop = 0;
      this.layoutPages();
      // Reveal the first painted page without waiting for the rest of a tall
      // viewport. Nearby pages continue through the normal rendering queue.
      // Non-virtual (print/export) previews still finish every page before ready.
      await this.renderVisiblePages(this.virtual);
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
      const normalizedError = (error as { name?: string })?.name === 'PasswordException'
        ? new PreviewPasswordError((error as { code?: number }).code === 2 ? 'password_invalid' : 'password_required')
        : error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
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
    if (!Number.isFinite(index) || !this.pages.length) return;
    const next = Math.max(0, Math.min(this.pages.length - 1, Math.trunc(index)));
    this.state.pageIndex = next;
    this.root.scrollTop = this.pages[next].element.offsetTop;
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

  private pageScale(width: number, height: number, containerWidth = this.root.clientWidth, containerHeight = this.root.clientHeight): number {
    const widthScale = containerWidth > 0 ? containerWidth / width : 1;
    const heightScale = containerHeight > 0 ? containerHeight / height : 1;
    if (this.state.fit === 'width') return widthScale * this.state.scale;
    if (this.state.fit === 'height') return heightScale * this.state.scale;
    if (this.state.fit === 'contain') return Math.min(widthScale, heightScale, 1) * this.state.scale;
    return this.state.scale;
  }

  private rootDimensions(): string { return `${this.root.clientWidth}:${this.root.clientHeight}`; }

  private layoutPages(): void {
    // Read the viewport once before writing page sizes to avoid per-page layout flushes.
    const width = this.root.clientWidth, height = this.root.clientHeight;
    this.dimensions = `${width}:${height}`;
    for (const slot of this.pages) this.sizeSlot(slot, width, height);
  }

  private sizeSlot(slot: PageSlot, containerWidth?: number, containerHeight?: number): void {
    const scale = this.pageScale(slot.width, slot.height, containerWidth, containerHeight);
    slot.element.style.width = `${slot.width * scale}px`;
    slot.element.style.height = `${slot.height * scale}px`;
  }

  private relayout(): void {
    const anchor = this.pages[this.state.pageIndex];
    const offset = anchor ? this.root.scrollTop - anchor.element.offsetTop : 0;
    this.renderGeneration++;
    this.renderAgain = true;
    for (const slot of this.activePages) this.clearCanvas(slot);
    this.layoutPages();
    if (anchor) this.root.scrollTop = anchor.element.offsetTop + offset;
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

  private visiblePages(): number[] {
    if (!this.virtual) return this.pages.map((_, index) => index);
    const viewport = this.root.getBoundingClientRect();
    if (!this.root.clientHeight) return this.pages.length ? [this.state.pageIndex] : [];
    // Finish the visible preview first; nearby pages can be prepared after loading settles.
    const margin = this.state.loading ? 0 : this.root.clientHeight / 2;
    const indices: number[] = [];
    let active = this.state.pageIndex, largestOverlap = -1;
    // Page slots form a vertical, ordered grid. Locate the first nearby page
    // using actual layout, including gaps and page sizes learned from PDF.js.
    let low = 0, high = this.pages.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.pages[middle]!.element.getBoundingClientRect().bottom <= viewport.top - margin) low = middle + 1;
      else high = middle;
    }
    // Check the preceding and following slots as well, preserving overlap
    // selection at exact page edges and within inter-page gaps.
    for (let index = Math.max(0, low - 1); index < this.pages.length; index++) {
      const slot = this.pages[index]!;
      const rect = slot.element.getBoundingClientRect();
      if (rect.bottom > viewport.top - margin && rect.top < viewport.bottom + margin) indices.push(index);
      const overlap = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top);
      if (overlap > largestOverlap) { active = index; largestOverlap = overlap; }
      if (rect.top >= viewport.bottom + margin) break;
    }
    if (active !== this.state.pageIndex) {
      this.state.pageIndex = active;
      this.emit('statechange', this.getState());
    }
    return indices;
  }

  private async renderVisiblePages(firstPageOnly = false): Promise<void> {
    this.renderAgain = true;
    if (this.rendering) {
      const needed = new Set(this.visiblePages());
      for (const slot of this.activePages) if (slot.task && !needed.has(slot.index)) this.clearCanvas(slot);
      return this.rendering;
    }
    const generation = this.loadGeneration;
    const pdf = this.document;
    if (!pdf) return;
    const rendering = (async () => {
      do {
        this.renderAgain = false;
        const epoch = this.renderGeneration;
        const needed = new Set(this.visiblePages());
        for (const slot of this.activePages) if (!needed.has(slot.index)) this.clearCanvas(slot);
        for (const index of needed) {
          if (generation !== this.loadGeneration || epoch !== this.renderGeneration || this.renderAgain) break;
          await this.renderPage(pdf, index, generation, epoch);
          if (firstPageOnly && this.pages[index]?.canvas?.dataset.rendered === 'true') break;
        }
      } while (this.renderAgain && generation === this.loadGeneration);
    })();
    this.rendering = rendering;
    try { await rendering; }
    finally { if (this.rendering === rendering) this.rendering = null; }
  }

  private async renderPage(pdf: PDFDocumentProxy, index: number, generation: number, epoch: number): Promise<void> {
    const slot = this.pages[index];
    if (slot.canvas) return;
    const page = slot.page ?? await pdf.getPage(index + 1);
    if (generation !== this.loadGeneration || epoch !== this.renderGeneration) return;
    slot.page = page;
    const base = page.getViewport({ scale: 1 });
    if (slot.width !== base.width || slot.height !== base.height) {
      const anchor = this.pages[this.state.pageIndex]?.element;
      const anchorTop = anchor?.offsetTop ?? 0;
      slot.width = base.width; slot.height = base.height;
      this.sizeSlot(slot);
      if (anchor) this.root.scrollTop += anchor.offsetTop - anchorTop;
    }
    const scale = this.pageScale(base.width, base.height);
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.className = 'pdfv-page';
    canvas.dataset.pageIndex = String(index);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Page ${index + 1}`);
    canvas.width = Math.ceil(viewport.width * outputScale);
    canvas.height = Math.ceil(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    slot.canvas = canvas;
    this.activePages.add(slot);
    slot.element.append(canvas);
    const cacheKey = index === 0 ? pdfPageKey(this.contentKey, viewport, canvas) : undefined;
    if (cacheKey && pdfPageCache.read(cacheKey, canvas)) {
      canvas.dataset.rendered = 'true';
      void this.renderPageText(page, slot, canvas, viewport, generation, epoch);
      return;
    }
    const task = page.render({ canvas, viewport: page.getViewport({ scale: scale * outputScale }), background: '#ffffff' });
    slot.task = task;
    try {
      await task.promise;
      if (slot.canvas === canvas) {
        if (cacheKey) pdfPageCache.write(cacheKey, canvas);
        canvas.dataset.rendered = 'true';
        void this.renderPageText(page, slot, canvas, viewport, generation, epoch);
      }
    } catch (error) {
      if (slot.canvas === canvas) this.clearCanvas(slot);
      if (generation === this.loadGeneration && epoch === this.renderGeneration && (error as Error)?.name !== 'RenderingCancelledException') throw error;
    } finally { if (slot.task === task) slot.task = undefined; }
  }

  private clearCanvas(slot: PageSlot): void {
    this.activePages.delete(slot);
    slot.textLayer?.cancel();
    slot.textLayer = undefined;
    slot.textElement?.remove();
    slot.textElement = undefined;
    slot.textOffsets = undefined;
    slot.highlighted = false;
    slot.task?.cancel();
    slot.task = undefined;
    if (slot.canvas) {
      slot.canvas.width = slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = undefined;
    }
  }

  private async renderPageText(page: PDFPageProxy, slot: PageSlot, canvas: HTMLCanvasElement,
    viewport: ReturnType<PDFPageProxy['getViewport']>, generation: number, epoch: number): Promise<void> {
    const current = () => generation === this.loadGeneration && epoch === this.renderGeneration && slot.canvas === canvas;
    let text;
    try {
      // The selection layer and font inventory share one extraction per painted page.
      text = await page.getTextContent?.();
    } catch {
      if (current()) this.warn(`Font metadata is unavailable for PDF page ${slot.index + 1}.`);
      return;
    }
    if (!text || !current()) return;
    let changed = false;
    for (const [fontId, style] of Object.entries(text.styles)) {
      if (this.fonts.has(fontId)) continue;
      // Public text styles do not establish original font names or embedded provenance.
      this.fonts.set(fontId, {
        fontId, fontFamily: style.fontFamily, status: 'unknown', source: 'unknown',
        classification: classifyPreviewFont(style.fontFamily)
      });
      changed = true;
    }
    if (changed) {
      this.state.fonts = [...this.fonts.values()];
      this.emit('statechange', this.getState());
    }
    if (!current() || !this.textLayerConstructor || !text.items?.length) return;
    const element = document.createElement('div');
    element.className = 'pdfv-text-layer';
    element.style.setProperty('--total-scale-factor', String(viewport.scale));
    slot.textElement = element;
    slot.element.append(element);
    try {
      const layer = new this.textLayerConstructor({ textContentSource: text, container: element, viewport });
      slot.textLayer = layer;
      await layer.render();
      if (current()) {
        slot.textOffsets = indexPdfText(text.items).offsets;
        element.dataset.rendered = 'true';
        this.highlightPage(slot);
      }
    } catch {
      element.remove();
      if (current()) {
        slot.textLayer?.cancel();
        slot.textLayer = undefined;
        slot.textElement = undefined;
        this.warn(`Text selection is unavailable for PDF page ${slot.index + 1}.`);
      }
    }
  }

  private warn(warning: string): void {
    this.state.warnings = [...new Set([...this.state.warnings, warning])];
    this.emit('warnings', this.state.warnings);
    this.emit('statechange', this.getState());
  }

  private releaseDocument(): Promise<void> {
    this.unbindTouch();
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.renderGeneration++;
    for (const slot of this.activePages) this.clearCanvas(slot);
    this.pages = [];
    this.textLayerConstructor = undefined;
    this.fonts.clear();
    this.state.fonts = [];
    this.rendering = null;
    this.renderAgain = false;
    this.root.replaceChildren();
    const task = this.loadingTask, pdf = this.document;
    this.loadingTask = null;
    this.document = null;
    this.contentKey = undefined;
    this.findControls.close();
    this.resetSearch('', false);
    return task ? task.destroy() : pdf?.destroy() ?? Promise.resolve();
  }
}

function abortError(): DOMException { return new DOMException('PDF loading was aborted.', 'AbortError'); }

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

async function toPdfSource(source: PreviewSource): Promise<string | Uint8Array> {
  if (typeof source === 'string') return source;
  if (source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
  }
  return new Uint8Array(source.slice(0));
}
