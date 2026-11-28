import type { ParsedCell, ParsedCellStyle, ParsedRichText, ParsedRow, ParsedRowHeight, ParsedSheet, ParsedTrackRange } from './types';
import { columnNameToIndex } from './columns';
import { addHiddenTrack } from './visible-tracks';
import { createWorksheetCell } from './worksheet-cell';
import { xlsxRowHeight } from './xlsx-row-heights';
import { decodePlainSpreadsheetXmlText, decodePlainXmlText, decodeSpreadsheetText } from './xml-values';

// Reuse patterns across cells. Every stateful attribute match sets its cursor
// before execution, including after a previous worksheet rejected the input.
const attributePattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<>&]*)"|'([^'<>&]*)')/gy;
const valuePattern = /^\s*(?:<v\s*>([\s\S]*?)<\/v\s*>|<v\s*\/>)?\s*$/;
const formulaPattern = /^\s*<f(?:\s+t\s*=\s*(?:"normal"|'normal'))?\s*>([^<\r]*)<\/f\s*>/;
const specialFormulaPattern = /^\s*<f(?=\s)([^<>]*?)(?:\/>|>([^<\r]*)<\/f\s*>)/;
const inlineTextPattern = /^\s*(?:<is\s*\/>|<is\s*>\s*(?:<t(?:\s+xml:space\s*=\s*(?:"(?:preserve|default)"|'(?:preserve|default)'))?\s*(?:\/>|>([^<\r]*)<\/t\s*>))?\s*<\/is\s*>)?\s*$/;
const richInlinePattern = /^\s*<is\s*>\s*<r(?=[\s/>])[\s\S]*<\/is\s*>\s*$/;
const numberPattern = /^[\s]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const booleanPattern = /^\s*(?:true|false)\s*$/;
const referencePattern = /^([A-Z]+)([1-9]\d*)$/i;

interface SimpleWorksheetOptions {
  id: string;
  name: string;
  sharedStrings: (string | ParsedRichText)[];
  styles?: ParsedCellStyle[];
  columnStyle?: (column: number) => number;
  forPreview?: boolean;
}

interface WorksheetFormulaEntry {
  cell: ParsedCell;
  type: 'shared' | 'array';
  si?: string;
  ref?: string;
  cm?: string;
  uncached: boolean;
}

export interface WorksheetBatchState {
  formulaEntries?: WorksheetFormulaEntry[];
  inlineEntries?: { cell: ParsedCell; xml: string }[];
  sharedStrings?: { through: number; missing?: { cell: ParsedCell; index: number }[] };
  usesTypedValues?: boolean;
  ambiguousValues?: boolean;
}

export function readSimpleWorksheet(xml: string, options: SimpleWorksheetOptions): ParsedSheet | undefined {
  if (xml.includes('<!')) return undefined;
  if (options.styles?.length && /<cols\b/.test(xml) && !options.columnStyle) return undefined;
  const opening = /<sheetData\b([^<>]*)>/.exec(xml);
  if (!opening || !attributes(opening[1])) return undefined;
  const start = opening.index + opening[0].length;
  const end = xml.indexOf('</sheetData>', start);
  if (end < 0) return undefined;
  return readSimpleRows(xml.slice(start, end), options);
}

