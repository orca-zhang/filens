// Inspect actual npm tarballs, resolve public paths and exercise packed code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[i + 1];
};
const baseline = option('--baseline', 'tmp/shared-readers-baseline');
const packages = option('--packages', 'tmp/shared-readers-current');
const output = option('--output', 'tmp/shared-readers-current/packages.json');
await mkdir('tmp', { recursive: true });
const temporary = await mkdtemp(path.resolve('tmp/shared-reader-package-'));
const result = {};
const bytes = zipSync({ 'docs/中文.txt': strToU8('中文 & bytes'), 'docs/empty.bin': new Uint8Array(),
  'images/a..b.bin': new Uint8Array([0, 127, 128, 255]) }, { mtime: new Date('2020-01-01T00:00:00Z') });
try {
  for (const name of ['core', 'archive']) {
    const packed = JSON.parse(await readFile(path.join(packages, 'npm-pack.json'), 'utf8')).find(row => row.name === `@filens/${name}`);
    const unpack = path.join(temporary, name);
    await mkdir(unpack);
    execFileSync('tar', ['-xzf', path.resolve(packages, packed.filename), '-C', unpack]);
    const root = path.join(unpack, 'package'), dist = path.join(root, 'dist');
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const files = await readdir(dist, { recursive: true });
    assert(files.every(file => !file.endsWith('.map')), `${name}: published maps`);
    const checkExport = async value => {
      if (typeof value === 'string') await access(path.join(root, value));
      else for (const target of Object.values(value)) await checkExport(target);
    };
    await checkExport(metadata.exports);
    let relativeDeclarations = 0;
    for (const file of files.filter(file => /\.(?:m?js|ts)$/.test(file))) {
      const code = await readFile(path.join(dist, file), 'utf8');
      assert(!code.includes('sourceMappingURL='), `${name}/${file}: stale source map URL`);
      if (file.endsWith('.d.ts')) for (const match of code.matchAll(/(?:from\s*|import\s*\()\s*['"]([.][^'"]+)['"]/g)) {
        const referenced = path.resolve(dist, path.dirname(file), match[1]);
        let found = false;
        for (const candidate of [referenced + '.d.ts', path.join(referenced, 'index.d.ts'), referenced.replace(/\.js$/, '.d.ts')]) {
          try { await access(candidate); found = true; break; } catch { /* Try the next TS resolution form. */ }
        }
        assert(found, `${name}/${file}: unresolved declaration ${match[1]}`);
        relativeDeclarations++;
      }
    }
    const current = await import(pathToFileURL(path.join(dist, 'index.js')).href);
    const previous = await import(pathToFileURL(path.resolve(baseline, `${name}-dist/index.js`)).href);
    assert.deepEqual(Object.keys(current).sort(), Object.keys(previous).sort());
    if (name === 'core') {
      for (const subpath of ['zip', 'archive-volumes']) {
        const module = await import(pathToFileURL(path.join(dist, `${subpath}.js`)).href);
        const expected = await import(pathToFileURL(path.resolve(baseline, `${name}-dist/${subpath}.js`)).href);
        assert.deepEqual(Object.keys(module).sort(), Object.keys(expected).sort());
      }
      const models = [];
      for (const engine of [current, previous]) {
        const archive = await engine.openZipArchive(bytes), entries = [];
        for (const entry of archive.values()) entries.push({ name: entry.name, size: entry.size, directory: entry.directory,
          modified: entry.modified, bytes: [...await entry.bytes()] });
        models.push(entries);
      }
      assert.deepEqual(models[0], models[1]);
      const pptx = new Uint8Array(await readFile('apps/demo/public/samples/sample-deck.pptx'));
      assert.deepEqual(await current.loadPptx(pptx), await previous.loadPptx(pptx));
    } else {
      const models = [];
      for (const engine of [current, previous]) {
        const index = await engine.createZipArchiveResourceIndex(bytes, { descriptor: { source: bytes, name: 'fixture.zip', extension: 'zip' } });
        const entries = [];
        for (const entry of index.files) entries.push({ name: entry.name, size: entry.size, bytes: [...new Uint8Array(await entry.readAsArrayBuffer())] });
        models.push(entries);
      }
      assert.deepEqual(models[0], models[1]);
    }
    result[name] = { exportCount: Object.keys(current).length, exports: Object.keys(current).sort(), files: files.sort(),
      relativeDeclarations, noSourceMaps: true, publicPathsResolve: true, completeModelsEqual: true };
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([name, value]) => [name,
    { exports: value.exportCount, declarationReferences: value.relativeDeclarations, modelsEqual: value.completeModelsEqual }])), null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
