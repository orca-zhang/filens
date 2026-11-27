/// <reference lib="es2022.intl" />

import { formatChartDate, resolveChartDates } from '../chart-dates';
import type {
  ChartItem,
  ChartDateAxis,
  ChartLabelStyle,
  ChartSeries,
  ChartTextRun,
  ChartTextStyle,
  ChartTitleLayout,
  ChartValueAxis,
  CropBox,
  CustomShapePath,
  FillStyle,
  InsetBox,
  LineEndType,
  LineStyle,
  MediaItem,
  OleItem,
  ParsedPresentation,
  ShadowStyle,
  ShapeItem,
  SlideItem,
  SlideModel,
  TableCell,
  TextFrame
} from '@filens/core/presentation-support';
import {
  applyElementFillStyles,
  applyLinkAttributes,
  buildFontFamilyStack,
  chartLabelRuns,
  colorWithAlpha,
  estimateTextWidth,
  fillToCss,
  linePaintColor,
  MediaRegistry,
  lineStyleToBorder,
  percent,
  renderTableCellContent,
  renderTextFrame,
  resolvePathGradientOrigin,
  withTextMeasurementScope,
  type MediaResolver,
  type PatternFillStyle
} from '@filens/core/presentation-support';
import { getPptxEmbeddedFonts } from '../embedded-fonts';
import { createPresetShapeNode, resolvePresetShapeTextBounds } from './preset-geometry';

export interface RenderSlideOptions {
  className?: string;
  thumbnail?: boolean;
  mediaRegistry?: MediaResolver;
  translate?: (message: string) => string;
  openAttachment?: (id: string, trigger: HTMLElement) => void;
}

export function renderSlideToElement(
  slide: SlideModel,
  presentation: ParsedPresentation,
  options: RenderSlideOptions = {}
): HTMLElement {
  return withTextMeasurementScope(() => {
    const registry = options.mediaRegistry ?? new MediaRegistry(presentation);
    const root = document.createElement('div');
    root.className = ['pptxv-slide', options.thumbnail ? 'pptxv-slide--thumbnail' : '', options.className ?? '']
      .filter(Boolean)
      .join(' ');
    root.style.position = 'relative';
    root.style.width = `${slide.width}px`;
    root.style.height = `${slide.height}px`;
    applyElementFillStyles(root, slide.background, registry);

    for (const item of slide.items) {
      root.appendChild(renderItem(item, registry, options, slide.id));
    }

    return root;
  }, getPptxEmbeddedFonts(presentation)?.aliases);
}

function renderItem(item: SlideItem, registry: MediaResolver, options: RenderSlideOptions, slideId: string): HTMLElement {
  if (item.kind === 'text') {
    return renderTextItem(item, registry);
  }
  if (item.kind === 'shape') {
    return renderShapeItem(item, registry);
  }
  if (item.kind === 'image') {
    return renderImageItem(item.mediaId, item, registry);
  }
  if (item.kind === 'media') {
    return renderMediaItem(item, registry);
  }
  if (item.kind === 'ole') {
    return renderOleItem(item, registry, options, slideId);
  }
  if (item.kind === 'table') {
    return renderTableItem(item, registry);
  }
  if (item.kind === 'chart') {
    return renderChartItem(item, registry);
  }
  return renderUnsupportedItem(item.transform, item.label);
}

function resolveItemOpacity(item: SlideItem): number | undefined {
  const value = (item as SlideItem & { opacity?: number }).opacity;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function createItemBox(
  transform: SlideItem['transform'],
  className: string,
  opacity?: number
): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  element.style.left = `${transform.x}px`;
  element.style.top = `${transform.y}px`;
  element.style.width = `${Math.max(transform.width, 1)}px`;
  element.style.height = `${Math.max(transform.height, 1)}px`;
  element.style.position = 'absolute';
  element.style.transformOrigin = 'center center';
  const transforms: string[] = [];
  if (transform.flipH) {
    transforms.push('scaleX(-1)');
  }
  if (transform.flipV) {
    transforms.push('scaleY(-1)');
  }
  if (transform.rotation) {
    transforms.push(`rotate(${transform.rotation}deg)`);
  }
  if (transforms.length) {
    element.style.transform = transforms.join(' ');
  }
  if (opacity != null) {
    element.style.opacity = String(opacity);
  }
  return element;
}

function renderTextItem(item: Extract<SlideItem, { kind: 'text' }>, registry: MediaResolver): HTMLElement {
  const autoWidth = item.transform.width <= 0;
  const autoHeight = item.transform.height <= 0;
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--text', resolveItemOpacity(item));
  if (autoWidth || autoHeight) {
    applyAutoTextBoxStyles(element, autoWidth, autoHeight);
  }
  if (item.placeholder?.type) {
    element.dataset.placeholderType = item.placeholder.type;
  }
  if (item.placeholder?.idx) {
    element.dataset.placeholderIdx = item.placeholder.idx;
  }
  applyTextOverflowStyles(element, item.textFrame);
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);
  const textFrame = renderTextFrame(item.textFrame, primaryFillColor(item.fill) ?? '#111827', {
    omitPlaceholderBulletLabels: Boolean(item.placeholder?.type),
    availableWidth: autoWidth ? undefined : item.transform.width,
    availableHeight: autoHeight ? undefined : item.transform.height
  });
  if (autoWidth) {
    textFrame.style.width = 'auto';
  }
  if (autoHeight) {
    textFrame.style.height = 'auto';
  }
  if (item.fill.type === 'picture') {
    textFrame.style.position = 'relative';
    textFrame.style.zIndex = '1';
  }
  element.appendChild(textFrame);
  appendItemLinkOverlay(element, item, !hasLinkedTextRuns(item.textFrame));
  return element;
}

function applyAutoTextBoxStyles(element: HTMLElement, autoWidth: boolean, autoHeight: boolean): void {
  if (autoWidth) {
    element.style.width = 'auto';
    element.style.minWidth = 'fit-content';
  }
  if (autoHeight) {
    element.style.height = 'auto';
  }

  const translateX = autoWidth ? '-50%' : '0';
  const translateY = autoHeight ? '-50%' : '0';
  const existingTransform = element.style.transform;
  element.style.transform = [`translate(${translateX}, ${translateY})`, existingTransform].filter(Boolean).join(' ');
  element.style.transformOrigin = '0 0';
}

function renderShapeItem(item: ShapeItem, registry: MediaResolver): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--shape', resolveItemOpacity(item));
  element.dataset.shapeType = item.shapeType;
  if (item.placeholder?.type) {
    element.dataset.placeholderType = item.placeholder.type;
  }
  if (item.placeholder?.idx) {
    element.dataset.placeholderIdx = item.placeholder.idx;
  }
  applyItemShadowStyles(element, item.shadow);
  const bleed = computeShapeBleed(item);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute(
    'viewBox',
    `${-bleed} ${-bleed} ${Math.max(item.transform.width, 1) + bleed * 2} ${Math.max(item.transform.height, 1) + bleed * 2}`
  );
  svg.setAttribute('width', `${Math.max(item.transform.width, 1) + bleed * 2}`);
  svg.setAttribute('height', `${Math.max(item.transform.height, 1) + bleed * 2}`);
  svg.setAttribute('overflow', 'visible');
  svg.style.position = 'absolute';
  svg.style.left = `${-bleed}px`;
  svg.style.top = `${-bleed}px`;
  svg.style.pointerEvents = 'none';
  svg.classList.add('pptxv-shape-svg');
  const shapeResult = createShapeNode(item, registry);
  if (shapeResult.defs.length) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    for (const definition of shapeResult.defs) {
      defs.appendChild(definition);
    }
    svg.appendChild(defs);
  }
  svg.appendChild(shapeResult.node);
  element.appendChild(svg);

  if (item.textFrame && hasVisibleText(item.textFrame)) {
    const overlay = renderTextFrame(item.textFrame, item.line?.color ?? '#111827', {
      omitPlaceholderBulletLabels: Boolean(item.placeholder?.type)
    });
    overlay.classList.add('pptxv-shape-text');
    applyShapeTextBounds(overlay, item);
    element.appendChild(overlay);
  }

  appendItemLinkOverlay(element, item, !item.textFrame || !hasLinkedTextRuns(item.textFrame));

  return element;
}

function applyShapeTextBounds(element: HTMLElement, item: ShapeItem): void {
  element.style.position = 'absolute';

  const customBounds = item.geometry?.type === 'custom' ? item.textBounds : undefined;
  const bounds = customBounds ?? resolveShapeTextBounds(item);
  const boxWidth = Math.max(1, item.transform.width - bounds.left - bounds.right);
  const boxHeight = Math.max(1, item.transform.height - bounds.top - bounds.bottom);

  element.style.left = `${bounds.left}px`;
  element.style.right = '';
  element.style.width = `${boxWidth}px`;
  element.style.height = 'auto';
  element.style.maxHeight = `${boxHeight}px`;
  element.style.bottom = '';
  element.style.transform = '';

  if (item.textFrame?.verticalAlign === 'middle' || (!customBounds && item.placeholder?.type === 'title')) {
    const center = customBounds ? bounds.top + boxHeight / 2 : item.transform.height / 2;
    element.style.top = `${Number(center.toFixed(3))}px`;
    element.style.transform = 'translateY(-50%)';
    return;
  }

  if (item.textFrame?.verticalAlign === 'bottom') {
    element.style.top = '';
    element.style.bottom = `${bounds.bottom}px`;
    return;
  }

  element.style.top = `${bounds.top}px`;
}

function resolveShapeTextBounds(item: ShapeItem): { left: number; top: number; right: number; bottom: number } {
  if (shouldUseReferenceFullBoxShapeTextBounds(item)) {
    return scaleInsetBox(item.transform.width, item.transform.height, 0, 0, 0, 0);
  }

  const resolved =
    item.textBounds ??
    (item.geometry?.type === 'preset'
      ? resolvePresetShapeTextBounds(item.shapeType, {
          width: item.transform.width,
          height: item.transform.height,
          adjustments: item.geometry.adjustments
        })
      : undefined);
  if (resolved) {
    return applyShapeTextInsetCompensation(item, normalizeInsetBox(resolved));
  }

  const width = item.transform.width;
  const height = item.transform.height;
  const defaultInset = scaleInsetBox(width, height, 0.08, 0.08, 0.08, 0.08);
  let fallbackBounds: { left: number; top: number; right: number; bottom: number };

  switch (item.shapeType) {
    case 'ellipse':
      // The reference preview keeps ellipse text spanning the full shape box
      // and relies on bodyPr padding + vertical centering instead of a
      // conservative circular safe area.
      fallbackBounds = scaleInsetBox(width, height, 0, 0, 0, 0);
      break;
    case 'diamond':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.16, 0.18, 0.16);
      break;
    case 'hexagon':
    case 'octagon':
    case 'decagon':
    case 'dodecagon':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.12, 0.16, 0.12);
      break;
    case 'pentagon':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.2, 0.14, 0.08);
      break;
    case 'heptagon':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.14, 0.14, 0.12);
      break;
    case 'triangle':
    case 'rtTriangle':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.3, 0.16, 0.08);
      break;
    case 'trapezoid':
    case 'parallelogram':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.12, 0.18, 0.12);
      break;
    case 'chevron':
      fallbackBounds = scaleInsetBox(width, height, 0.12, 0.12, 0.2, 0.12);
      break;
    case 'rightArrow':
    case 'stripedRightArrow':
    case 'notchedRightArrow':
    case 'rightArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.08, 0.16, 0.3, 0.16);
      break;
    case 'leftArrow':
    case 'leftArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.3, 0.16, 0.08, 0.16);
      break;
    case 'upArrow':
    case 'upArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.28, 0.16, 0.1);
      break;
    case 'downArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.1, 0.16, 0.28);
      break;
    case 'leftRightArrow':
    case 'leftRightArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.24, 0.16, 0.24, 0.16);
      break;
    case 'upDownArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.16, 0.24, 0.16, 0.24);
      break;
    case 'quadArrow':
    case 'quadArrowCallout':
      fallbackBounds = scaleInsetBox(width, height, 0.24, 0.24, 0.24, 0.24);
      break;
    case 'bentArrow':
    case 'bentUpArrow':
    case 'uturnArrow':
    case 'leftUpArrow':
    case 'leftRightUpArrow':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.2, 0.18, 0.18);
      break;
    case 'homePlate':
      fallbackBounds = scaleInsetBox(width, height, 0.08, 0.12, 0.22, 0.12);
      break;
    case 'plaque':
    case 'cloud':
    case 'smileyFace':
    case 'bevel':
    case 'can':
      fallbackBounds = scaleInsetBox(width, height, 0.14, 0.14, 0.14, 0.14);
      break;
    case 'pie':
    case 'chord':
    case 'donut':
      fallbackBounds = scaleInsetBox(width, height, 0.18, 0.18, 0.18, 0.18);
      break;
    case 'frame':
    case 'halfFrame':
    case 'corner':
    case 'diagStripe':
    case 'plus':
    case 'noSmoking':
    case 'arc':
    case 'line':
      fallbackBounds = defaultInset;
      break;
    default:
      fallbackBounds = defaultInset;
      break;
  }

  return applyShapeTextInsetCompensation(item, fallbackBounds);
}

const REFERENCE_FULL_BOX_SHAPE_TEXT_TYPES = new Set<ShapeItem['shapeType']>([
  'rect',
  'roundRect',
  'ellipse',
  'snip1Rect',
  'snip2SameRect',
  'snip2DiagRect',
  'snipRoundRect',
  'round1Rect',
  'round2SameRect',
  'round2DiagRect'
]);

function shouldUseReferenceFullBoxShapeTextBounds(item: ShapeItem): boolean {
  if (item.geometry?.type === 'custom') {
    return true;
  }
  return REFERENCE_FULL_BOX_SHAPE_TEXT_TYPES.has(item.shapeType);
}

function applyShapeTextInsetCompensation(item: ShapeItem, bounds: InsetBox): InsetBox {
  const strokeInset = resolveShapeTextStrokeInset(item);
  if (strokeInset <= 0) {
    return bounds;
  }

  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const maxHorizontalInset = Math.max((width - 1) / 2, 0);
  const maxVerticalInset = Math.max((height - 1) / 2, 0);

  return normalizeInsetBox({
    left: Math.min(bounds.left + strokeInset, maxHorizontalInset),
    top: Math.min(bounds.top + strokeInset, maxVerticalInset),
    right: Math.min(bounds.right + strokeInset, maxHorizontalInset),
    bottom: Math.min(bounds.bottom + strokeInset, maxVerticalInset)
  });
}

function resolveShapeTextStrokeInset(item: ShapeItem): number {
  const strokeWidth = Math.max(item.line?.width ?? 0, 0);
  if (strokeWidth <= 2 || item.shapeType === 'line') {
    return 0;
  }

  return Number(Math.min(Math.max((strokeWidth - 2) * 0.45, 0), 8).toFixed(3));
}

function normalizeInsetBox(bounds: InsetBox): InsetBox {
  return {
    left: Number(Math.max(bounds.left, 0).toFixed(3)),
    top: Number(Math.max(bounds.top, 0).toFixed(3)),
    right: Number(Math.max(bounds.right, 0).toFixed(3)),
    bottom: Number(Math.max(bounds.bottom, 0).toFixed(3))
  };
}

function scaleInsetBox(
  width: number,
  height: number,
  leftRatio: number,
  topRatio: number,
  rightRatio: number,
  bottomRatio: number
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Number((width * leftRatio).toFixed(3)),
    top: Number((height * topRatio).toFixed(3)),
    right: Number((width * rightRatio).toFixed(3)),
    bottom: Number((height * bottomRatio).toFixed(3))
  };
}

