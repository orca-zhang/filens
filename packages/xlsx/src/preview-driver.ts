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
import { formulaClock, type FormulaClock } from './formula-clock';
import { workbookFontReferences } from './font-usage';
import { createSheetTable, ROW_BATCH_SIZE, COLUMN_BATCH_SIZE, SheetRowWindow } from './table';
export { appendSheetRows, createSheetTable, ROW_BATCH_SIZE } from './table';
import type { ParsedSheet, ParsedWorkbook } from './types';

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
  private readonly sampleFonts: boolean;
  private fontReferences: PreviewFontReference[] = [];
  private allFontReferences: PreviewFontReference[] = [];
  private rowWindow?: SheetRowWindow;
  private csvUpdateFrame: number | null = null;
  private pendingCsvSheet?: ParsedSheet;
  private worksheetPending = false;
  private worksheetUpdateFrame: number | null = null;
  private pendingWorksheetRows?: ParsedSheet;
  private clock?: FormulaClock;
  private midnightTimer?: ReturnType<typeof setTimeout>;

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
    this.sampleFonts = Boolean(options.fontLoading);
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
      const canPublish = () => generation === this.loadGeneration && !controller.signal.aborted;
      const workbook = await loadPreviewWorkbook(source, { ...context, signal: controller.signal }, {
        csvRows: sheet => { if (canPublish()) this.previewCsvRows(sheet); },
        worksheet: sheet => { if (canPublish()) this.previewWorksheet(sheet); },
        worksheetRows: sheet => { if (canPublish()) this.previewWorksheet(sheet, true); }
      });
      if (generation !== this.loadGeneration) return;
      if (controller.signal.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
      const partialWorkbook = this.workbook;
      const isCsv = normalizeFormat(context.route?.sourceFormat ?? context.descriptor.extension ?? '') === 'csv';
      const csvSheet = isCsv ? partialWorkbook?.sheets[0] : undefined;
      if (csvSheet) {
        this.cancelCsvUpdate();
        this.updateCsvDimensions(csvSheet, workbook.sheets[0]);
        workbook.sheets[0] = csvSheet;
      }
      this.workbook = workbook;
      if (workbook.sheets.length) {
        this.clock = formulaClock(workbook.sheets[0]);
        this.clock.time = Date.now();
        this.host.ownerDocument.addEventListener('visibilitychange', this.resumeClock);
        this.scheduleMidnight();
      }
      const fontReferences = workbookFontReferences(workbook, this.sampleFonts);
      this.allFontReferences = fontReferences.all;
      this.fontReferences = fontReferences.loading;
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
        sheets: this.workbook.sheets.map((sheet, index) => ({
          id: sheet.id || String(index + 1),
          name: sheet.name
        }))
      };
      if (!partialWorkbook) this.render();
      else if (!csvSheet) this.rowWindow?.refresh('fonts');
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

  refreshFontLayout(): void { this.fontLoading.refresh(); }

  refreshFonts(update: PreviewFontRefresh): void {
    if (!this.workbook || this.state.loading || this.loadController?.signal.aborted) return;
    this.fontReferences = update.references;
    const replacementFor = (ref: PreviewFontReference) => update.references.find(item => item.fontFamily === ref.fontFamily
      && item.traits?.weight === ref.traits?.weight && (item.fontStyle ?? 'normal') === (ref.fontStyle ?? 'normal'));
    this.allFontReferences = this.allFontReferences.map(ref => replacementFor(ref) ?? ref);
    const analysis = analyzeLoadedPreviewFonts({ ...update, references: this.allFontReferences }, this.host.ownerDocument);
    const targets = new Map(analysis.fonts.map(font => [JSON.stringify([font.fontFamily, font.classification]), font.resolvedFontFamily]));
    for (const ref of this.workbook.fonts ?? []) {
      const replacement = replacementFor(ref);
      if (replacement) ref.resolvedFontFamily = replacement.resolvedFontFamily
        ?? targets.get(JSON.stringify([ref.fontFamily, classifyPreviewFont(ref.fontFamily ?? '', ref.traits)]));
    }
    this.state.fonts = analysis.fonts;
    this.state.warnings = [...new Set([...this.workbook.warnings, ...analysis.warnings])];
    if (update.loaded.length || update.relayout) this.refreshActiveSheet('fonts');
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
    if (this.clock) {
      this.clock.time = Date.now();
      this.scheduleMidnight();
    }
    this.render();
    this.emit('statechange', this.state);
  }

  private render(): void {
    this.renderTabs();
    this.renderActiveSheet();
  }

  private previewCsvRows(sheet: ParsedSheet): void {
    const visible = this.workbook?.sheets[0];
    if (!visible) {
      this.workbook = { sheets: [sheet], warnings: [] };
      this.state.sheets = [{ id: sheet.id, name: sheet.name }];
      this.renderTabs();
      this.rowWindow = new SheetRowWindow(sheet, this.grid);
      this.emit('statechange', this.state);
      return;
    }
    this.pendingCsvSheet = sheet;
    if (this.csvUpdateFrame !== null) return;
    this.csvUpdateFrame = requestAnimationFrame(() => {
      this.csvUpdateFrame = null;
      const pending = this.pendingCsvSheet;
      this.pendingCsvSheet = undefined;
      if (pending) this.updateCsvDimensions(visible, pending);
    });
  }

  private previewWorksheet(sheet: ParsedSheet, pending = false): void {
    const workbook = this.workbook ??= { sheets: [], warnings: [] };
    if (this.worksheetPending) {
      const index = workbook.sheets.length - 1;
      if (pending) {
        this.pendingWorksheetRows = sheet;
        if (this.worksheetUpdateFrame === null) {
          this.worksheetUpdateFrame = requestAnimationFrame(() => {
            this.worksheetUpdateFrame = null;
            const latest = this.pendingWorksheetRows;
            this.pendingWorksheetRows = undefined;
            if (latest) this.replaceWorksheet(workbook, index, latest);
          });
        }
      } else {
        this.cancelWorksheetUpdate();
        this.worksheetPending = false;
        this.replaceWorksheet(workbook, index, sheet);
      }
      return;
    }
    this.worksheetPending = pending;
    const index = workbook.sheets.length;
    workbook.sheets.push(sheet);
    this.state.sheets = [...this.state.sheets, { id: sheet.id || String(index + 1), name: sheet.name }];
    this.appendSheetTab(sheet.name, index);
    if (index === 0) this.renderActiveSheet();
    this.emit('statechange', this.state);
  }

  private replaceWorksheet(workbook: ParsedWorkbook, index: number, sheet: ParsedSheet): void {
    workbook.sheets[index] = sheet;
    if (index !== this.state.activeSheetIndex) return;
    const position = this.rowWindow?.scrollPosition();
    this.renderActiveSheet();
    if (position) this.rowWindow?.restoreScrollPosition(position);
  }

  private cancelWorksheetUpdate(): void {
    if (this.worksheetUpdateFrame !== null) cancelAnimationFrame(this.worksheetUpdateFrame);
    this.worksheetUpdateFrame = null;
    this.pendingWorksheetRows = undefined;
  }

  private updateCsvDimensions(visible: ParsedSheet, latest: ParsedSheet): void {
    visible.rowCount = latest.rowCount;
    visible.columnCount = latest.columnCount;
    this.rowWindow?.refreshCsvDimensions();
  }

  private cancelCsvUpdate(): void {
    if (this.csvUpdateFrame !== null) cancelAnimationFrame(this.csvUpdateFrame);
    this.csvUpdateFrame = null;
    this.pendingCsvSheet = undefined;
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const [index, sheet] of this.state.sheets.entries()) {
      this.appendSheetTab(sheet.name, index);
    }
  }

  private appendSheetTab(name: string, index: number): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'xlsxv-sheet-tab';
    button.classList.toggle('is-active', index === this.state.activeSheetIndex);
    button.textContent = name;
    button.addEventListener('click', () => this.goToSheet(index));
    this.tabs.appendChild(button);
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
    if (this.state.loading || sheet.columnWidthSource || sheet.rowCount > ROW_BATCH_SIZE || sheet.columnCount > COLUMN_BATCH_SIZE) {
      this.rowWindow = new SheetRowWindow(sheet, this.grid, this.grid, { calculationPending: () => this.state.loading });
    } else this.grid.appendChild(createSheetTable(sheet));
  }

  private refreshActiveSheet(reason: 'fonts' | 'values'): void {
    const sheet = this.workbook?.sheets[this.state.activeSheetIndex];
    if (this.rowWindow) this.rowWindow.refresh(reason);
    else if (sheet) {
      const top = this.grid.scrollTop, left = this.grid.scrollLeft;
      this.grid.replaceChildren(createSheetTable(sheet));
      this.grid.scrollTop = top;
      this.grid.scrollLeft = left;
    }
  }

  private scheduleMidnight(): void {
    clearTimeout(this.midnightTimer);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    this.midnightTimer = setTimeout(this.refreshClock, Math.max(1, next.getTime() - now.getTime()));
  }

  private readonly refreshClock = () => {
    if (!this.clock) return;
    const time = Date.now();
    if (time !== this.clock.time) {
      this.clock.time = time;
      if (this.clock.reads) this.refreshActiveSheet('values');
    }
    this.scheduleMidnight();
  };

  private readonly resumeClock = () => {
    if (this.host.ownerDocument.visibilityState === 'visible') this.refreshClock();
  };

  private releaseWorkbook(): void {
    clearTimeout(this.midnightTimer);
    this.midnightTimer = undefined;
    if (this.clock) this.host.ownerDocument.removeEventListener('visibilitychange', this.resumeClock);
    this.clock = undefined;
    this.cancelCsvUpdate();
    this.cancelWorksheetUpdate();
    this.worksheetPending = false;
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
