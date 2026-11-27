import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vitest/config';
import { packageDeclarations } from '../../scripts/package-declarations';
import { packageExternals } from '../../scripts/package-externals';

const coreEntries = Object.fromEntries(['presentation-support', 'preview-runtime', 'zip'].map(entry => [
  `@filens/core/${entry}`, fileURLToPath(new URL(`../core/src/${entry}.ts`, import.meta.url))
]));

export default defineConfig({
  build: {
    lib: { entry: './src/index.ts', formats: ['es'], fileName: () => 'index.js', cssFileName: 'style' },
    sourcemap: 'hidden',
    rollupOptions: { external: packageExternals(import.meta.url) }
  },
  test: { environment: 'jsdom', globals: true, alias: coreEntries },
  plugins: [{
    name: 'pptx-decoder-notices',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt',
        source: await readFile(new URL('./vendor/libeot/NOTICE.txt', import.meta.url)) });
    }
  }, packageDeclarations({
    include: ['src/**/*.ts', '../core/src/utif.d.ts'],
    entryRoot: 'src',
    insertTypesEntry: true,
    pathsToAliases: false,
    compilerOptions: {
      declarationMap: false,
      paths: {
        ...Object.fromEntries(Object.entries(coreEntries).map(([name, file]) => [name, [file]])),
        '@filens/pptx': [fileURLToPath(new URL('./src/index.ts', import.meta.url))]
      }
    }
  })]
});
