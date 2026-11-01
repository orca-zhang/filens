import { readFile } from 'node:fs/promises';

/** Keep the optional HEIF decoder separate in library mode. */
export function mediaWasmAsset() {
  return libraryAsset('/libheif-js/libheif-wasm/libheif.wasm?url', 'libheif.wasm');
}

/** Keep PDF's existing worker as a file instead of a Base64 URL module. */
export function pdfWorkerAsset() {
  return libraryAsset('/pdfjs-dist/build/pdf.worker.min.mjs?url', 'pdf.worker.min.mjs');
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
