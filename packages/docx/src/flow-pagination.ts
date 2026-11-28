import { columnCount, docxHeaderFooterType, nextDocxPageNumber, renderDocxFootnoteColumns, type createDocxPagination,
  type DocxElement, type DocxMeasuredPages, type HeaderFooterType, type PageSection } from './pagination';
import { measureParagraphLines, textGeometry, type FootnoteSpace } from './paragraph-lines';
import type { NotePart } from './notes';

type DocxFlowArea = {
  elements: DocxElement[];
  columns: number;
  firstColumn?: HTMLElement;
  balance?: boolean;
  section: PageSection;
};
export type DocxFlowAreas = Map<HTMLElement, DocxFlowArea>;
export type DocxPageFrames = {
  number: number;
  first?: PageSection;
  evenAndOdd: boolean;
  templates?: Map<PageSection['sectProps'], Partial<Record<HeaderFooterType, HTMLElement>>>;
};
type TableGrid = { width: number; columns: number[] };
type FlowEntry = { source: DocxElement; node: HTMLElement };
type FlowUnit = {
  source: DocxElement;
  top: number;
  bottom: number;
  repeatedHeight: number;
  paragraph?: HTMLElement;
  rowEnd?: number;
  table?: DocxElement;
  grid?: TableGrid;
};
type FlowRules = Pick<ReturnType<typeof createDocxPagination>, 'keepWithNext' | 'keepLines' | 'widowControl'>;
type FlowCursor = { index: number; offset?: number; row?: DocxElement };
type Footnotes = { reserve: FootnoteSpace; probe?: HTMLOListElement };
type ColumnSlice = { start: FlowCursor; remainder?: HTMLElement; layouts: Map<DocxElement, FlowUnit[][]> };
type PageFit = { noteIds: string[]; required: number; following?: unknown };

const footnoteIds = (node: Element) => Array.from(node.querySelectorAll<HTMLElement>('sup[data-docx-footnote]'), ref => ref.dataset.docxFootnote!);

function flowPlan() {
  return {
    before: new Map<DocxElement, 'page' | 'columnOverflow'>(),
    tables: new Map<DocxElement, TableGrid>(),
    lines: new Map<DocxElement, { cuts: number[]; breakAfter: 'page' | 'columnOverflow' }>(),
    longFootnotes: new Set<string>()
  };
}
type FlowPlan = ReturnType<typeof flowPlan>;

function appendPage(plan: FlowPlan, part: FlowPlan): void {
  for (const [source, value] of part.before) plan.before.set(source, value);
  for (const [source, value] of part.tables) plan.tables.set(source, value);
  for (const [source, value] of part.lines) {
    const leading = plan.lines.get(source);
    if (leading) leading.cuts.push(...value.cuts);
    else plan.lines.set(source, value);
  }
}

function fitPage<T extends PageFit>(height: number, reserve: FootnoteSpace, layoutAt: (cap: number) => T): T {
  let low = 0, high = height, cap = height;
  let first: T | undefined, best: T | undefined;
  // Reserve the notes from each candidate's actual page content.
  for (;;) {
    const layout = layoutAt(cap);
    first ??= layout;
    const room = height - reserve(layout.noteIds);
    if (Math.max(cap, layout.required) <= room + 0.5 || (cap === height && !layout.noteIds.length)) {
      best = layout;
      if (!layout.following || (room <= cap + 0.5 && layout.noteIds.join(',') === first.noteIds.join(','))) break;
      low = cap;
    } else high = cap;
    if (high - low <= 0.5) break;
    cap = room > low && room < high - 0.5 ? room : (low + high) / 2;
  }
  return best ?? first!;
}

export function recordDocxFlow(areas: DocxFlowAreas, article: HTMLElement, section: PageSection): void {
  const add = (node: HTMLElement, elements: DocxElement[], columns: number, firstColumn?: HTMLElement, balance?: boolean) => {
    if (elements.length && elements.every(element => element.type === 'paragraph' || element.type === 'table')) {
      areas.set(node, { elements, columns, firstColumn, balance, section });
    }
  };
  if (section.columnParts) {
    const nodes = article.querySelectorAll<HTMLElement>(':scope > div:not([aria-hidden])');
    section.columnParts.forEach((elements, index) => add(nodes[index], elements, 0));
  } else if (article.style.display === 'grid') {
    add(article, section.elements, columnCount(section.sectProps), article.firstElementChild as HTMLElement, section.balanceColumns);
  } else if (section.sectProps.columns?.equalWidth !== false) {
    add(article, section.elements, columnCount(section.sectProps));
  }
}

function flowEntries(article: HTMLElement, elements: DocxElement[]): FlowEntry[] {
  if (article.children.length !== elements.length) return [];
  const entries = elements.map((source, index) => ({ source, node: article.children[index] as HTMLElement }));
  return entries.every(({ source, node }) => node.localName === (source.type === 'table' ? 'table' : 'p')) ? entries : [];
}

function footerHeight(page: HTMLElement): number {
  const footer = page.querySelector(':scope > footer');
  if (!footer) return 0;
  const style = getComputedStyle(footer);
  return Math.max(0, footer.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom));
}

