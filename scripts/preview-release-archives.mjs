import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

export async function packagePreviewReleaseArchives({ previewDirectory, releaseDirectory, version, tag, date, licensePath }) {
  const archives = [];
  for (const mode of ['split', 'all-in-one']) {
    const name = `filens-preview-${version}-${mode}`;
    const target = path.join(releaseDirectory, name);
    await rm(target, { recursive: true, force: true });
    await cp(path.join(previewDirectory, mode), target, { recursive: true });
    await cp(licensePath, path.join(target, 'LICENSE'));

    if (mode === 'all-in-one') {
      const staging = path.join(releaseDirectory, `.precompressed-${version}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      for (const file of ['filens.js.gz', 'filens.js.br']) {
        await cp(path.join(target, file), path.join(staging, file));
        await rm(path.join(target, file));
      }
      const sidecars = `${name}-precompressed`;
      await writeFile(path.join(staging, 'README.md'), `# FiLens Preview ${version}: optional precompressed JavaScript\n\nUse these files with the matching ${name}.zip. Place filens.js.gz and filens.js.br beside filens.js, then configure your HTTP server to serve the matching Content-Encoding and JavaScript content type. This ZIP is optional; dynamic server compression works too.\n\nIntegration: https://github.com/orca-zhang/filens/blob/${tag}/packages/preview/README.md\n`);
      await assertReleaseDirectory(staging);
      await normalizeTimes(staging, new Date(`${date}T00:00:00Z`));
      const sidecarFile = `${sidecars}.zip`;
      await createZip(releaseDirectory, sidecarFile, ['filens.js.gz', 'filens.js.br', 'README.md'], staging);
      archives.push(await measure(releaseDirectory, sidecarFile, 'browser-precompressed-sidecars', await totalBytes(staging)));
      await rm(staging, { recursive: true, force: true });
    }

    await writeFile(path.join(target, 'README.md'), `# FiLens Preview ${version}: ${mode}\n\nDeploy this entire directory to an HTTP(S) static server and open index.html, or import createPreview from filens.js. Files are parsed and previewed locally. Default watermark: FiLens.\n\nRAR, 7z and multipart ZIP load archive/7zz.wasm and the archive worker under assets/ on demand; retain both sidecars to enable those formats. Keep LICENSE and THIRD-PARTY-NOTICES.txt when redistributing.\n${mode === 'all-in-one' ? `\nThe default ZIP omits optional filens.js.gz and filens.js.br files to reduce its download size. For static precompressed hosting, also download ${name}-precompressed.zip and place its two files beside filens.js.\n` : ''}\nIntegration: https://github.com/orca-zhang/filens/blob/${tag}/packages/preview/README.md\n`);
    await assertReleaseDirectory(target);
    await normalizeTimes(target, new Date(`${date}T00:00:00Z`));

    const file = `${name}.zip`;
    await createZip(releaseDirectory, file, [name]);
    archives.push(await measure(releaseDirectory, file, `browser-${mode}`, await totalBytes(target)));
  }
  return archives;
}

async function createZip(directory, file, entries, cwd = directory) {
  const archive = path.resolve(directory, file);
  await rm(archive, { force: true });
  const result = spawnSync('zip', ['-X', '-q', '-r', archive, ...entries], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Runtime ZIP failed: ${result.stderr}`);
  const verified = spawnSync('unzip', ['-tq', archive], { encoding: 'utf8' });
  if (verified.status !== 0) throw new Error(`Runtime ZIP integrity check failed: ${file}`);
}

async function measure(directory, file, kind, unpackedBytes) {
  const bytes = await readFile(path.join(directory, file));
  return { file, kind, bytes: bytes.length, unpackedBytes,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function totalBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    total += entry.isDirectory() ? await totalBytes(file) : (await stat(file)).size;
  }
  return total;
}

async function normalizeTimes(directory, time) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await normalizeTimes(file, time);
    await utimes(file, time, time);
  }
  await utimes(directory, time, time);
}
