import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDocxFixture, createDocxPaginationFixture, createDocxSectionsFixture } from '../../../packages/docx/test/fixtures/document.mjs';

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
      if (render < 2) await page.evaluate(() => (window as any).docxTest.session.refreshFonts({ references: [], loaded: [], warnings: [], relayout: true }));
    }
  });
}

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
