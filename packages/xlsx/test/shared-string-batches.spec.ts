import { openZipArchive } from '@filens/core';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook, readXlsxWorkbook, resolveCellValue } from '../src/parser';
import type { ParsedSheet } from '../src/types';
import { createDeferredSharedStringsWorkbook, createSharedStringsWorkbook, deferredSharedString, laterWorksheetBatch, oversizedSharedStringItem, oversizedSharedStringValue, sharedStringsLastValue } from './fixtures/shared-strings.mjs';
import { prefixXmlElements } from './fixtures/worksheet-batches.mjs';

afterEach(() => vi.restoreAllMocks());

describe('large XLSX shared string tables', () => {
  it.each(['complete', 'fallback', 'abort', 'inline-first', 'oversized', 'abort-oversized'])('previews ready rows while a shared string block is held (%s)', async mode => {
    const inlineFirst = mode === 'inline-first';
    const bytes = await createDeferredSharedStringsWorkbook({ malformedTail: mode === 'fallback', inlineFirst, oversized: mode.endsWith('oversized') });
    const zipEntries = await openZipArchive(bytes);
    const entry = zipEntries.get('xl/catalog-strings.xml')!;
    const read = vi.spyOn(entry, 'bytes'), original = entry.chunks!.bind(entry);
    let release!: () => void, waiting!: () => void, closed = false;
    const pause = new Promise<void>(resolve => { release = resolve; });
    const held = new Promise<void>(resolve => { waiting = resolve; });
    entry.chunks = async function* (signal) {
      let blocks = 0;
      try {
        for await (const chunk of original(signal)!) {
          if (blocks++ === (inlineFirst ? 0 : 1)) { waiting(); await pause; }
          yield chunk;
        }
      } finally { closed = true; }
    };
    const controller = new AbortController(), onRows = vi.fn<(sheet: ParsedSheet) => void>(), onSheet = vi.fn<(sheet: ParsedSheet) => void>();
    const loaded = readXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries, signal: controller.signal }, { onRows, onSheet });
    try {
      await held;
      expect(onRows).toHaveBeenCalledTimes(1);
      const snapshot = onRows.mock.calls[0][0];
      const ready = ['First & 中', 'Shared rich text', 'Inline rich text'];
      expect(snapshot.rows.map(row => row.cells[0].value)).toEqual(inlineFirst ? ready.slice(0, 1) : ready);
      expect(snapshot.rows[0].cells[1]).toMatchObject({ value: '17', needsCalculation: false });
      expect(snapshot.rows[0].cells[2]).toMatchObject({ value: '', needsCalculation: true });
      expect(onSheet).not.toHaveBeenCalled();
      if (mode.startsWith('abort')) {
        controller.abort();
        release();
        await expect(loaded).rejects.toMatchObject({ name: 'AbortError' });
        expect(onRows).toHaveBeenCalledTimes(1);
        expect(onSheet).not.toHaveBeenCalled();
        expect(closed).toBe(true);
        return;
      }
      release();
      const workbook = await loaded;
      if (inlineFirst) expect(onRows.mock.calls[1][0].rows.map(row => row.cells[0].value)).toEqual(ready);
      expect(read).toHaveBeenCalledTimes(mode === 'fallback' ? 1 : 0);
      expect(closed).toBe(true);
      expect(workbook).toEqual(await readXlsxWorkbook(bytes, undefined, {}));
      expect(workbook.fonts?.map(font => font.fontFamily)).toEqual(mode === 'fallback' ? ['Georgia'] : ['Courier New', 'Georgia']);
      const catalog = workbook.sheets[0], tail = mode === 'fallback' ? '' : deferredSharedString;
      expect(catalog.rows.at(-1)?.cells[0].value).toBe(tail);
      expect(resolveCellValue(catalog, catalog.rows[0].cells[2])).toBe(String(tail.length));
      expect(catalog.rows[3].cells[0].value).toBe(tail);
    } finally {
      release();
      await loaded.catch(() => {});
    }
  });

  it.each(['late dependency', 'unused tail', 'fallback', 'prefixed'])('publishes later worksheet batches before the shared strings finish (%s)', async mode => {
    const bytes = await createDeferredSharedStringsWorkbook({ multipleBatches: true,
      malformedTail: mode === 'fallback', tailDependency: mode !== 'unused tail', prefixed: mode === 'prefixed' });
    const zipEntries = await openZipArchive(bytes);
    const strings = zipEntries.get('xl/catalog-strings.xml')!;
    const sheetEntry = zipEntries.get('xl/worksheets/catalog.xml')!;
    const readSheet = vi.spyOn(sheetEntry, 'bytes'), streamSheet = vi.spyOn(sheetEntry, 'chunks');
    const original = strings.chunks!.bind(strings);
    let hold!: () => void, resume!: () => void;
    const held = new Promise<void>(resolve => { hold = resolve; });
    const paused = new Promise<void>(resolve => { resume = resolve; });
    strings.chunks = async function* (signal) {
      let blocks = 0;
      for await (const chunk of original(signal)!) {
        if (blocks++ === 1) { hold(); await paused; }
        yield chunk;
      }
    };
    const onRows = vi.fn<(sheet: ParsedSheet) => void>();
    const loaded = readXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries }, { onRows });
    try {
      await held;
      expect(onRows.mock.calls.map(([sheet]) => sheet.rows.length)).toEqual(mode === 'unused tail' ? [4, 5, 7] : [4, 5]);
      const partial = onRows.mock.lastCall![0];
      expect(partial.rows[4].cells.slice(0, 3).map(cell => cell.value)).toEqual(['Shared rich text', laterWorksheetBatch, 'Inline Cambria']);
      expect(partial.rows[4].cells[1].needsCalculation).toBe(false);
      expect(partial.rows[0].cells[2].needsCalculation).toBe(true);
      expect(partial.cellStyles?.variableHeight).toBe(true);
      resume();
      const workbook = await loaded;
      const catalog = workbook.sheets[0];
      const fallback = mode === 'fallback';
      expect(streamSheet).toHaveBeenCalledTimes(1);
      expect(readSheet).toHaveBeenCalledTimes(fallback ? 1 : 0);
      expect(workbook).toEqual(await readXlsxWorkbook(bytes, undefined, {}));
      expect(workbook.fonts?.map(font => font.fontFamily)).toEqual(fallback ? ['Georgia', 'Cambria'] : ['Courier New', 'Cambria', 'Georgia']);
      expect(catalog.rows[4].cells[2].richText?.runs[0].font).toBe(workbook.fonts?.find(font => font.fontFamily === 'Cambria'));
      expect(catalog.rows[1].cells[0].value).toBe(fallback ? '' : 'Shared rich text');
      const tail = fallback ? '' : mode === 'unused tail' ? 'First & 中' : deferredSharedString;
      expect(catalog.rows[5].cells[0].value).toBe(tail);
      expect(resolveCellValue(catalog, catalog.rows[0].cells[2])).toBe(String(tail.length));
    } finally {
      resume();
      await loaded.catch(() => {});
    }
  });

  it.each([false, true])('streams an oversized shared string with a split closing tag (prefixed=%s)', async prefixed => {
    const path = 'xl/catalog-strings.xml';
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook(4));
    let xml = '<sst><si><t>Before wide</t></si>' + oversizedSharedStringItem().replace('</si>', '</si \t\n>')
      + '<si><t>After wide</t></si><si><t>Final string</t></si></sst>';
    if (prefixed) xml = prefixXmlElements(xml).replaceAll('main:', 'sheet.ml:').replace('xmlns:main=', 'xmlns:sheet.ml=');
    zip.file(path, xml);
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const raw = Buffer.from(xml), tag = prefixed ? '</sheet.ml:si' : '</si';
    const end = raw.indexOf(tag + ' \t\n>');
    expect(end).toBeGreaterThan(1024 * 1024);
    entry.chunks = async function* () {
      let start = 0;
      for (const limit of [raw.indexOf('星') + 1, end + 3, end + tag.length, end + tag.length + 3, raw.length]) {
        while (start < limit) {
          const next = Math.min(start + 16_384, limit);
          yield raw.subarray(start, next);
          start = next;
        }
      }
    };
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const streamed = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(read).not.toHaveBeenCalled();
    const wideBatches = parse.mock.calls.flatMap(([xml]) => typeof xml === 'string' && xml.length > 512 * 1024 ? [xml] : []);
    expect(wideBatches).toHaveLength(1);
    expect(wideBatches[0]).toContain('Large &amp; 星');
    expect(wideBatches[0]).not.toMatch(/Before wide|After wide|Final string/);
    entry.chunks = async function* () { yield raw; };
    expect(await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries })).toEqual(streamed);
    expect(read).not.toHaveBeenCalled();
    zip.file(path, xml.replace(/<\/(?:sheet\.ml:)?sst>$/, '<!-- full parser -->$&'));
    const general = await loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    expect(streamed).toEqual(general);
    const [catalog, summary] = streamed.sheets;
    expect(catalog.rows.map(row => row.cells[0].value)).toEqual(['Before wide', oversizedSharedStringValue, 'After wide', 'Final string']);
    const [run] = catalog.rows[1].cells[0].richText!.runs;
    expect(run.color).toBe('#336699');
    expect(run.font).toBe(streamed.fonts?.find(font => font.fontFamily === 'Courier New'));
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe('12');
  });

  it.each(['streamed', 'buffered'])('retains shared indices, rich runs, fonts and formula values across %s batches', async mode => {
    const path = 'xl/catalog-strings.xml';
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook());
    const original = (index: number) => `Catalog entry ${index}: observations collected by the observatory across several seasons and viewing conditions.`;
    const plainText = '  Catalog label 星表 🪐 &lt; < >\nsecond line\r_x0001_  ';
    const encodedText = '  Catalog label &#x661F;&#34920; &#x1FA90; &amp;lt; &lt; &gt;\nsecond line&#13;_x005F_x0001_  ';
    const middleRun = '<r><rPr><rFont val="Cambria"/><color rgb="FF336699"/></rPr><t>Early &amp; 星</t></r>';
    const xml = (await zip.file(path)!.async('string'))
      .replace(`<t>${original(20)}</t>`, middleRun)
      .replace(`<t>${original(21)}</t>`, `<t xml:space="preserve">${encodedText}</t>`)
      .replace(`<t>${original(6000)}</t>`, `<t xml:space="preserve">${encodedText}</t>`);
    const makeSource = () => zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    zip.file(path, xml);
    const bytes = await makeSource();
    const zipEntries = await openZipArchive(bytes);
    const entry = zipEntries.get(path)!;
    expect(entry.chunks).toBeDefined();
    if (mode === 'buffered') entry.chunks = undefined;
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries });
    const batches = parse.mock.calls.map(([xml]) => xml)
      .filter((xml): xml is string => typeof xml === 'string' && xml.startsWith('<sst>'));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toContain('<si/>');
    expect(batches[0]).toContain(middleRun);
    expect(batches[1]).toContain('phonetic');
    expect(batches.every(xml => xml.length < 1024)).toBe(true);
    expect(batches.some(xml => xml.includes(encodedText))).toBe(false);
    parse.mockRestore();
    zip.file(path, xml.replace('</sst>', '<!-- general parser --></sst>'));
    const general = await loadXlsxWorkbook(await makeSource());
    expect(workbook).toEqual(general);

    const [catalog, summary] = workbook.sheets;
    expect(catalog.rows[0].cells[0].value).toBe('  Northern sky ★  ');
    expect(catalog.rows[1].cells[0].value).toBe('');
    const early = catalog.rows[20].cells[0];
    expect(early.value).toBe('Early & 星');
    expect(early.richText?.runs[0].font).toBe(workbook.fonts?.find(font => font.fontFamily === 'Cambria'));
    expect(catalog.rows[21].cells[0].value).toBe(plainText);
    expect(catalog.rows[6000].cells[0].value).toBe(plainText);
    const anchor = catalog.rows.at(-1)!.cells[0];
    expect(anchor).toMatchObject({ ref: 'XFD1048576', value: sharedStringsLastValue, richText: { value: sharedStringsLastValue } });
    expect(anchor.richText?.runs.map(run => run.text)).toEqual(['  Batch & ', '星表 ', '²']);
    expect(anchor.richText?.runs[1].font).toBe(workbook.fonts?.find(font => font.fontFamily === 'Courier New'));
    expect(summary.rows[0].cells[0].richText).toBe(anchor.richText);
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe(String(sharedStringsLastValue.length));
  });

  it.each([
    { buffered: false, strict: false }, { buffered: true, strict: true }
  ])('opens a workbook with explicit namespace prefixes (%o)', async ({ buffered, strict }) => {
    const canonical = await loadXlsxWorkbook(await createSharedStringsWorkbook(12_000, { styled: true }));
    const bytes = await createSharedStringsWorkbook(12_000, { styled: true, prefixed: true, strict });
    const zipEntries = await openZipArchive(bytes);
    const entry = zipEntries.get('xl/catalog-strings.xml')!;
    const source = Buffer.from(await entry.bytes());
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    if (buffered) entry.chunks = undefined;
    else entry.chunks = async function* () {
      const splits = [source.indexOf('<main:sst ') + 4, source.indexOf('星') + 1, source.indexOf('</main:sst>') + 5];
      let start = 0;
      for (const end of [...splits, source.length]) {
        while (start < end) {
          const next = Math.min(start + 32_768, end);
          yield source.subarray(start, next);
          start = next;
        }
      }
    };
    const workbook = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries });
    expect(read).toHaveBeenCalledTimes(buffered ? 1 : 0);
    expect(workbook).toEqual(canonical);
    const batches = parse.mock.calls.map(([xml]) => xml)
      .filter((xml): xml is string => typeof xml === 'string' && xml.includes('<main:si'));
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(xml => xml.length < 513 * 1024)).toBe(true);
    const [catalog, summary] = workbook.sheets;
    expect(summary.date1904).toBe(true);
    expect(catalog.rows.at(-1)?.cells[0].richText).toBe(summary.rows[0].cells[0].richText);
    const result = summary.rows[0].cells[1];
    expect(result.font?.fontFamily).toBe('Georgia');
    expect(resolveCellValue(summary, result)).toBe(String(sharedStringsLastValue.length));
  });

  it.each([false, true])('skips worksheets after cancellation between string batches (prefixed=%s)', async prefixed => {
    const bytes = await createSharedStringsWorkbook(12_000, { prefixed });
    const controller = new AbortController(), parse = XMLParser.prototype.parse;
    let batches = 0, now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 20);
    const spy = vi.spyOn(XMLParser.prototype, 'parse').mockImplementation(function (this: XMLParser, xml, options) {
      if (typeof xml === 'string' && (prefixed ? xml.includes('<main:si') : xml.startsWith('<sst>')) && ++batches === 1) {
        setTimeout(() => controller.abort(), 0);
      }
      return parse.call(this, xml, options);
    });
    await expect(loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(batches).toBe(1);
    expect(spy.mock.calls.some(([xml]) => typeof xml === 'string'
      && (xml.startsWith('<worksheet>') || xml.includes('<main:worksheet')))).toBe(false);
  });

  it('decodes characters and tags split across chunks without reading the expanded entry', async () => {
    const bytes = await createSharedStringsWorkbook();
    const zipEntries = await openZipArchive(bytes);
    const file = zipEntries.get('xl/catalog-strings.xml')!;
    const xml = Buffer.from(await file.bytes());
    const read = vi.spyOn(file, 'bytes').mockRejectedValue(new Error('Expected a streamed XML read'));
    const split = [1, 525_001, xml.indexOf('星') + 1, xml.indexOf('</sst>') + 3, xml.length];
    file.chunks = async function* () {
      let start = 0;
      for (const end of split) {
        yield xml.subarray(start, end);
        start = end;
      }
    };
    const workbook = await loadXlsxWorkbook(bytes, { descriptor: { source: bytes }, zipEntries });
    expect(workbook.sheets[0].rows.at(-1)?.cells[0].value).toBe(sharedStringsLastValue);
    expect(read).not.toHaveBeenCalled();
  });

  it('discards sampled fonts when late XML framing requires the full parser', async () => {
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook(2));
    const item = '<si><r><rPr><rFont val="Temporary Face"/></rPr><t>abc</t></r></si>';
    zip.file('xl/catalog-strings.xml', `<sst>${item.repeat(10_000)}</sst><sst/>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(bytes);
    expect(parse.mock.calls.some(([xml]) => typeof xml === 'string' && xml.startsWith('<sst>') && xml.includes('Temporary Face') && !xml.endsWith('<sst/>'))).toBe(true);
    expect(workbook.fonts).toEqual([]);
  });

  it('preserves shared string indices across batches with more than 100,000 standard references', async () => {
    const count = 31, path = 'xl/catalog-strings.xml';
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook(count));
    const text = '&#x661F;&#34920;&amp;&lt;'.repeat(900);
    const items = Array.from({ length: count }, (_, i) => `<si><t>${text} ${i}</t></si>`).join('');
    zip.file(path, `<sst>${items}</sst>`);
    const source = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zipEntries = await openZipArchive(source), entry = zipEntries.get(path)!;
    const read = vi.spyOn(entry, 'bytes'), parse = vi.spyOn(XMLParser.prototype, 'parse');
    const workbook = await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries });
    expect(read).not.toHaveBeenCalled();
    const batches = parse.mock.calls.map(([xml]) => xml)
      .filter((xml): xml is string => typeof xml === 'string' && xml.startsWith('<sst>') && xml.includes('<si>'));
    expect(batches).toHaveLength(0);
    entry.chunks = undefined;
    expect(await loadXlsxWorkbook(source, { descriptor: { source }, zipEntries })).toEqual(workbook);
    const [catalog, summary] = workbook.sheets;
    const last = '星表&<'.repeat(900) + ' 30';
    expect(catalog.rows[0].cells[0].value).toBe('星表&<'.repeat(900) + ' 0');
    expect(catalog.rows.at(-1)?.cells[0].value).toBe(last);
    expect(resolveCellValue(summary, summary.rows[0].cells[1])).toBe(String(last.length));
  });

  it('enforces the expanded length limit for a declared shared string entity', async () => {
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook(2));
    const item = `<si><t>${'&label;'.repeat(2000)}</t></si>`;
    zip.file('xl/catalog-strings.xml', '<!DOCTYPE sst [<!ENTITY label "a sample value for a text cell">]>'
      + `<sst>${item.repeat(3)}</sst>`);
    await expect(loadXlsxWorkbook(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })))
      .rejects.toThrow(/expanded content length limit exceeded/i);
  });
});
