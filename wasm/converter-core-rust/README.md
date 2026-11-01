# Rust converter core

Rust WASI implementation of `converter-core`. It covers every pair in `../converter-core/manifest/conversions.json` and now produces the production artifact.

The public conversion policy is read directly from `../converter-core/manifest/conversions.json`; there is no second Rust-only format list.

Build with `npm run build:wasm`; test with `npm run test:wasm` and `npm run test:wasm-smoke`.

## Current milestone

- Covered: all source/target pairs in the shared conversion manifest, including application icon extraction, BIFF spreadsheets and PowerPoint binary files.
- Production: `../converter-core/dist/converter-core.wasm` is Rust.

Size snapshot from `npm run report:wasm-sizes` (bytes, gzip level 9, Brotli quality 11;
Binaryen 131, `-Oz --converge` for document/Office builds):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-core.wasm` (split, detection only) | 916,303 | 412,942 | 335,464 |
| `converter-office.wasm` (optional decryptor) | 379,079 | 163,967 | 130,417 |
| `converter-core-full.wasm` (combined alternative) | 1,078,852 | 476,846 | 386,568 |
| `converter-image.wasm` (optional) | 1,126,286 | 305,601 | 221,453 |

The combined build retains all conversion routes, application icons and modern/
legacy Office decryption. Sharing the miniz compression backend, XML dependency,
ZIP readers and XML rewrite loop, removing unnecessary Unicode case conversion,
and converging Binaryen reduces its gzip size from 542,228 to 476,846 bytes
(12.1%). The preferred approximately 300 KB target is not reached. The historical
308,888-byte figure used Brotli; its gzip size was 381,175 bytes. See the
[optimization measurements and validation](../../docs/converter-size-impact.md).

RAW conversion in the core only copies the largest standard 8-bit embedded
JPEG. Full sensor decoding lives in the optional `converter-image.wasm` module,
so document and panorama users do not download the RAW decoder and camera data.

PPM conversion runs entirely in this core and produces PNG. Both P3 text and P6
binary RGB are supported, including header comments, arbitrary maximum sample
values (1–65535), and 8/16-bit samples. PNG retains the source sample depth;
values are scaled to the PNG range. Only the first image in a stream is used.
Input is limited to 256 MiB and decoded RGB data to 128 MiB.

The retired Go core was 82.8% larger by Brotli size at equivalent fixture coverage.

## Application icons and size attribution

APK/IPA and PE resource icons convert to PNG in `src/icons.rs`; the Go wrapper
continues to invoke this same core. ICO supports embedded PNG and standard
1/4/8/24/32-bit DIB frames. APK follows compiled application icon references and
resource aliases; IPA uses its main bundle's XML/binary plist and normalizes
Apple CgBI PNGs. Unsupported vector-only or asset-catalog-only icons return a
parse error. Input is limited to 256 MiB, ZIP entries to 10,000, each icon resource
to 16 MiB, decoded DIB/CgBI rasters to 16 megapixels, and raster candidate reads
to 64 MiB across at most 256 candidates. Resource references are depth bounded.

Office decryption is separated from the split core. The earlier increase
was primarily `msoffice-crypto` (AES, hashing, CFB and legacy RC4/XOR support), not
HEIF decoding or language strings. Reproduce a same-source comparison with:

```sh
npm run build:wasm
npm run report:converter-size-impact
```

The split core retains encryption detection but excludes the `office-crypto`
feature. On `engine_unavailable` with `requiredModule: "office"`, hosts invoke
the decrypt-only addon and pass its output back to the core. Missing passwords
produce `password_required` without loading the addon. The combined core retains
integrated decryption and is used by the all-in-one preview to avoid duplication.
Native/text CLI builds also retain integrated crypto through the default feature.
The analysis-only variants remove icon dispatch and then the Office handler from
a temporary source tree; they are never shipped. Exact byte counts
are recorded in [`docs/converter-size-impact.json`](../../docs/converter-size-impact.json).
See the [size explanation](../../docs/converter-size-impact.md) for the measured
contributions. Locale dictionaries live in the Vue/JS host and do not enter WASM.
