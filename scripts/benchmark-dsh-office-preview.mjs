// Compare actual sidebar first-paint latency in the installed DSH Desktop app.
// node scripts/benchmark-dsh-office-preview.mjs --home /tmp/filens-dsh-demo-...
// The home must be an isolated capture profile with dsh-filens installed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchDesktop, prepareWorkspace } from './capture-dsh-plugin-demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--home');
assert.ok(index >= 0 && process.argv[index + 1], 'Pass the isolated capture profile with --home.');
const home = path.resolve(process.argv[index + 1]);
assert.notEqual(home, path.resolve(process.env.HOME, '.dsh'), 'Use an isolated test profile.');
const directory = path.join(home, 'Office Benchmark');
await mkdir(directory, { recursive: true });
const pdfOnly = process.argv.includes('--only-pdf');
const cases = pdfOnly ? [['filens-cosmic-atlas.pdf', 'Cosmic Atlas.pdf']] : [
  ['filens-field-notes.pptx', 'Field Notes.pptx'],
  ['filens-aurora-guide.docx', 'Aurora Guide.docx']
];
const documents = [];
for (const [source, name] of cases) {
  const data = await readFile(path.join(root, 'apps/demo/public/samples', source));
  await writeFile(path.join(directory, name), data);
  documents.push({ name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const baselineIndex = process.argv.indexOf('--baseline-home');
const baselineHome = baselineIndex >= 0 ? path.resolve(process.argv[baselineIndex + 1]) : undefined;
const roundsIndex = process.argv.indexOf('--rounds');
const rounds = roundsIndex >= 0 ? Number(process.argv[roundsIndex + 1]) : 3;
assert.ok(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 10);
const installed = JSON.parse(await readFile(path.join(home, 'profiles/desktop/node_modules/dsh-filens/package.json'), 'utf8'));
const renderers = [{ renderer: 'filens', home, plugin: `dsh-filens@${installed.version}` }];
if (baselineHome) {
  assert.notEqual(baselineHome, path.resolve(process.env.HOME, '.dsh'), 'Use an isolated baseline profile.');
  assert.notEqual(baselineHome, home, 'Use separate profiles for the two plugin versions.');
  const baseline = JSON.parse(await readFile(path.join(baselineHome, 'profiles/desktop/node_modules/dsh-filens/package.json'), 'utf8'));
  renderers.push({ renderer: 'previous', home: baselineHome, plugin: `dsh-filens@${baseline.version}` });
}
renderers.push({ renderer: 'builtin', home, plugin: pdfOnly ? 'DSH built-in PDF' : 'DSH built-in Office-to-PDF' });
const rendererIndex = process.argv.indexOf('--renderer');
if (rendererIndex >= 0) {
  const selected = renderers.filter(item => item.renderer === process.argv[rendererIndex + 1]);
  assert.equal(selected.length, 1, 'Choose an available renderer: filens, previous or builtin.');
  renderers.splice(0, renderers.length, ...selected);
}
const offsetIndex = process.argv.indexOf('--round-offset');
const roundOffset = offsetIndex >= 0 ? Number(process.argv[offsetIndex + 1]) : 0;
assert.ok(Number.isSafeInteger(roundOffset) && roundOffset >= 0 && roundOffset < 10);
const observations = [], environments = [];
const runtimeBuilds = await Promise.all(renderers.filter(item => item.renderer !== 'builtin').map(async item => ({
  renderer: item.renderer, plugin: item.plugin,
  entrySHA256: createHash('sha256').update(await readFile(path.join(item.home, 'profiles/desktop/node_modules/dsh-filens/lib/runtime/filens.js'))).digest('hex')
})));
for (let round = 0; round < rounds; round++) {
  const ordered = renderers.slice(round % renderers.length).concat(renderers.slice(0, round % renderers.length));
  for (const { renderer, home: profileHome, plugin } of ordered) {
    const { app, page } = await launchDesktop(profileHome, false);
    const setEnabled = async enabled => {
      await page.getByRole('button', { name: '插件', exact: true }).click();
      await page.getByText('FiLens 文档工具与预览', { exact: true }).first().click();
      const toggle = page.getByRole('switch', { name: '启用 FiLens 文档工具与预览', exact: true }).first();
      if (await toggle.getAttribute('aria-checked') !== String(enabled)) {
        await toggle.click();
        await page.getByText(enabled ? '2 运行中' : '2 已停用', { exact: false }).waitFor();
      }
    };
    try {
      environments.push(await app.evaluate(({ app }, data) => ({ ...data, dsh: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }), { renderer, plugin, round: round + roundOffset + 1 }));
      await setEnabled(renderer !== 'builtin');
      await page.reload();
      await page.waitForFunction(() => window.__DSH_DEMO_CTX__?.get('workspaces'));
      const sessionId = await prepareWorkspace(page, directory);
      const ready = async () => {
        if (renderer !== 'builtin') {
          await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready', null, { timeout: 65000 });
          const frame = page.frames().find(frame => frame.url().includes('/viewer.html')) ?? page;
          await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        } else {
          await page.locator('[data-pdf-page] [data-document-zoom-surface]:not([hidden]) canvas').first().waitFor({ state: 'visible', timeout: 65000 });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
      };
      for (const [, name] of cases) {
        const samplesMs = [];
        for (let attempt = 0; attempt < 4; attempt++) {
          const start = await page.evaluate(({ sessionId, name }) => {
            const start = performance.now();
            window.__DSH_DEMO_CTX__.get('sidebarRight').openResource(`dsh-resource://file/session/${sessionId}/${encodeURIComponent(name)}`);
            return start;
          }, { sessionId, name });
          await ready();
          samplesMs.push(Math.round(await page.evaluate(start => performance.now() - start, start)));
          await page.evaluate(() => {
            const sidebar = window.__DSH_DEMO_CTX__.get('sidebarRight');
            sidebar.close(sidebar.active().id);
          });
          await page.locator(renderer !== 'builtin' ? '.filens-dsh' : '[data-pdf-page]').first().waitFor({ state: 'hidden' });
        }
        const warm = samplesMs.slice(1).sort((a, b) => a - b);
        observations.push({ renderer, plugin, round: round + roundOffset + 1, name, firstMs: samplesMs[0], cachedMedianMs: warm[1], samplesMs });
        console.log(JSON.stringify(observations.at(-1)));
      }
      if (renderer === 'builtin') await setEnabled(true);
    } finally { await app.close(); }
  }
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const results = renderers.flatMap(({ renderer, plugin }) => cases.map(([, name]) => {
  const runs = observations.filter(item => item.renderer === renderer && item.name === name);
  return { renderer, plugin, name, firstMs: median(runs.map(item => item.firstMs)),
    cachedMedianMs: median(runs.flatMap(item => item.samplesMs.slice(1))),
    freshProcessSamplesMs: runs.map(item => item.firstMs), cachedSamplesMs: runs.flatMap(item => item.samplesMs.slice(1)) };
}));
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(root, `docs/assets/dsh-plugin/${pdfOnly ? 'pdf' : 'office'}-preview-benchmark.json`);
await writeFile(output, JSON.stringify({
  measuredAt: new Date().toISOString(), machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryBytes: os.totalmem(), osRelease: os.release(), node: process.versions.node }, plugin: `dsh-filens@${installed.version}`, rounds, runtimeBuilds, environments, documents,
  method: `A fresh DSH process per renderer in each round, rotating renderer order between rounds. In the same workspace, open ${pdfOnly ? 'the PDF' : 'PPTX then DOCX'}, four times each, closing the document tab between opens. Timing starts immediately before sidebar.openResource and ends after ready content and two animation frames. Builtin uses ${pdfOnly ? 'its native PDF preview and visible PDF canvas, with no Office conversion' : 'the actual Office-to-PDF service and PDF canvas'}; Plugin timings wait for their actual ready content (a direct DOM viewer or an iframe in older packages). No model calls.`,
  cache: `First is the median of the first opening of each file in each fresh process; ${pdfOnly ? 'PDF is the first document opened in that process' : 'the engine may be warm for DOCX after PPTX'}. Cached median pools the next three opens per process. OS filesystem and persistent application caches are not cleared. Timing includes document reads, conversion/parsing and frontend rendering, not application startup.`,
  limits: `${pdfOnly ? 'One authored PDF' : 'Two small authored files'} on one macOS arm64 machine. This measures latency, not fidelity; results are not a guarantee for other files or platforms. The edited walkthrough GIF is not benchmark evidence.`,
  results, observations
}, null, 2) + '\n');
