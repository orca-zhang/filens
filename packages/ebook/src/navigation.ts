import { resolveArchivePath } from './epub-resources';

export interface ChapterLocation {
  index: number;
  fragment?: string;
}

export interface ContentsEntry {
  title: string;
  location?: ChapterLocation;
  children: ContentsEntry[];
}

export function resolveChapterLocation(href: string, base: string, chapters: ReadonlyMap<string, number>, current?: number): ChapterLocation | undefined {
  const value = href.trim().replace(/^about:srcdoc(?=#)/i, '');
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i.test(value)) return undefined;
  const path = value.split(/[?#]/, 1)[0];
  const index = path ? chapters.get(resolveArchivePath(base, path)) : current;
  if (index === undefined) return undefined;
  const hash = value.indexOf('#');
  return { index, fragment: hash >= 0 ? value.slice(hash + 1) : undefined };
}

export function parseContents(document: Document, ncx: boolean, locate: (href: string) => ChapterLocation | undefined): ContentsEntry[] {
  const contents: ContentsEntry[] = [];
  const byElement = new Map<Element, ContentsEntry>();
  const add = (element: Element, parent: Element | null, label: Element | undefined, href: string | null | undefined) => {
    const title = label?.textContent?.replace(/\s+/g, ' ').trim();
    if (!title) return;
    const location = href ? locate(href) : undefined;
    const entry = { title, location, children: [] };
    (parent && byElement.get(parent)?.children || contents).push(entry);
    byElement.set(element, entry);
  };
  if (ncx) {
    const map = document.getElementsByTagNameNS('*', 'navMap')[0];
    for (const point of Array.from(map?.getElementsByTagNameNS('*', 'navPoint') ?? [])) {
      const children = Array.from(point.children);
      add(point, point.parentElement, children.find(child => child.localName === 'navLabel'),
        children.find(child => child.localName === 'content')?.getAttribute('src'));
    }
  } else {
    const navs = Array.from(document.getElementsByTagNameNS('*', 'nav'));
    const toc = navs.find(element => (element.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? element.getAttribute('epub:type'))?.split(/\s+/).includes('toc')
      || element.getAttribute('role') === 'doc-toc') ?? navs[0] ?? document.documentElement;
    for (const element of toc.querySelectorAll('li, a[href]')) {
      if (element.localName === 'li') {
        const label = Array.from(element.children).find(child => child.localName === 'a' || child.localName === 'span');
        add(element, element.parentElement?.closest('li') ?? null, label, label?.getAttribute('href'));
      } else {
        const parent = element.closest('li');
        if (!parent || !byElement.has(parent)) add(element, parent, element, element.getAttribute('href'));
      }
    }
  }
  return contents;
}
