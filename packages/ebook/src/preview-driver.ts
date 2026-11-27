import { createEpubResources, resolveArchivePath } from './epub-resources';
import { parseContents, resolveChapterLocation, type ChapterLocation, type ContentsEntry } from './navigation';
import { readingThemeCss, readingThemes, type ReadingTheme } from './reading-theme';
import { createFrameResourceUrl, needsInlineFrameResources } from './frame-resource-url';
import {
  openZipArchive,
  waitForContainerTask,
  type EbookPreviewState,
  type ZipEntry,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewResourceResolver,
  type PreviewSession,
  type PreviewSource
} from '@filens/core';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export interface ParsedEpubChapter {
  id: string;
  title: string;
  href: string;
  html: string;
}

export interface ParsedEpubBook {
  title?: string;
  chapters: ParsedEpubChapter[];
  warnings: string[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface IndexedBook {
  title?: string;
  chapters: Omit<ParsedEpubChapter, 'html'>[];
  warnings: string[];
  zip: Map<string, ZipEntry>;
  epub?: { manifest: ManifestItem[]; packageDir: string; chapterPaths: Map<string, number>; contents: ContentsEntry[] };
}

export { EBOOK_FORMAT_ROUTES, createEbookPreviewRoutes } from './routes';

export class EpubPreviewSession implements PreviewSession<EbookPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly stage: HTMLDivElement;
  private readonly toolbar = document.createElement('div');
  private readonly position = document.createElement('input');
  private readonly positionLabel = document.createElement('span');
  private readonly positionCount = document.createElement('span');
  private readonly jumpButton = document.createElement('button');
  private readonly themeSelect = document.createElement('select');
  private readonly themeLabel = document.createElement('span');
  private readonly contents = document.createElement('details');
  private readonly contentsLabel = document.createElement('summary');
  private readonly contentsButtons = new Map<string, HTMLButtonElement>();
  private contentsCurrent?: HTMLButtonElement;
  private createdUrls = new Set<string>();
  private book: IndexedBook | null = null;
  private chapterController?: AbortController;
  private chapterGeneration = 0;
  private fragment?: string;
  private displayed?: { chapter: ParsedEpubChapter; index: number; fragment?: string };
  private frame: HTMLIFrameElement | null = null;
  private frameReady = false;
  private frameTheme?: HTMLStyleElement;
  private linkTimer?: number;
  private theme: ReadingTheme = 'original';
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private state: EbookPreviewState = {
    loading: false,
    error: null,
    family: 'ebook',
    warnings: [],
    capabilities: {
      chapters: true,
      search: true,
      fullscreen: true,
      download: true
    },
    location: undefined,
    progress: 0,
    chapterTitle: undefined,
    chapterIndex: 0,
    chapterCount: 0,
    chapterLoading: false,
    chapters: []
  };

  constructor(private readonly host: HTMLElement, private readonly options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'ebookv-preview';
    this.tabs = document.createElement('div');
    this.tabs.className = 'ebookv-chapters';
    this.stage = document.createElement('div');
    this.stage.className = 'ebookv-stage';
    this.buildToolbar();
    const sidebar = document.createElement('div');
    sidebar.className = 'ebookv-sidebar';
    this.contents.className = 'ebookv-contents';
    this.contents.hidden = true;
    this.contents.append(this.contentsLabel);
    sidebar.append(this.contents, this.tabs);
    this.root.replaceChildren(this.toolbar, sidebar, this.stage);
    this.host.replaceChildren(this.root);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseBook();
    const controller = new AbortController();
    this.loadController = controller;
    const signal = context.signal;
    const abort = () => {
      controller.abort();
      if (generation === this.loadGeneration) {
        this.releaseBook();
        this.state.loading = false;
        this.emit('statechange', this.state);
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.removeAbortListener = () => signal?.removeEventListener('abort', abort);
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      title: context.descriptor.name,
      warnings: [],
      location: undefined,
      progress: 0,
      chapterTitle: undefined,
      chapterIndex: 0,
      chapterCount: 0,
      chapters: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) controller.abort();
      checkAborted(controller.signal);
      const format = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension);
      if (format !== 'epub' && format !== 'cbz') {
        throw new Error(`Ebook preview currently supports EPUB and CBZ files, got ${format || 'unknown'}.`);
      }

      const loadContext = { ...context, signal: controller.signal };
      const book =
        format === 'cbz'
          ? await indexCbzBook(source, loadContext, true)
          : await indexEpubBook(source, loadContext, true);
      if (generation !== this.loadGeneration) return;
      checkAborted(controller.signal);
      this.book = book;
      this.state = {
        ...this.state,
        loading: true,
        error: null,
        title: this.book.title ?? context.descriptor.name,
        warnings: this.book.warnings.slice(),
        chapterCount: this.book.chapters.length,
        chapters: this.book.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title
        }))
      };
      this.renderTabs();
      this.renderContents(book.epub?.contents ?? []);
      this.position.max = String(book.chapters.length);
      this.positionCount.textContent = ` / ${book.chapters.length}`;
      this.toolbar.hidden = false;
      this.refreshTranslations();
      await this.openChapter(0);
      if (generation !== this.loadGeneration) return;
      checkAborted(controller.signal);
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.releaseBook();
      this.state.loading = false;
      if (controller.signal.aborted) {
        checkAborted(controller.signal);
      }
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.loadGeneration++;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseBook();
    this.state.loading = false;
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  getState(): EbookPreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice(),
      chapters: this.state.chapters.map(chapter => ({ ...chapter }))
    };
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  goToPage(index: number): void {
    this.goToChapter(index);
  }

  next(): void {
    this.goToChapter(Math.min(this.state.chapterIndex + 1, Math.max(this.state.chapterCount - 1, 0)));
  }

  prev(): void {
    this.goToChapter(Math.max(this.state.chapterIndex - 1, 0));
  }

  refreshTranslations(): void {
    const t = (message: string) => this.options.translate?.(message) ?? message;
    this.positionLabel.textContent = t(this.book?.epub ? 'Chapter number' : 'Page number');
    this.jumpButton.textContent = t('Go');
    this.contentsLabel.textContent = t('Table of contents');
    this.themeLabel.textContent = t('Reading theme');
    for (const option of this.themeSelect.options) option.textContent = t(readingThemes[option.value as ReadingTheme].label);
  }

  private buildToolbar(): void {
    this.toolbar.className = 'ebookv-toolbar';
    this.toolbar.hidden = true;
    const jump = document.createElement('form');
    const positionLabel = document.createElement('label');
    this.position.type = 'number';
    this.position.min = '1';
    this.position.required = true;
    positionLabel.append(this.positionLabel, this.position);
    this.jumpButton.type = 'submit';
    jump.append(positionLabel, this.positionCount, this.jumpButton);
    jump.addEventListener('submit', event => {
      event.preventDefault();
      this.goToChapter(this.position.valueAsNumber - 1);
    });
    const themeLabel = document.createElement('label');
    for (const value of Object.keys(readingThemes)) {
      const option = document.createElement('option');
      option.value = value;
      this.themeSelect.append(option);
    }
    this.themeSelect.addEventListener('change', () => {
      this.theme = this.themeSelect.value as ReadingTheme;
      this.stage.style.backgroundColor = readingThemes[this.theme].background;
      if (!this.frame || !this.displayed) return;
      if (needsInlineFrameResources()) this.setFrameSource(this.frame, this.displayed.chapter.html);
      else this.updateFrameTheme();
    });
    themeLabel.append(this.themeLabel, this.themeSelect);
    this.toolbar.append(jump, themeLabel);
    this.refreshTranslations();
  }

  private goToChapter(index: number, fragment?: string): void {
    const book = this.book, generation = this.loadGeneration;
    const operation = this.openChapter(index, fragment), chapterGeneration = this.chapterGeneration;
    void operation.catch(error => {
      if (book !== this.book || generation !== this.loadGeneration || chapterGeneration !== this.chapterGeneration) return;
      this.state.loading = false;
      this.state.chapterLoading = false;
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.state.error = normalized.message;
      this.emit('error', normalized);
      this.emit('statechange', this.getState());
    });
  }

  private async openChapter(index: number, fragment?: string): Promise<void> {
    const book = this.book, parentSignal = this.loadController?.signal;
    if (!Number.isInteger(index) || !book?.chapters.length || parentSignal?.aborted) return;
    const next = Math.max(0, Math.min(index, book.chapters.length - 1));
    if (next === this.state.chapterIndex && !this.state.error && (this.displayed?.index === next || this.chapterController)) {
      const changed = this.fragment !== fragment;
      this.setLocation(next, fragment);
      if (!this.chapterController && this.displayed && (changed || fragment !== undefined)) {
        this.displayed.fragment = fragment;
        this.scrollToFragment(fragment ?? '');
      }
      if (changed) this.emit('statechange', this.getState());
      return;
    }
    this.chapterController?.abort();
    const chapterGeneration = ++this.chapterGeneration;
    const controller = new AbortController();
    this.chapterController = controller;
    const urls = new Set<string>();
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', () => revokeUrls(urls), { once: true });
    const current = () => book === this.book && chapterGeneration === this.chapterGeneration && !controller.signal.aborted;
    const previous = this.state.chapterIndex;
    this.state = { ...this.state, chapterIndex: next, chapterTitle: book.chapters[next].title,
      progress: book.chapters.length <= 1 ? 1 : next / (book.chapters.length - 1), chapterLoading: true, error: null };
    this.tabs.children[previous]?.classList.remove('is-active');
    this.tabs.children[previous]?.removeAttribute('aria-current');
    this.tabs.children[next]?.classList.add('is-active');
    this.tabs.children[next]?.setAttribute('aria-current', 'page');
    this.setLocation(next, fragment);
    this.stage.setAttribute('aria-busy', 'true');
    this.emit('statechange', this.getState());
    let committed = false;
    const createUrl = (blob: Blob) => {
      checkAborted(controller.signal);
      const url = URL.createObjectURL(blob); urls.add(url); return url;
    };
    try {
      if (!current()) return;
      const warnings = book.warnings.slice();
      const chapter = await waitForContainerTask((async () => {
        const resources = book.epub ? await createEpubResources(book.zip, book.epub.manifest, book.epub.packageDir,
          createUrl, controller.signal, this.options.resourceResolver, warnings) : undefined;
        return readChapter(book, next, createUrl, controller.signal, resources);
      })(), controller.signal);
      if (!current()) return;
      if (!chapter) throw new Error(`Missing chapter file ${book.chapters[next].href}.`);
      const oldUrls = this.createdUrls;
      this.renderChapter(chapter, next);
      this.createdUrls = urls; committed = true;
      this.chapterController = undefined;
      revokeUrls(oldUrls);
      book.chapters[next].title = chapter.title;
      this.state.chapters[next] = { id: chapter.id, title: chapter.title };
      this.tabs.children[next].textContent = chapter.title;
      this.state.chapterTitle = chapter.title;
      this.state.loading = false;
      this.state.chapterLoading = false;
      this.state.warnings = warnings;
      this.stage.setAttribute('aria-busy', 'false');
      if (warnings.length) this.emit('warnings', warnings);
      this.emit('statechange', this.getState());
    } catch (error) {
      if (current()) { this.stage.setAttribute('aria-busy', 'false'); throw error; }
    } finally {
      parentSignal?.removeEventListener('abort', abort);
      if (!committed) revokeUrls(urls);
      if (this.chapterController === controller) this.chapterController = undefined;
    }
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [index, chapter] of this.state.chapters.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ebookv-chapter-tab';
      button.classList.toggle('is-active', index === this.state.chapterIndex);
      if (index === this.state.chapterIndex) button.setAttribute('aria-current', 'page');
      button.textContent = chapter.title;
      button.addEventListener('click', () => this.goToChapter(index));
      this.tabs.appendChild(button);
    }
  }

  private renderContents(contents: ContentsEntry[]): void {
    this.contents.hidden = !contents.length;
    if (!contents.length) return;
    const list = document.createElement('ol');
    this.contents.append(list);
    const pending = [{ entries: contents, list }];
    while (pending.length) {
      const { entries, list } = pending.pop()!;
      for (const { title, location, children } of entries) {
        if (!location && !children.length) continue;
        const item = document.createElement('li');
        if (location) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = title;
          button.addEventListener('click', () => this.goToChapter(location.index, location.fragment));
          const key = contentsKey(location.index, location.fragment);
          if (!this.contentsButtons.has(key)) this.contentsButtons.set(key, button);
          item.append(button);
        } else {
          const label = document.createElement('span');
          label.textContent = title;
          item.append(label);
        }
        if (children.length) {
          const nested = document.createElement('ol');
          item.append(nested);
          pending.push({ entries: children, list: nested });
        }
        list.append(item);
      }
    }
    this.contents.hidden = this.contentsButtons.size === 0;
  }

  private setLocation(index: number, fragment?: string): void {
    this.fragment = fragment;
    const href = this.book!.chapters[index].href;
    this.state.location = fragment === undefined ? href : `${href.split('#', 1)[0]}#${fragment}`;
    this.position.value = String(index + 1);
    this.contentsCurrent?.removeAttribute('aria-current');
    this.contentsCurrent = this.contentsButtons.get(contentsKey(index, fragment));
    this.contentsCurrent?.setAttribute('aria-current', 'location');
  }

  private renderChapter(chapter: ParsedEpubChapter, index: number): void {
    const frame = document.createElement('iframe');
    frame.className = 'ebookv-frame';
    frame.title = chapter.title;
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups');
    frame.referrerPolicy = 'no-referrer';
    this.displayed = { chapter, index, fragment: this.fragment };
    this.frame = frame;
    this.setFrameSource(frame, chapter.html);
    this.stage.replaceChildren(frame);
  }

  private setFrameSource(frame: HTMLIFrameElement, html: string): void {
    window.clearInterval(this.linkTimer);
    this.frameReady = false;
    this.frameTheme = undefined;
    const opaque = needsInlineFrameResources();
    if (opaque && this.theme !== 'original') {
      const chapter = new DOMParser().parseFromString(html, 'text/html');
      const style = chapter.createElement('style');
      style.textContent = readingThemeCss(this.theme);
      chapter.head.append(style);
      html = `<!doctype html>${chapter.documentElement.outerHTML}`;
    }
    frame.onload = () => {
      frame.onload = null;
      if (this.frame !== frame) return;
      this.frameReady = true;
      if (!opaque) {
        this.updateFrameTheme();
        this.bindChapterLinks(frame);
      }
      if (this.displayed?.fragment !== undefined) this.scrollToFragment(this.displayed.fragment);
    };
    frame.srcdoc = html;
  }

  private updateFrameTheme(): void {
    if (!this.frameReady || !this.frame?.contentDocument) return;
    if (this.theme === 'original') {
      this.frameTheme?.remove();
      this.frameTheme = undefined;
      return;
    }
    const chapter = this.frame.contentDocument;
    if (!this.frameTheme) {
      this.frameTheme = chapter.createElement('style');
      chapter.head.append(this.frameTheme);
    }
    this.frameTheme.textContent = readingThemeCss(this.theme);
  }

  private scrollToFragment(fragment: string): void {
    if (this.frameReady) this.frame?.contentWindow?.location.replace(`about:srcdoc#${fragment}`);
  }

  private bindChapterLinks(frame: HTMLIFrameElement): void {
    const document = frame.contentDocument, chapterWindow = frame.contentWindow;
    const epub = this.book?.epub, displayed = this.displayed;
    if (!document || !chapterWindow || !epub || !displayed) return;
    const chapterDir = dirname(resolveArchivePath(epub.packageDir, displayed.chapter.href));
    const destinations = new Map<string, ChapterLocation>();
    for (const link of document.querySelectorAll('a[href], area[href]')) {
      if (link.hasAttribute('download')) continue;
      const location = resolveChapterLocation(link.getAttribute('href')!, chapterDir, epub.chapterPaths, displayed.index);
      if (!location) continue;
      const hash = location.index === displayed.index ? `#${location.fragment ?? ''}` : `#filens-link-${this.chapterGeneration}-${destinations.size}`;
      if (location.index !== displayed.index) destinations.set(hash, location);
      link.setAttribute('href', `about:srcdoc${hash}`);
      link.setAttribute('target', '_self');
    }
    if (!destinations.size) return;
    let readingHash = '';
    // WebKit suppresses chapter event listeners in a sandbox without scripts.
    // Observe native fragment navigation from the host while this chapter is mounted.
    const timer = window.setInterval(() => {
      if (this.frame !== frame || frame.contentDocument !== document) {
        window.clearInterval(timer);
        return;
      }
      const hash = chapterWindow.location.hash;
      const location = destinations.get(hash);
      if (!location) { readingHash = hash; return; }
      chapterWindow.history.replaceState(null, '', `about:srcdoc${readingHash}`);
      this.goToChapter(location.index, location.fragment);
    }, 100);
    this.linkTimer = timer;
  }

  private releaseBook(): void {
    this.chapterGeneration++;
    this.chapterController?.abort();
    this.chapterController = undefined;
    revokeUrls(this.createdUrls);
    this.book?.zip.clear();
    this.book = null;
    this.displayed = undefined;
    this.fragment = undefined;
    this.frame = null;
    this.frameTheme = undefined;
    this.frameReady = false;
    window.clearInterval(this.linkTimer);
    this.toolbar.hidden = true;
    this.contents.replaceChildren(this.contentsLabel);
    this.contents.hidden = true;
    this.contents.open = false;
    this.contentsButtons.clear();
    this.contentsCurrent = undefined;
    this.tabs.replaceChildren();
    this.stage.replaceChildren();
    this.stage.removeAttribute('aria-busy');
    this.state.chapterCount = 0;
    this.state.chapterLoading = false;
    this.state.chapterIndex = 0;
    this.state.chapters = [];
    this.state.chapterTitle = undefined;
    this.state.location = undefined;
    this.state.progress = 0;
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createEbookPreviewDriver(): PreviewDriver<EbookPreviewState> {
  return {
    id: 'ebook',
    family: 'ebook',
    supports: (format) => ['epub', 'cbz'].includes(normalizeFormat(format)),
    createSession: (host, options) => new EpubPreviewSession(host, options)
  };
}

export async function loadEpubBook(
  source: PreviewSource,
  context: PreviewLoadContext = {
    descriptor: {
      source
    }
  },
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  resourceResolver?: PreviewResourceResolver
): Promise<ParsedEpubBook> {
  const book = await indexEpubBook(source, context);
  const resources = await createEpubResources(book.zip, book.epub!.manifest, book.epub!.packageDir,
    createUrl, context.signal, resourceResolver, book.warnings);
  const chapters: ParsedEpubChapter[] = [];
  for (let index = 0; index < book.chapters.length; index++) {
    const chapter = await readChapter(book, index, createUrl, context.signal, resources);
    if (chapter) chapters.push(chapter);
    else book.warnings.push(`Missing chapter file ${resolveArchivePath(book.epub!.packageDir, book.chapters[index].href)}.`);
  }
  if (!chapters.length) throw new Error('Invalid EPUB: no readable HTML chapters found.');
  return { title: book.title, chapters, warnings: book.warnings };
}

async function indexEpubBook(source: PreviewSource, context: PreviewLoadContext, ranged = false): Promise<IndexedBook> {
  const zip = await openBookZip(source, context, ranged);
  const warnings: string[] = [];
  const container = await readZipText(zip, 'META-INF/container.xml', context.signal);
  if (!container) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml.');
  }

  const rootfile = findRootfilePath(container);
  const packagePath = rootfile ? resolveArchivePath('', rootfile) : null;
  if (!packagePath) {
    throw new Error('Invalid EPUB: missing rootfile path.');
  }

  const packageXml = await readZipText(zip, packagePath, context.signal);
  if (!packageXml) {
    throw new Error(`Invalid EPUB: missing package document ${packagePath}.`);
  }

  const packageDir = dirname(packagePath);
  const document = parseXml(packageXml, packagePath);
  const manifest = readManifest(document);
  const spineIds = readSpine(document);
  const title = firstText(document, 'title');
  const chapters: IndexedBook['chapters'] = [];
  const chapterPaths = new Map<string, number>();

  for (const idref of spineIds) {
    checkAborted(context.signal);
    const item = manifest.get(idref);
    if (!item) {
      warnings.push(`Missing manifest item for spine id ${idref}.`);
      continue;
    }
    if (!isHtmlMediaType(item.mediaType)) {
      warnings.push(`Skipped non-HTML spine item ${item.href}.`);
      continue;
    }

    const path = resolveArchivePath(packageDir, item.href);
    if (!zip.has(path) || zip.get(path)!.directory || zip.get(path)!.size === 0) {
      warnings.push(`Missing chapter file ${path}.`);
      continue;
    }

    if (!chapterPaths.has(path)) chapterPaths.set(path, chapters.length);
    chapters.push({
      id: item.id,
      href: item.href,
      title: item.href
    });
  }

  if (!chapters.length) {
    throw new Error('Invalid EPUB: no readable HTML chapters found.');
  }

  const ncxId = document.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc');
  const contents = await readNavigation(zip, manifest, packageDir, ncxId, chapterPaths, context.signal, warnings);
  const titled = new Set<number>();
  const entries = contents.slice().reverse();
  while (entries.length) {
    const { title, location, children } = entries.pop()!;
    if (location && !titled.has(location.index)) {
      chapters[location.index].title = title;
      titled.add(location.index);
    }
    for (let index = children.length - 1; index >= 0; index--) entries.push(children[index]);
  }
  return {
    title: title || undefined,
    chapters,
    warnings,
    zip,
    epub: { manifest: [...manifest.values()], packageDir, chapterPaths, contents }
  };
}

