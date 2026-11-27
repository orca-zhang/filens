import { expect, test, type Page } from '@playwright/test';
import { createComicFixture, createNavigationBookFixture } from '../../../packages/ebook/test/fixtures/books.mjs';

async function openBook(page: Page, bytes: Uint8Array, extension: 'epub' | 'cbz', language = 'en') {
  await page.goto(`./?view=preview&lang=${language}`);
  await page.locator('.wb-upload input[type=file]').setInputFiles({ name: `book.${extension}`, mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  const book = page.locator('.ebookv-preview');
  return { book, frame: book.frameLocator('.ebookv-frame') };
}

for (const kind of ['epub3', 'ncx']) {
  test(`opens ${kind} nested contents and jumps to chapter fragments`, async ({ page }) => {
    const chapterRequests: string[] = [];
    page.on('request', request => { if (/\/chapter-3\.xhtml(?:$|[?#])/.test(request.url())) chapterRequests.push(request.url()); });
    const { book, frame } = await openBook(page, await createNavigationBookFixture(kind), 'epub');
    await expect(frame.locator('h1')).toHaveText('Chapter 1');
    await book.getByText('Table of contents', { exact: true }).click();
    const contents = book.locator('.ebookv-contents');
    const nested = contents.locator(':scope > ol > li > ol');
    const first = nested.getByRole('button', { name: 'Deep sky', exact: true });
    const second = nested.getByRole('button', { name: 'Winter sky', exact: true });
    await expect(contents.getByText('Part One', { exact: true })).toBeVisible();
    await expect(contents.getByText('Landmark', { exact: true })).toHaveCount(0);
    await expect(contents.getByText('External destination', { exact: true })).toHaveCount(0);
    await first.click();
    await expect(first).toHaveAttribute('aria-current', 'location');
    await expect(frame.locator('h1')).toHaveText('Chapter 2');
    const anchor = frame.locator('[id="café"]');
    await expect(anchor).toBeInViewport();
    await anchor.evaluate(node => { node.dataset.retained = 'yes'; });
    await second.click();
    await expect(second).toHaveAttribute('aria-current', 'location');
    await expect(frame.locator('#p79')).toBeInViewport();
    await expect(anchor).toHaveAttribute('data-retained', 'yes');
    await frame.getByRole('link', { name: 'Jump to the last chapter' }).click();
    await expect(frame.locator('h1')).toHaveText('Chapter 3');
    await expect(frame.locator('#p79')).toBeInViewport();
    await expect(book.getByRole('spinbutton', { name: 'Chapter number' })).toHaveValue('3');
    expect(chapterRequests).toEqual([]);
  });
}

test('switches EPUB reading themes in place and keeps the selection across chapters', async ({ page }) => {
  const { book, frame } = await openBook(page, await createNavigationBookFixture(), 'epub');
  await book.getByText('Table of contents', { exact: true }).click();
  await book.locator('.ebookv-contents').getByRole('button', { name: 'Deep sky', exact: true }).click();
  const anchor = frame.locator('[id="café"]'), theme = book.getByRole('combobox', { name: 'Reading theme' });
  await expect(anchor).toBeInViewport();
  const scroll = await anchor.evaluate(node => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await expect(anchor).toHaveCSS('color', 'rgb(0, 0, 0)');
  await theme.selectOption('dark');
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(24, 26, 30)');
  await expect(anchor).toHaveCSS('color', 'rgb(231, 233, 236)');
  expect(await anchor.evaluate(node => window.scrollY)).toBe(scroll);
  await theme.selectOption('sepia');
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(244, 236, 216)');
  const number = book.getByRole('spinbutton', { name: 'Chapter number' });
  await number.fill('3');
  await number.press('Enter');
  await expect(frame.locator('h1')).toHaveText('Chapter 3');
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(244, 236, 216)');
  await theme.selectOption('original');
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('jumps directly to a comic page and applies a translated reading theme on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 760 });
  const { book, frame } = await openBook(page, await createComicFixture(50), 'cbz', 'zh-CN');
  const image = frame.locator('img');
  await expect(image).toHaveAttribute('alt', 'Page 1');
  const number = book.getByRole('spinbutton', { name: '页码' });
  await number.fill('51');
  await number.press('Enter');
  await expect(image).toHaveAttribute('alt', 'Page 1');
  await number.fill('50');
  await book.getByRole('button', { name: '跳转', exact: true }).click();
  await expect(image).toHaveAttribute('alt', 'Page 50');
  await book.getByRole('combobox', { name: '阅读主题' }).selectOption({ label: '浅色' });
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(image).toBeInViewport();
});
