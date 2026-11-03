import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'filens-standalone-media-'));
const results = [];
let server, browser;
try {
  const fixture = path.join(temporary, 'original.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '4',
    '-c:v', 'libx264', '-threads', '2', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
  server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      const mode = url.searchParams.get('mode');
      if (!['split', 'all-in-one'].includes(mode)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', 'text/html');
      response.end(`<input id="file" type="file"><div id="preview"></div><script type="module">
        import { createPreview } from '/${mode}/filens.js';
        let viewer; window.conversions = 0;
        document.querySelector('#file').onchange = event => {
          viewer?.destroy(); document.body.dataset.state='loading';
          const file = event.target.files[0];
          viewer = createPreview('#preview', { src: file, name: file.name, browserMedia: true,
            mediaConverter: { convert() { window.conversions++; throw new Error('Conversion service must not run'); } },
            onRendered: () => { document.body.dataset.state='ready'; },
            onError: error => { document.body.dataset.state='error'; document.body.dataset.error=error.message; }
          });
          window.destroyPreview = () => viewer.destroy();
        }; window.ready = true;
      </script>`); return;
    }
    const relative = url.pathname.slice(1);
    if (!/^(split|all-in-one)\//.test(relative) || relative.split('/').includes('..')) { response.writeHead(404); response.end(); return; }
    try {
      response.setHeader('Content-Type', relative.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      response.end(readFileSync(path.join(root, 'packages/preview/dist', relative)));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: process.env.FILENS_MEDIA_TEST_BROWSER ?? 'chrome' });
  for (const mode of ['split', 'all-in-one']) {
    const page = await browser.newPage(); const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url(); requests.push(url);
      return url.startsWith(origin) ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/?mode=${mode}`); await page.waitForFunction(() => window.ready);
    await page.locator('#file').setInputFiles({ name: 'original.mov', mimeType: 'video/quicktime', buffer: readFileSync(fixture) });
    await expect(page.locator('#preview source')).toHaveCount(1);
    await page.locator('#preview source').evaluate(source => {
      document.body.dataset.state = 'recovering'; source.dispatchEvent(new Event('error'));
    });
    await expect.poll(() => page.locator('body').getAttribute('data-state'), { timeout: 20000 }).toBe('ready');
    const result = await page.locator('#preview video').evaluate(async video => {
      video.muted = true; await video.play(); await new Promise(resolve => setTimeout(resolve, 350));
      return { width: video.videoWidth, time: video.currentTime, source: video.currentSrc, conversions: window.conversions };
    });
    assert.equal(result.width, 320); assert.ok(result.time > 0); assert.ok(result.source.startsWith('blob:'));
    assert.equal(result.conversions, 0); assert.deepEqual(errors, []);
    assert.ok(!requests.some(url => /media_info|libheif\.wasm|converter-.*\.wasm/.test(url)));
    await page.evaluate(() => window.destroyPreview()); await expect(page.locator('#preview video')).toHaveCount(0);
    results.push({ mode, ...result, requests: requests.length });
    console.log(`${mode}: public createPreview(browserMedia: true), local remux and cleanup passed`);
    await page.close();
  }
  writeFileSync(process.env.FILENS_MEDIA_STANDALONE_RESULTS ?? path.join(tmpdir(), 'filens-browser-media-standalone.json'), `${JSON.stringify(results, null, 2)}\n`);
} finally { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); rmSync(temporary, { recursive: true, force: true }); }
