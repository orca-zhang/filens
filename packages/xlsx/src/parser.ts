import type { XMLParser, X2jOptions } from 'fast-xml-parser';
import { openZipArchive, type PreviewFontReference, type ZipEntry, type PreviewLoadContext, type PreviewSource } from '@filens/core';
import type { ParsedArrayFormula, ParsedCell, ParsedCellStyle, ParsedColumnStyle, ParsedColumnWidthSource, ParsedConditionalStyle, ParsedDefinedName, ParsedMerge, ParsedRichText, ParsedRow, ParsedRowHeight, ParsedSheet, ParsedTableRange, ParsedTrackRange, ParsedWorkbook } from './types';
import { readSimpleRows, readSimpleWorksheet } from './simple-worksheet';
import { xlsxColumnWidths } from './xlsx-column-widths';
import { xlsxRowHeight } from './xlsx-row-heights';
import { colorReader, readDifferentialStyles, readFontReference, readIndexedColors, readStyleAppearance } from './style-appearance';
import { readConditionalRules } from './conditional-rules';
import { columnStyleLookup } from './column-styles';
import { decodeSpreadsheetText, readLocalPath, readPath, toArray } from './xml-values';
import { decodeTableColumn } from './structured-references';
import { registerWorkbookFormulas } from './cell-value';
import { formulaName, MAX_FORMULA_LENGTH } from './formula-reader';
import { prepareFormulaRegex, regexFormula } from './formula-regex';
import { SharedFormulaReader } from './shared-formulas';
import { createRichTextReader, readTextValue } from './rich-text';
export { resolveCellValue } from './cell-value';
import { columnIndexToName, parseCellRef, parseSheetRange } from './columns';
import { addHiddenTrack } from './visible-tracks';
import { CsvPreviewData, csvPreviewData } from './csv-preview-data';
import { createWorksheetCell } from './worksheet-cell';

const XML_BATCH_CHARS = 512 * 1024;
const xmlPrefix = String.raw`(?:[^ \t\r\n<>"'=:/!?]+:)?`;
const xmlTagTail = String.raw`(?=[ \t\r\n/>])(?:[^<>"']|"[^"<]*"|'[^'<]*')*>`;
const namespaceAlias = /[ \t\r\n]xmlns:[^ \t\r\n<>"'=:/]+\s*=\s*(['"])(?:http:\/\/(?:schemas\.openxmlformats\.org\/spreadsheetml\/2006|purl\.oclc\.org\/ooxml\/spreadsheetml)\/main|[^&'"]*&[^'"]*)\1/;
const rowPath = ['worksheet', 'sheetData', 'row'];
const sharedStringPath = ['sst', 'si'];
const xmlOptions = {
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
    maxTotalExpansions: 100_000,
    maxExpandedLength: 100_000,
    maxEntityCount: 100,
    // Built-in character references produce less text than their source spelling.
    // The runtime supports appliesTo before its X2jOptions declaration does.
    appliesTo: 'external'
  }
} satisfies X2jOptions & { processEntities: { appliesTo: 'external' } };

const spreadsheetNamespaces = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main'
]);
const packageRelationshipNamespace = 'http://schemas.openxmlformats.org/package/2006/relationships';
const extendedNumberFormatNamespace = 'http://schemas.microsoft.com/office/spreadsheetml/2015/02/main';
const officeRelationshipNamespaces = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships'
]);

interface WorkbookXmlParsers {
  parser: XMLParser;
  worksheetMetadataParser: XMLParser;
  namespacedParser: XMLParser;
}

let parserPromise: Promise<WorkbookXmlParsers> | undefined;
function loadXmlParsers() {
  return parserPromise ??= import('fast-xml-parser').then(({ XMLParser }) => {
    const namespaces: (ReadonlyMap<string, string> | undefined)[] = [];
    let legacyUnqualified = false;
    let relationshipPart = false;
    return {
      parser: new XMLParser(xmlOptions),
      worksheetMetadataParser: new XMLParser({ ...xmlOptions, stopNodes: ['worksheet.sheetData'] }),
      namespacedParser: new XMLParser({
        ...xmlOptions,
        jPath: false,
        updateTag(tag, path, attrs) {
          if (typeof path === 'string' || tag.startsWith('?')) return tag;
          const depth = path.getDepth();
          if (!depth) return tag;
          namespaces.length = depth - 1;
          const inherited = namespaces.at(-1);
          let bindings: Map<string, string> | undefined;
          for (const key in attrs) {
            if (key === 'xmlns' || key.startsWith('xmlns:')) {
              (bindings ??= new Map(inherited)).set(key.slice(6), attrs[key]);
            }
          }
          const scope = bindings ?? inherited;
          namespaces.push(scope);
          const separator = tag.indexOf(':');
          const namespace = scope?.get(separator < 0 ? '' : tag.slice(0, separator));
          const local = tag.slice(separator + 1);
          if (depth === 1) {
            legacyUnqualified = separator < 0 && namespace === undefined;
            relationshipPart = local === 'Relationships' && namespace === packageRelationshipNamespace;
          }
          const ownNamespace = namespace === undefined ? legacyUnqualified
            : relationshipPart ? namespace === packageRelationshipNamespace : spreadsheetNamespaces.has(namespace);
          if (ownNamespace && local === 'sheet' && scope) {
            const conventional = scope.get('r');
            if (conventional !== undefined && !officeRelationshipNamespaces.has(conventional)) delete attrs['r:id'];
            for (const key in attrs) {
              if (!key.endsWith(':id')) continue;
              const uri = scope.get(key.slice(0, -3));
              if (uri && officeRelationshipNamespaces.has(uri)) attrs['r:id'] = attrs[key];
            }
          }
          if (ownNamespace && local === 'numFmt' && scope) {
            for (const key in attrs) {
              if (key.endsWith(':formatCode16') && scope.get(key.slice(0, key.indexOf(':'))) === extendedNumberFormatNamespace) {
                attrs.formatCode16 = attrs[key];
                break;
              }
            }
          }
          // Keep extension elements distinct from primary elements with the same local name.
          if (separator < 0) {
            return ownNamespace ? tag : ':' + tag;
          }
          if (!namespace || !ownNamespace) return tag;
          // Renames run after the XML parser has checked the original property name.
          return local in Object.prototype || local === 'prototype' ? tag : local;
        }
      })
    };
  });
}

function parseWorkbookPart(xml: string, { parser, namespacedParser }: WorkbookXmlParsers): Record<string, unknown> {
  return (xml.includes('xmlns:') ? namespacedParser : parser).parse(xml) as Record<string, unknown>;
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
  external?: boolean;
}

export function loadXlsxWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  return readXlsxWorkbook(source, context);
}

