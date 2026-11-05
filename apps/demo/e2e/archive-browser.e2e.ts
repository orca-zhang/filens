import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

async function upload(page: Page, zip: JSZip) {
  await page.goto('./?view=preview&lang=en');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'project-files.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  await expect(page.locator('.archivev-row').first()).toBeVisible();
}

test('browses larger rows, searches and sorts files, and distinguishes an empty folder', async ({ page }, testInfo) => {
  const zip = new JSZip();
  zip.file('项目资料/说明.txt', 'Project instructions');
  zip.folder('empty');
  zip.file('README.md', '# Archive browser');
  zip.file('data.json', '{}');
  zip.file('large.txt', 'A larger text file');
  await upload(page, zip);
  await expect(page.locator('.archivev-name')).toHaveText(['empty/', '项目资料/', 'data.json', 'large.txt', 'README.md']);
  const rowHeights = await page.locator('.archivev-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  expect(Math.round(Math.min(...rowHeights))).toBeGreaterThanOrEqual(72);
  expect(await page.locator('.archivev-filename').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(15);

  const search = page.getByRole('searchbox', { name: 'Search this folder' });
  await search.fill('README');
  await expect(page.locator('.archivev-name')).toHaveText(['README.md']);
  await expect(search).toBeFocused();
  await expect(page.locator('.archivev-item-count')).toHaveText('1 / 5 items');
  await search.fill('missing-file');
  await expect(page.locator('.archivev-empty')).toContainText('No matching files');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(search).toBeFocused();
  await page.getByRole('combobox', { name: 'Sort files' }).selectOption('size');
  await expect(page.locator('.archivev-name')).toHaveText(['empty/', '项目资料/', 'large.txt', 'README.md', 'data.json']);
  await search.fill('项目');
  await page.locator('.archivev-row').click();
  await expect(search).toHaveValue('');
  await expect(page.locator('.archivev-name')).toHaveText(['说明.txt']);
  await page.getByRole('button', { name: 'project-files.zip', exact: true }).click();
  await page.locator('.archivev-row').filter({ hasText: 'empty/' }).click();
  await expect(page.locator('.archivev-empty')).toContainText('This folder is empty');
  await page.getByRole('button', { name: 'project-files.zip', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('archive-desktop.png') });
});

test('keeps search, scroll and keyboard focus when returning from a preview', async ({ page }) => {
  const zip = new JSZip();
  for (let i = 0; i < 40; i++) zip.file(`note-${String(i).padStart(2, '0')}.txt`, `Archive note ${i}`);
  await upload(page, zip);
  const search = page.getByRole('searchbox', { name: 'Search this folder' });
  await search.fill('note-');
  const row = page.locator('.archivev-row').filter({ hasText: 'note-30.txt' });
  await row.focus();
  const scrollTop = await page.locator('.archivev-listing').evaluate(node => node.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.archivev-entry-preview')).toContainText('Archive note 30');
  const back = page.getByRole('button', { name: 'Back to archive', exact: true });
  await expect(back).toBeFocused();
  await back.press('Enter');
  await expect(search).toHaveValue('note-');
  await expect(row).toBeFocused();
  expect(await page.locator('.archivev-listing').evaluate(node => node.scrollTop)).toBe(scrollTop);
  await page.keyboard.press('Home');
  await expect(page.locator('.archivev-row').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('.archivev-row').last()).toBeFocused();
});

test('fits long Unicode names in narrow embedded previews without horizontal scrolling', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const zip = new JSZip();
  const name = `${'项目设计文档-'.repeat(8)}最终版.txt`;
  zip.file(name, 'Unicode filename preview');
  zip.folder('资料');
  const bytes = [...await zip.generateAsync({ type: 'uint8array' })];
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/archive/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createArchivePreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    document.body.style.cssText = 'margin:0;background:#f7f9fc';
    const host = document.createElement('div');
    host.style.cssText = 'width:100%;height:100dvh';
    document.body.replaceChildren(host);
    const source = new Uint8Array(bytes);
    await createArchivePreviewDriver().createSession(host).load(source, {
      descriptor: { source, name: '嵌套项目资料.zip', extension: 'zip' }
    });
  }, { moduleUrl, bytes });
  await expect(page.locator('.archivev-filename').filter({ hasText: name })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Type', exact: true })).toBeHidden();
  await expect(page.getByRole('columnheader', { name: 'Modified', exact: true })).toBeHidden();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const sizes = await page.locator('.archivev-preview').evaluate(node => {
      const list = node.querySelector('.archivev-listing')!;
      const toolbar = node.querySelector('.archivev-toolbar')!;
      return { root: node.scrollWidth - node.clientWidth, list: list.scrollWidth - list.clientWidth, toolbar: toolbar.scrollWidth - toolbar.clientWidth };
    });
    expect(sizes).toEqual({ root: 0, list: 0, toolbar: 0 });
    await page.screenshot({ path: testInfo.outputPath(`archive-mobile-${width}.png`) });
  }
  await page.getByRole('searchbox', { name: 'Search this folder' }).fill('资料');
  await page.locator('.archivev-row').click();
  await expect(page.locator('.archivev-empty')).toContainText('This folder is empty');
});
