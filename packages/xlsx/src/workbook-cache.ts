import { previewContentKey, previewModelCache, snapshotPreviewBytes, type PreviewFontReference, type PreviewLoadContext, type PreviewSource } from '@filens/core';
import { loadXlsxWorkbook } from './parser';
import { registerWorkbookFormulas } from './cell-value';
import type { ParsedCellStyle, ParsedConditionalStyle, ParsedMerge, ParsedRichText, ParsedWorkbook } from './types';

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
  const conditionalRules = workbook.sheets.some(sheet => sheet.conditionalRules)
    ? structuredClone(workbook.sheets.map(sheet => sheet.conditionalRules)) : undefined;
  const clone: ParsedWorkbook = {
    warnings: workbook.warnings.slice(),
    ...(workbook.definedNames ? { definedNames: workbook.definedNames.map(name => ({ ...name })) } : {}),
    ...(workbook.fonts ? { fonts: workbook.fonts.map(copyFont) } : {}),
    sheets: workbook.sheets.map((sheet, index) => ({ ...sheet,
      ...(sheet.sharedFormulas ? { sharedFormulas: structuredClone(sheet.sharedFormulas) } : {}),
      ...(conditionalRules?.[index] ? { conditionalRules: conditionalRules[index] } : {}),
      ...(sheet.columnWidthSource ? { columnWidthSource: { ...sheet.columnWidthSource,
        ...(sheet.columnWidthSource.font ? { font: copyFont(sheet.columnWidthSource.font) } : {}) } } : {}),
      ...(sheet.cellStyles ? { cellStyles: { ...sheet.cellStyles, formats: copyFormats(sheet.cellStyles.formats),
        columns: sheet.cellStyles.columns.map(range => ({ ...range })) } } : {}),
      rows: sheet.rows.map(row => ({ ...row,
      cells: row.cells.map(cell => ({ ...cell, ...(cell.font ? { font: copyFont(cell.font) } : {}),
        ...(cell.richText ? { richText: copyRichText(cell.richText) } : {}) }))
    })) }))
  };
  registerWorkbookFormulas(clone);
  return clone;
}

function workbookBytes(workbook: ParsedWorkbook): number {
  let bytes = 256;
  for (const name of workbook.definedNames ?? []) bytes += 160 + (name.name.length + name.formula.length + (name.sheet?.length ?? 0)) * 2;
  const formats = new Set<readonly ParsedCellStyle[]>();
  const richTexts = new Set<ParsedRichText>();
  const conditionalStyles = new Set<ParsedConditionalStyle>();
  const conditionalRanges = new Set<readonly ParsedMerge[]>();
  for (const sheet of workbook.sheets) {
    bytes += 256 + sheet.name.length * 2;
    bytes += (sheet.columnWidths?.length ?? 0) * 8 + (sheet.columnWidthSource?.ranges.length ?? 0) * 32;
    if (sheet.sharedFormulas) for (const group of Object.values(sheet.sharedFormulas)) bytes += 96 + group.formula.length * 2;
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
        bytes += 192 + (cell.ref.length + cell.value.length + (cell.formula?.length ?? 0)) * 2;
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

export async function loadPreviewWorkbook(source: PreviewSource, context: PreviewLoadContext): Promise<ParsedWorkbook> {
  const format = (context.route?.sourceFormat ?? context.descriptor.extension)?.replace(/^\./, '').toLowerCase();
  // CSV parsing is already cheaper than copying a cell graph; preserve its path.
  if (format === 'csv' || typeof source === 'string' || context.descriptor.password !== undefined) return loadXlsxWorkbook(source, context);
  const bytes = await snapshotPreviewBytes(source, context.signal);
  if (!bytes) return loadXlsxWorkbook(source, context);
  const key = await previewContentKey(bytes, 'xlsx-preview-v11', context.signal);
  const cached = previewModelCache.get<ParsedWorkbook>(key);
  if (cached) return cached;
  const workbook = await loadXlsxWorkbook(bytes, context);
  context.signal?.throwIfAborted();
  previewModelCache.put(key, workbook, { bytes: workbookBytes(workbook), clone: clonePreviewWorkbook });
  return workbook;
}
