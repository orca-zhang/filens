import { resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { createDrawioFixture } from '../../../packages/diagram/test/fixtures/diagrams.mjs';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
interface TouchFixture {
  name: string; pkg: string; factory: string; extension: string; selector: string;
  text?: string; file?: string; contentType?: string; bytes?: number[];
}
const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="600" height="600" fill="#158ac4"/><circle cx="900" cy="300" r="180" fill="#ec784a"/></svg>';
const scalable: TouchFixture[] = [
  { name: 'image', pkg: 'core', factory: 'createImagePreviewDriver', extension: 'svg', text: picture, selector: '.pptxv-native-preview--image' },
  { name: 'panorama', pkg: 'panorama', factory: 'createPanoramaPreviewDriver', extension: 'pano', text: picture, selector: '.panoramav-canvas' },
  { name: 'panorama video', pkg: 'panorama', factory: 'createPanoramaPreviewDriver', extension: '360v', file: 'sample-video.mp4', contentType: 'video/mp4', selector: '.panoramav-canvas' },
  { name: 'CAD', pkg: 'cad', factory: 'createCadPreviewDriver', extension: 'dxf', file: 'filens-cafe.dxf', selector: '.cadv-preview' },
  { name: 'diagram', pkg: 'diagram', factory: 'createDiagramPreviewDriver', extension: 'drawio', text: createDrawioFixture(6), selector: '.diagramv-preview' },
  { name: 'mindmap', pkg: 'mindmap', factory: 'createMindmapPreviewDriver', extension: 'opml', text: '<opml version="2.0"><head><title>Touch</title></head><body><outline text="Root">' + Array.from({ length: 60 }, (_, i) => `<outline text="Node ${i}"/>`).join('') + '</outline></body></opml>', selector: '.mindmapv-preview' },
  { name: 'PDF', pkg: 'pdf', factory: 'createPdfPreviewDriver', extension: 'pdf', file: 'filens-cosmic-atlas.pdf', selector: '.pdfv-preview' },
  { name: 'PPTX', pkg: 'core', factory: 'createPptxPreviewDriver', extension: 'pptx', file: 'sample-deck.pptx', selector: '.pptxv-scroll-area' },
  { name: 'Keynote', pkg: 'iwork', factory: 'createIworkPreviewDriver', extension: 'key', file: 'filens-weekend.key', selector: '.iworkv-root' },
  { name: 'Pages', pkg: 'iwork', factory: 'createIworkPreviewDriver', extension: 'pages', file: 'a.pages', selector: '.iworkv-root' }
];

async function touch(page: Page, cdp: CDPSession, type: string, touchPoints: Array<{ id: number; x: number; y: number }>) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function prepare(page: Page, fixture: TouchFixture) {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve(`packages/${fixture.pkg}/src/index.ts`)}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, fixture }) => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white';
    document.body.replaceChildren(host);
    const session = lib[fixture.factory]().createSession(host, { fit: 'contain' });
    (window as any).mobileTouch = { host, session };
    const source = fixture.bytes ? new Uint8Array(fixture.bytes) : fixture.text ? new TextEncoder().encode(fixture.text)
      : new Uint8Array(await (await fetch(new URL(`samples/${fixture.file}`, location.href))).arrayBuffer());
    await session.load(source, { route: fixture.extension === '360v' ? { family: 'panorama-video' } : undefined, descriptor: {
      source, extension: fixture.extension, name: `touch.${fixture.extension}`,
      contentType: fixture.contentType ?? (['svg', 'pano'].includes(fixture.extension) ? 'image/svg+xml' : undefined)
    } });
  }, { moduleUrl, fixture });
  await expect(page.locator(fixture.selector)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).mobileTouch.session.getState().loading)).toBe(false);
}