function renderImageItem(
  mediaId: string,
  item: Extract<SlideItem, { kind: 'image' }>,
  registry: MediaResolver
): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--image', resolveItemOpacity(item));
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);
  const image = document.createElement('img');
  image.className = 'pptxv-image';
  image.src = registry.getUrl(mediaId);
  image.alt = item.name ?? 'slide-image';
  applyFramedMediaLayout(element, image, item.crop, 'contain');
  image.draggable = false;
  element.appendChild(image);
  appendItemLinkOverlay(element, item, true);
  return element;
}

function renderOleItem(item: OleItem, registry: MediaResolver, options: RenderSlideOptions, slideId: string): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--ole');
  const name = item.name ?? item.programId ?? '';
  element.dataset.oleName = name;
  const fallback = document.createElement('span');
  fallback.className = 'pptxv-ole-label';
  element.appendChild(fallback);
  const poster = createPosterImage(item.posterMediaId, name, registry);
  const attachmentId = item.attachmentId;
  const open = options.thumbnail ? undefined : options.openAttachment;
  if (poster) {
    fallback.hidden = true;
    poster.className = 'pptxv-image';
    if (item.opacity !== undefined) poster.style.opacity = String(item.opacity);
    applyFramedMediaLayout(element, poster, item.crop, 'fill');
    poster.addEventListener('error', () => {
      poster.remove();
      fallback.hidden = false;
    }, { once: true });
    element.prepend(poster);
  }
  if (open && attachmentId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pptxv-ole-open';
    button.id = `pptxv-${slideId}-${item.id}-attachment`;
    button.append(document.createElement('span'));
    button.addEventListener('click', () => open(attachmentId, button));
    element.appendChild(button);
  }
  translateOleItem(element, options.translate ?? (message => message));
  return element;
}

export function translateOleItem(element: HTMLElement, translate: (message: string) => string): void {
  const name = element.dataset.oleName || translate('Embedded object');
  const fallback = element.querySelector('.pptxv-ole-label');
  if (fallback) fallback.textContent = name;
  const button = element.querySelector('.pptxv-ole-open');
  if (button) {
    const action = translate('Open attachment');
    button.setAttribute('aria-label', element.dataset.oleName ? `${action} · ${name}` : action);
    button.firstElementChild!.textContent = action;
  } else {
    element.querySelector('img')?.setAttribute('alt', name);
  }
}

function renderMediaItem(item: MediaItem, registry: MediaResolver): HTMLElement {
  const element = createItemBox(
    item.transform,
    `pptxv-item pptxv-item--media pptxv-item--media-${item.mediaType}`,
    resolveItemOpacity(item)
  );
  element.dataset.mediaType = item.mediaType;
  applyItemSurfaceStyles(element, item.fill, item.line, registry);
  applyItemShadowStyles(element, item.shadow);

  if (item.mediaType === 'video') {
    element.appendChild(renderVideoMediaStage(item, registry));
  } else {
    element.style.width = '0px';
    element.style.height = '0px';
    element.style.overflow = 'visible';
    const audio = document.createElement('audio');
    audio.className = 'pptxv-media-player pptxv-media-player--audio';
    configureMediaElement(audio, item.mediaId, registry);
    audio.style.position = 'absolute';
    audio.style.left = '0px';
    audio.style.top = '0px';
    audio.style.transform = 'translate(-50%)';
    audio.style.zIndex = '1';
    element.appendChild(audio);
  }

  return element;
}

function renderVideoMediaStage(item: MediaItem, registry: MediaResolver): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'pptxv-media-stage';

  const posterFrame = document.createElement('div');
  posterFrame.className = 'pptxv-media-poster-frame';
  applyVideoFrameLayout(posterFrame, item.transform);

  const poster = createPosterImage(item.posterMediaId, item.name ?? 'video-poster', registry);
  if (poster) {
    poster.className = 'pptxv-media-poster pptxv-media-poster--video';
    applyVideoPosterLayout(posterFrame, poster, item.crop);
    posterFrame.appendChild(poster);
    stage.appendChild(posterFrame);
  }

  const video = document.createElement('video');
  video.className = 'pptxv-media-player pptxv-media-player--video';
  configureMediaElement(video, item.mediaId, registry, true);
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  applyVideoElementLayout(video, item.transform, item.crop);
  stage.appendChild(video);

  return stage;
}

function createPosterImage(mediaId: string | undefined, alt: string, registry: MediaResolver): HTMLImageElement | null {
  if (!mediaId) {
    return null;
  }

  const url = registry.getUrl(mediaId);
  if (!url) {
    return null;
  }

  const poster = document.createElement('img');
  poster.src = url;
  poster.alt = '';
  poster.draggable = false;
  return poster;
}

function configureMediaElement(
  element: HTMLAudioElement | HTMLVideoElement,
  mediaId: string,
  registry: MediaResolver,
  showNativeControls = true
): void {
  const url = registry.getUrl(mediaId);
  if (url) {
    element.src = url;
    element.setAttribute('src', url);
  }
  element.controls = showNativeControls;
  if (showNativeControls) {
    element.setAttribute('controls', '');
  } else {
    element.removeAttribute('controls');
  }
  element.preload = 'metadata';
  element.setAttribute('preload', 'metadata');
}

function applyFramedMediaLayout(
  container: HTMLElement,
  mediaElement: HTMLElement,
  crop: CropBox | undefined,
  objectFit: 'contain' | 'fill'
): void {
  if (crop) {
    const visibleWidth = Math.max(1 - crop.left - crop.right, 0.0001);
    const visibleHeight = Math.max(1 - crop.top - crop.bottom, 0.0001);
    container.style.overflow = 'hidden';
    mediaElement.style.position = 'absolute';
    mediaElement.style.width = percent(100 / visibleWidth);
    mediaElement.style.height = percent(100 / visibleHeight);
    mediaElement.style.maxWidth = 'none';
    mediaElement.style.maxHeight = 'none';
    mediaElement.style.left = percent((-crop.left / visibleWidth) * 100);
    mediaElement.style.top = percent((-crop.top / visibleHeight) * 100);
    mediaElement.style.objectFit = 'fill';
    return;
  }

  mediaElement.style.width = '100%';
  mediaElement.style.height = '100%';
  mediaElement.style.objectFit = objectFit;
}

function applyVideoFrameLayout(frame: HTMLElement, transform: MediaItem['transform']): void {
  frame.style.position = 'absolute';
  frame.style.left = '0px';
  frame.style.top = '0px';
  frame.style.width = `${Number(transform.width.toFixed(3))}px`;
  frame.style.height = `${Number(transform.height.toFixed(3))}px`;
  frame.style.overflow = 'hidden';
}

function applyVideoPosterLayout(
  frame: HTMLElement,
  poster: HTMLImageElement,
  crop: Extract<MediaItem, { kind: 'media' }>['crop']
): void {
  if (crop) {
    applyFramedMediaLayout(frame, poster, crop, 'fill');
    return;
  }

  poster.style.width = '100%';
  poster.style.height = '100%';
}

function applyVideoElementLayout(
  video: HTMLVideoElement,
  transform: MediaItem['transform'],
  crop: Extract<MediaItem, { kind: 'media' }>['crop']
): void {
  video.style.position = 'absolute';
  video.style.left = '0px';
  video.style.top = '0px';

  if (crop) {
    const visibleWidth = Math.max(1 - crop.left - crop.right, 0.0001);
    const visibleHeight = Math.max(1 - crop.top - crop.bottom, 0.0001);
    video.style.width = percent(100 / visibleWidth);
    video.style.height = percent(100 / visibleHeight);
    video.style.maxWidth = 'none';
    video.style.maxHeight = 'none';
    video.style.left = percent((-crop.left / visibleWidth) * 100);
    video.style.top = percent((-crop.top / visibleHeight) * 100);
    return;
  }

  const width = Math.max(1, Math.round(transform.width));
  const height = Math.max(1, Math.round(transform.height));
  video.width = width;
  video.height = height;
  video.setAttribute('width', String(width));
  video.setAttribute('height', String(height));
}

function renderTableItem(item: Extract<SlideItem, { kind: 'table' }>, registry: MediaResolver): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--table');
  applyItemShadowStyles(element, item.shadow);
  const table = document.createElement('table');
  table.className = 'pptxv-table';
  if (item.autoFitRows) {
    element.style.height = 'auto';
    table.style.height = 'auto';
  }
  const hiddenColumns = new Set(item.hiddenColumns ?? []);
  const hiddenRows = new Set(item.hiddenRows ?? []);
  const columnSizes = fitTableTrackSizes(item.columns, item.transform.width, hiddenColumns);
  const rowSizes = item.autoFitRows ? item.rows : fitTableTrackSizes(item.rows, item.transform.height, hiddenRows);
  const cellsByRow = new Map<number, TableCell[]>();
  for (const cell of item.cells) {
    const cells = cellsByRow.get(cell.row) ?? [];
    cells.push(cell);
    cellsByRow.set(cell.row, cells);
  }

  const colgroup = document.createElement('colgroup');
  for (let columnIndex = 0; columnIndex < item.columns.length; columnIndex += 1) {
    const width = columnSizes[columnIndex] ?? 1;
    const col = document.createElement('col');
    if (hiddenColumns.has(columnIndex)) {
      col.style.width = '0px';
      col.style.visibility = 'collapse';
    } else {
      col.style.width = `${Math.max(width, 1)}px`;
    }
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);

  const body = document.createElement('tbody');
  for (let rowIndex = 0; rowIndex < item.rows.length; rowIndex += 1) {
    const row = document.createElement('tr');
    if (hiddenRows.has(rowIndex)) {
      row.style.height = '0px';
      row.style.visibility = 'collapse';
    } else {
      row.style.height = `${rowSizes[rowIndex] ?? 1}px`;
    }

    const rowCells = cellsByRow.get(rowIndex)?.sort((left, right) => left.column - right.column) ?? [];
    for (const cell of rowCells) {
      if (cell.isMergedContinuation) {
        continue;
      }
      row.appendChild(renderTableCell(cell, registry, item.autoFitRows));
    }

    body.appendChild(row);
  }

  table.appendChild(body);
  element.appendChild(table);
  appendItemLinkOverlay(element, item, !tableHasLinkedRuns(item));
  return element;
}

function fitTableTrackSizes(sizes: number[], targetSize: number, hiddenIndexes: Set<number>): number[] {
  const visibleSizes = sizes.map((size, index) => (hiddenIndexes.has(index) ? 0 : Math.max(size, 1)));
  const total = visibleSizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isFinite(targetSize) || targetSize <= 0 || total <= 0) {
    return visibleSizes;
  }
  const scale = targetSize / total;
  return visibleSizes.map((size) => size * scale);
}

function renderTableCell(cell: TableCell, registry: MediaResolver, autoFit = false): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'pptxv-table-cell';
  td.rowSpan = cell.rowSpan;
  td.colSpan = cell.colSpan;
  td.style.position = 'relative';
  td.style.overflow = 'hidden';
  const textFrame = renderTableCellContent(td, cell, registry);
  if (autoFit) {
    textFrame.style.position = 'relative';
    textFrame.style.height = 'auto';
  } else {
    textFrame.style.position = 'absolute';
    textFrame.style.inset = '0';
  }
  return td;
}

interface ChartPlotBounds {
  width: number;
  height: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  rightAxisWidth: number;
  legendSideWidth: number;
}

const CHART_LABELS = {
  column: 'Column chart', bar: 'Bar chart', pie: 'Pie chart', doughnut: 'Doughnut chart', line: 'Line chart',
  area: 'Area chart', combo: 'Combination chart', scatter: 'Scatter chart', bubble: 'Bubble chart'
};

const CHART_TITLE_FLOWS = {
  eaVert: { writingMode: 'vertical-rl', textOrientation: 'mixed' },
  mongolianVert: { writingMode: 'vertical-lr', textOrientation: 'mixed' },
  wordArtVert: { writingMode: 'vertical-lr', textOrientation: 'upright' },
  wordArtVertRtl: { writingMode: 'vertical-rl', textOrientation: 'upright' }
} as const;
type ChartTitleFlow = (typeof CHART_TITLE_FLOWS)[keyof typeof CHART_TITLE_FLOWS];
const CHART_TITLE_LINE_SPACING = 1.12;
let chartTitleGraphemes: Intl.Segmenter | undefined;
let chartFillId = 0;

function renderChartItem(item: ChartItem, registry: MediaResolver): HTMLElement {
  const element = createItemBox(item.transform, 'pptxv-item pptxv-item--chart');
  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('pptxv-chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', item.title ?? item.name ?? CHART_LABELS[item.chartType]);
  applyChartTextStyle(svg, item.textStyle);

  const seriesPaints = new Map<number, string>();
  const defs = createChartSvgNode('defs', {});
  item.series.forEach((series, index) => {
    if (!series.fill) return;
    const fill = createSvgFill(`pptx-chart-${++chartFillId}`, series.fill, registry, width, height);
    seriesPaints.set(index, fill.paint);
    defs.append(...fill.defs);
  });
  if (defs.hasChildNodes()) svg.appendChild(defs);

  const circular = item.chartType === 'pie' || item.chartType === 'doughnut';
  const legendPosition = item.legendPosition ?? 'right';
  const titleSize = item.titleStyle?.fontSize ?? item.textStyle?.fontSize ?? Math.max(12, height * 0.047);
  const titleLineSizes = chartTitleLineSizes(item.titleLines, titleSize);
  const titleBlockSize = titleLineSizes.reduce((sum, size) => sum + size * CHART_TITLE_LINE_SPACING, 0);
  const titleTop = height * 0.02;
  const plotTopLimit = height * 0.6;
  const plotTopGap = height * 0.035;
  const titleRotation = item.titleLayout?.rotation ?? 0;
  const titlePosition = item.titleLayout?.position;
  const titleFlow = item.titleLayout?.verticalText ? CHART_TITLE_FLOWS[item.titleLayout.verticalText] : undefined;
  const titleBounds = item.title && (titleRotation || titlePosition || titleFlow) ? measureChartTitle(
    item.title, item.titleLines, { ...item.textStyle, ...item.titleStyle }, titleSize, titleBlockSize, titleRotation, titleFlow
  ) : undefined;
  const legendBottomHeight = legendPosition === 'bottom' ? height * 0.15 : 0;
  const legendTopHeight = legendPosition === 'top' ? height * 0.13 : 0;
  const availableTitleHeight = item.titleLayout?.overlay ? height - titleTop * 2 : plotTopLimit - titleTop - legendTopHeight - plotTopGap;
  const titleScale = titleFlow && titleBounds && !titlePosition ? Math.min(1,
    width * 0.96 / Math.max(1, titleBounds.width), availableTitleHeight / Math.max(1, titleBounds.height)
  ) : 1;
  const titleHeight = item.title && !item.titleLayout?.overlay
    ? Math.max(height * 0.13, titleTop + (titleBounds?.height ?? titleBlockSize) * titleScale) : height * 0.04;
  const legendStyle = { ...item.textStyle, ...item.legendStyle };
  const legendSize = legendStyle.fontSize ?? Math.max(9, height * 0.036);
  const sideLegend = legendPosition === 'left' || legendPosition === 'right';
  let legendSideWidth = sideLegend ? width * 0.2 : 0;
  if (sideLegend && (legendStyle.scriptFonts?.eastAsia || legendStyle.scriptFonts?.complex)) {
    const labels = circular ? item.categories.slice(0, item.series[0]?.values.length ?? 0) : item.series.map(series => series.name);
    const measured = labels.reduce(
      (largest, label) => Math.max(largest, measureChartLabel(label, legendSize, legendStyle)), 0
    );
    const needed = measured + Math.max(8, legendSize * 0.9) * 1.35 + width * 0.025;
    legendSideWidth = Math.max(legendSideWidth, Math.min(width * 0.42, needed));
  }
  const rightAxisWidth = item.secondaryValueAxis && !item.secondaryValueAxis.hidden ? width * 0.13 : 0;
  const categoryStyle = { ...item.textStyle, ...item.categoryAxis?.textStyle };
  const categoryLabelWidth = item.chartType === 'bar' && !item.categoryAxis?.hidden
    ? Math.min(width * 0.4, item.categories.reduce((largest, text) => Math.max(largest, measureChartLabel(
        text, categoryStyle.fontSize ?? Math.max(10, height * 0.042), categoryStyle
      )), 0) + 20)
    : 0;
  const plotLeft = Math.max(categoryLabelWidth, width * (circular ? 0.04 : 0.125)) + (legendPosition === 'left' ? legendSideWidth : 0);
  const plotRight = width - width * (circular ? 0.04 : 0.068) - rightAxisWidth - (legendPosition === 'right' ? legendSideWidth : 0);
  const plotTop = Math.min(plotTopLimit, Math.max(height * 0.08, titleHeight + legendTopHeight + plotTopGap));
  const plotBottom = height - height * 0.08 - legendBottomHeight;
  const bounds = { width, height, plotLeft, plotRight, plotTop, plotBottom, rightAxisWidth, legendSideWidth };
  if (circular) {
    renderCircularChart(svg, item, bounds);
  } else if (item.chartType === 'scatter' || item.chartType === 'bubble') {
    renderXYChart(svg, item, bounds);
  } else {
    renderCartesianChart(svg, item, bounds, seriesPaints);
  }
  renderChartLegend(svg, item, bounds, seriesPaints);
  if (item.title) {
    const title = createChartSvgNode('g', {});
    title.classList.add('pptxv-chart-title');
    applyChartTextStyle(title, item.titleStyle);
    if (titleBounds) {
      const x = chartTitleCenter(titlePosition?.x, width / 2, width, titleBounds.width * titleScale);
      const scaledHeight = titleBounds.height * titleScale;
      const y = chartTitleCenter(titlePosition?.y, titleTop + scaledHeight / 2, height, scaledHeight);
      title.setAttribute('transform', `translate(${x} ${y}) rotate(${titleRotation}) scale(${titleScale})`);
      appendChartTitleRows(title, item.title, item.titleLines, titleLineSizes, titleSize, 0, -titleBlockSize / 2, titleFlow);
    } else {
      appendChartTitleRows(title, item.title, item.titleLines, titleLineSizes, titleSize, width / 2, titleTop);
    }
    svg.appendChild(title);
  }
  element.appendChild(svg);
  appendItemLinkOverlay(element, item, true);
  return element;
}

