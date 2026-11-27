import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { buildAreaCombinationFixture, buildBubbleChartFixture, buildCachedChartFixture, buildChartAnimationDataFixture, buildChartAxisTitleFixture,
  buildChartFontFixture, buildCombinedChartFixture, buildDateChartFixture, buildLogScatterFixture, buildManualChartTitleFixture,
  buildMixedChartLabelFixture, buildScatterChartFixture, buildStackedLineChartFixture, buildVerticalChartTitleFixture
} from '../../../packages/pptx/test/fixtures/cached-charts';
import { buildCustomGeometryTextRectangleFixture, buildGuidedCustomPathFixture } from '../../../packages/pptx/test/fixtures/custom-geometry';
import { buildSpeakerNotesFixture, firstSpeakerNotes, secondSpeakerNotes } from '../../../packages/pptx/test/fixtures/speaker-notes';
import { buildCommentLocationsFixture, buildCommentReviewFixture, buildCommentSourcesFixture, buildSlideCommentsFixture, legacyComment, modernComment } from '../../../packages/pptx/test/fixtures/slide-comments';
import { buildSlideTransitionsFixture } from '../../../packages/pptx/test/fixtures/slide-transitions';
import { buildSlideAnimationsFixture } from '../../../packages/pptx/test/fixtures/slide-animations';

test('plays the current slide’s object effects in click order and can restore the static slide', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./?view=preview&lang=zh');
  const input = page.getByLabel('导入文件', { exact: true });
  await input.setInputFiles({ name: 'slide-animations.pptx', mimeType, buffer: Buffer.from(await buildSlideAnimationsFixture(base)) });
  const shell = page.locator('.pptxv-shell');
  const controls = shell.getByRole('group', { name: '幻灯片动画' });
  const stage = shell.locator('.pptxv-slide-shell[data-slide-index="1"] .pptxv-slide-stage');
  const item = (text: string) => stage.locator('.pptxv-slide > .pptxv-item').filter({ hasText: text });
  const groupedText = item(/^Group$/);
  const note = item('Gradient surface support');
  const panel = item('Theme style matrix');
  const picture = item('Picture fill support');
  const unsupported = item('Theme pattern fill');
  const play = controls.getByRole('button', { name: '播放', exact: true });
  const next = controls.getByRole('button', { name: '下一个效果' });
  await expect(shell.locator('[data-slide-index="0"] .pptxv-slide')).toBeVisible();
  await expect(controls).toBeHidden();
  await shell.press('ArrowRight');
  await expect(play).toBeVisible();
  await expect(picture).toBeVisible();
  await play.press('Enter');
  await expect(next).toBeFocused();
  await expect(picture).toBeHidden();
  const scrub = (time: number) => stage.evaluate(async (element, ms) => {
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = ms;
    }
    await Promise.all(animations.map(animation => animation.ready));
    return animations.length;
  }, time);
  expect(await scrub(200)).toBe(5);
  await expect(groupedText).toHaveCSS('opacity', '0.5');
  await expect(note).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(unsupported).toBeVisible();
  expect(await scrub(850)).toBe(5);
  await expect(panel).toBeHidden();
  await next.press('Enter');
  await expect(note).toBeHidden();
  expect(await scrub(200)).toBe(2);
  await expect(picture).toHaveCSS('clip-path', /^inset\(50%/);
  const reset = controls.getByRole('button', { name: '重置视图' });
  await reset.press('Enter');
  await expect(play).toBeFocused();
  for (const object of [groupedText, note, panel, picture]) await expect(object).toBeVisible();
  expect(await scrub(0)).toBe(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await play.press('Enter');
  await expect(panel).toBeHidden();
  await expect(picture).toBeHidden();
  expect(await scrub(0)).toBe(0);
  await next.press('Enter');
  await expect(picture).toBeVisible();
  await expect(note).toBeHidden();
  await shell.press('ArrowRight');
  await expect(controls).toBeHidden();
  await shell.press('ArrowLeft');
  await expect(play).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(note).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await play.press('Enter');
  expect(await scrub(100)).toBe(5);
  await input.setInputFiles({ name: 'static-slides.pptx', mimeType, buffer: base });
  await expect(controls).toBeHidden();
  await expect(stage.locator('.pptxv-slide')).toHaveCount(0);
});

test('animates paragraph ranges while keeping the text box and its layout intact', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./?view=preview&lang=en');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'paragraph-builds.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildSlideAnimationsFixture(base, 'paragraphs'))
  });
  const shell = page.locator('.pptxv-shell');
  const controls = shell.getByRole('group', { name: 'Slide animations' });
  const play = controls.getByRole('button', { name: 'Play', exact: true });
  const next = controls.getByRole('button', { name: 'Next effect' });
  const item = shell.locator('[data-slide-index="0"] .pptxv-slide > .pptxv-item').filter({ hasText: 'Inherited master body style.' });
  const paragraphs = item.locator('.pptxv-paragraph');
  const detailsLink = item.getByRole('link', { name: 'Open preview documentation', includeHidden: true });
  const assetBox = () => paragraphs.nth(2).evaluate(element => {
    const box = element.getBoundingClientRect();
    return [box.top - element.closest('.pptxv-item')!.getBoundingClientRect().top, box.height];
  });
  const scrub = (time: number) => item.evaluate(async (element, ms) => {
    const animations = element.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = ms;
    }
    await Promise.all(animations.map(animation => animation.ready));
    return animations.length;
  }, time);
  await expect(play).toBeVisible();
  let originalBox: number[] = [];
  await expect.poll(async () => {
    originalBox = await assetBox();
    return originalBox[1];
  }).toBeGreaterThan(0);
  await play.press('Enter');
  expect(await scrub(200)).toBe(3);
  await expect(paragraphs.nth(0)).toHaveCSS('opacity', '0.5');
  await expect(paragraphs.nth(1)).toHaveCSS('opacity', '0.5');
  await expect(paragraphs.nth(2)).toBeVisible();
  (await assetBox()).forEach((value, index) => expect(value).toBeCloseTo(originalBox[index], 2));
  await expect(paragraphs.nth(4)).toBeHidden();
  expect(await scrub(700)).toBe(3);
  await expect(paragraphs.nth(3)).toHaveCSS('clip-path', /50%/);
  expect(await scrub(850)).toBe(3);
  await expect(paragraphs.nth(3)).toBeHidden();
  await expect(item).toBeVisible();
  await next.press('Enter');
  await expect(detailsLink).toBeVisible();
  await expect(paragraphs.nth(4)).toBeVisible();
  await next.press('Enter');
  expect(await scrub(300)).toBe(2);
  await expect(item).toBeHidden();
  expect(await paragraphs.nth(0).evaluate(element => element.checkVisibility())).toBe(false);
  await controls.getByRole('button', { name: 'Reset view' }).press('Enter');
  await expect(play).toBeFocused();
  await expect(paragraphs.nth(0)).toBeVisible();
  await expect(detailsLink).toBeVisible();
  await expect(item).toBeVisible();
});

test('builds chart grids, series, categories and individual points in authored click order', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  const fixture = await buildSlideAnimationsFixture(await buildChartAnimationDataFixture(base, 'column'), 'chart');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./?view=preview&lang=en');
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'chart-builds.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(fixture)
  });
  const chart = page.locator('.pptxv-chart-svg');
  const controls = page.getByRole('group', { name: 'Slide animations' });
  const play = controls.getByRole('button', { name: 'Play', exact: true });
  const next = controls.getByRole('button', { name: 'Next effect' });
  const mark = (series: number, category: number, label = false) => chart.locator(
    `.${label ? 'pptxv-chart-data-label' : 'pptxv-chart-bar'}[data-series-index="${series}"][data-category-index="${category}"]`
  );
  const legend = chart.locator('.pptxv-chart-legend');
  await expect(mark(0, 0)).toBeVisible();
  await play.press('Enter');
  await expect(legend).toBeVisible();
  await expect(chart.locator('.pptxv-chart-gridline').first()).toHaveCSS('visibility', 'visible');
  await expect(mark(0, 0)).toHaveCSS('visibility', 'hidden');
  await expect(mark(1, 0, true)).toHaveCSS('visibility', 'hidden');
  await next.press('Enter');
  const animated = await chart.evaluate(async svg => {
    const animations = svg.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 200;
    }
    await Promise.all(animations.map(animation => animation.ready));
    return animations.length;
  });
  expect(animated).toBe(8);
  await expect(mark(1, 0)).toHaveCSS('opacity', '0.5');
  await expect(mark(1, 0, true)).toHaveCSS('opacity', '0.5');
  await expect(mark(0, 0)).toHaveCSS('visibility', 'hidden');
  await expect(legend).toHaveCSS('opacity', '1');
  await next.press('Enter');
  await expect(mark(0, 2)).toBeVisible();
  await expect(mark(0, 2, true)).toBeVisible();
  await expect(mark(0, 3)).toHaveCSS('visibility', 'hidden');
  await next.press('Enter');
  await expect(mark(0, 3)).toBeVisible();
  await expect(mark(0, 1)).toHaveCSS('visibility', 'hidden');
  await next.press('Enter');
  await expect(mark(0, 1)).toBeVisible();
  await expect(mark(0, 0)).toHaveCSS('visibility', 'hidden');
  await next.press('Enter');
  await expect(mark(0, 0)).toBeVisible();
  await controls.getByRole('button', { name: 'Reset view' }).press('Enter');
  await expect(play).toBeFocused();
  await expect(mark(0, 0)).toBeVisible();
});

