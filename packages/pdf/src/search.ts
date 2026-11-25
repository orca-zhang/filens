import type { TextLayer } from 'pdfjs-dist';

export const PDF_SEARCH_MATCH_LIMIT = 10_000;
export interface PdfTextMatch { pageIndex: number; start: number; end: number; }

/** Offsets follow PDF.js textDivs, including empty text items and excluding marked-content records. */
export function indexPdfText(items: readonly ({ str?: string; hasEOL?: boolean } | { type: string })[]) {
  let text = '';
  const offsets: number[] = [];
  for (const item of items) {
    if (!('str' in item) || typeof item.str !== 'string') continue;
    offsets.push(text.length);
    text += item.str + (item.hasEOL ? ' ' : '');
  }
  return { text, offsets };
}

export function findPdfText(text: string, query: string, pageIndex: number, limit: number): PdfTextMatch[] {
  if (!query.trim() || limit <= 0) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const matches: PdfTextMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    matches.push({ pageIndex, start: match.index!, end: match.index! + match[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}

export function highlightPdfText(layer: TextLayer, offsets: number[], matches: PdfTextMatch[], active?: PdfTextMatch): void {
  let next = 0;
  for (const [index, div] of layer.textDivs.entries()) {
    const text = layer.textContentItemsStr[index];
    const start = offsets[index], end = start + text.length;
    while (next < matches.length && matches[next].end <= start) next++;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (let hit = next; hit < matches.length && matches[hit].start < end; hit++) {
      const match = matches[hit];
      const from = Math.max(0, match.start - start), to = Math.min(text.length, match.end - start);
      if (to <= from) continue;
      fragment.append(document.createTextNode(text.slice(cursor, from)));
      const mark = document.createElement('mark');
      mark.className = 'pdfv-search-match';
      mark.classList.toggle('is-active', match === active);
      mark.textContent = text.slice(from, to);
      fragment.append(mark);
      cursor = to;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    div.replaceChildren(fragment);
  }
}