export async function readXlsxWorkbook(source: PreviewSource, context?: PreviewLoadContext,
  preview?: { onSheet?: (sheet: ParsedSheet) => void; onRows?: (sheet: ParsedSheet) => void }): Promise<ParsedWorkbook> {
  checkAborted(context?.signal);
  const format = normalizeFormat(context?.route?.sourceFormat ?? context?.descriptor.extension);
  if (format === 'csv') {
    return loadCsvWorkbook(source, context);
  }

  const zip = context?.zipEntries ?? await openZipArchive(
    typeof source === 'string' || source instanceof Blob ? source
      : ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source),
    { signal: context?.signal });
  checkAborted(context?.signal);
  const warnings: string[] = [];
  const workbookXml = await readRequiredText(zip, 'xl/workbook.xml', context?.signal);
  const relsXml = await readRequiredText(zip, 'xl/_rels/workbook.xml.rels', context?.signal);
  const parsers = await loadXmlParsers();
  const { parser } = parsers;
  checkAborted(context?.signal);
  const workbook = parseWorkbookPart(workbookXml, parsers);
  const date1904 = ['1', 'true'].includes(String(readPath(workbook, ['workbook', 'workbookPr', 'date1904'])));
  const relationships = readRelationships(relsXml, parsers);
  const workbookStyles = await readWorkbookStyles(zip, relationships, parsers, context?.signal);
  const readRichText = createRichTextReader(workbookStyles.theme, workbookStyles.color, workbookStyles.fonts);
  const sharedPath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/sharedStrings'))?.target ?? 'sharedStrings.xml');
  const sharedStrings = await readSharedStrings(zip.get(sharedPath), parsers, readRichText, context?.signal);
  const hasRichSharedStrings = sharedStrings.some(value => typeof value !== 'string');
  const sheets = readWorkbookSheets(workbook);
  const definedNames = readDefinedNames(workbook, sheets, warnings);
  let regexPreparation: Promise<void> | undefined;
  const noteRegex = (formula: string) => {
    if (!regexPreparation && regexFormula.test(formula)) regexPreparation = prepareFormulaRegex().then(loaded => {
      if (!loaded) warnings.push('The XLSX regex engine is unavailable. Regex formulas may require saved results.');
    });
  };
  for (const name of definedNames) noteRegex(name.formula);
  const waitForRegex = () => {
    const signal = context?.signal;
    if (!regexPreparation || !signal) return regexPreparation;
    checkAborted(signal);
    return new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('Workbook preview aborted.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      void regexPreparation!.then(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      });
    });
  };

  const parsedSheets: ParsedSheet[] = [];
  let dynamicArrays: Promise<ReadonlySet<number> | undefined> | undefined;
  const loadDynamicArrays = () => dynamicArrays ??= readDynamicArrayMetadata(zip, relationships, parser, context?.signal);
  let lastYield = 0;
  for (const [index, sheet] of sheets.entries()) {
    checkAborted(context?.signal);
    if (!sheet.relationshipId) continue;
    const relationship = relationships.find((entry) => entry.id === sheet.relationshipId);
    if (!relationship) {
      warnings.push(`Missing relationship for sheet ${sheet.name}.`);
      continue;
    }

    const sheetPath = resolveWorkbookTarget(relationship.target);
    let publishedRows = false;
    const onRows = preview?.onRows ? (partial: ParsedSheet) => {
      publishedRows = true;
      preview.onRows!(partial);
    } : undefined;
    const parsed = await readWorksheetEntry(zip.get(sheetPath), {
      id: sheet.sheetId,
      name: sheet.name,
      sharedStrings,
      hasRichSharedStrings,
      readRichText,
      styles: workbookStyles.styles,
      differentialStyles: workbookStyles.differentialStyles,
      color: workbookStyles.color,
      numberFormatPalette: workbookStyles.numberFormatPalette,
      columnWidthFont: workbookStyles.columnWidthFont,
      forPreview: Boolean(preview),
      date1904,
      warnings,
      noteRegex,
      waitForRegex,
      loadDynamicArrays,
      loadTables: ids => readTableParts(zip, sheetPath, ids, parsers, warnings, sheet.name, context?.signal)
    }, parsers, context?.signal, onRows);
    checkAborted(context?.signal);
    if (!parsed) {
      warnings.push(`Missing worksheet file for sheet ${sheet.name}.`);
      continue;
    }
    parsedSheets.push(parsed);
    if (preview?.onSheet && (sheets.length > 1 || publishedRows)) {
      preview.onSheet(parsed);
      if (index + 1 < sheets.length && (parsedSheets.length === 1 || performance.now() - lastYield >= 16)) {
        await yieldWorksheetPreview();
        lastYield = performance.now();
      }
    }
  }

  const parsed = {
    sheets: parsedSheets,
    warnings,
    fonts: workbookStyles.fonts,
    ...(definedNames.length ? { definedNames } : {})
  };
  await waitForRegex();
  checkAborted(context?.signal);
  registerWorkbookFormulas(parsed);
  return parsed;
}

function yieldWorksheetPreview(): Promise<void> {
  return new Promise(resolve => {
    // Let the first sheet paint without relying on an animation frame in a hidden tab.
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { port1.close(); port2.close(); resolve(); };
    port2.postMessage(null);
  });
}

const CSV_READ_BYTES = 256 * 1024;

export function loadCsvWorkbook(source: PreviewSource, context?: PreviewLoadContext): Promise<ParsedWorkbook> {
  return readCsvWorkbook(source, context);
}

