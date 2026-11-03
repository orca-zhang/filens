import { expect, test } from '@playwright/test';

test('switches the console and preview language without resetting the open file', async ({ page }) => {
  await page.goto('./?view=preview&format=pdf');
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.locator('.pptxv-shell').getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.locator('.pptxv-shell').evaluate(element => element.setAttribute('data-language-test', 'mounted'));

  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('filens · File preview');
  await expect(page.getByRole('heading', { name: 'Sample library', exact: true })).toBeVisible();
  await expect(page.locator('.wb-status')).toHaveText('Preview ready');
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  await expect(page.getByRole('heading', { name: /3D models/ })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search file formats', exact: true }).fill('mind maps');
  await expect(page.getByRole('heading', { name: /Mind maps/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear format search', exact: true }).click();
  await expect(page.locator('.pptxv-shell')).toHaveAttribute('data-language-test', 'mounted');
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await page.getByRole('button', { name: 'File details', exact: true }).click();
  await expect(page.locator('.wb-file-facts')).toContainText('Source');
  await page.getByText('Runtime and build information', { exact: true }).click();
  await expect(page.locator('.wb-build-stat').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open from link', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Open a file link');
  await expect(page.getByLabel('File URL', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await expect(page.locator('.pptxv-shell')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.pptxv-status').first()).toHaveText('2 / 3');
  await expect(page.locator('.pptxv-shell').getByRole('button', { name: '下一页', exact: true })).toBeVisible();
  await expect(page.locator('.wb-status')).toHaveText('预览就绪');
});

test('shares the language with the homepage, navigation, and future visits', async ({ page }) => {
  await page.goto('./?view=agent');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Help your Agent understand your files.', exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveTitle('filens · Agent console');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page).toHaveTitle('filens · File preview');
  await page.goBack();
  await expect(page).toHaveTitle('filens · Agent console');
  await page.getByRole('button', { name: '← filens home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try filens', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await page.goBack();
  await expect(page).toHaveTitle('filens · Agent console');
  await page.goto('./?view=preview');
  await expect(page.getByRole('button', { name: '文件预览', exact: true })).toBeVisible();
  await page.goto('./?view=agent&lang=en-US');
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
  await page.goto('./?view=agent&lang=zh-CN');
  await expect(page.getByRole('button', { name: '文件预览', exact: true })).toBeVisible();
});

test('translates Agent installation and copied prompts while keeping selections', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?view=agent');
  await page.getByRole('combobox', { name: '目标 Agent', exact: true }).selectOption('codex');
  await page.getByRole('combobox', { name: '安装范围', exact: true }).selectOption('project');
  await page.getByRole('combobox', { name: 'CLI 版本', exact: true }).selectOption('lite');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Target Agent', exact: true })).toHaveValue('codex');
  await expect(page.getByRole('combobox', { name: 'Install scope', exact: true })).toHaveValue('project');
  await expect(page.getByRole('combobox', { name: 'CLI edition', exact: true })).toHaveValue('lite');
  await expect(page.getByRole('link', { name: 'Full CLI documentation ↗', exact: true })).toHaveAttribute('href', /agent-cli\.md$/);
  expect(await page.locator('.agent-content').innerText()).not.toMatch(/[\u4e00-\u9fff]/);
  await page.getByRole('button', { name: 'Copy install prompt for Agent', exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Lite CLI');
  expect(prompt).toContain('current project, for codex');
  expect(prompt).toContain('filens capacity --json');
  expect(prompt).not.toMatch(/[\u4e00-\u9fff]/);
  await expect(page.locator('.agent-feedback')).toHaveText('Install prompt copied. Paste it into your Agent.');
  await page.getByRole('button', { name: 'Copy search across files command', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('--query "budget risk"');
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '目标 Agent', exact: true })).toHaveValue('codex');
});

test('keeps switching usable on narrow screens when preference storage is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); }
    });
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?view=agent');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page).toHaveTitle('filens · File preview');
  for (const width of [320, 390, 760]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('button', { name: '切换到中文', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('button', { name: 'Switch to English', exact: true })).toBeVisible();
});
