/// <reference lib="es2022.intl" />
import { MediaRegistry, renderSlideToElement, type ParsedPresentation, type SlideModel, type TextParagraph } from '@filens/core';
import type { IworkCanvasModel, PagesBodyTextSource, PagesTableMeasurement, ParsedIworkDocument } from '../types';

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

export function observeSavedPagesTableGrowth(
  content: HTMLElement, canvas: IworkCanvasModel, previous: ReadonlyMap<string, PagesTableMeasurement>,
  update: (measurements: Map<string, PagesTableMeasurement>) => void
): (() => void) | undefined {
  if (!canvas.bodyFlows?.some(([, , bottom]) => bottom != null)) return undefined;
  const elements = Array.from(content.querySelectorAll<HTMLElement>(':scope > .iworkv-body-flow'));
  const bodySources = new Map(canvas.savedBodyText?.map(([index, , source]) => [index, source]));
  const flows = canvas.bodyFlows.flatMap(([start, end, bottom], index) => {
    if (bottom == null || !elements[index]) return [];
    const items = canvas.slide.items.slice(start, end);
    const children = Array.from(elements[index].children);
    const tables = items.flatMap((item, offset) => {
      if (item.kind !== 'table' || !item.autoFitRows || item.transform.rotation) return [];
      const element = children[offset]?.querySelector('table');
      return element ? [{ item, element, offset }] : [];
    });
    return tables.length ? [{ start, bottom, items, children, tables }] : [];
  });
  if (!flows.length) return undefined;
  const measure = () => {
    const paper = content.getBoundingClientRect();
    const scale = paper.height / canvas.height;
    if (!content.isConnected || !Number.isFinite(scale) || scale <= 0) return;
    const measured = new Map<string, PagesTableMeasurement>();
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
        if (cutoff == null && element.getBoundingClientRect().top < boundary - 0.01 * scale) continue;
        overflow = offset;
        break;
      }
      if (overflow < 0) {
        const outside = boxes.find(({ box }) => box.bottom > boundary + 1.5 * scale);
        if (outside) overflow = outside.offset + 1;
      }
      const batch: Array<[string, PagesTableMeasurement]> = [];
      let owner: PagesTableMeasurement | undefined;
      for (const { item, element, offset, box } of boxes) {
        const tracked = previous.has(item.id);
        if (offset >= overflow && !tracked) continue;
        const height = box.height / scale;
        if (height <= 0 || (!tracked && height <= item.transform.height + 0.5)) continue;
        const rows = Array.from(element.tBodies[0]?.rows ?? [], row => row.getBoundingClientRect().height / scale);
        if (rows.length !== item.rows.length) continue;
        const result = { width: item.transform.width, height, rows };
        batch.push([item.id, result]);
        if (offset < overflow) owner = result;
      }
      const stable = batch.every(([id, current]) => samePagesTableGeometry(current, previous.get(id)));
      for (const [id, current] of batch) {
        // A rendered prefix no longer contains the clipped text, so keep its break until the geometry changes.
        const earlier = stable ? previous.get(id)?.textCutoff : undefined;
        const currentCutoff = current === owner ? cutoff : undefined;
        current.textCutoff = earlier == null ? currentCutoff : Math.min(earlier, currentCutoff ?? earlier);
        measured.set(id, current);
      }
    }
    if (measured.size) update(measured);
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return undefined;
  const observer = new ResizeObserver(measure);
  for (const { tables } of flows) for (const { element } of tables) observer.observe(element);
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
      if (node?.nodeType === 3 && node.textContent?.length === paragraph.runs[runIndex].text.length) {
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
