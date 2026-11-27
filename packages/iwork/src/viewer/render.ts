/// <reference lib="es2022.intl" />
import { MediaRegistry, renderSlideToElement, type ParsedPresentation, type SlideModel, type TextParagraph } from '@filens/core';
import type { IworkCanvasModel, PagesBodyTextSource, PagesLayoutMeasurements, PagesMeasuredSourceRows, PagesTableCellSource, PagesTableMeasurement,
  ParsedIworkDocument } from '../types';

const DEFAULT_THEME: ParsedPresentation['theme'] = {
  colors: {},
  fonts: {}
};

export function createMediaRegistry(document: ParsedIworkDocument): MediaRegistry {
  return new MediaRegistry(presentationForDocument(document));
}

export function documentCanvases(document: ParsedIworkDocument): IworkCanvasModel[] {
  if (document.kind === 'key') {
    return document.slides;
  }
  if (document.kind === 'pages') {
    return document.pages.map((page) => page.canvas);
  }
  return document.sheets.map((sheet) => sheet.canvas);
}

export function createCanvasElement(documentLike: Document, document: ParsedIworkDocument, canvas: IworkCanvasModel, registry?: MediaRegistry): HTMLElement {
  const presentation = presentationForCanvas(document, canvas.slide);
  const activeRegistry = registry ?? new MediaRegistry(presentation);
  const shell = documentLike.createElement('div');
  shell.className = document.kind === 'numbers' ? 'iworkv-page-shell iworkv-sheet-shell' : 'iworkv-page-shell';
  const content = renderSlideToElement(canvas.slide, presentation, {
    mediaRegistry: activeRegistry
  });
  for (const [index, bottom] of canvas.savedBodyText ?? []) {
    (content.children[index] as HTMLElement).dataset.iworkTextBottom = String(bottom);
  }
  if (canvas.bodyFlows?.length) renderPagesBodyFlows(content, canvas);
  shell.appendChild(content);
  return shell;
}

const MIN_SAVED_TEXT_SCALE = 0.8;

