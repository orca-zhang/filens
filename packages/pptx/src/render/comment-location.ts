import type {
  ParsedPresentation, SlideCommentAnchor, SlideItem, SlideModel, TextFrame
} from '@filens/core/presentation-support';
import { matchSlideReference } from '../comment-references';

type TextRange = NonNullable<SlideCommentAnchor['textRange']>;

export interface CommentLocation {
  slideIndex: number;
  itemIndexes: number[];
  point?: SlideCommentAnchor['position'];
  textRange?: TextRange;
  source?: SlideModel;
}

type ViewportBox = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>;

export function resolveCommentLocation(
  presentation: ParsedPresentation, current: number, anchor: SlideCommentAnchor | undefined
): CommentLocation | undefined {
  if (!anchor || anchor.kind === 'unknown') return undefined;
  const { master, layout } = anchor;
  let source: SlideModel | undefined;
  if (master || layout) {
    if (!master || !presentation.commentSources) return undefined;
    const sources = presentation.commentSources;
    const owner = matchSlideReference(sources, master, item => item.master)?.master;
    if (!owner) return undefined;
    const owned = sources.filter(item => item.master.id === owner.id && item.master.creationId === owner.creationId);
    source = (layout ? matchSlideReference(owned, layout, item => item.layout) : owned.find(item => !item.layout))?.slide;
    if (!source) return undefined;
  }
  let slideIndex = current;
  if (!source && anchor.slide) {
    const target = matchSlideReference(presentation.slides, anchor.slide, slide => slide.sourceSlide);
    if (!target) return undefined;
    slideIndex = presentation.slides.indexOf(target);
  }
  const slide = source ?? presentation.slides[slideIndex];
  if (!slide) return undefined;
  if (anchor.kind === 'slide') {
    const point = anchor.position && [anchor.position.x, anchor.position.y].every(Number.isFinite) ? {
      x: Math.max(0, Math.min(slide.width, anchor.position.x)),
      y: Math.max(0, Math.min(slide.height, anchor.position.y))
    } : undefined;
    return { slideIndex, itemIndexes: [], point, source };
  }
  if (!anchor.drawing) return undefined;

  const { id, creationId } = anchor.drawing;
  const exact: number[] = [], byId: number[] = [];
  slide.items.forEach((item, index) => {
    const sources = [item.sourceDrawing, ...(item.sourceGroups ?? [])];
    if (creationId && sources.some(source => source?.creationId === creationId)) exact.push(index);
    else if (id && sources.some(source => source?.id === id && (!creationId || !source.creationId))) byId.push(index);
  });
  const itemIndexes = exact.length ? exact : byId;
  if (!itemIndexes.length) return undefined;
  return { slideIndex, itemIndexes, source, textRange: anchor.kind === 'text' ? anchor.textRange : undefined };
}

export function renderCommentLocation(
  slide: SlideModel, root: HTMLElement, location: CommentLocation
): { element: HTMLElement; bounds: ViewportBox } | undefined {
  const box = root.getBoundingClientRect();
  const scaleX = box.width / slide.width, scaleY = box.height / slide.height;
  if (!(scaleX > 0 && scaleY > 0)) return undefined;

  let rects: ViewportBox[];
  let kind: 'point' | 'text' | 'shape' | 'slide';
  if (location.point) {
    const x = box.left + location.point.x * scaleX;
    const y = box.top + location.point.y * scaleY;
    rects = [{ left: x, right: x, top: y, bottom: y }];
    kind = 'point';
  } else if (location.itemIndexes.length) {
    const targets = location.itemIndexes.map(index => root.children[index] as HTMLElement | undefined);
    const range = location.textRange;
    rects = targets.length === 1 && targets[0] && range
      ? textRects(targets[0], textFrame(slide.items[location.itemIndexes[0]]), range) : [];
    kind = rects.length ? 'text' : 'shape';
    if (!rects.length) {
      const boxes = targets.filter((target): target is HTMLElement => !!target).map(target => target.getBoundingClientRect());
      if (!boxes.length) return undefined;
      rects = [union(boxes)];
    }
  } else {
    rects = [box];
    kind = 'slide';
  }

  const doc = root.ownerDocument;
  const layer = doc.createElement('div');
  layer.className = 'pptxv-comment-highlight';
  layer.dataset.kind = kind;
  layer.setAttribute('aria-hidden', 'true');
  for (const rect of rects) {
    const marker = doc.createElement('span');
    marker.style.left = `${(rect.left - box.left) / scaleX}px`;
    marker.style.top = `${(rect.top - box.top) / scaleY}px`;
    if (kind !== 'point') {
      marker.style.width = `${Math.max(kind === 'text' ? 1 : 0, (rect.right - rect.left) / scaleX)}px`;
      marker.style.height = `${(rect.bottom - rect.top) / scaleY}px`;
    }
    layer.appendChild(marker);
  }
  return { element: layer, bounds: union(rects) };
}