function bodyHeight(page: HTMLElement, first: HTMLElement): number {
  const style = getComputedStyle(page);
  return parseFloat(style.minHeight) + page.getBoundingClientRect().top - first.getBoundingClientRect().top
    - parseFloat(style.paddingBottom) - footerHeight(page);
}

function columnWidths(article: HTMLElement, firstColumn?: HTMLElement): string[] {
  return firstColumn ? getComputedStyle(article).gridTemplateColumns.split(/\s+/).filter((_, index) => index % 2 === 0) : [''];
}

function measureSharedPage(page: HTMLElement, areas: DocxFlowAreas, rules: FlowRules, plan: FlowPlan,
  frames: DocxPageFrames, number: number): { extraPages: number; number: number } {
  const blocks = page.querySelectorAll<HTMLElement>(':scope > article, :scope > ol[data-docx-endnotes]');
  const height = bodyHeight(page, blocks[0]);
  let extraPages = 0;
  if (!(height > 0)) return { extraPages, number };
  const list = page.querySelector<HTMLOListElement>(':scope > ol[data-docx-footnotes]');
  if (list || frames.templates) return measureSharedPages(page, blocks, list, height, areas, rules, plan, frames, number);
  let used = 0;
  for (const article of blocks) {
    if (article.localName === 'ol') {
      const box = blockBox(article);
      used += box.bottom - box.top;
      continue;
    }
    const area = areas.get(article);
    const box = article.getBoundingClientRect();
    if (!area || (!area.balance && used + box.height <= height + 0.5)) {
      used += box.height;
      continue;
    }
    const node = area.firstColumn ?? article;
    const entries = flowEntries(node, area.elements);
    const widths = columnWidths(article, area.firstColumn);
    if (!entries.length || widths.length !== area.columns) {
      used += box.height;
      continue;
    }
    const layout = measureColumns(node, entries, widths, node.getBoundingClientRect().top, height,
      rules, plan, area.balance, undefined, used);
    if (!layout) continue;
    used = layout.used;
    extraPages += layout.extraPages;
    if (layout.startedNextPage) number = nextDocxPageNumber(number, area.section.sectProps, area.section.startsSection) - 1;
    number += layout.extraPages;
  }
  return { extraPages, number };
}

function usePageFrame(page: HTMLElement, frame: HTMLElement): () => void {
  const originalStyle = page.style.cssText;
  const header = page.querySelector(':scope > header'), footer = page.querySelector(':scope > footer');
  const nextHeader = frame.querySelector(':scope > header')?.cloneNode(true);
  const nextFooter = frame.querySelector(':scope > footer')?.cloneNode(true);
  for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
    page.style[side] = frame.style[side];
  }
  header?.remove();
  footer?.remove();
  if (nextHeader) page.prepend(nextHeader);
  if (nextFooter) page.append(nextFooter);
  return () => {
    page.style.cssText = originalStyle;
    if (nextHeader) page.removeChild(nextHeader);
    if (nextFooter) page.removeChild(nextFooter);
    if (header) page.prepend(header);
    if (footer) page.append(footer);
  };
}

