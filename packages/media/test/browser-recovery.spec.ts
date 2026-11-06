import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewOptions, PreviewSession } from '@filens/core';
import { createCodecPreviewDrivers } from '../src/codec-preview-driver';

const { recover } = vi.hoisted(() => ({ recover: vi.fn() }));
vi.mock('../src/engine', () => ({ recoverBrowserVideo: recover }));
const sessions: PreviewSession[] = [];
const context = (name: string) => ({ descriptor: { source: '/original.mp4', name, extension: name.split('.').pop()! } });
const setup = (options: PreviewOptions = {}) => {
  const convert = vi.fn();
  const host = document.createElement('div');
  const session = createCodecPreviewDrivers({ convert }, true)[1].createSession(host, options);
  sessions.push(session); return { host, session, convert };
};
beforeEach(() => {
  recover.mockReset(); recover.mockResolvedValue({ close: vi.fn(async () => {}) });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920);
  vi.spyOn(HTMLVideoElement.prototype, 'readyState', 'get').mockReturnValue(2);
});
afterEach(() => { sessions.splice(0).forEach(session => session.destroy()); vi.restoreAllMocks(); });

describe('optional browser recovery', () => {
  it('retains translations after native recovery and refreshes the recovered player in place', async () => {
    let chinese = true;
    const { host, session } = setup({ translate: key => chinese && key === 'Play' ? '播放' : key });
    const load = context('phone.mov');
    await session.load(load.descriptor.source, load);
    expect(host.querySelector('[aria-label="播放"]')).not.toBeNull();
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    expect(host.querySelector('[aria-label="播放"]')).not.toBeNull();
    const video = host.querySelector('video')!;
    video.currentTime = 12;
    chinese = false;
    session.refreshTranslations?.();
    expect(host.querySelector('[aria-label="Play"]')).not.toBeNull();
    expect(host.querySelector('video')).toBe(video);
    expect(video.currentTime).toBe(12);
  });

  it('keeps playable originals on the native path without loading recovery or a converter', async () => {
    const { host, session, convert } = setup(); const load = context('native.mp4');
    await session.load(load.descriptor.source, load);
    host.querySelector('video')!.dispatchEvent(new Event('loadeddata'));
    expect(session.getState()).toMatchObject({ error: null, loading: false });
    expect(recover).not.toHaveBeenCalled(); expect(convert).not.toHaveBeenCalled();
  });

  it('recovers failed MOV locally and never calls even a configured server converter', async () => {
    const { host, session, convert } = setup(); const load = context('phone.mov');
    const errors = vi.fn(); session.on('error', errors);
    await session.load(load.descriptor.source, load);
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    expect(recover.mock.calls[0][0]).toBe('/original.mp4');
    expect(recover.mock.calls[0][2]).toMatchObject({ autoplay: false, signal: expect.any(AbortSignal) });
    host.querySelector('video')!.dispatchEvent(new Event('loadeddata'));
    expect(session.getState()).toMatchObject({ loading: false, error: null, title: 'phone.mov' });
    expect(convert).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled();
    expect(host.querySelectorAll('video')).toHaveLength(1);
  });

  it('reports local unsupported media without silently falling back to a service', async () => {
    recover.mockRejectedValue(new Error('Client recovery cannot preserve this audio codec'));
    const { host, session, convert } = setup(); const load = context('unsupported.mov');
    await session.load(load.descriptor.source, load);
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(session.getState().error).toContain('audio codec'));
    expect(convert).not.toHaveBeenCalled(); expect(host.querySelector('video')).toBeNull();
    expect(session.getState().capabilities.download).toBe(true);
  });

  it('keeps original total duration in state and controls across native recovery', async () => {
    const { host, session } = setup();
    const load = context('growing.mov');
    Object.assign(load.descriptor, { durationSeconds: 60 });
    await session.load(load.descriptor.source, load);
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    const video = host.querySelector('video')!;
    for (const duration of [6, 12, 60]) {
      Object.defineProperty(video, 'duration', { configurable: true, value: duration });
      video.dispatchEvent(new Event('durationchange'));
      expect(session.getState()).toMatchObject({ duration: 60 });
      expect(host.querySelector<HTMLInputElement>('.pptxv-video-timeline')!.max).toBe('60');
    }
  });

  it.each([true, false])('preserves playback settings when native recovery begins (paused=%s)', async paused => {
    const { host, session } = setup(); const load = context('resume.mov');
    await session.load(load.descriptor.source, load);
    const original = host.querySelector('video')!;
    Object.defineProperty(original, 'paused', { value: paused });
    original.currentTime = 42; original.volume = .35; original.muted = true; original.playbackRate = 1.5;
    for (const event of ['timeupdate', 'volumechange', 'ratechange', paused ? 'pause' : 'play']) original.dispatchEvent(new Event(event));
    original.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    const recovered = host.querySelector('video')!;
    expect(recovered).not.toBe(original);
    expect(recovered.volume).toBe(.35); expect(recovered.muted).toBe(true); expect(recovered.playbackRate).toBe(1.5);
    expect(recover.mock.calls[0][2]).toMatchObject({ startTime: 42, autoplay: !paused });
  });

  it('closes late recovery on replacement and never removes the next native player', async () => {
    let complete!: (value: { close: () => Promise<void> }) => void;
    recover.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const { host, session } = setup(); const first = context('first.mp4');
    await session.load(first.descriptor.source, first);
    host.querySelector('source')!.dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    const signal = recover.mock.calls[0][2].signal;
    const next = context('next.mp4'); await session.load(next.descriptor.source, next);
    const video = host.querySelector('video'); const close = vi.fn(async () => {});
    complete({ close });
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(signal.aborted).toBe(true); expect(host.querySelector('video')).toBe(video);
    expect(session.getState().title).toBe('next.mp4');
  });
});
