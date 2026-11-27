import { cellTextContext, cellTextFont } from './cell-text-metrics';
import type { FormattedCellValue } from './number-formats';

export function createNumberLayout(document: Document) {
  const measure = cellTextContext(document);
  const tiles = new Map<string, { image: string; width: number; height: number } | undefined>();
  let brush: CanvasRenderingContext2D | null | undefined;
  return (cell: HTMLTableCellElement, { text, spacing }: FormattedCellValue, singleLine: boolean,
    appendText = (target: HTMLElement, part: string) => target.append(part)) => {
    if (!spacing?.length) { appendText(cell, text); return; }
    const fill = singleLine && !/[\r\n]/.test(text) && spacing.some(item => item.kind === 'fill');
    const target = fill ? document.createElement('span') : cell;
    if (fill) {
      target.className = 'xlsxv-number-layout';
      cell.append(target);
    }

    const fontSize = Number.parseFloat(cell.style.fontSize) || 12;
    const font = cellTextFont(cell.style, fontSize);
    const color = cell.style.color || '#172033';
    let start = 0;
    for (const item of spacing) {
      if (item.kind === 'fill' && !fill) continue;
      if (item.offset > start) appendText(target, text.slice(start, item.offset));
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      if (item.kind === 'pad') {
        spacer.className = 'xlsxv-number-pad';
        spacer.textContent = ' ';
        if (item.glyph === '0') spacer.style.width = '1ch';
        else if (measure) {
          measure.font = font;
          spacer.style.width = `${measure.measureText(item.glyph).width}px`;
        }
      } else {
        spacer.className = 'xlsxv-number-fill';
        if (measure && item.glyph.trim()) {
          const key = JSON.stringify([font, color, item.glyph]);
          if (!tiles.has(key)) {
            if (brush === undefined) brush = cellTextContext(document);
            measure.font = font;
            const metrics = measure.measureText(item.glyph);
            tiles.set(key, brush ? drawGlyph(brush, metrics, item.glyph, font, color, fontSize) : undefined);
          }
          const tile = tiles.get(key);
          if (tile) {
            spacer.style.setProperty('--xlsxv-glyph-image', `url(${tile.image})`);
            spacer.style.setProperty('--xlsxv-glyph-width', `${tile.width}px`);
            spacer.style.setProperty('--xlsxv-glyph-height', `${tile.height}px`);
          }
        }
      }
      target.append(spacer);
      start = item.offset + (item.kind === 'pad' ? 1 : 0);
    }
    if (start < text.length) appendText(target, text.slice(start));
  };
}

function drawGlyph(brush: CanvasRenderingContext2D, metrics: TextMetrics, glyph: string, font: string, color: string, fontSize: number) {
  const width = metrics.width;
  if (!Number.isFinite(width) || width <= 0) return undefined;
  const ascent = metrics.fontBoundingBoxAscent ?? fontSize, descent = metrics.fontBoundingBoxDescent ?? fontSize / 4;
  const height = Math.max(ascent + descent, 1);
  const { canvas } = brush;
  // A constant-size tile also covers merged cells with millions of pixels of source width.
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  brush.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  brush.font = font;
  brush.fillStyle = color;
  brush.fillText(glyph, 0, ascent);
  try { return { image: canvas.toDataURL(), width, height }; }
  catch { return undefined; }
}
