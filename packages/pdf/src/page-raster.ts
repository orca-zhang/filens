export const PDF_MAX_RASTER_PIXELS = 8 * 1024 * 1024;
export const PDF_DETAIL_RASTER_PIXELS = PDF_MAX_RASTER_PIXELS / 2;
export const PDF_WINDOW_RASTER_PIXELS = 2 * PDF_MAX_RASTER_PIXELS;
const MAX_RASTER_SIDE = 8192;

interface RasterDemand { index: number; pixels: number }

export function budgetPdfRasters(current: RasterDemand | undefined, visible: readonly RasterDemand[],
  nearby: readonly RasterDemand[]): Map<number, number> {
  const budgets = new Map<number, number>();
  let remaining = PDF_WINDOW_RASTER_PIXELS;
  if (current) {
    budgets.set(current.index, current.pixels);
    remaining -= current.pixels;
  }
  const extra = visible.reduce((sum, page) => sum + page.pixels - 1, 0);
  const share = extra > 0 ? Math.min(1, Math.max(0, remaining - visible.length) / extra) : 1;
  for (const page of visible) {
    if (!remaining) break;
    const pixels = Math.min(remaining, 1 + Math.floor((page.pixels - 1) * share));
    budgets.set(page.index, pixels);
    remaining -= pixels;
  }
  if (share === 1) for (const page of nearby) {
    if (page.pixels > remaining) continue;
    budgets.set(page.index, page.pixels);
    remaining -= page.pixels;
  }
  return budgets;
}

export function sizePdfRaster(width: number, height: number, density: number, maxPixels = PDF_MAX_RASTER_PIXELS) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid PDF page dimensions.');
  }
  const deviceWidth = Math.ceil(width * density), deviceHeight = Math.ceil(height * density);
  if (deviceWidth <= MAX_RASTER_SIDE && deviceHeight <= MAX_RASTER_SIDE && deviceWidth * deviceHeight <= maxPixels) {
    return { width: deviceWidth, height: deviceHeight, limited: false };
  }
  const scale = Math.min(density, MAX_RASTER_SIDE / Math.max(width, height), Math.sqrt(maxPixels / width / height));
  let rasterWidth = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.floor(width * scale)));
  let rasterHeight = Math.max(1, Math.min(MAX_RASTER_SIDE, Math.floor(height * scale)));
  // An extremely narrow side may have rounded up to one pixel.
  if (rasterWidth * rasterHeight > maxPixels) {
    if (rasterWidth >= rasterHeight) rasterWidth = Math.floor(maxPixels / rasterHeight);
    else rasterHeight = Math.floor(maxPixels / rasterWidth);
  }
  return {
    width: rasterWidth, height: rasterHeight,
    limited: true
  };
}

export function sizeVirtualPdfRaster(width: number, height: number, density: number, budget: number) {
  const full = sizePdfRaster(width, height, density, budget);
  const detail = full.limited && budget > 1;
  return {
    raster: detail ? sizePdfRaster(width, height, density, Math.floor(budget / 2)) : full,
    detail
  };
}
