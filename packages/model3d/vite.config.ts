import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  base: './',
  resolve: {
    preserveSymlinks: true
  },
  build: {
    lib: {
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
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ]
});