export function readSimpleRows(data: string, { id, name, sharedStrings, styles, columnStyle, forPreview }: SimpleWorksheetOptions,
  previousRow = 0, batch?: WorksheetBatchState): ParsedSheet | undefined {
  if (!batch && /<(?:f|is)\b/.test(data)) return undefined;
  const formulaEntries = batch?.formulaEntries;
  const rows: ParsedRow[] = [];
  const hiddenRows: ParsedTrackRange[] = [];
  const heights = new Map<number, ParsedRowHeight>();
  const rowPattern = /\s*<row\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/row\s*>)/gy;
  const cellPattern = /\s*<c\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/c\s*>)/gy;
  const valueUnits: number[] = [];
  const cells: ParsedCell[] = [];
  let offset = 0, maxRow = 0, maxColumn = 0;
  while (offset < data.length) {
    rowPattern.lastIndex = offset;
    const row = rowPattern.exec(data);
    if (!row) { if (data.slice(offset).trim()) return undefined; break; }
    offset = rowPattern.lastIndex;
    const rowAttrs = attributes(row[1]);
    if (!rowAttrs) return undefined;
    const index = Number(rowAttrs.r ?? previousRow + 1);
    if (!Number.isInteger(index) || index < 1) return undefined;
    if (rowAttrs.r === undefined && index > 1_048_576) continue;
    previousRow = index;
    const height = xlsxRowHeight(rowAttrs.ht, rowAttrs.customHeight);
    if (rowAttrs.hidden === '1' || rowAttrs.hidden === 'true' || height?.height === 0) addHiddenTrack(hiddenRows, index);
    if (height && height.height !== 0 && index <= 1_048_576) heights.set(index, height);
    const rowStyle = rowAttrs.customFormat === '1' || rowAttrs.customFormat === 'true' ? rowAttrs.s : undefined;
    const rowStyleIndex = rowStyle === undefined ? undefined : Number(rowStyle);
    const content = row[2] ?? '';
    let cellOffset = 0, cellCount = 0, column = 0;
    while (cellOffset < content.length) {
      cellPattern.lastIndex = cellOffset;
      const cell = cellPattern.exec(content);
      if (!cell) { if (content.slice(cellOffset).trim()) return undefined; break; }
      cellOffset = cellPattern.lastIndex;
      const attrs = attributes(cell[1]);
      if (!attrs) return undefined;
      const kind = attrs.t;
      const body = cell[2] ?? '';
      const ordinary = formulaEntries ? formulaPattern.exec(body) : null;
      const special = formulaEntries && !ordinary ? specialFormulaPattern.exec(body) : null;
      const savedFormula = ordinary ?? special;
      const formulaAttrs = special ? attributes(special[1]) : undefined;
      const formulaType = formulaAttrs?.t;
      const shared = formulaType === 'shared';
      if (special && !shared && formulaType !== 'array') return undefined;
      const formula = savedFormula ? decodePlainXmlText(ordinary?.[1] ?? special?.[2] ?? '') : undefined;
      if (savedFormula && (formula === undefined || (!formula && !shared))) return undefined;
      const inline = batch && kind === 'inlineStr';
      if (inline && savedFormula) return undefined;
      const textValue = batch && (kind === 'str' || kind === 'e' || kind === 'd');
      if (!inline && !textValue && kind && kind !== 'n' && kind !== 's' && kind !== 'b') return undefined;
      const valueBody = savedFormula ? body.slice(savedFormula[0].length) : body;
      const valueMatch = (inline ? inlineTextPattern : valuePattern).exec(valueBody);
      const richInline = !valueMatch && inline && richInlinePattern.test(valueBody)
        && valueBody.indexOf('</is') === valueBody.lastIndexOf('</is');
      if (!valueMatch && !richInline) return undefined;
      const savedText = valueMatch?.[1];
      const text = savedText ?? '';
      if (textValue && /[<\r]/.test(text)) return undefined;
      const raw = inline ? decodePlainSpreadsheetXmlText(text) : textValue ? decodePlainXmlText(text) : text;
      if (raw === undefined) return undefined;
      const trimmed = inline || textValue ? raw : raw.trim();
      if (!inline && !textValue && trimmed && !numberPattern.test(raw) && !booleanPattern.test(raw)) return undefined;
      if (batch && (inline || textValue)) batch.usesTypedValues = true;
      const ref = attrs.r === undefined ? undefined : referencePattern.exec(attrs.r);
      if (ref === null) return undefined;
      if (!ref && (column >= 16_384 || index > 1_048_576)) continue;
      column = ref ? columnNameToIndex(ref[1]) : column + 1;
      const sharedIndex = kind === 's' && trimmed ? Number(raw) : -1;
      const value = kind === 's' ? sharedStrings[sharedIndex] ?? '' :
        kind === 'b' ? (trimmed === '1' || trimmed === 'true' ? 'TRUE' : 'FALSE') :
          copyCellText(kind === 'str' ? decodeSpreadsheetText(raw) : raw, valueUnits);
      const type = inline || kind === 's' || kind === 'str' ? 'text' : kind === 'b' ? 'boolean'
        : kind === 'e' ? 'error' : kind === 'd' ? 'date' : undefined;
      const selfClosingValue = !inline && savedText === undefined && valueBody.includes('<v');
      const missing = savedText === undefined && (inline ? !valueBody.trim() : !(selfClosingValue && (textValue || savedFormula)));
      // The older simple reader treats a self-closing shared-string or boolean value as missing.
      if (batch && selfClosingValue && !savedFormula && (kind === 's' || kind === 'b')) batch.ambiguousValues = true;
      const uncached = missing || (!type && !trimmed);
      const waiting = uncached && savedFormula;
      const parsed = createWorksheetCell(attrs.r, ref ? Number(ref[2]) : index, column,
        waiting ? '' : typeof value === 'string' ? value : value.value, type, forPreview && !savedFormula);
      if (typeof value !== 'string' && !waiting) parsed.richText = value;
      if (batch?.sharedStrings && sharedIndex >= 0 && Number.isSafeInteger(sharedIndex)) {
        batch.sharedStrings.through = Math.max(batch.sharedStrings.through, sharedIndex);
        if (sharedIndex >= sharedStrings.length && !waiting) (batch.sharedStrings.missing ??= []).push({ cell: parsed, index: sharedIndex });
      }
      if (richInline) (batch!.inlineEntries ??= []).push({ cell: parsed, xml: valueBody });
      if (formula) {
        parsed.formula = copyCellText(formula, valueUnits);
        parsed.needsCalculation = uncached;
      } else if (type && missing) parsed.missingValue = true;
      if (shared || (formulaType === 'array' && parsed.row === index)) {
        formulaEntries!.push({ cell: parsed, type: formulaType, si: formulaAttrs?.si,
          ref: formulaAttrs?.ref, cm: attrs.cm, uncached });
      }
      if (styles?.length) {
        const styleIndex = attrs.s === undefined ? rowStyleIndex ?? columnStyle?.(column) ?? 0 : Number(attrs.s);
        const font = forPreview ? undefined : styles[styleIndex]?.font;
        if (font) parsed.font = font;
        if (styleIndex !== 0) parsed.styleIndex = styleIndex;
      }
      cells[cellCount++] = parsed;
      maxColumn = Math.max(maxColumn, column);
    }
    // Keep only the populated prefix so stored rows have no spare push capacity.
    rows.push({ index, cells: cells.slice(0, cellCount),
      ...(styles?.length && rowStyleIndex !== undefined ? { styleIndex: rowStyleIndex } : {}) });
    maxRow = Math.max(maxRow, index);
  }
  return { id, name, rows, columnCount: maxColumn, rowCount: maxRow,
    ...(hiddenRows.length ? { hiddenRows } : {}), ...(heights.size ? { rowHeightSource: { rows: heights } } : {}) };
}

