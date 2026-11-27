# Metafile decoder

This frontend WASM module plays EMF and WMF drawing records through
`betteroffice-metafile` and returns SVG. The preview loads the module when it
encounters a metafile and runs decoding in a browser worker. The module has no
host imports. It limits each input and SVG result to 8 MiB and its linear memory
to 128 MiB. The browser also cancels playback on source replacement or timeout.

Rebuild from the repository root with Rust 1.93, the `wasm32-unknown-unknown`
target and the workspace's npm dependencies installed.

```sh
node scripts/build-metafile-wasm.mjs
node scripts/build-metafile-wasm.mjs --check
```

The build writes `packages/core/vendor/metafile/metafile.wasm`. The dependency
versions are in [Cargo.lock](Cargo.lock), and their notices ship with the core
and browser preview packages. [Third-party notices](../../packages/core/vendor/metafile/NOTICE.txt)