function measureSharedPages(page: HTMLElement, blocks: NodeListOf<HTMLElement>, list: HTMLOListElement | null,
  height: number, areas: DocxFlowAreas, rules: FlowRules, plan: FlowPlan, frames: DocxPageFrames, number: number) {
  const flows = Array.from(blocks, article => {
    const area = areas.get(article);
    if (!area) return undefined;
    const node = area.firstColumn ?? article;
    const entries = flowEntries(node, area.elements);
    const widths = columnWidths(article, area.firstColumn);
    if (entries.length && widths.length === area.columns) {
      return { article, node, entries, widths, area, width: article.getBoundingClientRect().width, layouts: new Map<DocxElement, FlowUnit[][]>() };
    }
  });
  let extraPages = 0;
  if (!flows.some(Boolean) || flows.some((flow, i) => !flow && blocks[i].childElementCount && blocks[i].localName === 'article')) {
    return { extraPages, number };
  }
  const measureEndnotes = () => Array.from(blocks, block => {
    if (block.localName !== 'ol') return 0;
    const { top, bottom } = blockBox(block);
    return bottom - top;
  });

  const originalStyle = list?.style.cssText, originalDirection = list?.dir;
  const noteLayouts = new Map<string, Footnotes>();
  const notesFor = (props?: PageSection['sectProps']) => {
    if (!list) return;
    if (props) renderDocxFootnoteColumns(list, props);
    const key = [list.getBoundingClientRect().width, height, list.style.columnCount, list.style.columnGap, list.dir].join(',');
    let notes = noteLayouts.get(key);
    if (!notes) {
      notes = measureFootnotes(list, page, height, plan.longFootnotes, true);
      noteLayouts.set(key, notes);
    }
    list.style.cssText = originalStyle!;
    list.dir = originalDirection!;
    return notes;
  };
  const first = flows.findIndex(Boolean);
  type Cursor = { block: number; start: FlowCursor; remainder?: HTMLElement };
  let start: Cursor | undefined = { block: first, start: { index: 0 } };
  let noteHeights = measureEndnotes();
  let currentFrame: HTMLElement | undefined, restoreFrame: (() => void) | undefined;
  try {
    while (start) {
      const from: Cursor = start;
      const section = flows[from.block]!.area.section;
      const startsSection = section.startsSection && !from.start.index && !from.start.offset && !from.start.row;
      if (extraPages) number = nextDocxPageNumber(number, section.sectProps, startsSection);
      if (frames.templates && (extraPages || (frames.evenAndOdd && number % 2 !== frames.number % 2))) {
        const owner = extraPages ? section : frames.first!;
        const type = docxHeaderFooterType(number, owner.sectProps, extraPages ? startsSection : owner.startsSection, frames.evenAndOdd);
        const frame = frames.templates.get(owner.sectProps)?.[type];
        if (frame && frame !== currentFrame) {
          restoreFrame?.();
          restoreFrame = usePageFrame(page, frame);
          currentFrame = frame;
          height = Math.max(0, bodyHeight(page, blocks[0]));
          noteHeights = measureEndnotes();
        }
      }
      const notes = notesFor(extraPages ? section.sectProps : undefined);
      const read = new Set<HTMLElement>();
      const layoutAt = (cap: number) => {
        const part = flowPlan(), noteIds: string[] = [];
        let used = 0, required = 0;
        let following: Cursor | undefined;
        for (let index = from.block; index < flows.length; index++) {
          const flow = flows[index];
          if (!flow) {
            used += noteHeights[index];
            continue;
          }
          if (frames.templates && !read.has(flow.article)) {
            read.add(flow.article);
            const width = flow.article.getBoundingClientRect().width;
            if (width !== flow.width) {
              flow.width = width;
              flow.widths = columnWidths(flow.article, flow.area.firstColumn);
              flow.layouts.clear();
            }
          }
          const cursor: Cursor = index === from.block ? from : { block: index, start: { index: 0 } };
          const layout = measureColumns(flow.node, flow.entries, flow.widths, flow.node.getBoundingClientRect().top, cap,
            rules, part, flow.area.balance, notes, used, { ...cursor, layouts: flow.layouts });
          if (!layout) {
            part.before.set(flow.entries[0].source, 'page');
            following = cursor;
            break;
          }
          noteIds.push(...layout.noteIds);
          required = Math.max(required, used + layout.required);
          if (layout.following) {
            following = { block: index, start: layout.following, remainder: layout.remainder };
            break;
          }
          used = layout.used;
        }
        return { part, noteIds, required, following };
      };
      const selected = notes ? fitPage(height, notes.reserve, layoutAt) : layoutAt(height);
      appendPage(plan, selected.part);
      start = selected.following;
      if (start) extraPages++;
      for (let index = from.block; index <= (start?.block ?? flows.length - 1); index++) {
        const flow = flows[index];
        if (!flow) continue;
        const keep = start?.block === index && start.start.row ? flow.entries[start.start.index].source : undefined;
        for (const source of flow.layouts.keys()) if (source !== keep) flow.layouts.delete(source);
      }
    }
  } finally {
    for (const notes of noteLayouts.values()) notes.probe?.remove();
    restoreFrame?.();
  }
  return { extraPages, number };
}

export function measureDocxFlow(areas: DocxFlowAreas, rules: FlowRules, frames: ReadonlyMap<HTMLElement, DocxPageFrames>): DocxMeasuredPages {
  const plan = flowPlan();
  let physical = 0, number = 0;
  for (const [page, frame] of frames) {
    const first = frame.first;
    if (!first) continue; // Parity blanks are derived from the measured page count.
    const { startsSection, sectProps } = first;
    const parity = startsSection && (sectProps.type === 'oddPage' ? 1 : sectProps.type === 'evenPage' ? 0 : undefined);
    if (physical && typeof parity === 'number' && (physical + 1) % 2 !== parity) {
      physical++;
      number++;
    }
    number = nextDocxPageNumber(number, sectProps, startsSection);
    physical++;
    const article = page.querySelector<HTMLElement>(':scope > article');
    if (!article || !page.style.minHeight) continue;
    if (page.classList.contains('docxv-shared-page')) {
      if (page.style.contentVisibility !== 'visible') continue;
      const measured = measureSharedPage(page, areas, rules, plan, frame, number);
      physical += measured.extraPages;
      number = measured.number;
    } else {
      const area = areas.get(article);
      if (!area) continue;
      const extraPages = measureSinglePage(page, article, area, rules, plan);
      physical += extraPages;
      number += extraPages;
    }
  }
  return plan;
}

