import { previewContentKey, previewModelCache, snapshotPreviewBytes, type PreviewFontReference, type PreviewLoadContext, type PreviewSource } from '@filens/core';
import { readXlsxWorkbook, readCsvWorkbook } from './parser';
import { registerWorkbookFormulas, wasCalculatedWithClock } from './cell-value';
import type { ParsedCell, ParsedCellStyle, ParsedConditionalStyle, ParsedMerge, ParsedRichText, ParsedSheet, ParsedWorkbook } from './types';
import { WorksheetValueCell } from './worksheet-cell';

// Cells and font mappings are mutable during preview. Preserve font aliases
// inside each workbook, without sharing mutable cells/fonts between sessions.
export function clonePreviewWorkbook(workbook: ParsedWorkbook): ParsedWorkbook {
  const fonts = new Map<PreviewFontReference, PreviewFontReference>();
  const copyFont = (font: PreviewFontReference) => {
    let copy = fonts.get(font);
    if (!copy) { copy = structuredClone(font); fonts.set(font, copy); }
    return copy;
  };
  const formats = new Map<readonly ParsedCellStyle[], ParsedCellStyle[]>();
  const copyFormats = (source: readonly ParsedCellStyle[]) => {
    let copy = formats.get(source);
    if (!copy) {
      copy = source.map(({ font, ...style }) => ({ ...structuredClone(style), ...(font ? { font: copyFont(font) } : {}) }));
      formats.set(source, copy);
    }
    return copy;
  };
  const richTexts = new Map<ParsedRichText, ParsedRichText>();
  const copyRichText = (text: ParsedRichText) => {
    let copy = richTexts.get(text);
    if (!copy) {
      copy = { value: text.value, runs: text.runs.map(run => ({ ...run, ...(run.font ? { font: copyFont(run.font) } : {}) })) };
      richTexts.set(text, copy);
    }
    return copy;
  };
  const copyCell = (cell: ParsedCell): ParsedCell => {
    const copy = cell instanceof WorksheetValueCell
      ? Object.assign(new WorksheetValueCell(cell.row, cell.column, cell.value), cell)
      : { ...cell };
    if (wasCalculatedWithClock(cell)) copy.needsCalculation = true;
    if (cell.font) copy.font = copyFont(cell.font);
    if (cell.richText) copy.richText = copyRichText(cell.richText);
    return copy;
  };
  const conditionalRules = workbook.sheets.some(sheet => sheet.conditionalRules)
    ? structuredClone(workbook.sheets.map(sheet => sheet.conditionalRules)) : undefined;
  const clone: ParsedWorkbook = {
    warnings: workbook.warnings.slice(),
    ...(workbook.definedNames ? { definedNames: workbook.definedNames.map(name => ({ ...name })) } : {}),
    ...(workbook.fonts ? { fonts: workbook.fonts.map(copyFont) } : {}),
    sheets: workbook.sheets.map((sheet, index) => ({ ...sheet,
      ...(sheet.hiddenRows ? { hiddenRows: sheet.hiddenRows.map(range => ({ ...range })) } : {}),
      ...(sheet.hiddenColumns ? { hiddenColumns: sheet.hiddenColumns.map(range => ({ ...range })) } : {}),
      ...(sheet.rowHeightSource ? { rowHeightSource: structuredClone(sheet.rowHeightSource) } : {}),
      ...(sheet.sharedFormulas ? { sharedFormulas: structuredClone(sheet.sharedFormulas) } : {}),
      ...(sheet.arrayFormulas ? { arrayFormulas: sheet.arrayFormulas.map(range => ({ ...range })) } : {}),
      ...(sheet.tables ? { tables: structuredClone(sheet.tables) } : {}),
      ...(sheet.autoFilterRows ? { autoFilterRows: { ...sheet.autoFilterRows } } : {}),
      ...(conditionalRules?.[index] ? { conditionalRules: conditionalRules[index] } : {}),
      ...(sheet.columnWidthSource ? { columnWidthSource: { ...sheet.columnWidthSource,
        ...(sheet.columnWidthSource.font ? { font: copyFont(sheet.columnWidthSource.font) } : {}) } } : {}),
      ...(sheet.cellStyles ? { cellStyles: { ...sheet.cellStyles, formats: copyFormats(sheet.cellStyles.formats),
        columns: sheet.cellStyles.columns.map(range => ({ ...range })) } } : {}),
      rows: sheet.rows.map(row => ({ ...row, cells: row.cells.map(copyCell) })) }))
  };
  registerWorkbookFormulas(clone);
  return clone;
}

