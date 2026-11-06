import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaPreviewDriver, createPreviewer, type PreviewerInstance } from '../src/preview';

const previews: PreviewerInstance[] = [];
const setup = () => {
  const host = document.createElement('div');
  document.body.append(host);
  const preview = createPreviewer(host, { drivers: [createMediaPreviewDriver()] });
  previews.push(preview);
  return { host, preview };
};
const updateDuration = (video: HTMLVideoElement, duration: number) => {
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  video.dispatchEvent(new Event('durationchange'));
};
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  previews.splice(0).forEach(preview => preview.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('video total duration', () => {
  it('uses original metadata for state, progress and seeks while prepared media grows', async () => {
    const { host, preview } = setup();
    await preview.preview({ source: '/growing.mp4', name: 'growing.mp4', durationSeconds: 60 });
    const video = host.querySelector('video')!;
    const timeline = host.querySelector<HTMLInputElement>('.pptxv-video-timeline')!;
    for (const duration of [6, 12, 24, 60]) {
      updateDuration(video, duration);
      expect(preview.getState()).toMatchObject({ duration: 60 });
      expect(timeline.max).toBe('60');
      expect(host.querySelector('output')!.textContent).toContain('/ 1:00');
    }
    updateDuration(video, 6);
    video.currentTime = 12;
    video.dispatchEvent(new Event('timeupdate'));
    expect(timeline.style.getPropertyValue('--pptxv-video-progress')).toBe('20%');
    timeline.value = '45';
    timeline.dispatchEvent(new Event('change'));
    expect(video.currentTime).toBe(45);
  });

  it('keeps an unknown stream unseekable until the browser exposes a complete total', async () => {
    const { host, preview } = setup();
    await preview.preview('/unknown.mp4');
    const video = host.querySelector('video')!;
    const timeline = host.querySelector<HTMLInputElement>('.pptxv-video-timeline')!;
    updateDuration(video, Infinity);
    expect(preview.getState()).toMatchObject({ duration: undefined });
    expect(timeline.disabled).toBe(true);
    updateDuration(video, 60);
    expect(preview.getState()).toMatchObject({ duration: 60 });
    expect(timeline.disabled).toBe(false);
    expect(timeline.max).toBe('60');
  });

  it.each([0, -1, NaN, Infinity])('ignores invalid metadata %s and uses native duration', async durationSeconds => {
    const { host, preview } = setup();
    await preview.preview({ source: '/native.mp4', name: 'native.mp4', durationSeconds });
    updateDuration(host.querySelector('video')!, 30);
    expect(preview.getState()).toMatchObject({ duration: 30 });
    expect(host.querySelector<HTMLInputElement>('.pptxv-video-timeline')!.max).toBe('30');
  });

  it('clears the previous total and ignores stale duration events after switching sources', async () => {
    const { host, preview } = setup();
    await preview.preview({ source: '/first.mp4', name: 'first.mp4', durationSeconds: 60 });
    const old = host.querySelector('video')!;
    updateDuration(old, 6);
    await preview.preview('/next.mp4');
    const video = host.querySelector('video')!;
    updateDuration(video, 20);
    updateDuration(old, 90);
    expect(preview.getState()).toMatchObject({ duration: 20 });
    expect(host.querySelector<HTMLInputElement>('.pptxv-video-timeline')!.max).toBe('20');
  });
});
