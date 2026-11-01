import type { Plugin } from 'vite';

/** Three 0.176 vendors fflate 0.8.2, also used by our document/archive parsers. */
export function sharedThreeCompression(): Plugin {
  return {
    name: 'filens-shared-three-compression',
    enforce: 'pre',
    async resolveId(id, importer) {
      const direct = id === 'three/examples/jsm/libs/fflate.module.js';
      const fromThree = id === '../libs/fflate.module.js' &&
        importer?.replaceAll('\\', '/').includes('/three/examples/jsm/');
      if (direct || fromThree) return this.resolve('fflate', importer, { skipSelf: true });
    }
  };
}
