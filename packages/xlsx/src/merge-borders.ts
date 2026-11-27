import { lineStyleToBorder, type BorderBox } from '@filens/core';
import type { ColumnWidths } from './column-widths';
import type { MergeBorderSide, MergeFragment, SheetMerges } from './merged-cells';
import type { ParsedSheet } from './types';
import type { VisibleTracks } from './visible-tracks';

interface BorderSegment { start: number; end: number; border: string }

export function paintMergeBorders(cell: HTMLTableCellElement, merge: MergeFragment, index: SheetMerges,
  borders: BorderBox | undefined, differential: BorderBox | undefined, widths: ColumnWidths,
  rows: VisibleTracks, beforeRow: (row: number) => number, authoredRuns?: ParsedSheet['mergeBorderRuns']): void {
  const { source } = merge, columns = widths.tracks;
  const clipped = {
    top: rows.before(merge.firstRow) > rows.before(source.firstRow),
    right: columns.before(merge.lastColumn + 1) < columns.before(source.lastColumn + 1),
    bottom: rows.before(merge.lastRow + 1) < rows.before(source.lastRow + 1),
    left: columns.before(merge.firstColumn) > columns.before(source.firstColumn)
  };
  const terminal = index.hasStoredBorders && ((!clipped.right && !borders?.right) || (!clipped.bottom && !borders?.bottom))
    ? index.terminalBorders(source) : undefined;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (clipped[side]) {
      cell.style.setProperty(`border-${side}`, '0px solid transparent');
      hideGridLine(cell, side);
      continue;
    }
    if (differential?.[side]) continue;
    const horizontal = side === 'top' || side === 'bottom';
    const first = horizontal ? merge.firstColumn : merge.firstRow, last = horizontal ? merge.lastColumn : merge.lastRow;
    const authored = authoredRuns?.(source, side, first, last);
    if (!index.hasStoredBorders && !authored?.length) continue;
    const fallback = borders?.[side] ?? (side === 'right' || side === 'bottom' ? terminal?.[side] : undefined);
    const defaultBorder = fallback ? lineStyleToBorder(fallback) : authored ? cell.style.getPropertyValue(`border-${side}`) : '';
    const before = horizontal ? (column: number) => widths.before(column) : beforeRow;
    const origin = before(first), length = before(last + 1) - origin;
    const segments: BorderSegment[] = [];
    const add = (start: number, end: number, border: string) => {
      if (start >= end) return;
      const previous = segments.at(-1);
      if (previous?.border === border && previous.end === start) previous.end = end;
      else segments.push({ start, end, border });
    };
    let cursor = 0;
    for (const [firstTrack, lastTrack, line] of authored ?? index.edgeBorders(merge, side)) {
      const start = before(firstTrack) - origin, end = before(lastTrack + 1) - origin;
      const border = lineStyleToBorder(line);
      if (start >= end || border === defaultBorder) continue;
      add(cursor, start, defaultBorder);
      add(start, end, border);
      cursor = end;
    }
    add(cursor, length, defaultBorder);
    if (segments.length === 1) {
      const [{ border }] = segments;
      if (border) {
        cell.style.setProperty(`border-${side}`, border);
        hideGridLine(cell, side);
      }
    } else if (segments.length > 1) {
      cell.style.setProperty(`border-${side}`, '0px solid transparent');
      hideGridLine(cell, side);
      for (const { start, end, border } of segments) {
        const stroke = border || (!authored && (side === 'right' || side === 'bottom') ? '1px solid #d8dee8' : '');
        if (!stroke) continue;
        const segment = cell.ownerDocument.createElement('span');
        segment.className = 'xlsxv-merge-border-segment';
        segment.setAttribute('aria-hidden', 'true');
        segment.style.setProperty(side, '0');
        segment.style.setProperty(`border-${side}`, stroke);
        segment.style[horizontal ? 'left' : 'top'] = `${start / length * 100}%`;
        segment.style[horizontal ? 'width' : 'height'] = `${(end - start) / length * 100}%`;
        cell.append(segment);
      }
    }
  }
}

function hideGridLine(cell: HTMLTableCellElement, side: MergeBorderSide): void {
  if (side === 'right' || side === 'bottom') cell.style.setProperty(`--xlsxv-grid-${side}`, 'transparent');
}
