type MeasuredBreak = 'page' | 'columnOverflow';
type LayoutBreak = MeasuredBreak | 'lastRenderedPageBreak' | 'column';
export type HeaderFooterType = 'default' | 'first' | 'even';

interface HeaderFooterReference { type: HeaderFooterType; id: string }

interface SectionProperties {
  type?: string;
  pageSize?: { width?: string | null; height?: string | null; orientation?: string | null };
  pageMargins?: Record<string, string | null>;
  pageNumber?: { start?: number | null };
  bidi?: boolean;
  footnoteColumns?: number;
  columns?: {
    numberOfColumns?: number;
    space?: string | null;
    separator?: boolean;
    equalWidth?: boolean;
    columns?: { width?: string | null; space?: string | null }[];
  };
  titlePage?: boolean;
  headerRefs?: HeaderFooterReference[];
  footerRefs?: HeaderFooterReference[];
}

export interface DocxElement {
  type: string;
  children?: DocxElement[];
  styleName?: string;
  pageBreakBefore?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  text?: string;
  className?: string;
  sectionProps?: SectionProperties;
  break?: string;
  isHeader?: boolean;
  verticalMerge?: string;
  filensRepeatedHeader?: boolean;
  columns?: { width?: string | null }[];
  cssStyle?: Record<string, string>;
  filensParagraph?: DocxElement;
  filensOffset?: number;
}

interface DocxStyle {
  id?: string;
  target?: string;
  isDefault?: boolean;
  basedOn?: string;
  paragraphProps?: { pageBreakBefore?: boolean; keepNext?: boolean; keepLines?: boolean; widowControl?: boolean };
}

interface SectionFragment {
  elements: DocxElement[];
  sectProps?: SectionProperties;
  breakAfter?: LayoutBreak;
}

export interface PageSection {
  elements: DocxElement[];
  sectProps: SectionProperties;
  startsSection: boolean;
  columnParts?: DocxElement[][];
  authoredColumns?: boolean;
  balanceColumns?: boolean;
  endnotes?: { section: number; props: SectionProperties };
}

interface Page {
  sections: PageSection[];
  props: SectionProperties;
  headerFooterType: HeaderFooterType | null;
  number?: number;
}

interface Fragment { children: DocxElement[]; breakAfter?: LayoutBreak }

export interface DocxMeasuredPages {
  before: ReadonlyMap<DocxElement, MeasuredBreak>;
  tables: ReadonlyMap<DocxElement, { width: number; columns: number[] }>;
  lines: ReadonlyMap<DocxElement, { cuts: number[]; breakAfter: MeasuredBreak }>;
  longFootnotes?: ReadonlySet<string>;
}

const inlineContainers = new Set(['run', 'hyperlink', 'smartTag', 'inserted']);
const headerFooterTypes: readonly HeaderFooterType[] = ['default', 'first', 'even'];

export function someDocxElement(elements: readonly DocxElement[], matches: (element: DocxElement) => boolean): boolean {
  return elements.some(element => matches(element) || (element.children && someDocxElement(element.children, matches)));
}

