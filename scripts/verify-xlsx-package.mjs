// Validate a packed XLSX package, including its published entry and declarations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkbookFixture } from '../packages/xlsx/test/fixtures/workbook.mjs';

const option = name => {
  const at = process.argv.indexOf(name), value = at < 0 ? undefined : process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a path.`);
  return path.resolve(value);
};
const archive = option('--package'), baseline = option('--baseline');
// Keep extraction beneath the workspace so external dependencies resolve via
// the same node_modules as the baseline. Always remove the temporary copy.
const directory = await mkdtemp(path.resolve('tmp/xlsx-package-check-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', directory]);
  const root = path.join(directory, 'package'), dist = path.join(root, 'dist');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const files = await readdir(dist, { recursive: true });
  assert(files.every(file => !file.endsWith('.map')), 'Source maps must stay outside the npm package.');
  const checkExport = async value => {
    if (typeof value === 'string') await access(path.join(root, value));
    else for (const target of Object.values(value)) await checkExport(target);
  };
  await checkExport(metadata.exports);
  for (const file of files.filter(file => file.endsWith('.d.ts') || file.endsWith('.js'))) {
    const code = await readFile(path.join(dist, file), 'utf8');
    assert(!code.includes('sourceMappingURL='), `${file} references a map excluded from publication.`);
    if (file.endsWith('.d.ts')) for (const match of code.matchAll(/from\s+['"]([.][^'"]+)['"]/g)) {
      await access(path.resolve(dist, path.dirname(file), match[1] + '.d.ts'));
    }
  }
  const current = await import(pathToFileURL(path.join(dist, 'index.js')).href);
  const previous = await import(pathToFileURL(path.join(baseline, 'index.js')).href);
  assert.deepEqual(Object.keys(current).sort(), Object.keys(previous).sort());
  const csv = new TextEncoder().encode('Name,Value\n"中文, text",42');
  assert.deepEqual(await current.loadCsvWorkbook(csv), await previous.loadCsvWorkbook(csv));
  const bytes = await createWorkbookFixture(), models = [];
  for (const engine of [current, previous]) {
    const model = await engine.loadXlsxWorkbook(bytes);
    for (const sheet of model.sheets) for (const row of sheet.rows) for (const cell of row.cells) {
      if (cell.formula) engine.resolveCellValue(sheet, cell);
    }
    models.push(model);
  }
  assert.deepEqual(models[0], models[1]);
  console.log(JSON.stringify({ exports: Object.keys(current).sort(), files: files.sort(),
    noSourceMaps: true, declarationImportsResolve: true, csvModelsEqual: true, xlsxModelsEqual: true }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
