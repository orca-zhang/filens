import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIworkViewer } from '../src/viewer/create-iwork-viewer';
import { createNumbersWindowFixture, createNumbersStyledFixture, createNumbersColumnWidthFixture } from './fixtures/numbers-window.mjs';

const parse = vi.hoisted(() => vi.fn());
vi.mock('../src/worker/client', () => ({ IworkWorkerClient: class {
  parse = parse; cancel() {} destroy() {}
} }));
vi.mock('../src/parser/load-source', () => ({ loadSourceBytes: async () => new Uint8Array([1, 2, 3]) }));
afterEach(() => { vi.restoreAllMocks(); parse.mockReset(); document.body.replaceChildren(); });

async function open(fixture = createNumbersWindowFixture()) {
  parse.mockResolvedValue(fixture);
  const host = document.body.appendChild(document.createElement('div'));
  const viewer = createIworkViewer(host);
  await viewer.preview(new Uint8Array([1, 2, 3]));
  const grid = host.querySelector<HTMLElement>('.xlsxv-grid')!;
  const table = grid.querySelector<HTMLTableElement>('table')!;
  Object.defineProperties(grid, { clientHeight: { value: 600 }, clientWidth: { value: 800 } });
  vi.spyOn(HTMLTableElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const viewport = this.closest('.xlsxv-grid');
    return { top: -(viewport?.scrollTop ?? 0), left: -(viewport?.scrollLeft ?? 0), height: 26 * 100_001 } as DOMRect;
  });
  return { host, viewer, grid, table };
}

