# DSH integration validation

## 0.1.6 compact address-bar controls — 2026-11-05

Every format keeps **zoom out / percentage / zoom in / fullscreen** in the
DSH address-bar action slot. Page, rotation and fit buttons are omitted; PPTX
keyboard navigation remains. Driver-native zoom is reused; other documents
use shared view zoom without cancelling Word auto-fit. CAD layers and the 3D
inspector keep compact entries, while worksheet/archive/attachment controls
are grouped under Tools. Audio/video playback and progress stay below the
player. The percentage uses a compact four-character width. Controls follow fullscreen and return to
the address bar on exit. [Checks and exact package bytes](../../docs/dsh-compact-controls-validation.json).

## 0.1.5 address-bar controls and preview description — 2026-11-05

Plugin 0.1.5 (CLI 0.5.6 / shared-source preview 0.3.4) places the shared
controls in DSH’s address-bar action slot: page navigation, zoom, rotation,
fullscreen, worksheet tabs, archive tools, attachments, media playback and the
3D inspector. Manual **Fit / Width / Height** buttons are omitted in DSH,
including fullscreen. Fullscreen restores the remaining controls inside its
preview until exit. Standalone previews retain their normal toolbar behavior.
Driver-owned controls keep their actual nodes and handlers; retained parent
controls hide during attachment preview, and each tab cleans up independently.

Validation: **66 Vue tests** (including five control-portal tests), **17 core
attachment tests**, **18 DSH tool/resource tests**, **16 isolated format-loading
paths**, **12 complete browser previews**, and **six actual Desktop formats**.
Browser checks exercise header navigation, zoom, fullscreen and restoration,
archive search, audio/video speed, worksheet switching, theme, model inspector,
independent tabs and worker cleanup. Desktop checks include clickability in a
narrow address bar, the model-tools opener’s bounds, inspector placement,
Escape/focus restoration and unchanged canvas dimensions. Native macOS
fullscreen is explicitly skipped in that Desktop run; browser fullscreen passes.