function chartTitleLineSizes(lines: ChartTextRun[][] | undefined, fontSize: number): number[] {
  return lines?.length ? lines.map(line =>
    line.reduce((largest, run) => Math.max(largest, run.fontSize ?? fontSize), line.length ? 0 : fontSize)
  ) : [fontSize];
}

function measureChartTitle(
  text: string, lines: ChartTextRun[][] | undefined, defaults: ChartTextStyle, fontSize: number, blockSize: number,
  rotation: number, flow?: ChartTitleFlow
) {
  const inlineSize = (lines?.length ? lines : [[{ text }]]).reduce(
    (maximum, row) => Math.max(maximum, row.reduce((sum, run) => {
      const style = { ...defaults, ...run };
      if (flow?.textOrientation === 'upright') {
        const graphemes = typeof Intl.Segmenter === 'function'
          ? (chartTitleGraphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' })).segment(run.text)
          : run.text.replace(/[\p{Mark}\p{Format}]/gu, '');
        let count = 0;
        for (const _ of graphemes) count++;
        return sum + count * (style.fontSize ?? fontSize);
      }
      return sum + estimateTextWidth(run.text, style.fontSize ?? fontSize, style.fontFamily, style.bold, style.italic);
    }, 0)), 0
  );
  const width = flow ? blockSize : inlineSize;
  // Browsers can synthesize vertical advances from the font ascent and descent, beyond the measured horizontal advance.
  const height = flow ? inlineSize * 1.18 : blockSize;
  const radians = rotation * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  return { width: width * cosine + height * sine, height: width * sine + height * cosine };
}

function chartTitleCenter(
  coordinate: NonNullable<ChartTitleLayout['position']>['x'], defaultCenter: number, extent: number, size: number
): number {
  if (!coordinate) return defaultCenter;
  return coordinate.value * extent + (coordinate.mode === 'edge' ? size / 2 : defaultCenter);
}

function appendChartTitleRows(
  parent: SVGElement, text: string, lines: ChartTextRun[][] | undefined, sizes: number[], fontSize: number,
  inlineCenter: number, blockStart: number, flow?: ChartTitleFlow
): void {
  const progression = flow?.writingMode === 'vertical-rl' ? -1 : 1;
  (lines?.length ? lines : [[{ text }]]).forEach((runs, index) => {
    const cross = blockStart + sizes[index] / 2;
    const row = createChartSvgNode('text', {
      x: flow ? progression * cross : inlineCenter,
      y: flow ? inlineCenter : cross,
      'text-anchor': 'middle', 'dominant-baseline': flow ? 'central' : 'middle', 'font-size': fontSize
    });
    if (flow) {
      row.style.writingMode = flow.writingMode;
      row.style.textOrientation = flow.textOrientation;
    }
    row.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    for (const run of runs) {
      const span = createChartSvgNode('tspan', {});
      applyChartTextStyle(span, run, flow ? run.text : undefined);
      span.textContent = run.text;
      row.appendChild(span);
    }
    parent.appendChild(row);
    blockStart += sizes[index] * CHART_TITLE_LINE_SPACING;
  });
}

function renderCircularChart(
  svg: SVGSVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  bounds: ChartPlotBounds
): void {
  const centerX = (bounds.plotLeft + bounds.plotRight) / 2;
  const centerY = (bounds.plotTop + bounds.plotBottom) / 2;
  const radius = Math.max(0.5, Math.min(bounds.plotRight - bounds.plotLeft, bounds.plotBottom - bounds.plotTop) / 2);
  const holeRadius = item.chartType === 'doughnut' ? radius * (item.holeSize ?? 50) / 100 : 0;
  const rings = item.chartType === 'pie' ? item.series.slice(0, 1) : item.series;
  const ringWidth = (radius - holeRadius) / Math.max(1, rings.length);
  const firstAngle = ((item.firstSliceAngle ?? 0) - 90) * Math.PI / 180;
  const point = (r: number, angle: number) => `${centerX + r * Math.cos(angle)} ${centerY + r * Math.sin(angle)}`;
  const arc = (r: number, angle: number, sweep: number, full: boolean) => {
    const direction = sweep > 0 ? 1 : 0;
    // Split a full turn because SVG ignores arcs whose endpoints coincide.
    return full
      ? `A ${r} ${r} 0 0 ${direction} ${point(r, angle + sweep / 2)} A ${r} ${r} 0 0 ${direction} ${point(r, angle)}`
      : `A ${r} ${r} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${direction} ${point(r, angle + sweep)}`;
  };

  rings.forEach((series, seriesIndex) => {
    const values = series.values.map(value => value != null && Number.isFinite(value) ? Math.abs(value) : 0);
    const maximum = values.reduce((max, value) => Math.max(max, value), 0);
    if (maximum === 0) return;
    // Normalize before summing so finite, very large cached values cannot overflow.
    const total = values.reduce((sum, value) => sum + value / maximum, 0);
    const inner = holeRadius + ringWidth * seriesIndex;
    const outer = inner + ringWidth;
    let angle = firstAngle;
    values.forEach((value, index) => {
      const fraction = (value / maximum) / total;
      if (fraction === 0) return;
      const sweep = fraction * Math.PI * 2;
      const endAngle = angle + sweep;
      const full = fraction === 1;
      const outline = `M ${point(outer, angle)} ${arc(outer, angle, sweep, full)}`;
      const d = inner > 0
        ? full
          ? `${outline} Z M ${point(inner, angle)} ${arc(inner, angle, -sweep, true)} Z`
          : `${outline} L ${point(inner, endAngle)} ${arc(inner, endAngle, -sweep, false)} Z`
        : full ? `${outline} Z` : `${outline} L ${centerX} ${centerY} Z`;
      const style = series.pointStyles?.[index] ?? series;
      const path = createChartSvgNode('path', {
        d, fill: colorWithAlpha(style.color, style.alpha), 'fill-rule': 'evenodd',
        'data-series-index': seriesIndex, 'data-category-index': index
      });
      path.classList.add('pptxv-chart-slice');
      path.setAttribute('data-value', String(series.values[index]));
      path.setAttribute('data-percentage', String(fraction * 100));
      const title = createChartSvgNode('title', {});
      title.textContent = `${item.categories[index] || index + 1}: ${series.values[index]}`;
      path.appendChild(title);
      svg.appendChild(path);
      angle = endAngle;
    });
  });
}

interface CartesianChartPlot {
  chartType: 'column' | 'bar' | 'line' | 'area';
  grouping: ChartItem['grouping'];
  series: ChartSeries[];
  seriesIndices?: readonly number[];
  gapWidth?: number;
  secondaryAxis?: boolean;
  reversedCategories?: boolean;
  dateAxis?: ChartDateAxis | null;
}

interface ChartAxisRange {
  min: number;
  max: number;
}

interface ChartValueScale extends ChartAxisRange {
  majorUnit: number;
  logBase?: number;
  style?: ChartValueAxis;
  secondary: boolean;
  fractional: boolean;
  percent: boolean;
}

interface RenderedValueAxis extends ChartValueScale {
  position: (value: number) => number;
}

function chartXValue(series: ChartSeries, index: number): number | null {
  return series.xValues === undefined ? index + 1 : series.xValues[index] ?? null;
}

function xyPointCount(series: ChartSeries): number {
  return Math.max(series.values.length, series.xValues?.length ?? 0);
}

function bubbleSizeAt(series: ChartSeries, index: number, showNegative: boolean): number | null {
  const size = series.bubbleSizes?.[index];
  return size && (size > 0 || showNegative) ? size : null;
}

function renderXYChart(svg: SVGSVGElement, item: ChartItem, bounds: ChartPlotBounds): void {
  const xRange = { min: Infinity, max: -Infinity }, yRange = { min: Infinity, max: -Infinity };
  const bubble = item.chartType === 'bubble';
  const showNegative = item.bubble?.showNegative ?? false;
  let maxSize = 0;
  for (const series of item.series) {
    const count = bubble ? series.bubbleSizes?.length ?? 0 : xyPointCount(series);
    for (let index = 0; index < count; index++) {
      const x = chartXValue(series, index);
      const y = series.values[index] ?? (item.displayBlanksAs === 'zero' ? 0 : null);
      if (x == null || y == null) continue;
      if ((item.xValueAxis?.logBase && x <= 0) || (item.valueAxis?.logBase && y <= 0)) continue;
      if (bubble) {
        const size = bubbleSizeAt(series, index, showNegative);
        if (size == null) continue;
        maxSize = Math.max(maxSize, Math.abs(size));
      }
      xRange.min = Math.min(xRange.min, x); xRange.max = Math.max(xRange.max, x);
      yRange.min = Math.min(yRange.min, y); yRange.max = Math.max(yRange.max, y);
    }
  }
  // shortcut: the default maximum diameter is 25% of the shorter plot dimension, pending measured Office layouts.
  const radiusFraction = maxSize > 0 ? (item.bubble?.scale ?? 100) / 800 : 0;
  const scale = (range: ChartAxisRange, style: ChartValueAxis | undefined): ChartValueScale => {
    const common = { style: { ...style, textStyle: { ...item.textStyle, ...style?.textStyle } },
      secondary: false, fractional: true, percent: false };
    if (radiusFraction > 0) range = padBubbleExtent(range, style, radiusFraction);
    if (style?.logBase) return { ...common, ...resolveLogChartAxis(style, range, style.logBase) };
    if (!Number.isFinite(range.min)) range = { min: 0, max: 1 };
    if (range.min === range.max) {
      const padding = Math.max(Math.abs(range.min) * 0.1, 1);
      range = { min: range.min - padding, max: range.max + padding };
    }
    return { ...common, ...resolveChartAxis(style, range, true, false, false) };
  };
  const xScale = scale(xRange, item.xValueAxis), yScale = scale(yRange, item.valueAxis);
  if (!yScale.style?.hidden && yScale.style?.tickLabelPosition === 'high') {
    const style = yScale.style?.textStyle ?? {};
    const textSize = style.fontSize ?? Math.max(9, bounds.height * 0.036);
    const labels = chartValueTicks(yScale).map(value => formatChartAxisValue(value, yScale));
    const width = labels.reduce((largest, label) => Math.max(largest, measureChartLabel(label, textSize, style)), 0);
    const room = Math.min(bounds.width * 0.25, width + 10);
    bounds.plotRight -= room;
    bounds.rightAxisWidth += room;
  }
  const titles = reserveChartAxisTitles(item, bounds, yScale, undefined, 0, xScale);
  const { plotLeft, plotRight, plotTop, plotBottom } = bounds;
  const axis = (scale: ChartValueScale, start: number, end: number): RenderedValueAxis => {
    const transform = scale.logBase ? Math.log : (value: number) => value;
    const min = transform(scale.min), span = transform(scale.max) - min;
    return { ...scale, position: value => {
      const fraction = (transform(value) - min) / span;
      return start + (end - start) * (scale.style?.reversed ? 1 - fraction : fraction);
    } };
  };
  const x = axis(xScale, plotLeft, plotRight), y = axis(yScale, plotBottom, plotTop);
  const crossing = (other: RenderedValueAxis) => {
    const value = other.style?.crossesAt;
    return other.position(value === 'min' ? other.min : value === 'max' ? other.max
      : Math.max(other.min, Math.min(other.max, value ?? 0)));
  };
  const horizontal = crossing(y), vertical = crossing(x);
  renderChartValueTicks(svg, bounds, x, true, { name: 'x', crossing: horizontal });
  renderChartValueTicks(svg, bounds, y, false, { name: 'y', crossing: vertical });
  if (bubble) {
    renderBubbleSeries(svg, item, bounds, x, y, maxSize, radiusFraction);
  } else {
    const group: CartesianChartPlot = { chartType: 'line', grouping: 'clustered', series: item.series };
    renderLineSeries(svg, item, group, bounds, 0, (index, series) => {
      const value = chartXValue(series, index);
      return value == null ? null : x.position(value);
    }, y.position);
  }
  if (!x.style?.hidden) appendAxis('x', plotLeft, horizontal, plotRight, horizontal, x.style?.line);
  if (!y.style?.hidden) appendAxis('y', vertical, plotTop, vertical, plotBottom, y.style?.line);
  renderChartAxisTitles(svg, bounds, titles);

  function appendAxis(name: string, x1: number, y1: number, x2: number, y2: number, style: LineStyle | null | undefined) {
    const line = createChartSvgNode('line', { x1, y1, x2, y2, 'data-axis': name });
    line.classList.add('pptxv-chart-axis', 'pptxv-chart-axis-line');
    applyChartLineStyle(line, style);
    svg.appendChild(line);
  }
}

function padBubbleExtent(range: ChartAxisRange, style: ChartValueAxis | undefined, radiusFraction: number): ChartAxisRange {
  const logBase = style?.logBase;
  const fixedMin = style?.min !== undefined && (!logBase || style.min > 0) ? style.min : undefined;
  const fixedMax = style?.max !== undefined && (!logBase || style.max > 0) ? style.max : undefined;
  if (fixedMin !== undefined && fixedMax !== undefined) return range;
  const project = logBase ? Math.log : (value: number) => value;
  const min = project(fixedMin ?? range.min), max = project(fixedMax ?? range.max);
  const span = max > min ? max - min : logBase ? Math.log(logBase) : Math.max(1, Math.abs(min) * 0.2);
  const sides = fixedMin === undefined && fixedMax === undefined ? 2 : 1;
  const padding = span * radiusFraction / (1 - radiusFraction * sides);
  return logBase
    ? { min: Math.max(Number.MIN_VALUE, Math.exp(min - padding)), max: Math.min(Number.MAX_VALUE, Math.exp(max + padding)) }
    : { min: min - padding, max: max + padding };
}

function renderBubbleSeries(
  svg: SVGSVGElement, item: ChartItem, bounds: ChartPlotBounds, x: RenderedValueAxis, y: RenderedValueAxis,
  maxSize: number, radiusFraction: number
): void {
  if (radiusFraction <= 0) return;
  const plot = createChartPlotViewport(bounds);
  const radiusLimit = Math.min(bounds.plotRight - bounds.plotLeft, bounds.plotBottom - bounds.plotTop) * radiusFraction;
  const byWidth = item.bubble?.sizeRepresents === 'width';
  const showNegative = item.bubble?.showNegative ?? false;
  item.series.forEach((series, seriesIndex) => {
    series.bubbleSizes?.forEach((_, index) => {
      const size = bubbleSizeAt(series, index, showNegative);
      const xValue = chartXValue(series, index);
      const yValue = series.values[index] ?? (item.displayBlanksAs === 'zero' ? 0 : null);
      if (size == null || xValue == null || yValue == null) return;
      const cx = x.position(xValue), cy = y.position(yValue);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
      const ratio = Math.abs(size) / maxSize;
      const r = radiusLimit * (byWidth ? ratio : Math.sqrt(ratio));
      const style = series.pointStyles?.[index];
      const mark = createChartSvgNode('circle', {
        cx, cy, r, fill: colorWithAlpha(style?.color ?? series.color, style ? style.alpha : series.alpha),
        'data-series-index': seriesIndex, 'data-category-index': index, 'data-x-value': xValue,
        'data-value': yValue, 'data-size-value': size
      });
      mark.classList.add('pptxv-chart-bubble');
      applyChartLineStyle(mark, style?.line === undefined ? series.line : style.line);
      const title = createChartSvgNode('title', {});
      title.textContent = `${series.name}: (${xValue}, ${yValue}), ${size}`;
      mark.appendChild(title);
      plot.appendChild(mark);
    });
  });
  svg.appendChild(plot);
}

function renderCartesianChart(
  svg: SVGSVGElement, item: ChartItem, bounds: ChartPlotBounds, seriesPaints: ReadonlyMap<number, string>
): void {
  const horizontal = item.chartType === 'bar';
  const categoryCount = item.series.reduce((count, series) => Math.max(count, series.values.length), Math.max(item.categories.length, 1));
  const plots: CartesianChartPlot[] = item.plotGroups?.length
    ? item.plotGroups.map(group => ({ ...group, series: group.seriesIndices.map(index => item.series[index]) }))
    : [{
        chartType: item.chartType === 'line' || item.chartType === 'area' ? item.chartType : horizontal ? 'bar' : 'column',
        grouping: item.grouping, series: item.series, gapWidth: item.gapWidth
      }];
  const hasArea = plots.some(plot => plot.chartType === 'area');
  const hasColumns = plots.some(plot => plot.chartType === 'column');
  const dateAxis = item.categoryAxis?.date;
  const dates = dateAxis && resolveChartDates(dateAxis);
  const fractional = hasArea || item.chartType === 'line' || item.chartType === 'combo';
  const percentScale = fractional ? 1 : 100;
  const prepared = plots.map(plot => {
    const plotDates = plot.dateAxis ? resolveChartDates(plot.dateAxis) : plot.dateAxis === null ? undefined : dates;
    const spanArea = plot.chartType === 'area' && item.displayBlanksAs === 'span';
    if (plotDates || spanArea) {
      plot = { ...plot, series: plot.series.map(series => {
        let values = plotDates ? series.values.map((value, index) => plotDates.serials[index] == null ? null : value) : series.values;
        if (spanArea) values = interpolateAreaBlanks(values, plotDates);
        return { ...series, values };
      }) };
    }
    const stack = (plot.chartType === 'line' || plot.chartType === 'area') && plot.grouping !== 'clustered'
      ? stackLineAndAreaValues(plot, categoryCount) : undefined;
    return { plot, dates: plotDates, stack, range: stack ?? chartPlotRange(plot, categoryCount, percentScale) };
  });
  const describeAxis = (secondary: boolean, style: ChartValueAxis | undefined): ChartValueScale => {
    const assigned = prepared.filter(({ plot }) => Boolean(plot.secondaryAxis) === secondary);
    const range = assigned.reduce(({ min, max }, entry) => ({
      min: Math.min(min, entry.range.min), max: Math.max(max, entry.range.max)
    }), { min: 0, max: 0 });
    const percent = assigned.length > 0 && assigned.every(({ plot }) => plot.grouping === 'percentStacked');
    const axis = resolveChartAxis(style, range, fractional, percent);
    return { ...axis, style: { ...style, textStyle: { ...item.textStyle, ...style?.textStyle } }, secondary, fractional, percent };
  };
  const primaryScale = describeAxis(false, item.valueAxis);
  const secondaryScale = item.secondaryValueAxis ? describeAxis(true, item.secondaryValueAxis) : undefined;
  const titles = reserveChartAxisTitles(item, bounds, primaryScale, secondaryScale, categoryCount);
  const { height, plotLeft, plotRight, plotTop, plotBottom } = bounds;
  const plotWidth = Math.max(plotRight - plotLeft, 1);
  const plotHeight = Math.max(plotBottom - plotTop, 1);
  const makeAxis = (axis: ChartValueScale): RenderedValueAxis => {
    const position = (value: number) => {
      const ratio = (value - axis.min) / (axis.max - axis.min);
      const fraction = axis.style?.reversed ? 1 - ratio : ratio;
      return horizontal ? plotLeft + fraction * plotWidth : plotBottom - fraction * plotHeight;
    };
    return { ...axis, position };
  };
  const primary = makeAxis(primaryScale);
  const secondary = secondaryScale ? makeAxis(secondaryScale) : undefined;
  renderChartValueTicks(svg, bounds, primary, horizontal);
  if (secondary) renderChartValueTicks(svg, bounds, secondary, horizontal);

  const crosses = dateAxis?.crossesAt;
  const zeroPosition = primary.position(crosses === 'min' ? primary.min : crosses === 'max' ? primary.max
    : Math.min(primary.max, Math.max(primary.min, crosses ?? 0)));
  const onCategoryTicks = (axis: RenderedValueAxis) => hasArea && categoryCount > 1
    && (axis.style?.crossBetween ? axis.style.crossBetween === 'midCat' : !hasColumns);
  const primaryOnTicks = onCategoryTicks(primary);
  const categoryStep = (onTicks: boolean) => (horizontal ? plotHeight : plotWidth) / (categoryCount - Number(onTicks));
  const categoryCenter = (index: number, reversed = item.categoryAxis?.reversed, onTicks = primaryOnTicks) => {
    const orderedIndex = reversed ? categoryCount - index - 1 : index;
    const offset = (orderedIndex + (onTicks ? 0 : 0.5)) * categoryStep(onTicks);
    return horizontal ? plotBottom - offset : plotLeft + offset;
  };
  const datePosition = (domain: ChartAxisRange, reversed = item.categoryAxis?.reversed) => (serial: number) => {
    const ratio = (serial - domain.min) / (domain.max - domain.min);
    const fraction = reversed ? 1 - ratio : ratio;
    return horizontal ? plotBottom - fraction * plotHeight : plotLeft + fraction * plotWidth;
  };
  const dateAnnotations = dates ? createChartSvgNode('g', {}) : undefined;
  if (dateAxis && dates) {
    const domain = dates.domain(primary.style?.crossBetween === 'between');
    const position = datePosition(domain);
    renderChartValueTicks(svg, bounds, {
      ...domain, position, style: { ...dateAxis, textStyle: { ...item.textStyle, ...dateAxis.textStyle } },
      majorUnit: 1, secondary: false, fractional: false, percent: false
    }, !horizontal, {
      name: 'category', crossing: zeroPosition, annotations: dateAnnotations,
      dates: { major: dates.majorTicks, minor: dates.minorTicks, format: serial => formatChartDate(serial, dateAxis) }
    });
  }
  for (const { plot, stack, dates } of prepared) {
    const axis = plot.secondaryAxis && secondary ? secondary : primary;
    const onTicks = onCategoryTicks(axis);
    const placeDate = dates && datePosition(dates.domain(axis.style?.crossBetween === 'between'), plot.reversedCategories);
    const center = (index: number) => {
      if (!placeDate || !dates) return categoryCenter(index, plot.reversedCategories, onTicks);
      const serial = dates.serials[index];
      return serial == null ? null : placeDate(serial);
    };
    if (plot.chartType === 'line') {
      renderLineSeries(svg, item, plot, bounds, categoryCount, center, axis.position, stack?.values, dates);
    } else if (plot.chartType === 'area') {
      renderAreaSeries(svg, item, plot, bounds, categoryCount, center, axis, seriesPaints, stack?.values, dates?.indices);
    } else {
      const target = onTicks || dates ? createChartPlotViewport(bounds) : svg;
      renderBarSeries(target, item, plot, categoryCount, index => {
        const middle = center(index);
        if (middle == null) return null;
        const serial = dates?.serials[index];
        const width = placeDate && dates && serial != null
          ? Math.abs(placeDate(serial + dates.bandwidth(serial)) - middle)
          : categoryStep(onTicks);
        return { start: middle - width / 2, width };
      }, axis, percentScale);
      if (target !== svg) svg.appendChild(target);
    }
  }

  const xAxis = createChartSvgNode('line', horizontal
    ? { x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom }
    : { x1: plotLeft, y1: zeroPosition, x2: plotRight, y2: zeroPosition });
  xAxis.classList.add('pptxv-chart-axis');
  applyChartLineStyle(xAxis, horizontal ? primary.style?.line : item.categoryAxis?.line);
  if (!(horizontal ? primary.style?.hidden : item.categoryAxis?.hidden)) svg.appendChild(xAxis);
  const yAxis = createChartSvgNode('line', { x1: horizontal ? zeroPosition : plotLeft, y1: plotTop, x2: horizontal ? zeroPosition : plotLeft, y2: plotBottom });
  yAxis.classList.add('pptxv-chart-axis');
  applyChartLineStyle(yAxis, horizontal ? item.categoryAxis?.line : primary.style?.line);
  if (!(horizontal ? item.categoryAxis?.hidden : primary.style?.hidden)) svg.appendChild(yAxis);

  if (secondary && !secondary.style?.hidden) {
    const rightAxis = createChartSvgNode('line', { x1: plotRight, y1: plotTop, x2: plotRight, y2: plotBottom });
    rightAxis.classList.add('pptxv-chart-axis');
    applyChartLineStyle(rightAxis, secondary.style?.line);
    svg.appendChild(rightAxis);
  }

  if (dateAnnotations?.hasChildNodes()) svg.appendChild(dateAnnotations);
  const categoryStyle = { ...item.textStyle, ...item.categoryAxis?.textStyle };
  for (let categoryIndex = 0; !dates && !item.categoryAxis?.hidden && categoryIndex < categoryCount; categoryIndex += 1) {
    const position = categoryCenter(categoryIndex);
    const tickMark = createChartSvgNode('line', horizontal
      ? { x1: zeroPosition - 2, y1: position, x2: zeroPosition, y2: position }
      : { x1: position, y1: zeroPosition, x2: position, y2: zeroPosition + 2 });
    tickMark.classList.add('pptxv-chart-axis');
    applyChartLineStyle(tickMark, item.categoryAxis?.line);
    svg.appendChild(tickMark);

    const label = createChartSvgNode('text', {
      x: horizontal ? plotLeft - 10 : position,
      y: horizontal ? position : plotBottom + height * 0.057,
      'text-anchor': horizontal ? 'end' : 'middle',
      'dominant-baseline': 'middle'
    });
    label.classList.add('pptxv-chart-category-label');
    label.setAttribute('font-size', String(item.categoryAxis?.textStyle?.fontSize ?? item.textStyle?.fontSize ?? Math.max(10, height * 0.042)));
    setChartLabelText(label, item.categories[categoryIndex] ?? String(categoryIndex + 1), categoryStyle);
    svg.appendChild(label);
  }
  renderChartAxisTitles(svg, bounds, titles);
}

type ChartTitleSide = 'left' | 'right' | 'bottom';
const AXIS_TITLE_GAP = 4;

function reserveChartAxisTitles(
  item: ChartItem, bounds: ChartPlotBounds, primary: ChartValueScale, secondary: ChartValueScale | undefined,
  categoryCount: number, scatterX?: ChartValueScale
) {
  const { width, height, plotLeft } = bounds;
  const bar = item.chartType === 'bar';
  const candidates = [
    { axis: scatterX ? 'x' : 'category', side: bar ? 'left' : 'bottom', axisStyle: scatterX?.style ?? item.categoryAxis, scale: scatterX },
    { axis: scatterX ? 'y' : 'primary', side: bar ? 'bottom' : 'left', axisStyle: primary.style, scale: primary },
    { axis: 'secondary', side: 'right', axisStyle: secondary?.style, scale: secondary }
  ] as const;
  const titles = candidates.flatMap(({ axis, side, axisStyle, scale }) => {
    const title = axisStyle?.title;
    if (!title?.text || axisStyle?.hidden) return [];
    const fontSize = title.textStyle?.fontSize ?? item.textStyle?.fontSize ?? Math.max(10, height * 0.045);
    const sizes = chartTitleLineSizes(title.lines, fontSize);
    const textStyle = { ...item.textStyle, ...title.textStyle };
    const blockSize = sizes.reduce((sum, size) => sum + size * CHART_TITLE_LINE_SPACING, 0);
    const flow = title.verticalText ? CHART_TITLE_FLOWS[title.verticalText] : undefined;
    const rotation = title.rotation ?? (flow || side === 'bottom' ? 0 : -90);
    const { width: rotatedWidth, height: rotatedHeight } = measureChartTitle(title.text, title.lines, textStyle, fontSize, blockSize, rotation, flow);
    const tickStyle = { ...item.textStyle, ...axisStyle?.textStyle };
    const tickSize = tickStyle.fontSize ?? (scale ? Math.max(9, height * 0.036) : Math.max(10, height * 0.042));
    const generatedLabelWidth = axis === 'category' && item.categories.length < categoryCount
      ? measureChartLabel(String(categoryCount), tickSize, tickStyle) : 0;
    // SVG's middle baseline can leave more than half an em below the tick's y.
    const tickGap = side === 'bottom' ? height * 0.057 + tickSize + 2 : 12 + (
      scale ? chartValueTicks(scale).map(value => formatChartAxisValue(value, scale)) : item.categories
    ).reduce((maximum, text) => Math.max(maximum, measureChartLabel(text, tickSize, tickStyle)), generatedLabelWidth);
    const rightInset = (item.legendPosition ?? 'right') === 'right' ? 0.04 : 0.068;
    const tickRoom = side === 'bottom' ? height * 0.08
      : side === 'right' ? width * rightInset + bounds.rightAxisWidth : plotLeft - (item.legendPosition === 'left' ? bounds.legendSideWidth : 0);
    const thickness = side === 'bottom' ? rotatedHeight : rotatedWidth;
    const length = side === 'bottom' ? rotatedWidth : rotatedHeight;
    const extraTicks = Math.max(0, tickGap - tickRoom);
    const reserve = title.overlay ? 0 : thickness + AXIS_TITLE_GAP * 2 + extraTicks;
    return [{ axis, side, title, fontSize, sizes, blockSize, rotation, flow, thickness, length, tickGap, extraTicks, reserve }];
  });
  const use = (bottom: boolean) => {
    const requested = titles.reduce((sum, title) => sum + ((title.side === 'bottom') === bottom ? title.reserve : 0), 0);
    const span = bottom ? bounds.plotBottom - bounds.plotTop : bounds.plotRight - bounds.plotLeft;
    return requested ? Math.min(1, Math.max(0, span - (bottom ? height : width) * 0.16) / requested) : 1;
  };
  const rowShare = use(true), columnShare = use(false);
  return titles.map(title => {
    const reserved = title.reserve * (title.side === 'bottom' ? rowShare : columnShare);
    if (title.side === 'left') bounds.plotLeft += reserved;
    if (title.side === 'right') {
      bounds.plotRight -= reserved;
      bounds.rightAxisWidth += reserved;
    }
    if (title.side === 'bottom') bounds.plotBottom -= reserved;
    return { ...title, reserved };
  });
}

function renderChartAxisTitles(svg: SVGSVGElement, bounds: ChartPlotBounds, titles: ReturnType<typeof reserveChartAxisTitles>): void {
  const { width, height, plotLeft, plotRight, plotTop, plotBottom } = bounds;
  if (titles.length) {
    const description = createChartSvgNode('desc', {});
    description.textContent = titles.map(({ title }) => title.text).join('. ');
    svg.prepend(description);
  }
  for (const { axis, side, title, fontSize, sizes, rotation, flow, thickness, length, blockSize, tickGap, extraTicks, reserved } of titles) {
    const bottom = side === 'bottom';
    const overlay = title.overlay === true;
    const plotWidth = plotRight - plotLeft, plotHeight = plotBottom - plotTop;
    const availableCross = overlay ? (bottom ? plotHeight : plotWidth) : reserved - extraTicks;
    const availableAlong = bottom ? plotWidth : plotHeight;
    const scale = Math.min(1, Math.max(0, availableCross - AXIS_TITLE_GAP * 2) / Math.max(1, thickness),
      Math.max(0, availableAlong - AXIS_TITLE_GAP * 2) / Math.max(1, length)) || (title.position ? 1 : 0);
    if (!scale) continue;
    const offset = AXIS_TITLE_GAP + thickness * scale / 2;
    const defaultX = bottom ? (plotLeft + plotRight) / 2
      : side === 'left' ? plotLeft + (overlay ? offset : -tickGap - offset) : plotRight + (overlay ? -offset : tickGap + offset);
    const defaultY = !bottom ? (plotTop + plotBottom) / 2 : plotBottom + (overlay ? -offset : tickGap + offset);
    const x = chartTitleCenter(title.position?.x, defaultX, width, (bottom ? length : thickness) * scale);
    const y = chartTitleCenter(title.position?.y, defaultY, height, (bottom ? thickness : length) * scale);
    const group = createChartSvgNode('g', {
      transform: `translate(${x} ${y}) rotate(${rotation}) scale(${scale})`,
      'data-axis': axis, 'data-side': side, 'data-overlay': String(overlay)
    });
    group.classList.add('pptxv-chart-axis-title');
    applyChartTextStyle(group, title.textStyle);
    appendChartTitleRows(group, title.text, title.lines, sizes, fontSize, 0, -blockSize / 2, flow);
    svg.appendChild(group);
  }
}

function logChartTicks(axis: ChartValueScale, base: number, minor: boolean): number[] {
  const baseLog = Math.log(base);
  const low = Math.log(axis.min) / baseLog, high = Math.log(axis.max) / baseLog;
  const epsilon = 1e-10;
  const first = minor ? Math.floor(low + epsilon) : Math.ceil(low - epsilon);
  const last = Math.floor(high + epsilon);
  const perBand = minor ? Math.ceil(base) - 2 : 1;
  const slots = (last - first + 1) * perBand;
  const step = Math.max(1, Math.ceil(slots / 101));
  const ticks: number[] = [];
  for (let index = 0; index < slots; index += step) {
    const exponent = first + Math.floor(index / perBand);
    const multiplier = minor ? 2 + index % perBand : 1;
    const power = exponent + Math.log(multiplier) / baseLog;
    if (power < low - epsilon || power > high + epsilon) continue;
    const tick = minor ? Math.exp(power * baseLog) : base ** exponent;
    if (Number.isFinite(tick) && tick > 0) ticks.push(tick);
  }
  return ticks;
}

function chartValueTicks(axis: ChartValueScale): number[] {
  if (axis.logBase) return logChartTicks(axis, axis.logBase, false);
  const values: number[] = [];
  const tickStride = Math.max(1, Math.ceil((axis.max - axis.min) / axis.majorUnit / 100));
  const tickStep = Number.isFinite(tickStride) ? tickStride * axis.majorUnit : axis.majorUnit;
  for (let index = 0; index <= 100; index += 1) {
    const tick = axis.min + index * tickStep;
    if (tick > axis.max + axis.majorUnit * 1e-6) break;
    values.push(Math.abs(tick) < axis.majorUnit / 1000 ? 0 : tick);
  }
  return values;
}

function renderChartValueTicks(
  svg: SVGSVGElement, bounds: ChartPlotBounds, axis: RenderedValueAxis, horizontal: boolean,
  authored?: {
    name: 'x' | 'y' | 'category';
    crossing: number;
    annotations?: SVGElement;
    dates?: { major: number[]; minor: number[]; format: (serial: number) => string };
  }
): void {
  const { height, plotLeft, plotRight, plotTop, plotBottom } = bounds;
  const side = axis.secondary ? plotRight : plotLeft;
  const outward = axis.secondary ? 1 : -1;
  const crossing = authored?.crossing ?? (horizontal ? plotBottom : side);
  const tickDirection = horizontal ? 1 : outward;
  const labelPosition = authored ? axis.style?.tickLabelPosition ?? (authored.dates ? 'low' : undefined) : undefined;
  const high = labelPosition === 'high';
  const labelSide = high ? (horizontal ? plotTop : plotRight) : labelPosition === 'low' ? (horizontal ? plotBottom : plotLeft) : crossing;
  const labelOffset = high ? -tickDirection : tickDirection;
  if (authored?.dates) {
    for (const tick of authored.dates.minor) renderTick(tick, true);
  } else if (authored && axis.logBase && (axis.style?.showMinorGridlines || (axis.style?.minorTickMark && axis.style.minorTickMark !== 'none'))) {
    for (const tick of logChartTicks(axis, axis.logBase, true)) renderTick(tick, true);
  }
  for (const tick of authored?.dates?.major ?? chartValueTicks(axis)) renderTick(tick, false);

  function renderTick(normalizedTick: number, minor: boolean) {
    const position = axis.position(normalizedTick);
    if (authored ? (minor ? axis.style?.showMinorGridlines : axis.style?.showMajorGridlines)
      : normalizedTick !== 0 && (axis.style?.showMajorGridlines || (!axis.secondary && !axis.style?.hidden))) {
      const gridline = createChartSvgNode('line', horizontal
        ? { x1: position, y1: plotTop, x2: position, y2: plotBottom }
        : { x1: plotLeft, y1: position, x2: plotRight, y2: position });
      gridline.classList.add('pptxv-chart-gridline');
      if (authored) gridline.setAttribute('data-axis', authored.name);
      if (minor) gridline.classList.add('pptxv-chart-gridline--minor');
      if (authored) gridline.setAttribute('data-value', String(Number(normalizedTick.toPrecision(12))));
      applyChartLineStyle(gridline, minor ? axis.style?.minorGridline : axis.style?.majorGridline);
      svg.appendChild(gridline);
    }
    if (axis.style?.hidden) return;
    const tickStyle = authored ? (minor ? axis.style?.minorTickMark : axis.style?.majorTickMark) ?? 'none' : 'out';
    if (tickStyle !== 'none') {
      const offset = (minor ? 2 : 4) * tickDirection;
      const tickStart = crossing - (tickStyle === 'in' || tickStyle === 'cross' ? offset : 0);
      const tickEnd = crossing + (tickStyle === 'out' || tickStyle === 'cross' ? offset : 0);
      const tickMark = createChartSvgNode('line', horizontal
        ? { x1: position, y1: tickStart, x2: position, y2: tickEnd }
        : { x1: tickStart, y1: position, x2: tickEnd, y2: position });
      tickMark.classList.add('pptxv-chart-axis');
      if (minor) tickMark.classList.add('pptxv-chart-axis--minor');
      applyChartLineStyle(tickMark, axis.style?.line);
      (authored?.annotations ?? svg).appendChild(tickMark);
    }

    if (minor || labelPosition === 'none') return;
    const label = createChartSvgNode('text', {
      x: horizontal ? position : labelSide + 10 * labelOffset,
      y: horizontal ? labelSide + height * 0.057 * labelOffset : position,
      'text-anchor': horizontal ? 'middle' : labelOffset > 0 ? 'start' : 'end',
      'dominant-baseline': 'middle',
      'data-axis': authored?.name ?? (axis.secondary ? 'secondary' : 'primary')
    });
    if (authored?.dates) {
      label.classList.add('pptxv-chart-category-label');
      label.setAttribute('data-date-serial', String(normalizedTick));
    } else {
      label.classList.add('pptxv-chart-axis-label');
    }
    label.setAttribute('font-size', String(axis.style?.textStyle?.fontSize ?? Math.max(9, height * 0.036)));
    setChartLabelText(label, authored?.dates?.format(normalizedTick) ?? formatChartAxisValue(normalizedTick, axis), axis.style?.textStyle);
    (authored?.annotations ?? svg).appendChild(label);
  }
}

function renderBarSeries(
  svg: SVGElement,
  item: ChartItem,
  plot: CartesianChartPlot,
  categoryCount: number,
  categoryPlacement: (index: number) => { start: number; width: number } | null,
  axis: RenderedValueAxis,
  percentScale: number
): void {
  const horizontal = plot.chartType === 'bar';
  const clustered = plot.grouping === 'clustered';
  const groupFraction = plot.gapWidth == null ? clustered ? 0.74 : 0.5 : 100 / (100 + Math.max(0, plot.gapWidth));
  const position = (value: number) => axis.position(item.chartType === 'combo' ? Math.min(axis.max, Math.max(axis.min, value)) : value);
  visitPlotIntervals(plot, categoryCount, percentScale, (seriesIndex, categoryIndex, rawValue, value, start, end) => {
    const placement = categoryPlacement(categoryIndex);
    if (!placement) return;
    const groupWidth = placement.width * groupFraction;
    const barWidth = clustered ? groupWidth / Math.max(plot.series.length, 1) : groupWidth;
    const startPosition = position(clustered ? Math.min(axis.max, Math.max(axis.min, 0)) : start);
    const endPosition = position(end);
    const categoryPosition = placement.start + (placement.width - groupWidth) / 2 + (clustered ? seriesIndex * barWidth : 0);
    const rect = createChartSvgNode('rect', horizontal ? {
      x: Math.min(startPosition, endPosition),
      y: categoryPosition,
      width: Math.abs(startPosition - endPosition),
      height: Math.max(barWidth, 0.5)
    } : {
      x: categoryPosition,
      y: Math.min(startPosition, endPosition),
      width: Math.max(barWidth, 0.5),
      height: Math.abs(startPosition - endPosition)
    });
    const index = plot.seriesIndices?.[seriesIndex] ?? seriesIndex;
    applyChartBarStyles(rect, item, index, categoryIndex, value);
    svg.appendChild(rect);
    appendChartDataLabel(svg, item, index, categoryIndex, rawValue, startPosition, endPosition, categoryPosition + barWidth / 2, horizontal);
  });
}

function visitPlotIntervals(
  plot: CartesianChartPlot,
  categoryCount: number,
  percentScale: number,
  visit: (series: number, category: number, rawValue: number, value: number, start: number, end: number) => void
): void {
  const clustered = plot.grouping === 'clustered';
  const positive = clustered ? [] : Array<number>(categoryCount).fill(0);
  const negative = clustered ? [] : Array<number>(categoryCount).fill(0);
  plot.series.forEach((series, seriesIndex) => {
    series.values.forEach((rawValue, categoryIndex) => {
      if (rawValue == null) return;
      const value = normalizeChartValue(rawValue, plot, categoryIndex, percentScale);
      const offsets = value >= 0 ? positive : negative;
      const start = clustered ? 0 : offsets[categoryIndex];
      const end = start + value;
      if (!clustered) offsets[categoryIndex] = end;
      visit(seriesIndex, categoryIndex, rawValue, value, start, end);
    });
  });
}

function chartPlotRange(plot: CartesianChartPlot, count: number, percentScale: number): ChartAxisRange {
  let min = 0;
  let max = 0;
  if (plot.grouping === 'percentStacked') {
    const negative = plot.series.some(series => series.values.some(value => value != null && value < 0));
    return { min: negative ? -percentScale : 0, max: percentScale };
  }
  visitPlotIntervals(plot, count, percentScale, (_series, _category, _raw, _value, _start, end) => {
    min = Math.min(min, end);
    max = Math.max(max, end);
  });
  return { min, max };
}

interface ChartStack {
  values: number[][];
  min: number;
  max: number;
}

function stackLineAndAreaValues(plot: CartesianChartPlot, categoryCount: number): ChartStack {
  const percent = plot.grouping === 'percentStacked';
  const magnitude = percent && plot.chartType === 'area';
  const values = plot.series.map(() => Array<number>(categoryCount));
  let min = 0;
  let max = 0;
  for (let category = 0; category < categoryCount; category++) {
    let scale = 1;
    let total = 1;
    if (percent) {
      // Scale before summing so even very large cached values retain their proportions.
      scale = plot.series.reduce((largest, series) => Math.max(largest, Math.abs(series.values[category] ?? 0)), 0) || 1;
      total = plot.series.reduce((sum, series) => sum + Math.abs((series.values[category] ?? 0) / scale), 0) || 1;
    }
    let cumulative = 0;
    for (let index = 0; index < plot.series.length; index++) {
      const value = plot.series[index].values[category] ?? 0;
      // A 100% area stack displays each value's share of the category's total magnitude.
      cumulative += ((magnitude ? Math.abs(value) : value) / scale) / total;
      values[index][category] = cumulative;
      if (Number.isFinite(cumulative)) {
        min = Math.min(min, cumulative);
        max = Math.max(max, cumulative);
      }
    }
  }
  return percent ? { values, min: min < 0 ? -1 : 0, max: 1 } : { values, min, max };
}

function createChartPlotViewport({ plotLeft, plotRight, plotTop, plotBottom }: ChartPlotBounds): SVGElement {
  const width = plotRight - plotLeft;
  const height = plotBottom - plotTop;
  return createChartSvgNode('svg', {
    x: plotLeft, y: plotTop, width, height, overflow: 'hidden',
    viewBox: `${plotLeft} ${plotTop} ${width} ${height}`
  });
}

function interpolateAreaBlanks(values: Array<number | null>, dates?: ReturnType<typeof resolveChartDates>): Array<number | null> {
  let interpolated: Array<number | null> | undefined;
  let previous = -1;
  const at = (offset: number) => dates?.indices[offset] ?? offset;
  const count = dates?.indices.length ?? values.length;
  for (let offset = 0; offset < count; offset++) {
    const index = at(offset);
    const value = values[index];
    if (value == null) continue;
    if (previous >= 0 && offset > previous + 1) {
      interpolated ??= [...values];
      const first = values[at(previous)]!;
      const from = dates?.serials[at(previous)] ?? previous;
      const to = dates?.serials[index] ?? offset;
      for (let between = previous + 1; between < offset; between++) {
        const intermediate = at(between);
        const coordinate = dates?.serials[intermediate] ?? between;
        const fraction = to === from ? (between - previous) / (offset - previous) : (coordinate - from) / (to - from);
        interpolated[intermediate] = first * (1 - fraction) + value * fraction;
      }
    }
    previous = offset;
  }
  return interpolated ?? values;
}

function renderAreaSeries(
  svg: SVGSVGElement, item: ChartItem, group: CartesianChartPlot, bounds: ChartPlotBounds,
  categoryCount: number, categoryCenter: (index: number) => number | null, axis: RenderedValueAxis,
  seriesPaints: ReadonlyMap<number, string>, stack?: readonly (readonly number[])[], orderedCategories?: readonly number[]
): void {
  const plot = createChartPlotViewport(bounds);
  const zero = Math.min(axis.max, Math.max(axis.min, 0));
  // Stacked areas use zero thickness at an empty category unless it was interpolated.
  const useZero = group.grouping !== 'clustered' || item.displayBlanksAs === 'zero';
  group.series.forEach((series, index) => {
    const seriesIndex = group.seriesIndices?.[index] ?? index;
    const commands: string[] = [];
    const tops: string[] = [];
    const bases: string[] = [];
    const close = () => {
      if (tops.length > 1) commands.push(`M ${tops.join(' L ')} L ${bases.reverse().join(' L ')} Z`);
      tops.length = 0;
      bases.length = 0;
    };
    const count = orderedCategories?.length ?? (stack ? categoryCount : series.values.length);
    for (let offset = 0; offset < count; offset++) {
      const category = orderedCategories?.[offset] ?? offset;
      const raw = series.values[category] ?? (useZero ? 0 : null);
      if (raw == null) {
        close();
        continue;
      }
      const x = categoryCenter(category);
      const y = axis.position(stack?.[index][category] ?? raw);
      const base = axis.position(stack?.[index - 1]?.[category] ?? zero);
      if (x == null || !Number.isFinite(y) || !Number.isFinite(base)) {
        close();
        continue;
      }
      tops.push(`${x} ${y}`);
      bases.push(`${x} ${base}`);
    }
    close();
    if (!commands.length) return;
    const path = createChartSvgNode('path', {
      d: commands.join(' '), 'fill-rule': 'evenodd',
      fill: seriesPaints.get(seriesIndex) ?? colorWithAlpha(series.color, series.alpha),
      'data-series-index': seriesIndex
    });
    path.classList.add('pptxv-chart-area');
    applyChartLineStyle(path, series.line);
    plot.appendChild(path);
  });
  svg.appendChild(plot);
}

function renderLineSeries(
  svg: SVGSVGElement,
  item: ChartItem,
  group: CartesianChartPlot,
  bounds: ChartPlotBounds,
  categoryCount: number,
  categoryPosition: (index: number, series: ChartSeries) => number | null,
  valuePosition: (value: number) => number,
  stackedValues?: readonly (readonly number[])[],
  dates?: ReturnType<typeof resolveChartDates>
): void {
  const scatter = item.chartType === 'scatter';
  const orderedCategories = dates?.indices;
  const plot = createChartPlotViewport(bounds);
  group.series.forEach((series, indexInGroup) => {
    const seriesIndex = group.seriesIndices?.[indexInGroup] ?? indexInGroup;
    const commands: string[] = [];
    const points: Array<{ x: number; y: number }> = [];
    const markers: SVGElement[] = [];
    const finishSegment = () => {
      appendChartLineSegment(commands, points, series.smooth === true, scatter || orderedCategories !== undefined);
      points.length = 0;
    };
    const pointCount = orderedCategories?.length ?? (scatter ? xyPointCount(series) : categoryCount);
    for (let offset = 0; offset < pointCount; offset += 1) {
      const index = orderedCategories?.[offset] ?? offset;
      const value = series.values[index] ?? (item.displayBlanksAs === 'zero' ? 0 : null);
      const x = categoryPosition(index, series);
      if (value == null || x == null) {
        if (item.displayBlanksAs !== 'span') finishSegment();
        continue;
      }
      const y = valuePosition(stackedValues?.[indexInGroup][index] ?? value);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        finishSegment();
        continue;
      }
      points.push({ x, y });
      if (!series.marker) continue;
      const marker = createLineChartMarker(x, y, series.marker, series.color, series.alpha);
      marker.classList.add('pptxv-chart-marker');
      marker.setAttribute('data-series-index', String(seriesIndex));
      marker.setAttribute('data-category-index', String(index));
      marker.setAttribute('data-value', String(value));
      const title = createChartSvgNode('title', {});
      const sourceX = scatter ? chartXValue(series, index) : null;
      if (sourceX != null) marker.setAttribute('data-x-value', String(sourceX));
      const date = dates?.axis.serials[index];
      if (date != null) marker.setAttribute('data-date-serial', String(date));
      const category = date != null && dates ? formatChartDate(date, dates.axis) : item.categories[index] || index + 1;
      title.textContent = scatter ? `${series.name}: (${sourceX}, ${value})`
        : `${series.name}, ${category}: ${value}`;
      marker.appendChild(title);
      markers.push(marker);
    }
    finishSegment();
    if (commands.length && series.line !== null) {
      const path = createChartSvgNode('path', {
        d: commands.join(' '), fill: 'none', 'data-series-index': seriesIndex
      });
      path.classList.add('pptxv-chart-line');
      applyChartLineStyle(path, { ...series.line, color: series.color, alpha: series.alpha, width: series.line?.width ?? 2 });
      plot.appendChild(path);
    }
    for (const marker of markers) plot.appendChild(marker);
  });
  svg.appendChild(plot);
}

