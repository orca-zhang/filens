import { applyLumMod, applyTint, fontTraitsFromPanose, officeFontTraits, type BorderBox, type LineStyle, type PreviewFontReference } from '@filens/core';
import type { ParsedCellStyle, ParsedConditionalStyle } from './types';
import { decodeSpreadsheetText, readLocalPath, readPath, toArray } from './xml-values';
import { builtinNumberFormat } from './number-formats';
import { indexedColor } from './indexed-colors';

const themeSlots = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const fallbackTheme = 'FFFFFF 000000 EEECE1 1F497D 4F81BD C0504D 9BBB59 8064A2 4BACC6 F79646 0000FF 800080'.split(' ');

const isFalse = (value: unknown) => value === '0' || value === 'false';
const isTrue = (value: unknown) => value === '1' || value === 'true';
const toggle = (value: unknown) => value === undefined ? undefined : !isFalse(readPath(value, ['val']) ?? value);

function rgb(value: unknown): string | undefined {
  // XLSX style entries use the RGB channels of ARGB values, including 00-prefixed colors.
  return typeof value === 'string' && /^(?:[\da-f]{2})?[\da-f]{6}$/i.test(value) ? '#' + value.slice(-6).toUpperCase() : undefined;
}

export function readIndexedColors(styleSheet: unknown): (string | undefined)[] {
  return toArray(readPath(styleSheet, ['colors', 'indexedColors', 'rgbColor'])).map(entry => rgb(readPath(entry, ['rgb'])));
}

export function colorReader(custom: readonly (string | undefined)[], theme: unknown) {
  const scheme = readLocalPath(theme, ['theme', 'themeElements', 'clrScheme']);
  const themed = themeSlots.map((slot, i) => {
    const value = readLocalPath(scheme, [slot]);
    return rgb(readLocalPath(value, ['srgbClr', 'val']) ?? readLocalPath(value, ['sysClr', 'lastClr'])) ?? '#' + fallbackTheme[i];
  });
  return (node: unknown): string | undefined => {
    const themeIndex = Number(readPath(node, ['theme']));
    const index = Number(readPath(node, ['indexed']));
    const color = rgb(readPath(node, ['rgb'])) ?? themed[themeIndex] ?? indexedColor(index, custom)
      ?? (isTrue(readPath(node, ['auto'])) ? '#000000' : undefined);
    const tint = Number(readPath(node, ['tint']));
    if (!color || !Number.isFinite(tint) || !tint) return color;
    return tint < 0 ? applyLumMod(color, Math.max(0, 1 + tint)) : applyTint(color, tint);
  };
}

export function readFontReference(entry: unknown, theme: unknown, rich = false): PreviewFontReference {
  const scheme = readPath(entry, ['scheme', 'val']);
  const latin = scheme === 'major' || scheme === 'minor'
    ? readLocalPath(theme, ['theme', 'themeElements', 'fontScheme', `${scheme}Font`, 'latin']) : undefined;
  const themeFamily = readLocalPath(latin, ['typeface']);
  const themed = typeof themeFamily === 'string' && themeFamily.trim() ? themeFamily : undefined;
  const fontFamily = String(themed ?? readPath(entry, [rich ? 'rFont' : 'name', 'val']) ?? '').trim();
  const pitchFamily = Number(readLocalPath(latin, ['pitchFamily']));
  const validPitch = Number.isInteger(pitchFamily) && pitchFamily >= 0 && pitchFamily <= 255;
  const pitch = validPitch && (pitchFamily & 3) === 1 ? 'fixed' : validPitch && (pitchFamily & 3) === 2 ? 'variable' : undefined;
  const themeTraits = validPitch ? officeFontTraits(pitchFamily >> 4) : {};
  const panose = readLocalPath(latin, ['panose']);
  const bold = toggle(readPath(entry, ['b']));
  const italic = toggle(readPath(entry, ['i']));
  return {
    fontFamily: fontFamily || undefined,
    ...(italic ? { fontStyle: 'italic' as const } : rich && italic === false ? { fontStyle: 'normal' as const } : {}),
    traits: {
      // The saved family metadata describes the saved face.
      ...(themed ? { ...themeTraits, ...fontTraitsFromPanose(typeof panose === 'string' ? panose : undefined),
        ...officeFontTraits(undefined, pitch) }
        : officeFontTraits(readPath(entry, ['family', 'val']) as string | undefined)),
      ...(!rich || bold !== undefined ? { weight: bold ? 700 : 400 } : {})
    }
  };
}

