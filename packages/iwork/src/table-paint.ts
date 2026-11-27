import type { TableCell } from '@filens/core';

export type TableBorderSide = NonNullable<TableCell['borders']>['top'];
export type ResolvedTableBorderSide = TableBorderSide | false | undefined;
type ResolvedTableStyleBorders = Record<'top' | 'right' | 'bottom' | 'left', ResolvedTableBorderSide>;

export interface TableGridPaint {
  bandedFill?: TableCell['fill'];
  bodyHorizontalStroke?: ResolvedTableBorderSide;
  bodyVerticalStroke?: ResolvedTableBorderSide;
  bodyHorizontalBorderStroke?: ResolvedTableBorderSide;
  bodyVerticalBorderStroke?: ResolvedTableBorderSide;
  headerRowHorizontalStroke?: ResolvedTableBorderSide;
  headerRowVerticalStroke?: ResolvedTableBorderSide;
  headerRowBorderStroke?: ResolvedTableBorderSide;
  headerRowSeparatorStroke?: ResolvedTableBorderSide;
  headerColumnHorizontalStroke?: ResolvedTableBorderSide;
  headerColumnVerticalStroke?: ResolvedTableBorderSide;
  headerColumnBorderStroke?: ResolvedTableBorderSide;
  headerColumnSeparatorStroke?: ResolvedTableBorderSide;
  footerRowHorizontalStroke?: ResolvedTableBorderSide;
  footerRowVerticalStroke?: ResolvedTableBorderSide;
  footerRowBorderStroke?: ResolvedTableBorderSide;
  footerRowSeparatorStroke?: ResolvedTableBorderSide;
  vStrokesVisible?: boolean;
  hStrokesVisible?: boolean;
  hrSeparatorVisible?: boolean;
  hcSeparatorVisible?: boolean;
  footerSeparatorVisible?: boolean;
  tableBorderVisible?: boolean;
  tableHeaderBorderVisible?: boolean;
  tableHcDividerVisible?: boolean;
  tableHrDividerVisible?: boolean;
  tableFooterDividerVisible?: boolean;
  presetVisibleMask?: number;
}

export interface TableGridRegions {
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  headerColumnCount: number;
  footerRowCount: number;
}

export type TableRegion = 'body' | 'headerRow' | 'headerColumn' | 'footerRow';

export interface SourceCellPaint {
  fill: TableCell['fill'];
  strokes: ResolvedTableStyleBorders;
  fallbackStroke?: TableBorderSide;
}

export interface NumbersBlankCellStyles {
  gridPaint: TableGridPaint;
  regions: TableGridRegions;
  defaults: Partial<Record<TableRegion, SourceCellPaint>>;
  rows: Readonly<Record<number, SourceCellPaint>>;
  columns: Readonly<Record<number, SourceCellPaint>>;
}

const fallbackStroke: TableBorderSide = { color: '#cbd5e1', width: 1 };
const emptyCellPaint: SourceCellPaint = {
  fill: { type: 'none' },
  strokes: { top: undefined, right: undefined, bottom: undefined, left: undefined }
};

export function tableRegion(row: number, column: number, { rowCount, headerRowCount, headerColumnCount, footerRowCount }: TableGridRegions): TableRegion {
  if (row < headerRowCount) return 'headerRow';
  if (footerRowCount > 0 && row >= rowCount - footerRowCount) return 'footerRow';
  return column < headerColumnCount ? 'headerColumn' : 'body';
}

export function blankCellPaint(styles: NumbersBlankCellStyles, row: number, column: number): Pick<TableCell, 'fill' | 'borders'> {
  const { rows, columns, defaults, gridPaint, regions } = styles;
  const source = rows[row] ?? columns[column] ?? defaults[tableRegion(row, column, regions)] ?? emptyCellPaint;
  return {
    fill: resolveTableCellFill(source.fill, gridPaint, row, regions.headerRowCount, regions.footerRowCount, regions.rowCount),
    borders: resolveCellBorders(source, gridPaint, row, column, regions)
  };
}

