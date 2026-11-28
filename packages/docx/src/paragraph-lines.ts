/// <reference lib="es2022.intl" />
import { paragraphText, type DocxElement } from './pagination';

export type FootnoteSpace = (ids: string[]) => number;

export function textGeometry(paragraph: HTMLElement) {
  const document = paragraph.ownerDocument;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const positions: { node: Node; start: number; end: number }[] = [];
  const footnotes: { id: string; end: number }[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const sup = node.nodeName === 'SUP' ? (node as HTMLElement).dataset : undefined;
    const id = sup?.docxFootnote;
    const parent = node.parentElement;
    const value = node.nodeType === Node.TEXT_NODE
      ? parent?.nodeName === 'SUP' && (parent.hasAttribute('data-docx-footnote') || parent.hasAttribute('data-docx-endnote'))
        ? '' : node.nodeValue
      : node.nodeName === 'BR' ? '\n' : id !== undefined || sup?.docxEndnote !== undefined ? '\uFFFC' : '';
    if (!value) continue;
    positions.push({ node, start: text.length, end: text.length + value.length });
    text += value;
    if (id !== undefined) footnotes.push({ id, end: text.length });
  }
  if (!text.length) return undefined;
  const range = document.createRange();
  const position = (offset: number) => {
    let low = 0, high = positions.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle].end < offset) low = middle + 1;
      else high = middle;
    }
    return positions[low];
  };
  const fittingOffset = (fits: (offset: number) => boolean, start = 0) => {
    // Keep each probe near the current page even for a very long paragraph.
    let low = start, high = Math.min(start + 64, text.length);
    while (high < text.length && fits(high)) {
      low = high;
      high = Math.min(start + 2 * (high - start), text.length);
    }
    while (low < high) {
      const offset = (low + high + 1) >>> 1;
      if (fits(offset)) low = offset;
      else high = offset - 1;
    }
    return low;
  };
  const fit = (bottom: number, start = 0, reserve?: (end: number) => number) => {
    if (start) {
      const part = position(start);
      if (part.node.nodeType === Node.TEXT_NODE) range.setStart(part.node, start - part.start);
      else range.setStartAfter(part.node);
    } else range.setStart(paragraph, 0);
    return fittingOffset(offset => {
      const part = position(offset);
      if (part.node.nodeType === Node.TEXT_NODE) range.setEnd(part.node, offset - part.start);
      else range.setEndAfter(part.node);
      return range.getBoundingClientRect().bottom + (reserve?.(offset) ?? 0) <= bottom + 0.5;
    }, start);
  };
  const box = (offset: number) => {
    offset = Math.min(offset, text.length - 1);
    const part = position(offset + 1);
    if (part.node.nodeType === Node.TEXT_NODE) {
      range.setStart(part.node, offset - part.start);
      range.setEnd(part.node, offset + 1 - part.start);
    } else range.selectNode(part.node);
    return range.getBoundingClientRect();
  };
  const selectPrefix = (offset: number) => {
    range.setStart(paragraph, 0);
    const part = position(offset);
    if (part.node.nodeType === Node.TEXT_NODE) range.setEnd(part.node, offset - part.start);
    else range.setEndAfter(part.node);
  };
  range.selectNodeContents(paragraph);
  let segments: Intl.Segments | undefined;
  return { text, fit, fittingOffset, box, footnotes, bounds: range.getBoundingClientRect(),
    grapheme(offset: number) {
      segments ??= typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(text) : undefined;
      return segments?.containing(offset)?.index ?? (/[\uDC00-\uDFFF]/.test(text[offset]) ? offset - 1 : offset);
    },
    discardPrefix(offset: number) { selectPrefix(offset); range.deleteContents(); },
    takePrefix(offset: number, trimBreak = false) {
      selectPrefix(offset);
      const prefix = range.extractContents();
      if (trimBreak) {
        const last = position(offset).node;
        if (last.nodeName === 'BR') last.parentNode?.removeChild(last);
      }
      return prefix;
    },
    isBreak: (offset: number) => offset < text.length && position(offset + 1).node.nodeName === 'BR' };
}

export function measureParagraphLines(node: HTMLElement, source: DocxElement | undefined, top: number, bottom: number,
  limit: number, height: number, hasPrevious: boolean, widowControl: boolean,
  single?: { offset: number; notes?: FootnoteSpace; extract?: boolean }) {
  const geometry = textGeometry(node);
  if (!geometry || (source && !single?.offset && paragraphText(source.children ?? []) !== geometry.text)) return undefined;
  const notes = single?.notes;
  const box = node.getBoundingClientRect();
  const padding = Math.max(0, box.bottom - geometry.bounds.bottom);
  const firstLine = geometry.box(0);
  const length = geometry.text.length;
  const reserve = notes && ((end: number) => {
    const ids: string[] = [];
    for (const note of geometry.footnotes) {
      if (note.end > end) break;
      ids.push(note.id);
    }
    return notes(ids);
  });
  const boundary = (bottom: number, start: number, measureNotes?: (end: number) => number) => {
    const offset = geometry.fit(bottom, start, measureNotes);
    return offset + Number(geometry.isBreak(offset));
  };
  const lastLineStart = (end: number, start: number) => {
    const last = Math.max(start, end - (geometry.isBreak(end - 1) ? 2 : 1));
    return boundary(geometry.box(last).top - 1, start);
  };
  let before = false, start = 0, finalLine: number | undefined;
  const cuts: number[] = [];
  while (bottom > limit + 0.5) {
    let fit = boundary(limit - padding, start, reserve);
    if (fit >= length) break;
    // Reservation can stop at a reference even when its surrounding line fits.
    if (reserve && fit > start && !geometry.isBreak(fit - 1)
      && geometry.box(fit - 1).bottom > geometry.box(fit).top + 0.5) fit = lastLineStart(fit + 1, start);
    if (widowControl && fit > start) {
      const earlier = lastLineStart(fit, start);
      const widow = fit >= (finalLine ??= lastLineStart(length, start));
      if (widow && earlier > start && lastLineStart(earlier, start) > start) fit = earlier;
      // Try a fresh page when moving a line would leave one behind.
      else if ((earlier <= start || widow) && hasPrevious && !before && !cuts.length) fit = start;
    }
    fit = geometry.grapheme(fit);
    if (single) {
      if (!fit) return undefined;
      const prefix = single.extract ? geometry.takePrefix(fit) : geometry.discardPrefix(fit);
      return { cuts: [single.offset + fit], before, limit, prefix };
    }
    if (fit <= start) {
      if (!hasPrevious || before || cuts.length) return undefined;
      before = true;
      limit = top + height;
      continue;
    }
    const nextLine = geometry.box(fit);
    const nextLimit = box.top + nextLine.top - firstLine.top + height;
    if (nextLimit <= limit + 0.5) return undefined;
    cuts.push(fit);
    start = fit;
    limit = nextLimit;
  }
  return cuts.length ? { cuts, before, limit } : undefined;
}
