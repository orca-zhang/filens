import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import {
  createPagesAggregateColumnsArchive, createPagesLongBodyArchive, createPagesLongTableArchive, createPagesNumberingArchive,
  createPagesParagraphBreakArchive, createPagesSavedColumnsArchive, createPagesSavedTextFitArchive,
  pagesAggregateColumnText, pagesLongBodyText, pagesSavedTextLines, pagesTallCellText, pagesTallMergeText, pagesWrappedTableTail
} from '../../../packages/iwork/test/fixtures/pages-archive.mjs';

test('renders the saved headers, footers and inline image of a Pages document', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  await page.evaluate(async url => {
    const { createIworkViewer } = await import(/* @vite-ignore */ url);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const viewer = createIworkViewer(host);
    Object.assign(window, { pagesSections: viewer });
    const source = await (await fetch(new URL('samples/a.pages', location.href))).blob();
    await viewer.preview(source, { cache: false });
  }, moduleUrl);

  const sourceHeader = 'Apple Pages Import Fixture • generated source DOCX';
  const sourceFooter = 'Fixture coverage: headings, styles, lists, table, image, link, section break, unicode text';
  const margins = await page.evaluate(() => (window as any).pagesSections.getState().document.pages.map((page: any) => {
    const { items, height } = page.canvas.slide;
    const header = items.find(item => item.name === 'header-1');
    const footer = items.find(item => item.name === 'footer-1');
    return [header.transform.y, (height ?? page.canvas.height) - footer.transform.y - footer.transform.height];
  }));
  expect(margins).toEqual([[36, 36], [36, 36], [36, 36]]);
  for (const index of [0, 1, 2]) {
    await page.evaluate(index => (window as any).pagesSections.goToPage(index), index);
    const shell = page.locator(`.iworkv-page-shell[data-page-index="${index}"]`);
    const header = shell.locator('.pptxv-paragraph').filter({ hasText: index === 2 ? /^Landscape section$/ : sourceHeader });
    await expect(header).toBeVisible();
    await expect(header).toHaveCSS('text-align', 'center');
    await expect(shell.getByText(index === 2 ? 'End of fixture' : sourceFooter, { exact: true })).toBeVisible();
    if (index === 0) {
      const table = shell.locator('.pptxv-table');
      const cell = table.getByRole('cell', { name: 'Alt text may or may not survive conversion', exact: true });
      const heading = shell.getByText('4. Link and image', { exact: true });
      await expect(cell).toBeVisible();
      const cellLayout = await cell.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element.querySelector('.pptxv-run')!);
        const lines = Array.from(range.getClientRects());
        const bottom = element.getBoundingClientRect().bottom;
        return { lines: new Set(lines.map(line => Math.round(line.top))).size, fits: lines.every(line => line.bottom <= bottom + 0.5) };
      });
      expect(cellLayout.lines).toBeGreaterThan(1);
      expect(cellLayout.fits).toBe(true);
      const tableBounds = (await table.boundingBox())!;
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(tableBounds.y + tableBounds.height - 1);
    }
    if (index === 1) {
      const image = shell.getByAltText('Data/image1-31.png', { exact: true });
      const caption = shell.getByText('Figure 1. Embedded chart image generated for this fixture.', { exact: true });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([1000, 520]);
      await expect(caption).toBeVisible();
      const imageBounds = (await image.boundingBox())!;
      expect(imageBounds.y + imageBounds.height).toBeLessThanOrEqual((await caption.boundingBox())!.y + 1);
    }
    if (index === 2) {
      await expect(shell.getByText(sourceFooter, { exact: true })).toHaveCount(0);
      const heading = shell.getByText('5. Landscape section and wider table', { exact: true });
      await expect(heading).toBeVisible();
      await expect(heading).toHaveCSS('font-size', '14px');
      const tables = shell.locator('.pptxv-table');
      await expect(tables).toHaveCount(2);
      const paper = (await shell.locator('.pptxv-slide').boundingBox())!;
      for (const table of await tables.all()) {
        const bounds = (await table.boundingBox())!;
        expect((bounds.x + bounds.width - paper.x) / paper.width).toBeLessThan(562.6 / 612);
      }
      const end = shell.getByText(/^END_OF_PAGES_IMPORT_FIXTURE/);
      await expect(end).toBeVisible();
      const lastTable = (await tables.last().boundingBox())!;
      const endBounds = (await end.boundingBox())!;
      expect(endBounds.y).toBeGreaterThanOrEqual(lastTable.y + lastTable.height - 1);
      expect(endBounds.y + endBounds.height).toBeLessThan(paper.y + paper.height);
    }
  }
  await page.evaluate(() => (window as any).pagesSections.destroy());
  expect(errors).toEqual([]);
});

test('fits multiline Pages text in saved rectangles and keeps severe overflow readable', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'saved-text.pages', mimeType: 'application/vnd.apple.pages', buffer: Buffer.from(await createPagesSavedTextFitArchive())
  });
  const shells = page.locator('.iworkv-page-shell');
  await expect(shells).toHaveCount(3);
  for (const [index, shell] of (await shells.all()).entries()) {
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const item = shell.locator('.pptxv-item--text');
    const frame = item.locator('.pptxv-text-frame');
    const expected = pagesSavedTextLines[index].map(line => line.replace('Page \uFFFC of \uFFFC.', `Page ${index + 1} of 3.`));
    await expect(frame.locator('.pptxv-paragraph')).toHaveText(expected);
    const metrics = await frame.evaluate(element => {
      const item = element.parentElement!.getBoundingClientRect();
      const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(element);
      const last = document.createRange();
      last.selectNodeContents(element.lastElementChild!);
      const glyphs = text.getBoundingClientRect();
      const scale = paper.height / 320;
      return {
        box: [(item.left - paper.left) / scale, (item.top - paper.top) / scale, item.width / scale, item.height / scale],
        overflow: (glyphs.bottom - item.bottom) / scale, transform: getComputedStyle(element).transform,
        scrollable: element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto',
        lastBottom: (last.getBoundingClientRect().bottom - item.bottom) / scale
      };
    });
    const expectedBox = [60, 55, 260, [120, 88, 90][index]];
    for (const [axis, value] of metrics.box.entries()) expect(value).toBeCloseTo(expectedBox[axis], 1);
    if (index < 2) {
      expect(metrics.overflow, JSON.stringify(metrics)).toBeLessThanOrEqual(0.5);
      expect(metrics.scrollable).toBe(false);
      if (index === 0) expect(metrics.transform).toBe('none');
      else expect(metrics.transform).not.toBe('none');
    } else {
      expect(metrics.scrollable).toBe(true);
      expect(metrics.transform).toBe('none');
      expect(metrics.lastBottom).toBeGreaterThan(0);
      await expect(frame.locator('.pptxv-run').first()).toHaveCSS('font-size', '20px');
      await frame.focus();
      await expect(frame).toBeFocused();
      await page.keyboard.press('End');
      await expect.poll(() => frame.evaluate(element => element.scrollTop)).toBeGreaterThan(50);
      await expect.poll(() => frame.evaluate(element => {
        const last = document.createRange();
        last.selectNodeContents(element.lastElementChild!);
        return last.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1;
      })).toBe(true);
    }
  }
});

test('remeasures saved Pages text when refreshing font layout', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
  const source = Array.from(await createPagesSavedTextFitArchive());
  await page.evaluate(async ({ moduleUrl, source }) => {
    const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'saved-pages-fit';
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const viewer = createIworkViewer(host);
    Object.assign(window, { savedPagesViewer: viewer });
    await viewer.preview(new File([Uint8Array.from(source)], 'saved-text.pages'));
    viewer.goToPage(1);
  }, { moduleUrl, source });
  const frame = page.locator('.iworkv-page-shell[data-page-index="1"] .pptxv-text-frame');
  await expect(frame).not.toHaveCSS('transform', 'none');
  await page.addStyleTag({ content: `
    #saved-pages-fit .pptxv-paragraph, #saved-pages-fit .pptxv-run {font-size:14px!important}
    #saved-pages-fit .pptxv-paragraph {line-height:18px!important}
  ` });
  await page.evaluate(() => (window as any).savedPagesViewer.refreshFonts());
  await expect(frame).toHaveCSS('transform', 'none');
  await expect(frame.getByText('Page 2 of 3.')).toBeVisible();
  await page.evaluate(() => (window as any).savedPagesViewer.destroy());
});

