// Shared by XLSX and iWork; importing tables never imports a workbook parser.
import { applyTableCellPaint, buildPreviewFontStack, withTextMeasurementScope } from '@filens/core';
import { resolveCellValue } from './cell-value';
import { formatCellValue } from './number-formats';
import { RowHeights } from './row-heights';
import { ColumnWidths } from './column-widths';
import { sheetColumnWidths } from './xlsx-column-widths';
import { columnIndexToName } from './columns';
import { sheetMerges } from './merged-cells';
import { columnStyleLookup } from './column-styles';
import { conditionalFormattingWindow } from './conditional-formatting';
import type { ParsedCell, ParsedCellStyle, ParsedConditionalStyle, ParsedRichText, ParsedRichTextRun, ParsedRow, ParsedSheet } from './types';
export type { ParsedSheet } from './types';

export type SheetCellRenderer = (element: HTMLTableCellElement, cell: ParsedCell) => void;
export interface SheetRowMeasurements { width?: number; heights: Map<number, number> }
export interface SheetRowWindowOptions { renderCell?: SheetCellRenderer; measurements?: SheetRowMeasurements }

export const ROW_BATCH_SIZE = 100;
export const COLUMN_BATCH_SIZE = 20;

interface ColumnWindow {
  first: number;
  last: number;
  cells(row: ParsedRow): ParsedCell[];
}

const columnStyles = new WeakMap<ParsedSheet, (column: number) => number>();
const scrollHeightLimits = new WeakMap<Document, number>();

function scrollHeightLimit(document: Document): number {
  const known = scrollHeightLimits.get(document);
  if (known !== undefined) return known;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;overflow:auto';
  const spacer = document.createElement('div');
  probe.append(spacer);
  document.body.append(probe);
  // Engines reject oversized CSS heights. Leave room for the header and table borders.
  let limit = Infinity;
  for (const size of [32_000_000, 16_000_000, 8_000_000]) {
    spacer.style.height = `${size}px`;
    if (probe.scrollHeight >= size) { limit = size - 8192; break; }
  }
  probe.remove();
  scrollHeightLimits.set(document, limit);
  return limit;
}

function applyFont(element: HTMLElement, font: ParsedCell['font'], stacks: Map<ParsedCell['font'], string>): void {
  if (font?.fontFamily) {
    let stack = stacks.get(font);
    if (!stack) {
      stack = buildPreviewFontStack(font.fontFamily, font.traits, font.resolvedFontFamily ? [font.resolvedFontFamily] : []);
      stacks.set(font, stack);
    }
    element.style.fontFamily = stack;
  }
  if (font?.traits?.weight) element.style.fontWeight = String(font.traits.weight);
  if (font?.fontStyle) element.style.fontStyle = font.fontStyle;
}

function applyDecoration(element: HTMLElement, underline: ParsedRichTextRun['underline'], strike?: boolean): void {
  if (underline === 'none') underline = undefined;
  if (underline) element.style.textDecorationStyle = underline === 'double' ? 'double' : 'solid';
  if (underline || strike) element.style.textDecorationLine = underline && strike ? 'underline line-through' : underline ? 'underline' : 'line-through';
}

function appendRichText(element: HTMLElement, text: ParsedRichText, style: ParsedCellStyle | undefined,
  date1904: boolean | undefined, stacks: Map<ParsedCell['font'], string>, conditional: ParsedConditionalStyle | undefined): void {
  const wrapper = element.ownerDocument.createElement('span');
  const append = (value: string, run?: ParsedRichTextRun) => {
    if (!value) return;
    const span = element.ownerDocument.createElement('span');
    span.textContent = value;
    applyDecoration(span, conditional?.underline ?? run?.underline ?? style?.underline, conditional?.strike ?? run?.strike ?? style?.strike);
    if (run?.fontSize) span.style.fontSize = `${run.fontSize}px`;
    if (run?.color && !conditional?.color) span.style.color = run.color;
    if (run?.verticalAlign) span.style.verticalAlign = run.verticalAlign;
    applyFont(span, run?.font, stacks);
    if (conditional && run?.font) applyConditionalFont(span, conditional);
    wrapper.append(span);
  };
  // SpreadsheetML cannot contain a literal NUL in a format code; use it to locate @ substitutions.
  const parts = style?.numberFormat === undefined ? ['', ''] : formatCellValue('\0', 'text', style.numberFormat, date1904).split('\0');
  parts.forEach((part, index) => {
    if (index) for (const run of text.runs) append(run.text, run);
    append(part);
  });
  element.append(wrapper);
}

