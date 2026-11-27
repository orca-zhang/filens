import './styles/index.css';

export { createViewer, init, PptxViewer } from './viewer';
export { loadPptx } from './parser/load-pptx';
export { renderSlideToElement, type RenderSlideOptions } from './render/dom';
export { createPptxPreviewDriver, PptxPreviewSession, pptxPreviewDriver, toPagedPreviewState } from './preview/pptx-driver';
export type { ParsedPresentation, PptxSource, SlideModel, ViewerInstance, ViewerOptions, ViewerState } from '@filens/core/presentation-support';