for (const fixture of ['body', 'table', 'prefix', 'gap', 'overlap', 'glyph']) {
  test(`keeps all Pages text within page bounds with ${fixture} layout`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    const inTable = fixture === 'table';
    const bytes = inTable ? await createPagesLongTableArchive({ tallGlyph: true, fittedRows: true })
      : await createPagesLongBodyArchive({ savedLayout: fixture === 'body' ? undefined : fixture });
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'long-text.pages', mimeType: 'application/vnd.apple.pages', buffer: Buffer.from(bytes)
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells.first()).toBeVisible();
    const text: string[] = [];
    let glyphs = 0;
    for (const [index, shell] of (await shells.all()).entries()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      const paragraphs = await paper.evaluate((element, inTable) => {
        const paper = element.getBoundingClientRect();
        const selection = inTable ? '.pptxv-table td:first-child .pptxv-paragraph' : '.pptxv-item--text .pptxv-paragraph';
        return Array.from(element.querySelectorAll(selection)).flatMap(paragraph => {
          const text = paragraph.textContent;
          if (!text?.trim() || /^(?:Heading|Row \d+|Lead paragraph\.|Final paragraph\.)$/.test(text)) return [];
          const cell = paragraph.closest('td')?.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const rects = Array.from(range.getClientRects());
          const glyph = text === 'W' ? paragraph.querySelector('.pptxv-run') : undefined;
          const bottom = Math.max(...rects.map(rect => rect.bottom));
          return [{
            text,
            fontSize: glyph ? Number.parseFloat(getComputedStyle(glyph).fontSize) : 0,
            paperTop: (Math.min(...rects.map(rect => rect.top)) - paper.top) / paper.height,
            paperBottom: (bottom - paper.top) / paper.height,
            cellBottom: cell ? bottom - cell.bottom : 0,
            cellRight: cell ? Math.max(...rects.map(rect => rect.right)) - cell.right : 0
          }];
        });
      }, inTable);
      if (fixture === 'prefix') {
        if (index === 0) expect(paragraphs[0]?.text).toMatch(/Entry 10 .*\. $/u);
        if (index === 1) expect(paragraphs).toHaveLength(0);
        if (index === 2) expect(paragraphs[0]?.text).toMatch(/^Entry 11 /u);
      }
      for (const paragraph of paragraphs) {
        expect(paragraph.paperBottom).toBeLessThan(282 / 320);
        expect(paragraph.cellBottom).toBeLessThanOrEqual(1);
        expect(paragraph.cellRight).toBeLessThanOrEqual(1);
        if (paragraph.fontSize) {
          expect(paragraph.paperTop).toBeGreaterThan(38 / 320);
          expect(paragraph.fontSize).toBeGreaterThan(16);
          expect(paragraph.fontSize).toBeLessThan(inTable ? 160 : 240);
          if (fixture === 'glyph') {
            expect(index).toBe(1);
            expect(paragraph.paperTop).toBeGreaterThan(64 / 320);
            expect(paragraph.paperBottom).toBeLessThan(196 / 320);
          }
          glyphs += 1;
          if (!inTable) continue;
        }
        for (const field of paragraph.text.matchAll(/«(\d+)»/g)) expect(Number(field[1])).toBe(index + 1);
        text.push(paragraph.text);
      }
    }
    expect(glyphs).toBe(1);
    if (inTable) expect(text.join('')).toBe('Before W after.');
    else if (fixture !== 'glyph') expect(text.join('').replace(/«\d+»/g, '«\uFFFC»')).toBe(pagesLongBodyText);
    await expect(shells.last().getByText('Final paragraph.', { exact: true })).toBeVisible();
  });
}

test('renders saved Pages column breaks, widths and gutters', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'saved-columns.pages', mimeType: 'application/vnd.apple.pages', buffer: Buffer.from(await createPagesSavedColumnsArchive())
  });
  const shells = page.locator('.iworkv-page-shell');
  await expect(shells).toHaveCount(4);
  const expected = [
    [['Left column joins', 40, 40, 80], ['the right column on page 1.', 160, 40, 200]],
    [['Upper left.', 60, 52, 122.5], ['Upper right.', 217.5, 52, 122.5],
      ['Lower left.', 60, 158, 70], ['Lower right.', 165, 158, 175]],
    [['Saved left.', 49, 50, 98], ['Saved right.', 176, 50, 174]],
    [['Full-width text.', 40, 40, 320]]
  ] as const;
  for (const [index, shell] of (await shells.all()).entries()) {
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const paper = shell.locator('.pptxv-slide');
    const columns = paper.locator('.pptxv-item--text');
    const wanted = expected[index];
    await expect(columns).toHaveText(wanted.map(([text]) => text));
    const positions = await paper.evaluate(element => {
      const paper = element.getBoundingClientRect();
      const scale = paper.width / 400;
      return Array.from(element.querySelectorAll('.pptxv-item--text'), column => {
        const rect = column.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(column.querySelector('.pptxv-text-frame')!);
        const text = range.getBoundingClientRect();
        return { bounds: [(rect.x - paper.x) / scale, (rect.y - paper.y) / scale, rect.width / scale],
          textOverhang: (text.right - rect.right) / scale };
      });
    });
    for (const [column, [, x, y, width]] of wanted.entries()) {
      const { bounds, textOverhang } = positions[column];
      [x, y, width].forEach((value, dimension) => expect(bounds[dimension]).toBeCloseTo(value, 1));
      expect(textOverhang).toBeLessThan(1);
    }
  }
});

for (const overflow of [false, true]) {
  test(`flows Pages text from a saved whole-page range into columns (overflow ${overflow})`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'aggregate-columns.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesAggregateColumnsArchive({ overflow }))
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells).toHaveCount(4);
    const expected = [[[40, 52, 140], [40, 136, 140], [220, 52, 140]], [[56, 64, 72], [164, 64, 180]], [], [[40, 40, 320]]];
    for (const [index, shell] of (await shells.all()).entries()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      const items = paper.locator('.pptxv-item--text');
      const paragraphs = items.locator('.pptxv-paragraph');
      await expect(items).toHaveCount(expected[index].length);
      const bounds = await paper.evaluate(element => {
        const paper = element.getBoundingClientRect();
        const scale = paper.width / 400;
        return Array.from(element.querySelectorAll('.pptxv-item--text'), item => {
          const rect = item.getBoundingClientRect();
          return [(rect.x - paper.x) / scale, (rect.y - paper.y) / scale, rect.width / scale];
        });
      });
      bounds.forEach((rect, item) => rect.forEach((value, axis) => expect(value).toBeCloseTo(expected[index][item][axis], 1)));
      if (index === 0) {
        expect((await paragraphs.allTextContents()).join('')).toBe(pagesAggregateColumnText.replace('\n\uFFFC\n', '').replace('\uFFFC', '1'));
        const image = paper.locator('img[alt$="Column.svg"]');
        await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(65);
        const figure = (await image.boundingBox())!;
        expect(figure.y).toBeGreaterThan((await items.first().boundingBox())!.y);
        expect(figure.y + figure.height).toBeLessThanOrEqual((await items.nth(1).boundingBox())!.y + 1);
      } else if (index === 1) {
        const columns = [
          [...(overflow ? Array.from({ length: 9 }, (_, i) => `Archived left ${i + 1}.`) : []), 'Left stops here.'],
          ['Right starts here.', ...(overflow ? Array.from({ length: 20 }, (_, i) => `Archived right ${i + 1}.`) : []), 'End of page 2.']
        ];
        for (const [column, lines] of columns.entries()) {
          const item = items.nth(column);
          await expect(item.locator('.pptxv-paragraph')).toHaveText(lines);
          const scroll = item.getByRole('region', { name: 'Page text' });
          await expect(scroll).toHaveCount(Number(overflow));
          if (overflow) {
            await scroll.focus();
            await page.keyboard.press('End');
            await expect.poll(() => scroll.evaluate(element => {
              const range = document.createRange();
              range.selectNodeContents(element.lastElementChild!);
              return range.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom;
            })).toBeLessThanOrEqual(1);
          }
        }
      } else if (index === 3) {
        await expect(paragraphs).toHaveText(['Saved page 4 of 4.']);
      }
    }
  });
}

