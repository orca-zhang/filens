import { columnIndexToName, columnNameToIndex, parseCellRef } from './columns';
import { countExcelHolidays, countExcelWorkingDays, dayMilliseconds, excelDateParts, excelSerialFromTimestamp,
  excelWeekday, indexExcelHolidays, isExcelDateSerial, offsetExcelWorkingDays } from './excel-calendar';
import { parseFormulaDateText } from './local-date-text';
import { readNumberText } from './local-number-text';
import { findLookupIndex, indexExactLookup, type VisitLookupKeys } from './formula-lookup';
import { captureError, chooseArray, chooseValueArray, expandFormulaArray, filterArray, flattenArray, FormulaCalculationLimit, FormulaError, formulaSortComparator,
  generatedArrayPositions, mapFormulaArray, MAX_DENSE_ARRAY_SCAN, mergeOccupiedPositions, reorderArray, sliceArray, stackArrays, transposeArray, trimArrayBounds, uniqueArray, weightedRankReader, wrapVector,
  type FormulaArray, type SelectedInterval } from './formula-array';
import { groupFormulaRows } from './formula-groupby';
import type { GroupAggregate } from './formula-grouping';
import { pivotFormulaRows } from './formula-pivotby';
import { runFormulaRegex, type RegexFunction } from './formula-regex';
import { formatWorkbookValue } from './number-formats';
import { structuredBracketEnd, tableReference, type TableReferenceSource } from './structured-references';
import { wildcardMatcher, wildcardSearch } from './wildcard-matcher';

