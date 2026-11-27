import { openZipArchive } from '@filens/core';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadXlsxWorkbook, resolveCellValue } from '../src/parser';
import { createSharedStringsWorkbook, sharedStringsLastValue } from './fixtures/shared-strings.mjs';

afterEach(() => vi.restoreAllMocks());

describe('large XLSX shared string tables', () => {
  it.each(['streamed', 'buffered'])('retains shared indices, rich runs, fonts and formula values across %s batches', async mode => {
    const path = 'xl/catalog-strings.xml';
    const zip = await JSZip.loadAsync(await createSharedStringsWorkbook());
    const original = 'Catalog entry 6000: observations collected by the observatory across several seasons and viewing conditions.';
    const plainText = '  Catalog label 星表 🪐\nsecond line\r_x0001_  ';
    const encodedText = '  Catalog label 星表 🪐\nsecond line_x000D__x005F_x0001_  ';
    const xml = (await zip.file(path)!.async('string')).replace(
      `<t>${original}</t>`, `<t xml:space="preserve">${encodedText}</t>`
    );
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
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(xml => xml.length <= 512 * 1024 + '<sst></sst>'.length)).toBe(true);
    expect(batches.some(xml => xml.includes(encodedText))).toBe(false);
    parse.mockRestore();
    zip.file(path, xml.replace('</sst>', '<!-- general parser --></sst>'));
    const general = await loadXlsxWorkbook(await makeSource());
    expect(workbook).toEqual(general);

    const [catalog, summary] = workbook.sheets;
    expect(catalog.rows[0].cells[0].value).toBe('  Northern sky ★  ');
    expect(catalog.rows[1].cells[0].value).toBe('');
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
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every(xml => xml.length <= 512 * 1024 + '<sst></sst>'.length)).toBe(true);
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
