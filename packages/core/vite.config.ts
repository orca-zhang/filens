import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: { index: './src/index.ts', zip: './src/zip.ts', 'archive-volumes': './src/archive-volumes.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: { external: packageExternals(import.meta.url) }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  },
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      insertTypesEntry: true
    })
  ]
});