for (const offset of [0, 2]) {
  test(`estimates Pages columns and layout changes after ${offset} saved pages`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'estimated-columns.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesAggregateColumnsArchive({ savedLayout: offset ? 'prefix' : false }))
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells).toHaveCount(offset + 2);
    if (offset) {
      const prefix = shells.first().locator('.pptxv-item--text');
      await expect(prefix).toHaveText('Saved prefix.');
      await expect(prefix).toHaveCSS('left', '52px');
      await shells.nth(1).scrollIntoViewIfNeeded();
      await expect(shells.nth(1).locator('.pptxv-item')).toHaveCount(0);
    }
    const first = shells.nth(offset).locator('.pptxv-slide');
    const second = shells.last().locator('.pptxv-slide');
    await first.scrollIntoViewIfNeeded();
    const firstText = first.locator('.pptxv-item--text');
    await expect(firstText.nth(0)).toHaveText('Equal left.');
    await expect(firstText.nth(1)).toHaveText('Left joins');
    await expect(first.getByText(`right on page ${offset + 1}.`, { exact: true })).toBeVisible();
    const image = first.locator('img[alt$="Column.svg"]');
    await expect(image).toBeVisible();
    await second.scrollIntoViewIfNeeded();
    const secondText = second.locator('.pptxv-item--text');
    await expect(secondText).toHaveCount(4);
    await expect(secondText.nth(1)).toHaveText('Narrow.');
    await expect(secondText.nth(2)).toHaveText(`Wide on page ${offset + 2}.`);
    await expect(secondText.nth(3)).toHaveText(`Full on page ${offset + 2} of ${offset + 2}.`);
    const measure = (paper: typeof first) => paper.locator('.pptxv-item--text').evaluateAll(items => items.map(item => {
      const paper = item.closest('.pptxv-slide')!.getBoundingClientRect();
      const frame = item.getBoundingClientRect();
      const scale = paper.width / 400;
      const range = document.createRange();
      range.selectNodeContents(item.querySelector('.pptxv-text-frame')!);
      const content = range.getBoundingClientRect();
      return {
        x: Math.round((frame.x - paper.x) / scale), width: Math.round(frame.width / scale),
        y: Math.round((frame.y - paper.y) / scale), bottom: Math.round((content.bottom - paper.top) / scale)
      };
    }));
    const firstBounds = await measure(first);
    const secondBounds = await measure(second);
    expect(firstBounds.map(({ x, width }) => [x, width])).toEqual(firstBounds.map((_, index) => [index < 2 ? 40 : 220, 140]));
    expect(secondBounds.map(({ x, width }) => [x, width])).toEqual([[40, 140], [40, 80], [160, 200], [40, 320]]);
    expect([...firstBounds, ...secondBounds].every(({ bottom }) => bottom <= 281)).toBe(true);
    expect(secondBounds[1].y).toBeGreaterThanOrEqual(secondBounds[0].bottom - 1);
    expect(secondBounds[3].y).toBeGreaterThanOrEqual(secondBounds[2].bottom - 1);
    const lines = await page.locator('.iworkv-page-shell .pptxv-paragraph').allTextContents();
    expect(lines.filter(text => /^Equal \d+\.$/.test(text))).toEqual(Array.from({ length: 14 }, (_, i) => `Equal ${i + 1}.`));
  });
}

test('uses a new physical page for a Pages paragraph break in estimated columns', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'styled-page-break.pages', mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesParagraphBreakArchive({ columns: true, savedPrefix: true }))
  });
  const shells = page.locator('.iworkv-page-shell');
  await expect(shells).toHaveCount(4);
  await expect(shells.nth(0).locator('.pptxv-paragraph')).toHaveText('Saved prefix.');
  await shells.nth(1).scrollIntoViewIfNeeded();
  await expect(shells.nth(1).locator('.pptxv-slide')).toBeVisible();
  await expect(shells.nth(1).locator('.pptxv-item')).toHaveCount(0);
  const before = shells.nth(2).locator('.pptxv-item--text');
  await shells.nth(2).scrollIntoViewIfNeeded();
  await expect(before.locator('.pptxv-paragraph')).toHaveText(['Opening page 3.', 'Before the break.']);
  const after = shells.nth(3).locator('.pptxv-item--text');
  await shells.nth(3).scrollIntoViewIfNeeded();
  await expect(after.locator('.pptxv-paragraph')).toHaveText(['Styled page 4.', 'Same page.', 'Right of page 4.', 'Last on page 4 of 4.']);
  await expect(after.filter({ hasText: 'Styled page 4.' })).toHaveCSS('left', '40px');
  await expect(after.filter({ hasText: 'Right of page 4.' })).toHaveCSS('left', '220px');
  await expect(after.getByText('Right of page 4.', { exact: true })).toHaveCSS('font-size', '18px');
  await expect(after.getByText('Last on page 4 of 4.', { exact: true })).toHaveCSS('font-size', '14px');
});

for (const estimatedColumns of ['equal', 'unequal']) {
  test(`continues estimated Pages tables across ${estimatedColumns} columns and pages when rows grow`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'estimated-column-table.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({ dataRows: 8, estimatedColumns }))
    });
    const shells = page.locator('.iworkv-page-shell');
    const check = async (pages: number, expected: number[][]) => {
      await expect(shells).toHaveCount(pages);
      for (const [index, rows] of expected.entries()) {
        const shell = shells.nth(Math.floor(index / 2));
        await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
        const table = shell.locator('.pptxv-table').nth(index % 2);
        await expect(table.locator('tr > td:first-child')).toHaveText(['Heading', ...rows.map(row => `Row ${row}`)]);
        const bounds = await table.evaluate(element => {
          const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return { x: (box.left - paper.left) * 400 / paper.width, bottom: (box.bottom - paper.top) * 320 / paper.height,
            width: box.width * 400 / paper.width };
        });
        expect(bounds.x).toBeCloseTo(index % 2 ? (estimatedColumns === 'equal' ? 220 : 200) : 40, 0);
        expect(Math.abs(bounds.width - (estimatedColumns === 'equal' ? 140 : 120))).toBeLessThan(1.5);
        expect(bounds.bottom).toBeLessThan(282);
        if (rows.includes(2)) await expect(table.getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
      }
      await expect(shells.last().getByText(`after table on page ${pages} of ${pages}.`, { exact: true })).toBeVisible();
    };
    const initial = [[1], [2, 3, 4], [5, 6, 7], [8]];
    await check(2, initial);
    const growth = await page.addStyleTag({ content: '.iworkv-body-flow .pptxv-table tr { height: 75px !important; }' });
    await check(3, [[1], [2, 3], [4, 5], [6, 7], [8]]);
    await growth.evaluate(style => style.remove());
    await check(2, initial);
  });
}

test('paginates a long inline Pages table without saved page hints', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'long-table.pages', mimeType: 'application/vnd.apple.pages', buffer: Buffer.from(await createPagesLongTableArchive())
  });
  const shells = page.locator('.iworkv-page-shell');
  await expect(shells).toHaveCount(4);
  for (const [index, rows] of [[1], [2, 3, 4], [5, 6, 7], [8, 9]].entries()) {
    const shell = shells.nth(index);
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const table = shell.locator('.pptxv-table');
    await expect(table.locator('tr > td:first-child')).toHaveText(['Heading', ...rows.map(row => `Row ${row}`)]);
    const bounds = (await table.boundingBox())!;
    const paper = (await shell.locator('.pptxv-slide').boundingBox())!;
    expect((bounds.y + bounds.height - paper.y) / paper.height).toBeLessThan(282 / 320);
    if (index === 0) {
      const lead = shell.getByText('Before table', { exact: true });
      await expect(lead).toBeVisible();
      expect((await lead.boundingBox())!.y).toBeLessThan(bounds.y);
    }
    if (index === 1) await expect(table.getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
    if (index === 3) {
      const tail = shell.getByText('after table on page 4 of 4.', { exact: true });
      await expect(tail).toBeVisible();
      expect((await tail.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 1);
      await expect(shell.getByText('Final paragraph.', { exact: true })).toBeVisible();
    }
  }
});