export async function loadCbzBook(
  source: PreviewSource,
  context: PreviewLoadContext = {
    descriptor: {
      source
    }
  },
  createUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob)
): Promise<ParsedEpubBook> {
  const book = await indexCbzBook(source, context);
  const chapters: ParsedEpubChapter[] = [];
  for (let start = 0; start < book.chapters.length; start += 8) {
    checkAborted(context.signal);
    const batch = book.chapters.slice(start, start + 8);
    const pages = await Promise.all(batch.map(chapter =>
      book.zip.get(chapter.href)!.bytes(undefined, context.signal)));
    checkAborted(context.signal);
    for (const [index, chapter] of batch.entries()) {
      checkAborted(context.signal);
      const url = createFrameResourceUrl(pages[index], imageContentType(chapter.href), createUrl);
      chapters.push({ ...chapter, html: createComicPageHtml(chapter.title, url) });
    }
  }
  return { title: book.title, chapters, warnings: book.warnings };
}

async function indexCbzBook(source: PreviewSource, context: PreviewLoadContext, ranged = false): Promise<IndexedBook> {
  const zip = await openBookZip(source, context, ranged);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const entries = [...zip.values()]
    .filter((file) => !file.directory && isComicImage(file.name))
    .sort((left, right) => collator.compare(left.name, right.name));

  if (!entries.length) {
    throw new Error('Invalid CBZ: no readable image pages found.');
  }

  return {
    title: context.descriptor.name,
    chapters: entries.map((entry, index) => ({ id: `page-${index + 1}`, title: `Page ${index + 1}`, href: entry.name })),
    warnings: [],
    zip
  };
}

