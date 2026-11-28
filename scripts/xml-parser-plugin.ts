import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Preview builds use the XML parser and validator. */
export function xmlParserOnly(): Plugin {
  const source = import.meta.resolve('fast-xml-parser');
  const parser = fileURLToPath(new URL('./xmlparser/XMLParser.js', source));
  const validator = fileURLToPath(new URL('./validator.js', source));
  const entry = '\0filens:xml-parser';
  return {
    name: 'filens-xml-parser-only',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) { if (id === 'fast-xml-parser') return entry; },
    load(id) {
      if (id === entry) return `export {default as XMLParser} from ${JSON.stringify(parser)};
export * as XMLValidator from ${JSON.stringify(validator)};`;
    },
    generateBundle() {
      if ([...this.getModuleIds()].some(id => id.replaceAll('\\', '/').includes('/fast-xml-parser/src/xmlbuilder/'))) {
        this.error('Read-only previews must not include the unused XML builder.');
      }
    }
  };
}