function measureSinglePage(page: HTMLElement, article: HTMLElement, { elements, columns, firstColumn, balance }: DocxFlowArea,
  rules: FlowRules, plan: FlowPlan): number {
  const { keepWithNext, keepLines, widowControl } = rules;
  const { before, lines, tables } = plan;
  let extraPages = 0;
  const notes = page.querySelector<HTMLElement>(':scope > ol[data-docx-footnotes]');
  if ([...page.children].some(node => node !== article && node !== notes
    && node.localName !== 'header' && node.localName !== 'footer')) return extraPages;
  const minHeight = parseFloat(getComputedStyle(page).minHeight);
  if (!Number.isFinite(minHeight) || (!balance && page.getBoundingClientRect().height <= minHeight + 0.5)) return extraPages;
  const bodyTop = article.getBoundingClientRect().top, height = bodyHeight(page, article);
  if (!(height > 0)) return extraPages;
  const footnotes = notes ? measureFootnotes(notes, article, height, plan.longFootnotes, columns > 1) : undefined;
  try {
    if (firstColumn || (footnotes && columns === 1)) {
      const widths = columnWidths(article, firstColumn), node = firstColumn ?? article;
      return widths.length === columns ? measureColumns(node, flowEntries(node, elements), widths, bodyTop, height,
        rules, plan, balance, footnotes)?.extraPages ?? 0 : 0;
    }
    if (columns !== 1) return extraPages;
    const units = flowEntries(article, elements).flatMap(measureFlowEntry);
    let limit = bodyTop + height;
    let oversizedChainEnd = -1;
    for (let index = 0; index < units.length; index++) {
      const first = units[index];
      let end = index;
      if (index > oversizedChainEnd) {
        while (end + 1 < units.length && keepWithNext(units[end].source)) end++;
        if (units[end].bottom - first.top + first.repeatedHeight > height + 0.5) {
          oversizedChainEnd = end;
          end = index;
        }
      }
      if (units[end].bottom > limit + 0.5) {
        const split = end === index && first.paragraph && !keepLines(first.source)
          ? measureParagraphLines(first.paragraph, first.source, first.top, first.bottom, limit, height,
            index > 0, widowControl(first.source)) : undefined;
        if (split) {
          if (split.before) before.set(first.source, 'page');
          lines.set(first.source, { cuts: split.cuts, breakAfter: 'page' });
          limit = split.limit;
          extraPages += split.cuts.length + Number(split.before);
        } else if (index) {
          before.set(first.source, 'page');
          if (first.table && first.grid) tables.set(first.table, first.grid);
          limit = first.top + height - first.repeatedHeight;
          extraPages++;
        }
      }
      index = end;
    }
  } finally {
    footnotes?.probe?.remove();
  }
  return extraPages;
}

function measureFootnotes(list: HTMLElement, article: HTMLElement, available: number,
  longFootnotes: Set<string>, shared: boolean): Footnotes {
  const items = new Map<string, { node: HTMLElement; height: number }>();
  let content = 0;
  for (const note of list.children as HTMLCollectionOf<HTMLElement>) {
    const box = blockBox(note);
    items.set(note.dataset.docxFootnote!, { node: note, height: box.bottom - box.top });
    content += box.bottom - box.top;
  }
  const box = blockBox(list);
  const spacing = Math.max(0, box.bottom - box.top - content);
  const probe = list.style.columnCount ? list.cloneNode(false) as HTMLOListElement : undefined;
  if (probe) {
    probe.style.cssText += `;position:absolute;visibility:hidden;box-sizing:border-box;width:${box.box.width}px`;
    list.after(probe);
  }
  const cache = new Map<string, number>();
  const reserve: FootnoteSpace = ids => {
    if (!ids.length) return 0;
    if (!probe) {
      const total = ids.reduce((sum, id) => sum + (items.get(id)?.height ?? 0), 0);
      return total ? total + spacing : 0;
    }
    const key = ids.join(',');
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const children = ids.flatMap(id => {
      const item = items.get(id);
      return item ? [item.node.cloneNode(true)] : [];
    });
    probe.replaceChildren(...children);
    const box = blockBox(probe);
    const height = children.length ? box.bottom - box.top : 0;
    cache.set(key, height);
    return height;
  };
  const references = article.localName === 'section' ? ':scope > article sup[data-docx-footnote]' : 'sup[data-docx-footnote]';
  for (const ref of article.querySelectorAll<HTMLElement>(references)) {
    const id = ref.dataset.docxFootnote!;
    const note = items.get(id);
    if (!note) continue;
    const row = ref.closest('tr');
    const paragraph = ref.closest('p');
    const line = paragraph ? parseFloat(getComputedStyle(paragraph).lineHeight) : NaN;
    const referenceHeight = row?.getBoundingClientRect().height
      ?? (Number.isFinite(line) ? line : ref.parentElement!.getBoundingClientRect().height);
    const room = available - referenceHeight;
    if (reserve([id]) > room + 0.5) {
      longFootnotes.add(id);
      if (probe) {
        const opening = note.node.cloneNode(false) as HTMLElement;
        const child = note.node.firstElementChild as HTMLElement | null;
        const style = child && getComputedStyle(child);
        const lineHeight = style ? parseFloat(style.lineHeight) : 0;
        const firstLine = Number.isFinite(lineHeight) ? lineHeight : 0;
        opening.style.height = `${Math.max(firstLine + 1, footnotePrefixHeight(note.node, room, true))}px`;
        opening.style.breakInside = 'avoid';
        note.node = opening;
        cache.clear();
      } else if (room > spacing) {
        note.height = footnotePrefixHeight(note.node, room - spacing, shared);
      }
    }
  }
  return { reserve, probe };
}

function footnotePrefixHeight(note: HTMLElement, room: number, openingOnly: boolean): number {
  const top = blockBox(note).top;
  let bottom = top;
  for (const child of note.children as HTMLCollectionOf<HTMLElement>) {
    const block = blockBox(child);
    if (openingOnly) {
      // A reference can rewrap into a taller line group in another column.
      const text = child.localName === 'p' ? textGeometry(child) : undefined;
      const bottom = text ? text.box(0).bottom + Math.max(0, block.box.bottom - text.bounds.bottom) : block.bottom;
      return Math.ceil(bottom - top) + 1;
    }
    if (block.bottom <= top + room + 0.5) { bottom = block.bottom; continue; }
    const text = child.localName === 'p' ? textGeometry(child) : undefined;
    if (text) {
      const padding = Math.max(0, block.box.bottom - text.bounds.bottom);
      const end = text.fit(top + room - padding);
      if (end > 0) bottom = Math.max(bottom, text.box(end - (text.isBreak(end - 1) ? 2 : 1)).bottom + padding);
    }
    break;
  }
  return bottom > top ? bottom - top : room;
}

