import { applyTableCellPaint, bindPreviewTouchGestures, MediaRegistry, previewContentKey, previewModelCache, previewPasswordErrorCode, renderTableCellContent, type TableItem } from '@filens/core';
import type { ParsedCell } from '@filens/xlsx';
import { addHiddenTrack, appendSheetRows, createSheetTable, ROW_BATCH_SIZE, COLUMN_BATCH_SIZE, sheetTracks, SheetRowWindow,
  type ParsedSheet, type SheetBlankCellRenderer, type SheetCellRenderer, type SheetRowMeasurements } from '@filens/xlsx/table';
import type {
  IworkFitMode,
  IworkTable,
  IworkTableCell,
  IworkViewerEventMap,
  IworkViewerEventName,
  IworkViewerInstance,
  IworkViewerOptions,
  IworkViewerState,
  PagesTableMeasurement,
  ParsedIworkDocument
} from '../types';
import { loadSourceBytes } from '../parser/load-source';
import { IworkWorkerClient } from '../worker/client';
import { blankCellPaint } from '../table-paint';
import { cellStrokeBorders, visibleStrokeRuns } from '../table-strokes';
import { createCanvasElement, createMediaRegistry, documentCanvases, fitSavedPagesText, observeSavedPagesTableGrowth, samePagesTableGeometry } from './render';

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
  let resizeFrame = 0;
  let pageShells: HTMLDivElement[] = [];
  const mountedPages = new Map<number, HTMLElement>();
  const tableWatchers = new Map<number, () => void>();
  const pagesTableMeasurements = new Map<string, PagesTableMeasurement>();
  let pagesLayoutPending = false;
  let pagesLayoutDirty = false;
  const visiblePages = new Set<number>();
  const sheetLoads = new Map<number, Promise<void>>();
  const rowWindows = new Set<SheetRowWindow>();
  let numbersView: { preview: HTMLDivElement; tabs: HTMLDivElement; grid?: HTMLDivElement } | undefined;
  let rowMeasurements = new WeakMap<TableItem, SheetRowMeasurements>();
  let refreshedTables: ({ rows: number; width: number; height: number } | undefined)[] | undefined;
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

  const clearTableWatchers = () => {
    for (const disconnect of tableWatchers.values()) disconnect();
    tableWatchers.clear();
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
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    if (scrollFrame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    clearRowWindows(); rowMeasurements = new WeakMap();
    clearTableWatchers();
    pagesTableMeasurements.clear();
    pagesLayoutPending = pagesLayoutDirty = false;
    stage.replaceChildren();
    stage.classList.remove('iworkv-numbers-stage');
    numbersView = undefined;
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
    clearTableWatchers();
    stage.classList.toggle('iworkv-numbers-stage', state.document?.kind === 'numbers');
    pageShells = [];
    mountedPages.clear();
    visiblePages.clear();
    if (state.document?.kind === 'numbers') {
      if (state.document.sheets.length) renderNumbers();
      return;
    }

    stage.replaceChildren();
    if (!state.document) {
      return;
    }

    const canvases = documentCanvases(state.document);
    if (!canvases.length) return;

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
    if (!numbersView) {
      // Keep sheet buttons in place while pending sheet and font updates render the grid.
      const preview = document.createElement('div');
      preview.className = 'xlsxv-preview';
      const tabs = document.createElement('div');
      tabs.className = 'xlsxv-sheet-tabs';
      tabs.dataset.previewControls = '';
      state.document.sheets.forEach((_, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'xlsxv-sheet-tab';
        button.addEventListener('click', () => goToSheet(index), { signal: loadController!.signal });
        tabs.appendChild(button);
      });
      preview.appendChild(tabs);
      stage.appendChild(preview);
      numbersView = { preview, tabs };
    }
    const view = numbersView;
    state.document.sheets.forEach((sheet, index) => {
      const button = view.tabs.children[index];
      button.classList.toggle('is-active', index === state.currentSheet);
      if (button.textContent !== sheet.name) button.textContent = sheet.name;
    });

    const grid = document.createElement('div');
    grid.className = 'xlsxv-grid';
    const tables = document.createElement('div');
    tables.className = 'iworkv-numbers-tables';
    const activeSheet = state.document.sheets[state.currentSheet];
    const renderedTables: (ReturnType<typeof numbersTableToSheet> & { body: HTMLTableSectionElement })[] = [];
    (activeSheet?.tables ?? []).forEach(({ item }, index) => {
      const { sheet, renderCell, renderBlankCell } = numbersTableToSheet(item, index, mediaRegistry);
      const { rows, columns } = sheetTracks(sheet);
      const previous = refreshedTables?.[index];
      const section = document.createElement('section');
      section.className = 'iworkv-numbers-table';
      if (renderBlankCell) section.classList.add('iworkv-numbers-source-borders');
      section.style.containIntrinsicBlockSize = `auto ${previous?.height || (Math.min(rows.count, ROW_BATCH_SIZE) + 1) * 26}px`;
      if (previous?.width) section.style.containIntrinsicInlineSize = `auto ${previous.width}px`;
      if ((activeSheet?.tables.length ?? 0) > 1) {
        const title = document.createElement('h3');
        title.className = 'iworkv-numbers-table-title';
        title.textContent = `Table ${index + 1}`;
        section.appendChild(title);
      }
      tables.appendChild(section);
      const windowed = options.virtual !== false && (rows.count > ROW_BATCH_SIZE || columns.count > COLUMN_BATCH_SIZE);
      if (windowed) {
        section.classList.add('is-windowed');
        const measurements = rowMeasurements.get(item) ?? { heights: new Map<number, number>() };
        rowMeasurements.set(item, measurements);
        rowWindows.add(new SheetRowWindow(sheet, grid, section, { renderCell, renderBlankCell, measurements }));
      } else {
        const rendered = Math.min(rows.count, previous?.rows ?? ROW_BATCH_SIZE);
        const table = createSheetTable(sheet, rendered ? rows.source(rendered) : 0, renderCell, renderBlankCell);
        section.appendChild(table);
        renderedTables.push({ sheet, body: table.tBodies[0], renderCell, renderBlankCell });
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
      for (const { sheet, body, renderCell, renderBlankCell } of renderedTables) {
        const renderedRows = body.rows.length;
        const { rows } = sheetTracks(sheet);
        if (renderedRows < rows.count) {
          appendSheetRows(body, sheet, rows.source(renderedRows + 1), rows.source(Math.min(renderedRows + ROW_BATCH_SIZE, rows.count)), renderCell, renderBlankCell);
        }
      }
    }, { passive: true, signal: renderController!.signal });

    if (view.grid) view.grid.replaceWith(grid);
    else view.preview.appendChild(grid);
    view.grid = grid;
    for (const rowWindow of rowWindows) rowWindow.refresh();
  };

  const requestPagesLayout = () => {
    const controller = loadController;
    if (state.document?.kind !== 'pages' || !controller) return;
    pagesLayoutDirty = true;
    if (pagesLayoutPending) return;
    pagesLayoutPending = true;
    // Mounting several visible pages can supply measurements in one pass.
    void Promise.resolve().then(async () => {
      const document = state.document;
      if (loadController !== controller || document?.kind !== 'pages') return;
      pagesLayoutDirty = false;
      const result = await getWorker().reflowPages(pagesTableMeasurements, workerHasDocument ? undefined : document);
      if (loadController !== controller) return;
      workerHasDocument = true;
      if (pagesLayoutDirty) return;

      const top = pageShells[state.currentPage]?.getBoundingClientRect().top;
      const saved = document.pages[state.currentPage]?.savedPageIndex;
      const corresponding = saved == null ? -1 : result.pages.findIndex(page => page.savedPageIndex === saved);
      state.document = { ...document, ...result };
      state.pageCount = result.pages.length;
      state.currentPage = corresponding >= 0 ? corresponding : Math.min(state.currentPage, state.pageCount - 1);
      state.warnings = result.warnings.slice();
      // The driver reapplies resolved fonts to the new page model before mounting it.
      emit('pagechange', getState());
      if (loadController !== controller) return;
      render();
      const shell = pageShells[state.currentPage];
      if (top != null && shell) container.scrollTop += shell.getBoundingClientRect().top - top;
      emit('rendered', getState());
    }).catch(() => {
      if (loadController === controller) workerHasDocument = false;
    }).finally(() => {
      if (loadController !== controller) return;
      pagesLayoutPending = false;
      if (pagesLayoutDirty) requestPagesLayout();
    });
  };

  const updatePagesTableMeasurements = (measurements: Map<string, PagesTableMeasurement>) => {
    let changed = false;
    for (const [id, measured] of measurements) {
      const previous = pagesTableMeasurements.get(id);
      if (samePagesTableGeometry(measured, previous) && previous?.textCutoff === measured.textCutoff) continue;
      pagesTableMeasurements.set(id, measured);
      changed = true;
    }
    if (changed) requestPagesLayout();
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
        tableWatchers.get(index)?.();
        tableWatchers.delete(index);
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
        const mounted = content as HTMLElement;
        mountedPages.set(index, mounted);
        const disconnect = observeSavedPagesTableGrowth(mounted, canvas, pagesTableMeasurements, updatePagesTableMeasurements);
        if (disconnect) tableWatchers.set(index, disconnect);
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

    const resize = () => {
      resizeFrame = 0;
      if (!state.document) {
        return;
      }
      if (state.fit === 'none') {
        for (const content of mountedPages.values()) fitSavedPagesText(content, state.scale);
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
    };
    resizeObserver = new ResizeObserver(() => {
      // Canvas and toolbar changes can resize the stage again after this notification.
      if (typeof requestAnimationFrame === 'undefined') { resize(); return; }
      if (!resizeFrame) resizeFrame = requestAnimationFrame(resize);
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
      .then(({ sheet, media }) => {
        if (state.document !== numbers) {
          return;
        }
        workerHasDocument = true;
        if (media) Object.assign(numbers.media, media);
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
      const url = typeof source === 'string' ? new URL(source, container.ownerDocument.baseURI) : undefined;
      const rangeSource = url && /^https?:$/.test(url.protocol) ? url.href
        : typeof Blob !== 'undefined' && source instanceof Blob && source.size > 128 * 1024 ? source : undefined;
      const input = rangeSource ?? await waitForLoad(loadSourceBytes(source, { signal: controller.signal }), controller.signal);
      if (controller.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const sourceName = resolveSourceName(source);
      // Hash owned, buffered ZIP inputs. Ranged and protected sources remain session-local.
      const key = ArrayBuffer.isView(input) && previewOptions.cache !== false && previewOptions.password === undefined
        && typeof source !== 'string' && input[0] === 0x50 && input[1] === 0x4b
        ? await waitForLoad(previewContentKey(input, `iwork-v2:${JSON.stringify([options.type, sourceName])}`, controller.signal), controller.signal)
        : undefined;
      let document = previewModelCache.get<ParsedIworkDocument>(key);
      if (!document) {
        document = await waitForLoad(getWorker().parse(input, options.type, sourceName, previewOptions.password), controller.signal);
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
      if (previewPasswordErrorCode(normalized)) throw normalized;
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
      if (state.document.kind === 'pages' && pagesTableMeasurements.size) {
        pagesTableMeasurements.clear();
        requestPagesLayout();
      }
      const top = container.scrollTop, left = container.scrollLeft;
      const grid = stage.querySelector<HTMLElement>('.xlsxv-grid');
      const gridTop = grid?.scrollTop ?? 0, gridLeft = grid?.scrollLeft ?? 0;
      // Offscreen sections use their last dimensions until the browser lays out the rebuilt table.
      refreshedTables = [...stage.querySelectorAll<HTMLElement>('.iworkv-numbers-table')].map(section => {
        if (section.classList.contains('is-windowed')) return undefined;
        const { width, height } = section.getBoundingClientRect();
        return { rows: section.querySelector('table')?.tBodies[0]?.rows.length ?? ROW_BATCH_SIZE, width, height };
      });
      try { render(); } finally { refreshedTables = undefined; }
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

function numbersTableToSheet(table: IworkTable['item'], index: number, registry: MediaRegistry | null):
  { sheet: ParsedSheet; renderCell: SheetCellRenderer; renderBlankCell?: SheetBlankCellRenderer } {
  const { blankCellStyles, strokeEdges } = table;
  const renderBlankCell: SheetBlankCellRenderer | undefined = blankCellStyles ? (element, row, column) => {
    const paint = blankCellPaint(blankCellStyles, row - 1, column - 1);
    const authored = strokeEdges && cellStrokeBorders(strokeEdges, row - 1, column - 1);
    if (authored) paint.borders = { ...paint.borders, ...authored };
    if (paint.fill.type === 'picture') element.style.position = 'relative';
    if (paint.fill.pictureFit) element.classList.add('iworkv-picture-fill');
    applyTableCellPaint(element, paint, registry ?? undefined);
  } : undefined;
  const sources = new WeakMap<ParsedCell, IworkTableCell>();
  const merges: NonNullable<ParsedSheet['merges']> = [];
  const rows = new Map<number, ParsedSheet['rows'][number]>();
  const hiddenRanges = (indexes?: readonly number[]) => {
    if (!indexes?.length) return undefined;
    const ranges: { first: number; last: number }[] = [];
    for (const index of indexes) addHiddenTrack(ranges, index + 1);
    return ranges;
  };
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
    hiddenRows: hiddenRanges(table.hiddenRows),
    hiddenColumns: hiddenRanges(table.hiddenColumns),
    rowHeights: table.rows,
    columnWidths: table.columns,
    merges,
    mergeBorderRuns: strokeEdges && ((range, side, first, last) => {
      if (side === 'top' || side === 'bottom') return visibleStrokeRuns(strokeEdges.horizontal,
        side === 'top' ? range.firstRow - 1 : range.lastRow, first, last);
      return visibleStrokeRuns(strokeEdges.vertical, side === 'left' ? range.firstColumn - 1 : range.lastColumn, first, last);
    })
  }, renderBlankCell, renderCell: (element, cell) => {
    const source = sources.get(cell);
    if (!source || !registry) return;
    element.replaceChildren(); element.classList.add('iworkv-rich-cell'); element.style.padding = '0';
    element.style.setProperty('--xlsxv-merge-padding-left', '0px');
    element.style.setProperty('--xlsxv-merge-padding-inline', '0px');
    element.style.setProperty('--xlsxv-merge-padding-block', '0px');
    const frame = source.textFrame;
    const inlinePicture = source.fill.type === 'picture' && !source.fill.pictureFit;
    if (source.fill.pictureFit) {
      element.classList.add('iworkv-picture-fill');
      element.style.position = 'relative';
    }
    const text = renderTableCellContent(element, { ...source,
      fill: inlinePicture ? { type: 'none' } : source.fill,
      textFrame: { ...frame, verticalAlign: frame.verticalAlign ?? 'top', padding: frame.padding ?? { top: 4, right: 8, bottom: 4, left: 8 },
        paragraphs: frame.paragraphs.map(paragraph => paragraph.runs.some(run => run.fontSize != null) ? paragraph
          : { ...paragraph, runs: paragraph.runs.map(run => ({ ...run, fontSize: 12 })) }) }
    }, registry);
    if (frame.accounting) text.classList.add('iworkv-accounting');
    if (source.fill.type === 'gradient') element.style.backgroundRepeat = 'no-repeat';
    if (!inlinePicture || !source.fill.mediaId) return;
    const image = document.createElement('img'); image.className = 'iworkv-cell-image';
    image.src = registry.getUrl(source.fill.mediaId); image.alt = ''; image.loading = 'lazy'; text.prepend(image);
    if (source.fill.pictureTint) void registry.getTintedPicture(source.fill.mediaId, source.fill.pictureTint).then(picture => {
      if (picture) image.src = picture.url;
    });
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
  fitSavedPagesText(inner, scale);
}