test('plays authored slide transitions, falls back to a compatible wipe, and clears motion on navigation', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  const fixture = Buffer.from(await buildSlideTransitionsFixture(base));
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('./?view=preview&lang=en');
  const input = page.locator('input[type=file]').first();
  await input.setInputFiles({ name: 'slide-transitions.pptx', mimeType, buffer: fixture });
  const shell = page.locator('.pptxv-shell');
  const stage = (index: number) => shell.locator(`.pptxv-slide-shell[data-slide-index="${index}"] .pptxv-slide-stage`);
  const transitionLayer = '.pptxv-slide-transition';
  const backdrop = shell.locator(transitionLayer);
  await expect(stage(0)).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  await expect(backdrop).toHaveCount(0);
  await shell.press('ArrowRight');
  await expect(stage(1).locator(transitionLayer)).toHaveAttribute('data-effect', 'push');
  await expect(backdrop).toHaveAttribute('inert', '');
  await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  const push = await stage(1).evaluate(async element => {
    const animations = element.getAnimations({ subtree: true });
    const duration = animations[0].effect!.getTiming().duration as number;
    for (const effect of animations) {
      effect.pause();
      effect.currentTime = duration / 2;
    }
    await Promise.all(animations.map(effect => effect.ready));
    const incoming = element.firstElementChild!.getBoundingClientRect();
    const old = element.lastElementChild!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { duration, incoming: (incoming.top - box.top) / box.height, outgoing: (old.top - box.top) / box.height };
  });
  expect(push.duration).toBe(1600);
  expect(push.incoming).toBeCloseTo(0.5, 2);
  expect(push.outgoing).toBeCloseTo(-0.5, 2);
  await shell.press('ArrowRight');
  await expect(stage(2).locator(transitionLayer)).toHaveAttribute('data-effect', 'wipe');
  await expect(backdrop).toHaveCount(1);
  const wipe = await backdrop.evaluate(node => {
    const animation = node.getAnimations()[0];
    return { duration: animation.effect?.getTiming().duration, frames: (animation.effect as KeyframeEffect).getKeyframes() };
  });
  expect(wipe.duration).toBe(1000);
  expect(wipe.frames.at(-1)?.clipPath).toBe('inset(0px 0px 0px 100%)');
  await expect(backdrop).toHaveCount(0);

  await shell.press('Home');
  await expect(stage(0).locator(transitionLayer)).toHaveAttribute('data-effect', 'fade');
  const fade = await backdrop.evaluate(async node => {
    const animations = node.getAnimations({ subtree: true });
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 250;
    }
    await Promise.all(animations.map(animation => animation.ready));
    return { backdrop: getComputedStyle(node).backgroundColor, outgoing: getComputedStyle(node.firstElementChild!).opacity };
  });
  expect(fade).toEqual({ backdrop: 'rgb(0, 0, 0)', outgoing: '0' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(backdrop).toHaveCount(0);
  await shell.press('ArrowRight');
  await expect(stage(1)).toBeInViewport();
  await expect(backdrop).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await shell.press('ArrowRight');
  await expect(backdrop).toHaveAttribute('data-effect', 'wipe');
  await input.setInputFiles({ name: 'static-slides.pptx', mimeType, buffer: base });
  await expect(stage(0)).toBeInViewport();
  await expect(backdrop).toHaveCount(0);
});

test('shows legacy and modern comment threads with slide navigation and restores the notes panel', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  const fixture = await buildSlideCommentsFixture(await buildSpeakerNotesFixture(base));
  await page.goto('./?view=preview&lang=zh');
  const input = page.getByLabel('导入文件', { exact: true });
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await input.setInputFiles({ name: 'reviewed-slides.pptx', mimeType, buffer: Buffer.from(fixture) });
  const comments = page.locator('.pptxv-slide-comments');
  const notes = page.locator('.pptxv-speaker-notes');
  const summary = comments.locator('summary');
  const body = comments.locator('.pptxv-slide-comments-text');
  await expect(summary).toHaveText('批注');
  await expect(body).toBeHidden();
  await notes.locator('summary').press('Enter');
  await expect(notes.locator('.pptxv-speaker-notes-text')).toContainText('先确认原始数据');
  await summary.press('Enter');
  await expect(notes.locator('.pptxv-speaker-notes-text')).toBeHidden();
  await expect(body.locator('.pptxv-comment-text').first()).toHaveText(legacyComment);
  expect(await body.locator('.pptxv-comment-text').first().textContent()).toBe(legacyComment);
  await expect(body.locator('em')).toHaveCount(0);
  await expect(body.locator('.pptxv-comment-replies .pptxv-comment-text')).toHaveText([
    'Legacy reply before its parent.', 'Reply to the reply.'
  ]);
  await expect(body.locator('time').first()).toHaveAttribute('datetime', '2026-11-26T04:30:00.000Z');

  const shell = page.locator('.pptxv-shell');
  await shell.press('ArrowRight');
  await expect(body.locator('.pptxv-comment-text').first()).toHaveText(modernComment);
  await expect(body.locator('header strong')).toHaveText(['Maya Chen', 'Luis Ortiz']);
  await expect(body.locator('.pptxv-comment-status')).toHaveText(['已解决', '已关闭']);
  await expect(body.locator('.pptxv-comment-replies .pptxv-comment-text')).toHaveText('The totals now agree.');
  await shell.press('ArrowRight');
  await expect(body).toHaveText('本页没有批注。');
  await body.press('Escape');
  await expect(summary).toBeFocused();
  await expect(body).toBeHidden();
  await shell.press('ArrowLeft');
  await notes.locator('summary').press('Enter');
  await expect(notes.locator('.pptxv-speaker-notes-text')).toContainText('Inherited body.');
  await expect(body).toBeHidden();
  await input.setInputFiles({ name: 'clean-slides.pptx', mimeType, buffer: base });
  await expect(comments).toBeHidden();
  await expect(notes).toBeHidden();
  await expect(body).toBeEmpty();
});

