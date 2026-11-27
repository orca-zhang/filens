type PageBreak = 'page' | 'lastRenderedPageBreak';
type HeaderFooterType = 'default' | 'first' | 'even';

interface HeaderFooterReference { type: HeaderFooterType; id: string }

interface SectionProperties {
  type?: string;
  pageSize?: { width?: string | null; height?: string | null; orientation?: string | null };
  pageMargins?: Record<string, string | null>;
  pageNumber?: { start?: number | null };
  titlePage?: boolean;
  headerRefs?: HeaderFooterReference[];
  footerRefs?: HeaderFooterReference[];
}

interface DocxElement {
  type: string;
  children?: DocxElement[];
  styleName?: string;
  pageBreakBefore?: boolean;
  sectionProps?: SectionProperties;
  break?: string;
}

interface DocxStyle {
  id?: string;
  target?: string;
  isDefault?: boolean;
  basedOn?: string;
  paragraphProps?: { pageBreakBefore?: boolean };
}

interface SectionFragment {
  elements: DocxElement[];
  sectProps?: SectionProperties;
  pageBreak: boolean;
}

interface Page {
  sections: { elements: DocxElement[]; sectProps: SectionProperties }[];
  props: SectionProperties;
  headerFooterType: HeaderFooterType | null;
}

interface Fragment { children: DocxElement[]; pageBreak?: PageBreak }

const inlineContainers = new Set(['run', 'hyperlink', 'smartTag', 'inserted']);
const headerFooterTypes: readonly HeaderFooterType[] = ['default', 'first', 'even'];

/** Keep the authored values because docx-preview merges its style objects during rendering. */
export function createDocxPagination(document: {
  stylesPart?: { styles?: readonly DocxStyle[] };
  settingsPart?: { settings?: { evenAndOddHeaders?: boolean } };
}) {
  const evenAndOddHeaders = document.settingsPart?.settings?.evenAndOddHeaders;
  const styles = new Map<string, { basedOn?: string; pageBreakBefore?: boolean }>();
  let defaultStyle: string | undefined;
  for (const style of document.stylesPart?.styles ?? []) {
    if (!style.id || style.target !== 'p') continue;
    styles.set(style.id, { basedOn: style.basedOn, pageBreakBefore: style.paragraphProps?.pageBreakBefore });
    if (style.isDefault) defaultStyle = style.id;
  }
  const inheritedBreaks = new Map<string, boolean>();
  const styleBreak = (name: string | undefined): boolean => {
    if (!name) return false;
    const inherited = inheritedBreaks.get(name);
    if (inherited !== undefined) return inherited;
    const visited = new Set<string>();
    let id: string | undefined = name, pageBreak = false;
    while (id && !visited.has(id)) {
      visited.add(id);
      const style = styles.get(id);
      const candidate = inheritedBreaks.get(id) ?? style?.pageBreakBefore;
      if (candidate !== undefined) { pageBreak = candidate; break; }
      id = style?.basedOn;
    }
    for (const id of visited) inheritedBreaks.set(id, pageBreak);
    return pageBreak;
  };

  return (elements: readonly DocxElement[] = [], defaultProps: SectionProperties = {}, processElement: (element: DocxElement) => void): Page[] => {
    let current: SectionFragment = { elements: [], pageBreak: false };
    const sections = [current];
    const finish = (pageBreak: boolean, sectProps?: SectionProperties) => {
      current.pageBreak = pageBreak;
      current.sectProps = sectProps;
      current = { elements: [], pageBreak: false };
      sections.push(current);
    };

    for (const element of elements) {
      if (element.type !== 'paragraph') { current.elements.push(element); continue; }
      if (element.pageBreakBefore ?? styleBreak(element.styleName ?? defaultStyle)) {
        if (current.elements.length) finish(true);
        else if (sections.length > 1) sections[sections.length - 2].pageBreak = true;
      }
      const fragments = splitInline(element.children ?? []);
      if (!fragments) {
        current.elements.push(element);
        if (element.sectionProps) finish(false, element.sectionProps);
        continue;
      }
      for (const { children, pageBreak } of fragments) {
        if (children.length || pageBreak === 'page') {
          const paragraph = { ...element, children };
          processElement(paragraph);
          current.elements.push(paragraph);
        }
        if (pageBreak) {
          if (current.elements.length) finish(true);
          else if (sections.length > 1) sections[sections.length - 2].pageBreak = true;
        }
      }
      if (element.sectionProps) {
        if (current.elements.length) finish(false, element.sectionProps);
        else (sections[sections.length - 2] ?? current).sectProps = element.sectionProps;
      }
    }

    return paginateSections(sections, defaultProps, evenAndOddHeaders);
  };
}

