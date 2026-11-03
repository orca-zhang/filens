// The test runner prepares fixtures outside the sandbox. Each CLI process,
// including its OCR child, must work with all filesystem writes denied.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY ?? path.join(root, 'dist', process.platform === 'win32' ? 'filens.exe' : 'filens');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-workspace-test-'));
const strict = process.platform === 'darwin';
const policy = '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))';
const env = { ...process.env, TMPDIR: path.join(work, 'absent-tmp'), TMP: path.join(work, 'absent-tmp'), TEMP: path.join(work, 'absent-tmp'), FILENS_SEARCH_JOBS: '4' };
const checks = [];
function run(label, args, { expected = 0, extraEnv = {}, confined = strict, input } = {}) {
  const result = spawnSync(confined ? '/usr/bin/sandbox-exec' : binary,
    confined ? ['-p', policy, binary, ...args] : args,
    { cwd: work, env: { ...env, ...extraEnv }, input, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${label}: ${result.stderr}\n${result.stdout}`);
  const value = JSON.parse(result.stdout);
  checks.push(label);
  return value;
}
try {
  const capacity = run('capabilities and OCR health without writable TMPDIR', ['capacity', '--json']);
  assert.equal(capacity.capacity.execution.workspace, 'memory');
  assert.equal(capacity.capacity.ocr.available, true, JSON.stringify(capacity.capacity.ocr));
  for (const file of ['filens-aurora-guide.docx', 'filens-observatory.xlsx', 'filens-field-notes.pptx', 'filens-cosmic-atlas.pdf']) {
    assert.equal(run(file, ['read', path.join(root, 'apps/demo/public/samples', file), '--json']).ok, true);
  }
  const fixtures = path.join(root, 'converter/rapidocr/testdata');
  for (const file of ['scan.png', 'scan.pdf']) {
    const value = run(`OCR ${file}`, ['read', path.join(fixtures, file), '--layout', '--json']);
    assert.equal(value.ok, true);
    assert.match(value.content.text, /FILENS2026/);
    if (file.endsWith('.pdf')) assert.match(value.content.text, /FILENS2026[\s\S]*BRIGHT2027/);
  }
  const archive = path.join(work, 'nested.zip');
  await writeFile(archive, zipSync({ 'inner.zip': zipSync({ 'scan.png': await readFile(path.join(fixtures, 'scan.png')) }) }));
  assert.match(run('nested archive member OCR', ['read', `${archive}!/inner.zip!/scan.png`, '--json']).content.text, /FILENS2026/);
  const corpus = path.join(work, 'corpus');
  await mkdir(corpus);
  for (let i = 0; i < 40; i++) await writeFile(path.join(corpus, `source-${i}.txt`), `MEMORY2026 original evidence ${i}\n`);
  const searched = run('four parallel WASI workers', ['search', corpus, '--query', 'MEMORY2026', '--layout', '--json']);
  assert.equal(searched.ok, true, JSON.stringify(searched));
  assert.equal(searched.search.matchedFiles, 40);
  assert.equal(searched.search.scan.execution.workers, 4);
  const text = path.join(corpus, 'source-0.txt');
  assert.match(run('excerpt', ['summarize', text, '--query', 'MEMORY2026', '--summary-ratio', '1', '--json']).content.text, /MEMORY2026/);
  const csv = path.join(work, 'input.csv');
  await writeFile(csv, 'name,value\nMemory,42\n');
  const output = path.join(work, 'output.xlsx');
  if (strict) {
    const converted = run('only final conversion commit is denied', ['convert', csv, output, '--json'], { expected: 1 });
    assert.equal(converted.error.code, 'io_error');
    assert.equal(converted.conversion.ok, true, 'WASM conversion itself must finish in memory');
  } else {
    assert.equal(run('conversion commit', ['convert', csv, output, '--json']).ok, true);
    await rm(output);
  }
  assert.deepEqual((await readdir(work)).sort(), ['corpus', 'input.csv', 'nested.zip']);
  assert.equal((await readdir(corpus)).length, 40);
  // A partial CLI response must also avoid scratch files.
  assert.equal(run('truncated read cleanup', ['read', text, '--max-bytes', '4', '--json'], { expected: 3 }).content.truncated, true);
  assert.equal(run('explicit memory flag', ['capacity', '--workspace=memory', '--no-ocr', '--json']).capacity.execution.workspace, 'memory');
  const diskTmp = path.join(work, 'disk-tmp');
  await mkdir(diskTmp);
  const diskEnv = { TMPDIR: diskTmp, TMP: diskTmp, TEMP: diskTmp };
  const onDisk = (label, args, expected = 0) => {
    const value = run(label, [...args, '--workspace', 'disk'], { confined: false, extraEnv: diskEnv, expected });
    return value;
  };
  const diskCapacity = onDisk('disk capacity', ['capacity', '--json']);
  assert.equal(diskCapacity.capacity.execution.workspace, 'disk');
  assert.equal(diskCapacity.capacity.ocr.available, true);
  assert.equal(onDisk('disk document read', ['read', path.join(root, 'apps/demo/public/samples/filens-aurora-guide.docx'), '--json']).ok, true);
  assert.match(onDisk('disk scanned PDF OCR', ['read', path.join(fixtures, 'scan.pdf'), '--json']).content.text, /FILENS2026[\s\S]*BRIGHT2027/);
  assert.match(onDisk('disk nested archive OCR', ['read', `${archive}!/inner.zip!/scan.png`, '--json']).content.text, /FILENS2026/);
  const diskSearch = onDisk('disk parallel workers', ['search', corpus, '--query', 'MEMORY2026', '--layout', '--json']);
  assert.equal(diskSearch.ok, true, JSON.stringify(diskSearch));
  assert.equal(diskSearch.search.matchedFiles, 40);
  assert.equal(diskSearch.search.scan.execution.workers, 4);
  assert.equal(onDisk('disk conversion output', ['convert', csv, output, '--json']).ok, true);
  assert.equal((await readFile(output)).subarray(0, 2).toString(), 'PK');
  await rm(output);
  const fromJson = run('disk selected in JSON request', ['-'], { confined: false, extraEnv: diskEnv,
    input: JSON.stringify({ operation: 'capabilities', workspace: 'disk' }) });
  assert.equal(fromJson.capacity.execution.workspace, 'disk');
  assert.equal(onDisk('disk deadline cleanup', ['read', path.join(fixtures, 'scan.pdf'), '--timeout', '1ms', '--json'], 1).error.code, 'canceled');
  assert.deepEqual(await readdir(diskTmp), [], 'disk scratch directories must be cleaned on success and cancellation');
  if (strict) {
    const denied = run('explicit disk mode is denied by read-only without fallback', ['capacity', '--workspace', 'disk', '--json'], { expected: 1, extraEnv: diskEnv });
    assert.equal(denied.error.code, 'io_error');
    assert.deepEqual(await readdir(diskTmp), []);
  }
  const invalid = run('invalid workspace parameter', ['capacity', '--workspace', 'auto', '--json'], { expected: 2 });
  assert.equal(invalid.error.code, 'invalid_request');
  console.log(`${checks.length} workspace checks passed (default memory, explicit memory/disk, disk cleanup and ${strict ? 'macOS write-denied sandbox' : 'unavailable TMPDIR'}).`);
} finally { await rm(work, { recursive: true, force: true }); }