function union(boxes: readonly ViewportBox[]): ViewportBox {
  return boxes.reduce((bounds, box) => ({
    left: Math.min(bounds.left, box.left), top: Math.min(bounds.top, box.top),
    right: Math.max(bounds.right, box.right), bottom: Math.max(bounds.bottom, box.bottom)
  }), boxes[0]);
}

function textFrame(item: SlideItem): TextFrame | undefined {
  return item.kind === 'shape' || item.kind === 'text' ? item.textFrame : undefined;
}

function matchesContext(frame: TextFrame, range: TextRange): boolean {
  if (range.contextLength === undefined && range.contextHash === undefined) return true;
  const officeText = frame.paragraphs.map(paragraph =>
    paragraph.runs.map(run => run.text.replace(/\n/g, '\v')).join('')).join('\r');
  // The text may include the final paragraph terminator.
  return [officeText, officeText + '\r'].some(text => {
    if (range.contextLength !== undefined && range.contextLength !== text.length) return false;
    if (range.contextHash === undefined) return true;
    let hash = 0;
    for (let index = 0; index < text.length; index++) hash = (Math.imul(hash, 33) + text.charCodeAt(index)) >>> 0;
    return hash === range.contextHash;
  });
}

function textRects(element: HTMLElement, frame: TextFrame | undefined, range: TextRange): ViewportBox[] {
  if (!frame || !matchesContext(frame, range)) return [];
  const paragraphs = element.querySelectorAll('.pptxv-text-frame > .pptxv-paragraph');
  if (paragraphs.length !== frame.paragraphs.length) return [];
  const end = range.offset + range.length;
  const total = frame.paragraphs.reduce((length, paragraph) =>
    paragraph.runs.reduce((sum, run) => sum + run.text.length, length) + 1, 0);
  if (range.offset >= total || end > total) return [];
  const caret = range.length === 0;
  const rects: ViewportBox[] = [];
  let cursor = 0;
  for (let index = 0; index < paragraphs.length; index++) {
    const runs = frame.paragraphs[index].runs;
    const nodes = [...paragraphs[index].children].filter(node =>
      node.classList.contains('pptxv-run') && !node.classList.contains('pptxv-run--bullet'));
    if (nodes.length !== runs.length) return [];
    for (let index = 0; index < runs.length; index++) {
      const start = cursor;
      const length = runs[index].text.length;
      cursor += length;
      if (!length || (caret ? range.offset < start || range.offset > cursor : end <= start || range.offset >= cursor)) continue;
      const node = nodes[index];
      const text = node.firstChild;
      if (text?.nodeType === 3 && text.textContent === runs[index].text) {
        const selection = element.ownerDocument.createRange();
        selection.setStart(text, Math.max(0, range.offset - start));
        selection.setEnd(text, Math.min(length, end - start));
        if (typeof selection.getClientRects !== 'function') return [];
        rects.push(...[...selection.getClientRects()].filter(rect => rect.height > 0 && (caret || rect.width > 0)));
      } else if (!caret && node.getAttribute('data-resolved-label') === runs[index].text) {
        rects.push(node.getBoundingClientRect());
      } else {
        return [];
      }
      if (caret && rects.length) return rects;
    }
    cursor++; // OfficeArt inserts one paragraph return between text paragraphs.
  }
  return rects;
}
