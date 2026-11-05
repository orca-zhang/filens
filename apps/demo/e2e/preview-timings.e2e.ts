import { expect, test } from '@playwright/test';

test('separates a cold SDK load from file downloads and resets timings for a local file', async ({ page }) => {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(1));
  await page.route('**/packages/vue/src/index.ts*', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  const fileUrl = 'https://files.example.test/timed.txt';
  await page.route(fileUrl, async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({ body: 'A timed remote file.', contentType: 'text/plain' });
  });
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&lang=en`);
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  const timings = page.locator('.wb-runtime-timings');
  const duration = async (label: string) => Number.parseFloat(await timings.locator('span').filter({ has: page.locator('small', { hasText: label }) }).locator('strong').innerText());
  const coldSdk = await duration('SDK Loading');
  expect(coldSdk).toBeGreaterThanOrEqual(700);
  expect(await duration('Download')).toBeGreaterThanOrEqual(700);
  expect(await duration('Rendering')).toBeGreaterThan(0);

  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('A local file.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('A local file.');
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await expect(timings).not.toContainText('Download');
  await expect(timings).not.toContainText('Conversion');
  expect(await duration('SDK Loading')).toBeLessThan(coldSdk);
  expect(await duration('Rendering')).toBeGreaterThan(0);
});

test('reports rendering after a slow prefetched conversion source and separates WASM loading', async ({ page }) => {
  await page.route('**/samples/legacy-project-workflow.doc', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.route('**/externals/converter-core.wasm', async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
  await page.goto('./?view=preview&format=doc&lang=en');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('legacy-project-workflow.doc');
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  const timings = page.locator('.wb-runtime-timings');
  const duration = async (label: string) => Number.parseFloat(await timings.locator('span').filter({ has: page.locator('small', { hasText: label }) }).locator('strong').innerText());
  expect(await duration('Download')).toBeGreaterThanOrEqual(700);
  expect(await duration('SDK Loading')).toBeGreaterThanOrEqual(700);
  expect(await duration('Conversion')).toBeGreaterThan(0);
  expect(await duration('Rendering')).toBeGreaterThan(0);
});

test('does not charge a previous file’s pending renderer import to the new preview', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const routeFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route('**/packages/docx/src/index.ts*', async route => {
    await gate;
    try {
      await route.continue();
    } finally {
      finished();
    }
  });
  const pendingImport = page.waitForRequest('**/packages/docx/src/index.ts*');
  await page.goto('./?view=preview&format=docx&lang=en', { waitUntil: 'domcontentloaded' });
  await pendingImport;
  await page.getByLabel('Import files', { exact: true }).setInputFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this preview.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('Keep this preview.');
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  const timings = page.locator('.wb-runtime-timings');
  const rendering = timings.locator('span').filter({ has: page.locator('small', { hasText: 'Rendering' }) }).locator('strong');
  expect(Number.parseFloat(await rendering.innerText())).toBeGreaterThan(0);
  const before = await timings.innerText();
  release();
  await routeFinished;
  expect(await timings.innerText()).toBe(before);
});
