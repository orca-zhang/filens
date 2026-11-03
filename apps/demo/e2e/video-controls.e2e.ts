import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

const cases = [
  { extension: 'mp4', file: 'sample-video.mp4' },
  { extension: 'webm', file: 'panorama/nasa-black-hole-360.webm' },
  { extension: 'mov', file: 'sample-video.mp4', recovery: true },
  ...['360v', 'vr360', 'insv', 'osv'].map(extension => ({ extension, file: 'panorama/nasa-black-hole-360.webm', panorama: true }))
];

for (const width of [960, 320]) {
  for (const fixture of cases) {
    test(`${fixture.extension}: playback controls work at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('./?view=preview');
      const panorama = 'panorama' in fixture;
      const recovery = 'recovery' in fixture;
      const moduleUrl = new URL(`@fs${resolve(`packages/${panorama ? 'panorama' : recovery ? 'media' : 'core'}/src/index.ts`)}`, page.url()).href;
      await page.evaluate(async ({ moduleUrl, fixture, panorama, recovery }) => {
        const lib = await import(/* @vite-ignore */ moduleUrl);
        const host = document.createElement('div');
        host.id = 'video-controls-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:9999';
        document.body.replaceChildren(host);
        const url = new URL(`samples/${fixture.file}`, location.href).href;
        const driver = panorama ? lib.createPanoramaPreviewDriver()
          : recovery ? lib.createMediaPreviewDrivers({ browserMedia: true }).find((driver: any) => driver.id === 'media')
          : lib.createMediaPreviewDriver();
        const session = driver.createSession(host, { resourceResolver: () => url });
        (window as any).videoControlsTest = session;
        await session.load(url, {
          route: { family: panorama ? 'panorama-video' : 'video', sourceFormat: fixture.extension },
          descriptor: { source: url, name: `test.${fixture.extension}`, extension: fixture.extension,
            contentType: fixture.file.endsWith('.webm') ? 'video/webm' : fixture.extension === 'mov' ? 'video/quicktime' : 'video/mp4' }
        });
        if (recovery) host.querySelector('source')!.dispatchEvent(new Event('error'));
      }, { moduleUrl, fixture, panorama, recovery });
      const host = page.locator('#video-controls-test');
      const video = host.locator('video');
      await expect.poll(() => page.evaluate(() => (window as any).videoControlsTest.getState().loading)).toBe(false);
      if (recovery) await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentSrc)).toMatch(/^blob:/);
      const name = panorama ? 'panorama video' : 'video';
      const capitalized = panorama ? 'Panorama video' : 'Video';
      const play = host.getByRole('button', { name: `Play ${name}`, exact: true });
      const mute = host.getByRole('button', { name: `${panorama ? 'Unmute' : 'Mute'} ${name}`, exact: true });
      const speed = host.getByRole('combobox', { name: `${capitalized} playback speed` });
      const fullscreen = host.getByRole('button', { name: `Enter ${panorama ? 'panorama' : 'video'} fullscreen` });
      for (const control of [play, mute, speed, fullscreen]) {
        await expect(control).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      // Exercise the actual buttons, not HTMLMediaElement.play() from the test.
      await play.click();
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
      await host.getByRole('button', { name: `Pause ${name}`, exact: true }).click();
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
      await speed.selectOption('1.5');
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5);
      const position = host.getByRole('slider', { name: `${capitalized} position`, exact: true });
      await position.evaluate(element => {
        const slider = element as HTMLInputElement;
        slider.value = String(Number(slider.max) / 2);
        slider.dispatchEvent(new Event('input'));
        slider.dispatchEvent(new Event('change'));
      });
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime / video.duration)).toBeCloseTo(0.5, 1);
      await expect(play).toBeVisible();
      const wasMuted = await video.evaluate((video: HTMLVideoElement) => video.muted);
      await mute.click();
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.muted)).toBe(!wasMuted);
      if (width > 540) {
        await host.getByRole('slider', { name: `${capitalized} volume` }).fill('0.4');
        await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.volume)).toBe(0.4);
      }
      if (panorama) {
        await host.getByRole('button', { name: 'Zoom in panorama' }).click();
        expect(await page.evaluate(() => (window as any).videoControlsTest.getState().scale)).toBeGreaterThan(1);
        await host.getByRole('button', { name: 'Reset panorama view' }).click();
        expect(await page.evaluate(() => (window as any).videoControlsTest.getState().scale)).toBe(1);
      }
      if (!panorama) {
        await video.evaluate((video: HTMLVideoElement) => { video.addTextTrack('captions', 'English', 'en'); });
        const captions = host.getByRole('combobox', { name: 'Video subtitles' });
        await expect(captions).toBeVisible();
        await captions.selectOption('0');
        expect(await video.evaluate((video: HTMLVideoElement) => video.textTracks[0].mode)).toBe('showing');
        await captions.selectOption('-1');
        expect(await video.evaluate((video: HTMLVideoElement) => video.textTracks[0].mode)).toBe('disabled');
        const bounds = (await fullscreen.boundingBox())!;
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await fullscreen.click();
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('pptxv-has-video-controls'))).toBe(true);
      await expect(play).toBeVisible();
      if (panorama) await expect(host.locator('canvas')).toBeVisible();
      await host.getByRole('button', { name: `Exit ${panorama ? 'panorama' : 'video'} fullscreen` }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await host.locator('.pptxv-has-video-controls').focus();
      await page.keyboard.press('Space');
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
      await page.keyboard.press('Space');
      await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
      await page.screenshot({ path: `test-results/video-controls-${fixture.extension}-${width}.png` });
      await page.evaluate(() => (window as any).videoControlsTest.destroy());
      await expect(host.locator('button')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
