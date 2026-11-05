export interface TimeRange {
  start: number;
  end: number;
}

/** Wall time of the union, clipped to the measured preview. */
export function elapsedTime(ranges: TimeRange[], start: number, end: number): number {
  const sorted = ranges.map(range => ({
    start: Math.max(start, range.start),
    end: Math.min(end, range.end)
  })).filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let previousEnd = start;
  for (const range of sorted) {
    total += Math.max(0, range.end - Math.max(previousEnd, range.start));
    previousEnd = Math.max(previousEnd, range.end);
  }
  return total;
}

export function measurePreviewTimings(options: {
  start: number;
  end: number;
  sourceUrl?: string;
  prefetchedDownload?: TimeRange;
  resources: PerformanceResourceTiming[];
  sdkLoads: TimeRange[];
  conversions: TimeRange[];
}) {
  const { start, end, sourceUrl, prefetchedDownload, conversions } = options;
  const downloads: TimeRange[] = prefetchedDownload ? [prefetchedDownload] : [];
  const sdkLoads = [...options.sdkLoads];
  for (const resource of options.resources) {
    if (resource.startTime < start || resource.startTime >= end) continue;
    const range = { start: resource.startTime, end: resource.startTime + resource.duration };
    if (resource.name === sourceUrl) {
      downloads.push(range);
    } else if (resource.initiatorType === 'script'
      || /\.(?:[cm]?js|css|wasm)(?:[?#]|$)/i.test(resource.name)) {
      sdkLoads.push(range);
    }
  }
  const sdkMs = elapsedTime(sdkLoads, start, end);
  const conversionMs = elapsedTime([...conversions, ...sdkLoads, ...downloads], start, end)
    - elapsedTime([...sdkLoads, ...downloads], start, end);
  return {
    downloadMs: downloads.length ? elapsedTime(downloads, start, end) : null,
    sdkMs,
    conversionMs: conversions.length ? conversionMs : null,
    // Parallel downloads and SDK loads must only be subtracted once.
    renderMs: Math.max(0, end - start - elapsedTime([...downloads, ...sdkLoads, ...conversions], start, end))
  };
}