function applyConditionalFont(element: HTMLElement, style: ParsedConditionalStyle): void {
  if (style.bold !== undefined) element.style.fontWeight = style.bold ? '700' : '400';
  if (style.italic !== undefined) element.style.fontStyle = style.italic ? 'italic' : 'normal';
}

function applyCellStyle(element: HTMLTableCellElement, style: ParsedCellStyle, merged: boolean, rich: boolean): void {
  applyTableCellPaint(element, style);
  if (style.borders?.right) element.style.setProperty('--xlsxv-grid-right', 'transparent');
  if (style.borders?.bottom) element.style.setProperty('--xlsxv-grid-bottom', 'transparent');
  if (style.fill?.type === 'gradient') element.style.backgroundRepeat = 'no-repeat';
  if (style.fontSize) element.style.fontSize = style.fontSize + 'px';
  if (style.color) element.style.color = style.color;
  if (style.horizontal) element.style.textAlign = style.horizontal;
  if (style.vertical) element.style.verticalAlign = style.vertical;
  if (style.wrap) element.classList.add('xlsxv-wrap');
  if (!rich) applyDecoration(element, style.underline, style.strike);
  if (style.indent && (style.horizontal === 'left' || style.horizontal === 'right')) {
    const padding = (8 + style.indent * 3 * (style.fontSize ?? 12) / 2) + 'px';
    if (merged) {
      element.style.setProperty('--xlsxv-merge-padding-inline', 'calc(' + padding + ' + 8px)');
      if (style.horizontal === 'left') element.style.setProperty('--xlsxv-merge-padding-left', padding);
    } else if (style.horizontal === 'right') element.style.paddingRight = padding;
    else element.style.paddingLeft = padding;
  }
}

export function createSheetTable(sheet: ParsedSheet, rowCount = Math.max(sheet.rowCount, 1), renderCell?: SheetCellRenderer): HTMLTableElement {
  const widths = new ColumnWidths(Math.max(sheet.columnCount, 1), sheetColumnWidths(sheet, document));
  const table = document.createElement('table');
  table.className = 'xlsxv-table';
  sizeTable(table, sheet, widths);

  table.append(createSheetHeader(sheet, widths));
  const tbody = document.createElement('tbody');
  withTextMeasurementScope(() => appendRows(tbody, sheet, 1, rowCount, sheet.rows, { renderCell, widths }));
  table.append(tbody);
  return table;
}

function sizeTable(table: HTMLTableElement, sheet: ParsedSheet, widths: ColumnWidths, wide = false): void {
  table.style.minWidth = `${widths.before(widths.count + 1) + 48}px`;
  if (sheet.columnWidths) table.classList.add('xlsxv-source-columns');
  if (sheet.cellStyles?.formats.some(style => style.borders) || sheet.conditionalRules?.some(rule => rule.style?.borders)) {
    table.classList.add('xlsxv-custom-borders');
  }
  if (sheet.columnWidths || wide) table.style.width = table.style.minWidth;
}

function createSheetHeader(sheet: ParsedSheet, widths: ColumnWidths, columns?: Pick<ColumnWindow, 'first' | 'last'>): HTMLTableSectionElement {
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'xlsxv-corner';
  corner.style.width = '48px';
  headerRow.appendChild(corner);
  if (columns?.first && columns.first > 1) headerRow.append(columnSpacer(widths.before(columns.first), 'th'));
  for (let column = columns?.first ?? 1; column <= (columns?.last ?? Math.max(sheet.columnCount, 1)); column += 1) {
    const header = document.createElement('th');
    header.className = 'xlsxv-col-header';
    header.textContent = columnIndexToName(column);
    header.setAttribute('aria-colindex', String(column + 1));
    header.scope = 'col';
    if (columns || sheet.columnWidths) header.style.width = `${widths.width(column)}px`;
    headerRow.appendChild(header);
  }
  if (columns && columns.last < sheet.columnCount) headerRow.append(columnSpacer(widths.before(widths.count + 1) - widths.before(columns.last + 1), 'th'));
  thead.appendChild(headerRow);
  return thead;
}

