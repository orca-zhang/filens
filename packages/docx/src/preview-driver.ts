import {
  bindPreviewFontLoading,
  type PreviewFontReference,
  type PreviewFontRefresh,
  type FlowPreviewState,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';
import type { ZipEntry } from '@filens/core/zip';
import { prepareDocxFonts, readDocxFontTraits } from './fonts';
import { sampleDocxFonts } from './font-usage';
import { createDocxEmbeddedFonts } from './embedded-fonts';
import { createDocxPagination, renderDocxColumns, renderDocxFootnoteColumns, someDocxElement, type DocxMeasuredPages, type HeaderFooterType, type PageSection } from './pagination';
import { indexDocxFlow, measureDocxFlow, recordDocxFlow, type DocxFlowAreas, type DocxPageFrames } from './flow-pagination';
import { findEndnoteBreaks, paginateNotes, type DocxNotes, type NotePart } from './notes';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export { DOCX_FORMAT_ROUTES, createDocxPreviewRoutes } from './routes';

let nextDocxRender = 0;

function changesPageFrame(sections: PageSection[], evenAndOdd: boolean): boolean {
  const geometry = ({ sectProps: props }: PageSection) => JSON.stringify([props.pageMargins, props.headerRefs, props.footerRefs]);
  const first = geometry(sections[0]);
  return sections.some(section => {
    const { titlePage, headerRefs, footerRefs } = section.sectProps;
    return geometry(section) !== first || Boolean(titlePage && (headerRefs?.length || footerRefs?.length))
      || (evenAndOdd && [...headerRefs ?? [], ...footerRefs ?? []].some(ref => ref.type !== 'first'));
  });
}

function canMeasureSharedPage(sections: PageSection[], evenAndOdd: boolean): boolean {
  if (sections.length < 2) return false;
  const usesPageFit = changesPageFrame(sections, evenAndOdd) || sections.some(section =>
    (section.columnParts ?? [section.elements]).some(elements =>
      someDocxElement(elements, element => element.type === 'footnoteReference')));
  return !usesPageFit || sections.every(section => !section.authoredColumns && (section.columnParts ?? [section.elements])
    .every(elements => elements.every(element => element.type === 'paragraph' || element.type === 'table')));
}

export class DocxPreviewSession implements PreviewSession<FlowPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private documentHost: HTMLDivElement;
  private loadController: AbortController | null = null;
  private state: FlowPreviewState;
  private readonly fontLoading: ReturnType<typeof bindPreviewFontLoading>;
  private fontReferences: PreviewFontReference[] = [];
  private refreshDocumentFonts?: (update: PreviewFontRefresh) => Promise<void>;

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'docxv-preview';
    this.documentHost = document.createElement('div');
    this.documentHost.className = 'docxv-document';
    this.root.replaceChildren(this.documentHost);
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'flow',
      warnings: [],
      capabilities: {
        search: true,
        print: true,
        download: true
      },
      scale: options.initialScale ?? 1,
      scrollTop: 0
    };
    this.fontLoading = bindPreviewFontLoading(this, host.ownerDocument, options);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.stopLoad();
    this.fontLoading.reset(context.signal, context.route?.targetFormat ?? context.descriptor.extension ?? 'docx');
    const controller = new AbortController();
    this.loadController = controller;
    const signal = controller.signal;
    const container = document.createElement('div');
    container.className = 'docxv-document';
    this.documentHost = container;
    let activeContainer = container;
    this.root.replaceChildren(container);
    this.root.scrollTop = 0;
    const urls = new Set<string>();
    const abort = () => controller.abort();
    signal.addEventListener('abort', () => {
      context.signal?.removeEventListener('abort', abort);
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      activeContainer.replaceChildren();
      activeContainer.remove();
      if (this.loadController === controller) {
        this.loadController = null;
        this.state.loading = false;
        this.state.fonts = [];
        this.state.warnings = [];
        this.emit('statechange', this.state);
      }
    }, { once: true });
    context.signal?.addEventListener('abort', abort, { once: true });
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      fonts: [],
      warnings: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (context.signal?.aborted) controller.abort();
      checkAborted(signal);
      const entries = context.zipEntries;
      const data = entries ? undefined : await sourceToData(source, { ...context, signal });
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      const { parseAsync, renderDocument } = await import('docx-preview');
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      const renderOptions = { breakPages: true, ignoreLastRenderedPageBreak: false, ignoreFonts: true };
      const parseOptions = entries ? { ...renderOptions, filensZip: indexedDocxZip(entries, signal) } : renderOptions;
      const document = await parseAsync(data, parseOptions);
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      manageDocumentResources(document, signal, urls);
      const fontTraits = await readDocxFontTraits(document, this.host.ownerDocument);
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      const embedded = createDocxEmbeddedFonts(document, this.host.ownerDocument, signal);
      const paginator = createDocxPagination(document);
      const body = document.documentPart?.body?.children ?? [];
      const measureFlow = !someDocxElement(body, element => element.break === 'lastRenderedPageBreak');
      const evenAndOdd = Boolean(document.settingsPart?.settings?.evenAndOddHeaders);
      const fontAnalysis = prepareDocxFonts(document, this.host.ownerDocument, fontTraits, undefined, embedded.aliases);
      const renderOnce = async (target: HTMLDivElement, afterEndnotes: Set<number>, measured?: DocxMeasuredPages) => {
        // docx-preview emits global selectors. Keep named styles and counters
        // from other sessions and from the staging render out of this view.
        const className = `filens-docx-${++nextDocxRender}`;
        const areas: DocxFlowAreas | undefined = measureFlow ? new Map() : undefined;
        const frames = new Map<HTMLElement, DocxPageFrames>();
        const templates: NonNullable<DocxPageFrames['templates']> = new Map();
        const endnotes: DocxNotes[] = [];
        const footnotes: DocxNotes[] = [];
        const options = {
          ...renderOptions, className,
          filensPaginate: (...[elements, props, process]: Parameters<typeof paginator.paginate>) =>
            paginator.paginate(elements, props, process, measured, afterEndnotes),
          filensSharedFlow: (sections: PageSection[]) => measureFlow && canMeasureSharedPage(sections, evenAndOdd),
          filensPageFrames: (page: HTMLElement, sections: PageSection[], number: number, sharedFlow: boolean,
            create: (props: PageSection['sectProps'], type: HeaderFooterType) => HTMLElement) => {
            if (measured || !areas) return;
            const context: DocxPageFrames = { number, first: sections[0], evenAndOdd };
            frames.set(page, context);
            if (!sharedFlow || !changesPageFrame(sections, evenAndOdd)) return;
            for (const { sectProps: props } of sections) {
              if (templates.has(props)) continue;
              const variants: Partial<Record<HeaderFooterType, HTMLElement>> = { default: create(props, 'default') };
              if (evenAndOdd) variants.even = create(props, 'even');
              if (props.titlePage) variants.first = create(props, 'first');
              templates.set(props, variants);
            }
            context.templates = templates;
          },
          filensRenderColumns: (...[article, section, render, measure]: Parameters<typeof renderDocxColumns>) => {
            renderDocxColumns(article, section, render, measureFlow && measure);
            if (areas) recordDocxFlow(areas, article, section);
          },
          filensFootnoteColumns: renderDocxFootnoteColumns,
          filensLongFootnotes: measured?.longFootnotes,
          filensFootnotes: (list: HTMLOListElement, templates: HTMLElement[], notes: DocxNotes['notes']) => {
            footnotes.push({ list, templates, notes });
          },
          filensEndnotes: (list: HTMLOListElement, templates: HTMLElement[], notes: DocxNotes['notes'], section?: number) => {
            endnotes.push({ list, templates, notes, section });
          }
        };
        const rendering = renderDocument(document, target, undefined, options);
        const wrapper = target.querySelector(`:scope > .${className}-wrapper`);
        wrapper?.classList.add('docx-wrapper');
        const candidates: DocxFlowAreas = new Map();
        for (const page of wrapper?.querySelectorAll<HTMLElement>(':scope > section') ?? []) {
          page.classList.add('docx');
          // The renderer's border-box minimum already includes the page margins.
          if (page.style.minHeight) page.style.containIntrinsicHeight = 'auto 0px';
          if (areas && !measured && page.style.minHeight) {
            for (const article of page.querySelectorAll<HTMLElement>(':scope > article')) {
              const area = areas.get(article);
              if (area) {
                page.style.contentVisibility = 'visible';
                candidates.set(article, area);
              }
              if (!page.classList.contains('docxv-shared-page')) break;
            }
          }
        }
        await rendering;
        const separateEndnotes = endnotes.filter(({ list }) =>
          !list.parentElement?.classList.contains('docxv-shared-page') || !candidates.has(list.nextElementSibling as HTMLElement));
        const needsSectionBreak = !signal.aborted && !measured && findEndnoteBreaks(separateEndnotes, afterEndnotes);
        let plan: DocxMeasuredPages | undefined;
        if (!signal.aborted && !needsSectionBreak && candidates.size) {
          const lists = separateEndnotes.map(({ list }) => ({ list, parent: list.parentElement!, sibling: list.nextSibling }));
          for (const { list } of lists) list.remove();
          try { plan = measureDocxFlow(candidates, paginator, frames); }
          finally { for (const { list, parent, sibling } of lists.reverse()) parent.insertBefore(list, sibling); }
        }
        for (const article of candidates.keys()) article.parentElement!.style.contentVisibility = '';
        return { wrapper, className, areas, plan, endnotes, footnotes, needsSectionBreak };
      };
      const render = async (target: HTMLDivElement) => {
        const afterEndnotes = new Set<number>();
        let result = await renderOnce(target, afterEndnotes);
        while (result.needsSectionBreak) result = await renderOnce(target, afterEndnotes);
        if (!signal.aborted && result.plan && (result.plan.before.size || result.plan.lines.size || result.plan.longFootnotes?.size)) {
          result = await renderOnce(target, afterEndnotes, result.plan);
        }
        const notes: NotePart[] = [];
        if (!signal.aborted) {
          const documentEnd = result.endnotes.find(note => note.section === undefined)?.list;
          if (result.footnotes.length) {
            documentEnd?.remove();
            for (const area of result.footnotes) for (const part of paginateNotes(area, paginator)) notes.push(part);
            const last = result.wrapper?.lastElementChild;
            if (documentEnd && last) last.insertBefore(documentEnd, last.querySelector(':scope > footer'));
          }
          for (const area of result.endnotes) for (const part of paginateNotes(area, paginator)) notes.push(part);
        }
        const flow = result.areas || notes.length ? indexDocxFlow(result.areas ?? new Map(), notes) : undefined;
        return { ...result, flow };
      };
      // Keep the container attached for renderer layout work, but give every
      // load its own container so late tasks cannot write into a new document.
      const { wrapper, className, flow } = await render(container);
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      this.state.loading = false;
      this.state.error = null;
      this.state.fonts = fontAnalysis.fonts;
      this.fontReferences = this.options.fontLoading
        ? sampleDocxFonts(wrapper, fontAnalysis.loadingReferences, className) : fontAnalysis.loadingReferences;
      this.state.warnings = fontAnalysis.warnings;
      let activeFlow = flow;
      let fontLayout = 0;
      this.refreshDocumentFonts = async update => {
        if (signal.aborted || this.loadController !== controller) return;
        const analysis = prepareDocxFonts(document, this.host.ownerDocument, fontTraits, update, embedded.aliases);
        if (update.loaded.length || update.relayout) {
          const layout = ++fontLayout;
          const next = this.host.ownerDocument.createElement('div');
          next.className = 'docxv-document';
          // Layout in an attached staging container; keep the current preview readable.
          next.style.visibility = 'hidden';
          this.root.appendChild(next);
          try {
            const rendered = await render(next);
            if (signal.aborted || this.loadController !== controller || fontLayout !== layout) return;
            const top = this.root.scrollTop, left = this.root.scrollLeft;
            const position = docxReadingPosition(this.root, activeContainer);
            const viewportTop = this.root.getBoundingClientRect().top + this.root.clientTop;
            const anchor = position && activeFlow?.anchor(position.page, viewportTop);
            const reading = anchor && rendered.flow?.locate(anchor);
            next.style.visibility = '';
            activeContainer = this.documentHost = next;
            activeFlow = rendered.flow;
            this.root.replaceChildren(next);
            const page = reading?.node.closest('section.docx') ?? (position && rendered.wrapper?.children.item(position.index));
            if (position && page instanceof HTMLElement) {
              // Lay out the reading page before clamping its inset to the new text height.
              const previous = page.style.contentVisibility;
              page.style.contentVisibility = 'visible';
              const box = page.getBoundingClientRect();
              // Keep the measured height until auto visibility can recognize this page at its new offset.
              const style = getComputedStyle(page);
              const contentHeight = Math.max(0, page.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
              page.style.containIntrinsicHeight = `auto ${contentHeight}px`;
              const readingBox = reading?.box() ?? box;
              const inset = Math.min(reading && anchor ? anchor.inset : position.inset, Math.max(0, readingBox.height - 1));
              this.root.scrollTop += readingBox.top - this.root.getBoundingClientRect().top - this.root.clientTop + inset;
              page.style.contentVisibility = previous;
            } else this.root.scrollTop = top;
            this.root.scrollLeft = left;
          } finally {
            if (activeContainer !== next) next.remove();
          }
        }
        if (signal.aborted || this.loadController !== controller) return;
        this.fontReferences = analysis.loadingReferences;
        this.state.fonts = embedded.diagnostics(analysis.fonts); this.state.warnings = analysis.warnings;
        this.emit('warnings', this.state.warnings);
        this.emit('rendered', this.getState());
        this.emit('statechange', this.getState());
      };
      if (this.state.warnings.length) this.emit('warnings', this.state.warnings);
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
      void embedded.load().then(loaded => {
        if (!loaded || signal.aborted || this.loadController !== controller) return;
        this.state.fonts = embedded.diagnostics(this.state.fonts ?? []);
        if (measureFlow) this.refreshFontLayout();
        this.emit('rendered', this.getState());
        this.emit('statechange', this.getState());
      });
    } catch (error) {
      if (signal.aborted) {
        if (context.signal?.aborted) checkAborted(signal);
        return;
      }
      this.stopLoad();
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    } finally {
      if (signal.aborted) container.replaceChildren();
    }
  }

  destroy(): void {
    this.fontLoading.destroy();
    this.stopLoad();
    this.state.loading = false;
    this.state.fonts = [];
    this.state.warnings = [];
    this.documentHost.replaceChildren();
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  private stopLoad(): void {
    this.refreshDocumentFonts = undefined;
    this.fontReferences = [];
    const controller = this.loadController;
    this.loadController = null;
    controller?.abort();
  }

  getState(): FlowPreviewState {
    return {
      ...this.state,
      fonts: this.state.fonts?.map(font => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      warnings: [...this.state.warnings],
      scrollTop: this.root.scrollTop
    };
  }

  getFontReferences(): readonly PreviewFontReference[] { return this.fontReferences; }
  refreshFontLayout(): void { this.fontLoading.refresh(); }
  async refreshFonts(update: PreviewFontRefresh): Promise<void> { await this.refreshDocumentFonts?.(update); }

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
}

function docxReadingPosition(root: HTMLElement, container: HTMLElement): { index: number; inset: number; page: Element } | undefined {
  const pages = container.querySelector('.docx-wrapper')?.children;
  if (!root.scrollTop || !pages?.length) return undefined;
  const top = root.getBoundingClientRect().top + root.clientTop;
  let first = 0, end = pages.length;
  while (first < end) {
    const middle = (first + end) >>> 1;
    if (pages[middle].getBoundingClientRect().bottom <= top) first = middle + 1;
    else end = middle;
  }
  const page = pages[first];
  return page ? { index: first, inset: top - page.getBoundingClientRect().top, page } : undefined;
}

export function createDocxPreviewDriver(): PreviewDriver<FlowPreviewState> {
  return {
    id: 'docx',
    family: 'flow',
    supports: (format) => normalizeFormat(format) === 'docx',
    createSession: (host, options) => new DocxPreviewSession(host, options)
  };
}

async function sourceToData(source: PreviewSource, context: PreviewLoadContext): Promise<Blob | ArrayBuffer> {
  if (source instanceof Blob) return source;
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load DOCX source: ${response.status} ${response.statusText}`.trim());
    }
    return response.arrayBuffer();
  }
  // Snapshot before load() yields, preserving the exact supplied byte slice.
  // JSZip accepts bytes directly; avoid a Blob snapshot followed by FileReader.
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice().buffer as ArrayBuffer;
  }
  return source.slice(0);
}

function indexedDocxZip(entries: ReadonlyMap<string, ZipEntry>, signal: AbortSignal) {
  const decoder = new TextDecoder();
  return { files: new Proxy(Object.create(null), {
    get(_target, path) {
      if (typeof path !== 'string') return undefined;
      const entry = entries.get(path);
      if (!entry || entry.directory) return undefined;
      return {
        async async(type: string) {
          const bytes = await entry.bytes(undefined, signal);
          signal.throwIfAborted();
          if (type === 'string') return decoder.decode(bytes);
          if (type === 'blob') {
            const data = bytes.buffer instanceof ArrayBuffer
              ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
            return new Blob([data]);
          }
          if (type === 'uint8array') return bytes;
          throw new Error(`Unsupported DOCX ZIP output type: ${type}.`);
        }
      };
    }
  }) };
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('DOCX preview aborted.', 'AbortError');
}

type ResourceLoader = (...args: unknown[]) => Promise<string | null>;
type ResourceDocument = {
  documentPart?: unknown;
  loadDocumentImage?: ResourceLoader;
  loadNumberingImage?: ResourceLoader;
};
const MAX_DOCX_IMAGE_READS = 4;

function manageDocumentResources(document: ResourceDocument, signal: AbortSignal, urls: Set<string>): void {
  let reading = 0;
  const waiting = new Set<{ start(): void; reject(error: DOMException): void }>();
  signal.addEventListener('abort', () => {
    const error = new DOMException('DOCX preview aborted.', 'AbortError');
    for (const job of waiting) job.reject(error);
    waiting.clear();
  }, { once: true });

  const readImage = (load: () => Promise<string | null>) => new Promise<string | null>((resolve, reject) => {
    const start = () => {
      reading++;
      void Promise.resolve().then(() => {
        checkAborted(signal);
        return load();
      }).then(resolve, reject).finally(() => {
        reading--;
        const next = waiting.values().next().value;
        if (next) { waiting.delete(next); next.start(); }
      });
    };
    if (reading < MAX_DOCX_IMAGE_READS) start();
    else waiting.add({ start, reject });
  });

  // docx-preview exposes no disposal API. Scope its resource loaders to this
  // parsed document; never intercept the global URL API or another session.
  for (const name of ['loadDocumentImage', 'loadNumberingImage'] as const) {
    const load = document[name];
    if (!load) continue;
    const parts = new Map<unknown, Map<string, Promise<string | null>>>();
    document[name] = (...args) => {
      if (signal.aborted) return Promise.reject(new DOMException('DOCX preview aborted.', 'AbortError'));
      const part = name === 'loadDocumentImage' ? args[1] ?? document.documentPart : undefined;
      const key = String(args[0]);
      let cache = parts.get(part);
      if (!cache) parts.set(part, cache = new Map());
      let result = cache.get(key);
      if (!result) {
        result = readImage(() => load.apply(document, args)).then(url => {
          if (url?.startsWith('blob:')) {
            if (signal.aborted) {
              URL.revokeObjectURL(url);
              return null;
            }
            urls.add(url);
          }
          return url;
        });
        cache.set(key, result);
      }
      return result;
    };
  }
}