function measureColumns(firstColumn: HTMLElement, entries: FlowEntry[], widths: string[], top: number,
  height: number, { keepWithNext, keepLines, widowControl }: FlowRules, plan: FlowPlan, balance?: boolean,
  notes?: Footnotes, occupiedHeight?: number, slice?: ColumnSlice) {
  const scratch = firstColumn.cloneNode(false) as HTMLElement;
  const columns = widths.length;
  const sharedNotes = columns > 1 || slice ? notes : undefined;
  const columnNotes = sharedNotes ? undefined : notes;
  const breakAfter = columns > 1 ? 'columnOverflow' : 'page';
  const tableLayouts = slice?.layouts ?? new Map<DocxElement, FlowUnit[][]>();
  let tailNode = slice?.remainder;
  const caps: number[] = [];
  let firstHeight = Math.max(0, height - (occupiedHeight ?? 0));
  let extraPages = 0, startedNextPage = false;
  firstColumn.replaceWith(scratch);
  const setTrack = (column: number) => { scratch.style.gridColumn = String(column % columns * 2 + 1); };
  const run = ({ before, lines, tables }: FlowPlan, cap: number, start: FlowCursor, trial = false, onePage = false) => {
    let track = 0, lastPage = start;
    const noteIds: string[] = [];
    let required = 0, used = 0;
    let following: FlowCursor | undefined, remainder: HTMLElement | undefined;
    const result = () => ({ lastPage, track, noteIds, required, following, remainder, used, extraPages, startedNextPage });
    const trackNotes = () => notes ? footnoteIds(scratch) : [];
    const bottomOf = (node: Element | null) => occupiedHeight !== undefined && node instanceof HTMLElement ? blockBox(node).bottom - top : 0;
    const requireHeight = (height: number) => { required = Math.max(required, height); };
    const capacity = (column: number) => caps[column] ?? (!trial && column < columns ? Math.min(cap, firstHeight) : cap);
    const mark = (column: number, cursor: FlowCursor, ids: string[], tail?: HTMLElement, filled = 0) => {
      if (sharedNotes) noteIds.push(...ids);
      if (onePage && column === columns) {
        following = cursor;
        remainder = tail;
        return false;
      }
      if (!trial && column % columns === 0) {
        lastPage = cursor;
        const source = entries[cursor.index].source;
        const layout = tableLayouts.get(source);
        tableLayouts.clear();
        if (layout) tableLayouts.set(source, layout);
      }
      used = column % columns ? Math.max(used, filled) : 0;
      return !trial || column < columns;
    };
    const place = (column: number, nodes: HTMLElement[]) => {
      setTrack(track = column);
      scratch.replaceChildren(...nodes);
    };
    place(0, []);
    const fits = (node: HTMLElement) => blockBox(node).bottom + (columnNotes?.reserve(trackNotes()) ?? 0) <= top + capacity(track) + 0.5;
    let oversizedChainEnd = -1;
    for (let index = start.index; index < entries.length; index++) {
      const { source } = entries[index];
      const early = !trial && !index && firstHeight < height;
      const offset = index === start.index ? start.offset ?? 0 : 0;
      const row = index === start.index ? start.row : undefined;
      let end = index;
      if (!offset && !row && index > oversizedChainEnd) {
        while (end + 1 < entries.length && keepWithNext(entries[end].source)) end++;
      }
      const pending = entries.slice(index, end + 1).map(({ node }, item) =>
        (index === start.index && !item && tailNode ? tailNode : node).cloneNode(true) as HTMLElement);
      const node = pending[0];
      scratch.append(...pending);
      if (end > index) {
        const last = pending[pending.length - 1];
        if (fits(last)) { index = end; continue; }
        if (early && blockBox(last).bottom <= top + height + 0.5) return undefined;
        if (node.previousElementSibling) {
          const previous = Array.from(scratch.children).slice(0, -pending.length) as HTMLElement[];
          const current = track;
          const ids = sharedNotes ? trackNotes() : [];
          const filled = bottomOf(node.previousElementSibling);
          place(track + 1, pending);
          if (fits(last)) {
            before.set(source, breakAfter);
            if (!mark(track, { index }, sharedNotes ? ids.slice(0, ids.length - trackNotes().length) : [], undefined, filled)) {
              return onePage ? result() : undefined;
            }
            index = end;
            continue;
          }
          place(current, [...previous, ...pending]);
        }
        if (trial) return undefined;
        oversizedChainEnd = end;
        for (const other of pending.slice(1)) other.remove();
      }

      if (node instanceof HTMLTableElement && (row || !fits(node))) {
        let layouts = tableLayouts.get(source);
        if (!layouts) {
          const byWidth = new Map<string, FlowUnit[]>();
          // Measure each distinct width once and reuse the row geometry in balancing trials.
          layouts = widths.map((width, column) => {
            const measured = byWidth.get(width);
            if (measured) return measured;
            setTrack(column);
            const units = measureFlowEntry({ source, node });
            byWidth.set(width, units);
            return units;
          });
          setTrack(track);
          if (balance || onePage) tableLayouts.set(source, layouts);
        }
        if (layouts.every(units => units.length > 1)) {
          const next = measureColumnTable(source, node, layouts, track, top, capacity, row, trial,
            (column, row, ids, filled) => mark(column, { index, row }, ids, undefined, filled),
            before, tables, notes, sharedNotes && requireHeight, early);
          if (next === -1) return following ? result() : undefined;
          if (next !== undefined) { place(next, [node]); continue; }
        }
      }
      const cuts: number[] = [];
      const canSplit = source.type === 'paragraph' && !keepLines(source);
      for (;;) {
        const box = blockBox(node);
        const ids = trackNotes();
        const bottom = box.bottom + (columnNotes?.reserve(ids) ?? 0);
        const cap = capacity(track), limit = top + cap;
        if (bottom <= limit + 0.5) break;
        const occupied = Boolean(node.previousElementSibling);
        const prior = columnNotes ? ids.slice(0, ids.length - footnoteIds(node).length) : [];
        const cut = canSplit ? measureParagraphLines(node, source, box.top, bottom, limit,
          cap, occupied || (early && !track), widowControl(source), { offset: cuts.at(-1) ?? offset, extract: occupiedHeight !== undefined,
            notes: columnNotes && (refs => columnNotes.reserve(prior.concat(refs))) }) : undefined;
        let filled = bottomOf(node.previousElementSibling);
        if (cut) {
          cuts.push(cut.cuts[0]);
          if (cut.prefix) {
            const prefix = node.cloneNode(false) as HTMLElement;
            prefix.append(cut.prefix);
            prefix.style.marginBottom = '0';
            node.replaceWith(prefix);
            filled = bottomOf(prefix);
            prefix.replaceWith(node);
          }
          continueParagraph(node);
        } else if (occupied) before.set(source, breakAfter);
        else {
          if (trial || (early && !track)) return undefined;
          requireHeight(box.bottom - top);
          break;
        }
        const completed = sharedNotes ? ids.slice(0, ids.length - footnoteIds(node).length) : [];
        if (!mark(track + 1, { index, offset: cuts.at(-1) }, completed, cut ? node : undefined, filled)) {
          if (cuts.length) lines.set(source, { cuts, breakAfter });
          return onePage ? result() : undefined;
        }
        place(track + 1, [node]);
      }
      if (cuts.length) lines.set(source, { cuts, breakAfter });
    }
    if (sharedNotes) noteIds.push(...trackNotes());
    used = Math.max(used, bottomOf(scratch.lastElementChild));
    return result();
  };
  try {
    type PageTrial = { part: FlowPlan; layout: NonNullable<ReturnType<typeof run>> };
    let natural: ReturnType<typeof run>;
    if (slice) {
      natural = run(plan, height, slice.start, false, true);
      if (natural?.following) return natural;
    } else if (sharedNotes) {
      let start: FlowCursor | undefined = { index: 0 };
      while (start) {
        const current: FlowCursor = start;
        const selected = fitPage(height, sharedNotes.reserve, cap => {
          const part = flowPlan();
          const layout: PageTrial['layout'] = run(part, cap, current, false, true)!;
          return { part, layout, ...layout };
        });
        const { part, layout } = selected;
        appendPage(plan, part);
        natural = { ...layout, lastPage: start };
        start = layout.following;
        if (start) {
          extraPages++;
          tailNode = layout.remainder;
          const source = entries[start.index].source;
          for (const key of tableLayouts.keys()) if (key !== source) tableLayouts.delete(key);
        }
      }
    } else {
      natural = run(plan, height, { index: 0 });
      if (!natural && firstHeight < height) {
        plan.before.set(entries[0].source, 'page');
        firstHeight = height;
        extraPages++;
        startedNextPage = true;
        natural = run(plan, height, { index: 0 });
      }
    }
    if (!natural || !entries.length) return;
    if (!slice && !sharedNotes) extraPages += Math.floor(natural.track / columns);
    const onFirst = natural.track < columns && firstHeight < height;
    const prefixHeight = onFirst ? occupiedHeight! : 0;
    if (!balance) return { ...natural, used: prefixHeight + natural.used, extraPages };
    const { lastPage } = natural;
    if (!slice && !sharedNotes && (lastPage.offset || lastPage.row)) {
      const { source, node } = entries[lastPage.index];
      tailNode = node.cloneNode(true) as HTMLElement;
      if (lastPage.row && tailNode instanceof HTMLTableElement) {
        trimTable(tailNode, source.children!, lastPage.row);
      } else if (lastPage.offset) {
        textGeometry(tailNode)!.discardPrefix(lastPage.offset);
        continueParagraph(tailNode);
      }
    }
    let best: FlowPlan | undefined;
    // Replay the final page only, leaving full pages and their row/line cuts intact.
    let final = natural;
    const reserve = slice ? undefined : sharedNotes?.reserve;
    let high = (onFirst ? firstHeight : height) - (reserve?.(natural.noteIds) ?? 0), lastTrack = natural.track % columns;
    for (let column = 0; column < columns - 1; column++) {
      let low = 0;
      while (high - low > 1) {
        const cap = (low + high) / 2;
        const trial = flowPlan();
        const result = run(trial, cap, lastPage, true);
        if (result && (!reserve || Math.max(cap, caps[0] ?? 0) + reserve(result.noteIds) <= height + 0.5)) {
          high = cap;
          best = trial;
          final = result;
          lastTrack = result.track;
        } else low = cap;
      }
      // Rebalance the remaining tracks after fixing this one's height.
      if (!best || lastTrack <= column) break;
      caps.push(high);
    }
    if (best) replaceColumnTail(entries, lastPage, plan, best);
    return { ...final, used: prefixHeight + final.used, extraPages };
  } finally {
    scratch.replaceWith(firstColumn);
  }
}