export async function readCsvWorkbook(source: PreviewSource, context?: PreviewLoadContext,
  onRows?: (sheet: ParsedSheet) => void): Promise<ParsedWorkbook> {
  const signal = context?.signal;
  checkAborted(signal);
  const preview = onRows ? new CsvPreviewData() : undefined;
  const csv = createCsvReader(preview);
  const decoder = new TextDecoder();
  const name = inferCsvSheetName(context?.descriptor.name);
  const currentSheet = (): ParsedSheet => {
    const sheet = { id: 'csv', name, rows: csv.rows, columnCount: csv.columnCount, rowCount: csv.rowCount };
    if (preview) csvPreviewData.set(sheet, preview);
    return sheet;
  };
  const writeText = (text: string) => {
    checkAborted(signal);
    csv.write(text);
  };
  const writeBytes = (bytes: Uint8Array) => {
    checkAborted(signal);
    for (let start = 0; start < bytes.length; start += CSV_READ_BYTES) {
      csv.write(decoder.decode(bytes.subarray(start, start + CSV_READ_BYTES), { stream: true }));
    }
  };
  let reportedRows = 0;
  const writeChunk = (bytes: Uint8Array) => {
    writeBytes(bytes);
    if (onRows && csv.rowCount > reportedRows) {
      reportedRows = csv.rowCount;
      onRows(currentSheet());
    }
  };
  if (typeof source === 'string') {
    if (source.trimStart().slice(0, 5).toLowerCase() === 'data:') {
      writeText(readDataUrlText(source));
    } else {
      const response = await fetch(source, { signal });
      checkAborted(signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw Object.assign(new Error(`Failed to load CSV source: ${response.status} ${response.statusText}`.trim()), {
          name: 'CsvSourceHttpError', status: response.status
        });
      }
      if (response.body?.getReader) await readCsvResponse(response.body, writeChunk, signal);
      else writeText(await response.text());
    }
  } else if (source instanceof Blob) {
    if (source.size <= CSV_READ_BYTES) writeText(await source.text());
    else {
      for (let start = 0; start < source.size; start += CSV_READ_BYTES) {
        checkAborted(signal);
        writeChunk(new Uint8Array(await source.slice(start, start + CSV_READ_BYTES).arrayBuffer()));
      }
    }
  } else if (ArrayBuffer.isView(source)) {
    writeBytes(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  } else if (source instanceof ArrayBuffer) {
    writeBytes(new Uint8Array(source));
  } else {
    csv.write(String(source));
  }
  checkAborted(signal);
  csv.write(decoder.decode());
  csv.finish();
  preview?.finishBlock();
  return { sheets: [currentSheet()], warnings: [] };
}

async function readCsvResponse(body: ReadableStream<Uint8Array>, write: (bytes: Uint8Array) => void, signal?: AbortSignal) {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  let lastYield = signal ? performance.now() : 0;
  try {
    for (;;) {
      checkAborted(signal);
      const { value, done } = await reader.read();
      checkAborted(signal);
      if (done) break;
      write(value);
      if (signal && performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
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

function createCsvReader(preview?: CsvPreviewData) {
  const rows: ParsedRow[] = [];
  const columnNames: string[] = [];
  const parts: string[] = [];
  const fieldEnd = /[,\r\n]/g;
  let row: string[] = [];
  let state: 'start' | 'unquoted' | 'quoted' | 'quote' = 'start';
  let first = true, skipLf = false, recordStarted = false;
  let rowCount = 0, columnCount = 0;

  const appendRow = (record: string[]) => {
    const row = ++rowCount;
    columnCount = Math.max(columnCount, record.length);
    if (preview) {
      preview.appendRow(record);
      return;
    }
    while (columnNames.length < record.length) columnNames.push(columnIndexToName(columnNames.length + 1));
    const suffix = String(row);
    const cells: ParsedCell[] = new Array(record.length);
    for (let column = 0; column < record.length; column++) {
      cells[column] = { ref: columnNames[column] + suffix, row, column: column + 1, value: record[column] };
    }
    rows.push({ index: row, cells });
  };
  return {
    rows,
    get rowCount() { return rowCount; },
    get columnCount() { return columnCount; },
    write(text: string) {
      if (!text.length) return;
      let index = first && text[0] === '\uFEFF' ? 1 : 0;
      first = false;
      let start = index;
      while (index < text.length) {
        const char = text[index];
        if (skipLf) {
          skipLf = false;
          if (char === '\n') { start = ++index; continue; }
        }
        // A quote can close a field or begin an escape split across two reads.
        if (state === 'quote') {
          if (char === '"') {
            parts.push('"');
            state = 'quoted';
            start = ++index;
            continue;
          }
          state = 'unquoted';
        }
        if (state === 'quoted') {
          const quote = text.indexOf('"', index);
          if (quote < 0) break;
          if (quote > start) parts.push(text.slice(start, quote));
          state = 'quote';
          start = index = quote + 1;
          continue;
        }
        recordStarted = true;
        if (state === 'start' && char === '"') {
          state = 'quoted';
          start = ++index;
          continue;
        }
        if (char === ',' || char === '\r' || char === '\n') {
          const tail = text.slice(start, index);
          row.push(parts.length ? parts.join('') + tail : tail);
          parts.length = 0;
          state = 'start';
          start = ++index;
          if (char !== ',') {
            appendRow(row);
            row = [];
            recordStarted = false;
            skipLf = char === '\r';
          }
        } else {
          state = 'unquoted';
          fieldEnd.lastIndex = index + 1;
          index = fieldEnd.test(text) ? fieldEnd.lastIndex - 1 : text.length;
        }
      }
      if (start < text.length) parts.push(text.slice(start));
    },
    finish() {
      if (recordStarted || !rowCount) {
        row.push(parts.join(''));
        appendRow(row);
      }
    }
  };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Workbook preview aborted.', 'AbortError');
}

const zipTextDecoder = new TextDecoder();

async function readZipText(file: ZipEntry | undefined, signal?: AbortSignal): Promise<string | undefined> {
  checkAborted(signal);
  if (!file) return undefined;
  const bytes = await file.bytes(undefined, signal);
  checkAborted(signal);
  return zipTextDecoder.decode(bytes);
}

async function readRequiredText(zip: ReadonlyMap<string, ZipEntry>, path: string, signal?: AbortSignal): Promise<string> {
  const xml = await readZipText(zip.get(path), signal);
  if (xml === undefined) throw new Error(`Invalid XLSX file: missing ${path}.`);
  return xml;
}

const sharedStringOpening = new RegExp(String.raw`^[ \t\r\n]*(?:<\?xml[ \t\r\n][^?]*\?>[ \t\r\n]*)?<(${xmlPrefix}sst)${xmlTagTail}`);
const sharedStringClosing = new RegExp(String.raw`^[ \t\r\n]*</(${xmlPrefix}sst)[ \t\r\n]*>[ \t\r\n]*$`);
const plainSharedStringStart = /\s*<si\s*>\s*<t(?:\s+xml:space\s*=\s*(?:"(?:preserve|default)"|'(?:preserve|default)'))?\s*>/y;
const plainSharedStringEnd = /<\/t\s*>\s*<\/si\s*>/y;

function appendSharedStringBatch(xml: string, values: (string | ParsedRichText)[], parser: XMLParser,
  readRichText: ReturnType<typeof createRichTextReader>, opening = '<sst>', closing = '</sst>'): void {
  // Force V8 to flatten this batch separately before keeping its text slices.
  const batchXml = '\n' + xml;
  const start = values.length;
  let offset = 0;
  while (opening === '<sst>' && offset < batchXml.length) {
    plainSharedStringStart.lastIndex = offset;
    if (!plainSharedStringStart.test(batchXml)) break;
    const begin = plainSharedStringStart.lastIndex, end = batchXml.indexOf('<', begin);
    if (end < 0) break;
    plainSharedStringEnd.lastIndex = end;
    if (!plainSharedStringEnd.test(batchXml)) break;
    const value = batchXml.slice(begin, end);
    if (/[&\r>]/.test(value)) break;
    values.push(decodeSpreadsheetText(value));
    offset = plainSharedStringEnd.lastIndex;
  }
  if (offset === batchXml.length) return;
  values.length = start;
  const batch = parser.parse(opening + xml + closing);
  for (const item of toArray(readPath(batch, sharedStringPath))) values.push(readRichText(item));
}

async function readSharedStrings(file: ZipEntry | undefined, parsers: WorkbookXmlParsers,
  readRichText: ReturnType<typeof createRichTextReader>,
  signal?: AbortSignal): Promise<(string | ParsedRichText)[]> {
  checkAborted(signal);
  if (!file) return [];
  const chunks = file.chunks?.(signal);
  if (chunks) {
    // A late fallback must discard fonts found in the partial table as well as strings.
    const discardFonts = readRichText.checkpoint();
    const values = await readStreamedSharedStrings(chunks, parsers, readRichText, signal);
    if (values) return values;
    discardFonts();
  }
  const xml = await readZipText(file, signal);
  if (xml === undefined) return [];
  if (!chunks && canBatchXml(xml)) {
    const discardFonts = readRichText.checkpoint();
    const values = await readStreamedSharedStrings(xmlTextBlocks(xml), parsers, readRichText, signal);
    if (values) return values;
    discardFonts();
  }
  return toArray(readPath(parseWorkbookPart(xml, parsers), sharedStringPath)).map(readRichText);
}

async function readStreamedSharedStrings(chunks: AsyncIterable<Uint8Array> | Iterable<string>,
  { parser, namespacedParser }: WorkbookXmlParsers,
  readRichText: ReturnType<typeof createRichTextReader>, signal?: AbortSignal): Promise<(string | ParsedRichText)[] | undefined> {
  const decoder = new TextDecoder();
  const childEnd = xmlChildEnd('si');
  let qualifiedChildEnd: ReturnType<typeof xmlChildEnd> | undefined;
  const values: (string | ParsedRichText)[] = [];
  let pending = '', opening = '', closing = '', tag = '', rootHasAliases = false;
  let lastYield = signal ? performance.now() : 0;
  function readBatch(final: boolean): boolean {
    if (pending.includes('<!')) return false;
    if (!opening) {
      const root = sharedStringOpening.exec(pending);
      if (!root || root[0].endsWith('/>') || root[0].length > XML_BATCH_CHARS) return false;
      [opening, tag] = root;
      closing = `</${tag}>`;
      rootHasAliases = tag !== 'sst' || namespaceAlias.test(opening);
      const metadata = (rootHasAliases ? namespacedParser : parser).parse(opening + closing);
      if (readPath(metadata, ['sst']) === undefined || readPath(metadata, sharedStringPath) !== undefined) return false;
      pending = pending.slice(opening.length);
    }
    if (pending.includes('<?')) return false;
    const namespaced = rootHasAliases || namespaceAlias.test(pending);
    const offset = xmlBatchEnd(pending, namespaced ? qualifiedChildEnd ??= xmlChildEnd('si', true) : childEnd);
    if (offset) {
      const batch = pending.slice(0, offset);
      if (namespaced) appendSharedStringBatch(batch, values, namespacedParser, readRichText, opening, closing);
      else appendSharedStringBatch(batch, values, parser, readRichText);
      pending = pending.slice(offset);
    }
    if (final) return sharedStringClosing.exec(pending)?.[1] === tag;
    return offset > 0 || pending.length < XML_BATCH_CHARS;
  }
  for await (const chunk of chunks) {
    checkAborted(signal);
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    while (pending.length >= XML_BATCH_CHARS) {
      if (!readBatch(false)) return undefined;
      if (signal && performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        checkAborted(signal);
        lastYield = performance.now();
      }
    }
  }
  checkAborted(signal);
  pending += decoder.decode();
  return readBatch(true) ? values : undefined;
}

function readRelationships(xml: string, parsers: WorkbookXmlParsers): RelationshipRef[] {
  const document = parseWorkbookPart(xml, parsers);
  return toArray(readPath(document, ['Relationships', 'Relationship']))
    .map((relationship) => ({
      id: String(readPath(relationship, ['Id']) ?? ''),
      target: String(readPath(relationship, ['Target']) ?? ''),
      type: String(readPath(relationship, ['Type']) ?? ''),
      external: readPath(relationship, ['TargetMode']) === 'External'
    }))
    .filter((relationship) => relationship.id && relationship.target);
}

async function readDynamicArrayMetadata(zip: ReadonlyMap<string, ZipEntry>, relationships: readonly RelationshipRef[],
  parser: XMLParser, signal?: AbortSignal): Promise<ReadonlySet<number> | undefined> {
  const relation = relationships.find(rel => !rel.external && rel.type?.endsWith('/sheetMetadata'));
  if (!relation) return undefined;
  try {
    const xml = await readZipText(zip.get(resolveWorkbookTarget(relation.target)), signal);
    if (!xml) return undefined;
    const metadata = readLocalPath(parser.parse(xml, true), ['metadata']);
    const types = toArray(readLocalPath(metadata, ['metadataTypes', 'metadataType']));
    const future = toArray(readLocalPath(metadata, ['futureMetadata'])).find(group => readLocalPath(group, ['name']) === 'XLDAPR');
    if (!future) return undefined;
    const dynamic = toArray(readLocalPath(future, ['bk'])).map(block =>
      toArray(readLocalPath(block, ['extLst', 'ext'])).some(extension =>
        xmlTrue(readLocalPath(extension, ['dynamicArrayProperties', 'fDynamic']))));
    const indexes = new Set<number>();
    for (const [index, block] of toArray(readLocalPath(metadata, ['cellMetadata', 'bk'])).entries()) {
      const found = toArray(readLocalPath(block, ['rc'])).some(record => {
        const type = Number(readLocalPath(record, ['t'])), value = Number(readLocalPath(record, ['v']));
        return readLocalPath(types[type - 1], ['name']) === 'XLDAPR' && dynamic[value];
      });
      // The worksheet cm and record t attributes are one-based. The future metadata v is zero-based.
      if (found) indexes.add(index + 1);
    }
    return indexes;
  } catch {
    checkAborted(signal);
    return undefined;
  }
}

async function readTableParts(zip: ReadonlyMap<string, ZipEntry>, sheetPath: string, ids: readonly string[],
  parsers: WorkbookXmlParsers, warnings: string[], sheetName: string, signal?: AbortSignal): Promise<ParsedTableRange[]> {
  const split = sheetPath.lastIndexOf('/') + 1;
  const relsPath = `${sheetPath.slice(0, split)}_rels/${sheetPath.slice(split)}.rels`;
  const relationships = new Map<string, RelationshipRef | null>();
  try {
    const xml = await readZipText(zip.get(relsPath), signal);
    if (xml) for (const rel of readRelationships(xml, parsers)) relationships.set(rel.id, relationships.has(rel.id) ? null : rel);
  } catch { checkAborted(signal); }
  const tables: ParsedTableRange[] = [];
  for (const id of new Set(ids)) {
    const relationship = relationships.get(id);
    const target = relationship?.target.replace(/\\/g, '/');
    const part = target && !relationship?.external && relationship?.type?.endsWith('/table')
      && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) ? zip.get(resolveSheetTarget(sheetPath, target)) : undefined;
    let table: ParsedTableRange | undefined;
    try {
      const source = await readZipText(part, signal);
      if (source) table = readTablePart(source, parsers.parser);
    } catch { checkAborted(signal); }
    if (table) tables.push(table);
    else warnings.push(`Ignored invalid table part ${id} in sheet ${sheetName}.`);
  }
  return tables;
}

function resolveSheetTarget(sheetPath: string, target: string): string {
  const parts = target.startsWith('/') ? [] : sheetPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function readTablePart(xml: string, parser: XMLParser): ParsedTableRange | undefined {
  let table: unknown;
  try { table = readLocalPath(parser.parse(xml, true), ['table']); }
  catch { return undefined; }
  const name = String(readPath(table, ['displayName']) ?? readPath(table, ['name']) ?? '');
  const range = parseSheetRange(String(readPath(table, ['ref']) ?? ''));
  if (!range || !formulaName.test(name)) return undefined;
  const headerRows = Number(readPath(table, ['headerRowCount']) ?? 1);
  const totalRows = Number(readPath(table, ['totalsRowCount']) ?? 0);
  if (!Number.isSafeInteger(headerRows) || !Number.isSafeInteger(totalRows) || headerRows < 0 || totalRows < 0
    || headerRows + totalRows > range.lastRow - range.firstRow + 1) return undefined;
  const columns = toArray(readLocalPath(table, ['tableColumns', 'tableColumn']))
    .map(column => decodeTableColumn(String(readPath(column, ['name']) ?? '')));
  if (columns.length !== range.lastColumn - range.firstColumn + 1 || columns.some(column => !column)
    || new Set(columns.map(column => column.toLowerCase())).size !== columns.length) return undefined;
  const autoFilterRows = readActiveFilterRows(table);
  return { name, ...range, headerRows, totalRows, columns, ...(autoFilterRows ? { autoFilterRows } : {}) };
}

function readActiveFilterRows(document: unknown): ParsedTrackRange | undefined {
  const filter = readLocalPath(document, ['autoFilter']);
  const active = toArray(readLocalPath(filter, ['filterColumn'])).some(column =>
    ['filters', 'customFilters', 'dynamicFilter', 'top10', 'colorFilter', 'iconFilter']
      .some(key => readLocalPath(column, [key]) !== undefined));
  const range = active && parseSheetRange(String(readPath(filter, ['ref']) ?? ''));
  if (range && range.firstRow < range.lastRow) return { first: range.firstRow + 1, last: range.lastRow };
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

async function readWorkbookStyles(zip: ReadonlyMap<string, ZipEntry>, relationships: RelationshipRef[], parsers: WorkbookXmlParsers, signal?: AbortSignal): Promise<{
  fonts: PreviewFontReference[]; styles: ParsedCellStyle[];
  differentialStyles: ParsedConditionalStyle[];
  columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'>;
  theme: unknown; color: ReturnType<typeof colorReader>; numberFormatPalette?: ParsedSheet['numberFormatPalette'];
}> {
  const stylePath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/styles'))?.target ?? 'styles.xml');
  const xml = await readZipText(zip.get(stylePath), signal);
  const themePath = resolveWorkbookTarget(relationships.find(rel => rel.type?.endsWith('/theme'))?.target ?? 'theme/theme1.xml');
  const themeXml = await readZipText(zip.get(themePath), signal);
  const theme = themeXml ? parsers.parser.parse(themeXml) : undefined;
  const styles = xml ? parseWorkbookPart(xml, parsers) : undefined;
  const styleSheet = readPath(styles, ['styleSheet']);
  const indexedColors = readIndexedColors(styleSheet);
  const color = colorReader(indexedColors, theme);
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
    ...(indexedColors.length ? { numberFormatPalette: Object.freeze(indexedColors.slice(0, 64)) } : {}),
    columnWidthFont: { font: fonts[normalFontId], fontSize: Number.isFinite(normalSize) && normalSize > 0 ? normalSize : 11 },
    styles: readStyleAppearance(styleSheet, color, fontEntries, fonts, bases, cells),
    differentialStyles: readDifferentialStyles(styleSheet, color)
  };
}

interface WorksheetOptions {
  id: string;
  name: string;
  sharedStrings: (string | ParsedRichText)[];
  hasRichSharedStrings: boolean;
  forPreview: boolean;
  readRichText: ReturnType<typeof createRichTextReader>;
  styles: ParsedCellStyle[];
  differentialStyles: ParsedConditionalStyle[];
  color: ReturnType<typeof colorReader>;
  numberFormatPalette?: ParsedSheet['numberFormatPalette'];
  columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'>;
  date1904: boolean;
  warnings: string[];
  noteRegex(formula: string): void;
  waitForRegex(): Promise<void> | undefined;
  loadDynamicArrays(): Promise<ReadonlySet<number> | undefined>;
  loadTables(ids: readonly string[]): Promise<ParsedTableRange[]>;
}

const worksheetOpening = new RegExp(`<(${xmlPrefix}worksheet)${xmlTagTail}`);
const sheetDataOpening = new RegExp(`<(${xmlPrefix}sheetData)${xmlTagTail}`);
const sheetDataClosing = new RegExp(`^[ \\t\\r\\n]*</(${xmlPrefix}sheetData)[ \\t\\r\\n]*>`);
const sheetDataEnd = new RegExp(`</${xmlPrefix}sheetData[ \\t\\r\\n]*>`);
const worksheetEnd = new RegExp(`</${xmlPrefix}worksheet[ \\t\\r\\n]*>[ \\t\\r\\n]*$`);
const lateWorksheetMetadata = new RegExp(`<${xmlPrefix}(?:sheetData|cols|sheetFormatPr)\\b`);
const inlineFormatting = new RegExp(`<${xmlPrefix}rPr\\b`);
// These spellings are accepted by the direct value reader but can differ under general XML parsing.
const ambiguousSimpleRows = /<v\s*(?:\/>|>[^<]*\r)|<(?:row|c)\b[^<>]*\b(?:c|v|f|is)\s*=/;

function* xmlTextBlocks(xml: string): Generator<string> {
  for (let offset = 0; offset < xml.length; offset += XML_BATCH_CHARS) yield xml.slice(offset, offset + XML_BATCH_CHARS);
}

async function readStreamedWorksheet(chunks: AsyncIterable<Uint8Array> | Iterable<string>, options: WorksheetOptions,
  { parser, namespacedParser }: WorkbookXmlParsers, signal?: AbortSignal,
  onRows?: (sheet: ParsedSheet) => void): Promise<ParsedSheet | undefined> {
  const decoder = new TextDecoder();
  const childEnd = xmlChildEnd('row');
  let qualifiedChildEnd: ReturnType<typeof xmlChildEnd> | undefined;
  let rows: ReturnType<typeof createWorksheetRows> | undefined;
  let columnStyles: ParsedColumnStyle[] = [], columnStyle: (column: number) => number;
  let headerMetadata: object | undefined;
  let header = '', pending = '', closed = false, simple = false, ambiguous = false, inline = false, general = false, styled = false;
  let sheetDataTag = '', batchHeader = '', batchFooter = '', headerHasAliases = false;
  let publishedRowCount = 0, nextRowUpdate = 1;
  let lastYield = signal ? performance.now() : 0;

  function readBatch(final: boolean): boolean {
    if (pending.includes('<!')) return false;
    if (!rows) {
      const opening = sheetDataOpening.exec(pending);
      if (!opening || opening[0].endsWith('/>')) return false;
      const end = opening.index + opening[0].length;
      if (end > XML_BATCH_CHARS) return false;
      header = pending.slice(0, end);
      const root = worksheetOpening.exec(header);
      if (!root || root.index >= opening.index) return false;
      const rootTag = root[1];
      sheetDataTag = opening[1];
      batchHeader = root[0] + opening[0];
      batchFooter = `</${sheetDataTag}></${rootTag}>`;
      headerHasAliases = rootTag !== 'worksheet' || sheetDataTag !== 'sheetData' || namespaceAlias.test(header);
      const xml = header + batchFooter;
      const document = worksheetMetadata(xml, headerHasAliases ? namespacedParser : parser);
      if (!document) return false;
      if (onRows) headerMetadata = document;
      columnStyles = options.styles.length ? readColumnStyles(document) : [];
      columnStyle = columnStyleLookup(columnStyles);
      rows = createWorksheetRows(options, columnStyle);
      simple = !headerHasAliases && Boolean(readSimpleWorksheet(xml, { ...options, columnStyle }));
      pending = pending.slice(end);
    }
    if (closed) return true;
    if (pending.includes('<?')) return false;
    const namespaced = headerHasAliases || namespaceAlias.test(pending);
    const offset = xmlBatchEnd(pending, namespaced ? qualifiedChildEnd ??= xmlChildEnd('row', true) : childEnd);
    if (offset) {
      const batch = pending.slice(0, offset);
      pending = pending.slice(offset);
      const direct = simple && !namespaced
        ? readSimpleRows(batch, { ...options, columnStyle, allowInline: true }, rows.lastRow) : undefined;
      if (direct) {
        ambiguous ||= ambiguousSimpleRows.test(batch);
        inline ||= /<is\b/.test(batch);
        // Mixed and inline worksheets use the general parser's value semantics.
        if (ambiguous && (inline || general)) return false;
        rows.append(direct);
      } else {
        if (ambiguous) return false;
        general = true;
        styled ||= inlineFormatting.test(batch);
        let document: unknown;
        try {
          document = namespaced ? namespacedParser.parse(batchHeader + batch + batchFooter)
            : parser.parse('<worksheet><sheetData>' + batch + '</sheetData></worksheet>');
        }
        catch { return false; }
        rows.read(toArray(readPath(document, rowPath)));
      }
    }
    const closing = sheetDataClosing.exec(pending);
    if (closing) {
      if (closing[1] !== sheetDataTag) return false;
      if (ambiguous && !closing[0].endsWith('</sheetData>')) return false;
      pending = pending.slice(closing[0].length);
      closed = true;
    }
    return closed || (!final && (offset > 0 || pending.length < XML_BATCH_CHARS));
  }

  for await (const chunk of chunks) {
    checkAborted(signal);
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    while (!closed && (pending.length >= XML_BATCH_CHARS || (onRows && sheetDataEnd.test(pending)))) {
      const before = pending.length;
      if (!readBatch(false) || (!closed && pending.length === before)) return undefined;
      if (onRows && headerMetadata && rows && (closed
        ? rows.count > publishedRowCount && !worksheetEnd.test(pending) : rows.count >= nextRowUpdate)) {
        const first = publishedRowCount === 0;
        publishedRowCount = rows.count;
        // Geometric snapshots keep the total number of copied row references linear.
        nextRowUpdate = rows.count + Math.ceil(rows.count / 4);
        const finish = finishWorksheet(headerMetadata, headerMetadata, columnStyles, { ...options, warnings: [] }, styled);
        const partial = await finish(rows.snapshot());
        checkAborted(signal);
        onRows(partial);
        if (first) {
          await yieldWorksheetPreview();
          checkAborted(signal);
          lastYield = performance.now();
        }
      }
      if (signal && performance.now() - lastYield >= 16) {
        await new Promise(resolve => setTimeout(resolve, 0));
        checkAborted(signal);
        lastYield = performance.now();
      }
    }
    // Trailing XML shares the ZIP entry's expansion limit. Yield while retaining it so rows stay available during the remaining reads.
    if (closed && signal && performance.now() - lastYield >= 16) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkAborted(signal);
      lastYield = performance.now();
    }
  }
  checkAborted(signal);
  pending += decoder.decode();
  if (!readBatch(true) || !rows || lateWorksheetMetadata.test(pending)) return undefined;
  const metadata = worksheetMetadata(header + `</${sheetDataTag}>` + pending,
    headerHasAliases || namespaceAlias.test(pending) ? namespacedParser : parser);
  if (!metadata) return undefined;
  const finish = finishWorksheet(metadata, metadata, columnStyles, options,
    general && (styled || inlineFormatting.test(header) || inlineFormatting.test(pending)));
  return finish(await rows.finish());
}

function worksheetMetadata(xml: string, parser: XMLParser): object | undefined {
  try {
    const document = parser.parse(xml, true);
    const sheetData = readPath(document, ['worksheet', 'sheetData']);
    if (sheetData !== undefined && !Array.isArray(sheetData) && readPath(sheetData, ['row']) === undefined) return document;
  } catch { /* Preserve the original parser for unsupported XML framing. */ }
  return undefined;
}

async function readWorksheetEntry(file: ZipEntry | undefined, options: WorksheetOptions,
  parsers: WorkbookXmlParsers, signal?: AbortSignal,
  onRows?: (sheet: ParsedSheet) => void): Promise<ParsedSheet | undefined> {
  const chunks = file?.chunks?.(signal);
  if (chunks) {
    // Unsupported framing can appear after a batch has already registered inline fonts.
    const discardFonts = options.readRichText.checkpoint();
    const sheet = await readStreamedWorksheet(chunks, options, parsers, signal, onRows);
    if (sheet) return sheet;
    discardFonts();
  }
  const xml = await readZipText(file, signal);
  if (!xml) return undefined;
  const root = worksheetOpening.exec(xml);
  const namespaced = Boolean(root && root[1] !== 'worksheet') || namespaceAlias.test(xml);
  if (namespaced && !chunks && canBatchXml(xml)) {
    const discardFonts = options.readRichText.checkpoint();
    const sheet = await readStreamedWorksheet(xmlTextBlocks(xml), options, parsers, signal);
    if (sheet) return sheet;
    discardFonts();
  }
  return readWorksheet(xml, options, parsers, namespaced, signal);
}

async function readWorksheet(xml: string, options: WorksheetOptions,
  parsers: WorkbookXmlParsers, namespaced: boolean, signal?: AbortSignal
): Promise<ParsedSheet> {
  const { worksheetMetadataParser } = parsers;
  const parser = namespaced ? parsers.namespacedParser : parsers.parser;
  let metadata: unknown;
  const hasColumnMetadata = /<(?:cols|sheetFormatPr)\b/.test(xml);
  if (!namespaced && hasColumnMetadata && !xml.includes('<!')) {
    const dataStart = /<sheetData\b/.exec(xml)?.index;
    if (dataStart !== undefined && xml.lastIndexOf('<cols') < dataStart && xml.lastIndexOf('<sheetFormatPr') < dataStart) {
      // Parse only metadata with the existing XML parser, without creating an
      // intermediate XML object tree for every numeric/shared-string cell.
      metadata = parser.parse(xml.slice(0, dataStart) + '</worksheet>');
    }
  }
  let columnStyles = options.styles.length ? readColumnStyles(metadata) : [];
  const simple = namespaced || (hasColumnMetadata && !metadata) ? undefined
    : readSimpleWorksheet(xml, { ...options, columnStyle: columnStyleLookup(columnStyles) });
  let batchedDocument: unknown;
  if (!namespaced && !simple && canBatchXml(xml)) {
    try { batchedDocument = worksheetMetadataParser.parse(xml); }
    catch { /* Let the usual parser handle malformed worksheet structure. */ }
  }
  const rowXml = readTextValue(readPath(batchedDocument, ['worksheet', 'sheetData']));
  const batches = rowXml.length >= XML_BATCH_CHARS ? await worksheetRowBatchEnds(rowXml, signal) : undefined;
  // Keep worksheet metadata in its source structure while leaving fast-path rows out of the XML tree.
  const dataStart = simple ? /<sheetData\b/.exec(xml)!.index : 0;
  const dataEnd = simple ? xml.indexOf('</sheetData>', dataStart) + '</sheetData>'.length : 0;
  const document = batches ? batchedDocument : parser.parse(simple ? xml.slice(0, dataStart) + xml.slice(dataEnd) : xml);
  if (!simple && options.styles.length) columnStyles = readColumnStyles(document);
  const finish = finishWorksheet(document, simple ? metadata : document, columnStyles, options, !simple && inlineFormatting.test(xml));
  if (simple) return finish(simple);
  const rowGroups = batches ? readXmlBatches(rowXml, batches, parser, rowPath) : [toArray(readPath(document, rowPath))];
  const rows = createWorksheetRows(options, columnStyleLookup(columnStyles));
  let lastYield = signal && batches ? performance.now() : 0;
  for (const rowEntries of rowGroups) {
    rows.read(rowEntries);
    if (signal && batches && performance.now() - lastYield >= 16) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkAborted(signal);
      lastYield = performance.now();
    }
  }
  return finish(await rows.finish());
}

function finishWorksheet(document: unknown, layout: unknown, columnStyles: ParsedColumnStyle[],
  options: WorksheetOptions, hasInlineFormatting: boolean): (sheet: ParsedSheet) => Promise<ParsedSheet> {
  const merges = readMergedRanges(document, options.warnings, options.name);
  const conditionalRules = readConditionalRules(document, options.differentialStyles, options.color, options.warnings, options.name, options.forPreview);
  for (const { condition, activeFormula } of conditionalRules) {
    if (activeFormula) options.noteRegex(activeFormula);
    if ('formula' in condition) options.noteRegex(condition.formula);
    if ('formulas' in condition) for (const formula of condition.formulas) options.noteRegex(formula);
    if ('thresholds' in condition) for (const threshold of condition.thresholds) {
      if (threshold.type === 'formula') options.noteRegex(threshold.formula);
    }
  }
  const columnWidthSource = readColumnWidthSource(layout, options);
  const sheetView = toArray(readPath(document, ['worksheet', 'sheetViews', 'sheetView']))[0];
  const showFormulas = xmlTrue(readPath(sheetView, ['showFormulas']));
  const sheetFormat = readPath(layout, ['worksheet', 'sheetFormatPr']);
  const hideUnusedRows = xmlTrue(readPath(sheetFormat, ['zeroHeight']));
  const defaultRowHeight = xlsxRowHeight(readPath(sheetFormat, ['defaultRowHeight']), readPath(sheetFormat, ['customHeight']));
  const variableHeight = options.styles.some(style => style.wrap || style.textRotation || style.borders || (style.fontSize ?? 0) * 1.3 + 9 > 26)
    || conditionalRules.some(rule => rule.style?.borders);
  const tableIds = toArray(readLocalPath(document, ['worksheet', 'tableParts', 'tablePart']))
    .map(part => readLocalPath(part, ['id'])).filter((id): id is string => typeof id === 'string' && Boolean(id));
  const autoFilterRows = readActiveFilterRows(readLocalPath(document, ['worksheet']));
  return async sheet => {
    await options.waitForRegex();
    if (tableIds.length) {
      const tables = await options.loadTables(tableIds);
      if (tables.length) sheet.tables = tables;
    }
    if (autoFilterRows) sheet.autoFilterRows = autoFilterRows;
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
    sheet.columnWidths = xlsxColumnWidths(sheet.columnCount, columnWidthSource, undefined, showFormulas);
    if (showFormulas) sheet.showFormulas = true;
    if (defaultRowHeight && defaultRowHeight.height !== 0 && (defaultRowHeight.height !== undefined || defaultRowHeight.fixed)) {
      sheet.rowHeightSource = { ...defaultRowHeight, rows: sheet.rowHeightSource?.rows ?? new Map() };
    }
    const hiddenColumns = readHiddenColumns(layout);
    if (hiddenColumns) sheet.hiddenColumns = hiddenColumns;
    if (hideUnusedRows) hideUnstoredRows(sheet);
    if (options.date1904) sheet.date1904 = true;
    if (options.numberFormatPalette) sheet.numberFormatPalette = options.numberFormatPalette;
    if (conditionalRules.length) sheet.conditionalRules = conditionalRules;
    const measureRows = variableHeight || ((options.hasRichSharedStrings || hasInlineFormatting)
      && sheet.rows.some(row => row.cells.some(cell => cell.richText)));
    if (options.styles.length || measureRows) sheet.cellStyles = { formats: options.styles, columns: columnStyles, variableHeight: measureRows };
    return sheet;
  };
}

function createWorksheetRows(options: WorksheetOptions, columnStyle: (column: number) => number) {
  const rows: ParsedRow[] = [];
  const hiddenRows: ParsedTrackRange[] = [];
  const heights = new Map<number, ParsedRowHeight>();
  const shared = new SharedFormulaReader();
  const declaredArrays: { range: ParsedMerge; metadataIndex?: number }[] = [];
  let maxColumn = 0;
  let maxRow = 0;

  function sheet(copy = false): ParsedSheet {
    return {
      id: options.id, name: options.name, rows: copy ? rows.slice() : rows, columnCount: maxColumn, rowCount: maxRow,
      ...(hiddenRows.length ? { hiddenRows: copy ? hiddenRows.map(range => ({ ...range })) : hiddenRows } : {}),
      ...(heights.size ? { rowHeightSource: { rows: copy ? new Map(heights) : heights } } : {})
    };
  }

  function read(rowEntries: unknown[]): void {
    const cells: ParsedCell[] = [];
    for (const rowEntry of rowEntries) {
      const sourceIndex = readPath(rowEntry, ['r']);
      const rowIndex = Number(sourceIndex ?? (rows.at(-1)?.index ?? 0) + 1);
      if (sourceIndex === undefined && rowIndex > 1_048_576) continue;
      maxRow = Math.max(maxRow, rowIndex);
      const height = xlsxRowHeight(readPath(rowEntry, ['ht']), readPath(rowEntry, ['customHeight']));
      if (xmlTrue(readPath(rowEntry, ['hidden'])) || height?.height === 0) addHiddenTrack(hiddenRows, rowIndex);
      if (height && height.height !== 0 && Number.isInteger(rowIndex) && rowIndex >= 1 && rowIndex <= 1_048_576) heights.set(rowIndex, height);
      const rowStyle = xmlTrue(readPath(rowEntry, ['customFormat'])) ? readPath(rowEntry, ['s']) : undefined;
      let cellCount = 0, column = 0;
      for (const cellEntry of toArray(readPath(rowEntry, ['c']))) {
        const cell = readCell(cellEntry, options, shared, rowIndex, column);
        if (!cell) continue;
        column = cell.column;
        const index = Number(readPath(cellEntry, ['s']) ?? rowStyle ?? columnStyle(cell.column));
        const font = options.forPreview ? undefined : options.styles[index]?.font;
        if (font) cell.font = font;
        if (options.styles.length && index !== 0) cell.styleIndex = index;
        cells[cellCount++] = cell;
        maxColumn = Math.max(maxColumn, cell.column);
        if (cell.formula && cell.row === rowIndex && readPath(cellEntry, ['f', 't']) === 'array') {
          const range = parseSheetRange(String(readPath(cellEntry, ['f', 'ref']) ?? '').trim());
          if (range && range.firstRow === cell.row && range.firstColumn === cell.column) {
            const index = Number(readPath(cellEntry, ['cm']));
            const metadataIndex = Number.isSafeInteger(index) && index > 0 ? index : undefined;
            declaredArrays.push({ range, metadataIndex });
            maxRow = Math.max(maxRow, range.lastRow);
            maxColumn = Math.max(maxColumn, range.lastColumn);
          }
        }
      }
      rows.push({ index: rowIndex, cells: cells.slice(0, cellCount),
        ...(options.styles.length && rowStyle !== undefined ? { styleIndex: Number(rowStyle) } : {}) });
    }
  }
  return {
    get count() { return rows.length; },
    get lastRow() { return rows.at(-1)?.index ?? 0; },
    read,
    snapshot: () => sheet(true),
    append(batch: ParsedSheet) {
      for (const row of batch.rows) rows.push(row);
      maxColumn = Math.max(maxColumn, batch.columnCount);
      maxRow = Math.max(maxRow, batch.rowCount);
      for (const range of batch.hiddenRows ?? []) {
        addHiddenTrack(hiddenRows, range.first);
        hiddenRows.at(-1)!.last = range.last;
      }
      for (const [index, height] of batch.rowHeightSource?.rows ?? []) heights.set(index, height);
    },
    async finish(): Promise<ParsedSheet> {
      const sharedFormulas = shared.finish(rows, options.warnings, options.name);
      const metadata = declaredArrays.some(entry => entry.metadataIndex !== undefined) ? await options.loadDynamicArrays() : undefined;
      const arrayFormulas: ParsedArrayFormula[] = [];
      for (const { range, metadataIndex } of declaredArrays) {
        if (metadataIndex !== undefined && metadata?.has(metadataIndex)) arrayFormulas.push({ ...range, dynamic: true });
        else arrayFormulas.push(range);
      }
      return {
        ...sheet(),
        ...(arrayFormulas.length ? { arrayFormulas } : {}),
        ...(sharedFormulas ? { sharedFormulas } : {})
      };
    }
  };
}

function canBatchXml(xml: string): boolean {
  // Document-defined entities need a single parse with document-wide limits.
  return xml.length >= XML_BATCH_CHARS && !xml.includes('<!');
}

function xmlChildEnd(tag: 'row' | 'si', qualified = false) {
  const name = qualified ? `(${xmlPrefix}${tag})` : tag;
  const opening = new RegExp(`[ \\t\\r\\n]*<${name}${xmlTagTail}`, 'y');
  const closing = new RegExp(`</${name}[ \\t\\r\\n]*>`, 'g');
  return (xml: string, offset: number): number | undefined => {
    opening.lastIndex = offset;
    const start = qualified ? opening.exec(xml) : undefined;
    if (qualified ? !start : !opening.test(xml)) return undefined;
    const end = opening.lastIndex;
    if (xml[end - 2] === '/') return end;
    closing.lastIndex = end;
    if (start) return closing.exec(xml)?.[1] === start[1] ? closing.lastIndex : undefined;
    return closing.test(xml) ? closing.lastIndex : undefined;
  };
}

function xmlBatchEnd(xml: string, childEnd: ReturnType<typeof xmlChildEnd>): number {
  let offset = 0;
  for (;;) {
    const end = childEnd(xml, offset);
    if (end === undefined || end > XML_BATCH_CHARS) return offset;
    offset = end;
  }
}

async function worksheetRowBatchEnds(xml: string, signal?: AbortSignal): Promise<number[] | undefined> {
  if (xml.includes('<?')) return undefined;
  const childEnd = xmlChildEnd('row');
  const ends: number[] = [];
  let offset = 0, start = 0, scanned = 0;
  let lastYield = signal ? performance.now() : 0;
  while (offset < xml.length) {
    const end = childEnd(xml, offset);
    if (end === undefined) {
      if (xml.slice(offset).trim()) return undefined;
      break;
    }
    if (end - start > XML_BATCH_CHARS && offset > start) {
      ends.push(offset);
      start = offset;
    }
    offset = end;
    if (signal && ++scanned % 4096 === 0 && performance.now() - lastYield >= 16) {
      await new Promise(resolve => setTimeout(resolve, 0));
      checkAborted(signal);
      lastYield = performance.now();
    }
  }
  if (offset > start) ends.push(offset);
  return ends.length > 1 ? ends : undefined;
}

function* readXmlBatches(xml: string, ends: readonly number[], parser: XMLParser, path: readonly string[]): Generator<unknown[]> {
  const parents = path.slice(0, -1);
  const opening = parents.map(tag => `<${tag}>`).join('');
  const closing = parents.reverse().map(tag => `</${tag}>`).join('');
  let start = 0;
  for (const end of ends) {
    const chunk = parser.parse(opening + xml.slice(start, end) + closing);
    yield toArray(readPath(chunk, path));
    start = end;
  }
}

const xmlTrue = (value: unknown) => value === '1' || value === 'true';

function hideUnstoredRows(sheet: ParsedSheet): void {
  const count = Math.max(1, sheet.rowCount), hidden = [...(sheet.hiddenRows ?? [])];
  const rows = sheet.rows.every((row, index, rows) => !index || row.index >= rows[index - 1].index)
    ? sheet.rows : [...sheet.rows].sort((a, b) => a.index - b.index);
  const arrays = sheet.arrayFormulas?.slice().sort((a, b) => a.firstRow - b.firstRow) ?? [];
  let next = 1, row = 0, array = 0;
  while (row < rows.length || array < arrays.length) {
    const index = rows[row]?.index ?? Infinity, range = arrays[array];
    const first = range && range.firstRow < index ? range.firstRow : index;
    const last = first === index ? rows[row++].index : arrays[array++].lastRow;
    if (first > count) break;
    if (!Number.isSafeInteger(first) || last < next) continue;
    if (first > next) hidden.push({ first: next, last: first - 1 });
    next = last + 1;
  }
  if (next <= count) hidden.push({ first: next, last: count });
  if (hidden.length) sheet.hiddenRows = hidden;
}

function readHiddenColumns(document: unknown): ParsedTrackRange[] | undefined {
  const columns = toArray(readPath(document, ['worksheet', 'cols', 'col']));
  let count = 0;
  for (const column of columns) {
    const last = Number(readPath(column, ['max']));
    if (Number.isInteger(last) && last <= 16_384 && xmlTrue(readPath(column, ['hidden']))) count = Math.max(count, last);
  }
  if (!count) return undefined;
  const hidden = new Uint8Array(count);
  // Match the width lookup's precedence when column declarations overlap.
  for (let index = columns.length - 1; index >= 0; index--) {
    const column = columns[index];
    const first = Number(readPath(column, ['min'])), last = Number(readPath(column, ['max']));
    if (Number.isInteger(first) && Number.isInteger(last) && first >= 1 && first <= last && last <= 16_384) {
      hidden.fill(Number(xmlTrue(readPath(column, ['hidden']))), first - 1, last);
    }
  }
  const ranges: ParsedTrackRange[] = [];
  for (let index = 0; index < hidden.length; index++) if (hidden[index]) addHiddenTrack(ranges, index + 1);
  return ranges.length ? ranges : undefined;
}

function readColumnWidthSource(document: unknown, options: { name: string; warnings: string[]; columnWidthFont?: Pick<ParsedColumnWidthSource, 'font' | 'fontSize'> }): ParsedColumnWidthSource {
  const ranges: ParsedColumnWidthSource['ranges'][number][] = [];
  let invalid = 0;
  for (const column of toArray(readPath(document, ['worksheet', 'cols', 'col']))) {
    const value = readPath(column, ['width']);
    if (value === undefined || (value === '0' && xmlTrue(readPath(column, ['hidden'])))) continue;
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

function readCell(cellEntry: unknown, { sharedStrings, readRichText, forPreview, noteRegex }: WorksheetOptions,
  shared: SharedFormulaReader, row: number, previousColumn: number): ParsedCell | null {
  // An empty <c/> still occupies a position in the row.
  const entry = (typeof cellEntry === 'string' && !cellEntry.trim() ? {} : cellEntry) as Record<string, unknown> | undefined;
  if (!entry || typeof entry !== 'object') return null;
  const ref = entry.r === undefined ? undefined : String(entry.r ?? '');
  if (ref === '' || (ref === undefined
    && (previousColumn >= 16_384 || !Number.isInteger(row) || row < 1 || row > 1_048_576))) return null;
  const position = ref === undefined ? { row, column: previousColumn + 1 } : parseCellRef(ref);
  const valueType = String(entry.t ?? '');
  const rawValue = entry.v == null ? null : typeof entry.v === 'object' ? readTextValue(entry.v) : String(entry.v);
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
    value = decodeSpreadsheetText(value);
  } else if (valueType === 'e') {
    parsedType = 'error';
  } else if (valueType === 'd') {
    parsedType = 'date';
  }

  const uncached = rawValue == null || (!parsedType && rawValue.trim() === '');
  const isShared = readPath(entry.f, ['t']) === 'shared';
  const waitingForFormula = uncached && (formula || isShared);
  const cell = createWorksheetCell(ref, position.row, position.column, waitingForFormula ? '' : value,
    forPreview && entry.f === undefined);
  if (parsedType) cell.valueType = parsedType;
  if (!formula && parsedType && rawValue === null && entry.is === undefined) cell.missingValue = true;
  if (richText && !waitingForFormula) cell.richText = richText;
  if (formula) {
    noteRegex(formula);
    cell.formula = formula;
    cell.needsCalculation = uncached;
  }
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
