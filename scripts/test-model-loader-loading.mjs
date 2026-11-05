// Exercise actual standalone builds: lazy loading, cancellation and complete rendered pixels.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createBinaryStlFixture } from '../packages/model3d/test/fixtures/mesh.mjs';
import { createFbxFixture, create3dsFixture } from '../packages/model3d/test/fixtures/legacy-models.mjs';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a saved preview dist directory.');
const builds = { current: path.resolve('packages/preview/dist'), ...(baseline ? { baseline: path.resolve(baseline) } : {}) };
const variantsIndex = process.argv.indexOf('--variants');
const variants = variantsIndex < 0 ? ['split', 'all-in-one'] : process.argv[variantsIndex + 1]?.split(',');
assert(variants?.length && variants.every(value => ['split', 'all-in-one'].includes(value)), '--variants must contain split and/or all-in-one.');
const vrml = [...new TextEncoder().encode(`#VRML V2.0 utf8
Transform { translation 0.25 0 0 children [
  Shape { appearance Appearance { material Material { diffuseColor 0.2 0.6 0.9 } } geometry Box { size 2 1 1 } }
  Shape { appearance Appearance { material Material { diffuseColor 0.8 0.3 0.2 } }
    geometry IndexedFaceSet { coord Coordinate { point [ -1 1 0, 1 1 0, 0 2 0 ] } coordIndex [ 0, 1, 2, -1 ] solid FALSE } }
] }
`)];
const formats = [
  { engine: 'vrml', bytes: vrml, extensions: ['wrl', 'vrml'], triangles: 13 },
  { engine: 'fbx', bytes: [...createFbxFixture()], extensions: ['fbx', 'fbx'], triangles: 4 },
  { engine: '3ds', bytes: [...create3dsFixture()], extensions: ['3ds', '3ds'], triangles: 4 }
];
const browser = await chromium.launch(), reports = [], pixels = new Map();
try {
  for (const [name, root] of Object.entries(builds)) for (const variant of variants) for (const format of formats) {
    const engineChunk = new RegExp(`/model-${format.engine}-`);
    const directory = path.join(root, variant), page = await browser.newPage(), errors = [], requested = [];
    let release, hold = false;
    const held = new Promise(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="host" style="width:800px;height:600px"></div>' });
      requested.push(pathname);
      if (hold && engineChunk.test(pathname)) await held;
      const file = path.resolve(directory, '.' + pathname); assert(file.startsWith(directory + path.sep));
      await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: await readFile(file) });
    });
    try {
      await page.goto('http://localhost/');
      await page.evaluate(async () => {
        const { createPreview } = await import('/filens.js'); window.previewErrors = [];
        window.viewer = createPreview('#host', { src: new TextEncoder().encode('Initial text'), name: 'initial.txt', toolbar: false,
          onRendered: state => { window.lastRendered = state; }, onError: error => window.previewErrors.push(error.message) });
      });
      await expect(page.locator('#host')).toContainText('Initial text');
      const open = async (bytes, file) => page.evaluate(({ bytes, file }) => window.viewer.update({ src: new Uint8Array(bytes), name: file }), { bytes, file });
      await open([...createBinaryStlFixture(3)], 'ordinary.stl');
      await expect.poll(() => page.evaluate(() => window.lastRendered?.title)).toBe('ordinary.stl');
      if (name === 'current') assert(!requested.some(file => /\/model-(?:vrml|fbx|3ds)-/.test(file)), 'Optional model engine loaded for text/STL.');
      hold = name === 'current' && variant === 'split';
      await open(format.bytes, `scene.${format.extensions[0]}`);
      if (hold) {
        await expect.poll(() => requested.filter(file => engineChunk.test(file)).length).toBe(1);
        await page.evaluate(() => window.viewer.update({ src: new TextEncoder().encode('Replacement text'), name: 'replacement.txt' }));
        await expect(page.locator('#host')).toContainText('Replacement text');
        hold = false; release(); await open(format.bytes, `scene.${format.extensions[0]}`);
      }
      const rendered = {};
      for (const [iteration, extension] of format.extensions.entries()) {
        if (iteration) await open(format.bytes, `reopened.${extension}`);
        await expect.poll(() => page.evaluate(() => window.lastRendered?.title)).toBe(`${iteration ? 'reopened' : 'scene'}.${extension}`);
        const metadata = await page.evaluate(() => window.lastRendered.metadata);
        assert.equal(metadata.triangleCount, format.triangles);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const screenshot = await page.locator('canvas.model3dv-canvas').screenshot();
        const image = await page.evaluate(async encoded => {
          const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob(), bitmap = await createImageBitmap(blob);
          try {
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
            const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set();
            for (let index = 0; index < rgba.length; index += 4) colors.add((rgba[index] << 16) | (rgba[index + 1] << 8) | rgba[index + 2]);
            const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))].map(value => value.toString(16).padStart(2, '0')).join('');
            return { width: bitmap.width, height: bitmap.height, colors: colors.size, rgbaSha256: hash };
          } finally { bitmap.close(); }
        }, screenshot.toString('base64'));
        assert(image.colors > 10, 'No actual WebGL geometry rendered.');
        const key = `${variant}:${format.engine}:${iteration}`; if (!pixels.has(key)) pixels.set(key, image);
        assert.deepEqual(image, pixels.get(key), `${name}/${key}: rendered pixels changed.`);
        rendered[`${iteration}:${extension}`] = { triangleCount: metadata.triangleCount, ...image };
      }
      if (name === 'current' && variant === 'split') assert.equal(requested.filter(file => engineChunk.test(file)).length, 1);
      assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
      await page.evaluate(() => window.viewer.destroy()); await expect(page.locator('#host')).toBeEmpty(); assert.deepEqual(errors, []);
      reports.push({ name, variant, format: format.engine, deferredForTextAndStl: name === 'current' && variant === 'split', cancelledDuringImport: name === 'current' && variant === 'split',
        engineChunks: requested.filter(file => engineChunk.test(file)), rendered, errors });
    } finally { release(); await page.close(); }
  }
  console.log(JSON.stringify({ browser: browser.version(), cases: reports }, null, 2));
} finally { await browser.close(); }