export function fitSavedPagesText(content: HTMLElement, scale: number): void {
  const items = content.querySelectorAll<HTMLElement>('[data-iwork-text-bottom]');
  if (!items.length || scale <= 0) return;
  const paper = content.getBoundingClientRect();
  if (paper.height <= 0) return;

  for (const item of items) {
    const frame = item.querySelector<HTMLElement>(':scope > .pptxv-text-frame');
    if (!frame) continue;
    const box = item.getBoundingClientRect();
    const bottom = Math.min(box.bottom, paper.top + Number(item.dataset.iworkTextBottom) * scale);
    delete item.dataset.iworkTextBottom;
    if (bottom <= box.top || box.width <= 0) continue;

    const range = content.ownerDocument.createRange();
    range.selectNodeContents(frame);
    const text = range.getBoundingClientRect();
    const inset = (box.top - text.top) / scale;
    if (text.bottom <= bottom + 0.25 * scale && inset <= 2) continue;
    if (inset > 0.5) frame.style.paddingTop = `${(Number.parseFloat(frame.style.paddingTop) || 0) + inset}px`;
    const fits = () => range.getBoundingClientRect().bottom <= bottom + 0.25 * scale;
    if (fits()) continue;

    const originalWidth = frame.style.width;
    const setScale = (textScale: number) => {
      frame.style.width = `${100 / textScale}%`;
      frame.style.transform = `scale(${textScale})`;
    };
    frame.style.height = 'auto';
    frame.style.transformOrigin = 'top left';
    setScale(MIN_SAVED_TEXT_SCALE);
    if (fits()) {
      // Widen the unscaled frame as its text shrinks so wrapped lines can reflow.
      let low = MIN_SAVED_TEXT_SCALE;
      let high = 1;
      for (let iteration = 0; iteration < 6; iteration += 1) {
        const candidate = (low + high) / 2;
        setScale(candidate);
        if (fits()) low = candidate;
        else high = candidate;
      }
      setScale(low);
      continue;
    }

    // Keep heavily overflowing text at its original size and let readers scroll it.
    frame.style.width = originalWidth;
    frame.style.height = `${(bottom - box.top) / scale}px`;
    frame.style.transform = '';
    frame.style.transformOrigin = '';
    frame.style.overflowY = 'auto';
    const overhang = (range.getBoundingClientRect().bottom - box.top) / scale - frame.scrollHeight;
    if (overhang > 0) {
      frame.style.paddingBottom = `${(Number.parseFloat(frame.style.paddingBottom) || 0) + Math.ceil(overhang)}px`;
    }
    frame.tabIndex = 0;
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', 'Page text');
    frame.addEventListener('keydown', event => {
      if (['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation();
    });
  }
}

function renderPagesBodyFlows(content: HTMLElement, canvas: IworkCanvasModel): void {
  const elements = Array.from(content.children) as HTMLElement[];
  const items = canvas.slide.items;
  for (const [start, end] of canvas.bodyFlows ?? []) {
    const flow = content.ownerDocument.createElement('div');
    flow.className = 'iworkv-body-flow';
    let previousBottom = items[start].transform.y;
    flow.style.top = `${previousBottom}px`;
    content.insertBefore(flow, elements[start]);
    for (let index = start; index < end; index += 1) {
      const { y, height } = items[index].transform;
      const element = elements[index];
      element.style.position = 'relative';
      element.style.top = 'auto';
      element.style.marginTop = `${y - previousBottom}px`;
      flow.appendChild(element);
      previousBottom = y + Math.max(height, 1);
    }
  }
}

export interface PagesCellProbe {
  width: number;
  initialHeight: number;
  height: number;
  heightScale: number;
  frame: HTMLElement;
}

function pagesCellTextHeight(frame: HTMLElement, scale: number): number {
  return Array.from(frame.children).reduce((height, paragraph) => {
    const style = getComputedStyle(paragraph);
    return height + paragraph.getBoundingClientRect().height / scale + (parseFloat(style.marginTop) || 0) +
      (parseFloat(style.marginBottom) || 0);
  }, 0);
}

function measurePagesCellProbe(probe: PagesCellProbe, frame: HTMLElement, scale: number): number {
  const sample = probe.frame;
  frame.parentElement!.append(sample);
  try {
    return pagesCellTextHeight(sample, scale);
  } finally {
    sample.remove();
  }
}

export function observePagesTableGrowth(
  content: HTMLElement, canvas: IworkCanvasModel, previous: PagesLayoutMeasurements, probes: Map<string, Map<number, PagesCellProbe>>,
  update: (measurements: PagesLayoutMeasurements) => void
): (() => void) | undefined {
  if (!canvas.bodyFlows?.length) return undefined;
  const elements = Array.from(content.querySelectorAll<HTMLElement>(':scope > .iworkv-body-flow'));
  const bodySources = new Map(canvas.savedBodyText?.map(([index, , source]) => [index, source]));
  const tableSources = new Map(canvas.tableSourceRows);
  const flows = canvas.bodyFlows.flatMap(([start, end, bottom], index) => {
    if (bottom == null || !elements[index]) return [];
    const items = canvas.slide.items.slice(start, end);
    const children = Array.from(elements[index].children);
    const tables = items.flatMap((item, offset) => {
      if (item.kind !== 'table' || item.transform.rotation) return [];
      const source = tableSources.get(start + offset);
      if (source === null || (!item.autoFitRows && !source?.cells?.length)) return [];
      const element = children[offset]?.querySelector('table');
      if (!element) return [];
      const cells: Array<{ frame: HTMLElement; cell: HTMLTableCellElement; source: PagesTableCellSource }> = [];
      if (source?.cells) {
        const columnsByRow = new Map<number, number[]>(source.cells.map(({ row }) => [row, []]));
        for (const cell of item.cells) if (!cell.isMergedContinuation) columnsByRow.get(cell.row)?.push(cell.column);
        for (const columns of columnsByRow.values()) columns.sort((a, b) => a - b);
        for (const cellSource of source.cells) {
          const index = columnsByRow.get(cellSource.row)!.indexOf(cellSource.column);
          const cell = element.tBodies[0]?.rows[cellSource.row]?.cells[index];
          const frame = cell?.querySelector<HTMLElement>(':scope > .pptxv-text-frame');
          if (frame && cell) cells.push({ frame, cell, source: cellSource });
        }
      }
      return [{ item, element, offset, source, cells }];
    });
    return tables.length ? [{ start, bottom, items, children, tables }] : [];
  });
  if (!flows.length) return undefined;
  const measure = () => {
    const paper = content.getBoundingClientRect();
    const scale = paper.height / canvas.height;
    if (!content.isConnected || !Number.isFinite(scale) || scale <= 0) return;
    const measured = new Map<string, PagesTableMeasurement>();
    const measuredRows = new Map<string, PagesMeasuredSourceRows>();
    for (const { start, bottom, items, children, tables } of flows) {
      const boundary = paper.top + bottom * scale;
      const boxes = tables.map(table => ({ ...table, box: table.element.getBoundingClientRect() }));
      const firstGrowth = boxes.find(({ item, box }) => box.height / scale > item.transform.height + 0.5);
      let overflow = -1;
      let cutoff: number | undefined;
      for (let offset = (firstGrowth?.offset ?? items.length) + 1; offset < items.length; offset += 1) {
        const item = items[offset];
        if (item.kind !== 'text') continue;
        const element = children[offset];
        const source = bodySources.get(start + offset);
        const frame = element.querySelector('.pptxv-text-frame');
        if (source && frame) cutoff = findClippedPagesText(frame, item.textFrame.paragraphs, source, boundary + 0.25 * scale);
        if (cutoff == null && element.getBoundingClientRect().top < boundary - 0.01 * scale) {
          if (!firstGrowth?.source || !frame) continue;
          const range = content.ownerDocument.createRange();
          range.selectNodeContents(frame);
          if (range.getBoundingClientRect().bottom <= boundary + 0.25 * scale) continue;
        }
        overflow = offset;
        break;
      }
      if (overflow < 0) {
        const outside = boxes.find(({ box }) => box.bottom > boundary + 1.5 * scale);
        if (outside) overflow = outside.offset + 1;
      }
      const batch: Array<[string, PagesTableMeasurement]> = [];
      let owner: PagesTableMeasurement | undefined;
      for (const { item, element, offset, box, source, cells } of boxes) {
        const width = item.transform.width;
        const affected = offset < overflow || box.bottom > boundary + 1.5 * scale;
        const knownSource = source && previous.sourceRows.get(source.tableId);
        const knownRows = knownSource && Math.abs(knownSource.width - width) <= 0.5 ? knownSource.heights : undefined;
        if (source && cells.length) {
          let tableProbes = probes.get(source.tableId);
          const cellScales = new Map<number, number>();
          for (const { frame, cell, source: cellSource } of cells) {
            const { cell: cellIndex, estimatedHeight } = cellSource;
            const actual = pagesCellTextHeight(frame, scale);
            if (actual <= 0) continue;
            const cellBounds = cell.getBoundingClientRect();
            const cutoff = Math.min(boundary, cellBounds.bottom) + scale;
            const range = frame.ownerDocument.createRange();
            range.selectNodeContents(frame);
            const clipped = Array.from(range.getClientRects()).some(line => line.bottom > cutoff);
            let probe = tableProbes?.get(cellIndex);
            if (!probe || Math.abs(probe.width - width) > 0.5) {
              const sample = frame.cloneNode(true) as HTMLElement;
              Object.assign(sample.style, { position: 'absolute', inset: '0 auto auto 0', visibility: 'hidden',
                height: 'auto', width: getComputedStyle(frame).width });
              sample.setAttribute('aria-hidden', 'true');
              probe = { width, initialHeight: actual, height: actual, heightScale: 1, frame: sample };
              if (!tableProbes) probes.set(source.tableId, tableProbes = new Map());
              tableProbes.set(cellIndex, probe);
            } else {
              // Remeasure the same text so changes in wrapping after pagination cannot look like a font change.
              const height = measurePagesCellProbe(probe, frame, scale);
              if (height > 0 && Math.abs(height - probe.height) > 0.5) {
                if (height < probe.height || clipped || affected) {
                  probe.heightScale = Math.max(1, Math.ceil((height - 0.5) / probe.initialHeight * 16) / 16);
                }
                probe.height = height;
              }
            }
            if (clipped && actual > estimatedHeight * probe.heightScale + 1) {
              probe.heightScale = Math.ceil(actual / estimatedHeight * 16) / 16;
            }
            cellScales.set(cellIndex, probe.heightScale);
          }
          if (cellScales.size) {
            const result: PagesMeasuredSourceRows = measuredRows.get(source.tableId) ?? { width, heights: new Map() };
            result.cellScales ??= new Map();
            for (const [cell, heightScale] of cellScales) {
              result.cellScales.set(cell, Math.max(result.cellScales.get(cell) ?? 1, heightScale));
            }
            measuredRows.set(source.tableId, result);
          }
        }
        // Row heights can include shared space from a split merge.
        if (!item.autoFitRows || source?.rows.some((row, index) => index >= source.repeatedHeaders && row < 0)) continue;
        const exact = source && previous.tables.get(source.tableId);
        const exactRows = exact && Math.abs(exact.width - width) <= 0.5 ? exact.rows : undefined;
        const knownRow = (row: number) => knownRows?.has(row) || (exactRows != null && row >= 0 && row < exactRows.length);
        const tracked = source ? source.rows.some(knownRow) : previous.tables.has(item.id);
        if (!affected && !tracked) continue;
        const height = box.height / scale;
        if (height <= 0 || (!tracked && height <= item.transform.height + 0.5)) continue;
        // Normalize the float error introduced by the scaled DOM rectangle.
        const rows = Array.from(element.tBodies[0]?.rows ?? [], row => Math.round(row.getBoundingClientRect().height / scale * 64) / 64);
        if (rows.length !== item.rows.length) continue;
        if (source && !(source.savedPartition && source.tableId === item.id)) {
          const result = measuredRows.get(source.tableId) ?? { width, heights: new Map() };
          source.rows.forEach((row, index) => {
            if (row >= 0 && (affected || knownRow(row))) result.heights.set(row, rows[index]);
          });
          if (result.heights.size) measuredRows.set(source.tableId, result);
          continue;
        }
        const result = { width, height: source?.savedPartition ? rows.reduce((sum, row) => sum + row, 0) : height, rows };
        batch.push([item.id, result]);
        if (offset < overflow) owner = result;
      }
      const stable = batch.every(([id, current]) => samePagesTableGeometry(current, previous.tables.get(id)));
      for (const [id, current] of batch) {
        // A rendered prefix no longer contains the clipped text, so keep its break until the geometry changes.
        const earlier = stable ? previous.tables.get(id)?.textCutoff : undefined;
        const currentCutoff = current === owner ? cutoff : undefined;
        current.textCutoff = earlier == null ? currentCutoff : Math.min(earlier, currentCutoff ?? earlier);
        measured.set(id, current);
      }
    }
    if (measured.size || measuredRows.size) update({ tables: measured, sourceRows: measuredRows });
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return undefined;
  const observer = new ResizeObserver(measure);
  for (const { tables } of flows) for (const { element, cells } of tables) {
    observer.observe(element);
    for (const { frame } of cells) for (const paragraph of frame.children) observer.observe(paragraph);
  }
  return () => observer.disconnect();
}

export function samePagesTableGeometry(current: PagesTableMeasurement, previous?: PagesTableMeasurement): boolean {
  return !!previous && Math.abs(previous.width - current.width) <= 0.25 && Math.abs(previous.height - current.height) <= 0.25 &&
    previous.rows.length === current.rows.length && previous.rows.every((height, index) => Math.abs(height - current.rows[index]) <= 0.25);
}

function findClippedPagesText(
  frame: Element, paragraphs: TextParagraph[], sources: PagesBodyTextSource[], bottom: number
): number | undefined {
  const range = frame.ownerDocument.createRange();
  for (const [index, paragraph] of paragraphs.entries()) {
    const element = frame.children[index];
    const source = sources[index];
    if (!element || !source) break;
    range.selectNodeContents(element);
    if (range.getBoundingClientRect().bottom <= bottom) continue;

    const runs = Array.from(element.children).filter(child => !child.classList.contains('pptxv-run--bullet'));
    if (runs.length !== paragraph.runs.length) return pagesSourceTextOffset(source, 0);
    let length = 0;
    const ends = paragraph.runs.map(run => length += run.text.length);
    let low = 0, high = length;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      const runIndex = ends.findIndex(end => end >= middle);
      const run = runs[runIndex];
      const node = run.firstChild;
      if (node?.nodeType === Node.TEXT_NODE && node.textContent?.length === paragraph.runs[runIndex].text.length) {
        range.setEnd(node, middle - (ends[runIndex - 1] ?? 0));
      } else range.setEndAfter(run);
      if (range.getBoundingClientRect().bottom <= bottom) low = middle;
      else high = middle - 1;
    }
    if (low === length && length > 0) continue;
    const text = paragraph.runs.map(run => run.text).join('');
    const segment = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(text).containing(low) : undefined;
    const utf16 = text.charCodeAt(low);
    const offset = segment?.index ?? (utf16 >= 0xdc00 && utf16 <= 0xdfff && low > 0 ? low - 1 : low);
    return pagesSourceTextOffset(source, offset);
  }
  return undefined;
}

function pagesSourceTextOffset(source: PagesBodyTextSource, offset: number): number {
  const visible = source.visibleStart + offset;
  let delta = 0;
  for (const marker of source.markers ?? []) {
    if (visible < marker.offset + delta) break;
    // A rendered page field or attachment can span several characters at one source index.
    if (visible < marker.offset + 1 + marker.delta) return source.start + marker.offset;
    delta = marker.delta;
  }
  return source.start + visible - delta;
}

function presentationForCanvas(document: ParsedIworkDocument, slide: SlideModel): ParsedPresentation {
  if (document.kind === 'key') {
    return {
      ...document.presentation,
      slides: [slide]
    };
  }

  return {
    size: {
      width: slide.width,
      height: slide.height
    },
    theme: DEFAULT_THEME,
    slides: [slide],
    media: document.media,
    warnings: document.warnings.slice()
  };
}

function presentationForDocument(document: ParsedIworkDocument): ParsedPresentation {
  if (document.kind === 'key') {
    return document.presentation;
  }

  return {
    size: {
      width: 1,
      height: 1
    },
    theme: DEFAULT_THEME,
    slides: documentCanvases(document).map((canvas) => canvas.slide),
    media: document.media,
    warnings: document.warnings.slice()
  };
}