function copyCellText(raw: string, units: number[]): string {
  // V8 copies slices shorter than 13 code units. Longer captures can keep
  // the whole worksheet XML block alive through a single cell value.
  if (raw.length < 13) return raw;
  let copy = '';
  for (let start = 0; start < raw.length; start += units.length) {
    units.length = Math.min(1024, raw.length - start);
    for (let i = 0; i < units.length; i++) units[i] = raw.charCodeAt(start + i);
    copy += String.fromCharCode(...units);
  }
  return copy;
}

function attributes(source: string) {
  // A fixed shape avoids a dictionary object per cell. Validate every
  // attribute, but store only fields used by the worksheet reader.
  const values = { r: undefined as string | undefined, s: undefined as string | undefined,
    t: undefined as string | undefined, customFormat: undefined as string | undefined, hidden: undefined as string | undefined,
    ht: undefined as string | undefined, customHeight: undefined as string | undefined,
    si: undefined as string | undefined, ref: undefined as string | undefined, cm: undefined as string | undefined };
  let offset = 0;
  while (offset < source.length) {
    attributePattern.lastIndex = offset;
    const match = attributePattern.exec(source);
    if (!match) return source.slice(offset).trim() ? undefined : values;
    const key = match[1];
    if (key === 'r' || key === 's' || key === 't' || key === 'customFormat' || key === 'hidden' || key === 'ht' || key === 'customHeight'
      || key === 'si' || key === 'ref' || key === 'cm') {
      values[key] = match[2] ?? match[3];
    }
    offset = attributePattern.lastIndex;
  }
  return values;
}
