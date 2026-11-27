# Support Matrix

English | [简体中文](support-matrix.zh-CN.md)

filens provides read-only file previews in modern browsers. The complete preview host currently covers **450 source-file formats**, counted by unique extension, including direct previews and previews after local WASM conversion. Format support does not imply full compatibility with its authoring application.

Checked against the current source on **2026-11-06**. The default Vue routes register **451 unique extensions**: 319 direct source formats, 131 conversion source formats, and the internal `cad-json` drawing-model entry. The internal entry is excluded from the 450 source-file count; applications with custom routes or older releases may differ.

The demo lists supported formats only, distinguishing built-in samples from formats that require importing a file. A missing sample does not mean the decoder is missing. HEIC/HEIF primary-image decoding is already available through the media driver and local WASM fallback; the demo includes original samples.

| Find | Go to |
| --- | --- |
| Formats, extensions, and preview paths | [Format overview](#format-overview) |
| Conversion sources, targets, and runtime requirements | [Conversion support](#conversion-support) |
| PPM encodings, bit depth, limits, and verification | [PPM conversion](#ppm-conversion) |
| Camera RAW extensions and decode limits | [Camera RAW conversion](#camera-raw-conversion) |
| Individual features and fidelity limits | [Fidelity and feature details](#fidelity-and-feature-details) |
| APIs, Vue components, fonts, and sidecar files | [Integration support](#integration-support) |
| Formats and workflows without a shipped preview path | [Unsupported formats and workflows](#unsupported-formats-and-workflows) |

Long feature tables can be expanded using their disclosure headings. These tables work in GitHub Markdown; use the page's find command to locate an extension or feature.

## How to read this matrix

<details>
<summary>Expand preview paths, feature statuses, and integration requirements</summary>

| Preview path | Meaning |
| --- | --- |
| **Direct** | A browser preview driver opens the source without the converter adapter. Some drivers load their own WASM dependencies, such as STEP import. |
| **Convert** | A converter adapter first produces a previewable file. The browser WASM client runs locally; an HTTP adapter uses the configured service. |

| Feature status | Meaning |
| --- | --- |
| **Supported** | Common content or operations are implemented within the limits described here. |
| **Partial** | A useful subset is implemented; some content, formatting, or behavior is simplified or omitted. |
| **Experimental** | Support depends on specific files, camera metadata, codecs, or fallback paths. |
| **Unavailable** | The listed feature has no shipped implementation. |

| Applies to | Requirement or boundary |
| --- | --- |
| Format overview below | Describes the routes assembled by the Vue `Preview` host. |
| Core-only integrations | Register the relevant package drivers and routes. |
| Conversion routes | Configure a converter adapter. |
| Rendering and playback | Browser decoding, available fonts, and external resources affect the result. |

</details>

## Format overview

### Office and documents

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| PowerPoint | `pptx` | Direct | Slides, text, images, tables, and common shapes. | SmartArt and styling are partial; [feature matrix](#pptx). |
| Word | `docx` | Direct | Document rendering through `docx-preview`; repeated images reuse resources, with cancellation and safe file replacement. | Layout and font fidelity vary. |
| Excel / CSV | `xlsx`, `csv` | Direct | Read-only sheets, basic formulas, windowed rows/columns, cancellation and safe file replacement. | Partial calculation and styling; [workbook matrix](#pdf-docx-and-workbooks). |
| PDF | `pdf` | Direct | PDF.js engine loads when opening a PDF. Canvas/text-layer preview, selection, full-document search, page navigation, zoom/fit and on-demand rendering. Font diagnostics identify PDF font names and verified embedded programs on rendered pages. | Literal text search. Scanned pages require OCR for text. [Font diagnostics](fonts.md). |
| Apple iWork | `key`, `pages`, `numbers` | Direct | Native parsing and slide/page/sheet views. | Partial layout and content fidelity; [iWork matrix](#native-iwork). |
| Other Office, WPS, and OpenDocument | [Conversion extensions](#conversion-support) | Convert | Normalize to `pptx`, `docx`, or `xlsx`. | Fidelity depends on the source; macros are stripped. |

### Images, audio, video, and panoramas

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| Browser images | `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `apng`, `ico`, `svg`, `bmp` | Direct | Zoom, fit width/height, pan, rotation, fullscreen. | Browser decoding determines availability. |
| HEIC / HEIF | `heic`, `heif` | Direct; local WASM fallback | Primary still image; fallback preserves source depth for ICC or fixed PQ/HLG-to-sRGB previews. | No sequence-only files or gain-map reproduction. Fallback: 64 MiB input, 64 MP, 16,384 px per edge, 4 MiB ICC, 30 s decode. |
| TIFF | `tif`, `tiff` | Convert → `png` | First image, common TIFF compression, grayscale/RGB and 16-bit samples; orientation applied. | Requires `graphicsWasm`; 8-bit preview, additional pages and print profiles are omitted. |
| Other raster images | `tga`, `pgm`, `pbm`, `pnm`, `dds`, `hdr`, `dib`, `cur`, `pcx`, `exr`, `jxl`, `qoi`, `ff` | Convert → `png` | Local WASM decoding to RGBA, including cursor/TGA alpha, indexed/RGB PCX, DXT DDS textures and linear HDR/EXR to sRGB. | 64 MiB input, 32 megapixels; first DDS surface / JXL frame / largest cursor image only; EXR uses the default image and color channels; HDR/EXR dynamic range is reduced to 8-bit. |
| Apple icons | `icns` | Convert → `png` | Largest embedded PNG icon. | Raw icon planes and JPEG 2000 chunks are not decoded. |
| Windows application icons | `exe`, `dll`, `mui`, `mun` | Convert → `png` | Extract a PNG or supported DIB icon from PE resources in the shared WASM core. | Icon preview only; no execution. APK/IPA icon extraction and ICO normalization are also available as explicit conversion pairs. |
| Portable pixmaps | `ppm` | Convert → `png` | P3 text and P6 binary; comments, arbitrary maxval, 8/16-bit RGB. | First image in a stream; [decode, runtime, and verification limits](#ppm-conversion). |
| Camera RAW | `dng`, `cr2`, `cr3`, `nef`, and [more](#camera-raw-conversion) | Convert → `jpg` | Embedded JPEG or lightweight sensor preview. | Full RAW development is unavailable. |
| Audio | `mp3`, `wav`, `aac`, `m4a`, `flac`, `ogg`, `oga`, `opus` | Direct | Native browser playback and controls. | Codec support varies. |
| Video | `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`, `avi`, `mpeg`, `mpg`, `3gp` | Direct | Native browser playback and controls; optional [local MP4/MOV recovery](browser-media-engine.md). | A recognized extension does not guarantee a decodable codec. Recovery is opt-in and rejects unsupported tracks. |
| Equirectangular panoramas | `pano`, `panorama`, `360`; video: `360v`, `vr360` | Direct | Three.js spherical rendering. | Videos require browser-decodable media. |
| Camera panoramas | `insp`, `insv`, `osv` | Direct; WASM processing where needed | Experimental calibrated lens rendering or a supported fallback. | Camera metadata, codecs, and companion files; [requirements](#panoramas-and-live-photo-samples). |

### CAD, 3D, mind maps, and diagrams

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| Photoshop | `psd`, `psb` | Convert → `png` | Saved merged composite, decoded in the frontend WASM core. | 8-bit RGB/grayscale; no layer editing or ICC processing. [Design preview limits](design-preview.md). |
| Illustrator / PostScript | `ai`, `eps`, `ps` | Convert → `pdf` | PDF-compatible AI preserves PDF bytes; supported PostScript artwork becomes vector PDF, including multiple PS pages. | Preview subset; missing fonts and unsupported artwork fail explicitly. The EPS/PS module loads on demand. [Compatibility and download budget](design-preview.md). |
| 2D CAD | `dxf` | Direct | SVG geometry, text, layers, blocks, raster references. | Partial entity and text fidelity; [DXF matrix](#dxf-cad). |
| DWG drawings | `dwg` | Convert → `cad-json` | WASM reads the drawing model directly for the same SVG 2D renderer. | Requires `cadWasm`, `graphicsWasm` or a combined core; partial entity coverage, external references and SHX fonts. [DWG limits](#dwg-and-cad-drawing-models). |
| CAD drawing models | `cad-json` | Direct | Internal drawing-model interchange format emitted by DWG conversion. | Schema version 1 with DWG source metadata; excluded from the source-file format count. |
| CAD solids | `step`, `stp` | Direct + truck Rust WASM | Lazy-loaded triangulation for viewing. | CAD editing is unavailable. |
| 3D models and scenes | `stl`, `obj`, `ply`, `gltf`, `glb`, `3mf`, and [more](#3d-models-and-inspection) | Direct | Three.js meshes, materials, and scenes. | Format-specific material and resource limits. |
| Toolpaths, point clouds, voxels, motion, molecules | `gcode`, `gco`, `nc`, `pcd`, `xyz`, `vtk`, `vox`, `bvh`, `pdb`, `nrrd`, `nhdr` | Direct | Supported data subsets. | [Import and inspection matrix](#3d-models-and-inspection). |
| Mind maps | `mm`, `opml`, `xmind`, `mmap` | Direct | FreeMind, OPML, XMind, MindManager topic trees. | Partial layout fidelity; read-only interaction. |
| Diagrams | `drawio`, `dio`, `vdx`, `vsdx` | Direct | diagrams.net and basic Visio pages, shapes, labels, connectors. | Partial Visio fidelity; editing is unavailable. |

### Text, ebooks, and archives

| Format | Extensions | Path | Preview coverage | Limits |
| --- | --- | --- | --- | --- |
| Plain text | `txt`, `text`, `log` | Direct | UTF-8 text display. | Read-only. |
| Code, markup, configuration | Examples: `js`, `ts`, `py`, `go`, `json`, `xml`, `yaml`, `toml`, `ini`, `md`, `tex` | Direct | Language metadata, line numbers, non-wrapping source text, lightweight highlighting up to 200,000 characters. | Markdown, LaTeX, Mermaid, and similar sources are displayed as source. |
| HTML / XHTML | `html`, `htm`, `shtml`, `xhtml`, `xht`, `xhtm` | Direct | Sandboxed iframe; URLs, HTML data URLs and inline fragments. | Scripts are disabled by the iframe sandbox. |
| EPUB | `epub` | Direct | Chapters load on demand with CSS imports, fonts, backgrounds, SVG references, and local/app-resolved assets. Nested EPUB 3/NCX contents, chapter jumps and reading themes are available. | Cross-chapter document links require a same-origin frame. |
| Comic books | `cbz`; `cbr`, `cb7`, `cbt` | Direct | CBZ provides ordered image pages, numbered jumps and reading themes; CBR/CB7/CBT reuse RAR/7z/TAR browsing and individual image previews. | Sequential reading is available for CBZ only. CBR/CB7 require the external archive engine. |
| ZIP-compatible archives | `zip`, `jar`, `war`, `ear`, `apk`, `ipa`, `xpi`, `crx` | Direct | Listings, directory/nested browsing, entry preview, extraction helpers. | Read-only; no bulk extraction UI. |
| ZIPX | `zipx` | Direct + WASM | Existing ZIP decoder, including Deflate, Deflate64, BZip2 and LZMA; listings, nested browsing and entry preview. | Requires the external archive engine; proprietary WinZip methods may be unsupported. |
| RAR / 7-Zip | `rar`, `7z` | Direct + WASM | Listings, nested browsing, entry preview, passwords, encrypted filenames, solid and multi-volume archives. | Requires the external archive engine and all volume parts; shared archive limits apply. |
| TAR / GZIP | `tar`, `tgz`, `tar.gz`, `gz` | Direct | TAR/TGZ listings with PAX / GNU long paths; single-file GZIP extraction. | Read-only. |
| Compressed streams | `bz2`, `bzip2`, `xz`, `lzma`, `lzma86`, `zst`, `zstd`, `z`; TAR aliases `tbz`, `tbz2`, `txz`, `tlz`, `tzst`, `taz` | Direct + WASM | Single-file extraction; compressed TARs open as directories. CPIO payloads named `.cpio.xz` / `.cpio.zst` also open as directories. Includes BCJ-filtered LZMA86 and concatenated BZip2/XZ/Zstandard streams. | Requires the external archive engine. Output is bounded to 128 MiB, including streams without a declared size. Unix compress has no checksum. |
| AR / Debian / CPIO | `ar`, `deb`, `cpio` | Direct + WASM | File browsing and entry previews; Debian packages expose nested control/data archives through the same readers. | Read-only; packages are not installed or executed. Archive links are omitted. |
| LHA / XAR / RPM | `lha`, `lzh`, `xar`, `rpm` | Direct + WASM | LHA/LZH entries, including LH5/LH6; XAR zlib/BZip2 entries; RPM compressed CPIO payloads open through the shared nested reader. | Read-only file browsing; packages are not installed or executed. |
| Windows images | `wim`, `esd` | Direct + WASM | Browse and preview files in single/multiple images. LZX, XPRESS and solid LZMS decoding. | Requires the external archive engine; split SWM images and applying an image are unavailable. |
| Cabinet / optical-disc images | `cab`, `iso`, `udf` | Direct + WASM | Cabinet entries, including MSZIP; ISO 9660 / Joliet / UDF directories and files. `.iso` falls back to the UDF reader when needed. | Requires the external archive engine; no mounting or installation. |
| Additional readable inputs | Examples: `fb2`, `eml`, `msg`, `ics`, `vcf` | Convert → `docx` | Content extraction for preview. | Exact pairs follow the conversion manifest. |

| Extension lists | Source of truth |
| --- | --- |
| Code and readable-input examples | Illustrative, not exhaustive. Use the [route introspection helpers](#routes-and-source-loading) for formats enabled in an application. |
| Allowed conversion pairs | The [shared manifest](../wasm/converter-core/manifest/conversions.json) and optional [image manifest](../wasm/converter-image/manifest/conversions.json). |

## Conversion support

Listed pairs normalize files for preview; they do not promise to preserve every source feature. Exact pairs come from the manifests linked above.

| Source family | Source extensions | Target |
| --- | --- | --- |
| PowerPoint binary / WPS presentations | `ppt`, `pps`, `pot`, `dps`, `dpt` | `pptx` |
| PowerPoint shows, templates, macro-enabled packages | `pptm`, `ppsx`, `ppsm`, `potx`, `potm` | `pptx` |
| OpenDocument / legacy OpenOffice presentations and drawings | `odp`, `otp`, `fodp`, `sxi`, `sti`, `odg`, `otg`, `fodg`, `sxd`, `std` | `pptx` |
| Word binary / WPS / RTF | `doc`, `dot`, `wps`, `wpt`, `rtf` | `docx` |
| Word templates and macro-enabled packages | `docm`, `dotx`, `dotm` | `docx` |
| OpenDocument / legacy OpenOffice text | `odt`, `ott`, `fodt`, `sxw`, `stw` | `docx` |
| Text, markup, configuration, templates, code, ebooks, messages, and other readable content | Examples: `txt`, `md`, `html`, `xml`, `yaml`, `js`, `py`, `epub`, `fb2`, `eml`, `mbox`, `msg`, `oft`, `mht`, `mhtml` | `docx` |
| Excel binary / WPS spreadsheets | `xls`, `xlt`, `et`, `ett` | `xlsx` |
| Excel templates and macro-enabled packages | `xlsm`, `xltx`, `xltm` | `xlsx` |
| OpenDocument / legacy OpenOffice spreadsheets | `ods`, `ots`, `fods`, `sxc`, `stc` | `xlsx` |
| Table-like inputs | `dbf`, `slk`, `dif`, `csv`, `tsv`, `tab`, `psv`, `json`, `jsonl`, `ndjson`, `jsonlines`, `ldjson` | `xlsx` |
| DWG drawings | `dwg` | `cad-json` (default preview), `dxf` (explicit conversion) |
| TIFF and other raster images | `tif`, `tiff`, `tga`, `pgm`, `pbm`, `pnm`, `dds`, `hdr`, `dib`, `cur`, `pcx`, `exr`, `jxl`, `qoi`, `ff` | `png` |
| Camera RAW | [Complete RAW list](#camera-raw-conversion) | `jpg` |
| Apple icons | `icns` | `png` |
| Application icons / ICO normalization | `apk`, `ipa`, `exe`, `dll`, `mui`, `mun`, `ico` | `png` |
| Portable pixmaps | `ppm` | `png` |
| Photoshop saved composites | `psd`, `psb` | `png` |
| Illustrator / PostScript artwork | `ai`, `eps`, `ps` | `pdf` |

### Default routing

| Input | Default preview | Optional conversion target |
| --- | --- | --- |
| `csv` | Direct workbook | `xlsx` |
| `json` | Direct source text | `docx` or `xlsx` |
| `html` | Direct sandboxed iframe | `docx` |
| `epub` | Direct ebook driver | `docx` |
| `dwg` | Convert to `cad-json`, then use the CAD driver | `dxf` |
| `apk`, `ipa` | Direct archive browsing | `png` (application icon) |
| `ico` | Direct browser image | `png` |
| `ppm` / `image/x-portable-pixmap` | Convert to PNG, then use the image driver | `png` |

| Rule | Behavior |
| --- | --- |
| Default precedence | Direct routes take precedence over conversion routes. |
| Host override | Supply custom routes to select conversion instead. |

### Conversion fidelity

| Source or result | Current boundary |
| --- | --- |
| Macro-enabled OpenXML | Macro parts are removed before normalization. |
| Encrypted Office | Supported modern OpenXML and legacy DOC/XLS/PPT encryption can be opened with a password. The split core requires `officeWasm`; missing and incorrect passwords have distinct errors. This does not imply support for every encryption scheme. |
| Legacy binary, ODF, and table-like inputs | Layout, styles, media, charts, formulas, and embedded objects may be simplified or omitted. |
| CSV / TSV / TAB / PSV → XLSX | Reads complete input, including CRLF / CR / LF and quoted newlines, up to 1,000,000 cells, 16,384 columns per row and the XLSX row limit. Exceeding a limit raises an explicit error instead of producing a truncated workbook. Direct CSV preview does not use this conversion limit. |
| PPM | Dimensions and RGB samples are retained at 8/16-bit depth; nonstandard maxval values are scaled to the PNG range with rounding. Comments are not copied to PNG metadata. |
| Conversion warnings | Describe the fallback actually used for the input. |
| Valid OpenXML output | Confirms output structure; does not establish visual fidelity. |

### Conversion runtime

| Component | Role | Reference |
| --- | --- | --- |
| Browser WASM client | `createWasmConverterClient({ wasm, officeWasm, imageWasm, postscriptWasm, graphicsWasm, cadWasm })`; runs the shared core and optional modules locally, loading them on demand. | [Converter client API](../packages/converter-client/src/index.ts) |
| Document / panorama / PPM core | Production conversion WASM built from Rust; includes PPM → PNG without the optional image module. | [Rust core](../wasm/converter-core-rust/README.md) |
| Optional Office decryptor | `officeWasm` supplies `converter-office.wasm` when the split core requests Office decryption. | [Password checks](../packages/converter-client/test/password.spec.ts) |
| Optional image core | Separate image/RAW WASM module built from Rust. | [Rust image module](../wasm/converter-image-rust/README.md) |
| Optional CAD core | `cadWasm` supplies the compact `converter-cad.wasm` DWG reader and takes priority over `graphicsWasm` for DWG. | [WASM client](../packages/converter-client/src/wasm-client.ts) |
| Optional graphics core | `graphicsWasm` accepts `converter-raster.wasm` for raster formats or `converter-graphics.wasm` for both DWG and raster formats. `converter-core-full.wasm` includes both implementations. | [Graphics checks](../packages/converter-client/test/graphics-preview.spec.ts) |
| Optional PostScript core | `postscriptWasm` supplies `converter-postscript.wasm` for EPS/PS and non-PDF-compatible AI. | [Design preview limits](design-preview.md) |
| HTTP adapter | Invokes the configured conversion service. | [Adapter APIs](#routes-and-source-loading) |

<sub>Browser WASI output grows on demand while reads and file sizes expose only valid bytes. Overwrite, append and sparse writes are supported; exclusive creation preserves existing files. Growth retains spare capacity and does not establish lower peak memory. [Checks](../benchmarks/frontend/2026-10-24/converter-io-review.json).</sub>

### PPM conversion

| Capability | Coverage and boundary |
| --- | --- |
| Input recognition | `.ppm` (case-insensitive) or `image/x-portable-pixmap` routes to PNG conversion in the document core. PBM/PGM/PNM use the graphics module; PAM/PFM have no default route. |
| P3 / P6 | P3 decimal text and P6 binary RGB; P6 samples above 255 use two bytes in big-endian order. |
| Header and text raster | ASCII whitespace, LF/CRLF headers, header comments, and comments between P3 samples. Binary whitespace and `#` bytes remain pixel data. |
| Sample values | `maxval` 1–255 produces 8-bit PNG; 256–65535 produces 16-bit PNG. Values are normalized to 255/65535 with rounding. |
| Preview operations | Converted PNG uses the image driver's zoom, fit, pan, rotation, and fullscreen controls. Browser display may reduce 16-bit precision. |
| Runtime | Browser `createWasmConverterClient({ wasm })` and the Rust Agent CLI use the same Rust/WASI conversion implementation. HTTP integrations must provide a service with this conversion pair. |
| Resource limits | Input ≤256 MiB; decoded RGB ≤128 MiB (3 bytes/pixel at 8-bit, 6 at 16-bit). These are buffer limits, not a total peak-memory guarantee. |
| Stream and metadata | Only the first image is converted. No animation, alpha channel, comment metadata export, or additional color-profile conversion. |
| Decoder verification | [Rust tests](../wasm/converter-core-rust/src/ppm.rs) cover comments, maxval scaling, 16-bit samples, binary delimiter bytes, malformed inputs, and oversized dimensions. |
| Integration verification | [WASM client tests](../packages/converter-client/test/converter-client.spec.ts) cover P3/P6, PNG dimensions/depth, and invalid input; [browser regression](../apps/demo/e2e/ppm.e2e.ts) checks the built-in sample and uploaded P3/P6/16-bit image pixels. The [Rust CLI conversion checks](../scripts/test-agent-convert.mjs) exercise the same shared WASM core. |

### Camera RAW conversion

| RAW family | Source extensions | Target |
| --- | --- | --- |
| Digital Negative | `dng` | `jpg` |
| Canon | `cr2`, `cr3` | `jpg` |
| Nikon | `nef`, `nrw` | `jpg` |
| Sony | `arw`, `sr2`, `srf` | `jpg` |
| Olympus | `orf` | `jpg` |
| Panasonic / Leica | `rw2`, `rwl` | `jpg` |
| Fujifilm / Kodak / Sigma | `raf`, `kdc`, `x3f` | `jpg` |
| Pentax / Samsung | `pef`, `srw` | `jpg` |
| Epson / Mamiya / Minolta | `erf`, `mef`, `mrw` | `jpg` |
| Leaf / Hasselblad / Phase One | `mos`, `3fr`, `iiq` | `jpg` |

| Decode path | Coverage | Limits |
| --- | --- | --- |
| Embedded preview | Core copies the largest standard 8-bit embedded JPEG. | Requires a suitable embedded JPEG. |
| X3F sensor preview | The image module develops legacy mapped-Huffman and TRUE/Merrill sensors when no JPEG is available or its longest side is below 2048 px. Camera identity comes from X3F properties. | Output up to 2048 px without upscaling; daylight WB. Quattro sensor compression and CAMF adjustments are unavailable. |
| Sensor fallback | Optional `converter-image.wasm` performs lightweight sensor decoding and downsampling with camera WB, sRGB color and DNG exposure metadata. No-JPEG DNG, Nikon D3S NEF, Canon 40D sRAW CR2, PEF and ORF samples are [verified](performance-comparison.md). | Up to 2048 px; camera/file variants affect decoding. Invalid color calibration raises an error. |
| Calibrated panorama DNG | One RS and X5 metadata can select static spherical stitching before ordinary conversion. Uses full-sensor development, exposure matching and content-aware seams. | Requires both panorama WASM modules; preview up to 4096 px, experimental calibration and camera-dependent decoding. Unsupported calibration stays flat. |
| Full RAW development | Unavailable. | Full-resolution development, custom picture profiles, and camera edits are not preserved. |

The Vue preview enables calibrated DNG inspection when `converter` and
`panoramaProcessor` are supplied. See [RAW panorama integration](../packages/panorama/README.md).

<sub>Panorama/RAW replacement, cancellation and destruction release owned URLs, canvases and players and ignore late parsing, image and proxy results. Retained old controls cannot affect the next preview. Browser decoding, custom conversion or synchronous WASM already in progress may finish before their output is discarded. [Regression checks](../benchmarks/frontend/2026-10-24/panorama-lifecycle-review.json).</sub>

<sub>The panorama processor keeps cancellation active for subsequent range reads, RAW development and seam/IMU work. Failed companion loading leaves no partial manifest; obsolete requests cannot replace the next source. [Processor checks](../benchmarks/frontend/2026-10-24/panorama-processor-review.json).</sub>

## Fidelity and feature details

### PPTX

<details>
<summary>Expand PPTX content, geometry, styling, and unsupported features</summary>

| Feature | Status | Details |
| --- | --- | --- |
| Text boxes and placeholder inheritance | Supported | Text boxes copied from placeholders retain their authored list markers. Source-font availability and browser layout affect fidelity. |
| Images, groups, and tables | Supported | Table text style matrix coverage is partial. |
| EMF and WMF images | Partial | Frontend WASM converts embedded metafiles to SVG. The parsed media retains its original bytes. Less common GDI and EMF+ records and exact text metrics remain limited. |
| Links and slide navigation actions | Supported | Common link and action cases. Home and End jump to the first and last page. Reduced-motion navigation jumps immediately. During smooth scrolling, rapid page changes retain their destination and manual scrolling can take over. |
| Basic diagram-backed SmartArt | Partial | Full SmartArt parity is unavailable. |
| Preset shapes and adjustment formulas | Partial | Common `a:avLst` adjustments are supported; long-tail presets and OOXML formulas remain incomplete. |
| Custom paths | Supported | Path-local guides, lines, Bézier curves and DrawingML ellipse arcs retain authored order and scaling. Malformed subpaths are skipped with a warning. Advanced path fills remain partial. |
| Shape text bounds and `bodyPr` behavior | Partial | Custom text rectangles retain source EMUs and guide formulas, group scaling, signed offsets, and vertical anchors. Unsupported or invalid rectangles fall back to the shape bounds. Exact autofit and long-tail preset text bounds remain incomplete. |
| Theme colors and fonts | Supported | Browser font fallback stacks are available. |
| Solid and gradient fills | Supported | Pattern and picture fills are partial. |
| Line caps, joins, and ends | Supported | Common cases. |
| Shadows | Partial | Some source effects are simplified. |
| Unsupported content placeholders | Supported | Unsupported content can be represented by placeholders. |
| Exact source-font parity | Partial | Depends on installed fonts, app-provided webfonts, and format metadata. Embedded Office/iWork font loading is not implemented. |
| Animations and transitions | Partial | Explicit navigation plays slide-authored cut, fade, push and wipe transitions, using a supplied compatibility effect when available. **Slide animations** plays appear, disappear, fade and directional wipe effects on whole drawings and explicit paragraph ranges. Native chart builds support appearing, disappearing and fading for the grid and legend, all data, selected series and individually rendered category or point marks. **Reset view** restores static visibility. The preview honors reduced-motion preferences and caps each transition or animation step at 60 seconds. Transition timing and playable animation steps are available on parsed slides and in preview state. Automatic advance, inherited transitions, word and character builds, category-level line/area paths, other chart effects, interactive triggers, motion paths, repeats and sound remain pending. |
| Charts | Partial | Cached 2D column and horizontal bar charts (clustered, stacked and percent-stacked), pie and multi-series doughnut charts, and line charts (standard, stacked and percent-stacked). Column and line combinations support shared categories and primary/secondary value scales. Titles, legends, ticks and column/bar value labels participate in font diagnostics and optional loading. Mixed-script ticks and legends use the authored Latin, East Asian and complex-script faces. Chart and axis titles support automatic placement, manual edge coordinates and offsets, rotation, overlays, and East Asian, Mongolian and upright WordArt vertical flow. Doughnuts retain hole size and slice rotation. Lines support series-level cubic smoothing, gaps/zero/spanning for blank values, source stroke, and circle, square, diamond and triangle markers. Other combination types, exact Office curve control points, and Office title metrics and plot reflow remain pending. |
| XY scatter charts | Partial | Standalone charts use paired X/Y caches with independent linear or logarithmic axes. Supports bounds, reversal, crossings, scientific labels, major gridlines and logarithmic minor gridlines, markers, straight and smooth lines, and blank-value handling. Log axes exclude nonpositive coordinates. Combinations with other plot groups remain pending. |
| Area charts | Partial | Cached 2D area charts support standard, stacked and percent-stacked series, solid and gradient fills, outlines, category reversal and on-tick or between-tick placement. Standard areas honor gaps, zero, or spanning. Stacked areas use zero thickness for missing values and interpolate interior blanks when spanning is requested. Area, column and line combinations support shared categories and primary or secondary linear value axes. 3D effects and area data labels remain pending. |
| Date category axes | Partial | Line, area, bar, column and combination charts use chronological dates from numeric caches. Supports both Excel date systems, authored date format codes, bounds, reversal, and day, month and year units, ticks and gridlines. A combination can position plot groups on distinct date scales. Tick labels are drawn on the primary category axis. Office-specific automatic interval selection and locale-specific formatting remain partial. |
| Bubble charts | Partial | Standalone 2D charts pair cached X, Y and size values. They support independent linear or logarithmic axes, area or width sizing, bubble scale, negative-size visibility, and series and point solid fills and outlines. Authored bounds clip bubbles. Exact Office sizing, 3D effects, negative-value color inversion and bubble data labels remain pending. |
| Embedded audio/video | Partial | Native playback controls and poster assets; browser codec support applies. Source timing and interaction fidelity remain incomplete. |
| OLE objects | Partial | Slide frames show cached pictures, including decoded EMF/WMF, with authored placement and crop. Open the local object from the slide to preview its contents or save a copy. External links use the cached image when available. Undecodable pictures use a labeled placeholder. |
| Speaker notes | Supported as plain text | The collapsed notes panel follows the active slide. Sources with speaker notes expose them in the parsed slide model and paged preview state. Notes page artwork and rich-text styling remain pending. |
| Comments and review metadata | Partial | The read-only panel follows the active slide and displays legacy and modern threads, authors, timestamps and resolution status. **Locate on slide** highlights legacy points and modern slide, shape, group and text anchors. A stale text range highlights its shape. A comment can locate several targets in authored order. Master and layout actions open a read-only source view and return focus to the originating comment. Modern comments and replies show reactions by author and time. Current task fields and authored history are available in the panel, parsed slides and preview state. Comment editing remains pending. |

</details>

### Native iWork

| Runtime | Coverage |
| --- | --- |
| Detection and parsing | Native `.key`, `.pages`, and `.numbers` parsing through a worker. Supports ZIP packages with one enclosing document folder or a nested `Index.zip`. LZFSE edit history is skipped and saved document records supply the preview. [Package regressions](../packages/iwork/test/load-iwork.spec.ts) |
| Encrypted ZIP packages | Modern `.iwpv2` encryption uses Web Crypto with password prompts and retry. Unlocked previews bypass the shared model cache. Browser coverage uses a real Numbers file with a Unicode password. Pages and Keynote coverage uses encrypted test packages with media. [Parser regressions](../packages/iwork/test/encryption.spec.ts) · [Browser regression](../apps/demo/e2e/password.e2e.ts) |
| Switching and cancellation | Replacement, cancellation and destruction discard obsolete results and release images. Busy parsing Workers terminate and restart on the next load; idle Workers clear the old archive and remain reusable. Caller input buffers remain intact. |
| Navigation | Keynote slides, Pages continuous pages, Numbers sheets. |
| Diagnostics | Warning and error events. |

<details>
<summary>Expand iWork content and fidelity matrix</summary>

| Feature | Status | Details |
| --- | --- | --- |
| Keynote slide canvases | Supported | Full master/template fidelity is incomplete. |
| Pages multi-page body extraction | Supported | Exact source pagination is incomplete. |
| Pages floating attachments | Partial | Some placement and content are simplified. |
| Pages section/page backgrounds and template headers/footers | Supported | Template headers and footers preserve saved slots, page-edge margins and links to the previous page or section. Includes section page-number start values. |
| Numbers sheet canvases and merged cells | Supported | Table fidelity remains partial. |
| Numbers tables | Partial | A full Numbers calculation engine is unavailable. |
| Text runs and paragraphs | Partial | Some formatting is simplified. |
| Images, media asset lookup, basic shapes, and lines | Partial | Unsupported records produce warnings. |
| Charts | Unavailable | Chart rendering is outside current coverage. |
| Collaboration metadata | Unavailable | Not exposed by the native viewers. |

</details>

### PDF, DOCX, and workbooks

| Driver | Implemented | Current limits |
| --- | --- | --- |
| PDF | Virtual previews mount page containers and canvases around the viewport. Up to two visible page paints can proceed within the shared raster budget, so one held range can leave room for other visible pages to render. Text extraction for selection and font diagnostics starts when a page enters the viewport. Zoom, fit and host resize preserve the visible page's in-progress text extraction and selection. Leaving the viewport cancels unfinished extraction and preserves completed text while the page stays mounted. PDF.js drawing operators and page objects are released when pages leave the mounted window. Long scroll tracks preserve the displayed page scale and reach distant pages without mounting offscreen placeholders. Full-document literal search matches streamed text case-insensitively across runs and line breaks, with wrapped navigation and localized controls. It scans available selection layers as text arrives and publishes hits from complete visible layers while earlier pages are pending, including pages brought into view after the search begins. Results join in document order and preserve a match already selected by the user. Changing or clearing the query stops the scan, ends its wait for a pending page, and cancels any stream opened by search. A shared selection stream continues reading. Progress and page errors are reported together on animation frames. `virtual: false` renders every page eagerly. Text extraction and layout can finish after the first paint. [Search regressions](../apps/demo/e2e/pdf-search.e2e.ts) | Search opens a separate stream when the selection layer and cached page text are unavailable. Repeated queries can reuse up to 4,096 complete pages of text in the open document, capped at 1,048,576 UTF-16 code units in total and 32,768 per page. Password-opened and explicitly sensitive sources use fresh offscreen text streams. It retains at most 10,000 matches and stops at the first additional match in document order. Image-only pages require OCR. Selection follows PDF text order. Unopened page sizes initially use first-page estimates. Shared PDF.js resources and page metadata can remain cached until close. The eager rendering mode supports full-document printing. |
| PDF large pages and zoom | Page canvases have a combined limit of 8,388,608 pixels per page and 8,192 pixels per side. On oversized virtual pages, a bounded full-page raster and a sharper viewport raster preserve the zoom geometry and selectable text. Panning cancels and releases displaced detail. [Browser checks](../apps/demo/e2e/pdf-lifecycle.e2e.ts) | The limit covers page canvas backing stores, up to 32 MiB of RGBA pixels per page. PDF.js decoding, render intermediates, cached first pages and browser compositing have separate costs. Oversized pages in eager mode use a bounded full-page raster for preview and printing. |
| PDF HTTP sources | Virtual PDF previews and the workbench pass HTTP(S) URLs directly to PDF.js. Eligible servers receive byte-range requests for initialization and navigation. Servers without range support can send a normal full response. Replacement cancels outstanding requests. [Browser checks](../apps/demo/e2e/pdf-remote-ranges.e2e.ts). | Range loading requires a file larger than 128 KiB, an advertised byte range, known length, identity encoding and matching partial responses. Cross-origin responses need CORS access to the range headers. Initial transfer depends on PDF object layout, and full search can read the rest of the file. |
| PDF local sources | Virtual previews supply File/Blob data larger than 128 KiB to PDF.js through cancellable slices. Replacement or close aborts active file reads. Encrypted files use the same path with password prompts and retry. [Browser checks](../apps/demo/e2e/pdf-local-ranges.e2e.ts) | Small files and non-virtual previews use full reads. The bytes read at startup depend on object layout, and search can read the rest of the file. |
| PDF range storage | The PDF.js worker allocates bytes as chunks arrive for local and HTTP range-loaded files larger than 16 MiB. In a 756-page Adobe PDF, the worker held about 2.82 MiB of source bytes at first-page readiness and 10.08 MiB after full search, down from 21.45 MiB at both stages in Chromium. [Measurements](../benchmarks/frontend/2026-11-27/pdf-range-storage.json) | Smaller ranged files use contiguous storage. Loaded chunks remain available until close. Recovery and explicit full-document reads can still allocate a contiguous copy. |
| PDF encryption | PDF.js opens supported encrypted PDFs with a password prompt when required. An empty user password can open an owner-restricted PDF without a prompt. [Browser checks](../apps/demo/e2e/password.e2e.ts) | The shared first-page raster cache is limited to PDF.js-verified unencrypted sources outside protected containers. Attachments from encrypted PDFs bypass shared document caches. |
| DOCX | Rendering through `docx-preview`; repeated image references reuse resources within their document part. Switching, cancellation and destruction release embedded image/font URLs and discard obsolete rendering. | Fidelity depends on renderer coverage, fonts and layout. Parsing/rendering already in progress may finish in a detached container. |
| XLSX | Sheet switching, cell values, cached formula values and selected formula evaluation when cached values are absent. Rectangular merged cells retain anchor values/fonts/formulas, including when the anchor is outside the row/column window; blank merge endpoints extend sheet dimensions. | Unsupported formulas remain visible as formula text. Charts, advanced styles, number formats and a full calculation engine remain limited. See the XLSX grid styles entry below. |
| CSV | Read-only UTF-8 tables with CRLF, CR or LF, quoted multiline text, escaped quotes and empty records. Large local files use 256 KiB Blob slices, and remote previews consume the response stream. Complete rows appear while reading continues. The grid extends its row and column windows while preserving the reading position. Replacement cancels pending HTTP reads, and replacement or failure clears partial rows. [Browser regressions](../apps/demo/e2e/workbook-lifecycle.e2e.ts) | The preview retains decoded fields and row offsets in memory. The public CSV reader returns the row and cell model. The load promise completes at EOF. Data URLs and hosts without response streams can use buffered text. Rich type inference and workbook styling are unavailable. |
| XLSX/CSV and Numbers grid loading | Scroll renders row and column windows plus overscan (at least 100 rows and, for wide sheets, 20 columns), replacing distant content with spacers. XLSX/CSV sparse navigation through `XFD1048576` and offscreen formulas are verified. Numbers tables reuse these windows, including variable source heights and loaded pictures, multiple tables, horizontal-scroll height retention, font refresh and resize with logical reading-row preservation. Late layout changes retain the bottom position. Sparse semantic fixtures cover 100,000 rows × 1,024 columns and a 5,000-row × 64-column picture table. | The full parsed model remains in memory; semantic Numbers fixtures verify rendering; serialized sparse-merge fixtures additionally exercise ZIP/IWA decoding and the real worker. Numbers retains parsed source column widths in wide and narrow tables, including columns wider than the viewport; horizontal lookup and merged text/gradients use cumulative widths. XLSX also preserves explicit/default/base source widths, measuring the Normal style font and point size and retaining the logical reading column on font refresh. CSV keeps default widths; full source styles retain limits. `virtual: false` retains incremental row loading. Unseen image heights are estimated until loaded. XLSX/Numbers merged ranges are clipped to mounted rows/columns, preserving source content offsets; multi-row merged pictures fit the source row area. Incremental batches retain earlier native anchors and split spans at HTML limits. Compact hosts fit their available height. XLSX source styles/merge alignment and advanced Numbers effects remain partial. |
| XLSX package loading | Remote XLSX files can use HTTP byte ranges. Large local XLSX files use Blob slices. The worksheet reader and attachment listing share the ZIP index. The workbook reader resolves SpreadsheetML prefixes in the workbook and styles and package namespace prefixes in relationship parts. Opening an attachment reads its payload. Large worksheets add complete rows and saved values while later ranges or slices are pending, including in single-sheet files. Users can switch to available tabs while a later sheet is still streaming. The selected sheet and reading position survive later row batches. Replacing the workbook cancels pending range requests. [Browser regressions](../apps/demo/e2e/xlsx-remote-ranges.e2e.ts) | Unusable ranges and encrypted Office envelopes use a full read. The ZIP tail can include nearby entries. Shared strings and styles load before the first sheet. Merge ranges from trailing worksheet metadata appear once that sheet is parsed. Uncached formulas and conditional formatting wait for the complete workbook. The cell model stays in memory. |
| XLSX worksheet XML parsing | Large stored and DEFLATE entries stream into row batches of about 512 Ki characters. Ranged HTTP and large local Blob sources read entry data in blocks of at most 1 MiB. Batches of numeric, shared-string and plain inline text cells use the direct reader. Batches with formulas, rich text, XML escapes or SpreadsheetML namespace prefixes use the general XML parser. Worksheet prefixes and locally declared aliases are resolved for both Transitional and Strict SpreadsheetML namespaces. Large counts of standard escapes and numeric character references can stream. Column styles, shared formulas, row sizes, merged ranges and conditional formatting retain worksheet scope. Previews resolve cell fonts from shared styles, and the public reader exposes each cell's resolved font. [Browser regressions](../apps/demo/e2e/xlsx-remote-ranges.e2e.ts) · [XML batching measurements](../benchmarks/frontend/2026-11-25/xlsx-worksheet-streaming.json) · [Shared font measurements](../benchmarks/frontend/2026-11-26/xlsx-preview-shared-fonts.json) · [Inline text measurements](../benchmarks/frontend/2026-11-26/xlsx-inline-text-streaming.json) | The complete cell model stays in memory. ZIP compatibility paths, oversized rows or metadata, and unsupported framing use buffered parsing. Entity declarations use the buffered parser with document-wide expansion limits. |
| XLSX shared string table parsing | Large stored and DEFLATE entries use the same block reads and feed cancellable XML batches of about 512 Ki characters. String indices and rich text are retained across batches, including in prefixed SpreadsheetML shared string tables and with large counts of standard character references. In the earlier XML batching benchmark, a 220,000-string workbook produced the same model as buffered batching, with median peak Node RSS of 253 MiB, down from 323 MiB. [XML batching measurements](../benchmarks/frontend/2026-11-25/xlsx-shared-string-streaming.json) | The string index and workbook model stay in memory. ZIP compatibility paths, oversized items and unsupported framing can use the expanded XML. Entity declarations use the buffered parser with document-wide expansion limits. |
| Numbers merge parsing | Range-level coverage retains anchors (including absent row storage) and actual stored continuation cells, without synthesizing blank covered-cell objects. Pages retains a dense grid. Serialized ZIP/Snappy/IWA fixtures cover 100,000 rows × 1,024 columns in the real browser worker and one million rows under a 128 MiB Node V8 old-space cap. [Measurements](../benchmarks/frontend/2026-11-25/numbers-merge-memory-review.json). | Fixtures contain three stored cells and large declared merge ranges; they do not establish dense-archive, browser/device or total peak-memory limits. Compressed/decoded data, parsed values and source row/column arrays remain resident. |
| XLSX source column widths | Retains explicit column ranges, `defaultColWidth` and `baseColWidth`, with the ISO 29500 maximum-digit-width calculation. Raw units and the Normal style font/size survive parsing; numeric worksheets retain the metadata-only fast path. Font-ready refresh remeasures source widths without losing the logical column/position within it; cache clones preserve private font aliases. Unequal widths, wide columns, merged coordinates and source-width navigation through `XFD1048576` have browser regressions. Layout heights avoid offscreen rectangle precision errors near the final row. | No-canvas parsing uses a 7px digit baseline. Missing original fonts and live column best-fit remain fidelity limits. |
| XLSX source row heights and formula view | Saved default and per-row heights drive a sparse scroll index. Fixed rows clip content, including horizontal merges. Automatic rows grow for visible wrapping and retain fractional heights. Long wrapped text is clipped at the height limit of about 546 CSS pixels in ordinary cells, horizontal merges, and Center Across Selection, with the full value retained. Clock recalculation preserves measured heights across partial column windows and can shrink rows when all columns are mounted. A saved formula view shows original and translated shared expressions at double column widths. | Unmeasured auto rows use their saved height. A shorter value can retain its previous row height in a partial column window. Browser layout and loaded fonts determine visible wrapping. |
| XLSX and Numbers hidden tracks | Both grids skip source-hidden rows and columns in layout, scroll offsets and merged spans. Source labels and merge anchors survive. XLSX preserves hidden formula dependencies and applies `sheetFormatPr zeroHeight` to unstored rows. Numbers supports parsed hidden state in virtual and incremental grids. | Visibility follows the saved workbook. |
| XLSX formula evaluation | Cached values take priority. Without a cache, the viewer evaluates arithmetic, comparisons, percentages, common aggregates, rounding, conditionals and text concatenation with typed results. In array contexts, elementwise calculations repeat single rows or columns and pad other missing positions with `#N/A`. Quoted cross-sheet references and whole rows/columns use the sparse index. Shared formulas and workbook- or sheet-scoped defined names resolve on demand. Names support aliases, relative references, scalar expressions and multi-area ranges. `ROW` and `COLUMN` return current or referenced coordinates as single values or arrays. Saved `_xlfn.SINGLE` applies implicit intersection. Conditional aggregates include `COUNTIF(S)`, `SUMIF(S)`, `AVERAGEIF(S)`, `MINIFS` and `MAXIFS` with single-area references, comparisons, case-insensitive wildcards and sparse blank counting. Tests reach `XFD1048576` and remove caches from a shipped CONCAT sample. | External references, named expressions that require additional functions, and full array formula evaluation remain limited. Invalid or duplicate definitions produce warnings. Locale-specific date and numeric text criteria remain limited. Cycles and unsupported formulas retain source text when available. |
| XLSX `SUMPRODUCT` | Calculates weighted and conditional totals over cross-sheet ranges, defined names, table columns, and array constants when a cached value is absent. Whole-row and whole-column calculations use the sparse index, including when unstored cells affect the result. | Arguments require matching dimensions. Operators inside an argument support row and column expansion. General array functions and spill remain limited. |
| XLSX array slicing and stacking | `TAKE` and `DROP` select contiguous rows or columns from either end of an array. `HSTACK` and `VSTACK` append arrays and pad unequal inputs with `#N/A`. `IFNA` replaces those errors. `UNIQUE` selects distinct or exactly-once rows and columns in source order. `SUBSTITUTE` supports scalar and array text replacement. `COUNTIF` accepts array criteria, and `CHOOSE` selects values by scalar or array index. Stack functions and supported aggregates accept same-workbook 3-D references. Range-backed slices narrow the worksheet scan to the selected rectangle. [Browser regressions](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Spill output uses the declared workbook range and preserves cached cells. Full scans of generated positions, including padding, remain bounded. |
| XLSX `TOCOL` and `TOROW` | Flattens ranges and arrays into one column or row. Scans either source axis and can omit blanks, errors, or both. Kept blanks are zero, and empty text retains its type. Sparse source ranges skip unstored positions. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | A result must fit along one Excel axis. Filtering dense generated inputs uses the existing scan limit. |
| XLSX `WRAPROWS`, `WRAPCOLS`, and `EXPAND` | Reshapes single-row and single-column vectors by rows or columns and pads arrays to the requested dimensions. Typed padding defaults to `#N/A`. Sparse wrapping and repeated padding support offscreen formulas and declared spills through `XFD1048576`. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Dense generated scans use the existing limits. |
| XLSX `LAMBDA`, `ISOMITTED`, `BYROW`, and `BYCOL` | Calls inline functions, `LET`-bound functions and scoped defined names. Direct calls support optional parameters and explicit omissions. Worksheet references retain their source sheet in cross-sheet calls. Group callbacks receive a row or column, and supported aggregate shorthand can skip unstored groups through `XFD1048576`. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Each group callback takes one parameter and returns one value. General callback scans and named recursion use calculation limits. |
| XLSX `MAP` | Maps one or more arrays by position, passing worksheet cell references to callbacks and values from calculated arrays. Supports expanding `COUNTIF` ranges, visible-row `SUBTOTAL`, and sparse calculated results through `XFD1048576`. SpreadsheetML text escapes are decoded before text functions such as `CLEAN` and `PROPER` run. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Each callback returns one value. Mismatched dimensions use `#N/A` padding. Dense scans, including arbitrary reference callbacks, use the calculation limit. |
| XLSX `MAKEARRAY` | Generates values from one-based row and column positions using an inline, named or `LET`-bound lambda. Declared spills calculate on demand through `XFD1048576`. Saved follower values and conditional styling retain their usual precedence. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Each callback returns one value. Dense scans use the existing preview limit. |
| XLSX `LARGE`, `SMALL`, and `CORREL` | Rank functions select numeric values from ranges or calculated arrays and accept one or more ranks. `CORREL` pairs numeric values at the same position and computes the Pearson coefficient. Sparse ranges skip unstored blanks. | Dense scans use the existing preview limit. `CORREL` requires equal input lengths and variation in both numeric series. |
| XLSX `SCAN` and `REDUCE` | Apply inline or named lambdas and supported aggregate shorthand in row order. `SCAN` returns running values with an optional zero seed. `REDUCE` accepts scalar and array accumulators and uses the first source element when the seed is omitted. `SUM`, `PRODUCT`, `MIN` and `MAX` shorthand reductions skip repeated blank positions in sparse ranges. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Each `SCAN` step returns a single value. Sequential evaluation and intermediate accumulator arrays have calculation and text limits. |
| XLSX `GROUPBY` | Groups ranges and calculated arrays by one or more fields. Supports row filters, field headers, signed sort columns, hierarchy or table sorting, and grand totals or hierarchical subtotals. Aggregates include inline and named lambdas, common function shorthand, `PERCENTOF`, and horizontal or vertical aggregate lists. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Each aggregate returns one value. Group and output size use preview calculation limits. |
| XLSX `PIVOTBY` | Cross-tabulates ranges or calculated arrays. Supports independently sorted row and column fields, filters, subtotals and grand totals, Lambda aggregates and `PERCENTOF` with five choices of denominator. Empty intersections display as empty text. Large sparse results are read by position. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Aggregation scans use preview limits. The worksheet still supplies the declared spill range. |
| XLSX `REGEXTEST`, `REGEXEXTRACT`, and `REGEXREPLACE` | Unicode PCRE2 patterns, case options, first or all matches, capture groups, and replacement of all matches or one occurrence counted from either end. Scalar extraction can spill across columns. Array arguments support one result per input position. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Text arguments and replacement output are limited to 32,767 UTF-16 code units. Extraction fits within 16,384 columns. Pattern compilation, match work, and WASM memory are bounded. Hosted builds load `xlsx/pcre2.wasm` on demand, and CLI offline HTML embeds it when available. |
| XLSX `TRIMRANGE` and trim references | Removes blank outer rows and columns from ranges and calculated arrays with independent leading and trailing modes. Supports Excel's dot operators and serialized trim references. Worksheet results retain coordinates and interior blanks. Named calculated arrays can feed lookup formulas, including `VLOOKUP` and `HLOOKUP` with scalar keys. [Browser regression](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | Row-only trim can stop at the first and last populated records. General dense scans use the calculation limit. |
| XLSX text formulas | `TEXT` formats values with a workbook number code and the saved date epoch. `TEXTJOIN` joins literal arrays, named and cross-sheet ranges in row order and cycles range or array delimiters. It can skip or count unstored blanks without expanding the range. `TRIM`, `CHAR` and `FORMULATEXT` are supported. Formula expressions are read from saved or translated shared records without evaluating their targets. Cached strings retain preserved whitespace. `SEARCH` finds the first case-insensitive match with Excel wildcards, `FIND` searches case-sensitively, and `LEFT` and `RIGHT` extract text. These four functions and `NOT` calculate elementwise on arrays and preserve per-cell errors. `TEXTBEFORE` and `TEXTAFTER` support literal delimiters, signed occurrences, case and endpoint options, fallback values and declared spills. `NA` and scalar `IS` checks preserve typed values and error tests. `ISFORMULA` reads saved formula metadata and evaluates ranges elementwise in array contexts, including shared and legacy array formulas. | The output limit is 32,767 characters. `CHAR` uses Windows-1252. Character positions use legacy UTF-16 counting. Delimiter lists have a combined length limit. The shared formatter has limits for locale-specific numbers and long-tail format codes, and general spill and external workbook references remain limited. |
| XLSX structured and dynamic references, subtotals | Resolves named Excel tables and current-row, header, data, totals and contiguous column selections. Table metadata comes from worksheet relationships and survives streaming and cache clones. Escaped and multiline column names are supported. `ADDRESS` formats A1 or R1C1 coordinates with absolute and relative modes and sheet names. A scalar address passed to `INDIRECT` resolves to a workbook-local A1 or R1C1 reference. `OFFSET` shifts and resizes a contiguous reference for use in defined names, range endpoints and declared arrays. `SUBTOTAL` supports codes 1–11 and 101–111 using saved filters, source row visibility and nested-subtotal exclusion. | Calculated cells use saved formulas. Shared hidden flags can conflate filter-hidden and manually hidden rows inside an active filter range. Dynamic references use workbook-local inputs and scalar address or offset arguments. |
| XLSX lookup formulas | `VLOOKUP`, `HLOOKUP`, `MATCH`, `XMATCH`, `XLOOKUP` and `INDEX` support workbook ranges and defined names. Search modes include exact, approximate, case-insensitive wildcard, reverse and sorted binary matching as applicable. Sparse searches skip unstored coordinates, and an omitted `XLOOKUP` key can match an unstored blank. `INDEX` returns a cell, row, column or area reference from same-sheet ranges. Single-key `XLOOKUP` retains a cell, row or column reference when the return area is on a worksheet. Defined names, range endpoints, formula checks and conditional rules can use these references. Calculated return arrays produce values or arrays. `XMATCH` and `XLOOKUP` accept array lookup values and calculated lookup vectors. Exact searches share work across the spill. Array-key `XLOOKUP` keeps one typed result per key, including errors and scalar fallbacks for misses. `EXACT` compares text case-sensitively and expands its array operands elementwise. `TRANSPOSE` swaps axes and accepts a full row or column returned by `XLOOKUP` for a single key. | `XLOOKUP` with multiple keys and several return fields per key, further reference-returning functions, and locale-specific sort order remain limited. Sorted modes require ordered keys. |
| XLSX date and time formulas | `DATE`, `TIME`, `DATEVALUE`, `TIMEVALUE`, date/time parts, `DAYS`, `EDATE`, `EOMONTH`, `WEEKDAY`, `WORKDAY`, `NETWORKDAYS` and the `.INTL` workday variants use the saved 1900 or 1904 epoch. Applicable inputs include date serials, ISO date text, and Gregorian dates or times in the browser locale. Omitted years use the calculation clock. Date constructors, date and time text conversion, date and time parts, `DAYS`, `EDATE`, `EOMONTH` and `WEEKDAY` can calculate elementwise with scalar and array arguments. Workday functions calculate date pairs, offsets and weekend schedules elementwise. Each formula shares a deduplicated holiday index from sparse ranges, defined names, or array constants. Uncached `TODAY()` and `NOW()` use local time at open, sheet switch, tab resume or local midnight. Results feed conditional formatting and the cell's saved number format. | Date parsing follows the browser's locale data, including a fixed 1930–2029 two-digit year window. Custom system date patterns, non-Gregorian input, date-text criteria and general array formulas remain limited. |
| XLSX `TEXTSPLIT` | Splits text into rows and columns with literal delimiter lists. Supports case-insensitive matching, preserving or ignoring empty fields, typed padding, nested `TRIM` and declared spills. Formulas can count repeated padding without expanding the result. [Browser regressions](../apps/demo/e2e/xlsx-array-selection.e2e.ts) | The text argument reads one value, including the first cell of a range. Padding takes a scalar. Input and each delimiter list are limited to 32,767 UTF-16 code units and results fit within Excel's row and column limits. |
| XLSX numeric text formulas | Uncached `NUMBERVALUE` and `VALUE` read browser-locale digits, decimal and grouping separators, scientific notation and `%`. `NUMBERVALUE` accepts explicit separators. `VALUE` also reads common currency-symbol forms and supported date and time text in the workbook's 1900 or 1904 system. Results support array spills and conditional formatting. [Browser regressions](../apps/demo/e2e/xlsx-formulas.e2e.ts) | Currency codes, localized percent signs other than `%`, and desktop settings for custom separators or dates remain limited. |
| XLSX number formats | Built-in and workbook-local codes display dates and elapsed time, percentages, currencies, fractions, scientific notation and custom sections. Supports 1900/1904 serials and ISO date cells. Formatting applies to mounted values, including cached and evaluated formulas and merged anchors. Text retains its source type and raw calculation values stay intact. Recognized Windows locale IDs select Gregorian month and weekday names and AM/PM markers in individual date format sections. System long dates (`[$-F800]`) and system times (`[$-F400]`) use the browser's regional date and clock patterns. Active sections support named colors and `Color1`–`Color56` with workbook palette overrides. Explicit conditional font colors take priority. Accounting formats and custom `*` and `_` directives use available cell width and measured glyph spacing, including in clipped merges. Decimal, percentage, common fraction, and scientific mantissa and exponent masks use digit-width blanks for `?` and tabular digits where the font supplies them. Scientific formats support engineering exponent intervals and sign rules. `DBNum` numeric formats support Simplified and Traditional Chinese, Japanese and Korean, with locale-specific place units for `General` and digit substitution in explicit numeric masks. A saved locale ID takes precedence over the browser locale. `DBNum` also formats Gregorian dates, numeric clock fields and common Japanese era codes. Cells, differential formats and `TEXT` preserve authored literals. The namespaced `formatCode16` attribute takes precedence in the workbook styles part, including differential styles. Legacy and modern locale tags support Japanese and Minguo era fields, Buddhist and Dangi years, and common decimal and East Asian numeral scripts. Modern system date and time tags and Japanese gannen are supported. Date arithmetic uses the original serials. | Further calendar systems and private locale tags, locale-specific separators in custom codes, desktop date and time overrides, negative date/time display, and `?` placeholders in uncommon masks remain limited. Unsupported codes that fail to parse retain the raw value. |
| XLSX grid styles | Renders source font size, emphasis, decorations, RGB/theme/indexed colors, solid/basic pattern/gradient fills, four-sided and diagonal borders, explicit alignment and wrapping. Visible blanks inherit cell, row, column and base formats while the model stays sparse. Wrapped rows use sparse height measurements. Saved shrink-to-fit alignment scales single-line displayed text, including formatted values and rich text. Clipped merges preserve anchor styling, source alignment and the full merge width for fitting. Stored continuation-cell borders follow the merge perimeter through both grid axes. The bottom-right cell fills a missing anchor bottom or right border. Explicit conditional borders on the anchor take priority. [Browser regression](../apps/demo/e2e/xlsx-styles.e2e.ts) | Shrink-to-fit uses browser font metrics and keeps ordinary clipping when measurement is unavailable. Diagonal strokes follow the full merge geometry through clipped windows. Dash-dot variants use dashed CSS strokes. Advanced alignment and exact pattern geometry remain limited. |
| XLSX text orientation | Preserves saved angles from −90° to 90° and upright stacked characters. Rotated rich text and displayed formula values participate in automatic row sizing, fixed-row clipping and shrink-to-fit. Merged labels retain their source position through row and column windows. Unwrapped angled text extends across empty columns until it reaches content, a merge or an array result. The preview adds trailing blanks as needed through `XFD`, using saved column widths and visibility. Horizontal scrolling keeps the original source position, including offscreen anchors. [Browser regression](../apps/demo/e2e/xlsx-text-rotation.e2e.ts) | Trailing columns are added as the corresponding rows come into view. Wrapped, shrink-to-fit and merged content stays within its source cell or merge. At angled orientations, automatic line breaks follow browser font metrics. |
| XLSX Center Across Selection | Centers the label over consecutive stored blanks with the saved alignment, using their visible widths. Individual cell colors, borders and coordinates are preserved. The label keeps its source position if the anchor scrolls out of view. [Browser regression](../apps/demo/e2e/xlsx-center-across.e2e.ts) | Gaps, occupied cells, merges and array ranges end the span. |
| XLSX conditional formatting | Value comparisons, supported formulas, text, blanks and errors apply differential fills, font emphasis, colors, borders and number formats by priority and honor stop-if-true. Color scales, data bars and icon sets use sparse range values and supported formula thresholds. Office 2010 extensions support standalone rules, inline differential styles and formula activation for visual rules. Base and Office 2010 expression rules can use `ISFORMULA` to format source formula cells. Icons preserve threshold equality, reversal, Office 2010 custom choices and accessible numeric text in icon-only mode. Range rules cover top and bottom counts and percentages, averages and population standard deviations, duplicates and unique values. All ten base date periods use the viewer's local date and the workbook's 1900 or 1904 date system. | The browser approximates icon graphics and bar gradients. Percentage ranks round down and include ties at the cutoff. Rankings and exact percentiles use a temporary numeric buffer. Duplicate checks use typed values, case-insensitive text and whole-cell wildcards, with empty and error cells excluded. Date periods use Sunday-based weeks. Office 2010 text, blank and error rules depend on supported saved formulas. Locale-specific text matching and further extensions remain pending. |
| XLSX rich text | Shared and inline strings preserve per-run font, size, emphasis, color, decorations and baseline shifts, including in clipped merged cells and text format sections. Font diagnostics and host font mappings include named run faces. Formulas keep the plain string, and repeated shared strings reuse the same parsed runs. | Phonetic guides, advanced font effects and exact superscript/subscript metrics remain outside current coverage. |
| Numbers cell values | Modern v5 records provide numeric values, currencies, percentages, dates, booleans, text and durations. The preview reads the format for the saved result kind, preserves stored styles and supports four-byte offset units in wide rows. Built-in duration formats handle automatic and saved unit ranges from weeks to milliseconds through v4 and v5 storage. Compact output and both styles of unit labels use the document locale. Built-in scientific notation, mixed fractions and bases 2–36 use the saved precision, denominator and padding settings. Binary, octal and hexadecimal support two’s-complement display. Built-in decimals, percentages and currencies preserve saved precision, document locale, separators and currency symbols. Negative styles include red text and parentheses, and accounting amounts align separately from their symbol. Gregorian date and time formatting reads both v4 and v5 storage, resolves workbook-level custom format UUIDs and uses saved month and weekday names and day periods. | Decimal-backed values use JavaScript number precision. Explicit elapsed patterns are supported. Unrecognized duration settings can fall back to seconds. Currency placement and digit shapes follow runtime locale data. Saved separators and currency labels override runtime defaults when available. Non-Gregorian date arithmetic, additional saved formats and full Numbers calculation remain pending. |
| Numbers custom formats | Resolves workbook UUID references and inline number, currency and text definitions. Numeric patterns support zero and space padding, grouping, quoted text, fractions, scientific notation, saved scaling and ordered comparisons. Text substitution preserves rich-text runs for a single saved placeholder. | Numeric patterns with multiple separate digit fields and rich-text patterns without exactly one placeholder retain the original cell content. Values use JavaScript numeric precision. |
| Numbers grid styles | Shared core rendering preserves parsed rich runs (fonts, sizes, emphasis, colors and links), paragraph spacing/wrapping/padding/alignment, solid/gradient/basic pattern fills and per-side borders. Loaded font mappings reach visible runs. Merged content retains source alignment/gradient coordinates and clipped fragments omit interior borders. Stored empty style cells retain inherited/explicit fills; narrow columns remain stable and each visible batch shares font probes. Real-file header styles and large-grid windows have browser regressions. | Unstored blanks inherit source fills and borders, including track overrides, banding, header and footer styles and border visibility. The grid resolves them as each batch renders. Omitted rich-text/style metadata, advanced effects and full number formats remain partial. Saved picture modes control the cell background and keep text above it, including on clipped merges. The viewer uses its fitted preview for stored cells with missing mode metadata. Authored picture tint preserves image alpha and applies before fit and tiling. Full color-profile and native renderer parity remains pending. |

### DWG and CAD drawing models

| Area | Preview coverage | Limits |
| --- | --- | --- |
| Default path | The frontend WASM core reads DWG into `cad-json`; the CAD driver renders that model as SVG without a DXF round trip. | Use `cadWasm`, the combined graphics module via `graphicsWasm`, or the combined core. Explicit DWG → UTF-8 DXF conversion remains available. |
| Drawing content | Common 2D geometry, text, layers, line styles, block/array expansion, attributes, hatches, raster references and basic dimensions. | Partial DWG fidelity; unsupported entities are skipped with warnings. Proxy objects, external references, SHX glyphs and full CAD layout are incomplete. DXF entity coverage below does not imply identical DWG coverage. |
| Direct model input | `.cad-json` or `application/vnd.filens.cad+json`; `loadCadDrawing()` loads the model emitted by the converter. | Schema version 1 and DWG source metadata; not arbitrary JSON or a CAD editing API. |
| File-format versions | R14/AC1014 through AC1032 (2018 saved-file format). | R12 is unsupported and R13 is unverified. [13-drawing compatibility/performance audit](dwg-preview-optimization.md); saved-file versions do not establish support for every newer CAD application. |
| Verification | [WASM integration checks](../packages/converter-client/test/graphics-preview.spec.ts) cover R2000/R2018 drawing models and explicit DXF output. | These fixtures establish regression coverage, not compatibility with every DWG version or entity. |

### DXF CAD

<details>
<summary>Expand DXF SVG rendering, entities, metadata, and known gaps</summary>

| Area | Preview coverage | Limits |
| --- | --- | --- |
| Renderer | Supported entities render as browser SVG. | Geometry, layers, styles, and text are partial. |
| Common geometry | `POINT`, `LINE`, `XLINE`, `RAY`, `LEADER`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `LWPOLYLINE`, classic `POLYLINE`/`VERTEX`, bulge arcs, common polyline widths, `SOLID`, `TRACE`, `3DFACE`. | Full DXF entity coverage is unavailable. |
| Solid hatches | Polyline, line-edge, arc-edge, elliptical-arc-edge, spline-edge boundaries; multi-loop even-odd fill for holes. | Patterned/nested hatches remain incomplete. |
| Blocks and dimensions | Nested `BLOCK`/`INSERT`, `MINSERT` arrays, `DIMENSION` geometry-block expansion; lightweight linear/aligned fallback without geometry blocks. | Advanced block attributes and dimensions remain incomplete. |
| Raster references | `IMAGE`/`IMAGEDEF` references and clipping; app resolvers accept URLs, Blob, ArrayBuffer and typed-array slices. Owned image URLs are released on replacement, cancellation, failure and destruction. | Unresolved local paths produce placeholders and warnings. |
| Loading | Safe file replacement and cancellation; obsolete source/resolver results are discarded. Base64 data URLs decode UTF-8 text. | Already-started synchronous parsing and custom resolver work may finish before its result is discarded. |
| Text entities | Simple `TEXT`, `MTEXT`, `ATTRIB`, `ATTDEF`: height, rotation, width factor, oblique angle, alignment points, MTEXT attachment/direction, inline formatting cleanup, multiline rendering. | Exact text metrics, advanced MTEXT, annotative scaling, and layout-space text behavior remain incomplete. |
| Bounds and units | Entity geometry; `$EXTMIN`/`$EXTMAX` or `$LIMMIN`/`$LIMMAX` bounds hints; `$INSUNITS`, `$MEASUREMENT`, `$LTSCALE` metadata. | Layout and xref coverage remain incomplete. |
| Layers and colors | Names, basic ACI colors, true color, transparency, hidden/off/frozen/locked flags, entity invisibility/color overrides, SVG attributes, Vue layer toggles. | Coverage remains partial. |
| Line styles | `LTYPE` dash patterns, global/entity (`48`) line-type scale, entity/layer `LINEWEIGHT`. | Exact source styling is not guaranteed. |
| Fonts | TrueType/OpenType-style references map to CSS fonts. Supplied standard, Unicode, and Big Font SHX sidecars render horizontal glyphs as SVG strokes. | Missing glyphs, unsupported writing modes and unavailable legacy code pages use browser text with diagnostics. [CAD font setup](fonts.md#cad-shx-sidecars) |
| DWG | Local WASM reads a drawing model for the same SVG 2D renderer; optional UTF-8 DXF output remains available. | Separate partial coverage; see [DWG and CAD drawing models](#dwg-and-cad-drawing-models). |
| DGN | Unavailable. | No native preview route. |

</details>

### 3D models and inspection

| Runtime area | Coverage | Requirement or limit |
| --- | --- | --- |
| Three.js viewer | Orbit, zoom, fit, fullscreen. | Import coverage varies by format. |
| Loading and cleanup | Safe file replacement and cancellation; discard late model results and release geometries, materials, textures and nested resource URLs. | Already-started parsing may finish before its result is discarded. |
| External materials and data | Sidecar resource loading. | May require `resourceResolver`; some loaders require synchronous resolution. |
| Inspection controls | Model inspection where supported by the driver. | Object-based previews expose richer controls than some direct-geometry previews. |

<details>
<summary>Expand the complete 3D/model format list and import limits</summary>

| Formats | Import coverage | Requirements and limits |
| --- | --- | --- |
| `step`, `stp` | Triangulated CAD solids. | Lazy-loaded truck Rust WASM; approximate geometry, source colors/names/assembly tree omitted. External part references unsupported; recorded geometry screen 43/44. |
| `stl`, `obj`, `ply` | ASCII/binary STL; OBJ geometry and common inline vertex colors; ASCII/binary-little-endian PLY with common vertex colors. | OBJ MTL libraries/textures can use app-resolved sidecars. |
| `gltf`, `glb` | Embedded/data-URI glTF, URL-loaded buffers/textures, single-file GLB. | External buffers/textures can use app resolution. |
| `3mf`, `amf` | Core 3MF meshes, build/component items, base materials, color-group object/triangle vertex colors; AMF objects. | Unsupported 3MF textures, composite materials, multi-properties, and non-color-palette references emit fallback warnings. |
| `dae`, `kmz`, `fbx`, `3ds`, `usdz` | Collada, KMZ packaged Collada with nested/encoded paths and textures, FBX, 3DS, USDA-backed USDZ. | DAE/FBX/3DS texture sidecars require synchronous app resolution; KMZ uses packaged resources. |
| `wrl`, `vrml`, `ldr`, `mpd` | VRML scenes; LDraw models with packed MPD definitions and nested local parts/primitives. | VRML textures require synchronous app resolution; external LDraw parts require app-provided resources. |
| `md2`, `lwo` | MD2 and LightWave Object meshes. | LWO textures require synchronous app resolution. |
| `gcode`, `gco`, `nc` | Toolpaths. | Supported toolpath subset. |
| `pcd`, `xyz`, `vtk`, `vox` | Point clouds, VTK polydata meshes, VOX voxel scenes. | Supported data subsets. |
| `bvh`, `pdb` | Motion skeletons and molecular structures. | Supported subsets depend on the importer. |
| `nrrd`, `nhdr` | Three-dimensional scalar point volumes; raw, gzip, ASCII, LF/CRLF headers and binary byte order. | Detached NHDR requires one app-resolved data file. File lists, four-dimensional volumes and line/byte skips are unavailable. |

</details>

<details>
<summary>Expand 3D inspection capabilities and Vue UI</summary>

| Capability | Coverage | Scope or limits |
| --- | --- | --- |
| Model metadata | Format, bounds, mesh/line/point/material counts, material names, animation counts, basic triangle/vertex/color metadata. | Available fields depend on the importer. |
| Model tree | Stable node IDs, search/filter, visibility, selection/highlighting, subtree summaries, camera refocus on re-selection. | Object-based previews. |
| Assemblies | Exploded view controls. | Object-based multi-part assemblies. |
| Measurement | Point-to-point surface picks, hover preview, surface/nearest-vertex snapping, free/X/Y/Z axis locks, coordinates, XYZ deltas, preview deltas, total distance. | Available where the driver exposes measurement. |
| Sections | Single-plane and box clipping; X/Y/Z controls and bounds-derived offsets/ranges. | Object-based and direct-geometry previews; arbitrary multi-plane sectioning is unavailable. |
| Materials | Aggregate/per-node summaries: type, color/emissive, opacity, alpha test, depth flags, wireframe, vertex colors, sidedness, roughness/metalness/shininess/size, texture presence. | Material isolation requires an object-based preview. |
| Camera and export | Perspective/orthographic projection, front/right/top/isometric/free-orbit presets, PNG snapshots. | Controls depend on driver capabilities. |
| Diagnostics | Resource warnings in state/events. | glTF/OBJ resources, missing OBJ materials/textures, KMZ textures and LDraw parts, unsupported 3MF materials. |
| Vue inspector | Tree, summaries, explode, measurement, sections, camera controls, snapshots, material isolation, material cards. | Collapsed by default; expand with the button at the top left of the canvas. Models remain still when idle, with manual orbit and zoom. Features depend on driver support. |
| Layer-aware isolation | Unavailable. | Material isolation is supported for object-based previews. |
| Other native formats | Unavailable. | Import coverage is limited to the list above. |

</details>

<sub>glTF sidecar URLs are released after loading, failure or cancellation. Resolvers can return HTTP URLs directly; caller-provided URLs remain caller-owned. STEP can retry after WASM initialization fails. [Resource loading checks](../benchmarks/frontend/2026-10-24/model3d-resources-review.json).</sub>

<sub>Volume previews preserve detached NHDR encoding and fix final-header truncation and byte-order color errors. Cancellation stops waiting for resources; truncated binary data is rejected. [Volume checks](../benchmarks/frontend/2026-10-24/volume-preview-review.json).</sub>

<sub>OBJ preserves UTF-8 material names and resolves texture scale/offset options plus normal, bump and displacement maps. It waits for used images, reports failures and releases owned URLs on completion or cancellation. [OBJ checks](../benchmarks/frontend/2026-10-24/obj-resources-review.json).</sub>

<sub>LDraw preserves packed definitions and containing-file paths, reports missing parts and cycles, and cancels asynchronous dependency loads. Normal smoothing avoids repeated traversal of disconnected surfaces while preserving shading. [LDraw checks](../benchmarks/frontend/2026-10-24/ldraw-resources-review.json).</sub>

<sub>KMZ extracts the selected model and its images, resolves paths relative to KML/DAE, and waits for textures before previewing. Both public APIs release owned image URLs; asynchronous preview supports cancellation and reports missing/broken textures. [KMZ checks](../benchmarks/frontend/2026-10-24/kmz-resources-review.json).</sub>

<sub>3D input reads, GLB parsing, STEP initialization and 3MF archive waits support cancellation. Late scenes are disposed; shared STEP initialization remains usable by other loads. Synchronous parsing itself cannot be interrupted. [Cancellation and rendering checks](../benchmarks/frontend/2026-10-24/model3d-cancel-review.json).</sub>

### Panoramas and live photo samples

| Source | Preview coverage | Requirements and limits |
| --- | --- | --- |
| Equirectangular images | Spherical image preview. | Requires equirectangular source imagery. |
| Equirectangular videos | Spherical video playback. | Requires browser-decodable media. |
| Insta360 `insp` | Experimental calibrated One RS dual-fisheye photos with content-aware feathered seams. | Requires embedded lens calibration and a panorama processor. |
| Insta360 `insv` | Calibrated raw-lens rendering where supported; browser media decoding fallback without WebCodecs. | Calibration, codecs, and projection determine whether a file can open. |
| DJI Osmo `osv` | Calibrated rendering with raw lens sources where available; experimental proxy fallback. | Fallback requires matching camera-generated `.LRF` via `resourceResolver`. Baked-in seams cannot be reconstructed; use a DJI Studio stitched 2:1 export for accurate fallback playback. |
| Unsupported unstitched dual-fisheye video | Rejected. | Not mapped onto a sphere without a supported calibration or fallback path. |
| Apple Live Photo demo | Real iPhone 15 HEIC/MOV pair; Apple's LivePhotosKit JS plays JPEG/H.264 derivatives for Chromium compatibility. Originals remain available. | Demo integration only; no general HEIC/MOV pair decoding. |
| Android Motion Photo demo | Verified Pixel 9 Pro XL and Samsung Galaxy A34 / S20 FE / Tab S9 samples show still images. | Embedded video extraction is not implemented in the WASM conversion core. |

| Integration | Configuration |
| --- | --- |
| Calibrated camera processing | Pass a `panoramaProcessor` to the driver or Vue `Preview`, such as `createWasmPanoramaProcessor({ wasm })` from `@filens/panorama`. |
| Companion lens streams and proxies | Resolve sidecars through `resourceResolver`. |

### Ebooks, archives, mind maps, and diagrams

| Family | Preview coverage | Limits or integration notes |
| --- | --- | --- |
| EPUB / CBZ | Preview indexes metadata and extracts only the selected chapter/page. EPUB handles relative CSS imports, fonts/backgrounds, inline styles, encoded paths and SVG references, with per-chapter resource reuse and cycle checks; EPUB 3 navigation/EPUB 2 NCX supply chapter labels. EPUB shows nested contents with fragment jumps. Both readers support numbered jumps and publisher, light, sepia and dark themes. CBZ preserves natural page order. Page turns keep navigation responsive, cancel obsolete reads and release previous owned URLs. Replacement/cancellation/destruction clears resources. Single-volume ZIP and ZIP64 containers use HTTP ranges or local Blob slices for the ZIP tail, directory and selected entries, including Info-ZIP Unicode paths and CP437 filenames. | Unusable HTTP ranges and ZIP layouts handled by the compatibility reader fall back to a full read. Multi-volume ZIPs require the archive viewer and all parts. Range reads retain the ZIP metadata and current chapter assets. Without navigation titles, unread chapter labels use filenames until opened. Links between EPUB spine chapters require a same-origin chapter frame. Opaque share viewers support contents jumps and themes, returning to the selected anchor after a theme change. Additional native ebook formats are unavailable. Public `loadEpubBook` / `loadCbzBook` still extract the complete book. |
| Archives | ZIP/ZIPX, XPI/CRX, RAR 4/5, 7z, TAR/GZIP, BZip2/XZ/LZMA/Zstandard, AR/DEB/CPIO/RPM, LHA/XAR, WIM/ESD and CAB/ISO/UDF (including comic/TAR aliases): read-only browsing, nested archives, entry preview and extraction helpers. ZIP supports ZipCrypto/AES entry passwords; RAR/7z also support encrypted filenames and solid archives. Multi-volume RAR (`.part01.rar`, `.rar`/`.r00`), 7z (`.7z.001`) and ZIP (`.zip.001`, `.z01`/`.zip`) accept shuffled parts; nested archives collect parts from the same directory. | RAR/7z/ZIPX, compressed streams, AR/DEB/CPIO/RPM, LHA/XAR, WIM/ESD, CAB/ISO/UDF and multi-volume ZIP run in a lazy-loaded frontend 7-Zip WASM worker. CRX2/CRX3 preview reads the ZIP payload without verifying signatures. Hosted builds, including all-in-one, ship the WASM and worker as separate assets. CLI HTML exports embed the pair when available and start the engine on demand; without it the page displays the HTTP `--mode serve` fallback. The export takes one source file, which may be a ZIP containing all archive volumes. Cancellation and a 60-second operation timeout terminate the worker. A volume set accepts at most 256 parts / 512 MiB compressed bytes; missing first/intermediate parts identify the missing filename and the engine validates completeness. Shared nested limits: 8 levels, 20,000 entries, 128 MiB per entry, 512 MiB expanded bytes. Archive links, encrypted ZIP directory metadata and bulk extraction UI are unavailable. Host previewer factories retain preview options and resolve bundled sidecars relative to the entry directory. |
| Document attachments | DOCX/XLSX/PPTX embedded objects and PDF attachments open recursively through the same preview routes, including encrypted archives and documents. OLE Package streams are unwrapped and anonymous RAR/7z payloads are identified. | Return preserves the parent document and restores focus. Child errors remain local; unsupported payloads and corrupt OLE wrappers retain a download. External linked objects are not fetched. Legacy Office exposes only attachments retained by its OpenXML conversion. |
| Demo ZIP bundles | Primary-file detection with sidecars from the bundle. | Recognized primary files include glTF/GLB/3MF, DXF, mind maps, draw.io/dio, HTML/XHTML, and PNG. Text/code candidates keep the ZIP in archive browsing mode so all entries remain accessible. |
| Mind maps | XML/ZIP trees, zoom, responsive contain/width/height fitting, SVG node selection, outline/search capability flags; stale file results are discarded, with cancellation and destruction cleanup. | XMind reads `content.json` / `content.xml`; MindManager reads `Document.xml`. Complex editing and full layout fidelity are unavailable. |
| Diagrams | Compressed/uncompressed diagrams.net mxGraph with default-size fallback; basic Visio XML/ZIP pages including legacy VDX `XForm` / `PageProps` geometry, `Shape` connectors and `pages.xml` manifests; common colors, rounded/ellipse/rhombus shapes, dashed lines, arrows, selection, zoom and responsive fitting. Replaced/cancelled/destroyed sessions discard pending results. | Visio mainly reads cached geometry; full master inheritance, layout fidelity and editing are unavailable. |
| Code / text | UTF-8/UTF-16 BOM detection, declared charsets, literal search/navigation, localized wrap/find controls, and aligned logical line numbers. Above 500 lines, only visible/nearby 128-line blocks are mounted; wrapped heights are measured and reading position survives resize/wrap. Search reaches unmounted blocks, small-code syntax spans cross block boundaries, and Ctrl/Cmd+A in the viewport copies the full source. Verified with 200,000 code lines and 20,000 wrapped lines. | Full-source decoding and line indexes remain in memory. An extremely long individual line can still cost layout time; unread wrapped heights/horizontal extents are estimated. Native drag-selection covers mounted content; use viewport select-all for full-source copying, or `virtual: false` for full DOM/native browser find. Undeclared legacy encodings are not guessed; malformed bytes warn, binary/unsupported encodings fail, and sources over 200,000 characters skip highlighting. |
| Browser images / HTML | Replacement, cancellation and destruction release session-owned URLs and ignore old element events. | Image decoding remains browser-dependent; HTML scripts remain sandboxed. |
| Audio / video | Browser-native playback; replacement/cancellation/destruction stops old players. Failed media sources report errors; optional artwork does not block playback. | Browser codecs; optional bounded MP4/MOV recovery with `browserMedia: true`. No HLS/DASH or general transcoding. Artwork reads ID3 APIC only, limited to the first 512 KiB for Blob/File input. Standalone playback does not imply embedded Office/iWork media support. |

## Integration support

### Routes and source loading

| Capability | Support |
| --- | --- |
| Input sources | URL `string`, `ArrayBuffer`, `Uint8Array`, `Blob`, and `File`. |
| Generic preview runtime | `createPreviewer()`, package drivers/routes, lifecycle, state, warning/error events, and source switching. |
| Format introspection | `listPreviewFormats()`, `listPreviewFormatGroups()`, `listPreviewExtensions()`, and `createPreviewAcceptAttribute()`. Pass the application's composed routes to reflect enabled packages and overrides. |
| PPTX runtime | `init()` / `createViewer()`, `preview()`, `destroy()`, zoom/fit, slide/keyboard navigation, and a virtualized main viewport. |
| iWork runtime | `detectIworkType()`, `loadIwork()`, `createIworkViewer()`, worker parsing, and page/sheet navigation. |
| Vue wrappers | `PptxPreview`, `IworkPreview`, and generic `Preview`; direct `src`, toolbar, thumbnails where applicable, source switching, and warning/error emits. Controls depend on driver capabilities. |
| Converter adapters | Optional WASM, HTTP, and mock adapters. HTTP non-2xx JSON or `X-Preview-*` responses surface as `HttpConversionError` with stable converter metadata. |
| Content detection | Optional `createAutoFormatDetector()` from `@filens/converter-client/format-detector`; separate SIMD/scalar WASM assets with automatic fallback. |

Content detection provides routing evidence, not full-file validation, and does not change preview routes automatically. See the [detector API and hosting requirements](../packages/converter-client/README.md#content-detection-with-optional-simd128).

<sub>The shared runtime settles superseded preview calls on replacement or destruction, aborts their load signals and ignores late results/events. Failed loads release their sessions and remain visible in state. Custom drivers own their resources; work that ignores cancellation may still finish. [Regression checks](../benchmarks/frontend/2026-10-24/preview-runtime-review.json).</sub>

<sub>HTTP / WASM conversion accepts HTTP(S), Blob URLs, paths starting with `/`, `./` or `../`, inline text and data URLs; binary percent escapes preserve their bytes. Cancellation settles the caller while shared WASM loading remains available to other calls. Failed module loads can be fetched again on the next call; a fixed consumed Response must be replaced. Synchronous WASM execution cannot be interrupted. [Source checks](../benchmarks/frontend/2026-10-24/converter-source-review.json).</sub>

| Routing reference | Scope |
| --- | --- |
| [Core route definitions](../packages/core/src/preview/formats.ts) | Format definitions and default routing helpers. |
| [Vue route composition](../packages/vue/src/defaults.ts) | Routes assembled for the Vue `Preview` host. |

### Fonts and external resources

| Hook / helper | Current consumers | Limits or integration notes |
| --- | --- | --- |
| `fontResolver` | Currently consumed by the CAD driver for DXF and DWG drawing models. | Available in preview options and Vue `Preview`; not universal font loading across drivers. |
| `resourceResolver` | CAD raster references, glTF buffers/textures, OBJ materials/textures, supported 3D sidecars, missing EPUB assets, camera panorama companions. | Available in preview options and Vue `Preview`; supported resource types depend on the driver. |
| File-set resolver | Core helper for multi-file uploads and sidecar resolution. | Resolves resources from the provided file set. |
| Archive resolvers | `@filens/archive` helpers expose entries as resources. | Includes ZIP-backed compound bundles. |

| Font source | Current behavior |
| --- | --- |
| Browser fonts and app-provided webfonts | Affect layout; exact source-font rendering is not guaranteed. |
| SHX references | Render supported horizontal glyphs from explicitly supplied sidecars and warn when browser text is used as a fallback. |
| Embedded Office/iWork fonts | Loading is not implemented. |

## Unsupported formats and workflows

Gaps below apply to shipped preview paths. Hosts can supply custom drivers or converter routes.

| Area | Formats or workflow | Current boundary |
| --- | --- | --- |
| Native CAD | DGN, FreeCAD projects, IGES/BREP | No native preview route; STEP/STP, DXF and partial DWG are covered above. |
| BIM | Revit, IFC | No native preview route. |
| ECAD / fabrication | Gerber/Excellon, layered KiCad PCB | No native preview route. |
| Design editing | PSD/PSB layers, Illustrator editing data | Read-only saved-composite or vector preview; no design editor. [Supported subsets](design-preview.md). |
| Other Netpbm extensions | `pam`, `pfm` | No default preview/conversion routes. PBM/PGM/PNM and PPM are supported as described above. |
| Office add-ins | Add-ins and embedded application behavior | Outside the default conversion policy. |
| Unlisted conversion pairs | Any pair absent from the manifests | Outside the default conversion policy; macro stripping applies to listed macro-enabled OpenXML sources. |
| Editing | Office/iWork/CAD/diagram authoring | No full editor. |
| Application parity | Exact layout and calculation behavior | Not guaranteed; consult each family's feature table. |

| Further reading | Contents |
| --- | --- |
| [Roadmap](roadmap.md) | Planned work. |
| [Project overview](project-overview.md) | Architecture and integration context. |