async function readChapter(book: IndexedBook, index: number, createUrl: (blob: Blob) => string,
  signal?: AbortSignal, resources?: Awaited<ReturnType<typeof createEpubResources>>): Promise<ParsedEpubChapter | null> {
  checkAborted(signal);
  const chapter = book.chapters[index];
  if (book.epub) {
    const html = await readZipText(book.zip, resolveArchivePath(book.epub.packageDir, chapter.href), signal);
    if (!html) return null;
    const content = await rewriteChapterHtml(html, chapter.href, book.epub.packageDir, resources!, signal);
    return { ...chapter, title: content.title ?? chapter.title, html: content.html };
  }
  const bytes = await book.zip.get(chapter.href)!.bytes(undefined, signal);
  checkAborted(signal);
  const url = createFrameResourceUrl(bytes, imageContentType(chapter.href), createUrl);
  return { ...chapter, html: createComicPageHtml(chapter.title, url) };
}

function revokeUrls(urls: Set<string>): void {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}

async function openBookZip(source: PreviewSource, context: PreviewLoadContext, ranged: boolean): Promise<Map<string, ZipEntry>> {
  const input = ranged && (typeof source === 'string' || source instanceof Blob)
    ? source : new Uint8Array(await sourceToArrayBuffer(source, context));
  checkAborted(context.signal);
  const zip = await openZipArchive(input, { signal: context.signal });
  checkAborted(context.signal);
  return zip;
}

