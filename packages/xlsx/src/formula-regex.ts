import { FormulaCalculationLimit, FormulaError } from './formula-array';

export type RegexFunction = 'REGEXTEST' | 'REGEXEXTRACT' | 'REGEXREPLACE';
export const regexFormula = /\bREGEX(?:TEST|EXTRACT|REPLACE)\s*\(/i;

interface RegexEngine {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(bytes: number): number;
  free(pointer: number): void;
  reset_budget(): number;
  compile_pattern(pointer: number, length: number, ignoreCase: number): number;
  create_match(code: number): number;
  run_match(code: number, match: number, input: number, length: number, advance: number): number;
  substitute_text(code: number, match: number, input: number, length: number, replacement: number,
    replacementLength: number, output: number, capacity: number, selected: number): number;
  pcre2_get_ovector_pointer_16(match: number): number;
  pcre2_get_ovector_count_16(match: number): number;
  pcre2_match_data_free_16(match: number): void;
  pcre2_code_free_16(code: number): void;
}

const maxText = 32767;
let engine: RegexEngine | undefined;
let preparing: Promise<boolean> | undefined;

export function prepareFormulaRegex(): Promise<boolean> {
  return preparing ??= loadEngine().then(loaded => {
    engine = loaded;
    return true;
  }, () => {
    preparing = undefined;
    return false;
  });
}

async function loadEngine(): Promise<RegexEngine> {
  const embedded = globalThis.document?.getElementById('filens-xlsx-regex');
  const url = embedded ? 'data:application/wasm;base64,' + embedded.textContent
    : new URL('../vendor/pcre2/pcre2.wasm', import.meta.url).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error('XLSX regex engine asset is unavailable.');
  let runtime: RegexEngine;
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
    wasi_snapshot_preview1: { random_get: (pointer: number, length: number) => {
      const bytes = new Uint8Array(runtime.memory.buffer, pointer, length);
      for (let offset = 0; offset < bytes.length; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, offset + 65536));
      return 0;
    } }
  });
  runtime = instance.exports as unknown as RegexEngine;
  runtime._initialize();
  embedded?.remove();
  return runtime;
}

export function runFormulaRegex(operation: RegexFunction, input: string, pattern: string, insensitive: boolean,
  mode: number, replacement = ''): boolean | string | string[] {
  const runtime = engine;
  if (!runtime) throw new FormulaCalculationLimit('XLSX regex engine unavailable.');
  if (Math.max(input.length, pattern.length, replacement.length) > maxText) throw new FormulaError('#VALUE!');
  const allocations: [number, number][] = [];
  let code = 0, match = 0;
  try {
    const expression = put(pattern);
    code = runtime.compile_pattern(expression, pattern.length, Number(insensitive));
    if (!code) throw new FormulaError('#VALUE!');
    match = runtime.create_match(code);
    if (!match || !runtime.reset_budget()) throw new FormulaError('#VALUE!');
    const subject = put(input);
    const find = (advance: boolean) => {
      const count = runtime.run_match(code, match, subject, input.length, Number(advance));
      if (count < -1) throw new FormulaError('#VALUE!');
      return count;
    };
    const offsets = () => new Uint32Array(runtime.memory.buffer, runtime.pcre2_get_ovector_pointer_16(match),
      runtime.pcre2_get_ovector_count_16(match) * 2);
    const extract = (index: number, count: number) => {
      if (index >= count) return '';
      const loc = offsets();
      return loc[index * 2] === 0xffffffff ? '' : input.slice(loc[index * 2], loc[index * 2 + 1]);
    };
    if (operation === 'REGEXTEST') return find(false) >= 0;
    if (operation === 'REGEXEXTRACT') {
      let count = find(false);
      if (count < 0) throw new FormulaError('#N/A');
      if (mode === 0) return extract(0, count);
      if (mode === 2) {
        const groups = runtime.pcre2_get_ovector_count_16(match) - 1;
        if (!groups) return extract(0, count);
        return Array.from({ length: groups }, (_, index) => extract(index + 1, count));
      }
      const matches: string[] = [];
      while (count >= 0) {
        if (matches.length >= 16_384) throw new FormulaError('#SPILL!');
        matches.push(extract(0, count));
        count = find(true);
      }
      return matches;
    }

    const substitute = (selected: boolean) => {
      const replace = put(replacement), output = allocate(maxText + 1);
      const size = runtime.substitute_text(code, match, subject, input.length, replace, replacement.length,
        output, maxText + 1, Number(selected));
      if (size < 0) throw new FormulaError('#VALUE!');
      return String.fromCharCode(...new Uint16Array(runtime.memory.buffer, output, size));
    };
    if (mode === 0) return substitute(false);
    let occurrence = mode;
    if (occurrence < 0) {
      for (let count = find(false); count >= 0; count = find(true)) occurrence++;
      if (occurrence < 0) return input;
      occurrence++;
    }
    for (let count = find(false); count >= 0; count = find(true)) {
      if (--occurrence) continue;
      const [start, end] = offsets();
      const result = input.slice(0, start) + substitute(true) + input.slice(end);
      if (result.length > maxText) throw new FormulaError('#VALUE!');
      return result;
    }
    return input;
  } finally {
    if (match) runtime.pcre2_match_data_free_16(match);
    if (code) runtime.pcre2_code_free_16(code);
    for (const [pointer, bytes] of allocations) {
      new Uint8Array(runtime.memory.buffer, pointer, bytes).fill(0);
      runtime.free(pointer);
    }
  }

  function allocate(length: number): number {
    const bytes = length * 2, pointer = runtime!.malloc(bytes);
    if (!pointer) throw new FormulaError('#VALUE!');
    allocations.push([pointer, bytes]);
    return pointer;
  }

  function put(value: string): number {
    const pointer = allocate(value.length + 1);
    const units = new Uint16Array(runtime!.memory.buffer, pointer, value.length);
    // Preserve UTF-16 offsets while replacing invalid surrogate code units before PCRE2's unchecked match.
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff && (value.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
        units[index] = unit;
        units[++index] = value.charCodeAt(index);
      } else units[index] = unit >= 0xd800 && unit <= 0xdfff ? 0xfffd : unit;
    }
    return pointer;
  }
}
