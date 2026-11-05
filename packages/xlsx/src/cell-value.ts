import type { ParsedCell, ParsedSheet } from './types';
import { WorksheetCellIndex } from './cell-index';
import { parseCellRef } from './columns';

export function resolveCellValue(sheet: ParsedSheet, cell: ParsedCell, resolving?: Set<string>): string {
  if (!cell.formula || !cell.needsCalculation) {
    return cell.value;
  }
  resolving ??= new Set<string>();
  if (resolving.has(cell.ref)) {
    return `=${cell.formula}`;
  }

  resolving.add(cell.ref);
  try {
    const readNumber = (cell: ParsedCell | undefined) => readFormulaCellNumber(sheet, cell, resolving);
    const result = new FormulaReader(cell.formula,
      (row, column) => readNumber(formulaCellIndex(sheet).get(row, column)),
      (firstRow, lastRow, firstColumn, lastColumn, visit) => {
        formulaCellIndex(sheet).forEachInRange(firstRow, lastRow, firstColumn, lastColumn,
          cell => visit(readNumber(cell)));
      }).read();
    cell.value = String(result);
  } catch {
    // ponytail: unsupported Excel functions stay visible as formulas; add a full engine only when preview parity requires it.
    cell.value = `=${cell.formula}`;
  } finally {
    resolving.delete(cell.ref);
    cell.needsCalculation = false;
  }
  return cell.value;
}

const formulaCellIndexes = new WeakMap<ParsedSheet, WorksheetCellIndex>();

function formulaCellIndex(sheet: ParsedSheet): WorksheetCellIndex {
  let cells = formulaCellIndexes.get(sheet);
  if (!cells) {
    cells = new WorksheetCellIndex(sheet);
    formulaCellIndexes.set(sheet, cells);
  }
  return cells;
}

function readFormulaCellNumber(sheet: ParsedSheet, cell: ParsedCell | undefined, resolving: Set<string>): number {
  if (!cell) {
    return 0;
  }
  const value = (cell.needsCalculation ? resolveCellValue(sheet, cell, resolving) : cell.value).trim();
  if (value === '') {
    return 0;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    return number;
  }
  const boolean = value.toUpperCase();
  if (boolean === 'TRUE') {
    return 1;
  }
  if (boolean === 'FALSE') {
    return 0;
  }
  throw new Error('Formula reference is not numeric.');
}

class FormulaReader {
  private readonly tokens: string[];
  private index = 0;

  constructor(formula: string, private readonly readCell: (row: number, column: number) => number,
    private readonly visitCells: (firstRow: number, lastRow: number, firstColumn: number, lastColumn: number,
      visit: (value: number) => void) => void) {
    this.tokens = tokenizeFormula(formula.replace(/^=/, '').trim());
  }

  read(): number {
    const value = this.readExpression();
    if (this.index !== this.tokens.length || value === undefined || !Number.isFinite(value)) {
      throw new Error('Unsupported formula.');
    }
    return value;
  }

  private readExpression(): FormulaValue {
    let value = this.readTerm();
    while (this.peek() === '+' || this.peek() === '-') {
      const operator = this.take();
      const right = this.readTerm();
      value = operator === '+' ? scalar(value) + scalar(right) : scalar(value) - scalar(right);
    }
    return value;
  }

  private readTerm(): FormulaValue {
    let value = this.readPower();
    while (this.peek() === '*' || this.peek() === '/') {
      const operator = this.take();
      const right = this.readPower();
      value = operator === '*' ? scalar(value) * scalar(right) : scalar(value) / scalar(right);
    }
    return value;
  }

  private readPower(): FormulaValue {
    let value = this.readUnary();
    if (this.peek() === '^') {
      this.take();
      value = scalar(value) ** scalar(this.readPower());
    }
    return value;
  }

  private readUnary(): FormulaValue {
    if (this.peek() === '+' || this.peek() === '-') {
      return (this.take() === '-' ? -1 : 1) * scalar(this.readUnary());
    }
    return this.readPrimary();
  }