async function sourceToArrayBuffer(source: PreviewSource, context: PreviewLoadContext): Promise<ArrayBuffer> {
  checkAborted(context.signal);
  if (typeof source === 'string') {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) {
      throw new Error(`Failed to load EPUB source: ${response.status} ${response.statusText}`.trim());
    }
    const bytes = await response.arrayBuffer();
    checkAborted(context.signal);
    return bytes;
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  if (source instanceof ArrayBuffer) {
    return source;
  }
  if (source instanceof Blob) {
    const bytes = await source.arrayBuffer();
    checkAborted(context.signal);
    return bytes;
  }
  return new TextEncoder().encode(String(source)).buffer as ArrayBuffer;
}

async function readZipText(zip: Map<string, ZipEntry>, path: string, signal?: AbortSignal): Promise<string | null> {
  checkAborted(signal);
  const file = zip.get(path);
  if (!file) {
    return null;
  }
  const text = new TextDecoder().decode(await file.bytes(undefined, signal));
  checkAborted(signal);
  return text;
}

function findRootfilePath(containerXml: string): string | null {
  const document = parseXml(containerXml, 'container.xml');
  const rootfile = Array.from(document.getElementsByTagName('*')).find((element) => element.localName === 'rootfile');
  return rootfile?.getAttribute('full-path') ?? null;
}

