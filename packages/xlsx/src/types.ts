import type { BorderBox, FillStyle, LineStyle, PreviewFontReference } from '@filens/core';
import type { ConditionalIconSetName } from './conditional-icons';

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
  warnings: string[];
  fonts?: PreviewFontReference[];
  definedNames?: readonly ParsedDefinedName[];
}

export interface ParsedDefinedName {
  name: string;
  formula: string;
  /** Source worksheet name for a sheet-local definition. */
  sheet?: string;
}

export interface ParsedSheet {
  id: string;
  name: string;
  rows: ParsedRow[];
  columnCount: number;
  rowCount: number;
  hiddenRows?: readonly ParsedTrackRange[];
  hiddenColumns?: readonly ParsedTrackRange[];
  /** Source row minimum heights in CSS pixels, indexed from zero. */
  rowHeights?: readonly number[];
  /** XLSX row height metadata in CSS pixels, with sparse one-based overrides. */
  rowHeightSource?: ParsedRowHeightSource;
  /** Source widths in CSS pixels, indexed from zero; XLSX uses a 7px digit baseline before font measurement. */
  columnWidths?: readonly number[];
  /** XLSX character units retained for remeasurement when the Normal font becomes available. */
  columnWidthSource?: ParsedColumnWidthSource;
  /** Saved XLSX worksheet view displays expressions at twice the normal column widths. */
  showFormulas?: boolean;
  /** Whether numeric dates are measured from 1904-01-01. */
  date1904?: boolean;
  /** Workbook RGB overrides for indexed number-format colors. */
  numberFormatPalette?: readonly (string | undefined)[];
  /** Workbook formats and sheet-local column defaults. Indices refer to cellXfs. */
  cellStyles?: { formats: readonly ParsedCellStyle[]; columns: readonly ParsedColumnStyle[]; variableHeight: boolean };
  merges?: ParsedMerge[];
  /** Optional authored border runs on a merged edge, in one-based inclusive source tracks. */
  mergeBorderRuns?: (merge: ParsedMerge, side: keyof BorderBox, first: number, last: number) =>
    readonly (readonly [first: number, last: number, line: LineStyle])[];
  /** Worksheet-local shared formula definitions, addressed by the source si. */
  sharedFormulas?: Readonly<Record<number, ParsedSharedFormula>>;
  /** Result bounds declared by worksheet array formulas. */
  arrayFormulas?: readonly ParsedArrayFormula[];
  /** Excel table definitions used by structured references. */
  tables?: readonly ParsedTableRange[];
  autoFilterRows?: ParsedTrackRange;
  conditionalRules?: readonly ParsedConditionalRule[];
}

export interface ParsedArrayFormula extends ParsedMerge {
  /** The anchor's cell metadata identifies an Excel dynamic array. */
  dynamic?: true;
}

export interface ParsedTableRange extends ParsedMerge {
  name: string;
  headerRows: number;
  totalRows: number;
  columns: readonly string[];
  autoFilterRows?: ParsedTrackRange;
}

export interface ParsedRowHeight {
  height?: number;
  fixed?: boolean;
}

export interface ParsedRowHeightSource extends ParsedRowHeight {
  rows: ReadonlyMap<number, ParsedRowHeight>;
}

/** Inclusive, one-based source coordinates. */
export interface ParsedTrackRange { first: number; last: number }

export interface ParsedColumnWidthSource {
  ranges: readonly { firstColumn: number; lastColumn: number; width: number }[];
  defaultWidth?: number;
  /** Character count excluding the five pixels of cell/grid padding. */
  baseWidth: number;
  font?: PreviewFontReference;
  /** Normal style size in points. */
  fontSize: number;
}