export function readFontAppearance(entry: unknown, color: ReturnType<typeof colorReader>, read = readPath) {
  const size = Number(read(entry, ['sz', 'val']));
  const underline = read(entry, ['u']);
  const kind = readPath(underline, ['val']);
  return {
    fontSize: Number.isFinite(size) && size > 0 ? Math.min(size, 409) * 4 / 3 : undefined,
    color: color(read(entry, ['color'])),
    underline: underline === undefined ? undefined : !toggle(underline) || kind === 'none' ? 'none' as const
      : kind === 'double' || kind === 'doubleAccounting' ? 'double' as const : 'single' as const,
    strike: toggle(read(entry, ['strike']))
  };
}

const patterns = new Map(Object.entries({
  darkGray: 'pct75', mediumGray: 'pct50', lightGray: 'pct25', gray125: 'pct10', gray0625: 'pct5',
  darkHorizontal: 'horz', lightHorizontal: 'horz', darkVertical: 'vert', lightVertical: 'vert',
  darkDown: 'ltDnDiag', lightDown: 'ltDnDiag', darkUp: 'ltUpDiag', lightUp: 'ltUpDiag',
  darkGrid: 'lgGrid', lightGrid: 'smGrid', darkTrellis: 'diagCross', lightTrellis: 'diagCross'
}));

function readFill(entry: unknown, color: ReturnType<typeof colorReader>, differential = false, read = readPath): ParsedCellStyle['fill'] {
  const pattern = read(entry, ['patternFill']);
  const kind = String(readPath(pattern, ['patternType']) ?? '');
  const foregroundColor = color(read(pattern, ['fgColor']));
  const backgroundColor = color(read(pattern, ['bgColor']));
  if (differential && pattern !== undefined) {
    if (kind === 'none') return { type: 'none' };
    const solid = backgroundColor ?? foregroundColor;
    if (solid && (!kind || kind === 'solid')) return { type: 'solid', color: solid };
  }
  if (kind === 'solid' && foregroundColor) return { type: 'solid', color: foregroundColor };
  const supportedPattern = patterns.get(kind);
  if (supportedPattern) return { type: 'pattern', pattern: supportedPattern, foregroundColor, backgroundColor };
  const gradient = read(entry, ['gradientFill']);
  const stops = toArray(read(gradient, ['stop'])).flatMap(stop => {
    const position = Number(readPath(stop, ['position']));
    const value = color(read(stop, ['color']));
    return value && position >= 0 && position <= 1 ? [{ position, color: value }] : [];
  }).sort((a, b) => a.position - b.position);
  if (stops.length === 1) return { type: 'solid', color: stops[0].color };
  if (stops.length < 2) return undefined;
  const degree = Number(readPath(gradient, ['degree']) ?? 0);
  const fill = { type: 'gradient' as const, angle: Number.isFinite(degree) ? -degree : 0, stops };
  if (readPath(gradient, ['type']) === 'path') {
    const edge = (side: string) => {
      const value = Number(readPath(gradient, [side]));
      return value >= 0 && value <= 1 ? value : 0;
    };
    const left = edge('left'), top = edge('top');
    return { ...fill, gradientType: 'path',
      pathRectangle: { left, right: Math.max(left, edge('right')), top, bottom: Math.max(top, edge('bottom')) } };
  }
  return fill;
}

