import { buildPreviewFontStack } from '@filens/core';
import type { ParsedColumnWidthSource, ParsedSheet } from './types';

/** ISO 29500 col.width includes padding in character units; baseColWidth does not. */
export function xlsxColumnWidths(count: number, source: ParsedColumnWidthSource, digitWidth = 7): number[] {
  const pixels = (width: number) => Math.max(1, Math.trunc(((256 * width + Math.trunc(128 / digitWidth)) / 256) * digitWidth));
  const fallback = source.defaultWidth === undefined ? Math.max(1, Math.trunc(source.baseWidth * digitWidth + 5)) : pixels(source.defaultWidth);
  const widths = Array<number>(Math.min(Math.max(count, 1), 16_384)).fill(fallback);
  // A source range only touches real sheet columns, including blank merge endpoints.
  // Apply in reverse so overlapping declarations retain the first match.
  for (let index = source.ranges.length - 1; index >= 0; index--) {
    const range = source.ranges[index];
    widths.fill(pixels(range.width), Math.min(widths.length, range.firstColumn - 1), Math.min(widths.length, range.lastColumn));
  }
  return widths;
}

export function sheetColumnWidths(sheet: ParsedSheet, document: Document): readonly number[] | undefined {
  const source = sheet.columnWidthSource;
  if (!source) return sheet.columnWidths;
  let digitWidth = 7;
  if (source.font?.fontFamily) {
    try {
      const context = document.createElement('canvas').getContext('2d');
      if (context) {
        const font = source.font;
        const stack = buildPreviewFontStack(font.fontFamily!, font.traits, font.resolvedFontFamily ? [font.resolvedFontFamily] : []);
        context.font = `${font.fontStyle ?? 'normal'} ${font.traits?.weight ?? 400} ${source.fontSize * 96 / 72}px ${stack}`;
        const measured = Math.round(Math.max(...Array.from('0123456789', digit => context.measureText(digit).width)));
        if (Number.isFinite(measured) && measured > 0) digitWidth = measured;
      }
    } catch { /* Headless hosts without a canvas retain the 11pt Calibri baseline. */ }
  }
  return xlsxColumnWidths(sheet.columnCount, source, digitWidth);
}