test('locates review comments at a point, drawing, text range or whole slide', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.setViewportSize({ width: 960, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?view=preview&lang=zh');
  const input = page.getByLabel('导入文件', { exact: true });
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await input.setInputFiles({ name: 'comment-locations.pptx', mimeType, buffer: Buffer.from(await buildCommentLocationsFixture(base)) });
  const panel = page.locator('.pptxv-slide-comments');
  const summary = panel.locator('summary');
  const body = panel.locator('.pptxv-slide-comments-text');
  const shell = page.locator('.pptxv-shell');
  const area = shell.locator('.pptxv-scroll-area');
  const highlight = shell.locator('.pptxv-comment-highlight');
  const thread = (text: string) => body.locator('.pptxv-comment').filter({ hasText: text });
  const locate = (text: string) => thread(text).getByRole('button', { name: '在幻灯片上定位' });

  await expect(summary).toBeVisible();
  await summary.press('Enter');
  const point = locate('先检查图注。');
  await point.press('Enter');
  await expect(point).toBeFocused();
  await expect(point).toHaveAttribute('aria-pressed', 'true');
  await expect(highlight).toHaveAttribute('data-kind', 'point');
  await expect(highlight.locator('span')).toHaveCSS('left', '600px');
  await expect(highlight.locator('span')).toHaveCSS('top', '0px');
  await point.press('Escape');
  await expect(highlight).toHaveCount(0);
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(point).toHaveAttribute('aria-pressed', 'false');

  await shell.press('ArrowRight');
  await expect(thread('Missing drawing')).toBeVisible();
  await expect(locate('Missing drawing')).toHaveCount(0);
  await expect(locate('Check totals')).toHaveCount(0);

  const selection = locate('Selected words');
  await selection.press('Enter');
  await expect(selection).toBeFocused();
  await expect(highlight).toHaveAttribute('data-kind', 'text');
  await expect(highlight.locator('span')).toHaveCount(3);
  await expect(highlight).toHaveCSS('pointer-events', 'none');
  for (let step = 0; step < 11; step++) await shell.press('=');
  await expect(selection).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => area.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => highlight.locator('span').last().evaluate(marker => {
    const box = marker.getBoundingClientRect();
    const view = marker.closest('.pptxv-scroll-area')!.getBoundingClientRect();
    return box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom;
  })).toBe(true);

  const stage = shell.locator('.pptxv-slide-shell[data-slide-index="1"] .pptxv-slide-stage');
  const visibleItems = stage.locator('.pptxv-slide > .pptxv-item');
  const compareBounds = async (which: 'text' | 'text-box' | 'shape' | 'group') => {
    return stage.evaluate((element, which) => {
      const items = element.querySelectorAll('.pptxv-slide > .pptxv-item');
      const drawing = items[items.length - 2];
      const text = items[items.length - 1];
      const runs = text.querySelectorAll('.pptxv-run');
      const actual = [...element.querySelectorAll('.pptxv-comment-highlight > span')].map(span => span.getBoundingClientRect());
      const expected = [] as Array<Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>>;
      if (which === 'text') {
        for (const [index, start, end] of [[0, 7, 11], [1, 0, 7], [2, 0, 6]]) {
          const range = document.createRange();
          range.setStart(runs[index].firstChild!, start);
          range.setEnd(runs[index].firstChild!, end);
          expected.push(...range.getClientRects());
        }
      } else if (which === 'shape' || which === 'text-box') {
        expected.push((which === 'shape' ? drawing : text).getBoundingClientRect());
      } else {
        const a = drawing.getBoundingClientRect(), b = text.getBoundingClientRect();
        expected.push({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right),
          top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
      }
      return actual.length === expected.length && actual.every((rect, index) =>
        (['left', 'right', 'top', 'bottom'] as const).every(side => Math.abs(rect[side] - expected[index][side]) < 1));
    }, which);
  };
  await expect(visibleItems.last()).toContainText('Second line');
  await expect.poll(() => compareBounds('text')).toBe(true);

  await locate('Outdated text').press('Enter');
  await expect(selection).toHaveAttribute('aria-pressed', 'false');
  await expect(highlight).toHaveAttribute('data-kind', 'shape');
  await expect.poll(() => compareBounds('text-box')).toBe(true);
  await locate('Rotated shape').press('Enter');
  await expect.poll(() => compareBounds('shape')).toBe(true);
  await locate('Grouped shapes').press('Enter');
  await expect.poll(() => compareBounds('group')).toBe(true);

  await locate('On the next slide').press('Enter');
  const destination = shell.locator('.pptxv-slide-shell[data-slide-index="2"] .pptxv-slide-stage');
  await expect(destination).toBeFocused();
  await expect(destination.locator('.pptxv-comment-highlight')).toHaveAttribute('data-kind', 'slide');
  await expect.poll(() => destination.locator('.pptxv-comment-highlight > span').evaluate(marker => {
    const area = marker.closest('.pptxv-scroll-area')!;
    const view = area.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    return Math.abs(box.left - view.left - area.clientLeft) <= 1 &&
      Math.abs(box.top - view.top - area.clientTop) <= 1;
  })).toBe(true);
  await expect(body).toHaveText('本页没有批注。');
  await destination.press('ArrowLeft');
  await expect(selection).toHaveAttribute('aria-pressed', 'false');
  await expect(highlight).toHaveCount(0);
  await selection.press('Enter');
  await expect(highlight).toHaveAttribute('data-kind', 'text');
  await input.setInputFiles({ name: 'clean-slides.pptx', mimeType, buffer: base });
  await expect(highlight).toHaveCount(0);
  await expect(panel).toBeHidden();
});

test('locates master and unused layout comments and restores the original slide', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.setViewportSize({ width: 960, height: 760 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?view=preview&lang=zh');
  const input = page.getByLabel('导入文件', { exact: true });
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await input.setInputFiles({ name: 'comment-sources.pptx', mimeType, buffer: Buffer.from(await buildCommentSourcesFixture(base)) });
  const shell = page.locator('.pptxv-shell');
  const area = shell.locator('.pptxv-scroll-area');
  const panel = shell.locator('.pptxv-slide-comments');
  const thread = (text: string) => panel.locator('.pptxv-comment').filter({ hasText: text });
  const master = thread('Master review group').getByRole('button', { name: '在幻灯片母版上定位' });
  const layout = thread('Unused layout text').getByRole('button', { name: '在幻灯片版式上定位' });
  const dialog = page.getByRole('dialog');
  const back = dialog.getByRole('button', { name: '返回文档' });
  const highlight = dialog.locator('.pptxv-comment-highlight');
  await expect(panel.locator('summary')).toBeVisible();
  await panel.locator('summary').press('Enter');
  await shell.press('ArrowRight');
  for (const name of ['Stale master anchor', 'Wrong layout owner', 'Missing master drawing', 'Stale layout anchor']) {
    await expect(thread(name)).toBeVisible();
    await expect(thread(name).getByRole('button')).toHaveCount(0);
  }
  const scroll = () => area.evaluate(node => [node.scrollLeft, node.scrollTop]);
  const origin = await scroll();
  const slide = area.locator('[data-slide-index="1"]');
  const originalElement = await slide.elementHandle();
  await expect(master).toHaveAttribute('aria-haspopup', 'dialog');
  await master.press('Enter');
  await expect(dialog).toHaveAccessibleName('在幻灯片母版上定位');
  await expect(back).toBeFocused();
  await expect(dialog).toContainText('Master has');
  await expect(highlight).toHaveAttribute('data-kind', 'shape');
  await expect(highlight.locator('span')).toHaveCount(1);
  await back.press('ArrowRight');
  await expect(dialog).toBeVisible();
  await back.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(master).toBeFocused();
  expect(await scroll()).toEqual(origin);
  expect(await originalElement!.evaluate(node => node.isConnected)).toBe(true);

  await layout.press('Enter');
  await expect(dialog).toHaveAccessibleName('在幻灯片版式上定位');
  await expect(highlight).toHaveAttribute('data-kind', 'text');
  const matchesLayoutText = () => dialog.evaluate(node => {
    const runs = [...node.querySelectorAll('.pptxv-run')];
    const index = runs.findIndex(run => run.textContent === 'Layout has ');
    const text = runs[index + 1].getBoundingClientRect();
    const highlight = node.querySelector('.pptxv-comment-highlight > span')!.getBoundingClientRect();
    return (['left', 'top', 'right', 'bottom'] as const).every(key => Math.abs(text[key] - highlight[key]) < 1);
  });
  await expect.poll(matchesLayoutText).toBe(true);
  await page.setViewportSize({ width: 560, height: 500 });
  await expect.poll(matchesLayoutText).toBe(true);
  await back.click();
  await expect(layout).toBeFocused();
  await layout.press('Enter');
  await input.setInputFiles({ name: 'clean-slides.pptx', mimeType, buffer: base });
  await expect(dialog).toHaveCount(0);
  await expect(panel).toBeHidden();
});

test('offers separate locations for every resolvable drawing and text anchor in one comment', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?view=preview&lang=zh');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'multiple-comment-anchors.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildCommentSourcesFixture(base, 'multiple'))
  });
  const shell = page.locator('.pptxv-shell');
  const summary = shell.locator('.pptxv-slide-comments > summary');
  await expect(summary).toBeVisible();
  await summary.press('Enter');
  await shell.press('ArrowRight');
  const comment = (text: string) => shell.locator('.pptxv-comment').filter({ hasText: text });
  const drawings = comment('Several drawings');
  const ranges = comment('Several text ranges');
  await expect(drawings.getByRole('button')).toHaveText([
    '在幻灯片上定位 (1)', '在幻灯片母版上定位 (2)', '在幻灯片上定位 (3)'
  ]);
  await expect(ranges.getByRole('button')).toHaveText([
    '在幻灯片上定位 (1)', '在幻灯片版式上定位 (2)', '在幻灯片上定位 (3)'
  ]);
  const range = (index: number) => ranges.getByRole('button', { name: `在幻灯片上定位 (${index})`, exact: true });
  const onSlide = shell.locator('.pptxv-scroll-area .pptxv-comment-highlight');
  await range(1).press('Enter');
  await expect(onSlide).toHaveAttribute('data-kind', 'text');
  const start = await onSlide.locator('span').evaluate(node => parseFloat((node as HTMLElement).style.left));
  await range(3).press('Enter');
  await expect(range(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(range(3)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => onSlide.locator('span').evaluate(node => parseFloat((node as HTMLElement).style.left))).toBeGreaterThan(start);

  const dialog = page.getByRole('dialog');
  const back = dialog.getByRole('button', { name: '返回文档' });
  const visitSource = async (button: ReturnType<typeof range>, text: string, kind: string) => {
    await button.press('Enter');
    await expect(dialog).toContainText(text);
    await expect(dialog.locator('.pptxv-comment-highlight')).toHaveAttribute('data-kind', kind);
    await back.press('Escape');
    await expect(button).toBeFocused();
  };
  await visitSource(ranges.getByRole('button', { name: '在幻灯片版式上定位 (2)' }), 'Layout has', 'text');
  await visitSource(drawings.getByRole('button', { name: '在幻灯片母版上定位 (2)' }), 'Master has', 'shape');
  await drawings.getByRole('button', { name: '在幻灯片上定位 (3)', exact: true }).press('Enter');
  const destination = shell.locator('[data-slide-index="2"] .pptxv-slide-stage');
  await expect(destination).toBeFocused();
  await expect(destination.locator('.pptxv-comment-highlight')).toHaveAttribute('data-kind', 'shape');
  await expect(shell.locator('.pptxv-slide-comments-text')).toHaveText('本页没有批注。');
});

