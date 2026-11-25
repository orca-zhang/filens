import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('keeps wrapped line numbers aligned and source selectable while searching through code tokens', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const text = '/* first line\n' + 'a long comment to wrap correctly '.repeat(18) + '\n*/\nconst answer = "needle";\n// NEEDLE';
  await page.evaluate(async ({ moduleUrl, text }) => {
    const { createPreviewer, createTextPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:500px;height:550px'; document.body.replaceChildren(host);
    const viewer = createPreviewer(host, { drivers: [createTextPreviewDriver()], translate: message => message === 'Wrap lines' ? '自动换行' : message });
    (window as any).textControls = { viewer, host, text };
    const source = new TextEncoder().encode(text); await viewer.preview(source, { name: 'answer.ts' });
  }, { moduleUrl, text });
  await page.getByRole('button', { name: '自动换行' }).click();
  await expect(page.getByRole('button', { name: '自动换行' })).toHaveAttribute('aria-pressed', 'true');
  const alignment = await page.evaluate(() => {
    const { host } = (window as any).textControls;
    const lines = [...host.querySelectorAll('.pptxv-text-line')] as HTMLElement[];
    const numbers = [...host.querySelectorAll('.pptxv-text-number')] as HTMLElement[];
    return { deltas: lines.map((line, index) => Math.abs(line.getBoundingClientRect().top - numbers[index].getBoundingClientRect().top)),
      wrappedHeight: lines[1].getBoundingClientRect().height, text: host.querySelector('pre').textContent,
      comments: host.querySelectorAll('.pptxv-token--comment').length };
  });
  expect(alignment.text).toBe(text); expect(Math.max(...alignment.deltas)).toBeLessThan(1);
  expect(alignment.wrappedHeight).toBeGreaterThan(60); expect(alignment.comments).toBeGreaterThanOrEqual(3);
  const root = page.locator('.pptxv-native-preview'); await root.focus();
  await root.press('ControlOrMeta+f');
  const input = page.getByRole('searchbox', { name: 'Find in document' }); await input.fill('needle'); await input.press('Enter');
  await expect(page.locator('.pptxv-find-controls output')).toHaveText('1 / 2');
  await expect(page.locator('mark.is-active')).toHaveText('needle');
  await expect(page.locator('mark.is-active')).toBeInViewport();
  await input.press('Shift+Enter'); await expect(page.locator('mark.is-active')).toHaveText('NEEDLE');
  const source = await page.locator('pre').evaluate(pre => {
    const selection = getSelection()!, range = document.createRange(); range.selectNodeContents(pre);
    selection.removeAllRanges(); selection.addRange(range); return selection.toString();
  });
  expect(source.replace(/\r\n/g, '\n')).toBe(text);
  await input.press('Escape'); await expect(page.locator('mark')).toHaveCount(0);
  await page.evaluate(() => (window as any).textControls.viewer.destroy());
  await expect(page.locator('.pptxv-text-container')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('uses the shared localized controls through the demo and detects UTF-16 input', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=zh_CN');
  const source = '夜空\n星星\n夜空', bytes = Buffer.alloc(2 + source.length * 2); bytes.writeUInt16LE(0xfeff, 0);
  for (let index = 0; index < source.length; index++) bytes.writeUInt16LE(source.charCodeAt(index), 2 + index * 2);
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: bytes });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText(source);
  await expect(page.getByRole('button', { name: '自动换行', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.pptxv-find-controls summary').click();
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true }); await input.fill('夜空'); await input.press('Enter');
  await expect(page.locator('.pptxv-find-controls output')).toHaveText('1 / 2');
  await page.getByRole('button', { name: '下一处匹配' }).click();
  await expect(page.locator('.pptxv-find-controls output')).toHaveText('2 / 2');
  expect(errors).toEqual([]);
});
