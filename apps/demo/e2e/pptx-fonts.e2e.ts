import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { embeddedFontDeck, eotFont } from '../../../packages/pptx/test/fixtures/embedded-font-deck';

test.use({ reducedMotion: 'reduce' });

test('uses embedded PPTX fonts in the session and legacy Viewer and owns their lifetime', async ({ page }) => {
  const family = 'FiLens Embedded Deck Face';
  const [compressed, regular, boldItalic] = await Promise.all([
    readFile('packages/pptx/test/fixtures/Boldonse.eot'),
    readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'),
    readFile('node_modules/pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf')
  ]);
  const rejected = ['Restricted Deck Face', 'Missing Deck Face', 'External Deck Face', 'Truncated Deck Face'];
  const first = await embeddedFontDeck([
    { family, bytes: compressed }, { family, variant: 'boldItalic', bytes: eotFont(boldItalic, { flags: 0x10000000 }) },
    { family: rejected[0], bytes: eotFont(regular, { permissions: 2 }) }, { family: rejected[1] },
    { family: rejected[2], external: true }, { family: rejected[3], bytes: compressed.subarray(0, 200) }
  ]);
  const second = await embeddedFontDeck([{ family, bytes: regular }]);
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pptx/src/index.ts')}`, page.url()).href;
  const before = await page.evaluate(async ({ moduleUrl, files }) => {
    const { createPptxPreviewDriver, createViewer, renderSlideToElement } = await import(/* @vite-ignore */ moduleUrl);
    const loadFont = FontFace.prototype.load;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    FontFace.prototype.load = async function () { await gate; return loadFont.call(this); };
    const [firstHost, secondHost] = files.map((_, index) => {
      const host = document.createElement('div');
      host.id = `embedded-deck-${index}`;
      host.style.cssText = 'width:700px;height:400px;';
      document.body.append(host);
      return host;
    });
    const [source, raw] = files.map(bytes => Uint8Array.from(atob(bytes), char => char.charCodeAt(0)));
    const requested = new Set<string>();
    const session = createPptxPreviewDriver().createSession(firstHost, {
      fit: 'none', fontLoading: { packs: [] },
      fontResolver: ({ fontFamily }: { fontFamily?: string }) => { if (fontFamily) requested.add(fontFamily); }
    });
    const viewer = createViewer(secondHost, { fit: 'none' });
    const controller = new AbortController();
    await Promise.all([session.load(source, { descriptor: { source, extension: 'pptx' }, signal: controller.signal }), viewer.preview(raw)]);
    session.setScale(1.15);
    session.goToPage(1);
    const area = firstHost.querySelector('.pptxv-scroll-area')!;
    const run = () => firstHost.querySelector('.pptxv-slide-shell[data-slide-index="1"] .pptxv-run')!;
    const faces = () => [...document.fonts].filter(face => face.family.startsWith('filens-pptx-embedded-'));
    (window as any).deckFonts = { session, viewer, release, renderSlideToElement, requested, controller, faces, area, run, secondHost, firstRun: run() };
    return { fonts: session.getState().fonts, scroll: area.scrollTop, width: run().getBoundingClientRect().width, registered: faces().length };
  }, { moduleUrl, files: [first, second].map(bytes => Buffer.from(bytes).toString('base64')) });
  expect(before.scroll).toBeGreaterThan(0);
  expect(before.registered).toBe(0);
  expect(before.fonts).toContainEqual(expect.objectContaining({ fontFamily: family, embedded: true, status: 'unknown' }));

  await page.evaluate(() => (window as any).deckFonts.release());
  const inventory = () => page.evaluate(() => (window as any).deckFonts.session.getState().fonts);
  await expect.poll(inventory).toContainEqual(expect.objectContaining({ fontFamily: family, embedded: true, source: 'embedded', status: 'available' }));
  await expect.poll(() => page.evaluate(() => [...(window as any).deckFonts.requested].sort())).toEqual([...rejected].sort());
  await expect.poll(() => page.evaluate(() => (window as any).deckFonts.faces().length)).toBe(3);
  for (const name of rejected) expect(await inventory()).toContainEqual(expect.objectContaining({ fontFamily: name, embedded: true, status: 'unknown' }));

  const after = await page.evaluate(() => {
    const { session, viewer, renderSlideToElement, controller, faces, area, run, secondHost, firstRun } = (window as any).deckFonts;
    const alias = (element: Element) => getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '');
    const first = run(), second = secondHost.querySelector('.pptxv-run');
    const family = alias(first), otherFamily = alias(second);
    const variants = faces().filter((face: FontFace) => face.family === family).map((face: FontFace) => [face.weight, face.style, face.status]);
    const { presentation } = viewer.getState();
    const thumbnail = renderSlideToElement(presentation.slides[0], presentation, { thumbnail: true });
    document.body.append(thumbnail);
    const thumb = alias(thumbnail.querySelector('.pptxv-run'));
    thumbnail.remove();
    const { pageIndex, scale } = session.getState();
    const width = first.getBoundingClientRect().width, scroll = area.scrollTop;
    controller.abort();
    const sibling = faces().map((face: FontFace) => face.family);
    session.destroy();
    viewer.destroy();
    return { family, otherFamily, variants, thumb, pageIndex, scale, width, scroll, sibling, replaced: first !== firstRun, remaining: faces().length };
  });
  expect(after.family).not.toBe(after.otherFamily);
  expect(after.variants).toEqual([['400', 'normal', 'loaded'], ['700', 'italic', 'loaded']]);
  expect(after.thumb).toBe(after.otherFamily);
  expect(after.pageIndex).toBe(1);
  expect(after.scale).toBe(1.15);
  expect(after.scroll).toBe(before.scroll);
  expect(after.replaced).toBe(true);
  expect(Math.abs(after.width - before.width)).toBeGreaterThan(1);
  expect(after.sibling).toEqual([after.otherFamily]);
  expect(after.remaining).toBe(0);
});
