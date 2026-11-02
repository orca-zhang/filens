import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

/** The archive engine is always a sidecar, including library/all-in-one builds.
 * Vite's library mode otherwise inlines even large WASM assets in workers. */
export function archiveEngineAssets(): Plugin {
  let build = false;
  let base = '/';
  return {
    name: 'filens-external-archive-engine',
    enforce: 'pre',
    configResolved(config) {
      build = config.command === 'build';
      base = config.base;
    },
    async load(id) {
      if (!id.replaceAll('\\', '/').endsWith('/archive/vendor/7zip/7zz.wasm?archive-url')) return;
      const file = id.slice(0, -'?archive-url'.length);
      if (!build) {
        return `export default () => new URL(${JSON.stringify(`${base}@fs/${file}`)}, globalThis.location.href).href;`;
      }
      const reference = this.emitFile({ type: 'asset', fileName: 'archive/7zz.wasm', source: await readFile(file) });
      // Delay URL resolution so an embedded HTML can still preview ordinary
      // documents from a blob module without fetching optional archive assets.
      return `export default () => import.meta.ROLLUP_FILE_URL_${reference};`;
    },
    transform(code, id) {
      if (!build || !id.replaceAll('\\', '/').endsWith('/archive/vendor/7zip/7zz.js')) return;
      const fallback = 'return new URL("7zz.wasm",import.meta.url).href';
      if (!code.includes(fallback)) this.error('The archive engine changed its asset loader; verify that its WASM stays external.');
      // The host always supplies locateFile. Remove the unreachable fallback
      // before Vite turns its URL into a second base64 copy of the WASM.
      return { code: code.replace(fallback, 'throw new Error("The archive host must supply the external WASM URL.")'), map: null };
    }
  };
}
