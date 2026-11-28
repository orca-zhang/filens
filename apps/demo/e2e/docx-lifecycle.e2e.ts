import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createDocxAutomaticPaginationFixture, createDocxColumnBreakFixture, createDocxEndnotePaginationFixture,
  createDocxFixture, createDocxFootnotePaginationFixture, createDocxLinePaginationFixture,
  createDocxPageScrollFixture, createDocxPaginationFixture,
  createDocxSectionsFixture, createDocxSharedFootnoteFixture, createDocxSharedGeometryFixture, createDocxSharedPageFixture, createDocxTablePaginationFixture
} from '../../../packages/docx/test/fixtures/document.mjs';

const prepare = async (page: import('@playwright/test').Page) => {
  await page.goto('./');
  const url = new URL(`@fs${resolve('packages/docx/src/index.ts')}`, page.url()).href;
  await page.evaluate(async url => {
    const lib = await import(/* @vite-ignore */ url), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const active = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    const state: any = { lib, host, active };
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); state.onCreate?.(); return url; };
    URL.revokeObjectURL = url => { active.delete(url); revoke(url); };
    state.session = lib.createDocxPreviewDriver().createSession(host); (window as any).docxTest = state;
  }, url);
};

const readingLine = (page: import('@playwright/test').Page, label: string, scroll = false) =>
  page.evaluate(({ label, scroll }) => {
    const root = document.querySelector<HTMLElement>('.docxv-preview')!;
    const link = [...root.querySelectorAll('article a')].find(link => link.textContent?.includes(label + ' '))!;
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.nodeValue?.startsWith(label + ' ')) continue;
      const line = document.createRange();
      line.selectNodeContents(text);
      const top = root.getBoundingClientRect().top;
      if (scroll) root.scrollTop += line.getBoundingClientRect().top - top + 8;
      return { page: [...root.querySelectorAll('section.docx')].indexOf(link.closest('section')!),
        inset: top - line.getBoundingClientRect().top };
    }
    throw new Error(`${label} was not rendered`);
  }, { label, scroll });

const readingNoteLine = (line: import('@playwright/test').Locator, scroll = false) => line.evaluate((element, scroll) => {
  const root = element.closest('.docxv-preview')!;
  const range = document.createRange();
  range.selectNodeContents(element);
  const top = root.getBoundingClientRect().top;
  if (scroll) root.scrollTop += range.getBoundingClientRect().top - top + 8;
  return { page: Array.from(root.querySelectorAll('section.docx')).indexOf(element.closest('section')!),
    inset: top - range.getBoundingClientRect().top };
}, scroll);

test('preserves DOCX paragraph page breaks and text through font refreshes', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'pagination.docx', extension: 'docx' } });
  }, [...createDocxPaginationFixture()]);
  const pages = page.locator('section.docx');
  const expected = ['First paragraphBefore jump', 'InheritedDirect overrideStyle override', 'Direct start', 'After explicit', 'After savedLink before', 'Link afterTail'];
  for (let render = 0; render < 3; render++) {
    await expect(pages).toHaveText(expected);
    await expect(pages.nth(3).getByText('After explicit')).toHaveCSS('font-weight', '700');
    await expect(pages.nth(4).getByRole('link')).toHaveAttribute('href', '#tail');
    await expect(pages.nth(5).getByRole('link')).toHaveAttribute('href', '#tail');
    if (render < 2) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
  }
});

test('continues DOCX tables at saved row and cell breaks through font relayout', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'table-pages.docx', extension: 'docx' } });
  }, [...createDocxTablePaginationFixture()]);
  const pages = page.locator('section.docx');
  const expected = [
    'OpeningFactorValueBefore row breakOne', 'FactorValueAfter row breakTwo',
    'Before cell break', 'After cell breakFollowing rowThreeClosingMerged across rowsTop rightBottom right'
  ];
  for (let render = 0; render < 3; render++) {
    await expect(pages).toHaveText(expected);
    await expect(page.locator('#table-start')).toHaveCount(1);
    for (const index of [2, 3]) {
      const link = pages.nth(index).getByRole('link');
      await expect(link).toHaveAttribute('href', '#table-start');
      await expect(link.locator('span')).toHaveCSS('font-weight', '700');
      await expect(pages.nth(index).locator('table').first().locator('col')).toHaveCount(2);
    }
    await expect(pages.last().getByText('Merged across rows').locator('xpath=ancestor::td')).toHaveAttribute('rowspan', '2');
    if (render < 2) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
  }
});

test('measures DOCX pagination without saved breaks and preserves the reading row on reflow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'automatic-pagination.docx', extension: 'docx' } });
  }, [...createDocxAutomaticPaginationFixture()]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(4);
  await expect(pages.locator('header')).toHaveText(['Odd header', 'Even header', 'Odd header', 'Even header']);
  await expect(pages.nth(0).locator('article > p')).toHaveCount(9);
  await expect(pages.nth(1).locator('article > p')).toHaveText(['Heading with next paragraph', 'First paragraph of the section']);
  await expect(pages.locator('table tr').filter({ hasText: 'Column heading' })).toHaveCount(3);
  await expect(pages.nth(2).getByText('Info 7', { exact: true }).locator('xpath=ancestor::td')).toHaveAttribute('rowspan', '2');
  await expect(pages.last().locator('article > p')).toHaveText('Closing paragraph');
  expect(await pages.locator('td:first-child').allTextContents()).toEqual([
    'Column heading', ...Array.from({ length: 6 }, (_, i) => `Row ${i + 1}`),
    'Column heading', ...Array.from({ length: 9 }, (_, i) => `Row ${i + 7}`),
    'Column heading', ...Array.from({ length: 4 }, (_, i) => `Row ${i + 16}`)
  ]);
  expect(await pages.evaluateAll(elements => {
    elements.forEach(element => { (element as HTMLElement).style.contentVisibility = 'visible'; });
    const heights = elements.map(element => Math.round(element.getBoundingClientRect().height));
    elements.forEach(element => { (element as HTMLElement).style.contentVisibility = ''; });
    return heights;
  })).toEqual([400, 400, 400, 400]);

  // Change the height of the opening paragraphs so the later table rows change pages.
  await page.addStyleTag({ content: 'article > p[class$="_opening"] { line-height: 86px !important }' });
  const row = page.getByText('Row 7', { exact: true }).locator('xpath=ancestor::tr');
  await row.evaluate(element => {
    const root = element.closest('.docxv-preview')!;
    root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top + 8;
  });
  const oldPage = await row.evaluate(element => Array.from(element.closest('.docx-wrapper')!.children).indexOf(element.closest('section')!));
  await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
  await expect.poll(() => row.evaluate(element =>
    Array.from(element.closest('.docx-wrapper')!.children).indexOf(element.closest('section')!))).not.toBe(oldPage);
  await expect.poll(() => row.evaluate(element =>
    element.closest('.docxv-preview')!.getBoundingClientRect().top - element.getBoundingClientRect().top)).toBeCloseTo(8, 0);
});