  private readPrimary(): FormulaValue {
    const token = this.take();
    if (token === '(') {
      const value = this.readExpression();
      this.expect(')');
      return value;
    }
    if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(token)) {
      return Number(token);
    }
    if (/^\$?[A-Z]+\$?\d+$/i.test(token)) {
      if (this.peek() !== ':') {
        const position = parseCellRef(token.replace(/\$/g, ''));
        return this.readCell(position.row, position.column);
      }
      this.take();
      // Outside a complete SUM argument, a range is not a scalar. Still read
      // its values now so dependency evaluation and errors keep their order.
      this.readRange(token, this.take(), () => {});
      return undefined;
    }
    if (/^[A-Z][A-Z0-9_.]*$/i.test(token)) {
      if (token.toUpperCase() === 'TRUE') {
        return 1;
      }
      if (token.toUpperCase() === 'FALSE') {
        return 0;
      }
      if (token.toUpperCase() !== 'SUM') {
        throw new Error('Unsupported function.');
      }
      this.expect('(');
      let sum = 0;
      if (this.peek() !== ')') {
        do {
          const range = this.sumRangeArgument();
          if (range) {
            // Add each cell to the existing accumulator. Summing a range
            // separately would change floating point order across arguments.
            this.readRange(range[0], range[1], value => { sum += value; });
          } else {
            sum += scalar(this.readExpression());
          }
        } while (this.peek() === ',' && Boolean(this.take()));
      }
      this.expect(')');
      return sum;
    }
    throw new Error('Unsupported formula token.');
  }

  /** Recognize only a complete range argument, with optional parentheses.
   * Range arithmetic and malformed expressions retain the general parser's
   * eager evaluation and error behavior. Lookahead does not read any cells. */
  private sumRangeArgument(): [string, string] | undefined {
    let at = this.index, parentheses = 0;
    while (this.tokens[at] === '(') { at++; parentheses++; }
    const first = this.tokens[at], last = this.tokens[at + 2];
    if (this.tokens[at + 1] !== ':' || !/^\$?[A-Z]+\$?\d+$/i.test(first ?? '') ||
      !/^\$?[A-Z]+\$?\d+$/i.test(last ?? '')) return undefined;
    at += 3;
    while (parentheses-- > 0) if (this.tokens[at++] !== ')') return undefined;
    if (this.tokens[at] !== ',' && this.tokens[at] !== ')') return undefined;
    this.index = at;
    return [first, last];
  }

  private readRange(firstRef: string, lastRef: string, visit: (value: number) => void): void {
    if (!/^\$?[A-Z]+\$?\d+$/i.test(lastRef)) {
      throw new Error('Invalid range.');
    }
    const first = parseCellRef(firstRef.replace(/\$/g, ''));
    const last = parseCellRef(lastRef.replace(/\$/g, ''));
    this.visitCells(Math.min(first.row, last.row), Math.max(first.row, last.row),
      Math.min(first.column, last.column), Math.max(first.column, last.column), visit);
  }

  private peek(): string {
    return this.tokens[this.index] ?? '';
  }

  private take(): string {
    const token = this.tokens[this.index];
    if (!token) {
      throw new Error('Unexpected end of formula.');
    }
    this.index += 1;
    return token;
  }

  private expect(token: string): void {
    if (this.take() !== token) {
      throw new Error(`Expected ${token}.`);
    }
  }
}

type FormulaValue = number | undefined;

function scalar(value: FormulaValue): number {
  if (value === undefined) {
    throw new Error('Range cannot be used as a scalar.');
  }
  return value;
}

function tokenizeFormula(formula: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s*((?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?|\$?[A-Z]+\$?\d+|[A-Z][A-Z0-9_.]*|[()+\-*/^,:])/iy;
  let offset = 0;
  while (offset < formula.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(formula);
    if (!match) {
      throw new Error('Unsupported formula token.');
    }
    tokens.push(match[1] ?? '');
    offset = pattern.lastIndex;
  }
  return tokens;
}

