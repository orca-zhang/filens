import './styles/index.css';

export { createViewer, init, PptxViewer } from './viewer';
export { loadPptx } from './parser/load-pptx';
export { openZipArchive } from './parser/zip';
export type { ZipEntry, ZipArchiveOptions } from './parser/zip';
export { attachmentFilename, readOfficeAttachments, unwrapOfficeAttachment } from './parser/attachments';
export * from './archive-volumes';
export { MediaRegistry, renderSlideToElement } from './render/dom';
export type { MediaResolver, RenderSlideOptions } from './render/dom';
export * from './preview';
export { bindPreviewTouchGestures, type PreviewTouchGestureOptions } from './preview/touch-gestures';
export { bindPreviewSvgSelection } from './preview/svg-selection';
export { createVideoPlaybackControls, type VideoPlaybackActions, type VideoPlaybackState } from './preview/video-controls';
export { createVideoPreviewPlayer, resolveMediaDuration } from './preview/video-player';
export type {
  Model3dPreviewNode,
  Model3dPreviewState,
  PreviewDisplayMode,
  PreviewFontResolveRequest,
  PreviewFontResolveResult,
  PreviewFontResolver,
  PreviewMaterialInfo,
  PreviewSnapshotBackground,
  PreviewSectionInfo,
  PreviewerInstance,
  PreviewResourceResolveRequest,
  PreviewResourceResolveResult,
  PreviewResourceResolver,
  PreviewerFactory,
  PreviewSession
} from './preview/types';
export type * from './types';
