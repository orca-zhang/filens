// Exercise the production text WASM with deterministic OCR host responses.
// OCR inference is stubbed; parsing, filtering, provenance and layout are real.
import assert from 'node:assert/strict';
import { WASI } from 'node:wasi';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
assert(option('--wasm'), '--wasm requires a freshly built production converter-text.wasm');
const modules = {};
for (const [name, file] of [['after', option('--wasm')], ['before', option('--baseline')]]) {
  if (file) modules[name] = await WebAssembly.compile(await readFile(file));
}
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ocr-scores-'));
try {
  await cp(path.join(root, 'docs/assets/agent-cli/invoice-zh.png'), path.join(work, 'input.png'));
  const scenarios = [
    { name: 'unordered-duplicates-and-missing', lines: ['Invoice 42', 'noise', 'invalid first score', 'unscored', '', 'Threshold'],
      raw: 'TextBox[5]score(0.8)\nTextBox[2]missing\nTextBox[2]score(0.99)\nTextBox[1]score(0.2)\nTextBox[00]score(1)\nTextBox[0]score(0.96)\nTextBox[4]score(1)',
      threshold: 0.8, expected: 'Invoice 42\nThreshold\n' },
    { name: 'threshold-disabled', lines: ['Invoice 42', 'unscored'], raw: 'TextBox[0]score(NaN)', threshold: 0, expected: 'Invoice 42\nunscored\n' },
    { name: 'all-nonfinite-or-out-of-range', lines: ['a', 'b', 'c', 'd'],
      raw: 'TextBox[0]score(NaN)\nTextBox[1]score(inf)\nTextBox[2]score(-0.1)\nTextBox[3]score(1.1)', threshold: 0.8, expected: '' },
    { name: 'empty', lines: [], raw: '', threshold: 0.8, expected: '' },
    { name: '4000-reversed-records', lines: Array.from({ length: 4000 }, (_, i) => `Invoice line ${i}`),
      raw: Array.from({ length: 4000 }, (_, i) => 3999 - i).map(i => `TextBox[${i}]score(${i % 5 ? 0.96 : 0.2})`).join('\n'),
      threshold: 0.8, expected: Array.from({ length: 4000 }, (_, i) => i).filter(i => i % 5).map(i => `Invoice line ${i}\n`).join('') }
  ];
  const report = [];
  for (const scenario of scenarios) {
    const outputs = {};
    for (const [version, module] of Object.entries(modules)) {
      const directory = path.join(work, version);
      await mkdir(directory, { recursive: true });
      await cp(path.join(work, 'input.png'), path.join(directory, 'input.png'));
      await writeFile(path.join(directory, 'options.json'), JSON.stringify({
        ocr: 'always', ocrMinConfidence: scenario.threshold, includeLayout: true, includeStructure: true
      }));
      const wasi = new WASI({ version: 'preview1', returnOnExit: true, env: {}, preopens: { '/work': directory },
        args: ['converter-text', '--operation', 'extract-text', '--input', '/work/input.png', '--output', '/work/text.txt',
          '--source', 'png', '--target', 'text', '--result', '/work/result.json', '--options',
          '/work/options.json'] });
      let instance, calls = 0;
      const host_call = (pointer, length, response, capacity) => {
        const memory = new Uint8Array(instance.exports.memory.buffer);
        const request = JSON.parse(new TextDecoder().decode(memory.subarray(pointer, pointer + length)));
        assert.equal(request.operation, 'ocr');
        calls++;
        const bytes = new TextEncoder().encode(JSON.stringify({ text: scenario.lines.join('\n'),
          detail: { lines: scenario.lines, raw_output: scenario.raw } }));
        assert(bytes.length <= capacity);
        memory.set(bytes, response);
        return bytes.length;
      };
      instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport, filens_text: { host_call } });
      wasi.start(instance);
      const wire = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'));
      assert.equal(calls, 1, `${scenario.name}: ${JSON.stringify(wire)}`);
      assert.equal(wire.payload.text, scenario.expected, `${scenario.name}: ${JSON.stringify(wire)}`);
      wire.metrics.elapsedMs = 0;
      outputs[version] = wire;
    }
    if (outputs.before) assert.deepEqual(outputs.after, outputs.before, scenario.name);
    report.push({ name: scenario.name, lines: scenario.lines.length, outputBytes: Buffer.byteLength(scenario.expected),
      complete: outputs.after.payload.complete, payloadSha256: createHash('sha256').update(JSON.stringify(outputs.after.payload)).digest('hex') });
  }
  console.log(JSON.stringify({ baselineCompared: Boolean(modules.before), checks: report }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
