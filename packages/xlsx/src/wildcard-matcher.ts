const wildcardSyntax = /[*?]|~[~*?]/;

export function wildcardMatcher(pattern: string, substring = false): (input: string) => boolean {
  if (!wildcardSyntax.test(pattern)) return substring ? input => input.includes(pattern) : input => input === pattern;
  const { initial, accept, advance } = wildcardStates(pattern.match(/~[~*?]|./gsu) ?? [], substring);
  return input => {
    let active = initial;
    for (const char of input) {
      if (substring && (active & accept)) return true;
      active = advance(active, char);
      if (!active) return false;
    }
    return (active & accept) !== 0n;
  };
}

export function wildcardSearch(pattern: string, input: string): number {
  if (!/[*?~]/.test(pattern) && /^[\x00-\x7f]*$/.test(pattern) && /^[\x00-\x7f]*$/.test(input)) {
    return input.toLowerCase().indexOf(pattern.toLowerCase());
  }
  // SEARCH escapes any following code unit and ignores a trailing escape.
  const tokens = pattern.match(/~[\s\S]|[^~]/g) ?? [];
  const { initial, accept, advance } = wildcardStates(tokens.reverse(), true, foldSearchUnit);
  if (initial & accept) return 0;
  // Reverse the scan so an accepting state gives the start of a match.
  let active = initial, first = -1;
  for (let index = input.length - 1; index >= 0; index--) {
    active = advance(active, foldSearchUnit(input[index]));
    if (active & accept) first = index;
  }
  return first;
}

function foldSearchUnit(unit: string): string {
  const upper = unit.toUpperCase();
  return (upper.length === 1 ? upper : unit).toLowerCase();
}

function wildcardStates(tokens: string[], substring: boolean, fold?: (literal: string) => string) {
  const literals = new Map<string, bigint>();
  let stars = 0n, wildcards = 0n, state = 1n, previousStar = false;
  for (const token of tokens) {
    if (token === '*') {
      if (previousStar) continue;
      stars |= state;
    } else if (token === '?') wildcards |= state;
    else {
      const unescaped = token.startsWith('~') && token.length === 2 ? token[1] : token;
      const literal = fold ? fold(unescaped) : unescaped;
      literals.set(literal, (literals.get(literal) ?? 0n) | state);
    }
    previousStar = token === '*';
    state <<= 1n;
  }
  const accept = state, restart = substring ? 1n : 0n;
  return {
    accept,
    initial: 1n | ((1n & stars) << 1n),
    advance(active: bigint, char: string): bigint {
      const matches = wildcards | (literals.get(char) ?? 0n);
      const next = ((active & matches) << 1n) | (active & stars) | restart;
      return next | ((next & stars) << 1n);
    }
  };
}
