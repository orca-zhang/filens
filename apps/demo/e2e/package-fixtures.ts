import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { build } from 'vite';

const directories = new Map<string, Promise<string>>();

/** Exercise the published library through an application bundler, sharing the
 * test's Three.js instance while resolving the library's npm dependencies. */
export function bundledPackage(name = 'model3d'): Promise<string> {
  let directory = directories.get(name);
  if (directory) return directory;
  directory = (async () => {
    const outDir = await mkdtemp(join(os.tmpdir(), `filens-${name}-package-`));
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        lib: {
          entry: { index: resolve(`packages/${name}/dist/index.js`), core: resolve('packages/core/dist/index.js') },
          formats: ['es'], fileName: (_format, name) => `${name}.js`
        },
        rollupOptions: { external: name === 'panorama' ? [] : ['three', 'filens-step'] }
      }
    });
    return outDir;
  })();
  directories.set(name, directory);
  return directory;
}

export async function cleanupPackageFixtures(): Promise<void> {
  const current = [...directories.values()];
  directories.clear();
  await Promise.all(current.map(async directory => rm(await directory, { recursive: true, force: true })));
}

const archives = new Map<string, Promise<Record<string, string>>>();
export async function archivedPackageAsset(snapshot: string, name: string): Promise<Buffer> {
  let archive = archives.get(snapshot);
  if (!archive) {
    archive = readFile(`benchmarks/frontend/2026-10-24/${snapshot}-diagnostic.json.gz`)
      .then(bytes => JSON.parse(gunzipSync(bytes).toString('utf8')).baselineRuntimeFiles);
    archives.set(snapshot, archive);
  }
  const files = await archive;
  const source = files[`tmp/continued-review/${snapshot}-baseline/dist/${name}`];
  if (typeof source !== 'string') throw new Error(`Missing archived baseline module: ${snapshot}/${name}`);
  return Buffer.from(source);
}
