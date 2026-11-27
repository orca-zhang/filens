import { classifyPreviewFont, getFontFallbackCandidates } from '../preview/font-matching';
import type {
  FillStyle,
  LineStyle,
  SlideItem,
  TableCell,
  TextFrame,
  TextParagraph
} from '../types';
import { hexToRgb } from '../utils/colors';
import { normalizeFontFamilyName, normalizeLocalizedFontAlias } from '../utils/fonts';
import type { MediaResolver } from './media-registry';

interface RenderTextFrameOptions {
  omitPlaceholderBulletLabels?: boolean;
  availableWidth?: number;
  availableHeight?: number;
}

type FontStackOptions = {
  symbol?: boolean;
  emoji?: boolean;
  sampleText?: string;
  contextText?: string;
};

export type PatternFillStyle = FillStyle & {
  type: 'pattern';
};

interface TextMeasurementScope {
  context?: CanvasRenderingContext2D | null;
  baselineWidths?: Array<number | undefined>;
  fontAvailability?: Map<string, boolean>;
  fontAliases?: ReadonlyMap<string, string>;
}

// A render is synchronous. Reuse one canvas while building its text, then
// release it so later renders see current fonts and the current document.
let textMeasurementScope: TextMeasurementScope | undefined;

/** Share font probes only within one synchronous render batch. */
export function withTextMeasurementScope<T>(render: () => T, fontAliases?: ReadonlyMap<string, string>): T {
  const previousScope = textMeasurementScope;
  textMeasurementScope = { fontAliases };
  try { return render(); } finally { textMeasurementScope = previousScope; }
}

function getTextMeasurementContext(): CanvasRenderingContext2D | null {
  if (textMeasurementScope?.context !== undefined) return textMeasurementScope.context;
  const canvas = document.createElement('canvas');
  const isJsdomCanvas = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent) &&
    typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement;
  const context = !isJsdomCanvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (textMeasurementScope) textMeasurementScope.context = context;
  return context;
}

/** Render shared cell styling and rich text; the host controls sizing and positioning. */
export function renderTableCellContent(td: HTMLTableCellElement, cell: TableCell, registry: MediaResolver): HTMLElement {
  td.style.verticalAlign = verticalAlignToTableCell(cell.textFrame.verticalAlign);
  applyTableCellPaint(td, cell, registry);
  const textFrame = renderTextFrame(cell.textFrame, '#111827');
  if (cell.fill.type === 'picture') {
    textFrame.style.zIndex = '1';
  }
  td.appendChild(textFrame);
  return textFrame;
}

/** Paint a table cell without creating any text DOM. */
export function applyTableCellPaint(td: HTMLTableCellElement, cell: Partial<Pick<TableCell, 'fill' | 'borders'>>, registry?: MediaResolver): void {
  if (cell.fill) applyElementFillStyles(td, cell.fill, registry);
  applyTableCellBorderStyles(td, cell.borders);
}

export function applyElementFillStyles(element: HTMLElement, fill: FillStyle, registry?: MediaResolver): void {
  element.style.background = '';
  element.style.backgroundColor = '';
  element.style.backgroundImage = '';
  element.style.backgroundSize = '';
  element.style.backgroundRepeat = '';
  element.style.backgroundPosition = '';

  if (fill.type === 'pattern') {
    applyPatternFillStyles(element, fill as PatternFillStyle);
  } else {
    element.style.background = fillToCss(fill);
  }

  if (fill.type !== 'picture' || !registry) {
    return;
  }

  const layer = createPictureFillLayer(fill, registry);
  if (!layer) {
    return;
  }

  element.style.overflow = 'hidden';
  element.insertBefore(layer, element.firstChild);
}

function applyPatternFillStyles(element: HTMLElement, fill: PatternFillStyle): void {
  const style = patternFillToCssStyle(fill);
  element.style.backgroundColor = style.color;
  element.style.backgroundImage = style.image;
  if (style.size) {
    element.style.backgroundSize = style.size;
  }
  if (style.repeat) {
    element.style.backgroundRepeat = style.repeat;
  }
  if (style.position) {
    element.style.backgroundPosition = style.position;
  }
}

function createPictureFillLayer(fill: FillStyle, registry: MediaResolver): HTMLDivElement | undefined {
  if (fill.type !== 'picture' || !fill.mediaId) {
    return undefined;
  }

  const url = registry.getUrl(fill.mediaId);
  if (!url) {
    return undefined;
  }

  const layer = document.createElement('div');
  layer.className = 'pptxv-fill-layer';
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.overflow = 'hidden';
  layer.style.pointerEvents = 'none';
  layer.style.borderRadius = 'inherit';
  layer.style.zIndex = '0';
  if (fill.alpha != null) {
    layer.style.opacity = String(fill.alpha);
  }

  const fit = fill.pictureFit ?? (fill.tile ? 'tile' : undefined);
  if (fit) {
    layer.style.backgroundImage = `url("${escapeCssUrl(url)}")`;
    layer.style.backgroundRepeat = fit === 'tile' ? 'repeat' : 'no-repeat';
    layer.style.backgroundPosition = fit === 'tile' ? '0 0' : 'center';
    if (fit === 'stretch') layer.style.backgroundSize = '100% 100%';
    else if (fit === 'cover' || fit === 'contain') layer.style.backgroundSize = fit;
    else if (fill.pictureSize) layer.style.backgroundSize = `${fill.pictureSize.width}px ${fill.pictureSize.height}px`;
    if (fill.pictureTint) void registry.getTintedPicture?.(fill.mediaId, fill.pictureTint).then(picture => {
      if (!picture) return;
      layer.style.backgroundImage = `url("${escapeCssUrl(picture.url)}")`;
      if (!fill.pictureSize && (fit === 'tile' || fit === 'natural')) layer.style.backgroundSize = `${picture.width}px ${picture.height}px`;
    });
    return layer;
  }

  const image = document.createElement('img');
  image.className = 'pptxv-fill-image';
  image.src = url;
  if (fill.pictureTint) void registry.getTintedPicture?.(fill.mediaId, fill.pictureTint).then(picture => {
    if (picture) image.src = picture.url;
  });
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.draggable = false;
  image.style.position = 'absolute';
  image.style.maxWidth = 'none';
  image.style.maxHeight = 'none';

  if (fill.crop) {
    const visibleWidth = Math.max(1 - fill.crop.left - fill.crop.right, 0.0001);
    const visibleHeight = Math.max(1 - fill.crop.top - fill.crop.bottom, 0.0001);
    image.style.width = percent(100 / visibleWidth);
    image.style.height = percent(100 / visibleHeight);
    image.style.left = percent((-fill.crop.left / visibleWidth) * 100);
    image.style.top = percent((-fill.crop.top / visibleHeight) * 100);
    image.style.objectFit = 'fill';
  } else {
    image.style.width = '100%';
    image.style.height = '100%';
    image.style.objectFit = 'fill';
  }

  layer.appendChild(image);
  return layer;
}

