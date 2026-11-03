import type { Mp4PlaybackOptions } from './engine-snapshot';
import { createBrowserMediaSource, type BrowserMediaInput, type BrowserSourceOptions } from './browser-source';

export { createBrowserMediaSource } from './browser-source';
export type { BrowserMediaInput, BrowserSourceOptions } from './browser-source';
// Framework-free shared policy, probing, monitoring and transport interfaces.
export * from './engine-snapshot/core';

export interface BrowserMediaOptions extends BrowserSourceOptions {
  /** Affects recovery only; the preview driver always attempts original playback first. */
  allowTranscoding?: boolean;
}
export type BrowserMediaRecoveryOptions = BrowserMediaOptions & Pick<Mp4PlaybackOptions,
  'signal' | 'startTime' | 'autoplay' | 'onError' | 'onMetrics'>;

/** Explicit local recovery for an existing video element. No conversion API or signaling service. */
export async function recoverBrowserVideo(input: BrowserMediaInput, video: HTMLVideoElement, options: BrowserMediaRecoveryOptions = {}) {
  const source = createBrowserMediaSource(input, options);
  try {
    options.signal?.throwIfAborted();
    const { MediaEngine } = await import('./engine-snapshot');
    options.signal?.throwIfAborted();
    return await new MediaEngine().recover(source, video, { ...options, allowTranscoding: options.allowTranscoding ?? true });
  } catch (error) { source.close(); throw error; }
}