function appendChartLineSegment(commands: string[], points: readonly { x: number; y: number }[], smooth: boolean, parametric: boolean): void {
  if (!points.length) return;
  commands.push(`M ${points[0].x} ${points[0].y}`);
  for (let index = 1; index < points.length; index++) {
    const end = points[index];
    if (!smooth || points.length < 3) {
      commands.push(`L ${end.x} ${end.y}`);
      continue;
    }
    const start = points[index - 1];
    const before = points[index - 2] ?? start;
    const after = points[index + 1] ?? end;
    if (parametric) {
      // Parametric tangents also work for repeated or decreasing X values.
      commands.push(`C ${start.x + (end.x - before.x) / 6} ${start.y + (end.y - before.y) / 6} ${end.x - (after.x - start.x) / 6} ${end.y - (after.y - start.y) / 6} ${end.x} ${end.y}`);
      continue;
    }
    // shortcut: interpolate source points with cubic Hermite segments until Office control points are reproduced.
    const dx = (end.x - start.x) / 3;
    const startTangent = (end.y - before.y) / (end.x - before.x);
    const endTangent = (after.y - start.y) / (after.x - start.x);
    commands.push(`C ${start.x + dx} ${start.y + dx * startTangent} ${end.x - dx} ${end.y - dx * endTangent} ${end.x} ${end.y}`);
  }
}

