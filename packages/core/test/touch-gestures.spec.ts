import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPreviewTouchGestures } from '../src/preview/touch-gestures';

const point = (identifier: number, clientX: number, clientY = 100) => ({ identifier, clientX, clientY });
function touch(target: EventTarget, type: string, touches: ReturnType<typeof point>[], changedTouches = touches): Event {
  const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { touches, changedTouches });
  target.dispatchEvent(event);
  return event;
}
function setup(pan?: (x: number, y: number) => void) {
  const element = document.createElement('div'), child = document.createElement('div');
  element.append(child); document.body.append(element);
  let scale = 1;
  const setScale = vi.fn((next: number) => { scale = next; });
  const controller = new AbortController();
  const dispose = bindPreviewTouchGestures(element, { getScale: () => scale, setScale, pan, signal: controller.signal });
  return { element, child, setScale, controller, dispose, scale: () => scale };
}
afterEach(() => document.body.replaceChildren());

describe('preview touch gestures', () => {
  it('preserves single-finger native scrolling and link/control taps', () => {
    const { element, child, setScale, dispose } = setup();
    expect(touch(child, 'touchstart', [point(1, 100)]).defaultPrevented).toBe(false);
    expect(touch(child, 'touchmove', [point(1, 120)]).defaultPrevented).toBe(false);
    touch(child, 'touchend', []);
    const button = document.createElement('button'); element.append(button);
    expect(touch(button, 'touchstart', [point(1, 100), point(2, 200)]).defaultPrevented).toBe(false);
    touch(button, 'touchmove', [point(1, 100), point(2, 300)]);
    expect(setScale).not.toHaveBeenCalled(); dispose();
  });

  it('pinches around the content position and respects limits', () => {
    const { element, child, scale, dispose } = setup();
    element.scrollLeft = 20; element.scrollTop = 30;
    touch(child, 'touchstart', [point(1, 100), point(2, 200)]);
    expect(touch(child, 'touchmove', [point(1, 50), point(2, 250)]).defaultPrevented).toBe(true);
    expect(scale()).toBe(2);
    expect(element.scrollLeft).toBe(190); expect(element.scrollTop).toBe(160);
    touch(child, 'touchmove', [point(1, 50), point(2, 10000)]); expect(scale()).toBe(8);
    touch(child, 'touchmove', [point(1, 50), point(2, 50.01)]); expect(scale()).toBe(0.1);
    touch(child, 'touchmove', [point(1, 50), point(2, 50)]); expect(scale()).toBe(0.1);
    dispose();
  });

  it('continues a pinch when zoom rendering replaces the touched content', () => {
    const { element, child, setScale, scale, dispose } = setup();
    touch(child, 'touchstart', [point(1, 100), point(2, 200)]);
    setScale.mockImplementationOnce(() => element.replaceChildren());
    touch(child, 'touchmove', [point(1, 100), point(2, 250)]);
    touch(child, 'touchmove', [point(1, 100), point(2, 400)]);
    expect(scale()).toBe(2); expect(setScale).toHaveBeenCalledTimes(2);
    touch(child, 'touchend', []); dispose();
  });

  it('pans with one finger, pinches with two, and resumes without jumping', () => {
    const pan = vi.fn(), { child, scale, dispose } = setup(pan);
    touch(child, 'touchstart', [point(1, 100)]);
    touch(child, 'touchmove', [point(1, 120, 110)]);
    expect(pan).toHaveBeenLastCalledWith(20, 10);
    touch(child, 'touchstart', [point(1, 120, 110), point(2, 220, 110)], [point(2, 220, 110)]);
    touch(child, 'touchmove', [point(1, 120, 110), point(2, 320, 110)]);
    expect(scale()).toBe(2); expect(pan).toHaveBeenCalledTimes(1);
    touch(child, 'touchend', [point(1, 120, 110)], [point(2, 320, 110)]);
    touch(child, 'touchmove', [point(1, 130, 110)]);
    expect(pan).toHaveBeenLastCalledWith(10, 0); dispose();
  });

  it.each(['touchcancel', 'abort'])('cleans up after %s and ignores unrelated touches', action => {
    const pan = vi.fn(), { element, child, scale, controller, dispose } = setup(pan);
    touch(child, 'touchstart', [point(1, 100)], [point(1, 100)]);
    touch(child, 'touchmove', [point(1, 120), point(9, 300)]);
    expect(scale()).toBe(1); expect(pan).toHaveBeenLastCalledWith(20, 0);
    pan.mockClear();
    if (action === 'abort') controller.abort(); else touch(child, 'touchcancel', []);
    touch(child, 'touchmove', [point(1, 200)]);
    expect(pan).not.toHaveBeenCalled();
    if (action === 'abort') expect(element.style.touchAction).toBe('');
    dispose();
  });
});