/** Keep the authored values because docx-preview merges its style objects during rendering. */
export function createDocxPagination(document: {
  stylesPart?: { styles?: readonly DocxStyle[] };
  settingsPart?: { settings?: {
    evenAndOddHeaders?: boolean; compatibilityMode?: number; noColumnBalance?: boolean; endnoteProps?: { position?: string };
  } };
}) {
  const settings = document.settingsPart?.settings;
  const canContinueSectionInColumn = (settings?.compatibilityMode ?? 0) < 15;
  const styles = new Map<string, DocxStyle>();
  let defaultStyle: string | undefined;
  let defaultWidowControl = true;
  for (const style of document.stylesPart?.styles ?? []) {
    if (!style.id) {
      defaultWidowControl = style.paragraphProps?.widowControl ?? defaultWidowControl;
      continue;
    }
    if (style.target !== 'p') continue;
    styles.set(style.id, {
      basedOn: style.basedOn,
      paragraphProps: { ...style.paragraphProps }
    });
    if (style.isDefault) defaultStyle = style.id;
  }
  const inherited = {
    pageBreakBefore: new Map<string, boolean>(), keepNext: new Map<string, boolean>(),
    keepLines: new Map<string, boolean>(), widowControl: new Map<string, boolean>()
  };
  const styleFlag = (name: string | undefined, flag: keyof typeof inherited): boolean => {
    const fallback = flag === 'widowControl' && defaultWidowControl;
    if (!name) return fallback;
    const cache = inherited[flag];
    const known = cache.get(name);
    if (known !== undefined) return known;
    const visited = new Set<string>();
    let id: string | undefined = name, value = fallback;
    while (id && !visited.has(id)) {
      visited.add(id);
      const style = styles.get(id);
      const candidate = cache.get(id) ?? style?.paragraphProps?.[flag];
      if (candidate !== undefined) { value = candidate; break; }
      id = style?.basedOn;
    }
    for (const id of visited) cache.set(id, value);
    return value;
  };

  const paginate = (elements: readonly DocxElement[] = [], defaultProps: SectionProperties = {},
    processElement: (element: DocxElement) => void, measured?: DocxMeasuredPages, afterEndnotes?: ReadonlySet<number>): Page[] => {
    let current: SectionFragment = { elements: [] };
    const sections = [current];
    const finish = (breakAfter?: LayoutBreak, sectProps?: SectionProperties) => {
      current.breakAfter = breakAfter;
      current.sectProps = sectProps;
      current = { elements: [] };
      sections.push(current);
    };
    const finishBreak = (breakAfter: LayoutBreak) => {
      if (current.elements.length || breakAfter === 'column') finish(breakAfter);
      // Word can write a saved boundary immediately after a hard page or column break.
      else if (sections.length > 1) sections[sections.length - 2].breakAfter ??= breakAfter;
    };

    for (const element of elements) {
      const before = measured?.before.get(element);
      if (before) finishBreak(before);
      const tableParts = element.type === 'table' ? splitTable(element.children ?? [], measured?.before) : undefined;
      if (tableParts) {
        for (const { children, breakAfter } of tableParts) {
          if (children.length) {
            const grid = measured?.tables.get(children.find(row => !row.filensRepeatedHeader) ?? element)
              ?? measured?.tables.get(element);
            const table = { ...element, children };
            if (grid) {
              table.columns = grid.columns.map(width => ({ width: `${width}px` }));
              table.cssStyle = { ...table.cssStyle, width: `${grid.width}px`, 'table-layout': 'fixed' };
            }
            processElement(table);
            current.elements.push(table);
          }
          if (breakAfter) finishBreak(breakAfter);
        }
        continue;
      }
      if (element.type !== 'paragraph') { current.elements.push(element); continue; }
      if (element.pageBreakBefore ?? styleFlag(element.styleName ?? defaultStyle, 'pageBreakBefore')) {
        if (current.elements.length) finish('page');
        else if (sections.length > 1) sections[sections.length - 2].breakAfter = 'page';
      }
      const split = measured?.lines.get(element);
      const fragments = split ? splitInline(insertLineBreaks(element.children ?? [], split)) : splitParagraph(element);
      if (!fragments) {
        current.elements.push(element);
        if (element.sectionProps) finish(undefined, element.sectionProps);
        continue;
      }
      for (const [index, { children, breakAfter }] of fragments.entries()) {
        // A hard break after body content ends the page without an extra empty line.
        if (children.length || (breakAfter === 'page' && !current.elements.length)) {
          const paragraph = { ...element, children };
          if (split) {
            paragraph.filensParagraph = element;
            paragraph.filensOffset = split.cuts[index - 1] ?? 0;
            paragraph.cssStyle = { ...paragraph.cssStyle };
            if (index) {
              paragraph.className = [element.className, 'docxv-continuation'].filter(Boolean).join(' ');
              paragraph.cssStyle['margin-top'] = '0px';
              paragraph.cssStyle['text-indent'] = '0px';
            }
            if (breakAfter) paragraph.cssStyle['margin-bottom'] = '0px';
          }
          processElement(paragraph);
          current.elements.push(paragraph);
        }
        if (breakAfter) finishBreak(breakAfter);
      }
      if (element.sectionProps) {
        if (current.elements.length) finish(undefined, element.sectionProps);
        else (sections[sections.length - 2] ?? current).sectProps = element.sectionProps;
      }
    }

    return paginateSections(sections, defaultProps, canContinueSectionInColumn, settings?.evenAndOddHeaders,
      settings?.noColumnBalance, settings?.endnoteProps?.position === 'sectEnd', afterEndnotes);
  };
  return {
    paginate,
    keepWithNext: (element: DocxElement) => element.type === 'paragraph'
      && (element.keepNext ?? styleFlag(element.styleName ?? defaultStyle, 'keepNext')),
    keepLines: (element: DocxElement) => element.keepLines ?? styleFlag(element.styleName ?? defaultStyle, 'keepLines'),
    widowControl: (element: DocxElement) => element.widowControl ?? styleFlag(element.styleName ?? defaultStyle, 'widowControl')
  };
}