function continueParagraph(node: HTMLElement) {
  node.classList.add('docxv-continuation');
  node.style.marginTop = '0px';
  node.style.textIndent = '0px';
}

function replaceColumnTail(entries: FlowEntry[], start: FlowCursor, plan: FlowPlan, tail: FlowPlan) {
  for (let index = start.index; index < entries.length; index++) {
    const { source } = entries[index];
    if (index !== start.index) plan.before.delete(source);
    const leading = index === start.index && start.offset
      ? plan.lines.get(source)?.cuts.filter(offset => offset <= start.offset!) : undefined;
    if (leading?.length) {
      plan.lines.set(source, { cuts: leading.concat(tail.lines.get(source)?.cuts ?? []), breakAfter: 'columnOverflow' });
      tail.lines.delete(source);
    } else plan.lines.delete(source);
    if (source.type === 'table' && source.children) {
      const first = index === start.index && start.row ? source.children.indexOf(start.row) + 1 : 0;
      for (const row of source.children.slice(first)) plan.before.delete(row);
    }
  }
  for (const [element, value] of tail.before) plan.before.set(element, value);
  for (const [element, value] of tail.lines) plan.lines.set(element, value);
  for (const [element, value] of tail.tables) plan.tables.set(element, value);
}

function measureColumnTable(source: DocxElement, table: HTMLTableElement, layouts: FlowUnit[][], track: number,
  bodyTop: number, capacity: (column: number) => number, row: DocxElement | undefined, trial: boolean,
  mark: (column: number, row: DocxElement | undefined, ids: string[], filled: number) => boolean,
  before: FlowPlan['before'], tables: FlowPlan['tables'], notes?: Footnotes, requireHeight?: (height: number) => void,
  early = false): number | undefined {
  const initialTrack = track;
  let available = bodyTop + capacity(track) - blockBox(table).top;
  let occupied = Boolean(table.previousElementSibling);
  const rows = source.children!;
  const noteIds: string[] = [], noteEnds = [0];
  if (notes) for (const row of table.rows) {
    noteIds.push(...footnoteIds(row));
    noteEnds.push(noteIds.length);
  }
  const siblingIds = notes ? footnoteIds(table.parentElement!) : [];
  let prior = siblingIds.slice(0, siblingIds.length - noteIds.length);
  const headerCount = Math.max(0, rows.findIndex(row => !row.isHeader));
  let first = row ? layouts[0].findIndex(unit => unit.source === row) : 0;
  for (;;) {
    const units = layouts[track % layouts.length];
    const grid = units[first].grid!;
    const top = units[first].top - units[first].repeatedHeight;
    const start = first ? noteEnds[units[first - 1].rowEnd!] : 0;
    const headers = first ? noteIds.slice(0, noteEnds[headerCount]) : [];
    const through = (index: number) => prior.concat(headers, noteIds.slice(start, noteEnds[units[index].rowEnd!]));
    let end = first;
    while (end < units.length && units[end].bottom - top
      + (requireHeight ? 0 : notes?.reserve(through(end)) ?? 0) <= available + 0.5) end++;
    // A row group that exceeds an empty column still has to stay together.
    if (end === first && !occupied) {
      if (trial || (early && track === initialTrack)) return -1;
      requireHeight?.(capacity(track) + units[end].bottom - top - available);
      end++;
    }
    if (end > first) tables.set(first ? units[first].source : rows[0], grid);
    if (end === units.length) {
      if (first) {
        trimTable(table, rows, units[first].source);
        table.style.width = `${grid.width}px`;
        table.style.tableLayout = 'fixed';
        table.querySelectorAll<HTMLElement>(':scope > colgroup > col').forEach((col, index) => {
          col.style.width = `${grid.columns[index]}px`;
        });
      }
      return first || track !== initialTrack ? track : undefined;
    }
    before.set(units[end].source, layouts.length > 1 ? 'columnOverflow' : 'page');
    const ids = requireHeight ? (end > first ? through(end - 1) : prior) : [];
    const filled = capacity(track) - available + (end > first ? units[end - 1].bottom - top : 0);
    if (!mark(++track, end ? units[end].source : undefined, ids, filled)) return -1;
    first = end;
    available = capacity(track);
    occupied = false;
    prior = [];
  }
}

