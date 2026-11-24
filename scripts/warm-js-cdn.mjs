import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function cdnWarmupTargets(manifest) {
  const targets = manifest.files.filter(file => /^dist\/(split|all-in-one)\/[^?#]*\.(m?js|wasm)$/.test(file.path))
    .map(file => ({ url: `https://filens.cc/cdn/filens-preview@${manifest.version}/${file.path.slice(5)}`, bytes: file.bytes }));
  for (const mode of ['split', 'all-in-one']) {
    assert.ok(targets.some(target => target.url.endsWith(`/${mode}/filens.js`)), `Missing ${mode} CDN entry`);
  }
  return targets;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifest = JSON.parse(await readFile(new URL('../docs/preview-package-sizes.json', import.meta.url), 'utf8'));
  const release = JSON.parse(await readFile(new URL('../docs/preview-release-sizes.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, release.components.preview, 'CDN package and site release versions differ');
  const targets = cdnWarmupTargets(manifest);
  for (let offset = 0; offset < targets.length; offset += 4) {
    const results = await Promise.allSettled(targets.slice(offset, offset + 4).map(async target => {
      const response = await fetch(target.url, { headers: { 'Accept-Encoding': 'br, gzip' }, signal: AbortSignal.timeout(45_000) });
      assert.equal(response.status, 200, target.url);
      let bytes = 0;
      for await (const chunk of response.body) bytes += chunk.length;
      assert.equal(bytes, target.bytes, `Unexpected decoded size: ${target.url}`);
      console.log(`${response.headers.get('x-vercel-cache') ?? 'unknown'} ${bytes} ${target.url}`);
    }));
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, 'CDN warmup failed');
  }
  console.log(`Warmed ${targets.length} runtime files at this runner's CDN edge.`);
}
