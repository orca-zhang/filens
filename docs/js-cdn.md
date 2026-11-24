# JavaScript CDN

FiLens no longer serves preview package bytes from `filens.cc`. The old `/cdn/` paths are removed. Use the versioned npm package through jsDelivr:

```html
<div id="preview" style="height: 80vh"></div>
<script type="module">
  import { createPreview } from 'https://cdn.jsdelivr.net/npm/filens-preview@0.3.7/dist/split/filens.js';
  createPreview('#preview', { src: new File(['Hello FiLens'], 'hello.txt') });
</script>
```

| Entry | Use |
| --- | --- |
| `https://cdn.jsdelivr.net/npm/filens-preview@0.3.7/dist/split/filens.js` | Recommended: loads the modules needed by the selected format |
| `https://cdn.jsdelivr.net/npm/filens-preview@0.3.7/dist/all-in-one/filens.js` | One main JS file; useful when a simple single-file runtime matters |
| `https://registry.npmjs.org/filens-preview/-/filens-preview-0.3.7.tgz` | Complete npm package from npmjs |
| `https://registry.npmmirror.com/filens-preview/-/filens-preview-0.3.7.tgz` | Complete npm package from the npmmirror registry |

Pin a version in production. The `filens-preview` package root exports the split build; `filens-preview/all-in-one` exports the single-file build for bundlers. For direct browser imports use the full jsDelivr URL. jsDelivr sends the package with CORS enabled and serves its files from its own edge network.

## Transfer and startup

In the local Chromium comparison, the split entry rendered text in **25.9 ms** after about **125 KB Brotli** across six requests. The single-file entry took **123.0 ms** and transferred **3.57 MB Brotli**. These are seven-run measurements of the current workspace source, not a promise for every device or CDN edge. The npm version stays immutable; publishing the newer workspace build requires a new package version.

jsDelivr also negotiates Brotli for WASM. At the observed HKG edge, its 0.3.7 responses reported `Content-Encoding: br`: `libheif.wasm` **1,457,990 → 446,532 bytes**, `converter-image.wasm` **1,492,779 → 455,415 bytes**, and `pdf.worker.min.mjs` **1,078,612 → 298,037 bytes**. The two HEIF WASM files together drop from **2.95 MB to 902 KB** (about **69% less transfer**). This is based on response headers, not a browser timing run; CDN edge compression is doing useful work without storing `.br` copies in FiLens.

The split build transfers only the modules needed by a format. It also creates more requests. Its iWork and archive workers need the page and package to share an origin, so self-host the npm package's `dist/split` directory when those formats must work from an arbitrary application origin. The all-in-one entry embeds its ordinary worker sources and avoids that restriction for common document previews.

## China and overseas downloads

The downloads page shows explicit provider choices instead of guessing a visitor's country. International users can use jsDelivr for browser ESM, npmjs for npm installation, and GitHub Releases for ZIP archives. In mainland China, use `registry.npmmirror.com` for npm installation or its package tarballs. For browser ESM from that package, install it and serve `node_modules/filens-preview/dist/split` from the application origin; the npm registry is not a browser module CDN.

GitHub Release ZIPs are linked directly, and old `https://filens.cc/downloads/v…` links redirect to GitHub. jsDelivr's GitHub endpoint serves files committed to the repository; it does not mirror binary assets attached to GitHub Releases. The preview runtime is available on jsDelivr because it is published to npm. We have not verified a reliable mainland mirror for the desktop and mobile release ZIPs, so the page does not route those files through an unverified proxy.

The Vercel build now stages only the downloads index and the small Skill ZIP. It no longer fetches Release archives, extracts preview ZIPs, or writes a `/cdn/` asset tree. The old filens.cc CDN measurement is retained as history in [the original report](js-cdn-benchmark.json); it is not a current endpoint comparison.

Compare current public npm CDNs from your own network path with `node scripts/benchmark-js-cdn.mjs`; it records jsDelivr and unpkg timings and hashes in `docs/js-cdn-provider-benchmark.json`. A single runner cannot establish mainland-China or global performance, so the downloads page keeps explicit registry choices.