function trimTable(table: HTMLTableElement, rows: DocxElement[], from: DocxElement): void {
  const headers = Math.max(0, rows.findIndex(row => !row.isHeader));
  const start = rows.indexOf(from) - (rows.length - table.rows.length);
  Array.from(table.rows).slice(headers, start).forEach(row => row.remove());
}

function blockBox(node: HTMLElement) {
  const box = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const marginTop = Math.max(0, parseFloat(style.marginTop));
  const marginBottom = Math.max(0, parseFloat(style.marginBottom));
  return { top: box.top - marginTop, bottom: box.bottom + marginBottom, box, marginTop, marginBottom };
}

function measureFlowEntry({ source, node }: FlowEntry): FlowUnit[] {
  const { top, bottom, box, marginTop, marginBottom } = blockBox(node);
  const block = { source, top, bottom, repeatedHeight: 0,
    paragraph: source.type === 'paragraph' ? node : undefined };
  if (!(node instanceof HTMLTableElement) || !source.children || source.children.length < 2) return [block];
  const rows = source.children;
  const columns = measureTableColumns(node);
  if (node.rows.length !== rows.length || !columns) return [block];
  const grid = { width: box.width, columns };
  const rowBoxes = Array.from(node.rows, row => row.getBoundingClientRect());
  const headingRows = Math.max(0, rows.findIndex(row => !row.isHeader));
  const repeatedHeight = rowBoxes[headingRows].top - box.top + marginTop;
  const endMargin = box.bottom - rowBoxes[rowBoxes.length - 1].bottom + marginBottom;
  const units: FlowUnit[] = [];
  for (let index = 0; index < rows.length;) {
    // The first data row stays with the heading rows. A vertical merge stays with its anchor row.
    let end = index === 0 ? headingRows : index;
    while (end + 1 < rows.length && rows[end + 1].children?.some(cell => cell.verticalMerge === 'continue')) end++;
    units.push({
      source: index ? rows[index] : source,
      top: index ? rowBoxes[index].top : top,
      bottom: rowBoxes[end].bottom + endMargin,
      rowEnd: end + 1,
      repeatedHeight: index ? repeatedHeight : 0,
      table: index ? source : undefined,
      grid
    });
    index = end + 1;
  }
  return units;
}

