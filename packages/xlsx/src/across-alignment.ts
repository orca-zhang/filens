import { hasSourceValue } from './cell-value';
import { cellTextFont } from './cell-text-metrics';
import type { ColumnWidths } from './column-widths';
import { horizontalBarriers } from './horizontal-overflow';
import type { ParsedCell, ParsedRow, ParsedSheet } from './types';

type Alignment = 'center' | 'fill';
interface AlignedRange { anchor: ParsedCell; last: number; alignment: Alignment }
const empty: readonly AlignedRange[] = [];
const sheets = new WeakMap<ParsedSheet, WeakMap<ParsedRow, readonly AlignedRange[]>>();

export function alignedRanges(sheet: ParsedSheet, row: ParsedRow, widths: ColumnWidths): readonly AlignedRange[] {
  if (row.cells.length < 2) return empty;
  let rows = sheets.get(sheet);
  if (!rows) { rows = new WeakMap(); sheets.set(sheet, rows); }
  const known = rows.get(row);
  if (known) return known;
  const ranges: AlignedRange[] = [];
  const formats = sheet.cellStyles!.formats;
  const cells = row.cells.every((cell, index) => !index || cell.column >= row.cells[index - 1].column)
    ? row.cells : [...row.cells].sort((a, b) => a.column - b.column);
  let anchor: ParsedCell | undefined, alignment: Alignment | undefined, last = 0;
  const finish = () => {
    if (anchor && alignment && last > anchor.column) ranges.push({ anchor, last, alignment });
    anchor = undefined;
  };
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index];
    if (cells[index + 1]?.column === cell.column) continue;
    if (cell.column !== last + 1) finish();
    const style = formats[cell.styleIndex ?? 0];
    const next = style?.centerAcross ? 'center' : style?.fillAlignment && !style.wrap && !sheet.showFormulas ? 'fill' : undefined;
    if (next !== alignment || hasSourceValue(cell)) {
      finish();
      if (next && widths.tracks.includes(cell.column)) anchor = cell;
    }
    alignment = next;
    last = cell.column;
  }
  finish();
  if (ranges.length) {
    const barriers = horizontalBarriers(sheet, row.index, [ranges[0].anchor.column, ranges.at(-1)!.last])
      .sort((a, b) => a.firstColumn - b.firstColumn);
    let index = 0;
    for (const range of ranges) {
      while (barriers[index]?.lastColumn < range.anchor.column) index++;
      if (barriers[index]) range.last = Math.min(range.last, barriers[index].firstColumn - 1);
    }
  }
  const visible = ranges.filter(({ anchor, last }) => widths.tracks.before(last + 1) - widths.tracks.before(anchor.column) > 1);
  const result = visible.length ? visible : empty;
  rows.set(row, result);
  return result;
}

export function paintAlignedRange(cell: HTMLTableCellElement, host: HTMLTableCellElement, range: AlignedRange,
  widths: ColumnWidths, first: number, last: number, fixed: boolean, compact: boolean, rtl: boolean, paneStart: number) {
  const source = widths.before(range.anchor.column), end = widths.before(range.last + 1);
  const left = Math.max(source, widths.before(first)), right = Math.min(end, widths.before(last + 1));
  const hostEnd = widths.before(host === cell ? range.anchor.column + 1 : first);
  const hostStart = host === cell ? source : widths.before(paneStart);
  const clipLeft = rtl ? hostEnd - right : left - hostStart;
  const clip = cell.ownerDocument.createElement('div'), content = cell.ownerDocument.createElement('div');
  clip.className = 'xlsxv-center-across';
  clip.dir = 'ltr';
  content.className = 'xlsxv-center-across-content';
  if (cell.dir) content.dir = cell.dir;
  if (range.alignment === 'fill') content.style.textAlign = 'left';
  clip.style.width = `${right - left}px`;
  content.style.width = `${end - source}px`;
  content.style.marginLeft = `${rtl ? right - end : source - left}px`;
  if (fixed) {
    clip.classList.add('is-fixed');
    clip.style.left = `${clipLeft}px`;
    if (cell.style.verticalAlign === 'middle' || cell.style.verticalAlign === 'bottom') {
      clip.style.alignContent = cell.style.verticalAlign === 'middle' ? 'center' : 'end';
    }
  } else {
    const padding = host === cell ? 8 : 0;
    clip.style.marginLeft = `${clipLeft - padding}px`;
    if (rtl) clip.style.marginRight = `${hostEnd - hostStart - clipLeft - (right - left) - padding}px`;
  }
  if (host !== cell) {
    if (!fixed) host.style.paddingBlock = compact ? '1px' : '4px';
    host.style.verticalAlign = cell.style.verticalAlign || 'top';
    const style = cell.style;
    content.style.font = cellTextFont(style, Number.parseFloat(style.fontSize) || 12);
    content.style.lineHeight = compact ? '1.15' : '1.3';
    content.style.color = style.color;
    content.style.textDecorationLine = style.textDecorationLine;
    content.style.textDecorationStyle = style.textDecorationStyle;
    content.classList.add(...cell.classList);
    content.classList.remove('xlsxv-cell');
  }
  content.append(...cell.childNodes);
  clip.append(content);
  host.classList.add('xlsxv-overflow-host');
  host.append(clip);
  return { clip, content, left: clipLeft };
}
