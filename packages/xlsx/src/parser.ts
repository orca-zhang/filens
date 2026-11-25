import type { XMLParser } from 'fast-xml-parser';
import { openZipArchive, type PreviewFontReference, type ZipEntry, type PreviewLoadContext, type PreviewSource } from '@filens/core';
import type { ParsedCell, ParsedCellStyle, ParsedColumnStyle, ParsedColumnWidthSource, ParsedConditionalStyle, ParsedDefinedName, ParsedMerge, ParsedRichText, ParsedRow, ParsedSheet, ParsedWorkbook } from './types';
import { readSimpleWorksheet } from './simple-worksheet';
import { xlsxColumnWidths } from './xlsx-column-widths';
import { colorReader, readDifferentialStyles, readFontReference, readStyleAppearance } from './style-appearance';
import { readConditionalRules } from './conditional-rules';
import { columnStyleLookup } from './column-styles';
import { readPath, toArray } from './xml-values';
import { registerWorkbookFormulas } from './cell-value';
import { formulaName, MAX_FORMULA_LENGTH } from './formula-reader';
import { SharedFormulaReader } from './shared-formulas';
import { createRichTextReader, readTextValue } from './rich-text';
export { resolveCellValue } from './cell-value';
import { columnIndexToName, parseCellRef, parseSheetRange } from './columns';

const MAX_XML_ENTITY_EXPANSIONS = 100_000;

let parserPromise: Promise<XMLParser> | undefined;
function loadXmlParser(): Promise<XMLParser> {
  return parserPromise ??= import('fast-xml-parser').then(({ XMLParser }) => new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    // This parser also gates XML numeric character references behind htmlEntities.
    htmlEntities: true,
    processEntities: {
      enabled: true,
      maxEntitySize: 10_000,
      maxExpansionDepth: 10,
      maxTotalExpansions: MAX_XML_ENTITY_EXPANSIONS,
      maxExpandedLength: 100_000,
      maxEntityCount: 100
    }
  }));
}

interface WorkbookSheetRef {
  name: string;
  sheetId: string;
  relationshipId: string;
}

interface RelationshipRef {
  id: string;
  target: string;
  type?: string;
}

export async function loadXlsxWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  checkAborted(context?.signal);
  const format = normalizeFormat(context?.route?.sourceFormat ?? context?.descriptor.extension);
  if (format === 'csv') {
    return loadCsvWorkbook(source, context);
  }

  const bytes = await sourceToBytes(source, context);
  checkAborted(context?.signal);
  const zip = await openZipArchive(bytes);
  checkAborted(context?.signal);
  const warnings: string[] = [];
  const workbookXml = await readRequiredText(zip, 'xl/workbook.xml', context?.signal);
  const relsXml = await readRequiredText(zip, 'xl/_rels/workbook.xml.rels', context?.signal);
  const parser = await loadXmlParser();
  checkAborted(context?.signal);
  const workbook = parser.parse(workbookXml) as Record<string, unknown>;
  const date1904 = ['1', 'true'].includes(String(readPath(workbook, ['workbook', 'workbookPr', 'date1904'])));
  const relationships = readRelationships(relsXml, parser);
  const workbookStyles = await readWorkbookStyles(zip, relationships, parser, context?.signal);
  const readRichText = createRichTextReader(workbookStyles.theme, workbookStyles.color, workbookStyles.fonts);
  const sharedPath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  const sharedStrings = await readSharedStrings(zip.get(sharedPath), parser, readRichText, context?.signal);
  const hasRichSharedStrings = sharedStrings.some(value => typeof value !== 'string');
  const sheets = readWorkbookSheets(workbook);

  const parsedSheets: ParsedSheet[] = [];
  for (const sheet of sheets) {
    checkAborted(context?.signal);
    if (!sheet.relationshipId) continue;
    const relationship = relationships.find((entry) => entry.id === sheet.relationshipId);
    if (!relationship) {
      warnings.push(`Missing relationship for sheet ${sheet.name}.`);
      continue;
    }

    const sheetPath = resolveWorkbookTarget(relationship.target);
    const sheetXml = await zip.get(sheetPath)?.text();
    checkAborted(context?.signal);
    if (!sheetXml) {
      warnings.push(`Missing worksheet file for sheet ${sheet.name}.`);
      continue;
    }

    parsedSheets.push(readWorksheet(sheetXml, {
      id: sheet.sheetId,
      name: sheet.name,
      sharedStrings,
      hasRichSharedStrings,
      readRichText,
      styles: workbookStyles.styles,
      differentialStyles: workbookStyles.differentialStyles,
      columnWidthFont: workbookStyles.columnWidthFont,
      date1904,
      warnings
    }, parser));
  }

  const definedNames = readDefinedNames(workbook, sheets, warnings);
  const parsed = {
    sheets: parsedSheets,
    warnings,
    fonts: workbookStyles.fonts,
    ...(definedNames.length ? { definedNames } : {})
  };
  registerWorkbookFormulas(parsed);
  return parsed;
}

