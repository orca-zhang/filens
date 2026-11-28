const xmlReference = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([\da-fA-F]{1,6}));/y;
const xmlCharacters: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodePlainSpreadsheetXmlText(text: string): string | undefined {
  const value = decodePlainXmlText(text);
  return value === undefined ? undefined : decodeSpreadsheetText(value);
}

export function decodePlainXmlText(text: string): string | undefined {
  let next = text.indexOf('&');
  if (next < 0) return text;
  let offset = 0;
  const pieces: string[] = [];
  while (next >= 0) {
    xmlReference.lastIndex = next;
    const match = xmlReference.exec(text);
    if (!match) return undefined;
    const [, named, decimal, hex] = match;
    let character: string;
    if (named) character = xmlCharacters[named];
    else {
      const point = decimal !== undefined ? Number(decimal) : parseInt(hex, 16);
      if ((point < 32 && point !== 9 && point !== 10 && point !== 13) || point > 0x10FFFF
        || (point >= 0xD800 && point <= 0xDFFF) || point === 0xFFFE || point === 0xFFFF) return undefined;
      character = String.fromCodePoint(point);
    }
    pieces.push(text.slice(offset, next), character);
    offset = xmlReference.lastIndex;
    next = text.indexOf('&', offset);
  }
  pieces.push(text.slice(offset));
  return pieces.join('');
}

export function decodeSpreadsheetText(value: string): string {
  // One pass preserves literal escapes written with the _x005F_ prefix.
  return value.includes('_x') ? value.replace(/_x([\da-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : value;
}

export function readPath(source: unknown, path: readonly string[]): unknown {
  for (const part of path) {
    if (!source || typeof source !== 'object') return undefined;
    source = (source as Record<string, unknown>)[part];
  }
  return source;
}

export function readLocalPath(value: unknown, segments: readonly string[]): unknown {
  for (const segment of segments) {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const key = Object.keys(record).find(key => key.split(':').pop() === segment);
    value = key ? record[key] : undefined;
  }
  return value;
}

export function toArray<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
