#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--workspace', '--cli'].includes(args[i]) || !args[i+1]) throw new Error('Usage: filens-blue-install --workspace DIR [--cli FILENS_EXECUTABLE]');
  options[args[i]] = args[i+1];
}
if (!options['--workspace']) throw new Error('--workspace is required');
const workspace = path.resolve(options['--workspace']);
const cli = options['--cli'] || 'filens';
const probe = spawnSync(cli, ['capacity', '--json'], {encoding:'utf8',timeout:30000});
if (probe.error || probe.status !== 0) throw new Error(`FiLens CLI unavailable (${cli}): ${probe.error?.message || probe.stderr}`);
const capacity = JSON.parse(probe.stdout);
if (!capacity.ok) throw new Error('FiLens capacity check failed');
const source = path.join(here, 'skills/filens');
const target = path.join(workspace, '.agents/skills/filens');
const files = ['SKILL.md', 'references/reading.md', 'references/search.md', 'references/operations.md'];
for (const file of files) await readFile(path.join(source, file));
let unchanged = true;
for (const file of files) {
  try {
    if (!(await readFile(path.join(source, file))).equals(await readFile(path.join(target, file)))) unchanged = false;
  } catch (error) { if (error.code !== 'ENOENT') throw error; unchanged = false; }
}
const receipt = {status:unchanged?'unchanged':'installed',workspace,skill:target,cli,
  skillIteration:'v9',requiresBlueRoutingFix:true,ocrAvailable:capacity.capacity?.ocr?.available === true};
if (!unchanged) {
  const state = path.join(workspace, '.filens-blue');
  await mkdir(state, {recursive:true});
  const stage = await mkdtemp(path.join(state, 'install-'));
  let backup;
  try {
    for (const file of files) {
      await mkdir(path.dirname(path.join(stage, file)), {recursive:true});
      await cp(path.join(source, file), path.join(stage, file));
    }
    try {
      await readdir(target);
      await mkdir(path.join(state,'backups'), {recursive:true});
      backup = await mkdtemp(path.join(state,'backups','filens-'));
      await rm(backup, {recursive:true});
      await rename(target, backup);
      receipt.backup = backup;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(path.dirname(target), {recursive:true});
    try { await rename(stage, target); }
    catch (error) { if (backup) await rename(backup, target); throw error; }
    await writeFile(path.join(state,'installation.json'), JSON.stringify(receipt,null,2)+'\n');
  } finally { await rm(stage, {recursive:true,force:true}); }
}
console.log(JSON.stringify(receipt));