test('opens modern reactions and task history by keyboard in the active slide comments', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?view=preview&lang=zh_CN');
  const input = page.getByLabel('导入文件', { exact: true });
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await input.setInputFiles({ name: 'review-events.pptx', mimeType, buffer: Buffer.from(await buildCommentReviewFixture(base)) });
  const panel = page.locator('.pptxv-slide-comments');
  const summary = panel.locator(':scope > summary');
  const body = panel.locator('.pptxv-slide-comments-text');
  await expect(summary).toBeVisible();
  await summary.press('Enter');
  const shell = page.locator('.pptxv-shell');
  await shell.press('ArrowRight');
  const thread = body.locator('.pptxv-comment').first();
  const thumbs = thread.locator('summary[aria-label="表情回应 · 👍 2"]');
  await expect(thumbs).toHaveText('👍 2');
  await thumbs.press('Enter');
  await expect(thumbs).toBeFocused();
  const reactors = thumbs.locator('..').locator('li');
  await expect(reactors.locator('strong')).toHaveText(['Luis Ortiz', '未知作者']);
  await expect(reactors.first().locator('time')).toHaveAttribute('datetime', '2026-11-26T09:15:00Z');
  const replyReaction = thread.locator('.pptxv-comment-replies summary[aria-label="表情回应 · 🤝 1"]');
  await replyReaction.press('Enter');
  await expect(replyReaction.locator('..').locator('li strong')).toHaveText('Maya Chen');

  const snapshot = thread.locator('.pptxv-comment-task');
  await expect(snapshot.locator('dt')).toHaveText(['指派给', '开始日期', '截止日期', '任务进度']);
  await expect(snapshot.locator('dd').last()).toHaveText('75%');
  const history = thread.locator('.pptxv-comment-history');
  const historySummary = history.locator('summary');
  await expect(historySummary).toHaveText('任务历史');
  await expect(history.locator('ol')).toBeHidden();
  await historySummary.press('Enter');
  await expect(history.locator('ol')).toBeVisible();
  await expect(history.locator('li > div:last-child')).toHaveText([
    '已创建任务', '指派给 · Luis Ortiz', '任务标题 · <b>Finalize</b>',
    '任务日程 · 开始日期 2026-11-25 00:00:00 UTC · 截止日期 2026-11-30 00:00:00 UTC',
    '任务进度 · 25%', '已撤销任务变更 · 任务进度', '已清除指派', '已更新任务'
  ]);
  await expect(history.locator('b')).toHaveCount(0);
  await expect(snapshot.locator('dd').last()).toHaveText('75%');
  await historySummary.press('Escape');
  await expect(summary).toBeFocused();
  await expect(body).toBeHidden();
  await summary.press('Enter');
  await expect(history.locator('ol')).toBeHidden();
  await shell.press('ArrowRight');
  await expect(body).toHaveText('本页没有批注。');
});

test('opens speaker notes by keyboard and follows the active slide and source', async ({ page }) => {
  const base = await readFile(resolve('apps/demo/public/samples/sample-deck.pptx'));
  await page.goto('./?view=preview&lang=zh');
  const input = page.getByLabel('导入文件', { exact: true });
  const mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  await input.setInputFiles({ name: 'with-speaker-notes.pptx', mimeType, buffer: Buffer.from(await buildSpeakerNotesFixture(base)) });
  const panel = page.locator('.pptxv-speaker-notes');
  const summary = panel.locator('summary');
  const body = panel.locator('.pptxv-speaker-notes-text');
  await expect(summary).toHaveText('演讲者备注');
  await expect(body).toBeHidden();
  await expect(body).toHaveText('');
  await summary.press('Enter');
  await expect(body).toBeVisible();
  await expect.poll(() => body.textContent()).toBe(firstSpeakerNotes);
  await expect(body.locator('em')).toHaveCount(0);
  await expect(page.locator('.pptxv-slide-stage').filter({ hasText: '先确认原始数据' })).toHaveCount(0);

  const shell = page.locator('.pptxv-shell');
  await shell.press('ArrowRight');
  await expect(body).toContainText('Inherited body.');
  await expect.poll(() => body.textContent()).toBe(secondSpeakerNotes);
  await body.press('PageDown');
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(body).toContainText('Inherited body.');
  await shell.press('ArrowRight');
  await expect(body).toHaveText('本页没有演讲者备注。');
  await body.press('Escape');
  await expect(summary).toBeFocused();
  await expect(body).toBeHidden();
  await shell.press('ArrowLeft');
  await summary.press('Enter');
  await expect(body).toContainText('Inherited body.');
  await input.setInputFiles({ name: 'without-speaker-notes.pptx', mimeType, buffer: base });
  await expect(panel).toBeHidden();
  await expect(body).toHaveText('');
});