for (const dataRows of [3, 9]) {
  test(`recalculates estimated Pages table breaks after browser rows grow (${dataRows} data rows)`, async ({ page }) => {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
    const source = Array.from(await createPagesLongTableArchive({ dataRows, rowHeight: dataRows === 3 ? 48 : 60 }));
    const scale = dataRows === 3 ? 1 : 1.92;
    await page.evaluate(async ({ moduleUrl, source, scale }) => {
      const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = `position:fixed;inset:0 0 auto;height:${320 * scale}px`;
      document.body.replaceChildren(host);
      const viewer = createIworkViewer(host, { virtual: false, fit: 'none', initialScale: scale });
      await viewer.preview(new File([Uint8Array.from(source)], 'estimated-table.pages'));
      Object.assign(window, { estimatedPagesViewer: viewer });
    }, { moduleUrl, source, scale });
    const shells = page.locator('.iworkv-page-shell');
    const initialCount = dataRows === 3 ? 2 : 4;
    await expect(shells).toHaveCount(initialCount);
    const initialTail = page.getByText(`after table on page ${dataRows === 3 ? 1 : 4} of ${initialCount}.`, { exact: true });
    await expect(initialTail).toBeVisible();
    const currentPage = () => page.evaluate(() => (window as any).estimatedPagesViewer.getState().currentPage);
    if (dataRows === 9) {
      await page.evaluate(() => (window as any).estimatedPagesViewer.goToPage(3));
      await expect.poll(currentPage).toBe(3);
    }
    const growth = await page.addStyleTag({ content: '.iworkv-body-flow .pptxv-table tr { height: 75px !important; }' });
    const count = dataRows === 3 ? 3 : 6;
    await expect(shells).toHaveCount(count);
    if (dataRows === 9) await expect.poll(currentPage).toBe(4);
    const expectedRows = dataRows === 3 ? [[1], [2, 3]] : [[1], [2, 3], [4, 5], [6, 7], [8, 9]];
    for (const [index, rows] of expectedRows.entries()) {
      const table = shells.nth(index).locator('.pptxv-table');
      await expect(table.locator('tr > td:first-child')).toHaveText(['Heading', ...rows.map(row => `Row ${row}`)]);
      const bottom = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        return (element.getBoundingClientRect().bottom - paper.top) * 320 / paper.height;
      });
      expect(bottom).toBeLessThan(282);
    }
    await expect(shells.nth(1).getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
    await expect(shells.last().getByText(`after table on page ${count} of ${count}.`, { exact: true })).toBeVisible();
    await expect(shells.last().getByText('Final paragraph.', { exact: true })).toBeVisible();
    await growth.evaluate(style => style.remove());
    await expect(shells).toHaveCount(initialCount);
    if (dataRows === 9) await expect.poll(currentPage).toBe(3);
    await expect(initialTail).toBeVisible();
  });
}

for (const savedFlow of [true, 'leading', 'long', 'image']) {
  test(`continues text displaced by an inline object in saved Pages layout ${savedFlow}`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'saved-flow.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({ dataRows: 3, fittedRows: true, savedFlow }))
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells.first()).toBeVisible();
    const count = await shells.count();
    const objectPage = savedFlow === 'leading' ? 1 : 0;
    const continued = objectPage + 1;
    const image = savedFlow === 'image';
    if (savedFlow === 'long') expect(count).toBeGreaterThan(5);
    else expect(count).toBe(continued + 3);
    const text: string[] = [];
    for (const [index, shell] of (await shells.all()).entries()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      const object = paper.locator(image ? 'img[alt$="Figure.svg"]' : '.pptxv-table');
      await expect(object).toHaveCount(Number(index === objectPage));
      if (index === objectPage) {
        if (image) await expect.poll(() => object.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(320);
        else await expect(object.locator('tr > td:first-child')).toHaveText(['Heading', 'Row 1', 'Row 2', 'Row 3']);
        const bounds = (await object.boundingBox())!;
        const slide = (await paper.boundingBox())!;
        expect((bounds.y + bounds.height - slide.y) / slide.height).toBeLessThan(282 / 320);
      }
      const paragraphs = paper.locator('.pptxv-item--text .pptxv-paragraph');
      if (index === count - 2 || index === objectPage) await expect(paragraphs).toHaveCount(0);
      if (index < objectPage) await expect(paragraphs).toHaveText(['Saved lead']);
      if (index === count - 1) {
        await expect(paragraphs).toHaveText([`Saved next on page ${count} of ${count}.`]);
        await expect(paper.locator('img[alt$="Badge.svg"]')).toBeVisible();
      } else {
        await expect(paper.locator('img[alt$="Badge.svg"]')).toHaveCount(0);
      }
      if (index >= continued && index < count - 2) {
        text.push(...await paragraphs.allTextContents());
        const bottom = await paper.evaluate(element => {
          const slide = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element.querySelector('.pptxv-text-frame')!);
          return (range.getBoundingClientRect().bottom - slide.top) / slide.height;
        });
        expect(bottom).toBeLessThan(282 / 320);
      }
    }
    const longTail = savedFlow === 'long' ? pagesLongBodyText.replaceAll('\uFFFC', '') : '';
    expect(text.join('')).toBe(` After ${image ? 'image' : 'table'} on page ${continued + 1} of ${count}.${longTail}Final paragraph.`);
  });
}

for (const height of [58, 60, 85]) {
  test(`repaginates saved Pages after browser table rows grow to ${height}px`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    const input = page.getByLabel('导入文件', { exact: true });
    const file = {
      name: 'browser-table-height.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({ dataRows: 3, rowHeight: 48, savedFlow: height === 58 ? 'single-growth' : true }))
    };
    await input.setInputFiles(file);
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells).toHaveCount(3);
    await expect(shells.first().getByText('After table on page 1 of 3.', { exact: true })).toBeVisible();
    const css = `.iworkv-body-flow .pptxv-table tr { height: ${height}px !important; }`;
    const growth = await page.addStyleTag({ content: css });
    await expect(shells).toHaveCount(4);
    const rows: string[] = [];
    for (const [index, shell] of (await shells.all()).entries()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      const table = paper.locator('.pptxv-table');
      await expect(table).toHaveCount(Number(index === 0 || (index === 1 && height === 85)));
      if (await table.count()) {
        rows.push(...await table.locator('tr > td:first-child').allTextContents());
        const bottom = await table.evaluate(element => {
          const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
          return (element.getBoundingClientRect().bottom - paper.top) * 320 / paper.height;
        });
        expect(bottom).toBeLessThan(282);
      }
      const text = paper.locator('.pptxv-item--text .pptxv-paragraph');
      if (index === 1) await expect(text).toHaveText(height === 58 ? ['After table on page 2 of 4.']
        : ['After table on page 2 of 4.', 'Final paragraph.']);
      else if (index === 3) {
        await expect(text).toHaveText(['Saved next on page 4 of 4.']);
        await expect(paper.locator('img[alt$="Badge.svg"]')).toBeVisible();
      } else await expect(text).toHaveCount(0);
    }
    expect(rows).toEqual(['Heading', 'Row 1', 'Row 2', 'Row 3']);
    if (height < 85) {
      await shells.first().evaluate(element => element.scrollIntoView({ block: 'start' }));
      await expect(shells.first().locator('.pptxv-table')).toBeVisible();
      await growth.evaluate(style => style.remove());
      await expect(shells).toHaveCount(3);
      await expect(shells.first().getByText('After table on page 1 of 3.', { exact: true })).toBeVisible();
    } else {
      await growth.evaluate(style => style.remove());
      await input.setInputFiles(file);
      await expect(shells).toHaveCount(3);
      await page.addStyleTag({ content: css });
      await expect(shells).toHaveCount(4);
      await shells.nth(1).evaluate(element => element.scrollIntoView({ block: 'start' }));
      await expect(shells.nth(1).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
    }
  });
}

test('keeps complete lines of a Pages paragraph above a browser-induced page break', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'partially-visible-pages-text.pages', mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesLongTableArchive({ dataRows: 3, rowHeight: 24, savedFlow: 'wrapped-growth' }))
  });
  const shells = page.locator('.iworkv-page-shell');
  const first = shells.first().locator('.pptxv-item--text .pptxv-paragraph');
  await expect(shells).toHaveCount(3);
  await expect(first.first()).toHaveText(`${pagesWrappedTableTail} on page 1 of 3.`);
  const growth = await page.addStyleTag({ content: '.iworkv-body-flow .pptxv-table tr { height: 54px !important; }' });
  await expect(shells).toHaveCount(4);
  await expect(first).toHaveCount(1);
  const prefix = (await first.textContent())!;
  expect(prefix).toContain('A visible line VIII starts here.');
  const prefixBottom = await first.evaluate(element => {
    const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    return (range.getBoundingClientRect().bottom - paper.top) * 320 / paper.height;
  });
  expect(prefixBottom).toBeLessThanOrEqual(280.5);
  await shells.nth(1).evaluate(element => element.scrollIntoView({ block: 'start' }));
  const continuation = shells.nth(1).locator('.pptxv-item--text .pptxv-paragraph');
  await expect(continuation.last()).toHaveText('Final paragraph.');
  const suffix = await continuation.first().textContent();
  const restored = `${prefix}${suffix}`;
  expect(restored).toBe(` ${pagesWrappedTableTail} on page 2 of 4.`);
  expect(new Intl.Segmenter().segment(restored).containing(prefix.length)?.index).toBe(prefix.length);
  await expect(shells.nth(1).locator('.pptxv-table')).toHaveCount(0);
  await shells.first().evaluate(element => element.scrollIntoView({ block: 'start' }));
  await expect(first).toHaveCount(1);
  await growth.evaluate(style => style.remove());
  await expect(shells).toHaveCount(3);
  await expect(first.first()).toHaveText(`${pagesWrappedTableTail} on page 1 of 3.`);
});

