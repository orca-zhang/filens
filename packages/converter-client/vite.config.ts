import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { formatDetectorWasmAssets, mediaWasmAsset } from '../../scripts/media-wasm-plugin';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: { index: './src/index.ts', 'format-detector-auto': './src/format-detector-auto.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    sourcemap: 'hidden',
    rollupOptions: {
      external: packageExternals(import.meta.url)
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
  plugins: [
    {
      name: 'filens-postscript-notices',
      async generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'converter-postscript-NOTICES.txt', source: await readFile(new URL('../../wasm/converter-core/THIRD-PARTY-NOTICES.txt', import.meta.url), 'utf8') });
      }
    },
    mediaWasmAsset(),
    formatDetectorWasmAssets(),
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ]
});