export function renderTextFrame(frame: TextFrame, fallbackColor: string, options: RenderTextFrameOptions = {}): HTMLElement {
  const element = document.createElement('div');
  element.className = 'pptxv-text-frame';
  element.style.padding = `${frame.padding.top}px ${frame.padding.right}px ${frame.padding.bottom}px ${frame.padding.left}px`;
  element.style.justifyContent = verticalAlignToFlex(frame.verticalAlign);
  element.style.overflowX = frame.horizontalOverflow === 'clip' || frame.wrap === 'none' ? 'clip' : 'visible';
  element.style.overflowY = frame.verticalOverflow === 'clip' ? 'clip' : 'visible';
  if (frame.anchorCenter) {
    element.style.alignItems = 'center';
  }
  if (frame.direction === 'vertical' || frame.direction === 'vertical270') {
    element.style.writingMode = frame.direction === 'vertical270' ? 'vertical-lr' : 'vertical-rl';
    element.style.textOrientation = 'mixed';
  }
  const autoNumberState: number[] = [];

  for (const paragraph of frame.paragraphs) {
    const paragraphElement = document.createElement('p');
    paragraphElement.className = 'pptxv-paragraph';
    paragraphElement.style.textAlign = paragraph.align ?? 'left';
    const defaultTypography = resolveParagraphTypography(paragraph);
    const paragraphColor = resolveParagraphColor(paragraph, fallbackColor);
    const defaultFontSize = defaultTypography.fontSize;
    const defaultFontFamily = defaultTypography.fontFamily;
    const omitBulletLabel = Boolean(
      options.omitPlaceholderBulletLabels && shouldOmitBulletLabel(paragraph, defaultFontSize)
    );
    const collapseBulletIndent = !omitBulletLabel && shouldCollapseBulletIndent(paragraph, defaultFontSize);
    const useBulletHangingOffset = shouldUseBulletHangingOffset(paragraph, omitBulletLabel);
    paragraphElement.style.fontSize = `${defaultFontSize}px`;
    if (defaultFontFamily) {
      paragraphElement.style.fontFamily = buildFontFamilyStack(defaultFontFamily, {
        sampleText: collectParagraphText(paragraph)
      });
      const requestedFontWeight = resolveRequestedFontWeight(defaultFontFamily);
      if (requestedFontWeight) {
        paragraphElement.style.fontWeight = requestedFontWeight;
      }
      const requestedFontStyle = resolveRequestedFontStyle(defaultFontFamily);
      if (requestedFontStyle) {
        paragraphElement.style.fontStyle = requestedFontStyle;
      }
    }
    if (frame.anchorCenter) {
      paragraphElement.style.width = 'fit-content';
      paragraphElement.style.maxWidth = '100%';
    }
    if (frame.wrap === 'none') {
      paragraphElement.style.whiteSpace = 'pre';
      paragraphElement.style.overflowWrap = 'normal';
      paragraphElement.style.wordBreak = 'normal';
    }
    if (paragraph.marginLeft != null) {
      paragraphElement.style.paddingLeft = `${resolveParagraphPaddingLeft(paragraph, collapseBulletIndent)}px`;
    }
    if (paragraph.indent != null) {
      paragraphElement.style.textIndent = `${useBulletHangingOffset ? 0 : resolveParagraphTextIndent(paragraph, collapseBulletIndent)}px`;
    }
    if (paragraph.spaceBefore != null) {
      paragraphElement.style.marginTop = `${paragraph.spaceBefore}px`;
    }
    if (paragraph.spaceAfter != null) {
      paragraphElement.style.marginBottom = `${paragraph.spaceAfter}px`;
    }
    if (paragraph.lineHeight != null) {
      paragraphElement.style.lineHeight =
        paragraph.lineHeightUnit === 'px' ? `${paragraph.lineHeight}px` : String(paragraph.lineHeight);
    } else {
      paragraphElement.style.lineHeight = '1';
    }

    let lineAdvance = resolveParagraphFirstLineStart(paragraph, collapseBulletIndent);
    if (paragraph.bullet) {
      const bullet = document.createElement('span');
      const label = resolveBulletLabel(paragraph, autoNumberState);
      const bulletColor = resolveBulletColor(paragraph, paragraphColor);
      const bulletAdvance = resolveBulletAdvance(label, paragraph, defaultFontSize);
      const bulletFontStack = resolveBulletFontStack(paragraph, label);
      const bulletVisual = createCustomBulletVisual(label, defaultFontSize);
      bullet.className = [
        'pptxv-run',
        'pptxv-run--bullet',
        paragraph.bullet.autoType ? 'pptxv-run--bullet-auto' : ''
      ]
        .filter(Boolean)
        .join(' ');
      if (bulletVisual) {
        bullet.dataset.resolvedLabel = label;
        bullet.appendChild(bulletVisual);
        bullet.style.display = 'inline-flex';
        bullet.style.alignItems = 'center';
        bullet.style.justifyContent = 'flex-start';
        bullet.style.lineHeight = '1';
      } else {
        bullet.textContent = label;
      }
      bullet.style.color = bulletColor;
      if (bulletFontStack) {
        bullet.style.fontFamily = bulletFontStack;
      }
      const bulletFontWeight = resolveRequestedFontWeight(paragraph.bullet.fontFamily);
      if (bulletFontWeight) {
        bullet.style.fontWeight = bulletFontWeight;
      }
      if (bulletAdvance > 0 && paragraph.indent != null && paragraph.indent < 0) {
        bullet.style.display = bulletVisual ? 'inline-flex' : 'inline-block';
        bullet.style.width = `${Number(bulletAdvance.toFixed(3))}px`;
        bullet.style.boxSizing = 'border-box';
        if (useBulletHangingOffset) {
          bullet.style.marginLeft = `${collapseBulletIndent ? 0 : paragraph.indent}px`;
        }
      }
      if (paragraph.bullet.autoType) {
        bullet.style.fontVariantNumeric = 'tabular-nums';
      }
      if (label && !omitBulletLabel) {
        paragraphElement.appendChild(bullet);
        lineAdvance += bulletAdvance;
      }
    }

    const paragraphText = collectParagraphText(paragraph);
    // Advance widths only affect explicit tab stops. Let the browser lay out
    // ordinary text instead of creating a canvas and measuring every run.
    const hasTabs = paragraph.runs.some((run) => run.text === '\t');
    for (const run of paragraph.runs) {
      const span = renderTextRun(run, paragraphColor, paragraphText, defaultFontSize, frame.wrap === 'none');
      if (run.text === '\t') {
        const tabWidth = resolveTabRunWidth(paragraph, lineAdvance, defaultFontSize);
        span.classList.add('pptxv-run--tab');
        span.style.width = `${Number(tabWidth.toFixed(3))}px`;
        lineAdvance += tabWidth;
      } else if (run.text === '\n') {
        lineAdvance = resolveParagraphWrappedLineStart(paragraph, collapseBulletIndent);
      } else if (hasTabs) {
        lineAdvance += estimateRunAdvance(run, defaultFontSize);
      }
      paragraphElement.appendChild(span);
    }

    element.appendChild(paragraphElement);
  }

  applyShapeAutofitToTextFrame(element, frame, options);

  return element;
}

function applyShapeAutofitToTextFrame(
  element: HTMLElement,
  frame: TextFrame,
  options: Pick<RenderTextFrameOptions, 'availableWidth' | 'availableHeight'>
): void {
  if (frame.autofit?.type !== 'shape' || frame.wrap !== 'none') {
    return;
  }

  const availableWidth =
    options.availableWidth != null
      ? Math.max(options.availableWidth - frame.padding.left - frame.padding.right, 1)
      : undefined;
  const availableHeight =
    options.availableHeight != null
      ? Math.max(options.availableHeight - frame.padding.top - frame.padding.bottom, 1)
      : undefined;

  if ((!availableWidth || !Number.isFinite(availableWidth)) && (!availableHeight || !Number.isFinite(availableHeight))) {
    return;
  }

  const metrics = estimateTextFrameMetrics(frame);
  if (metrics.width <= 0 || metrics.height <= 0) {
    return;
  }

  let scale = 1;
  if (availableWidth && metrics.width > availableWidth + 0.5) {
    scale = Math.min(scale, availableWidth / metrics.width);
  }
  if (availableHeight && metrics.height > availableHeight + 0.5) {
    scale = Math.min(scale, availableHeight / metrics.height);
  }

  if (!Number.isFinite(scale) || scale >= 0.999) {
    return;
  }

  applyAutofitScaleToTextFrameElement(element, scale);
}

function estimateTextFrameMetrics(frame: TextFrame): { width: number; height: number } {
  let maxWidth = 0;
  let totalHeight = 0;

  for (const paragraph of frame.paragraphs) {
    const defaultFontSize = resolveParagraphTypography(paragraph).fontSize;
    let paragraphWidth = resolveParagraphFirstLineStart(paragraph);
    if (paragraph.bullet) {
      paragraphWidth += resolveBulletAdvance(resolveBulletLabel(paragraph, []), paragraph, defaultFontSize);
    }
    for (const run of paragraph.runs) {
      paragraphWidth += estimateRunAdvance(run, defaultFontSize);
    }

    const lineHeight = estimateParagraphLineHeight(paragraph, defaultFontSize);
    const paragraphHeight = lineHeight + (paragraph.spaceBefore ?? 0) + (paragraph.spaceAfter ?? 0);

    maxWidth = Math.max(maxWidth, paragraphWidth);
    totalHeight += Math.max(paragraphHeight, lineHeight);
  }

  return {
    width: maxWidth,
    height: totalHeight
  };
}

function estimateParagraphLineHeight(paragraph: TextParagraph, defaultFontSize: number): number {
  const runFontSize = paragraph.runs.reduce((maxSize, run) => Math.max(maxSize, run.fontSize ?? defaultFontSize), defaultFontSize);
  if (paragraph.lineHeight != null) {
    return paragraph.lineHeightUnit === 'px' ? paragraph.lineHeight : runFontSize * paragraph.lineHeight;
  }

  return runFontSize;
}

