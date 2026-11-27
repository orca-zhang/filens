import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const asset = fileURLToPath(new URL('../packages/xlsx/vendor/pcre2/pcre2.wasm', import.meta.url));

export function xlsxRegexAsset(): Plugin {
  return {
    name: 'filens-xlsx-regex-asset', enforce: 'pre', apply: 'build',
    async transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/xlsx/src/formula-regex.ts')) return;
      // Keep URL resolution inside the loader so a blob module can use
      // the copy embedded by the CLI without resolving a relative URL.
      const url = "new URL('../vendor/pcre2/pcre2.wasm', import.meta.url).href";
      if (!code.includes(url)) this.error('The XLSX regex asset URL has changed.');
      const bytes = await readFile(asset);
      const reference = this.emitFile({ type: 'asset', fileName: 'xlsx/pcre2.wasm', source: bytes });
      return { code: code.replace(url, `import.meta.ROLLUP_FILE_URL_${reference}`), map: null };
    }
  };
}