export function resolveCellBorders(
  { strokes, fallbackStroke: localFallback }: SourceCellPaint,
  gridPaint: TableGridPaint,
  row: number,
  column: number,
  { rowCount, columnCount, headerRowCount, headerColumnCount, footerRowCount }: TableGridRegions
): TableCell['borders'] {
  const tableBorders = resolveTableStyleBorders(gridPaint, row, column, rowCount, columnCount, headerRowCount, headerColumnCount, footerRowCount);
  const fallback = localFallback ?? fallbackStroke;
  const borders = {
    top: resolveBorderSide(strokes.top, tableBorders.top, fallback),
    right: resolveBorderSide(strokes.right, tableBorders.right, fallback),
    bottom: resolveBorderSide(strokes.bottom, tableBorders.bottom, fallback),
    left: resolveBorderSide(strokes.left, tableBorders.left, fallback)
  };
  return Object.values(borders).some(Boolean) ? borders : undefined;
}

function resolveBorderSide(
  local: ResolvedTableBorderSide,
  tableStyle: ResolvedTableBorderSide,
  fallback: TableBorderSide
): TableBorderSide {
  if (local === false) {
    return undefined;
  }
  if (local) {
    return local;
  }
  if (tableStyle === false) {
    return undefined;
  }
  return tableStyle ?? fallback;
}

function resolveTableStyleBorders(
  styleDefaults: TableGridPaint,
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  headerRowCount: number,
  headerColumnCount: number,
  footerRowCount: number
): ResolvedTableStyleBorders {
  const isHeaderRow = row < headerRowCount;
  const isHeaderColumn = column < headerColumnCount;
  const isFooter = footerRowCount > 0 && row >= rowCount - footerRowCount;
  if (isHeaderRow) {
    return {
      top: visibleStroke(
        row === 0 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowHorizontalStroke) : styleDefaults.headerRowHorizontalStroke,
        styleDefaults.hStrokesVisible,
        row === 0 ? styleDefaults.tableHeaderBorderVisible : undefined,
        row === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'top') : undefined
      ),
      right: visibleStroke(
        column === columnCount - 1 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowVerticalStroke) : styleDefaults.headerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === columnCount - 1 ? styleDefaults.tableHeaderBorderVisible : undefined,
        column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      ),
      bottom:
        row === headerRowCount - 1
          ? visibleStroke(
              styleDefaults.headerRowSeparatorStroke ?? styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowHorizontalStroke,
              styleDefaults.hStrokesVisible,
              styleDefaults.hrSeparatorVisible,
              styleDefaults.tableHrDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
            )
          : visibleStroke(styleDefaults.headerRowHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      left: visibleStroke(
        column === 0 ? (styleDefaults.headerRowBorderStroke ?? styleDefaults.headerRowVerticalStroke) : styleDefaults.headerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableHeaderBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  if (isFooter) {
    return {
      top:
        row === rowCount - footerRowCount
          ? visibleStroke(
              styleDefaults.footerRowSeparatorStroke ?? styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowHorizontalStroke,
              styleDefaults.hStrokesVisible,
              styleDefaults.footerSeparatorVisible,
              styleDefaults.tableFooterDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
            )
          : visibleStroke(styleDefaults.footerRowHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      right: visibleStroke(
        column === columnCount - 1 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowVerticalStroke) : styleDefaults.footerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === columnCount - 1 ? styleDefaults.tableBorderVisible : undefined,
        column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      ),
      bottom: visibleStroke(
        row === rowCount - 1 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowHorizontalStroke) : styleDefaults.footerRowHorizontalStroke,
        styleDefaults.hStrokesVisible,
        row === rowCount - 1 ? styleDefaults.tableBorderVisible : undefined,
        row === rowCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'bottom') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
      ),
      left: visibleStroke(
        column === 0 ? (styleDefaults.footerRowBorderStroke ?? styleDefaults.footerRowVerticalStroke) : styleDefaults.footerRowVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  if (isHeaderColumn) {
    return {
      top: visibleStroke(styleDefaults.headerColumnHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, row === 0 ? 'top' : 'insideH')),
      right:
        column === headerColumnCount - 1
          ? visibleStroke(
              styleDefaults.headerColumnSeparatorStroke ?? styleDefaults.headerColumnBorderStroke ?? styleDefaults.headerColumnVerticalStroke,
              styleDefaults.vStrokesVisible,
              styleDefaults.hcSeparatorVisible,
              styleDefaults.tableHcDividerVisible,
              presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
            )
          : visibleStroke(styleDefaults.headerColumnVerticalStroke, styleDefaults.vStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')),
      bottom: visibleStroke(styleDefaults.headerColumnHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
      left: visibleStroke(
        column === 0 ? (styleDefaults.headerColumnBorderStroke ?? styleDefaults.headerColumnVerticalStroke) : styleDefaults.headerColumnVerticalStroke,
        styleDefaults.vStrokesVisible,
        column === 0 ? styleDefaults.tableBorderVisible : undefined,
        column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
      )
    };
  }

  return {
    top: visibleStroke(
      row === 0 ? (styleDefaults.bodyHorizontalBorderStroke ?? styleDefaults.bodyHorizontalStroke) : styleDefaults.bodyHorizontalStroke,
      styleDefaults.hStrokesVisible,
      row === 0 ? styleDefaults.tableBorderVisible : undefined,
      row === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'top') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
    ),
    right: visibleStroke(
      column === columnCount - 1 ? (styleDefaults.bodyVerticalBorderStroke ?? styleDefaults.bodyVerticalStroke) : styleDefaults.bodyVerticalStroke,
      styleDefaults.vStrokesVisible,
      column === columnCount - 1 ? styleDefaults.tableBorderVisible : undefined,
      column === columnCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'right') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
    ),
    bottom:
      row === rowCount - 1 || (footerRowCount > 0 && row === rowCount - footerRowCount - 1)
        ? visibleStroke(
            styleDefaults.bodyHorizontalBorderStroke ?? styleDefaults.bodyHorizontalStroke,
            styleDefaults.hStrokesVisible,
            styleDefaults.tableBorderVisible,
            row === rowCount - 1 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'bottom') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')
          )
        : visibleStroke(styleDefaults.bodyHorizontalStroke, styleDefaults.hStrokesVisible, presetBorderVisible(styleDefaults.presetVisibleMask, 'insideH')),
    left: visibleStroke(
      column === 0 ? (styleDefaults.bodyVerticalBorderStroke ?? styleDefaults.bodyVerticalStroke) : styleDefaults.bodyVerticalStroke,
      styleDefaults.vStrokesVisible,
      column === 0 ? styleDefaults.tableBorderVisible : undefined,
      column === 0 ? presetBorderVisible(styleDefaults.presetVisibleMask, 'left') : presetBorderVisible(styleDefaults.presetVisibleMask, 'insideV')
    )
  };
}

