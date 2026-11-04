# Native design previews

The design gallery loads twelve original documents: six PSD, two PSB, two
PDF-compatible AI, one EPS and one two-page PS. WebP assets are picker thumbnails
only. Uploaded files and samples use the same frontend WASM conversion core.
Go hosts these modules and maps their results; it does not parse PostScript.

| Input | Preview path | Limits |
| --- | --- | --- |
| PSD / PSB | Decode the saved composite to PNG in `converter-core.wasm` | 8-bit RGB/grayscale; raw, PackBits, ZIP and prediction; no layer editing or ICC processing |
| PDF-compatible AI | Retain the PDF bytes exactly | Illustrator editing data is not interpreted |
| EPS / PS / legacy AI | Interpret PostScript in `converter-postscript.wasm` to vector PDF | Preview subset; 16 MiB PostScript input, 5 million executed objects; no host files or network; unsupported artwork fails explicitly |

The PDF viewer renders vectors again at each zoom level. EPS uses its bounding
box, including a nonzero origin, and needs no `showpage`. PS preserves multiple
pages. Source-embedded raster images retain their original resolution limits.

Standard PDF fonts and document-embedded fonts are supported. The compact build
excludes resident font outline assets and disables automatic font substitution.
Missing fonts, resident-font `charpath`, unsupported operators and reported
artwork losses produce errors. It does not promise complete Ghostscript or
Illustrator compatibility. Re-exporting text as vector paths or embedding the
needed fonts avoids dependence on omitted resident outlines.

## Compressed download budget

The requirement is **at most 1,000,000 bytes of compressed browser download for
the EPS/PS engine**, not uncompressed WASM size or the entire preview application.
The existing PDF viewer and application assets are outside this engine budget.

Production module measured on 2026-11-04 (Rust 1.93, LTO, Binaryen `-Oz --converge`):

| Encoding | Bytes | Decimal MB |
| --- | ---: | ---: |
| Uncompressed WASM | 2,487,397 | 2.487 |
| gzip level 9 | 763,353 | 0.763 |
| Brotli quality 11 | 528,558 | 0.529 |

The module loads on demand for EPS, PS and AI; those previews do not also
download the document conversion core. Hosts must serve WASM with HTTP gzip or
Brotli compression to obtain these transfer sizes. Development Vite serves raw
WASM. Reproduce the measurement with `node scripts/check-postscript-size.mjs`.
`npm run build:wasm` checks both compressed encodings against the 1 MB cap.

`createWasmConverterClient({ wasm, postscriptWasm })` selects the compact module.
The shared protocol remains identical. If a lean core is used without that
option, EPS/PS and legacy AI return `engine_unavailable` and
`requiredModule: postscript`. The Go host follows that result to the sibling
module. The standalone all-in-one preview embeds the combined core, which has
a different size scope.

The interpreter is EfterScript 0.0.7 (MIT), built with `default-features = false`
throughout its dependency graph. Its code, font metrics, glyph list and CMap
notices ship with the core, converter client, demo and standalone preview.
See [notices](../wasm/converter-core/THIRD-PARTY-NOTICES.txt).

An evaluated Ghostscript distribution was 16,177,271 bytes raw and 10,648,462
bytes with Brotli; another optimizer pass saved only 19,554 raw bytes. It was
not added. The compact interpreter achieves the budget by excluding resident
outlines and limiting compatibility, while preserving supported vector content.

Artwork provenance and regeneration instructions are in
[the sample sources](../apps/demo/public/samples/design/SOURCES.md).
