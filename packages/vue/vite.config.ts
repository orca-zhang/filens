import { packageExternals } from '../../scripts/package-externals';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import path from 'node:path';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: {
      '@filens/xlsx/table': path.resolve(__dirname, '../xlsx/src/table.ts'),
      '@filens/core/preview-runtime': path.resolve(__dirname, '../core/src/preview-runtime.ts'),
      '@filens/media/codecs': path.resolve(__dirname, '../media/src/codec-preview-driver.ts'),
      '@filens/archive/routes': path.resolve(__dirname, '../archive/src/routes.ts'),
      '@filens/cad/routes': path.resolve(__dirname, '../cad/src/routes.ts'),
      '@filens/diagram/routes': path.resolve(__dirname, '../diagram/src/routes.ts'),
      '@filens/design/routes': path.resolve(__dirname, '../design/src/routes.ts'),
      '@filens/docx/routes': path.resolve(__dirname, '../docx/src/routes.ts'),
      '@filens/books/routes': path.resolve(__dirname, '../ebook/src/routes.ts'),
      '@filens/iwork/routes': path.resolve(__dirname, '../iwork/src/routes.ts'),
      '@filens/model3d/routes': path.resolve(__dirname, '../model3d/src/routes.ts'),
      '@filens/media/routes': path.resolve(__dirname, '../media/src/routes.ts'),
      '@filens/mindmap/routes': path.resolve(__dirname, '../mindmap/src/routes.ts'),
      '@filens/panorama/routes': path.resolve(__dirname, '../panorama/src/routes.ts'),
      '@filens/office/routes': path.resolve(__dirname, '../office/src/routes.ts'),
      '@filens/pdf/routes': path.resolve(__dirname, '../pdf/src/routes.ts'),
      '@filens/text/routes': path.resolve(__dirname, '../text/src/routes.ts'),
      '@filens/xlsx/routes': path.resolve(__dirname, '../xlsx/src/routes.ts'),
      '@filens/archive/style.css': path.resolve(__dirname, '../archive/dist/index.css'),
      '@filens/cad/style.css': path.resolve(__dirname, '../cad/dist/index.css'),
      '@filens/core/style.css': path.resolve(__dirname, '../core/dist/index.css'),
      '@filens/diagram/style.css': path.resolve(__dirname, '../diagram/dist/index.css'),
      '@filens/design': path.resolve(__dirname, '../design/dist/index.js'),
      '@filens/docx/style.css': path.resolve(__dirname, '../docx/dist/index.css'),
      '@filens/books/style.css': path.resolve(__dirname, '../ebook/dist/index.css'),
      '@filens/iwork/style.css': path.resolve(__dirname, '../iwork/dist/index.css'),
      '@filens/model3d/style.css': path.resolve(__dirname, '../model3d/dist/index.css'),
      '@filens/media': path.resolve(__dirname, '../media/dist/index.js'),
      '@filens/mindmap/style.css': path.resolve(__dirname, '../mindmap/dist/index.css'),
      '@filens/panorama/style.css': path.resolve(__dirname, '../panorama/dist/index.css'),
      '@filens/office': path.resolve(__dirname, '../office/dist/index.js'),
      '@filens/pdf/style.css': path.resolve(__dirname, '../pdf/dist/index.css'),
      '@filens/text': path.resolve(__dirname, '../text/dist/index.js'),
      '@filens/xlsx/style.css': path.resolve(__dirname, '../xlsx/dist/index.css')
    }
  },
  plugins: [
    vue(),
    dts({
      aliasesExclude: [/^@filens\//],
      include: ['src/**/*.ts', 'src/**/*.vue', 'src/**/*.json'],
      outDir: 'dist',
      entryRoot: 'src',
      compilerOptions: { declarationMap: false },
      insertTypesEntry: true
    })
  ],
  build: {
    lib: {
      entry: './src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js'
    },
    cssCodeSplit: false,
    sourcemap: 'hidden',
    rollupOptions: {
      external: packageExternals(import.meta.url)
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    alias: [{
      find: /^@filens\/pdf$/,
      replacement: path.resolve(__dirname, './test/filens-pdf.mock.ts')
    }]
  }
});