for (const fixture of scalable) {
  test(`${fixture.name}: native pinch zoom changes content and keeps browser zoom stable`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Multi-touch injection uses Chromium DevTools.');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await prepare(page, fixture);
    const initial = await page.evaluate(() => (window as any).mobileTouch.session.getState().scale);
    const imageWidth = fixture.name === 'image' ? (await page.locator('img').boundingBox())!.width : undefined;
    const cdp = await page.context().newCDPSession(page);
    const fingers = (spread: number) => [{ id: 1, x: 195 - spread, y: 300 }, { id: 2, x: 195 + spread, y: 300 }];
    await touch(page, cdp, 'touchStart', fingers(40));
    await touch(page, cdp, 'touchMove', fingers(60));
    await touch(page, cdp, 'touchMove', fingers(80));
    await expect.poll(() => page.evaluate(() => (window as any).mobileTouch.session.getState().scale)).toBeCloseTo(initial * 2);
    if (imageWidth) expect((await page.locator('img').boundingBox())!.width).toBeCloseTo(imageWidth * 2, 0);
    await touch(page, cdp, 'touchMove', fingers(40));
    await expect.poll(() => page.evaluate(() => (window as any).mobileTouch.session.getState().scale)).toBeCloseTo(initial);
    await touch(page, cdp, 'touchEnd', []);
    expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).mobileTouch.session.destroy());
  });
}

test('image, CAD and panorama: single-finger drag resumes after a pinch is lifted or cancelled', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch injection uses Chromium DevTools.');
  for (const fixture of scalable.filter(fixture => ['image', 'CAD', 'panorama'].includes(fixture.name))) {
    await prepare(page, fixture);
    const cdp = await page.context().newCDPSession(page);
    const transform = () => fixture.name === 'panorama'
      ? page.locator('.panoramav-canvas').evaluate(canvas => {
        const image = (canvas as HTMLCanvasElement).toDataURL();
        let hash = 0;
        for (let index = 0; index < image.length; index++) hash = (hash * 31 + image.charCodeAt(index)) | 0;
        return hash;
      })
      : page.locator(fixture.name === 'image' ? 'img' : '.cadv-canvas').getAttribute('style');
    const before = await transform();
    await touch(page, cdp, 'touchStart', [{ id: 1, x: 150, y: 300 }]);
    await touch(page, cdp, 'touchMove', [{ id: 1, x: 170, y: 310 }]);
    expect(await transform()).not.toBe(before);
    await touch(page, cdp, 'touchStart', [{ id: 1, x: 170, y: 310 }, { id: 2, x: 250, y: 310 }]);
    await touch(page, cdp, 'touchMove', [{ id: 1, x: 170, y: 310 }, { id: 2, x: 290, y: 310 }]);
    await touch(page, cdp, 'touchEnd', [{ id: 2, x: 290, y: 310 }]);
    const pinched = await transform();
    await touch(page, cdp, 'touchMove', [{ id: 1, x: 190, y: 310 }]);
    expect(await transform()).not.toBe(pinched);
    await touch(page, cdp, 'touchCancel', []);
    await page.evaluate(() => (window as any).mobileTouch.session.destroy());
  }
});

test('image: off-center pinch and wheel keep the image point beneath the gesture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch injection uses Chromium DevTools.');
  await prepare(page, scalable.find(fixture => fixture.name === 'image')!);
  const image = page.locator('img.pptxv-native-image');
  const anchor = { x: 130, y: 400 };
  const position = () => image.evaluate((image, point) => {
    const rect = image.getBoundingClientRect();
    return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height };
  }, anchor);
  const initial = await position();
  const cdp = await page.context().newCDPSession(page);
  const fingers = (spread: number) => [{ id: 1, x: anchor.x - spread, y: anchor.y }, { id: 2, x: anchor.x + spread, y: anchor.y }];
  await touch(page, cdp, 'touchStart', fingers(30));
  await touch(page, cdp, 'touchMove', fingers(45));
  await touch(page, cdp, 'touchMove', fingers(60));
  await touch(page, cdp, 'touchEnd', []);
  expect((await position()).x).toBeCloseTo(initial.x, 2);
  expect((await position()).y).toBeCloseTo(initial.y, 2);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => (window as any).mobileTouch.session.getState().scale)).toBeGreaterThan(2);
  expect((await position()).x).toBeCloseTo(initial.x, 2);
  expect((await position()).y).toBeCloseTo(initial.y, 2);
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
});

