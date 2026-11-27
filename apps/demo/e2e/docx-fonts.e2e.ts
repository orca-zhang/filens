import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { embeddedFontDocument, withEmbeddingFlags } from '../../../packages/docx/test/fixtures/embedded-font-document';

test('uses permitted embedded DOCX faces per preview and releases them independently', async ({ page }) => {
  const family = 'FiLens Embedded Test Face';
  const font = (variant: string) => readFile(resolve(`node_modules/pdfjs-dist/standard_fonts/LiberationSans-${variant}.ttf`));
  const [regular, bold, italic, boldItalic] = await Promise.all(['Regular', 'Bold', 'Italic', 'BoldItalic'].map(font));
  const first = await embeddedFontDocument([
    { family, bytes: regular }, { family, bytes: bold, variant: 'Bold' },
    { family, bytes: italic, variant: 'Italic' }, { family, bytes: boldItalic, variant: 'BoldItalic' },
    { family: 'Restricted Face', bytes: withEmbeddingFlags(regular, 0x0002) },
    { family: 'Bitmap Face', bytes: withEmbeddingFlags(regular, 0x0200) },
    { family: 'Corrupt Face', bytes: new Uint8Array([1, 2, 3]) },
    { family: 'Missing Face' }, { family: 'External Face', external: true }
  ]);
  const second = await embeddedFontDocument([{ family, bytes: bold, plain: true }]);
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/docx/src/index.ts')}`, page.url()).href;
  const before = await page.evaluate(async ({ moduleUrl, files }) => {
    const { createDocxPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const loadFont = FontFace.prototype.load;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    FontFace.prototype.load = async function () { await gate; return loadFont.call(this); };
    const drivers = files.map((bytes, index) => {
      const host = document.createElement('div');
      host.id = `embedded-docx-${index}`;
      host.style.height = '420px';
      document.body.append(host);
      const source = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
      const session = createDocxPreviewDriver().createSession(host);
      return { host, session, open: () => session.load(source, { descriptor: { source, extension: 'docx' } }) };
    });
    await Promise.all(drivers.map(driver => driver.open()));
    const firstRoot = drivers[0].host.querySelector('.docxv-preview')!;
    firstRoot.scrollTop = 175;
    (window as any).embeddedDocx = { drivers, release };
    return {
      pages: drivers[0].host.querySelectorAll('section.docx').length,
      fonts: drivers[0].session.getState().fonts,
      registered: [...document.fonts].filter(face => face.family.startsWith('filens-docx-embedded-')).length,
      scroll: firstRoot.scrollTop
    };
  }, { moduleUrl, files: [first, second].map(bytes => Buffer.from(bytes).toString('base64')) });
  expect(before.pages).toBe(2);
  expect(before.scroll).toBe(175);
  expect(before.registered).toBe(0);
  expect(before.fonts).toContainEqual(expect.objectContaining({ fontFamily: family, embedded: true, status: 'unknown' }));
  await page.evaluate(() => (window as any).embeddedDocx.release());
  const inventory = () => page.evaluate(() => (window as any).embeddedDocx.drivers[0].session.getState().fonts);
  await expect.poll(inventory).toContainEqual(expect.objectContaining({ fontFamily: family, embedded: true, status: 'available', source: 'embedded' }));
  for (const name of ['Restricted Face', 'Bitmap Face', 'Corrupt Face', 'Missing Face', 'External Face']) {
    expect(await inventory()).toContainEqual(expect.objectContaining({ fontFamily: name, embedded: true, status: 'unknown' }));
  }
  const after = await page.evaluate(async () => {
    const [first, second] = (window as any).embeddedDocx.drivers;
    const firstRoot = first.host.querySelector('.docxv-preview');
    const one = first.host.querySelector('article span');
    const two = second.host.querySelector('article span');
    const theme = [...first.host.querySelectorAll('article span')].find((span: any) => span.textContent === 'Theme text') as HTMLElement;
    const symbol = [...first.host.querySelectorAll('article span span')].find((span: any) => span.textContent === '+') as HTMLElement;
    const alias = (element: HTMLElement) => getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '');
    const own = () => [...document.fonts].filter(face => face.family.startsWith('filens-docx-embedded-'));
    const firstAlias = alias(one), secondAlias = alias(two);
    const widths = [one, two].map(el => el.getBoundingClientRect().width);
    const variants = own().filter(face => face.family === firstAlias).map(face => [face.weight, face.style, face.status]);
    const content = [alias(theme), alias(symbol)];
    await first.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true });
    const refreshAlias = alias(first.host.querySelector('article span'));
    const scroll = firstRoot.scrollTop;
    first.session.destroy();
    const siblingFaces = own().map(face => face.family);
    second.session.destroy();
    return { firstAlias, secondAlias, widths, variants, content, refreshAlias, scroll, siblingFaces, remaining: own().length };
  });
  expect(after.firstAlias).not.toBe(after.secondAlias);
  expect(Math.abs(after.widths[0] - after.widths[1])).toBeGreaterThan(1);
  expect(after.variants).toEqual([
    ['400', 'normal', 'loaded'], ['700', 'normal', 'loaded'], ['400', 'italic', 'loaded'], ['700', 'italic', 'loaded']
  ]);
  expect(after.content).toEqual([after.firstAlias, after.firstAlias]);
  expect(after.refreshAlias).toBe(after.firstAlias);
  expect(after.scroll).toBe(before.scroll);
  expect(after.siblingFaces).toEqual([after.secondAlias]);
  expect(after.remaining).toBe(0);
});
