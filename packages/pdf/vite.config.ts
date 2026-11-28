import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import { packageDeclarations } from '../../scripts/package-declarations';
import { pdfDocumentPages, pdfWorkerAsset } from '../../scripts/pdf-worker-asset';

const external = packageExternals(import.meta.url);

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
      external: id => id !== 'pdfjs-dist' && external(id)
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  },
  plugins: [
    pdfDocumentPages(),
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
