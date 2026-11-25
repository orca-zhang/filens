export function wildcardMatcher(pattern: string, substring = false): (input: string) => boolean {
  if (!/[*?]|~[~*?]/.test(pattern)) return substring ? input => input.includes(pattern) : input => input === pattern;
  const literals = new Map<string, bigint>();
  let stars = 0n, wildcards = 0n, state = 1n, previousStar = false;
  const tokens = Array.from(pattern);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '*') {
      if (previousStar) continue;
      stars |= state;
    } else if (token === '?') wildcards |= state;
    else {
      const literal = token === '~' && /[*?~]/.test(tokens[i + 1] ?? '') ? tokens[++i] : token;
      literals.set(literal, (literals.get(literal) ?? 0n) | state);
    }
    previousStar = token === '*';
    state <<= 1n;
  }
  const accept = state, restart = substring ? 1n : 0n;
  return input => {
    // Advance all wildcard states together, restarting only for substring searches.
    let active = 1n | ((1n & stars) << 1n);
    for (const char of input) {
      if (substring && (active & accept)) return true;
      const matches = wildcards | (literals.get(char) ?? 0n);
      const next = ((active & matches) << 1n) | (active & stars) | restart;
      active = next | ((next & stars) << 1n);
      if (!active) return false;
    }
    return (active & accept) !== 0n;
  };
}
