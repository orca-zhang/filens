import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { sharedCompression } from '../../scripts/shared-compression';
import { archiveEngineAssets } from '../../scripts/archive-engine-assets';

const root = path.resolve(__dirname, '../..');
const single = process.env.FILENS_PREVIEW_BUILD === 'all-in-one';
const packages = ['archive', 'cad', 'core', 'converter-client', 'design', 'diagram', 'docx',
  'ebook', 'iwork', 'media', 'mindmap', 'model3d', 'office', 'panorama', 'pdf', 'text', 'vue', 'xlsx'];
const alias = packages.flatMap(name => [
  { find: `@filens/${name}/style.css`, replacement: path.join(root, `packages/${name}/src/${['design', 'media', 'office', 'text', 'vue'].includes(name) ? 'style.css' : 'styles/index.css'}`) },
  ...(name === 'core' ? [{ find: '@filens/core/zip', replacement: path.join(root, 'packages/core/src/zip.ts') }] : []),
  ...(name === 'core' ? [{ find: '@filens/core/archive-volumes', replacement: path.join(root, 'packages/core/src/archive-volumes.ts') }] : []),
  { find: `@filens/${name}`, replacement: path.join(root, `packages/${name}/src/index.ts`) }
]);
alias.push({ find: 'filens-step', replacement: path.join(root, 'packages/step/src/index.ts') });

function embeddedAssets() {
  return {
    name: 'filens-preview-assets', enforce: 'pre' as const,
    async load(id: string) {
      if (!id.endsWith('?url')) return;
      const file = id.slice(0, -4);
      if (!/\.(wasm|mjs)$/.test(file)) return;
      // A single file downloads every embedded engine anyway. Use the combined
      // core there to avoid shipping duplicate WASI/CFB code with the decryptor.
      const converterDir = path.join(root, 'wasm/converter-core/dist');
      if (single && file === path.join(converterDir, 'converter-office.wasm')) {
        return 'export default undefined;';
      }
      const asset = single && file === path.join(converterDir, 'converter-core.wasm')
        ? path.join(converterDir, 'converter-core-full.wasm') : file;
      const bytes = await readFile(asset);
      if (single) {
        const mime = file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
        // Compress before base64 to avoid its large transfer and parse overhead.
        // The shared WASM loader inflates lazily, retaining offline HTML support.
        return file.endsWith('.wasm')
          ? `export default ${JSON.stringify(`data:application/wasm+gzip;base64,${gzipSync(bytes, { level: 9 }).toString('base64')}`)};`
          : `export default URL.createObjectURL(new Blob([${JSON.stringify(bytes.toString())}], {type:${JSON.stringify(mime)}}));`;
      }
      const reference = this.emitFile({ type: 'asset', name: path.basename(file), source: bytes });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    transform(code: string, id: string) {
      if (single && id.endsWith('/iwork/src/worker/client.ts')) {
        return `import EmbeddedIworkWorker from './iwork-worker.ts?worker&inline';\n${code.replace(
          /new Worker\(new URL\('\.\/iwork-worker\.ts', import\.meta\.url\),\s*\{\s*type: 'module'\s*\}\)/,
          'new EmbeddedIworkWorker()'
        )}`;
      }
    },
    async generateBundle() {
      const notices = ['LICENSE', 'packages/step/vendor/THIRD-PARTY-NOTICES.txt', 'packages/archive/THIRD-PARTY-NOTICES.txt',
        'wasm/converter-image/THIRD-PARTY-NOTICES.txt', 'packages/media/src/engine-snapshot/MP4Box-LICENSE.txt'];
      const texts = await Promise.all(notices.map(file => readFile(path.join(root, file), 'utf8')));
      // Worker-only dependencies are absent from the main Rollup module graph.
      const dependencyRoots = new Set<string>(['libheif-js'].map(name => path.join(root, 'node_modules', name)));
      for (const id of this.getModuleIds()) {
        const offset = id.lastIndexOf('/node_modules/');
        if (offset < 0 || id.startsWith('\0')) continue;
        const segments = id.slice(offset + 14).split('/');
        dependencyRoots.add(id.slice(0, offset + 14) + segments.slice(0, segments[0].startsWith('@') ? 2 : 1).join('/'));
      }
      for (const dependency of [...dependencyRoots].sort()) {
        const metadata = JSON.parse(await readFile(path.join(dependency, 'package.json'), 'utf8'));
        const licenses = (await readdir(dependency)).filter(file => /^(licen[cs]e|notice)([.-]|$)/i.test(file));
        texts.push(`${metadata.name}@${metadata.version} (${metadata.license ?? 'see upstream'})\n\n` +
          (await Promise.all(licenses.map(file => readFile(path.join(dependency, file), 'utf8')))).join('\n\n'));
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: texts.join('\n\n') });
    }
  };
}

function embeddedStyles() {
  return {
    name: 'filens-preview-styles', enforce: 'post' as const,
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      const css = Object.values(bundle).filter((item: any) => item.type === 'asset' && item.fileName.endsWith('.css'));
      const entry: any = Object.values(bundle).find((item: any) => item.type === 'chunk' && item.isEntry);
      if (entry && css.length) {
        entry.code = `if(typeof document!=="undefined"){const s=document.createElement("style");s.textContent=${JSON.stringify(css.map((item: any) => String(item.source)).join('\n'))};document.head.append(s);}\n${entry.code}`;
        for (const item of css) delete bundle[item.fileName];
      }
    }
  };
}

export default defineConfig({
  base: './',
  worker: { plugins: () => [archiveEngineAssets()], rollupOptions: { output: { inlineDynamicImports: true } } },
  plugins: [archiveEngineAssets(), sharedCompression(), embeddedAssets(), vue(), embeddedStyles()],
  resolve: { alias, preserveSymlinks: true },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: `dist/${single ? 'all-in-one' : 'split'}`,
    lib: { entry: './src/index.ts', formats: ['es'], fileName: () => 'filens.js' },
    minify: 'esbuild', cssCodeSplit: false,
    rollupOptions: { output: single ? { inlineDynamicImports: true } : {
      chunkFileNames: 'chunks/[name]-[hash].js',
      manualChunks(id) {
        if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf';
        if (id.includes('/node_modules/')) return 'vendor';
        for (const name of ['iwork', 'model3d', 'core', 'panorama', 'archive', 'docx', 'xlsx', 'ebook', 'cad', 'mindmap', 'diagram']) {
          if (id.includes(`/packages/${name}/`)) return name;
        }
      }
    } }
  }
});
