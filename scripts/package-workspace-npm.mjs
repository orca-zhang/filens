// Pack format modules with their root license and exact release checksums.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive, assertReleaseDirectory } from './agent-release-privacy.mjs';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/workspace-npm');
await mkdir(output, { recursive: true });
const packages = [];
for (const entry of await readdir(path.join(root, 'packages'))) {
  const source = path.join(root, 'packages', entry);
  const metadata = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  if (!metadata.name.startsWith('@filens/') || metadata.private) continue;
  const directory = path.join(output, entry);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  // Keep debug maps in local builds; production packages need runtime, types
  // and notices, without source copies or machine-specific map paths.
  for (const file of metadata.files) await cp(path.join(source, file), path.join(directory, file), {
    recursive: true, filter: file => !file.endsWith('.map')
  });
  await removeMapReferences(directory);
  for (const file of (await readdir(source)).filter(name => /^README(?:\.[\w-]+)?\.md$/i.test(name))) {
    await cp(path.join(source, file), path.join(directory, file));
  }
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({ ...metadata, files: [...metadata.files, 'LICENSE'] }, null, 2)}\n`);
  await assertReleaseDirectory(directory);
  const npm = npmInvocation(['pack', '--json', '--ignore-scripts', '--pack-destination', output]);
  const result = spawnSync(npm.command, npm.args, { cwd: directory, encoding: 'utf8', maxBuffer: 8 << 20 });
  if (result.status !== 0) throw new Error(`npm pack failed for ${metadata.name}: ${result.stderr}`);
  const packed = JSON.parse(result.stdout)[0];
  const archive = path.join(output, packed.filename);
  assertReleaseArchive(archive);
  const bytes = await readFile(archive);
  packages.push({ name: packed.name, version: packed.version, file: packed.filename, bytes: packed.size,
    unpackedBytes: packed.unpackedSize, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: packed.integrity });
  console.log(`${packed.name}@${packed.version}: ${(packed.size / 1048576).toFixed(2)} MiB download / ${(packed.unpackedSize / 1048576).toFixed(2)} MiB installed`);
}
const report = `${JSON.stringify({ packages, privacyChecked: true }, null, 2)}\n`;
await writeFile(path.join(output, 'release.json'), report);
await writeFile(path.join(root, 'docs/module-npm-release.json'), report);

async function removeMapReferences(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await removeMapReferences(file);
    else if (/\.(?:[cm]?js|[cm]?ts)$/.test(entry.name)) {
      const code = await readFile(file, 'utf8');
      const clean = code.replace(/^\/\/[#@] sourceMappingURL=.*(?:\n|$)/gm, '');
      if (clean !== code) await writeFile(file, clean);
    }
  }
}
