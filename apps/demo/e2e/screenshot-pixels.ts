import type { Page } from '@playwright/test';

export async function countNearbyPixels(page: Page, x: number, y: number, rgb: [number, number, number], tolerance = 25,
  viewport = false) {
  const clip = { x: Math.round(x) - 4, y: Math.round(y) - 4, width: 9, height: 9 };
  const screenshot = await page.screenshot(viewport ? {} : { clip });
  return page.evaluate(async ({ png, rgb, tolerance, clip }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), byte => byte.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = clip ? 9 : bitmap.width;
    canvas.height = clip ? 9 : bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, -(clip?.x ?? 0), -(clip?.y ?? 0));
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (rgb.every((component, index) => Math.abs(component - pixels[offset + index]) <= tolerance)) count++;
    }
    return count;
  }, { png: screenshot.toString('base64'), rgb, tolerance, clip: viewport ? clip : null });
}