function applyAutofitScaleToTextFrameElement(element: HTMLElement, scale: number): void {
  const paragraphElements = Array.from(element.querySelectorAll('.pptxv-paragraph')) as HTMLParagraphElement[];
  for (const paragraph of paragraphElements) {
    scalePxStyle(paragraph.style, 'fontSize', scale);
    scalePxStyle(paragraph.style, 'marginTop', scale);
    scalePxStyle(paragraph.style, 'marginBottom', scale);
    scalePxStyle(paragraph.style, 'paddingLeft', scale);
    scalePxStyle(paragraph.style, 'textIndent', scale);
    scaleLineHeightStyle(paragraph.style, scale);
  }

  const runElements = Array.from(element.querySelectorAll('.pptxv-run')) as HTMLSpanElement[];
  for (const run of runElements) {
    scalePxStyle(run.style, 'fontSize', scale);
    scalePxStyle(run.style, 'width', scale);
    scalePxStyle(run.style, 'marginLeft', scale);
    scalePxStyle(run.style, 'lineHeight', scale);
    scaleLetterSpacingStyle(run.style, scale);
  }
}

function scalePxStyle(style: CSSStyleDeclaration, property: keyof CSSStyleDeclaration, scale: number): void {
  const currentValue = style[property];
  if (typeof currentValue !== 'string' || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  ((style as unknown) as Record<string, string>)[property as string] = `${Number((numeric * scale).toFixed(3))}px`;
}

function scaleLineHeightStyle(style: CSSStyleDeclaration, scale: number): void {
  const currentValue = style.lineHeight;
  if (!currentValue || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  style.lineHeight = `${Number((numeric * scale).toFixed(3))}px`;
}

function scaleLetterSpacingStyle(style: CSSStyleDeclaration, scale: number): void {
  const currentValue = style.letterSpacing;
  if (!currentValue || !currentValue.endsWith('px')) {
    return;
  }

  const numeric = Number.parseFloat(currentValue);
  if (!Number.isFinite(numeric)) {
    return;
  }

  style.letterSpacing = `${Number((numeric * scale).toFixed(3))}px`;
}

function renderTextRun(
  run: TextParagraph['runs'][number],
  fallbackColor: string,
  contextText?: string,
  defaultFontSize = 16,
  noWrap = false
): HTMLAnchorElement | HTMLSpanElement {
  const isLink = Boolean(run.href || run.slideIndex != null || run.navigationAction);
  const span = isLink ? document.createElement('a') : document.createElement('span');
  span.className = ['pptxv-run', isLink ? 'pptxv-run--link' : ''].filter(Boolean).join(' ');
  const standaloneSymbolLabel = resolveStandaloneSymbolLabel(run.text);
  const customInlineVisual =
    standaloneSymbolLabel && isPortableBulletGlyph(standaloneSymbolLabel)
      ? createCustomSymbolVisual(standaloneSymbolLabel, run.fontSize ?? defaultFontSize)
      : undefined;
  if (customInlineVisual) {
    span.dataset.resolvedLabel = standaloneSymbolLabel;
    span.appendChild(customInlineVisual);
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    span.style.lineHeight = '1';
  } else {
    span.textContent = run.text || '\u00A0';
  }
  if (span instanceof HTMLAnchorElement) {
    applyLinkAttributes(span, run);
  }
  if (run.color) {
    span.style.color = colorWithAlpha(run.color, run.colorAlpha);
  } else {
    span.style.color = fallbackColor;
  }
  const requestedFontWeight = resolveRequestedFontWeight(run.fontFamily, run.bold);
  if (requestedFontWeight) {
    span.style.fontWeight = requestedFontWeight;
  }
  const requestedFontStyle = resolveRequestedFontStyle(run.fontFamily, run.italic);
  if (requestedFontStyle) {
    span.style.fontStyle = requestedFontStyle;
  }
  const decorations: string[] = [];
  if (run.underline) {
    decorations.push('underline');
  }
  if (run.strike) {
    decorations.push('line-through');
  }
  if (decorations.length) {
    span.style.textDecoration = decorations.join(' ');
  }
  if (run.highlightColor) {
    span.style.backgroundColor = colorWithAlpha(run.highlightColor, run.highlightAlpha);
  }
  if (run.fontSize) {
    span.style.fontSize = `${run.fontSize}px`;
  }
  const standaloneSymbolFontStack = resolveStandaloneSymbolFontStack(run.text, run.fontFamily);
  if (standaloneSymbolFontStack) {
    span.style.fontFamily = standaloneSymbolFontStack;
  } else if (run.fontFamily) {
    span.style.fontFamily = buildFontFamilyStack(run.fontFamily, {
      sampleText: run.text,
      contextText
    });
  }
  const letterSpacing = resolveRunLetterSpacing(run, contextText);
  if (letterSpacing) {
    span.style.letterSpacing = letterSpacing;
  }
  if (run.baselineShift) {
    span.style.verticalAlign = `${Number(run.baselineShift.toFixed(4))}em`;
  }
  if (noWrap) {
    span.style.whiteSpace = 'pre';
  }
  return span;
}

function resolveParagraphTypography(paragraph: TextParagraph): { fontSize: number; fontFamily?: string } {
  const sizeWeights = new Map<number, number>();
  const familyWeights = new Map<string, number>();
  let fallbackFontSize: number | undefined;
  let fallbackFontFamily: string | undefined;

  for (const run of paragraph.runs) {
    const weight = resolveRunTypographyWeight(run);
    if (run.fontSize != null) {
      fallbackFontSize ??= run.fontSize;
      sizeWeights.set(run.fontSize, (sizeWeights.get(run.fontSize) ?? 0) + weight);
    }
    if (run.fontFamily) {
      fallbackFontFamily ??= run.fontFamily;
      familyWeights.set(run.fontFamily, (familyWeights.get(run.fontFamily) ?? 0) + weight);
    }
  }

  return {
    fontSize: selectWeightedTypographyValue(sizeWeights) ?? fallbackFontSize ?? 16,
    fontFamily: selectWeightedTypographyValue(familyWeights) ?? fallbackFontFamily
  };
}

function resolveParagraphColor(paragraph: TextParagraph, fallbackColor: string): string {
  for (const run of paragraph.runs) {
    if (run.color && run.text.trim().length > 0) {
      return colorWithAlpha(run.color, run.colorAlpha);
    }
  }

  for (const run of paragraph.runs) {
    if (run.color) {
      return colorWithAlpha(run.color, run.colorAlpha);
    }
  }

  return fallbackColor;
}

function resolveRunTypographyWeight(run: TextParagraph['runs'][number]): number {
  const text = run.text.replace(/[\n\t]/g, '');
  const normalized = text.trim().length ? text.trim() : text;
  return Math.max(Array.from(normalized).length, 1);
}

function selectWeightedTypographyValue<T>(weights: Map<T, number>): T | undefined {
  let bestValue: T | undefined;
  let bestWeight = -1;

  for (const [value, weight] of weights.entries()) {
    if (weight > bestWeight) {
      bestValue = value;
      bestWeight = weight;
    }
  }

  return bestValue;
}

function collectParagraphText(paragraph: TextParagraph): string {
  return paragraph.runs.map((run) => run.text).join('');
}

function resolveParagraphPaddingLeft(paragraph: TextParagraph, collapseBulletIndent: boolean): number {
  const marginLeft = Math.max(paragraph.marginLeft ?? 0, 0);
  if (!collapseBulletIndent) {
    return marginLeft;
  }

  return Math.max(marginLeft + Math.min(paragraph.indent ?? 0, 0), 0);
}

function resolveParagraphTextIndent(paragraph: TextParagraph, collapseBulletIndent: boolean): number {
  if (!collapseBulletIndent) {
    return paragraph.indent ?? 0;
  }

  return Math.max(paragraph.indent ?? 0, 0);
}

function resolveParagraphFirstLineStart(paragraph: TextParagraph, collapseBulletIndent = false): number {
  const marginLeft = resolveParagraphPaddingLeft(paragraph, collapseBulletIndent);
  return marginLeft + resolveParagraphTextIndent(paragraph, collapseBulletIndent);
}

function resolveParagraphWrappedLineStart(paragraph: TextParagraph, collapseBulletIndent = false): number {
  const marginLeft = resolveParagraphPaddingLeft(paragraph, collapseBulletIndent);
  const positiveIndent = Math.max(resolveParagraphTextIndent(paragraph, collapseBulletIndent), 0);
  return marginLeft + positiveIndent;
}

function shouldCollapseBulletIndent(paragraph: TextParagraph, defaultFontSize: number): boolean {
  if (!paragraph.bullet || defaultFontSize > 24) {
    return false;
  }

  const marginLeft = paragraph.marginLeft ?? 0;
  const indent = paragraph.indent ?? 0;
  if (marginLeft <= 0 || indent >= 0) {
    return false;
  }

  return Math.abs(marginLeft + indent) <= 2;
}

function shouldUseBulletHangingOffset(paragraph: TextParagraph, omitBulletLabel: boolean): boolean {
  return !omitBulletLabel && Boolean(paragraph.bullet && paragraph.indent != null && paragraph.indent < 0);
}

function shouldOmitBulletLabel(paragraph: TextParagraph, defaultFontSize: number): boolean {
  if (!paragraph.bullet?.char || paragraph.bullet.autoType || defaultFontSize < 24) {
    return false;
  }

  const normalizedFont = normalizeLocalizedFontAlias(paragraph.bullet.fontFamily ?? '').toLowerCase();
  return paragraph.bullet.char === '•' && normalizedFont === 'arial';
}

function resolveBulletAdvance(label: string, paragraph: TextParagraph, defaultFontSize: number): number {
  const hangingIndent = paragraph.indent != null && paragraph.indent < 0 ? Math.abs(paragraph.indent) : 0;
  if (hangingIndent > 0) {
    return Math.max(hangingIndent, estimateTextWidth(label, defaultFontSize));
  }

  return Math.max(estimateTextWidth(label, defaultFontSize), paragraph.bullet?.autoType ? defaultFontSize * 2.4 : defaultFontSize * 1.2);
}

function resolveTabRunWidth(paragraph: TextParagraph, currentAdvance: number, defaultFontSize: number): number {
  const fallback = defaultTabWidth(defaultFontSize);

  for (const stop of paragraph.tabStops ?? []) {
    if (stop > currentAdvance + 0.5) {
      return Math.max(stop - currentAdvance, 4);
    }
  }

  return fallback;
}

function defaultTabWidth(defaultFontSize: number): number {
  return Math.max(defaultFontSize * 2.6, 24);
}

function estimateRunAdvance(run: TextParagraph['runs'][number], defaultFontSize: number): number {
  return estimateTextWidth(run.text, run.fontSize ?? defaultFontSize, run.fontFamily, run.bold, run.italic);
}

export function estimateTextWidth(
  text: string,
  fontSize: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean
): number {
  if (!text) {
    return 0;
  }

  const measurableText = text.replace(/\n/g, '');
  const measured = measureTextWidthWithCanvas(measurableText, fontSize, fontFamily, bold, italic);
  if (measured != null && Number.isFinite(measured) && measured > 0) {
    return measured;
  }

  let width = 0;
  for (const character of measurableText) {
    width += estimateCharacterWidth(character);
  }

  const emphasizedWidth = width * (bold ? 1.04 : 1) * (italic ? 1.02 : 1);
  return emphasizedWidth * fontSize;
}

function measureTextWidthWithCanvas(
  text: string,
  fontSize: number,
  fontFamily?: string,
  bold?: boolean,
  italic?: boolean
): number | undefined {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return undefined;
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return undefined;
  }

  try {
    const context = getTextMeasurementContext();
    if (!context) {
      return undefined;
    }

    const styleParts = [
      italic ? 'italic' : '',
      resolveRequestedFontWeight(fontFamily, bold) ?? '400',
      `${fontSize}px`,
      fontFamily
        ? buildFontFamilyStack(fontFamily, {
            sampleText: text,
            contextText: text
          })
        : '"Segoe UI", Arial, sans-serif'
    ]
      .filter(Boolean)
      .join(' ');
    context.font = styleParts;
    return context.measureText(text).width;
  } catch {
    return undefined;
  }
}

function estimateCharacterWidth(character: string): number {
  if (character === '\t') {
    return 0;
  }
  if (character === ' ') {
    return 0.33;
  }
  if (/[.,:;'"!|`]/.test(character)) {
    return 0.28;
  }
  if (/[-_/\\(){}\[\]]/.test(character)) {
    return 0.34;
  }
  if (/[A-Z0-9]/.test(character)) {
    return 0.6;
  }
  if (/[a-z]/.test(character)) {
    return 0.54;
  }
  if (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(character)) {
    return 1;
  }

  return 0.56;
}

export function buildFontFamilyStack(fontFamily: string, options: FontStackOptions = {}): string {
  const lookupFontFamily = normalizeLocalizedFontAlias(fontFamily);
  const families: string[] = [];
  const seen = new Set<string>();
  const fallbackSampleText = options.contextText && options.contextText.trim() ? options.contextText : options.sampleText;
  const preferSystemThemeFallback =
    !options.symbol &&
    shouldPreferSystemThemeFontStack(lookupFontFamily) &&
    shouldUseNeutralThemeFallbackForText(options.sampleText, options.contextText);
  const add = (value: string | undefined) => {
    if (!value) {
      return;
    }

    const normalized = normalizeFontFamilyName(value);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    families.push(quoteFontFamily(normalized));
  };
  const addMany = (values: readonly string[]) => {
    for (const value of values) {
      add(value);
    }
  };

  add(embeddedFontAlias(fontFamily));
  if (!preferSystemThemeFallback) {
    add(fontFamily);
    if (lookupFontFamily !== fontFamily) {
      add(lookupFontFamily);
    }
    const knownFallbacks = resolveKnownFontFallbacks(lookupFontFamily, fallbackSampleText);
    addMany(knownFallbacks.length ? knownFallbacks : getFontFallbackCandidates(lookupFontFamily));
  }
  if (options.emoji) {
    addMany(EMOJI_FONT_STACK);
  }
  if (options.symbol || isSymbolFont(lookupFontFamily)) {
    addMany(SYMBOL_FONT_STACK);
  }
  if (!preferSystemThemeFallback) {
    addMany(resolveScriptFallbacks(lookupFontFamily, options.sampleText));
  }
  addMany(DEFAULT_SANS_STACK);

  return families.join(', ');
}

function embeddedFontAlias(family: string | undefined): string | undefined {
  return family && textMeasurementScope?.fontAliases?.get(normalizeFontFamilyName(family).toLowerCase()) || undefined;
}

const DEFAULT_SANS_STACK = [
  '-apple-system',
  'BlinkMacSystemFont',
  'Segoe UI',
  'Roboto',
  'Helvetica Neue',
  'Arial',
  'Noto Sans',
  'sans-serif'
] as const;
const EMOJI_FONT_STACK = ['Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Noto Emoji'] as const;
const SYMBOL_FONT_STACK = ['Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols 2', 'Noto Sans Symbols'] as const;
const OFFICE_THEME_NEUTRAL_FONTS = new Set([
  'aptos',
  'aptos display',
  'aptos narrow',
  'calibri',
  'calibri light',
  'dengxian',
  'dengxian light',
  '等线',
  '等线 light',
  '绛夌嚎',
  '绛夌嚎 light'
]);
const SIMPLIFIED_CHINESE_STACK = [
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
  'Source Han Sans SC',
  'WenQuanYi Micro Hei'
] as const;
const SERIF_CHINESE_STACK = [
  'SimSun',
  'Songti SC',
  'STSong',
  'Noto Serif CJK SC',
  'Source Han Serif SC'
] as const;
const JAPANESE_STACK = ['Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Hiragino Sans', 'Noto Sans CJK JP'] as const;
const KOREAN_STACK = ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR'] as const;
const BASE_SYNTHETIC_FONT_WEIGHT = 400;
const MIN_SYNTHETIC_FONT_WEIGHT = 100;
const MAX_SYNTHETIC_FONT_WEIGHT = 900;
const SYNTHETIC_FONT_WEIGHT_STEP = 5;
const SYNTHETIC_FONT_WEIGHT_PROFILES = [
  { pattern: /\b(thin|hairline)\b/, scale: 0.25 },
  { pattern: /\b(extra[- ]?light|ultra[- ]?light)\b/, scale: 0.55 },
  { pattern: /\b(semi[- ]?light|demi[- ]?light)\b/, scale: 0.88 },
  { pattern: /\blight\b/, scale: 0.78 },
  { pattern: /\bmedium\b/, scale: 1.15 },
  { pattern: /\b(semi[- ]?bold|demi[- ]?bold)\b/, scale: 1.38 },
  { pattern: /\b(extra[- ]?bold|ultra[- ]?bold)\b/, scale: 2 },
  { pattern: /\b(black|heavy)\b/, scale: 2.25 },
  { pattern: /\bbold\b/, scale: 1.75 }
] as const;
const FONT_AVAILABILITY_PROBE_TEXT = 'BESbswy1234567890';
const FONT_AVAILABILITY_PROBE_SIZE = 32;
const FONT_AVAILABILITY_EPSILON = 0.1;

const KNOWN_FONT_FALLBACKS: Record<string, readonly string[]> = {
  aptos: ['Aptos', 'Aptos Narrow', 'Calibri'],
  'aptos display': ['Aptos Display', 'Aptos', 'Calibri'],
  calibri: ['Calibri', 'Carlito'],
  'calibri light': ['Calibri Light', 'Calibri', 'Carlito'],
  roboto: ['Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto light': ['Roboto Light', 'Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto medium': ['Roboto Medium', 'Roboto', 'Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans'],
  'roboto mono': ['Roboto Mono', 'Cascadia Mono', 'Consolas', 'Courier New', 'monospace'],
  'segoe ui': ['Segoe UI'],
  'segoe ui emoji': ['Segoe UI Emoji'],
  'segoe ui symbol': ['Segoe UI Symbol'],
  arial: ['Arial', 'Liberation Sans'],
  tahoma: ['Tahoma'],
  verdana: ['Verdana'],
  dengxian: ['DengXian', ...SIMPLIFIED_CHINESE_STACK],
  'dengxian light': ['DengXian Light', 'DengXian', ...SIMPLIFIED_CHINESE_STACK],
  '等线': ['DengXian', ...SIMPLIFIED_CHINESE_STACK],
  '等线 light': ['DengXian Light', 'DengXian', ...SIMPLIFIED_CHINESE_STACK],
  simsun: ['SimSun', ...SERIF_CHINESE_STACK],
  '宋体': ['SimSun', ...SERIF_CHINESE_STACK],
  simhei: ['SimHei', 'Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  '黑体': ['SimHei', 'Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  'microsoft yahei': ['Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  '微软雅黑': ['Microsoft YaHei', ...SIMPLIFIED_CHINESE_STACK],
  kaiti: ['KaiTi', 'STKaiti', ...SERIF_CHINESE_STACK],
  '楷体': ['KaiTi', 'STKaiti', ...SERIF_CHINESE_STACK],
  fangsong: ['FangSong', 'STFangsong', ...SERIF_CHINESE_STACK],
  '仿宋': ['FangSong', 'STFangsong', ...SERIF_CHINESE_STACK],
  meiryo: ['Meiryo', ...JAPANESE_STACK],
  'yu gothic': ['Yu Gothic', 'Yu Gothic UI', ...JAPANESE_STACK],
  '游ゴシック': ['Yu Gothic', 'Yu Gothic UI', ...JAPANESE_STACK],
  '游ゴシック light': ['Yu Gothic Light', 'Yu Gothic', ...JAPANESE_STACK],
  'ms pgothic': ['MS PGothic', ...JAPANESE_STACK],
  'ms pmincho': ['MS PMincho', 'Yu Mincho', 'Hiragino Mincho ProN'],
  'malgun gothic': ['Malgun Gothic', ...KOREAN_STACK],
  '맑은 고딕': ['Malgun Gothic', ...KOREAN_STACK],
  batang: ['Batang', 'AppleMyungjo', 'Noto Serif CJK KR'],
  wingdings: ['Wingdings'],
  'wingdings 2': ['Wingdings 2'],
  'wingdings 3': ['Wingdings 3'],
  webdings: ['Webdings']
};

function resolveKnownFontFallbacks(fontFamily: string, sampleText?: string): readonly string[] {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  if (shouldPreferProportionalFallbackForRobotoMono(normalized, sampleText)) {
    return [
      'Roboto Mono',
      'Roboto',
      'Segoe UI',
      'Arial',
      'Helvetica Neue',
      'Helvetica',
      'Liberation Sans',
      'Cascadia Mono',
      'Consolas',
      'Courier New',
      'monospace'
    ];
  }

  return Object.prototype.hasOwnProperty.call(KNOWN_FONT_FALLBACKS, normalized) ? KNOWN_FONT_FALLBACKS[normalized] : [];
}

function shouldPreferProportionalFallbackForRobotoMono(fontFamily: string, sampleText?: string): boolean {
  if (fontFamily !== 'roboto mono' || !sampleText?.trim()) {
    return false;
  }

  if (containsCjkText(sampleText)) {
    return true;
  }

  const wordCount = sampleText
    .trim()
    .split(/\s+/)
    .filter((token) => /[A-Za-z]/.test(token)).length;

  return wordCount >= 3 && !looksCodeLikeText(sampleText);
}

function looksCodeLikeText(text: string): boolean {
  return /[`{}[\]();=<>/\\]|::|->|=>|\b(func|class|const|let|var|return|package|import|export)\b/i.test(text);
}

function resolveScriptFallbacks(fontFamily: string, sampleText?: string): readonly string[] {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  if (containsAny(normalized, ['dengxian', '等线', 'yahei', '微软雅黑', 'simsun', '宋体', 'simhei', '黑体', 'kaiti', '楷体', 'fangsong', '仿宋'])) {
    return SIMPLIFIED_CHINESE_STACK;
  }
  if (containsAny(normalized, ['meiryo', 'yu gothic', '游ゴシック', 'ms pgothic', 'ms pmincho'])) {
    return JAPANESE_STACK;
  }
  if (containsAny(normalized, ['malgun gothic', '맑은 고딕', 'batang'])) {
    return KOREAN_STACK;
  }
  const inferred = inferScriptFallbacksFromText(sampleText);
  if (inferred) {
    return inferred;
  }
  return [];
}

function inferScriptFallbacksFromText(text: string | undefined): readonly string[] | undefined {
  if (!text) {
    return undefined;
  }
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return SIMPLIFIED_CHINESE_STACK;
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return JAPANESE_STACK;
  }
  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text)) {
    return KOREAN_STACK;
  }
  return undefined;
}

function isSymbolFont(fontFamily: string): boolean {
  const normalized = normalizeFontFamilyName(fontFamily).toLowerCase();
  return containsAny(normalized, ['wingdings', 'webdings', 'symbol']);
}

function shouldPreferSystemThemeFontStack(fontFamily: string): boolean {
  return OFFICE_THEME_NEUTRAL_FONTS.has(normalizeLocalizedFontAlias(fontFamily).toLowerCase());
}

function shouldUseNeutralThemeFallbackForText(sampleText?: string, contextText?: string): boolean {
  const text = sampleText?.trim();
  if (!text) {
    return true;
  }
  if (/^[\x20-\x7E]+$/.test(text) && /[A-Za-z]/.test(text)) {
    return true;
  }
  if (containsCjkText(text) && containsLatinText(text)) {
    return true;
  }
  return false;
}

function containsCjkText(text: string | undefined): boolean {
  return Boolean(text && /[\u4E00-\u9FFF]/.test(text));
}

function containsLatinText(text: string | undefined): boolean {
  return Boolean(text && /[A-Za-z]/.test(text));
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function quoteFontFamily(fontFamily: string): string {
  if (/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|cursive|fantasy|emoji|math|fangsong)$/i.test(fontFamily)) {
    return fontFamily;
  }
  if (/^[A-Za-z0-9_-]+$/.test(fontFamily)) {
    return fontFamily;
  }
  return `"${fontFamily.replace(/["\\]/g, '\\$&')}"`;
}

function resolveRequestedFontWeight(fontFamily: string | undefined, bold = false): string | undefined {
  if (bold) {
    return '700';
  }

  return resolveSyntheticFontWeight(fontFamily);
}

function resolveSyntheticFontWeight(fontFamily: string | undefined): string | undefined {
  const normalized = normalizeLocalizedFontAlias(fontFamily ?? '').toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const scale = resolveSyntheticFontWeightScale(normalized);
  if (scale == null) {
    return undefined;
  }

  if (isFontFamilyProbablyAvailable(fontFamily ?? normalized)) {
    return undefined;
  }

  return String(scaleSyntheticFontWeight(scale));
}

function resolveSyntheticFontWeightScale(normalizedFontFamily: string): number | undefined {
  for (const profile of SYNTHETIC_FONT_WEIGHT_PROFILES) {
    if (profile.pattern.test(normalizedFontFamily)) {
      return profile.scale;
    }
  }

  return undefined;
}

function scaleSyntheticFontWeight(scale: number): number {
  const scaled = BASE_SYNTHETIC_FONT_WEIGHT * scale;
  const clamped = Math.min(MAX_SYNTHETIC_FONT_WEIGHT, Math.max(MIN_SYNTHETIC_FONT_WEIGHT, scaled));
  return Math.round(clamped / SYNTHETIC_FONT_WEIGHT_STEP) * SYNTHETIC_FONT_WEIGHT_STEP;
}

function isFontFamilyProbablyAvailable(fontFamily: string): boolean {
  const candidates = Array.from(
    new Set([normalizeFontFamilyName(fontFamily), normalizeLocalizedFontAlias(fontFamily)].filter(shouldProbeFontFamily))
  );
  if (!candidates.length) {
    return true;
  }

  return candidates.some((candidate) => probeExactFontFamilyAvailability(candidate));
}

function shouldProbeFontFamily(fontFamily: string): boolean {
  const normalized = normalizeFontFamilyName(fontFamily);
  if (!normalized || normalized.includes(',')) {
    return false;
  }

  return !/^(serif|sans-serif|monospace|system-ui|ui-sans-serif|cursive|fantasy|emoji|math|fangsong)$/i.test(normalized);
}

function probeExactFontFamilyAvailability(fontFamily: string): boolean {
  // Fonts can be loaded or removed between renders. Keep probe results only
  // for this synchronous render, alongside its measurement canvas.
  const cache = textMeasurementScope && (textMeasurementScope.fontAvailability ??= new Map<string, boolean>());
  const cacheKey = normalizeFontFamilyName(fontFamily).toLowerCase();
  const cached = cache?.get(cacheKey);
  if (cached != null) {
    return cached;
  }

  const available = detectExactFontFamilyAvailability(fontFamily);
  cache?.set(cacheKey, available);
  return available;
}

function detectExactFontFamilyAvailability(fontFamily: string): boolean {
  const baselineFamilies = ['monospace', 'serif', 'sans-serif'] as const;
  const baselineWidths = textMeasurementScope?.baselineWidths ?? baselineFamilies.map((family) => measureFontAvailabilityWidth(family));
  if (textMeasurementScope) textMeasurementScope.baselineWidths = baselineWidths;
  if (baselineWidths.some((width) => width == null)) {
    return true;
  }

  return baselineFamilies.some((family, index) => {
    const width = measureFontAvailabilityWidth(`${quoteFontFamily(fontFamily)}, ${family}`);
    const baseline = baselineWidths[index];
    return width != null && baseline != null && Math.abs(width - baseline) > FONT_AVAILABILITY_EPSILON;
  });
}

function measureFontAvailabilityWidth(fontFamily: string): number | undefined {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return undefined;
  }

  try {
    const context = getTextMeasurementContext();
    if (!context) {
      return undefined;
    }

    context.font = `normal 400 ${FONT_AVAILABILITY_PROBE_SIZE}px ${fontFamily}`;
    return context.measureText(FONT_AVAILABILITY_PROBE_TEXT).width;
  } catch {
    return undefined;
  }
}

function resolveRequestedFontStyle(fontFamily: string | undefined, italic = false): string | undefined {
  if (italic) {
    return 'italic';
  }

  const normalized = normalizeFontFamilyName(fontFamily ?? '').toLowerCase();
  if (/\bitalic\b|\boblique\b/.test(normalized)) {
    return 'italic';
  }
  return undefined;
}

function resolveRunLetterSpacing(run: TextParagraph['runs'][number], contextText?: string): string | undefined {
  const text = run.text.replace(/[\n\t]/g, '').trim();
  if (text.length < 2 || /\s/.test(text)) {
    return undefined;
  }
  if (!/^[\x20-\x7E]+$/.test(text) || !/[A-Za-z]/.test(text)) {
    return undefined;
  }
  if (
    containsCjkText(contextText) &&
    contextText?.trim() !== text &&
    (contextText?.includes(`${text} `) || contextText?.includes(` ${text}`))
  ) {
    return undefined;
  }
  if ((run.fontSize ?? 0) < 16) {
    return undefined;
  }
  return '-0.04em';
}

function verticalAlignToFlex(value: TextFrame['verticalAlign']): string {
  switch (value) {
    case 'middle':
      return 'center';
    case 'bottom':
      return 'flex-end';
    default:
      return 'flex-start';
  }
}

function verticalAlignToTableCell(value: TextFrame['verticalAlign']): 'top' | 'middle' | 'bottom' {
  switch (value) {
    case 'middle':
      return 'middle';
    case 'bottom':
      return 'bottom';
    default:
      return 'top';
  }
}

export function fillToCss(fill: FillStyle): string {
  if (fill.type === 'none') {
    return 'transparent';
  }

  if (fill.type === 'picture') {
    return 'transparent';
  }

  if (fill.type === 'pattern') {
    return colorWithAlpha(fill.backgroundColor ?? '#FFFFFF', fill.backgroundAlpha);
  }

  if (fill.type === 'gradient' && fill.stops?.length) {
    const stops = gradientStopsToCss(fill.stops);
    if (fill.gradientType === 'path') {
      if (fill.gradientPath === 'rect') {
        const angle = normalizeCssGradientAngle(fill.angle ?? 0);
        return `linear-gradient(${Number(angle.toFixed(3))}deg, ${stops})`;
      }
      const origin = resolvePathGradientOrigin(fill);
      return `radial-gradient(circle${origin ? ` at ${origin.x}% ${origin.y}%` : ''}, ${stops})`;
    }

    const angle = normalizeCssGradientAngle(fill.angle ?? 0);
    return `linear-gradient(${Number(angle.toFixed(3))}deg, ${stops})`;
  }

  if (!fill.color) {
    return 'transparent';
  }

  return colorWithAlpha(fill.color, fill.alpha);
}

export function colorWithAlpha(color: string, alpha?: number): string {
  if (alpha == null) {
    return color;
  }

  const [r, g, b] = hexToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function linePaintColor(line: LineStyle | undefined): string {
  if (!line?.color || line.color === 'transparent') {
    return 'transparent';
  }

  if (line.alpha != null && line.alpha <= 0) {
    return 'transparent';
  }

  return colorWithAlpha(line.color, line.alpha);
}

function normalizeCssGradientAngle(angle: number): number {
  return ((90 - angle) % 360 + 360) % 360;
}

function gradientStopsToCss(stops: NonNullable<FillStyle['stops']>): string {
  return stops
    .map((stop) => `${colorWithAlpha(stop.color, stop.alpha)} ${Number((stop.position * 100).toFixed(3))}%`)
    .join(', ');
}

export function resolvePathGradientOrigin(fill: FillStyle): { x: number; y: number } | undefined {
  if (fill.type !== 'gradient' || fill.gradientType !== 'path') {
    return undefined;
  }

  const tileRect = fill.gradientTileRect;
  if (!tileRect) {
    return undefined;
  }

  const x = tileRect.left < 0 ? 0 : tileRect.right < 0 ? 100 : 50;
  const y = tileRect.top < 0 ? 0 : tileRect.bottom < 0 ? 100 : 50;

  if (x === 50 && y === 50) {
    return undefined;
  }

  return { x, y };
}

function patternFillToCssStyle(fill: PatternFillStyle): {
  color: string;
  image: string;
  size?: string;
  repeat?: string;
  position?: string;
} {
  const fg = colorWithAlpha(fill.foregroundColor ?? '#111827', fill.foregroundAlpha);
  const bg = colorWithAlpha(fill.backgroundColor ?? '#FFFFFF', fill.backgroundAlpha);

  switch (fill.pattern) {
    case 'horz':
      return {
        color: bg,
        image: `repeating-linear-gradient(180deg, ${fg} 0 2px, ${bg} 2px 8px)`
      };
    case 'vert':
      return {
        color: bg,
        image: `repeating-linear-gradient(90deg, ${fg} 0 2px, ${bg} 2px 8px)`
      };
    case 'ltDnDiag':
      return {
        color: bg,
        image: `repeating-linear-gradient(45deg, ${fg} 0 2px, ${bg} 2px 10px)`
      };
    case 'ltUpDiag':
      return {
        color: bg,
        image: `repeating-linear-gradient(135deg, ${fg} 0 2px, ${bg} 2px 10px)`
      };
    case 'diagCross':
      return {
        color: bg,
        image: `repeating-linear-gradient(45deg, ${fg} 0 2px, transparent 2px 10px), repeating-linear-gradient(135deg, ${fg} 0 2px, transparent 2px 10px)`
      };
    case 'smGrid':
      return {
        color: bg,
        image: `repeating-linear-gradient(0deg, ${fg} 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, ${fg} 0 1px, transparent 1px 8px)`
      };
    case 'lgGrid':
      return {
        color: bg,
        image: `repeating-linear-gradient(0deg, ${fg} 0 2px, transparent 2px 14px), repeating-linear-gradient(90deg, ${fg} 0 2px, transparent 2px 14px)`
      };
    case 'pct10':
      return dotPatternCssStyle(fg, bg, 5, 0.65);
    case 'pct20':
      return dotPatternCssStyle(fg, bg, 10, 1.75);
    case 'pct25':
      return dotPatternCssStyle(fg, bg, 9, 1.9);
    case 'pct30':
      return dotPatternCssStyle(fg, bg, 8, 2);
    case 'pct40':
      return dotPatternCssStyle(fg, bg, 8, 2.35);
    case 'pct50':
      return dotPatternCssStyle(fg, bg, 7, 2.4);
    case 'pct60':
      return dotPatternCssStyle(fg, bg, 6, 2.45);
    case 'pct70':
      return dotPatternCssStyle(fg, bg, 5, 2.55);
    case 'pct75':
      return dotPatternCssStyle(fg, bg, 5, 2.7);
    case 'pct80':
      return dotPatternCssStyle(fg, bg, 4, 2.75);
    case 'pct90':
      return dotPatternCssStyle(fg, bg, 4, 3);
    case 'pct5':
      return dotPatternCssStyle(fg, bg, 4, 0.45);
    case 'solidDmnd':
      return svgTileCssStyle(
        `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">
          <rect width="8" height="8" fill="${bg}"/>
          <polygon points="4,1.5 6.5,4 4,6.5 1.5,4" fill="${fg}"/>
        </svg>`,
        bg,
        8
      );
    default:
      return dotPatternCssStyle(fg, bg, 4, 0.45);
  }
}

function dotPatternCssStyle(
  foreground: string,
  background: string,
  size: number,
  radius: number
): {
  color: string;
  image: string;
  size: string;
  repeat: string;
  position: string;
} {
  return {
    color: background,
    image: `radial-gradient(circle, ${foreground} 0 ${radius}px, transparent ${radius}px)`,
    size: `${size}px ${size}px`,
    repeat: 'repeat',
    position: '0 0'
  };
}

function svgTileCssStyle(
  svg: string,
  background: string,
  size: number
): {
  color: string;
  image: string;
  size: string;
  repeat: string;
  position: string;
} {
  return {
    color: background,
    image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: `${size}px ${size}px`,
    repeat: 'repeat',
    position: '0 0'
  };
}

function applyTableCellBorderStyles(cellElement: HTMLTableCellElement, borders: TableCell['borders']): void {
  if (!borders) {
    return;
  }

  const borderMap = [
    ['top', borders.top],
    ['right', borders.right],
    ['bottom', borders.bottom],
    ['left', borders.left]
  ] as const;

  for (const [side, border] of borderMap) {
    if (!border) {
      continue;
    }

    cellElement.style.setProperty(`border-${side}`, lineStyleToBorder(border));
  }
}

export function lineStyleToBorder(line: LineStyle): string {
  const width = line.width ?? 1;
  const color = linePaintColor(line);
  if (width <= 0 || color === 'transparent') {
    return '0px solid transparent';
  }

  const style = lineCompoundToBorderStyle(line.compound) ?? lineDashToBorderStyle(line.dash);
  return `${Number(width.toFixed(3))}px ${style} ${color}`;
}

function lineCompoundToBorderStyle(
  compound: LineStyle['compound']
): 'solid' | 'dashed' | 'dotted' | 'double' | undefined {
  switch (compound) {
    case 'double':
    case 'thickThin':
    case 'thinThick':
    case 'triple':
      return 'double';
    default:
      return undefined;
  }
}

function lineDashToBorderStyle(dash: string | undefined): 'solid' | 'dashed' | 'dotted' {
  switch (dash) {
    case 'dot':
    case 'sysDot':
      return 'dotted';
    case 'dash':
    case 'sysDash':
    case 'lgDash':
    case 'dashDot':
    case 'sysDashDot':
    case 'lgDashDot':
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return 'dashed';
    default:
      return 'solid';
  }
}

export function applyLinkAttributes(
  anchor: HTMLAnchorElement,
  target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'> | Pick<TextFrame['paragraphs'][number]['runs'][number], 'href' | 'slideIndex' | 'navigationAction'>
): void {
  if (target.href && /^(?:javascript|vbscript|data):/i.test(target.href.replace(/[\u0000-\u0020\u007f]/g, ''))) {
    anchor.removeAttribute('href'); anchor.setAttribute('aria-disabled', 'true'); return;
  }
  anchor.href = target.href ?? (target.slideIndex != null ? `#slide-${target.slideIndex + 1}` : `#action-${target.navigationAction ?? 'link'}`);
  if (target.href) {
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.setAttribute('referrerpolicy', 'no-referrer');
  } else {
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    anchor.removeAttribute('referrerpolicy');
  }
  if (target.slideIndex != null) {
    anchor.dataset.slideIndex = String(target.slideIndex);
  }
  if (target.navigationAction) {
    anchor.dataset.slideAction = target.navigationAction;
  }
}

function resolveBulletLabel(paragraph: TextFrame['paragraphs'][number], autoNumberState: number[]): string {
  if (!paragraph.bullet) {
    return '';
  }

  if (paragraph.bullet.char) {
    return resolveSymbolBulletLabel(paragraph.bullet.char, paragraph.bullet.fontFamily);
  }

  if (!paragraph.bullet.autoType) {
    return '';
  }

  const level = Math.max(0, paragraph.level ?? 0);
  autoNumberState.length = level + 1;
  const startAt = Math.max(1, paragraph.bullet.startAt ?? 1);
  const current = autoNumberState[level] == null ? startAt : autoNumberState[level] + 1;
  autoNumberState[level] = current;
  return formatAutoNumber(current, paragraph.bullet.autoType);
}

function resolveBulletColor(paragraph: TextFrame['paragraphs'][number], fallbackColor: string): string {
  if (!paragraph.bullet) {
    return fallbackColor;
  }

  if (paragraph.bullet.color) {
    return colorWithAlpha(paragraph.bullet.color, paragraph.bullet.colorAlpha);
  }

  return fallbackColor;
}

function resolveBulletFontStack(paragraph: TextFrame['paragraphs'][number], label: string): string | undefined {
  if (!paragraph.bullet) {
    return undefined;
  }

  const fontFamily = paragraph.bullet.fontFamily;
  if (isPortableBulletGlyph(label) && !(embeddedFontAlias(fontFamily) && shouldApplyBulletFontFamily(paragraph, label))) {
    return buildPortableBulletFontStack(label);
  }

  if (!fontFamily || !shouldApplyBulletFontFamily(paragraph, label)) {
    return undefined;
  }

  return buildFontFamilyStack(fontFamily, {
    symbol: true,
    sampleText: label
  });
}

function shouldApplyBulletFontFamily(paragraph: TextFrame['paragraphs'][number], label: string): boolean {
  const fontFamily = paragraph.bullet?.fontFamily;
  if (!fontFamily) {
    return false;
  }

  const sourceChar = paragraph.bullet?.char;
  if (sourceChar && sourceChar !== label) {
    return false;
  }

  return !isPortableBulletGlyph(label) || !isSymbolFont(fontFamily);
}

function isPortableBulletGlyph(label: string): boolean {
  if (!label) {
    return false;
  }

  return /^[\u2022\u25A0-\u25FF\u2713-\u2714\u27A2\u2460-\u2473\u2474-\u2487\u2488-\u249B]+[.)、．。]?$/.test(label);
}

function buildPortableBulletFontStack(sampleText: string): string {
  return buildFontFamilyStack(SYMBOL_FONT_STACK[0], {
    symbol: true,
    sampleText
  });
}

function resolveStandaloneSymbolLabel(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed !== text) {
    return undefined;
  }
  if (isPortableBulletGlyph(trimmed) || isEmojiPresentationRun(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function resolveStandaloneSymbolFontStack(text: string, fontFamily: string | undefined): string | undefined {
  const label = resolveStandaloneSymbolLabel(text);
  if (!label) {
    return undefined;
  }
  if (fontFamily && embeddedFontAlias(fontFamily)) {
    return buildFontFamilyStack(fontFamily, { emoji: isEmojiPresentationRun(label), symbol: true, sampleText: label });
  }
  if (isEmojiPresentationRun(label)) {
    const emojiFamily = fontFamily && classifyPreviewFont(fontFamily).script === 'emoji' ? fontFamily : EMOJI_FONT_STACK[0];
    return buildFontFamilyStack(emojiFamily, { emoji: true, sampleText: label });
  }
  if (isPortableBulletGlyph(label) || isSymbolFont(fontFamily ?? '')) {
    return buildPortableBulletFontStack(label);
  }
  return undefined;
}

function isEmojiPresentationRun(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0xfe0f || codePoint === 0x200d) {
      return true;
    }
    if (codePoint >= 0x1f000) {
      return true;
    }
    if ((codePoint >= 0x2600 && codePoint <= 0x26ff) || (codePoint >= 0x2700 && codePoint <= 0x27bf)) {
      return text.includes('\uFE0F');
    }
  }
  return false;
}

function createCustomBulletVisual(label: string, fontSize: number): SVGSVGElement | undefined {
  return createCustomSymbolVisual(label, fontSize);
}

function createCustomSymbolVisual(label: string, fontSize: number): SVGSVGElement | undefined {
  const type = resolveCustomSymbolVisualType(label);
  if (!type) {
    return undefined;
  }

  const size = Number(Math.max(fontSize * 0.92, 12).toFixed(3));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.flex = '0 0 auto';
  svg.style.overflow = 'visible';

  const append = (node: SVGElement) => {
    node.setAttribute('fill', 'currentColor');
    svg.appendChild(node);
  };

  switch (type) {
    case 'square': {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '2');
      rect.setAttribute('y', '2');
      rect.setAttribute('width', '12');
      rect.setAttribute('height', '12');
      append(rect);
      break;
    }
    case 'circle': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '8');
      circle.setAttribute('cy', '8');
      circle.setAttribute('r', '6');
      append(circle);
      break;
    }
    case 'circleOutline': {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '8');
      circle.setAttribute('cy', '8');
      circle.setAttribute('r', '5.6');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', 'currentColor');
      circle.setAttribute('stroke-width', '1.65');
      svg.appendChild(circle);
      break;
    }
    case 'diamond': {
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '8,1.5 14.5,8 8,14.5 1.5,8');
      append(polygon);
      break;
    }
    case 'squareOutline': {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '2.25');
      rect.setAttribute('y', '2.25');
      rect.setAttribute('width', '11.5');
      rect.setAttribute('height', '11.5');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'currentColor');
      rect.setAttribute('stroke-width', '1.75');
      svg.appendChild(rect);
      break;
    }
    case 'check': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 2.5 8.5 L 6.4 12.2 L 13.5 3.6');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2.2');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      break;
    }
    case 'arrow': {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M 1.5 8 L 9.5 8 L 9.5 4.6 L 14.5 8 L 9.5 11.4 L 9.5 8.9 L 1.5 8.9 Z');
      append(path);
      break;
    }
  }

  return svg;
}

