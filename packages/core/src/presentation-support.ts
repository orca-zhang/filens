// Shared scene, source and rendering support for the external PowerPoint driver.
export type * from './types';
export { loadSourceBytes, throwIfAborted, type LoadSourceOptions } from './parser/load-source';
export { analyzePreviewFonts, collectSlideFontReferences } from './preview/fonts';
export { analyzeLoadedPreviewFonts, bindPreviewFontLoading } from './preview/font-loading';
export { bindPreviewEmbeddedFonts } from './preview/embedded-fonts';
export { fontFamilyKey, observeHostFontLoads } from './preview/host-fonts';
export { applySlideFontMappings, collectSlideFontLoadingReferences } from './preview/font-scenes';
export { chartLabelRuns } from './chart-label-fonts';
export { bindPreviewTouchGestures } from './preview/touch-gestures';
export {
  applyElementFillStyles, applyLinkAttributes, buildFontFamilyStack, colorWithAlpha, estimateTextWidth,
  fillToCss, linePaintColor, lineStyleToBorder, percent, renderTableCellContent, renderTextFrame,
  resolvePathGradientOrigin, withTextMeasurementScope, type PatternFillStyle
} from './render/content';
export { MediaRegistry, type MediaResolver } from './render/media-registry';
export { createMetafileDecoder } from './render/metafile';
export { applyLumMod, applyLumOff, applyShade, applyTint, resolveThemeColor } from './utils/colors';
export { asArray, clamp, deepClone, resolvePartPath, toNumber } from './utils/common';
export { angleToDegrees, emuToPx } from './utils/units';
