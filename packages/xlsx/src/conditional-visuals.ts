import { evaluateWorksheetFormula } from './cell-value';
import { interpolate, numericCellValue, type ConditionalRangeValues } from './conditional-range-values';
import type { ConditionalThreshold, ParsedCell, ParsedConditionalIcon, ParsedConditionalStyle, ParsedConditionalVisual, ParsedDataBar, ParsedMerge, ParsedSheet } from './types';

export interface ConditionalAppearance extends ParsedConditionalStyle {
  dataBar?: DataBarAppearance;
  iconSet?: { icon: ParsedConditionalIcon | null; showValue: boolean };
}

export interface DataBarAppearance {
  start: number;
  width: number;
  color: string;
  borderColor?: string;
  axis?: { position: number; color: string };
  gradient?: 'left' | 'right';
  showValue: boolean;
}

export function compileVisualRule(sheet: ParsedSheet, condition: ParsedConditionalVisual, anchor: ParsedMerge,
  readRange: () => ConditionalRangeValues): (row: number, column: number, cell?: ParsedCell) => ConditionalAppearance | false {
  let stops: number[] | null | undefined;
  const colors = condition.type === 'colorScale' ? condition.colors.map(readChannels) : undefined;
  return (_, __, cell) => {
    const value = numericCellValue(sheet, cell);
    if (value === undefined) return false;
    if (stops === undefined) {
      const values = condition.thresholds.map(threshold => resolveThreshold(sheet, threshold, anchor, readRange));
      stops = values.every((stop, index) => stop !== undefined && Number.isFinite(stop) && (!index || stop >= values[index - 1]!))
        ? values as number[] : null;
    }
    if (!stops) return false;
    if (condition.type === 'dataBar') return { dataBar: dataBar(condition, value, stops[0], stops[1]) };
    if (condition.type === 'iconSet') {
      let index = stops.length;
      while (index > 0) {
        const boundary = stops[index - 1];
        if (value > boundary || (condition.inclusive[index - 1] && value === boundary)) break;
        index--;
      }
      return { iconSet: { icon: condition.icons[index], showValue: condition.showValue } };
    }
    return { fill: { type: 'solid', color: scaleColor(value, stops, colors!) } };
  };
}

function resolveThreshold(sheet: ParsedSheet, threshold: ConditionalThreshold, anchor: ParsedMerge,
  readRange: () => ConditionalRangeValues): number | undefined {
  if (threshold.type === 'num') return threshold.value;
  if (threshold.type === 'formula') {
    const value = evaluateWorksheetFormula(sheet, threshold.formula, { row: anchor.firstRow, column: anchor.firstColumn });
    return typeof value === 'number' ? value : undefined;
  }
  const { min, max, percentiles } = readRange();
  if (min > max) return undefined;
  switch (threshold.type) {
    case 'min': return min;
    case 'max': return max;
    case 'autoMin': return Math.min(0, min);
    case 'autoMax': return Math.max(0, max);
    case 'percent': return interpolate(min, max, threshold.value / 100);
    case 'percentile': return percentiles.get(threshold.value);
  }
}

function fraction(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  if (Number.isFinite(max - min)) return (value - min) / (max - min);
  return (value / 2 - min / 2) / (max / 2 - min / 2);
}

function readChannels(hex: string): number[] {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function scaleColor(value: number, stops: readonly number[], colors: readonly number[][]): string {
  let at = 0;
  while (at + 1 < stops.length - 1 && value >= stops[at + 1]) at++;
  const weight = value >= stops[at + 1] ? 1 : fraction(value, stops[at], stops[at + 1]);
  return '#' + colors[at].map((channel, index) => Math.round(interpolate(channel, colors[at + 1][index], weight))
    .toString(16).padStart(2, '0')).join('').toUpperCase();
}

function dataBar(rule: ParsedDataBar, value: number, min: number, max: number): DataBarAppearance {
  let origin = 0, length = 0;
  const width = (ratio: number, space: number) => interpolate(rule.minLength, rule.maxLength, ratio) * space / 100;
  const bounded = Math.max(min, Math.min(max, value));
  if (rule.axis === 'none') length = width(fraction(value, min, max), 100);
  else if (rule.axis === 'middle') {
    origin = 50;
    const extreme = Math.max(Math.abs(min), Math.abs(max));
    if (bounded && extreme) length = Math.sign(bounded) * width(Math.abs(bounded) / extreme, 50);
  } else {
    origin = min < 0 ? fraction(0, min, max) * 100 : 0;
    if (bounded > 0) length = width(fraction(bounded, Math.max(0, min), max), 100 - origin);
    else if (bounded < 0) length = -width(fraction(-bounded, Math.max(0, -max), -min), origin);
  }
  const magnitude = Math.abs(length), left = origin + Math.min(0, length);
  const negative = value < 0;
  const color = negative ? rule.negativeColor ?? rule.color : rule.color;
  const borderColor = negative ? rule.negativeBorderColor ?? rule.borderColor : rule.borderColor;
  return {
    start: rule.rightToLeft ? 100 - left - magnitude : left, width: magnitude, color, borderColor,
    ...(rule.gradient ? { gradient: (length >= 0) !== rule.rightToLeft ? 'right' : 'left' } : {}),
    ...(rule.axisColor && origin > 0 && origin < 100 ? { axis: { position: rule.rightToLeft ? 100 - origin : origin, color: rule.axisColor } } : {}),
    showValue: rule.showValue
  };
}
