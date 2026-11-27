import { hasSourceValue } from './cell-value';
import type { ColumnWidths } from './column-widths';
import { RowRangeIndex } from './row-range-index';
import type { ParsedCell, ParsedCellStyle, ParsedMerge, ParsedSheet } from './types';

export interface RotatedOverflow {
  paint(value: HTMLSpanElement, width: number, height: number, vertical: string, padding: number, fixed: boolean): boolean;
}

export function canOverflowRotation(style?: ParsedCellStyle): boolean {
  return Boolean(style?.textRotation && Math.abs(style.textRotation) < 90 && !style.wrap && !style.shrinkToFit);
}

const indexes = new WeakMap<ParsedSheet, RowRangeIndex<ParsedMerge>>();

export function horizontalBarriers(sheet: ParsedSheet, rowIndex: number): ParsedMerge[] {
  const ranges: ParsedMerge[] = [];
  let index = indexes.get(sheet);
  if (!index) {
    index = new RowRangeIndex([...(sheet.merges ?? []), ...(sheet.arrayFormulas ?? [])]);
    indexes.set(sheet, index);
  }
  index.forEach(rowIndex, rowIndex, range => ranges.push(range));
  return ranges;
}

export function rotatedOverflowRow(sheet: ParsedSheet, row: HTMLTableRowElement, rowIndex: number,
  cells: readonly ParsedCell[], widths: ColumnWidths, first: number, last: number, extend?: (end: number) => void) {
  const start = widths.before(first), end = widths.before(last + 1);
  const ranges = horizontalBarriers(sheet, rowIndex);

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
      if (cells[at + 1]?.column !== cell.column && widths.tracks.includes(cell.column) && hasSourceValue(cell)) return cell;
    }
  }

  function region(column: number, projectedRight?: number): [number, number] | undefined {
    const previous = neighbor(column, -1), next = neighbor(column, 1);
    let left = previous?.column ?? 0, right = next?.column ?? widths.count + 1;
    for (const range of ranges) {
      if (widths.before(range.firstColumn) === widths.before(range.lastColumn + 1)) continue;
      if (range.lastColumn < column) left = Math.max(left, range.lastColumn);
      else if (range.firstColumn > column) right = Math.min(right, range.firstColumn);
      else return undefined;
    }
    if (right > widths.count && projectedRight !== undefined && projectedRight > widths.before(widths.count + 1)) {
      extend?.(projectedRight);
    }
    const clipLeft = Math.max(start, widths.before(left + 1)), clipRight = Math.min(end, widths.before(right));
    if (clipLeft < clipRight) return [clipLeft, clipRight];
  }

  return {
    offscreen(step: -1 | 1): ParsedCell | undefined {
      const cell = neighbor(step === -1 ? first : last, step);
      if (cell && canOverflowRotation(sheet.cellStyles?.formats[cell.styleIndex ?? 0]) && region(cell.column)) return cell;
    },

    at(column: number, host: HTMLTableCellElement, indent: number): RotatedOverflow {
      const source = widths.before(column), sourceEnd = widths.before(column + 1);
      const hostStart = column < first ? 0 : column > last ? end : source;
      return {
        paint(value, width, height, vertical, padding, fixed) {
          const half = width / 2;
          const align = value.style.textAlign;
          const leftPadding = 8 + (align === 'left' ? indent : 0), rightPadding = 8 + (align === 'right' ? indent : 0);
          const center = align === 'center' ? (source + sourceEnd) / 2
            : align === 'right' ? sourceEnd - rightPadding - half : source + leftPadding + half;
          if (center - half >= source && center + half <= sourceEnd) return false;
          const bounds = region(column, center + half);
          if (!bounds) return false;
          const left = Math.max(bounds[0], Math.min(source, center - half));
          const right = Math.min(bounds[1], Math.max(sourceEnd, center + half));
          if (left >= right || (left >= source && right <= sourceEnd)) return false;
          const overlay = row.ownerDocument.createElement('div');
          overlay.className = 'xlsxv-rotated-overflow';
          Object.assign(overlay.style, {
            left: `${left - hostStart}px`, width: `${right - left}px`, paddingBlock: `${padding}px`,
            justifyContent: vertical === 'middle' ? 'center' : vertical === 'bottom' ? 'flex-end' : 'flex-start'
          });
          const frame = row.ownerDocument.createElement('div');
          frame.className = 'xlsxv-rotated-text';
          frame.style.height = `${height}px`;
          value.style.left = `${center - left}px`;
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
  };
}
