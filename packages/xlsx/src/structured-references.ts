import type { Reference, ReferenceValue } from './formula-reader';
import type { ParsedTableRange } from './types';

const escapable = /[\[\]'#@]/;
const sectionNames = ['#all', '#headers', '#data', '#totals', '#this row'];

export function structuredBracketEnd(source: string, start: number): number | undefined {
  let depth = 1;
  for (let at = start + 1; at < source.length; at++) {
    if (source[at] === "'" && escapable.test(source[at + 1] ?? '')) at++;
    else if (source[at] === '[') depth++;
    else if (source[at] === ']' && --depth === 0) return at + 1;
  }
}

export function decodeTableColumn(value: string): string {
  return value.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export interface TableReferenceSource {
  table: ParsedTableRange;
  sheet: string;
  row: number;
  column: number;
  sameSheet: boolean;
}

export function tableReference(source: TableReferenceSource, specifier: string): ReferenceValue | null | '#REF!' | '#VALUE!' {
  const selection = readSpecifier(specifier);
  if (!selection) return '#REF!';
  const { table, sheet, row, column } = source;
  const { sections, columns } = selection;
  const indexes = columns.map(name => {
    const key = name.toLowerCase(), decoded = decodeTableColumn(name).toLowerCase();
    const index = table.columns.findIndex(column => column.toLowerCase() === key);
    return index >= 0 || key === decoded ? index : table.columns.findIndex(column => column.toLowerCase() === decoded);
  });
  if (indexes.includes(-1)) return '#REF!';
  const firstColumn = indexes.length ? table.firstColumn + Math.min(...indexes) : table.firstColumn;
  const lastColumn = indexes.length ? table.firstColumn + Math.max(...indexes) : table.lastColumn;
  const dataStart = table.firstRow + table.headerRows, dataEnd = table.lastRow - table.totalRows;
  const areas: Reference[] = [];
  const add = (firstRow: number, lastRow: number) => {
    if (firstRow > lastRow) return;
    const previous = areas.at(-1);
    if (previous && previous.lastRow + 1 === firstRow) previous.lastRow = lastRow;
    else areas.push({ sheet, firstRow, lastRow, firstColumn, lastColumn });
  };
  if (sections.has('#this row')) {
    if (row < dataStart || row > dataEnd) return '#VALUE!';
    add(row, row);
  } else if (sections.has('#all')) {
    add(table.firstRow, table.lastRow);
  } else {
    if (sections.has('#headers')) {
      if (!table.headerRows) return '#REF!';
      add(table.firstRow, dataStart - 1);
    }
    if (!sections.size || sections.has('#data')) add(dataStart, dataEnd);
    if (sections.has('#totals')) add(dataEnd + 1, table.lastRow);
  }
  if (!areas.length) return null;
  const [area] = areas;
  const isRange = areas.length > 1 || area.firstRow !== area.lastRow || firstColumn !== lastColumn;
  let implicitCell: Reference | undefined;
  if (isRange && areas.length === 1 && source.sameSheet && row >= area.firstRow && row <= area.lastRow
    && column >= table.firstColumn && column <= table.lastColumn) {
    const selectedColumn = firstColumn === lastColumn ? firstColumn : column;
    if (selectedColumn >= firstColumn && selectedColumn <= lastColumn) {
      implicitCell = { sheet, firstRow: row, lastRow: row, firstColumn: selectedColumn, lastColumn: selectedColumn };
    }
  }
  return { areas, isRange, ...(implicitCell ? { implicitCell } : {}) };
}

function readSpecifier(specifier: string): { sections: Set<string>; columns: string[] } | undefined {
  const sections = new Set<string>(), columns: string[] = [];
  let content = specifier.slice(1, -1);
  if (content.startsWith('@')) {
    sections.add('#this row');
    content = content.slice(1);
  }
  const add = (part: string, separator: string): boolean => {
    if (part.startsWith('#')) {
      const key = part.trim().toLowerCase();
      if (separator === ':' || !sectionNames.includes(key)) return false;
      sections.add(key);
    } else {
      if (!part || columns.length === 2 || (separator === ':') !== (columns.length === 1)) return false;
      columns.push(part.replace(/'([\[\]'#@])/g, '$1'));
    }
    return true;
  };
  if (content.trimStart().startsWith('[')) {
    content = content.trim();
    for (let at = 0, separator = '';;) {
      const end = content[at] === '[' ? structuredBracketEnd(content, at) : undefined;
      if (end === undefined || !add(content.slice(at + 1, end - 1), separator)) return undefined;
      const tail = content.slice(end).trimStart();
      if (!tail) break;
      separator = tail[0];
      if (separator !== ',' && separator !== ':') return undefined;
      const next = tail.slice(1).trimStart();
      at = content.length - next.length;
    }
  } else if (content && !add(content, '')) return undefined;
  if ((sections.has('#this row') || sections.has('#all')) && sections.size > 1) return undefined;
  return { sections, columns };
}
