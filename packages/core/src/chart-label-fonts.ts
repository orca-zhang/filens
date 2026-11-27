import type { ChartFontFace, ChartLabelStyle } from './types';

const eastAsian = /[\p{Script=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}\p{Script=Yi}\u3000-\u303f\uff01-\uff60\uffe0-\uffe6]/u;
const complex = /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;
const inherited = /[\p{Mark}\p{Format}]/u;
const letterOrNumber = /[\p{Letter}\p{Number}]/u;

type LabelFace = ChartFontFace | ChartLabelStyle;

export function chartLabelRuns(text: string, style: ChartLabelStyle | undefined): Array<{ text: string; face?: LabelFace }> {
  const fonts = style?.scriptFonts;
  if (!fonts?.eastAsia && !fonts?.complex) return [{ text, face: style }];

  const latin = fonts.latin ?? style;
  const runs: Array<{ text: string; face?: LabelFace }> = [];
  let face: LabelFace | undefined;
  let start = 0;
  let offset = 0;
  for (const character of text) {
    // Marks, joiners and common punctuation stay in the surrounding run.
    const next = inherited.test(character) ? undefined
      : eastAsian.test(character) ? fonts.eastAsia ?? latin
      : complex.test(character) ? fonts.complex ?? latin
      : letterOrNumber.test(character) ? latin : undefined;
    if (next && next !== face) {
      if (face) runs.push({ text: text.slice(start, offset), face });
      if (face) start = offset;
      face = next;
    }
    offset += character.length;
  }
  runs.push({ text: text.slice(start), face: face ?? latin });
  return runs;
}
