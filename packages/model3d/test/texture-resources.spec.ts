import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer as NodeBuffer } from 'node:buffer';
import { normalizeResolvedPreviewSource, resolveModelTextureUrl } from '../src/resource-utils';

afterEach(() => vi.unstubAllGlobals());

describe('shared synchronous model texture lookup', () => {
  it.each(['native', 'node', 'compatibility'])('encodes sliced binary textures using %s Base64', mode => {
    const original = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
    const native = vi.fn(function (this: Uint8Array) { return NodeBuffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64'); });
    Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: mode === 'native' ? native : undefined });
    if (mode === 'compatibility') vi.stubGlobal('Buffer', undefined);
    try {
      for (const length of [0, 1, 2, 32768, 32769, 65537]) {
        const bytes = Uint8Array.from({ length: length + 8 }, (_, i) => i % 256);
        const source = new DataView(bytes.buffer, 3, length);
        expect(normalizeResolvedPreviewSource(source, 'image/png'))
          .toBe(`data:image/png;base64,${NodeBuffer.from(bytes.buffer, 3, length).toString('base64')}`);
      }
      expect(native).toHaveBeenCalledTimes(mode === 'native' ? 6 : 0);
    } finally {
      if (original) Object.defineProperty(Uint8Array.prototype, 'toBase64', original);
      else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
    }
  });

  it('tries the model directory, original path and basename, preserving resolver warnings', () => {
    const warnings: string[] = [], urls: string[] = [];
    const resourceResolver = vi.fn(({ source }: { source: string }) => source === 'base.png'
      ? { source: 'https://example.test/base.png', warnings: ['resolved'] }
      : { warnings: ['missing'] });
    const result = resolveModelTextureUrl('textures\\base.png', {
      resourceBasePath: 'models/nested/scene.fbx', sourceFormat: 'custom', resourceResolver
    }, warnings, urls, 'fbx', 'FBX');
    expect(result).toBe('https://example.test/base.png');
    expect(resourceResolver.mock.calls.map(([request]) => request.source)).toEqual([
      'models/nested/textures/base.png', 'textures/base.png', 'base.png'
    ]);
    expect(resourceResolver).toHaveBeenLastCalledWith({
      family: 'model3d', sourceFormat: 'custom', source: 'base.png', relation: 'texture', name: 'base.png'
    });
    expect(warnings).toEqual(['missing', 'missing', 'resolved']);
    expect(urls).toEqual([]);
  });

  it.each([['lwo', 'LWO'], ['dae', 'Collada'], ['fbx', 'FBX'], ['3ds', '3DS'], ['vrml', 'VRML']])(
    'preserves the %s default format and warning text, including repeated candidates', (format, label) => {
      const resourceResolver = vi.fn(() => undefined), warnings: string[] = [];
      expect(resolveModelTextureUrl('base.png', { resourceResolver }, warnings, [], format, label)).toBe('base.png');
      expect(resourceResolver).toHaveBeenCalledTimes(3);
      expect(resourceResolver).toHaveBeenCalledWith({
        family: 'model3d', sourceFormat: format, source: 'base.png', relation: 'texture', name: 'base.png'
      });
      expect(warnings).toEqual([`${label} texture "base.png" could not be resolved; default loader lookup was used.`]);
    }
  );

  it('encodes only the requested byte view and preserves the texture MIME type', () => {
    const storage = new Uint8Array([99, 1, 2, 3, 98]), urls: string[] = [];
    const result = resolveModelTextureUrl('base.png', {
      resourceResolver: () => new DataView(storage.buffer, 1, 3)
    }, [], urls, '3ds', '3DS');
    expect(result).toBe('data:image/png;base64,AQID');
    expect(urls).toEqual([]);
  });

  it('tracks a resolved Blob URL once for loader cleanup', () => {
    vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:texture'); });
    const urls: string[] = [];
    expect(resolveModelTextureUrl('base.png', { resourceResolver: () => new Blob(['texture']) }, [], urls, 'fbx', 'FBX')).toBe('blob:texture');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urls).toEqual(['blob:texture']);
  });

  it('leaves asynchronous results to the default loader', () => {
    const warnings: string[] = [];
    const resourceResolver = vi.fn(async () => 'https://example.test/base.png');
    expect(resolveModelTextureUrl('base.png', { resourceResolver }, warnings, [], 'vrml', 'VRML')).toBe('base.png');
    expect(warnings).toEqual(['VRML texture "base.png" could not be resolved; default loader lookup was used.']);
  });

  it('aborts before calling a resource resolver', () => {
    const controller = new AbortController(), resourceResolver = vi.fn();
    controller.abort();
    expect(() => resolveModelTextureUrl('base.png', { resourceResolver, signal: controller.signal }, [], [], 'fbx', 'FBX'))
      .toThrow(expect.objectContaining({ name: 'AbortError' }));
    expect(resourceResolver).not.toHaveBeenCalled();
  });
});
