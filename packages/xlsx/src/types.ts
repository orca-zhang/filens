import type { BorderBox, FillStyle, PreviewFontReference } from '@filens/core';

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
  /** Source row minimum heights in CSS pixels, indexed from zero. */
  rowHeights?: readonly number[];
  /** Source widths in CSS pixels, indexed from zero; XLSX uses a 7px digit baseline before font measurement. */
  columnWidths?: readonly number[];
  /** XLSX character units retained for remeasurement when the Normal font becomes available. */
  columnWidthSource?: ParsedColumnWidthSource;
  /** Whether numeric dates are measured from 1904-01-01. */
  date1904?: boolean;
  /** Workbook formats and sheet-local column defaults. Indices refer to cellXfs. */
  cellStyles?: { formats: readonly ParsedCellStyle[]; columns: readonly ParsedColumnStyle[]; variableHeight: boolean };
  merges?: ParsedMerge[];
  /** Worksheet-local shared formula definitions, addressed by the source si. */
  sharedFormulas?: Readonly<Record<number, ParsedSharedFormula>>;
  conditionalRules?: readonly ParsedConditionalRule[];
}

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
  | ParsedDataBar;

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

export type ParsedCondition =
  | { type: 'cellIs'; operator: ConditionalComparison; formulas: readonly string[] }
  | { type: 'expression'; formula: string }
  | { type: 'containsText' | 'notContainsText' | 'beginsWith' | 'endsWith'; text: string }
  | { type: 'containsBlanks' | 'notContainsBlanks' | 'containsErrors' | 'notContainsErrors' }
  | ParsedConditionalVisual;

export interface ParsedConditionalRule {
  /** The first range anchors relative rule formulas. */
  ranges: readonly ParsedMerge[];
  priority: number;
  stopIfTrue: boolean;
  condition: ParsedCondition;
  style?: ParsedConditionalStyle;
}

export interface ParsedConditionalStyle extends Pick<ParsedCellStyle, 'color' | 'fill' | 'borders' | 'numberFormat' | 'underline' | 'strike'> {
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
  horizontal?: 'left' | 'center' | 'right' | 'justify';
  vertical?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  indent?: number;
  /** Built-in format ID or workbook-local custom format code. */
  numberFormat?: number | string;
}
