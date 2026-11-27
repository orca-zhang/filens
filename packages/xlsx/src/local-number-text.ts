const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function readLocale(language?: string) {
  const formatter = new Intl.NumberFormat(language);
  const parts = formatter.formatToParts(-123456789.5);
  const integers = parts.filter(part => part.type === 'integer').map(part => [...part.value].length);
  const nativeDigits = new Intl.NumberFormat(language, { useGrouping: false }).format(9876543210);
  const digits = nativeDigits === '9876543210' ? undefined : [...nativeDigits].reverse();
  return {
    language, digits,
    decimal: parts.find(part => part.type === 'decimal')?.value ?? '.',
    group: parts.find(part => part.type === 'group')?.value ?? '',
    minus: parts.find(part => part.type === 'minusSign')?.value ?? '-',
    lastGroup: integers.at(-1) ?? 3,
    middleGroup: integers.at(-2) ?? 3
  };
}

let current: ReturnType<typeof readLocale> | undefined;

export function readNumberText(input: string | number, explicit: boolean, decimal?: string, group?: string): number | undefined {
  const language = globalThis.navigator?.language;
  if (!current || current.language !== language) current = readLocale(language);
  const locale = current;
  decimal = decimal === undefined ? locale.decimal : Array.from(decimal)[0] ?? '';
  group = group === undefined ? (decimal === locale.group ? '' : locale.group) : Array.from(group)[0] ?? '';
  if (!decimal || decimal === group) return;
  if (typeof input === 'number') return Number.isFinite(input) ? input : undefined;

  let value = input.replace(/[\u061c\u200e\u200f]/g, '');
  if (locale.minus !== '-') value = value.split(locale.minus).join('-');
  const digits = locale.digits;
  if (digits) {
    value = Array.from(value, char => {
      const digit = digits.indexOf(char);
      return digit < 0 ? char : String(digit);
    }).join('');
  }
  if (explicit) {
    value = value.replace(/\s+/g, '');
    if (!value) return 0;
  } else {
    value = value.trim();
    const parenthesized = value.startsWith('(') && value.endsWith(')');
    if (parenthesized) value = value.slice(1, -1).trim();
    value = value.replace(/^([+-]?)\s*\p{Sc}\s*|\s*\p{Sc}$/u, '$1').trim();
    if (parenthesized) value = '-' + value;
    if (group && /^\s$/.test(group)) value = value.replace(/[ \u00a0\u202f]/g, group);
  }
  const percent = /%+$/.exec(value)?.[0].length ?? 0;
  if (percent) value = value.slice(0, -percent).trimEnd();
  const exponent = /[eE]/.test(decimal + group) ? undefined : /[eE]([+-]?\d+)$/.exec(value);
  if (exponent) value = value.slice(0, exponent.index);
  if (decimal !== '.' && group !== '.' && value.includes('.')) return;
  const [integer, fraction, extra] = value.split(decimal);
  if (extra !== undefined || (group && fraction?.includes(group))) return;
  const groups = group ? integer.split(group) : [integer];
  if (!explicit && groups.length > 1) {
    const first = groups[0].replace(/^[+-]/, '');
    const last = groups.at(-1)!;
    if (!first || first.length > locale.middleGroup || last.length !== locale.lastGroup ||
      groups.slice(1, -1).some(part => part.length !== locale.middleGroup) ||
      !/^\d+$/.test(first) || !groups.slice(1).every(part => /^\d+$/.test(part))) return;
  }
  const normalized = groups.join('') + (fraction === undefined ? '' : '.' + fraction);
  if (!numeric.test(normalized)) return;
  // Combine the exponent and percent before conversion to avoid intermediate overflow.
  const number = exponent || percent ? Number(`${normalized}e${Number(exponent?.[1] ?? 0) - percent * 2}`) : Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}