function createLineChartMarker(
  x: number,
  y: number,
  { symbol, size, fill, alpha, line }: NonNullable<ChartSeries['marker']>,
  seriesColor: string,
  seriesAlpha: number | undefined
): SVGElement {
  const r = size / 2;
  const marker = symbol === 'circle' ? createChartSvgNode('circle', { cx: x, cy: y, r })
    : symbol === 'square' ? createChartSvgNode('rect', { x: x - r, y: y - r, width: size, height: size })
    : createChartSvgNode('polygon', {
        points: symbol === 'diamond'
          ? `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`
          : `${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}`
      });
  marker.setAttribute('fill', fill ? colorWithAlpha(fill, alpha) : colorWithAlpha(seriesColor, seriesAlpha));
  applyChartLineStyle(marker, line);
  return marker;
}

function applyChartTextStyle(node: SVGElement, style: ChartTextStyle | undefined, sampleText?: string): void {
  if (style?.color) node.style.fill = colorWithAlpha(style.color, style.colorAlpha);
  if (style?.fontSize != null) node.style.fontSize = `${style.fontSize}px`;
  if (style?.fontFamily) node.style.fontFamily = buildFontFamilyStack(style.fontFamily, sampleText === undefined ? {} : { sampleText });
  if (style?.bold != null) node.style.fontWeight = style.bold ? '700' : '400';
  if (style?.italic != null) node.style.fontStyle = style.italic ? 'italic' : 'normal';
}