function workbookBytes(workbook: ParsedWorkbook): number {
  let bytes = 256;
  bytes += (workbook.sheets.find(sheet => sheet.numberFormatPalette)?.numberFormatPalette?.length ?? 0) * 24;
  for (const name of workbook.definedNames ?? []) bytes += 160 + (name.name.length + name.formula.length + (name.sheet?.length ?? 0)) * 2;
  const formats = new Set<readonly ParsedCellStyle[]>();
  const richTexts = new Set<ParsedRichText>();
  const conditionalStyles = new Set<ParsedConditionalStyle>();
  const conditionalRanges = new Set<readonly ParsedMerge[]>();
  for (const sheet of workbook.sheets) {
    bytes += 256 + sheet.name.length * 2;
    bytes += (sheet.columnWidths?.length ?? 0) * 8 + (sheet.columnWidthSource?.ranges.length ?? 0) * 32;
    bytes += ((sheet.hiddenRows?.length ?? 0) + (sheet.hiddenColumns?.length ?? 0)) * 48;
    if (sheet.rowHeightSource) bytes += 80 + sheet.rowHeightSource.rows.size * 64;
    if (sheet.sharedFormulas) for (const group of Object.values(sheet.sharedFormulas)) bytes += 96 + group.formula.length * 2;
    bytes += (sheet.arrayFormulas?.length ?? 0) * 64;
    for (const table of sheet.tables ?? []) bytes += 128 + table.name.length * 2
      + table.columns.reduce((size, name) => size + 24 + name.length * 2, 0);
    for (const rule of sheet.conditionalRules ?? []) {
      bytes += 160 + (JSON.stringify(rule.condition).length + (rule.activeFormula?.length ?? 0)) * 2;
      conditionalRanges.add(rule.ranges);
      if (rule.style) conditionalStyles.add(rule.style);
    }
    if (sheet.cellStyles) {
      formats.add(sheet.cellStyles.formats);
      bytes += sheet.cellStyles.columns.length * 32;
    }
    for (const row of sheet.rows) {
      bytes += 80;
      for (const cell of row.cells) {
        const refLength = cell instanceof WorksheetValueCell ? 0 : cell.ref.length;
        bytes += 192 + (refLength + cell.value.length + (cell.formula?.length ?? 0)) * 2;
        if (cell.richText) richTexts.add(cell.richText);
      }
    }
  }
  for (const styles of formats) bytes += JSON.stringify(styles).length * 2;
  for (const style of conditionalStyles) bytes += 80 + JSON.stringify(style).length * 2;
  for (const ranges of conditionalRanges) bytes += 48 + ranges.length * 70;
  for (const text of richTexts) {
    bytes += 64;
    for (const run of text.runs) bytes += 128 + run.text.length * 2;
  }
  for (const font of workbook.fonts ?? []) bytes += 512 + JSON.stringify(font).length * 2;
  for (const warning of workbook.warnings) bytes += 32 + warning.length * 2;
  return bytes;
}

export async function loadPreviewWorkbook(source: PreviewSource, context: PreviewLoadContext,
  progress?: { csvRows(sheet: ParsedSheet): void; worksheet(sheet: ParsedSheet): void; worksheetRows?(sheet: ParsedSheet): void }): Promise<ParsedWorkbook> {
  const format = (context.route?.sourceFormat ?? context.descriptor.extension)?.trim().replace(/^\./, '').toLowerCase();
  if (format === 'csv') return readCsvWorkbook(source, context, progress?.csvRows);
  const parse = (input: PreviewSource) => readXlsxWorkbook(input, context, {
    onSheet: progress?.worksheet, onRows: progress?.worksheetRows
  });
  // Hashing Blob or ranged inputs would require materializing the whole package.
  if (typeof source === 'string' || source instanceof Blob || context.zipEntries ||
      context.descriptor.sensitive || context.descriptor.password !== undefined) return parse(source);
  const bytes = await snapshotPreviewBytes(source, context.signal);
  if (!bytes) return parse(source);
  const key = await previewContentKey(bytes, 'xlsx-preview-v16', context.signal);
  const cached = previewModelCache.get<ParsedWorkbook>(key);
  if (cached) return cached;
  const workbook = await parse(bytes);
  context.signal?.throwIfAborted();
  previewModelCache.put(key, workbook, { bytes: workbookBytes(workbook), clone: clonePreviewWorkbook });
  return workbook;
}