export const MAX_FORMULA_LENGTH = 8192;
const MAX_TEXT_LENGTH = 32767;
const MAX_ACCUMULATED_TEXT_LENGTH = 4 * 1024 * 1024;
const MAX_NESTING = 128;
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
const cellRef = /^(\$?)[A-Z]{1,3}(\$?)[1-9]\d*$/i;
const columnRef = /^\$?[A-Z]{1,3}$/i;
const rowRef = /^\$?[1-9]\d*$/;
const numberToken = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const formulaName = /^[\p{L}_\\][\p{L}\p{M}\p{N}_.]*$/u;
const anchorArrayName = /^(?:_xlfn\.)?ANCHORARRAY$/i;
const lookupReferenceNames = new Set(['INDEX', 'XLOOKUP']);
const referenceFunctionName = /^(?:_xlfn\.(?:_xlws\.)?)?(OFFSET|INDIRECT|INDEX|XLOOKUP|TRIMRANGE|_TRO_(?:ALL|LEADING|TRAILING))$/i;
const trimOperators = new Map([['.:', 1], [':.', 2], ['.:.', 3]]);
const trimReferences = new Map([['_TRO_LEADING', 1], ['_TRO_TRAILING', 2], ['_TRO_ALL', 3]]);
const aggregateNames = new Set(['SUM', 'PRODUCT', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'AND', 'OR', 'CONCAT']);
const scalarNames = new Set(['ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'TRUE', 'FALSE', 'NA', 'CONCATENATE', 'CHAR']);
const typeCheckNames = new Set(['ISBLANK', 'ISERR', 'ISERROR', 'ISLOGICAL', 'ISNA', 'ISNONTEXT', 'ISNUMBER', 'ISTEXT']);
const textPositionNames = new Set(['FIND', 'SEARCH', 'LEFT', 'RIGHT']);
const dateArgumentCounts = new Map([
  ['DATE', 3], ['TIME', 3], ['YEAR', 1], ['MONTH', 1], ['DAY', 1], ['HOUR', 1], ['MINUTE', 1], ['SECOND', 1],
  ['DAYS', 2], ['EDATE', 2], ['EOMONTH', 2], ['WEEKDAY', 1], ['DATEVALUE', 1], ['TIMEVALUE', 1]
]);
const workdayNames = new Set(['NETWORKDAYS', 'NETWORKDAYS.INTL', 'WORKDAY', 'WORKDAY.INTL']);
const conditionalAggregateNames = new Set(['COUNTIFS', 'SUMIF', 'SUMIFS', 'AVERAGEIF', 'AVERAGEIFS', 'MINIFS', 'MAXIFS']);
const lookupNames = new Set(['MATCH', 'XMATCH', 'VLOOKUP', 'HLOOKUP']);
const omittedLambdaArgument = new FormulaError('#VALUE!');
// Excel's Windows ANSI codes differ from Unicode only in this range.
const windows1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
type Argument = [start: number, end: number];

export type Scalar = number | string | boolean | null;
type Value = Scalar | FormulaArray | FormulaLambda | undefined;

export interface Reference {
  sheet?: string;
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

export interface ReferenceValue {
  areas: readonly Reference[];
  isRange: boolean;
  implicitCell?: Reference;
  threeDimensional?: true;
  zeroForBlanks?: true;
}

interface NameReference {
  name: string;
  sheet?: string | null;
  invalidAddress?: boolean;
}

type ReferenceTarget = ReferenceValue | NameReference | { table?: string; specifier: string; sheet?: string }
  | { call: string; span: Argument } | { endpoints: [ParsedReference, ParsedReference] };
interface ParsedReference { target: ReferenceTarget; end: number; spill?: true; lastSheet?: string; trimMode?: number }

export interface FormulaLambda {
  parameterCount: number;
  aggregate?: string;
  invoke(args: readonly (FormulaOperand | FormulaError)[]): Value;
}

export type FormulaOperand = Scalar | ReferenceValue | FormulaLambda | FormulaArray;
type LookupArea = Reference | FormulaArray;

export interface DefinitionOrigin {
  sheet: string;
  currentSheet: string;
  row: number;
  column: number;
}

function isReference(value: FormulaOperand): value is ReferenceValue {
  return value !== null && typeof value === 'object' && 'areas' in value;
}

export { FormulaError };

type RangeValue = Scalar | FormulaError;
interface SortKey { array: FormulaArray; order: 1 | -1 }
interface AggregateRangeFilter {
  skipHidden: boolean;
  skipFiltered?: boolean;
  skipNested?: 'subtotal' | 'both';
}
type VisitFormulaCells = (ref: Reference, visit: (value: RangeValue, row: number, column: number) => false | void,
  matches?: (row: number, column: number) => boolean, reverse?: boolean, filter?: AggregateRangeFilter) => void;
interface FormulaCriterion {
  range: Reference;
  matches(value: RangeValue): boolean;
}

export class FormulaReader {
  private readonly tokens: string[];
  private index = 0;
  private end: number;
  private depth = 0;
  private arrayContext = false;
  private letBindings?: Map<string, FormulaOperand | FormulaError>;
  private remainingAccumulation = MAX_DENSE_ARRAY_SCAN;

  constructor(formula: string, private readonly readCell: (ref: Reference) => Scalar,
    private readonly visitCells: VisitFormulaCells,
    private readonly lookupName?: (name: string, sheet?: string | null) => FormulaOperand | undefined,
    private readonly origin?: DefinitionOrigin, private readonly resolveSheetName?: (sheet: string | undefined) => string,
    private readonly date1904?: boolean, private readonly readClock?: (dayOnly: boolean) => number,
    private readonly readFormula?: (ref: Reference, includeLegacyArray?: boolean) => string | undefined,
    private readonly lookupTable?: (name?: string, sheet?: string) => TableReferenceSource | undefined,
    private readonly position?: { row: number; column: number },
    private readonly arrayFromRange?: (range: Reference, compactOnly?: boolean) => FormulaArray | undefined,
    private readonly readSpillRange?: (anchor: Reference) => Reference | undefined,
    private readonly resolveSheetSpan?: (first: string, last: string) => readonly string[],
    private readonly visitDisplayedRangeValues?: (range: Reference, visit: (value: RangeValue, weight: number) => void) => void) {
    this.tokens = tokenizeFormula(formula);
    this.end = this.tokens.length;
  }

  read(): Scalar {
    const value = scalar(this.readResult());
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Unsupported formula.');
    }
    return value;
  }

  readResult(array = false): Scalar | FormulaArray {
    const previous = this.arrayContext;
    this.arrayContext ||= array;
    try {
      const result = this.expression();
      if (this.index !== this.end || result === undefined) throw new Error('Unsupported formula.');
      if (isLambda(result)) throw new FormulaError('#CALC!');
      return result;
    } finally { this.arrayContext = previous; }
  }

  readDefinition(): FormulaOperand {
    this.arrayContext = true;
    const operand = this.readOperand();
    return isArray(operand) && operand.rows === 1 && operand.columns === 1 ? operand.read(0) : operand;
  }

  private readOperand(): FormulaOperand {
    // Excel permits parenthesized union references in name definitions.
    for (let nesting = 0; this.peek() === '('; nesting++) {
      if (nesting >= MAX_NESTING) throw new Error('Formula nesting exceeds the preview limit.');
      let depth = 1, next = this.index + 1;
      while (depth && next < this.end) {
        const token = this.tokens[next++];
        if (token === '(') depth++;
        else if (token === ')') depth--;
      }
      if (depth || next !== this.end) break;
      this.index++; this.end--;
    }
    const first = this.referenceArgument(true);
    if (first === undefined) {
      const value = this.expression();
      if (this.index !== this.end || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new Error('Unsupported formula.');
      }
      return value;
    }
    if (this.index === this.end) {
      if (isReference(first) && first.isRange && first.areas.length === 1) {
        const [area] = first.areas;
        if (area.firstRow === area.lastRow && area.firstColumn === area.lastColumn) return { ...first, isRange: false };
      }
      return first;
    }

    if (!isReference(first)) throw new Error('A name union requires references.');
    const areas = [...first.areas];
    while (this.index < this.end) {
      this.expect(',');
      const value = this.referenceArgument(true);
      if (value === undefined || !isReference(value)) throw new Error('A name union requires references.');
      for (const area of value.areas) {
        if (areas.length >= MAX_FORMULA_LENGTH) throw new Error('Name contains too many reference areas.');
        areas.push(area);
      }
    }
    return { areas, isRange: true };
  }

  private expression(): Value {
    let value = this.concatenate();
    while (['=', '<>', '<', '>', '<=', '>='].includes(this.peek())) {
      const operator = this.take();
      const right = this.concatenate();
      value = elementwise([value, right], read => compareFormulaValues(read(0), read(1), operator));
    }
    return value;
  }

  private concatenate(): Value {
    let value = this.add();
    while (this.peek() === '&') {
      this.take();
      const right = this.add();
      value = elementwise([value, right], read => {
        const result = text(read(0)) + text(read(1));
        checkTextLength(result.length);
        return result;
      });
    }
    return value;
  }

  private add(): Value {
    let value = this.multiply();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.take();
      const right = this.multiply();
      value = elementwise([value, right], read => {
        const left = this.arithmeticNumber(read(0)), right = this.arithmeticNumber(read(1));
        return operator === '+' ? left + right : left - right;
      });
    }
    return value;
  }

  private multiply(): Value {
    let value = this.power();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.take();
      const right = this.power();
      value = elementwise([value, right], read => {
        const left = this.arithmeticNumber(read(0)), right = this.arithmeticNumber(read(1));
        if (operator === '/' && right === 0) throw new FormulaError('#DIV/0!');
        return operator === '*' ? left * right : left / right;
      });
    }
    return value;
  }

  private power(): Value {
    const value = this.percent();
    if (this.peek() !== '^') return value;
    this.take();
    const left = !this.arrayContext && !isArray(value) ? this.arithmeticNumber(value) : value;
    const right = this.nested(() => this.power());
    return elementwise([left, right], read => this.arithmeticNumber(read(0)) ** this.arithmeticNumber(read(1)));
  }

  private percent(): Value {
    let value = this.unary();
    while (this.peek() === '%') {
      this.take();
      value = elementwise([value], read => this.arithmeticNumber(read(0)) / 100);
    }
    return value;
  }

  private unary(): Value {
    if (this.peek() !== '+' && this.peek() !== '-') return this.primary();
    const sign = this.take();
    const value = this.nested(() => this.unary());
    return elementwise([value], read => (sign === '-' ? -1 : 1) * this.arithmeticNumber(read(0)));
  }

  private primary(): Value {
    let value = this.atom();
    while (isLambda(value) && this.peek() === '(') {
      this.take();
      value = this.invokeLambda(value);
    }
    return value;
  }

  private atom(): Value {
    if (this.arrayContext && this.peek() === '{') return this.arrayConstant();
    const start = this.index;
    const token = this.take();
    if (formulaName.test(token) && this.peek() === '(' && !anchorArrayName.test(token) && !referenceFunctionName.test(token)) {
      this.take();
      const name = token.toUpperCase().replace(/^_XLFN\.(?:_XLWS\.)?/, '');
      return this.nested(() => this.call(name));
    }
    const ref = this.referenceAt(start);
    if (ref) {
      this.index = ref.end;
      const operand = this.referenceValue(ref);
      if (!isReference(operand)) return operand;
      if (!ref.spill && (operand.zeroForBlanks || ('call' in ref.target && lookupReferenceNames.has(ref.target.call)))) {
        return this.lookupValue(operand);
      }
      const calculated = ref.trimMode !== undefined || 'call' in ref.target || 'endpoints' in ref.target;
      if (this.arrayContext || ref.spill) {
        const array = this.arrayReference(operand);
        return calculated ? { ...array, zeroForBlanks: true } : array;
      }
      if (calculated) return this.intersectReference(operand);
      if (!operand.isRange) return this.readCell(operand.areas[0]);
      if (operand.implicitCell) return this.readCell(operand.implicitCell);
      // A bare range is not scalar, but keep its dependency reads on malformed expressions.
      for (const area of operand.areas) this.visitCells(area, value => { if (value instanceof FormulaError) throw value; });
      return undefined;
    }
    if (token === '(') {
      const value = this.nested(() => this.expression());
      this.expect(')');
      return value;
    }
    if (token.startsWith('"')) return token.slice(1, -1).replace(/""/g, '"');
    if (numberToken.test(token)) return Number(token);
    if (token.toUpperCase() === 'TRUE') return true;
    if (token.toUpperCase() === 'FALSE') return false;
    if (token.startsWith('#') && token !== '#') throw new FormulaError(token.toUpperCase());
    throw new Error('Unsupported formula token.');
  }

  private call(name: string): Value {
    const local = this.letBindings?.get(bindingName(name));
    if (isLambda(local)) return this.invokeLambda(local);
    if (name === 'LAMBDA') return this.lambda();
    if (name === 'ISOMITTED') {
      const args = this.arguments();
      if (args.length !== 1) throw new FormulaError('#VALUE!');
      return captureError(() => this.arrayOperand(args[0])) === omittedLambdaArgument;
    }
    if (name === 'BYROW' || name === 'BYCOL') return this.byAxis(name === 'BYROW');
    if (name === 'MAP') return this.map();
    if (name === 'MAKEARRAY') return this.makeArray();
    if (name === 'SCAN' || name === 'REDUCE') return this.accumulate(name === 'SCAN');
    if (aggregateNames.has(name)) return this.aggregate(name);
    if (name === 'COUNTBLANK') return this.countBlank();
    if (name === 'COUNTIF') return this.countIf();
    if (conditionalAggregateNames.has(name)) return this.conditionalAggregate(name);
    if (name === 'LARGE' || name === 'SMALL') return this.rank(name === 'LARGE');
    if (name === 'CORREL') return this.correlation();
    if (name === 'IF' || name === 'IFERROR' || name === 'IFNA') return this.conditional(name);
    if (name === 'IFS' || name === 'SWITCH') return this.orderedConditional(name === 'SWITCH');
    if (typeCheckNames.has(name)) return this.typeCheck(name);
    if (textPositionNames.has(name)) return this.textPosition(name);
    if (name === 'TEXTBEFORE' || name === 'TEXTAFTER') return this.textAroundDelimiter(name === 'TEXTAFTER');
    if (name === 'TEXTSPLIT') return this.textSplit();
    if (name === 'REGEXTEST' || name === 'REGEXEXTRACT' || name === 'REGEXREPLACE') return this.regex(name);
    if (name === 'LEN' || name === 'UNICODE') {
      const args = this.arguments();
      if (args.length !== 1 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
      return this.liftScalar(args, read => {
        const value = text(read(0));
        if (name === 'LEN') return value.length;
        const code = value.codePointAt(0);
        if (code === undefined || (code >= 0xD800 && code <= 0xDFFF)) throw new FormulaError('#VALUE!');
        return code;
      });
    }
    if (name === 'TRIM' || name === 'CLEAN' || name === 'PROPER') {
      const args = this.arguments();
      if (args.length !== 1 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
      return elementwise([this.arrayArgument(args[0])], read => {
        const input = text(read(0));
        if (name === 'TRIM') return input.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
        if (name === 'CLEAN') return input.replace(/[\x00-\x1f]/g, '');
        const result = input.toLowerCase().replace(/(\p{L})([\p{L}\p{M}]*)/gu,
          (_, first: string, rest: string) => first.toUpperCase() + rest);
        checkTextLength(result.length);
        return result;
      });
    }
    if (name === 'SUBSTITUTE') return this.substitute();
    if (name === 'NOT') {
      const args = this.arguments();
      if (args.length !== 1 || args[0][0] === args[0][1]) throw new Error('Invalid NOT arguments.');
      return this.liftScalar(args, read => !logical(read(0)));
    }
    if (name === 'INT') {
      const args = this.arguments();
      if (args.length !== 1 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
      return this.liftScalar(args, read => {
        const value = this.arithmeticNumber(read(0));
        if (!Number.isFinite(value)) throw new FormulaError('#NUM!');
        return Math.floor(value);
      });
    }
    if (name === 'MOD' || name === 'ISEVEN' || name === 'ISODD') {
      const args = this.arguments();
      if (args.length !== (name === 'MOD' ? 2 : 1) || args.some(([start, end]) => start === end)) throw new FormulaError('#VALUE!');
      return this.liftScalar(args, read => {
        const value = number(read(0));
        if (!Number.isFinite(value)) throw new FormulaError('#NUM!');
        if (name !== 'MOD') return (Math.trunc(excelTruncationInput(value)) % 2 === 0) === (name === 'ISEVEN');
        const divisor = number(read(1));
        if (!Number.isFinite(divisor)) throw new FormulaError('#NUM!');
        if (!divisor) throw new FormulaError('#DIV/0!');
        const remainder = value % divisor;
        if (!remainder) return 0;
        if (!Number.isInteger(value) || !Number.isInteger(divisor)) {
          const quotient = excelTruncationInput(value / divisor);
          // Cancel exact decimal multiples that acquired a binary rounding error.
          if (quotient && Number.isSafeInteger(quotient) && (quotient * divisor).toPrecision(15) === value.toPrecision(15)) return 0;
        }
        return (remainder < 0) === (divisor < 0) ? remainder : remainder + divisor;
      });
    }
    if (name === 'EXACT') {
      const args = this.arguments();
      if (args.length !== 2) throw new FormulaError('#VALUE!');
      return elementwise(args.map(arg => this.arrayArgument(arg)), read => text(read(0)) === text(read(1)));
    }
    if (name === 'NUMBERVALUE' || name === 'VALUE') return this.textNumber(name === 'NUMBERVALUE');
    if (name === 'TEXT') return this.formatText();
    if (lookupNames.has(name)) return this.lookup(name);
    if (name === 'TEXTJOIN') return this.textJoin();
    if (name === 'FORMULATEXT') return this.formulaText();
    if (name === 'ISFORMULA') return this.isFormula();
    if (name === 'SUBTOTAL') return this.subtotal();
    if (name === 'AGGREGATE') return this.aggregateByNumber();
    if (name === 'LET') return this.let();
    if (name === 'SEQUENCE') return this.sequence();
    if (name === 'FILTER') return this.filter();
    if (name === 'GROUPBY' || name === 'PIVOTBY') return this.groupBy(name === 'PIVOTBY');
    if (name === 'CHOOSE') return this.chooseValue();
    if (name === 'CHOOSEROWS' || name === 'CHOOSECOLS') return this.choose(name === 'CHOOSEROWS');
    if (name === 'TAKE' || name === 'DROP') return this.slice(name === 'TAKE');
    if (name === 'HSTACK' || name === 'VSTACK') return this.stack(name === 'VSTACK');
    if (name === 'UNIQUE') return this.unique();
    if (name === 'SORT') return this.sort();
    if (name === 'SORTBY') return this.sortBy();
    if (name === 'TOCOL' || name === 'TOROW') return this.flatten(name === 'TOCOL');
    if (name === 'WRAPROWS' || name === 'WRAPCOLS') return this.wrap(name === 'WRAPROWS');
    if (name === 'EXPAND') return this.expand();
    if (name === 'TRANSPOSE') {
      const args = this.arguments();
      if (args.length !== 1) throw new FormulaError('#VALUE!');
      const source = asArray(this.arrayArgument(args[0]));
      if (source.rows > MAX_COLUMN) throw new FormulaError('#SPILL!');
      return transposeArray(source);
    }
    if (name === 'ROWS' || name === 'COLUMNS') {
      const args = this.arguments();
      if (args.length !== 1 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
      const { rows, columns } = lookupShape(this.lookupArea(args[0]));
      return name === 'ROWS' ? rows : columns;
    }
    if (name === 'ROW' || name === 'COLUMN') return this.coordinateNumbers(name === 'ROW');
    if (name === 'SINGLE') {
      const args = this.arguments();
      if (args.length !== 1) throw new FormulaError('#VALUE!');
      const value = this.arrayOperand(args[0]);
      if (isReference(value)) return this.intersectReference(value);
      return isArray(value) ? value.read(0) : value;
    }
    if (name === 'SUMPRODUCT') return this.sumProduct();
    if (name === 'ADDRESS') return this.address();
    if (this.readClock && (name === 'TODAY' || name === 'NOW')) {
      this.expect(')');
      return this.checkedDateSerial(this.readClock(name === 'TODAY'));
    }
    const dateArgs = dateArgumentCounts.get(name);
    if (dateArgs !== undefined) return this.dateFunction(name, dateArgs);
    if (workdayNames.has(name)) return this.workdayFunction(name);
    if (!scalarNames.has(name)) {
      const named = this.lookupName?.(name);
      if (isLambda(named)) return this.invokeLambda(named);
      throw new Error('Unsupported formula function.');
    }
    const args: Scalar[] = [];
    if (this.peek() !== ')') {
      do {
        args.push(scalar(this.expression()));
      } while (this.peek() === ',' && this.take());
    }
    this.expect(')');
    switch (name) {
      case 'ABS': if (args.length === 1) return Math.abs(number(args[0])); break;
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': if (args.length === 2) return round(name, number(args[0]), number(args[1])); break;
      case 'CHAR': if (args.length === 1) {
        const code = Math.trunc(number(args[0]));
        if (code < 1 || code > 255 || !Number.isFinite(code)) throw new FormulaError('#VALUE!');
        return windows1252[code - 128] ?? String.fromCharCode(code);
      } break;
      case 'TRUE': case 'FALSE': if (!args.length) return name === 'TRUE'; break;
      case 'NA': if (!args.length) throw new FormulaError('#N/A'); break;
      case 'CONCATENATE': {
        if (!args.length) break;
        const value = args.map(text).join('');
        checkTextLength(value.length);
        return value;
      }
    }
    throw new Error('Unsupported formula function or arguments.');
  }

  private let(): Value {
    const args = this.arguments();
    if (args.length < 3 || args.length > 253 || args.length % 2 === 0) throw new FormulaError('#VALUE!');
    const inherited = this.letBindings, previousContext = this.arrayContext;
    const bindings = this.letBindings = new Map(inherited);
    const names = new Set<string>();
    this.arrayContext = true;
    try {
      for (let i = 0; i < args.length - 1; i += 2) {
        const [first, last] = args[i];
        const name = first + 1 === last ? bindingName(this.tokens[first]) : '';
        if (!validBindingName(name) || names.has(name)) throw new FormulaError('#NAME?');
        // Bind from left to right so each expression sees the previous scope.
        const value = this.argument(args[i + 1], () => {
          try {
            const reference = this.referenceArgument(true);
            if (reference !== undefined) return reference;
            const expression = this.expression();
            if (isLambda(expression)) return expression;
            if (!isArray(expression) || expression.rows * expression.columns === 1) return scalar(expression);
            return memoizeArrayPosition(expression);
          } catch (error) {
            if (!(error instanceof FormulaError)) throw error;
            this.index = args[i + 1][1];
            return error;
          }
        });
        names.add(name);
        bindings.set(name, value);
      }
      return this.argument(args.at(-1)!, () => this.expression());
    } finally {
      this.letBindings = inherited;
      this.arrayContext = previousContext;
    }
  }

  private lambda(): FormulaLambda {
    const args = this.arguments();
    const body = args.pop()!;
    if (args.length > 253 || body[0] === body[1]) throw new FormulaError('#VALUE!');
    const parameters = args.map(([start, end]) => {
      const token = end === start + 1 ? this.tokens[start] : '';
      const brackets = /^\[([^\[\]]+)\]$/.exec(token);
      const optional = Boolean(brackets || /^_xlop\./i.test(token));
      const name = bindingName(brackets?.[1] ?? token.replace(/^_xlop\./i, ''));
      // Excel can serialize R and C as lambda parameters with explicit parameter prefixes.
      if (!(validBindingName(name) || /^_xl(?:pm|op)\.[rc]$/i.test(token)) || name.includes('.')) throw new FormulaError('#VALUE!');
      return { name, optional };
    });
    const required = parameters.filter(parameter => !parameter.optional).length;
    if (new Set(parameters.map(({ name }) => name)).size !== parameters.length
      || parameters.slice(0, required).some(parameter => parameter.optional)) {
      throw new FormulaError('#VALUE!');
    }
    const captured = new Map(this.letBindings);
    const [first, last] = body, name = this.tokens[first].toUpperCase();
    // A single built-in aggregate of the parameter has one result for all equal groups.
    const aggregate = parameters.length === 1 && last === first + 4 && aggregateNames.has(name)
      && this.tokens[first + 1] === '(' && bindingName(this.tokens[first + 2]) === parameters[0].name
      && this.tokens[first + 3] === ')' && !isLambda(captured.get(bindingName(name))) ? name : undefined;
    return { parameterCount: parameters.length, aggregate, invoke: operands => {
      if (operands.length < required || operands.length > parameters.length) throw new FormulaError('#VALUE!');
      const inherited = this.letBindings, previousContext = this.arrayContext;
      this.letBindings = new Map(captured);
      parameters.forEach(({ name }, index) => this.letBindings!.set(name, index < operands.length ? operands[index] : omittedLambdaArgument));
      this.arrayContext = true;
      try { return this.nested(() => this.argument(body, () => this.expression())); }
      finally { this.letBindings = inherited; this.arrayContext = previousContext; }
    } };
  }

  private invokeLambda(lambda: FormulaLambda): Value {
    const args = this.arguments();
    const operands = args.length === 1 && args[0][0] === args[0][1] ? [] : args.map(span => {
      if (span[0] === span[1]) return omittedLambdaArgument;
      const operand = captureError(() => this.arrayOperand(span));
      if (operand instanceof FormulaError) return operand;
      return isReference(operand) ? this.bindLambdaReference(operand) : operand;
    });
    return lambda.invoke(operands);
  }

  private bindLambdaReference(operand: ReferenceValue): ReferenceValue {
    if (!this.resolveSheetName) return operand;
    const sheet = this.resolveSheetName(undefined);
    const bind = (area: Reference) => area.sheet === undefined ? { ...area, sheet } : area;
    return { ...operand, areas: operand.areas.map(bind), implicitCell: operand.implicitCell && bind(operand.implicitCell) };
  }

  private byAxis(byRow: boolean): FormulaArray {
    const args = this.arguments();
    if (args.length !== 2) throw new FormulaError('#VALUE!');
    const input = this.arrayOperand(args[0]);
    const reference = isReference(input) ? input : undefined;
    const array = isReference(input) ? this.arrayReference(input) : asArray(isArray(input) ? input : scalar(input));
    const [first, last] = args[1];
    const name = last === first + 1 ? this.tokens[first].replace(/^_xleta\./i, '').toUpperCase() : '';
    const shorthand = aggregateNames.has(name) ? name : undefined;
    const operand = shorthand ? undefined : this.argument(args[1], () => this.expression());
    const callback = isLambda(operand) && operand.parameterCount === 1 ? operand : undefined;
    const aggregate = shorthand ?? callback?.aggregate;
    if (!aggregate && !callback) throw new FormulaError('#VALUE!');
    const rows = byRow ? array.rows : 1, columns = byRow ? 1 : array.columns;
    const groupRows = byRow ? 1 : array.rows, groupColumns = byRow ? array.columns : 1;
    const dense = !aggregate || array.dense;
    return {
      rows, columns, dense,
      read: position => {
        const row = byRow ? position ?? 0 : 0, column = byRow ? 0 : position ?? 0;
        if (aggregate) {
          return aggregateValues(aggregate, add => {
            if (position === undefined) add(captureError(() => array.read()), true, groupRows * groupColumns);
            else visitFormulaArray(sliceArray(array, row, column, groupRows, groupColumns), (value, count) => add(value, true, count));
          });
        }
        if (!callback || position === undefined) return null;
        const area = reference?.areas[0];
        const group = area ? this.bindLambdaReference({ ...reference, isRange: true, areas: [{ ...area,
          firstRow: area.firstRow + row, lastRow: area.firstRow + row + groupRows - 1,
          firstColumn: area.firstColumn + column, lastColumn: area.firstColumn + column + groupColumns - 1 }] })
          : sliceArray(array, row, column, groupRows, groupColumns);
        const result = callback.invoke([group]);
        if (isArray(result) && result.rows * result.columns !== 1) throw new FormulaError('#CALC!');
        return scalar(result);
      },
      occupied: dense ? [] : [() => occupiedAxis(array, byRow)]
    };
  }

  private map(): FormulaArray {
    const args = this.arguments();
    const callbackSpan = args.pop()!;
    if (!args.length || args.length > 253 || args.some(([first, last]) => first === last)) throw new FormulaError('#VALUE!');
    const callback = this.argument(callbackSpan, () => this.expression());
    if (!isLambda(callback) || callback.parameterCount !== args.length) throw new FormulaError('#VALUE!');

    const inputs = args.map(span => {
      const input = captureError(() => this.arrayOperand(span));
      if (input instanceof FormulaError) return { array: asArray(input) };
      if (!isReference(input)) return { array: asArray(isArray(input) ? input : scalar(input)) };
      if (input.areas.length !== 1 || input.threeDimensional) throw new FormulaError('#VALUE!');
      const reference = this.bindLambdaReference(input);
      return { array: this.arrayReference(reference), reference };
    });
    const rows = Math.min(...inputs.map(({ array }) => array.rows));
    const columns = Math.min(...inputs.map(({ array }) => array.columns));
    const maxRows = Math.max(...inputs.map(({ array }) => array.rows));
    const maxColumns = Math.max(...inputs.map(({ array }) => array.columns));
    const invoke = (operands: (FormulaOperand | FormulaError)[]) => {
      const result = callback.invoke(operands);
      if (isArray(result) && result.rows * result.columns !== 1) throw new FormulaError('#CALC!');
      return scalar(result);
    };

    // A worksheet operand can expose its position and visibility even when the cell is blank.
    const result: FormulaArray = inputs.some(({ reference }) => reference) ? {
      rows, columns, dense: true, occupied: [],
      read: position => {
        if (position === undefined) return null;
        const row = Math.floor(position / columns), column = position % columns;
        return invoke(inputs.map(({ array, reference }) => reference ? {
          areas: [atOffset(reference.areas[0], row, column)], isRange: false, zeroForBlanks: reference.zeroForBlanks
        } : captureError(() => array.read(row * array.columns + column))));
      }
    } : elementwise(inputs.map(({ array }) => sliceArray(array, 0, 0, rows, columns)),
      read => invoke(inputs.map((_, index) => captureError(() => read(index))))) as FormulaArray;
    return rows === maxRows && columns === maxColumns ? { ...result, zeroForBlanks: true }
      : stackArrays([result], true, maxColumns, undefined, maxRows);
  }

  private makeArray(): FormulaArray {
    const args = this.arguments();
    if (args.length !== 3 || args.some(([first, last]) => first === last)) throw new FormulaError('#VALUE!');
    const dimension = (span: Argument) => {
      const value = this.arrayArgument(span);
      if (isArray(value) && value.rows * value.columns !== 1) throw new FormulaError('#VALUE!');
      return Math.trunc(number(value));
    };
    const rows = dimension(args[0]), columns = dimension(args[1]);
    if (!Number.isFinite(rows) || !Number.isFinite(columns)) throw new FormulaError('#NUM!');
    if (rows < 1 || columns < 1) throw new FormulaError('#VALUE!');
    if (rows > MAX_ROW || columns > MAX_COLUMN) throw new FormulaError('#SPILL!');
    const callback = this.argument(args[2], () => this.expression());
    if (!isLambda(callback) || callback.parameterCount !== 2) throw new FormulaError('#VALUE!');
    return {
      rows, columns, dense: true, occupied: [],
      read(position) {
        if (position === undefined) return null;
        const result = callback.invoke([Math.floor(position / columns) + 1, position % columns + 1]);
        if (isArray(result) && result.rows * result.columns !== 1) throw new FormulaError('#CALC!');
        return scalar(result) ?? 0;
      }
    };
  }

  private accumulate(scan: boolean): Value {
    const args = this.arguments();
    if (args.length !== 3) throw new FormulaError('#VALUE!');
    const [seed, source, fn] = args;
    if (source[0] === source[1]) throw new FormulaError('#VALUE!');
    const [first, last] = fn;
    const token = last === first + 1 ? this.tokens[first] : '';
    const eta = /^_xleta\./i.test(token);
    const name = token.replace(/^_xleta\./i, '').toUpperCase();
    const shorthand = aggregateNames.has(name) && (eta || !this.letBindings?.has(bindingName(token)));
    const callback = shorthand ? undefined : this.arrayOperand(fn);
    if (!shorthand && (!isLambda(callback) || callback.parameterCount !== 2)) throw new FormulaError('#VALUE!');
    const input = captureError(() => this.arrayOperand(source));
    const reference = !(input instanceof FormulaError) && isReference(input) ? this.bindLambdaReference(input) : undefined;
    if (reference?.threeDimensional) throw new FormulaError('#VALUE!');
    const array = input instanceof FormulaError ? asArray(input)
      : isReference(input) ? this.arrayReference(input) : asArray(isArray(input) ? input : scalar(input));
    const { rows, columns } = array;
    const read = (position: number): RangeValue => captureError(() => array.read(position));
    const omitted = seed[0] === seed[1];
    let next = 0;
    let accumulator: Scalar | FormulaError | FormulaArray;
    if (!omitted) accumulator = captureError(() => this.lookupValue(this.arrayOperand(seed)));
    else if (scan) accumulator = 0;
    else {
      accumulator = read(0);
      next = 1;
    }

    const advance = (position?: number) => {
      if (--this.remainingAccumulation < 0) throw new FormulaCalculationLimit('Accumulation exceeds the preview scan limit.');
      accumulator = captureError(() => {
        if (isLambda(callback) && position !== undefined) {
          const item: ReferenceValue | RangeValue = reference ? {
            areas: [atOffset(reference.areas[0], Math.floor(position / columns), position % columns)],
            isRange: false, zeroForBlanks: reference.zeroForBlanks
          } : read(position);
          const result = callback.invoke([accumulator, item]);
          if (isArray(result) && result.rows * result.columns > 1) {
            if (scan) throw new FormulaError('#CALC!');
            return result === accumulator ? result : this.snapshotAccumulator(result);
          }
          return scalar(result);
        }
        return aggregateValues(name, add => {
          if (isArray(accumulator)) visitFormulaArray(accumulator, (value, count) => add(value, true, count));
          else add(accumulator, false);
          add(position === undefined ? null : read(position), Boolean(reference));
        });
      });
      return accumulator;
    };

    if (!scan) {
      const length = rows * columns;
      const skipsBlanks = shorthand && ['SUM', 'PRODUCT', 'MIN', 'MAX'].includes(name);
      if (skipsBlanks && length - next > this.remainingAccumulation && !array.dense
        && captureError(() => array.read()) === null) {
        // These aggregates stabilize after one blank. Process each gap once in source order.
        for (const position of mergeOccupiedPositions(array.occupied)) {
          if (position < next) continue;
          if (position > next) advance();
          advance(position);
          next = position + 1;
        }
        if (next < length) advance();
      } else {
        for (let position = next; position < length; position++) advance(position);
      }
      if (accumulator instanceof FormulaError) throw accumulator;
      return accumulator;
    }

    const results: RangeValue[] = [];
    let textLength = 0;
    return { rows, columns, dense: true, occupied: [], zeroForBlanks: true, read(position) {
      if (position === undefined) return null;
      while (results.length <= position) {
        if (textLength > MAX_ACCUMULATED_TEXT_LENGTH) throw new FormulaCalculationLimit('Accumulated text exceeds the preview limit.');
        const result = advance(results.length) as RangeValue;
        if (typeof result === 'string') textLength += result.length;
        if (textLength > MAX_ACCUMULATED_TEXT_LENGTH) throw new FormulaCalculationLimit('Accumulated text exceeds the preview limit.');
        results.push(result);
      }
      const result = results[position];
      if (result instanceof FormulaError) throw result;
      return result;
    } };
  }

  private snapshotAccumulator(array: FormulaArray): FormulaArray {
    // Read each intermediate before the next lambda invocation to avoid retaining a chain of lazy arrays.
    const length = array.rows * array.columns;
    if ((this.remainingAccumulation -= length) < 0) throw new FormulaCalculationLimit('Accumulator array exceeds the preview scan limit.');
    const values: RangeValue[] = [];
    let textLength = 0;
    for (let position = 0; position < length; position++) {
      const value = captureError(() => array.read(position));
      if (typeof value === 'string') textLength += value.length;
      if (textLength > MAX_ACCUMULATED_TEXT_LENGTH) throw new FormulaCalculationLimit('Accumulator text exceeds the preview limit.');
      values.push(value);
    }
    return { rows: array.rows, columns: array.columns, dense: true, occupied: [], zeroForBlanks: array.zeroForBlanks, read(position) {
      if (position === undefined) return null;
      const value = values[position];
      if (value instanceof FormulaError) throw value;
      return value;
    } };
  }

  private arrayArgument(span: Argument): Scalar | FormulaArray {
    const previous = this.arrayContext;
    this.arrayContext = true;
    try {
      const result = this.argument(span, () => this.expression());
      return isArray(result) ? result : scalar(result);
    } finally { this.arrayContext = previous; }
  }

  private liftScalar(spans: Argument[], evaluate: (read: (index: number) => Scalar, single: boolean) => Scalar,
    omitted: Scalar = null): Value {
    const values = spans.map(span => {
      if (span[0] === span[1]) return omitted;
      const value = captureError(() => this.arrayArgument(span));
      return value instanceof FormulaError ? asArray(value) : value;
    });
    // Keep single-cell function results scalar, including for aggregate coercion.
    return values.some(value => isArray(value) && value.rows * value.columns > 1)
      ? elementwise(values, read => evaluate(read, false)) : evaluate(index => scalar(values[index]), true);
  }

  private sequence(): FormulaArray {
    const args = this.arguments();
    if (args.length > 4 || args.every(([first, last]) => first === last)) throw new FormulaError('#VALUE!');
    const argument = (index: number) => args[index] && args[index][0] !== args[index][1]
      ? this.argument(args[index], () => number(this.expression())) : 1;
    const rows = Math.trunc(argument(0)), columns = Math.trunc(argument(1));
    const start = argument(2), step = argument(3);
    if (![rows, columns, start, step].every(Number.isFinite)) throw new FormulaError('#NUM!');
    if (rows < 0 || columns < 0) throw new FormulaError('#VALUE!');
    if (!rows || !columns) throw new FormulaError('#CALC!');
    if (rows > MAX_ROW || columns > MAX_COLUMN) throw new FormulaError('#SPILL!');
    const dense = step !== 0 && rows * columns > 1;
    return { rows, columns, dense, occupied: [], read: position => {
      if (!dense) return start;
      if (position === undefined) return null;
      const value = start + step * position;
      if (!Number.isFinite(value)) throw new FormulaError('#NUM!');
      return value;
    } };
  }

  private coordinateNumbers(byRow: boolean): number | FormulaArray {
    const args = this.arguments();
    if (args.length !== 1) throw new FormulaError('#VALUE!');
    const span = args[0];
    if (span[0] === span[1]) {
      const coordinate = byRow ? this.position?.row : this.position?.column;
      if (coordinate === undefined) throw new FormulaError('#VALUE!');
      return coordinate;
    }
    const area = this.argument(span, () => this.referenceRange(true));
    const first = byRow ? area.firstRow : area.firstColumn;
    const length = (byRow ? area.lastRow : area.lastColumn) - first + 1;
    if (length === 1) return first;
    return {
      rows: byRow ? length : 1, columns: byRow ? 1 : length, dense: true, implicitFirst: true,
      read: position => position === undefined ? null : first + position,
      occupied: []
    };
  }

  private filter(): Scalar | FormulaArray {
    const args = this.arguments();
    if (args.length < 2 || args.length > 3) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(args[0])), include = asArray(this.arrayArgument(args[1]));
    const byRow = include.columns === 1 && include.rows === source.rows;
    if (!byRow && (include.rows !== 1 || include.columns !== source.columns)) throw new FormulaError('#VALUE!');
    let count = 0, first = 0;
    const runs: SelectedInterval[] = [];
    visitFormulaArray(include, (value, length) => {
      if (value instanceof FormulaError) throw value;
      const end = first + length;
      if (logical(value)) {
        const previous = runs.at(-1);
        if (previous?.end === first) previous.end = end;
        else runs.push({ first, end, before: count });
        count += length;
      }
      first = end;
    });
    if (count) return filterArray(source, byRow, count, runs);
    if (!args[2]) throw new FormulaError('#CALC!');
    return args[2][0] === args[2][1] ? 0 : this.arrayArgument(args[2]);
  }

  private chooseValue(): Value {
    const [index, ...args] = this.arguments();
    if (!args.length || args.length > 254) throw new FormulaError('#VALUE!');
    const selector = this.arrayArgument(index);
    const pick = (value: Scalar) => {
      const choice = Math.trunc(number(value));
      if (!Number.isFinite(choice) || choice < 1 || choice > args.length) throw new FormulaError('#VALUE!');
      return choice - 1;
    };
    const read = ([start, end]: Argument) => start === end ? 0 : this.arrayArgument([start, end]);
    if (!isArray(selector) || selector.rows * selector.columns === 1) {
      const value = read(args[pick(scalar(selector))]);
      return isArray(value) ? { ...value, zeroForBlanks: true } : value;
    }
    const choices = args.map(span => asArray(captureError(() => read(span))));
    if (choices.every(choice => choice.rows * choice.columns === 1 ||
      (choice.rows === selector.rows && choice.columns === selector.columns))) {
      return { ...elementwise([selector, ...choices], value => value(1 + pick(value(0)))) as FormulaArray, zeroForBlanks: true };
    }
    return chooseValueArray(selector, choices, pick);
  }

  private choose(byRow: boolean): FormulaArray {
    const [data, ...selectors] = this.arguments();
    if (!selectors.length || selectors.length > 253) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(data));
    const indexes: number[] = [], length = byRow ? source.rows : source.columns;
    const limit = byRow ? MAX_ROW : MAX_COLUMN;
    const add = (value: RangeValue, count = 1) => {
      if (value instanceof FormulaError) throw value;
      const index = Math.trunc(number(value));
      if (!index || Math.abs(index) > length || indexes.length + count > limit) throw new FormulaError('#VALUE!');
      const position = index < 0 ? length + index : index - 1;
      for (let n = 0; n < count; n++) indexes.push(position);
    };
    for (const span of selectors) {
      const selector = this.arrayArgument(span);
      if (isArray(selector)) visitFormulaArray(selector, add);
      else add(selector);
    }
    return chooseArray(source, byRow, indexes);
  }

  private slice(take: boolean): FormulaArray {
    const args = this.arguments();
    const [data, rows, columns] = args;
    const omitted = (span?: Argument) => !span || span[0] === span[1];
    if (args.length > 3 || (omitted(rows) && omitted(columns))) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(data));
    const dimension = (length: number, span?: Argument) => {
      if (!span || span[0] === span[1]) return { start: 0, size: length };
      const value = this.arrayArgument(span);
      if (isArray(value) && (value.rows !== 1 || value.columns !== 1)) throw new FormulaError('#VALUE!');
      const count = Math.trunc(number(value));
      if (!Number.isFinite(count)) throw new FormulaError('#NUM!');
      const size = take ? Math.min(Math.abs(count), length) : length - Math.abs(count);
      if (size <= 0) throw new FormulaError('#CALC!');
      const start = take ? (count < 0 ? length - size : 0) : Math.max(0, count);
      return { start, size };
    };
    const row = dimension(source.rows, rows), column = dimension(source.columns, columns);
    return mapFormulaArray(sliceArray(source, row.start, column.start, row.size, column.size), blankToZero);
  }

  private trimRange(referenceMode?: number): FormulaOperand {
    const args = this.arguments();
    if (args.length > (referenceMode === undefined ? 3 : 1)) throw new FormulaError('#VALUE!');
    const mode = (span?: Argument) => {
      const value = span && span[0] !== span[1] ? Math.trunc(number(this.arrayArgument(span))) : 3;
      if (!(value >= 0 && value <= 3)) throw new FormulaError('#VALUE!');
      return value;
    };
    return this.trimOperand(this.arrayOperand(args[0]), referenceMode ?? mode(args[1]), referenceMode ?? mode(args[2]));
  }

  private trimOperand(input: FormulaOperand, rowMode: number, columnMode: number): FormulaOperand {
    if (isReference(input)) return this.trimReference(input, rowMode, columnMode);
    const source = asArray(isArray(input) ? input : scalar(input));
    const { firstRow, firstColumn, rows, columns } = trimArrayBounds(source, rowMode, columnMode);
    return mapFormulaArray(sliceArray(source, firstRow, firstColumn, rows, columns), blankToZero);
  }

  private trimReference(input: ReferenceValue, rowMode: number, columnMode: number): ReferenceValue {
    if (input.areas.length !== 1 || input.threeDimensional) throw new FormulaError('#VALUE!');
    const area = { ...input.areas[0] };
    this.resolveSheetName?.(area.sheet);
    const { rows, columns } = lookupShape(area);
    if (rows === 1 || columns === 1 || !columnMode) {
      const byRow = rows !== 1, mode = byRow ? rowMode : columnMode;
      const start = byRow ? 'firstRow' : 'firstColumn', end = byRow ? 'lastRow' : 'lastColumn';
      const edge = (reverse: boolean) => {
        let location: number | undefined;
        this.visitCells(area, (value, row, column) => {
          if (value === null) return;
          location = byRow ? row : column;
          return false;
        }, undefined, reverse);
        return location;
      };
      // The worksheet index visits either end directly for row-only or single-row trim.
      const first = mode & 1 ? edge(false) ?? area[end] : area[start];
      const last = mode & 2 ? edge(true) ?? area[start] : area[end];
      area[start] = first <= last ? first : last;
      area[end] = last;
    } else {
      const source = this.arrayReference({ ...input, zeroForBlanks: undefined });
      const bounds = trimArrayBounds(source, rowMode, columnMode);
      area.firstRow += bounds.firstRow;
      area.firstColumn += bounds.firstColumn;
      area.lastRow = area.firstRow + bounds.rows - 1;
      area.lastColumn = area.firstColumn + bounds.columns - 1;
    }
    return { areas: [area], isRange: area.firstRow !== area.lastRow || area.firstColumn !== area.lastColumn };
  }

  private stack(byRow: boolean): FormulaArray {
    const args = this.arguments();
    if (args.length > 255 || args.some(([start, end]) => start === end)) throw new FormulaError('#VALUE!');
    const arrays = args.flatMap(span => {
      const result = captureError(() => {
        const value = this.arrayOperand(span);
        if (!isReference(value)) return [asArray(isArray(value) ? value : scalar(value))];
        return value.threeDimensional ? value.areas.map(area => this.arrayReference({ areas: [area], isRange: true }))
          : [this.arrayReference(value)];
      });
      return result instanceof FormulaError ? [asArray(result)] : result;
    });
    const result = stackArrays(arrays, byRow);
    if (result.rows > MAX_ROW || result.columns > MAX_COLUMN) throw new FormulaError('#SPILL!');
    return result;
  }

  private flatten(toColumn: boolean): FormulaArray {
    const args = this.arguments();
    if (args.length > 3 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
    const optional = (span?: Argument) => span && span[0] !== span[1] ? scalar(this.arrayArgument(span)) : null;
    const ignore = Math.trunc(number(optional(args[1])));
    if (!(ignore >= 0 && ignore <= 3)) throw new FormulaError('#VALUE!');
    const byColumn = logical(optional(args[2]));
    return flattenArray(asArray(this.arrayArgument(args[0])), toColumn, byColumn, ignore, toColumn ? MAX_ROW : MAX_COLUMN);
  }

  private wrap(byRow: boolean): FormulaArray {
    const args = this.arguments();
    if (args.length < 2 || args.length > 3) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(args[0]));
    if (source.rows !== 1 && source.columns !== 1) throw new FormulaError('#VALUE!');
    const count = Math.trunc(number(this.scalarArrayArgument(args[1])));
    if (!Number.isFinite(count) || count < 1) throw new FormulaError('#NUM!');
    const length = source.rows * source.columns, width = Math.min(count, length);
    if (width > (byRow ? MAX_COLUMN : MAX_ROW) || Math.ceil(length / width) > (byRow ? MAX_ROW : MAX_COLUMN)) {
      throw new FormulaError('#SPILL!');
    }
    const padding = length % width ? this.arrayPadding(args[2]) : undefined;
    return wrapVector(mapFormulaArray(source, blankToZero), width, byRow, padding);
  }

  private expand(): FormulaArray {
    const args = this.arguments();
    const provided = (span?: Argument): span is Argument => Boolean(span && span[0] !== span[1]);
    if (args.length > 4 || (!provided(args[1]) && !provided(args[2]))) throw new FormulaError('#VALUE!');
    const source = mapFormulaArray(asArray(this.arrayArgument(args[0])), blankToZero);
    const dimension = (span: Argument | undefined, current: number, maximum: number) => {
      if (!provided(span)) return current;
      const result = Math.trunc(number(this.scalarArrayArgument(span)));
      if (!Number.isFinite(result) || result > maximum) throw new FormulaError('#NUM!');
      if (result < current) throw new FormulaError('#VALUE!');
      return result;
    };
    const rows = dimension(args[1], source.rows, MAX_ROW), columns = dimension(args[2], source.columns, MAX_COLUMN);
    if (rows === source.rows && columns === source.columns) return source;
    return stackArrays([source], true, columns, this.arrayPadding(args[3]), rows);
  }

  private scalarArrayArgument(span: Argument): Scalar {
    const value = this.arrayArgument(span);
    if (isArray(value) && (value.rows !== 1 || value.columns !== 1)) throw new FormulaError('#VALUE!');
    return scalar(value);
  }

  private arrayPadding(span?: Argument): Scalar | FormulaError {
    if (!span || span[0] === span[1]) return new FormulaError('#N/A');
    return captureError(() => this.scalarArrayArgument(span) ?? 0);
  }

  private unique(): FormulaArray {
    const args = this.arguments();
    if (args.length > 3) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(args[0]));
    const enabled = (span?: Argument) => {
      if (!span || span[0] === span[1]) return false;
      const value = this.arrayArgument(span);
      if (isArray(value) && (value.rows !== 1 || value.columns !== 1)) throw new FormulaError('#VALUE!');
      return logical(scalar(value));
    };
    return uniqueArray(source, !enabled(args[1]), enabled(args[2]));
  }

  private substitute(): Value {
    const args = this.arguments();
    if (args.length < 3 || args.length > 4) throw new FormulaError('#VALUE!');
    const values = args.slice(0, 3).map(span => this.arrayArgument(span));
    const instance = args[3];
    const specified = instance && instance[0] !== instance[1];
    if (specified) values.push(this.arrayArgument(instance));
    return elementwise(values, read => {
      const input = text(read(0)), old = text(read(1)), replacement = text(read(2));
      const occurrence = specified ? Math.trunc(number(read(3))) : undefined;
      if (occurrence !== undefined && (!Number.isFinite(occurrence) || occurrence < 1)) throw new FormulaError('#VALUE!');
      if (!old) return input;
      if (occurrence === undefined) {
        const pieces = input.split(old);
        checkTextLength(input.length + (pieces.length - 1) * (replacement.length - old.length));
        return pieces.join(replacement);
      }
      let at = input.indexOf(old);
      for (let match = 1; at !== -1 && match < occurrence; match++) at = input.indexOf(old, at + old.length);
      if (at === -1) return input;
      checkTextLength(input.length + replacement.length - old.length);
      return input.slice(0, at) + replacement + input.slice(at + old.length);
    });
  }

  private regex(operation: RegexFunction): Value {
    const args = this.arguments();
    const replace = operation === 'REGEXREPLACE';
    const required = replace ? 3 : 2;
    const limit = operation === 'REGEXTEST' ? 3 : replace ? 5 : 4;
    if (args.length < required || args.length > limit || args.slice(0, required).some(([first, last]) => first === last)) {
      throw new FormulaError('#VALUE!');
    }
    const values = args.map(span => {
      if (span[0] === span[1]) return 0;
      const value = captureError(() => this.arrayArgument(span));
      return value instanceof FormulaError ? asArray(value) : value;
    });
    const multiple = values.some(value => isArray(value) && value.rows * value.columns > 1);
    const evaluate = (read: (index: number) => Scalar) => {
      const mode = operation === 'REGEXTEST' ? 0 : Math.trunc(number(read(limit - 2)));
      const sensitivity = number(read(limit - 1));
      if ((sensitivity !== 0 && sensitivity !== 1) || !Number.isSafeInteger(mode)
        || (operation === 'REGEXEXTRACT' && (mode < 0 || mode > 2))) throw new FormulaError('#VALUE!');
      return runFormulaRegex(operation, text(read(0)), text(read(1)), sensitivity === 1, mode, replace ? text(read(2)) : '');
    };
    const readValue = (index: number) => index < values.length ? scalar(values[index]) : 0;
    if (multiple) return elementwise(values, read => {
      const result = evaluate(index => index < values.length ? read(index) : 0);
      if (!Array.isArray(result)) return result;
      if (result.length > 1) throw new FormulaError('#CALC!');
      return result[0];
    });
    const result = evaluate(readValue);
    if (!Array.isArray(result)) return result;
    return { rows: 1, columns: result.length, dense: true, occupied: [], read: position => position === undefined ? null : result[position] };
  }

  private textAroundDelimiter(after: boolean): Value {
    const args = this.arguments();
    const provided = (index: number) => args[index] && args[index][0] !== args[index][1];
    if (args.length > 6 || !provided(0) || !provided(1)) throw new FormulaError('#VALUE!');
    const input = this.arrayArgument(args[0]), delimiters = readTextDelimiters(this.arrayArgument(args[1]));
    const values = [input, ...[1, 0, 0].map((value, index) => provided(index + 2) ? this.arrayArgument(args[index + 2]) : value)];
    const array = values.some(isArray);
    const fallback = !provided(5) ? new FormulaError('#N/A') : array ? captureError(() => this.arrayArgument(args[5])) : null;
    const patterns: RegExp[] = [];
    return elementwise([...values, fallback instanceof FormulaError ? null : fallback], read => {
      const source = text(read(0)), occurrence = Math.trunc(number(read(1)));
      const mode = number(read(2)), matchEnd = number(read(3));
      const backwards = occurrence < 0;
      let remaining = Math.abs(occurrence);
      if (!Number.isFinite(remaining) || remaining === 0 || (source && remaining > source.length) ||
          (mode !== 0 && mode !== 1) || (matchEnd !== 0 && matchEnd !== 1)) throw new FormulaError('#VALUE!');
      if (!source || delimiters.has('')) return after === backwards ? '' : source;

      const key = mode * 2 + Number(backwards);
      const pattern = patterns[key] ??= textDelimiterPattern(delimiters, Boolean(mode), backwards);
      const search = backwards ? reverseText(source) : source;
      pattern.lastIndex = 0;
      for (let match = pattern.exec(search); match; match = pattern.exec(search)) {
        if (--remaining !== 0) continue;
        if (backwards) return after ? source.slice(source.length - match.index) : source.slice(0, source.length - pattern.lastIndex);
        return after ? source.slice(pattern.lastIndex) : source.slice(0, match.index);
      }
      if (matchEnd && remaining === 1) return after === backwards ? source : '';
      if (fallback instanceof FormulaError) throw fallback;
      return array ? read(4) : scalar(this.arrayArgument(args[5]));
    });
  }

  private textSplit(): FormulaArray {
    const args = this.arguments();
    const provided = (i: number) => args[i] && args[i][0] !== args[i][1];
    if (args.length > 6 || !provided(0) || (!provided(1) && !provided(2))) throw new FormulaError('#VALUE!');
    const input = this.arrayArgument(args[0]);
    const source = text(isArray(input) ? input.read(0) : input);
    const ignoreEmpty = provided(3) && logical(scalar(this.arrayArgument(args[3])));
    const mode = provided(4) ? number(this.arrayArgument(args[4])) : 0;
    if (!source || (mode !== 0 && mode !== 1)) throw new FormulaError('#VALUE!');
    checkTextLength(source.length);

    const pattern = (index: number) => {
      if (!provided(index)) return;
      const delimiters = readTextDelimiters(this.arrayArgument(args[index]));
      if (delimiters.has('')) throw new FormulaError('#VALUE!');
      return textDelimiterPattern(delimiters, Boolean(mode));
    };
    const colDelimiter = pattern(1), rowDelimiter = pattern(2);
    const split = (value: string, delimiter?: RegExp) => delimiter ? value.split(delimiter) : [value];
    const rows: string[][] = [];
    let columns = 0, padded = false;
    for (const row of split(source, rowDelimiter)) {
      const fields = split(row, colDelimiter);
      const values = ignoreEmpty ? fields.filter(value => value !== '') : fields;
      if (!values.length) continue;
      if (rows.length && values.length !== columns) padded = true;
      rows.push(values);
      columns = Math.max(columns, values.length);
    }
    if (!rows.length) throw new FormulaError('#CALC!');
    if (rows.length > MAX_ROW || columns > MAX_COLUMN) throw new FormulaError('#SPILL!');
    const pad = padded && provided(5) ? captureError(() => scalar(this.arrayArgument(args[5])) ?? 0) : new FormulaError('#N/A');
    // The source bounds the real fields, even when one wide row pads thousands of short rows.
    return { rows: rows.length, columns, occupied: [function* () {
      for (const [row, fields] of rows.entries()) {
        for (let column = 0; column < fields.length; column++) yield row * columns + column;
      }
    }], read(position) {
      const value = position === undefined ? undefined : rows[Math.floor(position / columns)][position % columns];
      if (value !== undefined) return value;
      if (pad instanceof FormulaError) throw pad;
      return pad;
    } };
  }

  private textNumber(explicit: boolean): Value {
    const [input, ...separators] = this.arguments();
    if (input[0] === input[1] || separators.length > (explicit ? 2 : 0)) throw new FormulaError('#VALUE!');
    const value = this.arrayArgument(input);
    const defaults = separators.map(span => span[0] === span[1]);
    const args = separators.map((span, index) => defaults[index] ? null : this.arrayArgument(span));
    return elementwise([value, ...args], read => {
      const raw = read(0);
      const separator = (index: number) => index < args.length && !defaults[index] ? text(read(index + 1)) : undefined;
      const decimal = separator(0), group = separator(1);
      if (typeof raw === 'boolean') throw new FormulaError('#VALUE!');
      const numeric = readNumberText(raw ?? 0, explicit, decimal, group);
      if (numeric !== undefined) return numeric;
      if (!explicit && typeof raw === 'string') {
        const parsed = this.dateText(raw, false);
        const serial = (parsed?.day ?? 0) + (parsed?.time ?? 0);
        if (parsed && isExcelDateSerial(serial, this.date1904)) return serial;
      }
      throw new FormulaError('#VALUE!');
    });
  }

  private formatText(): Value {
    const args = this.arguments();
    if (args.length !== 2 || args.some(([start, end]) => start === end)) throw new FormulaError('#VALUE!');
    return this.liftScalar(args, read => {
      const input = read(0);
      const format = text(read(1));
      let value = typeof input === 'boolean' ? text(input) : input ?? 0;
      if (typeof input === 'string') {
        const numeric = criteriaNumber(input);
        if (numeric !== undefined) value = numeric;
        else {
          const parsed = this.dateText(input, false);
          if (parsed) value = (parsed.day ?? 0) + (parsed.time ?? 0);
        }
      }
      const result = formatWorkbookValue(value, format, this.date1904);
      if (!result) throw new FormulaError('#VALUE!');
      checkTextLength(result.text.length);
      return result.text;
    });
  }

  private groupBy(pivot: boolean): FormulaArray {
    const args = this.arguments();
    const metricIndex = pivot ? 3 : 2;
    if (args.length <= metricIndex || args.length > (pivot ? 11 : 8)) throw new FormulaError('#VALUE!');
    const provided = (i: number) => args[i] && args[i][0] !== args[i][1];
    const option = (i: number) => provided(i) ? number(this.scalarArrayArgument(args[i])) : undefined;
    const array = (i: number) => asArray(this.arrayArgument(args[i]));
    const orders = (i: number) => {
      if (!provided(i)) return [];
      const sort = array(i);
      if (sort.rows > 1 && sort.columns > 1) throw new FormulaError('#VALUE!');
      return Array.from(generatedArrayPositions(sort.rows * sort.columns), at => number(sort.read(at)));
    };
    const headers = option(metricIndex + 1);
    if (headers !== undefined && ![0, 1, 2, 3].includes(headers)) throw new FormulaError('#VALUE!');
    const { metrics, vertical } = this.groupFunctions(args[metricIndex]);
    const values = array(metricIndex - 1);
    if (pivot) {
      const rows = provided(0) ? array(0) : undefined, columns = provided(1) ? array(1) : undefined;
      const rowDepth = option(5) ?? Number(Boolean(rows)), columnDepth = option(7) ?? Number(Boolean(columns));
      const relative = option(10) ?? 0;
      if (!Number.isInteger(rowDepth) || !Number.isInteger(columnDepth) || ![0, 1, 2, 3, 4].includes(relative)) {
        throw new FormulaError('#VALUE!');
      }
      return pivotFormulaRows(rows, columns, values, metrics, {
        headers, rowDepth, rowSort: orders(6), columnDepth, columnSort: orders(8),
        filter: provided(9) ? array(9) : undefined, relative, vertical
      });
    }
    const depth = option(4) ?? 1, relationship = option(7) ?? 0;
    if (!Number.isInteger(depth) || (relationship !== 0 && relationship !== 1)) throw new FormulaError('#VALUE!');
    return groupFormulaRows(array(0), values, metrics, {
      headers, depth, sort: orders(5), filter: provided(6) ? array(6) : undefined, table: relationship === 1, vertical
    });
  }

  private groupFunctions(span: Argument): { metrics: GroupAggregate[]; vertical: boolean } {
    const stack = (span: Argument) => {
      const [first] = span;
      const name = this.tokens[first].replace(/^_xlfn\./i, '').toUpperCase();
      if (this.tokens[first + 1] !== '(' || (name !== 'HSTACK' && name !== 'VSTACK')) return undefined;
      return { name, spans: this.argument(span, () => {
        this.index += 2;
        return this.arguments();
      }) };
    };
    const vector = stack(span);
    const labelled = vector?.name === 'VSTACK' && vector.spans.length === 2 ? stack(vector.spans[0]) : undefined;
    const horizontal = labelled?.name === 'HSTACK' ? labelled : undefined;
    const metrics = (horizontal?.spans ?? vector?.spans ?? [span]).map(span => this.groupAggregate(span));
    if (horizontal) {
      const labels = asArray(this.arrayArgument(vector!.spans[1]));
      if (labels.rows * labels.columns !== metrics.length || (labels.rows > 1 && labels.columns > 1)) throw new FormulaError('#VALUE!');
      metrics.forEach((metric, index) => { metric.label = text(labels.read(index)); });
    }
    return { metrics, vertical: vector?.name === 'VSTACK' && !horizontal };
  }

  private groupAggregate(span: Argument): GroupAggregate {
    const [first, last] = span;
    const token = first + 1 === last ? this.tokens[first] : '';
    const label = token.replace(/^_xleta\./i, '').toUpperCase();
    const builtIn = /^_xleta\./i.test(token) || !this.letBindings?.has(bindingName(token));
    const aggregate = (name: string, array: FormulaArray) =>
      aggregateValues(name, add => visitFormulaArray(array, (value, weight) => add(value, true, weight)));
    if (builtIn && aggregateNames.has(label)) return { label, run: group => aggregate(label, group) };
    if (builtIn && label === 'PERCENTOF') {
      const totals = new WeakMap<FormulaArray, number>();
      return { label, run: (group, total) => {
        let sum = totals.get(total);
        if (sum === undefined) {
          sum = number(aggregate('SUM', total));
          totals.set(total, sum);
        }
        if (!sum) throw new FormulaError('#DIV/0!');
        return number(aggregate('SUM', group)) / sum;
      } };
    }
    if (builtIn && label === 'ARRAYTOTEXT') return { label, run: group => {
      const parts: string[] = [];
      let length = 0;
      visitFormulaArray(group, (value, weight) => {
        if (value instanceof FormulaError) throw value;
        const piece = text(value);
        length += (piece.length + 2) * weight;
        checkTextLength(length - 2);
        parts.push(piece + (', ' + piece).repeat(weight - 1));
      });
      return parts.join(', ');
    } };
    const fn = this.arrayOperand(span);
    if (!isLambda(fn) || (fn.parameterCount !== 1 && fn.parameterCount !== 2)) throw new FormulaError('#VALUE!');
    return { label: token || 'Lambda', run: (group, total) => {
      const result = fn.invoke(fn.parameterCount === 1 ? [group] : [group, total]);
      if (isArray(result) && result.rows * result.columns !== 1) throw new FormulaError('#CALC!');
      return scalar(result);
    } };
  }

  private sort(): FormulaArray {
    const args = this.arguments();
    if (args.length > 4) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(args[0]));
    const options = (span?: Argument) => {
      if (!span || span[0] === span[1]) return [1];
      const input = this.arrayArgument(span);
      if (!isArray(input)) return [number(input)];
      return Array.from(generatedArrayPositions(input.rows * input.columns), index => number(input.read(index)));
    };
    const byRow = !args[3] || args[3][0] === args[3][1] || !this.argument(args[3], () => logical(scalar(this.expression())));
    const indexes = options(args[1]), orders = options(args[2]).map(sortOrder);
    if (orders.length !== 1 && orders.length !== indexes.length) throw new FormulaError('#VALUE!');
    const width = byRow ? source.columns : source.rows;
    const keys = indexes.map((index, i) => {
      const at = Math.trunc(index) - 1;
      if (!(at >= 0 && at < width)) throw new FormulaError('#VALUE!');
      return { array: chooseArray(source, !byRow, [at]), order: orders.length === 1 ? orders[0] : orders[i] };
    });
    return sortFormulaArray(source, byRow, keys);
  }

  private sortBy(): FormulaArray {
    const args = this.arguments();
    if (args.length < 2 || args.length > 255) throw new FormulaError('#VALUE!');
    const source = asArray(this.arrayArgument(args[0]));
    const keys: SortKey[] = [];
    for (let i = 1; i < args.length; i += 2) {
      const array = asArray(this.arrayArgument(args[i])), direction = args[i + 1];
      const order = !direction || direction[0] === direction[1] ? 1 : this.argument(direction, () => sortOrder(number(this.expression())));
      keys.push({ array, order });
    }
    const first = keys[0].array;
    const byRow = first.columns === 1 && first.rows === source.rows;
    if (!byRow && (first.rows !== 1 || first.columns !== source.columns)) throw new FormulaError('#VALUE!');
    if (keys.some(({ array }) => array.rows !== first.rows || array.columns !== first.columns)) throw new FormulaError('#VALUE!');
    return sortFormulaArray(source, byRow, keys);
  }

  private typeCheck(name: string): boolean | FormulaArray {
    const args = this.arguments();
    if (args.length !== 1 || args[0][0] === args[0][1]) throw new FormulaError('#VALUE!');
    const operand = captureError(() => this.argument(args[0], () => this.expression()));
    if (operand instanceof FormulaError) return checkType(name, operand);
    if (isArray(operand) && operand.rows * operand.columns > 1) {
      return mapFormulaArray(operand, (array, position) => checkType(name, captureError(() => array.read(position))));
    }
    return checkType(name, captureError(() => scalar(operand)));
  }

  private textPosition(name: string): Value {
    const args = this.arguments();
    const search = name === 'SEARCH' || name === 'FIND', required = search ? 2 : 1;
    if (args.length < required || args.length > required + 1 || args.slice(0, required).some(([start, end]) => start === end)) {
      throw new FormulaError('#VALUE!');
    }
    return this.liftScalar(args, read => {
      const first = text(read(0));
      const input = search ? text(read(1)) : first;
      const amount = args.length > required ? number(read(required)) : 1;
      if (!Number.isFinite(amount) || amount < 0) throw new FormulaError('#VALUE!');
      const count = Math.trunc(amount);
      // shortcut: character positions use UTF-16, extend when workbook compatibility versions are read.
      if (!search) return name === 'LEFT' ? input.slice(0, count) : input.slice(Math.max(0, input.length - count));
      const offset = count - 1;
      if (offset < 0 || offset >= input.length + Number(name === 'FIND')) throw new FormulaError('#VALUE!');
      const suffix = input.slice(offset);
      const match = name === 'FIND' ? suffix.indexOf(first) : wildcardSearch(first, suffix);
      if (match < 0) throw new FormulaError('#VALUE!');
      return match + count;
    }, 1);
  }

  private formulaText(): string {
    const args = this.arguments();
    if (args.length !== 1) throw new FormulaError('#VALUE!');
    const area = this.argument(args[0], () => {
      const operand = this.referenceArgument(true);
      if (!operand || !isReference(operand)) throw new FormulaError('#VALUE!');
      return operand.areas[0];
    });
    const formula = this.readFormula?.(area);
    if (!formula || formula.length > MAX_FORMULA_LENGTH) throw new FormulaError('#N/A');
    return formula.startsWith('=') ? formula : '=' + formula;
  }

  private isFormula(): boolean | FormulaArray {
    const args = this.arguments();
    if (args.length !== 1) throw new FormulaError('#VALUE!');
    const area = this.argument(args[0], () => this.referenceRange(true));
    const { rows, columns } = lookupShape(area);
    const hasFormula = (cell: Reference) => Boolean(this.readFormula?.(cell, true));
    if (!this.arrayContext || (rows === 1 && columns === 1)) return hasFormula(this.implicitReferenceCell(area));
    return {
      rows, columns, dense: true, occupied: [],
      read: position => position === undefined ? null : hasFormula(atOffset(area, Math.floor(position / columns), position % columns))
    };
  }

  private arrayReference(operand: ReferenceValue): FormulaArray {
    const array = operand.areas.length === 1 ? this.arrayFromRange?.(operand.areas[0]) : undefined;
    if (!array) throw new FormulaError('#VALUE!');
    return operand.zeroForBlanks ? mapFormulaArray(array, blankToZero) : array;
  }

  private arrayConstant(): FormulaArray {
    const values: RangeValue[] = [];
    const columns = this.visitArrayConstant(value => values.push(value));
    return {
      rows: values.length / columns, columns,
      read: position => {
        if (position === undefined) return null;
        const value = values[position];
        if (value instanceof FormulaError) throw value;
        return value;
      },
      occupied: [function* () { for (let i = 0; i < values.length; i++) yield i; }]
    };
  }

  private sumProduct(): number {
    const args = this.arguments();
    if (args.length > 255) throw new FormulaError('#VALUE!');
    const previous = this.arrayContext;
    this.arrayContext = true;
    let values: Value[];
    try { values = args.map(span => this.argument(span, () => this.expression())); }
    finally { this.arrayContext = previous; }

    const arrays = values.filter(isArray);
    const rows = arrays[0]?.rows ?? 1, columns = arrays[0]?.columns ?? 1;
    if (values.some(value => (isArray(value) ? value.rows !== rows || value.columns !== columns : rows * columns !== 1))) {
      throw new FormulaError('#VALUE!');
    }
    const product = (position?: number) => {
      let result = 1;
      for (const value of values) {
        const factor = isArray(value) ? value.read(position) : scalar(value);
        result *= typeof factor === 'number' ? factor : 0;
      }
      if (!Number.isFinite(result)) throw new FormulaError('#NUM!');
      return result;
    };
    if (!arrays.length) return product(0);
    let sum = 0, next = 0;
    let blankProduct: number | undefined;
    const addBlank = (count: number) => {
      // Every unstored position in the gap has the same inputs.
      if (count) sum += count * (blankProduct ??= product());
    };
    const positions = arrays.some(array => array.dense) ? generatedArrayPositions(rows * columns)
      : mergeOccupiedPositions(arrays.flatMap(array => array.occupied));
    for (const position of positions) {
      addBlank(position - next);
      sum += product(position);
      next = position + 1;
    }
    addBlank(rows * columns - next);
    if (!Number.isFinite(sum)) throw new FormulaError('#NUM!');
    return sum;
  }

  private address(): Value {
    const args = this.arguments();
    const present = (index: number) => args[index] && args[index][0] !== args[index][1];
    if (args.length > 5 || !present(0) || !present(1)) throw new FormulaError('#VALUE!');
    const format = (read: (index: number) => Scalar) => {
      const row = Math.trunc(number(read(0))), column = Math.trunc(number(read(1)));
      const mode = present(2) ? Math.trunc(number(read(2))) : 1;
      if (!(row >= 1 && row <= MAX_ROW && column >= 1 && column <= MAX_COLUMN && mode >= 1 && mode <= 4)) {
        throw new FormulaError('#VALUE!');
      }
      const a1 = !present(3) || logical(read(3));
      const rowFixed = mode <= 2, columnFixed = mode % 2 === 1;
      const address = a1 ? (columnFixed ? '$' : '') + columnIndexToName(column) + (rowFixed ? '$' : '') + row
        : 'R' + (rowFixed ? row : '[' + row + ']') + 'C' + (columnFixed ? column : '[' + column + ']');
      const sheet = present(4) ? text(read(4)) : '';
      const result = sheet ? (formulaName.test(sheet) ? sheet : "'" + sheet.replace(/'/g, "''") + "'") + '!' + address : address;
      checkTextLength(result.length);
      return result;
    };
    return this.arrayContext ? this.liftScalar(args, format) : format(index => this.argument(args[index], () => scalar(this.expression())));
  }

  private offset(): ReferenceValue {
    const args = this.arguments();
    if (args.length < 3 || args.length > 5) throw new FormulaError('#VALUE!');
    const base = this.argument(args[0], () => this.referenceRange(true));
    const integer = (index: number, fallback: number) => {
      const span = args[index];
      return span && span[0] !== span[1] ? this.argument(span, () => Math.trunc(number(this.expression()))) : fallback;
    };
    const row = base.firstRow + integer(1, 0), column = base.firstColumn + integer(2, 0);
    const height = integer(3, base.lastRow - base.firstRow + 1), width = integer(4, base.lastColumn - base.firstColumn + 1);
    const lastRow = row + height - Math.sign(height), lastColumn = column + width - Math.sign(width);
    const firstRow = Math.min(row, lastRow), firstColumn = Math.min(column, lastColumn);
    const bottom = Math.max(row, lastRow), right = Math.max(column, lastColumn);
    if (!height || !width || !(firstRow >= 1 && bottom <= MAX_ROW && firstColumn >= 1 && right <= MAX_COLUMN)) {
      throw new FormulaError('#REF!');
    }
    return { areas: [{ sheet: base.sheet, firstRow, lastRow: bottom, firstColumn, lastColumn: right }],
      isRange: firstRow !== bottom || firstColumn !== right };
  }

  private indirect(): ReferenceValue {
    const args = this.arguments();
    if (args.length < 1 || args.length > 2) throw new FormulaError('#VALUE!');
    const value = this.argument(args[0], () => text(scalar(this.expression()))).trim();
    if (value.startsWith('=') || value.length > MAX_FORMULA_LENGTH) throw new FormulaError('#REF!');
    const a1 = !args[1] || args[1][0] === args[1][1] || this.argument(args[1], () => logical(scalar(this.expression())));
    const translated = a1 ? undefined : r1c1ToA1(value, this.position);
    let reader: FormulaReader, ref: ReturnType<FormulaReader['referenceAt']>;
    try {
      reader = new FormulaReader(translated ?? value, this.readCell, this.visitCells, this.lookupName,
        undefined, this.resolveSheetName, this.date1904, this.readClock, this.readFormula, this.lookupTable, this.position,
        this.arrayFromRange, this.readSpillRange);
      ref = reader.referenceAt(0, false);
    } catch {
      throw new FormulaError('#REF!');
    }
    if (!ref || ref.end !== reader.end || (!a1 && !translated && 'areas' in ref.target)) throw new FormulaError('#REF!');
    const operand = reader.referenceValue(ref, true);
    if (!isReference(operand)) throw new FormulaError('#REF!');
    return operand;
  }

  private intersectReference(operand: ReferenceValue): Scalar {
    if (operand.areas.length !== 1) throw new FormulaError('#VALUE!');
    const value = this.readCell(this.implicitReferenceCell(operand.areas[0]));
    return operand.zeroForBlanks ? value ?? 0 : value;
  }

  private implicitReferenceCell(area: Reference): Reference {
    const row = area.firstRow === area.lastRow ? area.firstRow : this.position?.row;
    const column = area.firstColumn === area.lastColumn ? area.firstColumn : this.position?.column;
    if (row === undefined || column === undefined || row < area.firstRow || row > area.lastRow
      || column < area.firstColumn || column > area.lastColumn) throw new FormulaError('#VALUE!');
    return atOffset(area, row - area.firstRow, column - area.firstColumn);
  }

  private subtotal(): number {
    const [functionNumber, ...args] = this.arguments();
    if (!args.length) throw new FormulaError('#VALUE!');
    const rawMode = this.argument(functionNumber, () => Math.trunc(number(this.expression())));
    const skipHidden = rawMode >= 101, mode = skipHidden ? rawMode - 100 : rawMode;
    if (!Number.isFinite(mode) || mode < 1 || mode > 11) throw new FormulaError('#VALUE!');
    const stats = numericSummary(mode);
    const filter: AggregateRangeFilter = { skipHidden, skipFiltered: true, skipNested: 'subtotal' };
    for (const span of args) this.argument(span, () => {
      const operand = this.referenceArgument(true);
      if (operand === null) return;
      if (operand === undefined || !isReference(operand)) throw new FormulaError('#VALUE!');
      for (const area of operand.areas) this.visitCells(area, value => stats.add(value), undefined, false, filter);
    });
    return stats.result();
  }

  private aggregateByNumber(): number {
    const [functionNumber, options, ...args] = this.arguments();
    if (!args.length || args.length > 253) throw new FormulaError('#VALUE!');
    const readNumber = (span: Argument) => this.argument(span, () => number(this.expression()));
    const mode = Math.trunc(readNumber(functionNumber));
    const flags = options[0] === options[1] ? 0 : Math.trunc(readNumber(options));
    if (!(mode >= 1 && mode <= 19 && flags >= 0 && flags <= 7) || (mode >= 14 && args.length !== 2)) {
      throw new FormulaError('#VALUE!');
    }
    const ignoreErrors = Boolean(flags & 2);
    const filter: AggregateRangeFilter = { skipHidden: Boolean(flags & 1), skipNested: flags < 4 ? 'both' : undefined };
    const parameter = mode >= 14 ? readNumber(args.pop()!) : undefined;
    const stats = numericSummary(mode, ignoreErrors);
    for (const span of args) this.argument(span, () => {
      let operand: FormulaOperand | undefined;
      try { operand = this.referenceArgument(true); }
      catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        this.index = span[1];
        stats.add(error);
        return;
      }
      if (operand !== undefined && isReference(operand)) {
        for (const area of operand.areas) {
          if (filter.skipHidden || filter.skipNested) this.visitCells(area, value => stats.add(value), undefined, false, filter);
          else this.visitReferenceValues(area, stats.add);
        }
        return;
      }
      const addScalar = (value: RangeValue) => {
        if (mode === 3 || value === null || value instanceof FormulaError || mode >= 14) stats.add(value);
        else if (mode !== 2 || typeof value !== 'string' || numericText(value)) stats.add(captureError(() => number(value)));
      };
      if (operand !== undefined) {
        if (isArray(operand)) visitFormulaArray(operand, stats.add);
        else addScalar(scalar(operand));
        return;
      }
      // Visibility and nested-function checks require direct cell references.
      const previous = this.arrayContext;
      this.arrayContext = true;
      let value: Value;
      try { value = this.expression(); }
      catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        this.index = span[1];
        stats.add(error);
        return;
      } finally { this.arrayContext = previous; }
      if (!isArray(value)) { addScalar(scalar(value)); return; }
      visitFormulaArray(value, stats.add);
    });
    const result = stats.result(parameter);
    if (!Number.isFinite(result)) throw new FormulaError('#NUM!');
    return result;
  }

  private rank(largest: boolean): Value {
    const args = this.arguments();
    if (args.length !== 2 || args.some(([first, last]) => first === last)) throw new FormulaError('#VALUE!');
    const input = asArray(this.arrayArgument(args[0]));
    const stats = numericSummary(largest ? 14 : 15);
    visitFormulaArray(input, stats.add);
    return this.liftScalar([args[1]], read => stats.result(number(read(0))));
  }

  private correlation(): number {
    const args = this.arguments();
    if (args.length !== 2 || args.some(([first, last]) => first === last)) throw new FormulaError('#VALUE!');
    const left = asArray(this.arrayArgument(args[0])), right = asArray(this.arrayArgument(args[1]));
    const size = left.rows * left.columns;
    if (size !== right.rows * right.columns) throw new FormulaError('#N/A');
    const dense = left.dense || right.dense;
    const positions = dense ? generatedArrayPositions(size) : mergeOccupiedPositions([...left.occupied, ...right.occupied]);
    let count = 0, meanX = 0, meanY = 0, spreadX = 0, spreadY = 0, covariance = 0;
    const add = (x: Scalar, y: Scalar, weight = 1) => {
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new FormulaError('#NUM!');
      const dx = x - meanX, dy = y - meanY;
      const fraction = weight / (count += weight);
      meanX += dx * fraction;
      meanY += dy * fraction;
      spreadX += dx * (x - meanX) * weight;
      spreadY += dy * (y - meanY) * weight;
      covariance += dx * (y - meanY) * weight;
    };
    let next = 0;
    for (const position of positions) {
      if (position > next) add(left.read(), right.read(), position - next);
      add(left.read(position), right.read(position));
      next = position + 1;
    }
    if (next < size) add(left.read(), right.read(), size - next);
    if (count < 2 || spreadX <= 0 || spreadY <= 0) throw new FormulaError('#DIV/0!');
    const result = covariance / Math.sqrt(spreadX) / Math.sqrt(spreadY);
    if (!Number.isFinite(result)) throw new FormulaError('#NUM!');
    return Math.max(-1, Math.min(1, result));
  }

  private textJoin(): string {
    const [delimiter, ignore, ...items] = this.arguments();
    if (!items.length || items.length > 252) throw new FormulaError('#VALUE!');
    const ignoreEmpty = ignore[0] !== ignore[1] && this.argument(ignore, () => logical(scalar(this.expression())));
    const separators: { index: number; text: string }[] = [];
    let period = 0, separatorLength = 0;
    this.visitTextArgument(delimiter, item => {
      if (item instanceof FormulaError) throw item;
      const piece = text(item);
      // All subsequent separators would follow a result already over the cell limit.
      if (piece && separatorLength <= MAX_TEXT_LENGTH) separators.push({ index: period, text: piece });
      separatorLength += piece.length;
      period++;
    }, blanks => { period += blanks; });
    const parts: string[] = [];
    let length = 0, started = false, separatorIndex = 0, position = 0;
    const addSeparators = (count: number) => {
      if (!count || !separators.length) return;
      if (period === 1) {
        const separator = separators[0].text;
        length += count * separator.length;
        checkTextLength(length);
        parts.push(separator.repeat(count));
        return;
      }
      while (count) {
        const separator = separators[separatorIndex];
        const gap = (separator.index - position + period) % period;
        if (count <= gap) { position = (position + count) % period; return; }
        count -= gap + 1;
        position = (separator.index + 1) % period;
        separatorIndex = (separatorIndex + 1) % separators.length;
        length += separator.text.length;
        checkTextLength(length);
        parts.push(separator.text);
      }
    };
    const addBlanks = (count: number) => {
      if (!count || ignoreEmpty) return;
      addSeparators(started ? count : count - 1);
      started = true;
    };
    const add = (item: RangeValue) => {
      if (item instanceof FormulaError) throw item;
      const piece = text(item);
      if (!piece && ignoreEmpty) return;
      if (started) addSeparators(1);
      started = true;
      length += piece.length;
      checkTextLength(length);
      if (piece) parts.push(piece);
    };
    for (const span of items) this.visitTextArgument(span, add, addBlanks);
    return parts.join('');
  }

  private visitTextArgument(span: Argument, visit: (value: RangeValue) => void, blanks: (count: number) => void): void {
    if (span[0] === span[1]) { blanks(1); return; }
    this.argument(span, () => {
      if (this.peek() === '{') { this.visitArrayConstant(visit); return; }
      const end = this.end;
      let operand = this.readOperand();
      this.index = end;
      if (isReference(operand) && operand.zeroForBlanks) operand = this.lookupValue(operand);
      if (isArray(operand)) {
        visitFormulaArray(operand, (value, count) => {
          if (value === null || value === '') blanks(count);
          else for (let i = 0; i < count; i++) visit(value);
        });
        return;
      }
      if (!isReference(operand)) { visit(scalar(operand)); return; }
      for (const area of operand.areas) {
        const width = area.lastColumn - area.firstColumn + 1;
        let next = 0;
        this.visitCells(area, (item, row, column) => {
          const index = (row - area.firstRow) * width + column - area.firstColumn;
          blanks(index - next);
          visit(item);
          next = index + 1;
        });
        blanks((area.lastRow - area.firstRow + 1) * width - next);
      }
    });
  }

  private dateFunction(name: string, required: number): Value {
    const spans = this.arguments();
    if (spans.length < required || spans.length > (name === 'WEEKDAY' ? 2 : required)
      || (spans.length === 1 && spans[0][0] === spans[0][1])) throw new Error('Invalid date formula arguments.');
    return this.liftScalar(spans, read => this.dateResult(name, spans.map((_, index) => read(index))));
  }

  private dateResult(name: string, args: Scalar[]): number {
    const midnight = (timestamp: number) => excelSerialFromTimestamp(timestamp, this.date1904);

    if (name === 'DATEVALUE' || name === 'TIMEVALUE') {
      const timeOnly = name === 'TIMEVALUE';
      const parsed = typeof args[0] === 'string' ? this.dateText(args[0], timeOnly) : undefined;
      const value = timeOnly ? parsed?.time : parsed?.day;
      if (value === undefined || (!timeOnly && (!isExcelDateSerial(value, this.date1904) || (!this.date1904 && value === 0)))) {
        throw new FormulaError('#VALUE!');
      }
      return value;
    }
    if (name === 'DATE') {
      const [rawYear, month, rawDay] = args.map(value => Math.floor(number(value)));
      if (month < -32767 || month >= 32767 || !Number.isFinite(rawYear) || !Number.isFinite(rawDay)) throw new FormulaError('#NUM!');
      // DATE clamps large years and days before applying month and day offsets.
      const year = rawYear < 1900 ? rawYear + 1900 : Math.min(rawYear, 10000);
      const day = rawDay < -32768 ? 32767 : Math.min(rawDay, 32767);
      if (year + Math.floor((month - 1) / 12) < 1) throw new FormulaError('#NUM!');
      const first = new Date(0);
      first.setUTCFullYear(year, month - 1, 1);
      // Day offsets count the serial for February 29, 1900.
      return this.checkedDateSerial(midnight(first.getTime()) + day - 1);
    }
    if (name === 'TIME') {
      const [hours, minutes, seconds] = args.map(value => Math.floor(number(value)));
      if ([hours, minutes, seconds].some(value => !(value >= 0 && value <= 32767))) throw new FormulaError('#NUM!');
      return ((hours * 3600 + minutes * 60 + seconds) % 86_400) / 86_400;
    }

    const timePart = name === 'HOUR' || name === 'MINUTE' || name === 'SECOND';
    const value = this.dateSerial(args[0], timePart), day = Math.floor(value);
    if (name === 'DAYS') return day - Math.floor(this.dateSerial(args[1]));
    if (name === 'WEEKDAY') {
      const mode = Math.trunc(number(args[1] ?? 1));
      const start = mode === 1 || mode === 17 ? 0 : mode === 2 || mode === 3 ? 1 : mode >= 11 && mode <= 16 ? mode - 10 : undefined;
      if (start === undefined) throw new FormulaError('#NUM!');
      const weekday = excelWeekday(day, this.date1904);
      return (weekday - start + 7) % 7 + (mode === 3 ? 0 : 1);
    }
    if (timePart) {
      const seconds = Math.floor(Math.round((value - day) * dayMilliseconds) / 1000) % 86_400;
      if (name === 'HOUR') return Math.floor(seconds / 3600);
      return name === 'MINUTE' ? Math.floor(seconds / 60) % 60 : seconds % 60;
    }
    const date = excelDateParts(day, this.date1904);
    if (name === 'YEAR') return date.year;
    if (name === 'MONTH') return date.month;
    if (name === 'DAY') return date.day;

    // The month-shift functions use Gregorian month lengths even in February 1900.
    const months = Math.trunc(number(args[1]));
    const end = new Date(Date.UTC(date.year, date.month + months, 0));
    if (name === 'EDATE') end.setUTCDate(Math.min(date.day, end.getUTCDate()));
    return this.checkedDateSerial(midnight(end.getTime()));
  }

  private dateText(value: string, preferTime: boolean) {
    return parseFormulaDateText(value, this.date1904, () => this.readClock
      ? excelDateParts(Math.floor(this.readClock(true)), this.date1904).year : new Date().getFullYear(), preferTime);
  }

  private arithmeticNumber(value: Value): number {
    const input = scalar(value);
    if (typeof input !== 'string' || numericText(input)) return Number(input);
    const parsed = this.dateText(input, false);
    if (parsed) return this.checkedDateSerial((parsed.day ?? 0) + (parsed.time ?? 0));
    throw new FormulaError('#VALUE!');
  }

  private dateSerial(value: Scalar, preferTime = false): number {
    if (typeof value !== 'string') return this.checkedDateSerial(number(value));
    const parsed = this.dateText(value, preferTime);
    return this.checkedDateSerial(parsed ? (parsed.day ?? 0) + (parsed.time ?? 0) : number(value));
  }

  private checkedDateSerial(serial: number): number {
    if (!isExcelDateSerial(serial, this.date1904)) throw new FormulaError('#NUM!');
    return serial;
  }

  private workdayFunction(name: string): Value {
    const args = this.arguments(), international = name.endsWith('.INTL'), countDays = name.startsWith('NETWORKDAYS');
    const holidayIndex = international ? 3 : 2;
    if (args.length < 2 || args.length > holidayIndex + 1) throw new Error('Invalid workday formula arguments.');
    const holidayArg = args[holidayIndex];
    const bindings = this.letBindings;
    const day = (date: Scalar) => {
      if (typeof date === 'boolean') throw new FormulaError('#VALUE!');
      return Math.floor(this.dateSerial(date));
    };
    const loadHolidays = (first: number, last: number, weekend: number) => {
      if (!holidayArg || holidayArg[0] === holidayArg[1]) return [];
      const dates = new Set<number>(), previous = this.letBindings;
      this.letBindings = bindings;
      try {
        this.argument(holidayArg, () => this.visitHolidays(value => {
          if (value instanceof FormulaError) throw value;
          if (value === null) return;
          const date = day(value);
          if (date >= first && date <= last && !(weekend & (1 << excelWeekday(date, this.date1904)))) dates.add(date);
        }));
      } finally { this.letBindings = previous; }
      return indexExcelHolidays(dates, this.date1904);
    };
    let holidays: number[][] | FormulaError | undefined;
    const valueArgs = args.slice(0, holidayIndex);
    return this.liftScalar(valueArgs, (read, single) => {
      const start = day(read(0));
      const endOrOffset = countDays ? day(read(1)) : Math.trunc(number(read(1)));
      if (!Number.isFinite(endOrOffset)) throw new FormulaError('#NUM!');
      const weekend = weekendMask(valueArgs.length === 3 ? read(2) : null);
      if (weekend === 127) {
        if (countDays) return 0;
        throw new FormulaError('#VALUE!');
      }
      const first = countDays ? Math.min(start, endOrOffset) : endOrOffset > 0 ? start + 1 : 0;
      const last = countDays ? Math.max(start, endOrOffset) : endOrOffset > 0 ? Infinity : start - 1;
      const dates = holidays ??= captureError(() => loadHolidays(single ? first : 0, single ? last : Infinity, single ? weekend : 0));
      if (dates instanceof FormulaError) throw dates;
      if (countDays) {
        const workdays = countExcelWorkingDays(first, last, weekend, this.date1904) - countExcelHolidays(dates, first, last, weekend);
        return (start <= endOrOffset ? 1 : -1) * workdays;
      }
      if (endOrOffset === 0) return start;
      const result = offsetExcelWorkingDays(start, endOrOffset, weekend, dates, this.date1904);
      if (result === undefined) throw new FormulaError('#NUM!');
      return result;
    });
  }

  private visitHolidays(visit: (value: RangeValue) => void): void {
    if (this.peek() !== '{') {
      const end = this.end;
      const operand = this.readOperand();
      if (isArray(operand)) visitFormulaArray(operand, visit);
      else if (isReference(operand)) for (const area of operand.areas) this.visitReferenceValues(area, visit);
      else visit(scalar(operand));
      this.index = end;
      return;
    }
    this.visitArrayConstant(visit);
  }

  private visitArrayConstant(visit: (value: RangeValue) => void): number {
    this.expect('{');
    let width = 0, columns = 0;
    for (;;) {
      const token = this.take();
      if (token === '+' || token === '-') {
        const magnitude = this.take();
        if (!numberToken.test(magnitude)) throw new Error('Invalid array constant.');
        visit(Number(token + magnitude));
      } else if (numberToken.test(token)) visit(Number(token));
      else if (token.startsWith('"')) visit(token.slice(1, -1).replace(/""/g, '"'));
      else if (/^(?:TRUE|FALSE)$/i.test(token)) visit(token.toUpperCase() === 'TRUE');
      else if (token.startsWith('#')) visit(new FormulaError(token.toUpperCase()));
      else throw new Error('Invalid array constant.');
      columns++;
      const separator = this.take();
      if (separator === ',') continue;
      if ((separator !== ';' && separator !== '}') || (width && columns !== width)) throw new Error('Invalid array constant.');
      if (separator === '}') return columns;
      width = columns;
      columns = 0;
    }
  }

  private lookup(name: string): Value {
    const args = this.arguments();
    if (name === 'XMATCH') return this.xmatch(args);
    const legacyTable = name === 'VLOOKUP' || name === 'HLOOKUP';
    const minimum = legacyTable ? 3 : 2;
    const maximum = name === 'MATCH' ? 3 : 4;
    if (args.length < minimum || args.length > maximum) throw new FormulaError('#VALUE!');
    const present = (index: number) => args[index] && args[index][0] !== args[index][1];
    const value = (index: number) => this.argument(args[index], () => scalar(this.expression()));
    const mode = (index: number, fallback: number) => present(index) ? number(value(index)) : fallback;
    const key = value(0) ?? 0;
    if (legacyTable) {
      const source = this.lookupArea(args[1]);
      const { rows, columns } = lookupShape(source);
      const vertical = name === 'VLOOKUP';
      const index = Math.trunc(number(value(2)));
      if (index < 1) throw new FormulaError('#VALUE!');
      if (index > (vertical ? columns : rows)) throw new FormulaError('#REF!');
      const approximate = present(3) ? logical(value(3)) : true;
      const matchMode = approximate ? -1 : 2, searchMode = approximate ? 2 : 1;
      let match: number | undefined;
      if ('occupied' in source) {
        const keys = sliceArray(source, 0, 0, vertical ? rows : 1, vertical ? 1 : columns);
        match = findArrayLookup(keys, key, matchMode, searchMode, approximate);
      } else {
        const keys = vertical ? { ...source, lastColumn: source.firstColumn } : { ...source, lastRow: source.firstRow };
        match = this.findLookup(keys, vertical, key, matchMode, searchMode, approximate);
      }
      if (match === undefined) throw new FormulaError('#N/A');
      return scalar(this.lookupValue(this.lookupSlice(source, vertical ? match + 1 : index, vertical ? index : match + 1))) ?? 0;
    }

    const source = this.argument(args[1], () => this.referenceRange(true));
    const vertical = source.firstColumn === source.lastColumn, horizontal = source.firstRow === source.lastRow;
    if (!vertical && !horizontal) throw new FormulaError('#VALUE!');
    const type = mode(2, 1);
    if (![0, -1, 1].includes(type)) throw new FormulaError('#VALUE!');
    const match = this.findLookup(source, vertical, key, type === 0 ? 2 : -type, type === 0 ? 1 : type * 2, type !== 0);
    if (match === undefined) throw new FormulaError('#N/A');
    return match + 1;
  }

  private indexReference(): FormulaOperand {
    const args = this.arguments();
    if (args.length < 2 || args.length > 4) throw new FormulaError('#VALUE!');
    const present = (index: number) => args[index] && args[index][0] !== args[index][1];
    const integer = (index: number, fallback: number) =>
      present(index) ? this.argument(args[index], () => Math.trunc(number(this.expression()))) : fallback;
    const operand = this.arrayOperand(args[0]);
    const area = integer(3, 1);
    let source: LookupArea | undefined;
    if (isReference(operand)) {
      source = operand.areas[area - 1];
      if (source) {
        const sheet = this.resolveSheetName?.(source.sheet);
        if (operand.areas.some(item => this.resolveSheetName?.(item.sheet) !== sheet)) throw new FormulaError('#VALUE!');
      }
    } else if (isArray(operand)) {
      if (area === 1) source = operand;
    } else throw new FormulaError('#VALUE!');
    if (!source) throw new FormulaError('#REF!');

    const { rows, columns } = lookupShape(source);
    let row = integer(1, 0), column = integer(2, 0);
    if (rows === 1 && columns > 1 && !present(2)) { column = row; row = 1; }
    if (!(row >= 0 && row <= rows && column >= 0 && column <= columns)) throw new FormulaError('#REF!');
    if (!row && rows === 1) row = 1;
    if (!column && columns === 1) column = 1;
    const result = this.lookupSlice(source, row, column);
    return isReference(result) && isReference(operand) && operand.zeroForBlanks ? { ...result, zeroForBlanks: true } : result;
  }

  private xmatch(args: Argument[]): Value {
    if (args.length < 2 || args.length > 4) throw new FormulaError('#VALUE!');
    const values = this.arrayArgument(args[0]), keys = this.lookupArea(args[1], true);
    const { rows, columns } = lookupShape(keys);
    if (rows !== 1 && columns !== 1) throw new FormulaError('#VALUE!');
    const mode = (index: number, fallback: number) => args[index] && args[index][0] !== args[index][1]
      ? this.argument(args[index], () => number(this.expression())) : fallback;
    const match = mode(2, 0), search = mode(3, 1);
    if (![0, -1, 1, 2].includes(match) || ![1, -1, 2, -2].includes(search)) throw new FormulaError('#VALUE!');
    const multiple = isArray(values) && values.rows * values.columns > 1;
    const find = this.lookupVector(keys, columns === 1, Math.max(rows, columns), match, search, multiple);
    const read = (key: Scalar) => {
      const position = find(key ?? 0);
      if (position === undefined) throw new FormulaError('#N/A');
      return position + 1;
    };
    return multiple ? mapFormulaArray(values, (array, position) => read(array.read(position))) : read(scalar(values));
  }

  private xlookup(): FormulaOperand {
    const args = this.arguments();
    if (args.length < 3 || args.length > 6) throw new FormulaError('#VALUE!');
    const present = (index: number) => args[index] && args[index][0] !== args[index][1];
    const value = (index: number) => this.argument(args[index], () => scalar(this.expression()));
    const values = present(0) ? this.arrayArgument(args[0]) : null;
    const keys = this.lookupArea(args[1], true), returns = this.lookupArea(args[2]);
    const keyShape = lookupShape(keys), returnShape = lookupShape(returns);
    const vertical = keyShape.columns === 1 && returnShape.rows === keyShape.rows;
    const horizontal = keyShape.rows === 1 && returnShape.columns === keyShape.columns;
    if (!vertical && !horizontal) throw new FormulaError('#VALUE!');
    const matchMode = present(4) ? number(value(4)) : 0, searchMode = present(5) ? number(value(5)) : 1;
    if (![0, -1, 1, 2].includes(matchMode) || ![1, -1, 2, -2].includes(searchMode)) throw new FormulaError('#VALUE!');
    const returnAt = (match: number) => this.lookupSlice(returns,
      vertical ? match + 1 : Number(returnShape.rows === 1),
      vertical ? Number(returnShape.columns === 1) : match + 1);

    if (isArray(values) && values.rows * values.columns > 1) {
      if ((vertical ? returnShape.columns : returnShape.rows) !== 1) throw new Error('XLOOKUP requires one return per array key.');
      const find = this.lookupVector(keys, vertical, Math.max(keyShape.rows, keyShape.columns), matchMode, searchMode, true);
      const bindings = this.letBindings;
      let fallback: RangeValue | undefined;
      return mapFormulaArray(values, (array, position) => {
        const match = find(array.read(position) ?? 0);
        if (match !== undefined) return scalar(this.lookupValue(returnAt(match))) ?? 0;
        if (!present(3)) throw new FormulaError('#N/A');
        if (fallback === undefined) {
          const previous = this.letBindings;
          this.letBindings = bindings;
          try { fallback = captureError(() => scalar(this.arrayArgument(args[3])) ?? 0); }
          finally { this.letBindings = previous; }
        }
        if (fallback instanceof FormulaError) throw fallback;
        return fallback;
      });
    }

    const key = present(0) ? scalar(values) ?? 0 : null;
    const match = 'occupied' in keys ? findArrayLookup(keys, key, matchMode, searchMode)
      : this.findLookup(keys, vertical, key, matchMode, searchMode);
    if (match === undefined) {
      if (present(3)) return this.arrayOperand(args[3]);
      throw new FormulaError('#N/A');
    }
    const result = returnAt(match);
    if (isReference(result)) return { ...result, zeroForBlanks: true };
    return isArray(result) ? mapFormulaArray(result, blankToZero) : result ?? 0;
  }

  private lookupVector(keys: LookupArea, vertical: boolean, length: number, match: number, search: number, indexed: boolean) {
    const visit = () => 'occupied' in keys ? arrayLookupKeys(keys) : this.lookupKeys(keys, vertical);
    return indexed && match === 0 && Math.abs(search) === 1
      ? indexExactLookup(length, visit(), search === -1)
      : (key: Exclude<Scalar, null>) => findLookupIndex(key, length, visit(), match, search);
  }

  private lookupArea(span: Argument, readLookupValues = false): LookupArea {
    const value = this.arrayOperand(span);
    if (isArray(value)) return value;
    if (!isReference(value) || value.areas.length !== 1) throw new FormulaError('#VALUE!');
    const [area] = value.areas;
    this.resolveSheetName?.(area.sheet);
    if (readLookupValues && value.zeroForBlanks) return asArray(this.lookupValue(value));
    return area;
  }

  private arrayOperand(span: Argument): FormulaOperand {
    const previous = this.arrayContext;
    this.arrayContext = true;
    try {
      return this.argument(span, () => {
        const value = this.readOperand();
        this.index = span[1];
        return value;
      });
    } finally { this.arrayContext = previous; }
  }

  private lookupSlice(source: LookupArea, row: number, column: number): FormulaOperand {
    if ('occupied' in source) {
      if (row && column) return source.read((row - 1) * source.columns + column - 1);
      if (row) return chooseArray(source, true, [row - 1]);
      if (column) return chooseArray(source, false, [column - 1]);
      return source;
    }
    const range = { ...source };
    if (row) range.firstRow = range.lastRow = source.firstRow + row - 1;
    if (column) range.firstColumn = range.lastColumn = source.firstColumn + column - 1;
    return { areas: [range], isRange: !row || !column };
  }

  private lookupValue(operand: FormulaOperand): Scalar | FormulaArray {
    if (!isReference(operand)) return isArray(operand) ? operand : scalar(operand);
    if (operand.isRange) return this.arrayReference(operand);
    const value = this.readCell(operand.areas[0]);
    return operand.zeroForBlanks ? value ?? 0 : value;
  }

  private findLookup(range: Reference, vertical: boolean, key: Scalar, match: number, search: number,
    lastExact = false): number | undefined {
    const length = vertical ? range.lastRow - range.firstRow + 1 : range.lastColumn - range.firstColumn + 1;
    return findLookupIndex(key, length, this.lookupKeys(range, vertical), match, search, lastExact);
  }

  private lookupKeys(range: Reference, vertical: boolean): VisitLookupKeys {
    return (first, last, reverse, found) => {
      const window = vertical ? { ...range, firstRow: range.firstRow + first, lastRow: range.firstRow + last }
        : { ...range, firstColumn: range.firstColumn + first, lastColumn: range.firstColumn + last };
      this.visitCells(window, (value, row, column) => found(value, vertical ? row - range.firstRow : column - range.firstColumn), undefined, reverse);
    };
  }

  private countBlank(): number {
    const args = this.arguments();
    if (args.length !== 1) throw new FormulaError('#VALUE!');
    const range = this.argument(args[0], () => this.referenceRange(true));
    let count = (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
    const subtractNonblank = (value: RangeValue, weight: number) => {
      if (value !== null && value !== '') count -= weight;
    };
    if (this.visitDisplayedRangeValues) this.visitDisplayedRangeValues(range, subtractNonblank);
    else this.visitReferenceValues(range, subtractNonblank);
    return count;
  }

  private countIf(): Value {
    const args = this.arguments();
    if (args.length !== 2) throw new FormulaError('#VALUE!');
    const range = this.argument(args[0], () => this.referenceRange(true));
    const criteria = this.arrayArgument(args[1]);
    const visit = (read: (value: RangeValue, weight: number) => void) => {
      let unstored = (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1);
      this.visitReferenceValues(range, (value, weight) => {
        unstored -= weight;
        read(value, weight);
      });
      if (unstored > 0) read(null, unstored);
    };
    if (!isArray(criteria) || criteria.rows * criteria.columns === 1) {
      const matches = formulaCriterion(scalar(criteria), false);
      let total = 0;
      visit((value, weight) => { if (matches(value)) total += weight; });
      return total;
    }
    let count: ((criterion: Scalar) => number) | undefined;
    return mapFormulaArray(criteria, (array, position) => {
      const criterion = array.read(position);
      return (count ??= indexCountIfValues(visit))(criterion);
    });
  }

  private conditionalAggregate(name: string): number {
    const multiple = name.endsWith('IFS'), countOnly = name.startsWith('COUNT');
    let results = multiple && !countOnly ? this.referenceRange() : undefined;
    if (results) this.expect(',');
    const criteria: FormulaCriterion[] = [];
    do {
      if (criteria.length === 127) throw new FormulaError('#VALUE!');
      const range = this.referenceRange();
      this.expect(',');
      const matches = formulaCriterion(scalar(this.expression()), name === 'AVERAGEIFS');
      criteria.push({ range, matches });
    } while (multiple && this.peek() === ',' && this.take());
    const first = criteria[0].range;
    const rows = first.lastRow - first.firstRow, columns = first.lastColumn - first.firstColumn;
    if (!multiple && !countOnly) {
      if (this.peek() === ',') {
        this.take();
        const start = this.referenceRange();
        // Single-criterion functions project the criteria shape from the result's top left.
        results = { ...start, lastRow: Math.min(MAX_ROW, start.firstRow + rows),
          lastColumn: Math.min(MAX_COLUMN, start.firstColumn + columns) };
      } else results = first;
    }
    this.expect(')');
    if (multiple && [...criteria.map(({ range }) => range), ...(results ? [results] : [])].some(range =>
      range.lastRow - range.firstRow !== rows || range.lastColumn - range.firstColumn !== columns)) throw new FormulaError('#VALUE!');

    const matches = (r: number, c: number, before = criteria.length, skip = -1) => {
      for (let i = 0; i < before; i++) {
        if (i === skip) continue;
        const { range, matches } = criteria[i];
        const row = range.firstRow + r, column = range.firstColumn + c;
        let value: RangeValue;
        try { value = this.readCell({ sheet: range.sheet, firstRow: row, lastRow: row, firstColumn: column, lastColumn: column }); }
        catch (error) {
          if (!(error instanceof FormulaError)) throw error;
          value = error;
        }
        if (!matches(value)) return false;
      }
      return true;
    };
    if (!results) {
      let count = 0;
      const compact = criteria.length === 1 && this.arrayFromRange?.(first, true);
      if (compact) {
        visitFormulaArray(compact, (value, weight) => { if (criteria[0].matches(value)) count += weight; });
        return count;
      }
      const pivot = criteria.findIndex(criterion => !criterion.matches(null));
      if (pivot >= 0) {
        const clause = criteria[pivot];
        this.visitCells(clause.range, (value, row, column) => {
          if (clause.matches(value) && matches(row - clause.range.firstRow, column - clause.range.firstColumn, criteria.length, pivot)) count++;
        });
      } else {
        count = (rows + 1) * (columns + 1);
        // Blank positions already match. Subtract an occupied position only at its first failing criterion.
        criteria.forEach((clause, i) => this.visitCells(clause.range, (value, row, column) => {
          if (!clause.matches(value) && matches(row - clause.range.firstRow, column - clause.range.firstColumn, i)) count--;
        }));
      }
      return count;
    }

    const target = results, average = name.startsWith('AVERAGE');
    const logicalValues = name === 'SUMIFS' || name === 'AVERAGEIFS';
    let count = 0, sum = 0, extreme: number | undefined;
    this.visitCells(target, value => {
      if (value instanceof FormulaError) throw value;
      if (typeof value === 'boolean' && logicalValues) value = Number(value);
      if (typeof value !== 'number') return;
      count++;
      if (name === 'MINIFS') extreme = extreme === undefined ? value : Math.min(extreme, value);
      else if (name === 'MAXIFS') extreme = extreme === undefined ? value : Math.max(extreme, value);
      else sum += value;
    }, (row, column) => matches(row - target.firstRow, column - target.firstColumn));
    if (!average) return extreme ?? sum;
    if (!count) throw new FormulaError('#DIV/0!');
    return sum / count;
  }

  private referenceRange(completeArgument = false): Reference {
    const value = this.referenceArgument(completeArgument);
    if (value === undefined || !isReference(value) || value.areas.length !== 1) throw new FormulaError('#VALUE!');
    const area = value.areas[0];
    this.resolveSheetName?.(area.sheet);
    return area;
  }

  private aggregate(name: string): Scalar {
    return aggregateValues(name, add => {
      if (this.peek() !== ')') {
        do {
          const reference = this.referenceArgument();
          const operand = reference === undefined ? this.expression() : reference;
          if (isArray(operand)) visitFormulaArray(operand, (value, weight) => add(value, true, weight));
          else if (operand !== undefined && isReference(operand)) {
            for (const area of operand.areas) this.visitReferenceValues(area, (value, weight) => add(value, true, weight));
          } else add(scalar(operand), false);
        } while (this.peek() === ',' && this.take());
      }
      this.expect(')');
    });
  }

  private visitReferenceValues(range: Reference, visit: (value: RangeValue, weight: number) => void): void {
    const compact = this.arrayFromRange?.(range, true);
    if (compact) visitFormulaArray(compact, visit);
    else this.visitCells(range, value => visit(value, 1));
  }

  private conditional(name: string): Value {
    const args = this.arguments();
    if (args.some(([first, last]) => first === last)) throw new Error('Missing formula argument.');
    const evaluate = (span: Argument) => this.argument(span, () => this.expression());
    const branch = (span: Argument): Value => {
      const result = captureError(() => this.arrayArgument(span));
      return result instanceof FormulaError ? asArray(result) : result;
    };
    if (name === 'IF' && (args.length === 2 || args.length === 3)) {
      const condition = evaluate(args[0]);
      if (isArray(condition) && condition.rows * condition.columns > 1) {
        return elementwise([condition, branch(args[1]), args[2] ? branch(args[2]) : false],
          read => logical(read(0)) ? read(1) : read(2));
      }
      if (logical(scalar(condition))) return evaluate(args[1]);
      return args[2] ? evaluate(args[2]) : false;
    }
    if ((name === 'IFERROR' || name === 'IFNA') && args.length === 2) {
      const catches = (error: unknown) => error instanceof FormulaError &&
        (name === 'IFERROR' || error.message.toUpperCase() === '#N/A');
      const recover = (value: RangeValue, fallback: () => Scalar) => {
        if (!(value instanceof FormulaError)) return value;
        if (!catches(value)) throw value;
        return fallback();
      };
      try {
        const value = evaluate(args[0]);
        if (isArray(value) && value.rows * value.columns > 1) {
          const alternative = branch(args[1]);
          if (!isArray(alternative) || alternative.rows * alternative.columns === 1) {
            return mapFormulaArray(value, (array, position) =>
              recover(captureError(() => array.read(position)), () => scalar(alternative)));
          }
          return elementwise([value, alternative], read => recover(captureError(() => read(0)), () => read(1)));
        }
        return scalar(value);
      }
      catch (error) {
        if (!catches(error)) throw error;
        return evaluate(args[1]);
      }
    }
    throw new Error('Invalid conditional arguments.');
  }

  private orderedConditional(hasSelector: boolean): Value {
    const args = this.arguments();
    const first = hasSelector ? 1 : 0;
    const pairEnd = args.length - ((args.length - first) % 2);
    if (pairEnd < first + 2 || args.length > 254 || (!hasSelector && pairEnd !== args.length) ||
      args.some(([start, end]) => start === end)) throw new FormulaError('#VALUE!');

    return this.liftScalar(args, read => {
      const selector = hasSelector ? read(0) : null;
      for (let index = first; index < pairEnd; index += 2) {
        const test = read(index);
        if (hasSelector ? compareFormulaValues(selector, test, '=') : logical(test)) return read(index + 1) ?? 0;
      }
      if (pairEnd < args.length) return read(pairEnd) ?? 0;
      throw new FormulaError('#N/A');
    });
  }

  private arguments(): Argument[] {
    const args: Argument[] = [];
    let start = this.index, depth = 0;
    for (;;) {
      const at = this.index, token = this.take();
      if (depth === 0 && (token === ',' || token === ')')) {
        args.push([start, at]);
        start = at + 1;
        if (token === ')') break;
      } else if (token === '(' || token === '{') depth++;
      else if (token === ')' || token === '}') depth--;
    }
    return args;
  }

  private argument<T>([first, last]: Argument, read: () => T): T {
    if (first === last) throw new FormulaError('#VALUE!');
    const at = this.index, end = this.end;
    this.index = first;
    this.end = last;
    try {
      const value = read();
      if (this.index !== last) throw new Error('Unsupported formula argument.');
      return value;
    } finally { this.index = at; this.end = end; }
  }

  private referenceArgument(definition = false): FormulaOperand | undefined {
    let at = this.index, parentheses = 0;
    let ref = this.referenceAt(at);
    if (!ref && this.tokens[at] === '(') {
      while (at < this.end && this.tokens[at] === '(') { at++; parentheses++; }
      ref = this.referenceAt(at);
    }
    if (!ref) return undefined;
    at = ref.end;
    while (parentheses-- > 0) if (this.tokens[at++] !== ')') return undefined;
    if (at > this.end || (at === this.end ? !definition : this.tokens[at] !== ',' && this.tokens[at] !== ')')) return undefined;
    this.index = at;
    return this.referenceValue(ref);
  }

  private referenceValue(ref: ParsedReference, indirect = false): FormulaOperand {
    let operand = this.referenceTargetValue(ref.target, indirect);
    if (ref.trimMode !== undefined) {
      if (ref.lastSheet !== undefined || !isReference(operand)) throw new FormulaError('#VALUE!');
      operand = this.trimReference(operand, ref.trimMode, ref.trimMode);
    }
    if (ref.lastSheet !== undefined) {
      if (indirect || ref.spill || !isReference(operand)) throw new FormulaError('#REF!');
      const area = operand.areas[0];
      const names = area.sheet === undefined ? undefined : this.resolveSheetSpan?.(area.sheet, ref.lastSheet);
      if (!names?.length) throw new FormulaError('#REF!');
      return { areas: names.map(sheet => ({ ...area, sheet })), isRange: true, threeDimensional: true };
    }
    if (!ref.spill) return operand;
    const anchor = isReference(operand) && operand.areas.length === 1 ? operand.areas[0] : undefined;
    const range = anchor && anchor.firstRow === anchor.lastRow && anchor.firstColumn === anchor.lastColumn
      ? this.readSpillRange?.(anchor) : undefined;
    if (!range) throw new FormulaError('#REF!');
    return { areas: [range], isRange: true };
  }

  private referenceTargetValue(target: ReferenceTarget, indirect: boolean): FormulaOperand {
    if ('call' in target) {
      return this.argument(target.span, () => this.nested(() => {
        if (target.call === 'INDEX') return this.indexReference();
        if (target.call === 'XLOOKUP') return this.xlookup();
        if (target.call === 'TRIMRANGE' || trimReferences.has(target.call)) return this.trimRange(trimReferences.get(target.call));
        return target.call === 'OFFSET' ? this.offset() : this.indirect();
      }));
    }
    if ('endpoints' in target) {
      const [left, right] = target.endpoints.map(ref => this.referenceValue(ref));
      if (!isReference(left) || !isReference(right) || left.areas.length !== 1 || right.areas.length !== 1
        || left.threeDimensional || right.threeDimensional) throw new FormulaError('#VALUE!');
      const [a] = left.areas, [b] = right.areas;
      const sheet = (ref: Reference) => this.resolveSheetName?.(ref.sheet) ?? ref.sheet;
      if (sheet(a) !== sheet(b)) throw new FormulaError('#REF!');
      return { areas: [{ sheet: a.sheet, firstRow: Math.min(a.firstRow, b.firstRow), lastRow: Math.max(a.lastRow, b.lastRow),
        firstColumn: Math.min(a.firstColumn, b.firstColumn), lastColumn: Math.max(a.lastColumn, b.lastColumn) }], isRange: true };
    }
    if ('specifier' in target) {
      const source = this.lookupTable?.(target.table, target.sheet);
      if (!source) throw new FormulaError('#REF!');
      return this.readTableReference(source, target.specifier);
    }
    if ('areas' in target) return target;
    if (this.letBindings && target.sheet === undefined) {
      const local = this.letBindings.get(bindingName(target.name));
      if (local instanceof FormulaError) throw local;
      if (local !== undefined) return local;
    }
    const value = this.lookupName?.(target.name, target.sheet);
    if (value !== undefined) return value;
    const source = this.lookupTable?.(target.name, target.sheet ?? undefined);
    if (source) return this.readTableReference(source, '[]');
    if (target.invalidAddress || indirect) throw new FormulaError('#REF!');
    if (this.letBindings) throw new FormulaError('#NAME?');
    throw new Error('Unsupported formula token.');
  }

  private readTableReference(source: TableReferenceSource, specifier: string): FormulaOperand {
    const value = tableReference(source, specifier);
    if (typeof value === 'string') throw new FormulaError(value);
    return value;
  }

  private referenceAt(at: number, calculated = true): ParsedReference | undefined {
    const wrapped = this.tokens[at + 1] === '(' && anchorArrayName.test(this.tokens[at]);
    const call = calculated && !wrapped ? this.referenceCallAt(at) : undefined;
    const ref = call ?? this.referenceTargetAt(wrapped ? at + 2 : at, calculated && !wrapped);
    if (!ref || ref.end >= this.end) return wrapped ? undefined : ref;
    const next = this.tokens[ref.end];
    if (wrapped && next !== ')') return undefined;
    if (calculated && !wrapped && next === ':') {
      const right = this.referenceCallAt(ref.end + 1) ?? this.referenceTargetAt(ref.end + 1);
      if (right) return { target: { endpoints: [ref, right] }, end: right.end };
    }
    return wrapped || next === '#' ? { ...ref, end: ref.end + 1, spill: true } : ref;
  }

  private referenceCallStart(at: number): number {
    while (at < this.end && this.tokens[at] === '(') at++;
    return at + 1 < this.end && this.tokens[at + 1] === '(' && referenceFunctionName.test(this.tokens[at]) ? at : -1;
  }

  private referenceCallAt(at: number): ParsedReference | undefined {
    const start = this.referenceCallStart(at);
    if (start < 0) return undefined;
    for (let close = start + 2, depth = 1; close < this.end; close++) {
      const token = this.tokens[close];
      if (token === '(') depth++;
      else if (token === ')' && --depth === 0) {
        const end = close + 1 + start - at;
        if (end > this.end) return undefined;
        for (let i = close + 1; i < end; i++) if (this.tokens[i] !== ')') return undefined;
        const call = referenceFunctionName.exec(this.tokens[start])![1].toUpperCase();
        return { target: { call, span: [start + 2, close + 1] }, end };
      }
    }
  }

  private referenceTargetAt(at: number, calculated = false): ParsedReference | undefined {
    if (this.tokens[at] === '[0]' && this.tokens[at + 1] === '!') {
      const name = this.tokens[at + 2] ?? '';
      if (at + 3 <= this.end && formulaName.test(name)) return { target: { name, sheet: null }, end: at + 3 };
      return undefined;
    }
    let sheet: string | undefined, lastSheet: string | undefined;
    if (this.origin && this.tokens[at] === '!') {
      sheet = this.origin.currentSheet;
      at++;
    } else if (this.tokens[at + 1] === ':' && this.tokens[at + 3] === '!') {
      sheet = sheetName(this.tokens[at]);
      lastSheet = sheetName(this.tokens[at + 2]);
      at += 4;
    } else if (this.tokens[at + 1] === '!') {
      const qualifier = this.tokens[at], colon = qualifier.startsWith("'") ? qualifier.indexOf(':') : -1;
      if (colon >= 0) {
        sheet = sheetName(qualifier.slice(0, colon) + "'");
        lastSheet = sheetName("'" + qualifier.slice(colon + 1));
      } else sheet = sheetName(qualifier);
      at += 2;
    }
    const first = this.tokens[at] ?? '';
    if (first.startsWith('[') && lastSheet === undefined) return { target: { specifier: first, sheet }, end: at + 1 };
    const next = this.tokens[at + 1];
    if (lastSheet === undefined && next?.startsWith('[') && formulaName.test(first) && at + 2 <= this.end) {
      return { target: { table: first, specifier: next, sheet }, end: at + 2 };
    }
    const right = this.tokens[at + 2] ?? '';
    const localEndpoint = calculated && next === ':' && this.letBindings && !(columnRef.test(first) && columnRef.test(right))
      && (this.letBindings.has(bindingName(right)) || (sheet === undefined && this.letBindings.has(bindingName(first))));
    const trimMode = trimOperators.get(next);
    const isRange = at + 1 < this.end && (trimMode !== undefined || (next === ':' && (!calculated
      || (!localEndpoint && this.referenceCallStart(at + 2) < 0))));
    let end = at + 1, last = first;
    if (isRange) {
      end++;
      if (this.tokens[end + 1] === '!') {
        const secondSheet = sheetName(this.tokens[end]);
        if (lastSheet !== undefined || !sheet || sheet.toLowerCase() !== secondSheet.toLowerCase()) throw new Error('Unsupported range sheets.');
        end += 2;
      }
      last = this.tokens[end++] ?? '';
    }
    if (end > this.end) return undefined;
    if (/^#REF!$/i.test(first) || /^#REF!$/i.test(last)) throw new FormulaError('#REF!');
    const firstCell = cellRef.exec(first), lastCell = isRange ? cellRef.exec(last) : firstCell;
    let bounds: Reference;
    if (firstCell && lastCell) {
      const a = parseCellRef(first.replace(/\$/g, '')), b = isRange ? parseCellRef(last.replace(/\$/g, '')) : { ...a };
      if (lastSheet === undefined && !isRange && formulaName.test(first) && (a.row > MAX_ROW || a.column > MAX_COLUMN)) {
        return { target: { name: first, sheet, invalidAddress: true }, end };
      }
      if (Math.max(a.row, b.row) > MAX_ROW || Math.max(a.column, b.column) > MAX_COLUMN) throw new FormulaError('#REF!');
      if (this.origin) {
        if (!firstCell[1]) a.column = relativeCoordinate(a.column, this.origin.column, MAX_COLUMN);
        if (!lastCell[1]) b.column = relativeCoordinate(b.column, this.origin.column, MAX_COLUMN);
        if (!firstCell[2]) a.row = relativeCoordinate(a.row, this.origin.row, MAX_ROW);
        if (!lastCell[2]) b.row = relativeCoordinate(b.row, this.origin.row, MAX_ROW);
      }
      bounds = { sheet, firstRow: Math.min(a.row, b.row), lastRow: Math.max(a.row, b.row),
        firstColumn: Math.min(a.column, b.column), lastColumn: Math.max(a.column, b.column) };
    } else if (isRange && columnRef.test(first) && columnRef.test(last)) {
      let a = columnNameToIndex(first.replace('$', '')), b = columnNameToIndex(last.replace('$', ''));
      if (Math.max(a, b) > MAX_COLUMN) throw new FormulaError('#REF!');
      if (this.origin) {
        if (!first.startsWith('$')) a = relativeCoordinate(a, this.origin.column, MAX_COLUMN);
        if (!last.startsWith('$')) b = relativeCoordinate(b, this.origin.column, MAX_COLUMN);
      }
      bounds = { sheet, firstRow: 1, lastRow: MAX_ROW, firstColumn: Math.min(a, b), lastColumn: Math.max(a, b) };
    } else if (isRange && rowRef.test(first) && rowRef.test(last)) {
      let a = Number(first.replace('$', '')), b = Number(last.replace('$', ''));
      if (Math.max(a, b) > MAX_ROW) throw new FormulaError('#REF!');
      if (this.origin) {
        if (!first.startsWith('$')) a = relativeCoordinate(a, this.origin.row, MAX_ROW);
        if (!last.startsWith('$')) b = relativeCoordinate(b, this.origin.row, MAX_ROW);
      }
      bounds = { sheet, firstRow: Math.min(a, b), lastRow: Math.max(a, b), firstColumn: 1, lastColumn: MAX_COLUMN };
    } else if (lastSheet === undefined && !isRange && formulaName.test(first) && (sheet !== undefined || !/^(?:TRUE|FALSE)$/i.test(first))) {
      return { target: { name: first, sheet }, end };
    } else return undefined;
    if (this.origin && bounds.sheet === undefined) bounds.sheet = this.origin.sheet;
    return { target: { areas: [bounds], isRange }, end, lastSheet, trimMode };
  }

  private nested<T>(run: () => T): T {
    if (this.depth >= MAX_NESTING) throw new Error('Formula nesting exceeds the preview limit.');
    this.depth++;
    try { return run(); }
    finally { this.depth--; }
  }

  private peek(): string { return this.index < this.end ? this.tokens[this.index] : ''; }
  private take(): string {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of formula.');
    this.index++;
    return token;
  }
  private expect(token: string): void {
    if (this.take() !== token) throw new Error('Expected ' + token + '.');
  }
}

function r1c1ToA1(value: string, position?: { row: number; column: number }): string | undefined {
  const spill = value.endsWith('#');
  const points = (spill ? value.slice(0, -1) : value).split(':');
  if (points.length > 2) return undefined;
  const axis = (source: string | undefined, current: number | undefined, limit: number): number => {
    if (source === undefined) return 0;
    const value = !source || source[0] === '[' ? (current ?? NaN) + Number(source.slice(1, -1)) : Number(source);
    if (!(value >= 1 && value <= limit)) throw new FormulaError('#REF!');
    return value;
  };
  const addresses = [];
  for (const point of points) {
    const end = point.lastIndexOf('!') + 1;
    const match = /^(?:R(\[[+-]?\d+\]|\d*)(?:C(\[[+-]?\d+\]|\d*))?|C(\[[+-]?\d+\]|\d*))$/i.exec(point.slice(end).trim());
    if (!match) return undefined;
    const row = axis(match[1], position?.row, MAX_ROW), column = axis(match[2] ?? match[3], position?.column, MAX_COLUMN);
    const address = (column ? columnIndexToName(column) : '') + (row || '');
    addresses.push(point.slice(0, end) + address + (points.length === 1 && (!row || !column) ? ':' + address : ''));
  }
  return addresses.join(':') + (spill ? '#' : '');
}

function atOffset(range: Reference, r: number, c: number): Reference {
  const row = range.firstRow + r, column = range.firstColumn + c;
  return { sheet: range.sheet, firstRow: row, lastRow: row, firstColumn: column, lastColumn: column };
}

function lookupShape(source: LookupArea): Pick<FormulaArray, 'rows' | 'columns'> {
  return 'occupied' in source ? source : {
    rows: source.lastRow - source.firstRow + 1, columns: source.lastColumn - source.firstColumn + 1
  };
}

function arrayLookupKeys(array: FormulaArray): VisitLookupKeys {
  const read = (position?: number) => captureError(() => array.read(position));
  let gap: RangeValue | undefined;
  const readGap = () => gap === undefined ? (gap = read()) : gap;
  let remaining = MAX_DENSE_ARRAY_SCAN;
  return (first, last, reverse, visit) => {
    const step = reverse ? -1 : 1;
    let next = reverse ? last : first;
    if (array.dense) {
      for (; next >= first && next <= last; next += step) {
        if (--remaining < 0) throw new FormulaCalculationLimit('Dense lookup array exceeds the preview scan limit.');
        if (visit(read(next), next) === false) return;
      }
      return;
    }
    const occupied = mergeOccupiedPositions(array.occupied);
    const positions = reverse ? [...occupied].reverse() : occupied;
    for (const position of positions) {
      if (reverse ? position > last : position < first) continue;
      if (reverse ? position < first : position > last) break;
      // Equal unstored values cannot improve a match after the first position in their gap.
      if (position !== next && visit(readGap(), next) === false) return;
      if (visit(read(position), position) === false) return;
      next = position + step;
    }
    if (next >= first && next <= last) visit(readGap(), next);
  };
}

function findArrayLookup(array: FormulaArray, key: Scalar, match: number, search: number, lastExact = false): number | undefined {
  const length = array.rows * array.columns, visitKeys = arrayLookupKeys(array);
  if (key === null) {
    let blank: number | undefined;
    visitKeys(0, length - 1, search === -1, (value, index) => {
      if (value === null) { blank = index; return false; }
    });
    return blank;
  }
  return findLookupIndex(key, length, visitKeys, match, search, lastExact);
}

function sheetName(token: string): string {
  if (token.startsWith("'")) {
    const name = token.slice(1, -1).replace(/''/g, "'");
    if (name && !/[:[\]]/.test(name)) return name;
  } else if (formulaName.test(token)) return token;
  throw new Error('Unsupported sheet reference.');
}

function relativeCoordinate(value: number, origin: number, limit: number): number {
  // Named formula coordinates are serialized relative to A1 and wrap at the grid boundary.
  return (value + origin - 2) % limit + 1;
}

export function isLambda(value: unknown): value is FormulaLambda {
  return value !== null && typeof value === 'object' && 'invoke' in value;
}

function scalar(value: Value): Scalar {
  if (isLambda(value)) throw new FormulaError('#CALC!');
  if (isArray(value)) {
    if (value.implicitFirst || (value.rows === 1 && value.columns === 1)) return value.read(0);
    throw new Error('Range cannot be used as a scalar.');
  }
  if (value === undefined) throw new Error('Range cannot be used as a scalar.');
  return value;
}

function isArray(value: unknown): value is FormulaArray {
  return value !== null && typeof value === 'object' && 'occupied' in value;
}

function asArray(value: Scalar | FormulaArray | FormulaError): FormulaArray {
  if (value instanceof FormulaError) return { rows: 1, columns: 1, occupied: [], read: () => { throw value; } };
  return isArray(value) ? value : { rows: 1, columns: 1, occupied: [], read: () => value };
}

function blankToZero(array: FormulaArray, position?: number): Scalar {
  return array.read(position) ?? 0;
}

function checkType(name: string, input: RangeValue): boolean {
  const value = typeof input === 'number' && !Number.isFinite(input) ? new FormulaError('#NUM!') : input;
  switch (name) {
    case 'ISBLANK': return value === null;
    case 'ISLOGICAL': return typeof value === 'boolean';
    case 'ISNUMBER': return typeof value === 'number';
    case 'ISTEXT': return typeof value === 'string';
    case 'ISNONTEXT': return typeof value !== 'string';
    case 'ISNA': return value instanceof FormulaError && value.message.toUpperCase() === '#N/A';
    case 'ISERR': return value instanceof FormulaError && value.message.toUpperCase() !== '#N/A';
    default: return value instanceof FormulaError;
  }
}

function bindingName(name: string): string {
  return name.replace(/^_xlpm\./i, '').toLowerCase();
}

function validBindingName(name: string): boolean {
  if (!formulaName.test(name) || name.length > 255 || /^(?:r|c|r\d*c\d*|true|false)$/i.test(name)) return false;
  const address = cellRef.test(name) ? parseCellRef(name.toUpperCase()) : undefined;
  return !address || address.row > MAX_ROW || address.column > MAX_COLUMN;
}

function memoizeArrayPosition(array: FormulaArray): FormulaArray {
  let previousPosition: number | undefined;
  let value: RangeValue | undefined;
  return { ...array, read(position) {
    if (value === undefined || previousPosition !== position) {
      value = captureError(() => array.read(position));
      previousPosition = position;
    }
    if (value instanceof FormulaError) throw value;
    return value;
  } };
}

function visitFormulaArray(array: FormulaArray, visit: (value: RangeValue, count: number) => void): void {
  const size = array.rows * array.columns;
  let next = 0, gap: RangeValue | undefined;
  const addGap = (count: number) => {
    if (!count) return;
    if (gap === undefined) gap = captureError(() => array.read());
    visit(gap, count);
  };
  const positions = array.dense ? generatedArrayPositions(size) : mergeOccupiedPositions(array.occupied);
  for (const position of positions) {
    addGap(position - next);
    visit(captureError(() => array.read(position)), 1);
    next = position + 1;
  }
  addGap(size - next);
}

function* occupiedAxis(array: FormulaArray, byRow: boolean): Iterable<number> {
  const positions = mergeOccupiedPositions(array.occupied);
  if (!byRow) {
    const columns = new Set<number>();
    for (const position of positions) columns.add(position % array.columns);
    yield* [...columns].sort((a, b) => a - b);
    return;
  }
  let previous = -1;
  for (const position of positions) {
    const row = Math.floor(position / array.columns);
    if (row !== previous) yield previous = row;
  }
}

function readTextDelimiters(delimiter: Scalar | FormulaArray): Set<string> {
  const delimiters = new Set<string>();
  let length = 0;
  const add = (value: RangeValue) => {
    if (value instanceof FormulaError) throw value;
    const literal = text(value);
    if (delimiters.has(literal)) return;
    length += literal.length;
    if (length > MAX_TEXT_LENGTH) throw new FormulaCalculationLimit('Text delimiter list exceeds the preview limit.');
    delimiters.add(literal);
  };
  if (isArray(delimiter)) visitFormulaArray(delimiter, add);
  else add(delimiter);
  return delimiters;
}

function reverseText(value: string): string { return [...value].reverse().join(''); }

function textDelimiterPattern(delimiters: Set<string>, insensitive: boolean, backwards = false): RegExp {
  const pattern = [...delimiters].sort((a, b) => b.length - a.length)
    .map(value => (backwards ? reverseText(value) : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(pattern, insensitive ? 'giu' : 'gu');
}

function sortOrder(value: number): 1 | -1 {
  if (value !== 1 && value !== -1) throw new FormulaError('#VALUE!');
  return value;
}

function sortFormulaArray(source: FormulaArray, byRow: boolean, inputs: readonly SortKey[]): FormulaArray {
  const count = byRow ? source.rows : source.columns;
  const occupied = new Set<number>();
  let denseBudget = MAX_DENSE_ARRAY_SCAN;
  const keys = inputs.map(({ array, order }) => {
    if (array.dense && (denseBudget -= count) < 0) throw new FormulaCalculationLimit('Dense sort keys exceed the preview scan limit.');
    const values = new Map<number, RangeValue>();
    const positions = array.dense ? generatedArrayPositions(count) : mergeOccupiedPositions(array.occupied);
    for (const index of positions) {
      const value = captureError(() => array.read(index));
      values.set(index, value);
      occupied.add(index);
    }
    const gap = values.size < count ? captureError(() => array.read()) : null;
    return { values, gap, order };
  });
  const compareValues = formulaSortComparator();
  const compare = (left?: number, right?: number): number => {
    for (const { values, gap, order } of keys) {
      const leftValue = left === undefined ? undefined : values.get(left);
      const rightValue = right === undefined ? undefined : values.get(right);
      const a = leftValue === undefined ? gap : leftValue, b = rightValue === undefined ? gap : rightValue;
      const sign = compareValues(a, b, order);
      if (sign) return sign;
    }
    return 0;
  };
  const ordered: number[] = [];
  let leading = 0;
  for (const position of occupied) {
    const sign = occupied.size === count ? 1 : compare(position);
    if (sign) ordered.push(position);
    if (sign < 0) leading++;
  }
  ordered.sort((a, b) => compare(a, b) || a - b);
  return mapFormulaArray(reorderArray(source, byRow, ordered, leading), blankToZero);
}

function elementwise(values: Value[], evaluate: (read: (index: number) => Scalar) => Scalar): Value {
  const arrays = values.filter(isArray);
  if (!arrays.length) return evaluate(index => scalar(values[index]));
  let rows = 1, columns = 1;
  for (const array of arrays) {
    rows = Math.max(rows, array.rows);
    columns = Math.max(columns, array.columns);
  }
  const inputs = arrays.some(array => array.rows !== rows || array.columns !== columns)
    ? values.map(value => isArray(value) ? expandFormulaArray(value, rows, columns) : value) : values;
  const expanded = inputs === values ? arrays : inputs.filter(isArray);
  const dense = expanded.some(array => array.dense);
  return {
    rows, columns, dense,
    zeroForBlanks: arrays.some(array => array.zeroForBlanks && (rows * columns === 1 || array.rows * array.columns > 1)),
    implicitFirst: arrays.every(array => array.implicitFirst),
    read: position => evaluate(index => {
      const value = inputs[index];
      return isArray(value) ? value.read(position) : scalar(value);
    }),
    occupied: dense ? [] : [...new Set(expanded.flatMap(array => array.occupied))],
    slice: expanded.some(array => array.slice) ? (row, column, rows, columns) => elementwise(inputs.map(value =>
      isArray(value) ? sliceArray(value, row, column, rows, columns) : value), evaluate) as FormulaArray : undefined
  };
}

function aggregateValues(name: string, feed: (add: (value: RangeValue, fromReference: boolean, weight?: number) => void) => void): Scalar {
  let sum = 0, product = 1, count = 0, min = Infinity, max = -Infinity, length = 0;
  let anyTrue = false, anyFalse = false;
  const strings: string[] = [];
  const add = (value: Scalar | FormulaError, fromReference: boolean, weight = 1) => {
    if (value === null) return;
    if (name === 'COUNTA') { count += weight; return; }
    if (value instanceof FormulaError) {
      if (name === 'COUNT' && fromReference) return;
      throw value;
    }
    if (name === 'AND' || name === 'OR') {
      if (fromReference && typeof value === 'string') return;
      if (logical(value)) anyTrue = true;
      else anyFalse = true;
      return;
    }
    if (name === 'CONCAT') {
      const piece = text(value);
      length += piece.length * weight;
      checkTextLength(length);
      if (piece) strings.push(weight === 1 ? piece : piece.repeat(weight));
      return;
    }
    if (typeof value !== 'number' && fromReference) return;
    if (name === 'COUNT' && typeof value === 'string' && !numericText(value)) return;
    const n = typeof value === 'number' ? value : number(value);
    count += weight;
    if (name === 'SUM' || name === 'AVERAGE') sum += n * weight;
    else if (name === 'PRODUCT') product *= n ** weight;
    else if (name === 'MIN') min = Math.min(min, n);
    else if (name === 'MAX') max = Math.max(max, n);
  };
  feed(add);
  switch (name) {
    case 'COUNT': case 'COUNTA': return count;
    case 'PRODUCT': return count ? product : 0;
    case 'MIN': return count ? min : 0;
    case 'MAX': return count ? max : 0;
    case 'CONCAT': return strings.join('');
    case 'AND': case 'OR':
      if (!anyTrue && !anyFalse) throw new FormulaError('#VALUE!');
      return name === 'AND' ? !anyFalse : anyTrue;
    case 'AVERAGE':
      if (!count) throw new FormulaError('#DIV/0!');
      return sum / count;
    default: return sum;
  }
}

function numericSummary(mode: number, ignoreErrors = false) {
  let count = 0, sum = 0, product = 1, min = Infinity, max = -Infinity, mean = 0, deviation = 0;
  const values = mode >= 12 ? [] as number[] : undefined;
  const gaps = values ? new Map<number, number>() : undefined;
  let readRank: ((rank: number) => number) | undefined;
  const rankValue = (rank: number) => {
    readRank ??= weightedRankReader(values!.sort((a, b) => a - b), gaps!);
    return readRank(rank);
  };
  return {
    add(value: RangeValue, weight = 1) {
      if (value === null) return;
      if (typeof value === 'number' && !Number.isFinite(value)) value = new FormulaError('#NUM!');
      if (value instanceof FormulaError) {
        if (ignoreErrors || mode === 2) return;
        if (mode !== 3) throw value;
      }
      if (mode === 3) { count += weight; return; }
      if (typeof value !== 'number') return;
      count += weight;
      if (values) {
        readRank = undefined;
        if (weight === 1) values.push(value);
        else gaps!.set(value, (gaps!.get(value) ?? 0) + weight);
      } else if (mode === 1 || mode === 9) sum += value * weight;
      else if (mode === 4) max = Math.max(max, value);
      else if (mode === 5) min = Math.min(min, value);
      else if (mode === 6) product *= value ** weight;
      else if (mode >= 7) {
        const delta = value - mean;
        mean += weight === 1 ? delta / count : delta * (weight / count);
        deviation += delta * (value - mean) * weight;
      }
    },
    result(parameter = 0) {
      if (values) return orderedSummary(mode, values, gaps!, count, parameter, rankValue);
      if (mode === 2 || mode === 3) return count;
      if (mode === 4) return count ? max : 0;
      if (mode === 5) return count ? min : 0;
      if (mode === 6) return count ? product : 0;
      if (mode === 9) return sum;
      const sample = mode === 7 || mode === 10;
      if (count <= Number(sample)) throw new FormulaError('#DIV/0!');
      if (mode === 1) return sum / count;
      const variance = Math.max(0, deviation / (count - Number(sample)));
      return mode <= 8 ? Math.sqrt(variance) : variance;
    }
  };
}

function orderedSummary(mode: number, values: number[], gaps: Map<number, number>, count: number, parameter: number,
  at: (rank: number) => number): number {
  if (mode === 13) {
    values.sort((a, b) => a - b);
    let best = Infinity, frequency = 1;
    const consider = (value: number, repeats: number) => {
      if (repeats > 1 && (repeats > frequency || (repeats === frequency && value < best))) {
        best = value;
        frequency = repeats;
      }
    };
    for (let first = 0; first < values.length;) {
      const value = values[first];
      let end = first + 1;
      while (end < values.length && values[end] === value) end++;
      consider(value, end - first + (gaps.get(value) ?? 0));
      gaps.delete(value);
      first = end;
    }
    for (const [value, repeats] of gaps) consider(value, repeats);
    if (frequency === 1) throw new FormulaError('#N/A');
    return best;
  }

  let rank: number;
  if (mode === 14 || mode === 15) {
    const k = Math.floor(parameter);
    rank = k < 1 || k > count ? -1 : mode === 14 ? count - k : k - 1;
  } else {
    const fraction = mode === 12 ? 0.5 : mode === 17 || mode === 19 ? Math.floor(parameter) / 4 : parameter;
    const exclusive = mode >= 18;
    rank = fraction < 0 || fraction > 1 ? -1 : exclusive ? fraction * (count + 1) - 1 : fraction * (count - 1);
  }
  if (!count || !(rank >= 0 && rank <= count - 1)) throw new FormulaError('#NUM!');
  const first = Math.floor(rank), offset = rank - first;
  return offset ? at(first) * (1 - offset) + at(first + 1) * offset : at(first);
}

function numericText(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

const criteriaErrors = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!'];

function formulaCriterion(criterion: Scalar, blankAsZero: boolean): (value: RangeValue) => boolean {
  const source = typeof criterion === 'string' ? criterion : undefined;
  const prefix = source?.match(/^(<>|>=|<=|=|>|<)/)?.[0];
  const operator = prefix ?? '=';
  const operand = source?.slice(prefix?.length ?? 0);
  if (operand === '') {
    // Excel distinguishes a truly blank cell from a formula returning empty text.
    if (!prefix) return value => value === null || value === '';
    if (prefix === '=') return value => value === null;
    if (prefix === '<>') return value => value !== null;
    return () => false;
  }
  const unequal = operator === '<>';
  const boolean = typeof criterion === 'boolean' ? criterion
    : /^true$/i.test(operand ?? '') ? true : /^false$/i.test(operand ?? '') ? false : undefined;
  if (boolean !== undefined) return value => typeof value === 'boolean' ? compareFormulaValues(value, boolean, operator) : unequal;
  const numeric = criterion === null ? 0 : typeof criterion === 'number' ? criterion : operand === undefined ? undefined : criteriaNumber(operand);
  if (numeric !== undefined) return value => {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? criteriaNumber(value)
      : value === null && blankAsZero ? 0 : undefined;
    return n === undefined ? unequal : compareFormulaValues(n, numeric, operator);
  };
  const error = criteriaErrors.indexOf(operand?.toUpperCase() ?? '');
  if (error >= 0) return value => {
    const actual = value instanceof FormulaError ? criteriaErrors.indexOf(value.message.toUpperCase()) : -1;
    return actual < 0 ? unequal : compareFormulaValues(actual, error, operator);
  };
  const text = operand!.toLowerCase();
  if (operator === '=' || unequal) {
    const match = wildcardMatcher(text);
    return value => typeof value === 'string' ? match(value.toLowerCase()) !== unequal : unequal;
  }
  return value => typeof value === 'string' && compareFormulaValues(value, text, operator);
}

function indexCountIfValues(visit: (read: (value: RangeValue, weight: number) => void) => void): (criterion: Scalar) => number {
  const exact = new Map<Scalar, number>(), numericText = new Map<number, number>();
  const errors = new Map<string, { value: FormulaError; weight: number }>();
  visit((value, weight) => {
    if (value instanceof FormulaError) {
      const key = value.message.toUpperCase(), error = errors.get(key);
      if (error) error.weight += weight;
      else errors.set(key, { value, weight });
      return;
    }
    const key = typeof value === 'string' ? value.toLowerCase() : value;
    exact.set(key, (exact.get(key) ?? 0) + weight);
    if (typeof value === 'string') {
      const numeric = criteriaNumber(value);
      if (numeric !== undefined) numericText.set(numeric, (numericText.get(numeric) ?? 0) + weight);
    }
  });
  const numberCount = (value: number) => (exact.get(value) ?? 0) + (numericText.get(value) ?? 0);
  const computed = new Map<string, number>();
  return criterion => {
    if (typeof criterion !== 'string') return typeof criterion === 'boolean' ? exact.get(criterion) ?? 0 : numberCount(criterion ?? 0);
    if (!criterion) return (exact.get(null) ?? 0) + (exact.get('') ?? 0);
    if (criterion === '=') return exact.get(null) ?? 0;
    const literal = criterion.startsWith('=') ? criterion.slice(1) : criterion;
    if (/^true$/i.test(literal)) return exact.get(true) ?? 0;
    if (/^false$/i.test(literal)) return exact.get(false) ?? 0;
    const error = literal.toUpperCase();
    if (criteriaErrors.includes(error)) return errors.get(error)?.weight ?? 0;
    const numeric = criteriaNumber(literal);
    if (numeric !== undefined) return numberCount(numeric);
    if (!/^[<>]|[~*?]/.test(criterion)) return exact.get(literal.toLowerCase()) ?? 0;
    const key = criterion.toLowerCase();
    let total = computed.get(key);
    if (total === undefined) {
      total = 0;
      const matches = formulaCriterion(criterion, false);
      for (const [value, weight] of exact) if (matches(value)) total += weight;
      for (const { value, weight } of errors.values()) if (matches(value)) total += weight;
      computed.set(key, total);
    }
    return total;
  };
}

function criteriaNumber(value: string): number | undefined {
  const text = value.trim(), percent = text.endsWith('%');
  const numeric = percent ? text.slice(0, -1) : text;
  if (!numericText(numeric)) return undefined;
  const number = Number(numeric) / (percent ? 100 : 1);
  return Number.isFinite(number) ? number : undefined;
}

function number(value: Value): number {
  const input = scalar(value);
  if (typeof input !== 'string' || numericText(input)) return Number(input);
  throw new FormulaError('#VALUE!');
}

function excelTruncationInput(value: number): number {
  // Keep integers and short binary fractions exact when applying Excel's 15-digit precision.
  return Number.isInteger(value) || Number.isInteger(value * 2 ** 11) ? value : Number(value.toPrecision(15));
}

function weekendMask(value: Scalar): number {
  if (typeof value === 'string') {
    if (!/^[01]{7}$/.test(value)) throw new FormulaError('#VALUE!');
    let mask = 0;
    for (let i = 0; i < 7; i++) if (value[i] === '1') mask |= 1 << ((i + 1) % 7);
    return mask;
  }
  const code = Math.trunc(number(value ?? 1));
  if (code >= 11 && code <= 17) return 1 << (code - 11);
  if (code < 1 || code > 7 || !Number.isFinite(code)) throw new FormulaError('#NUM!');
  // Two-day weekends start at Saturday/Sunday, then move one day per code.
  return (1 << ((code + 5) % 7)) | (1 << ((code + 6) % 7));
}

function text(value: Scalar): string {
  return value === null ? '' : typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : String(value);
}

function checkTextLength(length: number): void {
  if (length > MAX_TEXT_LENGTH) throw new FormulaError('#VALUE!');
}

function logical(value: Scalar): boolean {
  if (typeof value !== 'string') return Boolean(value);
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  throw new FormulaError('#VALUE!');
}

export function compareFormulaValues(left: Scalar, right: Scalar, operator: string): boolean {
  if (left === null) left = typeof right === 'string' ? '' : typeof right === 'boolean' ? false : 0;
  if (right === null) right = typeof left === 'string' ? '' : typeof left === 'boolean' ? false : 0;
  const order = (value: Scalar) => typeof value === 'boolean' ? 2 : typeof value === 'string' ? 1 : 0;
  if (typeof left === 'string') left = left.toUpperCase();
  if (typeof right === 'string') right = right.toUpperCase();
  const sign = order(left) - order(right) || (left < right ? -1 : left > right ? 1 : 0);
  switch (operator) {
    case '=': return sign === 0;
    case '<>': return sign !== 0;
    case '<': return sign < 0;
    case '>': return sign > 0;
    case '<=': return sign <= 0;
    default: return sign >= 0;
  }
}

function round(name: string, value: number, places: number): number {
  const digits = Math.trunc(places);
  if (!Number.isFinite(value) || !Number.isFinite(digits)) throw new FormulaError('#NUM!');
  if (!value || digits > 308) return value;
  if (digits < -308) return 0;
  const [mantissa, exponent] = Math.abs(value).toExponential().split('e');
  const scaled = Number(mantissa + 'e' + (Number(exponent) + digits));
  if (!Number.isFinite(scaled)) return value;
  const magnitude = name === 'ROUNDUP' ? Math.ceil(scaled) : name === 'ROUNDDOWN' ? Math.floor(scaled) : Math.round(scaled);
  const [rounded, shift] = magnitude.toExponential().split('e');
  return Math.sign(value) * Number(rounded + 'e' + (Number(shift) - digits));
}

function tokenizeFormula(source: string): string[] {
  if (source.length > MAX_FORMULA_LENGTH) throw new Error('Formula exceeds the preview length limit.');
  const formula = source.trim().replace(/^=/, '').trim();
  const tokens: string[] = [];
  const pattern = /\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|\[|#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)|(?:\d+(?:\.(?!:)\d*)?|\.\d+)(?:E[+-]?\d+)?|\$?[A-Z]+\$?\d+(?![\p{L}\p{M}\p{N}_]|\.(?!:))|\$[A-Z]+|\$\d+|[\p{L}_\\](?:[\p{L}\p{M}\p{N}_]|\.(?!:))*|\.:\.?|:\.|<>|<=|>=|[(){};+\-*/^,:!&%=<>#])/iyu;
  while (pattern.lastIndex < formula.length) {
    const match = pattern.exec(formula);
    if (!match) throw new Error('Unsupported formula token.');
    if (match[1] === '[') {
      const start = pattern.lastIndex - 1, end = structuredBracketEnd(formula, start);
      if (end === undefined) throw new Error('Unclosed table reference.');
      tokens.push(formula.slice(start, end));
      pattern.lastIndex = end;
    } else tokens.push(match[1]);
  }
  return tokens;
}

export function containsNestedAggregate(formula: string, includeAggregate: boolean): boolean {
  const pattern = includeAggregate ? /\b(?:SUBTOTAL|AGGREGATE)\s*\(/i : /\bSUBTOTAL\s*\(/i;
  if (!pattern.test(formula)) return false;
  try {
    const tokens = tokenizeFormula(formula);
    return tokens.some((token, index) => {
      if (tokens[index + 1] !== '(') return false;
      const name = token.toUpperCase().replace(/^_XLFN\./, '');
      return name === 'SUBTOTAL' || (includeAggregate && name === 'AGGREGATE');
    });
  } catch {
    return false;
  }
}
