import type { Plugin } from 'vite';
import { createRequire } from 'node:module';

/** Share compression across formats, including copies hidden in vendor builds. */
export function sharedCompression(): Plugin {
  const jszipSource = createRequire(import.meta.url).resolve('jszip');
  let build = false;
  return {
    name: 'filens-shared-compression',
    enforce: 'pre',
    config() {
      return { resolve: { dedupe: ['jszip', 'fflate', 'pako', '@zip.js/zip.js'] } };
    },
    configResolved(config) {
      build = config.command === 'build';
    },
    async resolveId(id, importer) {
      // JSZip's browser distribution embeds pako. Use its original modules so
      // TIFF and every ZIP-based format share the same installed pako instead.
      // In dev, let Vite prebundle CommonJS normally; source modules are for
      // production Rollup, which can share their transitive dependencies.
      if (build && id === 'jszip') return jszipSource;
      // Three 0.176 vendors fflate 0.8.2, also used by document/archive parsers.
      const direct = id === 'three/examples/jsm/libs/fflate.module.js';
      const fromThree = id === '../libs/fflate.module.js' &&
        importer?.replaceAll('\\', '/').includes('/three/examples/jsm/');
      if (direct || fromThree) return this.resolve('fflate', importer, { skipSelf: true });
    },
    generateBundle() {
      if ([...this.getModuleIds()].some(id => id.replaceAll('\\', '/').endsWith('/jszip/dist/jszip.min.js'))) {
        this.error('JSZip must use shared compression dependencies instead of its bundled browser copy.');
      }
    }
  };
}
