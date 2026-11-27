import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

/** Connect the pinned DOCX renderer to our ZIP reader and pagination. */
export function docxPreviewZip({ notice = false } = {}): Plugin {
  const modulePath = '/docx-preview/dist/docx-preview.mjs';
  const bindings = [
    ['const zip = await JSZip.loadAsync(input);', 'const zip = options.filensZip ?? await JSZip.loadAsync(input);'],
    ['case "defaultTabStop":',
      `case "evenAndOddHeaders":
                result.evenAndOddHeaders = xml.boolAttr(el, "val", true);
                break;
            case "defaultTabStop":`],
    ['const sections = this.splitBySection(document.children, document.props);\n        const pages = this.groupByPageBreaks(sections);',
      `const pages = this.options.filensPaginate
            ? this.options.filensPaginate(document.children, document.props, element => this.processElement(element))
            : this.groupByPageBreaks(this.splitBySection(document.children, document.props))
                .map(sections => ({ sections, props: sections[0].sectProps }));`],
    ['const section = pages[i][0];\n            let props = section.sectProps;',
      'const { sections, props: pageProps, headerFooterType } = pages[i];\n            let props = pageProps;'],
    ['this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement);',
      'this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement, headerFooterType);'],
    ['for (const sect of pages[i])', 'for (const sect of sections)'],
    ['this.options.renderFooters && this.renderHeaderFooter(props.footerRefs, props, result.length, prevProps != props, pageElement);',
      `const footerProps = headerFooterType === undefined ? props : pageProps;
            this.options.renderFooters && this.renderHeaderFooter(footerProps.footerRefs, footerProps, result.length, prevProps != footerProps, pageElement, headerFooterType);`],
    ['renderHeaderFooter(refs, props, page, firstOfSection, into)', 'renderHeaderFooter(refs, props, page, firstOfSection, into, type)'],
    ['var ref = (props.titlePage && firstOfSection ? refs.find(x => x.type == "first") : null)',
      'var ref = type !== undefined ? refs.find(x => x.type === type) : (props.titlePage && firstOfSection ? refs.find(x => x.type == "first") : null)']
  ];
  let license: URL | undefined;
  return {
    name: 'filens-docx-preview-zip',
    enforce: 'pre',
    config() {
      return { optimizeDeps: { exclude: ['docx-preview'], include: ['jszip'] } };
    },
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith(modulePath)) return;
      for (const [original, replacement] of bindings) {
        if (!code.includes(original) || code.indexOf(original) !== code.lastIndexOf(original)) {
          this.error('The docx-preview integration changed. Verify its adapters before updating the dependency.');
        }
        code = code.replace(original, replacement);
      }
      if (notice) license = new URL('../LICENSE', import.meta.resolve('docx-preview'));
      return { code, map: null };
    },
    async generateBundle() {
      if (notice && license) {
        this.emitFile({ type: 'asset', fileName: 'docx-preview-LICENSE.txt', source: await readFile(license) });
      }
    }
  };
}
