// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadIwork } from '../src/parser/load-iwork';
import { buildTableItem } from '../src/parser/table';
import { createLargeMergedNumbersArchive } from './fixtures/numbers-archive.mjs';

describe('Numbers merge parsing memory', () => {
  it.each([false, true])('keeps a 100000 × 1024 merged archive sparse (empty anchor: %s)', async emptyAnchor => {
    const bytes = await createLargeMergedNumbersArchive({ emptyAnchor });
    const document = await loadIwork(bytes);
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    const table = document.sheets[0].tables[0].item;
    expect([table.rows.length, table.columns.length, table.cells.length]).toEqual([100_000, 1024, 3]);
    expect(table.cells.map(cell => [cell.row, cell.column, cell.rowSpan, cell.colSpan, cell.isMergedContinuation]))
      .toEqual([[0, 0, 99_999, 1024, false], [50_000, 512, 1, 1, true], [99_999, 1023, 1, 1, false]]);
    const text = table.cells.map(cell => cell.textFrame.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n'));
    expect(text).toEqual([emptyAnchor ? '' : 'Large merge origin', 'Stored covered value', 'Last sparse cell']);
    expect(document.warnings).toEqual([]);
  });

  it('bounds malformed ranges and reflects source merge edits when rebuilding', async () => {
    const document = await loadIwork(await createLargeMergedNumbersArchive({ rowCount: 1000, columnCount: 64 }));
    const archive = document.archive;
    const map = archive.records['7'].value as { cellRange: Array<{ origin: unknown; size: unknown }> };
    map.cellRange.push(...[
      { origin: { row: -1, column: 0 }, size: { numRows: 2, numColumns: 2 } },
      { origin: { row: .5, column: 0 }, size: { numRows: 2, numColumns: 2 } },
      { origin: { row: 0, column: 0 }, size: { numRows: 2000, numColumns: 64 } },
      { origin: { row: 0, column: 0 }, size: { numRows: 1, numColumns: 65 } }
    ]);
    const build = () => buildTableItem(archive, { tableModel: { identifier: 4 } },
      { x: 0, y: 0, width: 800, height: 600, rotation: 0, flipH: false, flipV: false }, 0)!;
    expect(build().cells).toHaveLength(3);
    expect(archive.warnings).toContain('Ignored 4 invalid table merge range(s).');
    map.cellRange = [{ origin: { row: 100, column: 4 }, size: { numRows: 800, numColumns: 2 } }];
    const table = build(), blank = table.cells.find(cell => cell.row === 100 && cell.column === 4)!;
    expect([blank.rowSpan, blank.colSpan, blank.isMergedContinuation]).toEqual([800, 2, false]);
    expect(table.cells[0].rowSpan).toBe(1);
    expect(table.cells.find(cell => cell.row === 500)?.isMergedContinuation).toBe(false);
  });

  it('queries overlapping, adjacent and expired coverage without losing stored boundary cells', async () => {
    const doc = await loadIwork(await createLargeMergedNumbersArchive({ rowCount: 1000, columnCount: 64 }));
    const archive = doc.archive;
    (archive.records['7'].value as any).cellRange = [[50, 4, 800, 5], [100, 7, 800, 5], [100, 20, 100, 2], [999, 60, 1, 4]]
      .map(([row, column, numRows, numColumns]) => ({ origin: { row, column }, size: { numRows, numColumns } }));
    const rowInfo = (archive.records['8'].value as any).rowInfos[0];
    for (const column of [3, 4, 6, 7, 11, 12, 19, 20, 21, 22]) {
      const offsets = new Uint8Array(128); offsets.fill(255); new DataView(offsets.buffer).setUint16(column * 2, 0, true);
      rowInfo.cellOffsets = offsets;
      const table = buildTableItem(archive, { tableModel: { identifier: 4 } },
        { x: 0, y: 0, width: 800, height: 600, rotation: 0, flipH: false, flipV: false }, 0)!;
      const cell = table.cells.find(cell => cell.row === 500 && cell.column === column)!;
      expect(cell.isMergedContinuation, `column ${column}`).toBe(column >= 4 && column < 12);
      expect(cell.textFrame.paragraphs[0].runs[0].text).toBe('Stored covered value');
      expect(table.cells.find(cell => cell.row === 999 && cell.column === 63)?.isMergedContinuation).toBe(true);
    }
  });
});
