import {
  analyzePreviewFonts,
  classifyPreviewFont,
  analyzeLoadedPreviewFonts,
  bindPreviewFontLoading,
  type PreviewFontReference,
  type PreviewFontRefresh,
  type PreviewDriver,
  type PreviewEventMap,
  type PreviewEventName,
  type PreviewLoadContext,
  type PreviewOptions,
  type PreviewSession,
  type PreviewSource,
  type WorkbookPreviewState
} from '@filens/core';
import { loadPreviewWorkbook } from './workbook-cache';
import { createSheetTable, ROW_BATCH_SIZE, COLUMN_BATCH_SIZE, SheetRowWindow } from './table';
export { appendSheetRows, createSheetTable, ROW_BATCH_SIZE } from './table';
import type { ParsedRichText, ParsedWorkbook } from './types';

type PreviewListenerMap = {
  [K in PreviewEventName]: Set<(payload: PreviewEventMap[K]) => void>;
};

export { XLSX_FORMAT_ROUTES, createXlsxPreviewRoutes } from './routes';

export class XlsxPreviewSession implements PreviewSession<WorkbookPreviewState> {
  private readonly listeners: PreviewListenerMap = {
    loading: new Set(),
    rendered: new Set(),
    error: new Set(),
    statechange: new Set(),
    warnings: new Set()
  };
  private readonly root: HTMLDivElement;
  private readonly tabs: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private workbook: ParsedWorkbook | null = null;
  private loadGeneration = 0;
  private loadController?: AbortController;
  private removeAbortListener?: () => void;
  private state: WorkbookPreviewState;
  private readonly fontLoading: ReturnType<typeof bindPreviewFontLoading>;
  private fontReferences: PreviewFontReference[] = [];
  private allFontReferences: PreviewFontReference[] = [];
  private rowWindow?: SheetRowWindow;

