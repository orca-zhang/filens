import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { archiveEngineAssets } from '../../scripts/archive-engine-assets';

export default defineConfig({
  base: './',
  worker: { plugins: () => [archiveEngineAssets()], rollupOptions: { output: { inlineDynamicImports: true } } },
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
    archiveEngineAssets(),
    dts({
      include: ['src/**/*.ts'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ]
});