function readManifest(document: Document): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (element.localName !== 'item') {
      continue;
    }
    const id = element.getAttribute('id');
    const href = element.getAttribute('href');
    const mediaType = element.getAttribute('media-type') ?? '';
    if (id && href) {
      manifest.set(id, {
        id,
        href,
        mediaType,
        properties: element.getAttribute('properties') ?? undefined
      });
    }
  }
  return manifest;
}

function readSpine(document: Document): string[] {
  return Array.from(document.getElementsByTagName('*'))
    .filter((element) => element.localName === 'itemref')
    .map((element) => element.getAttribute('idref') ?? '')
    .filter(Boolean);
}

async function readNavigation(zip: Map<string, ZipEntry>, manifest: Map<string, ManifestItem>, packageDir: string,
  ncxId: string | null | undefined, chapterPaths: ReadonlyMap<string, number>, signal: AbortSignal | undefined, warnings: string[]): Promise<ContentsEntry[]> {
  const items = [...manifest.values()];
  const nav = items.find(item => item.properties?.split(/\s+/).includes('nav'));
  const declaredNcx = ncxId ? manifest.get(ncxId) : undefined;
  const ncx = declaredNcx?.mediaType === 'application/x-dtbncx+xml' ? declaredNcx
    : items.find(item => item.mediaType === 'application/x-dtbncx+xml');
  for (const navigation of new Set([nav, ncx])) {
    if (!navigation) continue;
    const path = resolveArchivePath(packageDir, navigation.href);
    try {
      const xml = await readZipText(zip, path, signal);
      if (!xml) throw new Error('Missing navigation document.');
      const base = dirname(path), current = chapterPaths.get(path);
      let hasTarget = false;
      const contents = parseContents(parseXml(xml, path), navigation === ncx, href => {
        const target = resolveChapterLocation(href, base, chapterPaths, current);
        if (target) hasTarget = true;
        return target;
      });
      if (hasTarget) return contents;
    } catch {
      checkAborted(signal);
      warnings.push(`EPUB navigation metadata is unavailable: ${path}.`);
    }
  }
  return [];
}

