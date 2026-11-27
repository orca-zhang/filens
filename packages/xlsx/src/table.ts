// Shared by XLSX and iWork; importing tables never imports a workbook parser.
import { applyTableCellPaint, applyTint, buildPreviewFontStack, lineStyleToBorder, withTextMeasurementScope } from '@filens/core';
import { displaySpillCell, hasSourceValue, resolveCellValue } from './cell-value';
import { withFormulaTime } from './formula-clock';
import { resolveSharedFormula } from './shared-formulas';
import { createShrinkTextFitter } from './shrink-text';
import { createRotatedTextLayout } from './text-rotation';
import { canOverflowRotation, rotatedOverflowRow } from './rotated-overflow';
import { centeredRanges, paintCenteredRange } from './center-across';
import { formatCellValue, type FormattedCellValue } from './number-formats';
import { createNumberLayout } from './number-format-layout';
import { RowHeights } from './row-heights';
import { fixedRowHeight, sourceRowHeight, XLSX_MAX_ROW_HEIGHT } from './xlsx-row-heights';
import { ColumnWidths } from './column-widths';
import { sheetColumnWidths } from './xlsx-column-widths';
import { columnIndexToName } from './columns';
import { sheetMerges } from './merged-cells';
import { paintMergeBorders } from './merge-borders';
import { columnStyleLookup } from './column-styles';
import { conditionalFormattingWindow } from './conditional-formatting';
import { createConditionalIcon } from './conditional-icons';
import { sheetTracks, VisibleTracks } from './visible-tracks';
import { csvPreviewData } from './csv-preview-data';
import type { DataBarAppearance } from './conditional-visuals';
import type { ParsedCell, ParsedCellStyle, ParsedConditionalIcon, ParsedConditionalStyle, ParsedRichText, ParsedRichTextRun, ParsedRow, ParsedSheet } from './types';
export type { ParsedSheet } from './types';
export { addHiddenTrack, sheetTracks } from './visible-tracks';

export type SheetCellRenderer = (element: HTMLTableCellElement, cell: ParsedCell) => void;
export type SheetBlankCellRenderer = (element: HTMLTableCellElement, row: number, column: number) => void;
export interface SheetRowMeasurements { width?: number; heights: Map<number, number> }
export interface SheetRowWindowOptions {
  renderCell?: SheetCellRenderer;
  renderBlankCell?: SheetBlankCellRenderer;
  measurements?: SheetRowMeasurements;
  calculationPending?: () => boolean;
}

interface SheetScrollPosition {
  row: number;
  rowOffset: number;
  column: number;
  columnOffset: number;
  columnCount?: number;
}

export const ROW_BATCH_SIZE = 100;
export const COLUMN_BATCH_SIZE = 20;
const MAX_XLSX_COLUMNS = 16_384;

interface ColumnWindow {
  first: number;
  last: number;
  cells(row: ParsedRow): ParsedCell[];
}

