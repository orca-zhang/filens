import type { ParsedCell, ParsedCellStyle, ParsedRichText, ParsedRow, ParsedRowHeight, ParsedSheet, ParsedTrackRange } from './types';
import { columnNameToIndex } from './columns';
import { addHiddenTrack } from './visible-tracks';
import { createWorksheetCell } from './worksheet-cell';
import { xlsxRowHeight } from './xlsx-row-heights';
import { decodeSpreadsheetText } from './xml-values';

// Reuse patterns across cells. Every stateful attribute match sets its cursor
// before execution, including after a previous worksheet rejected the input.
const attributePattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<>&]*)"|'([^'<>&]*)')/gy;
const valuePattern = /^\s*(?:<v\s*>([\s\S]*?)<\/v\s*>|<v\s*\/>)?\s*$/;
const inlineTextPattern = /^\s*<is\s*>\s*<t(?:\s+xml:space\s*=\s*(?:"(?:preserve|default)"|'(?:preserve|default)'))?\s*>([^<&\r]*)<\/t\s*>\s*<\/is\s*>\s*$/;
const numberPattern = /^[\s]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const booleanPattern = /^\s*(?:true|false)\s*$/;
const referencePattern = /^([A-Z]+)([1-9]\d*)$/i;

/** Read simple cells directly into the model. Formulas and text that needs XML
 * decoding use the general parser. */
interface SimpleWorksheetOptions {
  id: string;
  name: string;
  sharedStrings: (string | ParsedRichText)[];
  styles?: ParsedCellStyle[];
  columnStyle?: (column: number) => number;
  forPreview?: boolean;
  allowInline?: boolean;
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

export function readSimpleRows(data: string, { id, name, sharedStrings, styles, columnStyle, forPreview, allowInline }: SimpleWorksheetOptions,
  previousRow = 0): ParsedSheet | undefined {
  if ((allowInline ? /&|<f\b/ : /<(?:f|is)\b/).test(data)) return undefined;
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
      const inline = allowInline && attrs.t === 'inlineStr';
      if (!inline && attrs.t && !['n', 's', 'b'].includes(attrs.t)) return undefined;
      const valueMatch = (inline ? inlineTextPattern : valuePattern).exec(cell[2] ?? '');
      if (!valueMatch) return undefined;
      const raw = inline ? decodeSpreadsheetText(valueMatch[1] ?? '') : valueMatch[1] ?? '';
      if (!inline && raw.trim() && !numberPattern.test(raw) && !booleanPattern.test(raw)) return undefined;
      const ref = attrs.r === undefined ? undefined : referencePattern.exec(attrs.r);
      if (ref === null) return undefined;
      if (!ref && (column >= 16_384 || index > 1_048_576)) continue;
      column = ref ? columnNameToIndex(ref[1]) : column + 1;
      const value = attrs.t === 's' ? (raw.trim() ? sharedStrings[Number(raw)] ?? '' : '') :
        attrs.t === 'b' ? (raw.trim() === '1' || raw.trim() === 'true' ? 'TRUE' : 'FALSE') : copyCellText(raw, valueUnits);
      const parsed = createWorksheetCell(attrs.r, ref ? Number(ref[2]) : index, column,
        typeof value === 'string' ? value : value.value, forPreview);
      if (typeof value !== 'string') parsed.richText = value;
      if (inline || attrs.t === 's') parsed.valueType = 'text';
      if (attrs.t === 'b') parsed.valueType = 'boolean';
      if (parsed.valueType && valueMatch[1] === undefined) parsed.missingValue = true;
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
    ht: undefined as string | undefined, customHeight: undefined as string | undefined };
  let offset = 0;
  while (offset < source.length) {
    attributePattern.lastIndex = offset;
    const match = attributePattern.exec(source);
    if (!match) return source.slice(offset).trim() ? undefined : values;
    const key = match[1];
    if (key === 'r' || key === 's' || key === 't' || key === 'customFormat' || key === 'hidden' || key === 'ht' || key === 'customHeight') {
      values[key] = match[2] ?? match[3];
    }
    offset = attributePattern.lastIndex;
  }
  return values;
}