/** Inclusive, one-based source coordinates; never expand a merged range into cells. */
export interface ParsedMerge {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

export interface ParsedSharedFormula extends ParsedMerge {
  row: number;
  column: number;
  formula: string;
}

export type ConditionalComparison = '=' | '<>' | '<' | '<=' | '>' | '>=' | 'between' | 'notBetween';

export type ConditionalThreshold =
  | { type: 'min' | 'max' | 'autoMin' | 'autoMax' }
  | { type: 'num' | 'percent' | 'percentile'; value: number }
  | { type: 'formula'; formula: string };

export type ParsedConditionalVisual =
  | { type: 'colorScale'; thresholds: readonly ConditionalThreshold[]; colors: readonly string[] }
  | ParsedDataBar
  | ParsedIconSet;

export interface ParsedConditionalIcon {
  set: ConditionalIconSetName;
  index: number;
}

export interface ParsedIconSet {
  type: 'iconSet';
  thresholds: readonly ConditionalThreshold[];
  inclusive: readonly boolean[];
  icons: readonly (ParsedConditionalIcon | null)[];
  showValue: boolean;
}

export interface ParsedDataBar {
  type: 'dataBar';
  thresholds: readonly [ConditionalThreshold, ConditionalThreshold];
  color: string;
  negativeColor?: string;
  borderColor?: string;
  negativeBorderColor?: string;
  axisColor?: string;
  axis: 'automatic' | 'middle' | 'none';
  minLength: number;
  maxLength: number;
  gradient: boolean;
  rightToLeft: boolean;
  showValue: boolean;
}

export type ConditionalDatePeriod = 'yesterday' | 'today' | 'tomorrow' | 'last7Days'
  | 'lastWeek' | 'thisWeek' | 'nextWeek' | 'lastMonth' | 'thisMonth' | 'nextMonth';

export type ParsedCondition =
  | { type: 'cellIs'; operator: ConditionalComparison; formulas: readonly string[] }
  | { type: 'expression'; formula: string }
  | { type: 'containsText' | 'notContainsText' | 'beginsWith' | 'endsWith'; text: string }
  | { type: 'containsBlanks' | 'notContainsBlanks' | 'containsErrors' | 'notContainsErrors' }
  | { type: 'top10'; rank: number; bottom: boolean; percent: boolean }
  | { type: 'aboveAverage'; above: boolean; equal: boolean; deviations: number }
  | { type: 'duplicateValues' | 'uniqueValues' }
  | { type: 'timePeriod'; period: ConditionalDatePeriod }
  | ParsedConditionalVisual;

export interface ParsedConditionalRule {
  /** The first range anchors relative rule formulas. */
  ranges: readonly ParsedMerge[];
  priority: number;
  stopIfTrue: boolean;
  condition: ParsedCondition;
  style?: ParsedConditionalStyle;
  activeFormula?: string;
}

export interface ParsedConditionalStyle extends Pick<ParsedCellStyle, 'color' | 'fill' | 'borders' | 'diagonal' | 'numberFormat' | 'underline' | 'strike'> {
  bold?: boolean;
  italic?: boolean;
}

export interface ParsedRow {
  index: number;
  cells: ParsedCell[];
  styleIndex?: number;
}

export interface ParsedCell {
  ref: string;
  row: number;
  column: number;
  value: string;
  /** Omitted for numeric XLSX cells and grids without typed values. */
  valueType?: 'text' | 'boolean' | 'error' | 'date';
  richText?: ParsedRichText;
  formula?: string;
  sharedFormulaId?: number;
  needsCalculation?: boolean;
  /** The source cell declared a value type without storing a value. */
  missingValue?: true;
  font?: PreviewFontReference;
  styleIndex?: number;
}

export interface ParsedRichText {
  value: string;
  runs: readonly ParsedRichTextRun[];
}

export interface ParsedRichTextRun {
  text: string;
  font?: PreviewFontReference;
  fontSize?: number;
  color?: string;
  underline?: 'single' | 'double' | 'none';
  strike?: boolean;
  verticalAlign?: 'baseline' | 'sub' | 'super';
}

export interface ParsedColumnStyle {
  firstColumn: number;
  lastColumn: number;
  styleIndex: number;
}

export interface ParsedCellStyle {
  font?: PreviewFontReference;
  fontSize?: number;
  color?: string;
  underline?: 'single' | 'double' | 'none';
  strike?: boolean;
  fill?: FillStyle;
  borders?: BorderBox;
  diagonal?: { line: LineStyle; up: boolean; down: boolean };
  horizontal?: 'left' | 'center' | 'right' | 'justify';
  centerAcross?: boolean;
  vertical?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  shrinkToFit?: boolean;
  /** CSS rotation in degrees, or 255 for upright stacked text. */
  textRotation?: number;
  indent?: number;
  /** Built-in format ID or workbook-local custom format code. */
  numberFormat?: number | string;
}
