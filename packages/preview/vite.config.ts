import { defineConfig, transformWithEsbuild } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { sharedCompression } from '../../scripts/shared-compression';
import { xmlParserOnly } from '../../scripts/xml-parser-plugin';
import { archiveEngineAssets } from '../../scripts/archive-engine-assets';
import { optionalEngineChunk } from '../../scripts/optional-engine-chunks';
import { packedPreviewAssets } from '../../scripts/preview-asset-packing.mjs';

const root = path.resolve(__dirname, '../..');
const single = process.env.FILENS_PREVIEW_BUILD === 'all-in-one';
// Embedded application hosts share a DOM and may serve modules across origins.
// Keep CSS separate for host-owned lifetime and use Blob workers in that case.
const embeddedHost = process.env.FILENS_PREVIEW_BUILD === 'embedded';
const packages = ['archive', 'cad', 'core', 'converter-client', 'design', 'diagram', 'docx',
  'ebook', 'iwork', 'media', 'mindmap', 'model3d', 'office', 'panorama', 'pdf', 'text', 'vue', 'xlsx'];
const alias = packages.flatMap(directory => {
  const name = directory === 'ebook' ? 'books' : directory;
  return [
    { find: `@filens/${name}/style.css`, replacement: path.join(root, `packages/${directory}/src/${['design', 'media', 'office', 'text', 'vue'].includes(name) ? 'style.css' : 'styles/index.css'}`) },
    ...(name === 'xlsx' ? [{ find: '@filens/xlsx/table', replacement: path.join(root, 'packages/xlsx/src/table.ts') }] : []),
    ...(name === 'media' ? [{ find: '@filens/media/codecs', replacement: path.join(root, 'packages/media/src/codec-preview-driver.ts') }] : []),
    ...(name === 'core' ? [{ find: '@filens/core/preview-runtime', replacement: path.join(root, 'packages/core/src/preview-runtime.ts') }] : []),
    ...(name === 'core' ? [{ find: '@filens/core/zip', replacement: path.join(root, 'packages/core/src/zip.ts') }] : []),
    ...(name === 'core' ? [{ find: '@filens/core/archive-volumes', replacement: path.join(root, 'packages/core/src/archive-volumes.ts') }] : []),
    ...(name !== 'core' && name !== 'converter-client' && name !== 'vue' ? [{ find: `@filens/${name}/routes`, replacement: path.join(root, `packages/${directory}/src/routes.ts`) }] : []),
    { find: `@filens/${name}`, replacement: path.join(root, `packages/${directory}/src/index.ts`) }
  ];
});
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
      if (single && ['converter-office.wasm', 'converter-postscript.wasm', 'converter-graphics.wasm', 'converter-cad.wasm', 'converter-raster.wasm'].some(name => file === path.join(converterDir, name))) {
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
      if ((single || embeddedHost) && id.endsWith('/iwork/src/worker/client.ts')) {
        return `import EmbeddedIworkWorker from './iwork-worker.ts?worker&inline';\n${code.replace(
          /new Worker\(new URL\('\.\/iwork-worker\.ts', import\.meta\.url\),\s*\{\s*type: 'module'\s*\}\)/,
          'new EmbeddedIworkWorker()'
        )}`;
      }
      if (embeddedHost && id.endsWith('/archive/src/sevenzip/client.ts')) {
        return code.replace("'./archive-worker.ts?worker'", "'./archive-worker.ts?worker&inline'");
      }
    },
    async generateBundle() {
      const notices = ['LICENSE', 'packages/step/vendor/THIRD-PARTY-NOTICES.txt', 'packages/archive/THIRD-PARTY-NOTICES.txt',
        'wasm/converter-core/THIRD-PARTY-NOTICES.txt',
        'wasm/converter-image/THIRD-PARTY-NOTICES.txt', 'packages/media/src/engine-snapshot/MP4Box-LICENSE.txt',
        'packages/converter-client/vendor/libheif/NOTICE.txt', 'packages/converter-client/vendor/libheif/COPYING.libheif',
        'packages/converter-client/vendor/libheif/COPYING.libde265'];
      const texts = await Promise.all(notices.map(file => readFile(path.join(root, file), 'utf8')));
      if (single) {
        const decoderNotices = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LZMA-SDK.txt', 'compiler-rt.txt', 'emscripten-LICENSE.txt', 'musl.txt'];
        texts.push('Packed asset decoder: lzma-sdk-decode@0.1.1\n\n' + (await Promise.all(
          decoderNotices.map(file => readFile(path.join(root, 'packages/preview/vendor/lzma', file), 'utf8'))
        )).join('\n\n'));
      }
      // Worker-only dependencies are absent from the main Rollup module graph.
      const dependencyRoots = new Set<string>();
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
      if (embeddedHost) return;
      const css = Object.values(bundle).filter((item: any) => item.type === 'asset' && item.fileName.endsWith('.css'));
      const entry: any = Object.values(bundle).find((item: any) => item.type === 'chunk' && item.isEntry);
      if (entry && css.length) {
        entry.code = `if(typeof document!=="undefined"){const s=document.createElement("style");s.textContent=${JSON.stringify(css.map((item: any) => String(item.source)).join('\n'))};document.head.append(s);}\n${entry.code}`;
        for (const item of css) delete bundle[item.fileName];
      }
    }
  };
}

function minifiedRuntime() {
  return {
    name: 'filens-preview-minify',
    // Vite preserves ES library whitespace for downstream tree shaking. This
    // complete runtime is ready to serve; compact it after Vite's own transform.
    renderChunk: { order: 'post' as const, handler(code: string, chunk: { fileName: string }) {
      return transformWithEsbuild(code, chunk.fileName, { loader: 'js', minifyWhitespace: true, legalComments: 'eof' });
    } }
  };
}

export default defineConfig({
  base: './',
  worker: { plugins: () => [archiveEngineAssets()], rollupOptions: { output: { inlineDynamicImports: true } } },
  plugins: [archiveEngineAssets(), sharedCompression(), xmlParserOnly(), embeddedAssets(), vue(), embeddedStyles(), minifiedRuntime(), ...(single ? [packedPreviewAssets()] : [])],
  resolve: { alias, preserveSymlinks: true },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: `dist/${single ? 'all-in-one' : 'split'}`,
    lib: { entry: './src/index.ts', formats: ['es'], fileName: () => 'filens.js' },
    minify: 'esbuild', cssCodeSplit: false,
    rollupOptions: { output: single ? { inlineDynamicImports: true } : {
      chunkFileNames(chunk) {
        const format = chunk.facadeModuleId?.replaceAll('\\', '/').match(/\/packages\/([^/]+)\/src\/index\.ts$/)?.[1];
        return `chunks/${format ? `${format}-driver` : '[name]'}-[hash].js`;
      },
      manualChunks(id) {
        // JSZip also uses fflate. Give shared compression its own boundary so
        // the optional ZIP compatibility engine cannot absorb it into startup.
        if (id.includes('/node_modules/fflate/')) return 'compression';
        if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf';
        const optional = optionalEngineChunk(id);
        if (optional) return optional;
        // Keep framework code shared without merging unrelated format engines.
        if (/\/node_modules\/(?:@vue\/|vue\/)/.test(id)) return 'vue';
        if (id.includes('/node_modules/three/')) return 'three';
        // Let Rollup derive the remaining boundaries from the actual import graph.
        // Grouping whole workspace packages would merge their lightweight routes
        // and heavyweight renderers, making the dynamic imports eager again.
      }
    } }
  }
});