function resolveCustomSymbolVisualType(
  label: string
): 'square' | 'circle' | 'circleOutline' | 'diamond' | 'squareOutline' | 'check' | 'arrow' | undefined {
  switch (label) {
    case '\u25A0':
      return 'square';
    case '\u25CF':
      return 'circle';
    case '\u25CB':
      return 'circleOutline';
    case '\u25C6':
      return 'diamond';
    case '\u25A1':
      return 'squareOutline';
    case '\u2714':
      return 'check';
    case '\u27A2':
      return 'arrow';
    default:
      return undefined;
  }
}

function formatAutoNumber(value: number, type: string): string {
  switch (type) {
    case 'circleNumDbPlain':
      return formatCircledNumber(value);
    case 'ea1JpnChsDbPeriod':
      return `${toCjkCounting(value)}.`;
    case 'arabicPlain':
      return `${value}`;
    case 'arabicParenR':
      return `${value})`;
    case 'arabicParenBoth':
      return `(${value})`;
    case 'alphaLcParenR':
      return `${toAlpha(value).toLowerCase()})`;
    case 'alphaLcParenBoth':
      return `(${toAlpha(value).toLowerCase()})`;
    case 'alphaLcPeriod':
      return `${toAlpha(value).toLowerCase()}.`;
    case 'alphaUcParenR':
      return `${toAlpha(value)})`;
    case 'alphaUcParenBoth':
      return `(${toAlpha(value)})`;
    case 'alphaUcPeriod':
      return `${toAlpha(value)}.`;
    case 'romanLcParenR':
      return `${toRoman(value).toLowerCase()})`;
    case 'romanLcParenBoth':
      return `(${toRoman(value).toLowerCase()})`;
    case 'romanLcPeriod':
      return `${toRoman(value).toLowerCase()}.`;
    case 'romanUcParenR':
      return `${toRoman(value)})`;
    case 'romanUcParenBoth':
      return `(${toRoman(value)})`;
    case 'romanUcPeriod':
      return `${toRoman(value)}.`;
    case 'arabicPeriod':
    default:
      return `${value}.`;
  }
}

