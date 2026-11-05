import type { ParsedCell, ParsedRow, ParsedSheet } from './types';
import { columnNameToIndex } from './columns';

// Reuse patterns across cells. Every stateful attribute match sets its cursor
// before execution, including after a previous worksheet rejected the input.
const attributePattern = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<>&]*)"|'([^'<>&]*)')/gy;
const valuePattern = /^\s*(?:<v\s*>([\s\S]*?)<\/v\s*>|<v\s*\/>)?\s*$/;
const numberPattern = /^[\s]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;
const booleanPattern = /^\s*(?:true|false)\s*$/;
const referencePattern = /^([A-Z]+)([1-9]\d*)$/i;

/** Read the common numeric/shared-string cell representation directly into the
 * preview model. Rich text, formulas and other XML constructs use the general
 * parser; rejecting the entire fast path prevents partially missing content. */
export function readSimpleWorksheet(xml: string, options: { id: string; name: string; sharedStrings: string[]; fontStyles?: ParsedCell['font'][]; columnStyle?: (column: number) => number }): ParsedSheet | undefined {
  const { sharedStrings, fontStyles, columnStyle } = options;
  if (xml.includes('<!')) return undefined;
  if (fontStyles?.length && /<cols\b/.test(xml) && !columnStyle) return undefined;
  const opening = /<sheetData\b([^<>]*)>/.exec(xml);
  if (!opening || !attributes(opening[1])) return undefined;
  const start = opening.index + opening[0].length;
  const end = xml.indexOf('</sheetData>', start);
  if (end < 0) return undefined;
  const data = xml.slice(start, end);
  if (/<(?:f|is)\b/.test(data)) return undefined;
  const rows: ParsedRow[] = [];
  const rowPattern = /\s*<row\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/row\s*>)/gy;
  const cellPattern = /\s*<c\b([^<>]*?)(?:\/>|>([\s\S]*?)<\/c\s*>)/gy;
  let offset = 0, maxRow = 0, maxColumn = 0;
  while (offset < data.length) {
    rowPattern.lastIndex = offset;
    const row = rowPattern.exec(data);
    if (!row) { if (data.slice(offset).trim()) return undefined; break; }
    const rowAttrs = attributes(row[1]);
    if (!rowAttrs) return undefined;
    const index = Number(rowAttrs.r ?? rows.length + 1);
    if (!Number.isInteger(index) || index < 1) return undefined;
    const rowStyle = rowAttrs.customFormat === '1' || rowAttrs.customFormat === 'true' ? rowAttrs.s : undefined;
    const rowFont = fontStyles?.[Number(rowStyle ?? 0)];
    const cells: ParsedCell[] = [];
    const content = row[2] ?? '';
    let cellOffset = 0;
    while (cellOffset < content.length) {
      cellPattern.lastIndex = cellOffset;
      const cell = cellPattern.exec(content);
      if (!cell) { if (content.slice(cellOffset).trim()) return undefined; break; }
      const attrs = attributes(cell[1]);
      if (!attrs) return undefined;
      const body = cell[2] ?? '';
      const valueMatch = valuePattern.exec(body);
      if (!valueMatch) return undefined;
      const raw = valueMatch[1] ?? '';
      if (raw.trim() && !numberPattern.test(raw) && !booleanPattern.test(raw)) return undefined;
      if (attrs.t && !['n', 's', 'b'].includes(attrs.t)) return undefined;
      if (attrs.r) {
        const ref = referencePattern.exec(attrs.r);
        if (!ref) return undefined;
        const column = columnNameToIndex(ref[1]);
        const value = attrs.t === 's' ? sharedStrings[Number(raw)] ?? '' :
          attrs.t === 'b' ? (raw.trim() === '1' || raw.trim() === 'true' ? 'TRUE' : 'FALSE') : raw;
        const parsed: ParsedCell = { ref: attrs.r, row: Number(ref[2]), column, value };
        const font = attrs.s !== undefined ? fontStyles?.[Number(attrs.s)] : rowStyle === undefined && columnStyle
          ? fontStyles?.[columnStyle(column)] : rowFont;
        if (font) parsed.font = font;
        cells.push(parsed);
        maxColumn = Math.max(maxColumn, column);
      }
      cellOffset = cellPattern.lastIndex;
    }
    rows.push({ index, cells });
    maxRow = Math.max(maxRow, index);
    offset = rowPattern.lastIndex;
  }
  return { id: options.id, name: options.name, rows, columnCount: maxColumn, rowCount: maxRow };
}

function attributes(source: string) {
  // A fixed shape avoids a dictionary object per cell. Validate every
  // attribute, but store only fields used by the worksheet reader.
  const values = { r: undefined as string | undefined, s: undefined as string | undefined,
    t: undefined as string | undefined, customFormat: undefined as string | undefined };
  let offset = 0;
  while (offset < source.length) {
    attributePattern.lastIndex = offset;
    const match = attributePattern.exec(source);
    if (!match) return source.slice(offset).trim() ? undefined : values;
    const key = match[1];
    if (key === 'r' || key === 's' || key === 't' || key === 'customFormat') values[key] = match[2] ?? match[3];
    offset = attributePattern.lastIndex;
  }
  return values;
}
