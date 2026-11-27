import { describe, expect, it, vi } from 'vitest';
import { renderTableCellContent, withTextMeasurementScope } from '../src/rendering';
import type { TableCell } from '../src/types';

vi.mock('@filens/pptx', () => { throw new Error('Table rendering imported the slide renderer.'); });
vi.mock('utif', () => { throw new Error('Table rendering imported the TIFF decoder.'); });

describe('shared table cell content', () => {
  it('shares font probes across cells and refreshes them for the next render batch', () => {
    const originalCreateElement = document.createElement.bind(document), targetFont = 'Table Dynamic Light';
    let available = false, canvases = 0;
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== 'canvas') return originalCreateElement(tagName);
      canvases++;
      const context = { font: '', measureText() {
        return { width: 100 + Number(available && this.font.includes(targetFont)) * 12 };
      } };
      return { getContext: () => context } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    const source: TableCell = { row: 0, column: 0, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill: { type: 'none' },
      textFrame: { padding: { top: 0, right: 0, bottom: 0, left: 0 }, verticalAlign: 'top',
        paragraphs: [{ runs: [{ text: 'Shared typography', fontFamily: targetFont, fontSize: 14 }] }] } };
    const render = () => withTextMeasurementScope(() => Array.from({ length: 20 }, () => {
      const td = document.createElement('td'); renderTableCellContent(td, source, { getUrl: () => '' });
      return td.querySelector<HTMLElement>('.pptxv-run')!.style.fontWeight;
    }));
    try {
      expect(render()).toEqual(Array(20).fill('310')); expect(canvases).toBe(1);
      available = true;
      expect(render()).toEqual(Array(20).fill('')); expect(canvases).toBe(2);
    } finally { spy.mockRestore(); }
  });

  it.each(['javascript:alert(1)', ' \tJaVa\nScRiPt:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>'])(
    'disables executable source hyperlinks: %s', href => {
      const source: TableCell = { row: 0, column: 0, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill: { type: 'none' },
        textFrame: { padding: { top: 0, right: 0, bottom: 0, left: 0 }, verticalAlign: 'top',
          paragraphs: [{ runs: [{ text: 'Source link', href }] }] } };
      const target = document.createElement('td'); renderTableCellContent(target, source, { getUrl: () => '' });
      const link = target.querySelector('a')!;
      expect(link.textContent).toBe('Source link'); expect(link.hasAttribute('href')).toBe(false);
      expect(link.getAttribute('aria-disabled')).toBe('true');
      expect(source.textFrame.paragraphs[0].runs[0].href).toBe(href);
    }
  );
});
