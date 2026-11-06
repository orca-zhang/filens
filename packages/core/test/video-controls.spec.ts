import { describe, expect, it, vi } from 'vitest';
import { createVideoPlaybackControls } from '../src/preview/video-controls';

describe('video control translations', () => {
  it('keeps state-dependent labels and fullscreen errors translated while preserving a pending seek', async () => {
    const root = document.createElement('div');
    root.requestFullscreen = vi.fn();
    const controller = new AbortController();
    const dictionary: Record<string, string> = {
      Play: '播放', Pause: '暂停', Mute: '静音', Unmute: '取消静音',
      'Enter fullscreen': '进入全屏',
      'Fullscreen is unavailable in this browser': '此浏览器不支持全屏'
    };
    let chinese = true;
    const seek = vi.fn();
    const controls = createVideoPlaybackControls(root, {
      signal: controller.signal, translate: key => chinese ? dictionary[key] ?? key : key,
      togglePlayback: vi.fn(), seek, toggleMuted: vi.fn(), setVolume: vi.fn(), setPlaybackRate: vi.fn(),
      fullscreen: async () => { throw new Error('unavailable'); }
    });
    const state = { currentTime: 12, duration: 60, paused: true, muted: false, volume: 1, playbackRate: 1, audioAvailable: true };
    controls.sync(state);
    expect(root.querySelector('[aria-label="播放"]')?.getAttribute('title')).toBe('播放');
    controls.sync({ ...state, paused: false, muted: true });
    expect(root.querySelector('[aria-label="暂停"]')?.getAttribute('title')).toBe('暂停');
    expect(root.querySelector('[aria-label="取消静音"]')?.getAttribute('title')).toBe('取消静音');
    const fullscreen = root.querySelector<HTMLButtonElement>('[aria-label="进入全屏"]')!;
    fullscreen.click();
    await Promise.resolve();
    expect(fullscreen.title).toBe('此浏览器不支持全屏');
    const timeline = root.querySelector<HTMLInputElement>('.pptxv-video-timeline')!;
    timeline.value = '35';
    timeline.dispatchEvent(new Event('input'));
    chinese = false;
    controls.refreshTranslations();
    expect(root.querySelector('[aria-label="Pause"]')?.getAttribute('title')).toBe('Pause');
    expect(fullscreen.title).toBe('Fullscreen is unavailable in this browser');
    expect(timeline.value).toBe('35');
    timeline.dispatchEvent(new Event('change'));
    expect(seek).toHaveBeenCalledWith(35);
    controller.abort(); controls.remove();
  });
});
