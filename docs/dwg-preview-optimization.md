# Direct DWG preview audit

Measured on 2026-11-05 from the current source checkout, against the graphics engine distributed in `filens-preview@0.3.4`. These measurements describe the source changes; existing npm and GitHub release archives retain their own recorded sizes.

The v0.6.5 release carries preview 0.3.5. Its CAD/raster engine hashes match this audit; the all-in-one table below records the earlier source measurement. See [final runtime measurements](preview-build-sizes.json) and [download sizes](preview-release-sizes.json) for the release artifacts.

## Loading and size

DWG now loads a dedicated reader, separate from raster decoders. The reader uses `cadkit-dwg` / `cadkit-core` 0.5.2 (MIT distribution license) and passes a versioned drawing model to the existing SVG renderer. Preview no longer writes DXF and parses it again. Explicit DWG → UTF-8 DXF export remains available through `cadkit-dxf` in the same frontend WASM core.

| Engine | Raw bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Published graphics engine, DWG + raster | 5,007,118 | 1,980,976 | 1,501,121 |
| Dedicated CAD reader | 908,040 | 442,809 | 360,226 |
| Separate raster engine | 1,789,624 | 734,588 | 550,637 |
| Combined graphics compatibility engine | 2,490,703 | 1,077,863 | 818,594 |

The DWG engine download is **77.6% smaller with gzip**, or **76.0% smaller with Brotli**, than the published graphics engine. This comparison concerns the WASM engine; the shared preview host and CAD renderer are additional assets. All existing raster formats remain supported. Raster decoding loads only when needed.

Downloading both dedicated engines costs 1,177,397 bytes gzip, about 100 KB more than the new combined engine because each contains some shared runtime code. Applications regularly opening both types can still configure the combined engine through `graphicsWasm`. `cadWasm` takes priority for DWG when supplied; legacy `graphicsWasm` callers continue to work.

All-in-one uses the combined core once, avoiding duplicated embedded CAD/raster engines:

| All-in-one main JS | Raw bytes | Supplied gzip bytes | Supplied Brotli bytes |
| --- | ---: | ---: | ---: |
| Published npm baseline | 7,258,142 | 3,992,298 | 3,852,757 |
| Current source build | 6,653,452 | 3,530,166 | 3,392,433 |

The current main JS is **3.39 MB Brotli / 3.53 MB gzip**, both below the 4,000,000-byte delivery limit. The optional archive WASM and worker remain external as before, and are excluded from both rows. Supplied gzip/Brotli files were decompressed and checked against the exact main JS. Engine sizes use gzip level 9 / Brotli quality 11; all-in-one uses supplied Zopfli gzip / Brotli quality 11 files. [Exact sizes and hashes](dwg-preview-build-sizes.json).

## Performance

Apple M4 Pro, macOS arm64, Node 20.20.2. Each path reuses a compiled WASM module, creates a WASI instance, reads the DWG, serializes and validates the output, and loads the TypeScript drawing model. Old and new paths alternate; two warmups are discarded, then nine measurements per path yield the median. The old path uses the published graphics WASM to produce DXF and the same current DXF loader. Network transfer, WASM compilation, SVG layout and DOM paint are excluded. These are parse/model-load measurements, not full browser opening times or SoTA claims.

| Fixture | DWG header | Current median, ms | Baseline / current |
| --- | --- | ---: | ---: |
| ACadSharp R14 | AC1014 | 13.25 | 2.16× |
| ACadSharp 2000 | AC1015 | 12.41 | 1.95× |
| ACadSharp 2004 | AC1018 | 14.21 | 1.98× |
| ACadSharp 2007 | AC1021 | 18.00 | 1.40× |
| ACadSharp 2010 | AC1024 | 15.52 | 1.77× |
| ACadSharp 2013 | AC1027 | 12.56 | 1.84× |
| ACadSharp 2018 | AC1032 | 13.33 | 1.77× |
| Tika AC1032 | AC1032 | 6.10 | 1.57× |
| Tika AC1027, 3,231 rendered entities | AC1027 | 39.53 | 2.47× |
| Tika 2010 | AC1024 | 1.29 | 2.44× |
| Tika 2007 | AC1021 | 1.19 | 2.57× |
| FiLens cafe 2000 | AC1015 | 3.02 | 0.98× |
| FiLens cafe 2018 | AC1032 | 4.22 | 1.18× |