for (const dataRows of [4, 5]) {
  test(`respects saved Pages table partitions with ${dataRows} data rows`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'saved-table-partition.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({
        dataRows, fittedRows: true, savedFlow: 'partition', packedPartitions: true
      }))
    });
    const shells = page.locator('.iworkv-page-shell');
    const full = dataRows === 5;
    const count = full ? 5 : 4;
    await expect(shells).toHaveCount(count);
    const expectedText = [['Saved lead'], ...(full ? [[]] : []),
      [`After table on page ${full ? 3 : 2} of ${count}.`, 'Final paragraph.'], [], [`Saved next on page ${count} of ${count}.`]];
    for (const [index, shell] of (await shells.all()).entries()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      const table = paper.locator('.pptxv-table');
      const paragraphs = paper.locator('.pptxv-item--text .pptxv-paragraph');
      await expect(paragraphs).toHaveText(expectedText[index]);
      await expect(table).toHaveCount(Number(index < 2));
      await expect(paper.locator('img[alt$="Badge.svg"]')).toHaveCount(Number(index === count - 1));
      if (index >= 2) continue;
      await expect(table.locator('tr > td:first-child')).toHaveText(index === 0 ? ['Heading', 'Row 1']
        : Array.from({ length: dataRows - 1 }, (_, row) => `Row ${row + 2}`));
      const bounds = (await table.boundingBox())!;
      const slide = (await paper.boundingBox())!;
      if (index === 0) {
        expect((await paragraphs.first().boundingBox())!.y).toBeLessThan(bounds.y);
      } else {
        expect((bounds.x - slide.x) * 400 / slide.width).toBeCloseTo(53, 0);
        expect((bounds.y - slide.y) * 320 / slide.height).toBeCloseTo(40, 0);
        expect(Math.abs(bounds.width * 400 / slide.width - 287)).toBeLessThan(1.5);
        expect(Math.abs(bounds.height * 320 / slide.height - (dataRows - 1) * 60)).toBeLessThan(1.5);
        if (!full) {
          const textTop = await paragraphs.first().evaluate(paragraph => {
            const range = document.createRange();
            range.selectNodeContents(paragraph);
            return range.getBoundingClientRect().top;
          });
          expect((bounds.y + bounds.height - textTop) * 320 / slide.height).toBeLessThan(2);
        }
      }
    }
  });
}

for (const tableOnly of [false, true]) {
  test(`splits a saved Pages table partition when its rendered rows outgrow the page (table only: ${tableOnly})`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'saved-partition-growth.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({
        dataRows: 4, savedFlow: tableOnly ? 'partition-only' : 'partition', packedPartitions: true
      }))
    });
    const shells = page.locator('.iworkv-page-shell');
    const show = async (index: number) => {
      const shell = shells.nth(index);
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      return paper;
    };
    await expect(shells).toHaveCount(4);
    if (tableOnly) await expect((await show(1)).locator('.pptxv-item--text')).toHaveCount(0);
    else await expect((await show(1)).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
    const growth = await page.addStyleTag({
      content: '.iworkv-page-shell:not(:first-child) .iworkv-body-flow .pptxv-table tr { height: 85px !important; }'
    });
    await expect(shells).toHaveCount(5);
    for (const [index, rows] of [['Heading', 'Row 1'], ['Row 2', 'Row 3'], ['Row 4']].entries()) {
      const paper = await show(index);
      const table = paper.locator('.pptxv-table');
      await expect(table.locator('tr > td:first-child')).toHaveText(rows);
      const bounds = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        const table = element.getBoundingClientRect();
        return {
          bottom: (table.bottom - paper.top) * 320 / paper.height,
          left: (table.left - paper.left) * 400 / paper.width,
          width: table.width * 400 / paper.width
        };
      });
      expect(bounds.bottom).toBeLessThan(282);
      const usesSavedRect = index > 0 && !tableOnly;
      expect(bounds.left).toBeCloseTo(usesSavedRect ? 53 : 40, 0);
      expect(Math.abs(bounds.width - (usesSavedRect ? 287 : 320))).toBeLessThan(1.5);
      if (index === 0) await expect(paper.getByText('Saved lead', { exact: true })).toBeVisible();
      if (index === 1) await expect(table.getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
      if (index === 2 && !tableOnly) await expect(paper.locator('.pptxv-item--text .pptxv-paragraph')).toHaveText([
        'After table on page 3 of 5.', 'Final paragraph.'
      ]);
    }
    await expect((await show(3)).locator('.pptxv-item')).toHaveCount(0);
    const last = await show(4);
    await expect(last.getByText('Saved next on page 5 of 5.', { exact: true })).toBeVisible();
    if (tableOnly) await expect(last.getByText('After table on page 5 of 5.', { exact: true })).toBeVisible();
    const badge = last.locator('img[alt$="Badge.svg"]');
    await expect(badge).toBeVisible();
    const paper = (await last.boundingBox())!;
    const image = (await badge.boundingBox())!;
    expect((image.x - paper.x) * 400 / paper.width).toBeCloseTo(332, 0);
    expect((image.y - paper.y) * 320 / paper.height).toBeCloseTo(55, 0);
    await show(2);
    await growth.evaluate(style => style.remove());
    await show(1);
    await expect(shells).toHaveCount(4);
    const restored = await show(1);
    await expect(restored.locator('.pptxv-table tr > td:first-child')).toHaveText(['Row 2', 'Row 3', 'Row 4']);
    const tail = tableOnly ? await show(3) : restored;
    await expect(tail.getByText(`After table on page ${tableOnly ? 4 : 2} of 4.`, { exact: true })).toBeVisible();
  });
}

for (const height of [70, 115]) {
  test(`splits the first saved Pages table part when its rows grow to ${height}px`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'anchored-partition-growth.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({
        dataRows: 5, savedFlow: 'partition', packedPartitions: true, rowHeight: 44, firstPartitionRows: 4,
        partitionSuffix: ' After first part.'
      }))
    });
    const shells = page.locator('.iworkv-page-shell');
    const show = async (index: number) => {
      const shell = shells.nth(index);
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      return paper;
    };
    const rowLabels = (index: number) => shells.nth(index).locator('.pptxv-table tr > td:first-child');
    const movesEntirePart = height === 115;
    const count = movesEntirePart ? 7 : 5;
    const suffixPage = movesEntirePart ? 3 : 1;
    const savedPart = count - 3;
    await expect(shells).toHaveCount(4);
    await expect(rowLabels(0)).toHaveText(['Heading', 'Row 1', 'Row 2', 'Row 3']);
    await expect(shells.first().getByText('After first part.', { exact: true })).toBeVisible();
    const growth = await page.addStyleTag({ content: `
      .iworkv-body-flow .pptxv-item--table[style*="width: 320px"] .pptxv-table tr { height: ${height}px !important; }
    ` });
    await expect(shells).toHaveCount(count);
    const rebuiltRows = movesEntirePart
      ? [[], ['Heading', 'Row 1'], ['Row 2', 'Row 3'], []]
      : [['Heading', 'Row 1'], ['Heading', 'Row 2', 'Row 3']];
    const expectedRows = [...rebuiltRows, ['Row 4', 'Row 5']];
    for (const [index, rows] of expectedRows.entries()) {
      const paper = await show(index);
      const paragraphs = paper.locator('.pptxv-item--text .pptxv-paragraph');
      await expect(paragraphs).toHaveText(index === 0 ? ['Saved lead']
        : index === suffixPage ? ['After first part.']
        : index === savedPart ? [`After table on page ${savedPart + 1} of ${count}.`, 'Final paragraph.'] : []);
      await expect(rowLabels(index)).toHaveText(rows);
      if (!rows.length) continue;
      const table = paper.locator('.pptxv-table');
      const bounds = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { bottom: (box.bottom - paper.top) * 320 / paper.height, left: (box.left - paper.left) * 400 / paper.width };
      });
      expect(bounds.bottom).toBeLessThan(282);
      expect(bounds.left).toBeCloseTo(index === savedPart ? 53 : 40, 0);
      if (index === 0) expect((await paragraphs.first().boundingBox())!.y).toBeLessThan((await table.boundingBox())!.y);
      if (index === (movesEntirePart ? 2 : 1)) await expect(table.getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
    }
    await expect((await show(count - 2)).locator('.pptxv-item')).toHaveCount(0);
    const last = await show(count - 1);
    await expect(last.getByText(`Saved next on page ${count} of ${count}.`, { exact: true })).toBeVisible();
    await expect(last.locator('img[alt$="Badge.svg"]')).toBeVisible();
    await show(movesEntirePart ? 2 : 1);
    await growth.evaluate(style => style.remove());
    await show(1);
    await show(0);
    await expect(shells).toHaveCount(4);
    await expect(rowLabels(0)).toHaveText(['Heading', 'Row 1', 'Row 2', 'Row 3']);
    await expect(shells.first().getByText('After first part.', { exact: true })).toBeVisible();
    await expect((await show(1)).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
  });
}