const readable: TouchFixture[] = [
  ...scalable.filter(fixture => ['PDF', 'PPTX', 'Keynote', 'Pages', 'diagram', 'mindmap'].includes(fixture.name)),
  { name: 'Word', pkg: 'docx', factory: 'createDocxPreviewDriver', extension: 'docx', file: 'filens-aurora-guide.docx', selector: '.docxv-preview' },
  { name: 'CSV', pkg: 'xlsx', factory: 'createXlsxPreviewDriver', extension: 'csv', text: Array.from({ length: 300 }, (_, row) => Array.from({ length: 15 }, (_, col) => `Row ${row} column ${col}`).join(',')).join('\n'), selector: '.xlsxv-grid' },
  { name: 'text', pkg: 'core', factory: 'createTextPreviewDriver', extension: 'txt', text: Array.from({ length: 300 }, (_, i) => `Line ${i}: mobile reading`).join('\n'), selector: '.pptxv-native-preview--text' },
  { name: 'code', pkg: 'core', factory: 'createTextPreviewDriver', extension: 'ts', text: Array.from({ length: 300 }, (_, i) => `const value${i} = ${i};`).join('\n'), selector: '.pptxv-native-preview--text' }
];

for (const fixture of readable) {
  test(`${fixture.name}: single-finger reading scroll remains native`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Touch movement injection uses Chromium DevTools.');
    await prepare(page, fixture);
    await page.evaluate(() => (window as any).mobileTouch.session.setScale?.(2));
    const viewport = page.locator(fixture.selector);
    const { horizontal, start } = await viewport.evaluate(element => {
      const horizontal = element.scrollHeight <= element.clientHeight && element.scrollWidth > element.clientWidth;
      element.style.scrollBehavior = 'auto';
      if (horizontal) element.scrollLeft = 100; else element.scrollTop = 100;
      return { horizontal, start: horizontal ? element.scrollLeft : element.scrollTop };
    });
    const cdp = await page.context().newCDPSession(page);
    const finger = (distance: number) => ({ id: 1, x: horizontal ? 320 - distance : 180, y: horizontal ? 400 : 500 - distance });
    await touch(page, cdp, 'touchStart', [finger(0)]);
    for (const distance of [60, 150, 250]) await touch(page, cdp, 'touchMove', [finger(distance)]);
    await touch(page, cdp, 'touchEnd', []);
    await expect.poll(() => viewport.evaluate((element, horizontal) => horizontal ? element.scrollLeft : element.scrollTop, horizontal)).toBeGreaterThan(start + 10);
    await page.evaluate(() => (window as any).mobileTouch.session.destroy());
  });
}

test('spreadsheet tabs and diagram nodes remain tappable', async ({ page }) => {
  const workbook: TouchFixture = { name: 'Numbers', pkg: 'iwork', factory: 'createIworkPreviewDriver', extension: 'numbers', file: 'a.numbers', selector: '.xlsxv-grid' };
  await prepare(page, workbook);
  const tabs = page.locator('.xlsxv-sheet-tab, .iworkv-sheet-tab');
  expect(await tabs.count()).toBeGreaterThan(1);
  await tabs.nth(1).tap();
  expect(await page.evaluate(() => (window as any).mobileTouch.session.getState().activeSheetIndex)).toBe(1);
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
  const diagram = scalable.find(fixture => fixture.name === 'diagram')!;
  await prepare(page, diagram);
  await page.locator('.diagramv-node').first().tap();
  expect(await page.evaluate(() => (window as any).mobileTouch.session.getState().selectedElementId)).toBeTruthy();
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
});

