import { openZipArchive } from '@filens/core';
import { describe, expect, it, vi } from 'vitest';
import { WorksheetCellIndex } from '../src/cell-index';
import { displaySpillCell, evaluateWorksheetFormula, registerWorkbookFormulas } from '../src/cell-value';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import type { ParsedCell, ParsedSheet } from '../src/types';
import { createFormulaWorkbook } from './fixtures/formula-workbook.mjs';
import { createCriteriaFormulaWorkbook } from './fixtures/criteria-formula-workbook.mjs';
import { createLookupFormulaWorkbook } from './fixtures/lookup-formula-workbook.mjs';
import { createDateFormulaWorkbook } from './fixtures/date-formula-workbook.mjs';
import { createTextFormulaWorkbook } from './fixtures/text-formula-workbook.mjs';
import { createStructuredReferenceWorkbook } from './fixtures/structured-reference-workbook.mjs';
import { createSumProductWorkbook } from './fixtures/sum-product-workbook.mjs';
import { createAggregateWorkbook } from './fixtures/aggregate-workbook.mjs';
import { createLetWorkbook } from './fixtures/let-workbook.mjs';
import { createArraySelectionWorkbook } from './fixtures/array-selection-workbook.mjs';

function sheet(values: string[], formula: string) {
  const result: ParsedCell = { ref: 'B1', row: 1, column: 2, value: '', formula, needsCalculation: true };
  const model: ParsedSheet = {
    id: 'sum', name: 'Sum', columnCount: 2, rowCount: values.length,
    rows: values.map((value, index) => ({ index: index + 1, cells: [{ ref: `A${index + 1}`, row: index + 1, column: 1, value }] }))
  };
  model.rows[0].cells.push(result);
  return { model, result };
}

describe('remainder and parity formulas', () => {
  it.each([
    ['MOD(3,2)', '1'], ['MOD(-3,2)', '1'], ['MOD(3,-2)', '-1'], ['MOD(-3,-2)', '-1'],
    ['MOD(-6.25,1)', '0.75'], ['MOD(4,-2)', '0'], ['MOD(1,0)', '#DIV/0!'],
    ['MOD(1,0.1)', '0'], ['MOD(0.7,0.1)', '0'], ['MOD(0.3-0.1-0.1,0.1)', '0'], ['MOD(0.1+0.2,0.3)', '0'],
    ['MOD(100000000000000.125,1)', '0.125'],
    ['MOD(1,)', '#VALUE!'], ['MOD("none",2)', '#VALUE!'], ['MOD(1e999,2)', '#NUM!'],
    ['ISEVEN(-2.9)', 'TRUE'], ['ISODD(-3.9)', 'TRUE'], ['ISODD(0)', 'FALSE'], ['ISEVEN(2.9999999999999996)', 'FALSE'],
    ['ISODD("none")', '#VALUE!'], ['ISEVEN(#N/A)', '#N/A'],
    ['SUMPRODUCT((MOD(ROW(A1:A3),2)=1)*A1:A3)', '4'],
    ['TEXTJOIN("|",FALSE,IFERROR(MOD({1,2,3},{2,0,-2}),"error"))', '1|error|-1'],
    ['TEXTJOIN("|",FALSE,ISEVEN({1,2,-3.5,-4.5}))', 'FALSE|TRUE|FALSE|TRUE'],
    ['INDEX(ISODD(SEQUENCE(1,16384)),1,16384)', 'FALSE']
  ])('calculates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
    if (expected === 'TRUE' || expected === 'FALSE') expect(result.valueType).toBe('boolean');
    else if (expected.startsWith('#')) expect(result.valueType).toBe('error');
  });
});

