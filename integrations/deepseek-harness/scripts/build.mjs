import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = path.resolve(root, '../..');
const output = path.join(root, 'lib');
const previewRoot = path.join(repository, 'packages/preview');
const previewPackage = JSON.parse(await readFile(path.join(previewRoot, 'package.json'), 'utf8'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Sidebar previews need one format at a time. Keep the shared runtime split so
// opening a PDF does not initialize embedded Office/CAD/3D engines and workers.
const previewBuild = spawnSync(process.execPath, [path.join(repository, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', path.join(output, 'runtime'), '--emptyOutDir'], {
  cwd: previewRoot, env: { ...process.env, FILENS_PREVIEW_BUILD: 'embedded' }, stdio: 'inherit',
});
if (previewBuild.error) throw previewBuild.error;
if (previewBuild.status !== 0) throw new Error(`Shared preview build exited with ${previewBuild.status}`);
for (const name of ['tools.js', 'requests.js', 'images.js', 'preview-host.js']) await cp(path.join(root, 'src', name), path.join(output, name));
const files = {};
async function walk(directory, prefix = '') {
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + item.name;
    if (item.isDirectory()) await walk(path.join(directory, item.name), `${name}/`);
    else {
      const data = await readFile(path.join(directory, item.name));
      files[name] = { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') };
    }
  }
}
await walk(path.join(output, 'runtime'));
const styleFiles = Object.keys(files).filter(name => name.endsWith('.css'));
if (styleFiles.length !== 1) throw new Error('Embedded preview requires exactly one shared stylesheet.');
const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
const runtime = { basePath: `/_filens/${digest}/`, files };
await writeFile(path.join(output, 'runtime-manifest.js'), `export const runtime = ${JSON.stringify(runtime, null, 2)};\n`);

// Use the shared support manifest instead of maintaining a competing extension table.
const workspacePackages = new Map();
for (const entry of await readdir(path.join(repository, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(repository, 'packages', entry.name);
  try {
    const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    workspacePackages.set(pkg.name, directory);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const manifestBuild = await build({
  stdin: { contents: "import { listPreviewFormats } from '@filens/core'; import { createVueDefaultPreviewRoutes } from './packages/vue/src/defaults.ts'; export const formats = listPreviewFormats({ routes: createVueDefaultPreviewRoutes() });", resolveDir: repository },
  bundle: true, format: 'esm', platform: 'node', write: false,
  loader: { '.css': 'empty', '.vue': 'empty', '.wasm': 'empty', '.glsl': 'text' },
  plugins: [{ name: 'filens-route-manifest', setup(builder) {
    builder.onResolve({ filter: /^@filens\// }, ({ path: request }) => {
      const [name, ...rest] = request.slice('@filens/'.length).split('/');
      const entry = rest.length ? `${rest.join('/')}.ts` : 'index.ts';
      const directory = workspacePackages.get(`@filens/${name}`);
      if (!directory) throw new Error(`Unknown workspace package ${request}`);
      return { path: path.join(directory, 'src', entry), sideEffects: false };
    });
    builder.onResolve({ filter: /\?(?:url|raw|worker|archive-url)/ }, args => ({ path: args.path, namespace: 'manifest-asset', sideEffects: false }));
    builder.onLoad({ filter: /.*/, namespace: 'manifest-asset' }, () => ({ contents: 'export default undefined' }));
  } }],
});
const module = await import(`data:text/javascript;base64,${Buffer.from(manifestBuild.outputFiles[0].text).toString('base64')}`);
const extensions = [...new Set(module.formats.map(item => item.extension))].sort();
if (!Array.isArray(extensions) || !extensions.length) throw new Error('Cannot discover shared preview extensions');
const textExtensions = new Set(module.formats.filter(item => ['text', 'markdown', 'code'].includes(item.family)).map(item => item.extension));
await writeFile(path.join(output, 'support.json'), JSON.stringify({ previewVersion: previewPackage.version, previewSource: 'workspace', extensions, binaryExtensions: extensions.filter(extension => !textExtensions.has(extension)), runtime }, null, 2) + '\n');
for (const [source, id, destination, basePath] of [
  ['client.js', 'dsh-filens', path.join(output, 'client.js'), runtime.basePath],
  ['workspace-client.js', 'dsh-filens-workspace', path.join(root, 'workspace/client.js'), runtime.basePath.replace('/_filens/', '/_filens-workspace/')],
]) {
const result = await build({
  entryPoints: [path.join(root, 'src', source)], bundle: true, format: 'cjs', platform: 'browser', target: 'es2022', write: false,
  external: ['react', 'zod'],
  loader: { '.css': 'text' },
  define: {
    __FILENS_EXTENSIONS__: JSON.stringify(extensions),
    __FILENS_BINARY_EXTENSIONS__: JSON.stringify(extensions.filter(extension => !textExtensions.has(extension))),
    __FILENS_RUNTIME_PATH__: JSON.stringify(basePath),
    __FILENS_RUNTIME_STYLES__: JSON.stringify(styleFiles[0]),
  },
});
await writeFile(destination, `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${result.outputFiles[0].text}\nreturn module.exports;}});\n`);
}
console.log(`Built dsh-filens: ${extensions.length} preview extensions, ${Object.keys(files).length} runtime files.`);
