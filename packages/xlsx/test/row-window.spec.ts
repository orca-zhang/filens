import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendSheetRows, createSheetTable, SheetRowWindow } from '../src/table';
import type { ParsedRow, ParsedSheet } from '../src/types';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('workbook row windows', () => {
  it('uses layout height when offscreen rectangles lose precision near the final Excel row', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(26);
    vi.spyOn(HTMLTableRowElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 28 } as DOMRect);
    const grid = document.body.appendChild(document.createElement('div'));
    const view = new SheetRowWindow({ id: 'last', name: 'Last', rowCount: 1_048_576, columnCount: 1, rows: [] }, grid);
    try {
      grid.scrollTop = 26 * 1_048_576; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(view.table.querySelector('tr[aria-rowindex="1048577"]')).not.toBeNull());
      expect(view.table.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(100);
    } finally { view.destroy(); }
  });

  it('preserves narrow source columns and merged widths across incremental batches', () => {
    const sheet: ParsedSheet = { id: 'sized', name: 'Sized', rowCount: 200, columnCount: 3,
      columnWidths: [30, 300, 60], rows: [{ index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: 'Heading' }] }],
      merges: [{ firstRow: 1, lastRow: 1, firstColumn: 1, lastColumn: 2 }] };
    const table = createSheetTable(sheet, 100);
    expect(table.classList.contains('xlsxv-source-columns')).toBe(true);
    expect(table.style.width).toBe('438px');
    expect([...table.querySelectorAll<HTMLElement>('.xlsxv-col-header')].map(cell => cell.style.width)).toEqual(['30px', '300px', '60px']);
    expect(table.querySelector<HTMLElement>('[data-merge-ref="A1"]')!.style.width).toBe('330px');
    appendSheetRows(table.tBodies[0], sheet, 101, 200);
    expect(table.querySelector<HTMLElement>('tr[aria-rowindex="201"] td[aria-colindex="3"]')!.style.width).toBe('300px');
  });

  it('uses cumulative source widths for windows, spacers and merged gradients', async () => {
    const sheet: ParsedSheet = { id: 'sized', name: 'Sized', rowCount: 1, columnCount: 64,
      columnWidths: Array.from({ length: 64 }, (_, index) => [30, 200, 50, 400][index % 4]),
      rows: [{ index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: 'Wide merge' }] }],
      merges: [{ firstRow: 1, lastRow: 1, firstColumn: 1, lastColumn: 64 }] };
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(grid, 'clientWidth', { value: 800 });
    const view = new SheetRowWindow(sheet, grid, grid, { renderCell: cell => {
      cell.style.backgroundImage = 'linear-gradient(red, blue)'; cell.style.backgroundRepeat = 'no-repeat';
    } });
    try {
      grid.scrollLeft = 5440; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(view.table.querySelector('.xlsxv-col-header')?.textContent).toBe('AC'));
      expect(view.table.style.width).toBe('10928px');
      expect([...view.table.querySelectorAll<HTMLElement>('thead .xlsxv-column-spacer')].map(cell => cell.style.width)).toEqual(['4760px', '2720px']);
      const merge = view.table.querySelector<HTMLTableCellElement>('[data-merge-ref="A1"]')!;
      expect([merge.colSpan, merge.style.width]).toEqual([20, '3400px']);
      expect(merge.querySelector<HTMLElement>('.xlsxv-merged-content')!.style.width).toContain('10880px');
      expect(merge.querySelector<HTMLElement>('.xlsxv-merged-content')!.style.left).toContain('-4760px');
      expect(merge.style.backgroundSize).toBe('10880px 26px');
      expect(merge.style.backgroundPosition).toBe('-4760px 0px');
      expect(merge.style.borderLeftWidth).toBe('0px'); expect(merge.style.borderRightWidth).toBe('0px');
      expect(view.table.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
    } finally { view.destroy(); }
  });

  it('accounts for table offsets within a shared scroll viewport and preserves sibling content', async () => {
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperties(grid, { clientHeight: { value: 600 }, clientWidth: { value: 800 }, clientTop: { value: 1 }, clientLeft: { value: 1 } });
    grid.getBoundingClientRect = () => ({ top: 40, left: 20 }) as DOMRect;
    const title = grid.appendChild(document.createElement('h3')); title.textContent = 'First table';
    const mount = grid.appendChild(document.createElement('section'));
    const view = new SheetRowWindow({ id: 'second', name: 'Second', rowCount: 10_000, columnCount: 1024, rows: [] }, grid, mount);
    view.table.getBoundingClientRect = () => ({ top: 41 + 26_000 - grid.scrollTop, left: 21 + 96 - grid.scrollLeft }) as DOMRect;
    try {
      grid.scrollTop = 26_000 + 26 * 5000; grid.scrollLeft = 96 + 96 * 500;
      grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(view.table.querySelector('tbody tr[aria-rowindex]')?.getAttribute('aria-rowindex')).toBe('4992'));
      expect(view.table.querySelector('.xlsxv-col-header')?.getAttribute('aria-colindex')).toBe('498');
      expect(title.parentElement).toBe(grid);
      expect(view.table.parentElement).toBe(mount);
      expect(view.table.querySelectorAll('.xlsxv-cell')).toHaveLength(2000);
    } finally { view.destroy(); }
  });

  it('bounds both dimensions through Excel’s last cell without losing offscreen formula dependencies', async () => {
    const font = { fontFamily: 'Original' } as { fontFamily: string; resolvedFontFamily?: string };
    const sheet: ParsedSheet = {
      id: 'wide', name: 'Wide', rowCount: 1_048_576, columnCount: 16_384,
      rows: [
        { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '7' }] },
        { index: 1_048_576, cells: [
          { ref: 'XFD1048576', row: 1_048_576, column: 16_384, value: 'old' },
          { ref: 'A1048576', row: 1_048_576, column: 1, value: 'left' },
          { ref: 'XFD1048576', row: 1_048_576, column: 16_384, value: '', formula: 'A1*3', needsCalculation: true, font }
        ] }
      ]
    };
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperties(grid, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const view = new SheetRowWindow(sheet, grid);
    try {
      expect(grid.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
      expect(grid.querySelectorAll('.xlsxv-cell')).toHaveLength(2000);
      expect(view.table.getAttribute('aria-colcount')).toBe('16385');
      grid.scrollTop = 26 * 1_048_576; grid.scrollLeft = 96 * 16_384;
      grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(grid.querySelector('tr[aria-rowindex="1048577"] .xlsxv-cell[aria-colindex="16385"]')?.textContent).toBe('21'));
      expect(grid.querySelector('.xlsxv-col-header[aria-colindex="16385"]')?.textContent).toBe('XFD');
      expect(grid.querySelectorAll('.xlsxv-cell')).toHaveLength(2000);
      expect(grid.querySelectorAll('.xlsxv-col-header')).toHaveLength(20);
      font.resolvedFontFamily = 'Loaded';
      const top = grid.scrollTop, left = grid.scrollLeft;
      view.refresh();
      expect(grid.querySelector('tr[aria-rowindex="1048577"] .xlsxv-cell[aria-colindex="16385"]')?.textContent).toBe('21');
      expect(grid.querySelector<HTMLElement>('tr[aria-rowindex="1048577"] .xlsxv-cell[aria-colindex="16385"]')?.style.fontFamily).toContain('Loaded');
      expect([grid.scrollTop, grid.scrollLeft]).toEqual([top, left]);
      grid.scrollTop = grid.scrollLeft = 0; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(grid.querySelector('tr[aria-rowindex="2"] .xlsxv-cell[aria-colindex="2"]')?.textContent).toBe('7'));
    } finally { view.destroy(); }
  });

  it('reaches the last of a million sparse rows and evaluates dependencies outside the window', async () => {
    const sheet: ParsedSheet = {
      id: 'sparse', name: 'Sparse', rowCount: 1_048_576, columnCount: 1,
      rows: [
        { index: 1_048_576, cells: [{ ref: 'A1048576', row: 1_048_576, column: 1, value: 'old' }] },
        { index: 1, cells: [{ ref: 'A1', row: 1, column: 1, value: '7' }] },
        { index: 1_048_576, cells: [{ ref: 'A1048576', row: 1_048_576, column: 1, value: '', formula: 'A1*3', needsCalculation: true }] }
      ]
    };
    const grid = document.body.appendChild(document.createElement('div'));
    Object.defineProperty(grid, 'clientHeight', { value: 600 });
    const view = new SheetRowWindow(sheet, grid);
    const rows = () => [...grid.querySelectorAll('tbody tr[aria-rowindex]')];
    try {
      expect(view.table.getAttribute('aria-rowcount')).toBe('1048577');
      expect(rows()[0].querySelector('td')?.textContent).toBe('7');
      for (const row of [50_000, 500_000, 1_048_576]) {
        grid.scrollTop = (row - 1) * 26; grid.dispatchEvent(new Event('scroll'));
        await vi.waitFor(() => expect(rows().some(element => element.getAttribute('aria-rowindex') === String(row + 1))).toBe(true));
        expect(rows()).toHaveLength(100);
        expect(grid.querySelectorAll('tbody tr')).toHaveLength(102);
      }
      expect(rows().at(-1)?.querySelector('td')?.textContent).toBe('21');
      expect(rows().at(-1)?.getAttribute('aria-rowindex')).toBe('1048577');
      grid.scrollTop = 0; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(rows()[0].querySelector('td')?.textContent).toBe('7'));
      view.refresh();
      expect(rows()).toHaveLength(100);
    } finally { view.destroy(); }
  });

  it('bounds row access per scroll and cancels pending rendering when destroyed', async () => {
    let reads = 0;
    const source: ParsedRow[] = Array.from({ length: 100_000 }, (_, index) => ({ index: index + 1, cells: [] }));
    const rows = new Proxy(source, { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const grid = document.body.appendChild(document.createElement('div'));
    const view = new SheetRowWindow({ id: 'large', name: 'Large', rows, rowCount: rows.length, columnCount: 1 }, grid);
    try {
      reads = 0;
      grid.scrollTop = 26 * 50_000; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(grid.querySelector('tr[aria-rowindex="50002"]')).not.toBeNull());
      expect(reads).toBeLessThan(200);
      const before = grid.innerHTML;
      grid.scrollTop = 0; grid.dispatchEvent(new Event('scroll'));
      view.destroy();
      await new Promise(resolve => requestAnimationFrame(resolve));
      expect(grid.innerHTML).toBe(before);
    } finally { view.destroy(); }
  });

  it('avoids scanning all populated columns again on horizontal scrolling', async () => {
    let reads = 0;
    const cells = new Proxy(Array.from({ length: 16_384 }, (_, index) => ({
      ref: '', row: 1, column: index + 1, value: String(index + 1)
    })), { get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    } });
    const grid = document.body.appendChild(document.createElement('div'));
    const view = new SheetRowWindow({ id: 'wide', name: 'Wide', rowCount: 1, columnCount: cells.length, rows: [{ index: 1, cells }] }, grid);
    try {
      reads = 0;
      grid.scrollLeft = 96 * 8192; grid.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(grid.querySelector('.xlsxv-cell[aria-colindex="8193"]')?.textContent).toBe('8192'));
      expect(reads).toBeLessThan(100);
      expect(grid.querySelectorAll('.xlsxv-cell')).toHaveLength(20);
    } finally { view.destroy(); }
  });
});
