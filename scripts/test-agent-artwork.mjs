// Exercise the native shell and shared WASM decoders, including batch search.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { executableName } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist', executableName(`${process.platform}-${process.arch}`));
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-artwork-'));
const formats = 'tga dds dib cur pcx jxl qoi ff psd psb ico icns ai eps ps'.split(' ');
const results = [];
function run(args, expected = 0) {
  const result = spawnSync(binary, args, {cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20});
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
try {
  const capacity = run(['capacity', '--full', '--json']).capacity;
  for (const format of formats) {
    const entry = capacity.formats.find(row => row.format === format);
    assert.equal(entry?.textExtraction, true, format);
    assert.equal(entry?.ocr, true, format);
    const directory = ['psd', 'psb', 'ai', 'eps', 'ps'].includes(format) ? 'design'
      : format === 'ico' ? 'icons' : format === 'icns' ? 'image' : 'graphics';
    const input = path.join(root, 'examples/go-wazero-converter/fixtures', directory, `sample.${format}`);
    const response = run(['read', input, '--json', '--ocr', 'always']);
    assert.equal(response.ok, true, format);
    assert.equal(response.content.complete, true, `${format}: ${JSON.stringify(response.content)}`);
    const output = path.join(work, `converted-${format}.${['ai', 'eps', 'ps'].includes(format) ? 'pdf' : 'png'}`);
    assert.equal(run(['convert', input, output, '--json']).ok, true, format);
    const signature = await readFile(output);
    assert.ok(signature.subarray(0, 4).equals(Buffer.from(['ai', 'eps', 'ps'].includes(format) ? '%PDF' : '\x89PNG', 'latin1')), format);
    results.push({format, read: true, conversion: true});
  }
  // Text-bearing real artwork proves OCR is used after decoding, and that the
  // shared batch/archive paths accept formats beyond the old text catalog.
  const scan = path.join(root, 'apps/demo/public/samples/graphics/texture-study.tga');
  const read = run(['layout', scan, '--json']);
  assert.match(read.content.text, /FILENS/i);
  assert.ok(read.content.layout.blocks.some(block => block.bounds?.unit === 'px'));
  const archive = path.join(work, 'artwork.zip');
  await writeFile(archive, zipSync({'nested.zip': zipSync({'texture.tga': await readFile(scan)})}));
  const search = run(['search', archive, '--query', 'FILENS', '--json']);
  assert.equal(search.search.matchedFiles, 1);
  assert.deepEqual(search.search.results[0].archive.members, ['nested.zip', 'texture.tga']);
  assert.match(run(['read', `${archive}!/nested.zip!/texture.tga`, '--json']).content.text, /FILENS/i);
  const noOCR = run(['read', scan, '--no-ocr', '--json']);
  assert.equal(noOCR.content.text.trim(), '');
  for (const format of ['pcx', 'cur', 'psd']) {
    const corrupt = path.join(work, `bad.${format}`);
    await writeFile(corrupt, 'truncated artwork');
    const response = run(['read', corrupt, '--json'], 3);
    assert.equal(response.ok, false);
    assert.notEqual(response.error?.code, 'unsupported_format', format);
  }
  const report = {observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    cliVersion: '0.5.6', inputFormats: capacity.formats.length, addedFormats: results,
    ocrLayout: true, nestedArchiveSearch: true, virtualMemberRead: true, noOCR: true,
    malformedInputs: ['pcx', 'cur', 'psd'], passed: true};
  await writeFile(path.join(root, 'docs/agent-cli-artwork-validation.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Artwork CLI: ${formats.length} formats read/converted, OCR layout, nested archive search, virtual member reading, no-OCR policy and malformed files passed.`);
} finally {
  await rm(work, {recursive: true, force: true});
}
