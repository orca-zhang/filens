import type { PreviewFontReference } from '@filens/core';
import { readFontAppearance, readFontReference, type colorReader } from './style-appearance';
import type { ParsedRichText, ParsedRichTextRun } from './types';
import { decodeSpreadsheetText, readPath, toArray } from './xml-values';

export function readTextValue(node: unknown): string {
  if (typeof node === 'string') return node;
  const text = readPath(node, ['#text']);
  return typeof text === 'string' ? text : '';
}

export function createRichTextReader(theme: unknown, color: ReturnType<typeof colorReader>, fonts: PreviewFontReference[]) {
  const faces = new Map(fonts.filter(font => font.fontFamily).map(font => [JSON.stringify(font), font]));
  const read = (item: unknown): string | ParsedRichText => {
    const text = readPath(item, ['t']);
    if (text != null) return decodeSpreadsheetText(readTextValue(text));
    let styled = false;
    const runs = toArray(readPath(item, ['r'])).flatMap((run): ParsedRichTextRun[] => {
      const text = decodeSpreadsheetText(readTextValue(readPath(run, ['t'])));
      if (!text) return [];
      const properties = readPath(run, ['rPr']);
      if (!properties) return [{ text }];
      let font: PreviewFontReference | undefined = readFontReference(properties, theme, true);
      if (font.fontFamily) {
        const key = JSON.stringify(font), known = faces.get(key);
        if (known) font = known;
        else { faces.set(key, font); fonts.push(font); }
      } else if (!font.fontStyle && font.traits?.weight === undefined) font = undefined;
      const appearance = readFontAppearance(properties, color);
      const alignment = readPath(properties, ['vertAlign', 'val']);
      const verticalAlign = alignment === 'superscript' ? 'super' : alignment === 'subscript' ? 'sub'
        : alignment === 'baseline' ? alignment : undefined;
      styled ||= Boolean(font || appearance.fontSize || appearance.color || appearance.underline || appearance.strike !== undefined || verticalAlign);
      return [{ text, font, ...appearance, verticalAlign }];
    });
    const value = runs.map(run => run.text).join('');
    return styled ? { value, runs } : value;
  };
  read.checkpoint = () => {
    const before = fonts.length;
    return () => {
      for (const font of fonts.splice(before)) faces.delete(JSON.stringify(font));
    };
  };
  return read;
}
