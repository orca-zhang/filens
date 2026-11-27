// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FormulaReader } from '../src/formula-reader';
import { prepareFormulaRegex, runFormulaRegex } from '../src/formula-regex';

beforeAll(async () => {
  const bytes = await readFile(new URL('../vendor/pcre2/pcre2.wasm', import.meta.url));
  vi.stubGlobal('fetch', async () => new Response(bytes));
  try { expect(await prepareFormulaRegex()).toBe(true); }
  finally { vi.unstubAllGlobals(); }
});

describe('XLSX PCRE2 formulas', () => {
  const read = (formula: string) => new FormulaReader(formula, () => null, () => {}).read();

  it.each([
    [String.raw`REGEXTEST("αβ", "^\p{Greek}+$")`, true],
    [String.raw`REGEXTEST("Élise", "(?i)^é")`, true],
    [String.raw`REGEXTEST("😀", "^.$")`, true],
    [String.raw`REGEXTEST("invoice", "^receipt$")`, false],
    [String.raw`REGEXREPLACE("a1 b2 c3", "\d", "!", -2)`, 'a1 b! c3'],
    [String.raw`REGEXREPLACE("a1 b2 c3", "\d", "!", 9)`, 'a1 b2 c3'],
    [String.raw`REGEXREPLACE("alex@example.com", "(?<=.).(?=[^@]*@)", "*")`, 'a***@example.com'],
    [String.raw`REGEXREPLACE("Wow!!!", "([!?])\1+", "$1")`, 'Wow!'],
    [String.raw`REGEXREPLACE("error detected", "(error)", "\U$1")`, 'ERROR detected'],
    [String.raw`REGEXEXTRACT("text A17 B42", "\d+")`, '17'],
    [String.raw`INDEX(REGEXEXTRACT("A17 B42", "\d+", 1), 1, 2)`, '42'],
    [String.raw`INDEX(REGEXEXTRACT("Smith, John", "^(\w+), (\w+)$", 2), 1, 2)`, 'John'],
    [String.raw`COLUMNS(REGEXEXTRACT("😀x", "(?:)", 1))`, 3]
  ])('evaluates %s', (formula, expected) => {
    expect(read(formula)).toBe(expected);
  });

  it('returns an error for invalid syntax, inputs or absent matches', () => {
    expect(() => read('REGEXTEST("a", "(")')).toThrow('#VALUE!');
    expect(() => read('REGEXTEST("x", "x", 3)')).toThrow('#VALUE!');
    expect(() => read('REGEXEXTRACT("none", "digit")')).toThrow('#N/A');
    expect(() => read('REGEXEXTRACT("none", "digit", 3)')).toThrow('#VALUE!');
  });

  it('stops when PCRE2 reaches the work limit and can execute the next formula', () => {
    expect(() => runFormulaRegex('REGEXTEST', 'a'.repeat(4000) + '!', '(*NO_START_OPT)^(a+)+$', false, 0)).toThrow('#VALUE!');
    expect(read('REGEXTEST("after", "^after$")')).toBe(true);
  });
});