function resolveSymbolBulletLabel(char: string, fontFamily?: string): string {
  const normalizedFont = normalizeLocalizedFontAlias(fontFamily ?? '').toLowerCase();
  if (normalizedFont.includes('wingdings')) {
    return resolveWingdingsBullet(char);
  }
  if (normalizedFont.includes('webdings')) {
    return resolveWebdingsBullet(char);
  }

  return char;
}

function resolveWingdingsBullet(char: string): string {
  switch (char) {
    case 'n':
      return '\u25A0';
    case 'l':
      return '\u25CF';
    case 'u':
      return '\u25C6';
    case 'p':
      return '\u25A1';
    case '\u00FC':
      return '\u2714';
    case '\u00D8':
      return '\u27A2';
    default:
      return WINGDINGS_BULLET_MAP[char] ?? char;
  }
}

function resolveWebdingsBullet(char: string): string {
  switch (char) {
    case '8':
      return '\u2022';
    case '=':
      return '\u25A0';
    case '>':
      return '\u25C6';
    default:
      return WEBDINGS_BULLET_MAP[char] ?? char;
  }
}

const WINGDINGS_BULLET_MAP: Record<string, string> = {
  n: '■',
  l: '●',
  u: '◆',
  p: '□',
  'ü': '✓',
  Ø: '➔'
};

