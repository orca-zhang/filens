export interface VideoPlaybackState {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  playbackRate: number;
  audioAvailable: boolean;
  scale?: number;
}

export interface VideoPlaybackActions {
  signal: AbortSignal;
  mediaName?: 'video' | 'panorama video';
  translate?: (message: string) => string;
  togglePlayback(): void;
  seek(seconds: number): void;
  toggleMuted(): void;
  setVolume(volume: number): void;
  setPlaybackRate(rate: number): void;
  fullscreen(): Promise<void>;
  zoom?(delta: number): void;
  resetView?(): void;
}

// Inline vectors keep the controls available in standalone previews too.
const paths = {
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  backward: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="10" font-family="system-ui">5</text>',
  forward: '<path d="M21 10a9 9 0 1 0-2 8M21 4v6h-6"/><text x="12" y="16" text-anchor="middle" fill="currentColor" stroke="none" font-size="10" font-family="system-ui">5</text>',
  volume: '<path d="M11 4 6 8H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/>',
  muted: '<path d="M11 4 6 8H3v8h3l5 4ZM16 9l6 6M22 9l-6 6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  exitFullscreen: '<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>',
  zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
  zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
};
type Icon = keyof typeof paths;

function setButton(button: HTMLButtonElement, label: string, icon: Icon): void {
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg>`;
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(value / 60);
  const remainder = String(value % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

/** Shared by ordinary, recovered and calibrated panorama videos. */
export function createVideoPlaybackControls(root: HTMLElement, actions: VideoPlaybackActions) {
  const { signal } = actions;
  const mediaName = actions.mediaName ?? 'video';
  const t = actions.translate ?? ((message: string) => message);
  const labels = new Map<HTMLElement, string>();
  const label = (node: HTMLElement, key: string) => {
    labels.set(node, key);
    node.setAttribute('aria-label', t(key));
    if (node instanceof HTMLButtonElement || node instanceof HTMLSelectElement) node.title = t(key);
  };
  const updateButton = (node: HTMLButtonElement, key: string, icon: Icon) => {
    setButton(node, t(key), icon);
    labels.set(node, key);
  };
  const controls = document.createElement('div');
  controls.className = 'pptxv-video-controls';
  controls.dataset.previewControls = '';
  controls.setAttribute('role', 'group');
  label(controls, mediaName === 'video' ? 'Video controls' : 'Panorama video controls');
  const viewControls = document.createElement('div');
  viewControls.className = 'panoramav-view-controls';
  viewControls.dataset.previewControls = '';
  viewControls.setAttribute('role', 'group');
  label(viewControls, 'Panorama view controls');
  const button = (parent: HTMLElement, label: string, icon: Icon, action: () => void) => {
    const node = document.createElement('button');
    node.type = 'button';
    updateButton(node, label, icon);
    node.addEventListener('click', action, { signal });
    parent.append(node);
    return node;
  };

  let state: VideoPlaybackState;
  let scrubbing = false;
  const timeline = document.createElement('input');
  timeline.className = 'pptxv-video-timeline';
  timeline.type = 'range';
  timeline.min = '0';
  timeline.step = '0.01';
  label(timeline, 'Playback position');
  const time = document.createElement('output');
  time.className = 'pptxv-video-time';
  const showPosition = (position: number) => {
    time.value = `${formatTime(position)} / ${formatTime(state.duration)}`;
    timeline.setAttribute('aria-valuetext', time.value);
    timeline.style.setProperty('--pptxv-video-progress', `${state.duration > 0 ? Math.min(100, position / state.duration * 100) : 0}%`);
  };
  timeline.addEventListener('input', () => {
    scrubbing = true;
    showPosition(Number(timeline.value));
  }, { signal });
  timeline.addEventListener('change', () => {
    const target = Number(timeline.value);
    scrubbing = false;
    actions.seek(target);
  }, { signal });
  timeline.addEventListener('pointercancel', () => { scrubbing = false; }, { signal });
  timeline.addEventListener('blur', () => { scrubbing = false; }, { signal });
  controls.append(timeline);
  const row = document.createElement('div');
  row.className = 'pptxv-video-control-row';
  const play = button(row, 'Play', 'play', actions.togglePlayback);
  const backward = button(row, 'Rewind 5 seconds', 'backward', () => actions.seek(state.currentTime - 5));
  const forward = button(row, 'Forward 5 seconds', 'forward', () => actions.seek(state.currentTime + 5));
  backward.className = forward.className = 'pptxv-video-skip';
  row.append(time);
  const spacer = document.createElement('span');
  spacer.className = 'pptxv-video-control-spacer';
  row.append(spacer);
  const audio = document.createElement('div');
  audio.className = 'pptxv-video-volume';
  const mute = button(audio, 'Unmute', 'muted', actions.toggleMuted);
  const volume = document.createElement('input');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.01';
  label(volume, 'Volume');
  volume.addEventListener('input', () => actions.setVolume(Number(volume.value)), { signal });
  audio.append(volume);
  row.append(audio);
  const speed = document.createElement('select');
  speed.className = 'pptxv-video-rate';
  label(speed, 'Playback speed');
  for (const rate of [0.5, 1, 1.5, 2]) {
    const option = document.createElement('option');
    option.value = String(rate);
    option.textContent = `${rate}×`;
    speed.append(option);
  }
  speed.addEventListener('change', () => actions.setPlaybackRate(Number(speed.value)), { signal });
  row.append(speed);
  let fullscreenUnavailable = false;
  const fullscreen = button(row, 'Enter fullscreen', 'fullscreen', () => {
    void actions.fullscreen().catch(() => {
      fullscreenUnavailable = true;
      syncFullscreen();
    });
  });
  fullscreen.disabled = !root.requestFullscreen;
  const syncFullscreen = () => {
    const active = document.fullscreenElement === root;
    updateButton(fullscreen, active ? 'Exit fullscreen' : 'Enter fullscreen', active ? 'exitFullscreen' : 'fullscreen');
    if (fullscreen.disabled || fullscreenUnavailable) fullscreen.title = t('Fullscreen is unavailable in this browser');
  };
  document.addEventListener('fullscreenchange', syncFullscreen, { signal });
  syncFullscreen();
  controls.append(row);
  let zoomOut: HTMLButtonElement | undefined, zoomIn: HTMLButtonElement | undefined;
  if (actions.zoom && actions.resetView) {
    zoomOut = button(viewControls, 'Zoom out', 'zoomOut', () => actions.zoom?.(-0.2));
    zoomIn = button(viewControls, 'Zoom in', 'zoomIn', () => actions.zoom?.(0.2));
    button(viewControls, 'Reset view', 'reset', actions.resetView);
    root.append(viewControls);
  }
  root.append(controls);
  root.classList.add('pptxv-has-video-controls');
  root.tabIndex = 0;
  root.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target !== root) return;
    switch (event.key.toLowerCase()) {
      case ' ': case 'k': actions.togglePlayback(); break;
      case 'arrowleft': actions.seek(state.currentTime - 5); break;
      case 'arrowright': actions.seek(state.currentTime + 5); break;
      case 'm': if (state.audioAvailable) actions.toggleMuted(); break;
      case 'f': fullscreen.click(); break;
      default: return;
    }
    event.preventDefault();
  }, { signal });

  return {
    refreshTranslations() {
      labels.forEach((key, node) => label(node, key));
      syncFullscreen();
    },
    addControl(element: HTMLElement) { row.insertBefore(element, speed); },
    sync(next: VideoPlaybackState) {
      const changedPlayback = !state || state.paused !== next.paused;
      const changedAudio = !state || state.audioAvailable !== next.audioAvailable || state.muted !== next.muted || state.volume !== next.volume;
      state = next;
      if (changedPlayback) updateButton(play, state.paused ? 'Play' : 'Pause', state.paused ? 'play' : 'pause');
      const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
      timeline.max = String(duration || 0.1);
      timeline.disabled = backward.disabled = forward.disabled = duration <= 0;
      if (!scrubbing) {
        timeline.value = String(Math.min(state.currentTime, duration));
        showPosition(state.currentTime);
      }
      if (changedAudio) {
        const silent = state.muted || state.volume === 0;
        updateButton(mute, state.audioAvailable ? (silent ? 'Unmute' : 'Mute') : 'Audio unavailable for this panorama preview', silent ? 'muted' : 'volume');
        mute.disabled = volume.disabled = !state.audioAvailable;
        volume.hidden = !state.audioAvailable;
        volume.value = String(state.muted ? 0 : state.volume);
        volume.setAttribute('aria-valuetext', `${Math.round(Number(volume.value) * 100)}%`);
      }
      speed.value = String(state.playbackRate);
      if (zoomOut) zoomOut.disabled = (state.scale ?? 1) <= 0.5;
      if (zoomIn) zoomIn.disabled = (state.scale ?? 1) >= 2.4;
    },
    remove() {
      controls.remove();
      viewControls.remove();
      root.classList.remove('pptxv-has-video-controls');
      root.removeAttribute('tabindex');
    }
  };
}
