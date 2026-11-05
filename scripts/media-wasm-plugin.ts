import { readFile } from 'node:fs/promises';

/** Keep the optional HEIF decoder separate in library mode. */
export function mediaWasmAsset() {
  return [
    libraryAsset('/converter-client/vendor/libheif/libheif.wasm?url', 'libheif.wasm'),
    libraryAsset('/wasm/converter-image/dist/converter-image.wasm?url', 'converter-image.wasm'),
    {
      name: 'filens-image-core-notices', apply: 'build' as const,
      async generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): string }) {
        this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: (await Promise.all([
          '../wasm/converter-image/THIRD-PARTY-NOTICES.txt',
          '../packages/converter-client/vendor/libheif/NOTICE.txt',
          '../packages/converter-client/vendor/libheif/COPYING.libheif',
          '../packages/converter-client/vendor/libheif/COPYING.libde265'
        ].map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n\n') });
      }
    }
  ];
}

/** Keep PDF's existing worker as a file instead of a Base64 URL module. */
export function pdfWorkerAsset() {
  return libraryAsset('/pdfjs-dist/build/pdf.worker.min.mjs?url', 'pdf.worker.min.mjs');
}

/** Emit both variants separately; the loader fetches only the selected one. */
export function formatDetectorWasmAssets() {
  return [
    libraryAsset('/wasm/format-detector/dist/converter-detect-scalar.wasm?url', 'converter-detect-scalar.wasm'),
    libraryAsset('/wasm/format-detector/dist/converter-detect-simd.wasm?url', 'converter-detect-simd.wasm'),
  ];
}

function libraryAsset(suffix: string, name: string) {
  return {
    name: `filens-library-asset:${name}`, apply: 'build' as const, enforce: 'pre' as const,
    async load(this: { emitFile(asset: { type: 'asset'; name: string; source: Uint8Array }): string }, id: string) {
      if (!id.replaceAll('\\', '/').endsWith(suffix)) return;
      const reference = this.emitFile({ type: 'asset', name, source: await readFile(id.slice(0, -4)) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    }
  };
}