for (const mode of ['shared', 'moves', 'columns', 'rows', 'long', 'endnotes']) {
  test(`measures continuous DOCX sections with shared footnote space (${mode})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const source = new Uint8Array(bytes);
      await (window as any).docxTest.session.load(source, { descriptor: { source, name: 'shared-footnotes.docx', extension: 'docx' } });
    }, [...createDocxSharedFootnoteFixture(mode)]);
    const snapshot = await page.locator('section.docx').evaluateAll(sheets => sheets.map(element => {
      const paper = element as HTMLElement;
      paper.style.contentVisibility = 'visible';
      const articles = [...paper.querySelectorAll(':scope > article')];
      const lists = [...paper.querySelectorAll<HTMLOListElement>(':scope > ol[data-docx-footnotes]')];
      const refs = Array.from(paper.querySelectorAll<HTMLElement>('article sup[data-docx-footnote]'), ref => ref.dataset.docxFootnote);
      const referenceLines = Array.from(paper.querySelectorAll('article sup[data-docx-footnote]'),
        ref => ref.parentElement?.previousElementSibling?.textContent);
      const notes = lists.flatMap(list => Array.from(list.querySelectorAll<HTMLLIElement>(':scope > li'), item => ({
        id: item.dataset.docxFootnote, text: item.textContent!, continued: item.style.listStyleType === 'none'
      })));
      const widths = articles.flatMap(article =>
        Array.from(article.querySelectorAll(':scope > div:not([aria-hidden])'), column => column.getBoundingClientRect().width));
      const end = paper.querySelector(':scope > ol[data-docx-endnotes]');
      const height = paper.getBoundingClientRect().height;
      const gap = lists[0]?.getBoundingClientRect().top - articles.at(-1)!.getBoundingClientRect().bottom;
      const body = articles.map(article => article.textContent!);
      const headings = Array.from(paper.querySelectorAll('table tr:first-of-type td'), cell => cell.textContent);
      const counts = lists.map(list => getComputedStyle(list).columnCount);
      const endnote = end ? {
        text: end.textContent,
        before: end.previousElementSibling?.textContent,
        after: end.nextElementSibling?.localName === 'article' ? end.nextElementSibling.textContent : null,
        gap: end.nextElementSibling?.getBoundingClientRect().top! - end.getBoundingClientRect().bottom
      } : null;
      paper.style.contentVisibility = '';
      return { body, counts, endnote, gap, headings, height, referenceLines, refs, notes, widths };
    }));
    expect(snapshot.length).toBeGreaterThan(1);
    expect(snapshot.every(({ height, gap, notes }) => Math.abs(height - 400) < 0.5 && (!notes.length || gap >= -0.5)),
      JSON.stringify(snapshot)).toBe(true);
    const multi = mode === 'columns' || mode === 'rows';
    const firstCount = mode === 'moves' ? 6 : mode === 'rows' ? 3 : multi ? 5 : mode === 'endnotes' ? 1 : 2;
    expect(snapshot.flatMap(({ body }) => body).join('').match(/(?:First|Second) \d+ 👩🏽‍💻/g)).toEqual([
      ...Array.from({ length: firstCount }, (_, i) => `First ${i + 1} 👩🏽‍💻`),
      ...Array.from({ length: multi ? 25 : mode === 'long' ? 10 : 12 }, (_, i) => `Second ${i + 1} 👩🏽‍💻`)
    ]);
    const allRefs = snapshot.flatMap(({ refs }) => refs);
    expect(allRefs).toEqual(mode === 'long' ? ['1'] : ['1', '2']);
    expect(snapshot.flatMap(sheet => sheet.referenceLines)).toEqual(mode === 'long' ? ['First 2 👩🏽‍💻'] : [
      `First ${mode === 'endnotes' ? 1 : 2} 👩🏽‍💻`, `Second ${mode === 'rows' ? 9 : multi ? 13 : mode === 'moves' ? 2 : 1} 👩🏽‍💻`
    ]);
    for (const { refs, notes } of snapshot) {
      expect(notes.filter(note => !note.continued).map(({ id }) => id)).toEqual(refs);
    }
    const noteText = snapshot.flatMap(({ notes }) => notes.map(({ text }) => text)).join('');
    if (mode === 'long') {
      expect(noteText).toBe(Array.from({ length: 28 }, (_, i) => `Footnote line ${i + 1} 👩🏽‍💻`).join(''));
      expect(snapshot[0].notes[0].text).toContain('Footnote line 1 👩🏽‍💻');
      const later = snapshot.find(({ body }) => body.includes('Third section'))!;
      expect(later.body).toHaveLength(2);
      expect(later.notes[0]?.continued, JSON.stringify(snapshot)).toBe(true);
    } else {
      expect(noteText).toBe('Footnote 1, line 1Footnote 1, line 2Footnote 2, line 1Footnote 2, line 2Footnote 2, line 3');
    }
    if (mode === 'shared' || mode === 'endnotes') {
      expect(snapshot[0].body).toHaveLength(2);
      expect(snapshot[0].refs).toEqual(['1', '2']);
    }
    if (mode === 'moves' || multi) {
      expect(snapshot[0].refs).toEqual(['1']);
      expect(snapshot[1].refs).toEqual(['2']);
    }
    if (mode === 'moves') expect(snapshot[0].body[1]).toBe('Second 1 👩🏽‍💻');
    if (multi) {
      expect(snapshot[0].body).toHaveLength(2);
      expect(snapshot.slice(0, 2).map(({ widths }) => widths)).toEqual([[180, 120], [180, 120]]);
      expect(snapshot.slice(0, 2).map(({ counts }) => counts)).toEqual([['auto'], ['2']]);
    }
    if (mode === 'rows') {
      const headings = snapshot.flatMap(sheet => sheet.headings);
      expect(headings.length).toBeGreaterThan(2);
      expect(headings.every(text => text === 'Repeated heading')).toBe(true);
    }
    if (mode === 'endnotes') {
      const note = snapshot[0].endnote!;
      expect(note.text).toBe('Endnote 1 line 1 👩🏽‍💻');
      expect(note.before).toContain('First 1');
      expect(note.after).toContain('Second 1');
      expect(note.gap).toBeGreaterThanOrEqual(0);
    }
  });
}

for (const table of [false, true]) {
  test(`paginates DOCX footnotes with their references in ${table ? 'table rows' : 'a split paragraph'}`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'measured-footnotes.docx', extension: 'docx' } });
    }, [...createDocxFootnotePaginationFixture(table)]);
    const pages = page.locator('section.docx');
    for (let render = 0; render < 2; render++) {
      await expect(pages).toHaveCount(3);
      const layout = await pages.evaluateAll(pages => pages.map(node => {
        const page = node as HTMLElement;
        page.style.contentVisibility = 'visible';
        const body = page.querySelector('article')!;
        const notes = Array.from(page.querySelectorAll(':scope > ol > li'), li => li.textContent);
        const height = page.getBoundingClientRect().height;
        const plain = body.cloneNode(true) as HTMLElement;
        plain.querySelectorAll('sup').forEach(ref => ref.remove());
        const lines = [...plain.textContent!.matchAll(/Body line (\d+)/g)].map(match => Number(match[1]));
        const references = Array.from(body.querySelectorAll<HTMLElement>('sup'), ref => ref.dataset.docxFootnote);
        page.style.contentVisibility = '';
        return { height, lines, notes, references };
      }));
      expect(layout.every(({ height }) => Math.abs(height - (table ? 420 : 400)) < 0.5)).toBe(true);
      const firstNote = ['Footnote 1, line 1Footnote 1, line 2'];
      const secondNote = ['Footnote 2, line 1Footnote 2, line 2Footnote 2, line 3'];
      expect(layout.map(({ notes }) => notes)).toEqual(table ? [firstNote, secondNote, []] : [[], firstNote, secondNote]);
      expect(layout.flatMap(({ lines }) => lines)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
      expect(layout.map(({ references }) => references)).toEqual(table ? [['1'], ['2'], []] : [[], ['1'], ['2']]);
      expect(layout[table ? 0 : 1].lines).toContain(table ? 6 : 8);
      expect(layout[table ? 1 : 2].lines).toContain(table ? 9 : 12);
      await expect(pages.locator('article sup')).toHaveCount(2);
      if (table) await expect(pages.locator('article table tr:first-of-type')).toHaveText(Array(3).fill('Table heading'));
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    if (table) {
      await page.setViewportSize({ width: 900, height: 320 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) > ol p { line-height: 50px !important }` });
      const row = pages.getByText('Body line 6', { exact: true }).locator('xpath=ancestor::tr');
      const position = (scroll = false) => row.evaluate((element, scroll) => {
        const root = element.closest('.docxv-preview')!;
        if (scroll) root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top + 8;
        return {
          page: Array.from(element.closest('.docx-wrapper')!.children).indexOf(element.closest('section')!),
          inset: root.getBoundingClientRect().top - element.getBoundingClientRect().top
        };
      }, scroll);
      const before = await position(true);
      expect(Math.abs(before.inset - 8)).toBeLessThan(1);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await position()).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await position()).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const table of [false, true]) {
  test(`continues an oversized DOCX footnote from ${table ? 'a table row' : 'a body line'}`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'long-footnote.docx', extension: 'docx' } });
    }, [...createDocxFootnotePaginationFixture(table, true)]);
    const pages = page.locator('section.docx');
    for (let render = 0; render < 2; render++) {
      expect(await pages.count()).toBeGreaterThan(3);
      const layout = await pages.evaluateAll(pages => pages.map(node => {
        const page = node as HTMLElement;
        page.style.contentVisibility = 'visible';
        const height = page.getBoundingClientRect().height;
        const notes = Array.from(page.querySelectorAll('ol[data-docx-footnotes] > li'), li => ({
          text: li.textContent, marker: getComputedStyle(li).listStyleType
        }));
        const body = page.querySelector(':scope > article')?.cloneNode(true) as HTMLElement | undefined;
        const ref = Boolean(body?.querySelector('sup[data-docx-footnote]'));
        body?.querySelectorAll('sup, ol').forEach(node => node.remove());
        const lines = [...(body?.textContent ?? '').matchAll(/Body line (\d+)/g)].map(match => Number(match[1]));
        page.style.contentVisibility = '';
        return { height, notes, ref, lines };
      }));
      expect(layout.every(({ height }) => Math.abs(height - (table ? 420 : 400)) < 0.5)).toBe(true);
      expect(layout.flatMap(({ lines }) => lines)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
      await expect(pages.locator('header')).toHaveText(layout.map((_, i) =>
        i % 2 ? 'even footnote page' : 'odd footnote page'));
      const first = layout.findIndex(p => p.ref);
      expect(layout.findIndex(p => p.notes.length)).toBe(first);
      expect(layout[first].lines).toContain(4);
      const items = layout.flatMap(p => p.notes);
      expect(items.map(item => item.text).join('')).toBe(Array.from({ length: 26 }, (_, i) => `Footnote line ${i + 1} 👩🏽‍💻`).join(''));
      expect(items.filter(item => item.marker !== 'none')).toHaveLength(1);
      expect(layout.slice(first + 1).some(p => p.lines.length && p.notes.length)).toBe(true);
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    if (!table) {
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) ol[data-docx-footnotes] p { line-height: 52px !important }` });
      const line = pages.getByText('Footnote line 10 👩🏽‍💻', { exact: true });
      const before = await readingNoteLine(line, true);
      expect(Math.abs(before.inset - 8)).toBeLessThan(1);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const [layout, table, long] of [
  ['equal', false, false], ['unequal', true, false], ['equal', false, true]
] as const) {
  test(`reserves page-wide footnote space in ${layout} DOCX columns (${table ? 'rows' : long ? 'long footnote' : 'lines'})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'column-footnotes.docx', extension: 'docx' } });
    }, [...createDocxFootnotePaginationFixture(table, long, layout)]);
    const pages = page.locator('section.docx');
    const read = () => pages.evaluateAll(elements => elements.map(element => {
      const paper = element as HTMLElement;
      paper.style.contentVisibility = 'visible';
      const article = paper.querySelector('article')!;
      const columns = Array.from(article.querySelectorAll(':scope > div:not([aria-hidden])'), column => {
        const rect = column.getBoundingClientRect();
        const body = column.cloneNode(true) as HTMLElement;
        body.querySelectorAll('sup[data-docx-footnote]').forEach(ref => ref.remove());
        return { width: rect.width, left: rect.left,
          lines: Array.from(body.textContent!.matchAll(/Body line (\d+)/g), match => Number(match[1])),
          refs: Array.from(column.querySelectorAll<HTMLElement>('sup[data-docx-footnote]'), ref => ref.dataset.docxFootnote) };
      });
      const notes = Array.from(paper.querySelectorAll<HTMLElement>('ol[data-docx-footnotes] > li'), note => ({
        id: note.dataset.docxFootnote, text: note.textContent, continued: getComputedStyle(note).listStyleType === 'none'
      }));
      const first = paper.querySelector('ol[data-docx-footnotes]');
      const gap = first ? first.getBoundingClientRect().top - article.getBoundingClientRect().bottom : 0;
      const height = paper.getBoundingClientRect().height;
      paper.style.contentVisibility = '';
      return { height, columns, notes, gap };
    }));
    const snapshot = await read();
    expect(snapshot.length).toBeGreaterThan(1);
    expect(snapshot.flatMap(({ columns }) => columns.flatMap(({ lines }) => lines))).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1));
    for (const { height, columns, notes, gap } of snapshot) {
      expect(Math.abs(height - (table ? 420 : 400)), JSON.stringify(snapshot)).toBeLessThan(0.5);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(columns.flatMap(column => column.refs)).toEqual(notes.filter(note => !note.continued).map(note => note.id));
      expect(columns.map(column => column.width)).toEqual((layout === 'equal' ? [150, 150] : [180, 120]).slice(0, columns.length));
      if (layout === 'unequal' && columns.length === 2) expect(columns[0].left).toBeGreaterThan(columns[1].left);
    }
    const notes = snapshot.flatMap(page => page.notes);
    expect(notes.map(note => note.text).join('')).toBe(long
      ? Array.from({ length: 26 }, (_, index) => `Footnote line ${index + 1} 👩🏽‍💻`).join('')
      : 'Footnote 1, line 1Footnote 1, line 2Footnote 2, line 1Footnote 2, line 2Footnote 2, line 3');
    if (long) expect(notes.some(note => note.continued)).toBe(true);
    else expect(snapshot.some(({ columns }) => columns[1]?.refs.length)).toBe(true);
    if (table) {
      const fragments = pages.locator('article table');
      await expect(fragments.locator('tr:first-of-type')).toHaveText(Array(await fragments.count()).fill('Table heading'));
    }
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    expect(await read()).toEqual(snapshot);
    if (long) {
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) ol[data-docx-footnotes] p { line-height: 64px !important }` });
      const line = pages.getByText('Footnote line 21 👩🏽‍💻', { exact: true });
      const before = await readingNoteLine(line, true);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const [layout, table, long, authored, count] of [
  ['', false, false, 3, 3], ['unequal', true, false, null, 2], ['equal', false, true, 0, 2]
] as const) {
  test(`flows DOCX notes through ${count} footnote columns (${table ? 'RTL match' : long ? 'long note' : 'explicit count'})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const source = new Uint8Array(bytes);
      await (window as any).docxTest.session.load(source, { descriptor: { source, name: 'footnote-columns.docx', extension: 'docx' } });
    }, [...createDocxFootnotePaginationFixture(table, long, layout, authored, 70)]);
    const pages = page.locator('section.docx');
    const snapshot = await pages.evaluateAll(pages => pages.map(node => {
      const sheet = node as HTMLElement;
      sheet.style.contentVisibility = 'visible';
      const body = sheet.querySelector('article')!;
      const fields = Array.from(sheet.querySelectorAll<HTMLOListElement>('ol[data-docx-footnotes]'), list => ({
        count: getComputedStyle(list).columnCount,
        dir: getComputedStyle(list).direction,
        gap: list.getBoundingClientRect().top - body.getBoundingClientRect().bottom,
        tracks: new Set([...list.querySelectorAll('p')].flatMap(p => [...p.getClientRects()].map(rect => rect.left))).size,
        overflow: (() => {
          const bounds = list.getBoundingClientRect();
          const paper = sheet.getBoundingClientRect();
          const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          const excess: unknown[] = [];
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            range.selectNodeContents(text);
            for (const rect of range.getClientRects()) {
              if (rect.width && (rect.left < paper.left - 1 || rect.right > paper.right + 1 || rect.bottom > bounds.bottom + 1)) {
                excess.push([text.textContent, rect.left - paper.left, rect.right - paper.right, rect.bottom - bounds.bottom]);
              }
            }
          }
          return excess;
        })(),
        notes: Array.from(list.children, entry => ({
          text: entry.textContent, id: (entry as HTMLElement).dataset.docxFootnote,
          continued: getComputedStyle(entry).listStyleType === 'none'
        }))
      }));
      const refs = Array.from(body.querySelectorAll<HTMLElement>('sup[data-docx-footnote]'), ref => ref.dataset.docxFootnote);
      const plain = body.cloneNode(true) as HTMLElement;
      plain.querySelectorAll('sup').forEach(node => node.remove());
      const height = sheet.getBoundingClientRect().height;
      sheet.style.contentVisibility = '';
      return { height, fields, refs, body: plain.textContent };
    }));
    expect(snapshot.every(p => Math.abs(p.height - (table ? 420 : 400)) < 0.5), JSON.stringify(snapshot)).toBe(true);
    expect(snapshot.map(p => p.body).join('').match(/Body line \d+/g)).toEqual(
      Array.from({ length: layout ? 27 : 17 }, (_, index) => `Body line ${index + 1}`));
    const fields = snapshot.flatMap(p => p.fields);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some(field => field.tracks === count)).toBe(true);
    for (const field of fields) {
      expect(field.count).toBe(String(count));
      expect(field.dir).toBe(table ? 'rtl' : 'ltr');
      expect(field.gap).toBeGreaterThanOrEqual(0);
      expect(field.overflow).toEqual([]);
    }
    for (const p of snapshot) expect(p.refs).toEqual(p.fields.flatMap(field => field.notes.filter(note => !note.continued).map(note => note.id)));
    const notes = fields.flatMap(field => field.notes);
    expect(notes.map(note => note.text).join('')).toBe(long
      ? Array.from({ length: 70 }, (_, i) => `Footnote line ${i + 1} 👩🏽‍💻`).join('')
      : 'Footnote 1, line 1Footnote 1, line 2Footnote 2, line 1Footnote 2, line 2Footnote 2, line 3');
    if (long) {
      expect(notes.some(note => note.continued)).toBe(true);
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) ol[data-docx-footnotes] p { line-height: 72px !important }` });
      const label = await pages.nth(4).locator('ol[data-docx-footnotes] span').filter({ hasText: /^Footnote line \d+ 👩🏽‍💻$/ }).first().textContent();
      const line = pages.getByText(label!, { exact: true });
      const before = await readingNoteLine(line, true);
      expect(Math.abs(before.inset - 8)).toBeLessThan(1);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const bodyLines of [3, 14]) {
  test(`paginates DOCX endnotes after ${bodyLines} body lines and continues long notes`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'measured-endnotes.docx', extension: 'docx' } });
    }, [...createDocxEndnotePaginationFixture(bodyLines)]);
    const pages = page.locator('section.docx');
    for (let render = 0; render < 2; render++) {
      expect(await pages.count()).toBeGreaterThan(2);
      const snapshot = await pages.evaluateAll(pages => pages.map((node, index) => {
        const page = node as HTMLElement;
        page.style.contentVisibility = 'visible';
        const height = page.getBoundingClientRect().height;
        const notes = Array.from(page.querySelectorAll('ol[data-docx-endnotes] > li'), li => ({
          text: li.textContent, marker: getComputedStyle(li).listStyleType, number: (li as HTMLLIElement).value
        }));
        const body = page.querySelector('article')?.cloneNode(true) as HTMLElement | undefined;
        body?.querySelectorAll('sup, ol').forEach(node => node.remove());
        const header = page.querySelector('header')?.textContent;
        page.style.contentVisibility = '';
        return { index, height, notes, header, body: body?.textContent ?? '' };
      }));
      expect(snapshot.every(page => Math.abs(page.height - 400) < 0.5)).toBe(true);
      expect(snapshot.map(page => page.header)).toEqual(snapshot.map(({ index }) =>
        index === 0 ? 'first header' : index % 2 ? 'odd header' : 'even header'));
      await expect(pages.locator('footer')).toHaveText(Array(snapshot.length).fill('endnote footer'));
      const firstNote = snapshot.find(page => page.notes.length)!;
      expect(firstNote.body).toContain(`Body line ${bodyLines}`);
      expect(snapshot.map(page => page.body).join('')).toBe(Array.from({ length: bodyLines }, (_, i) => `Body line ${i + 1}`).join(''));
      const items = snapshot.flatMap(page => page.notes);
      expect(items.map(item => item.text).join('')).toBe([14, 2, 1].flatMap((count, i) =>
        Array.from({ length: count }, (_, line) => `Endnote ${i + 1} line ${line + 1} 👩🏽‍💻`)).join(''));
      expect(items.filter(item => item.marker !== 'none').map(item => item.number)).toEqual([1, 2, 3]);
      expect(items.some(item => item.marker === 'none' && item.number === 1)).toBe(true);
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    if (bodyLines === 3) {
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) ol[data-docx-endnotes] p { line-height: 52px !important }` });
      const line = pages.getByText('Endnote 1 line 10 👩🏽‍💻', { exact: true });
      const before = await readingNoteLine(line, true);
      expect(Math.abs(before.inset - 8)).toBeLessThan(1);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const { type, long, body } of [
  { type: 'nextPage', long: true, body: 14 },
  { type: 'continuous', long: true, body: 3 },
  { type: 'continuous', long: false, body: 3 }
]) {
  test(`places ${long ? 'long' : 'short'} DOCX endnotes before a ${type} section`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'section-endnotes.docx', extension: 'docx' } });
    }, [...createDocxEndnotePaginationFixture(body, type, long)]);
    const pages = page.locator('section.docx');
    const read = () => pages.evaluateAll(elements => elements.map(element => {
      const paper = element as HTMLElement;
      paper.style.contentVisibility = 'visible';
      const height = paper.getBoundingClientRect().height;
      const header = paper.querySelector('header')?.textContent;
      const content = Array.from(paper.querySelectorAll('article > p, ol[data-docx-endnotes] > li')).map(node => {
        const plain = node.cloneNode(true) as HTMLElement;
        plain.querySelectorAll('sup').forEach(ref => ref.remove());
        return plain.textContent;
      });
      const notes = Array.from(paper.querySelectorAll<HTMLLIElement>('ol[data-docx-endnotes] > li'))
        .filter(item => getComputedStyle(item).listStyleType !== 'none')
        .map(item => item.value || (item.parentElement as HTMLOListElement).start
          + Array.from(item.parentElement!.children).indexOf(item));
      paper.style.contentVisibility = '';
      return { height, header, content, notes };
    }));
    const snapshot = await read();
    const continuation = snapshot.findIndex(({ content }) => content.some(text => text?.includes('Second section')));
    expect(snapshot.flatMap(({ content }) => content).join('')).toBe(
      Array.from({ length: body }, (_, i) => `Body line ${i + 1}`).join('')
      + 'First section end'
      + (long ? Array.from({ length: 14 }, (_, i) => `Endnote 1 line ${i + 1} 👩🏽‍💻`).join('') : 'Endnote 1 line 1 👩🏽‍💻')
      + 'Endnote 2 line 1 👩🏽‍💻Endnote 2 line 2 👩🏽‍💻Second sectionEndnote 3 line 1 👩🏽‍💻');
    expect(snapshot.flatMap(({ notes }) => notes)).toEqual([1, 2, 3]);
    if (long) expect(continuation).toBeGreaterThan(1);
    else expect(continuation).toBe(0);
    expect(snapshot.every(({ height }, index) => Math.abs(height - (type === 'nextPage' && index >= continuation ? 360 : 400)) < 0.5)).toBe(true);
    expect(snapshot.slice(0, continuation).map(({ header }) => header)).toEqual(
      Array.from({ length: continuation }, (_, i) => i === 0 ? 'first header' : i % 2 ? 'odd header' : 'even header'));
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    expect(await read()).toEqual(snapshot);
    if (type === 'continuous' && long) {
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) ol[data-docx-endnotes] p { line-height: 64px !important }` });
      const line = pages.getByText('Endnote 1 line 10 👩🏽‍💻', { exact: true });
      const before = await readingNoteLine(line, true);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const preceding of [3, 18]) {
  test(`measures a continuous DOCX section after endnotes following ${preceding} body lines`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const source = new Uint8Array(bytes);
      await (window as any).docxTest.session.load(source, { descriptor: { source, name: 'shared-endnotes.docx', extension: 'docx' } });
    }, [...createDocxEndnotePaginationFixture(preceding, 'continuous', false, 19)]);
    const pages = page.locator('section.docx');
    const inspect = () => pages.evaluateAll(elements => elements.map(element => {
      const sheet = element as HTMLElement;
      sheet.style.contentVisibility = 'visible';
      const height = sheet.getBoundingClientRect().height;
      const content = Array.from(sheet.querySelectorAll('article p, ol[data-docx-endnotes] > li'), node => {
        const plain = node.cloneNode(true) as HTMLElement;
        plain.querySelectorAll('sup').forEach(ref => ref.remove());
        return plain.textContent!;
      }).join('');
      const list = sheet.querySelector('ol[data-docx-endnotes]');
      const following = list?.nextElementSibling;
      const gap = following?.localName === 'article'
        ? following.getBoundingClientRect().top - list!.getBoundingClientRect().bottom : null;
      sheet.style.contentVisibility = '';
      return { height, content, gap };
    }));
    const snapshot = await inspect();
    expect(snapshot.every(({ height }) => Math.abs(height - 400) < 0.5), JSON.stringify(snapshot)).toBe(true);
    expect(snapshot.map(({ content }) => content).join('')).toBe(
      Array.from({ length: preceding }, (_, i) => `Body line ${i + 1}`).join('')
      + 'First section endEndnote 1 line 1 👩🏽‍💻Endnote 2 line 1 👩🏽‍💻Endnote 2 line 2 👩🏽‍💻'
      + Array.from({ length: 19 }, (_, i) => `Second section line ${i + 1}`).join('') + 'Endnote 3 line 1 👩🏽‍💻');
    const shared = snapshot.find(({ gap }) => gap !== null)!;
    expect(shared.gap).toBeGreaterThanOrEqual(0);
    expect(shared.content).toContain('Endnote 2 line 2 👩🏽‍💻Second section line 1');
    expect(shared.content).not.toContain('Second section line 19');
    if (preceding === 3) {
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) > ol[data-docx-endnotes] p { line-height: 72px !important }` });
      const line = pages.getByText('Second section line 1', { exact: true });
      const before = await readingNoteLine(line, true);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingNoteLine(line)).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingNoteLine(line)).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const table of [false, true]) {
  test(`measures continuous DOCX sections sharing a page (${table ? 'unequal columns and table rows' : 'single-column paragraphs'})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const source = new Uint8Array(bytes);
      await (window as any).docxTest.session.load(source, { descriptor: { source, name: 'shared-sections.docx', extension: 'docx' } });
    }, [...createDocxSharedPageFixture(table)]);
    const pages = page.locator('section.docx');
    const snapshot = await pages.evaluateAll(elements => elements.map(node => {
      const paper = node as HTMLElement;
      paper.style.contentVisibility = 'visible';
      const body = Array.from(paper.querySelectorAll(':scope > article'), article => ({
        bottom: article.getBoundingClientRect().bottom,
        top: article.getBoundingClientRect().top,
        widths: Array.from(article.querySelectorAll(':scope > div:not([aria-hidden])'), col => col.getBoundingClientRect().width),
        text: article.textContent!
      }));
      const height = paper.getBoundingClientRect().height;
      paper.style.contentVisibility = '';
      return { height, body };
    }));
    expect(snapshot.every(({ height }) => Math.abs(height - 400) < 0.5), JSON.stringify(snapshot)).toBe(true);
    expect(snapshot[0].body.map(part => part.text.match(/Line \d+/g))).toEqual([null, Array.from({ length: table ? 10 : 2 }, (_, i) => `Line ${i + 1}`)]);
    expect(snapshot.flatMap(({ body }) => body.map(({ text }) => text)).join('').match(/Line \d+/g))
      .toEqual(Array.from({ length: 18 }, (_, i) => `Line ${i + 1}`));
    expect(snapshot.every(({ body }) => body.slice(1).every((part, i) => Math.abs(part.top - body[i].bottom) < 0.5))).toBe(true);
    await expect(pages.last()).toContainText('Closing headingClosing paragraph');
    if (table) {
      expect(snapshot[1].body[0].widths).toEqual([180, 120]);
      expect(snapshot[1].body[1].text).toContain('Row 1');
      await expect(pages.locator('table tr:first-of-type')).toHaveText(['Heading', 'Heading']);
      expect((await pages.locator('td').allTextContents()).filter(text => text.startsWith('Row ')))
        .toEqual(Array.from({ length: 13 }, (_, i) => `Row ${i + 1}`));
    } else {
      await expect(pages.last().locator('article')).toHaveText('Closing headingClosing paragraph');
      await page.setViewportSize({ width: 900, height: 360 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) article p:has(#opening) { line-height: 35px !important }` });
      const before = await readingLine(page, 'Line 12', true);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await readingLine(page, 'Line 12')).page).toBeGreaterThan(before.page);
      await expect.poll(async () => Math.abs((await readingLine(page, 'Line 12')).inset - before.inset)).toBeLessThan(1);
    }
  });
}

