import { classifyPreviewFont, type PreviewFontReference } from '@filens/core';
import { formatCellValue } from './number-formats';
import { RowRangeIndex } from './row-range-index';
import { resolveSharedFormula } from './shared-formulas';
import type { ParsedRichText, ParsedRichTextRun, ParsedWorkbook } from './types';

const SAMPLE_LIMIT = 4096;
const subsetScripts = new Set(['cjk-sc', 'cjk-tc', 'japanese', 'korean', 'emoji']);

interface FontSample {
  text: string;
  strings: Set<string>;
  complete: boolean;
}

export function workbookFontReferences(workbook: ParsedWorkbook, collectSamples: boolean) {
  const fonts = workbook.fonts ?? [];
  const used = new Set<PreviewFontReference>();
  const byFont = new Map<PreviewFontReference, FontSample>();
  const byFace = new Map<string, FontSample>();
  const varyingFamilies = new Set<string>();
  if (collectSamples) {
    for (const font of fonts) {
      if (!font.fontFamily || !subsetScripts.has(classifyPreviewFont(font.fontFamily, font.traits).script ?? '')) continue;
      const key = JSON.stringify([font.fontFamily.toLowerCase(), font.traits?.weight, font.fontStyle ?? 'normal']);
      let sample = byFace.get(key);
      if (!sample) byFace.set(key, sample = { text: '', strings: new Set(), complete: true });
      byFont.set(font, sample);
    }
  }

  // Repeated shared strings and numeric values need only one copy in a sample.
  const append = (font: PreviewFontReference | undefined, value: string) => {
    const sample = font && byFont.get(font);
    if (!sample?.complete || !value || sample.strings.has(value)) return;
    if (sample.text.length + value.length > SAMPLE_LIMIT) {
      sample.complete = false;
      sample.text = '';
      sample.strings.clear();
      return;
    }
    sample.strings.add(value);
    sample.text += value;
  };
  const invalidate = (font?: PreviewFontReference) => {
    const sample = font && byFont.get(font);
    if (sample) sample.complete = false;
  };
  const vary = (font?: PreviewFontReference) => {
    if (font?.fontFamily) varyingFamilies.add(font.fontFamily.toLowerCase());
  };
  const addRun = (run: ParsedRichTextRun, cellFont?: PreviewFontReference) => {
    const face = run.font?.fontFamily ? run.font : cellFont;
    if (run.font && face && byFont.has(face)) {
      const expectedWeight = face.traits?.weight ?? 400, expectedStyle = face.fontStyle ?? 'normal';
      const weight = run.font.traits?.weight ?? cellFont?.traits?.weight ?? 400;
      const style = run.font.fontStyle ?? cellFont?.fontStyle ?? 'normal';
      if (weight !== expectedWeight || style !== expectedStyle) vary(face);
    }
    append(face, run.text);
  };

  const richTexts = new Map<ParsedRichText, boolean>();
  for (const sheet of workbook.sheets) {
    const widthFont = sheet.columnWidthSource?.font;
    if (widthFont) { used.add(widthFont); append(widthFont, '0123456789'); }
    const formats = sheet.cellStyles?.formats;
    const addStyleFont = (index: number) => {
      const font = formats?.[index]?.font;
      if (font) used.add(font);
    };
    addStyleFont(0);
    for (const range of sheet.cellStyles?.columns ?? []) {
      if (range.firstColumn <= sheet.columnCount && range.lastColumn >= 1) addStyleFont(range.styleIndex);
    }
    // A conditional rule can recalculate or change with the date. Index only the
    // ranges that can alter the displayed text or the font weight/style.
    const ranges = byFont.size ? (sheet.conditionalRules ?? []).flatMap(({ style, ranges }) => {
      const varyingFace = style?.bold !== undefined || style?.italic !== undefined;
      return varyingFace || style?.numberFormat !== undefined ? ranges.map(range => ({ ...range, varyingFace })) : [];
    }) : [];
    const conditional = ranges.length ? new RowRangeIndex(ranges) : undefined;
    const richFormatParts = new Map<string | number | undefined, string[]>();
    for (const row of sheet.rows) {
      if (row.styleIndex !== undefined) addStyleFont(row.styleIndex);
      let rowRanges: typeof ranges | undefined;
      for (const cell of row.cells) {
        const cellStyle = formats?.[cell.styleIndex ?? 0];
        const font = cell.font ?? cellStyle?.font;
        if (font) used.add(font);
        const rich = cell.richText;
        if (rich && !richTexts.has(rich)) {
          let hasSample = false;
          for (const run of rich.runs) if (run.font?.fontFamily) {
            used.add(run.font);
            hasSample ||= byFont.has(run.font);
          }
          richTexts.set(rich, hasSample);
        }
        const sample = font && byFont.get(font);
        const richSample = rich && richTexts.get(rich);
        if (!sample?.complete && !richSample && !(conditional && sample)) continue;
        const formula = sheet.showFormulas ? cell.formula ?? resolveSharedFormula(sheet, cell) : undefined;
        let varyingFace = false, varyingFormat = false;
        if (conditional && !rowRanges) {
          const overlaps: typeof ranges = [];
          conditional.forEach(row.index, row.index, range => overlaps.push(range));
          rowRanges = overlaps;
        }
        for (const range of rowRanges ?? []) {
          if (cell.column < range.firstColumn || cell.column > range.lastColumn) continue;
          varyingFormat = true;
          varyingFace ||= range.varyingFace;
        }
        if (varyingFace) {
          vary(font);
          if (!formula) for (const run of rich?.runs ?? []) vary(run.font);
        }
        if (!sample?.complete && !richSample) continue;
        if (!formula && (cell.needsCalculation || varyingFormat)) {
          invalidate(font);
          for (const run of rich?.runs ?? []) invalidate(run.font);
          continue;
        }
        if (formula) {
          append(font, '=' + formula.replace(/^=/, ''));
          continue;
        }
        const numberFormat = cellStyle?.numberFormat;
        if (rich?.value === cell.value) {
          let parts = richFormatParts.get(numberFormat);
          if (!parts) {
            const formatted = numberFormat === undefined ? '\0'
              : formattedFontSample('\0', 'text', numberFormat, sheet.date1904, sheet.numberFormatPalette);
            richFormatParts.set(numberFormat, parts = formatted.split('\0'));
          }
          for (const part of parts) append(font, part);
          if (parts.length > 1) for (const run of rich.runs) addRun(run, font);
        } else if (cell.value) {
          append(font, numberFormat === undefined ? cell.value
            : formattedFontSample(cell.value, cell.valueType, numberFormat, sheet.date1904, sheet.numberFormatPalette));
        }
      }
    }
  }
  const all = fonts.map(font => {
    const sample = byFont.get(font);
    return sample?.complete && sample.text && !varyingFamilies.has(font.fontFamily!.toLowerCase())
      ? { ...font, text: sample.text, textComplete: true } : { ...font };
  });
  return { all, loading: all.filter((_, index) => used.has(fonts[index])) };
}
function formattedFontSample(...args: Parameters<typeof formatCellValue>): string {
  const { text, spacing } = formatCellValue(...args);
  return text + (spacing?.map(item => item.glyph).join('') ?? '');
}

