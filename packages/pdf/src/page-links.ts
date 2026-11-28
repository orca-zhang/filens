import type { PDFPageProxy } from 'pdfjs-dist';
import { safePdfUrl, type PdfDestination } from './outline';

export interface PdfPageLink {
  rect: number[];
  quadPoints?: Float32Array;
  dest?: PdfDestination;
  url?: string;
  label?: string;
}

type Rect = [number, number, number, number];
type Viewport = ReturnType<PDFPageProxy['getViewport']>;

function linkRegions(link: PdfPageLink, viewport: Viewport): Rect[] {
  const points = link.quadPoints;
  const regions: Rect[] = [];
  // PDF.js normalizes each quadrilateral to top-left, top-right, bottom-left, bottom-right.
  for (let index = 0, count = points?.length ?? 8; index + 7 < count; index += 8) {
    const rect = points ? [points[index], points[index + 5], points[index + 2], points[index + 1]] : link.rect;
    if (rect?.length !== 4 || !rect.every(Number.isFinite)) continue;
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);
    const box: Rect = [Math.max(0, Math.min(x1, x2)), Math.max(0, Math.min(y1, y2)),
      Math.min(viewport.width, Math.max(x1, x2)), Math.min(viewport.height, Math.max(y1, y2))];
    if (box[2] > box[0] && box[3] > box[1]) regions.push(box);
  }
  return regions;
}

function positionLink(element: HTMLElement, rect: Rect, frame: Rect): void {
  const [left, top, right, bottom] = rect;
  const width = frame[2] - frame[0], height = frame[3] - frame[1];
  Object.assign(element.style, {
    left: `${(left - frame[0]) / width * 100}%`, top: `${(top - frame[1]) / height * 100}%`,
    width: `${(right - left) / width * 100}%`, height: `${(bottom - top) / height * 100}%`
  });
}

export function createPdfPageLinks(page: PDFPageProxy, links: PdfPageLink[],
  follow: (destination: PdfDestination) => void, fallback: string): HTMLDivElement {
  const viewport = page.getViewport({ scale: 1 });
  const frame: Rect = [0, 0, viewport.width, viewport.height];
  const layer = document.createElement('div');
  layer.className = 'pdfv-page-links';
  for (const link of links) {
    const url = safePdfUrl(link.url) ? link.url : undefined;
    const dest = typeof link.dest === 'string' || Array.isArray(link.dest) ? link.dest : undefined;
    if (!url && !dest) continue;
    const regions = linkRegions(link, viewport);
    if (!regions.length) continue;
    const control = url ? document.createElement('a') : document.createElement('button');
    const label = link.label?.trim() || url || (typeof dest === 'string' ? dest : '');
    control.setAttribute('aria-label', label || fallback);
    if (control instanceof HTMLAnchorElement) {
      control.href = url!;
      control.target = '_blank';
      control.rel = 'noopener noreferrer';
    } else {
      control.type = 'button';
      if (!label) control.dataset.pdfLinkLabel = '';
      control.addEventListener('click', () => follow(dest!));
    }
    const box = regions.reduce<Rect>(([left, top, right, bottom], rect) => [
      Math.min(left, rect[0]), Math.min(top, rect[1]), Math.max(right, rect[2]), Math.max(bottom, rect[3])
    ], regions[0]);
    positionLink(control, box, frame);
    // One keyboard target covers a link whose text spans several lines.
    for (const rect of regions) {
      const hit = document.createElement('span');
      hit.setAttribute('aria-hidden', 'true');
      positionLink(hit, rect, box);
      control.append(hit);
    }
    layer.append(control);
  }
  return layer;
}