for (const mode of ['margins', 'header', 'fresh', 'prior', 'columns', 'notes', 'long']) {
  test(`measures continuous DOCX sections with page geometry changes (${mode})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const source = new Uint8Array(bytes);
      await (window as any).docxTest.session.load(source, { descriptor: { source, name: 'shared-geometry.docx', extension: 'docx' } });
    }, [...createDocxSharedGeometryFixture(mode)]);
    const pages = page.locator('section.docx');
    const inspect = () => pages.evaluateAll(elements => elements.map(element => {
      const paper = element as HTMLElement;
      paper.style.contentVisibility = 'visible';
      const bounds = paper.getBoundingClientRect();
      const style = getComputedStyle(paper);
      const body = [...paper.querySelectorAll(':scope > article')];
      const header = paper.querySelector(':scope > header'), footer = paper.querySelector(':scope > footer');
      const lists = [...paper.querySelectorAll(':scope > ol[data-docx-footnotes]')];
      const list = lists[0];
      const bodyStart = body[0].getBoundingClientRect().top, bodyEnd = body.at(-1)!.getBoundingClientRect().bottom;
      const headings = [...paper.querySelectorAll('table tr:first-of-type td')].map(cell => cell.textContent);
      const refs = [...paper.querySelectorAll<HTMLElement>('article sup[data-docx-footnote]')].map(ref => ref.dataset.docxFootnote);
      const notes = lists.flatMap(list => [...list.querySelectorAll<HTMLElement>('li')].map(note =>
        [note.dataset.docxFootnote, note.textContent, note.style.listStyleType === 'none']));
      const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat);
      const bodyText = body.map(article => {
        const plain = article.cloneNode(true) as HTMLElement;
        plain.querySelectorAll('sup[data-docx-footnote]').forEach(ref => ref.remove());
        return plain.textContent!;
      });
      const result = {
        height: bounds.height, padding, header: header?.textContent ?? null, footer: footer?.textContent ?? null,
        body: bodyText, widths: body.map(article => article.getBoundingClientRect().width),
        columns: [...paper.querySelectorAll('article > div:not([aria-hidden])')].map(column => column.getBoundingClientRect().width),
        tables: [...paper.querySelectorAll('article table')].map(table => table.getBoundingClientRect().width),
        headings, refs, notes,
        fits: bodyStart >= (header?.getBoundingClientRect().bottom ?? bounds.top) - 0.5
          && bodyEnd <= (list?.getBoundingClientRect().top ?? footer?.getBoundingClientRect().top ?? bounds.bottom - padding[2]) + 0.5
          && (!list || lists.at(-1)!.getBoundingClientRect().bottom <= (footer?.getBoundingClientRect().top ?? bounds.bottom - padding[2]) + 0.5)
      };
      paper.style.contentVisibility = '';
      return result;
    }));
    const allPages = await inspect();
    expect(allPages.every(part => Math.abs(part.height - 400) < 0.5 && part.fits), JSON.stringify(allPages)).toBe(true);
    const snapshot = mode === 'prior' ? allPages.slice(2) : allPages;
    if (mode === 'prior') expect(allPages.slice(0, 2).map(sheet => sheet.body.join('')).join('').match(/Prior \d+/g))
      .toEqual(Array.from({ length: 13 }, (_, i) => `Prior ${i + 1}`));
    expect(snapshot.length).toBeGreaterThanOrEqual(3);
    expect(snapshot[0].body.length).toBe(mode === 'fresh' ? 1 : 2);
    expect(snapshot[0].widths.every(width => width === 320)).toBe(true);
    expect(snapshot[0].padding).toEqual([40, 40, 40, 40]);
    const differentMargins = ['margins', 'notes', 'long', 'columns'].includes(mode);
    for (const [index, page] of snapshot.entries()) {
      if (mode === 'long' && !page.body.some(text => text)) continue;
      if (index) {
        expect(page.padding).toEqual(differentMargins ? [70, 80, 60, 80] : [40, 40, 40, 40]);
        expect(page.widths.every(width => width === (differentMargins ? 240 : 320))).toBe(true);
      }
      if (mode === 'margins') expect([page.header, page.footer]).toEqual([null, null]);
      else if (index === 0) expect([page.header, page.footer]).toEqual([
        mode === 'prior' ? 'Default header 1Default header 2Default header 3' : 'Default header', 'Default footer'
      ]);
      else if (mode === 'fresh' && index === 1) expect([page.header, page.footer]).toEqual(['First-page header', null]);
      else expect([page.header, page.footer]).toEqual(index % 2
        ? [mode === 'long' ? 'even 1even 2' : 'even 1even 2even 3', 'alternate 1alternate 2']
        : ['continuous 1continuous 2', 'Replacement footer']);
    }
    const text = snapshot.flatMap(sheet => sheet.body).join('');
    const count = mode === 'notes' ? 20 : mode === 'columns' ? 40 : mode === 'long' ? 8 : 24;
    const name = mode === 'notes' ? 'Data' : 'Next';
    expect(text.match(/Opening \d+/g)).toEqual(Array.from({ length: mode === 'fresh' ? 9 : 3 }, (_, i) => `Opening ${i + 1}`));
    expect(text.match(new RegExp(`${name} \\d+`, 'g'))).toEqual(Array.from({ length: count }, (_, i) => `${name} ${i + 1}`));
    if (mode === 'columns') {
      expect(snapshot[0].columns).toEqual([150, 150]);
      expect(snapshot.slice(1).every(sheet => sheet.columns.length && sheet.columns.every(width => width === 110))).toBe(true);
    }
    if (mode === 'notes') {
      for (const sheet of snapshot) expect(sheet.notes.map(([id]) => id)).toEqual(sheet.refs);
      expect(snapshot.flatMap(sheet => sheet.notes)).toEqual([
        ['1', 'Opening footnote', false], ['2', 'Table footnote wraps at the narrower width of the following section.', false]
      ]);
      expect(snapshot.flatMap(sheet => sheet.headings)).toEqual(Array(snapshot.length).fill('Column heading'));
      expect(snapshot.every(sheet => sheet.tables.every(width => Math.abs(width - sheet.widths[0]) < 1))).toBe(true);
    }
    if (mode === 'long') {
      const nextBodyPage = snapshot.slice(1).find(sheet => sheet.body.some(text => text))!;
      expect(nextBodyPage.notes[0]?.[2], JSON.stringify(snapshot)).toBe(true);
      expect(snapshot.flatMap(sheet => sheet.notes.map(([, text]) => text)).join(''))
        .toBe(Array.from({ length: 28 }, (_, i) => `Long note ${i + 1}`).join(''));
      expect(snapshot.flatMap(sheet => sheet.notes.filter(([, , continued]) => !continued).map(([id]) => id))).toEqual(['1']);
    }
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    expect(await inspect()).toEqual(allPages);
  });
}

for (const wrap of [false, true]) {
  test(`paginates a long DOCX paragraph with ${wrap ? 'browser wrapping' : 'authored line breaks'}`, async ({ page }) => {
    await prepare(page);
    const { bytes, text } = createDocxLinePaginationFixture({ wrap });
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'line-pagination.docx', extension: 'docx' } });
    }, [...bytes]);
    const pages = page.locator('section.docx');
    for (let render = 0; render < 2; render++) {
      expect(await pages.count()).toBeGreaterThan(1);
      const links = pages.locator('article a');
      const parts = await links.allTextContents();
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.join('')).toBe(text);
      if (wrap) {
        const clusters = new Intl.Segmenter().segment(text);
        let offset = 0;
        for (const part of parts) {
          expect(clusters.containing(offset)?.index).toBe(offset);
          offset += part.length;
        }
      } else expect(parts.map(part => part.match(/Line /g)?.length)).toEqual([7, 10, 10, 3]);
      const measured = await pages.evaluateAll(elements => {
        for (const element of elements) (element as HTMLElement).style.contentVisibility = 'visible';
        const heights = elements.map(element => element.getBoundingClientRect().height);
        for (const element of elements) (element as HTMLElement).style.contentVisibility = '';
        return heights;
      });
      expect(measured.every(height => Math.abs(height - 400) < 0.5)).toBe(true);
      await expect(links.last()).toHaveAttribute('href', '#opening');
      await expect(links.last().locator('span')).toHaveCSS('font-weight', '700');
      await expect(pages.last()).toContainText('Closing paragraph');
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    if (!wrap) {
      await page.setViewportSize({ width: 900, height: 520 });
      const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
      await page.addStyleTag({ content: `section.docx:not(.${activeClass}) article > p:has(a) { line-height: 40px !important; }` });
      const position = (scroll = false) => readingLine(page, 'Line 17', scroll);
      const before = await position(true);
      expect(Math.abs(before.inset - 8)).toBeLessThan(1);
      await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
      await expect.poll(async () => (await position()).page).not.toBe(before.page);
      await expect.poll(async () => Math.abs((await position()).inset - before.inset)).toBeLessThan(1);
    }
  });
}

test('moves a DOCX paragraph with keepLines to a fresh page intact', async ({ page }) => {
  await prepare(page);
  const { bytes, text } = createDocxLinePaginationFixture({ keepLines: true });
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'keep-lines.docx', extension: 'docx' } });
  }, [...bytes]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(3);
  await expect(pages.first()).toHaveText('Opening 1Opening 2Opening 3');
  await expect(pages.nth(1).locator('article a')).toHaveText(text);
  await expect(pages.last()).toHaveText('Closing paragraph');
});

for (const [label, options, expected] of [
  ['default orphan control', { openingCount: 9, count: 5 }, [0, 5]],
  ['default widow control', { count: 8 }, [6, 2]],
  ['a three-line paragraph stays together when two lines fit', { openingCount: 8, count: 3 }, [0, 3]],
  ['widow on the final page of a long paragraph', { count: 18 }, [7, 9, 2]],
  ['direct control set to false', { openingCount: 9, count: 5, base: true, direct: false }, [1, 4]],
  ['control set to false in a base style', { count: 8, base: false }, [7, 1]],
  ['direct control overrides the base style', { count: 8, base: false, direct: true }, [6, 2]],
  ['control set to false in document defaults', { count: 8, docDefault: false }, [7, 1]],
  ['the default paragraph style overrides the document default', { count: 8, docDefault: true, namedDefault: false }, [7, 1]]
] as const) {
  test(`honors DOCX ${label}`, async ({ page }) => {
    await prepare(page);
    const { bytes, text } = createDocxLinePaginationFixture(options);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'widow-control.docx', extension: 'docx' } });
    }, [...bytes]);
    const pages = page.locator('section.docx');
    const read = () => pages.evaluateAll(elements =>
      elements.map(element => element.querySelector('article a')?.textContent ?? ''));
    for (let render = 0; render < 2; render++) {
      const parts = await read();
      expect(parts.map(part => part.match(/Line /g)?.length ?? 0)).toEqual(expected);
      expect(parts.join('')).toBe(text);
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
  });
}

for (const evenHeaders of [false, true]) {
  test(`paginates DOCX sections with even headers ${evenHeaders ? 'enabled' : 'disabled'}`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'sections.docx', extension: 'docx' } });
    }, [...createDocxSectionsFixture(evenHeaders)]);
    const pages = page.locator('section.docx');
    const expected = [
      [['Portrait opening'], 'Default header', 'Default footer', '816px', '1056px'],
      [['Next section', 'Continuous on the same page'], 'First-page header', null, '816px', '1056px'],
      [['Continuous after a hard break'], 'Continuous header', 'Replacement footer', '816px', '1056px'],
      [['Landscape section'], evenHeaders ? 'Even header' : 'Continuous header', evenHeaders ? 'Even footer' : 'Replacement footer', '1056px', '816px'],
      [[], null, null, '1056px', '816px'],
      [['Even sectionEnd of even section'], evenHeaders ? 'Even header' : 'Continuous header', evenHeaders ? 'Even footer' : 'Replacement footer', '1056px', '816px'],
      [['Continuous after a saved break'], 'Continuous header', 'Replacement footer', '1056px', '816px'],
      [[], null, null, '1056px', '816px'],
      [['Odd section'], 'First-page header', null, '1056px', '816px'],
      [['Restart at page 21'], 'Continuous header', 'Replacement footer', '1056px', '816px'],
      [['Page 22'], evenHeaders ? 'Even header' : 'Continuous header', evenHeaders ? 'Even footer' : 'Replacement footer', '1056px', '816px']
    ];
    for (let render = 0; render < 3; render++) {
      expect(await pages.evaluateAll(elements => elements.map(page => [
        [...page.querySelectorAll(':scope > article')].map(article => article.textContent),
        page.querySelector(':scope > header')?.textContent ?? null,
        page.querySelector(':scope > footer')?.textContent ?? null,
        getComputedStyle(page).width,
        getComputedStyle(page).minHeight
      ]))).toEqual(expected);
      await expect(pages.nth(1).locator('article').nth(1)).toHaveCSS('column-count', '2');
      await expect(pages.nth(3)).toHaveCSS('padding-left', '96px');
      await expect(pages.nth(9).locator('#numbering-restart')).toHaveCount(1);
      if (render < 2) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
  });
}

for (const [unequal, rtl] of [[false, false], [false, true], [true, false], [true, true]]) {
  test(`paginates DOCX line breaks through ${unequal ? 'unequal' : 'equal-width'} columns (RTL=${rtl})`, async ({ page }) => {
    await prepare(page);
    const { bytes, text } = createDocxLinePaginationFixture({ count: 26, columns: 2, unequal, rtl });
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'automatic-columns.docx', extension: 'docx' } });
    }, [...bytes]);
    const pages = page.locator('section.docx');
    const columns = pages.locator('article > div:not([aria-hidden])');
    for (let render = 0; render < 2; render++) {
      await expect(pages).toHaveCount(2);
      await expect(pages.nth(0).locator('article > div:not([aria-hidden])')).toHaveCount(2);
      await expect(pages.nth(1).locator('article > div:not([aria-hidden])')).toHaveCount(1);
      const parts = await columns.locator('a').allTextContents();
      expect(parts.map(part => part.match(/Line /g)?.length)).toEqual([7, 10, 9]);
      expect(parts.join('')).toBe(text);
      await expect(columns.last().locator('a')).toHaveAttribute('href', '#opening');
      await expect(columns.last().locator('span').first()).toHaveCSS('font-weight', '700');
      await expect(columns.last()).toContainText('Closing paragraph');
      await expect(pages.locator('.docxv-column-separator')).toHaveCount(1);
      const geometry = await pages.evaluateAll(pages => {
        return pages.map(page => {
          (page as HTMLElement).style.contentVisibility = 'visible';
          const columns = Array.from(page.querySelectorAll('article > div:not([aria-hidden])'), column => {
            const { top, left, right, width } = column.getBoundingClientRect();
            return { top, left, right, width };
          });
          const height = page.getBoundingClientRect().height;
          (page as HTMLElement).style.contentVisibility = '';
          return { columns, height };
        });
      });
      expect(geometry.map(page => page.height)).toEqual([400, 400]);
      expect(geometry.flatMap(page => page.columns.map(column => column.width))).toEqual(unequal ? [180, 120, 180] : [150, 150, 150]);
      const [first, second] = geometry[0].columns;
      expect(first.top).toBe(second.top);
      expect(rtl ? first.left - second.right : second.left - first.right).toBe(20);
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    await page.setViewportSize({ width: 900, height: 360 });
    const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
    await page.addStyleTag({ content: `section.docx:not(.${activeClass}) article p:has(a) { line-height: 24px !important; }` });
    const before = await readingLine(page, 'Line 18', true);
    expect(Math.abs(before.inset - 8)).toBeLessThan(1);
    expect(before.page).toBe(1);
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    await expect.poll(async () => (await readingLine(page, 'Line 18')).page).toBe(0);
    await expect.poll(async () => Math.abs((await readingLine(page, 'Line 18')).inset - before.inset)).toBeLessThan(1);
  });
}

for (const unequal of [false, true]) {
  test(`balances DOCX sections after full pages (unequal=${unequal})`, async ({ page }) => {
    await prepare(page);
    const { bytes, text } = createDocxLinePaginationFixture({
      columns: 2, unequal, rtl: unequal, count: 26, noColumnBalance: unequal ? false : null
    });
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'balanced-columns.docx', extension: 'docx' } });
    }, [...bytes]);
    const pages = page.locator('section.docx');
    const columns = pages.locator('article > div:not([aria-hidden])');
    for (let render = 0; render < 2; render++) {
      await expect(pages).toHaveCount(2);
      await expect(columns).toHaveCount(4);
      const parts = await columns.locator('a').allTextContents();
      expect(parts.map(part => part.match(/Line /g)?.length)).toEqual(unequal ? [7, 10, 6, 3] : [7, 10, 5, 4]);
      expect(parts.join('')).toBe(text);
      await expect(columns.last().locator('a')).toHaveAttribute('href', '#opening');
      await expect(columns.last().locator('p').last()).toHaveText('Closing paragraph');
      const heights = await columns.evaluateAll(columns => columns.slice(-2).map(column => {
        const blocks = Array.from(column.querySelectorAll('p'), p => p.getBoundingClientRect());
        return blocks.at(-1)!.bottom - blocks[0].top;
      }));
      expect(heights).toEqual(unequal ? [180, 150] : [150, 150]);
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
    await page.setViewportSize({ width: 900, height: 360 });
    const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
    await page.addStyleTag({ content: `section.docx:not(.${activeClass}) article p:has(a) { line-height: 24px !important; }` });
    const before = await readingLine(page, 'Line 18', true);
    expect(before.page).toBe(1);
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    await expect.poll(async () => (await readingLine(page, 'Line 18')).page).toBe(0);
    await expect.poll(async () => Math.abs((await readingLine(page, 'Line 18')).inset - before.inset)).toBeLessThan(1);
  });
}

test('fills DOCX columns in order when Word disables balancing', async ({ page }) => {
  await prepare(page);
  const { bytes } = createDocxLinePaginationFixture({ columns: 2, count: 5, openingCount: 2 });
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'sequential-columns.docx', extension: 'docx' } });
  }, [...bytes]);
  const columns = page.locator('section.docx article > div:not([aria-hidden])');
  await expect(columns).toHaveCount(1);
  await expect(columns.first()).toContainText('Closing paragraph');
});

test('balances a short DOCX section across all four columns', async ({ page }) => {
  await prepare(page);
  const { bytes, text } = createDocxLinePaginationFixture({
    columns: 4, count: 8, openingCount: 1, direct: false, noColumnBalance: null
  });
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'four-balanced-columns.docx', extension: 'docx' } });
  }, [...bytes]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(1);
  const columns = pages.locator('article > div:not([aria-hidden])');
  await expect(columns).toHaveCount(4);
  expect((await columns.locator('a').allTextContents()).join('')).toBe(text);
  const heights = await columns.evaluateAll(columns => columns.map(column => {
    const blocks = Array.from(column.querySelectorAll('p'), p => p.getBoundingClientRect());
    return blocks.at(-1)!.bottom - blocks[0].top;
  }));
  expect(heights).toEqual([90, 90, 60, 60]);
});

test('continues DOCX table rows across automatic column and page boundaries', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'column-tables.docx', extension: 'docx' } });
  }, [...createDocxAutomaticPaginationFixture(2)]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(2);
  await expect(pages.locator('header')).toHaveText(['Odd header', 'Even header']);
  const columns = pages.locator('article > div:not([aria-hidden])');
  await expect(columns).toHaveCount(4);
  await expect(columns.nth(1).locator('p').first()).toHaveText('Heading with next paragraph');
  expect(await columns.locator('td:first-child').allTextContents()).toEqual([
    'Column heading', ...Array.from({ length: 6 }, (_, i) => `Row ${i + 1}`),
    'Column heading', ...Array.from({ length: 9 }, (_, i) => `Row ${i + 7}`),
    'Column heading', ...Array.from({ length: 4 }, (_, i) => `Row ${i + 16}`)
  ]);
  await expect(columns.nth(2).getByText('Info 7', { exact: true }).locator('xpath=ancestor::td')).toHaveAttribute('rowspan', '2');
});

test('continues DOCX tables at the width of each unequal column', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 });
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'unequal-column-tables.docx', extension: 'docx' } });
  }, [...createDocxAutomaticPaginationFixture(2, true, true)]);
  const pages = page.locator('section.docx');
  const tables = pages.locator('article > div > table');
  for (let render = 0; render < 2; render++) {
    expect(await pages.count()).toBeGreaterThan(1);
    expect(await tables.count()).toBeGreaterThan(2);
    expect(await tables.locator('tr:not(:first-of-type) td:first-child').allTextContents())
      .toEqual(Array.from({ length: 19 }, (_, index) => `Row ${index + 1}`));
    await expect(tables.locator('tr:first-of-type td:first-child')).toHaveText(Array(await tables.count()).fill('Column heading'));
    await expect(tables.getByText('Info 7', { exact: true }).locator('xpath=ancestor::td')).toHaveAttribute('rowspan', '2');
    const geometry = await pages.evaluateAll(pages => pages.map(page => {
      const element = page as HTMLElement;
      element.style.contentVisibility = 'visible';
      const height = element.getBoundingClientRect().height;
      const tables = Array.from(element.querySelectorAll('article > div > table'), table => ({
        width: table.getBoundingClientRect().width,
        column: table.parentElement!.getBoundingClientRect().width,
        rowHeights: Array.from((table as HTMLTableElement).rows).slice(1)
          .filter(row => row.cells.length === 2 && row.cells[1].rowSpan === 1)
          .map(row => row.getBoundingClientRect().height)
      }));
      element.style.contentVisibility = '';
      return { height, tables };
    }));
    expect(geometry.every(page => Math.abs(page.height - 400) < 0.5)).toBe(true);
    const fragments = geometry.flatMap(page => page.tables);
    expect(new Set(fragments.map(table => table.column))).toEqual(new Set([480, 220]));
    expect(fragments.every(table => Math.abs(table.width - table.column) < 0.5)).toBe(true);
    expect(Math.max(...fragments.filter(table => table.column === 220).flatMap(table => table.rowHeights)))
      .toBeGreaterThan(Math.max(...fragments.filter(table => table.column === 480).flatMap(table => table.rowHeights)));
    if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
  }
  const activeClass = (await pages.first().getAttribute('class'))!.split(' ').find(name => name.startsWith('filens-docx-'));
  await page.addStyleTag({ content: `section.docx:not(.${activeClass}) p[class$="_opening"] { line-height: 86px !important }` });
  const row = tables.getByText('Row 10', { exact: true }).locator('xpath=ancestor::tr');
  const position = (scroll = false) => row.evaluate((element, scroll) => {
    const root = element.closest('.docxv-preview')!;
    if (scroll) root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top + 8;
    return {
      page: Array.from(element.closest('.docx-wrapper')!.children).indexOf(element.closest('section')!),
      inset: root.getBoundingClientRect().top - element.getBoundingClientRect().top
    };
  }, scroll);
  expect((await position(true)).inset).toBeCloseTo(8, 0);
  const { page: oldPage } = await position();
  await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
  await expect.poll(async () => (await position()).page).not.toBe(oldPage);
  await expect.poll(async () => (await position()).inset).toBeCloseTo(8, 0);
});

for (const rtl of [false, true]) {
  test(`rewraps DOCX text across unequal columns and pages (RTL=${rtl})`, async ({ page }) => {
    await prepare(page);
    const { bytes, text } = createDocxLinePaginationFixture({ wrap: true, unequal: true, rtl, noColumnBalance: null });
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'unequal-columns.docx', extension: 'docx' } });
    }, [...bytes]);
    const pages = page.locator('section.docx');
    for (let render = 0; render < 2; render++) {
      expect(await pages.count()).toBeGreaterThan(1);
      const columns = pages.locator('article > div:not([aria-hidden])');
      const parts = await columns.locator('a').allTextContents();
      expect(parts.join('')).toBe(text);
      expect(parts[0].length).toBeGreaterThan(parts[1].length);
      const clusters = new Intl.Segmenter().segment(text);
      let offset = 0;
      for (const part of parts) {
        expect(clusters.containing(offset)?.index).toBe(offset);
        offset += part.length;
      }
      await expect(columns.locator('a').last()).toHaveAttribute('href', '#opening');
      await expect(columns.locator('a span').last()).toHaveCSS('font-weight', '700');
      await expect(pages.last()).toContainText('Closing paragraph');
      const geometry = await pages.evaluateAll(pages => pages.map(page => {
        const element = page as HTMLElement;
        element.style.contentVisibility = 'visible';
        const height = element.getBoundingClientRect().height;
        const columns = Array.from(element.querySelectorAll('article > div:not([aria-hidden])'), column => {
          const { left, right, width } = column.getBoundingClientRect();
          return { left, right, width };
        });
        element.style.contentVisibility = '';
        return { height, columns };
      }));
      expect(geometry.every(page => Math.abs(page.height - 400) < 0.5)).toBe(true);
      for (const { columns } of geometry) {
        expect(columns.map(column => column.width)).toEqual(columns.length === 2 ? [180, 120] : [180]);
        const [first, second] = columns;
        if (second) expect(rtl ? first.left - second.right : second.left - first.right).toBe(20);
      }
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
  });
}

test('keeps a DOCX heading with the next paragraph in a narrower column', async ({ page }) => {
  await prepare(page);
  const { bytes } = createDocxLinePaginationFixture({ unequal: true, count: 1, openingCount: 8, keepNext: true });
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'unequal-keep-next.docx', extension: 'docx' } });
  }, [...bytes]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(1);
  const columns = pages.locator('article > div:not([aria-hidden])');
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(0).locator('a')).toContainText('Line 01');
  await expect(columns.nth(1).locator('p')).toHaveText(['Keep heading', 'Closing paragraph']);
  await expect(columns.nth(1)).toHaveCSS('width', '120px');
});

test('uses Word saved breaks for unequal DOCX columns on the same page', async ({ page }) => {
  await prepare(page);
  const { bytes, text } = createDocxLinePaginationFixture({ count: 26, columns: 2, unequal: true, saved: [7, 17] });
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'saved-unequal-columns.docx', extension: 'docx' } });
  }, [...bytes]);
  const pages = page.locator('section.docx');
  await expect(pages).toHaveCount(2);
  const columns = pages.locator('article > div:not([aria-hidden])');
  const parts = await columns.locator('a').allTextContents();
  expect(parts.map(part => part.match(/Line /g)?.length)).toEqual([7, 10, 9]);
  expect(parts.join('')).toBe(text);
  await expect(columns.nth(0)).toHaveCSS('width', '180px');
  await expect(columns.nth(1)).toHaveCSS('width', '120px');
  await expect(columns.nth(2)).toHaveCSS('width', '180px');
});

for (const [rtl, mode] of [[false, 14], [true, 14], [false, 15]] as const) {
  test(`lays out authored DOCX columns through font relayout (RTL=${rtl}, compatibility=${mode})`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async bytes => {
      const { session } = (window as any).docxTest;
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'columns.docx', extension: 'docx' } });
    }, [...createDocxColumnBreakFixture(rtl, mode)]);
    const pages = page.locator('section.docx');
    const first = pages.first().locator('article');
    const columns = first.locator(':scope > div:not([aria-hidden])');
    for (let render = 0; render < 2; render++) {
      await expect(pages).toHaveCount(2);
      await expect(columns).toHaveText(mode === 14 ? ['Initial column', 'Manual column', 'New section'] : ['Initial column', 'Manual column']);
      await expect(pages.nth(1)).toHaveText(mode === 14 ? 'After the third columnTail' : 'New sectionAfter the third columnTail');
      await expect(first.locator('.docxv-column-separator')).toHaveCount(mode === 14 ? 2 : 1);
      await expect(columns.nth(0).getByRole('link')).toHaveAttribute('href', '#tail');
      await expect(columns.nth(1).getByRole('link')).toHaveAttribute('href', '#tail');
      await expect(columns.nth(1).getByText('Manual column')).toHaveCSS('font-weight', '700');
      const [a, b, c] = await columns.evaluateAll(items => items.map(item => {
        const box = item.getBoundingClientRect();
        return { width: box.width, left: box.left, top: box.top, right: box.right };
      }));
      expect(a.width).toBeCloseTo(240, 1);
      expect(b.width).toBeCloseTo(200, 1);
      expect(b.top).toBeCloseTo(a.top, 1);
      expect(rtl ? a.left - b.right : b.left - a.right).toBeCloseTo(20, 1);
      if (c) {
        expect(c.width).toBeCloseTo(240, 1);
        expect(rtl ? b.left - c.right : c.left - b.right).toBeCloseTo(20, 1);
      }
      if (!render) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
  });
}

test('retains DOCX paper heights offscreen and keeps the reading page after font relayout', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await prepare(page);
  await page.evaluate(async bytes => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'mixed-paper.docx', extension: 'docx' } });
  }, [...createDocxPageScrollFixture()]);
  const pages = page.locator('section.docx'), root = page.locator('.docxv-preview');
  const height = (index: number) => pages.nth(index).evaluate(element => element.getBoundingClientRect().height);
  await expect(pages).toHaveCount(220);
  expect(await height(180)).toBeCloseTo(1056, 1);
  expect(await height(181)).toBeCloseTo(816, 1);
  await expect.poll(() => height(0)).toBeGreaterThan(2000);
  const firstHeight = await height(0);

  const readingPage = pages.nth(174);
  const scrollToInset = (inset: number) => readingPage.evaluate((element, inset) => {
    const root = element.closest('.docxv-preview')!;
    root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top + inset;
  }, inset);
  const offset = () => readingPage.evaluate(element =>
    element.closest('.docxv-preview')!.getBoundingClientRect().top - element.getBoundingClientRect().top);
  await scrollToInset(120);
  await expect.poll(() => height(174)).toBeGreaterThan(2000);
  await scrollToInset(1200);
  await expect.poll(offset).toBeCloseTo(1200, 0);
  await expect.poll(() => height(0)).toBeCloseTo(firstHeight, 0);
  for (let repeat = 0; repeat < 2; repeat++) {
    await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    await expect.poll(offset).toBeCloseTo(1200, 0);
    await expect(readingPage).toBeInViewport();
  }
  await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(pages.last().getByText('Page 220', { exact: true })).toBeInViewport();
});

test('opens real DOCX tables and images and releases embedded resources when switching or destroying', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
  const counts = [];
  for (const name of ['filens-aurora-guide.docx', 'rich-docx-images.docx', 'rich-docx-tables.docx']) {
    counts.push(await page.evaluate(async name => {
      const { host, session, active } = (window as any).docxTest;
      const source = new Uint8Array(await (await fetch(new URL('samples/' + name, location.href))).arrayBuffer());
      await session.load(source, { descriptor: { source, name, extension: 'docx' } });
      const images = [...host.querySelectorAll('img')] as HTMLImageElement[]; await Promise.all(images.map(image => image.decode()));
      return { images: images.length, tables: host.querySelectorAll('table').length, urls: active.size, error: session.getState().error };
    }, name));
    await expect(page.locator('section.docx').first()).toBeVisible();
  }
  expect(counts[0]).toMatchObject({ images: 3, tables: 2, urls: 2, error: null });
  expect(counts[1].images).toBeGreaterThan(0); expect(counts[2].tables).toBeGreaterThan(0);
  expect(await page.evaluate(() => { const { session, host, active } = (window as any).docxTest; session.destroy(); return { urls: active.size, empty: !host.childElementCount }; })).toEqual({ urls: 0, empty: true });
  expect(errors).toEqual([]);
});

test('keeps the current DOCX when a replaced network response arrives late', async ({ page }) => {
  let complete!: () => void, requested!: () => void;
  const response = new Promise<void>(resolve => { complete = resolve; }), request = new Promise<void>(resolve => { requested = resolve; });
  const old = createDocxFixture(2);
  await page.route('**/delayed.docx', async route => { requested(); await response; await route.fulfill({ body: Buffer.from(old), contentType: 'application/octet-stream' }).catch(() => {}); });
  await prepare(page);
  await page.evaluate(() => { const state = (window as any).docxTest; state.pending = state.session.load('/delayed.docx', { descriptor: { source: '/delayed.docx', name: 'old.docx', extension: 'docx' } }); });
  await request;
  await page.evaluate(async () => {
    const { session } = (window as any).docxTest;
    const source = new Uint8Array(await (await fetch(new URL('samples/rich-docx-tables.docx', location.href))).arrayBuffer());
    await session.load(source, { descriptor: { source, name: 'current.docx', extension: 'docx' } });
  });
  complete();
  await page.evaluate(async () => { await (window as any).docxTest.pending; });
  expect(await page.evaluate(() => (window as any).docxTest.session.getState())).toMatchObject({ title: 'current.docx', loading: false, error: null });
  await expect(page.locator('table').first()).toBeVisible(); await expect(page.getByText('Image 1', { exact: true })).toHaveCount(0);
});

test('releases a real image URL created while an in-flight DOCX is cancelled', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async bytes => {
    const state = (window as any).docxTest, controller = new AbortController(), source = new Uint8Array(bytes);
    state.onCreate = () => controller.abort();
    let failure: string | undefined;
    try { await state.session.load(source, { descriptor: { source, name: 'abort.docx', extension: 'docx' }, signal: controller.signal }); } catch (error: any) { failure = error.name; }
    return { failure, urls: state.active.size, documents: state.host.querySelectorAll('.docx').length, state: state.session.getState() };
  }, [...createDocxFixture(4)]);
  expect(result).toMatchObject({ failure: 'AbortError', urls: 0, documents: 0, state: { loading: false, error: null } });
});

test('opens a DOCX upload through the demo with every repeated image intact', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: 'images.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(createDocxFixture(3)) });
  await expect(page.locator('.docxv-document img')).toHaveCount(3);
  await expect(page.getByText('Image 3', { exact: true })).toBeVisible();
  expect(await page.locator('.docxv-document img').evaluateAll(async images => { await Promise.all((images as HTMLImageElement[]).map(image => image.decode())); return images.every(image => (image as HTMLImageElement).naturalWidth === 256); })).toBe(true);
  expect(errors).toEqual([]);
});