function readBorders(entry: unknown, color: ReturnType<typeof colorReader>, differential = false, read = readPath): Pick<ParsedCellStyle, 'borders' | 'rtlBorders'> {
  const borders: BorderBox = {};
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const line = readBorderLine(read(entry, [side]), color, differential, read);
    if (line) borders[side] = line;
  }
  const start = readBorderLine(read(entry, ['start']), color, differential, read);
  const end = readBorderLine(read(entry, ['end']), color, differential, read);
  if (!start && !end) return Object.keys(borders).length ? { borders } : {};
  const rtlBorders = { ...borders };
  if (start) {
    borders.left ??= start;
    rtlBorders.right ??= start;
  }
  if (end) {
    borders.right ??= end;
    rtlBorders.left ??= end;
  }
  return { borders, rtlBorders };
}

function readBorderLine(node: unknown, color: ReturnType<typeof colorReader>, differential: boolean, read: typeof readPath): LineStyle | undefined {
  const style = readPath(node, ['style']);
  if (typeof style !== 'string') return undefined;
  if (style === 'none') return differential ? { width: 0, color: 'transparent' } : undefined;
  const line: LineStyle = { color: color(read(node, ['color'])) ?? '#000000', width: 1 };
  if (style === 'double') { line.compound = 'double'; line.width = 3; }
  else if (style === 'thick') line.width = 3;
  else if (style.startsWith('medium')) line.width = 2;
  if (style === 'dotted' || style === 'hair') line.dash = 'dot';
  else if (/dash/i.test(style)) line.dash = 'dash';
  return line;
}

function readDiagonal(entry: unknown, color: ReturnType<typeof colorReader>, differential = false, read = readPath): ParsedCellStyle['diagonal'] {
  const up = isTrue(readPath(entry, ['diagonalUp'])), down = isTrue(readPath(entry, ['diagonalDown']));
  const line = readBorderLine(read(entry, ['diagonal']), color, differential, read);
  return line && (up || down || line.width === 0) ? { line, up, down } : undefined;
}

export function readDifferentialStyles(styleSheet: unknown, color: ReturnType<typeof colorReader>): ParsedConditionalStyle[] {
  return toArray(readPath(styleSheet, ['dxfs', 'dxf'])).map(entry => readDifferentialStyle(entry, color));
}

function readNumberFormatCode(entry: unknown): string | undefined {
  const code = readPath(entry, ['formatCode16']) ?? readPath(entry, ['formatCode']);
  return typeof code === 'string' ? decodeSpreadsheetText(code) : undefined;
}

export function readDifferentialStyle(entry: unknown, color: ReturnType<typeof colorReader>, read = readPath): ParsedConditionalStyle {
  const font = read(entry, ['font']);
  const appearance = readFontAppearance(font, color, read);
  const bold = toggle(read(font, ['b'])), italic = toggle(read(font, ['i']));
  const fill = readFill(read(entry, ['fill']), color, true, read);
  const border = read(entry, ['border']);
  const diagonal = readDiagonal(border, color, true, read);
  const number = read(entry, ['numFmt']);
  const id = Number(readPath(number, ['numFmtId']));
  const code = readNumberFormatCode(number);
  const numberFormat = code || (id === 0 ? 'General' : builtinNumberFormat(id));
  return {
    ...(bold !== undefined ? { bold } : {}), ...(italic !== undefined ? { italic } : {}),
    ...(appearance.underline ? { underline: appearance.underline } : {}),
    ...(appearance.strike !== undefined ? { strike: appearance.strike } : {}),
    ...(appearance.color ? { color: appearance.color } : {}),
    ...(fill ? { fill } : {}), ...readBorders(border, color, true, read), ...(diagonal ? { diagonal } : {}),
    ...(numberFormat !== undefined ? { numberFormat } : {})
  };
}

