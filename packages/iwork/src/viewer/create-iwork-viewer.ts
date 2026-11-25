import { bindPreviewTouchGestures, MediaRegistry, previewContentKey, previewModelCache, renderTableCellContent, type TableCell, type TableItem } from '@filens/core';
import type { ParsedCell } from '@filens/xlsx';
import { appendSheetRows, createSheetTable, ROW_BATCH_SIZE, COLUMN_BATCH_SIZE, SheetRowWindow, type ParsedSheet, type SheetCellRenderer, type SheetRowMeasurements } from '@filens/xlsx/table';
import type {
  IworkFitMode,
  IworkViewerEventMap,
  IworkViewerEventName,
  IworkViewerInstance,
  IworkViewerOptions,
  IworkViewerState,
  ParsedIworkDocument
} from '../types';
import { loadSourceBytes } from '../parser/load-source';
import { IworkWorkerClient } from '../worker/client';
import { createCanvasElement, createMediaRegistry, documentCanvases } from './render';

type EventHandler<T extends IworkViewerEventName> = (payload: IworkViewerEventMap[T]) => void;

export function createIworkViewer(container: HTMLElement, options: IworkViewerOptions = {}): IworkViewerInstance {
  const listeners = new Map<IworkViewerEventName, Set<(payload: unknown) => void>>();
  let worker: IworkWorkerClient | null = null;
  let workerHasDocument = false;
  const getWorker = () => worker ??= new IworkWorkerClient();
  const usePagedWidthFitByDefault = options.fit === undefined;
  let mediaRegistry: MediaRegistry | null = null;
  let loadController: AbortController | null = null;
  let renderController: AbortController | null = null;
  let generation = 0;
  let destroyed = false;
  const state: IworkViewerState = {
    loading: false,
    error: null,
    kind: null,
    currentPage: 0,
    pageCount: 0,
    currentSheet: 0,
    sheetCount: 0,
    scale: options.initialScale ?? 1,
    fit: options.fit ?? 'contain',
    warnings: [],
    document: null
  };

  container.classList.add('iworkv-root');
  container.innerHTML = '<div class="iworkv-stage"></div>';
  const stage = container.querySelector('.iworkv-stage') as HTMLDivElement;
  let resizeObserver: ResizeObserver | null = null;
  let pageShells: HTMLDivElement[] = [];
  const mountedPages = new Map<number, HTMLElement>();
  const visiblePages = new Set<number>();
  const sheetLoads = new Map<number, Promise<void>>();
  const rowWindows = new Set<SheetRowWindow>();
  let rowMeasurements = new WeakMap<TableItem, SheetRowMeasurements>();
  let refreshedRows: number[] | undefined;
  let scrollFrame = 0;
  let unbindTouch = () => {};

  const emit = <T extends IworkViewerEventName>(event: T, payload: IworkViewerEventMap[T]) => {
    listeners.get(event)?.forEach((handler) => handler(payload));
  };

  const setStatus = () => {
    container.classList.toggle('is-loading', state.loading);
    container.classList.toggle('is-error', Boolean(state.error));
    container.dataset.status = state.error ?? (state.loading ? 'Loading document...' : '');
  };

  const getState = (): IworkViewerState => ({
    ...state,
    warnings: state.warnings.slice()
  });

  const clearRowWindows = () => {
    for (const view of rowWindows) view.destroy();
    rowWindows.clear();
  };

  const stopLoad = () => {
    unbindTouch();
    unbindTouch = () => {};
    const controller = loadController;
    loadController = null;
    controller?.abort();
    worker?.cancel();
    workerHasDocument = false;
    renderController?.abort();
    renderController = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (scrollFrame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    clearRowWindows(); rowMeasurements = new WeakMap();
    stage.replaceChildren();
    stage.classList.remove('iworkv-numbers-stage');
    pageShells = [];
    mountedPages.clear();
    visiblePages.clear();
    sheetLoads.clear();
    mediaRegistry?.destroy();
    mediaRegistry = null;
    Object.assign(state, {
      document: null, kind: null, loading: false, error: null, warnings: [],
      currentPage: 0, pageCount: 0, currentSheet: 0, sheetCount: 0
    });
    container.scrollTop = 0;
    container.scrollLeft = 0;
  };

  const render = () => {
    renderController?.abort();
    renderController = new AbortController();
    clearRowWindows();
    stage.innerHTML = '';
    stage.classList.toggle('iworkv-numbers-stage', state.document?.kind === 'numbers');
    pageShells = [];
    mountedPages.clear();
    visiblePages.clear();
    if (!state.document) {
      return;
    }

    const canvases = documentCanvases(state.document);
    if (!canvases.length) {
      return;
    }

    if (state.document.kind === 'numbers') {
      renderNumbers();
      return;
    }

    if (state.document.kind === 'key' || state.document.kind === 'pages') {
      const pages = document.createElement('div');
      pages.className = 'iworkv-pages';
      const bounds = stage.getBoundingClientRect();
      canvases.forEach((canvas, index) => {
        const shell = document.createElement('div');
        shell.className = 'iworkv-page-shell';
        applyCanvasScale(shell, canvas.width, canvas.height, resolveScale(canvas.width, canvas.height, bounds));
        shell.dataset.pageIndex = String(index);
        pages.appendChild(shell);
        pageShells.push(shell);
      });
      stage.appendChild(pages);
      visiblePages.add(state.currentPage);
      syncMountedPages();
      return;
    }
  };

  const renderNumbers = () => {
    if (state.document?.kind !== 'numbers') {
      return;
    }
    const preview = document.createElement('div');
    preview.className = 'xlsxv-preview';
    const tabs = document.createElement('div');
    tabs.className = 'xlsxv-sheet-tabs';
    tabs.dataset.previewControls = '';
    state.document.sheets.forEach((sheet, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xlsxv-sheet-tab';
      button.classList.toggle('is-active', index === state.currentSheet);
      button.textContent = sheet.name;
      button.addEventListener('click', () => goToSheet(index), { signal: renderController!.signal });
      tabs.appendChild(button);
    });

    const grid = document.createElement('div');
    grid.className = 'xlsxv-grid';
    const tables = document.createElement('div');
    tables.className = 'iworkv-numbers-tables';
    const activeSheet = state.document.sheets[state.currentSheet];
    const renderedTables: { sheet: ParsedSheet; table: HTMLTableElement; body: HTMLTableSectionElement; renderCell: SheetCellRenderer }[] = [];
    (activeSheet?.tables ?? []).forEach(({ item }, index) => {
      const { sheet, renderCell } = numbersTableToSheet(item, index, mediaRegistry);
      const section = document.createElement('section');
      section.className = 'iworkv-numbers-table';
      section.style.containIntrinsicBlockSize = `auto ${(Math.min(Math.max(sheet.rowCount, 1), ROW_BATCH_SIZE) + 1) * 26}px`;
      if ((activeSheet?.tables.length ?? 0) > 1) {
        const title = document.createElement('h3');
        title.className = 'iworkv-numbers-table-title';
        title.textContent = `Table ${index + 1}`;
        section.appendChild(title);
      }
      tables.appendChild(section);
      const windowed = options.virtual !== false && (sheet.rowCount > ROW_BATCH_SIZE || sheet.columnCount > COLUMN_BATCH_SIZE);
      if (windowed) {
        section.classList.add('is-windowed');
        const measurements = rowMeasurements.get(item) ?? { heights: new Map<number, number>() };
        rowMeasurements.set(item, measurements);
        rowWindows.add(new SheetRowWindow(sheet, grid, section, { renderCell, measurements }));
      } else {
        const table = createSheetTable(sheet, Math.min(Math.max(sheet.rowCount, 1), refreshedRows?.[index] ?? ROW_BATCH_SIZE), renderCell);
        section.appendChild(table);
        renderedTables.push({ sheet, table, body: table.tBodies[0], renderCell });
      }
    });
    const floatingItems = activeSheet?.canvas.slide.items.filter((item) => item.kind !== 'table') ?? [];
    if (activeSheet && floatingItems.length) {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.className = 'iworkv-numbers-table-title';
      title.textContent = 'Sheet objects';
      const canvas = {
        ...activeSheet.canvas,
        slide: {
          ...activeSheet.canvas.slide,
          items: floatingItems
        }
      };
      const shell = createCanvasElement(document, state.document, canvas, mediaRegistry ?? undefined);
      const availableWidth = Math.max(stage.getBoundingClientRect().width - 32, 1);
      applyCanvasScale(shell, canvas.width, canvas.height, availableWidth / Math.max(canvas.width, 1));
      section.className = 'iworkv-numbers-objects';
      section.append(title, shell);
      tables.appendChild(section);
    }
    grid.appendChild(tables);
    grid.addEventListener('scroll', () => {
      if (grid.scrollHeight - grid.scrollTop - grid.clientHeight > grid.clientHeight * 2) {
        return;
      }
      for (const { sheet, body, renderCell } of renderedTables) {
        const renderedRows = body.rows.length;
        if (renderedRows < sheet.rowCount) {
          appendSheetRows(body, sheet, renderedRows + 1, Math.min(renderedRows + ROW_BATCH_SIZE, sheet.rowCount), renderCell);
        }
      }
    }, { passive: true, signal: renderController!.signal });

    preview.replaceChildren(tabs, grid);
    stage.appendChild(preview);
    for (const view of rowWindows) view.refresh();
  };

  const syncMountedPages = () => {
    if (!state.document || state.document.kind === 'numbers') {
      return;
    }

    const canvases = documentCanvases(state.document);
    const shouldVirtualize = options.virtual ?? state.document.kind === 'pages';
    const targetPages = shouldVirtualize
      ? visiblePages
      : new Set(pageShells.map((_, index) => index));
    for (const [index, element] of mountedPages) {
      if (!targetPages.has(index)) {
        element.remove();
        mountedPages.delete(index);
      }
    }
    for (const index of targetPages) {
      if (mountedPages.has(index)) {
        continue;
      }
      const shell = pageShells[index];
      const canvas = canvases[index];
      if (!shell || !canvas) {
        continue;
      }
      const content = createCanvasElement(document, state.document, canvas, mediaRegistry ?? undefined).firstElementChild;
      if (content) {
        shell.appendChild(content);
        applyCanvasScale(shell, canvas.width, canvas.height, state.scale);
        mountedPages.set(index, content as HTMLElement);
      }
    }
  };

  const trackVisiblePage = () => {
    scrollFrame = 0;
    if (!state.document || state.document.kind === 'numbers' || !pageShells.length) {
      return;
    }
    const viewport = resolveVisibleViewport(container);
    const viewportCenter = (viewport.top + viewport.bottom) / 2;
    const overscan = Math.max(viewport.height, 1);
    let nearestIndex = state.currentPage;
    let nearestDistance = Number.POSITIVE_INFINITY;
    visiblePages.clear();
    pageShells.forEach((shell, index) => {
      const rect = shell.getBoundingClientRect();
      if (rect.bottom >= viewport.top - overscan && rect.top <= viewport.bottom + overscan) {
        visiblePages.add(index);
      }
      const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (!visiblePages.size) {
      visiblePages.add(nearestIndex);
    }
    syncMountedPages();
    if (nearestIndex === state.currentPage) {
      return;
    }
    state.currentPage = nearestIndex;
    emit('pagechange', getState());
  };

  const handleScroll = () => {
    if (scrollFrame || typeof requestAnimationFrame === 'undefined') {
      if (!scrollFrame) {
        trackVisiblePage();
      }
      return;
    }
    scrollFrame = requestAnimationFrame(trackVisiblePage);
  };

  container.addEventListener('scroll', handleScroll, { passive: true });
  container.ownerDocument.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  container.ownerDocument.defaultView?.addEventListener('scroll', handleScroll, { passive: true });

  const scrollToPageCanvas = (index: number) => {
    if (!state.document || state.document.kind === 'numbers') {
      return;
    }
    const shell = stage.querySelector<HTMLElement>(`.iworkv-page-shell[data-page-index="${index}"]`);
    if (!shell) {
      return;
    }
    shell.scrollIntoView({
      block: 'nearest',
      inline: 'nearest'
    });
  };

  const resolveScale = (width: number, height: number, measuredBounds?: DOMRect): number => {
    if (state.fit === 'none') {
      return state.scale;
    }

    const bounds = measuredBounds ?? stage.getBoundingClientRect();
    // The stage owns 16px padding on each side. Keep the fit calculation in
    // sync with that padding so paged iWork canvases use the viewport.
    const availableWidth = Math.max(bounds.width - 32, 1);
    const availableHeight = Math.max(bounds.height - 32, 1);
    if (state.fit === 'width') {
      state.scale = availableWidth / Math.max(width, 1);
      return state.scale;
    }

    if (state.fit === 'height') {
      state.scale = availableHeight / Math.max(height, 1);
      return state.scale;
    }

    state.scale = Math.min(availableWidth / Math.max(width, 1), availableHeight / Math.max(height, 1));
    return state.scale;
  };

  const bindResizeObserver = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    resizeObserver = new ResizeObserver(() => {
      if (!state.document) {
        return;
      }
      if (state.fit === 'none') {
        return;
      }
      if (state.document.kind === 'numbers') {
        // The workbook grid fills its container through CSS. Rebuilding it on
        // resize repeats table layout and discards rows loaded by scrolling.
        // Only floating sheet objects have a canvas scale to update.
        const canvas = state.document.sheets[state.currentSheet]?.canvas;
        const shell = stage.querySelector<HTMLElement>('.iworkv-numbers-objects .iworkv-page-shell');
        if (canvas && shell) {
          const availableWidth = Math.max(stage.getBoundingClientRect().width - 32, 1);
          applyCanvasScale(shell, canvas.width, canvas.height, availableWidth / Math.max(canvas.width, 1));
        }
        return;
      }
      const bounds = stage.getBoundingClientRect();
      documentCanvases(state.document).forEach((canvas, index) => {
        const shell = pageShells[index];
        if (shell) applyCanvasScale(shell, canvas.width, canvas.height, resolveScale(canvas.width, canvas.height, bounds));
      });
      emit('scalechange', getState());
    });
    resizeObserver.observe(stage);
  };

  const loadSheet = (index: number) => {
    const numbers = state.document?.kind === 'numbers' ? state.document : null;
    if (!numbers || numbers.sheets[index]?.loaded !== false) {
      return;
    }
    if (state.currentSheet === index) {
      container.classList.add('is-loading');
      container.dataset.status = 'Loading sheet...';
    }
    if (sheetLoads.has(index)) {
      return;
    }
    const task = (workerHasDocument ? getWorker().parseSheet(index) : getWorker().parseSheet(index, numbers))
      .then((sheet) => {
        if (state.document !== numbers) {
          return;
        }
        workerHasDocument = true;
        numbers.sheets[index] = sheet;
        if (state.currentSheet === index) {
          render();
          setStatus();
        }
        emit('sheetchange', getState());
      })
      .catch((error) => {
        if (state.document !== numbers) {
          return;
        }
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (state.currentSheet === index) {
          state.error = normalized.message;
          setStatus();
          emit('error', normalized);
        }
      })
      .finally(() => {
        if (sheetLoads.get(index) === task) sheetLoads.delete(index);
      });
    sheetLoads.set(index, task);
  };

  const preview: IworkViewerInstance['preview'] = async (source, previewOptions = {}) => {
    if (destroyed) throw new Error('iWork viewer has been destroyed.');
    const currentGeneration = ++generation;
    stopLoad();
    const controller = new AbortController();
    loadController = controller;
    const abort = () => {
      if (loadController !== controller) return;
      stopLoad();
      setStatus();
      emit('loadingchange', getState());
    };
    previewOptions.signal?.addEventListener('abort', abort, { once: true });
    controller.signal.addEventListener('abort', () => previewOptions.signal?.removeEventListener('abort', abort), { once: true });
    if (previewOptions.signal?.aborted) {
      abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    state.loading = true;
    state.error = null;
    setStatus();
    emit('loadingchange', getState());
    try {
      const bytes = await waitForLoad(loadSourceBytes(source, { signal: controller.signal }), controller.signal);
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      // Snapshot keys cover every byte plus parsing hints; URL and password
      // callers bypass reuse. Only immutable parser data enters the cache.
      const key = previewOptions.cache !== false && typeof source !== 'string' && bytes[0] === 0x50 && bytes[1] === 0x4b
        ? await waitForLoad(previewContentKey(bytes, `iwork-v1:${JSON.stringify([options.type, resolveSourceName(source)])}`, controller.signal), controller.signal)
        : undefined;
      let document = previewModelCache.get<ParsedIworkDocument>(key);
      if (!document) {
        document = await waitForLoad(getWorker().parse(bytes, options.type, resolveSourceName(source)), controller.signal);
        if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        workerHasDocument = true;
        previewModelCache.put(key, document);
      }
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      state.document = document;
      state.kind = document.kind;
      state.warnings = document.warnings.slice();
      // Paged iWork canvases are best read at viewport width. The toolbar
      // still exposes Fit for users who prefer the full canvas in view.
      if (usePagedWidthFitByDefault && (document.kind === 'key' || document.kind === 'pages') && state.fit === 'contain') {
        state.fit = 'width';
      }
      state.currentPage = 0;
      state.currentSheet = 0;
      sheetLoads.clear();
      state.pageCount = document.kind === 'numbers' ? 0 : document.kind === 'key' ? document.slides.length : document.pages.length;
      state.sheetCount = document.kind === 'numbers' ? document.sheets.length : 0;
      mediaRegistry?.destroy();
      mediaRegistry = createMediaRegistry(document);
      state.loading = false;
      render();
      if (state.kind !== 'numbers') {
        unbindTouch = bindPreviewTouchGestures(container, {
          getScale: () => state.scale,
          setScale,
          enabled: () => !destroyed && !state.loading,
          minScale: options.minScale,
          maxScale: options.maxScale,
          signal: controller.signal
        });
      }
      bindResizeObserver();
      setStatus();
      emit('loadingchange', getState());
      if (loadController !== controller) return;
      emit('warnings', state.warnings);
      if (loadController === controller) emit('rendered', getState());
    } catch (error) {
      if (destroyed || generation !== currentGeneration) return;
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const normalized = error instanceof Error ? error : new Error(String(error));
      stopLoad();
      state.error = normalized.message;
      setStatus();
      emit('loadingchange', getState());
      if (!destroyed && generation === currentGeneration) emit('error', normalized);
    }
  };

  const setScale = (scale: number) => {
    if (destroyed || state.kind === 'numbers') {
      return;
    }
    state.fit = 'none';
    state.scale = Math.max(options.minScale ?? 0.25, Math.min(scale, options.maxScale ?? 4));
    render();
    emit('scalechange', getState());
  };

  const fit = (mode: IworkFitMode = 'contain') => {
    if (destroyed || state.kind === 'numbers') {
      return;
    }
    state.fit = mode;
    render();
    emit('scalechange', getState());
  };

  const on = <T extends IworkViewerEventName>(event: T, handler: EventHandler<T>) => {
    if (destroyed) return () => {};
    const handlers = listeners.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler as (payload: unknown) => void);
    listeners.set(event, handlers);
    return () => {
      handlers.delete(handler as (payload: unknown) => void);
    };
  };

  const goToSheet = (index: number) => {
    if (destroyed || state.kind !== 'numbers') return;
    state.currentSheet = Math.max(0, Math.min(index, Math.max(state.sheetCount - 1, 0)));
    state.error = null;
    render();
    setStatus();
    loadSheet(state.currentSheet);
    emit('sheetchange', getState());
  };

  return {
    preview,
    refreshFonts() {
      if (destroyed || state.loading || !state.document) return;
      const top = container.scrollTop, left = container.scrollLeft;
      const grid = stage.querySelector<HTMLElement>('.xlsxv-grid');
      const gridTop = grid?.scrollTop ?? 0, gridLeft = grid?.scrollLeft ?? 0;
      refreshedRows = [...stage.querySelectorAll('table')].map(table => table.tBodies[0]?.rows.length ?? ROW_BATCH_SIZE);
      try { render(); } finally { refreshedRows = undefined; }
      container.scrollTop = top; container.scrollLeft = left;
      const nextGrid = stage.querySelector<HTMLElement>('.xlsxv-grid');
      if (nextGrid) { nextGrid.scrollTop = gridTop; nextGrid.scrollLeft = gridLeft; }
      for (const view of rowWindows) view.refresh();
      // The initial left-column window can briefly clamp the old horizontal offset.
      if (nextGrid) nextGrid.scrollLeft = gridLeft;
      emit('rendered', getState());
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unbindTouch();
      ++generation;
      listeners.clear();
      stopLoad();
      container.removeEventListener('scroll', handleScroll);
      container.ownerDocument.removeEventListener('scroll', handleScroll, true);
      container.ownerDocument.defaultView?.removeEventListener('scroll', handleScroll);
      worker?.destroy();
      worker = null;
      container.classList.remove('iworkv-root', 'is-loading', 'is-error');
      container.removeAttribute('data-status');
      container.innerHTML = '';
    },
    setScale,
    fit,
    goToPage(index: number) {
      if (destroyed) return;
      state.currentPage = Math.max(0, Math.min(index, Math.max(state.pageCount - 1, 0)));
      if (state.document && state.document.kind !== 'numbers') {
        visiblePages.clear();
        visiblePages.add(state.currentPage);
        syncMountedPages();
        scrollToPageCanvas(state.currentPage);
      } else {
        render();
      }
      emit('pagechange', getState());
    },
    goToSheet,
    next() {
      if (state.kind === 'numbers') {
        this.goToSheet(Math.min(state.currentSheet + 1, Math.max(state.sheetCount - 1, 0)));
      } else {
        this.goToPage(Math.min(state.currentPage + 1, Math.max(state.pageCount - 1, 0)));
      }
    },
    prev() {
      if (state.kind === 'numbers') {
        this.goToSheet(Math.max(0, state.currentSheet - 1));
      } else {
        this.goToPage(Math.max(0, state.currentPage - 1));
      }
    },
    getState,
    on
  };
}

// Blob reads and third-party source promises may not implement cancellation.
// Settle the caller promptly while still handling any late rejection.
function waitForLoad<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function numbersTableToSheet(table: TableItem, index: number, registry: MediaRegistry | null): { sheet: ParsedSheet; renderCell: SheetCellRenderer } {
  const sources = new WeakMap<ParsedCell, TableCell>();
  const merges: NonNullable<ParsedSheet['merges']> = [];
  const rows = new Map<number, ParsedSheet['rows'][number]>();
  for (const cell of table.cells) {
    if (cell.isMergedContinuation) {
      continue;
    }
    const rowIndex = cell.row + 1;
    const row = rows.get(rowIndex) ?? { index: rowIndex, cells: [] };
    const entry: ParsedCell = {
      ref: `${rowIndex}:${cell.column + 1}`,
      row: rowIndex,
      column: cell.column + 1,
      value: cell.textFrame.paragraphs
        .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
        .join('\n')
    };
    row.cells.push(entry); sources.set(entry, cell);
    rows.set(rowIndex, row);
    if (cell.rowSpan > 1 || cell.colSpan > 1) merges.push({ firstRow: rowIndex, lastRow: cell.row + cell.rowSpan,
      firstColumn: cell.column + 1, lastColumn: cell.column + cell.colSpan });
  }
  return { sheet: {
    id: table.id,
    name: `Table ${index + 1}`,
    rows: [...rows.values()].sort((left, right) => left.index - right.index),
    columnCount: Math.max(table.columns.length, 1),
    rowCount: Math.max(table.rows.length, 1),
    rowHeights: table.rows,
    columnWidths: table.columns,
    merges
  }, renderCell: (element, cell) => {
    const source = sources.get(cell);
    if (!source || !registry) return;
    element.replaceChildren(); element.classList.add('iworkv-rich-cell'); element.style.padding = '0';
    element.style.setProperty('--xlsxv-merge-padding-left', '0px');
    element.style.setProperty('--xlsxv-merge-padding-inline', '0px');
    element.style.setProperty('--xlsxv-merge-padding-block', '0px');
    const frame = source.textFrame;
    const text = renderTableCellContent(element, { ...source,
      fill: source.fill.type === 'picture' ? { type: 'none' } : source.fill,
      textFrame: { ...frame, verticalAlign: frame.verticalAlign ?? 'top', padding: frame.padding ?? { top: 4, right: 8, bottom: 4, left: 8 },
        paragraphs: frame.paragraphs.map(paragraph => paragraph.runs.some(run => run.fontSize != null) ? paragraph
          : { ...paragraph, runs: paragraph.runs.map(run => ({ ...run, fontSize: 12 })) }) }
    }, registry);
    if (source.fill.type === 'gradient') element.style.backgroundRepeat = 'no-repeat';
    if (source.fill.type !== 'picture' || !source.fill.mediaId) return;
    const image = document.createElement('img'); image.className = 'iworkv-cell-image';
    image.src = registry.getUrl(source.fill.mediaId); image.alt = ''; image.loading = 'lazy'; text.prepend(image);
  } };
}

function resolveSourceName(source: unknown): string | undefined {
  if (typeof source === 'string') {
    return extractSourceName(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return source.name;
  }

  return undefined;
}

function extractSourceName(path: string): string | undefined {
  const normalized = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) {
    return undefined;
  }

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function resolveVisibleViewport(container: HTMLElement): { top: number; bottom: number; height: number } {
  const ownerWindow = container.ownerDocument.defaultView;
  const containerRect = container.getBoundingClientRect();
  let top = ownerWindow ? 0 : containerRect.top;
  let bottom = ownerWindow ? ownerWindow.innerHeight : containerRect.bottom;

  for (let element: HTMLElement | null = container; element; element = element.parentElement) {
    const overflowY = ownerWindow?.getComputedStyle(element).overflowY ?? 'visible';
    if (!/^(auto|scroll|hidden|clip)$/.test(overflowY)) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }

  if (bottom <= top) {
    const fallbackTop = ownerWindow ? 0 : containerRect.top;
    const fallbackBottom = ownerWindow ? ownerWindow.innerHeight : containerRect.bottom;
    return {
      top: fallbackTop,
      bottom: fallbackBottom,
      height: Math.max(fallbackBottom - fallbackTop, 1)
    };
  }

  return { top, bottom, height: bottom - top };
}

function applyCanvasScale(shell: HTMLElement, width: number, height: number, scale: number): void {
  shell.style.width = `${width * scale}px`;
  shell.style.height = `${height * scale}px`;
  shell.style.position = 'relative';
  const inner = shell.firstElementChild as HTMLElement | null;
  if (!inner) {
    return;
  }
  inner.style.transform = `scale(${scale})`;
  inner.style.transformOrigin = 'top left';
}