function measureTableColumns(table: HTMLTableElement): number[] | undefined {
  const cols = table.querySelectorAll(':scope > colgroup > col');
  if (!cols.length) return undefined;
  const widths = Array.from(cols, col => col.getBoundingClientRect().width);
  if (widths.every(width => width > 0)) return widths;
  // WebKit exposes table column geometry through the cells.
  for (const row of table.rows) {
    if (row.cells.length !== cols.length || Array.from(row.cells).some(cell => cell.colSpan !== 1)) continue;
    const widths = Array.from(row.cells, cell => cell.getBoundingClientRect().width);
    if (widths.every(width => width > 0)) return widths;
  }
  return undefined;
}

export function indexDocxFlow(areas: DocxFlowAreas, notes: NotePart[] = []) {
  type Source = DocxElement | string;
  type Anchor = { source: Source; inset: number; offset?: number };
  const nodes = new Map<Source, HTMLElement[]>();
  const elements = new WeakMap<HTMLElement, { source: Source; offset: number }>();
  const index = (node: HTMLElement, source: Source, offset = 0) => {
    const parts = nodes.get(source);
    if (parts) parts.push(node);
    else nodes.set(source, [node]);
    elements.set(node, { source, offset });
  };
  const add = (node: HTMLElement, element: DocxElement) => {
    if (!element.filensRepeatedHeader) index(node, element.filensParagraph ?? element, element.filensOffset);
  };
  for (const [article, { elements, columns, firstColumn }] of areas) {
    if (columns > 1 && !firstColumn) continue;
    for (const entry of flowEntries(firstColumn ?? article, elements)) {
      if (entry.node instanceof HTMLTableElement && entry.source.children?.length === entry.node.rows.length) {
        const rows = entry.source.children;
        Array.from(entry.node.rows).forEach((row, index) => add(row, rows[index]));
      } else add(entry.node, entry.source);
    }
  }
  for (const note of notes) index(note.node, note.source, note.offset);
  return {
    locate(anchor: Anchor) {
      const parts = nodes.get(anchor.source);
      if (!parts) return undefined;
      let node = parts[0], offset = 0;
      for (const part of parts) {
        const start = elements.get(part)?.offset ?? 0;
        if (start > (anchor.offset ?? 0)) break;
        node = part;
        offset = (anchor.offset ?? 0) - start;
      }
      return { node, box: () => (anchor.offset === undefined ? undefined : textGeometry(node)?.box(offset))
        ?? node.getBoundingClientRect() };
    },
    anchor(page: Element, top: number): Anchor | undefined {
      for (const node of page.querySelectorAll<HTMLElement>(
        'article p, article table, article tr, ol:is([data-docx-endnotes],[data-docx-footnotes]) > li > *')) {
        const part = elements.get(node);
        if (!part) continue;
        const box = node.getBoundingClientRect();
        if (box.bottom <= top) continue;
        const text = node.localName === 'p' ? textGeometry(node) : undefined;
        if (text) {
          let offset = Math.min(text.fit(top), text.text.length - 1);
          if (text.isBreak(offset) && offset + 1 < text.text.length) offset++;
          return { source: part.source, offset: offset + part.offset,
            inset: top - text.box(offset).top };
        }
        return { source: part.source, inset: top - box.top };
      }
      return undefined;
    }
  };
}
