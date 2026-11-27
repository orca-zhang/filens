import {
  createPptxPreviewDriver, createViewer, init, loadPptx, PptxPreviewSession,
  PptxViewer, pptxPreviewDriver, renderSlideToElement, toPagedPreviewState
} from '@filens/pptx';
import type { ParsedPresentation, RenderSlideOptions } from '@filens/pptx';
import * as core from '@filens/core';
import type { PagedPreviewState, PreviewDriver } from '@filens/core/preview-runtime';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertTyped<T extends false> = T;
export type ModelIsTyped = AssertTyped<IsAny<ParsedPresentation['slides'][number]>>;

export const driver: PreviewDriver<PagedPreviewState> = createPptxPreviewDriver();
export const legacy: typeof import('@filens/pptx') = {
  createPptxPreviewDriver: core.createPptxPreviewDriver,
  createViewer: core.createViewer,
  init: core.init,
  loadPptx: core.loadPptx,
  PptxPreviewSession: core.PptxPreviewSession,
  PptxViewer: core.PptxViewer,
  pptxPreviewDriver: core.pptxPreviewDriver,
  renderSlideToElement: core.renderSlideToElement,
  toPagedPreviewState: core.toPagedPreviewState
};
export const standalone: typeof legacy = {
  createPptxPreviewDriver, createViewer, init, loadPptx, PptxPreviewSession,
  PptxViewer, pptxPreviewDriver, renderSlideToElement, toPagedPreviewState
};
export async function renderDeck(bytes: Uint8Array, options: RenderSlideOptions): Promise<HTMLElement[]> {
  const model = await loadPptx(bytes);
  return model.slides.map(slide => renderSlideToElement(slide, model, options));
}

// @ts-expect-error The parser must reject unsupported inputs.
loadPptx(12);