for (const partitionColumns of ['anchor', 'continuation']) {
  test(`repaginates a saved Pages table in two body regions (${partitionColumns})`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    const anchored = partitionColumns === 'anchor';
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'partition-columns.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({
        dataRows: anchored ? 5 : 4, rowHeight: anchored ? 44 : 60, firstPartitionRows: anchored ? 4 : 2,
        savedFlow: 'partition', packedPartitions: true, partitionColumns
      }))
    });
    const shells = page.locator('.iworkv-page-shell');
    const show = async (index: number) => {
      const shell = shells.nth(index);
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      return paper;
    };
    const originalPage = anchored ? 0 : 1;
    const siblingText = anchored ? 'Previous column.' : 'Final paragraph.';
    const original = await show(originalPage);
    await expect(shells).toHaveCount(4);
    await expect(original.getByText(siblingText, { exact: true })).toBeVisible();
    const marker = 'img[alt$="Marker.svg"]';
    if (!anchored) await expect(original.locator(marker)).toBeVisible();
    const growth = await page.addStyleTag({ content: `
      .iworkv-body-flow .pptxv-item--table[style*="width: ${anchored ? 175 : 145}px"] tr { height: ${anchored ? 70 : 85}px !important; }
    ` });
    await expect(shells).toHaveCount(5);
    const expected = anchored ? [['Heading', 'Row 1'], ['Heading', 'Row 2', 'Row 3'], ['Row 4', 'Row 5']]
      : [['Heading', 'Row 1'], ['Row 2', 'Row 3'], ['Row 4']];
    for (const [index, rows] of expected.entries()) {
      const paper = await show(index);
      const table = paper.locator('.pptxv-table');
      await expect(table.locator('tr > td:first-child')).toHaveText(rows);
      const bounds = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { bottom: (box.bottom - paper.top) * 320 / paper.height, left: (box.left - paper.left) * 400 / paper.width };
      });
      expect(bounds.bottom).toBeLessThan(282);
      expect(bounds.left).toBeCloseTo(anchored ? (index < 2 ? 185 : 53) : (index === 0 ? 40 : 53), 0);
    }
    const lastTable = await show(2);
    await expect(lastTable.getByText('After table on page 3 of 5.', { exact: true })).toBeVisible();
    const sibling = (await show(anchored ? 0 : 2)).getByText(siblingText, { exact: true });
    const left = await sibling.evaluate(element => {
      const frame = element.closest('.pptxv-item--text')!.getBoundingClientRect();
      const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
      return (frame.left - paper.left) * 400 / paper.width;
    });
    expect(left).toBeCloseTo(anchored ? 40 : 218, 0);
    if (!anchored) {
      const image = lastTable.locator(marker);
      await expect(image).toBeVisible();
      const paper = (await lastTable.boundingBox())!;
      const bounds = (await image.boundingBox())!;
      expect((bounds.x - paper.x) * 400 / paper.width).toBeCloseTo(255, 0);
      expect((bounds.y - paper.y) * 320 / paper.height).toBeCloseTo(125, 0);
      await expect((await show(1)).locator(marker)).toHaveCount(0);
    }
    await expect((await show(3)).locator('.pptxv-item')).toHaveCount(0);
    const last = await show(4);
    await expect(last.getByText('Saved next on page 5 of 5.', { exact: true })).toBeVisible();
    await expect(last.locator('img[alt$="Badge.svg"]')).toBeVisible();
    await show(originalPage + 1);
    await growth.evaluate(style => style.remove());
    await show(originalPage);
    await expect(shells).toHaveCount(4);
    await expect((await show(originalPage)).getByText(siblingText, { exact: true })).toBeVisible();
    if (!anchored) await expect((await show(originalPage)).locator(marker)).toBeVisible();
    await expect((await show(1)).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
  });
}