function paginateSections(sections: SectionFragment[], defaultProps: SectionProperties,
  canContinueSectionInColumn: boolean, evenAndOddHeaders = false, noColumnBalance = false,
  sectionEndnotes = false, afterEndnotes?: ReadonlySet<number>): Page[] {
  let following = defaultProps;
  for (let i = sections.length - 1; i >= 0; i--) {
    const authored = sections[i].sectProps;
    if (authored) {
      following = authored.type === 'continuous' || authored.type === 'nextColumn' ? {
        ...authored,
        pageSize: authored.pageSize ?? following.pageSize,
        pageMargins: authored.pageMargins ?? following.pageMargins
      } : authored;
    }
    sections[i].sectProps = following;
  }

  const pages: Page[] = [];
  let previousSection: SectionProperties | undefined;
  let props: SectionProperties = {};
  let previousBreak: LayoutBreak | undefined, pageNumber = 0;
  let sectionNumber = 0, hasEndnotes = false;
  for (const [index, part] of sections.entries()) {
    const section = part.sectProps!;
    const startsSection = section !== previousSection;
    const previousProps = props;
    if (startsSection) {
      sectionNumber++;
      hasEndnotes = false;
      props = {
        ...section,
        headerRefs: inheritReferences(section.headerRefs, previousProps.headerRefs),
        footerRefs: inheritReferences(section.footerRefs, previousProps.footerRefs)
      };
    }
    const last = pages.at(-1)?.sections.at(-1);
    const sectionColumnBreak = startsSection && props.type === 'nextColumn';
    // Word saves column starts as lastRenderedPageBreak inside a multi-column section.
    const fromSavedColumn = previousBreak === 'lastRenderedPageBreak' && !startsSection && columnCount(props) > 1;
    const fromColumn = previousBreak === 'column' || previousBreak === 'columnOverflow' || fromSavedColumn;
    const columnBreak = fromColumn || sectionColumnBreak;
    const pageBreak = previousBreak && !fromColumn;
    // Word 2013 compatibility and later start next-column sections on a fresh page.
    const sameColumns = !startsSection || ((props.type === 'continuous' || (sectionColumnBreak && canContinueSectionInColumn))
      && sameColumnLayout(previousProps, props));
    const noteBreak = startsSection && last?.endnotes && (columnBreak || afterEndnotes?.has(last.endnotes.section));
    const useNextColumn = columnBreak && !pageBreak && !noteBreak && last && sameColumns
      && (last.columnParts?.length ?? 1) < columnCount(props);
    const sectionBreak = startsSection && (props.type !== 'continuous' || hasPaperChange(previousProps, props));
    if (useNextColumn) {
      (last.columnParts ??= [last.elements]).push(part.elements);
      if (previousBreak === 'column' || fromSavedColumn || sectionColumnBreak) last.authoredColumns = true;
    } else if (!pages.length || pageBreak || sectionBreak || columnBreak || noteBreak) {
      const parity = props.type === 'evenPage' ? 0 : props.type === 'oddPage' ? 1 : undefined;
      if (pages.length && startsSection && parity !== undefined && (pages.length + 1) % 2 !== parity) {
        pages.push({ sections: [], props: pages[pages.length - 1].props, headerFooterType: null });
        pageNumber++;
      }
      // Word chooses header and footer parity from the section's page numbering.
      pageNumber = nextDocxPageNumber(pageNumber, props, startsSection);
      const headerFooterType = docxHeaderFooterType(pageNumber, props, startsSection, evenAndOddHeaders);
      pages.push({ sections: [], props, headerFooterType, number: pageNumber });
    }
    if (!useNextColumn) {
      const elements = part.elements;
      const columnParts = fromSavedColumn || (previousBreak === 'columnOverflow' && columnCount(props) > 1) ? [elements] : undefined;
      pages[pages.length - 1].sections.push({ elements, sectProps: props, startsSection, columnParts,
        authoredColumns: fromSavedColumn || previousBreak === 'column' || part.breakAfter === 'column' || sectionColumnBreak,
        balanceColumns: !noColumnBalance && !part.breakAfter });
    }
    if (sectionEndnotes) {
      hasEndnotes ||= someDocxElement(part.elements, element => element.type === 'endnoteReference');
      if (hasEndnotes && sections[index + 1]?.sectProps !== section) {
        pages.at(-1)!.sections.at(-1)!.endnotes = { section: sectionNumber, props };
      }
    }
    previousSection = section;
    previousBreak = part.breakAfter;
  }
  return pages;
}

