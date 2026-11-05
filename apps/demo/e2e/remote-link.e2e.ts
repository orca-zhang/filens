import { expect, test } from '@playwright/test';

test('opens an encoded signed file URL directly and keeps the source notice after reload', async ({ page }) => {
  const fileUrl = 'https://files.example.test/%E6%8A%A5%E5%91%8A%20v1.txt?token=a%2Fb%2Bc%3D&download=1';
  await page.route(fileUrl, route => route.fulfill({ body: 'A signed remote document.', contentType: 'text/plain' }));
  const request = page.waitForRequest(fileUrl);
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&lang=zh`);
  expect((await request).url()).toBe(fileUrl);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('报告 v1.txt');
  await expect(page.locator('.wb-preview-stage')).toContainText('A signed remote document.');
  const notice = page.locator('.wb-source-notice');
  await expect(notice).toContainText('资源来自第三方站点');
  await expect(notice.getByRole('link')).toHaveText('https://files.example.test');
  await expect(notice.getByRole('link')).toHaveAttribute('href', fileUrl);
  await expect(notice.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(notice).not.toContainText('token=');
  await page.reload();
  await expect(page.locator('.wb-preview-stage')).toContainText('A signed remote document.');
  await expect(notice).toBeVisible();
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(notice).toContainText('This resource comes from a third-party site');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect((await page.locator('.wb-preview-stage').boundingBox())!.height).toBeGreaterThan(350);
});

test('uses a supplied filename for extensionless downloads and retains the origin after prefetching', async ({ page }) => {
  const fileUrl = 'https://downloads.example.test/download?id=42&signature=a%2Fb';
  await page.route(fileUrl, route => route.fulfill({ path: 'apps/demo/public/samples/filens-cosmic-atlas.pdf', contentType: 'application/pdf' }));
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&name=report.pdf&format=step&lang=en`);
  await expect(page.locator('.wb-preview-title strong')).toHaveText('report.pdf');
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await expect(page.getByRole('note')).toContainText('This resource comes from a third-party site');
  await expect(page.getByRole('note').getByRole('link')).toHaveText('https://downloads.example.test');
  await page.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-cosmic-atlas.pdf');
  await expect(page.getByRole('note')).toHaveCount(0);
  const params = new URL(page.url()).searchParams;
  expect(params.has('url')).toBe(false);
  expect(params.has('name')).toBe(false);
  expect(params.get('view')).toBe('preview');
  expect(params.has('format')).toBe(false);
});

test('supports relative same-origin paths without labeling them as third-party resources', async ({ page }) => {
  await page.route('**/relative-note.txt', route => route.fulfill({ body: 'A same-origin document.', contentType: 'text/plain' }));
  await page.goto(`./?url=${encodeURIComponent('./relative-note.txt')}`);
  await expect(page.locator('.wb-preview-stage')).toContainText('A same-origin document.');
  await expect(page.getByRole('note')).toHaveCount(0);
});

test('shows the attempted source and no previous preview when a remote download fails', async ({ page }) => {
  const fileUrl = 'https://files.example.test/missing.pdf';
  await page.route(fileUrl, route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&lang=zh`);
  await expect(page.getByRole('alert')).toContainText('404');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('missing.pdf');
  await expect(page.getByRole('note')).toContainText('资源来自第三方站点');
  await expect(page.locator('.wb-preview-stage')).toBeEmpty();
  await expect(page.locator('.wb-status')).toHaveText('预览失败');
});

test('explains remote network failures and allows recovery by importing a local file', async ({ page }) => {
  const fileUrl = 'https://files.example.test/blocked.pdf';
  await page.route(fileUrl, route => route.abort('failed'));
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&name=blocked.pdf&lang=zh`);
  await expect(page.getByRole('alert')).toContainText('CORS');
  await expect(page.getByRole('note')).toContainText('https://files.example.test');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'local.txt', mimeType: 'text/plain', buffer: Buffer.from('A local document.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('A local document.');
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('url')).toBe(false);
  expect(new URL(page.url()).searchParams.has('name')).toBe(false);
});

for (const fileUrl of ['', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///tmp/report.pdf', 'https://user:password@files.example.test/report.pdf', 'http://[invalid']) {
  test(`rejects an unsupported or invalid file URL: ${fileUrl.split(':', 1)[0]}`, async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', error => errors.push(error));
    await page.goto(`./?url=${encodeURIComponent(fileUrl)}&lang=en`);
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('.wb-preview-stage')).toBeEmpty();
    await expect(page.getByRole('note')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('restores previews and source notices when navigating back and forward', async ({ page }) => {
  const fileUrl = 'https://files.example.test/note.txt';
  await page.route(fileUrl, route => route.fulfill({ body: 'A remote document.', contentType: 'text/plain' }));
  await page.goto('./?view=preview&format=pdf&lang=zh');
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await page.getByRole('button', { name: '通过链接打开', exact: true }).click();
  await page.getByRole('dialog').getByLabel('文件 URL', { exact: true }).fill(fileUrl);
  await page.getByRole('dialog').getByRole('button', { name: '打开预览', exact: true }).click();
  await expect(page.locator('.wb-preview-stage')).toContainText('A remote document.');
  expect(new URL(page.url()).searchParams.get('url')).toBe(fileUrl);
  await page.goBack();
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
  await page.goForward();
  await expect(page.locator('.wb-preview-stage')).toContainText('A remote document.');
  await expect(page.getByRole('note')).toContainText('资源来自第三方站点');
  await page.getByRole('button', { name: '← 探微首页', exact: true }).click();
  await expect(page.locator('.workbench')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('url')).toBe(false);
  await page.goBack();
  await expect(page.locator('.wb-preview-stage')).toContainText('A remote document.');
});

test('does not replace a local file when an earlier remote download finishes', async ({ page }) => {
  const fileUrl = 'https://files.example.test/slow.pdf';
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const routeFinished = new Promise<void>(resolve => { finished = resolve; });
  await page.route(fileUrl, async route => {
    await gate;
    try {
      await route.fulfill({ path: 'apps/demo/public/samples/filens-cosmic-atlas.pdf', contentType: 'application/pdf' });
    } finally {
      finished();
    }
  });
  const request = page.waitForRequest(fileUrl);
  await page.goto(`./?url=${encodeURIComponent(fileUrl)}&lang=zh`);
  await request;
  await expect(page.locator('.wb-loading')).toBeVisible();
  await expect(page.getByRole('note')).toContainText('资源来自第三方站点');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'current.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this file open.') });
  await expect(page.locator('.wb-preview-stage')).toContainText('Keep this file open.');
  release();
  await routeFinished;
  await expect(page.locator('.wb-preview-title strong')).toHaveText('current.txt');
  await expect(page.locator('.wb-preview-stage')).toContainText('Keep this file open.');
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
