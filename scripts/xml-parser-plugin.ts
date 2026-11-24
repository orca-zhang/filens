import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Preview only reads XML; expose the original parser without its unused builder. */
export function xmlParserOnly(): Plugin {
  const parser = fileURLToPath(new URL('./xmlparser/XMLParser.js', import.meta.resolve('fast-xml-parser')));
  const entry = '\0filens:xml-parser';
  return {
    name: 'filens-xml-parser-only',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) { if (id === 'fast-xml-parser') return entry; },
    load(id) { if (id === entry) return `export {default as XMLParser} from ${JSON.stringify(parser)};`; },
    generateBundle() {
      if ([...this.getModuleIds()].some(id => id.replaceAll('\\', '/').includes('/fast-xml-parser/src/xmlbuilder/'))) {
        this.error('Read-only previews must not include the unused XML builder.');
      }
    }
  };
}
