// Verify content detection through the packaged WASM path, independent of names.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { executableName } from './agent-platforms.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist', executableName(`${process.platform}-${process.arch}`));
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-inspect-'));
const checks = [];
function run(args, {expected = 0, input = ''} = {}) {
  const result = spawnSync(binary, args, {cwd: work, encoding: 'utf8', input, timeout: 30000, maxBuffer: 8 << 20});
  assert.equal(result.error, undefined);
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function inspect(file) {
  const result = JSON.parse(run(['inspect', file, '--json']));
  assert.equal(result.op, 'inspect');
  assert.equal(result.ok, true);
  assert.ok(result.inspection.bytesRead <= 262144);
  assert.match(result.inspection.validation, /not full-file validation/);
  return result.inspection;
}
try {
  const png = path.join(root, 'converter/rapidocr/testdata/scan-transparent.png');
  await copyFile(png, path.join(work, 'invoice.pdf'));
  const renamed = inspect('invoice.pdf');
  assert.equal(renamed.format, 'png');
  assert.equal(renamed.mime, 'image/png');
  assert.equal(renamed.confidence, 'high');
  assert.equal(renamed.extensionMatches, false);
  await copyFile(png, path.join(work, 'no-extension'));
  const extensionless = inspect('no-extension');
  assert.equal(extensionless.format, 'png');
  assert.equal(extensionless.extensionMatches, null);
  checks.push('misleading and missing extensions');
  await copyFile(path.join(root, 'apps/demo/public/samples/filens-aurora-guide.docx'), path.join(work, 'office.bin'));
  const office = inspect('office.bin');
  assert.equal(office.format, 'docx');
  assert.equal(office.evidence, 'structure');
  assert.equal(office.container, 'zip');
  assert.equal(office.extensionMatches, false);
  await writeFile(path.join(work, 'container.docx'), zipSync({'plain.txt': strToU8('Ambiguous package')}));
  const container = inspect('container.docx');
  assert.equal(container.format, null);
  assert.equal(container.container, 'zip');
  assert.equal(container.extensionMatches, null);
  checks.push('OOXML structure and ambiguous ZIP');
  for (const [name, bytes, evidence] of [
    ['empty.pdf', Buffer.alloc(0), 'unknown'],
    ['unknown.png', Buffer.from([0, 1, 2, 3, 0, 255]), 'unknown'],
    ['code.rs', Buffer.from('plain content without a unique format\n'), 'text'],
  ]) {
    await writeFile(path.join(work, name), bytes);
    const result = inspect(name);
    assert.equal(result.format, null);
    assert.equal(result.evidence, evidence);
    assert.equal(result.extensionMatches, null);
  }
  checks.push('unknown, empty and ambiguous text');
  // No full-file staging into the memory workspace: inspect an otherwise
  // oversized sparse input and verify the detector's actual read accounting.
  const large = await open(path.join(work, 'large.png'), 'w');
  try { await large.write(await readFile(png), 0); await large.truncate(512 * 1024 * 1024); }
  finally { await large.close(); }
  const bounded = inspect('large.png');
  assert.equal(bounded.format, 'png');
  assert.equal(bounded.fileBytes, 512 * 1024 * 1024);
  checks.push('512 MiB sparse file, bounded reads and no memory-workspace copy');
  const structured = JSON.parse(run(['-'], {input: JSON.stringify({op: 'inspect', input: 'invoice.pdf'})}));
  assert.deepEqual(structured.inspection, renamed);
  for (const format of ['text', 'json', 'yaml', 'xml', 'markdown', 'html', 'csv', 'tsv']) {
    assert.match(run(['inspect', 'invoice.pdf', '--format', format]), /png/);
  }
  assert.ok(JSON.parse(run(['capacity', '--op', 'inspect', '--full', '--json'])).capacity.operations.some(row => row.name === 'inspect'));
  checks.push('stdin protocol, eight serializers and capacity');
  assert.equal(JSON.parse(run(['inspect', work, '--json'], {expected: 2})).ok, false);
  assert.equal(JSON.parse(run(['inspect', 'missing', '--json'], {expected: 1})).ok, false);
  assert.equal(JSON.parse(run(['inspect', 'invoice.pdf', '--layout', '--json'], {expected: 2})).error.code, 'invalid_request');
  assert.equal(JSON.parse(run(['inspect', 'invoice.pdf', '--timeout', '1ns', '--json'], {expected: 1})).error.code, 'canceled');
  checks.push('directory/missing input, incompatible flags and timeout');
  await writeFile(path.join(root, 'docs/agent-cli-inspect-validation.json'), JSON.stringify({
    observedAt: new Date().toISOString(), cliVersion: '0.5.6', platform: `${process.platform}-${process.arch}`,
    checks, example: renamed, passed: true,
  }, null, 2) + '\n');
  console.log(`Inspect CLI: ${checks.length} groups passed, including bounded WASM content detection, extension mismatches and eight serializers.`);
} finally { await rm(work, {recursive: true, force: true}); }
