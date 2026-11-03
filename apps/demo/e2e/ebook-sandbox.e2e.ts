import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createComicFixture, createStyledBookFixture } from '../../../packages/ebook/test/fixtures/books.mjs';

let runtime: string;
let styles: string;

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [resolve('packages/ebook/src/preview-driver.ts')],
    bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.css': 'empty' }
  });
  runtime = bundle.outputFiles[0]!.text;
  styles = await readFile(resolve('packages/ebook/src/styles/index.css'), 'utf8');
});

async function openSandbox(page: Page, bytes: Uint8Array, extension = 'epub') {
  await page.goto('./');
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.className = 'ebook-sandbox';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; connect-src data: blob:; frame-src blob:"><div id="book"></div>`;
    document.body.replaceChildren(frame);
  });
  const sandbox = page.frameLocator('.ebook-sandbox');
  await sandbox.locator('#book').evaluate(async (host, { runtime, styles, bytes, extension }) => {
    const url = URL.createObjectURL(new Blob([runtime], { type: 'text/javascript' }));
    try {
      const { createEbookPreviewDriver } = await import(/* @vite-ignore */ url);
      const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
      const source = new Uint8Array(bytes);
      const session = createEbookPreviewDriver().createSession(host);
      await session.load(source, { descriptor: { source, extension } });
    } finally { URL.revokeObjectURL(url); }
  }, { runtime, styles, bytes: [...bytes], extension });
  expect(await sandbox.locator('#book').evaluate(() => window.origin)).toBe('null');
  expect(await sandbox.locator('#book').evaluate(() => {
    try { return !!parent.document; } catch { return false; }
  })).toBe(false);
  return sandbox;
}

test('renders Pepper & Carrot images and styles inside a share-style opaque sandbox', async ({ page }) => {
  const sandbox = await openSandbox(page, await readFile(resolve('apps/demo/public/samples/pepper-carrot.epub')));
  const chapter = sandbox.frameLocator('.ebookv-frame');
  await expect(chapter.locator('.eyebrow')).toHaveCSS('color', 'rgb(160, 113, 55)');
  expect(await chapter.locator('svg image').evaluate(async element => {
    const image = new Image(); image.src = element.getAttribute('href')!; await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([1200, 1660]);
  await sandbox.getByRole('button', { name: 'Read the comic', exact: true }).click();
  for (const image of await chapter.locator('img').all()) {
    expect(await image.evaluate(async (image: HTMLImageElement) => {
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    })).toEqual([1200, 1660]);
  }
  await expect(chapter.locator('.spread')).toHaveCSS('display', 'flex');
});

test('loads imported CSS, fonts and backgrounds in opaque EPUB chapters', async ({ page }) => {
  const sandbox = await openSandbox(page, await createStyledBookFixture());
  const chapter = sandbox.frameLocator('.ebookv-frame');
  for (const title of ['First chapter', 'Last chapter']) {
    await expect(chapter.locator('h1')).toHaveText(title);
    await expect(chapter.locator('.imported')).toHaveCSS('color', 'rgb(18, 52, 86)');
    expect(await chapter.locator('.font').evaluate(async element =>
      (await element.ownerDocument.fonts.load('16px EpubFixture', 'A')).length)).toBe(1);
    expect(await chapter.locator('.cover').first().evaluate(async element => {
      const image = new Image(); image.src = getComputedStyle(element).backgroundImage.slice(5, -2);
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    })).toEqual([80, 64]);
    await sandbox.getByRole('button', { name: 'Last chapter', exact: true }).click();
  }
});

test('renders CBZ pages inside an opaque sandbox', async ({ page }) => {
  const sandbox = await openSandbox(page, await createComicFixture(2), 'cbz');
  const chapter = sandbox.frameLocator('.ebookv-frame');
  for (const title of ['Page 1', 'Page 2']) {
    await expect(sandbox.locator('.ebookv-chapter-tab.is-active')).toHaveText(title);
    const size = await chapter.locator('img').evaluate(async (image: HTMLImageElement) => {
      await image.decode(); return [image.naturalWidth, image.naturalHeight];
    });
    // WebKit reports the fitted dimensions for an SVG image.
    expect(size[0]).toBeGreaterThan(0);
    expect(size[0]! / size[1]!).toBeCloseTo(600 / 800);
    await sandbox.getByRole('button', { name: 'Page 2', exact: true }).click();
  }
});