function contentsKey(index: number, fragment?: string): string { return `${index}#${fragment ?? ''}`; }

async function rewriteChapterHtml(
  html: string,
  chapterHref: string,
  packageDir: string,
  resources: Awaited<ReturnType<typeof createEpubResources>>,
  signal?: AbortSignal
): Promise<{ title?: string; html: string }> {
  checkAborted(signal);
  const document = new DOMParser().parseFromString(html, 'text/html');
  const chapterDir = dirname(resolveArchivePath(packageDir, chapterHref));
  // Plain chapters need no resource traversal; the pattern also catches namespaced hrefs.
  if (/\b(?:src|href|poster|style)\b/i.test(html)) {
    for (const element of Array.from(document.querySelectorAll('[src], [*|href], [poster], [style], style'))) {
      for (const attr of ['src', 'href', 'xlink:href', 'poster']) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const stylesheet = element.localName.toLowerCase() === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(element.getAttribute('rel') ?? '');
        const url = await resources.resolve(value, chapterDir, stylesheet);
        if (url) element.setAttribute(attr, url);
      }
      if (element.localName.toLowerCase() === 'style') {
        element.textContent = await resources.rewriteCss(element.textContent ?? '', chapterDir);
      }
      const inlineStyle = element.getAttribute('style');
      if (inlineStyle !== null) element.setAttribute('style', await resources.rewriteCss(inlineStyle, chapterDir));
    }
  }
  // srcdoc inherits the parent's base URL. Point local links at the chapter itself
  // so native fragment navigation also works in WebKit's script-disabled sandbox.
  for (const link of document.querySelectorAll('a[href], area[href]')) {
    const href = link.getAttribute('href')!.trim();
    if (href.startsWith('#')) link.setAttribute('href', `about:srcdoc${href}`);
  }
  checkAborted(signal);
  return {
    title: document.querySelector('title')?.textContent?.trim() || document.querySelector('h1,h2,h3')?.textContent?.trim() || undefined,
    html: `<!doctype html>${document.documentElement.outerHTML}`
  };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Ebook preview aborted.', 'AbortError');
}

function parseXml(xml: string, label: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const error = document.getElementsByTagName('parsererror')[0];
  if (error) {
    throw new Error(`Invalid XML in ${label}.`);
  }
  return document;
}

function firstText(document: Document, localName: string): string {
  const element = Array.from(document.getElementsByTagName('*')).find((node) => node.localName === localName);
  return element?.textContent?.trim() ?? '';
}

function isHtmlMediaType(mediaType: string): boolean {
  return mediaType === 'application/xhtml+xml' || mediaType === 'text/html';
}

function isComicImage(name: string): boolean {
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);
}

function imageContentType(name: string): string {
  const extension = normalizeFormat(name.split('.').pop());
  const types: Record<string, string> = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp'
  };
  return types[extension] ?? 'application/octet-stream';
}

function createComicPageHtml(title: string, imageUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
html,body{margin:0;min-height:100%;background:#111827;color:#f8fafc;font-family:system-ui,sans-serif;}
body{display:flex;align-items:center;justify-content:center;}
img{display:block;max-width:100%;max-height:100vh;width:auto;height:auto;object-fit:contain;}
</style></head><body><img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(title)}"></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char] ?? char);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}
