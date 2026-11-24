import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import { packageDeclarations } from '../../scripts/package-declarations';

export default defineConfig({
  build: {
    lib: {
      cssFileName: 'style',
      entry: { index: './src/index.ts', 'preview-runtime': './src/preview-runtime.ts', zip: './src/zip.ts', 'archive-volumes': './src/archive-volumes.ts' },
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
    setupFiles: []
  },
  plugins: [
    packageDeclarations({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ]
});