const WEBDINGS_BULLET_MAP: Record<string, string> = {
  '8': '•',
  '=': '■',
  '>': '◆'
};

function formatCircledNumber(value: number): string {
  const circledNumbers = [
    '',
    '①',
    '②',
    '③',
    '④',
    '⑤',
    '⑥',
    '⑦',
    '⑧',
    '⑨',
    '⑩',
    '⑪',
    '⑫',
    '⑬',
    '⑭',
    '⑮',
    '⑯',
    '⑰',
    '⑱',
    '⑲',
    '⑳'
  ];

  return circledNumbers[value] ?? `${value}`;
}

function toCjkCounting(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 0) {
    return `${value}`;
  }
  if (value < 10) {
    return digits[value];
  }
  if (value === 10) {
    return '十';
  }
  if (value < 20) {
    return `十${digits[value % 10]}`;
  }
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ''}`;
  }

  return `${value}`;
}

export function percent(value: number): string {
  return `${Number(value.toFixed(6))}%`;
}

function escapeCssUrl(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function toAlpha(value: number): string {
  let current = Math.max(1, Math.floor(value));
  let output = '';
  while (current > 0) {
    current -= 1;
    output = String.fromCharCode(65 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return output || 'A';
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];
  let current = Math.max(1, Math.floor(value));
  let output = '';
  for (const [amount, numeral] of numerals) {
    while (current >= amount) {
      output += numeral;
      current -= amount;
    }
  }
  return output || 'I';
}
