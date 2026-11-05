# Packed preview asset decoder

`decoder.wasm` is the unmodified decoder asset from `lzma-sdk-decode@0.1.1`:

- npm tarball: https://registry.npmjs.org/lzma-sdk-decode/-/lzma-sdk-decode-0.1.1.tgz
- Wrapper source commit: `06032892ed0cadc0974916f77078eb8bb2a44fe9`
- Decoder SHA-256: `2c899b6e3e5dee43d7326348f5a411e2097ef900272132e28ec97df3de91c3f1`
- LZMA SDK / 7-Zip 26.05 source and Emscripten compiler pins are in `build-info.json`.

The standalone packer checks this hash and uses only the binary decoder's fixed
ABI. It embeds the 20,283-byte decoder in the merged preview; the split preview
does not use it. No archive parser or encoder is included at runtime. The reader
verifies consumed input, complete output, SDK completion status and CRC-32 before
exposing assets. The original WASM engines, workers and static strings are
verified byte-for-byte during the build.

The wrapper's MIT license, SDK public-domain notice and compiler runtime notices
are adjacent and included in the merged preview's third-party notice file.
`lzma@2.3.2` is used only by the Node build to encode the data; `terser` compacts
the ordinary JavaScript module. Runtime exports remain synchronous and need no
`eval`, `Function` constructor or extra JavaScript module imports.