The more involved drawings improve by roughly **1.4–2.5×** in this run. The tiny Tika drawings are useful compatibility fixtures, rather than meaningful latency showcases. The cafe drawings remain around 3–5 ms; earlier runs changed the direction of the small difference, so no consistent speedup is claimed for them. [Raw timings, bounds, entity types, diagnostics and hashes](dwg-preview-audit.json) include all nine samples per path.

The changes reduce repeated work:

- Read DWG directly into `cad-json`, removing DXF serialization and reparsing from preview.
- Buffer WASI JSON writes and validation reads, avoiding tiny filesystem calls for individual JSON tokens.
- Validate JSON syntax and the required model envelope without constructing a second full JSON value tree in WASM.
- Omit unused document header/class property dumps from preview output; explicit DXF export retains its own source model.
- Cache expanded block definitions, then apply each insertion's transform, layer and color independently. Cyclic blocks are excluded from the cache.

## Content fixes and remaining limits

The direct path preserves model and paper-space content together, matching the existing DXF preview behavior. It retains common geometry, layers, colors, line styles, text, nested INSERT/MINSERT, placed attributes, dimension blocks and supported hatches/images/mesh faces. RAY/XLINE are reconstructed from decoded native coordinates. Visible constant attributes are rendered; variable ATTDEF templates and invisible metadata are omitted, while placed ATTRIB values are retained. Constant attribute fallback does not yet preserve all upstream text formatting. Font/resource resolution keeps earlier DWG diagnostics.

Entity totals are not identical measures of fidelity. ACadSharp produces 230 preview entities versus 236 previously: the new path omits variable attribute templates and adds mesh faces. Tika AC1027 produces 3,231 versus 3,494; the 263 omitted text entities are invisible ATTDEF metadata. Both cafe generations retain all 223 entities, 8 layers, the title and the same drawing bounds.

The reader covers R14/AC1014 through AC1032. **AC1032 means the 2018 saved-file format**, including files saved in that format by newer CAD applications; this audit does not establish compatibility with every newer application's output. R12 is unsupported; R13 is unverified. Multi-leaders, CAD tables, multi-lines, wipeouts, ACIS solids/regions, some MESH/proxy entities, external references and SHX glyphs remain incomplete or unavailable, with diagnostics. This is a partial 2D preview, not a full CAD layout engine.

Binary reads enforce a 64 MiB input limit, 256 MiB decompression limit, 500,000 objects, 32 nesting levels, 1 million vertices per entity and 5 million total vertices. TypeScript expansion separately bounds work/output, nesting, INSERT arrays, attributes and mesh faces so compact input cannot trigger unbounded block expansion. Parsing stays in frontend WASM/TypeScript; Go remains a host wrapper.

## Verification and reproduction

The corpus contains seven ACadSharp drawings (MIT), four Apache Tika drawings (Apache-2.0), and the two repository cafe drawings. [The corpus manifest](../scripts/fixtures/dwg-corpus.json) records upstream URLs, exact SHA-256 values, sizes and headers. Downloads fail if upstream content changes.

Verified: 73 CAD unit checks, 46 real-WASM graphics checks, 31 preview routing/lifecycle checks, 2,128 conversion-policy checks, and 328 controlled fixture definitions. Ten isolated Chromium checks rendered both cafe generations, ACadSharp AC1032, Tika AC1027 and TIFF in split and all-in-one builds, with external network dependencies blocked. Split DWG fetched CAD once, reused it between drawings, and fetched raster only upon opening TIFF. All-in-one requested just the main JS for these engines. These checks establish render readiness and content presence, not pixel-perfect CAD fidelity.

The normal [preview smoke suite](../scripts/test-preview.mjs) also includes DWG/TIFF fixtures and engine-request assertions. For the corpus benchmark, build the core, CAD and converter-client packages plus production WASM, then:

```sh
mkdir -p tmp/dwg-reader-final-audit
npm pack filens-preview@0.3.4 --pack-destination tmp/dwg-reader-final-audit --silent
tar -xOf tmp/dwg-reader-final-audit/filens-preview-0.3.4.tgz package/dist/split/converter-graphics.wasm > tmp/dwg-reader-final-audit/published-0.3.4-graphics.wasm
node scripts/audit-dwg-preview.mjs --baseline tmp/dwg-reader-final-audit/published-0.3.4-graphics.wasm
```

The script verifies/downloads fixtures and writes `tmp/dwg-reader-final-audit/dwg-preview-audit.json`. Rebuilding preview runtimes with `npm run build:preview` produces the split/all-in-one bundles; existing release receipts must be measured separately from source builds.