export function nextDocxPageNumber(previous: number, props: SectionProperties, startsSection: boolean): number {
  const start = startsSection ? props.pageNumber?.start : undefined;
  return typeof start === 'number' && Number.isSafeInteger(start) ? start : previous + 1;
}

export function docxHeaderFooterType(number: number, props: SectionProperties, startsSection: boolean, evenAndOddHeaders: boolean): HeaderFooterType {
  return startsSection && props.titlePage ? 'first' : evenAndOddHeaders && number % 2 === 0 ? 'even' : 'default';
}

export function columnCount(props: SectionProperties): number {
  const columns = props.columns;
  const count = columns?.equalWidth === false ? columns.columns?.length || columns.numberOfColumns : columns?.numberOfColumns;
  return count && Number.isSafeInteger(count) && count > 0 ? count : 1;
}

export function renderDocxFootnoteColumns(list: HTMLOListElement, props: SectionProperties): void {
  const count = (props.footnoteColumns ?? 0) > 0 ? props.footnoteColumns! : columnCount(props);
  list.style.columnCount = count > 1 ? String(count) : '';
  list.style.columnGap = count > 1 ? props.columns?.space || '36pt' : '';
  list.dir = count > 1 && props.bidi ? 'rtl' : '';
}

function sameColumnLayout(previous: SectionProperties, next: SectionProperties): boolean {
  return !hasPaperChange(previous, next)
    && previous.pageMargins?.left === next.pageMargins?.left && previous.pageMargins?.right === next.pageMargins?.right
    && JSON.stringify(previous.columns) === JSON.stringify(next.columns);
}

export function renderDocxColumns(container: HTMLElement, { elements, sectProps, columnParts }: PageSection,
  render: (elements: DocxElement[], into: HTMLElement) => void, measureFlow = false): void {
  if (sectProps.bidi) container.dir = 'rtl';
  const count = columnCount(sectProps), columns = sectProps.columns;
  const gap = columns?.space || '36pt';
  if (!columnParts && measureFlow && count > 1 && sectProps.pageSize?.height
    && elements.every(element => element.type === 'paragraph' || element.type === 'table')) columnParts = [elements];
  if (!columnParts) {
    if (count > 1 && columns?.equalWidth !== false) container.style.columnGap = gap;
    render(elements, container);
    return;
  }
  const width = 'minmax(0, 1fr)';
  const tracks = columns?.equalWidth === false && columns.columns?.length === count
    ? columns.columns.map(({ width: savedWidth, space }, index) => index === count - 1
      ? savedWidth || width : `${savedWidth || width} ${space || gap}`).join(' ')
    : `repeat(${count - 1}, ${width} ${gap}) ${width}`;
  container.style.display = 'grid';
  container.style.columnCount = 'auto';
  container.style.columnGap = '0';
  container.style.gridTemplateColumns = tracks;
  for (const [index, elements] of columnParts.entries()) {
    const column = container.ownerDocument.createElement('div');
    column.style.gridColumn = String(index * 2 + 1);
    column.style.gridRow = '1';
    column.style.minWidth = '0';
    render(elements, column);
    container.append(column);
    if (columns?.separator && index + 1 < columnParts.length) {
      const separator = container.ownerDocument.createElement('div');
      separator.className = 'docxv-column-separator';
      separator.setAttribute('aria-hidden', 'true');
      separator.style.gridColumn = String(index * 2 + 2);
      separator.style.gridRow = '1';
      container.append(separator);
    }
  }
}

