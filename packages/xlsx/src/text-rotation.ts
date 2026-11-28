import { cellTextFont } from './cell-text-metrics';
import type { TextOverflow } from './horizontal-overflow';
import { XLSX_MAX_ROW_HEIGHT } from './xlsx-row-heights';

interface RotationLayout {
  rotation: number;
  width: number;
  height?: number;
  compact: boolean;
  wrap?: boolean;
  shrink: boolean;
  overflow?: TextOverflow;
}

interface RotatedValue {
  frame: HTMLDivElement;
  value: HTMLSpanElement;
  angle: number;
  sin: number;
  cos: number;
  layout: RotationLayout;
  vertical: string;
}

interface FillValue {
  line: HTMLSpanElement;
  pattern: HTMLSpanElement;
  width: number;
  start: number;
  end: number;
}

export function createCellTextLayout(document: Document) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;contain:strict';
  const pending: RotatedValue[] = [];
  const fills: FillValue[] = [];

  return {
    addFill(cell: HTMLTableCellElement, width: number, start: number, end: number) {
      const line = document.createElement('span'), pattern = document.createElement('span');
      line.className = 'xlsxv-fill-line';
      pattern.className = 'xlsxv-fill-pattern';
      if (cell.dir) pattern.dir = cell.dir;
      pattern.style.font = cellTextFont(cell.style, Number.parseFloat(cell.style.fontSize) || 12);
      if (cell.classList.contains('xlsxv-number-tabular')) pattern.classList.add('xlsxv-number-tabular');
      pattern.append(...cell.childNodes);
      probe.append(pattern);
      cell.append(line);
      fills.push({ line, pattern, width, start, end });
    },

    add(cell: HTMLTableCellElement, layout: RotationLayout) {
      const { rotation, width, height, compact, wrap } = layout;
      const stacked = rotation === 255;
      const angle = stacked ? 0 : rotation;
      const radians = angle * Math.PI / 180;
      const sin = Math.abs(Math.sin(radians)), cos = Math.abs(Math.cos(radians));
      const frame = document.createElement('div'), value = document.createElement('span');
      frame.className = 'xlsxv-rotated-text';
      value.className = rotation ? 'xlsxv-rotated-value' : 'xlsxv-overflow-value';
      if (cell.dir) value.dir = cell.dir;
      const style = cell.style;
      const fontSize = Number.parseFloat(style.fontSize) || 12;
      value.style.font = cellTextFont(style, fontSize);
      if (layout.overflow) value.style.color = style.color;
      value.style.lineHeight = compact ? '1.15' : '1.3';
      value.style.textDecorationLine = style.textDecorationLine;
      value.style.textDecorationStyle = style.textDecorationStyle;
      if (cell.classList.contains('xlsxv-number-tabular')) value.classList.add('xlsxv-number-tabular');
      if (stacked) {
        value.style.writingMode = 'vertical-lr';
        value.style.textOrientation = 'upright';
      } else if (wrap) {
        value.style.whiteSpace = 'pre-wrap';
        value.style.overflowWrap = 'anywhere';
        const limit = Math.min(cos > .001 ? width / cos : Infinity, height === undefined ? Infinity : height / sin);
        if (Number.isFinite(limit)) value.style.maxWidth = `${Math.max(1, limit)}px`;
      }
      value.style.textAlign = style.textAlign;
      value.append(...cell.childNodes);
      probe.append(value);
      cell.append(frame);
      pending.push({ frame, value, angle, sin, cos, layout, vertical: style.verticalAlign });
    },

    finish() {
      document.body.append(probe);
      try {
        // Measure the browser's actual rich runs and line breaks in one layout pass.
        const bounds = pending.map(({ value }) => value.getBoundingClientRect());
        const fillBounds = fills.map(({ pattern }) => pattern.getBoundingClientRect().width);
        for (const [index, { frame, value, angle, sin, cos, layout, vertical }] of pending.entries()) {
          const { width, height, compact, shrink } = layout;
          const text = bounds[index];
          const projectedWidth = text.width * cos + text.height * sin;
          const projectedHeight = text.width * sin + text.height * cos;
          const scale = shrink ? Math.min(1, width / (projectedWidth || 1), height === undefined ? 1 : height / (projectedHeight || 1)) : 1;
          const half = projectedWidth * scale / 2;
          const fullHeight = projectedHeight * scale;
          // Very long vertical text shares the height limit used for saved rows.
          const frameHeight = height === undefined ? Math.min(fullHeight, XLSX_MAX_ROW_HEIGHT - (compact ? 2 : 8)) : fullHeight;
          frame.style.height = `${frameHeight}px`;
          value.style.left = value.style.textAlign === 'center' ? '50%' : value.style.textAlign === 'right'
            ? `calc(100% - ${half}px)` : `${half}px`;
          if (frameHeight < fullHeight && vertical !== 'middle') {
            value.style.top = vertical === 'bottom' ? `calc(100% - ${fullHeight / 2}px)` : `${fullHeight / 2}px`;
          }
          value.style.transform = `translate(-50%, -50%) rotate(${angle}deg) scale(${scale})`;
          const padding = height !== undefined ? 2 : compact ? 1 : 4;
          if (!layout.overflow?.paint(value, projectedWidth * scale, frameHeight, vertical, padding, height !== undefined)) {
            if (layout.rotation) frame.append(value);
            else frame.replaceWith(...value.childNodes);
          }
        }
        for (const [index, { line, pattern, width, start, end }] of fills.entries()) {
          const advance = fillBounds[index];
          // shortcut: subpixel values render once to avoid creating thousands of imperceptible copies.
          const count = advance >= 1 ? Math.floor(width / advance) : 1;
          if (count <= 1) {
            line.replaceWith(...pattern.childNodes);
            continue;
          }
          pattern.style.font = '';
          const first = Math.min(count, Math.max(0, Math.floor(start / advance)));
          const last = Math.min(count, Math.ceil(end / advance));
          line.append(pattern);
          for (let i = Math.max(1, first); i < last; i++) {
            const copy = pattern.cloneNode(true) as HTMLSpanElement;
            copy.setAttribute('aria-hidden', 'true');
            line.append(copy);
          }
          if (first) {
            // Keep the source value available to accessibility APIs while mounting only the clipped interval.
            pattern.classList.add('is-source');
            line.style.paddingLeft = `${first * advance}px`;
          }
        }
      } finally {
        probe.remove();
      }
    }
  };
}
