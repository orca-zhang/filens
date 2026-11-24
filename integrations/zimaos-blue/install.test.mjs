import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
test('fresh install includes references, repeats safely and preserves an existing skill', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filens-blue-install-'));
  try {
    const workspace = path.join(root, 'workspace with spaces');
    const cli = path.join(root, 'filens');
    await writeFile(cli, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ok:true,capacity:{ocr:{available:true}}}));\n');
    await chmod(cli, 0o755);
    const run = () => spawnSync(process.execPath, [path.join(here, 'install.mjs'), '--workspace', workspace, '--cli', cli], {encoding:'utf8'});
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const target = path.join(workspace, '.agents/skills/filens');
    assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), await readFile(path.join(here, 'skills/filens/SKILL.md'), 'utf8'));
    for (const reference of ['reading', 'search', 'operations']) assert.ok((await readFile(path.join(target, 'references', reference+'.md'))).length);
    assert.equal(JSON.parse(run().stdout).status, 'unchanged');
    await writeFile(path.join(target, 'SKILL.md'), 'my previous skill\n');
    const replaced = run();
    assert.equal(replaced.status, 0, replaced.stderr);
    const receipt = JSON.parse(replaced.stdout);
    assert.equal(await readFile(path.join(receipt.backup, 'SKILL.md'), 'utf8'), 'my previous skill\n');
    assert.deepEqual(await readdir(path.join(workspace, '.agents/skills')), ['filens']);
    assert.equal(receipt.ocrAvailable, true);
  } finally { await rm(root, {recursive:true,force:true}); }
});

test('CLI failure leaves the workspace unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filens-blue-install-'));
  try {
    const workspace = path.join(root, 'workspace');
    const result = spawnSync(process.execPath, [path.join(here, 'install.mjs'), '--workspace', workspace, '--cli', path.join(root, 'missing')], {encoding:'utf8'});
    assert.notEqual(result.status, 0);
    await assert.rejects(readdir(workspace), {code:'ENOENT'});
  } finally { await rm(root, {recursive:true,force:true}); }
});
