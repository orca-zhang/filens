import type { BorderBox, LineStyle } from '@filens/core';
import type { IworkArchiveIndex } from './types';
import { asArray, asObject, colorAlpha, getRecordValue, lineFromValue, readField } from './parser/helpers';

// Coordinates are zero-based and end is exclusive. Line indices refer to the
// boundary preceding a row or column, so adjacent cells share an edge.
type StrokeRun = { start: number; end: number; line: LineStyle };
type OrderedStroke = StrokeRun & { order: number };
type StrokeLines = Readonly<Record<number, readonly StrokeRun[]>>;
export interface TableStrokeEdges { horizontal: StrokeLines; vertical: StrokeLines }

const sides = ['top', 'left', 'right', 'bottom'] as const;
const layerFields = {
  top: ['topRowStrokeLayers', 'top_row_stroke_layers'],
  left: ['leftColumnStrokeLayers', 'left_column_stroke_layers'],
  right: ['rightColumnStrokeLayers', 'right_column_stroke_layers'],
  bottom: ['bottomRowStrokeLayers', 'bottom_row_stroke_layers']
};

export function readTableStrokeEdges(archive: IworkArchiveIndex, reference: unknown, rows: number, columns: number): TableStrokeEdges | undefined {
  const sidecar = getRecordValue(archive, reference);
  if (!sidecar) return undefined;
  const noStroke: LineStyle = { color: 'transparent', width: 0 };
  const horizontal = new Map<number, OrderedStroke[]>(), vertical = new Map<number, OrderedStroke[]>();
  for (const side of sides) {
    const across = side === 'top' || side === 'bottom';
    const lines = across ? horizontal : vertical;
    for (const reference of asArray(readField(sidecar, layerFields[side]))) {
      const layer = getRecordValue(archive, reference);
      const index = Number(readField(layer, ['rowColumnIndex', 'row_column_index']) ?? 0);
      if (!Number.isSafeInteger(index) || index < 0 || index >= (across ? rows : columns)) continue;
      const boundary = index + Number(side === 'bottom' || side === 'right');
      for (const run of asArray<Record<string, unknown>>(readField(layer, ['strokeRuns', 'stroke_runs']))) {
        const origin = Number(readField(run, ['origin']) ?? 0), length = Number(readField(run, ['length']));
        if (!Number.isSafeInteger(origin) || !Number.isSafeInteger(length) || length <= 0) continue;
        const start = Math.max(0, origin), end = Math.min(across ? columns : rows, origin + length);
        if (end <= start) continue;
        const stroke = asObject(readField(run, ['stroke']));
        if (!stroke) continue;
        const pattern = readField(asObject(readField(stroke, ['pattern'])), ['type']);
        const hidden = pattern === 2 || readField(stroke, ['width']) === 0 || colorAlpha(readField(stroke, ['color'])) === 0;
        const line = hidden ? noStroke : lineFromValue(stroke);
        if (!line || !Number.isFinite(line.width)) continue;
        const order = Number(readField(run, ['order']) ?? 0);
        const value = { start, end, line, order: Number.isSafeInteger(order) ? order : 0 };
        const runs = lines.get(boundary);
        if (runs) runs.push(value);
        else lines.set(boundary, [value]);
      }
    }
  }
  if (!horizontal.size && !vertical.size) return undefined;
  return {
    horizontal: Object.fromEntries([...horizontal].map(([index, runs]) => [index, resolveStrokeRuns(runs)])),
    vertical: Object.fromEntries([...vertical].map(([index, runs]) => [index, resolveStrokeRuns(runs)]))
  };
}

function resolveStrokeRuns(runs: OrderedStroke[]): StrokeRun[] {
  if (runs.length === 1) {
    const [{ start, end, line }] = runs;
    return [{ start, end, line }];
  }
  const offsets = [...new Set(runs.flatMap(({ start, end }) => [start, end]))].sort((a, b) => a - b);
  const indexes = new Map(offsets.map((offset, index) => [offset, index]));
  const lines: (LineStyle | undefined)[] = [];
  const next = Uint32Array.from(offsets, (_, i) => i);
  const unpainted = (index: number) => {
    while (next[index] !== index) {
      next[index] = next[next[index]];
      index = next[index];
    }
    return index;
  };
  // The latest stroke wins. Skip assigned intervals without expanding the
  // affected rows or columns, even for overlapping runs spanning a full sheet.
  runs.sort((a, b) => a.order - b.order);
  for (let i = runs.length - 1; i >= 0; i--) {
    const { start, end, line } = runs[i];
    const limit = indexes.get(end)!;
    for (let at = unpainted(indexes.get(start)!); at < limit; at = next[at]) {
      lines[at] = line;
      next[at] = unpainted(at + 1);
    }
  }
  const result: StrokeRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const previous = result.at(-1);
    if (previous?.line === line && previous.end === offsets[i]) previous.end = offsets[i + 1];
    else result.push({ start: offsets[i], end: offsets[i + 1], line });
  }
  return result;
}

function firstStroke(runs: readonly StrokeRun[], position: number): number {
  let low = 0, high = runs.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (runs[mid].end <= position) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function cellStrokeBorders(strokes: TableStrokeEdges, row: number, column: number, rowSpan = 1, colSpan = 1): BorderBox | undefined {
  const { horizontal, vertical } = strokes;
  const at = (runs: readonly StrokeRun[] | undefined, position: number) => {
    if (!runs) return undefined;
    const run = runs[firstStroke(runs, position)];
    return run && run.start <= position ? run.line : undefined;
  };
  const top = at(horizontal[row], column), bottom = at(horizontal[row + rowSpan], column);
  const left = at(vertical[column], row), right = at(vertical[column + colSpan], row);
  if (!top && !bottom && !left && !right) return undefined;
  return { ...(top && { top }), ...(right && { right }), ...(bottom && { bottom }), ...(left && { left }) };
}

/** The shared grid consumes one-based inclusive positions on a visible edge. */
export function visibleStrokeRuns(lines: StrokeLines, boundary: number, first: number, last: number): (readonly [number, number, LineStyle])[] {
  const runs = lines[boundary];
  if (!runs) return [];
  const visible: (readonly [number, number, LineStyle])[] = [];
  for (let i = firstStroke(runs, first - 1); i < runs.length && runs[i].start < last; i++) {
    const { start, end, line } = runs[i];
    visible.push([Math.max(start + 1, first), Math.min(end, last), line]);
  }
  return visible;
}
