import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import { packageDeclarations } from '../../scripts/package-declarations';
import { pdfWorkerAsset } from '../../scripts/media-wasm-plugin';

export default defineConfig({
  base: './',
  build: {
    lib: {
      cssFileName: 'style',
      entry: { index: './src/index.ts', routes: './src/routes.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    cssCodeSplit: false,
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
    pdfWorkerAsset(),
    packageDeclarations({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ]
});