describe('SEQUENCE', () => {
  it.each([
    ['SUM(_xlfn.SEQUENCE(4,5))', '210'],
    ['TEXTJOIN("|",FALSE,SEQUENCE(,3,10,2))', '10|12|14'],
    ['TEXTJOIN("|",FALSE,SEQUENCE(2,,1.5,-0.5))', '1.5|1'],
    ['SEQUENCE(1,,TRUE)', '1'],
    ['INDEX(SEQUENCE(2.9,3.9,-5,0.5),2,3)', '-2.5'],
    ['SUMPRODUCT(SEQUENCE(2,2),SEQUENCE(2,2,,0))', '10'],
    ['SUM(IF(SEQUENCE(2,2)>2,SEQUENCE(2,2)*2,0))', '14'],
    ['TEXTJOIN("|",TRUE,FILTER(SEQUENCE(1048576,2),A:A=2))', '3|4'],
    ['TEXTJOIN("|",TRUE,INDEX(SEQUENCE(2,3),0,2))', '2|5'],
    ['TEXTJOIN("|",TRUE,INDEX(A1:A3,0))', '1|2|3'],
    ['SUM(INDEX(A1:A3,0,0))', '6'],
    ['SUM(INDEX(SEQUENCE(1048576,16384),1048576,0))', String((1_048_576 * 16_384 - (16_384 - 1) / 2) * 16_384)],
    ['INDEX(CHOOSECOLS(CHOOSEROWS(SEQUENCE(1048576,16384),-1),-1),1)', '17179869184'],
    ['COUNT(SEQUENCE(1048576,16384,4,0))', '17179869184'],
    ['SUMPRODUCT(SEQUENCE(1048576,16384,4,0),SEQUENCE(1048576,16384,2,0))', '137438953472'],
    ['SUM(SEQUENCE(1048576,16384))', '=SUM(SEQUENCE(1048576,16384))'],
    ['SUMPRODUCT(SEQUENCE(1048576,16384))', '=SUMPRODUCT(SEQUENCE(1048576,16384))'],
    ['SEQUENCE(0)', '#CALC!'],
    ['SEQUENCE(-1)', '#VALUE!'],
    ['SEQUENCE(1048577)', '#SPILL!'],
    ['SEQUENCE(1,16385)', '#SPILL!'],
    ['SEQUENCE("wrong")', '#VALUE!'],
    ['SEQUENCE()', '#VALUE!'],
    ['SEQUENCE(1,1,1,1,1)', '#VALUE!'],
    ['INDEX(SEQUENCE(1,2,1e308,1e308),2)', '#NUM!']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('MAKEARRAY and array statistics', () => {
  it.each([
    ['TEXTJOIN("|",FALSE,MAKEARRAY(2,3,LAMBDA(rr,cc,rr*10+cc)))', '11|12|13|21|22|23'],
    ['LET(f,LAMBDA(rr,cc,INDEX(A1:A3,rr)+cc),INDEX(MAKEARRAY(3.8,2.2,f),3,2))', '5'],
    ['INDEX(MAKEARRAY(1048576,16384,LAMBDA(rr,cc,rr+cc)),1048576,16384)', '1064960'],
    ['SUM(MAKEARRAY(1048576,1,LAMBDA(rr,cc,rr+cc)))', '=SUM(MAKEARRAY(1048576,1,LAMBDA(rr,cc,rr+cc)))'],
    ['INDEX(MAKEARRAY(2,2,LAMBDA(rr,cc,IF(rr=1,rr,NA()))),2,2)', '#N/A'],
    ['MAKEARRAY(1,1,LAMBDA(rr,cc,{1,2}))', '#CALC!'],
    ['MAKEARRAY(1,1,LAMBDA(rr,rr))', '#VALUE!'],
    ['MAKEARRAY(1,1,42)', '#VALUE!'],
    ['MAKEARRAY(,1,LAMBDA(rr,cc,rr+cc))', '#VALUE!'],
    ['MAKEARRAY(0,1,LAMBDA(rr,cc,rr+cc))', '#VALUE!'],
    ['MAKEARRAY(-1,1,LAMBDA(rr,cc,rr+cc))', '#VALUE!'],
    ['MAKEARRAY(A1:A2,1,LAMBDA(rr,cc,rr+cc))', '#VALUE!'],
    ['MAKEARRAY(1048577,1,LAMBDA(rr,cc,rr+cc))', '#SPILL!'],
    ['MAKEARRAY(1,16385,LAMBDA(rr,cc,rr+cc))', '#SPILL!'],
    ['LARGE({1,TRUE,3,3,2,"9"},2)', '3'],
    ['LARGE(A:A,4)', '#NUM!'],
    ['SMALL({1,2,#N/A},1)', '#N/A'],
    ['TEXTJOIN("|",FALSE,SMALL({9,7,8},{1,2,3}))', '7|8|9'],
    ['LARGE(SEQUENCE(1048576,16384,23,0),1030000)', '23'],
    ['ROUND(CORREL({1,2,3,4},{4,3,2,1}),14)', '-1'],
    ['ROUND(CORREL({1,"ignored",5,7},{3,999,11,15}),14)', '1'],
    ['CORREL(A1:A2,A1:A3)', '#N/A'],
    ['CORREL({2,2,2},{1,2,3})', '#DIV/0!'],
    ['CORREL({1,2,#N/A},{1,4,9})', '#N/A'],
    ['ROUND(CORREL(A:A,A:A),14)', '1']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('numeric text formulas', () => {
  it.each([
    ['_xlfn.NUMBERVALUE("2.500,27",",",".")', '2500.27'],
    ['NUMBERVALUE("3.5%")', '0.035'], ['NUMBERVALUE(" 3 000 ")', '3000'],
    ['NUMBERVALUE("9%%")', '0.0009'], ['NUMBERVALUE("1e309%")', '1e+307'],
    ['NUMBERVALUE("10,15",",")', '10.15'], ['NUMBERVALUE("2.500,27",",;","._")', '2500.27'],
    ['NUMBERVALUE("",".",",")', '0'], ['NUMBERVALUE("1.2.3",".",",")', '#VALUE!'],
    ['NUMBERVALUE("1.2,3",".",",")', '#VALUE!'], ['NUMBERVALUE("123.4",".",".")', '#VALUE!'],
    ['NUMBERVALUE("123//22","//")', '#VALUE!'], ['NUMBERVALUE("0x10")', '#VALUE!'],
    ['NUMBERVALUE(54.2,",",".")', '54.2'], ['NUMBERVALUE("1",#REF!,",")', '#REF!'],
    ['NUMBERVALUE(1,".","." )', '#VALUE!'], ['NUMBERVALUE()', '#VALUE!'],
    ['VALUE("$1,000")', '1000'], ['VALUE("($1,000.25)")', '-1000.25'],
    ['ROUND(VALUE("16:48:00")-VALUE("12:00:00"),10)', '0.2'], ['VALUE("2024-02-29")', '45351'],
    ['VALUE("1,234e2")', '123400'], ['VALUE("1,23")', '#VALUE!'],
    ['VALUE("12 potatoes")', '#VALUE!'], ['VALUE("")', '#VALUE!'], ['VALUE(C1)', '0'],
    ['SUM(NUMBERVALUE({"1,50";"2,25"},",","."))', '3.75'],
    ['TEXTJOIN("|",FALSE,NUMBERVALUE({"1.200,2";"1,200.2"},{",";"."},{".";","}))', '1200.2|1200.2'],
    ['TEXTJOIN("|",TRUE,IFERROR(NUMBERVALUE({"1,50";"bad"},",","."),"missing"))', '1.5|missing'],
    ['TEXTJOIN("|",FALSE,NUMBERVALUE({"1.200,2";"1,200.2"},{",";"."},{".","，"}))', '#VALUE!']
  ])('calculates %s with Excel-compatible defaults', (formula, expected) => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    try {
      const { model, result } = sheet(['1'], formula);
      expect(resolveCellValue(model, result)).toBe(expected);
      expect(result.valueType).toBe(expected.startsWith('#') ? 'error' : expected.includes('|') ? 'text' : undefined);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    ['de-DE', 'NUMBERVALUE("1.234,56")', '1234.56'],
    ['de-DE', 'VALUE("1,234")', '1.234'],
    ['fr-FR', 'VALUE("1\u00a0234,25 €")', '1234.25'],
    ['en-IN', 'VALUE("1,23,456.5")', '123456.5'],
    ['ar-EG', 'NUMBERVALUE("١٬٢٣٤٫٥")', '1234.5']
  ])('uses the %s number symbols in %s', (language, formula, expected) => {
    vi.stubGlobal('navigator', { language });
    try {
      const { model, result } = sheet(['1'], formula);
      expect(resolveCellValue(model, result)).toBe(expected);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('ISFORMULA', () => {
  it.each([
    ['_xlfn.ISFORMULA(A1)', 'TRUE'], ['ISFORMULA(A2)', 'FALSE'], ['ISFORMULA(A3)', 'FALSE'],
    ['ISFORMULA(A4)', 'TRUE'], ['ISFORMULA(A5)', 'TRUE'], ['ISFORMULA(A6)', 'FALSE'],
    ['ISFORMULA(A7)', 'FALSE'], ['ISFORMULA(B1)', 'TRUE'], ['ISFORMULA(A1:A7)', 'TRUE'],
    ['ISFORMULA((OFFSET(A2,2,0)))', 'TRUE'], ['ISFORMULA(INDIRECT("A2"))', 'FALSE'],
    ['ISFORMULA(INDEX(A1:A7,4))', 'TRUE'], ['ISFORMULA(INDEX(A1:A7,2))', 'FALSE'],
    ['FORMULATEXT(INDEX((A2:A3,A4:A5),1,1,2))', '=3/0'],
    ['ISFORMULA(INDEX({1;2},2))', '#VALUE!'],
    ['ISFORMULA(_xlfn.XLOOKUP(4,{1;2;3;4},A1:A4,1/0))', 'TRUE'],
    ['FORMULATEXT(XLOOKUP(4,{1;2;3;4},A1:A4))', '=3/0'],
    ['ISFORMULA(XLOOKUP(2,{1;2;3;4},A1:A4))', 'FALSE'],
    ['FORMULATEXT(XLOOKUP(99,{1;2},A1:A2,A4))', '=3/0'],
    ['LET(found,XLOOKUP(4,{1;2;3;4},A1:A4),ISFORMULA(found))', 'TRUE'],
    ['TEXTJOIN("|",FALSE,TAKE(ISFORMULA(XLOOKUP("left",{"left","right"},A1:B5)),5))', 'TRUE|FALSE|FALSE|TRUE|TRUE'],
    ['ISFORMULA(XLOOKUP(1,{1},{2}))', '#VALUE!'],
    ['ISFORMULA(SourceCell)', 'TRUE'], ["ISFORMULA('Formula data'!A1)", 'TRUE'],
    ['ISFORMULA(ConstantName)', '#VALUE!'], ['ISFORMULA(A1+0)', '#VALUE!'],
    ['ISFORMULA(7)', '#VALUE!'], ['ISFORMULA("A1")', '#VALUE!'], ['ISFORMULA()', '#VALUE!'],
    ['ISFORMULA(A1,A2)', '#VALUE!'], ['ISFORMULA(A2:A7)', '#VALUE!'], ['ISFORMULA(Missing!A1)', '#REF!'],
    ['ISFORMULA(A8)', 'TRUE'], ['ISFORMULA(A9)', 'TRUE'], ['ISFORMULA(A10)', 'TRUE'], ['ISFORMULA(A11)', 'FALSE'],
    ['TEXTJOIN("|",FALSE,TAKE(ISFORMULA(A8:A11),4))', 'TRUE|TRUE|TRUE|FALSE'],
    ['TEXTJOIN("|",FALSE,TAKE(ISFORMULA(A10#),2))', 'TRUE|FALSE'], ['FORMULATEXT(A9)', '#N/A']
  ])('checks source formula records in %s', (formula, expected) => {
    const { model, result } = sheet(['', '7', 'Hello, world!', '', '2', '#N/A', '', '1', '2', '1', '2'], formula);
    Object.assign(model.rows[0].cells[0], { formula: 'TODAY()', needsCalculation: true });
    Object.assign(model.rows[3].cells[0], { formula: '3/0', needsCalculation: true });
    model.rows[4].cells[0].sharedFormulaId = 0;
    model.rows[5].cells[0].valueType = 'error';
    model.rows[6].cells.length = 0;
    model.rows[7].cells[0].formula = 'SEQUENCE(2)';
    model.rows[9].cells[0].formula = 'SEQUENCE(2)';
    model.sharedFormulas = { 0: { formula: '3/0', row: 4, column: 1, firstRow: 4, lastRow: 5, firstColumn: 1, lastColumn: 1 } };
    model.arrayFormulas = [
      { firstRow: 8, lastRow: 9, firstColumn: 1, lastColumn: 1 },
      { firstRow: 10, lastRow: 11, firstColumn: 1, lastColumn: 1, dynamic: true }
    ];
    const other = sheet([''], '42').model;
    other.name = 'Formula data';
    other.rows[0].cells[0].formula = 'UNSUPPORTED()';
    registerWorkbookFormulas({ sheets: [model, other], warnings: [], definedNames: [
      { name: 'SourceCell', formula: "'Formula data'!$A$1" }, { name: 'ConstantName', formula: '7' }
    ] });
    expect(resolveCellValue(model, result)).toBe(expected);
    if (expected === 'TRUE' || expected === 'FALSE') expect(result.valueType).toBe('boolean');
    expect(model.rows[0].cells[0].needsCalculation).toBe(true);
    expect(model.rows[3].cells[0].needsCalculation).toBe(true);
  });

  it('projects a declared spill and slices a whole grid without visiting reference values', () => {
    const { model, result } = sheet(['1', '2'], 'ISFORMULA(A1:A2)');
    model.rows[0].cells[0].formula = '1/0';
    model.arrayFormulas = [{ firstRow: 1, lastRow: 2, firstColumn: 2, lastColumn: 2, dynamic: true }];
    model.rows.push({ index: 1_048_576, cells: [
      { ref: 'XFD1048576', row: 1_048_576, column: 16_384, formula: 'NA()', value: '', needsCalculation: true }
    ] });
    expect(resolveCellValue(model, result)).toBe('TRUE');
    expect(displaySpillCell(model, 2, 2)).toMatchObject({ value: 'FALSE', valueType: 'boolean' });
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      const formula = 'TEXTJOIN("|",FALSE,TAKE(ISFORMULA(A1:XFD1048576),-1,-2))';
      expect(evaluateWorksheetFormula(model, formula, result)).toBe('FALSE|TRUE');
      expect(get).toHaveBeenCalledTimes(2);
      expect(model.rows.at(-1)!.cells[0].needsCalculation).toBe(true);
    } finally { get.mockRestore(); }
  });
});

describe('array selection formulas', () => {
  it.each([
    ['SUM(FILTER({1,2;3,4;5,6},{TRUE;FALSE;TRUE}))', '14'],
    ['TEXTJOIN(",",TRUE,FILTER({1,2,3;4,5,6},{0,1,1}))', '2,3,5,6'],
    ['FILTER(2,FALSE)', '#CALC!'],
    ['FILTER(2,TRUE,1/0)', '2'],
    ['FILTER(2,FALSE,"none")', 'none'],
    ['FILTER({1,2;3,4},{1,#N/A})', '#N/A'],
    ['INDEX(FILTER({1,2;3,4},{0;1}),1,3)', '#REF!'],
    ['FILTER({1,2;3,4},{1;0;0})', '#VALUE!'],
    ['FILTER({1,2;3,4},{1,0;0,1})', '#VALUE!'],
    ['TEXTJOIN(",",TRUE,CHOOSEROWS({1,2;3,4;5,6},-1,1,-1))', '5,6,1,2,5,6'],
    ['TEXTJOIN(",",TRUE,CHOOSECOLS({1,2,3;4,5,6},-1,{1;3}))', '3,1,3,6,4,6'],
    ['INDEX(CHOOSEROWS({1;2;3},-1),1)', '3'],
    ['INDEX(CHOOSECOLS({1,2,3},0),1)', '#VALUE!'],
    ['INDEX(CHOOSECOLS({1,2,3},-4),1)', '#VALUE!'],
    ['TEXTJOIN("|",TRUE,_xlfn.TAKE({1,2,3;4,5,6;7,8,9},-2.8,2))', '4|5|7|8'],
    ['TEXTJOIN("|",TRUE,TAKE({1,2,3;4,5,6},,-2))', '2|3|5|6'],
    ['TEXTJOIN("|",TRUE,TAKE({1,2;3,4},-50,50))', '1|2|3|4'],
    ['TEXTJOIN("|",TRUE,DROP({1,2,3;4,5,6;7,8,9},1,-2))', '4|7'],
    ['TEXTJOIN("|",TRUE,DROP({1,2;3,4},0,1))', '2|4'],
    ['TEXTJOIN("|",TRUE,DROP({1,2;3,4},,-1))', '1|3'],
    ['TEXTJOIN("|",TRUE,DROP({1,2;3,4},0,0))', '1|2|3|4'],
    ['INDEX(DROP(SORT({3;#N/A;2;1}),-1),2)', '2'],
    ['SUM(TAKE({#N/A,2;3,4},-1))', '7'],
    ['SUM(TAKE(A:A,2))', '3'],
    ['INDEX(TAKE(A:A,-1),1)', '0'],
    ['TAKE(2,1)', '2'],
    ['TAKE(A1:A3,A2:A3)', '#VALUE!'],
    ['TAKE({1;2})', '#VALUE!'],
    ['DROP({1;2},,)', '#VALUE!'],
    ['TAKE({1;2},0)', '#CALC!'],
    ['DROP({1;2},-3)', '#CALC!'],
    ['DROP({1,2;3,4},1,2)', '#CALC!'],
    ['DROP({1;2},#N/A)', '#N/A'],
    ['TAKE({1;2},1e309)', '#NUM!'],
    ['TEXTJOIN(",",TRUE,LET(data,FILTER({1;#N/A;3},{1;1;1}),IF(ISNA(data),"-",data)))', '1,-,3'],
    ['TEXTJOIN(",",TRUE,LET(data,{1;0;1},IF(data,4,IFERROR(1/0,6))))', '4,6,4'],
    ['TEXTJOIN(",",TRUE,LET(data,{1;1},IF(data,4,1/0)))', '4,4'],
    ['COUNT(FILTER(A:A+0,A:A=0))', '1048573']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('evaluates parsed cross-sheet selectors and reads only stored inputs for a full-width sparse FILTER', async () => {
    const { sheets: [summary] } = await loadXlsxWorkbook(await createArraySelectionWorkbook());
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell))).toEqual(['28', '5', '2|3|2|5|7|5', '-', '90', '8']);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe('14');
      expect(get.mock.calls).toEqual([[2, 4], [1048576, 16384]]);
    } finally { get.mockRestore(); }
  });
});

describe('TEXTSPLIT', () => {
  it.each([
    ['TEXTJOIN("|",FALSE,_xlfn.TEXTSPLIT(",a,,b,",","))', '|a||b|', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("a;!b!!c;",,{";","!"},TRUE))', 'a|b|c', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("A,B;C",",",";",,,"pad"))', 'A|B|C|pad', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("a,b;,;x",",",";",TRUE,,"pad"))', 'a|b|x|pad', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("a,,b;c,d",",",";",TRUE))', 'a|b|c|d', 'text'],
    ['TEXTJOIN("|",FALSE,TRIM(TEXTSPLIT("  A   A  , B ",",")))', 'A A|B', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("ABxCDXÉ","x",,,1))', 'AB|CD|É', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("Mr. A, B",{" ",", ","Mr. "},,TRUE))', 'A|B', 'text'],
    ['TEXTJOIN("|",FALSE,TEXTSPLIT("α[β]🙂γ",{"[","]🙂"}))', 'α|β|γ', 'text'],
    ['INDEX(TEXTSPLIT("a,b;c",",",";"),2,2)', '#N/A', 'error'],
    ['INDEX(TEXTSPLIT("a,b;c",",",";",,,#REF!),2,2)', '#REF!', 'error'],
    ['INDEX(TEXTSPLIT("a,b;c",",",";",,,#REF!),1,2)', 'b', 'text'],
    ['INDEX(TEXTSPLIT("a,b;c",",",";",,,FALSE),2,2)', 'FALSE', 'boolean'],
    ['INDEX(TEXTSPLIT("a,b;c",",",";",,,0),2,2)', '0', undefined],
    ['TEXTSPLIT("same",",")', 'same', 'text'],
    ['TEXTSPLIT("",",")', '#VALUE!', 'error'], ['TEXTSPLIT("test","")', '#VALUE!', 'error'],
    ['TEXTSPLIT("test")', '#VALUE!', 'error'], ['TEXTSPLIT("test",",",,,2)', '#VALUE!', 'error'],
    ['TEXTSPLIT(",,",",",,TRUE)', '#CALC!', 'error'], ['TEXTSPLIT(#N/A,",")', '#N/A', 'error']
  ])('calculates %s', (formula, expected, type) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
    expect(result.valueType).toBe(type);
  });

  it('counts padding without expanding the rectangular result', () => {
    const source = 'a,'.repeat(8_000) + 'end' + ';r'.repeat(8_000);
    const { model, result } = sheet([source], 'SUM(TEXTSPLIT(A1,",",";",,,2))');
    model.rows[0].cells[0].valueType = 'text';
    expect(resolveCellValue(model, result)).toBe('128000000');
  });
});

describe('stacking formula arrays', () => {
  it.each([
    ['TEXTJOIN("|",TRUE,_xlfn.HSTACK({1;2},{3;4},{5;6}))', '1|3|5|2|4|6'],
    ['TEXTJOIN("|",TRUE,IFERROR(_xlfn.VSTACK({1,2,3},{4,5},{6}),"-"))', '1|2|3|4|5|-|6|-|-'],
    ['TEXTJOIN("|",TRUE,IFNA(HSTACK({1;2},3,NA()),"-"))', '1|3|-|2|-|-'],
    ['INDEX(IFNA(HSTACK(1,1/0),99),1,2)', '#DIV/0!'],
    ['INDEX(VSTACK({TRUE,"";FALSE,0},7),2,1)', 'FALSE'],
    ['INDEX(VSTACK({TRUE,"";FALSE,0},7),1,2)', ''],
    ['INDEX(HSTACK({1;2},{3,4}),2,3)', '#N/A'],
    ['INDEX(VSTACK({1;2},{3,4}),1,2)', '#N/A'],
    ['INDEX(HSTACK(A1:A3),1)', '1'],
    ['LET(values,VSTACK(A1:A2,{0;3}),TEXTJOIN("|",TRUE,FILTER(values,values<>"")))', '1|0|3'],
    ['COUNT(HSTACK(A:A,C:XFD))', '2'],
    ['SUM(HSTACK(A:A,C:XFD))', '4'],
    ['SUM(VSTACK(SEQUENCE(524288,16384,2,0),SEQUENCE(524288,16384,2,0)))', String(1_048_576 * 16_384 * 2)],
    ['SUM(TAKE(IFERROR(HSTACK(SEQUENCE(1048576,16383),9),0),-1,-2))', String(1_048_576 * 16_383)],
    ['SUM(TAKE(VSTACK(SEQUENCE(1048575,1),{23,24}),-1))', '47'],
    ['COUNT(TAKE(VSTACK(SEQUENCE(1048575,1),{23,24}),1048575,-1))', '0'],
    ['SUM(HSTACK(A:A,7))', '#N/A'],
    ['VSTACK(A:A,A1)', '#SPILL!'],
    ['HSTACK(A:XFD,A1)', '#SPILL!'],
    ['HSTACK()', '#VALUE!'],
    ['VSTACK(1,,2)', '#VALUE!']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('distinct records and text substitution', () => {
  it.each([
    ['TEXTJOIN("|",TRUE,_xlfn.UNIQUE({"North",2;"north",2;"South",2;"North",3}))', 'North|2|South|2|North|3'],
    ['TEXTJOIN("|",TRUE,UNIQUE({1,1,2;3,3,4},TRUE))', '1|2|3|4'],
    ['TEXTJOIN("|",TRUE,UNIQUE({1,1,2;3,3,4},TRUE,TRUE))', '2|4'],
    ['TEXTJOIN("|",TRUE,UNIQUE({"North";"north";"South"},,TRUE))', 'South'],
    ['UNIQUE({2;2},,TRUE)', '#CALC!'],
    ['ROWS(UNIQUE({0;"0";FALSE;0}))', '3'],
    ['ROWS(UNIQUE(VSTACK(A1:A3,0)))', '4'],
    ['IFNA(INDEX(UNIQUE({#N/A;#N/A;7}),1),19)', '19'],
    ['ROWS(UNIQUE(HSTACK(A:A,C:XFD)))', '3'],
    ['COLUMNS(UNIQUE(HSTACK(A:A,C:XFD),TRUE))', '2'],
    ['SUM(UNIQUE(A:A,,TRUE))', '4'],
    ['INDEX(UNIQUE(SEQUENCE(1048576),TRUE,TRUE),1048576)', '1048576'],
    ['UNIQUE({1;2},A1:A2)', '#VALUE!'],
    ['SUBSTITUTE("north north North","north","south")', 'south south North'],
    ['SUBSTITUTE("aaaa","aa","b",2)', 'aab'],
    ['SUBSTITUTE("abcabc","abc","$&",2.9)', 'abc$&'],
    ['SUBSTITUTE("abc","abc","x",7)', 'abc'],
    ['SUBSTITUTE("abc","","x")', 'abc'],
    ['SUBSTITUTE("abc","a","",0)', '#VALUE!'],
    ['TEXTJOIN("|",TRUE,SUBSTITUTE(HSTACK({"red";"green"},{"fed";"red"}),"ed","!"))', 'r!|f!|green|r!'],
    ['INDEX(TAKE(SUBSTITUTE(HSTACK(A:A,C:XFD),1,"yes"),-1,-1),1)', '']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('array COUNTIF and CHOOSE', () => {
  it.each([
    ['TEXTJOIN("|",TRUE,COUNTIF(A1:A4,A1:A4))', '2|0|2|1'],
    ['TEXTJOIN("|",TRUE,COUNTIF(A1:A4,{"",">1","<>1","*"}))', '1|1|2|0'],
    ['TEXTJOIN("|",TRUE,IFNA(COUNTIF(A1:A4,{1,#N/A,3}),99))', '2|99|1'],
    ['INDEX(COUNTIF(A:A,A:A),1048576)', '0'],
    ['SUM(COUNTIF(A:A,A:A))', '5'],
    ['CHOOSE(2.7,1/0,42)', '42'],
    ['SUM(CHOOSE(2,1/0,A1:A4))', '5'],
    ['CHOOSE(0,1,2)', '#VALUE!'],
    ['CHOOSE(2,1,)', '0'],
    ['TEXTJOIN("|",TRUE,CHOOSE({1,2},{1;2;3},{4;5;6}))', '1|4|2|5|3|6'],
    ['TEXTJOIN("|",TRUE,CHOOSE({2;1},{1,2,3},{4,5,6}))', '4|5|6|1|2|3'],
    ['TEXTJOIN("|",TRUE,CHOOSE({2;1;2},{1;2;3},{4;5;6}))', '4|2|6'],
    ['TEXTJOIN("|",TRUE,IFERROR(CHOOSE({1,2},{1;2},{3;4;5}),"-"))', '1|3|2|4|-|5'],
    ['TEXTJOIN("|",TRUE,IFERROR(CHOOSE({1,0;2,1},4,5),"-"))', '4|-|5|4'],
    ['SUM(CHOOSE({2,1},A:A,C:C))', '5'],
    ['ROWS(CHOOSE({2,1},A:A,C:C))', '1048576'],
    ['SUM(TAKE(CHOOSE({1,2},SEQUENCE(1048576),9),-1))', '1048585']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '', '1', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('LET', () => {
  it.each([
    ['LET(x,5,SUM(x,1))', '6'],
    ['_xlfn.LET(_xlpm.score,MAX(A:A),_xlpm.total,_xlpm.score*2,_xlpm.total+score)', '9'],
    ['LET(x,2,LET(x,x+1,x+4)+x)', '9'],
    ['LET(x,4,IFERROR(LET(x,2,1/0),x)+x)', '8'],
    ['LET(amount,1/0,IFERROR(amount,9))', '9'],
    ['LET(unused,1/0,2)', '2'],
    ['LET(amount,1/0,amount)', '#DIV/0!'],
    ['LET(data,A:A,SUM(data))', '6'],
    ['LET(data,A:A,INDEX(data,3))', '3'],
    ['LET(keys,A1:A3,XLOOKUP(2,keys,keys))', '2'],
    ['LET(data,{1,2;3,4},INDEX(data,2,2))', '4'],
    ['LET(data,A1:A3*2,AGGREGATE(14,4,data,2))', '4'],
    ['LET(data,A1:A3*2,TEXTJOIN("-",FALSE,data))', '2-4-6'],
    ['LET(data,{1,0,2},SUMPRODUCT(data^2))', '5'],
    ['SUM(LET(data,A1:A3,data))', '6'],
    ['LET(XFE1,3,XFE1)', '3'],
    ['LET(C,3,C)', '#NAME?'],
    ['LET(RC1,3,RC1)', '#NAME?'],
    ['LET(A1,3,A1)', '#NAME?'],
    ['LET(amount,1,AMOUNT,2,amount)', '#NAME?'],
    ['LET(first,second,second,2,first)', '#NAME?'],
    ['LET(amount,1)', '#VALUE!'],
    ['LET(amount,1,)', '#VALUE!']
  ])('evaluates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('evaluates named ranges and counts entire grid gaps with one read of the stored array position', async () => {
    const { sheets: [summary] } = await loadXlsxWorkbook(await createLetWorkbook());
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell))).toEqual(['26', '58', '13', '41', 'saved fallback', '4/5', '991']);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe(String(16_380 * 1_048_576 + 24));
      expect(get).toHaveBeenCalledExactlyOnceWith(1048576, 16384);
    } finally { get.mockRestore(); }
  });

  it('reuses sparse iterators and computed positions in a chain of array bindings', () => {
    const chain = Array.from({ length: 70 }, (_, i) => `term${i + 1},term${i}+term${i}`).join(',');
    const { model, result } = sheet(['2'], `LET(term0,A:A+1,${chain},SUM(term70))`);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      expect(resolveCellValue(model, result)).toBe(String((1_048_575 + 3) * 2 ** 70));
      expect(get).toHaveBeenCalledExactlyOnceWith(1, 1);
    } finally { get.mockRestore(); }
  });
});

describe('AGGREGATE', () => {
  it.each([
    [1, '', '2.5'], [2, '', '4'], [3, '', '4'], [4, '', '4'], [5, '', '1'],
    [6, '', '24'], [7, '', String(Math.sqrt(5 / 3))], [8, '', String(Math.sqrt(5 / 4))],
    [9, '', '10'], [10, '', String(5 / 3)], [11, '', '1.25'], [12, '', '2.5'], [13, '', '#N/A'],
    [14, ',2.9', '3'], [15, ',2', '2'], [16, ',0.25', '1.75'], [17, ',1', '1.75'],
    [18, ',0.25', '1.25'], [19, ',1', '1.25']
  ])('calculates operation %s', (mode, suffix, expected) => {
    const { model, result } = sheet(['1', '2', '3', '4'], `AGGREGATE(${mode},4,A:A${suffix})`);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([
    [0, '#N/A'], [1, '#N/A'], [2, '60'], [3, '30'], [4, '#N/A'], [5, '#N/A'], [6, '170'], [7, '140']
  ])('uses option %s to select which source cells to count', (option, expected) => {
    const { model, result } = sheet(['10', '30', '#N/A', '50', '60', '20'], `AGGREGATE(9,${option},A:A)`);
    model.hiddenRows = [{ first: 2, last: 2 }];
    model.rows[2].cells[0].valueType = 'error';
    model.rows[3].cells[0].formula = '_xlfn.AGGREGATE(9,4,A1)';
    model.rows[4].cells[0].formula = 'SUBTOTAL(9,A1)';
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([
    ['AGGREGATE(9,,A:A)', '7'], ['AGGREGATE(9,8,A:A)', '#VALUE!'], ['AGGREGATE(20,0,A:A)', '#VALUE!'],
    ['AGGREGATE(15,6,A:A)', '#VALUE!'], ['AGGREGATE(14,4,A:A,0)', '#NUM!'],
    ['AGGREGATE(18,4,{1;2},0.1)', '#NUM!'], ['AGGREGATE(16,4,{1;2},1.1)', '#NUM!'],
    ['AGGREGATE(19,4,{1,2,3},2)', '2'], ['AGGREGATE(13,4,{3,1;3,1})', '1'],
    ['AGGREGATE(14,7,A:A/(A:A>0),1)', '5'], ['AGGREGATE(14,5,A:A,1)', '2'],
    ['AGGREGATE(9,7,A:A+0)', '7'], ['AGGREGATE(12,4,A:A+0,C:C+3)', '3'],
    ['AGGREGATE(13,4,A:A+0)', '0'], ['AGGREGATE(1,6,{2;#DIV/0!;6})', '4'],
    ['AGGREGATE(3,6,{"apples";FALSE;#DIV/0!})', '2'], ['AGGREGATE(9,4,1,2)', '3'],
    ['AGGREGATE(17,6,{-1E308;1E308},2)', '0']
  ])('handles %s', (formula, expected) => {
    const { model, result } = sheet(['2', '5'], formula);
    model.hiddenRows = [{ first: 2, last: 2 }];
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('reads cross-sheet names lazily and counts formula gaps at the full grid size', async () => {
    const { sheets: [summary, ledger] } = await loadXlsxWorkbook(await createAggregateWorkbook());
    const firstRow = summary.rows[0].cells;
    expect(firstRow.slice(0, 2).map(cell => resolveCellValue(summary, cell))).toEqual(['17', '8.5']);
    expect(ledger.rows[3].cells[0].needsCalculation).toBe(true);
    expect(ledger.rows[4].cells[0].needsCalculation).toBe(true);
    expect(firstRow.slice(2).map(cell => resolveCellValue(summary, cell))).toEqual(['10', '40', '#DIV/0!', '997']);
    const get = vi.spyOn(WorksheetCellIndex.prototype, 'get');
    try {
      expect(resolveCellValue(summary, summary.rows[1].cells[0])).toBe(String(16_380 * 1_048_576));
      expect(get).toHaveBeenCalledExactlyOnceWith(1048576, 16384);
    } finally { get.mockRestore(); }
    expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe('20');
  });
});

describe('SUMPRODUCT', () => {
  it.each([
    ['SUMPRODUCT(A1:A2,{2;3})', '8'],
    ['SUMPRODUCT(A1:A2,A2:A3)', '2'],
    ['SUMPRODUCT(A1:A2*{2;3})', '8'],
    ['SUMPRODUCT({1;2}*{3;4}+1)', '13'],
    ['SUMPRODUCT({2,-3;4,5}^{2,2;2,2})', '54'],
    ['SUMPRODUCT({1,"2";TRUE,-3})', '-2'],
    ['SUMPRODUCT(A1:A2+((A1)))', '5'],
    ['SUMPRODUCT(--(A:A=0))', '1048574'],
    ['SUMPRODUCT(--(C:C<>0))', '0'],
    ['SUMPRODUCT(SUMPRODUCT(A1:A2,{2;3})+1)', '9'],
    ['SUMPRODUCT({1;2},2)', '#VALUE!'],
    ['SUMPRODUCT({1,2},{1;2})', '#VALUE!'],
    ['SUMPRODUCT({1;2}/{1;0})', '#DIV/0!'],
    ['SUMPRODUCT(0,{#N/A})', '#N/A'],
    ['SUMPRODUCT(1E308,2)', '#NUM!']
  ])('calculates %s', (formula, expected) => {
    const { model, result } = sheet(['1', '2'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('uses stored cells in cross-sheet ranges and computes gaps without cell lookups', async () => {
    const [totals, orders] = (await loadXlsxWorkbook(await createSumProductWorkbook())).sheets;
    const price = orders.rows.at(-1)!.cells[1];
    expect(price.needsCalculation).toBe(true);
    expect(totals.rows[0].cells.map(cell => resolveCellValue(totals, cell))).toEqual([
      '60', '10', '13', '#VALUE!', '#N/A', '777', '#REF!'
    ]);
    expect(price.value).toBe('2');
    const get = WorksheetCellIndex.prototype.get;
    let reads = 0;
    const getCell = vi.spyOn(WorksheetCellIndex.prototype, 'get').mockImplementation(function (
      this: WorksheetCellIndex, row, column
    ) {
      if (++reads > 1) throw new Error('Expected one stored cell in the formula range.');
      return get.call(this, row, column);
    });
    try {
      expect(resolveCellValue(totals, totals.rows.at(-1)!.cells[0])).toBe(String(16_380 * 1_048_576 - 1));
      expect(getCell).toHaveBeenCalledExactlyOnceWith(1048576, 16384);
    } finally { getCell.mockRestore(); }
  });
});

describe('structured table references', () => {
  it.each([false, true])('retains table metadata through the %s streamed path and cache clone', async streamed => {
    const bytes = await createStructuredReferenceWorkbook({ streamed });
    const entries = new Map(await openZipArchive(bytes));
    const ledgerEntry = entries.get('xl/worksheets/ledger.xml')!;
    const ledgerBytes = vi.fn(ledgerEntry.bytes.bind(ledgerEntry));
    // Force the buffered path for the compact workbook.
    entries.set(ledgerEntry.name, { ...ledgerEntry, bytes: ledgerBytes, chunks: streamed ? ledgerEntry.chunks : undefined });
    const loaded = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries: entries });
    expect(ledgerBytes).toHaveBeenCalledTimes(streamed ? 0 : 1);
    expect(loaded.warnings).toEqual([]);
    const clone = clonePreviewWorkbook(loaded);
    const [summary, ledger] = clone.sheets;
    expect(ledger.tables?.[0]).toMatchObject({
      name: 'Sales', firstRow: 2, lastRow: 1048576, headerRows: 1, totalRows: 1,
      columns: ['Label', 'Qty', 'Price', 'Gross', '#Paid [net]', 'Line\nBreak']
    });
    expect(ledger.tables?.[0].columns).not.toBe(loaded.sheets[1].tables?.[0].columns);
    expect(ledger.rows).toHaveLength(streamed ? 10506 : 6);
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell))).toEqual([
      '44', '32', '5', 'Qty', '32', '29', '3', '2', '32'
    ]);
    expect(summary.rows[1].cells.map(cell => resolveCellValue(summary, cell))).toEqual([
      'North|Quiet|West|Last', '10', 'out', '76', 'Label', '=[@Qty]*[@Price]', 'bad', '0', '999'
    ]);
    expect(resolveCellValue(summary, summary.rows.at(-1)!.cells[0])).toBe('76');
    expect(loaded.sheets[1].rows.at(-2)!.cells.some(cell => cell.needsCalculation)).toBe(true);
    expect(evaluateWorksheetFormula(summary, 'SUMPRODUCT((Sales[Qty]+Sales[Price])*(Sales[Label]="north"))',
      { row: 1, column: 1 })).toBe(7);
  });

  it('keeps other worksheets available when a table relationship is invalid', async () => {
    const workbook = await loadXlsxWorkbook(await createStructuredReferenceWorkbook({ invalid: true }));
    expect(workbook.warnings).toEqual(['Ignored invalid table part filter in sheet Filtered.']);
    expect(workbook.sheets[2].tables).toBeUndefined();
    const summary = workbook.sheets[0];
    expect(resolveCellValue(summary, summary.rows[0].cells[0])).toBe('44');
    expect(resolveCellValue(summary, summary.rows[0].cells[2])).toBe('#REF!');
  });

  it('uses saved worksheet filter visibility for SUBTOTAL across a named table', async () => {
    const { sheets: [summary, , filtered] } = await loadXlsxWorkbook(await createStructuredReferenceWorkbook({ worksheetFilter: true }));
    expect(filtered.autoFilterRows).toEqual({ first: 2, last: 4 });
    expect(filtered.tables?.[0].autoFilterRows).toBeUndefined();
    expect(resolveCellValue(summary, summary.rows[0].cells[2])).toBe('5');
  });

  it.each([
    ['SUBTOTAL(1,A:A)', '2'], ['SUBTOTAL(2,A:A)', '3'], ['SUBTOTAL(3,A:A)', '3'],
    ['SUBTOTAL(4,A:A)', '3'], ['SUBTOTAL(5,A:A)', '1'], ['SUBTOTAL(6,A:A)', '6'],
    ['SUBTOTAL(7,A:A)', '1'], ['SUBTOTAL(8,A:A)', String(Math.sqrt(2 / 3))],
    ['SUBTOTAL(9,A:A)', '6'], ['SUBTOTAL(10,A:A)', '1'], ['SUBTOTAL(11,A:A)', String(2 / 3)],
    ['SUBTOTAL(109,A:A)', '4'], ['SUBTOTAL(110,A:A)', '2'], ['SUBTOTAL(100,A:A)', '#VALUE!'],
    ['SUBTOTAL(109,C:C)', '0'], ['SUBTOTAL(110,C:C)', '#DIV/0!'],
    ['INDIRECT("A2")', '2'], ['INDIRECT("A1,A2")', '#REF!'], ['INDIRECT("Missing!A1")', '#REF!']
  ])('calculates %s and leaves excluded dependencies lazy', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '3', '55'], formula);
    model.hiddenRows = [{ first: 2, last: 2 }];
    const nested = model.rows[3].cells[0];
    nested.formula = 'SUBTOTAL(9,A1:A3)+49';
    nested.needsCalculation = true;
    expect(resolveCellValue(model, result)).toBe(expected);
    expect(nested.needsCalculation).toBe(true);
  });
});

describe('workbook text formulas', () => {
  it('keeps width-dependent number padding out of TEXT results', () => {
    const { model, result } = sheet(['1'], 'TEXT(12.3,"$*·0.00_)")');
    expect(resolveCellValue(model, result)).toBe('$12.30 ');
  });

  it('returns ordinary spaces for insignificant digits in TEXT', () => {
    const { model, result } = sheet(['1'], 'TEXT(8.9,"0.0?")&"!"&TEXT(5.25,"# ???/???")');
    expect(resolveCellValue(model, result)).toBe('8.9 !5   1/4  ');
  });

  it.each([
    ['SEARCH("soft*2010","Microsoft Excel 2010")', '6'],
    ['SEARCH("text","This is some text",14)', '14'],
    ['SEARCH("a*b","--aab--ab")', '3'], ['SEARCH("*b","ab ab",3)', '3'],
    ['SEARCH("a~?*","--A? done")', '3'], ['SEARCH("?~??","--a?bx")', '3'],
    ['SEARCH("~a~b~","--AB")', '3'], ['SEARCH("~~","--~")', '3'],
    ['SEARCH("x","İx")', '2'], ['SEARCH("x","😀x")', '3'],
    ['SEARCH("??x","😀x")', '1'], ['SEARCH("?x","😀x")', '2'],
    ['SEARCH("","",1)', '#VALUE!'], ['SEARCH("","abc",4)', '#VALUE!'],
    ['SEARCH("x","xyz",0)', '#VALUE!'], ['SEARCH("x","xyz",)', '1'],
    ['SEARCH("*",#N/A)', '#N/A'], ['SEARCH("y","x")', '#VALUE!'],
    ['FIND("x","xXx",2)', '3'], ['FIND("x","X")', '#VALUE!'],
    ['FIND("*","x*y")', '2'], ['FIND("","")', '1'], ['FIND("","a",2)', '2'],
    ['LEFT("SKU",2.9)', 'SK'], ['RIGHT("SKU")', 'U'], ['LEFT("SKU",-0.1)', '#VALUE!'],
    ['RIGHT("SKU",0)', ''], ['RIGHT("SKU",123)', 'SKU'], ['LEFT(123,2)', '12'],
    ['RIGHT("SKU",#REF!)', '#REF!'],
    ['TEXTJOIN("|",FALSE,LEFT({"abc";"xyz"},{1;2}))', 'a|xy'],
    ['TEXTJOIN("|",FALSE,RIGHT({"abc";"xyz"},))', 'c|z'],
    ['TEXTJOIN("|",FALSE,IFERROR(FIND("x",{"Xx";"ab";"x"}),7))', '2|7|1'],
    ['TEXTJOIN("|",FALSE,SEARCH("?b",{"ab","xb"}))', '1|1'],
    ['TEXTJOIN("|",FALSE,IFNA(LEFT({"abc";"xyz"},#N/A),"missing"))', 'missing|missing']
  ])('calculates text searches and slices in %s', (formula, expected) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([
    ['ISERROR(1/0)', true], ['ISERROR(A4)', true], ['ISNUMBER(A4)', false], ['ISNUMBER(1E308*1E308)', false],
    ['ISERR(NA())', false], ['ISERR(#DIV/0!)', true], ['ISNA(NA())', true], ['ISNA(#VALUE!)', false],
    ['ISBLANK(A2)', false], ['ISBLANK(C1)', true], ['ISTEXT(A2)', true], ['ISNONTEXT(C1)', true],
    ['ISNONTEXT(NA())', true], ['ISLOGICAL(A3)', true], ['ISNUMBER(A3)', false], ['ISNUMBER(A1)', true],
    ['ISTEXT("12")', true], ['ISNUMBER("12")', false], ['ISNUMBER(SEARCH("y","x"))', false]
  ])('preserves argument types and errors in %s', (formula, expected) => {
    const { model, result } = sheet(['1', '', 'TRUE', '#DIV/0!'], formula);
    Object.assign(model.rows[1].cells[0], { formula: 'IF(TRUE,"","x")', needsCalculation: true });
    model.rows[2].cells[0].valueType = 'boolean';
    model.rows[3].cells[0].valueType = 'error';
    expect(resolveCellValue(model, result)).toBe(expected ? 'TRUE' : 'FALSE');
    expect(result.valueType).toBe('boolean');
  });

  it('leaves unsupported expressions unresolved inside type tests', () => {
    const { model, result } = sheet(['1'], 'ISERROR(UNSUPPORTED())');
    expect(resolveCellValue(model, result)).toBe('=ISERROR(UNSUPPORTED())');
  });

  it.each([
    ['TEXT(66348.72,"$#,###.##")', '$66,348.72'], ['TEXT(5,"0,000.00")', '0,005.00'],
    ['TEXT(12200000,"0,000.00")', '12,200,000.00'], ['TEXT(4.34,"# ???/???")', '4  17/50 '],
    [`TEXT(123456,"###° 00' 00''")`, "12° 34' 56''"], ['TEXT(3735.8/86400,"[ss].00")', '3735.80'],
    ['TEXT(1.9999/86400,"[ss].00")', '02.00'], ['TEXT(7,"")', ''],
    ['TEXT("211x","0.0")', '211x'], ['TEXT(TRUE,"0.0")', 'TRUE'],
    ['TEXT("0003.25","0.0")', '3.3'], ['TEXT("10%","0.00%")', '10.00%'],
    ['TEXT(0.5,"0.0%")&" done"', '50.0% done'],
    ['TEXT(1200,"0.0?E+?0")', '1.2 E+ 3'], ['TEXT(99.995,"##0.00E+00")', '100.00E+00'],
    ['TEXT(1,"invalid garbage")', '#VALUE!'], ['TEXT(#REF!,"0")', '#REF!'],
    ['CHAR(10)&CHAR(128)&CHAR(138)&CHAR(255.9)', '\n€Šÿ'],
    ['CHAR(0.9)', '#VALUE!'], ['CHAR(256)', '#VALUE!'],
    ['TRIM("  A   B "&CHAR(160)&" ")', 'A B \u00a0'],
    ['TEXTJOIN("|",FALSE,{"A","","B";1,2,3},,4)', 'A||B|1|2|3||4'],
    ['TEXTJOIN("|",TRUE,{"A","","B";1,2,3},,4)', 'A|B|1|2|3|4'],
    ['TEXTJOIN({"-",""},TRUE,{"a","b","c","d","e"})', 'a-bc-de'],
    ['TEXTJOIN(A:A,FALSE,"a",C:C,"b")', 'a' + '1' + '1' + 'b'],
    ['TEXTJOIN("|",TRUE,{"A",#REF!})', '#REF!'], ['TEXTJOIN("|",TRUE,IF(FALSE,"z","x"),FALSE,"")', 'x|FALSE'],
    ['TEXTJOIN("",FALSE,C1:XFD1048576,"x")', 'x'],
    ['TEXTJOIN(",",FALSE,C1:C32768)', ','.repeat(32767)],
    ['TEXTJOIN(",",FALSE,C1:C32769)', '#VALUE!'],
    ['_xlfn.TEXTBEFORE("alpha--beta--gamma","--",2)', 'alpha--beta'],
    ['TEXTAFTER("alpha--beta--gamma","--",-2)', 'beta--gamma'],
    ['TEXTBEFORE("préİ.Fin.🙂","fin",,1)', 'préİ.'],
    ['TEXTAFTER("prefix🙂终🙂tail","🙂",-1)', 'tail'],
    ['TEXTBEFORE("aaa","aa",-1)', 'a'], ['TEXTAFTER("aaa","aa",-1)', ''],
    ['TEXTAFTER("color; green",{",",", ",";","; "})', 'green'],
    ['TEXTAFTER("color; green",{",",", ",";","; "},-1)', 'green'],
    ['TEXTBEFORE("a-B*c","*")', 'a-B'], ['TEXTBEFORE("abc","*")', '#N/A'],
    ['TEXTBEFORE("text","",-1)', 'text'], ['TEXTAFTER("text","")', 'text'],
    ['TEXTBEFORE("",":")', ''], ['TEXTAFTER("",":")', ''],
    ['TEXTBEFORE("Socrates"," ",,,1)', 'Socrates'], ['TEXTAFTER("red",": ",-1,,1)', 'red'],
    ['TEXTBEFORE("a:b",":",2,,1)', 'a:b'], ['TEXTAFTER("a:b",":",-2,,1)', 'a:b'],
    ['TEXTAFTER("one"," ",,,0,"none")', 'none'], ['TEXTAFTER("a b"," ",,,,1/0)', 'b'],
    ['TEXTAFTER("abc",":",0)', '#VALUE!'], ['TEXTBEFORE("abc",":",4)', '#VALUE!'],
    ['TEXTBEFORE("abc",":",,2)', '#VALUE!'], ['TEXTBEFORE("abc",":",,,2)', '#VALUE!'],
    ['TEXTAFTER("abc",#REF!)', '#REF!'],
    ['TEXTJOIN("|",TRUE,TEXTAFTER({"a;b";"x";"c: d"},{";",": "},,,,{"-";"none";"-"}))', 'b|none|d'],
    ['TEXTJOIN("|",TRUE,IFERROR(TEXTBEFORE({"a;b";"x"},";",,,,1/0),"bad"))', 'a|bad'],
    ['FORMULATEXT(A1)', '#N/A'], ['FORMULATEXT(1+2)', '#VALUE!'],
    ['FORMULATEXT((B1:B1048576))', '=FORMULATEXT((B1:B1048576))']
  ])('calculates %s', (formula, expected) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
    expect(result.valueType).toBe(expected.startsWith('#') ? 'error' : 'text');
  });

  it.each([false, true])('loads text results and sparse references with the %s 1904 flag', async date1904 => {
    const [labels, source] = (await loadXlsxWorkbook(await createTextFormulaWorkbook(date1904))).sheets;
    expect(labels.rows[0].cells.map(cell => resolveCellValue(labels, cell))).toEqual([
      'February 29, 2024', 'North · South · Far', 'R1C1|||R2C2', '=D3+1', '$1,234.57', date1904 ? '0' : '1462'
    ]);
    expect(labels.rows[1].cells.map(cell => resolveCellValue(labels, cell))).toEqual([
      'sku 04\n00321', 'A|B|C|TRUE|0', '#VALUE!', '=_xlfn.FORMULATEXT(D2)', '4  17/50 ', '=1/0', 'a/b:c/d'
    ]);
    expect(source.rows[0].cells.find(cell => cell.ref === 'G1')?.needsCalculation).toBe(true);
    expect(source.rows[2].cells.find(cell => cell.ref === 'E3')?.needsCalculation).toBe(true);
    const far = labels.rows.at(-1)!.cells[0], percentage = source.rows.at(-1)!.cells[1];
    expect(percentage.needsCalculation).toBe(true);
    expect(resolveCellValue(labels, far)).toBe('North | South | Far | 12.50% | Deep');
    expect(percentage.value).toBe('0.125');
  });
});

describe('workbook date and time formulas', () => {
  it.each([
    ['DATE(0,1,0)', '0'], ['DATE(1900,2,29)', '60'], ['DATE(1900,3,0)', '60'], ['DATE(1900,2,30)', '61'],
    ['DATE(1899,1,1)', '693598'], ['DATE(2000,-5.1,1)', '36312'], ['DATE(2008,15,-120)', '39752'],
    ['DATE(2000,1,-32768.1)', '69292'], ['DATE(9999,12,31)', '2958465'], ['DATE(9999,12,32)', '#NUM!'],
    ['DAY(0)', '0'], ['DAY(60.8)', '29'], ['MONTH(61)', '3'], ['YEAR(366)', '1900'], ['YEAR(367)', '1901'],
    ['DAYS(61.2,59.8)', '2'], ['DAYS("2024-02-28","2024-02-29")', '-1'], ['DAY("2024-02-30")', '#VALUE!'],
    ['EDATE(31,1)', '59'], ['EDATE(60,0)', '59'], ['EOMONTH(60.1,0.9)', '59'], ['EOMONTH(60,1)', '91'],
    ['EDATE(-0.1,0)', '#NUM!'], ['EDATE(2958465,1)', '#NUM!'], ['EOMONTH(2958465,0)', '2958465'],
    ['WEEKDAY(1)', '1'], ['WEEKDAY(60,)', '4'], ['WEEKDAY(61,2)', '4'], ['WEEKDAY(61,3)', '3'],
    ['WEEKDAY(61,14)', '1'], ['WEEKDAY(61,17)', '5'], ['WEEKDAY(61,21)', '#NUM!'],
    ['TIME(24,0,0)', '0'], ['TIME(12.9,0,0)', '0.5'], ['TIME(-0.1,0,0)', '#NUM!'], ['TIME(0,0,32768)', '#NUM!'],
    ['HOUR("10:53:12 PM")', '22'], ['HOUR("2024-02-29T05:30:00-05:00")', '10'],
    ['MINUTE(TIME(2,19,20))', '19'], ['SECOND("14:47:20")', '20'],
    ['SECOND(DATE(9999,12,31)+0.9999)', '51'], ['SECOND(45351+TIME(0,0,1))', '1'],
    ['IFERROR(YEAR(2958466),"outside")', 'outside'], ['YEAR(A1)', '#DIV/0!'],
    ['SUM(MONTH({60,61,92}))', '9'], ['SUM(DATE({1900,1900},2,{28,29}))', '119'],
    ['SUM(IFERROR(DAY({60,2958466}),0))', '29']
  ])('calculates %s as %s', (formula, expected) => {
    const { model, result } = sheet(['#DIV/0!'], formula);
    model.rows[0].cells[0].valueType = 'error';
    expect(resolveCellValue(model, result)).toBe(expected);
    expect(result.valueType).toBe(expected.startsWith('#') ? 'error' : expected === 'outside' ? 'text' : undefined);
  });

  it.each([false, true])('uses the loaded workbook epoch and keeps distant dependencies lazy (1904=%s)', async date1904 => {
    const workbook = await loadXlsxWorkbook(await createDateFormulaWorkbook(date1904));
    const [calendar, inputs] = clonePreviewWorkbook(workbook).sheets;
    const [distantWorkday, last] = calendar.rows.at(-1)!.cells;
    const raw = String(date1904 ? 43889 : 45351);
    expect(calendar.rows[0].cells.map(cell => resolveCellValue(calendar, cell))).toEqual([
      raw, String(Number(raw) + 31), '4', raw, String(7321 / 86_400), 'invalid'
    ]);
    expect(calendar.rows[1].cells.map(cell => resolveCellValue(calendar, cell))).toEqual(date1904 ? ['0', '6'] : ['1462', '7']);
    expect(calendar.rows[2].cells.map(cell => resolveCellValue(calendar, cell))).toEqual([
      '3', String(Number(raw) + 5), raw, '2', String(Number(raw) + 1), 'invalid weekend'
    ]);
    expect(workbook.sheets[0].rows[0].cells[0].needsCalculation).toBe(true);
    expect(inputs.rows.at(-1)?.cells[0].value).toBe('2024-02-29T22:10:45');
    expect(distantWorkday.needsCalculation).toBe(true);
    expect(resolveCellValue(calendar, distantWorkday)).toBe(String(Number(raw) + 5));
    expect(last.needsCalculation).toBe(true);
    expect(Number(resolveCellValue(calendar, last))).toBe(Number(raw) + 365 + 86_399 / 86_400);
  });
});

describe('workbook working-day formulas', () => {
  it.each([
    ['NETWORKDAYS(INT(A1),10)', '7'],
    ['NETWORKDAYS(1,10,(A1:A3))', '4'], ['NETWORKDAYS(10,1,(A1,A2))', '-5'],
    ['NETWORKDAYS(2.7,2.9)', '1'], ['NETWORKDAYS(3,3,{3.3;3.7})', '0'],
    ['NETWORKDAYS(10,1,{2,2;4,7})', '-5'], ['NETWORKDAYS(1,10,#N/A)', '#N/A'],
    ['NETWORKDAYS(1,10,{2;TRUE})', '#VALUE!'], ['NETWORKDAYS(1,10,{2;2958466})', '#NUM!'],
    ['NETWORKDAYS(TRUE,10)', '#VALUE!'], ['NETWORKDAYS(1,"2006-02-30")', '#VALUE!'],
    ['NETWORKDAYS.INTL(10,1,"1111111")', '0'], ['NETWORKDAYS.INTL(1,7,"0000000")', '7'],
    ['NETWORKDAYS.INTL(1,7,"100001X")', '#VALUE!'], ['NETWORKDAYS.INTL(1,7,10)', '#NUM!'],
    ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,1,31))', '22'],
    ['NETWORKDAYS.INTL(DATE(2006,2,28),DATE(2006,1,31))', '-21'],
    ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),7,{"2006/1/2","2006/1/16"})', '22'],
    ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),"0010001",{"2006/1/2","2006/1/16"})', '20'],
    ['WORKDAY(0,1)', '2'], ['WORKDAY(1.8,0.9)', '1'], ['WORKDAY(2,8)', '12'],
    ['WORKDAY(100,-5,{82,93;94,95;94,100})', '88'], ['WORKDAY(98,-2,{97})', '95'],
    ['WORKDAY(2,1,A2)', '4'], ['WORKDAY(2,1,"1900-01-03")', '4'], ['WORKDAY(2,1,DATE(1900,1,3))', '4'],
    ['WORKDAY.INTL(DATE(2012,1,1),90,11)', '41013'], ['WORKDAY.INTL(DATE(2012,1,1),30,17)', '40944'],
    ['WORKDAY.INTL(1,1,"1111111")', '#VALUE!'], ['WORKDAY.INTL(1,1,0)', '#NUM!'],
    ['WORKDAY.INTL(0,-1,"0000000")', '#NUM!'], ['WORKDAY.INTL(2958465,1,"0000000")', '#NUM!'],
    ['WORKDAY.INTL(0,2000000,"0000000",{1;22;2100000})', '2000002'],
    ['WORKDAY.INTL(2000005,-2000000,"0000000",{2;300;2000005})', '4'],
    ['IF(FALSE,WORKDAY(1,1,{#N/A,3}),42)', '42'], ['IFERROR(WORKDAY(2,1,{#N/A,7}),42)', '42'],
    ['TEXTJOIN("|",FALSE,IFNA(WORKDAY.INTL(2,{1;#N/A},1,{3}),"missing"))', '4|missing'],
    ['SUM(NETWORKDAYS({2;7},10,{3,3,8}))', '8']
  ])('evaluates %s with bounded calendar arithmetic', (formula, expected) => {
    const { model, result } = sheet(['2', '3', '4'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
    if (expected.startsWith('#')) expect(result.valueType).toBe('error');
  });

  it('keeps empty cells sparse and skips the other column’s formulas', () => {
    const { model, result } = sheet(['3'], 'NETWORKDAYS(2,10,A:A)');
    const formulaCell: ParsedCell = { ref: 'B1048576', row: 1048576, column: 2, value: '', formula: '2/0', needsCalculation: true };
    model.rowCount = 1048576;
    model.rows.push({ index: 1048576, cells: [
      { ref: 'A1048576', row: 1048576, column: 1, value: '6', formula: '2+4', needsCalculation: true }, formulaCell
    ] });
    expect(resolveCellValue(model, result)).toBe('5');
    expect(model.rows.at(-1)!.cells[0].needsCalculation).toBe(false);
    expect(formulaCell.needsCalculation).toBe(true);
  });
});

describe('workbook coordinate formulas', () => {
  it.each([
    ['ROW($A$3:$B$4)+1', '4'], ['COLUMN(B1:D2)', '2'], ['MAX(ROW(A1:C6))', '6'], ['SUM(COLUMN(B2:D4))', '9'],
    ['_xlfn.SINGLE(ROW(A2:A4))', '2'], ['ROW(42)', '#VALUE!'], ['ROW((A1,A2))', '#VALUE!'],
    ['COLUMN(A1,A2)', '#VALUE!'], ['ROW(Missing!A1)', '#REF!'], ['COLUMN(#REF!)', '#REF!']
  ])('recalculates %s', (formula, expected) => {
    const { model, result } = sheet(['#N/A'], formula);
    model.rows[0].cells[0].valueType = 'error';
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([
    ['ADDRESS(1048576,16384)', '$XFD$1048576'], ['ADDRESS(2,3,2)', 'C$2'],
    ['ADDRESS(2,3,3)', '$C2'], ['ADDRESS(2,3,4)', 'C2'],
    ['ADDRESS(2,3,2,FALSE)', 'R2C[3]'], ['ADDRESS(2,3,3,FALSE)', 'R[2]C3'],
    ['ADDRESS(2,3,4,FALSE)', 'R[2]C[3]'], ['ADDRESS(2,3,,FALSE)', 'R2C3'],
    ['ADDRESS(1.9,2.9,,TRUE,"Month End")', "'Month End'!$B$1"],
    ['ADDRESS(2,3,4,TRUE,"O\'Brien!")', "'O''Brien!'!C2"],
    ['ADDRESS(0,1)', '#VALUE!'], ['ADDRESS(1,16385)', '#VALUE!'], ['ADDRESS(1,1,5)', '#VALUE!'],
    ['INDIRECT("R2C1",FALSE)', '22'], ['INDIRECT("RC[-1]",FALSE)', '11'],
    ['INDIRECT("R[+2]C[-1]",FALSE)', '33'], ['INDIRECT("C1",FALSE)', '11'],
    ['INDIRECT("Sum!R1C1:Sum!R3C1",FALSE)', '11'], ['INDIRECT("R1C1#",FALSE)', '#REF!'],
    ['INDIRECT("A1",FALSE)', '#REF!'], ['INDIRECT("R[-1]C[-1]",FALSE)', '#REF!'], ['INDIRECT("R1048577C1",FALSE)', '#REF!']
  ])('round-trips coordinate text in %s', (formula, expected) => {
    const { model, result } = sheet(['11', '22', '33'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([
    ['OFFSET(A1,1,0)', '22'], ['OFFSET(A3,-1.9,0)', '22'], ['OFFSET(A1,,)', '11'],
    ['SUM(OFFSET(B1,0,-1,3))', '66'], ['SUM(OFFSET(A1:A2,1,0,,))', '55'],
    ['SUM(OFFSET(A3,0,0,-2,1))', '55'], ['SUM(OFFSET(B2,0,0,1,-2))', '22'],
    ['SUM(A1:(OFFSET(A3,-1,0)))', '33'], ['SUM((OFFSET(A1,1,0)):A3)', '55'],
    ['SUM(OFFSET(A1,0,0):OFFSET(A3,0,0))', '66'],
    ['ROW(OFFSET(A1,2,0))+COLUMN(OFFSET(A1,0,1))', '5'],
    ['MATCH(33,OFFSET(A1,1,0,2),0)', '2'], ['COUNTIF(OFFSET(A1,0,0,3),">20")', '2'],
    ['LET(tail,OFFSET(A1,1,0,2),SUM(tail))', '55'],
    ['OFFSET(INDIRECT("A1"),2,0)+SUM(INDIRECT("A1:A2"))', '66'],
    ['SUM(OFFSET(A1,0,0,3)+1)', '12'],
    ['OFFSET(A2,0,1,1,2)', '0'], ['OFFSET(A1,1,0,2)', '#VALUE!'],
    ['OFFSET(A1,-1,0)', '#REF!'], ['OFFSET(A1,0,-1)', '#REF!'], ['OFFSET(A1,0,0,0)', '#REF!'],
    ['OFFSET(XFD1048576,1,0)', '#REF!'], ['OFFSET(XFD1048576,0,0,,2)', '#REF!'],
    ['OFFSET(A1,0,0,-2)', '#REF!'], ['OFFSET(12,0,0)', '#VALUE!'],
    ['OFFSET(A1,#N/A,0)', '#N/A'], ['IF(FALSE,OFFSET(A1,1/0,0),42)', '42'],
    ['INDIRECT("OFFSET(A1,1,0)")', '#REF!']
  ])('resolves the reference in %s', (formula, expected) => {
    const { model, result } = sheet(['11', '22', '33'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });
});

describe('workbook lookup formulas', () => {
  it.each([
    ['MATCH(2,A:A,0)', '2'], ['MATCH(2,A1:A4)', '3'], ['MATCH(3,A1:A4,1)', '3'],
    ['MATCH(3,A5:A8,-1)', '3'],
    ['XMATCH(2,A:A,0,-1)', '8'], ['XMATCH(3,A1:A4,-1)', '2'], ['XMATCH(3,A1:A4,-1,-1)', '3'],
    ['XMATCH(3,A1:A4,1,2)', '4'], ['XMATCH(3,A5:A8,-1,-2)', '4'],
    ['XMATCH(5,A5:A8,0,-2)', '1'], ['XMATCH(8,A1:A4,0,2)', '#N/A'],
    ['INDEX(A:A,MATCH(4,A1:A4,0))', '4'], ['INDEX(A1:A1,1,1,2)', '#REF!'],
    ['SUM(A1:INDEX(A:A,4))', '9'], ['SUM((INDEX(A:A,4)):A8)', '19'],
    ['SUM(INDEX(A:A,2):INDEX(A:A,4))', '8'], ['COUNTIF(INDEX(A1:A4,0),2)', '2'],
    ['ROW(INDEX(A:A,1048576))', '1048576'], ['COLUMN(INDEX(1:1,1,16384))', '16384'],
    ['OFFSET(INDEX(A1:A8,4),1,0)', '5'], ['INDEX(INDEX(A1:A4,0),3)', '2'],
    ['INDEX({1,2;3,4},2,1)', '3'], ['INDEX(A1:A4,1e309)', '#REF!'],
    ['SUM(A1:INDEX({1;2},2))', '#VALUE!'],
    ['SUM(XLOOKUP(2,A1:A4,A1:A4):XLOOKUP(4,A1:A4,A1:A4))', '8'],
    ['SUM((XLOOKUP(4,A1:A4,A1:C4)):XLOOKUP(2,A1:A4,A1:C4))', '8'],
    ['SUM(XLOOKUP("left",{"left","right"},A3:B7):A2)', '21'],
    ['SUM(INDEX(A:A,2):_xlfn.XLOOKUP(4,A1:A4,A1:A4))', '8'],
    ['SUM(A1:XLOOKUP(4,A1:A4,A1:A4))', '9'],
    ['SUM(A1:XLOOKUP({2;4},A1:A4,A1:A4))', '#VALUE!'],
    ['SUM(A1:XLOOKUP(1,{1},{2}))', '#VALUE!'],
    ['ROW(XLOOKUP(4,A1:A4,A1:A4))', '4'],
    ['ROWS(XLOOKUP(4,A1:A4,A1:A4))', '1'],
    ['COLUMNS(XLOOKUP(4,A1:A4,A1:C4))', '3'],
    ['XLOOKUP(1,A1:A4,C1:C4)', '0'],
    ['INDEX(XLOOKUP(4,A1:A4,A1:C4),1,2)', '0'],
    ['TEXTJOIN("|",TRUE,XLOOKUP(4,A1:A4,A1:C4))', '4|0|0'],
    ['TEXTJOIN("|",TRUE,HSTACK(XLOOKUP(4,A1:A4,A1:C4),9))', '4|0|0|9'],
    ['XLOOKUP(0,XLOOKUP("blank",{"blank","other"},C1:D4),A1:A4)', '1'],
    ['INDEX(A1:A4,5)', '#REF!'], ['VLOOKUP(2,A1:A4,0,FALSE)', '#VALUE!'],
    ['VLOOKUP(2,A1:A4,2,FALSE)', '#REF!'], ['XLOOKUP(2,A1:A4,A1:A3)', '#VALUE!'],
    ['XLOOKUP(2,A1:B1,A1:A2)', '#VALUE!'],
    ['TEXTJOIN("|",FALSE,XLOOKUP(3,{1;3;5},{10,11;30,31;50,51}))', '30|31'],
    ['TEXTJOIN("|",FALSE,XLOOKUP(3,{1,3,5},{10,30,50;11,31,51}))', '30|31'],
    ['TEXTJOIN("|",FALSE,XLOOKUP("one",{"one"},{5;6;7}))', '5|6|7'],
    ['XLOOKUP(5,A1:A4*2,SEQUENCE(4,1,10,10),,1)', '40'],
    ['XLOOKUP(999,SEQUENCE(1048576),SEQUENCE(1048576,1,-1,2),,0,2)', '1995'],
    ['XLOOKUP(5,A:A+5,SEQUENCE(1048576),,0,-1)', '1048576'],
    ['XLOOKUP(,IF(A:A,A:A,A:A),SEQUENCE(1048576),,0,-1)', '1048576'],
    ['XLOOKUP(,A:A+5,SEQUENCE(1048576),"missing")', 'missing'],
    ['XLOOKUP(4,{1;3;5},{10;30;50},,1,2)', '50'],
    ['TEXTJOIN("|",FALSE,XLOOKUP(99,A1:A3,A1:A3,{"missing";"retry"}))', 'missing|retry'],
    ['XLOOKUP(2,{1,2;3,4},{5,6;7,8})', '#VALUE!'],
    ['TEXTJOIN("|",FALSE,XLOOKUP(2,{1;2},{"yes","no";"",FALSE},1/0))', '|FALSE'],
    ['IFERROR(XMATCH(9,A:A),"absent")', 'absent']
  ])('calculates %s with typed matches and errors', (formula, expected) => {
    const { model, result } = sheet(['1', '2', '2', '4', '5', '4', '4', '2'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
    if (expected.startsWith('#')) expect(result.valueType).toBe('error');
  });

  it.each(['INDEX(A1:A1,1)', 'XLOOKUP(1,{1},A1:A1)'])('uses reference rules for text selected by %s inside SUM', lookup => {
    const { model, result } = sheet(['9'], `SUM(${lookup})`);
    model.rows[0].cells[0].valueType = 'text';
    expect(resolveCellValue(model, result)).toBe('0');
    expect(evaluateWorksheetFormula(model, lookup, result)).toBe('9');
  });

  it.each([
    ['MATCH("ab?",A:A,0)', '1'], ['XMATCH("AB?",A:A,2,-1)', '5'], ['XMATCH("ab?",A:A)', '#N/A'],
    ['MATCH("ab~*",A:A,0)', '5'], ['XMATCH("ab~*",A:A,2)', '5'],
    ['MATCH(2,A:A,0)', '3'], ['MATCH("2",A:A,0)', '2'], ['MATCH(TRUE,A:A,0)', '4']
  ])('keeps text, numbers and booleans distinct in %s', (formula, expected) => {
    const { model, result } = sheet(['Ab1', '2', '2', 'TRUE', 'ab*'], formula);
    for (const row of [1, 2, 5]) model.rows[row - 1].cells[0].valueType = 'text';
    model.rows[3].cells[0].valueType = 'boolean';
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it.each([['MATCH(2,A:A,0)', 0], ['XMATCH(2,A:A,0,-1)', 1]])(
    'stops dependency evaluation at the first match in the selected direction for %s', (formula, match) => {
      const { model, result } = sheet(['2', '2'], formula);
      const unrelated = model.rows[1 - match].cells[0];
      Object.assign(unrelated, { formula: 'B1', needsCalculation: true });
      expect(resolveCellValue(model, result)).toBe(String(match + 1));
      expect(unrelated.needsCalculation).toBe(true);
    }
  );

  it('uses sparse midpoint probes for sorted whole-column searches', () => {
    const { model, result } = sheet(Array(1024).fill(''), 'XMATCH(613,A:A,0,2)');
    for (const [i, row] of model.rows.entries()) {
      const key = row.cells[0];
      const position = i * 1024 + 1;
      row.index = key.row = position;
      key.ref = 'A' + position;
      key.formula = String(i + 1);
      key.needsCalculation = true;
    }
    expect(resolveCellValue(model, result)).toBe(String(612 * 1024 + 1));
    expect(model.rows.filter(row => !row.cells[0].needsCalculation).length).toBeLessThan(32);
  });

  it('resolves cross-sheet names and lazy return values through the real workbook loader', async () => {
    const { sheets: [summary, stock] } = await loadXlsxWorkbook(await createLookupFormulaWorkbook());
    const row = (index: number) => summary.rows[index].cells.map(cell => resolveCellValue(summary, cell));
    expect(row(0)).toEqual(['Pallet A', '20', '3', 'TRUE', '55', 'Tier B', '#N/A', 'none']);
    expect(row(1)).toEqual(['#DIV/0!', '1048576', 'Tier B', 'Tier C', 'Middle', '777']);
    expect(row(2)).toEqual(['TRUE', '=Rates!A1*2', '2', '75', '18', '=Rates!A1*2', '18']);
    expect(row(3)).toEqual(['20']);
    expect(summary.rows[0].cells[3].valueType).toBe('boolean');
    expect(stock.rows.at(-1)?.cells[1]).toMatchObject({ value: '20', needsCalculation: false });
  });

  it.each(['XLOOKUP(1,A1:A2,C1:D2)', 'INDEX(A1:C2,1,0)'])('preserves the source of spilling formulas: %s', formula => {
    const { model, result } = sheet(['1', '2'], formula);
    expect(resolveCellValue(model, result)).toBe('=' + formula);
  });
});

describe('conditional workbook aggregates', () => {
  it.each([
    ['0', '2'], ['A7', '2'], ['""', '2'], ['"="', '1'], ['"<>"', '9'], ['"<>0"', '8'],
    ['TRUE', '1'], ['"TrUe"', '1'], ['"#N/A"', '1'], ['"~*"', '1'],
    ['"12.5%"', '2'], ['">0"', '2'], ['"*"', '5']
  ])('matches typed criteria %s and counts unstored blanks', (criterion, expected) => {
    const { model, result } = sheet(['0', '0', 'TRUE', 'TRUE', '#N/A', '', '', '*', '12.5%', '0.125'],
      `COUNTIF(A1:A10,${criterion})`);
    for (const row of [2, 4, 6, 8, 9]) model.rows[row - 1].cells[0].valueType = 'text';
    model.rows[2].cells[0].valueType = 'boolean';
    model.rows[4].cells[0].valueType = 'error';
    model.rows[6].cells = [];
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('projects and combines sparse criteria ranges, preserves cache precedence and filters result errors', async () => {
    const workbook = await loadXlsxWorkbook(await createCriteriaFormulaWorkbook());
    const copy = clonePreviewWorkbook(workbook);
    copy.sheets[2].rows[0].cells[0].value = '20';
    expect(resolveCellValue(copy.sheets[0], copy.sheets[0].rows[0].cells[1])).toBe('53');
    const [summary, ledger] = workbook.sheets;
    expect(summary.rows[0].cells.map(cell => resolveCellValue(summary, cell)))
      .toEqual(['4', '33', '11', '9', '20', '1048568', '1', '21', '7']);
    expect(ledger.rows.find(row => row.index === 7)?.cells[2].needsCalculation).toBe(true);
    expect(summary.rows[1].cells.map(cell => resolveCellValue(summary, cell)))
      .toEqual(['1', 'bad', '#VALUE!', '#DIV/0!', '77', '#REF!', '1048572']);
    expect(resolveCellValue(summary, summary.rows[2].cells[0])).toBe('46');
  });

  it('counts a full rectangular sheet by occupied positions without counting overlapping failures twice', async () => {
    const { sheets: [model] } = await loadXlsxWorkbook(await createCriteriaFormulaWorkbook());
    const result: ParsedCell = { ref: 'J1', row: 1, column: 10, value: '', needsCalculation: true, formula:
      `COUNTIFS('Team''s Ledger'!A:XFD,"",Rates!A:XFD,"=")` };
    expect(resolveCellValue(model, result)).toBe(String(1_048_576 * 16_384 - 29));
  });
});

describe('formula range evaluation', () => {
  it.each([
    ['2^3^2', '512'], ['-2^2', '4'], ['2^-2', '0.25'],
    ['1-2-3', '-4'], ['8/4/2', '1'], ['1+2*3^2', '19']
  ])('preserves existing arithmetic precedence and associativity: %s', (formula, expected) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('calculates SUM ranges larger than the engine argument limit', () => {
    const count = 160_000;
    const { model, result } = sheet(Array.from({ length: count }, (_, index) => String(index + 1)), `SUM(A1:A${count})`);
    expect(resolveCellValue(model, result)).toBe(String(count * (count + 1) / 2));
    expect(result.needsCalculation).toBe(false);
  });

  it('preserves addition order across scalars, ranges and nested SUM calls', () => {
    const { model, result } = sheet(['-10000000000000000', '1'], 'SUM(1E16,$A$1:A2,SUM(1,1))');
    expect(resolveCellValue(model, result)).toBe('3');
  });

  it.each([
    ['SUM(1E16,(( $A$1:A2 )),SUM(1,1))', '3'],
    ['SUM(1E16,SUM($A$1:A2),SUM(1,1))', '2'],
    ['SUM((A2:A1),1E16)', '0']
  ])('preserves parentheses and floating point grouping: %s', (formula, expected) => {
    const { model, result } = sheet(['-10000000000000000', '1'], formula);
    expect(resolveCellValue(model, result)).toBe(expected);
  });

  it('preserves intermediate overflow instead of pre-summing a range', () => {
    const formula = 'SUM(1E308,A1:A2)';
    const { model, result } = sheet(['1E308', '-1E308'], formula);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
  });

  it.each(['SUM((A1:A2)+1)', 'SUM(A1:A2*0)', 'SUM((A1:A2)', 'SUM(A1:A2,)'])(
    'keeps dependency evaluation before a range-expression error: %s', formula => {
      const { model, result } = sheet(['2', ''], formula);
      Object.assign(model.rows[1].cells[0], { formula: 'A1*3', needsCalculation: true });
      expect(resolveCellValue(model, result)).toBe(`=${formula}`);
      expect(model.rows[1].cells[0]).toMatchObject({ value: '6', needsCalculation: false });
    });

  it('stops reading later dependencies when a streamed range contains nonnumeric data', () => {
    const { model, result } = sheet(['text', ''], 'SUM(A1:A2)');
    Object.assign(model.rows[1].cells[0], { formula: '1+2', needsCalculation: true });
    expect(resolveCellValue(model, result)).toBe('=SUM(A1:A2)');
    expect(model.rows[1].cells[0]).toMatchObject({ value: '', needsCalculation: true });
  });

  it.each([
    ['SUM(A1:A2+C1)', true], ['SUM((A1:A2)*C1)', true],
    ['SUM((A1:A2)^C1)', false], ['+(A1:A2)+C1', false]
  ])('preserves right-hand dependency reads for unsupported range arithmetic: %s', (formula, readsRight) => {
    const { model, result } = sheet(['2', ''], formula);
    Object.assign(model.rows[1].cells[0], { formula: 'A1*3', needsCalculation: true });
    const right: ParsedCell = { ref: 'C1', row: 1, column: 3, value: '', formula: '3+4', needsCalculation: true };
    model.rows[0].cells.push(right);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
    expect(model.rows[1].cells[0]).toMatchObject({ value: '6', needsCalculation: false });
    expect(right).toMatchObject({ value: readsRight ? '7' : '', needsCalculation: !readsRight });
  });

  it('handles reversed absolute ranges, boolean values and empty cells', () => {
    const { model, result } = sheet([' 2 ', 'TRUE', 'FALSE', ''], 'SUM($A$4:$A$1)+$A$1');
    expect(resolveCellValue(model, result)).toBe('5');
  });

  it('calculates formula dependencies through a range and reuses cached values', () => {
    const { model, result } = sheet(['2', ''], 'SUM(A1:A2)');
    const dependency = model.rows[1].cells[0];
    Object.assign(dependency, { formula: '$A$1*3', needsCalculation: true });
    expect(resolveCellValue(model, result)).toBe('8');
    expect(dependency.value).toBe('6');
    expect(dependency.needsCalculation).toBe(false);
    expect(resolveCellValue(model, result)).toBe('8');
  });

  it('sums a full-sheet sparse range without visiting billions of empty coordinates', () => {
    const model: ParsedSheet = { id: 'sparse', name: 'Sparse', columnCount: 16384, rowCount: 1048576, rows: [
      { index: 1048576, cells: [{ ref: 'XFD1048576', row: 1048576, column: 16384, value: '7' }] },
      { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '2' }] },
      { index: 32, cells: [{ ref: 'AF32', row: 32, column: 32, value: '', formula: 'A1*3', needsCalculation: true }] }
    ] };
    const result: ParsedCell = { ref: 'XFE1', row: 1, column: 16385, value: '',
      formula: 'SUM($XFD$1048576:$A$1)', needsCalculation: true };
    expect(resolveCellValue(model, result)).toBe('15');
    expect(model.rows[2].cells[0].value).toBe('6');
  });

  it('keeps row-major floating point order and the last duplicate coordinate', () => {
    const model: ParsedSheet = { id: 'order', name: 'Order', columnCount: 33, rowCount: 3, rows: [
      { index: 3, cells: [{ ref: 'AG3', row: 3, column: 33, value: '1' }] },
      { index: 1, cells: [{ ref: 'AF1', row: 1, column: 32, value: '1E16' }, { ref: 'A1', row: 1, column: 1, value: '99' }] },
      { index: 2, cells: [{ ref: 'A2', row: 2, column: 1, value: '-1E16' }] },
      { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '0' }] }
    ] };
    const result: ParsedCell = { ref: 'AH1', row: 1, column: 34, value: '', formula: 'SUM(AG3:A1)', needsCalculation: true };
    expect(resolveCellValue(model, result)).toBe('1');
    expect(resolveCellValue(model, { ...result, formula: 'AF1+A2+AG3', needsCalculation: true })).toBe('1');
  });

  it.each(['SUM(A1:A2)', 'A1:A2+1', 'AVERAGE(A1:A2)', 'SUM(A1:A2,)', 'SUM(B1)'])('keeps unsupported, nonnumeric and circular formulas visible: %s', formula => {
    const { model, result } = sheet(['text', '1'], formula);
    expect(resolveCellValue(model, result)).toBe(`=${formula}`);
    expect(result.needsCalculation).toBe(false);
  });
});

describe('typed workbook formulas', () => {
  it.each([
    ['-2^2+12.5%*8', '5', undefined], ['2^3^2', '512', undefined],
    ['"a ""quote""" & TRUE & 3', 'a "quote"TRUE3', 'text'],
    ['_xlfn.CONCAT("項目 ",2,LEN("測試"))', '項目 22', 'text'],
    ['IF(3<>4,TRUE,1/0)', 'TRUE', 'boolean'],
    ['IF(FALSE,UNKNOWN(A1),"ok")', 'ok', 'text'],
    ['IFERROR(5,UNKNOWN(A1))', '5', undefined],
    ['IFERROR(#N/A,"fallback")', 'fallback', 'text'],
    ['NOT(AND(OR(FALSE,TRUE),1))', 'FALSE', 'boolean'],
    ['ROUND(-2.675,2)', '-2.68', undefined], ['ROUNDUP(-4.1,0)', '-5', undefined],
    ['ROUNDDOWN(-1.9,0)', '-1', undefined], ['ROUND(1250,-2)', '1300', undefined],
    ['MIN(9,4,7)+MAX(9,4,7)', '13', undefined],
    ['1/0', '#DIV/0!', 'error'], ['XFE1', '#REF!', 'error'],
    ['SUM("x",1)', '#VALUE!', 'error'], ['ABS(-5)', '5', undefined]
  ])('evaluates %s as the expected value and type', (formula, value, type) => {
    const { model, result } = sheet(['1'], formula);
    expect(resolveCellValue(model, result)).toBe(value);
    expect(result.valueType).toBe(type);
  });

  it('evaluates cross-sheet formulas, whole columns/rows and data types on sparse source cells', async () => {
    const { sheets: [summary, input] } = await loadXlsxWorkbook(await createFormulaWorkbook());
    const row = (index: number) => summary.rows[index].cells.map(cell => resolveCellValue(summary, cell));
    expect(row(0)).toEqual(['10', '15', '7.5', 'total: 15', 'safe', '2.68', '1', '1', '6']);
    expect(input.rows[0].cells[0].value).toBe('10');
    expect(row(1)).toEqual(['=Input!B1', 'missing', '#N/A', '4:TRUE', '5', "='[remote.xlsx]Sheet1'!A1"]);
    const last = summary.rows[2].cells[0];
    expect(resolveCellValue(summary, last)).toBe('225.25');
    expect(summary.rows[0].cells[3].valueType).toBe('text');
    expect(summary.rows[1].cells[2].valueType).toBe('error');
  });

  it('resolves sibling references against the individual cached workbook copy', async () => {
    const original = await loadXlsxWorkbook(await createFormulaWorkbook());
    const copy = clonePreviewWorkbook(original);
    copy.sheets[2].rows[0].cells[0].value = '99';
    expect(resolveCellValue(copy.sheets[0], copy.sheets[0].rows[0].cells[0])).toBe('100');
    expect(resolveCellValue(original.sheets[0], original.sheets[0].rows[0].cells[0])).toBe('10');
  });

  it('bounds dependency recursion without caching failures in uncalculated dependencies', () => {
    const { model, result } = sheet(Array(75).fill(''), 'A1');
    model.rows.forEach((row, i) => Object.assign(row.cells[0], {
      formula: i === model.rows.length - 1 ? '1' : 'A' + (i + 2) + '+1',
      needsCalculation: true
    }));
    expect(resolveCellValue(model, result)).toBe('=A1');
    expect(model.rows[50].cells[0].needsCalculation).toBe(true);
    expect(resolveCellValue(model, model.rows[50].cells[0])).toBe('25');
  });
});
