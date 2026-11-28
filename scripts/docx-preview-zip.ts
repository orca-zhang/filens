import { readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

/** Connect the pinned DOCX renderer to our ZIP reader and pagination. */
export function docxPreviewZip({ notice = false } = {}): Plugin {
  const modulePath = '/docx-preview/dist/docx-preview.mjs';
  const bindings = [
    ['const zip = await JSZip.loadAsync(input);', 'const zip = options.filensZip ?? await JSZip.loadAsync(input);'],
    ['case "keepLines":\n            props.keepLines',
      `case "widowControl":
            props.widowControl = xml.boolAttr(elem, "val", true);
            break;
        case "keepLines":
            props.keepLines`],
    ['var pPr = globalXmlParser.element(c, "pPr");\n                    if (pPr)',
      `var pPr = globalXmlParser.element(c, "pPr");
                    if (pPr) result.paragraphProps = parseParagraphProperties(pPr, globalXmlParser);
                    if (pPr)`],
    ['result.element = element;\n        for (const c of globalXmlParser.elements(node)) {\n            switch (c.localName) {',
      `result.element = element;
        for (const c of globalXmlParser.elements(node)) {
            switch (c.localName) {
                case "smartTag":
                    result.children.push(this.parseSmartTag(c, result));
                    break;`],
    ['row.isHeader = globalXmlParser.boolAttr(c, "val");', 'row.isHeader = globalXmlParser.boolAttr(c, "val", true);'],
    ['this.currentCellPosition.row++;\n        return result;',
      `this.currentCellPosition.row++;
        if (elem.filensRepeatedHeader) for (const anchor of result.querySelectorAll("[id]")) anchor.removeAttribute("id");
        return result;`],
    ['case "cols":\n                section.columns = parseColumns(e, xml);',
      `case "bidi":
                section.bidi = xml.boolAttr(e, "val", true);
                break;
            case "footnoteColumns":
                if (e.namespaceURI === "http://schemas.microsoft.com/office/word/2012/wordml")
                    section.footnoteColumns = xml.intAttr(e, "val");
                break;
            case "cols":
                section.columns = parseColumns(e, xml);`],
    ['case "defaultTabStop":',
      `case "evenAndOddHeaders":
                result.evenAndOddHeaders = xml.boolAttr(el, "val", true);
                break;
            case "compat": {
                const noBalance = xml.element(el, "noColumnBalance");
                if (noBalance) result.noColumnBalance = xml.boolAttr(noBalance, "val", true);
                const mode = xml.elements(el, "compatSetting").find(setting =>
                    xml.attr(setting, "name") === "compatibilityMode" &&
                    xml.attr(setting, "uri") === "http://schemas.microsoft.com/office/word");
                if (mode) result.compatibilityMode = xml.intAttr(mode, "val");
                break;
            }
            case "defaultTabStop":`],
    ['case "numFmt":\n                result.nummeringFormat',
      `case "pos":
                result.position = xml.attr(el, "val");
                break;
            case "numFmt":
                result.nummeringFormat`],
    ['const sections = this.splitBySection(document.children, document.props);\n        const pages = this.groupByPageBreaks(sections);',
      `const pages = this.options.filensPaginate
            ? this.options.filensPaginate(document.children, document.props, element => this.processElement(element))
            : this.groupByPageBreaks(this.splitBySection(document.children, document.props))
                .map(sections => ({ sections, props: sections[0].sectProps }));`],
    ['const section = pages[i][0];\n            let props = section.sectProps;',
      'const { sections, props: pageProps, headerFooterType } = pages[i];\n            let props = pageProps;'],
    ['let prevProps = null;\n        for (let i = 0, l = pages.length;',
      'let prevProps = null, endnoteOffset = 0;\n        for (let i = 0, l = pages.length;'],
    ['this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement);',
      'this.renderHeaderFooter(props.headerRefs, props, result.length, prevProps != props, pageElement, headerFooterType);'],
    ['for (const sect of pages[i])', `const sharedFlow = this.options.filensSharedFlow?.(sections);
            if (sharedFlow) pageElement.classList.add("docxv-shared-page");
            for (const sect of sections)`],
    ['this.renderElements(sect.elements, contentElement);',
      `if (this.options.filensRenderColumns) {
                    this.options.filensRenderColumns(contentElement, sect, (elements, into) => this.renderElements(elements, into), sections.length === 1 || sharedFlow);
                } else this.renderElements(sect.elements, contentElement);`],
    ['props = sect.sectProps;\n            }',
      `props = sect.sectProps;
                if (this.options.renderEndnotes && sect.endnotes) {
                    const { section, props } = sect.endnotes;
                    endnoteOffset = this.renderEndnoteGroup(pageElement, props, pages[i].number ?? i + 1,
                        document.cssStyle, endnoteOffset, section);
                }
            }`],
    ['this.options.renderFooters && this.renderHeaderFooter(props.footerRefs, props, result.length, prevProps != props, pageElement);',
      `const footerProps = headerFooterType === undefined ? props : pageProps;
            this.options.renderFooters && this.renderHeaderFooter(footerProps.footerRefs, footerProps, result.length, prevProps != footerProps, pageElement, headerFooterType);`],
    ['result.push(pageElement);', `this.options.filensPageFrames?.(pageElement, sections, pages[i].number ?? i + 1, sharedFlow,
                (section, type) => this.createPageFrame(section, document.cssStyle, type));
            result.push(pageElement);`],
    ['this.renderNotes(this.currentFootnoteIds, this.footnoteMap, pageElement);',
      `const list = this.renderNotes(this.currentFootnoteIds, this.footnoteMap, pageElement, "footnotes");
                if (list) this.options.filensFootnoteColumns?.(list, pageProps);
                if (list && this.currentFootnoteIds.some(id => this.options.filensLongFootnotes?.has(id))) {
                    this.options.filensFootnotes(list, this.createNotePages(pageProps, pages[i].number ?? i + 1, document.cssStyle),
                        this.currentFootnoteIds.map(id => this.footnoteMap[id]).filter(Boolean));
                }`],
    ['this.renderNotes(this.currentEndnoteIds, this.endnoteMap, pageElement);',
      'this.renderEndnoteGroup(pageElement, props, pages[i].number ?? i + 1, document.cssStyle, endnoteOffset);'],
    ['renderNotes(noteIds, notesMap, into) {', `renderEndnoteGroup(page, props, number, style, offset, section) {
        const ids = this.currentEndnoteIds.slice(offset);
        const list = this.renderNotes(ids, this.endnoteMap, page, "endnotes");
        if (list) {
            list.start = offset + 1;
            this.options.filensEndnotes?.(list, this.createNotePages(props, number, style),
                ids.map(id => this.endnoteMap[id]).filter(Boolean), section);
        }
        return offset + ids.length;
    }
    createPageFrame(props, style, type) {
        const page = this.createPageElement(this.className, props);
        this.renderStyleValues(style, page);
        this.options.renderHeaders && this.renderHeaderFooter(props.headerRefs, props, 0, false, page, type);
        this.options.renderFooters && this.renderHeaderFooter(props.footerRefs, props, 0, false, page, type);
        return page;
    }
    createNotePages(props, pageNumber, style) {
        const even = this.document.settingsPart?.settings?.evenAndOddHeaders;
        return Array.from({ length: even ? 2 : 1 }, (_, offset) => {
            const number = pageNumber + offset + 1;
            const type = even && number % 2 === 0 ? "even" : "default";
            return this.createPageFrame(props, style, type);
        });
    }
    renderNotes(noteIds, notesMap, into, kind) {`],
    ['var result = this.createElement("ol", null, this.renderElements(notes));\n            into.appendChild(result);',
      `var result = this.createElement("ol", null, this.renderElements(notes));
            if (kind === "footnotes") {
                result.dataset.docxFootnotes = "";
                notes.forEach((note, index) => result.children[index].dataset.docxFootnote = note.id);
            } else result.dataset.docxEndnotes = "";
            into.appendChild(result);
            return result;`],
    ['this.currentFootnoteIds.push(elem.id);', 'result.dataset.docxFootnote = elem.id;\n        this.currentFootnoteIds.push(elem.id);'],
    ['this.currentEndnoteIds.push(elem.id);', 'result.dataset.docxEndnote = elem.id;\n        this.currentEndnoteIds.push(elem.id);'],
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
