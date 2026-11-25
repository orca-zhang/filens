import { MAX_FORMULA_LENGTH } from './formula-reader';
import { readTextValue } from './rich-text';
import type { colorReader } from './style-appearance';
import type { ConditionalThreshold, ParsedConditionalVisual, ParsedDataBar } from './types';
import { readLocalPath, readPath, toArray } from './xml-values';

type ReadColor = ReturnType<typeof colorReader>;
const isFalse = (value: unknown) => value === '0' || value === 'false';
const isTrue = (value: unknown) => value === '1' || value === 'true';

function readThreshold(node: unknown, extension = false): ConditionalThreshold | undefined {
  const type = readPath(node, ['type']);
  const value = readPath(node, ['val']) ?? (extension ? readTextValue(readLocalPath(node, ['f'])) : undefined);
  switch (type) {
    case 'autoMin': case 'autoMax': return extension ? { type } : undefined;
    case 'min': case 'max': return { type };
    case 'num': case 'percent': case 'percentile': {
      if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return undefined;
      const number = Number(value);
      return Number.isFinite(number) && (type === 'num' || number >= 0 && number <= 100) ? { type, value: number } : undefined;
    }
    case 'formula': {
      const formula = typeof value === 'string' ? value.trim() : '';
      return formula && formula.length <= MAX_FORMULA_LENGTH ? { type, formula } : undefined;
    }
    default: return undefined;
  }
}

export function readColorScale(node: unknown, color: ReadColor): ParsedConditionalVisual | undefined {
  const thresholds = toArray(readPath(node, ['cfvo'])).map(entry => readThreshold(entry));
  const colors = toArray(readPath(node, ['color'])).map(color);
  if ((thresholds.length !== 2 && thresholds.length !== 3) || thresholds.length !== colors.length
    || !thresholds.every(value => value !== undefined) || !colors.every(value => value !== undefined)) return undefined;
  return { type: 'colorScale', thresholds, colors };
}

export function readDataBar(node: unknown, color: ReadColor, rightToLeft: boolean,
  extension = false, base?: ParsedDataBar): ParsedDataBar | undefined {
  const child = (key: string) => (extension ? readLocalPath : readPath)(node, [key]);
  const thresholds = toArray(child('cfvo')).map(entry => readThreshold(entry, extension));
  const fill = color(child(extension ? 'fillColor' : 'color')) ?? base?.color;
  const minLength = Number(readPath(node, ['minLength']) ?? 10), maxLength = Number(readPath(node, ['maxLength']) ?? 90);
  if (!fill || thresholds.length !== 2 || !thresholds[0] || !thresholds[1]
    || !Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 0 || minLength > maxLength || maxLength > 100) return undefined;
  const show = readPath(node, ['showValue']);
  const result: ParsedDataBar = {
    type: 'dataBar', thresholds: [thresholds[0], thresholds[1]], color: fill, axis: 'none',
    minLength, maxLength, gradient: true, rightToLeft, showValue: show === undefined ? base?.showValue ?? true : !isFalse(show)
  };
  if (!extension) return result;

  const axis = readPath(node, ['axisPosition']);
  result.axis = axis === 'middle' || axis === 'none' ? axis : 'automatic';
  const direction = readPath(node, ['direction']);
  if (direction === 'leftToRight' || direction === 'rightToLeft') result.rightToLeft = direction === 'rightToLeft';
  result.gradient = !isFalse(readPath(node, ['gradient']));
  if (!isTrue(readPath(node, ['negativeBarColorSameAsPositive']))) result.negativeColor = color(child('negativeFillColor')) ?? '#FF0000';
  if (isTrue(readPath(node, ['border']))) {
    result.borderColor = color(child('borderColor')) ?? fill;
    if (isFalse(readPath(node, ['negativeBarBorderColorSameAsPositive']))) {
      result.negativeBorderColor = color(child('negativeBorderColor')) ?? result.negativeColor ?? fill;
    }
  }
  if (result.axis !== 'none') result.axisColor = color(child('axisColor')) ?? '#000000';
  return result;
}
