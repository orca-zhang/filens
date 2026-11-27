import { describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import JSZip from 'jszip';
import {
  createIworkPreviewDriver,
  createIworkPreviewRoutes,
  detectIworkType,
  loadIwork
} from '../src/index';
import {
  createPagesAggregateColumnsArchive, createPagesLongBodyArchive, createPagesLongTableArchive, createPagesNumberingArchive,
  createPagesParagraphBreakArchive, createPagesSavedColumnsArchive, pagesAggregateColumnText, pagesEstimatedColumnOverflowText, pagesLongBodyText,
  pagesTallCellText, pagesTallMergeText
} from './fixtures/pages-archive.mjs';
import { readFixture, repackageIworkFixture } from './helpers';

describe('iWork parsing', () => {
  it('resolves the same archive records when ZIP entries are stored in a different order', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.numbers');
    const original = await JSZip.loadAsync(bytes);
    const reversed = new JSZip();
    for (const entry of Object.values(original.files).filter(entry => !entry.dir).reverse()) {
      reversed.file(entry.name, await entry.async('uint8array'));
    }
    const before = await loadIwork(bytes, { hint: 'numbers' });
    const after = await loadIwork(await reversed.generateAsync({ type: 'uint8array' }), { hint: 'numbers' });
    expect(after.archive).toEqual(before.archive);
    if (before.kind !== 'numbers' || after.kind !== 'numbers') throw new Error('Expected Numbers documents');
    expect(after.sheets).toEqual(before.sheets);
  });

  it('fetches an unnamed download URL once when detecting its archive type', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.pages');
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(bytes)));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const document = await loadIwork('https://example.com/download?id=42');
      expect(document.kind).toBe('pages');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('detects and parses a large local package without reading its full Blob', async () => {
    const bytes = await readFixture('vendor/iwork-converter/testdata/a.numbers');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('Unused/padding.bin', new Uint8Array(4 * 1024 * 1024));
    const source = new NodeBlob([await zip.generateAsync({ type: 'uint8array' })]) as unknown as Blob;
    const whole = vi.spyOn(source, 'arrayBuffer').mockRejectedValue(new Error('Unexpected full archive read'));
    const slice = vi.spyOn(source, 'slice');
    vi.stubGlobal('Blob', NodeBlob);
    try {
      await expect(detectIworkType(source)).resolves.toBe('numbers');
      const parsed = await loadIwork(source);
      expect(parsed.kind).toBe('numbers');
      if (parsed.kind === 'numbers') expect(parsed.sheets).toHaveLength(1);
      expect(whole).not.toHaveBeenCalled();
      expect(slice.mock.results.reduce((sum, result) => sum + result.value.size, 0)).toBeLessThan(source.size / 2);
    } finally { vi.unstubAllGlobals(); }
  });

  it('detects vendored iWork fixtures by archive contents', async () => {
    const keyBytes = await readFixture('vendor/iwork-converter/testdata/a.key');
    const pagesBytes = await readFixture('vendor/iwork-converter/testdata/a.pages');
    const numbersBytes = await readFixture('vendor/iwork-converter/testdata/a.numbers');

    await expect(detectIworkType(keyBytes)).resolves.toBe('key');
    await expect(detectIworkType(pagesBytes)).resolves.toBe('pages');
    await expect(detectIworkType(numbersBytes)).resolves.toBe('numbers');
  });

  it.each([
    ['numbers', '', true],
    ['numbers', 'Workbook.numbers', false],
    ['numbers', 'Workbook.numbers', true],
    ['pages', 'Document.pages', true],
    ['key', 'Presentation.key', true]
  ] as const)('loads %s with package folder "%s" and nested index %s', async (format, folder, nestedIndex) => {
    const source = await readFixture(`vendor/iwork-converter/testdata/a.${format}`);
    const archive = await repackageIworkFixture(source, folder, nestedIndex);
    await expect(detectIworkType(archive)).resolves.toBe(format);
    const original = await loadIwork(source);
    expect(await loadIwork(archive)).toEqual(original);
  });

  it('rejects an Index.zip with no document entry', async () => {
    const index = new JSZip().file('Index/Other.iwa', 'invalid');
    const zip = new JSZip().file('Index.zip', await index.generateAsync({ type: 'uint8array' }));
    const source = await zip.generateAsync({ type: 'uint8array' });
    await expect(detectIworkType(source)).rejects.toThrow('Index.zip is missing Index/Document.iwa');
    await expect(loadIwork(source, { hint: 'numbers' })).rejects.toThrow('Index.zip is missing Index/Document.iwa');
  });

  it('uses the root document when a separate Index.zip is present', async () => {
    const source = await readFixture('vendor/iwork-converter/testdata/a.numbers');
    const zip = await JSZip.loadAsync(source);
    zip.file('Index.zip', 'unrelated data');
    expect(await loadIwork(await zip.generateAsync({ type: 'uint8array' }))).toEqual(await loadIwork(source));
  });

  it('loads keynote fixtures into a slide-oriented model', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.key'));

    expect(document.kind).toBe('key');
    if (document.kind !== 'key') {
      return;
    }

    expect(document.slides).toHaveLength(1);
    expect(document.presentation.slides).toHaveLength(1);
    expect(document.slides[0]?.title).toBe('账户passport');
    expect(document.slides[0]?.slide.items.length).toBeGreaterThanOrEqual(20);
    expect(
      document.slides[0]?.slide.items.some((item) => {
        const textFrame = 'textFrame' in item ? item.textFrame : undefined;
        return textFrame?.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text.includes('聚合支付pay'))
        );
      })
    ).toBe(true);
  });

  it('loads pages fixtures into a page canvas with body text and tables', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.pages'));

    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') {
      return;
    }

    expect(document.pages).toHaveLength(3);
    expect(document.title).toBe('购 销 合 同');
    expect(document.pages[0]?.canvas.slide.items.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(document.pages[0]?.canvas.slide.items.some((item) => item.kind === 'table')).toBe(true);
    expect(document.pages[0]?.canvas.slide.items.some((item) => item.kind === 'text')).toBe(true);
    expect(document.pages[0]?.blocks.length).toBeGreaterThanOrEqual(2);
    expect(document.pages[0]?.blocks.some((block) => block.kind === 'paragraphs')).toBe(true);
    expect(document.pages[0]?.blocks.some((block) => block.kind === 'table')).toBe(true);

    const bodyItem = document.pages[0]?.canvas.slide.items.find((item) => item.kind === 'text');
    expect(bodyItem && bodyItem.kind === 'text').toBe(true);

    if (bodyItem && bodyItem.kind === 'text') {
      const paragraphs = bodyItem.textFrame.paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join('')
      );
      expect(paragraphs[0]).toBe('购 销 合 同');
      expect(paragraphs).toContain('货物清单及价格');
    }

    const firstParagraphBlock = document.pages[0]?.blocks.find((block) => block.kind === 'paragraphs');
    expect(firstParagraphBlock?.paragraphs?.[0]?.runs.map((run) => run.text).join('')).toBe('购 销 合 同');
    expect(document.pages[1]?.canvas.slide.items).toHaveLength(1);
    expect(document.pages[1]?.canvas.slide.items[0]?.kind).toBe('text');
    expect(document.pages[2]?.canvas.slide.items).toHaveLength(1);
    expect(document.pages[2]?.canvas.slide.items[0]?.kind).toBe('text');

    const firstTable = document.pages
      .flatMap((page) => page.canvas.slide.items)
      .find((item) => item.kind === 'table');
    expect(firstTable && firstTable.kind === 'table').toBe(true);
    if (firstTable && firstTable.kind === 'table') {
      const cellText = (row: number, column: number): string | undefined =>
        firstTable.cells
          .find((cell) => cell.row === row && cell.column === column)
          ?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

      // Pages stores ordinary strings and rich cell payloads in overlapping
      // key spaces; empty cells must also remain in the table grid.
      expect(cellText(1, 2)).toBe('只');
      expect(cellText(9, 5)).toBe('60000');
      expect(cellText(10, 5)).toBe('');
    }
  });

  it('carries Pages numbering through section restarts, blank pages and inherited fields', async () => {
    const document = await loadIwork(await createPagesNumberingArchive(), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const pageNumbers = [1, 1, 2, 3, 4];
    expect(document.pages).toHaveLength(pageNumbers.length);
    expect(document.pages[2].canvas.slide.items.some(item => item.name === 'Body')).toBe(false);
    expect(document.pages.map(page => page.blocks.flatMap(block => block.paragraphs?.map(
      paragraph => paragraph.runs.map(run => run.text).join('')) ?? []))).toEqual([
      ['First page 1'], ['Restart page 1'], [], ['😀 Continued 3 (label IV) — '], ['4 of 5, final.']
    ]);
    for (const [index, page] of document.pages.entries()) {
      const fields = page.canvas.slide.items.flatMap(item =>
        item.kind === 'text' && /^(header|footer)-/.test(item.name ?? '')
          ? [[item.id, item.textFrame.paragraphs.flatMap(para => para.runs.map(run => run.text)).join('')]]
          : []);
      expect(fields).toEqual([
        [`pages-header-${index + 1}-0`, `Page ${pageNumbers[index]}`],
        [`pages-footer-${index + 1}-0`, 'Total 5']
      ]);
    }
  });

  it('resolves body page fields against the estimated Pages pagination when saved layout is absent', async () => {
    const document = await loadIwork(await createPagesNumberingArchive({ savedLayout: false }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages.map(page => page.blocks.flatMap(block => block.paragraphs?.map(
      paragraph => paragraph.runs.map(run => run.text).join('')) ?? []))).toEqual([
      ['First page 1'], ['Restart page 1'], ['😀 Continued 2 (label IV) — 2 of 3, final.']
    ]);
  });

  it.each([false, true])('honors inherited Pages paragraph breaks with saved prefix and columns: %s', async columns => {
    const document = await loadIwork(await createPagesParagraphBreakArchive({ columns, savedPrefix: columns }));
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const first = columns ? 3 : 1;
    const last = first + 1;
    expect(document.pages.map(page => page.blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join('').trim()).filter(Boolean))).toEqual([
      ...(columns ? [['Saved prefix.'], []] : []),
      [`Opening page ${first}.`, 'Before the break.'],
      [`Styled page ${last}.`, ...(columns ? ['Same page.', `Right of page ${last}.`] : [`Same physical page ${last}.`]),
        `Last on page ${last} of ${last}.`]
    ]);
    if (columns) {
      const [before, after] = document.pages.slice(-2).map(page => page.canvas.slide.items
        .filter(item => item.kind === 'text').map(({ transform: { x, y } }) => [x, y]));
      expect(before.every(([x]) => x === 40)).toBe(true);
      expect(after[0]).toEqual([40, 40]);
      expect(after.find(([x]) => x === 220)).toEqual([220, 40]);
      const paragraphs = document.pages.at(-1)?.blocks.flatMap(block => block.paragraphs ?? []);
      const sizes = paragraphs?.slice(-2).map(paragraph => [...new Set(paragraph.runs.map(run => run.fontSize))]);
      expect(sizes).toEqual([[18], [14]]);
    }
  });

  it('honors a paragraph style that starts a new page after a leading Pages column break', async () => {
    const document = await loadIwork(await createPagesParagraphBreakArchive({ columns: true, afterColumnBreakStartsPage: true }));
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages.map(page => page.blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join('').trim()).filter(Boolean))).toEqual([
      ['Opening page 1.', 'Before the break.'], ['Styled page 2.', 'Same page.'], ['Right of page 3.', 'Last on page 3 of 3.']
    ]);
    expect(document.pages[2].canvas.slide.items[0].transform.x).toBe(40);
  });

  it('reserves space for wrapping table cells when a Pages archive omits cached pagination and fitted rows', async () => {
    const source = await readFixture('../../apps/demo/public/samples/a.pages');
    const zip = await JSZip.loadAsync(source);
    for (const name of Object.keys(zip.files)) if (/^Index\/ViewState-.*\.iwa$/.test(name)) zip.remove(name);
    const document = await loadIwork(await zip.generateAsync({ type: 'uint8array' }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(Object.values(document.archive.records).some(record => record.typeName === 'TP.LayoutStateArchive')).toBe(false);
    const items = document.pages[0].canvas.slide.items;
    const tableIndex = items.findIndex(item => item.kind === 'table');
    const table = items[tableIndex];
    if (table?.kind !== 'table') throw new Error('Expected inline table on the first page');
    expect(table.autoFitRows).toBe(true);
    expect(table.transform.height).toBeGreaterThan(table.rows.reduce((sum, height) => sum + height, 0) + 30);
    expect(items[tableIndex + 1].transform.y).toBeCloseTo(table.transform.y + table.transform.height);
  });

  it('paginates an oversized Pages paragraph and refreshes fields on their actual pages', async () => {
    const document = await loadIwork(await createPagesLongBodyArchive(), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const fragments: string[] = [];
    const numberedPages = new Set<number>();
    let oversizedFontSize = 0;
    for (const [index, page] of document.pages.entries()) {
      const paragraphs = page.blocks.flatMap(block => block.paragraphs ?? []);
      for (const paragraph of paragraphs) {
        const text = paragraph.runs.map(run => run.text).join('');
        if (text === 'Lead paragraph.' || text === 'Final paragraph.') continue;
        if (text === 'W') {
          expect(paragraph.runs[0]).toMatchObject({ bold: true });
          oversizedFontSize = paragraph.runs[0].fontSize ?? 0;
          continue;
        }
        for (const field of text.matchAll(/«(\d+)»/g)) {
          expect(Number(field[1])).toBe(index + 1);
          numberedPages.add(index + 1);
        }
        fragments.push(text);
      }
    }
    expect(fragments.length).toBeGreaterThan(2);
    expect(numberedPages.size).toBeGreaterThan(2);
    expect(fragments.join('').replace(/«\d+»/g, '«\uFFFC»')).toBe(pagesLongBodyText);
    const graphemeStarts = new Set(Array.from(new Intl.Segmenter().segment(fragments.join('')), entry => entry.index));
    let offset = 0;
    for (const text of fragments) {
      expect(graphemeStarts.has(offset)).toBe(true);
      offset += text.length;
    }
    expect(oversizedFontSize).toBeGreaterThan(16);
    expect(oversizedFontSize).toBeLessThan(240);
    expect(document.pages.at(-1)?.blocks[0]?.paragraphs?.[0]?.runs[0]?.text).toBe('Final paragraph.');
  });

  it('keeps a Pages inline drawable between the correct parts of a long paragraph', async () => {
    const document = await loadIwork(await createPagesLongBodyArchive({ inlineDrawable: true }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const blocks = document.pages.flatMap(page => page.blocks);
    const drawables = blocks.filter(block => block.item?.kind === 'image');
    expect(drawables).toHaveLength(1);
    const imageIndex = blocks.indexOf(drawables[0]);
    const text = blocks.map(block => block.paragraphs?.flatMap(paragraph => paragraph.runs).map(run => run.text).join('') ?? '');
    expect(text.slice(0, imageIndex).join('')).toMatch(/Entry 45 .*\. $/u);
    expect(text.slice(imageIndex + 1).join('')).toMatch(/^Entry 46 /u);
    expect(drawables[0].item!.transform.y + drawables[0].item!.transform.height).toBeLessThanOrEqual(280);
  });

  it('fits an indivisible oversized glyph inside its saved Pages text rectangle', async () => {
    const document = await loadIwork(await createPagesLongBodyArchive({ savedLayout: 'glyph' }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(3);
    const [glyph] = document.pages[1].canvas.slide.items;
    expect(glyph).toMatchObject({
      kind: 'text', transform: { x: 60, y: 65, width: 120, height: 130 },
      textFrame: { paragraphs: [{ runs: [{ text: 'W', bold: true }] }] }
    });
    if (glyph.kind !== 'text') throw new Error('Expected text item');
    expect(glyph.textFrame.paragraphs[0].runs[0].fontSize).toBeGreaterThan(16);
    expect(glyph.textFrame.paragraphs[0].runs[0].fontSize).toBeLessThanOrEqual(104);
    expect(document.pages[1].blocks[0].paragraphs).toEqual(glyph.textFrame.paragraphs);
  });

  it.each(['prefix', 'gap', 'overlap', 'grapheme'])('recovers Pages body text from invalid or incomplete saved ranges: %s', async (savedLayout) => {
    const document = await loadIwork(await createPagesLongBodyArchive({
      savedLayout, inlineDrawable: savedLayout === 'prefix'
    }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const fragments: string[] = [];
    for (const [index, page] of document.pages.entries()) {
      const paragraphs = page.blocks.flatMap(block => block.paragraphs ?? []);
      for (const paragraph of paragraphs) {
        const text = paragraph.runs.map(run => run.text).join('');
        if (['Lead paragraph.', 'Final paragraph.', 'W'].includes(text)) continue;
        for (const field of text.matchAll(/«(\d+)»/g)) expect(Number(field[1])).toBe(index + 1);
        fragments.push(text);
      }
    }
    expect(fragments.join('').replace(/«\d+»/g, '«\uFFFC»')).toBe(pagesLongBodyText);
    if (savedLayout === 'prefix') {
      expect(fragments[0]).toMatch(/Entry 10 .*\. $/u);
      expect(fragments[1]).toMatch(/^Entry 11 /u);
      expect(document.pages[1].canvas.slide.items).toHaveLength(0);
      const blocks = document.pages.flatMap(page => page.blocks);
      const image = blocks.findIndex(block => block.item?.kind === 'image');
      expect(image).toBeGreaterThan(0);
      expect(blocks[image + 1].paragraphs?.[0].runs[0].text).toMatch(/^Entry 46 /u);
      expect(blocks.filter(block => block.item?.kind === 'image')).toHaveLength(1);
    } else {
      expect(document.warnings).toContain('Pages saved layout ranges are inconsistent with the body; using estimated pagination.');
    }
    expect(document.pages.at(-1)?.blocks[0]?.paragraphs?.[0]?.runs[0]?.text).toBe('Final paragraph.');
  });

  it.each([true, false])('paginates a long Pages table with saved row heights: %s', async (fittedRows) => {
    const document = await loadIwork(await createPagesLongTableArchive({ fittedRows }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const text = (frame: { paragraphs: { runs: { text: string }[] }[] }) =>
      frame.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n');
    expect(document.pages).toHaveLength(4);
    const expected = [[1], [2, 3, 4], [5, 6, 7], [8, 9]];
    for (const [index, page] of document.pages.entries()) {
      const table = page.canvas.slide.items.find(item => item.kind === 'table');
      if (!table || table.kind !== 'table') throw new Error('Expected table rows on every page');
      expect(table.id.endsWith(`-part-${index + 1}`)).toBe(true);
      expect(table.cells.filter(cell => cell.column === 0).map(cell => text(cell.textFrame)))
        .toEqual(['Heading', ...expected[index].map(row => `Row ${row}`)]);
      expect(table.transform.y + table.transform.height).toBeLessThanOrEqual(280);
      if (index === 1) expect(table.cells.find(cell => text(cell.textFrame) === 'Merged rows')).toMatchObject({ rowSpan: 2 });
    }
    expect(document.pages[0].blocks[0]?.paragraphs?.[0].runs.map(run => run.text).join('')).toBe('Before table ');
    expect(document.pages[3].blocks[1]?.paragraphs?.[0].runs.map(run => run.text).join('')).toBe(' after table on page 4 of 4.');
    expect(document.pages[3].blocks[2]?.paragraphs?.[0].runs.map(run => run.text).join('')).toBe('Final paragraph.');
  });

  it.each([true, false])('keeps all text from an oversized Pages row with saved heights: %s', async (fittedRows) => {
    const document = await loadIwork(await createPagesLongTableArchive({ fittedRows, tallRow: true }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const text = (frame: { paragraphs: { runs: { text: string }[] }[] }) =>
      frame.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n');
    const chunks: string[] = [];
    const sideNotes: string[] = [];
    const rowLabels: string[] = [];
    const mergedRowSpans: number[] = [];
    for (const page of document.pages) {
      const table = page.canvas.slide.items.find(item => item.kind === 'table');
      if (table?.kind !== 'table') continue;
      expect(table.columns).toEqual([160, 160]);
      expect(text(table.cells.find(cell => cell.row === 0 && cell.column === 0)!.textFrame)).toBe('Heading');
      expect(table.transform.y + table.transform.height).toBeLessThanOrEqual(280);
      for (const cell of table.cells) {
        const value = text(cell.textFrame);
        if (value === 'Merged rows') mergedRowSpans.push(cell.rowSpan);
        if (cell.column !== 0 || !value || value === 'Heading') continue;
        if (/^Row \d+$/.test(value)) {
          rowLabels.push(value);
          continue;
        }
        chunks.push(value);
        const companion = table.cells.find(other => other.row === cell.row && other.column === 1);
        expect(companion).toBeDefined();
        sideNotes.push(text(companion!.textFrame));
      }
    }
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(pagesTallCellText);
    const graphemeStarts = new Set(Array.from(new Intl.Segmenter().segment(pagesTallCellText), segment => segment.index));
    let offset = 0;
    for (const chunk of chunks) {
      expect(graphemeStarts.has(offset)).toBe(true);
      offset += chunk.length;
    }
    expect(rowLabels).toEqual(Array.from({ length: 8 }, (_, index) => `Row ${index + 2}`));
    expect(mergedRowSpans).toEqual([2]);
    expect(sideNotes).toEqual(['Side note', ...chunks.slice(1).map(() => '')]);
    const last = document.pages.at(-1)!;
    expect(last.blocks.flatMap(block => block.paragraphs ?? []).map(paragraph =>
      paragraph.runs.map(run => run.text).join(''))).toEqual([
      ` after table on page ${document.pages.length} of ${document.pages.length}.`, 'Final paragraph.'
    ]);
  });

  it.each([
    { fittedRows: false, tallMerge: true },
    { fittedRows: true, tallMerge: true },
    { fittedRows: false, tallRow: true, mergeRow: 1 },
    { fittedRows: false, tallRow: true, tallMerge: true, mergeRow: 1 },
    { fittedRows: true, tallMerge: true, hideMergeAnchor: true }
  ])('paginates cells inside and alongside an oversized Pages merge: %j', async (fixture) => {
    const document = await loadIwork(await createPagesLongTableArchive(fixture), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const text = (frame: { paragraphs: { runs: { text: string }[] }[] }) =>
      frame.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n');
    const columns = [[], []] as string[][];
    let continuedMerge = false;
    let hiddenRowCount = 0;
    for (const page of document.pages) {
      const table = page.canvas.slide.items.find(item => item.kind === 'table');
      if (table?.kind !== 'table') continue;
      expect(table.transform.y + table.transform.height).toBeLessThanOrEqual(280);
      for (const [row, height] of table.rows.entries()) {
        if (table.hiddenRows?.includes(row)) {
          hiddenRowCount += 1;
          continue;
        }
        expect(height).toBeLessThanOrEqual(240);
        for (const column of [0, 1]) {
          const cells = table.cells.filter(cell => cell.column === column &&
            cell.row <= row && row < cell.row + cell.rowSpan);
          expect(cells).toHaveLength(1);
          if (cells[0].row !== row) continue;
          const value = text(cells[0].textFrame);
          if (value) {
            if (fixture.tallMerge && column === 1) expect(cells[0].borders?.right).toMatchObject({ color: '#0000ff', width: 2 });
            columns[column].push(value);
          }
        }
      }
      if (fixture.tallRow && !fixture.tallMerge && table.cells.some(cell =>
        cell.column === 0 && text(cell.textFrame).includes('Entry') && table.cells.some(other =>
          other.column === 1 && other.row <= cell.row && other.row + other.rowSpan > cell.row && !text(other.textFrame)))) {
        continuedMerge = true;
      }
    }
    const data = columns[0].filter(value => value !== 'Heading');
    const rowLabels = data.filter(value => /^Row \d+$/.test(value));
    const expectedRows = Array.from({ length: 9 }, (_, i) => i + 1)
      .filter(row => !(fixture.tallRow && row === 1) && !(fixture.hideMergeAnchor && row === 2));
    expect(rowLabels).toEqual(expectedRows.map(row => `Row ${row}`));
    expect(hiddenRowCount).toBe(Number(!!fixture.hideMergeAnchor));
    if (fixture.tallRow) expect(data.filter(value => !/^Row \d+$/.test(value)).join('')).toBe(pagesTallCellText);
    if (fixture.tallMerge) {
      expect(columns[1].length).toBeGreaterThan(1);
      expect(columns[1].join('')).toBe(pagesTallMergeText);
    } else {
      expect(columns[1]).toEqual(['Merged rows']);
      expect(continuedMerge).toBe(true);
    }
    const last = document.pages.at(-1)!;
    expect(last.blocks.flatMap(block => block.paragraphs ?? []).map(paragraph =>
      paragraph.runs.map(run => run.text).join(''))).toEqual([
      ` after table on page ${document.pages.length} of ${document.pages.length}.`, 'Final paragraph.'
    ]);
  });

  it.each([false, true])('fits an indivisible tall glyph in a Pages table row with saved heights: %s', async (fittedRows) => {
    const document = await loadIwork(await createPagesLongTableArchive({ tallGlyph: true, fittedRows }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const fragments: string[] = [];
    let glyphSize = 0;
    for (const page of document.pages) {
      for (const table of page.canvas.slide.items) {
        if (table.kind !== 'table') continue;
        expect(table.transform.y + table.transform.height).toBeLessThanOrEqual(280);
        for (const cell of table.cells) {
          if (cell.column !== 0) continue;
          const runs = cell.textFrame.paragraphs.flatMap(paragraph => paragraph.runs);
          const text = runs.map(run => run.text).join('');
          if (!text || text === 'Heading' || /^Row \d+$/.test(text)) continue;
          fragments.push(text);
          const glyph = runs.find(run => run.text === 'W');
          if (glyph) {
            expect(glyph.bold).toBe(true);
            glyphSize = glyph.fontSize ?? 0;
          }
          expect(runs.filter(run => run.text !== 'W').every(run => (run.fontSize ?? 16) === 16)).toBe(true);
        }
      }
    }
    expect(fragments.join('')).toBe('Before W after.');
    expect(glyphSize).toBeGreaterThan(16);
    expect(glyphSize).toBeLessThan(160);
  });

  it('places saved Pages text ranges in the columns of their source layout style', async () => {
    const document = await loadIwork(await createPagesSavedColumnsArchive(), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const columns = document.pages.map(page => page.canvas.slide.items.flatMap(item => item.kind === 'text' ? [{
      text: item.textFrame.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.text)).join(''),
      x: item.transform.x, y: item.transform.y, width: item.transform.width, height: item.transform.height
    }] : []));
    expect(columns).toEqual([
      [{ text: 'Left column joins ', x: 40, y: 40, width: 80, height: 240 },
        { text: 'the right column on page 1.', x: 160, y: 40, width: 200, height: 240 }],
      [{ text: 'Upper left.', x: 60, y: 52, width: 122.5, height: 86 },
        { text: 'Upper right.', x: 217.5, y: 52, width: 122.5, height: 86 },
        { text: 'Lower left.', x: 60, y: 158, width: 70, height: 90 },
        { text: 'Lower right.', x: 165, y: 158, width: 175, height: 90 }],
      [{ text: 'Saved left.', x: 49, y: 50, width: 98, height: 140 },
        { text: 'Saved right.', x: 176, y: 50, width: 174, height: 140 }],
      [{ text: 'Full-width text.', x: 40, y: 40, width: 320, height: 240 }]
    ]);
  });

  it.each([false, true])('lays out Pages columns from a saved whole-page range (overflow %s)', async (overflow) => {
    const document = await loadIwork(await createPagesAggregateColumnsArchive({ overflow }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(4);
    const paragraphs = (index: number) => document.pages[index].blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join(''));
    const [first, second, blank, last] = document.pages.map(page => page.canvas.slide.items);
    const geometry = (items: typeof first) => items.filter(item => item.kind === 'text')
      .map(({ transform: { x, y, width } }) => [x, y, width]);
    expect(geometry(first)).toEqual([[40, 52, 140], [40, 136, 140], [220, 52, 140]]);
    expect(first.filter(item => item.kind === 'image').map(item => item.transform)).toMatchObject([{ x: 40, y: 92, height: 44 }]);
    expect(paragraphs(0).join('')).toBe(pagesAggregateColumnText.replace('\n\uFFFC\n', '').replace('\uFFFC', '1'));
    expect(geometry(second)).toEqual([[56, 64, 72], [164, 64, 180]]);
    expect(paragraphs(1).filter(Boolean)).toEqual([
      ...(overflow ? Array.from({ length: 9 }, (_, i) => `Archived left ${i + 1}.`) : []), 'Left stops here.', 'Right starts here.',
      ...(overflow ? Array.from({ length: 20 }, (_, i) => `Archived right ${i + 1}.`) : []), 'End of page 2.']);
    expect(blank).toEqual([]);
    expect(geometry(last)).toEqual([[40, 40, 320]]);
    expect(paragraphs(3)).toEqual(['Saved page 4 of 4.']);
  });

  it('keeps grapheme clusters intact across estimated unequal Pages columns', async () => {
    const document = await loadIwork(await createPagesAggregateColumnsArchive({ savedLayout: false, overflow: true }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const pageCount = document.pages.length;
    expect(pageCount).toBeGreaterThan(3);
    const fragments = document.pages.flatMap(page => page.blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join('')));
    expect(fragments.at(-1)).toBe(`Full on page ${pageCount} of ${pageCount}.`);
    const start = fragments.indexOf('Wide on page 2.') + 1;
    expect(start).toBeGreaterThan(0);
    const parts = fragments.slice(start, -1);
    expect(parts.join('')).toBe(pagesEstimatedColumnOverflowText);
    const boundaries = new Intl.Segmenter().segment(pagesEstimatedColumnOverflowText);
    let offset = 0;
    for (const part of parts) {
      expect(boundaries.containing(offset)?.index).toBe(offset);
      offset += part.length;
    }
    const widths = new Set(document.pages.slice(2).flatMap(page => page.canvas.slide.items
      .filter(item => item.kind === 'text').map(item => item.transform.width)));
    expect(widths).toEqual(new Set([80, 200, 320]));
  });

  it.each([true, 'long', 'leading', 'image', 'split'])('continues text displaced by a saved Pages inline object: %j', async (savedFlow) => {
    const document = await loadIwork(await createPagesLongTableArchive({
      dataRows: 3, fittedRows: true, savedFlow
    }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const pageCount = document.pages.length;
    if (savedFlow === 'long') expect(pageCount).toBeGreaterThan(5);
    else expect(pageCount).toBe(savedFlow === 'leading' ? 5 : 4);
    const text = (page: typeof document.pages[number]) => page.blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join('')).join('');
    const objectPage = savedFlow === 'leading' ? 1 : 0;
    const continuedPage = objectPage + 1;
    const image = savedFlow === 'image';
    const label = image ? 'image' : 'table';
    if (savedFlow === 'leading') expect(text(document.pages[0])).toBe('Saved lead ');
    expect(document.pages[objectPage].blocks.map(block => block.kind)).toEqual([image ? 'drawable' : 'table']);
    expect(document.pages[objectPage].canvas.slide.items[0]).toMatchObject({ kind: label, transform: { y: 40, height: 240 } });
    expect(text(document.pages[continuedPage])).toMatch(new RegExp(`^ After ${label} on page ${continuedPage + 1} of ${pageCount}\\.`));
    expect(document.pages.at(-2)?.blocks).toEqual([]);
    const last = document.pages.at(-1)!;
    expect(last.canvas.slide.items[0].transform).toMatchObject({ x: 57, y: 63, width: 268, height: 190 });
    expect(last.canvas.slide.items[1]).toMatchObject({ kind: 'image', transform: { x: 332, y: 55, width: 20, height: 24 } });
    expect(document.pages.flatMap(page => page.canvas.slide.items).filter(item => item.kind === 'image')).toHaveLength(image ? 2 : 1);
    expect(text(last)).toBe(`Saved next on page ${pageCount} of ${pageCount}.`);
    const continued = document.pages.slice(continuedPage, -2).map(text).join('');
    const longTail = savedFlow === 'long' ? pagesLongBodyText.replaceAll('\uFFFC', '') : '';
    expect(continued).toBe(` After ${label} on page ${continuedPage + 1} of ${pageCount}.${longTail}Final paragraph.${savedFlow === 'split' ? ' ' : ''}`);
  });

  it.each([
    [5, false], [5, true], [4, false]
  ])('places saved Pages table partitions and their trailing text (%i rows, packed origin %s)', async (dataRows, packedPartitions) => {
    const document = await loadIwork(await createPagesLongTableArchive({
      dataRows, fittedRows: true, savedFlow: 'partition', packedPartitions
    }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    const continued = dataRows === 5;
    const pageCount = continued ? 5 : 4;
    const paragraphs = (page: typeof document.pages[number]) => page.blocks.flatMap(block => block.paragraphs ?? [])
      .map(paragraph => paragraph.runs.map(run => run.text).join(''));
    expect(document.pages.map(paragraphs)).toEqual([
      ['Saved lead '], ...(continued ? [[]] : []), [`After table on page ${continued ? 3 : 2} of ${pageCount}.`, 'Final paragraph.'],
      [], [`Saved next on page ${pageCount} of ${pageCount}.`]
    ]);
    const tables = document.pages.flatMap(page => page.canvas.slide.items.filter(item => item.kind === 'table'));
    expect(tables).toHaveLength(2);
    const rows = tables.map(table => table.cells.filter(cell => cell.column === 0)
      .map(cell => cell.textFrame.paragraphs.flatMap(paragraph => paragraph.runs).map(run => run.text).join('')));
    expect(rows).toEqual([['Heading', 'Row 1'], Array.from({ length: dataRows - 1 }, (_, index) => `Row ${index + 2}`)]);
    expect(document.pages[0].canvas.slide.items).toContain(tables[0]);
    expect(document.pages[1].canvas.slide.items[0]).toBe(tables[1]);
    expect(tables[1].transform).toMatchObject({ x: 53, y: 40, width: 287, height: (dataRows - 1) * 60 });
    expect(document.pages.at(-2)?.canvas.slide.items).toEqual([]);
    expect(document.pages.at(-1)?.canvas.slide.items.map(item => item.transform)).toMatchObject([
      { x: 57, y: 63, width: 268, height: 190 }, { x: 332, y: 55, width: 20, height: 24 }
    ]);
  });

  it('moves trailing text to the next page when the final Pages table part fills the body', async () => {
    const document = await loadIwork(await createPagesLongTableArchive({ dataRows: 10 }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(5);
    expect(document.pages[3].blocks.map(block => block.kind)).toEqual(['table']);
    expect(document.pages[4].blocks.flatMap(block => block.paragraphs ?? []).map(paragraph =>
      paragraph.runs.map(run => run.text).join(''))).toEqual([' after table on page 5 of 5.', 'Final paragraph.']);
  });

  it('keeps a one-page table whole when the surrounding text makes its paragraph taller than a page', async () => {
    const document = await loadIwork(await createPagesLongTableArchive({ dataRows: 3 }), { hint: 'pages' });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages.map(page => page.blocks.map(block => block.kind))).toEqual([
      ['paragraphs'], ['table'], ['paragraphs', 'paragraphs']
    ]);
    expect(document.pages[1].blocks[0].item).toMatchObject({ rows: [60, 60, 60, 60] });
    expect(document.pages[2].blocks[0]?.paragraphs?.[0].runs.map(run => run.text).join('')).toBe(' after table on page 3 of 3.');
  });

  it('retains sparse trailing cells and row-tree positions across the full Numbers workbook', async () => {
    const document = await loadIwork(await readFixture('../../apps/demo/public/samples/a.numbers'), { hint: 'numbers' });
    if (document.kind !== 'numbers') throw new Error('Expected Numbers document');
    expect(document.sheets).toHaveLength(6);
    const tables = document.sheets.flatMap(sheet => sheet.tables);
    expect(tables).toHaveLength(14);
    const text = (table: number, row: number, column: number) => tables[table].item.cells
      .find(cell => cell.row === row && cell.column === column)?.textFrame.paragraphs
      .map(p => p.runs.map(r => r.text).join('')).join('\n');
    expect(tables.flatMap(table => table.item.cells).filter(cell => cell.textFrame.paragraphs
      .some(p => p.runs.some(r => r.text.trim())))).toHaveLength(5772);
    expect(text(0, 32, 10)).toBe('$0.000278');
    expect(text(7, 47, 0)).toBe('aws');
    expect(text(8, 0, 12)).toBe('billedTime');
    expect(text(8, 46, 12)).toBe('1.079');
  });

  it('loads numbers fixtures into sheet canvases with parsed tables', async () => {
    const document = await loadIwork(await readFixture('vendor/iwork-converter/testdata/a.numbers'));

    expect(document.kind).toBe('numbers');
    if (document.kind !== 'numbers') {
      return;
    }

    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe('工作表 1');
    expect(document.sheets[0]?.tables).toHaveLength(2);
    expect(document.sheets[0]?.tables.map((table) => table.item.name)).toEqual(['数盟指标统计', '各指标和大盘对比']);
    expect(document.sheets[0]?.tables.map((table) => table.item.rows.length)).toEqual([11, 10]);
    expect(document.sheets[0]?.tables.map((table) => table.item.columns.length)).toEqual([13, 11]);
    expect(document.sheets[0]?.tables.flatMap((table) => table.item.columns).every((width) => width > 0)).toBe(true);
    expect(document.sheets[0]?.canvas.width).toBeCloseTo(722, 1);
    expect(document.sheets[0]?.canvas.height).toBeCloseTo(872, 1);

    const footerTextItem = document.sheets[0]?.canvas.slide.items.find(
      (item) =>
        item.kind === 'text' &&
        item.name === 'footer-1' &&
        item.textFrame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text === '1'))
    );
    expect(footerTextItem && footerTextItem.kind === 'text').toBe(true);

    const getCellText = (tableIndex: number, row: number, column: number): string | undefined => {
      const cell = document.sheets[0]?.tables[tableIndex]?.item.cells.find(
        (candidate) => candidate.row === row && candidate.column === column
      );
      return cell?.textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
    };

    expect(getCellText(0, 1, 6)).toBe('230.45');
    expect(getCellText(0, 1, 10)).toBe('-214.4');
    expect(getCellText(1, 1, 4)).toBe('254.55%');
    expect(getCellText(1, 1, 7)).toBe('136.84%');
    expect(getCellText(1, 7, 4)).toBe('536.36%');
  });
});

describe('iWork preview driver', () => {
  it('overrides iWork conversion routes with native driver routes', () => {
    const routes = createIworkPreviewRoutes();
    const keyRoute = routes.find((route) => route.extensions.includes('key'));
    const pagesRoute = routes.find((route) => route.extensions.includes('pages'));
    const numbersRoute = routes.find((route) => route.extensions.includes('numbers'));

    expect(keyRoute).toMatchObject({
      targetFormat: 'key',
      family: 'paged',
      driverId: 'iwork'
    });
    expect(pagesRoute).toMatchObject({
      targetFormat: 'pages',
      family: 'paged',
      driverId: 'iwork'
    });
    expect(numbersRoute).toMatchObject({
      targetFormat: 'numbers',
      family: 'workbook',
      driverId: 'iwork'
    });
    expect(keyRoute?.conversion).toBeUndefined();
  });

  it('exposes a generic preview driver for iWork formats', () => {
    const driver = createIworkPreviewDriver();

    expect(driver.id).toBe('iwork');
    expect(driver.family).toBe('paged');
    expect(driver.supports('key')).toBe(true);
    expect(driver.supports('.pages')).toBe(true);
    expect(driver.supports('numbers')).toBe(true);
    expect(driver.supports('pptx')).toBe(false);
    expect(driver.createSession).toEqual(expect.any(Function));
  });
});
