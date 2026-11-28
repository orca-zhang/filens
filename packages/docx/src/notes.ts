import { measureParagraphLines, textGeometry } from './paragraph-lines';
import type { createDocxPagination, DocxElement } from './pagination';

export type DocxNotes = { list: HTMLOListElement; templates: HTMLElement[]; notes: DocxElement[]; section?: number };
export type NotePart = { source: string; node: HTMLElement; offset: number };

export function findEndnoteBreaks(endnotes: DocxNotes[], breaks: Set<number>): boolean {
  const count = breaks.size;
  for (const { list, section } of endnotes) {
    if (section === undefined || list.nextElementSibling?.localName !== 'article') continue;
    const page = list.parentElement!;
    const visibility = page.style.contentVisibility;
    page.style.contentVisibility = 'visible';
    if (page.getBoundingClientRect().height > parseFloat(getComputedStyle(page).minHeight) + 0.5) breaks.add(section);
    page.style.contentVisibility = visibility;
  }
  return breaks.size > count;
}

export function paginateNotes({ list, templates, notes }: DocxNotes,
  { keepLines, widowControl }: Pick<ReturnType<typeof createDocxPagination>, 'keepLines' | 'widowControl'>): NotePart[] {
  const footnote = list.hasAttribute('data-docx-footnotes');
  const firstPage = list.parentElement!;
  const body = list.previousElementSibling;
  if (list.nextElementSibling?.localName === 'article' && body instanceof HTMLElement) body.style.marginBottom = '0px';
  let visibility = firstPage.style.contentVisibility;
  firstPage.style.contentVisibility = 'visible';
  let page = firstPage;
  let paper = parseFloat(getComputedStyle(page).minHeight);
  const overflow = () => Number.isFinite(paper) ? page.getBoundingClientRect().height - paper : 0;
  const source = Array.from(list.children as HTMLCollectionOf<HTMLLIElement>);
  const emptyList = list.cloneNode(false) as HTMLOListElement;
  const parts: NotePart[] = [];
  let target = list, continuation = 0;
  let hasBody = Boolean(firstPage.querySelector(footnote
    ? ':scope > article > *' : ':scope > article > *, :scope > ol[data-docx-footnotes] > li'));
  const keyOf = (item: HTMLLIElement, index: number, block: number) => footnote
    ? `f${item.dataset.docxFootnote}:${block}` : `e${list.start + index}:${block}`;
  const finishPage = () => {
    if (!target.children.length) target.remove();
    page.style.contentVisibility = visibility;
  };
  const nextPage = (node: HTMLElement, item: HTMLLIElement, canSplit: boolean, widow: boolean) => {
    finishPage();
    const previous = page;
    const following = previous.nextElementSibling;
    target = emptyList.cloneNode(false) as HTMLOListElement;
    if (footnote && following instanceof HTMLElement && acceptContinuation(following, previous, target, item, node, canSplit, widow)) {
      continuation++;
      page = following;
      visibility = page.style.contentVisibility;
      page.style.contentVisibility = 'visible';
      paper = parseFloat(getComputedStyle(page).minHeight);
      hasBody = true;
      return;
    }
    page = templates[continuation++ % templates.length].cloneNode(true) as HTMLElement;
    page.classList.add('docx');
    page.style.containIntrinsicHeight = 'auto 0px';
    page.style.contentVisibility = 'visible';
    const article = list.ownerDocument.createElement('article');
    const footer = page.querySelector(':scope > footer');
    page.insertBefore(article, footer);
    if (footnote) page.insertBefore(target, footer);
    else article.append(target);
    previous.after(page);
    visibility = '';
    hasBody = false;
    paper = parseFloat(getComputedStyle(page).minHeight);
    // When the empty continuation already exceeds the paper height, keep the remaining notes there.
    if (overflow() > 0.5) paper = NaN;
  };

  try {
    if (overflow() <= 0.5) {
      source.forEach((item, index) => Array.from(item.children as HTMLCollectionOf<HTMLElement>).forEach((node, block) =>
        parts.push({ source: keyOf(item, index, block), node, offset: 0 })));
      return parts;
    }
    list.replaceChildren();
    for (const [index, item] of source.entries()) {
      const blocks = Array.from(item.children as HTMLCollectionOf<HTMLElement>);
      const models = notes[index]?.children;
      item.replaceChildren();
      item.value = list.start + index;
      let part = item;
      target.append(part);
      for (const [block, node] of blocks.entries()) {
        const key = keyOf(item, index, block);
        const model = models?.length === blocks.length && models[block].type === 'paragraph' ? models[block] : undefined;
        const canSplit = !model || !keepLines(model);
        const widow = !model || widowControl(model);
        let offset = 0;
        part.append(node);
        for (let excess = overflow(); excess > 0.5; excess = overflow()) {
          const occupied = Boolean(node.previousElementSibling || part.previousElementSibling || hasBody);
          const origin = footnote && page === firstPage && !node.previousElementSibling && offset === 0;
          const cut = canSplit ? noteCut(node, excess, paper, occupied && !origin, widow) : undefined;
          if (cut?.prefix) {
            const prefix = node.cloneNode(false) as HTMLElement;
            prefix.append(cut.prefix);
            prefix.style.marginBottom = '0px';
            node.replaceWith(prefix);
            if ('columnHeight' in cut) {
              target.style.height = `${cut.columnHeight}px`;
              target.style.columnFill = 'auto';
            }
            parts.push({ source: key, node: prefix, offset });
            offset += cut.cuts[0];
            node.classList.add('docxv-continuation');
            node.style.marginTop = '0px';
            node.style.textIndent = '0px';
          } else {
            if (!occupied || origin) break;
            node.remove();
          }
          const continued = part.children.length > 0 || part.style.listStyleType === 'none';
          if (!part.children.length) part.remove();
          nextPage(node, item, canSplit, widow);
          part = item.cloneNode(false) as HTMLLIElement;
          if (continued) part.style.listStyleType = 'none';
          part.append(node);
          target.append(part);
        }
        parts.push({ source: key, node, offset });
      }
    }
    return parts;
  } finally {
    finishPage();
  }
}

