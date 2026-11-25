import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { resolveSharedFormula } from '../src/shared-formulas';
import type { ParsedCell, ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createSharedFormulaWorkbook } from './fixtures/shared-formula-workbook.mjs';

function cell(sheet: ParsedSheet, ref: string): ParsedCell {
  return sheet.rows.flatMap(row => row.cells).find(cell => cell.ref === ref)!;
}

describe('XLSX shared formulas', () => {
  it('keeps a worksheet-local master and translates uncached followers and dependencies on demand', async () => {
    const workbook = await loadXlsxWorkbook(await createSharedFormulaWorkbook());
    const [summary, rates] = workbook.sheets;
    expect(workbook.warnings).toEqual([]);
    expect(Object.keys(summary.sharedFormulas!)).toHaveLength(4);
    expect(summary.rows).toHaveLength(5);
    expect(cell(summary, 'D4')).toMatchObject({ sharedFormulaId: 0, value: '', needsCalculation: true });
    expect(cell(summary, 'D4').formula).toBeUndefined();
    expect(resolveCellValue(summary, cell(summary, 'F2'))).toBe('76');
    expect(resolveCellValue(summary, cell(summary, 'D4'))).toBe('75');
    expect(resolveCellValue(summary, cell(summary, 'D2'))).toBe('57');
    expect(resolveCellValue(summary, cell(summary, 'E2'))).toBe('90');
    expect(resolveCellValue(summary, cell(summary, 'D3'))).toBe('99');
    expect(resolveCellValue(summary, cell(summary, 'E3'))).toBe('');
    expect(resolveCellValue(summary, cell(summary, 'G3'))).toBe('=UNKNOWN(A3,"A2")');
    expect(resolveCellValue(summary, cell(summary, 'J3'))).toBe('42');
    expect(resolveCellValue(summary, cell(summary, 'XFD1048576'))).toBe('12');
    expect(resolveCellValue(rates, cell(rates, 'C2'))).toBe('14');
    expect(cell(summary, 'D4').formula).toBeUndefined();
  });

  it('shifts cell and whole-axis references while preserving literals, function names, sheet names and structured references', () => {
    const formula = `SUM($A2,B$1,$C$3,A:C,$2:5,'Data ''2026'''!D2,LOG10(E2),Sheet2!F2,"A1:$A$2",Table1[[#All],[A1]],[Book.xlsx]S2!G2,S1:S2!H2,1E-6,A1.foo,αA1)`;
    const model: ParsedSheet = { id: 'test', name: 'test', rowCount: 10, columnCount: 20, rows: [],
      sharedFormulas: { 0: { formula, row: 2, column: 3, firstRow: 2, lastRow: 5, firstColumn: 3, lastColumn: 4 } } };
    expect(resolveSharedFormula(model, { ref: 'D4', row: 4, column: 4, value: '', sharedFormulaId: 0 }))
      .toBe(`SUM($A4,C$1,$C$3,B:D,$2:7,'Data ''2026'''!E4,LOG10(F4),Sheet2!G4,"A1:$A$2",Table1[[#All],[A1]],[Book.xlsx]S2!H4,S1:S2!I4,1E-6,A1.foo,αA1)`);
  });

  it('preserves caches and reports malformed, orphaned, out-of-range and ambiguous entries', async () => {
    const zip = await JSZip.loadAsync(await createSharedFormulaWorkbook());
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="b"><f t="shared" si="6"/></c><c r="B1"><f t="shared" si="6"/><v>9</v></c>'
      + '<c r="C1"><f t="shared" si="7" ref="C1:C2">1</f></c><c r="D1"><f t="shared" si="7" ref="D1:D2">2</f></c>'
      + '<c r="E1"><f t="shared" si="x"/><v>11</v></c><c r="F1"><f t="shared" si="8" ref="F2:F4">3</f></c>'
      + '<c r="G1"><f t="shared" si="9" ref="G1:G2">4</f></c></row>'
      + '<row r="2"><c r="C2"><f t="shared" si="7"/></c><c r="H2"><f t="shared" si="9"/></c></row>'
      + '</sheetData></worksheet>');
    const workbook = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }));
    const summary = workbook.sheets[0];
    expect(workbook.warnings).toEqual(['Ignored 7 invalid shared formula entries in sheet Summary.']);
    expect(Object.keys(summary.sharedFormulas!)).toHaveLength(1);
    expect(cell(summary, 'A1').valueType).toBeUndefined();
    expect(resolveCellValue(summary, cell(summary, 'A1'))).toBe('');
    expect(resolveCellValue(summary, cell(summary, 'B1'))).toBe('9');
    expect(resolveCellValue(summary, cell(summary, 'E1'))).toBe('11');
    expect(cell(summary, 'C2').sharedFormulaId).toBeUndefined();
    expect(cell(summary, 'H2').needsCalculation).toBeUndefined();
  });

  it('clones definitions and calculates followers against their own workbook copy', async () => {
    const workbook = await loadXlsxWorkbook(await createSharedFormulaWorkbook());
    const copy = clonePreviewWorkbook(workbook);
    const [summary, rates] = copy.sheets;
    expect(summary.sharedFormulas?.[0]).not.toBe(workbook.sheets[0].sharedFormulas?.[0]);
    cell(rates, 'A4').value = '10';
    expect(resolveCellValue(summary, cell(summary, 'D4'))).toBe('78');
    expect(resolveCellValue(workbook.sheets[0], cell(workbook.sheets[0], 'D4'))).toBe('75');
  });
});
