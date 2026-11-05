import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import { readFileSync, readdirSync } from 'node:fs';
import dts from 'vite-plugin-dts';

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
  plugins: [dts({ compilerOptions: { declarationMap: false }, insertTypesEntry: true }), { name: 'media-engine-license', generateBundle() {
    const directory = new URL('./src/engine-snapshot/types/', import.meta.url);
    for (const name of readdirSync(directory, { recursive: true }).map(String).filter(name => /\.d\.(ts|mts)$/.test(name)))
      this.emitFile({ type: 'asset', fileName: `engine-snapshot/types/${name}`,
        source: readFileSync(new URL(name, directory), 'utf8').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '\n') });
    this.emitFile({ type: 'asset', fileName: 'MP4Box-LICENSE.txt', source: readFileSync(new URL('./src/engine-snapshot/MP4Box-LICENSE.txt', import.meta.url)) });
  } }],
  build: {
    cssCodeSplit: false,
    lib: {
      entry: { index: './src/index.ts', engine: './src/engine.ts', routes: './src/routes.ts', codecs: './src/codec-preview-driver.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    sourcemap: 'hidden',
    rollupOptions: {
      external: packageExternals(import.meta.url)
    }
  }
});
