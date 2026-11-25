import { applyLumMod, applyTint, fontTraitsFromPanose, officeFontTraits, type BorderBox, type FillStyle, type LineStyle, type PreviewFontReference } from '@filens/core';
import type { ParsedCellStyle, ParsedConditionalStyle } from './types';
import { readLocalPath, readPath, toArray } from './xml-values';
import { builtinNumberFormat } from './number-formats';

// SpreadsheetML's standard indexed palette and theme slot order.
const indexedColors = ('000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF '
  + '000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF '
  + '800000 008000 000080 808000 800080 008080 C0C0C0 808080 '
  + '9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF '
  + '000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF '
  + '00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 '
  + '3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 '
  + '003366 339966 003300 333300 993300 993366 333399 333333 000000 FFFFFF').split(' ');
const themeSlots = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
const fallbackTheme = 'FFFFFF 000000 EEECE1 1F497D 4F81BD C0504D 9BBB59 8064A2 4BACC6 F79646 0000FF 800080'.split(' ');

const isFalse = (value: unknown) => value === '0' || value === 'false';
const isTrue = (value: unknown) => value === '1' || value === 'true';
const toggle = (value: unknown) => value === undefined ? undefined : !isFalse(readPath(value, ['val']) ?? value);

function rgb(value: unknown): string | undefined {
  // XLSX style entries use the RGB channels of ARGB values, including 00-prefixed colors.
  return typeof value === 'string' && /^(?:[\da-f]{2})?[\da-f]{6}$/i.test(value) ? '#' + value.slice(-6).toUpperCase() : undefined;
}