  constructor(private readonly host: HTMLElement, options: PreviewOptions = {}) {
    this.root = document.createElement('div');
    this.root.className = 'xlsxv-preview';
    this.tabs = document.createElement('div');
    this.tabs.className = 'xlsxv-sheet-tabs';
    this.tabs.dataset.previewControls = '';
    this.grid = document.createElement('div');
    this.grid.className = 'xlsxv-grid';
    this.root.replaceChildren(this.tabs, this.grid);
    this.host.replaceChildren(this.root);
    this.state = {
      loading: false,
      error: null,
      family: 'workbook',
      warnings: [],
      capabilities: {
        workbook: true,
        sheets: true,
        search: true,
        download: true
      },
      activeSheetIndex: 0,
      sheets: [],
      scale: options.initialScale ?? 1
    };
    this.fontLoading = bindPreviewFontLoading(this, host.ownerDocument, options);
  }

  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.fontLoading.reset(context.signal, context.route?.targetFormat ?? context.descriptor.extension ?? 'xlsx');
    const generation = ++this.loadGeneration;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseWorkbook();
    const controller = new AbortController();
    this.loadController = controller;
    const signal = context.signal;
    const abort = () => {
      controller.abort();
      if (generation === this.loadGeneration) {
        this.releaseWorkbook();
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
      warnings: []
    };
    this.emit('loading', this.state);
    this.emit('statechange', this.state);

    try {
      if (signal?.aborted) abort();
      const workbook = await loadPreviewWorkbook(source, { ...context, signal: controller.signal });
      if (generation !== this.loadGeneration) return;
      if (controller.signal.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
      this.workbook = workbook;
      const used = new Set<PreviewFontReference>();
      const richTexts = new Set<ParsedRichText>();
      for (const sheet of workbook.sheets) {
        if (sheet.columnWidthSource?.font) used.add(sheet.columnWidthSource.font);
        const formats = sheet.cellStyles?.formats;
        const addStyleFont = (index: number) => {
          const font = formats?.[index]?.font;
          if (font) used.add(font);
        };
        addStyleFont(0);
        for (const range of sheet.cellStyles?.columns ?? []) {
          if (range.firstColumn <= sheet.columnCount && range.lastColumn >= 1) addStyleFont(range.styleIndex);
        }
        for (const row of sheet.rows) {
          if (row.styleIndex !== undefined) addStyleFont(row.styleIndex);
          for (const cell of row.cells) {
            if (cell.font) used.add(cell.font);
            if (!cell.richText || richTexts.has(cell.richText)) continue;
            richTexts.add(cell.richText);
            for (const run of cell.richText.runs) if (run.font?.fontFamily) used.add(run.font);
          }
        }
      }
      this.allFontReferences = (workbook.fonts ?? []).map(ref => ({ ...ref }));
      this.fontReferences = this.allFontReferences.filter((_, index) => used.has(workbook.fonts![index]));
      const fontAnalysis = analyzePreviewFonts(workbook.fonts ?? [], this.host.ownerDocument, { substitute: true });
      // These references belong to this parsed workbook and are shared by its cells.
      const targets = new Map(fontAnalysis.fonts.map(font => [JSON.stringify([font.fontFamily, font.classification]), font.resolvedFontFamily]));
      for (const reference of workbook.fonts ?? []) {
        const target = targets.get(JSON.stringify([reference.fontFamily, classifyPreviewFont(reference.fontFamily ?? '', reference.traits)]));
        if (target) reference.resolvedFontFamily = target;
      }
      this.state = {
        ...this.state,
        loading: false,
        error: null,
        warnings: [...new Set([...this.workbook.warnings, ...fontAnalysis.warnings])],
        fonts: fontAnalysis.fonts,
        activeSheetIndex: 0,
        sheets: this.workbook.sheets.map((sheet, index) => ({
          id: sheet.id || String(index + 1),
          name: sheet.name
        }))
      };
      this.render();
      if (this.state.warnings.length) {
        this.emit('warnings', this.state.warnings);
      }
      this.emit('rendered', this.state);
      this.emit('statechange', this.state);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      this.releaseWorkbook();
      this.state.loading = false;
      if (controller.signal.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.error = normalizedError.message;
      this.emit('error', normalizedError);
      this.emit('statechange', this.state);
      throw normalizedError;
    }
  }

  destroy(): void {
    this.fontLoading.destroy();
    this.loadGeneration++;
    this.loadController?.abort();
    this.removeAbortListener?.();
    this.releaseWorkbook();
    this.state.loading = false;
    this.root.replaceChildren();
    if (this.root.parentElement === this.host) {
      this.host.replaceChildren();
    }
    for (const listeners of Object.values(this.listeners)) listeners.clear();
  }

  getState(): WorkbookPreviewState {
    return {
      ...this.state,
      warnings: this.state.warnings.slice(),
      fonts: this.state.fonts?.map(font => ({ ...font, classification: font.classification ? { ...font.classification } : undefined })),
      sheets: this.state.sheets.slice()
    };
  }

  getFontReferences(): readonly PreviewFontReference[] { return this.fontReferences; }

  refreshFonts(update: PreviewFontRefresh): void {
    if (!this.workbook || this.loadController?.signal.aborted) return;
    this.fontReferences = update.references;
    const replacementFor = (ref: PreviewFontReference) => update.references.find(item => item.fontFamily === ref.fontFamily
      && item.traits?.weight === ref.traits?.weight && (item.fontStyle ?? 'normal') === (ref.fontStyle ?? 'normal'));
    this.allFontReferences = this.allFontReferences.map(ref => replacementFor(ref) ?? ref);
    const analysis = analyzeLoadedPreviewFonts({ ...update, references: this.allFontReferences }, this.host.ownerDocument);
    for (const ref of this.workbook.fonts ?? []) {
      const replacement = replacementFor(ref);
      if (replacement?.resolvedFontFamily) ref.resolvedFontFamily = replacement.resolvedFontFamily;
    }
    this.state.fonts = analysis.fonts;
    this.state.warnings = [...new Set([...this.workbook.warnings, ...analysis.warnings])];
    if (update.loaded.length || update.relayout) {
      const sheet = this.workbook.sheets[this.state.activeSheetIndex];
      if (this.rowWindow) this.rowWindow.refresh();
      else if (sheet) {
        const top = this.grid.scrollTop, left = this.grid.scrollLeft;
        this.grid.replaceChildren(createSheetTable(sheet));
        this.grid.scrollTop = top;
        this.grid.scrollLeft = left;
      }
    }
    this.emit('warnings', this.state.warnings);
    this.emit('rendered', this.getState()); this.emit('statechange', this.getState());
  }

  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  goToPage(index: number): void {
    this.goToSheet(index);
  }

  next(): void {
    this.goToSheet(Math.min(this.state.activeSheetIndex + 1, Math.max(this.state.sheets.length - 1, 0)));
  }

  prev(): void {
    this.goToSheet(Math.max(this.state.activeSheetIndex - 1, 0));
  }

  private goToSheet(index: number): void {
    if (!Number.isInteger(index) || !this.workbook) return;
    const nextIndex = Math.max(0, Math.min(index, Math.max(this.state.sheets.length - 1, 0)));
    if (nextIndex === this.state.activeSheetIndex) {
      return;
    }
    this.state.activeSheetIndex = nextIndex;
    this.render();
    this.emit('statechange', this.state);
  }

  private render(): void {
    this.renderTabs();
    this.renderActiveSheet();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [index, sheet] of this.state.sheets.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xlsxv-sheet-tab';
      button.classList.toggle('is-active', index === this.state.activeSheetIndex);
      button.textContent = sheet.name;
      button.addEventListener('click', () => this.goToSheet(index));
      this.tabs.appendChild(button);
    }
  }

  private renderActiveSheet(): void {
    const sheet = this.workbook?.sheets[this.state.activeSheetIndex];
    this.rowWindow?.destroy();
    this.rowWindow = undefined;
    this.grid.replaceChildren();
    this.grid.scrollTop = this.grid.scrollLeft = 0;
    if (!sheet) {
      return;
    }
    if (sheet.columnWidthSource || sheet.rowCount > ROW_BATCH_SIZE || sheet.columnCount > COLUMN_BATCH_SIZE) this.rowWindow = new SheetRowWindow(sheet, this.grid);
    else this.grid.appendChild(createSheetTable(sheet));
  }

  private releaseWorkbook(): void {
    this.rowWindow?.destroy();
    this.rowWindow = undefined;
    this.fontReferences = [];
    this.allFontReferences = [];
    this.workbook = null;
    this.tabs.replaceChildren();
    this.grid.replaceChildren();
    this.grid.scrollTop = this.grid.scrollLeft = 0;
    this.state.activeSheetIndex = 0;
    this.state.sheets = [];
    this.state.fonts = [];
  }

  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }
}

export function createXlsxPreviewDriver(): PreviewDriver<WorkbookPreviewState> {
  return {
    id: 'xlsx',
    family: 'workbook',
    supports: (format) => ['xlsx', 'csv'].includes(normalizeFormat(format)),
    createSession: (host, options) => new XlsxPreviewSession(host, options)
  };
}

function normalizeFormat(format: string): string {
  return format.trim().replace(/^\./, '').toLowerCase();
}
