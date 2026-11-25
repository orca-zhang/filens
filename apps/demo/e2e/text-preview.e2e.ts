import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('windows 200,000 code lines, keeps the last line aligned/selectable and copies the original source', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const text = Array.from({ length: 200_000 }, (_, i) => `const row${i + 1} = ${i + 1};`).join('\n');
    const source = new TextEncoder().encode(text), session = lib.createTextPreviewDriver().createSession(host);
    await session.load(source, { descriptor: { source, name: 'large.js' }, route: lib.resolveFormatRoute({ name: 'large.js' }) });
    (window as any).largeText = { host, text, session };
  }, moduleUrl);
  const root = page.locator('.pptxv-native-preview');
  expect(await page.locator('.pptxv-text-line').count()).toBeLessThanOrEqual(512);
  await root.evaluate(root => { root.scrollTop = root.scrollHeight; });
  await expect(page.locator('.pptxv-text-number').last()).toHaveText('200000');
  const last = page.locator('.pptxv-text-line').last(); await expect(last).toHaveText('const row200000 = 200000;');
  await expect(last).toBeInViewport();
  const result = await page.evaluate(() => {
    const { host, text, session } = (window as any).largeText;
    const line = [...host.querySelectorAll('.pptxv-text-line')].at(-1)!, number = [...host.querySelectorAll('.pptxv-text-number')].at(-1)!;
    const selection = getSelection()!, range = document.createRange(); range.selectNodeContents(line); selection.removeAllRanges(); selection.addRange(range);
    return { lineCount: session.getState().lineCount, selected: selection.toString(), deltaY: Math.abs(line.getBoundingClientRect().y - number.getBoundingClientRect().y),
      rendered: [...host.querySelectorAll('pre')].reduce((sum: number, pre: Element) => sum + pre.textContent!.length, 0), full: text.length };
  });
  expect(result).toMatchObject({ lineCount: 200_000, selected: 'const row200000 = 200000;' });
  expect(result.deltaY).toBeLessThan(1); expect(result.rendered).toBeLessThan(20_000); expect(result.full).toBeGreaterThan(4_000_000);
  await root.focus(); await root.press('ControlOrMeta+a');
  expect(await root.evaluate(root => {
    let copied = ''; const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (_type: string, value: string) => { copied = value; } } });
    root.dispatchEvent(event); return event.defaultPrevented && copied === (window as any).largeText.text;
  })).toBe(true);
  await page.evaluate(() => (window as any).largeText.session.destroy());
  await expect(page.locator('.pptxv-text-container')).toHaveCount(0); expect(errors).toEqual([]);
});

test('keeps the current file when a replaced URL finishes late and clears pending work on destroy', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/preview/index.ts')}`, page.url()).href;
  const result = await page.evaluate(async moduleUrl => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); document.body.replaceChildren(host);
    const session = lib.createTextPreviewDriver().createSession(host);
    const originalFetch = window.fetch;
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    window.fetch = (_source, options) => { signal = options!.signal!; return new Promise(resolve => { finish = resolve; }); };
    try {
      const events: string[] = [], sessionErrors: string[] = [];
      session.on('rendered', state => events.push(state.title));
      session.on('error', error => sessionErrors.push(String(error)));
      const pending = session.load('/slow.txt', { descriptor: { source: '/slow.txt', name: 'old.txt' } });
      const source = new TextEncoder().encode('current');
      await session.load(source, { descriptor: { source, name: 'current.txt' } });
      const abortedOnReplace = signal.aborted;
      finish(new Response('stale')); await pending;
      const current = host.querySelector('pre')?.textContent;
      const destroyed = session.load('/slow-again.txt', { descriptor: { source: '/slow-again.txt', name: 'destroyed.txt' } });
      session.destroy(); const abortedOnDestroy = signal.aborted;
      finish(new Response('destroyed')); await destroyed;
      return { current, events, sessionErrors, abortedOnReplace, abortedOnDestroy, empty: !host.childElementCount };
    } finally { window.fetch = originalFetch; session.destroy(); }
  }, moduleUrl);
  expect(result).toEqual({ current: 'current', events: ['current.txt'], sessionErrors: [], abortedOnReplace: true, abortedOnDestroy: true, empty: true });
  expect(errors).toEqual([]);
});

test('previews highlighted code through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview');
  const text = 'const answer: number = 42;\nconsole.log(answer);';
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'answer.ts', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect(page.locator('pre.pptxv-native-text')).toHaveText(text);
  await expect(page.locator('.pptxv-native-text-gutter')).toHaveText('1\n2');
  await expect(page.locator('.pptxv-token--keyword').first()).toHaveText('const');
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