function inheritReferences(refs: HeaderFooterReference[] = [], previous: HeaderFooterReference[] = []): HeaderFooterReference[] {
  if (!refs.length) return previous;
  return headerFooterTypes.flatMap(type => refs.find(ref => ref.type === type)
    ?? previous.find(ref => ref.type === type) ?? []);
}

function hasPaperChange(previous: SectionProperties, next: SectionProperties): boolean {
  return previous.pageSize?.width !== next.pageSize?.width
    || previous.pageSize?.height !== next.pageSize?.height
    || (previous.pageSize?.orientation ?? 'portrait') !== (next.pageSize?.orientation ?? 'portrait');
}

function splitTable(rows: DocxElement[], measured?: DocxMeasuredPages['before']): Fragment[] | undefined {
  const fragments: Fragment[] = [];
  const headerCount = rows.findIndex(row => !row.isHeader);
  let children: DocxElement[] | undefined;
  for (const [index, row] of rows.entries()) {
    const before = measured?.get(row);
    if (before) {
      fragments.push({ children: children ?? rows.slice(0, index), breakAfter: before });
      children = [row];
      continue;
    }
    const cells = row.children ?? [];
    const cell = cells.find(cell => !isEmptyCell(cell));
    const parts = cell && !cells.some(cell => cell.verticalMerge === 'continue')
      ? splitSavedCell(cell.children ?? []) : undefined;
    if (!cell || !parts) { children?.push(row); continue; }
    // A single populated cell gives the complete position of each break within the row.
    const canSplitRow = index >= headerCount && cells.every(other => !other.verticalMerge && (other === cell || isEmptyCell(other)));
    if (!canSplitRow && parts[0].children.length) { children?.push(row); continue; }
    children ??= rows.slice(0, index);
    if (canSplitRow) {
      for (const part of parts) {
        if (part.children.length) {
          const rowCells = cells.map(other => other === cell ? { ...cell, children: part.children } : other);
          children.push({ ...row, children: rowCells });
        }
        if (part.breakAfter) {
          fragments.push({ children, breakAfter: part.breakAfter });
          children = [];
        }
      }
    } else {
      fragments.push({ children, breakAfter: 'lastRenderedPageBreak' });
      children = [row];
    }
  }
  if (!children) return undefined;
  if (children.length) fragments.push({ children });

  if (headerCount > 0) {
    let remainingHeaders = headerCount;
    const copies = rows.slice(0, headerCount).map(row => ({ ...row, filensRepeatedHeader: true }));
    for (const part of fragments) {
      if (!part.children.length) continue;
      if (remainingHeaders === 0) part.children = [...copies, ...part.children];
      else remainingHeaders = Math.max(0, remainingHeaders - part.children.length);
    }
  }
  return fragments;
}

function isEmptyCell(cell: DocxElement): boolean {
  return cell.children?.every(block => block.type === 'paragraph' && !block.children?.length) ?? true;
}

