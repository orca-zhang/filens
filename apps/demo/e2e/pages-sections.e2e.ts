import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import {
  createPagesAggregateColumnsArchive, createPagesLongBodyArchive, createPagesLongTableArchive, createPagesNumberingArchive,
  createPagesSavedColumnsArchive, createPagesSavedTextFitArchive,
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
      await expect(shell.getByText('5. Landscape section and wider table', { exact: true })).toBeVisible();
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
      buffer: Buffer.from(await createPagesLongTableArchive({ dataRows: 3, rowHeight: 48, savedFlow: true }))
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
      if (index === 1) await expect(text).toHaveText(['After table on page 2 of 4.', 'Final paragraph.']);
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
  await page.addStyleTag({ content: '.iworkv-body-flow .pptxv-table tr { height: 54px !important; }' });
  await expect(shells).toHaveCount(4);
  await expect(first).toHaveCount(1);
  const prefix = (await first.textContent())!;
  expect(prefix.length).toBeGreaterThan(' A visible line starts here.'.length);
  await shells.nth(1).evaluate(element => element.scrollIntoView({ block: 'start' }));
  const continuation = shells.nth(1).locator('.pptxv-item--text .pptxv-paragraph');
  await expect(continuation.last()).toHaveText('Final paragraph.');
  const suffix = await continuation.first().textContent();
  expect(`${prefix}${suffix}`).toBe(` ${pagesWrappedTableTail} on page 2 of 4.`);
  await expect(shells.nth(1).locator('.pptxv-table')).toHaveCount(0);
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