The 3D / panorama gallery was re-recorded in the installed Desktop app using an
isolated source-build profile, including address-bar model/view/section tools,
panorama zoom and video seeking/playback. GIF, WebP and MP4 are actual UI captures;
encoding verifies GIF colors and timing. The release runtime and client are verified against that recording’s source
build. Package measurements identify the immutable 0.1.5 archive separately.
[Exact source hashes, sizes and checks](../../docs/dsh-header-controls-validation.json)
· [Gallery and provenance](../../docs/assets/dsh-plugin/README.md#3d-and-360-gallery).

## Public 0.1.3 release checks

Final 0.1.3 checks use CLI **0.5.6** and preview **0.3.4**: 18 tool/resource tests, 15 isolated format-loading paths and 12 complete browser previews. The release also verifies all 18 npm modules, 51 offline HTML cases across Chromium/Firefox/WebKit, and packaged content inspection. The terminal demonstrations include actual `inspect` output.

## 0.1.3 model-reopen candidate

XLSX and iWork parser models and STEP CPU meshes share a four-entry, 64 MiB
accounting budget with a 30-second idle lifetime. Each tab gets an independent
model; DOM, URLs, workers and GPU resources are released with the tab. Cached
Numbers documents restore worker archive context only for later lazy sheets.
Full-byte content digests reject changed files. Password opens bypass reuse,
including Office files already decrypted by the shared converter.

Checks: **31 related core tests**, **83 XLSX**, **344 iWork**, **345 model3d**,
**28 PDF**, **61 Vue**, **2 DSH resource tests**, **15 isolated browser format
categories**, and **12 complete browser formats**. Real browser tests verify
Keynote skips document parsing, Numbers preserves lazy-sheet content on reopen,
and all closed iWork workers are released. Six Desktop formats, layout, zoom and
3D interactions pass. Native macOS fullscreen exit hung in automation; this run
explicitly skipped that Desktop check, while browser fullscreen passed.

Nine paired rounds / 18 fresh Desktop processes / 432 opens compare this runtime
with the preceding PDF-cache candidate. Large XLSX reopens fall **94 → 77 ms**,
Pages **177 → 77**, Numbers **176 → 93**, Keynote **177 → 94**, STEP **226 → 109**.
Small XLSX stays **68 ms**; Numbers first open rises **193 → 227 ms**. These are
complete sidebar timings, including hashing, cloning, layout and GPU upload.
[Current package and checks](../../docs/dsh-model-reopen-validation.json) ·
[Raw results, ranges and limits](../../docs/assets/dsh-plugin/model-reopen-optimization.zh-CN.md).
Earlier records below describe their own historical source/package snapshots.

## 0.1.3 PDF reopen candidate

The shared frontend PDF driver keeps up to four recently painted first-page
canvases (16 MiB total, 30 idle seconds). Full-byte SHA-256, exact CSS viewport
and backing resolution identify each entry. Password opens, URL sources and
non-virtual print/export paths bypass it. Every open still loads and validates
its own PDF document; closing destroys its document/worker and live canvases.
Only independent pixel copies remain briefly. Page hide clears them immediately.
DSH removes the loading cover as soon as the real PDF canvas is complete.

Current checks: **28 PDF tests**, **61 Vue tests**, **15 isolated browser format
categories** and **12 browser integration formats**. Reopening releases the worker,
skips first-page operator decoding and preserves the canvas pixel SHA-256 exactly.
Tests also cover changed bytes under the same filename, failed PDF validation,
password bypass, scale/resolution keys, LRU/byte bounds, expiry, cancellation,
printing and independent tab controls. Desktop checks and paired performance
results are recorded in the [current report](../../docs/dsh-pdf-reopen-validation.json)
and [measurement notes](../../docs/assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md).
Earlier measurements below retain their original source snapshots and limits.

## Earlier 0.1.3 format-loading snapshot

The shared runtime mounts directly into DSH's sidebar DOM, with zoom/fullscreen in
its existing header. Lightweight routes register 450 extensions; dynamic imports
load only the matching renderer, reusing shared modules. The PDF driver reports
ready after the first painted page and preserves complete non-virtual rendering.

Snapshot checks: **36 core/lazy-driver tests**, **61 Vue tests**, **80 XLSX tests**,
**19 PDF tests**, **2 DSH resource tests**, **15 isolated-browser format categories**
with reopen/cache checks, **12 full browser-harness formats**, **6 actual Desktop
formats**, plus **58 standalone previews** and **17 offline HTML checks**. Coverage
includes canceled imports, conversion targets, retry, header controls, passwords,
source ownership, file switching, concurrent tabs, PDF pixels and stylesheet cleanup.
The existing 18 DSH tool/attachment checks belong to the unchanged CLI transport.

That snapshot's Desktop comparison includes **9 PDF rounds** and **4 complete Office
rounds**, with 204 matched opens plus 8 retained baseline-only opens. PDF
first / cached medians are **214 / 159 ms**, versus **646 / 411 ms** for public 0.1.2
and **324 / 110 ms** built in. Initial JS requests shrink from **3.04 MiB to 345 KiB**;
TXT opening requests shrink from **3.09 MiB to 449 KiB**, excluding document bytes.
[Raw timings and limits](../../docs/assets/dsh-plugin/README.md#load-formats-on-demand)
· [Snapshot validation](../../docs/dsh-format-loading-validation.json).

The earlier direct-DOM benchmark/report is retained as a historical source snapshot.
The installation recording uses 0.1.3; the performance tables retain their original implementation stages.

## 0.1.2 release checks

The 0.1.2 adapter registers **450 extensions** and uses CLI **0.5.5** with preview **0.3.4**. Publication and exact package integrity are recorded in the repository publication report. Its public CLI transport uses `op` and `forOp`; `operation` and `forOperation` are rejected. Document selection, per-call OCR policy, native-text completion, Office media inventory and image attachments are covered by the current tool checks.

On macOS arm64 with Node **24.22.1**, all **18 tool/request/image tests** and the compiled browser harness passed. Chromium rendered **12 formats** and passed the current model inspector, file switching, source ownership, message validation, password, theme/language, resize and cleanup checks. Shared workspace tests cover the real CLI/WASM separately.

These checks use the current compiled adapter and shared runtime. The profile observations in the previous-release section below belong to **0.1.0**. Exact package hashes and current results are in [the current validation report](../../docs/dsh-plugin-validation.json).

### Desktop 0.1.2 recording and Office timing

On **2026-11-05**, public npm **dsh-filens@0.1.2** was installed through the actual **Desktop 0.2.1-rc.5** plugin UI in an isolated macOS arm64 home, using the **default China mainland mirror**, then enabled with **Enable now**. The installed CLI is **0.5.5**, preview **0.3.4**, with **450 extensions**; the preview runtime SHA-256 matches the published package. Both Tools and Preview ran. The recording covers DOCX, XLSX worksheet switching, PPTX fullscreen, Page Down through three slides and Esc back to DSH. No account or model call was used. See the [25 fps WebP/GIF, full MP4 and evidence](../../docs/assets/dsh-plugin/README.md).

The 9-round benchmark compares installed **0.1.1**, installed **0.1.2** and DSH's actual built-in Office-to-PDF/PDF-canvas path, rotating renderer order and starting a fresh process per renderer/round. The **216 actual opens** give PPTX / DOCX first-open medians of **540 / 294 ms** for 0.1.2, **356 / 245 ms** for 0.1.1 and **1,828 / 1,812 ms** built in. Cached medians and every sample are in the [raw report](../../docs/assets/dsh-plugin/office-preview-benchmark.json). First means first in a process, with OS/persistent caches retained; it is not a cold-disk or fidelity comparison. Encoding ran separately.

The separate **9-round PDF benchmark** covers **108 additional opens**, with PDF first in each fresh process. First / cached medians are **684 / 443 ms** for 0.1.2, **1,623 / 1,408 ms** for 0.1.1 and **328 / 111 ms** built in. The built-in path directly previews PDF. [Raw PDF timing and ranges](../../docs/assets/dsh-plugin/pdf-preview-benchmark.json). Office and PDF total **324 opens**.

That release originally used a historical 0.1.1 gallery. The current [3D/360° recording](../../docs/assets/dsh-plugin/README.md#3d-and-360-gallery) has been replaced by a separately labeled source-build recording.

## Previous release: 0.1.0

Date: **2026-11-04**. Release validation for `dsh-filens@0.1.0`, CLI **0.5.2** and preview **0.3.2**. All release npm packages are publicly available with verified integrity. Publication status and exact registry hashes are recorded in the repository publication reports. The release checks used no community post, model prompt or DSH account; a later source-only model trial is recorded separately below.

## Environments

| Environment | Result |
| --- | --- |
| Installed `/Applications/DeepSeek Harness.app`, **0.2.1-rc.5**, macOS arm64 | Real Desktop sidebar and packaged CLI/Host tested in an isolated `DSH_HOME`. |
| Same installed runtime, **0.2.1-rc.5**, Web profile | Real Loader, module graph, HTTP routes, tools and independent lifecycle tested. |
| npm `@deepseek-ai/dsh@0.2.2-alpha.3`, Node **24.11.0**, Web profile | Same profile checks tested against the newer API. |
| Chromium, Playwright **1.59.1**, React **18.3.1** | Compiled adapter, iframe, shared-source preview runtime (version **0.3.2**), file switching and cleanup tested. |

Release artifact: universal `dsh-filens@0.1.0`, depending on `filens-cli@0.5.2` and its matching byte-input RapidOCR platform libraries/models. Preview is built from the shared frontend workspace at version `0.3.2`. The plugin ships no duplicate CLI binary; npm selects its platform dependencies. The original validation report remains available in the v0.6.2 source tag. The client registers 397 extensions from the shared FiLens manifest. This count is **not** 397 independently validated formats.

The public package was installed with `dsh plugin --profile filens-test add dsh-filens@0.1.0` in the installed rc.5 runtime's isolated Web profile, without dependency overrides. All 13 integration checks passed, including the five tools, OCR, conversion, preview routing and independent lifecycle. Installed CLI/OCR/preview bytes match the exact published tarballs. pnpm 11.28.5 automatically recorded exact new versions in `minimumReleaseAgeExclude` during the ordinary add operation; no manual policy bypass was used.

## Checks

| Area | Evidence |
| --- | --- |
| Tools | All five tools execute through DSH's real tool pipeline: capacity, read, search, excerpt, convert. |
| Extraction | PDF, DOCX, XLSX and PPTX; original text and response envelopes retained. |
| OCR | Real two-page scanned PDF, checking `FILENS2026` and `BRIGHT2027` in source order; layout request enabled. |
| Conversion | CSV→XLSX using the existing WASM core; output ZIP signature checked. Existing output refused and bytes unchanged. |
| Input handling | Chinese path containing quotes and shell substitution syntax remains literal; no injected command runs. Session cwd and environment delegation checked. |
| Partial/error results | Missing file, CLI exit 3 with truncation, invalid/truncated JSON and runner failure handling checked. |
| Cancellation | Actual subprocess deadline, caller abort and plugin unload terminate the wait/process. |
| Permissions | Policy forwarding, invalid escalation pairs and rejected approval checked. Real rc.5 and alpha.3 `read-only` sandboxes allow capacity, reads, scanned-PDF OCR, excerpts and search; final conversion output is denied and absent. |
| Host lifecycle | Either entry can be disabled/re-enabled independently; Tools unregisters while Preview stays live; Preview removes route and client graph row while Tools stays live. Re-enablement has no duplicate registrations. |
| Removal | Removed with the real CLI from rc.5 Web/Desktop and alpha.3 test profiles. Fresh Web boots have no FiLens tools, client row or runtime route. |
| Static resources | Real DSH prefix route, HTTP GET/HEAD, MIME/length/CSP, missing resource, traversal and unsupported method checks. Document paths cannot be requested through this route. |
| Browser | TXT, PDF, DOCX, XLSX, PPTX, Pages, Numbers, Keynote, STEP, DNG, ZIP and RAR render. Archive WASM/worker are included. Parent input buffer stays attached; spoofed messages ignored; source switching and unload checked. |
| Preview interaction | Full-height narrow and short panes, keyboard page navigation/fullscreen, live DSH theme/language without source reload, stale-result rejection, localized failure/retry, password entry, Word width fitting and reading position after resize, reduced-motion loading, and direct 3D orbit/zoom without a top toolbar. 3D framing leaves visible margins at 240×600; double-click restores orbit and zoom. |
| Shared 3D core | 326 tests across 10 files; portrait/landscape camera fitting, resize preserving zoom/orbit, initial scale and double-click reset covered. Package build passed. |
| Installed Desktop | Through the real Session file service, open DOCX, Keynote, STEP and ZIP in DSH's document sidebar. Screenshots retained; no page errors. |

Two compatibility defects found by integration testing were fixed: rc.5 only supports the Node HTTP handler contract, and DSH prefix registrations must omit a trailing slash. iWork's published Emscripten glue also requires `unsafe-eval` in the viewer CSP. Web URLs preserve a reverse-proxy mount prefix when constructing the viewer URL; a full proxy deployment was not tested.

The default memory workspace passes positive tool checks in `workspace-write` and `read-only`. The sandbox still denies the final output commit in `read-only`, after successful WASM conversion. Preview reads through DSH's separate file service.

Workspace regression checks: 22 Rust unit tests, 8 CLI end-to-end groups, 19 conversion checks, 46 search checks, 53 archive/OCR checks, 27 similarity checks, 7 plugin test groups, and 23 workspace checks with each of the native FTS and WASI directory walkers. The workspace checks cover default memory under a write-denied sandbox, explicit disk execution, mode selection by flags/JSON, parallel workers and disk cleanup after a deadline. The latter include four parallel WASI extraction workers and nested archive-member OCR. The WASI walker was exercised on macOS using `hdrw-wasi`; this does not replace native Windows/Linux validation. Desktop DOCX, Keynote, STEP and ZIP checks were repeated with the current bundle.

The CLI defaults to `--workspace memory`; `--workspace disk` or the JSON field selects disk scratch explicitly. Both modes invoke the same WASM core. Disk scratch cleanup is supervised on completion and cancellation, and read-only rejects disk mode without fallback. There is one plugin package with ordinary versioning. The embedded hdrw walker uses stdin/stdout with 1 MiB input and 16 MiB output limits, and no `/work` mount. Its embedded-module test covers Unicode filenames, one JSON response, invalid input and input/output limits.

Memory workspace file bytes share a request-wide 512 MiB quota, including unlinked files still held open by WASI. Filesystem operations reject traversal, invalid paths, overflowing sparse writes and quota overflow. WASM linear memory and native OCR memory are separate allocations. The implementation never spills scratch files to disk; operating-system swapping is outside its control.

## Source additions after 0.1.0

These source changes are **not published** in `dsh-filens@0.1.0` / CLI `0.5.2`. They require a CLI and text WASM built from the same current source; the tools' `command` override was used for validation. No published npm payload or normal DSH profile was modified.

- **18 DSH/render/attachment test groups** pass on macOS arm64, Node 24, through the actual DSH alpha.3 tools/shell services: compact/filtered capability discovery, OCR controls and provenance, PDF page selection, read/search/excerpt, conversion/no overwrite, duplicate files, similar images, cwd/env, cancellation and sandbox/error mapping. Public CLI 0.5.2 OCR library/models were reused with the new CLI/WASM; OCR provider diagnostics carry detector scores, not recognition probabilities.
- A generated ordered three-slide OpenXML fixture includes native text around an embedded scan, a blank slide and an unreferenced media item. The CLI regression script covers page/shape/source metadata, original presentation relationship order, range validation, whole-package media usage/dimensions/hash, OCR score filtering, whole-sentence excerpts, conversion alternatives and two-page scanned PDF selection. Run `npm run test:agent:inspection` after building the CLI.
- Current-source regression results: **147 core unit tests (passing in both core/text binaries)**, **27 CLI unit tests**, **21 document inspection groups**, **44 search checks**, **53 archive/OCR checks**, **18 excerpt groups**, and **19 conversion checks** passed. Native and WASM search outputs agree after provenance normalization. `git diff --check` is clean.
- The shared core owns XML/ZIP/image metadata parsing, selection, OCR policy and excerpt provenance. CLI and DSH only validate/forward requests and map results. Global OCR disable cannot be overridden per call.

The earlier boolean per-call control passed 9 groups against the exact CLI/OCR 0.5.2 npm payloads before this wider change. The current string policy and inspection fields need the new source CLI. That earlier source snapshot limited the sidebar toolbar to zoom out/in and fullscreen; the current header-controls implementation restores every supported control in the address-bar action slot. The browser suite passes all 12 existing format cases and interaction checks, including actual zoom, keyboard navigation/fullscreen, toolbar absence for 3D, direct orbit/zoom/reset, Word resizing, passwords, retry and lifecycle. The full released Desktop checks remain separate evidence above.

The source 3D inspector now uses one floating panel, collapsed by default, with View / Structure / Tools tabs and disclosures for advanced settings. The canvas dimensions stay unchanged when it opens. The built DSH browser suite also verifies the inspector in 420px dark and 240px panes, working zoom/fullscreen, keyboard tabs, structure search, section controls, Escape and focus restoration. Evidence: `artifacts/browser/report.json` and `artifacts/browser/model-tools-narrow-dark.png` (zero browser errors or failed requests). The Vue build/type declarations and 43 Vue/localization tests pass; seven demo browser cases cover all eight bundled models, narrow layouts, structure visibility, measurement/section controls, orbit and native touch gestures. These UI changes remain source-only.

## Compact model output and capacity conditions (source)

Capacity supports composable `from` / `to` / `operation` / `query`, plus section selection. CLI equivalents are `--from`, `--to`, `--op`, `--query`, `--section`. Directional queries accept `docx>?`, `?>pdf` and exact `docx>pdf`, through the CLI positional query, `--query` or JSON `query`. Defaults return cross-format pairs only; the three same-format pairs (DOCX, XLSX, PPTX) are excluded from lists and counts (306 → 303). Target-filtered format lists contain only sources of matching pairs. Conflicting explicit filters and malformed directions are rejected. Compact conversion lists use `source>target,target;source>target` on one line; full JSON and real TSV/CSV remain available. Keyword matching is case-insensitive substring AND; exact operation filters also resolve declared aliases. An exact format plus operation (`pptx read`, either order/case) resolves to the corresponding `from` / `operation` filters, with remaining words kept as AND terms. Empty results stay explicit. `npm run test:agent:capacity` passes **33 real CLI checks** for conditions, stdin and genuine TSV/CSV rows.

DSH's canonical values retain the full structured response. The default model rendering uses signatures, a single semicolon-separated conversion string, KV and JSON-cell TSV, emitting original document text once. Search removes duplicate display text, routine execution diagnostics and the repeated extension list (a count remains). Errors, warnings, false/zero completion flags, Unicode text, byte locations and OCR origins remain available; `detail: "full"` returns canonical JSON. `filens_capacity` additionally accepts `full: true` to retrieve the entire catalog.

Earlier compact-output trial: measured UTF-8 bytes on the same real CLI responses, comparing the previous indented model rendering with the compact projection:

| Case | Indented JSON | Minified JSON | Compact |
| --- | ---: | ---: | ---: |
| Default capacity | 5,294 | 2,480 | 1,139 |
| Read operation only | 717 | 386 | 133 |
| All conversion pairs | 26,720 | 13,938 | 2,946 |
| Native text from sample PPTX | 11,057 | 6,243 | 3,366 |
| Two-file search sample | 10,590 | 5,225 | 1,543 |

These are byte counts, not tokenizer measurements. The PPTX read used `ocr=never`; its omission warnings and media/provenance were retained. DSH defaults are now 5 search files, 20 duplicate/similar-image groups and 2000 excerpt characters; callers can raise the existing result/character parameters. CLI defaults remain unchanged. The DSH/render groups include lossless UTF-8 block reconstruction, delimiter escaping, warnings before display truncation, complete JSON access and smaller default budgets.

## Initial real model trial (source, 2026-11-04)

An authorized model trial used `deepseek-account` / `deepseek-flash` in an isolated alpha.3 headless profile, with the source plugin and newly built CLI/WASM. Network transport retries required continuing the same Session with the machine's configured proxy. User profiles were unchanged and the temporary credential copy was deleted.

The model inspected `filens-field-notes.pptx`: 19 native text blocks, three referenced JPEGs, and an unreferenced PNG. It extracted media using `bash` and opened three actual image attachments through DSH `read_image`; committed attachment hashes, bytes and dimensions match the originals. Its descriptions of two aurora photographs and an orange nebula/star field were checked against the pixels independently. The unreferenced PNG failed image decoding, and the model did not invent its content.

At the time of this initial trial, the visual integration gap was direct image delivery: FiLens provides inventory/provenance, but the model must unpack media to view pixels. Other observed limitations are the `ocr=never` partial/error status, lack of a per-media decode warning for the bad PNG, and OCR discard warnings without per-image localization. These were reported, not claimed fixed in this trial.

The model explicitly requested all three capacity sections and `detail=full` for its first read; its long-output complaint therefore does not measure the compact defaults. Its claim that no conversion pairs were registered was incorrect. Its valid observation that target-filtered `formats` included unrelated entries was fixed, along with excluding same-format pairs from capability discovery and unsupported-conversion alternatives. The complete conversation and an audited Chinese report are retained locally under `tmp/dsh-vision-*`; they are not included in npm artifacts.

## Intent acceptance: direct visual reading (source, 2026-11-04)

A fresh authorized `deepseek-account` / `deepseek-flash` conversation used the source plugin with the rebuilt CLI/text WASM in an isolated alpha.3 headless profile. The prompt only asked to use FiLens to describe the sample PPTX pictures page by page, list native titles, separate extracted text from visual observation, and report usability. It specified no tool names, flags or argument values. The normal DSH profile was unchanged; the temporary credential copy was removed after completion.

The final trace contains exactly two tool calls, both `filens_read`, both **exit 0 / ok true / complete true**:

1. `images: true, max_images: 16, detail: "full"`: all 19 native text blocks and three actual image attachments returned together.
2. `layout: true, images: false, detail: "full"`: additional structure inspection before answering.

There were **zero failed calls, retries, shell/Python calls, extraction commands, alternative image readers or conversion attempts**. The second call was a successful optional structure read. The model requested full JSON itself; this trace does not measure compact defaults. It described the aurora coastline on slides 1–2 and the orange/brown nebula below a blue star field on slide 3, and correctly distinguished the embedded images from rendered slide layout. It used explicit font sizes to identify native headings and disclosed the absence of title placeholders. Its feedback was "整体顺畅"; it noted that embedded images do not show full-page layout and that an unreferenced bad PNG remains in the inventory. This is evidence for this fixture and model route, not a guarantee that all documents or all model choices succeed.

The committed DSH Session contains three genuine image blocks. Attachment hashes, dimensions and bytes match the referenced originals:

| Image | Pixels | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `aurora-portrait.jpg` | 960×900 | 141,744 | `abdb5977e38902ea5bb5fff2a5f26b2b3c4e56acb63099de62019a37a97be2cf` |
| `aurora.jpg` | 1600×900 | 227,990 | `3cd76f2089384f71a8f7231f524ed1c4260bf5b5a7f989f2fe006a6388a95d8c` |
| `nebula.jpg` | 900×900 | 279,005 | `e929cc6004863d619bdcf04e1e61cc6aa87e70a98b94f18337041ffaca56c6b6` |

The earlier trial's actionable gaps are now addressed in source:

- `filens_read({images:true})` selects/decodes Office media in the shared WASM and sends DSH attachments, with selection, limits and explicit failures. Base64 is never retained in model text or canonical history.
- OpenXML Office paths default to native-only OCR policy in DSH. Explicit `auto` still recognizes embedded text; PDF/scans keep automatic OCR. Intentional native-only scope succeeds and remains labeled; real OCR failures/low-confidence omissions remain partial.
- OCR audit results locate each attempt by page, shape and media. Unreadable unused raster headers warn without failing native text. Explicitly selecting a corrupt image returns partial failure rather than invented content.
- PPTX native blocks include shape names, explicit placeholder types and maximum explicitly declared font sizes. They do not claim inferred semantic titles or inherited styling.
- `capacity {query:"pptx read"}` resolves the exact format and operation instead of returning empty metadata matches.

The image integration tests exercise a real DSH local attachment store, real CLI/WASM selection, single-slide reads, payload omission from history, count limits, corrupt/unknown image names, model-route gating and storage failure. The final source preview build registers 400 extensions from the current shared manifest; only the listed browser fixtures were rendered. Local trial artifacts are retained under ignored `tmp/dsh-visual-v4-*`; they are not shipped in npm.

## Reproduce

From the monorepo, using Node >=24.9:

```sh
npm --prefix integrations/deepseek-harness ci
npm run build:agent
npm run test:agent:workspace
npm run build:dsh
FILENS_TEST_COMMAND='["/absolute/path/filens/dist/filens"]' npm run test:dsh
cd integrations/deepseek-harness
npx playwright install chromium
npm run test:browser
mkdir -p artifacts
npm run pack:local
```

Use a fresh tarball filename for each changed build: pnpm can retain a cached `file:` dependency when its pathname is reused.

With the corresponding DSH CLI, initialize/install a dedicated Web test profile:

```sh
export DSH_HOME=/tmp/filens-dsh-test
dsh filens-test --from-default-profile web --dump-config > /tmp/filens-dsh-test-config.yml
dsh plugin --profile filens-test add /absolute/path/dsh-filens-0.1.0-HASH.tgz
npm run test:integration
DSH_PERMISSION_MODE=read-only DSH_TEST_READ_ONLY=1 npm run test:integration
```

`test:integration` uses the development npm runtime by default. To target the installed macOS app's packaged rc.5 runtime, use its bundled Node/ASAR support:

```sh
ELECTRON_RUN_AS_NODE=1 \
DSH_RUNTIME_MODULES='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules' \
'/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
  --expose-internals test/integration.mjs
```

For the actual Desktop checks, initialize an **isolated** Desktop home by launching that app with `DSH_HOME` and a separate `--user-data-dir`, quit the test instance, install with its bundled `dsh plugin --profile desktop add …`, then:

```sh
DSH_TEST_HOME=/tmp/filens-dsh-test npm run test:desktop
```

`DSH_DESKTOP_EXECUTABLE` can override the app binary. The desktop test instruments only its browser loader to capture the real client context for navigation; the delivered plugin package is unchanged. Tests save JSON reports, screenshots and browser video under ignored `artifacts/`. A shareable desktop STEP screenshot is in the repository at `docs/assets/dsh-plugin/desktop-step.jpg`.

After quitting the test instance, remove through the same CLI/profile and confirm `dsh-filens` is absent from the dependency/bundle list and composed config:

```sh
dsh plugin --profile filens-test remove dsh-filens
dsh filens-test --dump-config
DSH_TEST_REMOVED=1 npm run test:integration
```

## Scope and limits

- A real model choosing the tools during a conversation was **not tested**. Calls were dispatched directly through DSH's real tools service.
- Linux, Windows, remote/container execution, PowerShell-only profiles and a full reverse-proxy deployment were not tested. Native package platform support is inherited from the CLI.
- Browser codecs, fonts, encrypted document variants and all 397 extensions were not exhaustively checked. The RAR sample exercises archive rendering; it is not a complete password/decryption matrix.
- DSH hands this integration a single selected file. Multipart archives needing companion files are not validated here.
- Local parsing does not prevent tool text from entering DSH's configured model provider.
- Revenue sharing, marketplace endorsement and commercial eligibility remain unverified.