interface RowHeightMeasurement {
  first: number;
  last: number;
  height: number;
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
  stacks: Map<ParsedCell['font'], string>, conditional: ParsedConditionalStyle | undefined, formatted?: FormattedCellValue): void {
  const wrapper = element.ownerDocument.createElement('span');
  const append = (value: string, run?: ParsedRichTextRun) => {
    if (!value) return;
    const span = element.ownerDocument.createElement('span');
    span.textContent = value;
    applyDecoration(span, conditional?.underline ?? run?.underline ?? style?.underline, conditional?.strike ?? run?.strike ?? style?.strike);
    if (run?.fontSize) span.style.fontSize = `${run.fontSize}px`;
    if (run?.color && !conditional?.color && !formatted?.color) span.style.color = run.color;
    if (run?.verticalAlign) span.style.verticalAlign = run.verticalAlign;
    applyFont(span, run?.font, stacks);
    if (conditional && run?.font) applyConditionalFont(span, conditional);
    wrapper.append(span);
  };
  const parts = (formatted?.text ?? '\0').split('\0');
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

function appendDataBar(cell: HTMLTableCellElement, appearance: DataBarAppearance,
  geometry?: { top: string; left: string; width: string; height: string }): void {
  const document = cell.ownerDocument;
  const clip = document.createElement('span'); clip.className = 'xlsxv-data-bar-clip';
  clip.setAttribute('aria-hidden', 'true');
  const track = document.createElement('span'); track.className = 'xlsxv-data-bar-track';
  if (geometry) Object.assign(track.style, { right: 'auto', bottom: 'auto', ...geometry });
  if (appearance.width > 0) {
    const fill = document.createElement('span'); fill.className = 'xlsxv-data-bar-fill';
    fill.style.left = `${appearance.start}%`;
    fill.style.width = `${appearance.width}%`;
    fill.style.background = appearance.gradient
      ? `linear-gradient(to ${appearance.gradient}, ${appearance.color}, ${applyTint(appearance.color, .78)})` : appearance.color;
    if (appearance.borderColor) fill.style.border = `1px solid ${appearance.borderColor}`;
    track.append(fill);
  }
  if (appearance.axis) {
    const axis = document.createElement('span'); axis.className = 'xlsxv-data-bar-axis';
    axis.style.left = `${appearance.axis.position}%`;
    axis.style.borderColor = appearance.axis.color;
    track.append(axis);
  }
  clip.append(track);
  cell.classList.add('xlsxv-data-bar-cell');
  cell.append(clip);
}

function applyConditionalIcon(cell: HTMLTableCellElement, reference: ParsedConditionalIcon | null, showValue: boolean): void {
  const document = cell.ownerDocument;
  const icon = reference ? createConditionalIcon(document, reference.set, reference.index) : undefined;
  if (!icon && showValue) return;
  const numberLayout = cell.firstElementChild;
  if (icon && showValue && numberLayout?.classList.contains('xlsxv-number-layout')) {
    icon.dataset.withValue = '';
    numberLayout.prepend(icon);
    return;
  }
  // Keep the icon and value on one line inside vertically aligned merged cells.
  const content = document.createElement('span');
  if (icon) {
    if (showValue) icon.dataset.withValue = '';
    content.append(icon);
  }
  if (showValue) content.append(...cell.childNodes);
  else {
    const value = document.createElement('span');
    value.className = 'xlsxv-icon-hidden-value';
    value.append(...cell.childNodes);
    content.append(value);
  }
  cell.append(content);
}

function applyCellStyle(element: HTMLTableCellElement, style: ParsedCellStyle, merged: boolean, rich: boolean, indent: number): void {
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
  if (indent) {
    const padding = `${8 + indent}px`;
    if (merged) {
      element.style.setProperty('--xlsxv-merge-padding-inline', 'calc(' + padding + ' + 8px)');
      if (style.horizontal === 'left') element.style.setProperty('--xlsxv-merge-padding-left', padding);
    } else if (style.horizontal === 'right') element.style.paddingRight = padding;
    else element.style.paddingLeft = padding;
  }
}

export function createSheetTable(sheet: ParsedSheet, rowCount = Math.max(sheet.rowCount, 1),
  renderCell?: SheetCellRenderer, renderBlankCell?: SheetBlankCellRenderer): HTMLTableElement {
  const widths = columnWidthsFor(sheet, document);
  const table = document.createElement('table');
  table.className = 'xlsxv-table';
  sizeTable(table, sheet, widths);
  if (sheet.hiddenRows?.length || sheet.hiddenColumns?.length) {
    table.setAttribute('aria-rowcount', String(Math.max(sheet.rowCount, 1) + 1));
    table.setAttribute('aria-colcount', String(widths.count + 1));
  }

  table.append(createSheetHeader(sheet, widths));
  const tbody = document.createElement('tbody');
  withFormulaTime(sheet, () => withTextMeasurementScope(() =>
    appendRows(tbody, sheet, 1, rowCount, sheet.rows, { renderCell, renderBlankCell, widths })));
  table.append(tbody);
  return table;
}

function columnWidthsFor(sheet: ParsedSheet, document: Document, count?: number): ColumnWidths {
  const { columns } = sheetTracks(sheet);
  const tracks = count === undefined || count === columns.sourceCount ? columns : new VisibleTracks(count, sheet.hiddenColumns);
  return new ColumnWidths(tracks.sourceCount, sheetColumnWidths(sheet, document, tracks.sourceCount), tracks);
}

function sizeTable(table: HTMLTableElement, sheet: ParsedSheet, widths: ColumnWidths, wide = false): void {
  table.style.minWidth = `${widths.before(widths.count + 1) + 48}px`;
  if (sheet.columnWidthSource) table.style.setProperty('--xlsxv-max-row-height', `${XLSX_MAX_ROW_HEIGHT}px`);
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
  const { tracks } = widths;
  const first = tracks.before(columns?.first ?? 1), last = tracks.before((columns?.last ?? widths.count) + 1);
  const left = widths.before(columns?.first ?? 1), right = widths.before(widths.count + 1) - widths.before((columns?.last ?? widths.count) + 1);
  if (left) headerRow.append(columnSpacer(left, 'th'));
  for (let ordinal = first + 1; ordinal <= last; ordinal++) {
    const column = tracks.source(ordinal);
    const header = document.createElement('th');
    header.className = 'xlsxv-col-header';
    header.textContent = columnIndexToName(column);
    header.setAttribute('aria-colindex', String(column + 1));
    header.scope = 'col';
    if (columns || sheet.columnWidths) header.style.width = `${widths.width(column)}px`;
    headerRow.appendChild(header);
  }
  if (right) headerRow.append(columnSpacer(right, 'th'));
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

export function appendSheetRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number,
  renderCell?: SheetCellRenderer, renderBlankCell?: SheetBlankCellRenderer): void {
  const widths = columnWidthsFor(sheet, tbody.ownerDocument);
  withFormulaTime(sheet, () => withTextMeasurementScope(() =>
    appendRows(tbody, sheet, firstRow, lastRow, sheet.rows, { renderCell, renderBlankCell, widths })));
}

function appendRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number, rows: Iterable<ParsedRow>,
  options: Pick<SheetRowWindowOptions, 'renderCell' | 'renderBlankCell'> & {
    widths: ColumnWidths; columns?: ColumnWindow; rowHeight?(row: number): number; rowOffset?(row: number): number;
    clipMerges?: boolean; calculationPending?: boolean; extendColumns?(end: number): void
  }): void {
  const { columns, renderCell, renderBlankCell, widths } = options;
  if (firstRow > lastRow) return;
  const { rows: rowTracks } = sheetTracks(sheet), columnTracks = widths.tracks;
  const first = rowTracks.before(firstRow), last = rowTracks.before(lastRow + 1);
  if (first === last) return;
  const leftSource = columns?.first ?? 1, rightSource = columns?.last ?? widths.count;
  const left = columnTracks.before(leftSource), right = columnTracks.before(rightSource + 1);
  const beforeWidth = widths.before(leftSource), afterWidth = widths.before(widths.count + 1) - widths.before(rightSource + 1);
  const csv = csvPreviewData.get(sheet);
  const mergeIndex = sheetMerges(sheet);
  const mergedRows = mergeIndex?.window(firstRow, lastRow, leftSource, rightSource, !options.clipMerges);
  const before = options.rowOffset ?? (row => mergeIndex!.before(row));
  const conditionalStyle = options.calculationPending ? undefined
    : conditionalFormattingWindow(sheet, firstRow, lastRow, leftSource, rightSource);
  const fontStacks = new Map<ParsedCell['font'], string>();
  let fitText: ReturnType<typeof createShrinkTextFitter> | null;
  let layoutNumber: ReturnType<typeof createNumberLayout> | undefined;
  let layoutRotation: ReturnType<typeof createRotatedTextLayout> | undefined;
  const formats = sheet.cellStyles?.formats;
  const rotatedOverflow = sheet.columnWidths && formats?.some(canOverflowRotation);
  const centerAcross = sheet.columnWidths && formats?.some(style => style.centerAcross);
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
  for (let ordinal = first + 1; ordinal <= last; ordinal++) {
    const rowIndex = rowTracks.source(ordinal);
    const { rowHeightSource } = sheet;
    const fixed = fixedRowHeight(rowHeightSource, rowIndex);
    const row = rowMap.get(rowIndex);
    const csvStart = csv?.rowOffsets[rowIndex - 1] ?? 0, csvEnd = csv?.rowOffsets[rowIndex] ?? 0;
    const tr = document.createElement('tr');
    tr.setAttribute('aria-rowindex', String(rowIndex + 1));
    const height = options.rowHeight?.(rowIndex) ?? sourceRowHeight(rowHeightSource, rowIndex)
      ?? sheet.rowHeights?.[rowIndex - 1] ?? (fixed ? 26 : undefined);
    if (height !== undefined && Number.isFinite(height)) tr.style.height = `${rowHeightSource ? height : Math.max(26, height)}px`;
    if (rowHeightSource) tr.classList.add('xlsxv-source-row');
    if (fixed) tr.classList.add('xlsxv-fixed-row');
    const rowHeader = document.createElement('th');
    rowHeader.className = 'xlsxv-row-header';
    rowHeader.scope = 'row';
    rowHeader.setAttribute('aria-colindex', '1');
    rowHeader.style.width = '48px';
    const label = rowHeightSource ? document.createElement('span') : rowHeader;
    label.textContent = String(rowIndex);
    if (rowHeightSource) rowHeader.append(label);
    tr.appendChild(rowHeader);
    const beforeSpacer = beforeWidth ? columnSpacer(beforeWidth, 'td') : undefined;
    const afterSpacer = afterWidth ? columnSpacer(afterWidth, 'td') : undefined;
    if (beforeSpacer) tr.append(beforeSpacer);
    const ordered = row && (columns?.cells(row) ?? row.cells);
    const visible = ordered && columns
      ? ordered.slice(lowerBound(ordered, leftSource, cellColumn), lowerBound(ordered, rightSource + 1, cellColumn)) : ordered;
    const cells = visible && new Map(visible.map(cell => [cell.column, cell]));
    const overflow = rotatedOverflow && ordered?.length ? rotatedOverflowRow(sheet, tr, rowIndex,
      columns ? ordered : [...ordered].sort((a, b) => a.column - b.column), widths, leftSource, rightSource, options.extendColumns) : undefined;
    const centered = centerAcross && row ? centeredRanges(sheet, row, widths) : [];
    let centerAt = lowerBound(centered, leftSource, range => range.last);
    const carried = beforeSpacer && centered[centerAt]?.anchor.column < leftSource ? centered[centerAt].anchor : undefined;
    const beforeAnchor = carried ?? (beforeSpacer && overflow?.offscreen(-1));
    const afterAnchor = afterSpacer && overflow?.offscreen(1);
    const merges = mergedRows?.get(rowIndex) ?? [];
    let mergeAt = 0;
    for (let slot = beforeAnchor ? left : left + 1; slot <= right + Number(Boolean(afterAnchor)); slot++) {
      const outside = slot === left ? beforeAnchor : slot > right ? afterAnchor : undefined;
      const column = outside?.column ?? columnTracks.source(slot);
      const col = outside ? columnTracks.before(column) + 1 : slot;
      while (mergeAt < merges.length && merges[mergeAt].lastColumn < column) mergeAt++;
      const merge = !outside && merges[mergeAt]?.firstColumn <= column ? merges[mergeAt] : undefined;
      if (merge && (rowIndex !== merge.firstRow || column !== merge.firstColumn)) continue;
      while (centered[centerAt]?.last < column) centerAt++;
      const center = !merge && centered[centerAt]?.anchor.column === column ? centered[centerAt] : undefined;
      const td = document.createElement('td');
      td.className = 'xlsxv-cell';
      td.setAttribute('aria-colindex', String(column + 1));
      if (columns || sheet.columnWidths) td.style.width = `${widths.before((merge?.lastColumn ?? column) + 1) - widths.before(column)}px`;
      if (csv) {
        const index = csvStart + column - 1;
        td.textContent = index < csvEnd ? csv.valueAt(index) : '';
        tr.appendChild(td);
        continue;
      }
      const source = outside ?? (merge ? merge.cell : cells?.get(column));
      const cell = options.calculationPending || !sheet.arrayFormulas?.length ? source
        : displaySpillCell(sheet, merge?.source.firstRow ?? rowIndex, merge?.source.firstColumn ?? column, source);
      const styleIndex = source ? source.styleIndex ?? 0
        : merge ? merge.rowStyle ?? columnStyle?.(merge.source.firstColumn) ?? 0
        : row?.styleIndex ?? columnStyle?.(column) ?? 0;
      const baseStyle = formats?.[styleIndex];
      const formula = sheet.showFormulas && cell ? cell.formula ?? resolveSharedFormula(sheet, cell) : undefined;
      const value = cell && (!formula || conditionalStyle) && (!cell.missingValue || hasSourceValue(cell))
        ? options.calculationPending ? cell.value : resolveCellValue(sheet, cell) : '';
      const conditional = conditionalStyle?.(merge?.source.firstRow ?? rowIndex, merge?.source.firstColumn ?? column, cell);
      const style = conditional ? { ...baseStyle, ...conditional,
        ...(conditional.borders && baseStyle?.borders ? { borders: { ...baseStyle.borders, ...conditional.borders } } : {}) } : baseStyle;
      const indent = style?.indent && (style.horizontal === 'left' || style.horizontal === 'right')
        ? style.indent * 3 * (style.fontSize ?? 12) / 2 : 0;
      const rich = !formula && cell?.richText?.value === value ? cell.richText : undefined;
      // SpreadsheetML cannot contain a literal NUL in a format code; use it to locate @ substitutions.
      const formatted = cell && !formula && (value || rich) && style?.numberFormat !== undefined
        ? formatCellValue(rich ? '\0' : value, rich ? 'text' : cell.valueType, style.numberFormat, sheet.date1904, sheet.numberFormatPalette)
        : undefined;
      const rotation = style?.textRotation;
      const vertical = style?.vertical ?? (rotation || center ? 'bottom' : undefined);
      const shrink = style?.shrinkToFit && !style.wrap && !formula;
      const spanEnd = center?.last ?? merge?.source.lastColumn ?? column;
      if (formula) {
        td.textContent = '=' + formula.replace(/^=/, '');
        td.classList.add('xlsxv-formatted-value');
      } else if (options.calculationPending && cell?.needsCalculation) {
        td.textContent = '…';
        td.setAttribute('aria-busy', 'true');
      } else if (rich || formatted) {
        td.classList.add('xlsxv-formatted-value');
        if (!formatted?.spacing || shrink) {
          if (rich) appendRichText(td, rich, style, fontStacks, conditional, formatted);
          else if (formatted) td.textContent = formatted.text;
        }
      } else td.textContent = value;
      applyFont(td, cell?.font ?? style?.font, fontStacks);
      if (conditional) applyConditionalFont(td, conditional);
      if (style) applyCellStyle(td, style, Boolean(merge), Boolean(rich), indent);
      if (formatted?.alignRight) {
        td.classList.add('xlsxv-number-tabular');
        if (!style?.horizontal) td.style.textAlign = 'right';
      }
      if (formatted?.color && !conditional?.color) td.style.color = formatted.color;
      const dataBar = conditional?.dataBar;
      const iconSet = conditional?.iconSet;
      let shrunk = false;
      if (shrink && !rotation && td.hasChildNodes() && dataBar?.showValue !== false && iconSet?.showValue !== false) {
        if (fitText === undefined) fitText = createShrinkTextFitter(td.ownerDocument) ?? null;
        const width = widths.before(spanEnd + 1) - widths.before(merge?.source.firstColumn ?? column);
        shrunk = Boolean(fitText?.(td, width, indent, Boolean(rich), Boolean(iconSet?.icon)));
      }
      if (formatted?.spacing && !shrunk) {
        if (shrink) td.replaceChildren();
        const append = rich ? (target: HTMLElement, text: string) =>
          appendRichText(target, rich, style, fontStacks, conditional, { text, color: formatted.color }) : undefined;
        (layoutNumber ??= createNumberLayout(td.ownerDocument))(td, formatted, !style?.wrap && !/[\r\n]/.test(value), append);
      }
      if (cell) renderCell?.(td, cell);
      else renderBlankCell?.(td, merge?.source.firstRow ?? rowIndex, merge?.source.firstColumn ?? column);
      if (iconSet) applyConditionalIcon(td, iconSet.icon, Boolean(formula) || (iconSet.showValue && dataBar?.showValue !== false));
      else if (dataBar && !dataBar.showValue && !formula) {
        const value = td.ownerDocument.createElement('span');
        value.className = 'xlsxv-data-bar-hidden-value';
        value.append(...td.childNodes); td.append(value);
      }
      if (rotation && td.hasChildNodes()) {
        td.style.verticalAlign = vertical!;
        if (!td.style.textAlign && !formula && cell) {
          if (cell.valueType === 'boolean' || cell.valueType === 'error') td.style.textAlign = 'center';
          else if (cell.valueType === 'date' || (!cell.valueType && value.trim() && Number.isFinite(Number(value)))) {
            td.style.textAlign = 'right';
          }
        }
        const width = widths.before(spanEnd + 1) - widths.before(merge?.source.firstColumn ?? column);
        const source = merge?.source;
        const sourceHeight = source && rowTracks.before(source.lastRow + 1) - rowTracks.before(source.firstRow) > 1
          ? before(source.lastRow + 1) - before(source.firstRow) : fixed ? height ?? 26 : undefined;
        const host = slot === left ? beforeSpacer! : slot > right ? afterSpacer! : td;
        const overflowPlacement = overflow && !merge && !center && canOverflowRotation(style) && (formula || cell?.valueType === 'text')
          && !dataBar && !iconSet ? overflow.at(column, host, indent) : undefined;
        (layoutRotation ??= createRotatedTextLayout(td.ownerDocument)).add(td, {
          rotation, width: Math.max(1, width - 16 - indent),
          height: sourceHeight === undefined ? undefined : Math.max(1, sourceHeight - (merge ? 8 : 4)),
          compact: Boolean(rowHeightSource), wrap: style?.wrap, shrink: Boolean(shrink) && !/[\r\n]/.test(td.textContent ?? ''),
          overflow: overflowPlacement
        });
      }
      if (center && td.hasChildNodes()) {
        td.style.verticalAlign = vertical!;
        paintCenteredRange(td, outside ? beforeSpacer! : td, center, widths, leftSource, rightSource, fixed, Boolean(rowHeightSource));
      }
      if (outside) continue;
      if (merge) {
        td.classList.add('xlsxv-merged-cell');
        const top = rowTracks.before(merge.firstRow), bottom = rowTracks.before(merge.lastRow + 1);
        const sourceTop = rowTracks.before(merge.source.firstRow), sourceBottom = rowTracks.before(merge.source.lastRow + 1);
        const lastColumn = columnTracks.before(merge.lastColumn + 1);
        td.rowSpan = bottom - top; td.colSpan = lastColumn - col + 1;
        td.dataset.mergeRef = cell?.ref ?? `${columnIndexToName(merge.source.firstColumn)}${merge.source.firstRow}`;
        const clip = document.createElement('div'); clip.className = 'xlsxv-merged-clip';
        const content = document.createElement('div'); content.className = 'xlsxv-merged-content';
        const sourceWidth = widths.before(merge.source.lastColumn + 1) - widths.before(merge.source.firstColumn);
        const visibleWidth = widths.before(merge.lastColumn + 1) - widths.before(merge.firstColumn);
        const sourceLeft = widths.before(merge.source.firstColumn) - widths.before(merge.firstColumn);
        const unit = sheet.columnWidths ? 'px' : '%', scale = sheet.columnWidths ? 1 : 100 / visibleWidth;
        content.style.width = `calc(${scale * sourceWidth}${unit} - var(--xlsxv-merge-padding-inline, 16px))`;
        content.style.left = `calc(${scale * sourceLeft}${unit} + var(--xlsxv-merge-padding-left, 8px))`;
        const height = before(merge.source.lastRow + 1) - before(merge.source.firstRow);
        content.style.setProperty('--xlsxv-merge-paint-height', `${height}px`);
        if (td.style.backgroundImage && td.style.backgroundRepeat === 'no-repeat') {
          td.style.backgroundSize = `${scale * sourceWidth}${unit} ${height}px`;
          td.style.backgroundPosition = `${sheet.columnWidths ? sourceLeft : sourceWidth > visibleWidth ? -100 * sourceLeft / (sourceWidth - visibleWidth) : 0}${unit} ${before(merge.source.firstRow) - before(merge.firstRow)}px`;
          td.style.backgroundRepeat = 'no-repeat';
        }
        if (sourceBottom - sourceTop > 1 || fixed) {
          content.style.top = `${before(merge.source.firstRow) - before(merge.firstRow)}px`;
          content.style.maxHeight = `${height}px`;
          content.style.setProperty('--xlsxv-merge-source-height', `${height}px`);
          content.style.setProperty('--xlsxv-merge-image-height', `${Math.max(0, height - 29)}px`);
          if (vertical === 'middle' || vertical === 'bottom') {
            content.classList.add('is-vertically-aligned');
            content.style.justifyContent = vertical === 'middle' ? 'center' : 'flex-end';
          }
        } else clip.classList.add('is-single-row');
        content.append(...td.childNodes); clip.append(content); td.append(clip);
        if (dataBar) appendDataBar(td, dataBar, {
          left: `calc(${scale * sourceLeft}${unit} + 2px)`, width: `calc(${scale * sourceWidth}${unit} - 4px)`,
          top: `${before(merge.source.firstRow) - before(merge.firstRow) + 2}px`, height: `${Math.max(0, height - 4)}px`
        });
        if (style?.diagonal) appendDiagonal(td, style.diagonal, {
          ...(sourceWidth !== visibleWidth ? { left: `${scale * sourceLeft}${unit}`, width: `${scale * sourceWidth}${unit}` } : {}),
          ...(top !== sourceTop || bottom !== sourceBottom ? { top: `${before(merge.source.firstRow) - before(merge.firstRow)}px`, height: `${height}px` } : {})
        });
        paintMergeBorders(td, merge, mergeIndex!, style?.borders, conditional?.borders, widths, rowTracks, before, sheet.mergeBorderRuns);
      } else {
        if (fixed && !center && td.hasChildNodes()) clipFixedCell(td, vertical);
        else if (sheet.columnWidthSource && !center && !rotation && td.hasChildNodes() && (style?.wrap
          || ((formula || formatted) && /[\r\n]/.test(formatted?.text ?? formula ?? value))
          || (style?.fontSize ?? 0) > XLSX_MAX_ROW_HEIGHT / 2
          || rich?.runs.some(run => (run.fontSize ?? 0) > XLSX_MAX_ROW_HEIGHT / 2))) {
          const clip = td.ownerDocument.createElement('div');
          clip.className = 'xlsxv-auto-row-clip';
          clip.append(...td.childNodes);
          td.append(clip);
        }
        if (dataBar) appendDataBar(td, dataBar);
        if (style?.diagonal) appendDiagonal(td, style.diagonal);
      }
      tr.appendChild(td);
    }
    if (afterSpacer) tr.append(afterSpacer);
    fragment.appendChild(tr);
  }
  layoutRotation?.finish();
  tbody.appendChild(fragment);
}

