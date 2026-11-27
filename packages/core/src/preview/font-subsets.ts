import type { PreviewFontAsset, PreviewFontAssetSource, PreviewFontReference } from './types';

export interface FontsourceSubsetIndex {
  packageId: string;
  sources: readonly PreviewFontAssetSource[];
  requiresSvg?: boolean;
}

export const fontsourceSubsetIndexes = new WeakMap<PreviewFontAsset, FontsourceSubsetIndex>();

interface FontsourceSubset {
  name: string;
  unicodeRange: string;
  coverage: NonNullable<PreviewFontAsset['coverage']>;
}

// Fontsource puts the more specific rule last, matching @font-face source order.
export function parseFontsourceSubsets(bytes: ArrayBuffer): FontsourceSubset[] {
  const manifest: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid font subset index.');
  const entries = Object.entries(manifest);
  if (!entries.length || entries.length > 160) throw new Error('Invalid font subset count.');
  return entries.reverse().map(([key, unicodeRange]) => {
    const name = /^\[(\d{1,3})\]$/.exec(key)?.[1] ?? key;
    if (!/^(?:\d{1,3}|[a-z][a-z0-9-]{0,31})$/.test(name) || typeof unicodeRange !== 'string' || !unicodeRange) {
      throw new Error('Invalid font subset entry.');
    }
    const coverage = unicodeRange.split(',').map(range => {
      const match = /^U\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(range.trim());
      if (!match) throw new Error('Invalid font subset range.');
      const start = parseInt(match[1], 16), end = parseInt(match[2] ?? match[1], 16);
      if (end < start || end > 0x10ffff) throw new Error('Invalid font subset range.');
      return [start, end] as const;
    });
    return { name, unicodeRange, coverage };
  });
}

export function fontSubsetPoints(reference: PreviewFontReference): Set<number> | undefined {
  const text = reference.text;
  if (!reference.textComplete || !text || text.length > 4096) return undefined;
  // A cmap range cannot prove that a shard has the composed glyph or ligature.
  if (/[\p{Mark}\p{Format}\p{Emoji_Modifier}\p{Regional_Indicator}\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u.test(text)) return undefined;
  const points = new Set<number>();
  for (const character of text) {
    if (!/[\p{White_Space}\p{Control}]/u.test(character)) points.add(character.codePointAt(0)!);
  }
  return points.size ? points : undefined;
}

export function selectFontsourceSubsets(index: ReturnType<typeof parseFontsourceSubsets>, points: ReadonlySet<number>) {
  const selected = new Set<FontsourceSubset>();
  for (const point of points) {
    const subset = index.find(entry => entry.coverage.some(([start, end]) => start <= point && point <= end));
    if (!subset) return undefined;
    selected.add(subset);
    // Longer documents can touch many index entries. Use one full face in that case.
    if (selected.size > 6) return undefined;
  }
  // Registration order is @font-face precedence for overlapping ranges.
  return index.filter(entry => selected.has(entry)).reverse();
}
