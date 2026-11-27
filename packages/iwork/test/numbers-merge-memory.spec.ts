// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadIwork } from '../src/parser/load-iwork';
import { buildTableItem } from '../src/parser/table';
import { blankCellPaint } from '../src/table-paint';
import { cellStrokeBorders } from '../src/table-strokes';
import { createLargeMergedNumbersArchive, createModernNumbersArchive, createNumbersMediaArchive, createWideSparseNumbersArchive } from './fixtures/numbers-archive.mjs';

describe('Numbers merge parsing memory', () => {
  it('reads authored border layers and keeps full-axis stroke runs sparse', async () => {
    const document = await loadIwork(await createLargeMergedNumbersArchive({ customStrokes: true }));
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    const { archive } = document;
    const table = document.sheets[0].tables[0].item;
    expect(archive.records['20'].typeName).toBe('TST.StrokeSidecarArchive');
    expect(archive.records['21'].typeName).toBe('TST.StrokeLayerArchive');
    expect(table.cells).toHaveLength(3);
    expect(table.cells[0]).toMatchObject({ row: 0, column: 0, rowSpan: 99999, colSpan: 1024 });
    expect(table.cells[1].isMergedContinuation).toBe(true);
    expect(document.warnings).toEqual([]);
    const strokes = structuredClone(table.strokeEdges)!;
    expect(strokes.horizontal[0].map(({ start, end, line }) => [start, end, line.color, line.width])).toEqual([
      [0, 1, '#112299', 3], [1, 4, '#008844', 4], [4, 5, '#112299', 3], [5, 7, 'transparent', 0], [7, 1024, '#112299', 3]
    ]);
    expect(strokes.vertical[1024]).toMatchObject([{ start: 0, end: 99999, line: { color: '#995511' } }]);
    expect(cellStrokeBorders(strokes, 99998, 1022)?.bottom).toMatchObject({ color: '#aa2233', width: 4 });
    expect(cellStrokeBorders(strokes, 99999, 1022)?.top).toMatchObject({ color: '#aa2233', width: 4 });
    expect(table.cells.at(-1)?.borders?.top).toMatchObject({ color: '#552299', width: 5 });
  });

  it('reads MergeOwner ranges with an omitted end on a single row or column', async () => {
    const { archive } = await loadIwork(await createLargeMergedNumbersArchive({ rowCount: 1000, columnCount: 64, customStrokes: true }));
    const model = archive.records['4'].value as { mergeOwner: { formulaStore: { formulas: unknown[] } } };
    model.mergeOwner.formulaStore.formulas = [
      { absoluteRow: [{ rangeBegin: 20 }], absoluteColumn: [{ rangeBegin: 3, rangeEnd: 5 }] },
      { absoluteRow: [{ rangeBegin: 30, rangeEnd: 33 }], absoluteColumn: [{ rangeBegin: 8 }] }
    ].map(ASTColonTract => ({ formula: { ASTNodeArray: { ASTNode: [{ ASTColonTract }] } } }));
    const table = buildTableItem(archive, { tableModel: { identifier: 4 } },
      { x: 0, y: 0, width: 800, height: 600, rotation: 0, flipH: false, flipV: false }, 0)!;
    expect(table.cells.filter(cell => cell.rowSpan > 1 || cell.colSpan > 1)
      .map(cell => [cell.row, cell.column, cell.rowSpan, cell.colSpan])).toEqual([[20, 3, 1, 3], [30, 8, 4, 1]]);
    expect(archive.warnings).toEqual([]);
  });

  it('reads wide v5 offsets and legacy rows across tiles without filling sparse columns', async () => {
    const document = await loadIwork(await createWideSparseNumbersArchive({ rowCount: 512 }));
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    const table = document.sheets[0].tables[0].item;
    expect([table.rows.length, table.columns.length, table.cells.length]).toEqual([512, 2048, 768]);
    const read = (cell: typeof table.cells[number]) => [cell.row, cell.column, cell.textFrame.paragraphs[0].runs[0].text];
    expect(table.cells.slice(0, 3).map(read)).toEqual([[0, 0, 'Row start'], [0, 2047, 'Modern edge'], [1, 2047, 'Legacy edge']]);
    expect(table.cells.slice(381, 387).map(read)).toEqual([
      [254, 0, 'Row start'], [254, 2047, 'Modern edge'], [255, 2047, 'Legacy edge'],
      [256, 0, 'Row start'], [256, 2047, 'Modern edge'], [257, 2047, 'Legacy edge']
    ]);
    expect(read(table.cells.at(-1)!)).toEqual([511, 2047, 'Legacy edge']);
    expect(document.warnings).toEqual([]);
  });

  it('returns the complete media catalog and every sheet through the public reader', async () => {
    const document = await loadIwork(await createNumbersMediaArchive());
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    expect(Object.values(document.media).map(asset => asset.path)).toEqual(['Data/First.svg', 'Data/Later.svg', 'Data/Blank.svg', 'Data/Unused.svg']);
    expect(new TextDecoder().decode(document.media['104'].data)).toContain('numbers-unreferenced-image');
    expect(document.sheets.map(sheet => sheet.loaded)).toEqual([true, true, true]);
  });

  it('loads typed values and saved formats through wide row offsets', async () => {
    const document = await loadIwork(await createModernNumbersArchive());
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    const table = document.sheets[0].tables[0].item;
    const text = (cell: typeof table.cells[number]) => cell.textFrame.paragraphs[0].runs.map(run => run.text).join('');
    expect([table.rows.length, table.columns.length, table.cells.length]).toEqual([100_000, 2048, 2095]);
    expect(table.cells.filter(cell => cell.row === 0).map(cell => [cell.column, text(cell)])).toEqual([
      [0, '-12.50%'], [1, '1999-12-31 23:59:59'], [2, '36:00:00'], [3, 'Available'],
      [4, 'Modern text'], [5, '€123.45'], [6, '#ERROR!'], [8, '1e-10']
    ]);
    expect(table.cells.filter(cell => cell.row === 1).map(text)).toEqual([
      '36:00', '-1h 1m 1s 125ms', '0 days', '01:01.001', '2 weeks 3 days', '0.001 s', '36:00'
    ]);
    expect(table.cells.filter(cell => cell.row === 2).map(text)).toEqual([
      '-1.23E-05', '3 16/113', '-1 2/4', 'FFFFFF01', '-00FF', '0', '0E+00', '1.23E+03'
    ]);
    const decimals = table.cells.filter(cell => cell.row === 3);
    expect(decimals.map(text)).toEqual([
      '3', '(123,456.79)', '12.35%', '12.35%', '£(9,876,543.22)', '$ (1,234.56)', '0.00', '3'
    ]);
    expect(decimals[2].textFrame.paragraphs[0].runs[0].color).toBe('#ff0000');
    expect(decimals[3].textFrame.paragraphs[0].runs[0].color).not.toBe('#ff0000');
    expect(decimals[4].textFrame.paragraphs[0].runs[0].color).toBe('#ff0000');
    expect(decimals[5].textFrame.accounting).toBe(true);
    expect(decimals[5].textFrame.paragraphs[0].runs.map(run => run.text)).toEqual(['$ ', '(1,234.56)']);
    expect(table.cells.filter(cell => cell.row === 4).map(text)).toEqual([
      'Thursday, 29 February 2024 1:04:05.12345 PM AD', 'Sun5172026AD', 'Epoch 2001/01/01 24:00 0',
      '1372143', 'Friday, 31 December 1999 11:59:59.00000 PM AD'
    ]);
    const custom = table.cells.filter(cell => cell.row === 5);
    expect(custom.map(text)).toEqual([
      'Zero or below 1,234.56', 'Zero or below 0', 'Ref 007%: 1,234.56', 'Tag [A&B]', 'Tag [Styled text]',
      'CHF\u00a042.45 paid', '5% of 12.5%', '2 1/4', '1.23E-05', '-    42.12', 'Zero or below 2.5'
    ]);
    expect(custom[4].textFrame.paragraphs[0].runs.map(({ text, bold }) => [text, bold])).toEqual([
      ['Tag [', true], ['Styled', true], [' text', false], [']', false]
    ]);
    expect(table.cells[0].fill).toMatchObject({ color: '#00ff00' });
    const last = table.cells.at(-1)!;
    expect([last.row, last.column, text(last)]).toEqual([99_999, 2047, '€42.50']);
    expect(text(table.cells.at(-2)!)).toBe('1 day 1 hour');
    expect(text(table.cells.at(-3)!)).toBe('1.00E+01');
    expect(text(table.cells.at(-5)!)).toBe('Epoch 2001/01/01 24:00 0');
    expect(text(table.cells.at(-6)!)).toBe('Zero or below 1,234.56');
  });

  it('uses the saved locale and symbols for durations, percentages and currency', async () => {
    const document = await loadIwork(await createModernNumbersArchive({ locale: 'fr_FR', formattingSymbols: {
      currencyGroupingSeparator: '\u00a0', currencySymbols: [{ code: 'GBP', symbol: 'GBP£' }, { code: 'CHF', symbol: 'Fr.' }],
      months: ['janvier', 'février (source)'], pmSymbol: 'après-midi'
    } }));
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    const row = document.sheets[0].tables[0].item.cells.filter(cell => cell.row === 1);
    const text = (column: number) => row[column].textFrame.paragraphs[0].runs.map(run => run.text).join('').replace(/\s/g, ' ');
    expect(text(2)).toBe('0 jour');
    expect(text(3)).toBe('01:01,001');
    expect(text(4)).toBe('2 semaines 3 jours');
    const amounts = document.sheets[0].tables[0].item.cells.filter(cell => cell.row === 3);
    const formatted = (column: number) => amounts[column].textFrame.paragraphs[0].runs.map(run => run.text).join('');
    expect(formatted(1)).toBe('(123\u202f456,79)');
    expect(formatted(2)).toBe('12,35\u00a0%');
    expect(formatted(4)).toBe('(9\u00a0876\u00a0543,22)\u00a0GBP£');
    const dates = document.sheets[0].tables[0].item.cells.filter(cell => cell.row === 4);
    const dateText = (column: number) => dates[column].textFrame.paragraphs[0].runs.map(run => run.text).join('');
    expect(dateText(0)).toContain('jeudi, 29 février (source) 2024 1:04:05.12345 après-midi');
    expect(dateText(3)).toBe('1372023');
    const customs = document.sheets[0].tables[0].item.cells.filter(cell => cell.row === 5);
    expect(customs[2].textFrame.paragraphs[0].runs[0].text).toBe('Ref 007%: 1\u202f234,56');
    expect(customs[5].textFrame.paragraphs[0].runs[0].text).toBe('Fr.\u00a042,45 paid');
  });

  it('keeps inherited blank-cell paint sparse and matches stored styling defaults', async () => {
    const doc = await loadIwork(await createLargeMergedNumbersArchive({ styledBlanks: true }));
    if (doc.kind !== 'numbers') throw new Error('Expected Numbers document');
    const table = doc.sheets[0].tables[0].item;
    expect([table.rows.length, table.columns.length, table.cells.length]).toEqual([100_000, 1024, 3]);
    const styles = structuredClone(table.blankCellStyles)!;
    expect(Object.keys(styles.rows)).toEqual(['4']);
    expect(Object.keys(styles.columns)).toEqual(['4']);
    const paint = (row: number, col: number) => blankCellPaint(styles, row, col);
    expect(paint(0, 2)).toMatchObject({ fill: { color: '#99ccff' }, borders: { bottom: { color: '#336699', width: 3 } } });
    expect(paint(0, 2)).toMatchObject({ fill: table.cells[0].fill, borders: table.cells[0].borders });
    expect(paint(2, 0).fill).toMatchObject({ color: '#ffcc66' });
    expect(paint(2, 2)).toMatchObject({ fill: { color: '#ccddff' }, borders: { bottom: { color: '#334455', width: 2 } } });
    expect(paint(2, 2).borders?.right).toBeUndefined();
    expect(paint(3, 2).fill.type).toBe('none');
    expect(paint(4, 4).fill).toMatchObject({ color: '#ffccdd' });
    expect(paint(3, 4)).toMatchObject({ fill: { color: '#cceecc' }, borders: { right: { color: '#993366', width: 1 } } });
    expect(paint(99_999, 1022)).toMatchObject({ fill: { color: '#ccffcc' }, borders: { top: { color: '#006633', width: 4 } } });
    expect(table.cells.at(-1)?.fill).toMatchObject({ color: '#ffe666' });
  });

  it('preserves the paint of a dimensioned table without any tile records', async () => {
    const { archive } = await loadIwork(await createLargeMergedNumbersArchive({ rowCount: 1024, columnCount: 32, styledBlanks: true }));
    const model = archive.records['4'].value as { numberOfRows: number; baseDataStore: { tiles?: unknown; mergeRegionMap?: unknown } };
    delete model.baseDataStore.tiles;
    delete model.baseDataStore.mergeRegionMap;
    const build = () => buildTableItem(archive, { tableModel: { identifier: 4 } },
      { x: 0, y: 0, width: 800, height: 600, rotation: 0, flipH: false, flipV: false }, 0);
    const table = build()!;
    expect([table.rows.length, table.columns.length, table.cells.length]).toEqual([1024, 32, 0]);
    expect(blankCellPaint(table.blankCellStyles!, 1023, 31).fill).toMatchObject({ color: '#ccffcc' });
    model.numberOfRows = 0xffffffff;
    expect(build()).toBeUndefined();
  });
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
