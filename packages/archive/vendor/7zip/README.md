# Read-only 7-Zip engine

7-Zip 24.09 at the exact revision in `manifest.json`, compiled with Emscripten
4.0.10, **-O3 and LTO**. This is a throughput-oriented build. It retains the
RAR/RAR5, 7z, ZIP, split-volume, BZip2, XZ, LZMA/LZMA86, Zstandard, Unix compress,
AR, CPIO, CAB, ISO/UDF, LHA/LZH, RPM, XAR and WIM/ESD handlers, their decoders and crypto, and
the existing `l` / `x -so` CLI contract. Ordinary
ZIP, TAR and GZIP previews continue using the shared TypeScript readers.

The same WASM ZIP handler also reads ZIPX (including BZip2, Deflate64 and LZMA).
CBR/CB7 alias the RAR/7z readers; CBT aliases TAR. XPI and CRX2/CRX3 use the shared
ZIP reader, including its support for prepended container headers. These routes
do not add decoders or increase the vendored WASM size. Comic archives provide
file browsing and individual image previews.

Standalone BZ2/BZIP2/XZ/LZMA/LZMA86/ZST/ZSTD/Z streams use bounded `x -so` output
without requiring a declared unpacked size. Compressed TARs (including TBZ/TBZ2/TXZ/TLZ/TZST/TAZ)
share the existing TAR reader. DEB aliases AR and its nested control/data archives
use the same readers. RPM exposes its compressed CPIO payload; XZ/Zstandard CPIO
opens directly as a directory. ISO preview covers ISO 9660 / Joliet and falls back
to UDF for UDF-only images. WIM/ESD supports single/multiple images, LZX, XPRESS and
solid LZMS; split SWM images are not routed.
The engine is 1,116,075 bytes (340,301 bytes Brotli). The system/package handlers
add 162,959 bytes (44,580 bytes Brotli) over the previous 953,116-byte engine.
It remains an optional external asset.

`7zip-24.09.patch` contains all source changes: Emscripten platform guards
adapted from 7z-wasm 1.2.0, and extraction-only guards for the ZIP/BZip2/WIM writer
interfaces. The build script supplies the complete object selection, flags,
pre/post JavaScript and toolchain version check. Encoders and unrelated archive
handlers are excluded; supported decoding methods and encryption are retained.
The unRAR source **must not be used to develop a RAR-compatible compressor**.
See [the notices](../../THIRD-PARTY-NOTICES.txt) for all license terms.

Activate Emscripten 4.0.10, then run from the repository root:

```sh
npm run build:archive:wasm
node scripts/build-archive-wasm.mjs --check
```

The script fetches and verifies the pinned upstream revision. Set
`FILENS_7ZIP_SOURCE` to an existing clone for an offline rebuild. `--check`
verifies the generated JS, WASM and patch hashes without changing the vendored
files. The JS/WASM are shipped separately and may be replaced together by a
compatible rebuild. No archive WASM is embedded into main JavaScript or HTML.

The full `7z-wasm` npm package is a development-only archive fixture generator;
it is not a runtime dependency.