test('paints a cached doughnut chart as concentric rings with a transparent center', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cached-doughnut.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildCachedChartFixture(source, 'doughnut'))
  });
  const slices = page.locator('.pptxv-chart-slice');
  await expect(slices).toHaveCount(3);
  const layout = await page.evaluate(async () => {
    const elements = [...document.querySelectorAll<SVGPathElement>('.pptxv-chart-slice')];
    const [inner, largeSlice, smallSlice] = elements;
    const bounds = inner.getBBox();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    const radius = bounds.width / 1.6;
    const offset = 0.9 * radius / Math.SQRT2;
    const innerRing = inner.isPointInFill(new DOMPoint(x + radius * 0.7, y));
    const gap = inner.isPointInFill(new DOMPoint(x + radius * 0.59, y));
    const sweep = [largeSlice, smallSlice].map(path => [
      path.isPointInFill(new DOMPoint(x + offset, y + offset)),
      path.isPointInFill(new DOMPoint(x + offset, y - offset))
    ]);
    const image = new Image();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"
      viewBox="${x - radius} ${y - radius} ${2 * radius} ${2 * radius}">${elements.map(path => path.outerHTML).join('')}</svg>`;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { centerAlpha: context.getImageData(64, 64, 1, 1).data[3], innerRing, gap, sweep };
  });
  expect(layout).toEqual({ centerAlpha: 0, innerRing: true, gap: false, sweep: [[true, false], [false, true]] });
});

test('renders cached line data in reverse category order and leaves missing points empty', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cached-line.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildCachedChartFixture(source, 'line'))
  });
  const line = page.locator('.pptxv-chart-line');
  await expect(line).toHaveCount(1);
  const markers = page.locator('.pptxv-chart-marker[data-series-index="0"]');
  await expect(markers).toHaveCount(3);
  const points = await markers.evaluateAll((elements: SVGGraphicsElement[]) =>
    elements.map(element => {
      const bounds = element.getBBox();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    })
  );
  expect(points[0].x - points[1].x).toBeCloseTo(2 * (points[1].x - points[2].x), 2);
  expect(points[0].x).toBeGreaterThan(points[1].x);
  expect(points[1].y).toBeGreaterThan(points[0].y);
  expect(points[2].y).toBeLessThan(points[0].y);
  expect(await line.evaluate((path: SVGPathElement) => path.getTotalLength()))
    .toBeCloseTo(Math.hypot(points[1].x - points[2].x, points[1].y - points[2].y), 2);
});

test('plots cached scatter points on separate numeric axes and clips out-of-range marks', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cached-scatter.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildScatterChartFixture(source, 'span'))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-marker[data-series-index="0"]')).toHaveCount(5);
  await expect(chart.locator('.pptxv-chart-legend-item text')).toHaveText(['Measured', 'Reference']);
  await expect(chart.locator('.pptxv-chart-axis-title')).toHaveText(['Distance', 'Response']);
  await expect(chart.locator('.pptxv-chart-gridline[data-axis="x"]')).toHaveCount(6);
  const positions = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.pptxv-chart-svg')!;
    const tick = (axis: string, text: string) => [...svg.querySelectorAll<SVGTextElement>(`.pptxv-chart-axis-label[data-axis="${axis}"]`)]
      .find(label => label.textContent === text)!;
    const coordinate = (node: Element, attribute: string) => Number(node.getAttribute(attribute));
    const markers = [...svg.querySelectorAll<SVGGraphicsElement>('.pptxv-chart-marker[data-series-index="0"]')];
    const [x0, x50] = [tick('x', '0.0'), tick('x', '50.0')].map(tick => coordinate(tick, 'x'));
    const [yMin, yMax] = [tick('y', '-10.00'), tick('y', '20.00')].map(tick => coordinate(tick, 'y'));
    const expectedX = (value: number) => x0 + (x50 - x0) * value / 50;
    const expectedY = (value: number) => yMin + (yMax - yMin) * (value + 10) / 30;
    const positions = markers.map(marker => {
      const box = marker.getBBox();
      return [box.x + box.width / 2 - expectedX(coordinate(marker, 'data-x-value')),
        box.y + box.height / 2 - expectedY(coordinate(marker, 'data-value'))];
    });
    const lineX = svg.querySelector('.pptxv-chart-axis-line[data-axis="x"]')!;
    const lineY = svg.querySelector('.pptxv-chart-axis-line[data-axis="y"]')!;
    const outside = svg.querySelector<SVGGraphicsElement>('.pptxv-chart-marker[data-x-value="60"]')!;
    const curve = svg.querySelector<SVGPathElement>('.pptxv-chart-line')!;
    const end = curve.getPointAtLength(curve.getTotalLength());
    const rightTick = tick('y', '20.00').getBBox();
    return {
      reversed: x0 > x50, positions, crossing: [coordinate(lineX, 'y1') - expectedY(5), coordinate(lineY, 'x1') - expectedX(20)],
      outsideIsClipped: outside.getBBox().x < x50 && outside.parentElement!.getAttribute('overflow') === 'hidden',
      curveEndsAtLastPoint: [end.x - expectedX(40), end.y - expectedY(16)],
      curveCommands: curve.getAttribute('d')!.match(/[MC]/g),
      labelsInside: rightTick.x + rightTick.width <= svg.viewBox.baseVal.width
    };
  });
  expect(positions.reversed).toBe(true);
  for (const offset of [...positions.positions.flat(), ...positions.crossing, ...positions.curveEndsAtLastPoint]) {
    expect(offset).toBeCloseTo(0, 2);
  }
  expect(positions.outsideIsClipped).toBe(true);
  expect(positions.curveCommands).toEqual(['M', 'C', 'C', 'C', 'C']);
  expect(positions.labelsInside).toBe(true);
});

test('places points and axis crossings on independent logarithmic scatter scales', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'log-scatter.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildLogScatterFixture(source))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-axis-label[data-axis="x"]')).toHaveText(['1.0E+00', '1.0E+01', '1.0E+02', '1.0E+03']);
  await expect(chart.locator('.pptxv-chart-axis-label[data-axis="y"]')).toHaveText(['2', '4', '8', '16', '32', '64']);
  await expect(chart.locator('.pptxv-chart-marker')).toHaveCount(6);
  await expect(chart.locator('.pptxv-chart-gridline--minor[data-axis="x"]')).toHaveCount(24);
  await expect(chart.locator('.pptxv-chart-gridline--minor[data-axis="y"]')).toHaveCount(0);
  await expect(chart.locator('.pptxv-chart-gridline--minor[data-axis="x"][data-value="2"]')).toHaveCSS('stroke', 'rgb(51, 68, 85)');
  const positions = await chart.evaluate(svg => {
    const at = (node: Element, name: string) => Number(node.getAttribute(name));
    const ticks = (axis: string) => [...svg.querySelectorAll(`.pptxv-chart-axis-label[data-axis="${axis}"]`)].map(label => at(label, axis));
    const x = ticks('x'), y = ticks('y');
    const minor = svg.querySelector('.pptxv-chart-gridline--minor[data-axis="x"][data-value="2"]')!;
    const horizontal = svg.querySelector('.pptxv-chart-axis-line[data-axis="x"]')!;
    const vertical = svg.querySelector('.pptxv-chart-axis-line[data-axis="y"]')!;
    const marker = svg.querySelector('.pptxv-chart-marker[data-x-value="200"]')!;
    const outside = svg.querySelector('.pptxv-chart-marker[data-x-value="9999"]')!;
    const xFor = (value: number) => x[0] + (x[1] - x[0]) * Math.log10(value);
    return {
      x, y, verticalOffset: at(vertical, 'x1') - x[1], horizontalOffset: at(horizontal, 'y1') - y[1],
      minorOffset: at(minor, 'x1') - xFor(2),
      point: [at(marker, 'cx') - xFor(200), at(marker, 'cy') - y[4]],
      outside: at(outside, 'cx') < x[3] && outside.parentElement!.getAttribute('overflow') === 'hidden',
      segments: svg.querySelector('.pptxv-chart-line')!.getAttribute('d')!.match(/M/g)?.length
    };
  });
  expect(positions.x[0]).toBeGreaterThan(positions.x[1]);
  expect(positions.x[2] - positions.x[1]).toBeCloseTo(positions.x[1] - positions.x[0], 2);
  expect(positions.y[3] - positions.y[2]).toBeCloseTo(positions.y[1] - positions.y[0], 2);
  for (const offset of [...positions.point, positions.verticalOffset, positions.horizontalOffset, positions.minorOffset]) {
    expect(offset).toBeCloseTo(0, 2);
  }
  expect(positions.outside).toBe(true);
  expect(positions.segments).toBe(3);
});

test('paints styled bubbles on numeric axes with authored bounds and legend order', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cached-bubble.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildBubbleChartFixture(source, '<c:bubbleScale val="150"/><c:showNegBubbles val="1"/><c:sizeRepresents val="w"/>'))
  });
  const chart = page.locator('.pptxv-chart-svg');
  const marks = chart.locator('.pptxv-chart-bubble');
  await expect(marks).toHaveCount(7);
  await expect(chart.locator('.pptxv-chart-legend-item text')).toHaveText(['Measured', 'Reference']);
  await expect(chart.locator('.pptxv-chart-legend-item circle')).toHaveCount(2);
  await expect(chart.locator('.pptxv-chart-axis-label[data-axis="x"]')).toHaveText(['1', '10', '100']);
  await expect(chart.locator('.pptxv-chart-axis-label[data-axis="y"]')).toHaveText(['-10', '0', '10', '20', '30']);
  await expect(chart.locator('svg[overflow="hidden"]')).toHaveCSS('overflow', 'hidden');
  const atSize = (size: number) => chart.locator(`.pptxv-chart-bubble[data-series-index="0"][data-size-value="${size}"]`);
  await expect(atSize(4)).toHaveCSS('fill', 'rgba(40, 85, 170, 0.6)');
  await expect(atSize(4)).toHaveCSS('stroke', 'rgb(18, 52, 86)');
  await expect(atSize(16)).toHaveCSS('fill', 'rgba(255, 0, 0, 0.5)');
  await expect(atSize(16)).toHaveCSS('stroke', 'none');
  await expect(atSize(-9)).toHaveCSS('stroke', 'rgb(255, 136, 0)');
  await expect(atSize(9)).toHaveCSS('fill', 'rgba(40, 85, 170, 0)');
  await expect(atSize(9)).toHaveCSS('stroke-dasharray', '6px, 4px');

  const layout = await chart.evaluate(svg => {
    const at = (node: Element, attr: string) => Number(node.getAttribute(attr));
    const tick = (axis: string, value: string) => [...svg.querySelectorAll(`.pptxv-chart-axis-label[data-axis="${axis}"]`)]
      .find(label => label.textContent === value)!;
    const find = (value: string) => svg.querySelector(`.pptxv-chart-bubble[data-series-index="0"][data-x-value="${value}"]`)!;
    const x10 = at(tick('x', '10'), 'x'), x100 = at(tick('x', '100'), 'x');
    const near = find('10'), far = find('200'), edge = find('100');
    return {
      nearAtTick: [at(near, 'cx') - x10, at(near, 'cy') - at(tick('y', '10'), 'y')],
      logOffset: at(find('20'), 'cx') - (x10 + (x100 - x10) * Math.log10(2)),
      clipped: at(far, 'cx') + at(far, 'r') < x100 && at(edge, 'cx') === x100
    };
  });
  expect(layout.clipped).toBe(true);
  for (const offset of [...layout.nearAtTick, layout.logOffset]) expect(offset).toBeCloseTo(0, 2);
});

test('plots an authored date axis with unequal gaps, reversed bounds and calendar labels', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'date-axis.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildDateChartFixture(source, 'line'))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-category-label')).toHaveText(['1904-01-01', '1904-01-06', '1904-01-11']);
  await expect(chart.locator('.pptxv-chart-marker')).toHaveCount(4);
  await expect(chart.locator('.pptxv-chart-gridline[data-axis="category"]:not(.pptxv-chart-gridline--minor)')).toHaveCount(3);
  await expect(chart.locator('.pptxv-chart-gridline--minor[data-axis="category"][data-value="7"]')).toHaveCSS('stroke', 'rgb(161, 178, 195)');
  await expect(chart.locator('svg[overflow="hidden"]')).toHaveCSS('overflow', 'hidden');
  const offsets = await page.evaluate(() => {
    const svg = document.querySelector('.pptxv-chart-svg')!;
    const attr = (element: Element, name: string) => Number(element.getAttribute(name));
    const at = (serial: number) => svg.querySelector(`.pptxv-chart-marker[data-date-serial="${serial}"]`)!;
    const labels = [...svg.querySelectorAll('.pptxv-chart-category-label')];
    const x0 = attr(labels[0], 'x'), x10 = attr(labels[2], 'x');
    const expected = (day: number) => x0 + (x10 - x0) * day / 10;
    const y4 = attr([...svg.querySelectorAll('.pptxv-chart-axis-label')].find(label => label.textContent === '4')!, 'y');
    const categoryAxis = [...svg.querySelectorAll('.pptxv-chart-axis')].find(line =>
      attr(line, 'x1') === x10 && attr(line, 'x2') === x0 && attr(line, 'y1') === attr(line, 'y2'))!;
    return {
      pixels: [0, 2, 7, 15].map(day => attr(at(day), 'cx') - expected(day)),
      reversed: x0 > x10,
      outside: attr(at(15), 'cx') + attr(at(15), 'r') < x10,
      chronological: [...svg.querySelectorAll('.pptxv-chart-marker')].map(mark => attr(mark, 'data-date-serial')),
      crossing: attr(categoryAxis, 'y1') - y4
    };
  });
  expect(offsets.reversed).toBe(true);
  expect(offsets.outside).toBe(true);
  expect(offsets.chronological).toEqual([0, 2, 7, 15]);
  for (const offset of [...offsets.pixels, offsets.crossing]) expect(offset).toBeCloseTo(0, 2);
});

test('paints a smoothed percent-stacked line through the cached series points', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'cached-percent.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildStackedLineChartFixture(source, 'percentStacked', 'span'))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-line')).toHaveCount(2);
  const layout = await chart.evaluate(svg => {
    const tick = (text: string) => [...svg.querySelectorAll('.pptxv-chart-axis-label')].find(label => label.textContent === text);
    const yZero = Number(tick('0.0%')!.getAttribute('y'));
    const yOne = Number(tick('100.0%')!.getAttribute('y'));
    const markers = (index: number) => [...svg.querySelectorAll(`.pptxv-chart-marker[data-series-index="${index}"]`)].map(marker => ({
      x: Number(marker.getAttribute('cx')), y: Number(marker.getAttribute('cy'))
    }));
    const first = markers(0);
    const second = markers(1);
    const curve = svg.querySelector<SVGPathElement>('.pptxv-chart-line[data-series-index="0"]')!;
    const length = curve.getTotalLength();
    const midpointX = (first[0].x + first[1].x) / 2;
    let lo = 0;
    let hi = length;
    for (let step = 0; step < 20; step++) {
      const mid = (lo + hi) / 2;
      if (curve.getPointAtLength(mid).x > midpointX) lo = mid;
      else hi = mid;
    }
    const point = curve.getPointAtLength((lo + hi) / 2);
    const end = curve.getPointAtLength(length);
    return {
      firstStack: first.map(({ y }) => (y - yZero) / (yOne - yZero)),
      secondStack: second.map(({ y }) => (y - yZero) / (yOne - yZero)),
      deviation: Math.abs(point.y - (first[0].y + first[1].y) / 2),
      endpointError: Math.hypot(end.x - first[2].x, end.y - first[2].y)
    };
  });
  [0.6, -2 / 3, 5 / 6].forEach((value, i) => expect(layout.firstStack[i]).toBeCloseTo(value, 3));
  [1, 1, -1 / 3, 1].forEach((value, i) => expect(layout.secondStack[i]).toBeCloseTo(value, 3));
  expect(layout.deviation).toBeGreaterThan(0.1);
  expect(layout.endpointError).toBeLessThan(0.01);
});

test('layers stacked areas behind columns and a line while sharing category positions', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'area-combination.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildAreaCombinationFixture(source))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-area')).toHaveCount(2);
  await expect(chart.locator('.pptxv-chart-bar')).toHaveCount(4);
  await expect(chart.locator('.pptxv-chart-marker')).toHaveCount(4);
  await expect(chart.locator('.pptxv-chart-legend-item text')).toHaveText(['Base', 'Budget', 'Changes', 'Margin']);
  await expect(chart.locator('.pptxv-chart-axis-label[data-axis="secondary"]')).toHaveText(['0%', '25%', '50%', '75%', '100%']);
  const base = chart.locator('.pptxv-chart-area[data-series-index="0"]');
  const changes = chart.locator('.pptxv-chart-area[data-series-index="2"]');
  await expect(base).toHaveCSS('fill', /url\("#pptx-chart-\d+-fill-gradient"\)/);
  await expect(base).toHaveCSS('stroke', 'rgb(18, 52, 86)');
  await expect(changes).toHaveCSS('fill', 'rgba(255, 136, 0, 0.6)');
  await expect(changes).toHaveCSS('stroke', 'none');
  await expect(chart.locator('svg[overflow="hidden"]').first()).toHaveCSS('overflow', 'hidden');
  const layout = await page.evaluate(() => {
    const svg = document.querySelector('.pptxv-chart-svg')!;
    const [base, changes] = [...svg.querySelectorAll('.pptxv-chart-area')];
    const points = (path: Element) => [...(path.getAttribute('d') ?? '').matchAll(/[ML] ([^ ]+) ([^ ]+)/g)]
      .map(([, x, y]) => [Number(x), Number(y)]);
    const bars = [...svg.querySelectorAll('.pptxv-chart-bar')];
    const markers = [...svg.querySelectorAll('.pptxv-chart-marker')];
    const then = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    const at = (element: Element, name: string) => Number(element.getAttribute(name));
    const y = (axis: string, text: string) => at([...svg.querySelectorAll(`.pptxv-chart-axis-label[data-axis="${axis}"]`)]
      .find(node => node.textContent === text)!, 'y');
    const basePoints = points(base), changePoints = points(changes);
    return {
      offsets: bars.flatMap((bar, index) => {
        const x = at(bar, 'x') + at(bar, 'width') / 2;
        return [x - basePoints[index][0], x - at(markers[index], 'cx')];
      }),
      layerOrder: then(base, changes) && then(changes, bars[0]) && then(bars[0], markers[0]),
      outside: changePoints[1][1] < at(changes.parentElement!, 'y'),
      lowerGapSpanned: basePoints[2][1] - (y('primary', '0') + (y('primary', '0') - y('primary', '2')) / 2),
      borrowedBoundary: changePoints[5][1] - basePoints[2][1],
      usesSecondary: at(markers[1], 'cy') - y('secondary', '50%')
    };
  });
  expect(layout.layerOrder).toBe(true);
  expect(layout.outside).toBe(true);
  for (const offset of [...layout.offsets, layout.lowerGapSpanned, layout.borrowedBoundary, layout.usesSecondary]) {
    expect(offset).toBeCloseTo(0, 2);
  }
});

test('aligns combination chart categories while scaling the line on its secondary axis', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'secondary-combination.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildCombinedChartFixture(source, true))
  });
  const chart = page.locator('.pptxv-chart-svg');
  await expect(chart.locator('.pptxv-chart-marker')).toHaveCount(3);
  const measure = () => chart.evaluate(svg => {
    const tick = (axis: string, label: string) => [...svg.querySelectorAll(`.pptxv-chart-axis-label[data-axis="${axis}"]`)]
      .find(element => element.textContent === label)!;
    const position = (element: Element, attribute: string) => Number(element.getAttribute(attribute));
    const bars = (index: number) => [...svg.querySelectorAll(`.pptxv-chart-bar[data-series-index="${index}"]`)] as SVGRectElement[];
    const products = bars(1).map(bar => bar.getBBox());
    const services = bars(2).map(bar => bar.getBBox());
    const markers = [...svg.querySelectorAll('.pptxv-chart-marker')].map(marker => ({
      category: position(marker, 'data-category-index'), x: position(marker, 'cx'), y: position(marker, 'cy')
    }));
    const rightLabels = ['50%', '75%', '25%'].map(label => tick('secondary', label));
    const productsAxisY = position(tick('primary', '40'), 'y');
    const primaryTwenty = position(tick('primary', '20'), 'y');
    const screenBoxes = rightLabels.map(label => label.getBoundingClientRect());
    const legend = svg.querySelector('.pptxv-chart-legend')!.getBoundingClientRect();
    return {
      painted: products[0].width > 0 && legend.width > 0,
      markers,
      centers: markers.map(({ category }) => products[category].x + products[category].width / 2),
      markerY: rightLabels.map(label => position(label, 'y')),
      productsY: products[0].y,
      servicesY: services[0].y,
      expectedProductsY: productsAxisY,
      expectedServicesY: productsAxisY + (productsAxisY - primaryTwenty) / 2,
      rightOfData: position(rightLabels[0], 'x') > Math.max(...products.map(bar => bar.x + bar.width)),
      legendClear: legend.left > Math.max(...screenBoxes.map(box => box.right))
    };
  });
  let layout!: Awaited<ReturnType<typeof measure>>;
  await expect.poll(async () => (layout = await measure()).painted).toBe(true);
  expect(layout.markers.map(marker => marker.category)).toEqual([0, 2, 3]);
  layout.markers.forEach((marker, index) => {
    expect(marker.x).toBeCloseTo(layout.centers[index], 2);
    expect(marker.y).toBeCloseTo(layout.markerY[index], 2);
  });
  expect(layout.markers[0].x).toBeGreaterThan(layout.markers[2].x);
  expect(layout.productsY).toBeCloseTo(layout.expectedProductsY, 2);
  expect(layout.servicesY).toBeCloseTo(layout.expectedServicesY, 2);
  expect(layout.rightOfData).toBe(true);
  expect(layout.legendClear).toBe(true);
});

test('updates chart typography after a host font loads and still preserves slide zoom', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  const bytes = [...await buildChartFontFixture(source)];
  const font = await readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf'));
  await page.goto('./');
  const entry = new URL(`@fs${resolve('packages/pptx/src/index.ts')}`, page.url()).href;
  const fontUrl = new URL('chart-legend-font.ttf', page.url()).href;
  let releaseFont!: () => void;
  const pendingFont = new Promise<void>(done => { releaseFont = done; });
  await page.route(fontUrl, async route => {
    await pendingFont;
    await route.fulfill({ body: font, contentType: 'font/ttf' });
  });
  const target = { entry, fontUrl, bytes, family: 'Filens Chart Legend', mapped: 'Filens Hosted Legend' };
  try {
    const before = await page.evaluate(async ({ entry, bytes, fontUrl, family, mapped }) => {
      const { createPptxPreviewDriver } = await import(/* @vite-ignore */ entry);
      const host = document.createElement('div');
      host.id = 'chart-font-preview';
      host.style.cssText = 'width:800px;height:600px';
      document.body.append(host);
      const requests: Array<{ family?: string; style?: string }> = [];
      const session = createPptxPreviewDriver().createSession(host, {
        fit: 'none',
        fontLoading: { packs: [], preferLocal: false },
        fontResolver: (request: { fontFamily?: string; fontStyle?: string }) => {
          requests.push({ family: request.fontFamily, style: request.fontStyle });
          if (request.fontFamily !== family) return undefined;
          return { fontFamily: mapped, assets: [{ id: 'chart-legend-italic', fontFamily: mapped, sources: [{ url: fontUrl }], descriptors: { style: 'italic' } }] };
        }
      });
      const input = new Uint8Array(bytes);
      await session.load(input, { descriptor: { source: input, extension: 'pptx' } });
      session.setScale(1.35);
      const legend = host.querySelector('.pptxv-chart-legend-item text')!;
      (window as any).filensChartFonts = { session, host, requests, legend };
      const rows = [...host.querySelectorAll<SVGGraphicsElement>('.pptxv-chart-title > text')];
      return {
        font: getComputedStyle(legend).fontFamily,
        status: session.getState().fonts.find((item: { fontFamily?: string }) => item.fontFamily === family)?.status,
        rows: rows.map(row => [row.textContent, row.getBBox().y])
      };
    }, target);
    expect(before.font).toContain(target.family);
    expect(before.status).toBe('missing');
    expect(before.rows.map(row => row[0])).toEqual(['Net margin report', 'Quarterly view']);
    expect(before.rows[1][1]).toBeGreaterThan(before.rows[0][1] as number);
    releaseFont();
    const legend = page.locator('#chart-font-preview .pptxv-chart-legend-item text').first();
    await expect.poll(() => legend.evaluate(node => getComputedStyle(node).fontFamily)).toContain(target.mapped);
    const after = await page.evaluate(({ family, mapped }) => {
      const { session, host, requests, legend } = (window as any).filensChartFonts;
      const current = session.getState();
      const label = host.querySelector('.pptxv-chart-legend-item text');
      const result = {
        requests: requests.filter((item: { family?: string }) => item.family === family),
        hiddenRequested: requests.some((item: { family?: string }) => item.family === 'Filens Hidden Labels'),
        refreshed: legend !== label,
        style: getComputedStyle(label).fontStyle,
        zoom: current.scale,
        diagnostic: current.fonts.find((item: { fontFamily?: string }) => item.fontFamily === family),
        loaded: [...document.fonts].some(face => face.family === mapped && face.status === 'loaded'),
      };
      session.destroy();
      host.remove();
      return { ...result, released: ![...document.fonts].some(face => face.family === mapped) };
    }, target);
    expect(after).toMatchObject({
      requests: [{ family: target.family, style: 'italic' }], hiddenRequested: false,
      refreshed: true, style: 'italic', zoom: 1.35, loaded: true, released: true,
      diagnostic: { fontFamily: target.family, resolvedFontFamily: target.mapped, source: 'application', status: 'substituted' }
    });
  } finally {
    releaseFont();
  }
});

test('places axis titles beyond their ticks and keeps the secondary title clear of the legend', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'axis-titles.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildChartAxisTitleFixture(source))
  });
  const chart = page.locator('.pptxv-chart-svg');
  const titles = chart.locator('.pptxv-chart-axis-title');
  await expect(titles).toHaveCount(3);
  const measure = () => chart.evaluate(svg => {
    const bounds = (selector: string) => svg.querySelector(selector)!.getBoundingClientRect();
    const tickBounds = (selector: string) => Array.from(svg.querySelectorAll(selector), tick => tick.getBoundingClientRect());
    const category = bounds('.pptxv-chart-axis-title[data-axis="category"]');
    const primary = bounds('.pptxv-chart-axis-title[data-axis="primary"]');
    const secondary = bounds('.pptxv-chart-axis-title[data-axis="secondary"]');
    const legend = bounds('.pptxv-chart-legend');
    const chartBounds = svg.getBoundingClientRect();
    return {
      painted: category.width > 0 && primary.width > 0 && secondary.width > 0 && legend.width > 0,
      categoryClear: category.top > Math.max(...tickBounds('.pptxv-chart-category-label').map(label => label.bottom)),
      primaryClear: primary.right < Math.min(...tickBounds('.pptxv-chart-axis-label[data-axis="primary"]').map(label => label.left)),
      secondaryClear: secondary.left > Math.max(...tickBounds('.pptxv-chart-axis-label[data-axis="secondary"]').map(label => label.right))
        && secondary.right < legend.left,
      inside: category.bottom <= chartBounds.bottom && primary.left >= chartBounds.left && secondary.right <= chartBounds.right
    };
  });
  let layout!: Awaited<ReturnType<typeof measure>>;
  await expect.poll(async () => (layout = await measure()).painted).toBe(true);
  expect(layout).toMatchObject({ categoryClear: true, primaryClear: true, secondaryClear: true, inside: true });
  await expect(titles.first().locator('text')).toHaveText(['Fiscal 年度 trends', 'Q1–Q4']);
  await expect(titles.nth(1)).toHaveAttribute('transform', /rotate\(-90\)/);
  await expect(titles.nth(2)).toHaveAttribute('transform', /rotate\(20\)/);
});

test('places chart and axis titles at authored edges and offsets', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  const input = page.getByLabel('导入文件', { exact: true });
  const chart = page.locator('.pptxv-chart-svg');
  const title = chart.locator('.pptxv-chart-title');
  const load = async (name: string, buffer: Uint8Array) => {
    await input.setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(buffer) });
    await expect(title).toBeVisible();
  };
  const measure = () => chart.evaluate((svg: SVGSVGElement) => {
    const title = (selector: string) => svg.querySelector<SVGGElement>(selector)!;
    const center = (group: SVGGElement) => group.transform.baseVal.getItem(0).matrix;
    const root = svg.getBoundingClientRect();
    const main = title('.pptxv-chart-title');
    const category = title('[data-axis="category"].pptxv-chart-axis-title');
    const primary = title('[data-axis="primary"].pptxv-chart-axis-title');
    const mainBounds = main.getBoundingClientRect();
    const bar = svg.querySelector('.pptxv-chart-bar')!.getBoundingClientRect();
    return {
      mainLeft: (mainBounds.left - root.left) / root.width,
      mainTop: (mainBounds.top - root.top) / root.height,
      categoryTop: (category.getBoundingClientRect().top - root.top) / root.height,
      categoryX: center(category).e / svg.viewBox.baseVal.width,
      primaryX: center(primary).e / svg.viewBox.baseVal.width,
      primaryY: center(primary).f / svg.viewBox.baseVal.height,
      barHeight: bar.height
    };
  });
  await load('auto-titles.pptx', await buildChartAxisTitleFixture(source, 'bar'));
  const automatic = await measure();
  await load('manual-titles.pptx', await buildManualChartTitleFixture(source));
  await expect(title).toHaveAttribute('transform', /translate/);
  const manual = await measure();
  expect(Math.abs(manual.mainLeft - 0.24)).toBeLessThan(0.015);
  // The browser's fallback font ascent affects the painted edge of the layout box.
  expect(Math.abs(manual.mainTop - 0.36)).toBeLessThan(0.04);
  expect(Math.abs(manual.categoryTop - 0.29)).toBeLessThan(0.015);
  expect(manual.categoryX - automatic.categoryX).toBeCloseTo(0.28, 3);
  expect(manual.primaryX).toBeCloseTo(automatic.primaryX, 3);
  expect(manual.primaryY - automatic.primaryY).toBeCloseTo(-0.16, 3);
  expect(manual.barHeight).toBeGreaterThan(automatic.barHeight);
});

test('lays out vertical chart titles in their authored scripts and column order', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'vertical-titles.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildVerticalChartTitleFixture(source))
  });
  const chart = page.locator('.pptxv-chart-svg');
  const main = chart.locator('.pptxv-chart-title');
  const category = chart.locator('.pptxv-chart-axis-title[data-axis="category"]');
  const primary = chart.locator('.pptxv-chart-axis-title[data-axis="primary"]');
  const secondary = chart.locator('.pptxv-chart-axis-title[data-axis="secondary"]');
  await expect(main.locator('text')).toHaveText(['春A期', '第二季主要產品出貨與收入']);
  await expect(category.locator('text')).toHaveText(['Cafe\u0301 年度𠀀', 'Q1–Q4']);
  await expect(primary.locator('text')).toHaveText(['2026', 'USD']);
  await expect(secondary.locator('text')).toHaveText(['ᠮᠣᠩᠭᠣᠯ', 'ᠪᠢᠴᠢᠭ']);
  await expect(primary).toHaveAttribute('transform', /rotate\(15\)/);
  await expect(secondary).toHaveAttribute('transform', /rotate\(0\)/);
  const measure = (group: typeof main) => group.locator('text').evaluateAll((columns: SVGTextElement[]) => {
    const [first, second] = columns;
    const style = getComputedStyle(first);
    return {
      flow: style.writingMode, orientation: style.textOrientation,
      rightToLeft: first.x.baseVal.getItem(0).value > second.x.baseVal.getItem(0).value,
      down: first.getStartPositionOfChar(0).y < first.getStartPositionOfChar(2).y,
      angles: [0, 1, 2].map(index => first.getRotationOfChar(index))
    };
  });
  expect(await measure(main)).toEqual({ flow: 'vertical-rl', orientation: 'mixed', rightToLeft: true, down: true, angles: [0, 90, 0] });
  expect(await measure(category)).toEqual({ flow: 'vertical-lr', orientation: 'upright', rightToLeft: false, down: true, angles: [0, 0, 0] });
  expect(await measure(primary)).toEqual({ flow: 'vertical-rl', orientation: 'upright', rightToLeft: true, down: true, angles: [0, 0, 0] });
  expect(await measure(secondary)).toMatchObject({ flow: 'vertical-lr', orientation: 'mixed', rightToLeft: false, down: true });
  const readLayout = () => chart.evaluate(svg => {
    // Font refresh can replace the SVG between locator resolution and measurement.
    if (!svg.isConnected) return;
    const title = svg.querySelector<SVGGElement>('.pptxv-chart-title')!;
    const main = title.getBoundingClientRect();
    const scale = title.transform.baseVal.getItem(2).matrix.a;
    const top = svg.getBoundingClientRect().top;
    const columnTop = Math.min(...Array.from(svg.querySelectorAll('.pptxv-chart-bar'), bar => bar.getBoundingClientRect().top));
    return { scale, width: main.width, topGap: main.top - top, plotGap: columnTop - main.bottom };
  });
  let layout!: NonNullable<Awaited<ReturnType<typeof readLayout>>>;
  await expect.poll(async () => {
    const current = await readLayout();
    if (!current) return false;
    layout = current;
    return true;
  }).toBe(true);
  expect(layout.scale).toBeLessThan(1);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.topGap, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
  expect(layout.plotGap, JSON.stringify(layout)).toBeGreaterThan(0);
});

test('loads the mixed-script tick face without changing the differently styled legend face', async ({ page }) => {
  const source = await readFile(resolve('apps/demo/public/samples/rich-pptx-shapes.pptx'));
  const deck = Buffer.from(await buildMixedChartLabelFixture(source)).toString('base64');
  const font = await readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
  await page.goto('./');
  const entry = new URL(`@fs${resolve('packages/pptx/src/index.ts')}`, page.url()).href;
  const family = 'Filens Theme Japanese', mapped = 'Filens Hosted Tick Face';
  await page.evaluate(async ({ entry, deck, fontBytes, family, mapped }) => {
    const { createPptxPreviewDriver } = await import(/* @vite-ignore */ entry);
    const host = document.createElement('div');
    host.id = 'mixed-chart-preview';
    host.style.cssText = 'width:800px;height:600px';
    document.body.append(host);
    const requests: string[] = [];
    const session = createPptxPreviewDriver().createSession(host, {
      fit: 'none', fontLoading: { packs: [], preferLocal: false },
      fontResolver: (request: { fontFamily?: string; fontStyle?: string }) => {
        if (request.fontFamily !== family) return undefined;
        requests.push(request.fontStyle ?? '');
        if (request.fontStyle !== 'normal') return undefined;
        return { fontFamily: mapped, assets: [{ id: 'mixed-chart-bold', fontFamily: mapped,
          descriptors: { weight: '700' }, data: new Uint8Array(fontBytes) }] };
      }
    });
    const input = Uint8Array.from(atob(deck), char => char.charCodeAt(0));
    (window as any).mixedChartFontTest = { session, host, requests };
    await session.load(input, { descriptor: { source: input, extension: 'pptx' } });
  }, { entry, deck, fontBytes: [...font], family, mapped });
  const chart = page.locator('#mixed-chart-preview .pptxv-chart-svg');
  const category = chart.locator('.pptxv-chart-category-label').filter({ hasText: 'Q1' });
  const legend = chart.locator('.pptxv-chart-legend-item text').filter({ hasText: 'Products' });
  await expect(category.locator('tspan')).toHaveText(['Q1 ', '季節 ', 'العَرَبِيَّة']);
  await expect(legend.locator('tspan')).toHaveText(['Products ', '日本語 ', 'العربية']);
  const categoryFont = () => category.locator('tspan').nth(1).evaluate(node => getComputedStyle(node).fontFamily);
  await expect.poll(categoryFont).toContain(mapped);
  expect(await legend.locator('tspan').nth(1).evaluate(node => getComputedStyle(node).fontFamily)).toContain(family);
  expect(await category.locator('tspan').nth(2).evaluate(node => getComputedStyle(node).fontFamily)).toContain('Filens Tick Arabic');
  expect(await legend.locator('tspan').nth(2).evaluate(node => getComputedStyle(node).fontFamily)).toContain('Filens Label Arabic');

  const result = await page.evaluate(({ family, mapped }) => {
    const { session, host, requests } = (window as any).mixedChartFontTest;
    const fonts = session.getState().fonts;
    const loaded = [...document.fonts].some(face => face.family === mapped && face.status === 'loaded');
    session.destroy();
    host.remove();
    return { requests, loaded, released: ![...document.fonts].some(face => face.family === mapped),
      recognized: fonts.some((font: { fontFamily: string; resolvedFontFamily?: string }) => font.fontFamily === family && font.resolvedFontFamily === mapped),
      unused: fonts.some((font: { fontFamily: string }) => font.fontFamily === 'Filens Unused Numeric Han') };
  }, { family, mapped });
  expect(result).toEqual({ requests: ['italic', 'normal'], loaded: true, released: true, recognized: true, unused: false });
});

test('renders guided ellipse arcs with the authored sweep and shape scaling', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'guided-ellipse.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildGuidedCustomPathFixture())
  });
  const path = page.locator('.pptxv-shape-svg path').first();
  await expect(path).toBeVisible();
  const result = await path.evaluate((element: SVGPathElement) => {
    const { x, y, width, height } = element.getBBox();
    const firstArc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    firstArc.setAttribute('d', element.getAttribute('d')!.split(' L ')[0]);
    const middle = firstArc.getPointAtLength(firstArc.getTotalLength() / 2);
    return { box: [x, y, width, height], middle: [middle.x, middle.y] };
  });
  [0, 48, 384, 144].forEach((edge, index) => expect(result.box[index]).toBeCloseTo(edge, 1));
  const offset = 30 * 20 / Math.hypot(30, 20);
  const ellipseX = (60 - offset) * 3.2;
  const ellipseY = (40 - offset) * 2.4;
  const [x, y] = result.middle;
  expect(((x - ellipseX) / 96) ** 2 + ((y - ellipseY) / 48) ** 2).toBeCloseTo(1, 3);
  expect(x).toBeGreaterThan(ellipseX);
  expect(y).toBeGreaterThan(96);
});

test('places freeform text inside its authored rectangle on the preview surface', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'freeform-text.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(await buildCustomGeometryTextRectangleFixture())
  });
  const centered = page.locator('.pptxv-shape-text').filter({ hasText: 'Grouped guide rectangle' });
  await expect(centered).toBeVisible();
  const layout = await centered.evaluate(element => {
    const shape = element.parentElement!.getBoundingClientRect();
    const text = element.getBoundingClientRect();
    const scale = shape.width / 768;
    return { x: (text.x - shape.x) / scale, center: (text.y + text.height / 2 - shape.y) / scale, width: text.width / scale };
  });
  expect(layout.x).toBeCloseTo(144, 1);
  expect(layout.center).toBeCloseTo(60, 1);
  expect(layout.width).toBeCloseTo(432, 1);
});

test('refreshes PPTX font weights after a font is added and removed', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/index.ts')}`, page.url()).href;
  const bytes = [...await readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'))];
  const weights = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { renderSlideToElement } = await import(/* @vite-ignore */ moduleUrl);
    const family = 'Filens Dynamic Light';
    const slide = {
      id: 'dynamic-font', index: 0, title: 'Dynamic font', width: 400, height: 200,
      background: { type: 'solid', color: '#ffffff' }, warnings: [],
      items: [{
        id: 'title', kind: 'text', name: 'Title', order: 1, groupPath: [],
        transform: { x: 0, y: 0, width: 320, height: 100, rotation: 0, flipH: false, flipV: false },
        fill: { type: 'none' },
        textFrame: {
          verticalAlign: 'top', padding: { top: 0, right: 0, bottom: 0, left: 0 },
          paragraphs: [{ runs: [{ text: 'Dynamic title', fontSize: 44, fontFamily: family }] }]
        }
      }]
    };
    const presentation = { size: { width: 400, height: 200 }, slides: [slide], media: {}, warnings: [] };
    const weight = () => (renderSlideToElement(slide, presentation).querySelector('.pptxv-run') as HTMLElement).style.fontWeight;
    const before = weight();
    const face = new FontFace(family, new Uint8Array(bytes));
    try {
      await face.load();
      document.fonts.add(face);
      const loaded = weight();
      document.fonts.delete(face);
      return { before, loaded, removed: weight() };
    } finally {
      document.fonts.delete(face);
    }
  }, { moduleUrl, bytes });
  expect(weights).toEqual({ before: '310', loaded: '', removed: '310' });
});

