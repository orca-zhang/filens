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
import { createDocxPagination } from './pagination';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export { DOCX_FORMAT_ROUTES, createDocxPreviewRoutes } from './routes';

let nextDocxRender = 0;

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
      const filensPaginate = createDocxPagination(document);
      const fontAnalysis = prepareDocxFonts(document, this.host.ownerDocument, fontTraits, undefined, embedded.aliases);
      const render = async (target: HTMLDivElement) => {
        // docx-preview emits global selectors. Keep named styles and counters
        // from other sessions and from the staging render out of this view.
        const className = `filens-docx-${++nextDocxRender}`;
        const options = { ...renderOptions, className, filensPaginate };
        const rendering = renderDocument(document, target, undefined, options);
        const wrapper = target.querySelector(`:scope > .${className}-wrapper`);
        wrapper?.classList.add('docx-wrapper');
        for (const page of wrapper?.children ?? []) page.classList.add('docx');
        await rendering;
        return { wrapper, className };
      };
      // Keep the container attached for renderer layout work, but give every
      // load its own container so late tasks cannot write into a new document.
      const { wrapper, className } = await render(container);
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
      this.refreshDocumentFonts = async update => {
        if (signal.aborted || this.loadController !== controller) return;
        const analysis = prepareDocxFonts(document, this.host.ownerDocument, fontTraits, update, embedded.aliases);
        if (update.loaded.length || update.relayout) {
          const next = this.host.ownerDocument.createElement('div');
          next.className = 'docxv-document';
          // Layout in an attached staging container; keep the current preview readable.
          next.style.visibility = 'hidden';
          this.root.appendChild(next);
          try {
            await render(next);
            if (signal.aborted || this.loadController !== controller) return;
            const top = this.root.scrollTop, left = this.root.scrollLeft;
            next.style.visibility = '';
            activeContainer = this.documentHost = next;
            this.root.replaceChildren(next);
            this.root.scrollTop = top; this.root.scrollLeft = left;
          } finally { if (activeContainer !== next) next.remove(); }
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

function manageDocumentResources(document: ResourceDocument, signal: AbortSignal, urls: Set<string>): void {
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
        result = Promise.resolve(load.apply(document, args)).then(url => {
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
