// Shared by XLSX and iWork; importing tables never imports a workbook parser.
import { buildPreviewFontStack } from '@filens/core';
import { resolveCellValue } from './cell-value';
import { columnIndexToName } from './columns';
import type { ParsedCell, ParsedRow, ParsedSheet } from './types';
export type { ParsedSheet } from './types';

export const ROW_BATCH_SIZE = 100;

export function createSheetTable(sheet: ParsedSheet, rowCount = Math.max(sheet.rowCount, 1)): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'xlsxv-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'xlsxv-corner';
  headerRow.appendChild(corner);
  for (let column = 1; column <= Math.max(sheet.columnCount, 1); column += 1) {
    const header = document.createElement('th');
    header.className = 'xlsxv-col-header';
    header.textContent = columnIndexToName(column);
    headerRow.appendChild(header);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  appendSheetRows(tbody, sheet, 1, rowCount);
  table.appendChild(tbody);
  return table;
}

export function appendSheetRows(tbody: HTMLTableSectionElement, sheet: ParsedSheet, firstRow: number, lastRow: number): void {
  if (firstRow > lastRow) return;
  const fontStacks = new Map<ParsedCell['font'], string>();
  // Index only this batch. Preserve unordered/duplicate rows and caller edits
  // without allocating a complete-sheet map on every scroll.
  const rowMap = new Map<number, ParsedRow>();
  for (const row of sheet.rows) {
    if (row.index >= firstRow && row.index <= lastRow) rowMap.set(row.index, row);
  }
  const fragment = document.createDocumentFragment();
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = rowMap.get(rowIndex);
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.className = 'xlsxv-row-header';
    rowHeader.textContent = String(rowIndex);
    tr.appendChild(rowHeader);
    const cells = new Map(row?.cells.map((cell) => [cell.column, cell]) ?? []);
    for (let column = 1; column <= Math.max(sheet.columnCount, 1); column += 1) {
      const td = document.createElement('td');
      td.className = 'xlsxv-cell';
      const cell = cells.get(column);
      td.textContent = cell ? resolveCellValue(sheet, cell) : '';
      if (cell?.font?.fontFamily) {
        let stack = fontStacks.get(cell.font);
        if (!stack) {
          stack = buildPreviewFontStack(cell.font.fontFamily, cell.font.traits, cell.font.resolvedFontFamily ? [cell.font.resolvedFontFamily] : []);
          fontStacks.set(cell.font, stack);
        }
        td.style.fontFamily = stack;
        if (cell.font.traits?.weight) td.style.fontWeight = String(cell.font.traits.weight);
      }
      tr.appendChild(td);
    }
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