function visibleStroke(stroke: ResolvedTableBorderSide, ...flags: Array<boolean | undefined>): ResolvedTableBorderSide {
  if (stroke === false) {
    return false;
  }
  return flags.some((flag) => flag === false) ? false : stroke;
}

function presetBorderVisible(mask: number | undefined, side: 'top' | 'right' | 'bottom' | 'left' | 'insideH' | 'insideV'): boolean | undefined {
  if (typeof mask !== 'number' || !Number.isFinite(mask)) {
    return undefined;
  }

  const bits: Record<typeof side, number> = {
    top: 1,
    right: 2,
    bottom: 4,
    left: 8,
    insideH: 16,
    insideV: 32
  };
  return (Math.trunc(mask) & bits[side]) !== 0;
}

export function resolveTableCellFill(
  localFill: TableCell['fill'],
  styleDefaults: TableGridPaint,
  row: number,
  headerRowCount: number,
  footerRowCount: number,
  rowCount: number
): TableCell['fill'] {
  if (localFill.type !== 'none') {
    return localFill;
  }

  if (!styleDefaults.bandedFill) {
    return localFill;
  }

  const isHeader = row < headerRowCount;
  const isFooter = footerRowCount > 0 && row >= rowCount - footerRowCount;
  if (isHeader || isFooter) {
    return localFill;
  }

  return (row - headerRowCount) % 2 === 1 ? styleDefaults.bandedFill : localFill;
}
