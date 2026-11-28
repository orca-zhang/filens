import { cellTextContext, cellTextFont } from './cell-text-metrics';
import type { FormattedCellValue } from './number-formats';
import type { ParsedCell, ParsedSheet } from './types';
import { normalDigitWidth } from './xlsx-column-widths';

export type FitColumn = (column: number, cell: HTMLTableCellElement, value: string,
  format: FormattedCellValue | undefined, icon: boolean, type: ParsedCell['valueType']) => number;

export function createBestFitMeasurer(sheet: ParsedSheet, document: Document, minimums?: Map<number, number>): FitColumn | undefined {
  const source = sheet.columnWidthSource;
  if (!source || sheet.showFormulas || !source.ranges.some(range => range.bestFit)) return;
  const context = cellTextContext(document);
  if (!context) return;
  const columns = new Uint8Array(16_385);
  for (let index = source.ranges.length - 1; index >= 0; index--) {
    const range = source.ranges[index];
    // Widths and best-fit eligibility use the same precedence when ranges overlap.
    columns.fill(Number(Boolean(range.bestFit)), range.firstColumn, range.lastColumn + 1);
  }
  if (minimums) for (const column of minimums.keys()) if (!columns[column]) minimums.delete(column);
  const maximum = 255 * normalDigitWidth(source, document);
  return (column, cell, value, format, icon, type) => {
    if (!columns[column] || (type !== 'date' && (type !== undefined || !value.trim() || !Number.isFinite(Number(value))))) return 0;
    const text = format?.text ?? cell.textContent ?? value;
    if (!text || /[\r\n]/.test(text)) return 0;
    const style = cell.style, size = Number.parseFloat(style.fontSize) || 12;
    context.font = cellTextFont(style, size);
    if ('fontKerning' in context) context.fontKerning = format?.alignRight ? 'none' : 'auto';
    let width = 0, start = 0;
    for (const space of format?.spacing ?? []) {
      if (space.kind === 'fill') continue;
      width += context.measureText(text.slice(start, space.offset)).width + context.measureText(space.glyph).width;
      start = space.offset + 1;
    }
    width += context.measureText(text.slice(start)).width;
    if (icon) width += 1.3 * size;
    const padding = (Number.parseFloat(style.paddingLeft) || 8) + (Number.parseFloat(style.paddingRight) || 8);
    const border = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
    return Math.min(maximum, Math.ceil(width + padding + Math.max(1, border)));
  };
}
