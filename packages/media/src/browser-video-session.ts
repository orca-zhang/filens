import { createVideoPreviewPlayer, type PreviewEventMap, type PreviewEventName, type MediaPreviewState, type PreviewLoadContext,
  type PreviewSession, type PreviewSource } from '@filens/core';
import { recoverBrowserVideo, type BrowserMediaOptions } from './engine';

/** Optional recovery session with the same controls as native video previews. */
export class BrowserVideoSession implements PreviewSession {
  private controller?: AbortController;
  private removeParent?: () => void;
  private playback?: Awaited<ReturnType<typeof recoverBrowserVideo>>;
  private root?: HTMLDivElement;
  private video?: HTMLVideoElement;
  private listeners = new Map<PreviewEventName, Set<(payload: never) => void>>();
  private state: MediaPreviewState = { family: 'video', currentTime: 0, paused: true, muted: false, volume: 1, loading: false, error: null, warnings: [],
    capabilities: { playback: true, timeline: true, volume: true, fullscreen: true, download: true, subtitles: false } };

  constructor(private host: HTMLElement, private options: BrowserMediaOptions) {}
  async load(source: PreviewSource, context: PreviewLoadContext): Promise<void> {
    this.destroy();
    const controller = this.controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener('abort', abort, { once: true });
    this.removeParent = () => context.signal?.removeEventListener('abort', abort);
    signal.addEventListener('abort', () => this.release(), { once: true });
    this.state = { ...this.state, title: context.descriptor.name, loading: true, error: null, duration: undefined,
      currentTime: 0, paused: true, muted: false, volume: 1, playbackRate: 1 };
    this.emit('loading', this.state); this.emit('statechange', this.state);
    if (context.signal?.aborted) controller.abort(context.signal.reason);
    if (signal.aborted) return;
    const root = this.root = document.createElement('div');
    root.className = 'pptxv-native-preview pptxv-native-preview--video';
    const video = this.video = document.createElement('video');
    video.className = 'pptxv-native-media pptxv-native-media--video';
    video.controls = true; video.playsInline = true; video.preload = 'metadata';
    root.append(video); this.host.append(root);
    createVideoPreviewPlayer(root, video, signal);
    let rendered = false;
    const sync = () => {
      if (signal.aborted) return;
      this.state = { ...this.state, duration: Number.isFinite(video.duration) ? video.duration : undefined,
        currentTime: video.currentTime, paused: video.paused, volume: video.volume, muted: video.muted, playbackRate: video.playbackRate };
      if (!rendered && video.videoWidth > 0 && video.readyState >= 2) {
        rendered = true; this.state = { ...this.state, loading: false }; this.emit('rendered', this.state);
      }
      this.emit('statechange', this.state);
    };
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'resize', 'timeupdate', 'durationchange',
      'seeking', 'seeked', 'play', 'pause', 'ended', 'volumechange', 'ratechange']) video.addEventListener(event, sync, { signal });
    const fail = (error: unknown) => {
      if (signal.aborted || this.controller !== controller) return;
      const normalized = error instanceof Error ? error : new Error(String(error));
      controller.abort();
      this.state = { ...this.state, loading: false, error: normalized.message };
      this.emit('error', normalized); this.emit('statechange', this.state);
    };
    video.addEventListener('error', () => fail(new Error('Browser media recovery cannot decode this video codec.')), { signal });
    try {
      const playback = await recoverBrowserVideo(source, video, { ...this.options, signal, autoplay: false, onError: fail });
      if (signal.aborted || this.controller !== controller) { await playback.close(); return; }
      this.playback = playback; sync();
    } catch (error) { fail(error); }
  }
  getState() { return this.state; }
  on<T extends PreviewEventName>(event: T, handler: (payload: PreviewEventMap[T]) => void) {
    const handlers = this.listeners.get(event) ?? new Set(); this.listeners.set(event, handlers);
    handlers.add(handler as (payload: never) => void);
    return () => { handlers.delete(handler as (payload: never) => void); };
  }
  private emit<T extends PreviewEventName>(event: T, payload: PreviewEventMap[T]) {
    this.listeners.get(event)?.forEach(handler => handler(payload as never));
  }
  async fullscreen() {
    if (document.fullscreenElement === this.root) await document.exitFullscreen?.();
    else await this.root?.requestFullscreen?.();
  }
  destroy() {
    this.controller?.abort(); this.controller = undefined;
    this.removeParent?.(); this.removeParent = undefined; this.release();
    this.state = { ...this.state, loading: false };
  }
  private release() {
    const playback = this.playback; this.playback = undefined;
    void playback?.close();
    this.root?.remove(); this.root = undefined; this.video = undefined;
  }
}