export function colorReader(styleSheet: unknown, theme: unknown) {
  const custom = toArray(readPath(styleSheet, ['colors', 'indexedColors', 'rgbColor'])).map(entry => rgb(readPath(entry, ['rgb'])));
  const scheme = readLocalPath(theme, ['theme', 'themeElements', 'clrScheme']);
  const themed = themeSlots.map((slot, i) => {
    const value = readLocalPath(scheme, [slot]);
    return rgb(readLocalPath(value, ['srgbClr', 'val']) ?? readLocalPath(value, ['sysClr', 'lastClr'])) ?? '#' + fallbackTheme[i];
  });
  return (node: unknown): string | undefined => {
    const themeIndex = Number(readPath(node, ['theme']));
    const index = Number(readPath(node, ['indexed']));
    const color = rgb(readPath(node, ['rgb'])) ?? themed[themeIndex] ?? custom[index]
      ?? (indexedColors[index] ? '#' + indexedColors[index] : undefined)
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

export function readFontAppearance(entry: unknown, color: ReturnType<typeof colorReader>) {
  const size = Number(readPath(entry, ['sz', 'val']));
  const underline = readPath(entry, ['u']);
  const kind = readPath(underline, ['val']);
  return {
    fontSize: Number.isFinite(size) && size > 0 ? Math.min(size, 409) * 4 / 3 : undefined,
    color: color(readPath(entry, ['color'])),
    underline: underline === undefined ? undefined : !toggle(underline) || kind === 'none' ? 'none' as const
      : kind === 'double' || kind === 'doubleAccounting' ? 'double' as const : 'single' as const,
    strike: toggle(readPath(entry, ['strike']))
  };
}

const patterns = new Map(Object.entries({
  darkGray: 'pct75', mediumGray: 'pct50', lightGray: 'pct25', gray125: 'pct10', gray0625: 'pct5',
  darkHorizontal: 'horz', lightHorizontal: 'horz', darkVertical: 'vert', lightVertical: 'vert',
  darkDown: 'ltDnDiag', lightDown: 'ltDnDiag', darkUp: 'ltUpDiag', lightUp: 'ltUpDiag',
  darkGrid: 'lgGrid', lightGrid: 'smGrid', darkTrellis: 'diagCross', lightTrellis: 'diagCross'
}));

function readFill(entry: unknown, color: ReturnType<typeof colorReader>, differential = false): FillStyle | undefined {
  const pattern = readPath(entry, ['patternFill']);
  const kind = String(readPath(pattern, ['patternType']) ?? '');
  const foregroundColor = color(readPath(pattern, ['fgColor']));
  const backgroundColor = color(readPath(pattern, ['bgColor']));
  if (differential && pattern !== undefined) {
    if (kind === 'none') return { type: 'none' };
    const solid = backgroundColor ?? foregroundColor;
    if (solid && (!kind || kind === 'solid')) return { type: 'solid', color: solid };
  }
  if (kind === 'solid' && foregroundColor) return { type: 'solid', color: foregroundColor };
  const supportedPattern = patterns.get(kind);
  if (supportedPattern) return { type: 'pattern', pattern: supportedPattern, foregroundColor, backgroundColor };
  const gradient = readPath(entry, ['gradientFill']);
  const stops = toArray(readPath(gradient, ['stop'])).flatMap(stop => {
    const position = Number(readPath(stop, ['position']));
    const value = color(readPath(stop, ['color']));
    return value && position >= 0 && position <= 1 ? [{ position, color: value }] : [];
  }).sort((a, b) => a.position - b.position);
  if (stops.length === 1) return { type: 'solid', color: stops[0].color };
  if (stops.length < 2) return undefined;
  const degree = Number(readPath(gradient, ['degree']) ?? 0);
  return { type: 'gradient', angle: Number.isFinite(degree) ? -degree : 0, stops,
    ...(readPath(gradient, ['type']) === 'path' ? { gradientType: 'path' } : {}) };
}

function readBorders(entry: unknown, color: ReturnType<typeof colorReader>, differential = false): BorderBox | undefined {
  const borders: BorderBox = {};
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const alias = side === 'left' ? 'start' : side === 'right' ? 'end' : side;
    const node = readPath(entry, [side]) ?? readPath(entry, [alias]);
    const style = readPath(node, ['style']);
    if (typeof style !== 'string') continue;
    if (style === 'none') {
      if (differential) borders[side] = { width: 0, color: 'transparent' };
      continue;
    }
    const line: LineStyle = { color: color(readPath(node, ['color'])) ?? '#000000', width: 1 };
    if (style === 'double') { line.compound = 'double'; line.width = 3; }
    else if (style === 'thick') line.width = 3;
    else if (style.startsWith('medium')) line.width = 2;
    if (style === 'dotted' || style === 'hair') line.dash = 'dot';
    else if (/dash/i.test(style)) line.dash = 'dash';
    borders[side] = line;
  }
  return Object.keys(borders).length ? borders : undefined;
}

export function readDifferentialStyles(styleSheet: unknown, color: ReturnType<typeof colorReader>): ParsedConditionalStyle[] {
  return toArray(readPath(styleSheet, ['dxfs', 'dxf'])).map(entry => {
    const font = readPath(entry, ['font']);
    const appearance = readFontAppearance(font, color);
    const bold = toggle(readPath(font, ['b'])), italic = toggle(readPath(font, ['i']));
    const fill = readFill(readPath(entry, ['fill']), color, true);
    const borders = readBorders(readPath(entry, ['border']), color, true);
    const number = readPath(entry, ['numFmt']);
    const id = Number(readPath(number, ['numFmtId']));
    const code = readPath(number, ['formatCode']);
    const numberFormat = typeof code === 'string' && code ? code : id === 0 ? 'General' : builtinNumberFormat(id);
    return {
      ...(bold !== undefined ? { bold } : {}), ...(italic !== undefined ? { italic } : {}),
      ...(appearance.underline ? { underline: appearance.underline } : {}),
      ...(appearance.strike !== undefined ? { strike: appearance.strike } : {}),
      ...(appearance.color ? { color: appearance.color } : {}),
      ...(fill ? { fill } : {}), ...(borders ? { borders } : {}),
      ...(numberFormat !== undefined ? { numberFormat } : {})
    };
  });
}

function readAlignment(value: unknown): Pick<ParsedCellStyle, 'horizontal' | 'vertical' | 'wrap' | 'indent'> {
  const horizontal = readPath(value, ['horizontal']);
  const vertical = readPath(value, ['vertical']);
  const indent = Number(readPath(value, ['indent']));
  return {
    horizontal: horizontal === 'left' || horizontal === 'center' || horizontal === 'right' || horizontal === 'justify' ? horizontal
      : horizontal === 'centerContinuous' ? 'center' : undefined,
    vertical: vertical === 'top' || vertical === 'bottom' ? vertical : vertical === 'center' ? 'middle' : undefined,
    wrap: isTrue(readPath(value, ['wrapText'])),
    indent: Number.isInteger(indent) && indent > 0 ? Math.min(indent, 250) : undefined
  };
}

export function readStyleAppearance(styleSheet: unknown, color: ReturnType<typeof colorReader>, fontEntries: unknown[],
  fonts: PreviewFontReference[], bases: unknown[], cells: unknown[]): ParsedCellStyle[] {
  const customFormats = new Map<number, string>();
  for (const entry of toArray(readPath(styleSheet, ['numFmts', 'numFmt']))) {
    const id = Number(readPath(entry, ['numFmtId']));
    const code = readPath(entry, ['formatCode']);
    if (Number.isSafeInteger(id) && id >= 0 && typeof code === 'string') customFormats.set(id, code);
  }
  const fills = toArray(readPath(styleSheet, ['fills', 'fill'])).map(entry => readFill(entry, color));
  const borders = toArray(readPath(styleSheet, ['borders', 'border'])).map(entry => readBorders(entry, color));
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
      borders: borders[Number(property('borderId', 'applyBorder') ?? 0)],
      numberFormat: customFormats.get(formatId) ?? builtinNumberFormat(formatId),
      ...readAlignment(property('alignment', 'applyAlignment'))
    };
  });
}
