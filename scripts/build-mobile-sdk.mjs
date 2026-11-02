import { cp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// External module workers are required by WebKit's iWork path. Keep the split
// runtime intact instead of using the browser HTML build's inline workers.
const runtime = path.join(root, 'packages/preview/dist/split');
try {
  await readFile(path.join(runtime, 'filens.js'));
  await readFile(path.join(runtime, 'THIRD-PARTY-NOTICES.txt'));
} catch {
  throw new Error('Build the shared runtime first: npm run build:wasm && npm run build:preview');
}
await assertReleaseDirectory(runtime);
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
  await cp(path.join(root, 'sdk/mobile/web'), directory, { recursive: true });
  await cp(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  console.log(`Staged shared preview runtime: ${destination}`);
}