function paginateSections(sections: SectionFragment[], defaultProps: SectionProperties, evenAndOddHeaders = false): Page[] {
  let following = defaultProps;
  for (let i = sections.length - 1; i >= 0; i--) {
    const authored = sections[i].sectProps;
    if (authored) {
      following = authored.type === 'continuous' ? {
        ...authored,
        pageSize: authored.pageSize ?? following.pageSize,
        pageMargins: authored.pageMargins ?? following.pageMargins
      } : authored;
    }
    sections[i].sectProps = following;
  }

  const pages: Page[] = [];
  let previousSection: SectionProperties | undefined;
  let props: SectionProperties = {};
  let previousPageBreak = false, pageNumber = 0;
  for (const fragment of sections) {
    const section = fragment.sectProps!;
    const startsSection = section !== previousSection;
    const previousProps = props;
    if (startsSection) {
      props = {
        ...section,
        headerRefs: inheritReferences(section.headerRefs, previousProps.headerRefs),
        footerRefs: inheritReferences(section.footerRefs, previousProps.footerRefs)
      };
    }
    const sectionBreak = startsSection && (
      (props.type !== 'continuous' && props.type !== 'nextColumn') || hasPaperChange(previousProps, props)
    );
    if (!pages.length || previousPageBreak || sectionBreak) {
      const parity = props.type === 'evenPage' ? 0 : props.type === 'oddPage' ? 1 : undefined;
      if (pages.length && startsSection && parity !== undefined && (pages.length + 1) % 2 !== parity) {
        pages.push({ sections: [], props: pages[pages.length - 1].props, headerFooterType: null });
        pageNumber++;
      }
      // Word chooses header and footer parity from the section's page numbering.
      const start = startsSection ? props.pageNumber?.start : undefined;
      pageNumber = typeof start === 'number' && Number.isSafeInteger(start) ? start : pageNumber + 1;
      const headerFooterType = startsSection && props.titlePage ? 'first'
        : evenAndOddHeaders && pageNumber % 2 === 0 ? 'even' : 'default';
      pages.push({ sections: [], props, headerFooterType });
    }
    pages[pages.length - 1].sections.push({ elements: fragment.elements, sectProps: props });
    previousSection = section;
    previousPageBreak = fragment.pageBreak;
  }
  return pages;
}

function inheritReferences(refs: HeaderFooterReference[] = [], previous: HeaderFooterReference[] = []): HeaderFooterReference[] {
  if (!refs.length) return previous;
  return headerFooterTypes.flatMap(type => refs.find(ref => ref.type === type)
    ?? previous.find(ref => ref.type === type) ?? []);
}

function hasPaperChange(previous: SectionProperties, next: SectionProperties): boolean {
  return previous.pageSize?.width !== next.pageSize?.width
    || previous.pageSize?.height !== next.pageSize?.height
    || (previous.pageSize?.orientation ?? 'portrait') !== (next.pageSize?.orientation ?? 'portrait');
}

/** Allocate new child lists only when a page break actually divides this inline sequence. */
function splitInline(nodes: readonly DocxElement[]): Fragment[] | undefined {
  let fragments: Fragment[] | undefined, children: DocxElement[] | undefined;
  for (const [index, node] of nodes.entries()) {
    const pageBreak = node.type === 'break' && (node.break === 'page' || node.break === 'lastRenderedPageBreak')
      ? node.break : undefined;
    const nested = inlineContainers.has(node.type) && node.children ? splitInline(node.children) : undefined;
    if (!pageBreak && !nested) { children?.push(node); continue; }
    fragments ??= [];
    children ??= nodes.slice(0, index);
    if (pageBreak) {
      fragments.push({ children, pageBreak });
      children = [];
    } else for (const fragment of nested!) {
      if (fragment.children.length) children.push({ ...node, children: fragment.children });
      if (fragment.pageBreak) {
        fragments.push({ children, pageBreak: fragment.pageBreak });
        children = [];
      }
    }
  }
  if (children?.length) fragments!.push({ children });
  return fragments;
}