describe('Numbers row and column windows', () => {
  it('carries source column widths through virtual grids and small sibling tables', async () => {
    const fixture = createNumbersColumnWidthFixture(), { host, viewer, grid, table } = await open(fixture);
    try {
      expect(table.style.width).toBe(`${fixture.sheets[0].tables[0].item.columns.reduce((sum, width) => sum + width, 48)}px`);
      expect(table.querySelector<HTMLElement>('.xlsxv-col-header')!.style.width).toBe('40px');
      const sibling = host.querySelectorAll<HTMLTableElement>('table')[1];
      expect(sibling.style.width).toBe('364px');
      expect(sibling.querySelector<HTMLElement>('.xlsxv-col-header')!.style.width).toBe('36px');
      grid.scrollLeft = fixture.sheets[0].tables[0].item.columns.slice(0, 30).reduce((sum, width) => sum + width, 1000);
      grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(table.querySelector('tr[aria-rowindex="2"] td[aria-colindex="32"]')?.textContent).toBe('Wide source column'));
      expect(table.querySelector<HTMLElement>('td[aria-colindex="32"]')!.style.width).toBe('2400px');
      expect(table.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
      viewer.refreshFonts();
      expect(host.querySelector('tr[aria-rowindex="2"] td[aria-colindex="32"]')?.textContent).toBe('Wide source column');
    } finally { viewer.destroy(); }
  });

  it('retains rich text, source fills, borders and font changes across grid windows', async () => {
    const fixture = createNumbersStyledFixture(), { host, viewer, grid, table } = await open(fixture);
    try {
      const first = table.querySelector<HTMLTableCellElement>('tr[aria-rowindex="2"] td[aria-colindex="2"]')!;
      expect(first.style.backgroundColor).toBe('rgb(254, 243, 199)');
      expect(first.style.borderTopStyle).toBe('dashed'); expect(first.style.borderBottomStyle).toBe('double');
      expect(first.style.verticalAlign).toBe('bottom');
      const frame = first.querySelector<HTMLElement>('.pptxv-text-frame')!;
      expect(frame.style.padding).toBe('6px 10px 8px 12px');
      expect(frame.querySelectorAll('p')).toHaveLength(2);
      const runs = frame.querySelectorAll<HTMLElement>('.pptxv-run');
      expect(runs[0].style.fontFamily).toContain('Courier New'); expect(runs[0].style.fontSize).toBe('18px');
      expect(runs[0].style.fontWeight).toBe('700'); expect(runs[0].style.textDecoration).toBe('underline');
      expect(runs[0].getAttribute('href')).toBe('https://example.com/report');
      expect(runs[1].style.fontStyle).toBe('italic'); expect(runs[1].style.textDecoration).toBe('line-through');
      expect(runs[1].style.verticalAlign).toBe('0.2em');
      expect(table.querySelector<HTMLTableCellElement>('tr[aria-rowindex="3"] td[aria-colindex="2"]')!.style.backgroundImage).toContain('linear-gradient');
      grid.scrollTop = 26 * 135; grid.scrollLeft = 96 * 10; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(Number(table.querySelector('[data-merge-ref="91:2"]')?.parentElement?.getAttribute('aria-rowindex') ?? 0)).toBeGreaterThan(100));
      const merged = table.querySelector<HTMLTableCellElement>('[data-merge-ref="91:2"]')!;
      expect(merged.style.borderTopWidth).toBe('0px'); expect(merged.style.borderBottomWidth).toBe('0px');
      expect(merged.style.borderLeftWidth).toBe('0px'); expect(merged.style.backgroundSize).toContain('3900px');
      expect(merged.querySelector<HTMLElement>('.pptxv-text-frame')!.style.justifyContent).toBe('center');
      grid.scrollTop = 26 * 2000; grid.scrollLeft = 96 * 64; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(table.querySelector('tr[aria-rowindex="2001"] td[aria-colindex="65"]')?.textContent).toBe('Styled last'));
      fixture.sheets[0].tables[0].item.cells[1].textFrame.paragraphs[0].runs[0].fontFamily = 'Loaded Mono';
      viewer.refreshFonts();
      expect(host.querySelector<HTMLElement>('tr[aria-rowindex="2001"] .pptxv-run')!.style.fontFamily).toContain('Loaded Mono');
    } finally { viewer.destroy(); }
  });

  it('reaches distant sparse cells while bounding DOM rows and columns and preserving other tables', async () => {
    const { host, viewer, grid, table } = await open();
    try {
      expect(table.querySelectorAll('.xlsxv-cell').length).toBeLessThanOrEqual(2000);
      expect(table.getAttribute('aria-rowcount')).toBe('100001');
      expect(host.querySelectorAll('table')).toHaveLength(2);
      expect(host.querySelectorAll('table')[1].textContent).toContain('tail first');
      grid.scrollTop = 26 * 100_000; grid.scrollLeft = 96 * 1024;
      grid.dispatchEvent(new Event('scroll'));
      const last = () => table.querySelector('tr[aria-rowindex="100001"] td[aria-colindex="1025"]');
      await vi.waitFor(() => expect(last()?.textContent).toBe('large last'));
      expect(table.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(100);
      expect(table.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
      viewer.refreshFonts();
      const refreshed = host.querySelector<HTMLTableElement>('table')!;
      const nextGrid = host.querySelector<HTMLElement>('.xlsxv-grid')!;
      expect([nextGrid.scrollTop, nextGrid.scrollLeft]).toEqual([grid.scrollTop, grid.scrollLeft]);
      expect(refreshed.querySelector('tr[aria-rowindex="100001"] td[aria-colindex="1025"]')?.textContent).toBe('large last');
      viewer.goToSheet(1);
      expect(host.querySelectorAll('table')).toHaveLength(1);
      expect(host.querySelector('table')?.textContent).toContain('other first');
      const detached = refreshed.innerHTML;
      nextGrid.scrollTop = 0; nextGrid.dispatchEvent(new Event('scroll'));
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(refreshed.innerHTML).toBe(detached);
    } finally { viewer.destroy(); }
    expect(host.childElementCount).toBe(0);
  });

  it('cancels a pending row update when a new file replaces the sheet', async () => {
    const { viewer, grid, table } = await open();
    try {
      grid.scrollTop = 26 * 50_000; grid.dispatchEvent(new Event('scroll'));
      const before = table.innerHTML;
      parse.mockResolvedValue(createNumbersWindowFixture(2, 2));
      await viewer.preview(new Uint8Array([4, 5, 6]));
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(table.innerHTML).toBe(before);
    } finally { viewer.destroy(); }
  });

  it('windows picture cells using variable source heights and preserves measured heights across horizontal turns and font refresh', async () => {
    const doc = createNumbersWindowFixture(2000, 64), item = doc.sheets[0].tables[0].item;
    item.rows[0] = 70; item.rows[1999] = 120;
    for (const cell of item.cells) cell.fill = { type: 'picture', mediaId: 'photo' };
    doc.media.photo = { id: 'photo', path: 'photo.svg', contentType: 'image/svg+xml', data: new TextEncoder().encode('<svg/>') };
    parse.mockResolvedValue(doc);
    let expanded = false;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const grid = this.closest('.xlsxv-grid');
      if (this.tagName === 'TABLE') return { top: -(grid?.scrollTop ?? 0), left: -(grid?.scrollLeft ?? 0), width: grid ? 64 * 96 + 48 + (grid.scrollLeft ? 1 : 0) : 0 } as DOMRect;
      if (this.tagName === 'TR') return { height: expanded && this.getAttribute('aria-rowindex') === '2' ? 180 : parseFloat(this.style.height) || 26 } as DOMRect;
      return { top: 0, left: 0, width: 800, height: 600 } as DOMRect;
    });
    const host = document.body.appendChild(document.createElement('div')), viewer = createIworkViewer(host);
    try {
      await viewer.preview(new Uint8Array([1, 2, 3]));
      const grid = host.querySelector<HTMLElement>('.xlsxv-grid')!, table = grid.querySelector('table')!;
      expect(table.getAttribute('aria-rowcount')).toBe('2001');
      expect(table.querySelectorAll('.xlsxv-cell').length).toBeLessThanOrEqual(2400);
      const first = () => table.querySelector<HTMLElement>('tr[aria-rowindex="2"]')!;
      expect(first().style.height).toBe('70px');
      expanded = true; table.querySelector('img')!.dispatchEvent(new Event('load'));
      await vi.waitFor(() => expect(first().style.height).toBe('180px'));
      grid.scrollLeft = 96 * 64; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(table.querySelector('td[aria-colindex="65"]')).not.toBeNull());
      expect(first().style.height).toBe('180px'); expect(table.querySelector('img')).toBeNull();
      grid.scrollTop = 100_000; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(table.querySelector('tr[aria-rowindex="2001"] td[aria-colindex="65"] img')).not.toBeNull());
      viewer.refreshFonts();
      expect(host.querySelector('tr[aria-rowindex="2001"] td[aria-colindex="65"] img')).not.toBeNull();
      expect(host.querySelectorAll('tbody tr[aria-rowindex]').length).toBeLessThanOrEqual(103);
    } finally { viewer.destroy(); }
  });

  it('retains incremental picture-cell loading when virtualization is explicitly disabled', async () => {
    const doc = createNumbersWindowFixture(200, 2);
    const item = doc.sheets[0].tables[0].item;
    item.columns = [40, 320];
    item.cells[1].fill = { type: 'picture', mediaId: 'photo' };
    Object.assign(item.cells[1].textFrame.paragraphs[0].runs[0], { fontFamily: 'Incremental Mono', fontSize: 20, bold: true });
    doc.media.photo = { id: 'photo', path: 'photo.svg', contentType: 'image/svg+xml', data: new TextEncoder().encode('<svg/>') };
    parse.mockResolvedValue(doc);
    const host = document.body.appendChild(document.createElement('div')), viewer = createIworkViewer(host, { virtual: false });
    try {
      await viewer.preview(new Uint8Array([1, 2, 3]));
      const grid = host.querySelector('.xlsxv-grid')!, table = grid.querySelector('table')!;
      expect(table.tBodies[0].rows).toHaveLength(100);
      grid.dispatchEvent(new Event('scroll'));
      expect(table.tBodies[0].rows).toHaveLength(200);
      expect(table.style.width).toBe('408px');
      expect(table.querySelector<HTMLElement>('tr[aria-rowindex="201"] td[aria-colindex="3"]')!.style.width).toBe('320px');
      expect(table.querySelector('tr[aria-rowindex="201"] td[aria-colindex="3"] img.iworkv-cell-image')).not.toBeNull();
      const run = table.querySelector<HTMLElement>('tr[aria-rowindex="201"] td[aria-colindex="3"] .pptxv-run')!;
      expect(run.style.fontFamily).toContain('Incremental Mono'); expect(run.style.fontSize).toBe('20px');
      expect(run.style.fontWeight).toBe('700');
    } finally { viewer.destroy(); }
  });

  it('extends merged picture cells across incremental batches without duplicate anchors', async () => {
    const doc = createNumbersWindowFixture(200, 2), item = doc.sheets[0].tables[0].item;
    item.cells.push({ row: 90, column: 0, rowSpan: 50, colSpan: 2, isMergedContinuation: false,
      fill: { type: 'picture', mediaId: 'photo' }, textFrame: { paragraphs: [{ runs: [{ text: 'Merged picture' }] }] } });
    doc.media.photo = { id: 'photo', path: 'photo.svg', contentType: 'image/svg+xml', data: new TextEncoder().encode('<svg/>') };
    parse.mockResolvedValue(doc);
    const host = document.body.appendChild(document.createElement('div')), viewer = createIworkViewer(host, { virtual: false });
    try {
      await viewer.preview(new Uint8Array([1, 2, 3]));
      const grid = host.querySelector('.xlsxv-grid')!, table = grid.querySelector('table')!;
      const merge = table.querySelector<HTMLTableCellElement>('[data-merge-ref="91:1"]')!;
      expect([merge.rowSpan, merge.colSpan, merge.textContent]).toEqual([50, 2, 'Merged picture']);
      expect(merge.querySelector('img')).not.toBeNull();
      grid.dispatchEvent(new Event('scroll'));
      expect(table.querySelectorAll('[data-merge-ref="91:1"]')).toHaveLength(1);
      expect(table.querySelector('tr[aria-rowindex="102"] td')).toBeNull();
      expect(table.querySelector('tr[aria-rowindex="201"] td[aria-colindex="3"]')?.textContent).toBe('large last');
    } finally { viewer.destroy(); }
  });
});
