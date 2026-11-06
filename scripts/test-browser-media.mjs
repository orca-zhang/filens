// Real browser codecs and MSE; only an ordinary static/Range fixture server.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = mkdtempSync(path.join(tmpdir(), 'filens-browser-media-'));
let server;
const reports = [];
try {
  const file = path.join(directory, 'original.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '20', '-c:v', 'libx264', '-threads', '2',
    '-g', '300', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', file]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-c', 'copy', '-f', 'hls', '-hls_time', '2',
    '-hls_list_size', '0', '-hls_segment_type', 'fmp4', '-hls_segment_filename', path.join(directory, 'segment%03d.m4s'),
    path.join(directory, 'playlist.m3u8')]);
  const fragmented = { init: readFileSync(path.join(directory, 'init.mp4')).toString('base64'),
    segments: readdirSync(directory).filter(name => name.endsWith('.m4s')).sort()
      .map(name => readFileSync(path.join(directory, name)).toString('base64')) };
  const vp9File = path.join(directory, 'vp9.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
    '-t', '5', '-c:v', 'libvpx-vp9', '-threads', '2', '-deadline', 'realtime', '-cpu-used', '8', '-g', '30', '-movflags', '+faststart', vp9File]);
  const vp9Bytes = readFileSync(vp9File);
  const bytes = readFileSync(file), total = 9 * 1024 ** 3;
  let bytesServed = 0;
  server = await createServer({ configFile: false, root, logLevel: 'error', optimizeDeps: { entries: ['packages/media/test/browser.html'] }, server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'media-range-fixture', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (!['/original.mp4', '/huge.mp4', '/ignored.mp4', '/vp9.mp4'].includes(request.url)) return next();
        const sourceBytes = request.url === '/vp9.mp4' ? vp9Bytes : bytes;
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
        const huge = request.url === '/huge.mp4';
        const size = huge ? total : sourceBytes.length;
        const start = match ? +match[1] : 0;
        const end = Math.min(size - 1, match?.[2] ? +match[2] : sourceBytes.length - 1);
        const ignored = request.url === '/ignored.mp4';
        if (ignored) { response.writeHead(200, { 'Content-Type': 'video/mp4' }); response.end(bytes); return; }
        if (start > end) { response.writeHead(416); response.end(); return; }
        const data = Buffer.alloc(end - start + 1); sourceBytes.copy(data, 0, start, Math.min(end + 1, sourceBytes.length));
        response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': data.length,
          'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', ETag: '"v1"' });
        bytesServed += data.length; response.end(data);
      });
    } }] });
  await server.listen(); const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const name of (process.env.BROWSERS ?? 'chromium').split(',')) {
    const browser = await ({ chromium, firefox, webkit })[name].launch({ headless: true,
      ...(name === 'chromium' ? { channel: process.env.FILENS_MEDIA_TEST_BROWSER ?? 'chrome' } : {}) });
    try {
      const context = await browser.newContext(); const page = await context.newPage();
      const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(`${origin}/packages/media/test/browser.html`);
      await page.waitForFunction(() => window.filensMedia);
      const direct = await page.evaluate(async () => {
        const api = window.filensMedia;
        const nativeEncoder = window.VideoEncoder, nativeDecoder = window.VideoDecoder;
        let codecs = 0, fetches = 0;
        if (nativeEncoder) window.VideoEncoder = new Proxy(nativeEncoder, { construct(target, args) { codecs++; return Reflect.construct(target, args); } });
        if (nativeDecoder) window.VideoDecoder = new Proxy(nativeDecoder, { construct(target, args) { codecs++; return Reflect.construct(target, args); } });
        const fetch = window.fetch; window.fetch = (...args) => { fetches++; return fetch(...args); };
        const session = api.createMediaPreviewDrivers({ browserMedia: true }).find(driver => driver.id === 'media').createSession(document.querySelector('#host'));
        try {
          const ready = new Promise((resolve, reject) => { session.on('rendered', resolve); session.on('error', reject); });
          await session.load('/original.mp4', { descriptor: { source: '/original.mp4', name: 'original.mp4', extension: 'mp4' } });
          await ready; const video = document.querySelector('#host video'); video.muted = true; await video.play();
          await new Promise(resolve => setTimeout(resolve, 350));
          return { codecs, fetches, width: video.videoWidth, time: video.currentTime };
        } finally { session.destroy(); window.VideoEncoder = nativeEncoder; window.VideoDecoder = nativeDecoder; window.fetch = fetch; }
      });
      assert.equal(direct.codecs, 0); assert.equal(direct.fetches, 0); assert.ok(direct.width > 0 && direct.time > 0);
      const durations = await page.evaluate(async fragmented => {
        const api = window.filensMedia;
        const input = api.createBrowserMediaSource('/original.mp4');
        const { format } = await new api.MediaFormatInspector().openMp4(input);
        input.close();
        const total = Math.max(format.duration || 0, ...format.tracks.map(track => track.duration));
        const mime = `video/mp4; codecs="${format.tracks.map(track => track.codec).join(', ')}"`;
        const reports = [];
        for (const metadata of [true, false]) {
          const source = new MediaSource();
          const url = URL.createObjectURL(source);
          const session = api.createMediaPreviewDrivers().find(driver => driver.id === 'media')
            .createSession(document.querySelector('#host'));
          const observed = [];
          session.on('statechange', state => observed.push(state.duration));
          try {
            const opened = new Promise(resolve => source.addEventListener('sourceopen', resolve, { once: true }));
            await session.load(url, { descriptor: { source: url, name: 'progressive.mp4', extension: 'mp4',
              ...(metadata ? { durationSeconds: total } : {}) } });
            await opened;
            if (!metadata) source.duration = Infinity;
            const buffer = source.addSourceBuffer(mime);
            const append = data => new Promise((resolve, reject) => {
              buffer.addEventListener('updateend', resolve, { once: true });
              buffer.addEventListener('error', reject, { once: true });
              buffer.appendBuffer(Uint8Array.from(atob(data), byte => byte.charCodeAt(0)));
            });
            const ready = new Promise(resolve => session.on('rendered', resolve));
            await append(fragmented.init);
            await append(fragmented.segments[0]);
            await ready;
            // Emulate a producer reporting only the completed fragment length.
            if (metadata) source.duration = Math.ceil(buffer.buffered.end(0) + 1);
            const video = document.querySelector('#host video');
            const timeline = document.querySelector('#host .pptxv-video-timeline');
            const preparing = session.getState().duration;
            const disabledWhilePreparing = timeline.disabled;
            const partial = video.duration;
            video.muted = true;
            document.querySelector('#host .pptxv-video-control-row button').click();
            const deadline = performance.now() + 5000;
            while (video.currentTime < .1 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
            if (video.currentTime < .1) throw new Error('Progressive video failed to play');
            document.querySelector('#host .pptxv-video-control-row button').click();
            for (const segment of fragmented.segments.slice(1)) await append(segment);
            source.endOfStream();
            await new Promise(resolve => setTimeout(resolve, 100));
            timeline.value = '15'; timeline.dispatchEvent(new Event('change'));
            await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
            const seek = video.currentTime;
            reports.push({ metadata, total, partial, preparing, disabledWhilePreparing, duration: session.getState().duration,
              max: Number(timeline.max), seek, paused: video.paused, observed });
          } finally { session.destroy(); URL.revokeObjectURL(url); }
        }
        return reports;
      }, fragmented);
      for (const result of durations) {
        if (result.metadata) { assert.ok(result.partial < result.total - 1, JSON.stringify(result)); assert.equal(result.preparing, result.total); }
        else { assert.equal(result.partial, Infinity); assert.equal(result.preparing, undefined); assert.equal(result.disabledWhilePreparing, true); }
        assert.ok(Math.abs(result.duration - result.total) < .1, JSON.stringify(result));
        assert.ok(Math.abs(result.max - result.total) < .1);
        assert.ok(Math.abs(result.seek - 15) < .1); assert.equal(result.paused, true);
        assert.ok(result.observed.every(value => value === undefined || Math.abs(value - result.total) < .1), JSON.stringify(result));
      }
      console.log(`${name}: original total stays stable during progressive MSE appends; unknown total resolves on completion`);
      const recovery = [];
      for (const paused of [true, false]) recovery.push(await page.evaluate(async paused => {
        const session = window.filensMedia.createMediaPreviewDrivers({ browserMedia: true }).find(driver => driver.id === 'media').createSession(document.querySelector('#host'));
        try {
          const nativeReady = new Promise((resolve, reject) => { session.on('rendered', resolve); session.on('error', reject); });
          await session.load('/original.mp4', { descriptor: { source: '/original.mp4', name: 'remux.mov', extension: 'mov' } });
          await nativeReady;
          const original = document.querySelector('#host video');
          original.volume = .35; original.muted = true; original.playbackRate = 1.5;
          const sought = new Promise(resolve => original.addEventListener('seeked', resolve, { once: true }));
          original.currentTime = 6; await sought;
          if (!paused) await original.play();
          const startTime = original.currentTime;
          const at = performance.now();
          const ready = new Promise((resolve, reject) => { session.on('rendered', resolve); session.on('error', reject); });
          // Deterministically emulate rejection of the original container, then use real demux + MSE.
          document.querySelector('#host source').dispatchEvent(new Event('error'));
          await ready;
          const video = document.querySelector('#host video');
          // A frame can render while recovery still prepares autoplay.
          const deadline = performance.now() + 5000;
          while (video.paused !== paused && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
          return { width: video.videoWidth, src: video.currentSrc, firstFrameMs: performance.now() - at,
            startTime, time: video.currentTime, paused: video.paused, volume: video.volume, muted: video.muted, rate: video.playbackRate };
        } finally { session.destroy(); }
      }, paused));
      for (const [index, result] of recovery.entries()) {
        assert.equal(result.width, 640); assert.ok(result.src.startsWith('blob:'));
        assert.equal(result.paused, index === 0); assert.equal(result.volume, .35); assert.equal(result.muted, true); assert.equal(result.rate, 1.5);
        assert.ok(Math.abs(result.time - result.startTime) < .5, JSON.stringify(result));
      }
      const transcoding = await page.evaluate(async () => {
        if (!window.VideoEncoder || !window.VideoDecoder) return { unsupported: 'WebCodecs unavailable' };
        const support = MediaSource.isTypeSupported;
        MediaSource.isTypeSupported = function(mime) { return /vp09/.test(mime) ? false : support.call(this, mime); };
        const video = document.querySelector('#video'), errors = [], measurements = [];
        let session;
        try {
          const at = performance.now();
          session = await window.filensMedia.recoverBrowserVideo('/vp9.mp4', video, { autoplay: true,
            onError: error => errors.push(String(error)), onMetrics: metrics => measurements.push(metrics) });
          await new Promise(resolve => setTimeout(resolve, 500));
          const result = { width: video.videoWidth, time: video.currentTime, readyAndPlaybackMs: performance.now() - at, errors, measurements };
          return result;
        } catch (error) { return { error: String(error), errors }; }
        finally { MediaSource.isTypeSupported = support; await session?.close(); }
      });
      if (!transcoding.unsupported) {
        assert.ok(!transcoding.error, JSON.stringify(transcoding)); assert.equal(transcoding.width, 640);
        assert.ok(transcoding.time > 0, JSON.stringify(transcoding)); assert.deepEqual(transcoding.errors, []);
      }
      const ranged = await page.evaluate(async () => {
        const api = window.filensMedia, video = document.querySelector('#video'), reads = [], errors = [];
        const fetch = (url, options) => { reads.push(options.headers.Range); return window.fetch(url, options); };
        const at = performance.now(); const session = await api.recoverBrowserVideo('/huge.mp4', video, { fetch, autoplay: true, onError: error => errors.push(String(error)) });
        await new Promise(resolve => setTimeout(resolve, 350)); const readyAndPlaybackMs = performance.now() - at;
        video.pause(); video.volume = .4; video.playbackRate = 1.5;
        for (const time of [12, 3, 16]) { await session.seek(time, false); await new Promise(resolve => setTimeout(resolve, 150)); }
        const result = { readyAndPlaybackMs, time: video.currentTime, width: video.videoWidth, paused: video.paused,
          volume: video.volume, rate: video.playbackRate, reads: reads.length,
          maxRead: Math.max(...reads.map(range => { const [start, end] = range.slice(6).split('-').map(Number); return end - start + 1; })), errors };
        await session.close(); result.released = !video.getAttribute('src'); return result;
      });
      assert.equal(ranged.width, 640); assert.ok(ranged.time >= 16 && ranged.time < 16.5, JSON.stringify(ranged));
      assert.equal(ranged.paused, true); assert.equal(ranged.volume, .4); assert.equal(ranged.rate, 1.5);
      assert.ok(ranged.maxRead <= 1024 ** 2); assert.equal(ranged.released, true); assert.deepEqual(ranged.errors, []);
      // All optional media modules are now warm. A local Blob plays with browser networking disabled.
      await page.evaluate(async () => { window.localVideo = new File([await (await fetch('/original.mp4')).arrayBuffer()], 'offline.mp4', { type: 'video/mp4' }); });
      const offlineBlock = route => route.abort();
      if (name === 'webkit') await page.route('**/*', offlineBlock);
      else await context.setOffline(true);
      const offline = await page.evaluate(async () => {
        const api = window.filensMedia; let requests = 0;
        const fetch = window.fetch; window.fetch = () => { requests++; throw new Error('Offline preview attempted a request'); };
        const video = document.querySelector('#video'); const at = performance.now();
        try {
          const session = await api.recoverBrowserVideo(window.localVideo, video, { autoplay: true });
          await video.play();
          const deadline = performance.now() + 5000;
          while (video.currentTime < .05 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          const result = { requests, time: video.currentTime, width: video.videoWidth, readyAndPlaybackMs: performance.now() - at };
          await session.close(); return result;
        } finally { window.fetch = fetch; }
      });
      assert.equal(offline.requests, 0); assert.ok(offline.width > 0 && offline.time > 0, JSON.stringify(offline));
      if (name === 'webkit') await page.unroute('**/*', offlineBlock);
      else await context.setOffline(false);
      const rejectedRange = await page.evaluate(async () => {
        try { await window.filensMedia.recoverBrowserVideo('/ignored.mp4', document.querySelector('#video')); return ''; }
        catch (error) { return error.message; }
      });
      assert.match(rejectedRange, /Range/);
      const benchmarks = (process.env.FILENS_MEDIA_BENCH === '1' || process.argv.includes('--bench')) ? await page.evaluate(async () => {
        const results = [];
        for (const [width, height, framerate] of [[1920,1080,30], [1920,1080,60], [2560,1440,60], [3840,2160,30]]) {
          const config = { codec: 'avc1.640033', width, height, framerate, bitrate: 6000000, latencyMode: 'realtime', hardwareAcceleration: 'prefer-hardware' };
          const result = await new window.filensMedia.HardwareAccelerationProbe().run(config, { frames: 30, timeoutMs: 15000 });
          results.push({ config, result });
        }
        return results;
      }) : [];
      assert.deepEqual(pageErrors, []);
      reports.push({ browser: name, version: browser.version(), direct, durations, recovery, transcoding, ranged, offline, rejectedRange, benchmarks,
        bytesServed, fixtureBytes: statSync(file).size, virtualRangeBytes: total, hardwareExecution: 'unknown' });
      writeFileSync(process.env.FILENS_MEDIA_RESULTS ?? path.join(tmpdir(), 'filens-browser-media-results.json'), `${JSON.stringify(reports, null, 2)}\n`);
      console.log(`${name}: native, bounded Range, forward/backward paused seeking, offline Blob and cleanup passed`);
    } finally { await browser.close(); }
  }
  const output = process.env.FILENS_MEDIA_RESULTS ?? path.join(tmpdir(), 'filens-browser-media-results.json');
  writeFileSync(output, `${JSON.stringify(reports, null, 2)}\n`); console.log(`Report: ${output}`);
} finally { await server?.close(); rmSync(directory, { recursive: true, force: true }); }