function appendDiagonal(cell: HTMLTableCellElement, { line, up, down }: NonNullable<ParsedCellStyle['diagonal']>,
  geometry?: Partial<Pick<CSSStyleDeclaration, 'top' | 'left' | 'width' | 'height'>>): void {
  if (!line.width || (!up && !down)) return;
  const doc = cell.ownerDocument;
  const clip = doc.createElement('div'), source = doc.createElement('div');
  cell.classList.add('xlsxv-has-diagonal');
  clip.className = 'xlsxv-diagonal-clip';
  clip.setAttribute('aria-hidden', 'true');
  source.className = 'xlsxv-diagonal-source';
  if (geometry) Object.assign(source.style, geometry);
  const border = lineStyleToBorder(line);
  for (const direction of ['up', 'down'] as const) if (direction === 'up' ? up : down) {
    const stroke = doc.createElement('span');
    stroke.className = `is-${direction}`;
    stroke.style.borderTop = border;
    source.append(stroke);
  }
  clip.append(source);
  cell.append(clip);
}

function clipFixedCell(cell: HTMLTableCellElement, vertical?: ParsedCellStyle['vertical']): void {
  const clip = cell.ownerDocument.createElement('div');
  clip.className = 'xlsxv-fixed-clip';
  if (vertical === 'middle' || vertical === 'bottom') clip.style.alignContent = vertical === 'middle' ? 'center' : 'end';
  if (cell.style.paddingLeft) { clip.style.paddingLeft = cell.style.paddingLeft; cell.style.paddingLeft = ''; }
  if (cell.style.paddingRight) { clip.style.paddingRight = cell.style.paddingRight; cell.style.paddingRight = ''; }
  const value = cell.ownerDocument.createElement('div');
  value.append(...cell.childNodes);
  clip.append(value);
  cell.append(clip);
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
  private wide: boolean;
  private rowTracks: VisibleTracks;
  private widths: ColumnWidths;
  private overflowWidths?: ColumnWidths;
  private readonly cellRows = new WeakMap<ParsedRow, ParsedCell[]>();
  private heights?: RowHeights;
  private readonly measurements: SheetRowMeasurements;
  private readonly observedRowHeights = new Map<number, RowHeightMeasurement[]>();
  private readonly naturalRowHeights = new WeakMap<HTMLTableRowElement, string>();
  private measuredBody?: HTMLTableSectionElement;
  private previousScrollHeight = 0;
  private destroyed = false;

  constructor(private readonly sheet: ParsedSheet, private readonly grid: HTMLElement, private readonly mount: HTMLElement = grid, private readonly options: SheetRowWindowOptions = {}) {
    this.measurements = options.measurements ?? { heights: new Map() };
    this.rowTracks = sheetTracks(sheet).rows;
    if (sheet.rowHeights || sheet.rowHeightSource || sheet.cellStyles?.variableHeight) {
      this.heights = new RowHeights(this.rowTracks.sourceCount, sheet.rowHeights, this.measurements.heights, this.rowTracks, sheet.rowHeightSource);
    }
    const rows = this.rowTracks.count < this.rowTracks.sourceCount ? sheet.rows.filter(row => this.rowTracks.includes(row.index)) : sheet.rows;
    this.rows = rows.every((row, index) => !index || row.index >= rows[index - 1].index)
      ? rows : [...rows].sort((a, b) => a.index - b.index);
    this.widths = columnWidthsFor(sheet, grid.ownerDocument);
    this.wide = this.widths.tracks.count > COLUMN_BATCH_SIZE;
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

  refresh(reason: 'fonts' | 'values' = 'fonts'): void {
    if (this.destroyed) return;
    if (reason === 'fonts' && this.sheet.columnWidthSource) {
      const column = this.widths.at(this.grid.scrollLeft);
      const width = this.widths.width(column);
      const fraction = width ? (this.grid.scrollLeft - this.widths.before(column)) / width : 0;
      this.widths = columnWidthsFor(this.sheet, this.grid.ownerDocument, this.widths.count);
      this.overflowWidths = undefined;
      sizeTable(this.table, this.sheet, this.widths, this.wide);
      this.table.tHead!.replaceWith(createSheetHeader(this.sheet, this.widths,
        this.wide ? { first: this.columnFirst, last: this.columnLast } : undefined));
      this.grid.scrollLeft = this.widths.before(column) + fraction * this.widths.width(column);
    }
    if (this.sheet.columnWidthSource && reason === 'fonts' && this.measurements.width !== undefined
      && this.sheet.cellStyles?.formats.some(style => style.wrap || style.textRotation)) {
      this.measurements.width = -1;
    }
    this.first = 0; this.update();
  }

  /** Refresh the dimensions of a CSV after the parser appends to its existing rows. */
  refreshCsvDimensions(): void {
    if (this.destroyed) return;
    const tracks = sheetTracks(this.sheet);
    if (tracks.rows === this.rowTracks && tracks.columns === this.widths.tracks) return;
    const headerHeight = this.table.tHead!.getBoundingClientRect().height || 26;
    const topInRows = this.grid.scrollTop * this.scrollTrack(headerHeight).scale / this.rowHeight;
    this.rowTracks = tracks.rows;
    if (tracks.columns !== this.widths.tracks) {
      this.widths = columnWidthsFor(this.sheet, this.grid.ownerDocument);
      this.wide = tracks.columns.count > COLUMN_BATCH_SIZE;
      sizeTable(this.table, this.sheet, this.widths, this.wide);
      if (!this.wide) this.table.tHead!.replaceWith(createSheetHeader(this.sheet, this.widths));
      this.columnFirst = this.columnLast = 0;
    }
    this.table.setAttribute('aria-rowcount', String(tracks.rows.sourceCount + 1));
    this.table.setAttribute('aria-colcount', String(tracks.columns.sourceCount + 1));
    this.update(topInRows);
  }

  scrollPosition(): SheetScrollPosition {
    const headerHeight = this.table.tHead!.getBoundingClientRect().height || 26;
    const { scale } = this.scrollTrack(headerHeight);
    // Use the content directly below the sticky header in either scroll track.
    const y = Math.max(0, this.grid.scrollTop * scale);
    const row = this.heights?.at(y) ?? this.rowTracks.source(Math.floor(y / this.rowHeight) + 1);
    const column = this.widths.at(this.grid.scrollLeft);
    return { row, rowOffset: y - this.rowOffset(row), column, columnOffset: this.grid.scrollLeft - this.widths.before(column),
      columnCount: this.widths.count };
  }

  restoreScrollPosition({ row, rowOffset, column, columnOffset, columnCount }: SheetScrollPosition): void {
    if (this.sheet.columnWidthSource && column > this.widths.count && columnCount && columnCount > this.widths.count) {
      this.setColumnExtent(Math.min(columnCount, MAX_XLSX_COLUMNS));
    }
    const headerHeight = this.table.tHead!.getBoundingClientRect().height || 26;
    const { scale } = this.scrollTrack(headerHeight);
    const y = this.rowOffset(row) + Math.min(rowOffset, Math.max(0, this.rowOffset(row + 1) - this.rowOffset(row) - 1));
    this.grid.scrollTop = y / scale;
    this.grid.scrollLeft = this.widths.before(column) + Math.min(columnOffset, Math.max(0, this.widths.width(column) - 1));
    this.update();
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

  private orderedCells(row: ParsedRow): ParsedCell[] {
    let cells = this.cellRows.get(row);
    if (!cells) {
      const tracks = this.widths.tracks;
      const visible = tracks.count < tracks.sourceCount ? row.cells.filter(cell => tracks.includes(cell.column)) : row.cells;
      cells = visible.every((cell, index) => !index || cell.column >= visible[index - 1].column)
        ? visible : [...visible].sort((a, b) => a.column - b.column);
      this.cellRows.set(row, cells);
    }
    return cells;
  }

  private measureRows(): boolean {
    const heights = this.heights;
    if (!heights) return false;
    const body = this.table.tBodies[0];
    const xlsx = this.sheet.columnWidthSource && this.columnFirst > 0;
    const measureNatural = xlsx && this.measuredBody !== body;
    this.measuredBody = xlsx ? body : undefined;
    const xlsxLayout = this.sheet.rowHeightSource || this.sheet.cellStyles?.variableHeight;
    const view = this.table.ownerDocument.defaultView;
    const reset: Array<[HTMLTableRowElement, number]> = [];
    const rows = body.querySelectorAll<HTMLTableRowElement>('tr[aria-rowindex]');
    if (measureNatural) {
      // Clear the saved DOM floor for this pass while retaining heights from other columns in the index.
      for (const row of rows) {
        const natural = this.naturalRowHeights.get(row);
        if (natural === undefined) continue;
        reset.push([row, Number(row.getAttribute('aria-rowindex')) - 1]);
        row.style.height = natural;
      }
    }
    let changed = false;
    for (const row of rows) {
      const index = Number(row.getAttribute('aria-rowindex')) - 1;
      if (fixedRowHeight(this.sheet.rowHeightSource, index)) continue;
      // The used height retains subpixels without depending on the row's distant Y coordinate.
      let height: number;
      if (xlsxLayout) {
        height = row.offsetHeight;
        if (height && view) height = Number.parseFloat(view.getComputedStyle(row).height) || height;
      } else height = row.getBoundingClientRect().height;
      if (height <= 0 || (xlsx && !measureNatural && height <= heights.height(index))) continue;
      const minimum = heights.minimum(index);
      if (xlsx && this.wide) height = this.mergeRowHeightMeasurements(row, index, height, minimum);
      if (heights.set(index, height)) {
        const updated = heights.height(index);
        if (xlsx && updated === minimum) this.measurements.heights.delete(index);
        else this.measurements.heights.set(index, updated);
        changed = true;
      }
    }
    for (const [row, index] of reset) row.style.height = `${heights.height(index)}px`;
    return changed;
  }

  private mergeRowHeightMeasurements(row: HTMLTableRowElement, index: number, height: number, minimum: number): number {
    const { columnFirst, columnLast } = this;
    const previous = this.observedRowHeights.get(index);
    const grows = height - minimum >= .25;
    if (!previous && !grows) return height;
    const measurements = (previous ?? [])
      .filter(entry => entry.first < columnFirst || entry.last > columnLast);
    if (grows) {
      let first = columnLast, last = columnFirst;
      for (const cell of row.cells) {
        if (cell.tagName !== 'TD' || (!cell.hasChildNodes() && !cell.style.borderTop && !cell.style.borderBottom)) continue;
        if (cell.classList.contains('xlsxv-column-spacer') && !cell.hasChildNodes()) continue;
        const col = Number(cell.getAttribute('aria-colindex')) - 1;
        if (col < columnFirst || cell.rowSpan > 1 || cell.colSpan > 1) {
          first = columnFirst; last = columnLast;
          break;
        }
        first = Math.min(first, col);
        last = Math.max(last, col);
      }
      measurements.push({ first: first <= last ? first : columnFirst, last: first <= last ? last : columnLast, height });
    }
    if (measurements.length) this.observedRowHeights.set(index, measurements);
    else this.observedRowHeights.delete(index);
    return measurements.reduce((tallest, entry) => Math.max(tallest, entry.height), height);
  }

  private rowOffset(row: number): number {
    return this.heights?.before(row) ?? this.rowTracks.before(row) * this.rowHeight;
  }

  private setColumnExtent(count: number): void {
    this.widths = count === this.overflowWidths?.count ? this.overflowWidths : columnWidthsFor(this.sheet, this.grid.ownerDocument, count);
    this.wide = this.widths.tracks.count > COLUMN_BATCH_SIZE;
    this.columnFirst = this.columnLast = 0;
    sizeTable(this.table, this.sheet, this.widths, this.wide);
    this.table.setAttribute('aria-colcount', String(count + 1));
  }

  private extendRotatedText(right: number): boolean {
    if (!right || !this.sheet.columnWidthSource || this.widths.count >= MAX_XLSX_COLUMNS || right <= this.widths.before(this.widths.count + 1)) return false;
    const all = this.overflowWidths ??= columnWidthsFor(this.sheet, this.grid.ownerDocument, MAX_XLSX_COLUMNS);
    const count = all.at(Math.ceil(right) - 1);
    if (count <= this.widths.count || count > MAX_XLSX_COLUMNS) return false;
    this.setColumnExtent(count);
    return true;
  }

  private scrollTrack(headerHeight: number): { height: number; scale: number } {
    const logicalHeight = this.rowOffset(this.rowTracks.sourceCount + 1);
    const limit = this.mount === this.grid && logicalHeight > 1_000_000 ? scrollHeightLimit(this.grid.ownerDocument) : Infinity;
    const height = Math.min(logicalHeight, limit);
    const visible = Math.max(0, this.grid.clientHeight - headerHeight);
    return { height, scale: height < logicalHeight ? (logicalHeight - visible) / Math.max(1, height - visible) : 1 };
  }

  private update(topInRows?: number): void {
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
    const rowTracks = this.rowTracks;
    const total = rowTracks.count, end = rowTracks.sourceCount + 1;
    const headerHeight = this.table.tHead!.getBoundingClientRect().height || 26;
    let track = this.scrollTrack(headerHeight);
    const logicalTop = topInRows === undefined ? undefined : topInRows * this.rowHeight;
    let rowTop = logicalTop ?? (track.scale > 1 ? top * track.scale : top - (this.heights ? headerHeight : 0));
    let restoreTop = logicalTop === undefined ? undefined : logicalTop / track.scale;
    const atBottom = this.grid.scrollTop > 0 && this.grid.clientHeight > 0 && this.previousScrollHeight > 0
      && this.grid.scrollTop + this.grid.clientHeight >= this.previousScrollHeight - 2;
    if (this.heights) {
      const y = Math.max(0, rowTop), oldTotal = this.heights.before(end);
      const anchor = y >= oldTotal ? end : this.heights.at(y), oldOffset = this.heights.before(anchor);
      let changed = false;
      // Column spacers can change collapsed borders without changing cell layout.
      const width = this.sheet.columnWidths ? this.widths.before(Math.max(1, this.sheet.columnCount) + 1)
        : this.table.querySelector('.xlsxv-col-header')?.getBoundingClientRect().width ?? 0;
      const widthChanged = width > 0 && this.measurements.width !== undefined && Math.abs(width - this.measurements.width) > .5;
      if (widthChanged && (!this.sheet.columnWidthSource || this.sheet.cellStyles?.formats.some(style => style.wrap || style.textRotation))) {
        this.measurements.heights.clear();
        this.observedRowHeights.clear();
        this.heights = new RowHeights(rowTracks.sourceCount, this.sheet.rowHeights, undefined, rowTracks, this.sheet.rowHeightSource);
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
          + (anchor < end ? Math.min(within, Math.max(0, this.heights.height(anchor) - 1)) - within : 0);
        const nextTrack = this.scrollTrack(headerHeight);
        if (track.scale > 1 || nextTrack.scale > 1) {
          rowTop = Math.max(0, y + delta);
          restoreTop = nextTrack.scale > 1 ? rowTop / nextTrack.scale : rowTop + headerHeight;
        } else {
          this.grid.scrollTop = (this.mount === this.grid ? top : this.grid.scrollTop) + delta;
          rowTop += delta;
        }
        track = nextTrack; this.first = 0;
      }
    }
    const rowAtTop = this.heights ? rowTracks.before(this.heights.at(Math.max(0, rowTop))) + 1 : Math.floor(rowTop / this.rowHeight) + 1;
    const visibleCount = this.sheet.rowHeightSource && this.heights
      ? rowTracks.before(this.heights.at(Math.max(0, rowTop) + this.grid.clientHeight)) - rowAtTop + 2
      : Math.ceil(this.grid.clientHeight / this.rowHeight);
    const count = Math.max(ROW_BATCH_SIZE, visibleCount + 20);
    const firstOrdinal = Math.min(Math.max(1, rowAtTop - 10), Math.max(1, total - count + 1));
    const first = rowTracks.source(firstOrdinal), last = total ? rowTracks.source(Math.min(total, firstOrdinal + count - 1)) : 0;
    let before = this.rowOffset(first), after = this.rowOffset(end) - this.rowOffset(last + 1);
    if (track.scale > 1) {
      // Compress only unmounted rows. Align full-height visible rows to the logical scroll position.
      const empty = Math.max(0, track.height - (this.rowOffset(last + 1) - before));
      before = Math.max(0, Math.min(empty, before + (restoreTop ?? top) - rowTop));
      after = empty - before;
    }
    for (;;) {
      const columnTracks = this.widths.tracks;
      const visibleFirst = columnTracks.before(this.widths.at(left)) + 1;
      const visibleLast = columnTracks.before(this.widths.at(left + Math.max(0, this.grid.clientWidth - 48))) + 1;
      const columnCount = Math.max(COLUMN_BATCH_SIZE, visibleLast - visibleFirst + 1 + 8);
      const firstColumnOrdinal = this.wide ? Math.min(Math.max(1, visibleFirst - 4), Math.max(1, columnTracks.count - columnCount + 1)) : 1;
      const firstColumn = this.wide ? columnTracks.source(firstColumnOrdinal) : 1;
      const lastColumn = this.wide ? columnTracks.source(Math.min(columnTracks.count, firstColumnOrdinal + columnCount - 1)) : columnTracks.sourceCount;
      if (first === this.first && last === this.last && firstColumn === this.columnFirst && lastColumn === this.columnLast) {
        if (track.scale > 1 || logicalTop !== undefined) {
          const rows = this.table.tBodies[0].rows;
          rows[0].cells[0].style.height = `${before}px`;
          rows[rows.length - 1].cells[0].style.height = `${after}px`;
        }
        break;
      }
      const columns: ColumnWindow | undefined = this.wide || columnTracks.count < columnTracks.sourceCount
        ? { first: firstColumn, last: lastColumn, cells: row => this.orderedCells(row) } : undefined;
      const body = document.createElement('tbody');
      const xlsxHeights = this.sheet.columnWidthSource && this.heights;
      let right = 0;
      withFormulaTime(this.sheet, () => withTextMeasurementScope(() => appendRows(body, this.sheet, first, last,
        this.rows.slice(lowerBound(this.rows, first, row => row.index), lowerBound(this.rows, last + 1, row => row.index)),
        { widths: this.widths, columns, renderCell: this.options.renderCell, renderBlankCell: this.options.renderBlankCell,
          rowHeight: xlsxHeights ? row => xlsxHeights.minimum(row) : this.heights ? row => this.heights!.height(row) : undefined,
          rowOffset: row => this.rowOffset(row), clipMerges: true, calculationPending: this.options.calculationPending?.(),
          extendColumns: end => { right = Math.max(right, end); } })));
      // Measure source labels before committing the horizontal window. Growth adds only blank columns at the end.
      if (this.extendRotatedText(right)) continue;
      if (xlsxHeights) {
        for (const row of body.rows) {
          const index = Number(row.getAttribute('aria-rowindex')) - 1;
          const previous = this.measurements.heights.get(index);
          if (previous === undefined || previous <= (Number.parseFloat(row.style.height) || 0)) continue;
          // Rotated overflow can set a row minimum during rendering.
          this.naturalRowHeights.set(row, row.style.height);
          row.style.height = `${previous}px`;
        }
      }
      if (firstColumn !== this.columnFirst || lastColumn !== this.columnLast) {
        this.table.tHead!.replaceWith(createSheetHeader(this.sheet, this.widths, columns));
      }
      this.first = first; this.last = last;
      this.columnFirst = firstColumn; this.columnLast = lastColumn;
      body.prepend(this.spacer(before));
      body.append(this.spacer(after));
      this.table.tBodies[0].replaceWith(body);
      if (xlsxHeights) this.schedule();
      break;
    }
    // The browser can clamp to a fractional endpoint even when scrollHeight is rounded.
    if (logicalTop === undefined && atBottom && (this.heights || track.scale > 1)) this.grid.scrollTop = this.grid.scrollHeight;
    else if (restoreTop !== undefined) this.grid.scrollTop = restoreTop;
    this.previousScrollHeight = this.grid.scrollHeight;
  }

  private spacer(height: number): HTMLTableRowElement {
    const row = document.createElement('tr'); row.className = 'xlsxv-spacer'; row.setAttribute('aria-hidden', 'true');
    const cell = document.createElement('td'); cell.colSpan = this.table.tHead!.rows[0].cells.length;
    cell.style.cssText = `height:${height}px;padding:0;border:0`; row.append(cell); return row;
  }

}

const cellColumn = (cell: ParsedCell) => cell.column;

function lowerBound<T>(items: readonly T[], value: number, coordinate: (item: T) => number): number {
  let low = 0, high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (coordinate(items[middle]) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}