function columnSpacer(pixels: number, tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = document.createElement(tag);
  cell.className = 'xlsxv-column-spacer';
  cell.setAttribute('aria-hidden', 'true');
  const width = `${pixels}px`;
  cell.style.cssText = `width:${width};min-width:${width};max-width:${width};padding:0;border:0`;
  return cell;
}

export function appendSheetRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number, renderCell?: SheetCellRenderer): void {
  const widths = new ColumnWidths(Math.max(sheet.columnCount, 1), sheetColumnWidths(sheet, tbody.ownerDocument));
  withTextMeasurementScope(() => appendRows(tbody, sheet, firstRow, lastRow, sheet.rows, { renderCell, widths }));
}

function appendRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number, rows: Iterable<ParsedRow>, options: { widths: ColumnWidths; columns?: ColumnWindow; renderCell?: SheetCellRenderer; rowHeight?(row: number): number; rowOffset?(row: number): number; clipMerges?: boolean }): void {
  const { columns, renderCell, widths } = options;
  if (firstRow > lastRow) return;
  const mergeIndex = sheetMerges(sheet);
  const mergedRows = mergeIndex?.window(firstRow, lastRow, columns?.first ?? 1,
    columns?.last ?? Math.max(sheet.columnCount, 1), !options.clipMerges);
  const conditionalStyle = conditionalFormattingWindow(sheet, firstRow, lastRow, columns?.first ?? 1,
    columns?.last ?? Math.max(sheet.columnCount, 1));
  const fontStacks = new Map<ParsedCell['font'], string>();
  const formats = sheet.cellStyles?.formats;
  let columnStyle = columnStyles.get(sheet);
  if (!columnStyle && sheet.cellStyles) {
    columnStyle = columnStyleLookup(sheet.cellStyles.columns);
    columnStyles.set(sheet, columnStyle);
  }
  // Index only this batch. Preserve unordered/duplicate rows and caller edits
  // without allocating a complete-sheet map on every scroll.
  const rowMap = new Map<number, ParsedRow>();
  for (const row of rows) {
    if (row.index >= firstRow && row.index <= lastRow) rowMap.set(row.index, row);
  }
  const fragment = document.createDocumentFragment();
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rowMap.get(rowIndex);
    const tr = document.createElement('tr');
    tr.setAttribute('aria-rowindex', String(rowIndex + 1));
    const height = options.rowHeight?.(rowIndex) ?? sheet.rowHeights?.[rowIndex - 1];
    if (height !== undefined && Number.isFinite(height)) tr.style.height = `${Math.max(26, height)}px`;
    const rowHeader = document.createElement('th');
    rowHeader.className = 'xlsxv-row-header';
    rowHeader.scope = 'row';
    rowHeader.setAttribute('aria-colindex', '1');
    rowHeader.style.width = '48px';
    rowHeader.textContent = String(rowIndex);
    tr.appendChild(rowHeader);
    if (columns && columns.first > 1) tr.append(columnSpacer(widths.before(columns.first), 'td'));
    const cells = new Map((row ? columns?.cells(row) ?? row.cells : []).map(cell => [cell.column, cell]));
    const merges = mergedRows?.get(rowIndex) ?? [];
    let mergeAt = 0;
    for (let column = columns?.first ?? 1; column <= (columns?.last ?? Math.max(sheet.columnCount, 1)); column += 1) {
      while (mergeAt < merges.length && merges[mergeAt].lastColumn < column) mergeAt++;
      const merge = merges[mergeAt]?.firstColumn <= column ? merges[mergeAt] : undefined;
      if (merge && (rowIndex !== merge.firstRow || column !== merge.firstColumn)) continue;
      const td = document.createElement('td');
      td.className = 'xlsxv-cell';
      td.setAttribute('aria-colindex', String(column + 1));
      if (columns || sheet.columnWidths) td.style.width = `${widths.before((merge?.lastColumn ?? column) + 1) - widths.before(column)}px`;
      const cell = merge ? merge.cell : cells.get(column);
      const styleIndex = cell ? cell.styleIndex ?? 0
        : merge ? merge.rowStyle ?? columnStyle?.(merge.source.firstColumn) ?? 0
        : row?.styleIndex ?? columnStyle?.(column) ?? 0;
      const baseStyle = formats?.[styleIndex];
      const value = cell ? resolveCellValue(sheet, cell) : '';
      const conditional = conditionalStyle?.(merge?.source.firstRow ?? rowIndex, merge?.source.firstColumn ?? column, cell);
      const style = conditional ? { ...baseStyle, ...conditional,
        ...(conditional.borders && baseStyle?.borders ? { borders: { ...baseStyle.borders, ...conditional.borders } } : {}) } : baseStyle;
      const rich = cell?.richText?.value === value ? cell.richText : undefined;
      if (rich) {
        appendRichText(td, rich, style, sheet.date1904, fontStacks, conditional);
        td.classList.add('xlsxv-formatted-value');
      } else if (cell && style?.numberFormat !== undefined && value) {
        td.textContent = formatCellValue(value, cell.valueType, style.numberFormat, sheet.date1904);
        td.classList.add('xlsxv-formatted-value');
      } else td.textContent = value;
      applyFont(td, cell?.font ?? style?.font, fontStacks);
      if (conditional) applyConditionalFont(td, conditional);
      if (style) applyCellStyle(td, style, Boolean(merge), Boolean(rich));
      if (cell) renderCell?.(td, cell);
      if (merge) {
        td.classList.add('xlsxv-merged-cell');
        td.rowSpan = merge.lastRow - merge.firstRow + 1; td.colSpan = merge.lastColumn - merge.firstColumn + 1;
        if (merge.firstRow > merge.source.firstRow) td.style.borderTop = '0px solid transparent';
        if (merge.lastRow < merge.source.lastRow) {
          td.style.borderBottom = '0px solid transparent';
          td.style.setProperty('--xlsxv-grid-bottom', 'transparent');
        }
        if (merge.firstColumn > merge.source.firstColumn) td.style.borderLeft = '0px solid transparent';
        if (merge.lastColumn < merge.source.lastColumn) {
          td.style.borderRight = '0px solid transparent';
          td.style.setProperty('--xlsxv-grid-right', 'transparent');
        }
        td.dataset.mergeRef = cell?.ref ?? `${columnIndexToName(merge.source.firstColumn)}${merge.source.firstRow}`;
        const clip = document.createElement('div'); clip.className = 'xlsxv-merged-clip';
        const content = document.createElement('div'); content.className = 'xlsxv-merged-content';
        const sourceWidth = widths.before(merge.source.lastColumn + 1) - widths.before(merge.source.firstColumn);
        const visibleWidth = widths.before(merge.lastColumn + 1) - widths.before(merge.firstColumn);
        const sourceLeft = widths.before(merge.source.firstColumn) - widths.before(merge.firstColumn);
        const unit = sheet.columnWidths ? 'px' : '%', scale = sheet.columnWidths ? 1 : 100 / visibleWidth;
        content.style.width = `calc(${scale * sourceWidth}${unit} - var(--xlsxv-merge-padding-inline, 16px))`;
        content.style.left = `calc(${scale * sourceLeft}${unit} + var(--xlsxv-merge-padding-left, 8px))`;
        const before = options.rowOffset ?? (row => mergeIndex!.before(row));
        const height = before(merge.source.lastRow + 1) - before(merge.source.firstRow);
        if (td.style.backgroundImage && td.style.backgroundRepeat === 'no-repeat') {
          td.style.backgroundSize = `${scale * sourceWidth}${unit} ${height}px`;
          td.style.backgroundPosition = `${sheet.columnWidths ? sourceLeft : sourceWidth > visibleWidth ? -100 * sourceLeft / (sourceWidth - visibleWidth) : 0}${unit} ${before(merge.source.firstRow) - before(merge.firstRow)}px`;
          td.style.backgroundRepeat = 'no-repeat';
        }
        if (merge.source.lastRow > merge.source.firstRow) {
          content.style.top = `${before(merge.source.firstRow) - before(merge.firstRow)}px`;
          content.style.maxHeight = `${height}px`;
          content.style.setProperty('--xlsxv-merge-source-height', `${height}px`);
          content.style.setProperty('--xlsxv-merge-image-height', `${Math.max(0, height - 29)}px`);
          if (style?.vertical === 'middle' || style?.vertical === 'bottom') {
            content.classList.add('is-vertically-aligned');
            content.style.justifyContent = style.vertical === 'middle' ? 'center' : 'flex-end';
          }
        } else clip.classList.add('is-single-row');
        content.append(...td.childNodes); clip.append(content); td.append(clip);
      }
      tr.appendChild(td);
    }
    if (columns && columns.last < sheet.columnCount) tr.append(columnSpacer(widths.before(widths.count + 1) - widths.before(columns.last + 1), 'td'));
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

/** Keep a viewport and overscan in the DOM, indexing sparse rows and wide-sheet cells. */
export class SheetRowWindow {
  readonly table: HTMLTableElement;
  private readonly rows: ParsedRow[];
  private readonly observer?: ResizeObserver;
  private frame: number | null = null;
  private first = 0;
  private last = 0;
  private rowHeight = 26;
  private columnFirst = 0;
  private columnLast = 0;
  private readonly wide: boolean;
  private widths: ColumnWidths;
  private readonly cellRows = new WeakMap<ParsedRow, ParsedCell[]>();
  private heights?: RowHeights;
  private readonly measurements: SheetRowMeasurements;
  private previousScrollHeight = 0;
  private destroyed = false;

  constructor(private readonly sheet: ParsedSheet, private readonly grid: HTMLElement, private readonly mount: HTMLElement = grid, private readonly options: SheetRowWindowOptions = {}) {
    this.measurements = options.measurements ?? { heights: new Map() };
    if (sheet.rowHeights || sheet.cellStyles?.variableHeight) {
      this.heights = new RowHeights(Math.max(sheet.rowCount, 1), sheet.rowHeights, this.measurements.heights);
    }
    this.rows = sheet.rows.every((row, index, rows) => !index || row.index >= rows[index - 1].index)
      ? sheet.rows : [...sheet.rows].sort((a, b) => a.index - b.index);
    this.wide = sheet.columnCount > COLUMN_BATCH_SIZE;
    this.widths = new ColumnWidths(Math.max(sheet.columnCount, 1), sheetColumnWidths(sheet, grid.ownerDocument));
    if (this.wide) {
      this.table = document.createElement('table');
      this.table.className = 'xlsxv-table';
      sizeTable(this.table, sheet, this.widths, true);
      this.table.append(document.createElement('thead'), document.createElement('tbody'));
    } else this.table = createSheetTable(sheet, 0);
    this.table.setAttribute('aria-rowcount', String(Math.max(sheet.rowCount, 1) + 1));
    this.table.setAttribute('aria-colcount', String(Math.max(sheet.columnCount, 1) + 1));
    this.table.style.overflowAnchor = 'none';
    if (mount === grid) grid.replaceChildren(this.table);
    else mount.appendChild(this.table);
    this.update();
    grid.addEventListener('scroll', this.schedule, { passive: true });
    if (this.heights) {
      this.table.addEventListener('load', this.schedule, true);
      this.table.addEventListener('error', this.schedule, true);
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule);
      this.observer.observe(grid);
      if (this.heights) {
        this.observer.observe(this.table);
        // Sibling tables can reveal content after this table reaches the bottom.
        if (mount !== grid && mount.parentElement) this.observer.observe(mount.parentElement);
      }
    }
  }

  refresh(): void {
    if (this.destroyed) return;
    if (this.sheet.columnWidthSource) {
      const column = this.widths.at(this.grid.scrollLeft);
      const fraction = (this.grid.scrollLeft - this.widths.before(column)) / this.widths.width(column);
      this.widths = new ColumnWidths(Math.max(this.sheet.columnCount, 1), sheetColumnWidths(this.sheet, this.grid.ownerDocument));
      sizeTable(this.table, this.sheet, this.widths, this.wide);
      this.table.tHead!.replaceWith(createSheetHeader(this.sheet, this.widths,
        this.wide ? { first: this.columnFirst, last: this.columnLast } : undefined));
      this.grid.scrollLeft = this.widths.before(column) + fraction * this.widths.width(column);
      if (this.sheet.cellStyles?.formats.some(style => style.wrap) && this.measurements.width !== undefined) {
        this.measurements.width = -1;
      }
    }
    this.first = 0; this.update();
  }

  destroy(): void {
    this.destroyed = true;
    this.grid.removeEventListener('scroll', this.schedule);
    this.table.removeEventListener('load', this.schedule, true);
    this.table.removeEventListener('error', this.schedule, true);
    this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly schedule = () => {
    if (this.frame !== null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  };

  private visibleCells(row: ParsedRow, first: number, last: number): ParsedCell[] {
    let cells = this.cellRows.get(row);
    if (!cells) {
      cells = row.cells.every((cell, index, cells) => !index || cell.column >= cells[index - 1].column)
        ? row.cells : [...row.cells].sort((a, b) => a.column - b.column);
      this.cellRows.set(row, cells);
    }
    return cells.slice(lowerBound(cells, first, cell => cell.column), lowerBound(cells, last + 1, cell => cell.column));
  }

  private measureRows(): boolean {
    if (!this.heights) return false;
    let changed = false;
    for (const row of this.table.querySelectorAll<HTMLTableRowElement>('tbody tr[aria-rowindex]')) {
      const index = Number(row.getAttribute('aria-rowindex')) - 1;
      const height = this.sheet.cellStyles?.variableHeight ? row.offsetHeight : row.getBoundingClientRect().height;
      if (height > 0 && this.heights.set(index, height)) {
        this.measurements.heights.set(index, this.heights.height(index));
        row.style.height = `${this.heights.height(index)}px`; changed = true;
      }
    }
    return changed;
  }

  private rowOffset(row: number): number {
    return this.heights?.before(row) ?? (row - 1) * this.rowHeight;
  }

  private scrollTrack(total: number, headerHeight: number): { height: number; scale: number } {
    const logicalHeight = this.rowOffset(total + 1);
    const limit = this.mount === this.grid && logicalHeight > 1_000_000 ? scrollHeightLimit(this.grid.ownerDocument) : Infinity;
    const height = Math.min(logicalHeight, limit);
    const visible = Math.max(0, this.grid.clientHeight - headerHeight);
    return { height, scale: height < logicalHeight ? (logicalHeight - visible) / Math.max(1, height - visible) : 1 };
  }

  private update(): void {
    if (this.destroyed) return;
    if (!this.heights) {
      // Far-offscreen client rectangles lose precision at million-row offsets.
      const measured = this.table.querySelector<HTMLTableRowElement>('tbody tr:not(.xlsxv-spacer)')?.offsetHeight;
      if (measured && measured !== this.rowHeight) { this.rowHeight = measured; this.first = 0; }
    }
    // Numbers mounts several tables (and headings) inside one scroll viewport.
    const viewport = this.mount === this.grid ? undefined : this.grid.getBoundingClientRect();
    const bounds = viewport || this.heights ? this.table.getBoundingClientRect() : undefined;
    const top = viewport && bounds ? viewport.top + this.grid.clientTop - bounds.top : this.grid.scrollTop;
    const left = viewport && bounds ? viewport.left + this.grid.clientLeft - bounds.left : this.grid.scrollLeft;
    const total = Math.max(this.sheet.rowCount, 1), headerHeight = this.table.tHead!.getBoundingClientRect().height || 26;
    let track = this.scrollTrack(total, headerHeight);
    let rowTop = track.scale > 1 ? top * track.scale : top - (this.heights ? headerHeight : 0);
    let restoreTop: number | undefined;
    const atBottom = this.grid.scrollTop > 0 && this.grid.clientHeight > 0 && this.previousScrollHeight > 0
      && this.grid.scrollTop + this.grid.clientHeight >= this.previousScrollHeight - 2;
    if (this.heights) {
      const y = Math.max(0, rowTop), oldTotal = this.heights.before(total + 1);
      const anchor = y >= oldTotal ? total + 1 : this.heights.at(y), oldOffset = this.heights.before(anchor);
      let changed = false;
      // Column spacers can change collapsed borders without changing cell layout.
      const width = this.sheet.columnWidths ? this.widths.before(this.widths.count + 1)
        : this.table.querySelector('.xlsxv-col-header')?.getBoundingClientRect().width ?? 0;
      const widthChanged = width > 0 && this.measurements.width !== undefined && Math.abs(width - this.measurements.width) > .5;
      if (widthChanged && (!this.sheet.columnWidthSource || this.sheet.cellStyles?.formats.some(style => style.wrap))) {
        this.measurements.heights.clear(); this.heights = new RowHeights(total, this.sheet.rowHeights);
        for (const row of this.table.querySelectorAll<HTMLTableRowElement>('tbody tr[aria-rowindex]')) {
          row.style.height = `${this.heights.height(Number(row.getAttribute('aria-rowindex')) - 1)}px`;
        }
        changed = true;
      }
      if (width > 0) this.measurements.width = width;
      // After a font refresh, the old rows still carry their previous font styles.
      if (!changed || !this.sheet.columnWidthSource) changed = this.measureRows() || changed;
      if (changed) {
        const within = y - oldOffset;
        const delta = this.heights.before(anchor) - oldOffset
          + (anchor <= total ? Math.min(within, Math.max(0, this.heights.height(anchor) - 1)) - within : 0);
        const nextTrack = this.scrollTrack(total, headerHeight);
        if (track.scale > 1 || nextTrack.scale > 1) {
          rowTop = Math.max(0, y + delta);
          restoreTop = nextTrack.scale > 1 ? rowTop / nextTrack.scale : rowTop + headerHeight;
        } else {
          this.grid.scrollTop += delta;
          rowTop += delta;
        }
        track = nextTrack; this.first = 0;
      }
    }
    const count = Math.max(ROW_BATCH_SIZE, Math.ceil(this.grid.clientHeight / this.rowHeight) + 20);
    const rowAtTop = this.heights ? this.heights.at(Math.max(0, rowTop)) : Math.floor(rowTop / this.rowHeight) + 1;
    const first = Math.min(Math.max(1, rowAtTop - 10), Math.max(1, total - count + 1));
    const last = Math.min(total, first + count - 1);
    const visibleFirst = this.widths.at(left), visibleLast = this.widths.at(left + Math.max(0, this.grid.clientWidth - 48));
    const columnCount = Math.max(COLUMN_BATCH_SIZE, visibleLast - visibleFirst + 1 + 8);
    const firstColumn = this.wide ? Math.min(Math.max(1, visibleFirst - 4), Math.max(1, this.sheet.columnCount - columnCount + 1)) : 1;
    const lastColumn = this.wide ? Math.min(this.sheet.columnCount, firstColumn + columnCount - 1) : this.sheet.columnCount;
    let before = this.rowOffset(first), after = this.rowOffset(total + 1) - this.rowOffset(last + 1);
    if (track.scale > 1) {
      // Compress only unmounted rows. Align full-height visible rows to the logical scroll position.
      const empty = Math.max(0, track.height - (this.rowOffset(last + 1) - before));
      before = Math.max(0, Math.min(empty, before + (restoreTop ?? top) - rowTop));
      after = empty - before;
    }
    if (first === this.first && last === this.last && firstColumn === this.columnFirst && lastColumn === this.columnLast) {
      if (track.scale > 1) {
        const rows = this.table.tBodies[0].rows;
        rows[0].cells[0].style.height = `${before}px`;
        rows[rows.length - 1].cells[0].style.height = `${after}px`;
      }
    } else {
      this.first = first; this.last = last;
      const columns: ColumnWindow | undefined = this.wide ? { first: firstColumn, last: lastColumn, cells: row => this.visibleCells(row, firstColumn, lastColumn) } : undefined;
      if (columns && (firstColumn !== this.columnFirst || lastColumn !== this.columnLast)) this.table.tHead!.replaceWith(createSheetHeader(this.sheet, this.widths, columns));
      this.columnFirst = firstColumn; this.columnLast = lastColumn;
      const body = document.createElement('tbody');
      withTextMeasurementScope(() => appendRows(body, this.sheet, first, last,
        this.rows.slice(lowerBound(this.rows, first, row => row.index), lowerBound(this.rows, last + 1, row => row.index)),
        { widths: this.widths, columns, renderCell: this.options.renderCell, rowHeight: this.heights ? row => this.heights!.height(row) : undefined,
          rowOffset: row => this.rowOffset(row), clipMerges: true }));
      body.prepend(this.spacer(before));
      body.append(this.spacer(after));
      this.table.tBodies[0].replaceWith(body);
    }
    if (atBottom && (this.heights || track.scale > 1)) this.grid.scrollTop = Math.max(0, this.grid.scrollHeight - this.grid.clientHeight);
    else if (restoreTop !== undefined) this.grid.scrollTop = restoreTop;
    this.previousScrollHeight = this.grid.scrollHeight;
  }

  private spacer(height: number): HTMLTableRowElement {
    const row = document.createElement('tr'); row.className = 'xlsxv-spacer'; row.setAttribute('aria-hidden', 'true');
    const cell = document.createElement('td'); cell.colSpan = this.table.tHead!.rows[0].cells.length;
    cell.style.cssText = `height:${height}px;padding:0;border:0`; row.append(cell); return row;
  }

}

function lowerBound<T>(items: readonly T[], value: number, coordinate: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (coordinate(items[middle]) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
