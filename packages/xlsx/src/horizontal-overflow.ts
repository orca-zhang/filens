import { hasSourceValue } from './cell-value';
import type { ColumnWidths } from './column-widths';
import { RowRangeIndex } from './row-range-index';
import type { ParsedCell, ParsedCellStyle, ParsedMerge, ParsedSheet } from './types';

export interface TextOverflow {
  paint(value: HTMLSpanElement, width: number, height: number, vertical: string, padding: number, fixed: boolean): boolean;
}
interface OverflowBounds { left: number; right: number; trailing: boolean }

export function canOverflowRotation(style?: ParsedCellStyle): boolean {
  return Boolean(style?.textRotation && Math.abs(style.textRotation) < 90 && !style.wrap && !style.shrinkToFit && !style.fillAlignment);
}

export function canOverflowText(style?: ParsedCellStyle): boolean {
  return !style?.textRotation && !style?.wrap && !style?.shrinkToFit && !style?.clipText
    && !style?.centerAcross && !style?.fillAlignment && style?.horizontal !== 'justify' && style?.horizontal !== 'distributed';
}

const indexes = new WeakMap<ParsedSheet, RowRangeIndex<ParsedMerge>>();

export function horizontalBarriers(sheet: ParsedSheet, rowIndex: number, columns: readonly [number, number]): ParsedMerge[] {
  const ranges: ParsedMerge[] = [];
  if (!sheet.merges?.length && !sheet.arrayFormulas?.length) return ranges;
  let index = indexes.get(sheet);
  if (!index) {
    index = new RowRangeIndex([...(sheet.merges ?? []), ...(sheet.arrayFormulas ?? [])]);
    indexes.set(sheet, index);
  }
  index.forEach(rowIndex, rowIndex, range => ranges.push(range), columns);
  return ranges;
}

export function horizontalOverflowRow(sheet: ParsedSheet, row: HTMLTableRowElement, rowIndex: number,
  cells: readonly ParsedCell[], widths: ColumnWidths, first: number, last: number, extend?: (end: number) => void,
  alignedEnd?: (column: number) => number, paneStart = 1, paneEnd = widths.count) {
  const rtl = Boolean(sheet.rightToLeft);
  const start = widths.before(first), end = widths.before(last + 1), sheetEnd = widths.before(widths.count + 1);

  function neighbor(column: number, step: -1 | 1): ParsedCell | undefined {
    let low = 0, high = cells.length;
    const key = column + (step === 1 ? 1 : 0);
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cells[middle].column < key) low = middle + 1;
      else high = middle;
    }
    for (let at = low - (step === -1 ? 1 : 0); at >= 0 && at < cells.length; at += step) {
      const cell = cells[at];
      if (cell.column < paneStart || cell.column > paneEnd) return;
      if (cells[at + 1]?.column !== cell.column && widths.tracks.includes(cell.column) && hasSourceValue(cell)) return cell;
    }
  }

  function region(column: number): OverflowBounds | undefined {
    const previous = neighbor(column, -1), next = neighbor(column, 1);
    const anchor = previous?.column ?? 0;
    let left = alignedEnd?.(anchor) ?? anchor, right = next?.column ?? widths.count + 1;
    for (const range of horizontalBarriers(sheet, rowIndex, [Math.min(column, left + 1), Math.max(column, right - 1)])) {
      if (widths.before(range.firstColumn) === widths.before(range.lastColumn + 1)) continue;
      if (range.lastColumn < column) left = Math.max(left, range.lastColumn);
      else if (range.firstColumn > column) right = Math.min(right, range.firstColumn);
      else return undefined;
    }
    const clipLeft = Math.max(start, widths.before(left + 1)), clipRight = Math.min(end, widths.before(right));
    if (clipLeft < clipRight) return { left: clipLeft, right: clipRight, trailing: right > widths.count };
  }

  function placement(column: number, host: HTMLTableCellElement, indent: number, plainBounds?: OverflowBounds): TextOverflow {
    const source = widths.before(column), sourceEnd = widths.before(column + 1);
    const hostStart = column < first ? widths.before(paneStart) : column > last ? end : source;
    const hostEnd = column < first ? start : column > last ? sheetEnd : sourceEnd;
    return {
      paint(value, width, height, vertical, padding, fixed) {
        const half = width / 2;
        const align = value.style.textAlign;
        const paddingInline = 8 + (align === 'left' || align === 'right' ? indent : 0);
        const center = align === 'center' ? (source + sourceEnd) / 2
          : (align === 'right') !== rtl ? sourceEnd - paddingInline - half : source + paddingInline + half;
        if (center - half >= source && center + half <= sourceEnd) return false;
        const bounds = plainBounds ?? region(column);
        if (!bounds) return false;
        if (bounds.trailing && center + half > sheetEnd) extend?.(center + half);
        const left = Math.max(bounds.left, Math.min(source, center - half));
        const right = Math.min(bounds.right, Math.max(sourceEnd, center + half));
        if (left >= right || (left >= source && right <= sourceEnd)) return false;
        const overlay = row.ownerDocument.createElement('div');
        overlay.className = plainBounds ? 'xlsxv-text-overflow' : 'xlsxv-rotated-overflow';
        Object.assign(overlay.style, {
          left: `${rtl ? hostEnd - right : left - hostStart}px`, width: `${right - left}px`, paddingBlock: `${padding}px`,
          justifyContent: vertical === 'middle' ? 'center' : vertical === 'bottom' ? 'flex-end' : 'flex-start'
        });
        const frame = row.ownerDocument.createElement('div');
        frame.className = 'xlsxv-rotated-text';
        frame.style.height = `${height}px`;
        value.style.left = `${rtl ? right - center : center - left}px`;
        frame.append(value);
        overlay.append(frame);
        host.classList.add('xlsxv-overflow-host');
        host.append(overlay);
        if ((column < first || column > last) && !fixed) {
          row.style.height = `${Math.max(Number.parseFloat(row.style.height) || 0, height + 2 * padding)}px`;
        }
        for (const cell of row.cells) {
          const index = Number(cell.getAttribute('aria-colindex')) - 1;
          if (index < first || index >= last) continue;
          const edge = widths.before(index + 1);
          if (edge > left && edge < right) cell.classList.add('xlsxv-overflow-edge');
        }
        return true;
      }
    };
  }

  return {
    offscreen(step: -1 | 1): ParsedCell | undefined {
      const cell = neighbor(step === -1 ? first : last, step);
      if (!cell) return;
      const style = sheet.cellStyles?.formats[cell.styleIndex ?? 0];
      const backwards = (style?.horizontal === 'right') !== rtl;
      const plain = !sheet.showFormulas && canOverflowText(style) && (cell.valueType === 'text' || cell.needsCalculation)
        && (style?.horizontal === 'center' || backwards === (step === 1));
      if ((plain || canOverflowRotation(style)) && region(cell.column)) return cell;
    },

    at(column: number, host: HTMLTableCellElement, indent: number): TextOverflow {
      return placement(column, host, indent);
    },

    plain(column: number, host: HTMLTableCellElement, indent: number, align: ParsedCellStyle['horizontal']): TextOverflow | undefined {
      const bounds = region(column);
      if (!bounds) return;
      const sourceEnd = widths.before(column + 1);
      const backwards = (align === 'right') !== rtl;
      const left = (backwards || align === 'center') && bounds.left < widths.before(column);
      const right = (!backwards || align === 'center') && (bounds.right > sourceEnd || (extend && bounds.trailing && sourceEnd === sheetEnd));
      if (left || right) return placement(column, host, indent, bounds);
    }
  };
}
