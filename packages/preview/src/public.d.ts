export type PreviewSource = string | ArrayBuffer | Uint8Array | Blob | File;
export interface PreviewCommentAuthor {
  id: string;
  name?: string;
  initials?: string;
}
export interface PreviewCommentReaction {
  type: string;
  instances: { author: PreviewCommentAuthor; created?: string }[];
}
export type PreviewCommentTaskEvent = {
  id: string;
  created?: string;
  author?: PreviewCommentAuthor;
  commentId?: string;
} & (
  | { kind: 'created' | 'unassigned' | 'unknown' }
  | { kind: 'assigned'; assignee?: PreviewCommentAuthor }
  | { kind: 'title'; title?: string }
  | { kind: 'schedule'; startDate?: string; dueDate?: string }
  | { kind: 'progress'; complete?: number }
  | { kind: 'undo'; eventId?: string }
);
export interface PreviewCommentTask {
  title?: string;
  startDate?: string;
  dueDate?: string;
  assignedTo?: PreviewCommentAuthor[];
  /** Percentage from 0 through 100. */
  complete?: number;
  history?: PreviewCommentTaskEvent[];
}
export interface PreviewCommentMessage {
  id: string;
  text: string;
  author?: PreviewCommentAuthor;
  created?: string;
  status?: 'active' | 'resolved' | 'closed';
  replyTo?: string;
  reactions?: PreviewCommentReaction[];
  task?: PreviewCommentTask;
}
export interface PreviewSlideCommentAnchor {
  kind: 'slide' | 'shape' | 'text' | 'unknown';
  /** Source position in slide pixels relative to the first anchor. */
  position?: { x: number; y: number };
  slide?: { id?: string; creationId?: string };
  master?: { id?: string; creationId?: string };
  layout?: { id?: string; creationId?: string };
  drawing?: { id?: string; creationId?: string };
  /** OfficeArt plain-text range in UTF-16 code units. */
  textRange?: { offset: number; length: number; contextLength?: number; contextHash?: number };
}
export interface PreviewSlideComment extends PreviewCommentMessage {
  replies?: PreviewCommentMessage[];
  anchor?: PreviewSlideCommentAnchor;
  /** Subsequent modern drawing or text anchors in source order. */
  additionalAnchors?: PreviewSlideCommentAnchor[];
}
export interface PreviewSlideTransition {
  effect?: string;
  direction?: string;
  speed?: 'fast' | 'med' | 'slow';
  durationMs?: number;
  throughBlack?: boolean;
  advanceOnClick: boolean;
  advanceAfterMs?: number;
  fallback?: Omit<PreviewSlideTransition, 'fallback'>;
}
export interface PreviewSlideAnimationStep {
  onClick: boolean;
  effects: Array<{
    effect: 'appear' | 'fade' | 'wipe';
    targetId: string;
    itemIndexes: number[];
    /** Inclusive zero-based paragraph indexes for a text-only target. */
    paragraphs?: { start: number; end: number };
    chart?: {
      step: 'series' | 'category' | 'ptInSeries' | 'ptInCategory' | 'allPts' | 'gridLegend';
      /** Zero-based index into the rendered chart's series. */
      seriesIndex?: number;
      categoryIndex?: number;
    };
    enter: boolean;
    direction?: 'up' | 'down' | 'left' | 'right';
    delayMs: number;
    durationMs: number;
  }>;
}
export interface SourceDescriptor {
  source: PreviewSource;
  archiveVolumes?: readonly { name: string; source: PreviewSource }[];
  name?: string;
  extension?: string;
  contentType?: string;
  size?: number;
  /** Original video total in seconds; overrides partial stream durations when positive and finite. */
  durationSeconds?: number;
  password?: string;
  /** Content from a protected source. Keep decoded data out of shared preview caches. */
  sensitive?: boolean;
}
export interface BrowserPreviewOptions {
  src: PreviewSource | SourceDescriptor;
  name?: string;
  extension?: string;
  contentType?: string;
  password?: string;
  fit?: 'contain' | 'width' | 'height' | 'none';
  /** With controlsTarget, 'minimal' keeps zoom/fullscreen and compact tool menus. */
  toolbar?: boolean | 'minimal';
  /** Mount preview controls in an application-owned element. */
  controlsTarget?: HTMLElement;
  /** Native first; local MP4/MOV recovery without a conversion service. Off by default. */
  browserMedia?: boolean | { allowTranscoding?: boolean; fetch?: typeof globalThis.fetch };
  /** ZimaOS codes (zh_CN) and BCP 47 tags (zh-CN); defaults to browser language. */
  locale?: string;
  /** English source phrases mapped to host translations. */
  messages?: Readonly<Record<string, string>>;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  /** Disable viewport windows when a host explicitly needs the entire text DOM. */
  virtual?: boolean;
  onRendered?: (state: unknown) => void;
  onError?: (error: Error) => void;
  /** Trusted archive engine assets supplied by the host and resolved on first use. */
  archiveEngine?: () => { workerUrl: string; wasmUrl: string };
  requestPassword?: (request: {
    name?: string;
    reason: 'password_required' | 'password_invalid';
    attempt: number;
    signal?: AbortSignal;
  }) => string | null | Promise<string | null>;
  /** Advanced shared-host options, including converter, fonts, audio and resources. */
  [option: string]: unknown;
}
export interface BrowserPreview {
  update(options: Partial<BrowserPreviewOptions>): void;
  /** Inspect the current viewer when using an application-owned toolbar. */
  getState(): {
    family: string;
    loading: boolean;
    scale?: number;
    search?: PreviewSearchState;
    chapterLoading?: boolean;
    /** Plain-text speaker notes on the current slide, when available. */
    speakerNotes?: string;
    /** Review threads on the current slide, when available. */
    comments?: PreviewSlideComment[];
    /** Authored transition into the active slide. */
    slideTransition?: PreviewSlideTransition;
    slideAnimations?: PreviewSlideAnimationStep[];
    [key: string]: unknown;
  } | undefined;
  find(query: string): Promise<void> | undefined;
  findNext(backward?: boolean): void;
  setWrap(wrap: boolean): void;
  refreshFonts(): void;
  setScale(scale: number): void;
  fullscreen(): Promise<void> | undefined;
  destroy(): void;
}
export interface PreviewSearchState {
  query: string;
  searching: boolean;
  total: number;
  activeIndex: number;
  pagesScanned: number;
  pageCount: number;
  truncated: boolean;
  error?: string;
}
export declare function createPreview(element: Element | string, options: BrowserPreviewOptions): BrowserPreview;
export declare function isArchiveVolumeName(name: string): boolean;
export declare function createFileSetResourceResolver(resources: Iterable<File | Blob | {
  name: string; path?: string; contentType?: string; source: PreviewSource;
}>, options?: { root?: string }): (request: {
  source?: string; name?: string;
}) => { source?: PreviewSource; warnings?: string[] } | null | undefined | Promise<{ source?: PreviewSource; warnings?: string[] } | null | undefined>;
export declare function selectArchiveVolumes<T extends { name: string }>(name: string, candidates: readonly T[]): {
  format: 'rar' | '7z' | 'zip'; primary: T; files: T[];
} | undefined;
