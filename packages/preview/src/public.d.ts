export type PreviewSource = string | ArrayBuffer | Uint8Array | Blob | File;
export interface SourceDescriptor {
  source: PreviewSource;
  archiveVolumes?: readonly { name: string; source: PreviewSource }[];
  name?: string;
  extension?: string;
  contentType?: string;
  size?: number;
  password?: string;
}
export interface BrowserPreviewOptions {
  src: PreviewSource | SourceDescriptor;
  name?: string;
  extension?: string;
  contentType?: string;
  password?: string;
  fit?: 'contain' | 'width' | 'height' | 'none';
  toolbar?: boolean | 'minimal';
  /** Native first; local MP4/MOV recovery without a conversion service. Off by default. */
  browserMedia?: boolean | { allowTranscoding?: boolean; fetch?: typeof globalThis.fetch };
  /** ZimaOS codes (zh_CN) and BCP 47 tags (zh-CN); defaults to browser language. */
  locale?: string;
  /** English source phrases mapped to host translations. */
  messages?: Readonly<Record<string, string>>;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  onRendered?: (state: unknown) => void;
  onError?: (error: Error) => void;
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
  destroy(): void;
}
export declare function createPreview(element: Element | string, options: BrowserPreviewOptions): BrowserPreview;
export declare function isArchiveVolumeName(name: string): boolean;
export declare function selectArchiveVolumes<T extends { name: string }>(name: string, candidates: readonly T[]): {
  format: 'rar' | '7z' | 'zip'; primary: T; files: T[];
} | undefined;
