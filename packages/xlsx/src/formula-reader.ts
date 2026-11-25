import { columnNameToIndex, parseCellRef } from './columns';

export const MAX_FORMULA_LENGTH = 8192;
const MAX_NESTING = 128;
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;
const cellRef = /^(\$?)[A-Z]{1,3}(\$?)[1-9]\d*$/i;
const columnRef = /^\$?[A-Z]{1,3}$/i;
const rowRef = /^\$?[1-9]\d*$/;
const numberToken = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
export const formulaName = /^[\p{L}_\\][\p{L}\p{M}\p{N}_.]*$/u;
const aggregateNames = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'AND', 'OR', 'CONCAT']);
const scalarNames = new Set(['ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'LEN', 'NOT', 'CONCATENATE']);

export type Scalar = number | string | boolean | null;
type Value = Scalar | undefined;

export interface Reference {
  sheet?: string;
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

interface ReferenceValue {
  areas: readonly Reference[];
  isRange: boolean;
}

interface NameReference {
  name: string;
  sheet?: string | null;
  invalidAddress?: boolean;
}

export type FormulaOperand = Scalar | ReferenceValue;

export interface DefinitionOrigin {
  sheet: string;
  currentSheet: string;
  row: number;
  column: number;
}

function isReference(value: FormulaOperand): value is ReferenceValue {
  return value !== null && typeof value === 'object';
}

export class FormulaError extends Error {}

export class FormulaReader {
  private readonly tokens: string[];
  private index = 0;
  private end: number;
  private depth = 0;

  constructor(formula: string, private readonly readCell: (ref: Reference) => Scalar,
    private readonly visitCells: (ref: Reference, visit: (value: Scalar | FormulaError) => void) => void,
    private readonly lookupName?: (name: string, sheet?: string | null) => FormulaOperand | undefined,
    private readonly origin?: DefinitionOrigin) {
    this.tokens = tokenizeFormula(formula);
    this.end = this.tokens.length;
  }

  read(): Scalar {
    const value = scalar(this.expression());
    if (this.index !== this.end || (typeof value === 'number' && !Number.isFinite(value))) {
      throw new Error('Unsupported formula.');
    }
    return value;
  }

  readDefinition(): FormulaOperand {
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
    if (first === undefined) return this.read();
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
      value = compareFormulaValues(scalar(value), scalar(right), operator);
    }
    return value;
  }

  private concatenate(): Value {
    let value = this.add();
    while (this.peek() === '&') {
      this.take();
      const right = this.add();
      value = text(scalar(value)) + text(scalar(right));
      checkTextLength(value);
    }
    return value;
  }

  private add(): Value {
    let value = this.multiply();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.take();
      const right = this.multiply();
      value = operator === '+' ? number(value) + number(right) : number(value) - number(right);
    }
    return value;
  }

  private multiply(): Value {
    let value = this.power();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.take();
      const right = this.power();
      const left = number(value), divisor = number(right);
      if (operator === '/' && divisor === 0) throw new FormulaError('#DIV/0!');
      value = operator === '*' ? left * divisor : left / divisor;
    }
    return value;
  }

  private power(): Value {
    const value = this.percent();
    if (this.peek() !== '^') return value;
    this.take();
    return number(value) ** number(this.nested(() => this.power()));
  }

  private percent(): Value {
    let value = this.unary();
    while (this.peek() === '%') {
      this.take();
      value = number(value) / 100;
    }
    return value;
  }

  private unary(): Value {
    if (this.peek() !== '+' && this.peek() !== '-') return this.primary();
    const sign = this.take();
    return (sign === '-' ? -1 : 1) * number(this.nested(() => this.unary()));
  }

  private primary(): Value {
    if (this.peek() === '(') {
      this.take();
      const value = this.nested(() => this.expression());
      this.expect(')');
      return value;
    }
    const start = this.index;
    const token = this.take();
    if (formulaName.test(token) && this.peek() === '(') {
      this.take();
      const name = token.toUpperCase().replace(/^_XLFN\./, '');
      return this.nested(() => this.call(name));
    }
    const ref = this.referenceAt(start);
    if (ref) {
      this.index = ref.end;
      const operand = this.referenceValue(ref.target);
      if (!isReference(operand)) return operand;
      if (!operand.isRange) return this.readCell(operand.areas[0]);
      // A bare range is not scalar, but keep its dependency reads on malformed expressions.
      for (const area of operand.areas) this.visitCells(area, value => { if (value instanceof FormulaError) throw value; });
      return undefined;
    }
    if (token.startsWith('"')) return token.slice(1, -1).replace(/""/g, '"');
    if (numberToken.test(token)) return Number(token);
    if (token.toUpperCase() === 'TRUE') return true;
    if (token.toUpperCase() === 'FALSE') return false;
    if (token.startsWith('#')) throw new FormulaError(token.toUpperCase());
    throw new Error('Unsupported formula token.');
  }

  private call(name: string): Scalar {
    if (aggregateNames.has(name)) return this.aggregate(name);
    if (name === 'IF' || name === 'IFERROR') return this.conditional(name);
    if (!scalarNames.has(name)) throw new Error('Unsupported formula function.');
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
      case 'LEN': if (args.length === 1) return text(args[0]).length; break;
      case 'NOT': if (args.length === 1) return !logical(args[0]); break;
      case 'CONCATENATE': {
        if (!args.length) break;
        const value = args.map(text).join('');
        checkTextLength(value);
        return value;
      }
    }
    throw new Error('Unsupported formula function or arguments.');
  }

  private aggregate(name: string): Scalar {
    let sum = 0, count = 0, min = Infinity, max = -Infinity, length = 0;
    let anyTrue = false, anyFalse = false;
    const strings: string[] = [];
    const add = (value: Scalar | FormulaError, fromReference: boolean) => {
      if (value === null) return;
      if (name === 'COUNTA') { count++; return; }
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
        length += piece.length;
        if (length > 32767) throw new FormulaError('#VALUE!');
        if (piece) strings.push(piece);
        return;
      }
      if (typeof value !== 'number' && fromReference) return;
      if (name === 'COUNT' && typeof value === 'string' && !numericText(value)) return;
      const n = typeof value === 'number' ? value : number(value);
      count++;
      if (name === 'SUM' || name === 'AVERAGE') sum += n;
      else if (name === 'MIN') min = Math.min(min, n);
      else if (name === 'MAX') max = Math.max(max, n);
    };
    if (this.peek() !== ')') {
      do {
        const operand = this.referenceArgument();
        if (operand === undefined) add(scalar(this.expression()), false);
        else if (!isReference(operand)) add(operand, false);
        else for (const area of operand.areas) this.visitCells(area, value => add(value, true));
      } while (this.peek() === ',' && this.take());
    }
    this.expect(')');
    switch (name) {
      case 'COUNT': case 'COUNTA': return count;
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

  private conditional(name: string): Scalar {
    const args: [number, number][] = [];
    let start = this.index, depth = 0;
    for (;;) {
      const at = this.index, token = this.take();
      if (depth === 0 && (token === ',' || token === ')')) {
        args.push([start, at]);
        start = at + 1;
        if (token === ')') break;
      } else if (token === '(') depth++;
      else if (token === ')') depth--;
    }
    if (args.some(([first, last]) => first === last)) throw new Error('Missing formula argument.');
    const at = this.index, end = this.end;
    const evaluate = ([first, last]: [number, number]) => {
      this.index = first;
      this.end = last;
      const value = scalar(this.expression());
      if (this.index !== last) throw new Error('Unsupported formula argument.');
      return value;
    };
    try {
      if (name === 'IF' && (args.length === 2 || args.length === 3)) {
        if (logical(evaluate(args[0]))) return evaluate(args[1]);
        return args[2] ? evaluate(args[2]) : false;
      }
      if (name === 'IFERROR' && args.length === 2) {
        try { return evaluate(args[0]); }
        catch (error) {
          if (!(error instanceof FormulaError)) throw error;
          return evaluate(args[1]);
        }
      }
      throw new Error('Invalid conditional arguments.');
    } finally { this.index = at; this.end = end; }
  }

  private referenceArgument(definition = false): FormulaOperand | undefined {
    let at = this.index, parentheses = 0;
    while (this.tokens[at] === '(') { at++; parentheses++; }
    const ref = this.referenceAt(at);
    if (!ref) return undefined;
    at = ref.end;
    while (parentheses-- > 0) if (this.tokens[at++] !== ')') return undefined;
    if (at > this.end || (at === this.end ? !definition : this.tokens[at] !== ',' && this.tokens[at] !== ')')) return undefined;
    this.index = at;
    return this.referenceValue(ref.target);
  }

  private referenceValue(target: ReferenceValue | NameReference): FormulaOperand {
    if (!('name' in target)) return target;
    const value = this.lookupName?.(target.name, target.sheet);
    if (value !== undefined) return value;
    if (target.invalidAddress) throw new FormulaError('#REF!');
    throw new Error('Unsupported formula token.');
  }

  private referenceAt(at: number): { target: ReferenceValue | NameReference; end: number } | undefined {
    if (this.tokens[at] === '[0]' && this.tokens[at + 1] === '!') {
      const name = this.tokens[at + 2] ?? '';
      if (at + 3 <= this.end && formulaName.test(name)) return { target: { name, sheet: null }, end: at + 3 };
      return undefined;
    }
    let sheet: string | undefined;
    if (this.origin && this.tokens[at] === '!') {
      sheet = this.origin.currentSheet;
      at++;
    } else if (this.tokens[at + 1] === '!') {
      sheet = sheetName(this.tokens[at]);
      at += 2;
    }
    const first = this.tokens[at] ?? '';
    const isRange = at + 1 < this.end && this.tokens[at + 1] === ':';
    let end = at + 1, last = first;
    if (isRange) {
      end++;
      if (this.tokens[end + 1] === '!') {
        const secondSheet = sheetName(this.tokens[end]);
        if (!sheet || sheet.toLowerCase() !== secondSheet.toLowerCase()) throw new Error('Unsupported range sheets.');
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
      if (!isRange && formulaName.test(first) && (a.row > MAX_ROW || a.column > MAX_COLUMN)) {
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
    } else if (!isRange && formulaName.test(first) && (sheet !== undefined || !/^(?:TRUE|FALSE)$/i.test(first))) {
      return { target: { name: first, sheet }, end };
    } else return undefined;
    if (this.origin && bounds.sheet === undefined) bounds.sheet = this.origin.sheet;
    return { target: { areas: [bounds], isRange }, end };
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

function scalar(value: Value): Scalar {
  if (value === undefined) throw new Error('Range cannot be used as a scalar.');
  return value;
}

function numericText(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

function number(value: Value): number {
  const input = scalar(value);
  if (typeof input !== 'string' || numericText(input)) return Number(input);
  throw new FormulaError('#VALUE!');
}

function text(value: Scalar): string {
  return value === null ? '' : typeof value === 'boolean' ? value ? 'TRUE' : 'FALSE' : String(value);
}

function checkTextLength(value: string): void {
  if (value.length > 32767) throw new FormulaError('#VALUE!');
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
  const pattern = /\s*("(?:[^"]|"")*"|'(?:[^']|'')*'|\[0\](?=!)|#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|SPILL!|CALC!)|(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|\$?[A-Z]+\$?\d+(?![\p{L}\p{M}\p{N}_.])|\$[A-Z]+|\$\d+|[\p{L}_\\][\p{L}\p{M}\p{N}_.]*|<>|<=|>=|[()+\-*/^,:!&%=<>])/iyu;
  while (pattern.lastIndex < formula.length) {
    const match = pattern.exec(formula);
    if (!match) throw new Error('Unsupported formula token.');
    tokens.push(match[1]);
  }
  return tokens;
}