function setChartLabelText(node: SVGElement, text: string, style: ChartLabelStyle | undefined): void {
  applyChartTextStyle(node, style);
  if (!style?.scriptFonts?.eastAsia && !style?.scriptFonts?.complex) {
    node.textContent = text;
    return;
  }
  const runs = chartLabelRuns(text, style);
  if (runs.length === 1) {
    applyChartTextStyle(node, runs[0].face, text);
    node.textContent = text;
    return;
  }
  node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  for (const run of runs) {
    const span = createChartSvgNode('tspan', {});
    applyChartTextStyle(span, run.face, run.text);
    span.textContent = run.text;
    node.appendChild(span);
  }
}

function measureChartLabel(text: string, size: number, style: ChartLabelStyle): number {
  return chartLabelRuns(text, style).reduce((sum, run) => sum + estimateTextWidth(
    run.text, size, run.face?.fontFamily, run.face?.bold, run.face?.italic
  ), 0);
}

function applyChartLineStyle(node: SVGElement, line: LineStyle | null | undefined): void {
  if (line === undefined) return;
  node.style.stroke = line === null ? 'none' : colorWithAlpha(line.color ?? '#000000', line.alpha);
  if (line?.width != null) node.style.strokeWidth = String(line.width);
  applySvgLineStyles(node, line ?? undefined);
}

function appendChartDataLabel(
  svg: SVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  seriesIndex: number,
  categoryIndex: number,
  value: number,
  start: number,
  end: number,
  categoryPosition: number,
  horizontal: boolean
): void {
  const settings = item.series[seriesIndex].dataLabels;
  if (!settings?.showValue) return;
  const position = settings.position ?? 'outEnd';
  const direction = Math.sign(end - start) || (horizontal ? 1 : -1);
  const outside = position === 'outEnd';
  const centered = position === 'ctr';
  const labelPosition = centered ? (start + end) / 2
    : position === 'inBase' ? start + direction * 6 : end + direction * (outside ? 6 : -6);
  const anchorAtStart = position === 'inBase' ? direction > 0 : outside === (direction > 0);
  const label = createChartSvgNode('text', {
    'data-series-index': seriesIndex,
    'data-category-index': categoryIndex,
    x: horizontal ? labelPosition : categoryPosition,
    y: horizontal ? categoryPosition : labelPosition,
    'text-anchor': horizontal && !centered ? anchorAtStart ? 'start' : 'end' : 'middle',
    'dominant-baseline': horizontal || centered ? 'middle' : anchorAtStart ? 'hanging' : 'auto',
    'font-size': item.textStyle?.fontSize ?? Math.max(9, item.transform.height * 0.036)
  });
  label.classList.add('pptxv-chart-data-label');
  setChartLabelText(label, formatChartDataValue(value, settings.formatCode), { ...item.textStyle, ...settings.textStyle });
  svg.appendChild(label);
}

function formatChartDataValue(value: number, formatCode: string | undefined): string {
  if (!Number.isFinite(value)) return String(value);
  const scientific = /^0(?:\.(0{1,20}))?E([+-])(0{1,20})$/i.exec(formatCode ?? '');
  if (scientific) {
    const [mantissa, power] = value.toExponential(scientific[1]?.length ?? 0).split('e');
    const exponent = Number(power);
    const sign = exponent < 0 ? '-' : scientific[2] === '+' ? '+' : '';
    return `${mantissa}E${sign}${String(Math.abs(exponent)).padStart(scientific[3].length, '0')}`;
  }
  // shortcut: basic decimal and percent formats only; extend for other Excel number formats.
  const format = /^([#,0]+)(?:\.([0#]+))?(%)?$/.exec(formatCode ?? '');
  if (!format) return String(value);
  const decimals = format[2] ?? '';
  const formatted = (format[3] ? value * 100 : value).toLocaleString('en-US', {
    useGrouping: format[1].includes(','),
    minimumFractionDigits: Math.min(decimals.replace(/#/g, '').length, 20),
    maximumFractionDigits: Math.min(decimals.length, 20)
  });
  return formatted + (format[3] ?? '');
}

function createChartSvgNode(name: string, attributes: Record<string, string | number>): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(Number.isFinite(value) ? Number(Number(value).toFixed(3)) : value));
  }
  return node;
}

function resolveLogChartAxis(style: ChartValueAxis, extent: ChartAxisRange, logBase: number): ChartAxisRange & { majorUnit: number; logBase: number } {
  const atPower = (exponent: number) => Math.max(Number.MIN_VALUE, Math.min(Number.MAX_VALUE, logBase ** exponent));
  const power = (value: number) => Math.log(value) / Math.log(logBase);
  const minBound = style.min !== undefined && style.min > 0 ? style.min : undefined;
  const maxBound = style.max !== undefined && style.max > 0 ? style.max : undefined;
  let min = minBound ?? (Number.isFinite(extent.min) ? atPower(Math.floor(power(extent.min) + 1e-10))
    : maxBound === undefined ? 1 : atPower(power(maxBound) - 1));
  let max = maxBound ?? (Number.isFinite(extent.max) ? atPower(Math.ceil(power(extent.max) - 1e-10))
    : minBound === undefined ? logBase : atPower(power(minBound) + 1));
  if (max <= min) {
    if (maxBound !== undefined && minBound === undefined) min = atPower(power(max) - 1);
    else {
      max = atPower(power(min) + 1);
      if (minBound === undefined || max <= min) min = atPower(power(min) - 1);
    }
    if (max <= min) max = atPower(power(min) + 1);
  }
  return { min, max, majorUnit: 1, logBase };
}

function resolveChartAxis(
  style: ChartValueAxis | undefined, extent: ChartAxisRange, fractional: boolean, percent: boolean, includeZero = true
): ChartAxisRange & { majorUnit: number } {
  const rawMin = style?.min ?? extent.min;
  const rawMax = style?.max ?? extent.max;
  const desiredIntervals = 4;
  const fractionalPercent = fractional && percent;
  const span = rawMax > rawMin ? rawMax - rawMin : 1;
  const autoStep = niceChartStep((fractional ? span : Math.max(span, 1)) / desiredIntervals);
  const majorUnit = style?.majorUnit && style.majorUnit > 0 ? style.majorUnit : autoStep;
  const roundedMin = Math.floor(rawMin / majorUnit) * majorUnit;
  const min = style?.min ?? (fractionalPercent ? rawMin : includeZero ? Math.min(0, roundedMin) : roundedMin);
  let max = style?.max ?? (fractionalPercent ? rawMax : Math.max(
    Math.ceil(rawMax / majorUnit) * majorUnit, min + desiredIntervals * majorUnit
  ));
  if (max <= min) {
    max = min + majorUnit;
  }
  return { min, max, majorUnit };
}

function niceChartStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, Number.EPSILON)));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function normalizeChartValue(
  value: number,
  plot: CartesianChartPlot,
  categoryIndex: number,
  percentScale: number
): number {
  if (plot.grouping !== 'percentStacked') {
    return value;
  }

  const total = plot.series.reduce((sum, series) => sum + Math.abs(series.values[categoryIndex] ?? 0), 0);
  return total > 0 ? (value / total) * percentScale : 0;
}

function formatChartAxisValue(value: number, axis: ChartValueScale): string {
  if (axis.logBase) return formatChartDataValue(Number(value.toPrecision(12)), axis.style?.formatCode);
  if (axis.fractional) {
    const format = axis.style?.formatCode || (axis.percent ? '0%' : undefined);
    if (format) return formatChartDataValue(value, format);
  }
  if (axis.percent || axis.style?.formatCode?.includes('%')) {
    return `${Number(value.toFixed(2))}%`;
  }
  return String(Number(value.toFixed(6)));
}

function applyChartBarStyles(
  rect: SVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  seriesIndex: number,
  categoryIndex: number,
  value: number
): void {
  const series = item.series[seriesIndex];
  rect.classList.add('pptxv-chart-bar');
  rect.setAttribute('fill', colorWithAlpha(series?.color ?? '#4472C4', series?.alpha));
  rect.setAttribute('data-series-index', String(seriesIndex));
  rect.setAttribute('data-category-index', String(categoryIndex));
  rect.setAttribute('data-value', String(value));
}

