import { describe, expect, it } from 'vitest';
import { measurePreviewTimings } from '../src/preview-timings';

const sourceUrl = 'https://files.example.test/document.js';
const resource = (name: string, startTime: number, duration: number, initiatorType = 'fetch') => (
  { name, startTime, duration, initiatorType } as PerformanceResourceTiming
);
const measure = (options: Partial<Parameters<typeof measurePreviewTimings>[0]> = {}) => measurePreviewTimings({
  start: 100,
  end: 1100,
  resources: [],
  sdkLoads: [],
  conversions: [],
  ...options
});

describe('preview timings', () => {
  it('keeps slow prefetch and parallel SDK loading out of rendering without subtracting either twice', () => {
    expect(measure({
      prefetchedDownload: { start: 100, end: 1000 },
      sdkLoads: [{ start: 100, end: 700 }]
    })).toEqual({ downloadMs: 900, sdkMs: 600, conversionMs: null, renderMs: 100 });
  });

  it('separates WASM loading from conversion and deduplicates its network timing', () => {
    expect(measure({
      sdkLoads: [{ start: 100, end: 300 }, { start: 500, end: 800 }],
      conversions: [{ start: 500, end: 1000 }],
      sourceUrl,
      resources: [
        resource('/assets/preview.js', 150, 100, 'script'),
        resource('/assets/converter.wasm', 500, 200),
        resource(sourceUrl, 300, 200)
      ]
    })).toEqual({ downloadMs: 200, sdkMs: 500, conversionMs: 200, renderMs: 100 });
  });

  it('counts all file requests, merging overlapping ranges and treating a JS document as the file', () => {
    expect(measure({
      sourceUrl,
      resources: [resource(sourceUrl, 200, 300), resource(sourceUrl, 400, 200), resource(sourceUrl, 700, 100)]
    })).toEqual({ downloadMs: 500, sdkMs: 0, conversionMs: null, renderMs: 500 });
  });

  it('ignores earlier file requests while clipping a shared SDK import to the current preview', () => {
    expect(measure({
      sourceUrl,
      sdkLoads: [{ start: 0, end: 300 }],
      resources: [resource(sourceUrl, 0, 500), resource('/assets/old.js', 0, 80), resource(sourceUrl, 1200, 200)]
    })).toEqual({ downloadMs: null, sdkMs: 200, conversionMs: null, renderMs: 800 });
  });

  it('accumulates conversion attempts, excluding downloads and SDK waits from conversion', () => {
    expect(measure({
      sourceUrl,
      sdkLoads: [{ start: 200, end: 300 }],
      conversions: [{ start: 100, end: 400 }, { start: 600, end: 900 }],
      resources: [resource(sourceUrl, 100, 100)]
    })).toEqual({ downloadMs: 100, sdkMs: 100, conversionMs: 400, renderMs: 400 });
  });

  it('does not charge prefetch before the measurement against rendering', () => {
    expect(measure({ prefetchedDownload: { start: 0, end: 100 } }).renderMs).toBe(1000);
  });

  it('keeps document images and font preloads in rendering', () => {
    expect(measure({
      resources: [resource('/images/cover.png', 100, 300, 'link'), resource('/fonts/body.woff2', 100, 300, 'link')]
    })).toEqual({ downloadMs: null, sdkMs: 0, conversionMs: null, renderMs: 1000 });
  });
});