function readAlignment(value: unknown): Pick<ParsedCellStyle, 'horizontal' | 'readingOrder' | 'justifyLastLine' | 'centerAcross' | 'fillAlignment' | 'vertical' | 'verticalSpacing' | 'wrap' | 'shrinkToFit' | 'textRotation' | 'indent'> {
  const horizontal = readPath(value, ['horizontal']);
  const vertical = readPath(value, ['vertical']);
  const readingOrder = Number(readPath(value, ['readingOrder']));
  const indent = Number(readPath(value, ['indent']));
  const rotation = Number(readPath(value, ['textRotation']));
  const justified = horizontal === 'justify' || horizontal === 'distributed';
  const verticalSpacing = vertical === 'justify' || vertical === 'distributed' ? vertical : undefined;
  const textRotation = rotation === 255 ? rotation : Number.isInteger(rotation) && rotation > 0 && rotation <= 180
    ? rotation <= 90 ? -rotation : rotation - 90 : undefined;
  const verticalWriting = textRotation === 255 || Math.abs(textRotation ?? 0) === 90;
  return {
    horizontal: horizontal === 'left' || horizontal === 'center' || horizontal === 'right' || justified ? horizontal
      : horizontal === 'centerContinuous' ? 'center' : undefined,
    ...(readingOrder === 0 || readingOrder === 1 || readingOrder === 2 ? { readingOrder } : {}),
    ...(horizontal === 'centerContinuous' ? { centerAcross: true } : {}),
    ...(horizontal === 'fill' ? { fillAlignment: true } : {}),
    ...((justified || verticalWriting && verticalSpacing) && isTrue(readPath(value, ['justifyLastLine'])) ? { justifyLastLine: true } : {}),
    vertical: vertical === 'top' || vertical === 'bottom' ? vertical : vertical === 'center' ? 'middle' : undefined,
    ...(verticalSpacing ? { verticalSpacing } : {}),
    wrap: justified || Boolean(verticalSpacing && (!textRotation || verticalWriting)) || isTrue(readPath(value, ['wrapText'])),
    ...(isTrue(readPath(value, ['shrinkToFit'])) ? { shrinkToFit: true } : {}),
    ...(textRotation !== undefined ? { textRotation } : {}),
    indent: Number.isInteger(indent) && indent > 0 ? Math.min(indent, 255) : undefined
  };
}

export function readStyleAppearance(styleSheet: unknown, color: ReturnType<typeof colorReader>, fontEntries: unknown[],
  fonts: PreviewFontReference[], bases: unknown[], cells: unknown[]): ParsedCellStyle[] {
  const customFormats = new Map<number, string>();
  for (const entry of toArray(readPath(styleSheet, ['numFmts', 'numFmt']))) {
    const id = Number(readPath(entry, ['numFmtId']));
    const code = readNumberFormatCode(entry);
    if (Number.isSafeInteger(id) && id >= 0 && code !== undefined) customFormats.set(id, code);
  }
  const fills = toArray(readPath(styleSheet, ['fills', 'fill'])).map(entry => readFill(entry, color));
  const borders = toArray(readPath(styleSheet, ['borders', 'border'])).map(entry => ({
    ...readBorders(entry, color), diagonal: readDiagonal(entry, color)
  }));
  const typography = fontEntries.map(entry => {
    const font = readFontAppearance(entry, color);
    return { ...font, underline: font.underline === 'none' ? undefined : font.underline, strike: font.strike ?? false };
  });
  return cells.map(cell => {
    const base = bases[Number(readPath(cell, ['xfId']) ?? 0)];
    const property = (key: string, apply: string) => {
      const inherited = readPath(base, [key]);
      return isFalse(readPath(cell, [apply])) ? inherited : readPath(cell, [key]) ?? inherited;
    };
    const fontId = Number(property('fontId', 'applyFont') ?? 0);
    const formatId = Number(property('numFmtId', 'applyNumberFormat') ?? 0);
    return {
      font: fonts[fontId],
      ...typography[fontId],
      fill: fills[Number(property('fillId', 'applyFill') ?? 0)],
      ...borders[Number(property('borderId', 'applyBorder') ?? 0)],
      numberFormat: customFormats.get(formatId) ?? builtinNumberFormat(formatId),
      ...readAlignment(property('alignment', 'applyAlignment'))
    };
  });
}