function renderChartLegend(
  svg: SVGSVGElement,
  item: Extract<SlideItem, { kind: 'chart' }>,
  bounds: ChartPlotBounds,
  seriesPaints: ReadonlyMap<number, string>
): void {
  const position = item.legendPosition ?? 'right';
  if (position === 'none' || !item.series.length) {
    return;
  }

  const entries = item.chartType === 'pie' || item.chartType === 'doughnut'
    ? item.series[0].values.map((_, index) => ({
        ...(item.series[0].pointStyles?.[index] ?? item.series[0]),
        name: item.categories[index] || String(index + 1),
        seriesIndex: 0,
        categoryIndex: index
      }))
    : ((item.chartType === 'column' || item.chartType === 'bar') && (position === 'bottom' || position === 'top')
      ? [...item.series].reverse() : item.series)
      .map((series) => ({ ...series, seriesIndex: item.series.indexOf(series), categoryIndex: undefined }));
  const comboLineIndices = new Set(item.plotGroups?.flatMap(group => group.chartType === 'line' ? group.seriesIndices : []));
  const comboAreaIndices = new Set(item.plotGroups?.flatMap(group => group.chartType === 'area' ? group.seriesIndices : []));
  const style = { ...item.textStyle, ...item.legendStyle };
  const fontSize = style.fontSize ?? Math.max(9, bounds.height * 0.036);
  const swatchSize = Math.max(8, fontSize * 0.9);
  const bubble = item.chartType === 'bubble';
  const legend = createChartSvgNode('g', {});
  legend.classList.add('pptxv-chart-legend');

  entries.forEach((series, index) => {
    let x: number;
    let y: number;
    if (position === 'bottom' || position === 'top') {
      const entryWidth = (bounds.plotRight - bounds.plotLeft) / entries.length;
      x = bounds.plotLeft + index * entryWidth + entryWidth * 0.03;
      y = position === 'bottom' ? bounds.height * 0.925 : Math.max(bounds.height * 0.105, bounds.plotTop - fontSize);
    } else {
      x = position === 'left' ? bounds.width * 0.025 : bounds.plotRight + bounds.rightAxisWidth + bounds.width * 0.04;
      y = bounds.plotTop + (index + 0.5) * Math.min(fontSize * 2.2, (bounds.plotBottom - bounds.plotTop) / entries.length);
    }

    const group = createChartSvgNode('g', { 'data-series-index': series.seriesIndex });
    if (series.categoryIndex != null) {
      group.setAttribute('data-category-index', String(series.categoryIndex));
    }
    group.classList.add('pptxv-chart-legend-item');
    const lineSeries = item.chartType === 'line' || item.chartType === 'scatter' || comboLineIndices.has(series.seriesIndex);
    const swatch = lineSeries
      ? createChartSvgNode('line', { x1: x, x2: x + swatchSize, y1: y, y2: y })
      : bubble ? createChartSvgNode('circle', { cx: x + swatchSize / 2, cy: y, r: swatchSize / 2 })
        : createChartSvgNode('rect', { x, y: y - swatchSize * 0.72, width: swatchSize, height: swatchSize });
    group.appendChild(swatch);
    if (lineSeries) {
      const { line, marker } = item.series[series.seriesIndex];
      applyChartLineStyle(swatch, line === null ? null : { ...line, color: series.color, alpha: series.alpha, width: line?.width ?? 2 });
      if (marker) {
        group.appendChild(createLineChartMarker(
          x + swatchSize / 2, y, { ...marker, size: Math.min(marker.size, swatchSize) }, series.color, series.alpha
        ));
      }
    } else {
      swatch.setAttribute('fill', seriesPaints.get(series.seriesIndex) ?? colorWithAlpha(series.color, series.alpha));
      if (bubble || item.chartType === 'area' || comboAreaIndices.has(series.seriesIndex)) {
        applyChartLineStyle(swatch, item.series[series.seriesIndex].line);
      }
    }
    const label = createChartSvgNode('text', {
      x: x + swatchSize * 1.35,
      y,
      'dominant-baseline': 'middle'
    });
    label.setAttribute('font-size', String(fontSize));
    setChartLabelText(label, series.name, style);
    group.appendChild(label);
    legend.appendChild(group);
  });

  svg.appendChild(legend);
}

function renderUnsupportedItem(transform: SlideItem['transform'], label: string): HTMLElement {
  const element = createItemBox(transform, 'pptxv-item pptxv-item--unsupported');
  element.textContent = label;
  return element;
}

function appendItemLinkOverlay(element: HTMLElement, item: SlideItem, allowOverlay: boolean): void {
  if (!allowOverlay || !hasItemLink(item)) {
    return;
  }

  const link = document.createElement('a');
  link.className = 'pptxv-item-link';
  applyLinkAttributes(link, item);
  const linkLabel = describeLinkTarget(item, item.name);
  link.setAttribute('aria-label', linkLabel);
  link.title = describeLinkTitle(item, item.name);
  link.style.position = 'absolute';
  link.style.inset = '0';
  link.style.zIndex = '4';
  link.style.display = 'block';
  link.style.background = 'transparent';
  link.style.textDecoration = 'none';
  element.appendChild(link);
}

function applyItemSurfaceStyles(
  element: HTMLElement,
  fill: FillStyle,
  line: LineStyle | undefined,
  registry: MediaResolver
): void {
  applyElementFillStyles(element, fill, registry);
  element.style.border = 'none';

  if (!line) {
    return;
  }

  element.style.border = lineStyleToBorder(line);
}

function applyItemShadowStyles(element: HTMLElement, shadow: ShadowStyle | undefined): void {
  if (!shadow) {
    return;
  }

  element.style.filter = `drop-shadow(${Number(shadow.offsetX.toFixed(3))}px ${Number(shadow.offsetY.toFixed(3))}px ${Number(shadow.blur.toFixed(3))}px ${colorWithAlpha(shadow.color, shadow.alpha)})`;
}

function applyTextOverflowStyles(element: HTMLElement, frame: TextFrame): void {
  element.style.overflowX = frame.horizontalOverflow === 'clip' || frame.wrap === 'none' ? 'clip' : 'visible';
  element.style.overflowY = frame.verticalOverflow === 'clip' ? 'clip' : 'visible';
}

function createShapeNode(item: ShapeItem, registry: MediaResolver): { node: SVGElement; defs: SVGElement[] } {
  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  const strokeWidth = Math.max(item.line?.width ?? 1, 0);
  const fill = createSvgFill(item.id, item.fill, registry, width, height);
  const stroke = linePaintColor(item.line);

  if (item.geometry?.type === 'custom') {
    const customNode = createCustomShapeNode(item.geometry.paths, width, height, fill.paint, stroke, strokeWidth, item.line);
    return { node: customNode ?? document.createElementNS('http://www.w3.org/2000/svg', 'g'), defs: fill.defs };
  }

  if (item.shapeType === 'line') {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const geometry = item.geometry?.type === 'line' ? item.geometry : undefined;
    line.setAttribute('x1', String(geometry?.x1 ?? 0));
    line.setAttribute('y1', String(geometry?.y1 ?? 0));
    line.setAttribute('x2', String(geometry?.x2 ?? width));
    line.setAttribute('y2', String(geometry?.y2 ?? height));
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(line, item.line);
    return {
      node: line,
      defs: applyLineMarkers(line, item, stroke)
    };
  }

  if (item.shapeType === 'ellipse') {
    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', String(width / 2));
    ellipse.setAttribute('cy', String(height / 2));
    ellipse.setAttribute('rx', String(width / 2));
    ellipse.setAttribute('ry', String(height / 2));
    ellipse.setAttribute('fill', fill.paint);
    ellipse.setAttribute('stroke', stroke);
    ellipse.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(ellipse, item.line);
    return {
      node: ellipse,
      defs: fill.defs
    };
  }

  if (item.shapeType === 'rect' || item.shapeType === 'roundRect') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(height));
    rect.setAttribute('fill', fill.paint);
    rect.setAttribute('stroke', stroke);
    rect.setAttribute('stroke-width', String(strokeWidth));
    if (item.shapeType === 'roundRect') {
      const radius = resolveRoundRectRadius(item, width, height);
      rect.setAttribute('rx', String(radius));
      rect.setAttribute('ry', String(radius));
    }
    applySvgLineStyles(rect, item.line);
    return {
      node: rect,
      defs: fill.defs
    };
  }

  const presetNode = createPresetShapeNode(item.shapeType, {
    width,
    height,
    fill: fill.paint,
    stroke,
    strokeWidth,
    line: item.line,
    adjustments: item.geometry?.type === 'preset' ? item.geometry.adjustments : undefined,
    applyLineStyles: applySvgLineStyles,
    applyDashPattern: applySvgDashPattern
  });
  if (presetNode) {
    return {
      node: presetNode,
      defs: fill.defs
    };
  }

  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', fallbackPolygonPoints(width, height));
  polygon.setAttribute('fill', fill.paint);
  polygon.setAttribute('stroke', stroke);
  polygon.setAttribute('stroke-width', String(strokeWidth));
  applySvgLineStyles(polygon, item.line);
  return {
    node: polygon,
    defs: fill.defs
  };
}

function createCustomShapeNode(
  paths: CustomShapePath[],
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  line: LineStyle | undefined
): SVGElement | undefined {
  const renderedPaths = paths
    .map((pathInfo) => createCustomShapePathNode(pathInfo, width, height, fill, stroke, strokeWidth, line))
    .filter((node): node is SVGPathElement => Boolean(node));

  if (!renderedPaths.length) {
    return undefined;
  }

  if (renderedPaths.length === 1) {
    return renderedPaths[0];
  }

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  for (const path of renderedPaths) {
    group.appendChild(path);
  }
  return group;
}

