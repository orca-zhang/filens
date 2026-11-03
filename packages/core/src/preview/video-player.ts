import { createVideoPlaybackControls } from './video-controls';

/** Bind the shared controls to an ordinary or recovered HTML video. */
export function createVideoPreviewPlayer(root: HTMLElement, video: HTMLVideoElement, signal: AbortSignal) {
  const nativeControls = video.controls;
  video.controls = false;
  const controls = createVideoPlaybackControls(root, {
    signal,
    togglePlayback: () => {
      if (video.paused) void video.play().catch(() => undefined); else video.pause();
    },
    seek: seconds => {
      if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(seconds, video.duration));
    },
    toggleMuted: () => {
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
    },
    setVolume: volume => { video.volume = volume; video.muted = volume === 0; },
    setPlaybackRate: rate => { video.playbackRate = rate; },
    fullscreen: async () => {
      if (document.fullscreenElement === root) await document.exitFullscreen?.();
      else await root.requestFullscreen?.();
    }
  });
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'pptxv-video-pip';
    pip.setAttribute('aria-label', 'Picture in picture');
    pip.title = 'Picture in picture';
    pip.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor"/></svg>';
    pip.addEventListener('click', () => {
      const request = document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture();
      void request.catch(() => { pip.title = 'Picture in picture is unavailable for this video'; });
    }, { signal });
    const syncPip = () => {
      const label = document.pictureInPictureElement === video ? 'Exit picture in picture' : 'Picture in picture';
      pip.title = label;
      pip.setAttribute('aria-label', label);
    };
    video.addEventListener('enterpictureinpicture', syncPip, { signal });
    video.addEventListener('leavepictureinpicture', syncPip, { signal });
    for (const event of ['loadedmetadata', 'loadeddata', 'resize']) {
      video.addEventListener(event, () => { pip.disabled = !video.videoWidth; }, { signal });
    }
    pip.disabled = !video.videoWidth;
    controls.addControl(pip);
  }
  const captions = document.createElement('select');
  captions.className = 'pptxv-video-rate pptxv-video-captions';
  captions.setAttribute('aria-label', 'Video subtitles');
  captions.title = 'Subtitles';
  const syncCaptions = () => {
    const tracks = Array.from(video.textTracks).filter(track => track.kind === 'subtitles' || track.kind === 'captions');
    captions.hidden = tracks.length === 0;
    captions.replaceChildren();
    const off = document.createElement('option');
    off.value = '-1'; off.textContent = 'CC off';
    captions.append(off);
    tracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = track.label || track.language || `Subtitles ${index + 1}`;
      captions.append(option);
    });
    captions.value = String(tracks.findIndex(track => track.mode === 'showing'));
  };
  captions.addEventListener('change', () => {
    const tracks = Array.from(video.textTracks).filter(track => track.kind === 'subtitles' || track.kind === 'captions');
    tracks.forEach((track, index) => { track.mode = index === Number(captions.value) ? 'showing' : 'disabled'; });
  }, { signal });
  for (const event of ['addtrack', 'removetrack', 'change']) video.textTracks.addEventListener?.(event, syncCaptions, { signal });
  controls.addControl(captions);
  syncCaptions();
  const sync = () => controls.sync({
    currentTime: video.currentTime,
    duration: video.duration,
    paused: video.paused,
    muted: video.muted,
    volume: video.volume,
    playbackRate: video.playbackRate,
    audioAvailable: true
  });
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'ended', 'volumechange', 'ratechange']) {
    video.addEventListener(event, sync, { signal });
  }
  signal.addEventListener('abort', () => {
    controls.remove();
    video.controls = nativeControls;
  }, { once: true });
  sync();
}
