import type { FormulaError, Scalar } from './formula-reader';
import { wildcardMatcher } from './wildcard-matcher';

type Key = Exclude<Scalar, null>;
type LookupValue = Key | FormulaError | null;
export type VisitLookupKeys = (first: number, last: number, reverse: boolean,
  visit: (value: LookupValue, index: number) => false | void) => void;

const fold = (value: Key): Key => typeof value === 'string' ? value.toUpperCase() : value;
const compare = (left: Key, right: Key): number => left < right ? -1 : left > right ? 1 : 0;

export function indexExactLookup(length: number, visit: VisitLookupKeys, reverse: boolean): (key: Key) => number | undefined {
  const positions = new Map<Key, number>();
  let first = 0, last = length - 1;
  return key => {
    const needle = fold(key);
    if (first > last || positions.has(needle)) return positions.get(needle);
    let found: number | undefined;
    // Reuse the first occurrence in search order, extending the scan only as needed.
    visit(first, last, reverse, (value, position) => {
      if (reverse) last = position - 1;
      else first = position + 1;
      if (typeof value === 'object') return;
      const candidate = fold(value);
      if (!positions.has(candidate)) positions.set(candidate, position);
      if (candidate === needle) { found = position; return false; }
    });
    if (found === undefined) first = length;
    return found;
  };
}

export function findLookupIndex(key: Scalar, length: number, visit: VisitLookupKeys,
  matchMode: number, searchMode: number, lastExact = false): number | undefined {
  if (key === null) return findBlank(length, visit, searchMode === -1);
  const needle = fold(key);
  const pattern = matchMode === 2 && typeof needle === 'string' ? wildcardMatcher(needle) : undefined;
  if (!pattern && Math.abs(searchMode) === 2) return findSorted(needle, length, visit, matchMode, searchMode === 2, lastExact);
  let selected: number | undefined, closest: Key | undefined;
  visit(0, length - 1, searchMode === -1, (value, index) => {
    if (!isKeyType(value, needle)) return;
    const candidate = fold(value);
    const relation = compare(candidate, needle);
    if (pattern ? pattern(candidate as string) : relation === 0) {
      selected = index;
      return false;
    }
    if (relation === matchMode && (closest === undefined || compare(closest, candidate) === matchMode)) {
      closest = candidate;
      selected = index;
    }
  });
  return selected;
}

function isKeyType(value: LookupValue, key: Key): value is Key {
  return typeof value === typeof key;
}

function findBlank(length: number, visit: VisitLookupKeys, reverse: boolean): number | undefined {
  let index = reverse ? length - 1 : 0;
  visit(0, length - 1, reverse, (value, occupied) => {
    if (index !== occupied || value === null) return false;
    index += reverse ? -1 : 1;
  });
  return index >= 0 && index < length ? index : undefined;
}

function findSorted(key: Key, length: number, visit: VisitLookupKeys, matchMode: number,
  ascending: boolean, lastExact: boolean): number | undefined {
  let low = 0, high = length, before: number | undefined, after: number | undefined;
  const direction = ascending ? 1 : -1;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    let index: number | undefined, relation = 0;
    // Seek an occupied, comparable key near the midpoint without materializing gaps.
    visit(mid, high - 1, false, (value, position) => {
      if (!isKeyType(value, key)) return;
      index = position;
      relation = compare(fold(value), key) * direction;
      return false;
    });
    if (index === undefined) high = mid;
    else if (relation === 0 && !lastExact) return index;
    else if (relation <= 0) {
      before = index;
      low = index + 1;
    } else {
      after = index;
      high = mid;
    }
  }
  return matchMode === 0 || matchMode === 2 ? undefined : matchMode === direction ? after : before;
}
