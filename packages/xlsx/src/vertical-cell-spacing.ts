import { cellTextFont } from './cell-text-metrics';
import { centerLoneVerticalWords, loneVerticalWords } from './vertical-word-alignment';
import { XLSX_MAX_ROW_HEIGHT } from './xlsx-row-heights';

interface VerticalLayout {
  width: number;
  left: number;
  padding: number;
  compact: boolean;
  centerSingle: boolean;
  natural?: HTMLTableCellElement;
  extraHeight?: number;
  inlineRotation?: number;
  height?: number;
}

function setVerticalWriting(text: HTMLDivElement, cell: HTMLTableCellElement, layout: VerticalLayout): void {
  const rotation = layout.inlineRotation;
  const align = cell.style.textAlign;
  const left = align === 'right' ? 100 : align === 'center' ? 50 : 0;
  if (rotation === 255) {
    text.style.writingMode = 'vertical-lr';
    text.style.textOrientation = 'upright';
  }
  text.style.inlineSize = layout.height === undefined ? 'max-content' : `${Math.max(1, layout.height - 2 * layout.padding)}px`;
  text.style.maxInlineSize = layout.height === undefined ? `${XLSX_MAX_ROW_HEIGHT - 2 * layout.padding}px` : '';
  text.style.textAlign = 'justify';
  text.style.textAlignLast = layout.centerSingle || cell.style.textAlignLast === 'justify' ? 'justify' : 'start';
  text.style.setProperty('text-justify', 'inter-word');
  if (layout.centerSingle && !/\S[ \t]+\S/.test(text.textContent ?? '')) {
    text.style.textAlign = 'center';
    text.style.textAlignLast = '';
  }
  text.style.position = 'absolute';
  text.style.top = '0';
  text.style.left = `${left}%`;
  text.style.transformOrigin = '0 0';
  // The translation uses the live block size, so wrapping can change the cross-axis position.
  text.style.transform = rotation === 255 ? `translateX(${-left}%)`
    : rotation === 90 ? `rotate(90deg) translateY(${left - 100}%)` : `rotate(-90deg) translate(-100%, ${-left}%)`;
}

export function createVerticalCellSpacing(document: Document) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;contain:strict';
  const cells: { frame: HTMLDivElement; text: HTMLDivElement; flow?: HTMLDivElement; layout: VerticalLayout }[] = [];

  return {
    add(cell: HTMLTableCellElement, parent: HTMLElement, layout: VerticalLayout) {
      if (!parent.hasChildNodes()) return;
      const frame = document.createElement('div'), text = document.createElement('div');
      frame.className = 'xlsxv-vertical-frame';
      frame.style.left = `${layout.left}px`;
      frame.style.width = `${Math.max(1, layout.width)}px`;
      frame.style.insetBlock = `${layout.padding}px`;
      text.className = 'xlsxv-vertical-lines';
      if (cell.dir) text.dir = cell.dir;
      if (cell.classList.contains('xlsxv-number-tabular')) text.classList.add('xlsxv-number-tabular');
      if (!layout.inlineRotation) text.style.width = frame.style.width;
      text.style.font = cellTextFont(cell.style, parseFloat(cell.style.fontSize) || 12);
      // Set the line-height through the shared rule so the probe and the live inline runs use the same leading.
      text.style.lineHeight = '';
      text.style.setProperty('--xlsxv-vertical-line-height', layout.compact ? '1.15' : '1.3');
      text.style.textAlign = parent.style.textAlign || cell.style.textAlign;
      text.style.textAlignLast = cell.style.textAlignLast;
      text.style.setProperty('text-justify', cell.style.getPropertyValue('text-justify'));
      text.append(...parent.childNodes);
      if (layout.inlineRotation) setVerticalWriting(text, cell, layout);
      parent.append(frame);
      probe.append(text);
      let flow: HTMLDivElement | undefined;
      if (layout.natural) {
        flow = document.createElement('div');
        flow.className = 'xlsxv-auto-row-clip';
        flow.setAttribute('aria-hidden', 'true');
        if (layout.extraHeight) flow.style.setProperty('--xlsxv-row-padding-height', '0px');
        layout.natural.append(flow);
      }
      cells.push({ frame, text, flow, layout });
    },

    finish() {
      if (!cells.length) return;
      document.body.append(probe);
      try {
        const view = document.defaultView;
        const length = (text: HTMLDivElement, axis: 'width' | 'height') =>
          (view && parseFloat(view.getComputedStyle(text)[axis])) || (axis === 'width' ? text.offsetWidth : text.offsetHeight);
        const natural = cells.map(({ text, layout }) => length(text, layout.inlineRotation && layout.inlineRotation !== 255 ? 'width' : 'height'));
        const loneWords = cells.map(({ text, layout }) => {
          if (!layout.inlineRotation || !layout.centerSingle || text.style.textAlign !== 'justify') return;
          const rtl = text.dir === 'rtl' && layout.inlineRotation !== 255;
          return loneVerticalWords(text, (layout.inlineRotation === -90) !== rtl);
        });
        // Measure an isolated leading change to count visual wraps without splitting text or styled runs.
        probe.style.setProperty('--xlsxv-vertical-gap', '4px');
        const lineCounts = cells.map(({ text, layout }, index) => layout.inlineRotation ? 0 : Math.round((length(text, 'height') - natural[index]) / 4));
        for (const [index, { frame, text, flow, layout }] of cells.entries()) {
          const base = natural[index], gaps = lineCounts[index] - 1;
          if (flow) flow.style.height = `${base + (layout.extraHeight ?? 0)}px`;
          if (layout.inlineRotation) {
            text.style.inlineSize = '100cqh';
            text.style.maxInlineSize = '';
            if (loneWords[index]?.length) centerLoneVerticalWords(loneWords[index]!);
          } else if (gaps > 0) {
            text.style.setProperty('--xlsxv-vertical-gap', `max(0px, calc((100cqh - ${base}px) / ${gaps}))`);
            text.style.marginTop = 'calc(-0.5 * var(--xlsxv-vertical-gap))';
          } else if (layout.centerSingle) text.style.marginTop = `max(0px, calc((100cqh - ${base}px) / 2))`;
          frame.append(text);
        }
      } finally { probe.remove(); }
    }
  };
}
