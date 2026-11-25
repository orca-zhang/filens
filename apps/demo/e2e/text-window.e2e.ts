import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('keeps a logical reading position while resizing wrapped long text and searches across block boundaries', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 420, height: 560 }); await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const text = Array.from({ length: 20_000 }, (_, index) => `Row ${index + 1} ${index % 7 === 0 ? 'long text 中文 🌙 '.repeat(30) : 'short 中文'}`).join('\r\n');
    const source = new TextEncoder().encode(text), session = lib.createTextPreviewDriver().createSession(host);
    await session.load(source, { descriptor: { source, name: 'long.txt' } });
    (window as any).wrappedWindow = { host, session, text };
    await session.find('Row 9999 ');
  }, moduleUrl);
  const root = page.locator('.pptxv-native-preview');
  await expect(page.locator('mark.is-active')).toBeInViewport();
  const anchor = () => root.evaluate(root => {
    const top = root.getBoundingClientRect().top;
    return [...root.querySelectorAll<HTMLElement>('.pptxv-text-line')].find(line => line.getBoundingClientRect().bottom > top)?.dataset.textStart;
  });
  const reading = await anchor();
  await page.setViewportSize({ width: 800, height: 560 });
  await expect.poll(anchor).toBe(reading);
  await root.evaluate(root => { root.scrollTop = root.scrollHeight; });
  await expect(page.locator('.pptxv-text-number').last()).toHaveText('20000');
  await expect(page.locator('.pptxv-text-line').last()).toBeInViewport();
  expect(await page.locator('.pptxv-text-line').count()).toBeLessThanOrEqual(512);
  const query = 'short 中文\r\nRow 129 ';
  await page.evaluate(query => (window as any).wrappedWindow.session.find(query), query);
  await expect.poll(async () => (await page.locator('mark.is-active').allTextContents()).join('')).toBe(query);
  await expect(page.locator('mark.is-active').first()).toBeInViewport();
  const copied = await root.evaluate(root => {
    const marks = [...root.querySelectorAll('mark.is-active')], range = document.createRange();
    range.setStart(marks[0].firstChild!, 0); range.setEnd(marks.at(-1)!.lastChild!, marks.at(-1)!.textContent!.length);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    let text = ''; const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (_type: string, value: string) => { text = value; } } });
    root.dispatchEvent(event); return text;
  });
  expect(copied).toBe(query);
  await root.evaluate(root => { root.scrollTop = 0; });
  await expect.poll(() => root.evaluate(root => root.scrollTop)).toBe(0);
  await expect(page.locator('.pptxv-text-number').first()).toHaveText('1');
  await page.evaluate(() => (window as any).wrappedWindow.session.destroy());
  expect(errors).toEqual([]);
});

test('releases virtual selection, scroll work and observers on replacement and cancellation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const session = lib.createTextPreviewDriver().createSession(host), source = new TextEncoder().encode('row\n'.repeat(5000));
    const load = (bytes: Uint8Array, signal?: AbortSignal) => session.load(bytes, { descriptor: { source: bytes, name: 'notes.txt' }, signal });
    await load(source);
    const root = host.querySelector<HTMLElement>('.pptxv-native-preview')!;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    root.scrollTop = root.scrollHeight; root.dispatchEvent(new Event('scroll'));
    await load(new TextEncoder().encode('replacement'));
    let copied = false; const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: () => { copied = true; } } }); root.dispatchEvent(event);
    const replacement = host.querySelector('pre')?.textContent;
    const controller = new AbortController(); await load(source, controller.signal);
    root.scrollTop = root.scrollHeight; root.dispatchEvent(new Event('scroll')); controller.abort();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const clean = !root.childElementCount && !session.getState().loading;
    session.destroy(); return { copied, prevented: event.defaultPrevented, replacement, clean, empty: !host.childElementCount };
  }, moduleUrl);
  expect(result).toEqual({ copied: false, prevented: false, replacement: 'replacement', clean: true, empty: true });
  expect(errors).toEqual([]);
});

test('enables text windows by default through the demo upload and localized find controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto('./?view=preview&lang=zh_CN');
  const text = Array.from({ length: 5000 }, (_, index) => `const row${index + 1} = ${index + 1};`).join('\n');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'windowed.ts', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('.pptxv-text-window')).toHaveCount(1);
  expect(await page.locator('.pptxv-text-line').count()).toBeLessThanOrEqual(512);
  await page.locator('.pptxv-find-controls summary').click();
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await input.fill('row5000'); await input.press('Enter');
  await expect(page.locator('mark.is-active')).toHaveText('row5000');
  await expect(page.locator('mark.is-active')).toBeInViewport();
  await expect(page.locator('.pptxv-text-number').last()).toHaveText('5000');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
