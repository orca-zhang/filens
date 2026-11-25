import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import type { ParsedSheet } from '../src/types';
import { createDefinedNameWorkbook } from './fixtures/defined-name-workbook.mjs';

function getCell(sheet: ParsedSheet, ref: string) {
  return sheet.rows.flatMap(row => row.cells).find(cell => cell.ref === ref)!;
}

describe('XLSX defined names', () => {
  it('uses source tab order, scoped and qualified names, sparse ranges and typed expressions', async () => {
    const workbook = await loadXlsxWorkbook(await createDefinedNameWorkbook());
    const [summary, rates] = workbook.sheets;
    expect(rates.name).toBe("Rates O'Brien");
    expect(workbook.definedNames).toContainEqual({ name: 'Tax', formula: "'Rates O''Brien'!$B$1", sheet: rates.name });
    expect(workbook.warnings).toEqual(['Ignored 2 invalid XLSX defined name entries.', 'Found 1 duplicate XLSX defined name entries.']);
    const value = (ref: string) => resolveCellValue(summary, getCell(summary, ref));
    expect(['B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'I1', 'J1', 'K1'].map(value))
      .toEqual(['5', '24', '21', '5.5', '5', '99', '77', '=LoopOne', '=Dup', '=External']);
    expect(['B2', 'C2', 'D2', 'F2', 'G2', 'H2', 'I2', 'J2', 'K2'].map(value))
      .toEqual(["=SUM('Rates O''Brien'!inputs)", '7!', '31', '12', '33', '23.2', '42', '=WrongScope', '=[1]!Rate']);
    expect(['A3', 'C3', 'F3', 'K3', 'A4', 'D4', 'XFD1048576'].map(value)).toEqual(['51', '12', '21', '=Recent', '50', '13', '67.5']);
    expect(resolveCellValue(rates, getCell(rates, 'D1'))).toBe('3');
    expect(resolveCellValue(rates, getCell(rates, 'E1'))).toBe('2.5');
    expect(getCell(summary, 'C2').valueType).toBe('text');
  });

  it('rebuilds one-sheet scopes and cross-sheet dependencies for each workbook clone', async () => {
    const original = await loadXlsxWorkbook(await createDefinedNameWorkbook());
    const copy = clonePreviewWorkbook(original);
    expect(copy.definedNames?.[0]).not.toBe(original.definedNames?.[0]);
    getCell(copy.sheets[1], 'A1').value = '4';
    expect(resolveCellValue(copy.sheets[0], getCell(copy.sheets[0], 'C1'))).toBe('17');
    expect(resolveCellValue(original.sheets[0], getCell(original.sheets[0], 'C1'))).toBe('24');

    const zip = await JSZip.loadAsync(await createDefinedNameWorkbook());
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Solo" r:id="summary"/></sheets><definedNames>'
      + '<definedName name="Rate">2</definedName><definedName name="Rate" localSheetId="0">5</definedName></definedNames></workbook>');
    zip.file('xl/worksheets/summary.xml', '<worksheet><sheetData><row r="1"><c r="A1"><f>Rate+[0]!Rate</f></c></row></sheetData></worksheet>');
    const solo = (await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }))).sheets[0];
    expect(resolveCellValue(solo, getCell(solo, 'A1'))).toBe('7');
  });

  it('bounds repeated name expansion without committing partial dependency results', async () => {
    const zip = await JSZip.loadAsync(await createDefinedNameWorkbook());
    const names = Array.from({ length: 14 }, (_, index) => `<definedName name="_Fan${index}">${index === 13 ? '1'
      : `_Fan${index + 1}+_Fan${index + 1}`}</definedName>`).join('');
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Summary" r:id="summary"/></sheets><definedNames>' + names + '</definedNames></workbook>');
    zip.file('xl/worksheets/summary.xml', '<worksheet><sheetData><row r="1">'
      + '<c r="A1"><f>_Fan0+A2</f></c><c r="B1"><f>A1+2</f></c><c r="C1"><f>_Fan8</f></c></row></sheetData></worksheet>');
    const summary = (await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array' }))).sheets[0];
    expect(resolveCellValue(summary, getCell(summary, 'B1'))).toBe('=A1+2');
    expect(getCell(summary, 'A1').needsCalculation).toBe(true);
    expect(resolveCellValue(summary, getCell(summary, 'C1'))).toBe('32');
  });
});
