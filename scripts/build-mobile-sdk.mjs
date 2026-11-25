import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// External module workers are required by WebKit's iWork path. Keep the split
// runtime intact instead of using the browser HTML build's inline workers.
const runtime = path.join(root, 'packages/preview/dist/mobile');
try {
  await readFile(path.join(root, 'wasm/converter-core/dist/converter-core-mobile.wasm'));
  await readFile(path.join(root, 'wasm/converter-image/dist/converter-image-mobile.wasm'));
} catch { throw new Error('Build the compact shared WASM first: npm run build:wasm:mobile'); }
const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: path.join(root, 'packages/preview'), env: { ...process.env, FILENS_PREVIEW_BUILD: 'mobile' }, stdio: 'inherit'
});
if (build.status !== 0) throw new Error('Mobile preview runtime build failed');
try {
  await readFile(path.join(runtime, 'filens.js'));
  await readFile(path.join(runtime, 'THIRD-PARTY-NOTICES.txt'));
} catch {
  throw new Error('Missing shared mobile preview runtime');
}
await assertReleaseDirectory(runtime);
const compressedAssets = new Map();
for (const destination of [
  'sdk/ios/Sources/FilensPreview/Resources/filens',
  'sdk/android/filens-preview/src/main/assets/filens'
]) {
  const directory = path.join(root, destination);
  await mkdir(directory, { recursive: true });
  // Keep the tracked placeholder while replacing generated runtime files.
  for (const name of await readdir(directory)) {
    if (name !== 'README.txt') await rm(path.join(directory, name), { recursive: true, force: true });
  }
  await cp(runtime, directory, { recursive: true });
  await writeFile(path.join(directory, 'THIRD-PARTY-NOTICES.txt'),
    await readFile(path.join(runtime, 'THIRD-PARTY-NOTICES.txt'), 'utf8') +
    '\n\nAndroid Brotli decoder: org.brotli:dec:0.1.2\n\n' +
    await readFile(path.join(root, 'sdk/mobile/BROTLI-LICENSE.txt'), 'utf8'));
  // Keep assets compressed on disk; the native transports retain their original URLs.
  await compressRuntime(directory);
  await rm(path.join(directory, 'index.html'), { force: true });
  await cp(path.join(root, 'sdk/mobile/web'), directory, { recursive: true });
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  console.log(`Staged shared preview runtime: ${destination}`);
}

async function compressRuntime(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) await compressRuntime(file, relative);
    else if (/\.(?:m?js|wasm)$/.test(entry.name) || entry.name === 'THIRD-PARTY-NOTICES.txt') {
      const bytes = compressedAssets.get(relative) ?? brotliCompressSync(await readFile(file));
      compressedAssets.set(relative, bytes);
      await writeFile(`${file}.br`, bytes);
      await rm(file);
    }
  }
}