function splitSavedCell(blocks: DocxElement[]): Fragment[] | undefined {
  let fragments: Fragment[] | undefined, children: DocxElement[] | undefined;
  for (const [index, block] of blocks.entries()) {
    const parts = block.type === 'paragraph' ? splitParagraph(block, true) : undefined;
    if (!parts) { children?.push(block); continue; }
    fragments ??= [];
    children ??= blocks.slice(0, index);
    for (const part of parts) {
      if (part.children.length) children.push({ ...block, children: part.children });
      if (part.breakAfter) {
        fragments.push({ children, breakAfter: part.breakAfter });
        children = [];
      }
    }
  }
  if (children?.length) fragments!.push({ children });
  return fragments;
}

function splitParagraph(paragraph: DocxElement, savedOnly = false): Fragment[] | undefined {
  const parts = splitInline(paragraph.children ?? [], savedOnly);
  const [first, next] = parts ?? [];
  // Bookmarks at the start of a saved page belong with the text that follows.
  if (next && first.breakAfter === 'lastRenderedPageBreak' && first.children.length
    && first.children.every(child => child.type === 'bookmarkStart' || child.type === 'bookmarkEnd')) {
    next.children = [...first.children, ...next.children];
    first.children = [];
  }
  return parts;
}

export function paragraphText(nodes: readonly DocxElement[]): string | undefined {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text') text += node.text ?? '';
    else if (isNoteReference(node)) text += '\uFFFC';
    else if (node.break === 'textWrapping') text += '\n';
    else if (inlineContainers.has(node.type)) {
      const content = paragraphText(node.children ?? []);
      if (content === undefined) return undefined;
      text += content;
    } else if (node.type !== 'bookmarkStart' && node.type !== 'bookmarkEnd') return undefined;
  }
  return text;
}

function isNoteReference(node: DocxElement): boolean {
  return node.type === 'footnoteReference' || node.type === 'endnoteReference';
}

function insertLineBreaks(nodes: DocxElement[], { cuts, breakAfter }: { cuts: number[]; breakAfter: MeasuredBreak }): DocxElement[] {
  let offset = 0, cutIndex = 0;
  const visit = (nodes: DocxElement[]): DocxElement[] => nodes.flatMap(node => {
    if (inlineContainers.has(node.type) && node.children) return [{ ...node, children: visit(node.children) }];
    const length = node.type === 'text' ? node.text?.length ?? 0 : Number(node.break === 'textWrapping' || isNoteReference(node));
    const start = offset;
    offset += length;
    if (!(cuts[cutIndex] <= offset)) return [node];
    const result: DocxElement[] = [];
    let from = 0;
    while (cuts[cutIndex] <= offset) {
      const to = cuts[cutIndex++] - start;
      if (node.type === 'text') result.push({ ...node, text: node.text!.slice(from, to) });
      else if (isNoteReference(node)) result.push(node);
      result.push({ type: 'break', break: breakAfter });
      from = to;
    }
    if (from < length) result.push({ ...node, text: node.text!.slice(from) });
    return result;
  });
  return visit(nodes);
}

/** Allocate new child lists only when a page break actually divides this inline sequence. */
function splitInline(nodes: readonly DocxElement[], savedOnly = false): Fragment[] | undefined {
  let fragments: Fragment[] | undefined, children: DocxElement[] | undefined;
  for (const [index, node] of nodes.entries()) {
    const breakAfter = node.type === 'break' && (node.break === 'lastRenderedPageBreak'
      || (!savedOnly && (node.break === 'page' || node.break === 'column' || node.break === 'columnOverflow')))
      ? node.break : undefined;
    const nested = inlineContainers.has(node.type) && node.children ? splitInline(node.children, savedOnly) : undefined;
    if (!breakAfter && !nested) { children?.push(node); continue; }
    fragments ??= [];
    children ??= nodes.slice(0, index);
    if (breakAfter) {
      fragments.push({ children, breakAfter });
      children = [];
    } else for (const fragment of nested!) {
      if (fragment.children.length) children.push({ ...node, children: fragment.children });
      if (fragment.breakAfter) {
        fragments.push({ children, breakAfter: fragment.breakAfter });
        children = [];
      }
    }
  }
  if (children?.length) fragments!.push({ children });
  return fragments;
}