test('repaginates both saved Pages columns when their tables grow together', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'two-growing-tables.pages', mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesLongTableArchive({
      dataRows: 4, rowHeight: 44, savedFlow: 'partition', packedPartitions: true, partitionColumns: 'two-tables'
    }))
  });
  const shells = page.locator('.iworkv-page-shell');
  const show = async (index: number) => {
    const shell = shells.nth(index);
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const paper = shell.locator('.pptxv-slide');
    await expect(paper).toBeVisible();
    return paper;
  };
  const checkTables = async (index: number, expected: Array<[number, string[]]>) => {
    const paper = await show(index);
    const tables = paper.locator('.pptxv-table');
    await expect(tables).toHaveCount(expected.length);
    for (const [tableIndex, [left, rows]] of expected.entries()) {
      const table = tables.nth(tableIndex);
      await expect(table.locator('tr > td:first-child')).toHaveText(rows);
      const bounds = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { bottom: (box.bottom - paper.top) * 320 / paper.height, left: (box.left - paper.left) * 400 / paper.width };
      });
      expect(bounds.left).toBeCloseTo(left, 0);
      expect(bounds.bottom).toBeLessThan(282);
    }
  };
  await expect(shells).toHaveCount(4);
  await checkTables(1, [[53, ['Row 2', 'Row 3', 'Row 4']], [218, ['Heading', 'Row 1', 'Row 2', 'Row 3']]]);
  const leftGrowth = '.iworkv-body-flow .pptxv-item--table[style*="width: 145px"] tr { height: 85px !important; }';
  const rightGrowth = '.iworkv-body-flow .pptxv-item--table[style*="width: 140px"] tr { height: 70px !important; }';
  const growth = await page.addStyleTag({ content: leftGrowth + rightGrowth });
  await expect(shells).toHaveCount(6);
  await checkTables(0, [[40, ['Heading', 'Row 1']]]);
  await checkTables(1, [[53, ['Row 2', 'Row 3']]]);
  await checkTables(2, [[53, ['Row 4']], [218, ['Heading', 'Row 1']]]);
  await checkTables(3, [[218, ['Heading', 'Row 2', 'Row 3']]]);
  await expect((await show(1)).locator('.pptxv-table').getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
  await expect((await show(3)).locator('.pptxv-table').getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
  const middle = await show(2);
  await expect(middle.getByText('After table on page 3 of 6.', { exact: true })).toBeVisible();
  await expect(middle.getByText('Right lead', { exact: true })).toBeVisible();
  await expect((await show(4)).locator('.pptxv-item')).toHaveCount(0);
  await checkTables(5, [[57, ['Row 4']]]);
  const last = await show(5);
  await expect(last.getByText('Saved next on page 6 of 6.', { exact: true })).toBeVisible();
  await expect(last.locator('img[alt$="Badge.svg"]')).toBeVisible();
  await show(1);
  await growth.evaluate((style, css) => { style.textContent = css; }, rightGrowth);
  await show(2);
  await expect(shells).toHaveCount(5);
  await checkTables(1, [[53, ['Row 2', 'Row 3', 'Row 4']], [218, ['Heading', 'Row 1']]]);
  await checkTables(2, [[218, ['Heading', 'Row 2', 'Row 3']]]);
  await expect((await show(1)).getByText('After table on page 2 of 5.', { exact: true })).toBeVisible();
  await growth.evaluate(style => style.remove());
  await show(2);
  await show(1);
  await expect(shells).toHaveCount(4);
  await checkTables(1, [[53, ['Row 2', 'Row 3', 'Row 4']], [218, ['Heading', 'Row 1', 'Row 2', 'Row 3']]]);
  await expect((await show(1)).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
  await checkTables(3, [[57, ['Row 4']]]);
});

test('continues two growing saved Pages tables from the same body region', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'stacked-growing-tables.pages', mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesLongTableArchive({
      dataRows: 4, rowHeight: 24, savedFlow: 'partition', packedPartitions: true, partitionColumns: 'stacked-tables'
    }))
  });
  const shells = page.locator('.iworkv-page-shell');
  const show = async (index: number) => {
    const shell = shells.nth(index);
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const paper = shell.locator('.pptxv-slide');
    await expect(paper).toBeVisible();
    return paper;
  };
  const checkRows = async (index: number, expected: string[]) => {
    const paper = await show(index);
    await expect(paper.locator('.pptxv-table tr > td:first-child')).toHaveText(expected);
    const bounds = await paper.locator('.pptxv-table').evaluateAll(tables => tables.map(table => {
      const paper = table.closest('.pptxv-slide')!.getBoundingClientRect();
      const box = table.getBoundingClientRect();
      return (box.bottom - paper.top) * 320 / paper.height;
    }));
    expect(bounds.every(bottom => bottom < 282)).toBe(true);
    return paper;
  };
  const initial = ['Row 2', 'Row 3', 'Row 4', 'Heading', 'Row 1', 'Row 2', 'Row 3'];
  const waitForPages = async (count: number) => {
    await expect.poll(async () => page.evaluate(async expected => {
      const pages = () => document.querySelectorAll('.iworkv-page-shell');
      // Scroll resized continuations into the virtual window so both tables can be measured.
      for (let index = 1; index < pages().length && pages().length !== expected; index += 1) {
        pages()[index]?.scrollIntoView({ block: 'start' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      return pages().length;
    }, count)).toBe(count);
  };
  await expect(shells).toHaveCount(4);
  await checkRows(1, initial);
  const firstGrowth = '.iworkv-body-flow .pptxv-item--table[style*="width: 287px"] tr { height: 85px !important; }';
  const secondGrowth = '.iworkv-body-flow .pptxv-item--table[style*="width: 180px"] tr { height: 70px !important; }';
  const growth = await page.addStyleTag({ content: firstGrowth + secondGrowth });
  await expect(shells).toHaveCount(7);
  await checkRows(0, ['Heading', 'Row 1']);
  await checkRows(1, ['Row 2', 'Row 3']);
  const middle = await checkRows(2, ['Row 4']);
  await expect(middle.getByText('After table on page 3 of 7.', { exact: true })).toBeVisible();
  await expect(middle.getByText('Right lead', { exact: true })).toBeVisible();
  await checkRows(3, ['Heading', 'Row 1']);
  const secondPart = await checkRows(4, ['Heading', 'Row 2', 'Row 3']);
  await expect(secondPart.getByRole('cell', { name: 'Merged rows' })).toHaveAttribute('rowspan', '2');
  await expect((await show(5)).locator('.pptxv-item')).toHaveCount(0);
  const last = await checkRows(6, ['Row 4']);
  await expect(last.getByText('Saved next on page 7 of 7.', { exact: true })).toBeVisible();
  await expect(last.locator('img[alt$="Badge.svg"]')).toBeVisible();
  await show(4);
  await growth.evaluate((style, css) => { style.textContent = css; }, firstGrowth);
  await waitForPages(5);
  await checkRows(2, ['Row 4', 'Heading', 'Row 1', 'Row 2', 'Row 3']);
  await checkRows(4, ['Row 4']);
  await show(1);
  await growth.evaluate(style => style.remove());
  await waitForPages(4);
  await checkRows(1, initial);
  await expect((await show(1)).getByText('After table on page 2 of 4.', { exact: true })).toBeVisible();
  await checkRows(3, ['Row 4']);
});

test('keeps saved Pages table continuations in order when both start the region', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'leading-growing-tables.pages', mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesLongTableArchive({
      dataRows: 4, rowHeight: 24, savedFlow: 'partition', packedPartitions: true, partitionColumns: 'leading-tables'
    }))
  });
  const shells = page.locator('.iworkv-page-shell');
  const show = async (index: number) => {
    const shell = shells.nth(index);
    await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
    const paper = shell.locator('.pptxv-slide');
    await expect(paper).toBeVisible();
    return paper;
  };
  const initial = ['Row 2', 'Row 3', 'Row 4', 'Row 1', 'Row 2', 'Row 3', 'Row 4'];
  await expect(shells).toHaveCount(5);
  await expect((await show(2)).locator('.pptxv-table tr > td:first-child')).toHaveText(initial);
  const growth = await page.addStyleTag({ content: `
    .iworkv-body-flow .pptxv-item--table[style*="width: 287px"] tr { height: 85px !important; }
    .iworkv-body-flow .pptxv-item--table[style*="width: 180px"] tr { height: 70px !important; }
  ` });
  await expect(shells).toHaveCount(8);
  for (const [offset, rows] of [['Row 2', 'Row 3'], ['Row 4', 'Row 1'], ['Row 2', 'Row 3', 'Row 4']].entries()) {
    const paper = await show(offset + 2);
    await expect(paper.locator('.pptxv-table tr > td:first-child')).toHaveText(rows);
    const bottoms = await paper.locator('.pptxv-table').evaluateAll(tables => tables.map(table => {
      const paper = table.closest('.pptxv-slide')!.getBoundingClientRect();
      return (table.getBoundingClientRect().bottom - paper.top) * 320 / paper.height;
    }));
    expect(bottoms.every(bottom => bottom < 282)).toBe(true);
  }
  await expect((await show(4)).getByText('After table on page 5 of 8.', { exact: true })).toBeVisible();
  await expect((await show(5)).getByText('Final paragraph.', { exact: true })).toBeVisible();
  await expect((await show(6)).locator('.pptxv-item')).toHaveCount(0);
  const last = await show(7);
  await expect(last.getByText('Saved next on page 8 of 8.', { exact: true })).toBeVisible();
  await expect(last.locator('img[alt$="Badge.svg"]')).toBeVisible();
  await show(4);
  await growth.evaluate(style => style.remove());
  for (const index of [3, 2]) await show(index);
  await expect(shells).toHaveCount(5);
  const restored = await show(2);
  await expect(restored.locator('.pptxv-table tr > td:first-child')).toHaveText(initial);
  await expect(restored.getByText('After table on page 3 of 5.', { exact: true })).toBeVisible();
});

for (const fittedRows of [false, true]) {
  test(`keeps oversized Pages cell text inside the table and paper with saved heights: ${fittedRows}`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'tall-row.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({ fittedRows, tallRow: true }))
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells.first()).toBeVisible();
    const count = await shells.count();
    const chunks: string[] = [];
    for (const shell of await shells.all()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      const table = paper.locator('.pptxv-table');
      if (!await table.count()) continue;
      await expect(table.locator('tr').first().locator('td').first()).toHaveText('Heading');
      const results = await table.evaluate(element => {
        const paper = element.closest('.pptxv-slide')!.getBoundingClientRect();
        const rows = Array.from(element.querySelectorAll('tr'));
        return rows.slice(1).flatMap(row => {
          const [cell, side] = Array.from(row.cells);
          const text = cell?.textContent;
          if (!text || /^Row \d+$/.test(text)) return [];
          const bounds = cell.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(cell);
          const bottom = Math.max(...Array.from(range.getClientRects(), rect => rect.bottom));
          return [{
            text,
            side: side?.textContent,
            aligned: side && Math.abs(side.getBoundingClientRect().left - bounds.right) <= 1,
            bottom: (bottom - paper.top) / paper.height,
            overflow: bottom - bounds.bottom
          }];
        });
      });
      for (const result of results) {
        expect(result.aligned).toBe(true);
        expect(result.side).toBe(chunks.length ? '' : 'Side note');
        expect(result.bottom).toBeLessThan(282 / 320);
        expect(result.overflow).toBeLessThanOrEqual(1);
        chunks.push(result.text);
      }
    }
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(pagesTallCellText);
    await expect(shells.last().getByText(`after table on page ${count} of ${count}.`, { exact: true })).toBeVisible();
  });
}

