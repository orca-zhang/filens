import { describe, expect, it } from 'vitest';
import { WorksheetCellIndex } from '../src/cell-index';
import type { ParsedCell, ParsedSheet } from '../src/types';

const cell = (column: number, value = String(column)): ParsedCell => ({ ref: '', row: 1, column, value });
const sheet = (rows: ParsedSheet['rows']): ParsedSheet => ({ id: 'index', name: 'Index', rows, rowCount: 0, columnCount: 0 });

describe('worksheet cell index', () => {
  it('handles high bitmap bits, full words, gaps and inclusive page boundaries', () => {
    const cells = Array.from({ length: 64 }, (_, i) => cell(i + 1));
    cells.push(cell(1025));
    const index = new WorksheetCellIndex(sheet([{ index: 1, cells }]));
    for (let column = 0; column <= 1026; column++) {
      expect(index.get(1, column)).toBe(cells.find(cell => cell.column === column));
    }
    for (const [first, last] of [[1, 32], [32, 33], [33, 64], [64, 1025], [65, 1024], [1025, 1026]]) {
      const actual: ParsedCell[] = [];
      index.forEachInRange(1, 1, first, last, cell => actual.push(cell));
      expect(actual).toEqual(cells.filter(cell => cell.column >= first && cell.column <= last));
    }
    expect(index.get(2, 1)).toBeUndefined();
    expect(new WorksheetCellIndex(sheet([])).get(1, 1)).toBeUndefined();
  });

  it('matches a coordinate-map oracle for unordered rows, duplicate cells and sparse rectangles', () => {
    let seed = 42;
    const random = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const model = sheet(Array.from({ length: 160 }, (_, i) => ({
      index: random(64) + 1,
      cells: Array.from({ length: 24 }, (_, j) => cell(random(256) + 1, `${i}:${j}`))
    })));
    const snapshot = JSON.stringify(model), expected = new Map<string, { row: number; cell: ParsedCell }>();
    for (const row of model.rows) for (const cell of row.cells) expected.set(`${row.index}:${cell.column}`, { row: row.index, cell });
    const ordered = [...expected.values()].sort((a, b) => a.row - b.row || a.cell.column - b.cell.column);
    const index = new WorksheetCellIndex(model);
    for (let i = 0; i < 400; i++) {
      const firstRow = random(80) + 1, lastRow = firstRow + random(32);
      const firstColumn = random(280) + 1, lastColumn = firstColumn + random(128);
      expect(index.get(firstRow, firstColumn)).toBe(expected.get(`${firstRow}:${firstColumn}`)?.cell);
      const actual: ParsedCell[] = [];
      index.forEachInRange(firstRow, lastRow, firstColumn, lastColumn, cell => actual.push(cell));
      expect(actual).toEqual(ordered.filter(entry => entry.row >= firstRow && entry.row <= lastRow &&
        entry.cell.column >= firstColumn && entry.cell.column <= lastColumn).map(entry => entry.cell));
    }
    expect(JSON.stringify(model)).toBe(snapshot);
  });

  it('keeps sparse coordinates above 32 bits distinct without allocating their gaps', () => {
    const first = cell(1), far = cell(2 ** 32 + 32);
    const index = new WorksheetCellIndex(sheet([
      { index: 1, cells: [first] }, { index: 2 ** 32 + 1, cells: [far] }
    ]));
    expect(index.get(1, 1)).toBe(first);
    expect(index.get(2 ** 32 + 1, 2 ** 32 + 32)).toBe(far);
    expect(index.get(1, 32)).toBeUndefined();
    const found: ParsedCell[] = [];
    index.forEachInRange(2, 2 ** 32 + 1, 2, 2 ** 32 + 32, cell => found.push(cell));
    expect(found).toEqual([far]);
  });

  it('rebuilds a partially loaded ordered prefix when a later row is out of order', () => {
    const first = cell(1, 'first'), replacement = cell(1, 'last'), boundary = cell(32), next = cell(33);
    const model = sheet([
      { index: 1, cells: [first] }, { index: 2, cells: [next] },
      { index: 1, cells: [boundary, replacement] }, { index: 3, cells: [] }
    ]);
    const original = JSON.stringify(model), index = new WorksheetCellIndex(model), found: ParsedCell[] = [];
    index.forEachInRange(1, 3, 1, 33, cell => found.push(cell));
    expect(found).toEqual([replacement, boundary, next]);
    expect(index.get(1, 1)).toBe(replacement);
    expect(JSON.stringify(model)).toBe(original);
  });
});