function acceptContinuation(page: HTMLElement, previous: HTMLElement, list: HTMLOListElement,
  item: HTMLLIElement, node: HTMLElement, canSplit: boolean, widow: boolean): boolean {
  if (page.style.width !== previous.style.width) return false;
  const article = page.querySelector(':scope > article:last-of-type');
  if (!article?.childElementCount) return false;
  const visibility = page.style.contentVisibility;
  page.style.contentVisibility = 'visible';
  try {
    if (!(parseFloat(getComputedStyle(article).marginBottom) > 0.5)) return false;
    const paper = parseFloat(getComputedStyle(page).minHeight);
    page.insertBefore(list, page.querySelector(':scope > ol[data-docx-footnotes], :scope > footer'));
    const probe = item.cloneNode(false) as HTMLLIElement;
    const block = node.cloneNode(true) as HTMLElement;
    probe.appendChild(block);
    list.append(probe);
    const overflow = page.getBoundingClientRect().height - paper;
    const fits = overflow <= 0.5 || (canSplit && noteCut(block, overflow, paper, true, widow));
    probe.remove();
    if (!fits) list.remove();
    return Boolean(fits);
  } finally {
    page.style.contentVisibility = visibility;
  }
}

function noteCut(node: HTMLElement, overflow: number, paper: number, occupied: boolean, widowControl: boolean) {
  if (node.localName !== 'p' || node.querySelector('img,svg,math,canvas,iframe,object,video')) return undefined;
  const list = node.parentElement?.parentElement;
  if (list?.style.columnCount) return columnNoteCut(node, list, overflow);
  const { top, bottom } = node.getBoundingClientRect();
  return measureParagraphLines(node, undefined, top, bottom, bottom - overflow, paper, occupied, widowControl,
    { offset: 0, extract: true });
}

function columnNoteCut(node: HTMLElement, list: HTMLElement, overflow: number) {
  const room = list.getBoundingClientRect().height - overflow;
  if (room < 1) return;
  const { height, columnFill } = list.style;
  list.style.height = `${room}px`;
  list.style.columnFill = 'auto';
  try {
    const text = textGeometry(node);
    if (!text) return;
    const { left, right, bottom } = list.getBoundingClientRect();
    // A fixed column height sends text beyond the page to an extra column.
    const end = text.grapheme(text.fittingOffset(offset => {
      const box = text.box(offset - 1 - Number(offset > 1 && text.isBreak(offset - 1)));
      return box.left >= left - 0.5 && box.right <= right + 0.5 && box.bottom <= bottom + 0.5;
    }));
    if (end && end < text.text.length) return { cuts: [end], prefix: text.takePrefix(end, true), columnHeight: room };
  } finally {
    list.style.height = height;
    list.style.columnFill = columnFill;
  }
}