for (const fixture of [{ fittedRows: true }, { tallRow: true, mergeRow: 1 }, { fittedRows: true, hideMergeAnchor: true }]) {
  test(`fits vertically merged Pages cell fragments in the paper ${JSON.stringify(fixture)}`, async ({ page }) => {
    await page.goto('./?view=preview&lang=zh');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'tall-merge.pages', mimeType: 'application/vnd.apple.pages',
      buffer: Buffer.from(await createPagesLongTableArchive({ ...fixture, tallMerge: true }))
    });
    const shells = page.locator('.iworkv-page-shell');
    await expect(shells.first()).toBeVisible();
    const chunks = [[], []] as string[][];
    for (const shell of await shells.all()) {
      await shell.evaluate(element => element.scrollIntoView({ block: 'start' }));
      const paper = shell.locator('.pptxv-slide');
      await expect(paper).toBeVisible();
      const cells = await paper.evaluate(element => {
        const table = element.querySelector('.pptxv-table');
        if (!table) return [];
        const bounds = element.getBoundingClientRect();
        const header = Array.from(table.querySelector('tr')!.cells, cell => cell.getBoundingClientRect());
        return Array.from(table.querySelectorAll('td')).flatMap(cell => {
          const text = cell.textContent;
          if (!text?.trim() || text === 'Heading' || /^Row \d+$/.test(text)) return [];
          const rect = cell.getBoundingClientRect();
          const column = header.findIndex(box => Math.abs(rect.left - box.left) <= 1);
          const range = document.createRange();
          range.selectNodeContents(cell);
          const bottom = Math.max(...Array.from(range.getClientRects(), line => line.bottom));
          return [{
            text, column,
            rightBorder: getComputedStyle(cell).borderRightColor,
            overflow: bottom - rect.bottom, paperBottom: (bottom - bounds.top) / bounds.height
          }];
        });
      });
      for (const cell of cells) {
        expect(cell.column).toBeGreaterThanOrEqual(0);
        if (cell.column === 1) expect(cell.rightBorder).toBe('rgb(0, 0, 255)');
        expect(cell.overflow).toBeLessThanOrEqual(1);
        expect(cell.paperBottom).toBeLessThan(282 / 320);
        chunks[cell.column].push(cell.text);
      }
    }
    expect(chunks[0].join('')).toBe(fixture.tallRow ? pagesTallCellText : '');
    expect(chunks[1].length).toBeGreaterThan(1);
    expect(chunks[1].join('')).toBe(pagesTallMergeText);
    const count = await shells.count();
    await expect(shells.last().getByText(`after table on page ${count} of ${count}.`, { exact: true })).toBeVisible();
  });
}

for (const fixture of [{ tallRow: true }, { tallMerge: true, fittedRows: true, hideMergeAnchor: true },
  { tallRow: true, savedFlow: 'partition', packedPartitions: true }]) {
  test(`repaginates split Pages cells when browser lines grow ${JSON.stringify(fixture)}`, async ({ page }) => {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/iwork/src/index.ts')}`, page.url()).href;
    const source = Array.from(await createPagesLongTableArchive({ ...fixture, dataRows: 4 }));
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { createIworkViewer } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0';
      document.body.replaceChildren(host);
      const viewer = createIworkViewer(host, { virtual: false, fit: 'none', initialScale: 1.25 });
      await viewer.preview(new File([Uint8Array.from(source)], 'growing-cell.pages'));
    }, { moduleUrl, source });
    const shells = page.locator('.iworkv-page-shell');
    await expect(page.locator('.pptxv-table').first()).toBeVisible();
    const contents = async () => page.locator('.pptxv-table td').evaluateAll(cells => cells.flatMap(cell => {
      const text = cell.textContent ?? '';
      if (!text.trim()) return [];
      if (/^(Heading|Row \d+|Side note|Merged rows)$/.test(text)) return [];
      const page = cell.closest('.pptxv-slide')!.getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const lines = Array.from(range.getClientRects());
      const glyphBottom = Math.max(...lines.map(line => line.bottom));
      return [{ text, fits: glyphBottom <= Math.min(bounds.bottom, page.top + page.height * 280 / 320) + 1.5 }];
    }));
    const expected = fixture.tallRow ? pagesTallCellText : pagesTallMergeText;
    const graphemes = new Intl.Segmenter().segment(expected);
    const inspect = async () => {
      await expect.poll(async () => (await contents()).every(chunk => chunk.fits)).toBe(true);
      const chunks = await contents();
      expect(chunks.map(chunk => chunk.text).join('')).toBe(expected);
      let offset = 0;
      for (const chunk of chunks) {
        expect(graphemes.containing(offset)?.index).toBe(offset);
        offset += chunk.text.length;
      }
      if (fixture.tallRow) await expect(page.getByText('Side note', { exact: true })).toHaveCount(1);
      const count = await shells.count();
      const tail = page.locator('.pptxv-paragraph').filter({ hasText: 'after table on page' });
      await expect(tail).toBeVisible();
      const pageNumber = await tail.evaluate(element => Number((element.closest('.iworkv-page-shell') as HTMLElement).dataset.pageIndex) + 1);
      await expect(tail).toHaveText(new RegExp(`after table on page ${pageNumber} of ${count}\\.`, 'i'));
      if (fixture.savedFlow) {
        await expect(shells.last().getByText(`Saved next on page ${count} of ${count}.`, { exact: true })).toBeVisible();
        await expect(shells.last().locator('img[alt$="Badge.svg"]')).toBeVisible();
      } else await expect(shells.last().getByText('Final paragraph.', { exact: true })).toBeVisible();
    };
    await inspect();
    const initial = await shells.count();
    const growth = await page.addStyleTag({ content: '.iworkv-body-flow .pptxv-table td .pptxv-paragraph { line-height: 34px !important; }' });
    await expect.poll(() => shells.count()).toBeGreaterThan(initial);
    await inspect();
    await growth.evaluate(style => style.remove());
    await expect(shells).toHaveCount(initial);
    await inspect();
  });
}

test('matches a Pages table’s bounds and final row against the saved preview', async ({ page }) => {
  const path = 'packages/iwork/vendor/iwork-converter/testdata/a.pages';
  const preview = unzipSync(await readFile(path))['preview.jpg'];
  await page.goto('./?view=preview&lang=zh');
  const expected = await page.evaluate(async jpeg => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${jpeg}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    const { naturalWidth: width, naturalHeight: height } = image;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    const rowBorders: number[] = [];
    let firstBorderWidth = 0;
    let previousDarkRow = false;
    for (let y = Math.floor(height / 5); y < height * 0.75; y += 1) {
      let dark = 0;
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4] < 218) dark += 1;
      }
      const isDarkRow = dark > width * 0.6;
      if (isDarkRow && !previousDarkRow) {
        rowBorders.push(y);
        if (rowBorders.length === 1) firstBorderWidth = dark;
      }
      previousDarkRow = isDarkRow;
    }
    if (rowBorders.length !== 12) throw new Error('Expected twelve table boundaries in the Pages preview image');
    const top = rowBorders[0], bottom = rowBorders[11];
    return { top: top / height, height: (bottom - top) / height, width: firstBorderWidth / width,
      lastRow: (bottom - rowBorders[10]) / height };
  }, Buffer.from(preview).toString('base64'));

  await page.getByLabel('导入文件', { exact: true }).setInputFiles(path);
  const canvas = page.locator('.iworkv-page-shell[data-page-index="0"] .pptxv-slide');
  const table = canvas.locator('.pptxv-table');
  await expect(table).toBeVisible();
  await expect(table.locator('td').first()).toHaveCSS('border-top-color', 'rgb(0, 0, 0)');
  const finalLine = canvas.getByText(/买方已知悉上述标准/);
  await expect(finalLine).toBeVisible();
  const pageBounds = (await canvas.boundingBox())!;
  const tableBounds = (await table.boundingBox())!;
  const lastRowBounds = (await table.locator('tbody > tr').last().boundingBox())!;
  const lineBounds = (await finalLine.boundingBox())!;
  expect(Math.abs((tableBounds.y - pageBounds.y) / pageBounds.height - expected.top)).toBeLessThan(1.5 / 842);
  expect(Math.abs(tableBounds.width / pageBounds.width - expected.width)).toBeLessThan(1.5 / 595);
  expect(Math.abs(tableBounds.height / pageBounds.height - expected.height)).toBeLessThan(1.5 / 842);
  expect(Math.abs(lastRowBounds.height / pageBounds.height - expected.lastRow)).toBeLessThan(1.5 / 842);
  expect((lineBounds.y + lineBounds.height - pageBounds.y) / pageBounds.height).toBeLessThan(770 / 842);
});

test('refreshes body and inherited page fields through a restart, blank page and split paragraph', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  const openedWorker = page.waitForEvent('worker', worker => worker.url().includes('iwork-worker'));
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'section-numbering.pages',
    mimeType: 'application/vnd.apple.pages',
    buffer: Buffer.from(await createPagesNumberingArchive())
  });
  await openedWorker;

  const shells = page.locator('.iworkv-page-shell');
  await expect(shells).toHaveCount(5);
  const body = ['First page 1', 'Restart page 1', '', '😀 Continued 3 (label IV) —', '4 of 5, final.'];
  for (const [index, number] of [1, 1, 2, 3, 4].entries()) {
    const shell = shells.nth(index);
    await shell.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await expect(shell.getByText(`Page ${number}`, { exact: true })).toBeVisible();
    await expect(shell.getByText('Total 5', { exact: true })).toBeVisible();
    if (body[index]) await expect(shell.getByText(body[index], { exact: true })).toBeVisible();
  }
});
