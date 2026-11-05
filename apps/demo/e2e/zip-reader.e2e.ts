import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';

test('reads large ZIP entries with native inflate, preserves cancellation and rejects forged sizes', async ({ page }) => {
  const data = Uint8Array.from({ length: 400_000 }, (_, index) => index % 251);
  const bytes = zipSync({ 'large.bin': data });
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/core/src/zip.ts')}`, page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { openUnencryptedZipArchive } = await import(/* @vite-ignore */ moduleUrl);
    const NativeDecompressionStream = globalThis.DecompressionStream;
    let inflates = 0;
    globalThis.DecompressionStream = new Proxy(NativeDecompressionStream, {
      construct(target, args) { inflates++; return Reflect.construct(target, args); }
    });
    try {
      const source = new Uint8Array(bytes);
      const entry = (await openUnencryptedZipArchive(source)).get('large.bin')!;
      const controller = new AbortController();
      const pending = entry.bytes(undefined, controller.signal);
      queueMicrotask(() => controller.abort());
      const cancelled = await pending.then(() => 'loaded', (error: Error) => error.name);
      const loaded: Uint8Array = await entry.bytes();
      const cached = loaded === await entry.bytes();
      const errors = [];
      for (const size of [300_000, 600_000]) {
        const forged = source.slice();
        const view = new DataView(forged.buffer);
        const directory = view.getUint32(forged.length - 6, true);
        view.setUint32(directory + 24, size, true);
        const invalid = (await openUnencryptedZipArchive(forged)).get('large.bin')!;
        errors.push(await invalid.bytes().then(() => 'loaded', (error: Error) => error.message));
      }
      return { cancelled, cached, inflates, errors, length: loaded.length,
        matches: loaded.every((value, index) => value === index % 251) };
    } finally { globalThis.DecompressionStream = NativeDecompressionStream; }
  }, { moduleUrl, bytes: [...bytes] });
  expect(result).toEqual({ cancelled: 'AbortError', cached: true, inflates: 3,
    errors: ['Invalid ZIP entry size.', 'Invalid ZIP entry size.'], length: data.length, matches: true });
});
