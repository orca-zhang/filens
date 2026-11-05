import { previewContentKey, previewModelCache, snapshotPreviewBytes, type PreviewFontReference, type PreviewLoadContext, type PreviewSource } from '@filens/core';
import { loadXlsxWorkbook } from './parser';
import type { ParsedWorkbook } from './types';

// Cells and font mappings are mutable during preview. Preserve font aliases
// inside each workbook, without sharing mutable cells/fonts between sessions.
export function clonePreviewWorkbook(workbook: ParsedWorkbook): ParsedWorkbook {
  const fonts = new Map<PreviewFontReference, PreviewFontReference>();
  const copyFont = (font: PreviewFontReference) => {
    let copy = fonts.get(font);
    if (!copy) { copy = structuredClone(font); fonts.set(font, copy); }
    return copy;
  };
  return {
    warnings: workbook.warnings.slice(),
    ...(workbook.fonts ? { fonts: workbook.fonts.map(copyFont) } : {}),
    sheets: workbook.sheets.map(sheet => ({ ...sheet, rows: sheet.rows.map(row => ({ ...row,
      cells: row.cells.map(cell => ({ ...cell, ...(cell.font ? { font: copyFont(cell.font) } : {}) }))
    })) }))
  };
}

function workbookBytes(workbook: ParsedWorkbook): number {
  let bytes = 256;
  for (const sheet of workbook.sheets) {
    bytes += 256 + sheet.name.length * 2;
    for (const row of sheet.rows) {
      bytes += 80;
      for (const cell of row.cells) bytes += 192 + (cell.ref.length + cell.value.length + (cell.formula?.length ?? 0)) * 2;
    }
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
  const key = await previewContentKey(bytes, 'xlsx-preview-v1', context.signal);
  const cached = previewModelCache.get<ParsedWorkbook>(key);
  if (cached) return cached;
  const workbook = await loadXlsxWorkbook(bytes, context);
  context.signal?.throwIfAborted();
  previewModelCache.put(key, workbook, { bytes: workbookBytes(workbook), clone: clonePreviewWorkbook });
  return workbook;
}
