import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { mediaWasmAsset } from '../../scripts/media-wasm-plugin';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    sourcemap: true,
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
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      insertTypesEntry: true
    })
  ]
});
