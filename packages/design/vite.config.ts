import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ compilerOptions: { declarationMap: false }, insertTypesEntry: true })],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: { index: './src/index.ts', routes: './src/routes.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: 'hidden',
    rollupOptions: {
      external: packageExternals(import.meta.url)
    }
  }
});