test('HTML and EPUB: links and chapters remain usable during touch reading', async ({ page, browserName }) => {
  const text = '<html><body><a href="#end">Go to end</a>' + '<p>Mobile reading content</p>'.repeat(150) + '<h1 id="end">The end</h1></body></html>';
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file('book.opf', '<package><metadata><title>Touch book</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file('one.xhtml', text); zip.file('two.xhtml', '<html><body><h1>Second chapter</h1></body></html>');
  const fixtures: TouchFixture[] = [
    { name: 'HTML', pkg: 'core', factory: 'createHtmlPreviewDriver', extension: 'html', text, selector: '.pptxv-native-html-frame', contentType: 'text/html' },
    { name: 'EPUB', pkg: 'ebook', factory: 'createEbookPreviewDriver', extension: 'epub', bytes: [...await zip.generateAsync({ type: 'uint8array' })], selector: '.ebookv-frame' }
  ];
  for (const fixture of fixtures) {
    await prepare(page, fixture);
    const frame = page.locator('iframe');
    await expect(page.frameLocator('iframe').getByRole('link', { name: 'Go to end' })).toBeVisible();
    await page.frameLocator('iframe').getByRole('link', { name: 'Go to end' }).tap();
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'The end' })).toBeInViewport();
    await frame.evaluate(frame => { (frame as HTMLIFrameElement).contentDocument!.scrollingElement!.scrollTop = 0; });
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await touch(page, cdp, 'touchStart', [{ id: 1, x: 180, y: 500 }]);
      await touch(page, cdp, 'touchMove', [{ id: 1, x: 180, y: 350 }]);
      await touch(page, cdp, 'touchEnd', []);
      await expect.poll(() => frame.evaluate(frame => (frame as HTMLIFrameElement).contentDocument!.scrollingElement!.scrollTop)).toBeGreaterThan(10);
    }
    if (fixture.name === 'EPUB') {
      await page.locator('.ebookv-chapter-tab').nth(1).tap();
      await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Second chapter' })).toBeVisible();
    }
    await page.evaluate(() => (window as any).mobileTouch.session.destroy());
  }
});

test('archive folders remain tappable', async ({ page }) => {
  const zip = new JSZip(); zip.file('docs/readme.txt', 'Mobile archive content');
  await prepare(page, {
    name: 'ZIP', pkg: 'archive', factory: 'createArchivePreviewDriver', extension: 'zip',
    bytes: [...await zip.generateAsync({ type: 'uint8array' })], selector: '.archivev-table'
  });
  await page.locator('.archivev-row').filter({ hasText: 'docs/' }).tap();
  await expect(page.locator('.archivev-table')).toContainText('readme.txt');
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
});

test('demo upload lets diagram and mindmap SVG nodes receive touch taps', async ({ page }) => {
  await page.goto('./?view=preview');
  for (const fixture of [
    { extension: 'drawio', content: createDrawioFixture(2), selector: '.diagramv-node' },
    { extension: 'opml', content: '<opml version="2.0"><body><outline text="Root"><outline text="Touch node"/></outline></body></opml>', selector: '.mindmapv-node' }
  ]) {
    await page.locator('input[type=file]').setInputFiles({
      name: `touch.${fixture.extension}`, mimeType: 'application/xml', buffer: Buffer.from(fixture.content)
    });
    const node = page.locator(fixture.selector).last();
    await expect(node).toBeVisible();
    await node.tap();
    await expect(node).toHaveClass(/is-selected/);
  }
});

test('audio playback controls remain tappable', async ({ page }) => {
  const bytes = Buffer.alloc(44 + 16000 * 2 * 10);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  await prepare(page, {
    name: 'audio', pkg: 'core', factory: 'createMediaPreviewDriver', extension: 'wav',
    bytes: [...bytes], contentType: 'audio/wav', selector: 'audio'
  });
  await page.locator('.pptxv-audio-play').tap();
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).paused)).toBe(false);
  await page.locator('.pptxv-audio-play').tap();
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).paused)).toBe(true);
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
});

test('native video playback controls remain tappable', async ({ page }) => {
  await prepare(page, {
    name: 'video', pkg: 'core', factory: 'createMediaPreviewDriver', extension: 'mp4',
    file: 'sample-video.mp4', contentType: 'video/mp4', selector: 'video'
  });
  const video = page.locator('video');
  await page.getByRole('button', { name: 'Play video', exact: true }).tap();
  await expect.poll(() => video.evaluate(video => (video as HTMLVideoElement).paused)).toBe(false);
  await page.evaluate(() => (window as any).mobileTouch.session.destroy());
});
