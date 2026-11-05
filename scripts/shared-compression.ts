import type { Plugin } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Share compression across formats, including copies hidden in vendor builds. */
export function sharedCompression(): Plugin {
  const jszipSource = createRequire(import.meta.url).resolve('jszip');
  const jszipFlate = fileURLToPath(new URL('./jszip-flate.mjs', import.meta.url));
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
      // Use JSZip's original modules so its DEFLATE encoder can reuse fflate.
      // In dev, let Vite prebundle CommonJS normally; source modules are for
      // production Rollup, which can share their transitive dependencies.
      if (build && id === 'jszip') return jszipSource;
      if (build && id === 'pako') {
        const from = importer?.replaceAll('\\', '/');
        if (from?.endsWith('/jszip/lib/flate.js')) return jszipFlate;
        if (from?.endsWith('/utif/UTIF.js')) return this.resolve('pako/lib/inflate.js', importer, { skipSelf: true });
      }
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
      if ([...this.getModuleIds()].some(id => /\/pako\/lib\/(?:zlib\/)?deflate\.js/.test(id.replaceAll('\\', '/')))) {
        this.error('JSZip must reuse fflate instead of bundling a second DEFLATE encoder.');
      }
    }
  };
}