export async function loadCsvWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  checkAborted(context?.signal);
  const text = await sourceToText(source, context);
  checkAborted(context?.signal);
  const { rows, columnCount } = parseCsv(text);

  return {
    sheets: [
      {
        id: 'csv',
        name: inferCsvSheetName(context?.descriptor.name),
        rows,
        columnCount,
        rowCount: rows.length
      }
    ],
    warnings: []
  };
}

async function sourceToBytes(source: PreviewSource, context?: PreviewLoadContext): Promise<Uint8Array> {
  if (typeof source === 'string') {
    const response = await fetch(source, {
      signal: context?.signal
    });
    if (!response.ok) {
      throw new Error(`Failed to load XLSX source: ${response.status} ${response.statusText}`.trim());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  if (source instanceof Uint8Array) {
    return source;
  }
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  if (source instanceof Blob) {
    return new Uint8Array(await source.arrayBuffer());
  }
  return new Uint8Array();
}

async function sourceToText(source: PreviewSource, context?: PreviewLoadContext): Promise<string> {
  if (typeof source === 'string') {
    if (source.trimStart().toLowerCase().startsWith('data:')) {
      return readDataUrlText(source);
    }
    const response = await fetch(source, {
      signal: context?.signal
    });
    if (!response.ok) {
      throw new Error(`Failed to load CSV source: ${response.status} ${response.statusText}`.trim());
    }
    return response.text();
  }

  if (source instanceof Blob) {
    return source.text();
  }
  if (ArrayBuffer.isView(source)) {
    return new TextDecoder().decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
  if (source instanceof ArrayBuffer) {
    return new TextDecoder().decode(source);
  }
  return String(source);
}

function readDataUrlText(source: string): string {
  const commaIndex = source.indexOf(',');
  if (commaIndex < 0) {
    return source;
  }
  const meta = source.slice(0, commaIndex).toLowerCase();
  const payload = source.slice(commaIndex + 1);
  if (meta.endsWith(';base64')) {
    return new TextDecoder().decode(Uint8Array.from(atob(payload), (char) => char.charCodeAt(0)));
  }
  return decodeURIComponent(payload);
}

function parseCsv(text: string): Pick<ParsedSheet, 'rows' | 'columnCount'> {
  text = text.replace(/^\uFEFF/, '');
  const rows: ParsedRow[] = [];
  const columnNames: string[] = [];
  const appendRow = (record: string[]) => {
    while (columnNames.length < record.length) columnNames.push(columnIndexToName(columnNames.length + 1));
    const row = rows.length + 1;
    const suffix = String(row);
    const cells: ParsedCell[] = new Array(record.length);
    for (let column = 0; column < record.length; column++) {
      cells[column] = { ref: columnNames[column] + suffix, row, column: column + 1, value: record[column] };
    }
    rows.push({ index: row, cells });
  };
  if (!text.includes('"')) {
    const lines = text.split(/\r\n|\r|\n/);
    if (text.length && /[\r\n]$/.test(text)) lines.pop();
    for (const line of lines) appendRow(line.split(','));
    return { rows, columnCount: columnNames.length };
  }
  let row: string[] = [];
  let cell = '';
  let index = 0;
  let start = 0;
  let recordStart = 0;
  let quoted = false;

  while (index < text.length) {
    if (quoted) {
      const quote = text.indexOf('"', index);
      if (quote < 0) {
        cell += text.slice(index);
        start = index = text.length;
        break;
      }
      cell += text.slice(index, quote);
      index = quote + 1;
      if (text[index] === '"') {
        cell += '"';
        index++;
      } else {
        quoted = false;
      }
      start = index;
      continue;
    }

    const char = text[index];
    if (char === '"' && cell.length === 0 && index === start) {
      quoted = true;
      start = ++index;
      continue;
    }
    if (char === ',') {
      row.push(cell + text.slice(start, index));
      cell = '';
      start = ++index;
      continue;
    }
    if (char === '\r' || char === '\n') {
      row.push(cell + text.slice(start, index));
      appendRow(row);
      row = [];
      cell = '';
      if (char === '\r' && text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      recordStart = start = index;
      continue;
    }
    index += 1;
  }

  // A quoted empty field still starts a record, even though its decoded value is empty.
  if (recordStart < text.length || text.length === 0) {
    row.push(cell + text.slice(start, index));
    appendRow(row);
  }

  return { rows, columnCount: columnNames.length };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
}

async function readRequiredText(zip: Map<string, ZipEntry>, path: string, signal?: AbortSignal): Promise<string> {
  checkAborted(signal);
  const file = zip.get(path);
  if (!file) {
    throw new Error(`Invalid XLSX file: missing ${path}.`);
  }
  const text = await file.text();
  checkAborted(signal);
  return text;
}

async function readSharedStrings(file: ZipEntry | undefined, parser: XMLParser,
  readRichText: ReturnType<typeof createRichTextReader>, signal?: AbortSignal): Promise<(string | ParsedRichText)[]> {
  checkAborted(signal);
  if (!file) {
    return [];
  }
  const xml = await file.text();
  checkAborted(signal);
  const document = parser.parse(xml) as Record<string, unknown>;
  const items = toArray(readPath(document, ['sst', 'si']));
  return items.map(readRichText);
}

function readRelationships(xml: string, parser: XMLParser): RelationshipRef[] {
  const document = parser.parse(xml) as Record<string, unknown>;
  return toArray(readPath(document, ['Relationships', 'Relationship']))
    .map((relationship) => ({
      id: String(readPath(relationship, ['Id']) ?? ''),
      target: String(readPath(relationship, ['Target']) ?? ''),
      type: String(readPath(relationship, ['Type']) ?? '')
    }))
    .filter((relationship) => relationship.id && relationship.target);
}

function readWorkbookSheets(workbook: Record<string, unknown>): WorkbookSheetRef[] {
  return toArray(readPath(workbook, ['workbook', 'sheets', 'sheet']))
    .map((sheet) => ({
      name: String(readPath(sheet, ['name']) ?? 'Sheet'),
      sheetId: String(readPath(sheet, ['sheetId']) ?? readPath(sheet, ['name']) ?? 'sheet'),
      relationshipId: String(readPath(sheet, ['r:id']) ?? '')
    }));
}

function readDefinedNames(workbook: unknown, sheets: readonly WorkbookSheetRef[], warnings: string[]): ParsedDefinedName[] {
  const names: ParsedDefinedName[] = [];
  const keys = new Set<string>();
  let invalid = 0, duplicates = 0;
  for (const entry of toArray(readPath(workbook, ['workbook', 'definedNames', 'definedName']))) {
    const name = readPath(entry, ['name']), ordinal = readPath(entry, ['localSheetId']);
    const formula = readTextValue(entry).trim();
    const sheet = typeof ordinal === 'string' && /^\d+$/.test(ordinal) ? sheets[Number(ordinal)]?.name : undefined;
    if (typeof name !== 'string' || name.length > 255 || !formulaName.test(name) || !formula
      || formula.length > MAX_FORMULA_LENGTH || (ordinal !== undefined && sheet === undefined)) {
      invalid++;
      continue;
    }
    const key = JSON.stringify([sheet?.toLowerCase(), name.toLowerCase()]);
    if (keys.has(key)) duplicates++;
    else keys.add(key);
    names.push({ name, formula, ...(sheet !== undefined ? { sheet } : {}) });
  }
  if (invalid) warnings.push(`Ignored ${invalid} invalid XLSX defined name entries.`);
  if (duplicates) warnings.push(`Found ${duplicates} duplicate XLSX defined name entries.`);
  return names;
}

async function readWorkbookStyles(zip: Map<string, ZipEntry>, relationships: RelationshipRef[], parser: XMLParser, signal?: AbortSignal): Promise<{
  fonts: PreviewFontReference[]; styles: ParsedCellStyle[];
  differentialStyles: ParsedConditionalStyle[];
  columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'>;
  theme: unknown; color: ReturnType<typeof colorReader>;
}> {
  const stylePath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/styles'))?.target ?? 'styles.xml');
  const xml = await zip.get(stylePath)?.text();
  checkAborted(signal);
  const themePath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/theme'))?.target ?? 'theme/theme1.xml');
  const themeXml = await zip.get(themePath)?.text();
  checkAborted(signal);
  const theme = themeXml ? parser.parse(themeXml) : undefined;
  const styles = xml ? parser.parse(xml) as Record<string, unknown> : undefined;
  const styleSheet = readPath(styles, ['styleSheet']);
  const color = colorReader(styleSheet, theme);
  if (!xml) return { fonts: [], styles: [], differentialStyles: [], theme, color };
  const fontEntries = toArray(readPath(styles, ['styleSheet', 'fonts', 'font']));
  const fonts = fontEntries.map(font => readFontReference(font, theme));
  const bases = toArray(readPath(styles, ['styleSheet', 'cellStyleXfs', 'xf']));
  const cells = toArray(readPath(styles, ['styleSheet', 'cellXfs', 'xf']));
  const normal = toArray(readPath(styles, ['styleSheet', 'cellStyles', 'cellStyle']))
    .find(style => String(readPath(style, ['builtinId'])) === '0' || readPath(style, ['name']) === 'Normal');
  const normalFontId = Number(readPath(bases[Number(readPath(normal, ['xfId']) ?? 0)], ['fontId']) ?? 0);
  const normalSize = Number(readPath(fontEntries[normalFontId], ['sz', 'val']));
  return {
    fonts,
    theme,
    color,
    columnWidthFont: { font: fonts[normalFontId], fontSize: Number.isFinite(normalSize) && normalSize > 0 ? normalSize : 11 },
    styles: readStyleAppearance(styleSheet, color, fontEntries, fonts, bases, cells),
    differentialStyles: readDifferentialStyles(styleSheet, color)
  };
}

function readWorksheet(
  xml: string,
  options: {
    id: string;
    name: string;
    sharedStrings: (string | ParsedRichText)[];
    hasRichSharedStrings: boolean;
    readRichText: ReturnType<typeof createRichTextReader>;
    styles: ParsedCellStyle[];
    differentialStyles: ParsedConditionalStyle[];
    columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'>;
    date1904: boolean;
    warnings: string[];
  },
  parser: XMLParser
): ParsedSheet {
  let metadata: unknown;
  const hasColumnMetadata = /<(?:cols|sheetFormatPr)\b/.test(xml);
  if (hasColumnMetadata && !xml.includes('<!')) {
    const dataStart = /<sheetData\b/.exec(xml)?.index;
    if (dataStart !== undefined && xml.lastIndexOf('<cols') < dataStart && xml.lastIndexOf('<sheetFormatPr') < dataStart) {
      // Parse only metadata with the existing XML parser, without creating an
      // intermediate XML object tree for every numeric/shared-string cell.
      metadata = parser.parse(xml.slice(0, dataStart) + '</worksheet>');
    }
  }
  let columnStyles = options.styles.length ? readColumnStyles(metadata) : [];
  let columnStyle = columnStyleLookup(columnStyles);
  const simple = hasColumnMetadata && !metadata ? undefined : readSimpleWorksheet(xml, { ...options, columnStyle });
  // Keep worksheet metadata in its source structure while leaving fast-path rows out of the XML tree.
  const dataStart = simple ? /<sheetData\b/.exec(xml)!.index : 0;
  const dataEnd = simple ? xml.indexOf('</sheetData>', dataStart) + '</sheetData>'.length : 0;
  const document = parser.parse(simple ? xml.slice(0, dataStart) + xml.slice(dataEnd) : xml) as Record<string, unknown>;
  const merges = readMergedRanges(document, options.warnings, options.name);
  const conditionalRules = readConditionalRules(document, options.differentialStyles, options.warnings, options.name);
  const columnWidthSource = readColumnWidthSource(simple ? metadata : document, options);
  if (!simple && options.styles.length) {
    columnStyles = readColumnStyles(document);
    columnStyle = columnStyleLookup(columnStyles);
  }
  const variableHeight = options.styles.some(style => style.wrap || style.borders || (style.fontSize ?? 0) * 1.3 + 9 > 26)
    || conditionalRules.some(rule => rule.style?.borders);
  const finish = (sheet: ParsedSheet): ParsedSheet => {
    if (merges.length) {
      sheet.merges = merges;
      for (const range of merges) {
        sheet.rowCount = Math.max(sheet.rowCount, range.lastRow);
        sheet.columnCount = Math.max(sheet.columnCount, range.lastColumn);
      }
    }
    sheet.columnCount = Math.min(sheet.columnCount, 16_384);
    sheet.rowCount = Math.min(sheet.rowCount, 1_048_576);
    sheet.columnWidthSource = columnWidthSource;
    sheet.columnWidths = xlsxColumnWidths(sheet.columnCount, columnWidthSource);
    if (options.date1904) sheet.date1904 = true;
    if (conditionalRules.length) sheet.conditionalRules = conditionalRules;
    const measureRows = variableHeight || ((options.hasRichSharedStrings || !simple && /<rPr\b/.test(xml))
      && sheet.rows.some(row => row.cells.some(cell => cell.richText)));
    if (options.styles.length || measureRows) sheet.cellStyles = { formats: options.styles, columns: columnStyles, variableHeight: measureRows };
    return sheet;
  };
  if (simple) return finish(simple);
  const rowEntries = toArray(readPath(document, ['worksheet', 'sheetData', 'row']));
  const rows: ParsedRow[] = [];
  const shared = new SharedFormulaReader();
  let maxColumn = 0;
  let maxRow = 0;

  for (const rowEntry of rowEntries) {
    const rowIndex = Number(readPath(rowEntry, ['r']) ?? rows.length + 1);
    maxRow = Math.max(maxRow, rowIndex);
    const rowStyle = ['1', 'true'].includes(String(readPath(rowEntry, ['customFormat']))) ? readPath(rowEntry, ['s']) : undefined;
    const cells = toArray(readPath(rowEntry, ['c']))
      .map((cellEntry) => {
        const cell = readCell(cellEntry, options, shared);
        if (!cell) return null;
        const index = Number(readPath(cellEntry, ['s']) ?? rowStyle ?? columnStyle(cell.column));
        const font = options.styles[index]?.font;
        if (font) cell.font = font;
        if (options.styles.length && index !== 0) cell.styleIndex = index;
        return cell;
      })
      .filter((cell): cell is ParsedCell => cell != null);
    for (const cell of cells) {
      maxColumn = Math.max(maxColumn, cell.column);
    }
    rows.push({ index: rowIndex, cells, ...(options.styles.length && rowStyle !== undefined ? { styleIndex: Number(rowStyle) } : {}) });
  }

  const sharedFormulas = shared.finish(rows, options.warnings, options.name);
  return finish({
    id: options.id,
    name: options.name,
    rows,
    columnCount: maxColumn,
    rowCount: maxRow,
    ...(sharedFormulas ? { sharedFormulas } : {})
  });
}

function readColumnWidthSource(document: unknown, options: { name: string; warnings: string[]; columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'> }): ParsedColumnWidthSource {
  const ranges: ParsedColumnWidthSource['ranges'][number][] = [];
  let invalid = 0;
  for (const column of toArray(readPath(document, ['worksheet', 'cols', 'col']))) {
    const value = readPath(column, ['width']);
    if (value === undefined) continue;
    const firstColumn = Number(readPath(column, ['min'])), lastColumn = Number(readPath(column, ['max'])), width = Number(value);
    if (!Number.isInteger(firstColumn) || !Number.isInteger(lastColumn) || firstColumn < 1 || firstColumn > lastColumn
      || lastColumn > 16_384 || !Number.isFinite(width * 256) || width <= 0) { invalid++; continue; }
    ranges.push({ firstColumn, lastColumn, width });
  }
  const format = readPath(document, ['worksheet', 'sheetFormatPr']);
  const readWidth = (name: string, allowZero = false) => {
    const value = readPath(format, [name]);
    if (value === undefined) return undefined;
    const width = Number(value);
    if (Number.isFinite(width * 256) && (allowZero ? Number.isInteger(width) && width >= 0 : width > 0)) return width;
    invalid++; return undefined;
  };
  const defaultWidth = readWidth('defaultColWidth'), baseWidth = readWidth('baseColWidth', true);
  if (invalid) options.warnings.push(`Ignored ${invalid} invalid or unsupported column width declaration(s) in sheet ${options.name}.`);
  return { ranges, defaultWidth, baseWidth: baseWidth ?? 8, fontSize: 11, ...options.columnWidthFont };
}

function readMergedRanges(document: unknown, warnings: string[], name: string): ParsedMerge[] {
  const ranges: ParsedMerge[] = [];
  let invalid = 0;
  for (const entry of toArray(readPath(document, ['worksheet', 'mergeCells', 'mergeCell']))) {
    const range = parseSheetRange(String(readPath(entry, ['ref']) ?? '').trim());
    if (range) ranges.push(range);
    else invalid++;
  }
  if (invalid) warnings.push(`Ignored ${invalid} invalid merged range(s) in sheet ${name}.`);
  return ranges;
}

function readColumnStyles(document: unknown): ParsedColumnStyle[] {
  return toArray(readPath(document, ['worksheet', 'cols', 'col'])).map(column => ({
    firstColumn: Number(readPath(column, ['min'])), lastColumn: Number(readPath(column, ['max'])), styleIndex: Number(readPath(column, ['style']) ?? 0)
  }));
}

function readCell(cellEntry: unknown, { sharedStrings, readRichText }: {
  sharedStrings: (string | ParsedRichText)[]; readRichText: ReturnType<typeof createRichTextReader>;
}, shared: SharedFormulaReader): ParsedCell | null {
  if (!cellEntry || typeof cellEntry !== 'object') return null;
  const entry = cellEntry as Record<string, unknown>;
  const ref = String(entry.r ?? '');
  if (!ref) {
    return null;
  }

  const position = parseCellRef(ref);
  const valueType = String(entry.t ?? '');
  const rawValue = entry.v == null ? null : String(entry.v);
  const formula = readTextValue(entry.f);
  let value = rawValue ?? '';
  let parsedType: ParsedCell['valueType'];
  let richText: ParsedRichText | undefined;

  if (valueType === 's' || valueType === 'inlineStr') {
    parsedType = 'text';
    const text = valueType === 'inlineStr' ? readRichText(entry.is) : rawValue?.trim() ? sharedStrings[Number(rawValue)] ?? '' : '';
    if (typeof text === 'string') value = text;
    else { richText = text; value = text.value; }
  } else if (valueType === 'b') {
    parsedType = 'boolean';
    const boolean = rawValue?.trim();
    value = boolean === '1' || boolean === 'true' ? 'TRUE' : 'FALSE';
  } else if (valueType === 'str') {
    parsedType = 'text';
  } else if (valueType === 'e') {
    parsedType = 'error';
  } else if (valueType === 'd') {
    parsedType = 'date';
  }

  const uncached = rawValue == null || (!parsedType && rawValue.trim() === '');
  const isShared = readPath(entry.f, ['t']) === 'shared';
  const cell: ParsedCell = {
    ref,
    row: position.row,
    column: position.column,
    value: uncached && (formula || isShared) ? '' : value,
    ...(parsedType ? { valueType: parsedType } : {}),
    ...(richText && !(uncached && (formula || isShared)) ? { richText } : {}),
    ...(formula ? { formula, needsCalculation: uncached } : {})
  };
  if (isShared) shared.add(entry.f, cell, uncached);
  return cell;
}

function inferCsvSheetName(name: string | undefined): string {
  const baseName = String(name ?? '').split(/[?#]/, 1)[0]?.split(/[\\/]/).pop() ?? '';
  return baseName.replace(/\.[^.]+$/, '') || 'CSV';
}

function normalizeFormat(format: string | undefined): string {
  return String(format ?? '').trim().replace(/^\./, '').toLowerCase();
}

function resolveWorkbookTarget(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}
