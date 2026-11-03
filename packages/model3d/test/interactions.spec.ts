import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrthographicCamera } from 'three';
import { createModel3dPreviewDriver } from '../src';

const mock = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('three', async () => ({
  ...await vi.importActual<typeof import('three')>('three'),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    getContext = () => ({});
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn();
    render = mock.render;
    dispose = vi.fn();
  }
}));

let session: ReturnType<ReturnType<typeof createModel3dPreviewDriver>['createSession']>;
let canvas: HTMLCanvasElement;
let captures: Set<number>;

function pointer(type: string, id: number, x: number, y: number, pointerType = 'touch'): void {
  canvas.dispatchEvent(Object.assign(new Event(type), {
    pointerId: id, clientX: x, clientY: y, pointerType
  }));
}

beforeEach(async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  mock.render.mockClear();
  const host = document.createElement('div');
  document.body.append(host);
  session = createModel3dPreviewDriver().createSession(host);
  const source = new TextEncoder().encode(`solid triangle
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid triangle`);
  await session.load(source, { descriptor: { source, name: 'triangle.stl', extension: 'stl' } });
  canvas = host.querySelector('canvas')!;
  captures = new Set();
  canvas.setPointerCapture = vi.fn(id => { captures.add(id); });
  canvas.hasPointerCapture = vi.fn(id => captures.has(id));
  canvas.releasePointerCapture = vi.fn(id => { captures.delete(id); });
});

afterEach(() => {
  session?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('3D pointer controls', () => {
  it.each(['touch', 'mouse', 'pen'])('orbits with a single %s pointer and publishes camera state', pointerType => {
    const before = session.getState().camera?.position;
    const changed = vi.fn();
    session.on('statechange', changed);
    pointer('pointerdown', 1, 100, 100, pointerType);
    pointer('pointermove', 1, 140, 120, pointerType);
    pointer('pointerup', 1, 140, 120, pointerType);
    expect(session.getState().camera?.position).not.toEqual(before);
    expect(session.getState().camera?.viewPreset).toBe('free');
    expect(session.getState().scale).toBe(1);
    expect(changed).toHaveBeenCalled();
    expect(captures.size).toBe(0);
  });

  it('pinches in both directions without changing the orbit', () => {
    const before = session.getState().camera!.position;
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 300, 100);
    expect(session.getState().scale).toBeCloseTo(2);
    const after = session.getState().camera!.position;
    expect(after[0] / after[2]).toBeCloseTo(before[0] / before[2]);
    expect(after[1] / after[2]).toBeCloseTo(before[1] / before[2]);
    pointer('pointermove', 2, 150, 100);
    expect(session.getState().scale).toBeCloseTo(0.5);
  });

  it('resumes orbiting smoothly when one finger of a pinch is lifted', () => {
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 250, 100);
    pointer('pointerup', 2, 250, 100);
    const before = session.getState().camera;
    pointer('pointermove', 1, 100, 100);
    expect(session.getState().camera).toEqual(before);
    pointer('pointermove', 1, 120, 100);
    expect(session.getState().camera).not.toEqual(before);
    expect(session.getState().scale).toBeCloseTo(1.5);
  });

  it.each(['pointercancel', 'lostpointercapture'])('recovers from %s and ignores untracked pointers', event => {
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    if (event === 'lostpointercapture') captures.delete(2);
    pointer(event, 2, 200, 100);
    const before = session.getState().camera;
    pointer('pointermove', 2, 300, 100);
    expect(session.getState().camera).toEqual(before);
    pointer('pointermove', 1, 120, 100);
    expect(session.getState().camera).not.toEqual(before);
    pointer('pointerup', 1, 120, 100);
    const after = session.getState().camera;
    pointer('pointermove', 1, 160, 100);
    expect(session.getState().camera).toEqual(after);
    expect(captures.size).toBe(0);
  });

  it('keeps pinching finite and within zoom limits when fingers coincide', () => {
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 100, 100);
    pointer('pointermove', 2, 200, 100);
    expect(session.getState().scale).toBe(1);
    pointer('pointermove', 2, 10000, 100);
    expect(session.getState().scale).toBe(4);
    pointer('pointermove', 2, 101, 100);
    expect(session.getState().scale).toBe(0.2);
    pointer('pointermove', 2, 100, 100);
    expect(session.getState().scale).toBe(0.2);
  });

  it('changes the visible zoom in orthographic projection', () => {
    session.setCameraProjection?.('orthographic');
    // Render once so the renderer exposes the newly selected camera.
    const renderFrame = (session as unknown as { renderFrame(): void }).renderFrame.bind(session);
    renderFrame();
    const camera = mock.render.mock.calls[mock.render.mock.calls.length - 1]![1] as OrthographicCamera;
    const height = camera.top - camera.bottom;
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointermove', 2, 300, 100);
    expect(camera.top - camera.bottom).toBeCloseTo(height / 2);
  });

  it('measures taps while excluding pinches, cancelled touches and drags that return to the start', () => {
    session.setMeasurementActive?.(true);
    const pick = vi.spyOn(session as unknown as { pickMeasurementPoint(x: number, y: number): void }, 'pickMeasurementPoint');
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerup', 1, 100, 100);
    expect(pick).toHaveBeenCalledTimes(1);
    pick.mockClear();

    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    pointer('pointerup', 2, 200, 100);
    pointer('pointerup', 1, 100, 100);
    pointer('pointerdown', 1, 100, 100);
    pointer('pointercancel', 1, 100, 100);
    pointer('pointerup', 1, 100, 100);
    pointer('pointerdown', 1, 100, 100);
    pointer('pointermove', 1, 130, 100);
    pointer('pointermove', 1, 100, 100);
    pointer('pointerup', 1, 100, 100);
    expect(pick).not.toHaveBeenCalled();
  });

  it('releases all pointer captures and detaches controls on destroy', () => {
    pointer('pointerdown', 1, 100, 100);
    pointer('pointerdown', 2, 200, 100);
    session.destroy();
    expect(captures.size).toBe(0);
    const before = session.getState();
    pointer('pointermove', 2, 300, 100);
    expect(session.getState()).toEqual(before);
  });

  it('retains wheel zoom', () => {
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(session.getState().scale).toBeCloseTo(1.08);
  });
});
