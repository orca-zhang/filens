import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import { packageDeclarations } from '../../scripts/package-declarations';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const pptx = fileURLToPath(new URL('../pptx/src/index.ts', import.meta.url));
const support = fileURLToPath(new URL('./src/presentation-support.ts', import.meta.url));
const zip = fileURLToPath(new URL('./src/zip.ts', import.meta.url));

export default defineConfig({
  build: {
    lib: {
      cssFileName: 'style',
      entry: {
        index: './src/index.ts',
        'preview-runtime': './src/preview-runtime.ts',
        'presentation-support': './src/presentation-support.ts',
        rendering: './src/rendering.ts',
        zip: './src/zip.ts',
        'archive-volumes': './src/archive-volumes.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    cssCodeSplit: false,
    sourcemap: 'hidden',
    rollupOptions: { external: packageExternals(import.meta.url) }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    alias: { '@filens/pptx': pptx, '@filens/core/presentation-support': support, '@filens/core/zip': zip }
  },
  plugins: [
    {
      name: 'filens-metafile-notices',
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt',
          source: await readFile(new URL('./vendor/metafile/NOTICE.txt', import.meta.url)) });
      }
    },
    packageDeclarations({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      pathsToAliases: false,
      compilerOptions: {
        composite: false,
        declarationMap: false,
        paths: {
          '@filens/pptx': [pptx],
          '@filens/core/presentation-support': [support],
          '@filens/core/preview-runtime': [fileURLToPath(new URL('./src/preview-runtime.ts', import.meta.url))],
          '@filens/core/zip': [zip]
        }
      },
      insertTypesEntry: true
    })
  ]
});
