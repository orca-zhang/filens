import type { Page } from '@playwright/test';

export async function countNearbyPixels(page: Page, x: number, y: number, rgb: [number, number, number], tolerance = 25) {
  const screenshot = await page.screenshot({ clip: { x: Math.round(x) - 4, y: Math.round(y) - 4, width: 9, height: 9 } });
  return page.evaluate(async ({ png, rgb, tolerance }) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), byte => byte.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (rgb.every((component, index) => Math.abs(component - pixels[offset + index]) <= tolerance)) count++;
    }
    return count;
  }, { png: screenshot.toString('base64'), rgb, tolerance });
}