function createCustomShapePathNode(
  pathInfo: CustomShapePath,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  line: LineStyle | undefined
): SVGPathElement | undefined {
  const d = buildCustomShapePathData(pathInfo, width, height);
  if (!d) {
    return undefined;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', pathInfo.fill === 'none' ? 'none' : fill);
  path.setAttribute('stroke', pathInfo.stroke === 'none' ? 'none' : stroke);
  if (pathInfo.stroke !== 'none') {
    path.setAttribute('stroke-width', String(strokeWidth));
    applySvgLineStyles(path, line);
    if (line?.lineJoin === 'miter' && customShapeNeedsRoundMiterJoin(pathInfo)) {
      path.setAttribute('stroke-linejoin', 'round');
    }
  }
  return path;
}

function customShapeNeedsRoundMiterJoin(pathInfo: CustomShapePath): boolean {
  return pathInfo.commands.some((command) => command.type === 'Q' || command.type === 'C');
}

function buildCustomShapePathData(pathInfo: CustomShapePath, width: number, height: number): string {
  const scaleX = width / Math.max(pathInfo.width, 1);
  const scaleY = height / Math.max(pathInfo.height, 1);
  const parts: string[] = [];

  for (const command of pathInfo.commands) {
    switch (command.type) {
      case 'M':
        parts.push(`M ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`);
        break;
      case 'L':
        parts.push(`L ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`);
        break;
      case 'Q':
        parts.push(
          `Q ${formatCustomShapeValue(command.x1 * scaleX)} ${formatCustomShapeValue(command.y1 * scaleY)} ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`
        );
        break;
      case 'C':
        parts.push(
          `C ${formatCustomShapeValue(command.x1 * scaleX)} ${formatCustomShapeValue(command.y1 * scaleY)} ${formatCustomShapeValue(command.x2 * scaleX)} ${formatCustomShapeValue(command.y2 * scaleY)} ${formatCustomShapeValue(command.x * scaleX)} ${formatCustomShapeValue(command.y * scaleY)}`
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        assertNever(command);
        break;
    }
  }

  return parts.join(' ');
}

function formatCustomShapeValue(value: number): string {
  return String(Number(value.toFixed(3)));
}

function assertNever(_value: never): void {}

function fallbackPolygonPoints(width: number, height: number): string {
  return `0,0 ${width},0 ${width},${height} 0,${height}`;
}

function computeShapeBleed(item: ShapeItem): number {
  const strokeWidth = Math.max(item.line?.width ?? 0, 0);
  const hasMarkers = Boolean(
    (item.shapeType === 'line' || item.shapeType.endsWith('Arrow')) &&
      ((item.line?.headEnd && item.line.headEnd !== 'none') || (item.line?.tailEnd && item.line.tailEnd !== 'none'))
  );
  const markerBleed = hasMarkers ? Math.max(strokeWidth * 5, 10) : 0;
  const customGeometryBleed = item.geometry?.type === 'custom' ? computeCustomGeometryBleed(item) : 0;
  return Number(Math.max(strokeWidth * 1.5, markerBleed, customGeometryBleed, 1).toFixed(3));
}

function computeCustomGeometryBleed(item: ShapeItem): number {
  if (item.geometry?.type !== 'custom') {
    return 0;
  }

  const width = Math.max(item.transform.width, 1);
  const height = Math.max(item.transform.height, 1);
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;

  for (const path of item.geometry.paths) {
    const scaleX = width / Math.max(path.width, 1);
    const scaleY = height / Math.max(path.height, 1);

    for (const command of path.commands) {
      switch (command.type) {
        case 'M':
        case 'L':
          minX = Math.min(minX, command.x * scaleX);
          minY = Math.min(minY, command.y * scaleY);
          maxX = Math.max(maxX, command.x * scaleX);
          maxY = Math.max(maxY, command.y * scaleY);
          break;
        case 'Q':
          minX = Math.min(minX, command.x1 * scaleX, command.x * scaleX);
          minY = Math.min(minY, command.y1 * scaleY, command.y * scaleY);
          maxX = Math.max(maxX, command.x1 * scaleX, command.x * scaleX);
          maxY = Math.max(maxY, command.y1 * scaleY, command.y * scaleY);
          break;
        case 'C':
          minX = Math.min(minX, command.x1 * scaleX, command.x2 * scaleX, command.x * scaleX);
          minY = Math.min(minY, command.y1 * scaleY, command.y2 * scaleY, command.y * scaleY);
          maxX = Math.max(maxX, command.x1 * scaleX, command.x2 * scaleX, command.x * scaleX);
          maxY = Math.max(maxY, command.y1 * scaleY, command.y2 * scaleY, command.y * scaleY);
          break;
        case 'Z':
          break;
        default:
          assertNever(command);
          break;
      }
    }
  }

  return Number(Math.max(-minX, -minY, maxX - width, maxY - height, 0).toFixed(3));
}

function resolveRoundRectRadius(item: ShapeItem, width: number, height: number): number {
  const adjustment = item.geometry?.type === 'preset' ? item.geometry.adjustments?.adj : undefined;
  const ratio = clampRoundRectAdjustment(adjustment ?? 16667) / 100000;
  return Number((Math.min(width, height) * ratio).toFixed(3));
}

function clampRoundRectAdjustment(value: number): number {
  if (!Number.isFinite(value)) {
    return 16667;
  }

  return Math.min(Math.max(value, 0), 50000);
}

function primaryFillColor(fill: FillStyle): string | undefined {
  if (fill.type === 'solid') {
    return fill.color;
  }

  if (fill.type === 'gradient') {
    return fill.stops?.[0]?.color;
  }

  if (fill.type === 'pattern') {
    return fill.foregroundColor ?? fill.backgroundColor;
  }

  return undefined;
}

function createSvgFill(
  id: string,
  fill: FillStyle,
  registry: MediaResolver,
  width: number,
  height: number
): {
  paint: string;
  defs: SVGElement[];
} {
  if (fill.type === 'picture' && fill.mediaId) {
    const url = registry.getUrl(fill.mediaId);
    if (!url) {
      return {
        paint: 'transparent',
        defs: []
      };
    }

    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.id = `${id}-fill-pattern`;
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('x', '0');
    pattern.setAttribute('y', '0');
    pattern.setAttribute('width', String(width));
    pattern.setAttribute('height', String(height));

    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('href', url);
    image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);

    if (fill.crop) {
      const visibleWidth = Math.max(1 - fill.crop.left - fill.crop.right, 0.0001);
      const visibleHeight = Math.max(1 - fill.crop.top - fill.crop.bottom, 0.0001);
      image.setAttribute('x', String(Number(((-fill.crop.left / visibleWidth) * width).toFixed(3))));
      image.setAttribute('y', String(Number(((-fill.crop.top / visibleHeight) * height).toFixed(3))));
      image.setAttribute('width', String(Number((width / visibleWidth).toFixed(3))));
      image.setAttribute('height', String(Number((height / visibleHeight).toFixed(3))));
    } else {
      image.setAttribute('x', '0');
      image.setAttribute('y', '0');
      image.setAttribute('width', String(width));
      image.setAttribute('height', String(height));
    }
    if (fill.alpha != null) {
      image.setAttribute('opacity', String(fill.alpha));
    }

    pattern.appendChild(image);
    return {
      paint: `url(#${pattern.id})`,
      defs: [pattern]
    };
  }

  if (fill.type === 'pattern') {
    return createSvgPatternFill(id, fill as PatternFillStyle, width, height);
  }

  if (fill.type !== 'gradient' || !fill.stops?.length) {
    return {
      paint: fillToCss(fill),
      defs: []
    };
  }

  if (fill.gradientType === 'path') {
    if (fill.gradientPath === 'rect') {
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
      gradient.id = `${id}-fill-gradient`;
      gradient.setAttribute('x1', '0');
      gradient.setAttribute('y1', '0.5');
      gradient.setAttribute('x2', '1');
      gradient.setAttribute('y2', '0.5');
      gradient.setAttribute('gradientUnits', 'objectBoundingBox');

      for (const stopInfo of fill.stops) {
        const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
        stop.setAttribute('stop-color', stopInfo.color);
        if (stopInfo.alpha != null) {
          stop.setAttribute('stop-opacity', String(stopInfo.alpha));
        }
        gradient.appendChild(stop);
      }

      return {
        paint: `url(#${gradient.id})`,
        defs: [gradient]
      };
    }

    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
    gradient.id = `${id}-fill-gradient`;
    const origin = resolvePathGradientOrigin(fill);
    if (origin) {
      gradient.setAttribute('cx', `${origin.x}%`);
      gradient.setAttribute('cy', `${origin.y}%`);
    }

    for (const stopInfo of fill.stops) {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
      stop.setAttribute('stop-color', stopInfo.color);
      if (stopInfo.alpha != null) {
        stop.setAttribute('stop-opacity', String(stopInfo.alpha));
      }
      gradient.appendChild(stop);
    }

    return {
      paint: `url(#${gradient.id})`,
      defs: [gradient]
    };
  }

  const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  gradient.id = `${id}-fill-gradient`;
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0.5');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '0.5');
  gradient.setAttribute('gradientUnits', 'objectBoundingBox');
  gradient.setAttribute('gradientTransform', `rotate(${Number(((fill.angle ?? 0) % 360).toFixed(3))} 0.5 0.5)`);

  for (const stopInfo of fill.stops) {
    const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop.setAttribute('offset', `${Number((stopInfo.position * 100).toFixed(3))}%`);
    stop.setAttribute('stop-color', stopInfo.color);
    if (stopInfo.alpha != null) {
      stop.setAttribute('stop-opacity', String(stopInfo.alpha));
    }
    gradient.appendChild(stop);
  }

  return {
    paint: `url(#${gradient.id})`,
    defs: [gradient]
  };
}

function createSvgPatternFill(
  id: string,
  fill: PatternFillStyle,
  width: number,
  height: number
): {
  paint: string;
  defs: SVGElement[];
} {
  const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
  pattern.id = `${id}-fill-pattern`;
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('x', '0');
  pattern.setAttribute('y', '0');

  const fg = fill.foregroundColor ?? '#111827';
  const bg = fill.backgroundColor ?? '#FFFFFF';
  const fgOpacity = fill.foregroundAlpha;
  const bgOpacity = fill.backgroundAlpha;

  const addRect = (x: number, y: number, rectWidth: number, rectHeight: number, color: string, opacity?: number) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(rectWidth));
    rect.setAttribute('height', String(rectHeight));
    rect.setAttribute('fill', color);
    if (opacity != null) {
      rect.setAttribute('fill-opacity', String(opacity));
    }
    pattern.appendChild(rect);
  };

  const addLine = (x1: number, y1: number, x2: number, y2: number, strokeWidth: number) => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', fg);
    line.setAttribute('stroke-width', String(strokeWidth));
    if (fgOpacity != null) {
      line.setAttribute('stroke-opacity', String(fgOpacity));
    }
    pattern.appendChild(line);
  };

  const addCircle = (cx: number, cy: number, radius: number) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', fg);
    if (fgOpacity != null) {
      circle.setAttribute('fill-opacity', String(fgOpacity));
    }
    pattern.appendChild(circle);
  };

  const addPolygon = (points: string) => {
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', points);
    polygon.setAttribute('fill', fg);
    if (fgOpacity != null) {
      polygon.setAttribute('fill-opacity', String(fgOpacity));
    }
    pattern.appendChild(polygon);
  };

  const setTile = (tileWidth: number, tileHeight: number) => {
    pattern.setAttribute('width', String(tileWidth));
    pattern.setAttribute('height', String(tileHeight));
    addRect(0, 0, tileWidth, tileHeight, bg, bgOpacity);
  };

  switch (fill.pattern) {
    case 'horz':
      setTile(8, 8);
      addLine(0, 1, 8, 1, 2);
      break;
    case 'vert':
      setTile(8, 8);
      addLine(1, 0, 1, 8, 2);
      break;
    case 'ltDnDiag':
      setTile(10, 10);
      addLine(-2, 10, 10, -2, 2);
      addLine(0, 12, 12, 0, 2);
      break;
    case 'ltUpDiag':
      setTile(10, 10);
      addLine(-2, 0, 10, 12, 2);
      addLine(0, -2, 12, 10, 2);
      break;
    case 'diagCross':
      setTile(10, 10);
      addLine(-2, 10, 10, -2, 2);
      addLine(0, 12, 12, 0, 2);
      addLine(-2, 0, 10, 12, 2);
      addLine(0, -2, 12, 10, 2);
      break;
    case 'smGrid':
      setTile(8, 8);
      addLine(0, 1, 8, 1, 1);
      addLine(1, 0, 1, 8, 1);
      break;
    case 'lgGrid':
      setTile(14, 14);
      addLine(0, 2, 14, 2, 2);
      addLine(2, 0, 2, 14, 2);
      break;
    case 'pct10':
      setTile(5, 5);
      addCircle(1.25, 1.25, 0.65);
      break;
    case 'pct20':
      setTile(10, 10);
      addCircle(2, 2, 1.75);
      break;
    case 'pct25':
      setTile(9, 9);
      addCircle(2, 2, 1.9);
      break;
    case 'pct30':
      setTile(8, 8);
      addCircle(2, 2, 2);
      break;
    case 'pct40':
      setTile(8, 8);
      addCircle(2, 2, 2.35);
      break;
    case 'pct50':
      setTile(7, 7);
      addCircle(2, 2, 2.4);
      break;
    case 'pct60':
      setTile(6, 6);
      addCircle(2, 2, 2.45);
      break;
    case 'pct70':
      setTile(5, 5);
      addCircle(1.8, 1.8, 2.55);
      break;
    case 'pct75':
      setTile(5, 5);
      addCircle(1.8, 1.8, 2.7);
      break;
    case 'pct80':
      setTile(4, 4);
      addCircle(1.5, 1.5, 2.75);
      break;
    case 'pct90':
      setTile(4, 4);
      addCircle(1.5, 1.5, 3);
      break;
    case 'pct5':
      setTile(4, 4);
      addCircle(1, 1, 0.45);
      break;
    case 'solidDmnd':
      setTile(8, 8);
      addPolygon('4,1.5 6.5,4 4,6.5 1.5,4');
      break;
    default:
      setTile(4, 4);
      addCircle(1, 1, 0.45);
      break;
  }

  return {
    paint: `url(#${pattern.id})`,
    defs: [pattern]
  };
}

function applySvgDashPattern(node: SVGElement, line: LineStyle | undefined): void {
  const pattern = lineDashToSvgPattern(line);
  if (pattern) {
    node.setAttribute('stroke-dasharray', pattern);
    return;
  }

  node.removeAttribute('stroke-dasharray');
}

function applySvgLineStyles(
  node: SVGElement,
  line: LineStyle | undefined,
  defaults: {
    defaultJoin?: LineStyle['lineJoin'];
  } = {}
): void {
  applySvgDashPattern(node, line);

  if (line?.dashOffset != null && Number.isFinite(line.dashOffset)) {
    node.setAttribute('stroke-dashoffset', String(Number(line.dashOffset.toFixed(3))));
  } else {
    node.removeAttribute('stroke-dashoffset');
  }

  if (line?.lineCap) {
    node.setAttribute('stroke-linecap', line.lineCap);
  } else {
    node.removeAttribute('stroke-linecap');
  }

  const join = line?.lineJoin ?? defaults.defaultJoin;
  if (join) {
    node.setAttribute('stroke-linejoin', join);
  } else {
    node.removeAttribute('stroke-linejoin');
  }

  if (join === 'miter' && line?.miterLimit != null) {
    node.setAttribute('stroke-miterlimit', String(Number(line.miterLimit.toFixed(3))));
  } else {
    node.removeAttribute('stroke-miterlimit');
  }
}

function lineDashToSvgPattern(line: LineStyle | undefined): string | undefined {
  const exactPattern = line?.dashPattern?.filter((value) => Number.isFinite(value) && value > 0);
  if (exactPattern?.length) {
    return exactPattern.map((value) => String(Number(value.toFixed(3)))).join(' ');
  }

  if (!line?.dash || line.dash === 'solid') {
    return undefined;
  }

  const width = Math.max(line.width ?? 1, 1);
  const lineCap = line.lineCap ?? 'butt';
  switch (line.dash) {
    case 'dot':
    case 'sysDot':
      return dashSegments(width, lineCap, 1, 1.8);
    case 'dash':
    case 'sysDash':
      return dashSegments(width, lineCap, 3, 2);
    case 'lgDash':
      return dashSegments(width, lineCap, 6, 3);
    case 'dashDot':
    case 'sysDashDot':
      return dashSegments(width, lineCap, 3, 2, 1, 2);
    case 'lgDashDot':
      return dashSegments(width, lineCap, 6, 3, 1, 3);
    case 'lgDashDotDot':
    case 'sysDashDotDot':
      return dashSegments(width, lineCap, 6, 3, 1, 2, 1, 2);
    default:
      return dashSegments(width, lineCap, 3, 2);
  }
}

function dashSegments(width: number, lineCap: LineStyle['lineCap'], ...multipliers: number[]): string {
  const capExtendsDash = lineCap === 'round' || lineCap === 'square';
  return multipliers
    .map((value, index) => {
      let length = width * value;
      if (capExtendsDash && index % 2 === 0) {
        length = Math.max(length - width, 0.01);
      }

      return String(Number(length.toFixed(3)));
    })
    .join(' ');
}

function describeLinkTarget(
  target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'>,
  name?: string
): string {
  if (target.href) {
    return name ? `Open link: ${name}` : 'Open external link';
  }

  if (target.slideIndex != null) {
    return name ? `Go to slide ${target.slideIndex + 1}: ${name}` : `Go to slide ${target.slideIndex + 1}`;
  }

  switch (target.navigationAction) {
    case 'next':
      return 'Go to next slide';
    case 'previous':
      return 'Go to previous slide';
    case 'first':
      return 'Go to first slide';
    case 'last':
      return 'Go to last slide';
    case 'lastViewed':
      return 'Return to last viewed slide';
    default:
      return name ?? 'Linked slide item';
  }
}

function describeLinkTitle(target: Pick<SlideItem, 'href' | 'slideIndex' | 'navigationAction'>, name?: string): string {
  if (target.href) {
    return name ? `${name}: ${target.href}` : target.href;
  }

  return describeLinkTarget(target, name);
}

function hasVisibleText(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim().length > 0));
}

function hasLinkedTextRuns(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => Boolean(run.href || run.slideIndex != null || run.navigationAction))
  );
}

function tableHasLinkedRuns(item: Extract<SlideItem, { kind: 'table' }>): boolean {
  return item.cells.some((cell) => hasLinkedTextRuns(cell.textFrame));
}

function hasItemLink(item: SlideItem): boolean {
  return Boolean(item.href || item.slideIndex != null || item.navigationAction);
}

function applyLineMarkers(line: SVGLineElement, item: ShapeItem, stroke: string): SVGMarkerElement[] {
  const definitions: SVGMarkerElement[] = [];
  const strokeWidth = Math.max(item.line?.width ?? 1, 1);

  if (item.line?.headEnd && item.line.headEnd !== 'none') {
    const marker = createLineMarker(`${item.id}-head`, item.line.headEnd, stroke, strokeWidth);
    line.setAttribute('marker-start', `url(#${marker.id})`);
    definitions.push(marker);
  }

  if (item.line?.tailEnd && item.line.tailEnd !== 'none') {
    const marker = createLineMarker(`${item.id}-tail`, item.line.tailEnd, stroke, strokeWidth);
    line.setAttribute('marker-end', `url(#${marker.id})`);
    definitions.push(marker);
  }

  return definitions;
}

function createLineMarker(id: string, type: LineEndType, color: string, strokeWidth: number): SVGMarkerElement {
  const markerScale = resolveMarkerScale(type);
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.id = id;
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('markerWidth', String(Number((markerScale * 2).toFixed(3))));
  marker.setAttribute('markerHeight', String(Number((markerScale * 2).toFixed(3))));
  marker.setAttribute('refX', String(resolveMarkerRefX(type)));
  marker.setAttribute('refY', '5');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'strokeWidth');

  const shape = createMarkerShape(type, color, strokeWidth);
  marker.appendChild(shape);
  return marker;
}

function resolveMarkerScale(type: LineEndType): number {
  switch (type) {
    case 'arrow':
      return 3;
    case 'oval':
      return 2.8;
    case 'diamond':
    case 'stealth':
    case 'triangle':
    default:
      return 2.4;
  }
}

function resolveMarkerRefX(type: LineEndType): number {
  switch (type) {
    case 'arrow':
      return 9.2;
    case 'stealth':
      return 8.8;
    case 'oval':
      return 7.6;
    case 'diamond':
      return 8.4;
    case 'triangle':
    default:
      return 8.6;
  }
}

function createMarkerShape(type: LineEndType, color: string, strokeWidth: number): SVGElement {
  switch (type) {
    case 'diamond': {
      const diamond = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      diamond.setAttribute('d', 'M 0 5 L 4 1 L 8 5 L 4 9 z');
      diamond.setAttribute('fill', color);
      return diamond;
    }
    case 'oval': {
      const oval = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      oval.setAttribute('cx', '4.5');
      oval.setAttribute('cy', '5');
      oval.setAttribute('r', '3');
      oval.setAttribute('fill', color);
      return oval;
    }
    case 'stealth': {
      const stealth = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      stealth.setAttribute('d', 'M 0 0 L 8 5 L 0 10 L 2.6 5 z');
      stealth.setAttribute('fill', color);
      return stealth;
    }
    case 'arrow': {
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrow.setAttribute('d', 'M 0 0 L 8 5 L 0 10');
      arrow.setAttribute('fill', 'none');
      arrow.setAttribute('stroke', color);
      arrow.setAttribute('stroke-width', String(Number(Math.max(strokeWidth * 0.9, 1.25).toFixed(3))));
      arrow.setAttribute('stroke-linecap', 'round');
      arrow.setAttribute('stroke-linejoin', 'round');
      return arrow;
    }
    case 'triangle':
    default: {
      const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      triangle.setAttribute('d', 'M 0 0 L 8 5 L 0 10 z');
      triangle.setAttribute('fill', color);
      return triangle;
    }
  }
}
