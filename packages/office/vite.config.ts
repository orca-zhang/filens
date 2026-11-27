import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vite';
import { packageDeclarations } from '../../scripts/package-declarations';

export default defineConfig({
  plugins: [packageDeclarations({ compilerOptions: { declarationMap: false }, insertTypesEntry: true })],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: { index: './src/index.ts', routes: './src/routes.ts' },
      cssFileName: 'style',
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: 'hidden',
    rollupOptions: {
      external: packageExternals(import.meta.url)
    }
  }
});