test('stops a cancelled file and preserves the latest preview through switching and destruction', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/index.ts')}`, page.url()).href;
  const pptxUrl = new URL(`@fs${resolve('packages/pptx/src/index.ts')}`, page.url()).href;
  const sampleUrl = new URL('samples/filens-field-notes.pptx', page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, pptxUrl, sampleUrl }) => {
    const { createViewer, loadPptx } = await import(/* @vite-ignore */ moduleUrl);
    const standalone = await import(/* @vite-ignore */ pptxUrl);
    const sharesImplementation = standalone.createViewer === createViewer && standalone.loadPptx === loadPptx;
    const bytes = await (await fetch(sampleUrl)).arrayBuffer();
    const delayedFile = () => {
      let release!: (value: ArrayBuffer) => void;
      const file = new File([], 'late.pptx');
      Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(done => { release = done; }) });
      return { file, release: () => release(new ArrayBuffer(4)) };
    };
    const controller = new AbortController();
    const direct = delayedFile();
    const pending = loadPptx(direct.file, { signal: controller.signal }).then(
      () => 'parsed', (error: Error) => error.name
    );
    controller.abort();
    direct.release();
    const cancelled = await pending;
    const host = document.createElement('div');
    host.style.cssText = 'width:800px;height:600px';
    document.body.append(host);
    const viewer = createViewer(host);
    let rendered = 0, errors = 0;
    viewer.on('rendered', () => rendered++);
    viewer.on('error', () => errors++);
    try {
      const first = delayedFile();
      const previous = viewer.preview(first.file);
      await viewer.preview(new File([bytes], 'current.pptx'));
      const current = viewer.getState().presentation;
      first.release();
      await previous;
      const latestPreserved = !!current && viewer.getState().presentation === current && !!host.querySelector('.pptxv-slide');
      const last = delayedFile();
      const unfinished = viewer.preview(last.file);
      viewer.destroy();
      last.release();
      await unfinished;
      return { sharesImplementation, cancelled, latestPreserved, rendered, errors, destroyed: !host.childElementCount && !viewer.getState().presentation };
    } finally {
      viewer.destroy();
      host.remove();
    }
  }, { moduleUrl, pptxUrl, sampleUrl });
  expect(result).toEqual({ sharesImplementation: true, cancelled: 'AbortError', latestPreserved: true, rendered: 1, errors: 0, destroyed: true });
  expect(errors).toEqual([]);
});
