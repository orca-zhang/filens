# DSH integration validation

## 0.1.1 release checks

The 0.1.1 adapter registers **402 extensions** and uses CLI **0.5.4** with preview **0.3.3**. Its public CLI transport uses `op` and `forOp`; `operation` and `forOperation` are rejected. Document selection, per-call OCR policy, native-text completion, Office media inventory and image attachments are covered by the current tool checks.

On macOS arm64 with Node **24.22.2**, all **18 tool/request/image tests** and the compiled browser harness passed. Chromium rendered **12 formats** and passed the current model inspector, file switching, source ownership, message validation, password, theme/language, resize and cleanup checks. Shared workspace tests cover the real CLI/WASM separately.

These checks use the current compiled adapter and shared runtime. The real Desktop and Web profile observations below belong to **0.1.0**; they were not repeated for 0.1.1. They do not establish a new physical Desktop or model-conversation result. Exact package hashes and current results are in [the current validation report](../../docs/dsh-plugin-validation.json).

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

The earlier boolean per-call control passed 9 groups against the exact CLI/OCR 0.5.2 npm payloads before this wider change. The current string policy and inspection fields need the new source CLI. The source sidebar toolbar now contains only zoom out/in and fullscreen where supported; fit, rotate and page buttons are removed. The browser suite passes all 12 existing format cases and interaction checks, including actual zoom, keyboard navigation/fullscreen, toolbar absence for 3D, direct orbit/zoom/reset, Word resizing, passwords, retry and lifecycle. The full released Desktop checks remain separate evidence above.

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
