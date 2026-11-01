// Verify the browser binary mesh transport against the legacy JSON core output.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWasmCoreRunner } from '../packages/converter-client/dist/index.js';
import { createStepReader } from '../packages/step/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = process.argv[2] ?? 'packages/step/vendor/filens-step.wasm';
const baseline = await readFile(path.resolve(root, baselinePath));
const candidate = await readFile(path.join(root, 'packages/step/vendor/filens-step.wasm'));
const legacy = createWasmCoreRunner({ wasm: await WebAssembly.compile(baseline) });
const reader = createStepReader({ wasm: await WebAssembly.compile(candidate) });
const corpus = JSON.parse(await readFile(path.join(root, 'docs/assets/rust-engines/results-step-refined.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function meshHash(positions, normals) {
  // Ignore triangle/instance emission order, preserving every Float32 bit,
  // triangle's vertex order/winding, normal, and duplicate triangle.
  const triangles = [];
  for (let offset = 0; offset < positions.length; offset += 9) {
    const bytes = Buffer.alloc(72);
    for (let axis = 0; axis < 9; axis++) {
      bytes.writeFloatLE(positions[offset + axis], axis * 4);
      bytes.writeFloatLE(normals[offset + axis], 36 + axis * 4);
    }
    triangles.push(bytes.toString('hex'));
  }
  return sha(triangles.sort().join('\n'));
}
const results = [];
for (const fixture of corpus.step) {
  const source = await readFile(path.join(root, 'tmp/rust-engines/source/occt-import-js-0.0.23/test/testfiles', fixture.id));
  assert.equal(sha(source), fixture.sha256);
  const previous = await legacy({
    args: ['filens-step', '/work/input.step', '/work/mesh.json', '0.1', '--reviewed'],
    files: { '/work/input.step': source }, readFiles: ['/work/mesh.json'], captureStdio: true
  });
  const metadata = JSON.parse(previous.stdout.trim().split('\n').at(-1));
  if (!metadata.success || previous.exitCode) {
    await assert.rejects(reader.read(source));
    results.push({ id: fixture.id, rejectedByBoth: true });
    continue;
  }
  const raw = previous.files['/work/mesh.json'];
  const json = JSON.parse(new TextDecoder().decode(raw));
  const oldPositions = new Float32Array(json.positions.flat()), oldNormals = new Float32Array(json.normals.flat());
  const mesh = await reader.read(source);
  for (const field of ['faces', 'missingFaces', 'instances', 'shellFallback']) assert.equal(mesh.metadata[field], metadata[field], `${fixture.id}: ${field}`);
  assert.deepEqual(mesh.metadata.preparation, metadata.preparation);
  assert.equal(mesh.triangleCount, metadata.triangles);
  assert(mesh.positions.every(Number.isFinite) && mesh.normals.every(Number.isFinite));
  const geometrySha256 = meshHash(mesh.positions, mesh.normals);
  assert.equal(geometrySha256, meshHash(oldPositions, oldNormals), fixture.id);
  results.push({ id: fixture.id, triangles: mesh.triangleCount, matchingFloat32Geometry: true,
    geometrySha256, jsonBytes: raw.length, binaryBytes: 16 + mesh.positions.length * 8 });
}
const report = {
  date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
  baselineWasmSha256: sha(baseline), candidateWasmSha256: sha(candidate),
  method: 'Same public 55-fixture corpus and 0.1 mm tolerance, shared browser WASI host on Node. Legacy core JSON output projected to Float32 as before; candidate read through actual binary browser reader. Exact Float32 position/normal bits and triangle winding match, ignoring only triangle emission order. Face/instance counts, preparation metadata and rejected inputs also checked. This is an output-preservation check, not a new OCCT geometry screen or speed benchmark.',
  fixtures: results.length, matchingMeshes: results.filter(r => r.matchingFloat32Geometry).length,
  rejectedByBoth: results.filter(r => r.rejectedByBoth).length, results
};
await writeFile(path.join(root, 'docs/assets/rust-engines/binary-transport-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`STEP binary transport: ${report.matchingMeshes}/44 Float32 meshes match; ${report.rejectedByBoth}/11 external-only inputs remain rejected.`);
