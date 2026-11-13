# FiLens for DeepSeek Harness

[中文](README.zh-CN.md)

`dsh-filens` integrates natively with DSH's document sidebar, providing **local previews for 450 file formats** and three independently switchable plugins:

| Entry | What it does |
| --- | --- |
| `filens-tools` (`dsh-filens/tools`) | Agent tools for local document reading, OCR, search, original excerpts and conversion. |
| `filens-workspace` (built into `dsh-filens`) | Full-page session file collection, previews, related files and navigation to the original message or question. |
| `filens-preview` (`dsh-filens`) | Native sidebar previews for Office, PDF, iWork, CAD/3D, RAW and 360° media, with Excel worksheet switching and fullscreen PPT presentations. |

Native sidebar previews embed directly in DSH's existing file preview pane. FiLens parses and renders locally, with no separate preview service. DOCX/PPTX render directly without a LibreOffice-to-PDF step; 3D and 360° media retain orbit, zoom, look-around and playback interactions.

**New in 0.1.7:** a third, independently switchable **File workspace** plugin adds a full-page file gallery and reading canvas. It gathers supported local file references and attachments from paginated session history, retains each source occurrence, and links back to its message or question. Local file selection, drag-and-drop, thumbnails, filters and search reuse the sidebar's preview core. Use **Refresh session files** to rescan. Browser-selected files must be reopened after a reload; deleted or inaccessible source files cannot be previewed. Developer information appears in the bottom corner. The reader’s **Related files** section lists up to six files by shared message, question, folder or session, explains each relationship, and opens the file on click. Recommendations use existing references only. Collapsed sessions use group cards aligned with the file grid with up to four real file thumbnails with type-cover fallbacks. Files without thumbnails use folded-page type covers. Session labels use short human-readable titles with the full title on hover. Temporary session artifacts are hidden by default with a reveal button; useful results in OS temporary directories and explicitly selected local files remain visible. The reader file list is 144–160px wide. The file details card follows ZimaOS Photos with a fixed filename header, scrolling sections, three-column related-file thumbnails and a bottom sheet in narrow windows. Sizes use actual bytes after reading; session reference dates are labeled separately from local modification dates. [Actual DSH screenshots, validation scope and reproduction](../../docs/assets/dsh-workspace/README.md).

The **`dsh-filens@0.1.10` supports 450 source-file extensions** (451 route entries including internal `cad-json`). Counts use unique extensions and include direct previews and previews after local WASM conversion. Source builds use the current shared manifest; their exact count is in the build's `lib/support.json`. See the [support matrix](../../docs/support-matrix.md) and [validation record](VALIDATION.md) for format coverage and fidelity limits.

**0.1.10:** preview watermarks and the File workspace footer now display only `FiLens`. Session scans check paths and stored attachments through DSH metadata. Confirmed missing files are omitted from cards, counts, navigation and related files. Refresh rechecks existence; a file deleted after scanning is removed when opening detects its absence. Permission and connection failures remain visible. This check does not read or parse complete files.

The adapter uses `filens-cli@0.5.7` and shared preview 0.3.7. It adds no parsing or conversion algorithms.

Tested on macOS arm64 with DSH **Desktop/Web 0.2.1-rc.5**, **Web 0.2.2-alpha.3**, **Desktop/Web 0.2.2-rc.1** and Node 24. Other DSH versions remain unverified.

**English recordings for 0.1.10:** refreshed in DSH Desktop 0.2.2-rc.1 with English captions and synthetic sessions, using a build matching the published package. [Release notes and recording provenance](../../docs/releases/dsh-filens-0.1.8/README.md).

![Word and Excel previews, and a fullscreen PPT presentation in English DSH](../../docs/assets/dsh-release/office-preview.en.gif?v=branding-20261114)

Open Office files in DSH's file sidebar to use FiLens. Switch Excel worksheets inside the preview. For PPT, click **Fullscreen**, click the slide to focus, use **Page Down / Page Up** to present, and press **Esc** to return. DOCX/PPTX render directly without LibreOffice-to-PDF conversion.

| Sample · first / cached median (ms) | FiLens 0.1.3 | DSH built in | First-open speedup |
| --- | ---: | ---: | ---: |
| PPTX | **135 / 81** | 1830 / 124 | **13.56×** |
| DOCX | **111 / 94** | 1827 / 112 | **16.46×** |
| PDF | **190 / 77** | 329 / 110 | **1.73×** |

Nine paired rounds on one macOS machine. Speedup = matched built-in median ÷ FiLens median; ratios describe **first opens**. First means the first opening of that file per process; system/persistent caches remain. Built-in Office converts to PDF; FiLens renders directly. [Ranges and method](../../docs/assets/dsh-plugin/performance-retest.zh-CN.md) · [New demo MP4](../../docs/assets/dsh-release/office-preview.en.mp4?v=branding-20261114) · [New demo GIF](../../docs/assets/dsh-release/office-preview.en.gif?v=branding-20261114).

PDF uses a separate nine-round paired run after first-page pixel reuse: cached opens are **1.43×** faster than built in (**110 → 77 ms**, **30.0%** less time). The 689,455-byte sample still loads and validates on every open; closing releases the worker. [PDF samples, ranges and method](../../docs/assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md).

The workloads below time complete parser calls on identical inputs, **excluding UI rendering**; these are separate from sidebar latency. Engines alternate over two warmups and nine measured rounds. Every cell value or complete entry text is verified. Small examples and low-gain cases are omitted from the featured tables.

| Larger parsing workload | Baseline | Baseline / FiLens median (ms) | Speedup |
| --- | --- | ---: | ---: |
| XLSX · 2,000 × 64, 128,000 cells | SheetJS CE 0.20.3 | 150.94 / **61.72** | **2.45×** |
| XLSX · 8,000 × 64, 512,000 cells | SheetJS CE 0.20.3 | 615.71 / **213.50** | **2.88×** |
| ZIP · 10,000 entries, 18.34 MiB expanded | JSZip 3.10.1 | 700.55 / **55.52** | **12.62×** |
| ZIP · 2,500 entries, 36.23 MiB expanded | JSZip 3.10.1 | 247.99 / **95.37** | **2.60×** |

Library feature/fidelity scopes differ; these ratios are not an overall ranking across files. [Raw samples and reproduction](../../docs/featured-performance.md).

**DSH 0.1.6:** the address bar contains zoom out, the compact 4-character zoom percentage, zoom in and fullscreen for every preview type. The 3D inspector and CAD layers retain compact entries; worksheet, archive and attachment controls are grouped in a Tools menu. Audio/video playback and progress remain below the player. Page, rotation and manual Fit / Width / Height buttons are omitted; keyboard slide navigation remains available. The matching driver loads on first use; modules and WASM are reused. Initial JS requests total **351.5 KiB**; TXT first-open runtime requests total **456.8 KiB**, excluding document bytes and DSH. [0.1.6 runtime measurements](../../docs/assets/dsh-plugin/format-loading-current.json). The historical installation recording uses public 0.1.3, and the historical 3D/360° gallery uses public 0.1.6. The single-language recordings above use FiLens DSH 0.1.10, preview 0.3.7 and CLI 0.5.7. PDF reopens reuse validated first-page pixels, bounded to four pages / 16 MiB / 30 idle seconds; each open still loads and validates its document, and closing releases the worker. Password opens and printing bypass reuse. [PDF timings and limits](../../docs/assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md).

Version 0.1.3 also reuses parsed XLSX/iWork models and STEP CPU meshes within a shared four-entry / 64 MiB estimated model budget / 30-second idle lifetime. [Complete measurements, costs and limits](../../docs/assets/dsh-plugin/model-reopen-optimization.zh-CN.md).

![Orbit GLB and 3MF models, explore a spherical photo and play a 360-degree video in English DSH](../../docs/assets/dsh-release/3d-and-panorama.en.gif?v=branding-20261114)

![File workspace: session file groups, related files and the originating question](../../docs/assets/dsh-release/file-workspace.en.gif?v=branding-20261114)

The same sidebar supports interactive 3D models and 360° media. Drag to orbit or look around; scroll to zoom. For spherical JPEG/video samples, use `.pano` / `.360v` filenames, preserving the original bytes; ordinary `.jpg` / `.webm` use the normal image/video view. [Gallery MP4, sources and recording details](../../docs/assets/dsh-plugin/README.md#3d-and-360-gallery).

<!-- dsh-package-metrics:start -->
Adapter 0.1.10: **5.81 MiB** download / **17.58 MiB** unpacked, including the built-in workspace. CLI/OCR, DSH dependencies and caches are separate. [Exact package receipt](../../docs/dsh-plugin-package.json).
<!-- dsh-package-metrics:end -->

The 0.1.6 header controls and packaged runtime are covered by [the validation receipt](../../docs/dsh-compact-controls-validation.json). Sidebar latency tables retain their measured 0.1.3 snapshot.

**One installation:** File workspace ships inside `dsh-filens`; it retains its own switch alongside Preview and Tools. No separate workspace package is needed. Version 0.1.10 updates the DSH and peer compatibility declarations for RC.1/Cordis 4.1.

## Install and build

Install [`dsh-filens@0.1.10`](https://www.npmjs.com/package/dsh-filens) directly from Desktop:

1. Open **Plugins** and click **Add plugin**.
2. Enter `dsh-filens`, or `dsh-filens@0.1.10` to pin the version, and click **Install**.
3. When installation completes, click **Enable now**. The bundle provides separate FiLens Tools, FiLens Preview and File workspace entries that can be enabled independently; the recorded Desktop version enables them immediately.

Keep the default installation source; no registry change is needed.

The CLI also installs into a specific profile. Fully quit Desktop before managing its profile from the CLI, then reopen it after installation:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.10
# For a Web profile:
dsh plugin --profile web add dsh-filens@0.1.10
```

The plugin includes its client, preview WASM, archive worker and notices. npm platform dependencies supply CLI/OCR binaries and models; no compilation or separate model download is needed. Keep optional dependencies enabled. Platforms are macOS arm64, Linux x64/arm64 and Windows x64; native execution was verified on macOS arm64, with cross-built Linux/Windows artifacts.

To build from the repository with Node >=24.9:

```sh
npm ci
npm --prefix integrations/deepseek-harness ci
npm run package:dsh:npm
```

Artifacts and checksums are recorded in `dist/dsh-npm/release.json`. The build uses shared frontend source and ships one preview runtime. For a local offline CLI/OCR test bundle, run `npm run build:agent`, then `npm --prefix integrations/deepseek-harness run pack:local`; that build also needs Rust 1.93, Go and Xcode command-line tools. `pack:local` does not publish to npm.

For Web, use the DSH CLI matching the intended runtime:

```sh
dsh plugin --profile web add /absolute/path/dsh-filens-0.1.10.tgz
dsh web
```

For Desktop, open the app once to initialize its profile, fully quit it, then:

```sh
dsh plugin --profile desktop add /absolute/path/dsh-filens-0.1.10.tgz
```

If macOS reports `dsh: command not found`, use the Desktop UI above or invoke the app's bundled CLI directly:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-filens@0.1.10
```

Reopen Desktop after installation. The profile manager may print peer warnings because DSH supplies shared packages from its own runtime; startup and the checks below verify the actual shared instances.

Use an isolated home for testing, for example `DSH_HOME=/tmp/filens-dsh-test`; use the same value when launching and managing that test instance. For repeated local builds, use a fresh tarball filename: pnpm can retain the previous contents of an unchanged `file:` specifier.

## Use

Ask the agent to use these tools explicitly during a first test:

| Tool | Example arguments |
| --- | --- |
| `filens_capacity` | `{"op":"read"}`; `{}` returns operations, format/pair counts and OCR health |
| `filens_read` | `{"path":"report.pdf","layout":true}`; `{"path":"deck.pptx","images":true}` |
| `filens_search` | `{"path":"docs","query":"annual revenue","max_results":10}` |
| `filens_excerpt` | `{"path":"report.docx","query":"risks","max_chars":4000}` |
| `filens_convert` | `{"path":"data.csv","output":"data.xlsx"}` |
| `filens_duplicates` | `{"path":"./files"}` |
| `filens_similar_images` | `{"path":"./photos","threshold":8}` |

Paths resolve in the calling Session's execution environment and working directory. Document paths and queries travel over stdin as JSON, never inside shell syntax. Conversion refuses existing output files; discover supported pairs with `filens_capacity`. Excerpts select original passages, with the CLI's ranking and omission metadata.

Canonical results are `{ exit_code, response }`. Inspect `response.ok`, completeness, truncation, warnings and provenance. CLI exit **3** preserves partial results. Invalid JSON, sandbox runner errors, output overflow, timeout and cancellation become tool errors. The model view has a display limit; structured tool values retain the complete response. Request smaller results if the displayed text is clipped.

Open a file through DSH's Files tab or a file link. The existing viewer menu includes **FiLens** and applicable built-in alternatives. FiLens takes extension priority for its registered formats.

### Reduce image OCR noise

For Office files or PDFs with native text, ask the agent: "Read the native document text; skip OCR of illustrations, logos and decorative images. Do not treat recognition artifacts as source facts." Keep OCR enabled for scans, screenshots and illustrations whose text matters. Verify uncertain fragments against the source file or preview.

**Available in plugin 0.1.2 / CLI 0.5.5:** `filens_read`, `filens_search` and `filens_excerpt` accept a per-call `ocr` parameter:

```json
{"path":"report.docx","ocr":"never"}
```

Per-call `ocr` is `"auto"`, `"never"` or `"always"`; global `ocr: false` takes precedence. DSH defaults OpenXML Office paths to `never`, including named archive members; PDF, scans and other paths keep `auto`. Set `ocr: "auto"` explicitly when embedded image text matters. `never` retains native text and skips images/scans; `always` forces PDF page OCR. `ocr_min_confidence` defaults to 0.8; low/unscored lines are omitted with partial-result warnings. Scores are detector confidence, not recognition accuracy. OCR blocks are marked `source: "ocr"`; verify even high-scoring text.

Plugin **0.1.10** requires its matching CLI **0.5.7** and WASM. Version 0.1.0 / CLI 0.5.2 only supported the global `ocr: false` setting or `--no-ocr`; update the complete package together.

Plugin 0.1.2 treats intentional `ocr: "never"` as a successful native-text request: `textScope: "native-text"`, exit 0 and `complete: true` unless another failure/limit occurs. It still reports skipped image text. OCR-enabled scope is `"native-and-ocr"`; actual OCR errors and low-confidence omissions remain partial (exit 3). `content.ocr.results[]` locates each skipped/complete/partial/failed attempt by page, slide, shape and media where available. Published 0.1.0 / CLI 0.5.2 retain the earlier partial status for skipped OCR. Sidebar previews are unaffected.

`filens_capacity` accepts composable conditions: `{"op":"read"}`, `{"query":"pptx read"}`, `{"query":"docx>?"}`, `{"query":"?>pdf"}`, `{"query":"ocr","section":"formats"}`, `{"from":"pptx","to":"pdf"}`, plus `fields` and `full`. Defaults use short signatures and a single `source>target,target;source>target` string, returning only matching sections; same-format conversions are excluded from lists and counts. `filens_read` / `filens_excerpt` accept `slides: "1-3"`, PDF `pages: "2,4"`, and `media: false`; Office inventories cover the whole file. Excerpts retain whole sentences/paragraphs, returning short documents whole without a query. Similar-image detection supports resize/recompression, not arbitrary crop matching. See the [CLI contract](../../docs/agent-cli.md).

### See embedded Office pictures

For "describe the pictures in this deck and list its native titles", call `filens_read` directly:

```json
{"path":"deck.pptx","images":true}
```

One response contains cited native text and actual image attachments for an image-capable model. PPTX blocks also carry shape names, explicit placeholder types (`none` when absent) and `maxExplicitFontSizePt`; titles are not inferred, inherited font styles are not resolved. No capacity call, Python script or package extraction is needed for this task. Use `slides: "2,4"` to narrow the read. Attachments are embedded media, not rendered slides; slide cropping and overlaid text are not baked into them.

`max_images` defaults to 4, maximum 16; `image_names` selects exact names from the media inventory, including unused media. `imagesInfo` reports available/returned/remaining counts. Images are decoded, oriented/resized when needed to at most 1600 pixels, with an 8 MiB aggregate payload cap; deployment limits can be stricter. Limits and decoding/storage failures are explicit partial results. An unused bad image warns without failing native text extraction. DSH must provide an attachment store and the current model must declare image input. Transport base64 is removed from tool text/history; DSH manages the durable attachment bytes through its normal attachment store, separately from CLI memory scratch.

Tools default to compact model tables/KV; `{"detail":"full"}` returns complete JSON while canonical `{exit_code,response}` remains intact. Reads emit original text once with page/shape/OCR origins and scores. Search omits duplicate display text, counts the supported-extension list, and leaves routine execution diagnostics for full mode. Completeness, truncation, nonempty errors/warnings and citations remain; critical diagnostics precede long text. `detail` controls rendering; capacity `full: true` requests the entire capability catalog.

DSH defaults to 5 search files, 20 duplicate/similar-image groups, and 2000 excerpt characters. Increase `max_results` / `max_chars` when needed. Match counts, completeness and truncation remain visible. CLI defaults are unchanged.

## Configuration and independent enablement

In the profile's `cordis.patch.yml`:

```yaml
- id: filens-tools
  config:
    timeoutMs: 120000
    maxBytes: 131072
    displayChars: 60000
    ocr: true
    # Optional executable and fixed arguments, in the shell execution world:
    # command: [filens]
- id: filens-preview
  disabled: false
```

Either row can set `disabled: true`, including through DSH's plugin UI. A tools-only/headless profile should disable `filens-preview`; preview requires the Web/Desktop client and `webServer`. Unloading Tools unregisters its seven tools and cancels active calls. Unloading Preview removes its client registration, route and startup injection; unmounting a viewer releases its DOM controls and workers.

Default command: DSH Host's Node/Electron executable plus the packaged CLI launcher. For a remote shell/container, configure `command: [filens]` and install the matching CLI **inside that execution environment**. A Host installation path is not assumed to exist remotely. Execution requires DSH's Bash-compatible `shell` provider; a PowerShell-only composition is not supported. The default CLI prebuild supports macOS arm64, Linux x64/arm64 and Windows x64; platform coverage here is inherited, not independently tested.

The command uses `ctx.shell`, Session cwd, `shellEnv` and the resolved sandbox policy. Escalation uses DSH's approval service. The plugin does not grant filesystem permissions itself. OCR and native binaries are optional npm platform dependencies: do not install with `--omit=optional`. OCR models ship with the full CLI; normal reads do not download models. Check `filens_capacity` when OCR is unavailable; the `ocr: false` option disables it.

The current CLI keeps CLI input copies, options, results, PDF render images and OCR image transport in process memory. Search workers share a **512 MiB workspace file-data quota** with no disk fallback. This quota excludes WASM linear memory, OCR runtime memory and transport copies. Capacity, reads, OCR, search and excerpts pass DSH's strict `read-only` sandbox. Conversion finishes in memory, then requires permission to write the requested output using a sibling staging file and atomic commit. Preview uses DSH's file-read service. This does not control operating-system swapping.

Workspace selection is a runtime option:

```sh
filens read report.pdf --json                    # memory by default
filens read report.pdf --workspace disk --json   # disk scratch explicitly
filens read report.pdf --workspace memory --json # memory explicitly
```

stdin JSON also accepts `"workspace": "disk"`. Disk mode invokes the same WASM core and cleans scratch directories after completion or cancellation. A read-only sandbox rejects disk mode; neither mode silently switches backends. In DSH, fixed arguments can be supplied through the existing `command` option, for example `command: [filens, --workspace, disk]` when the CLI is installed in that shell's environment. The bundled default command needs no configuration.

The new CLI requires the matching OCR byte-input ABI. An old OCR library fails its health check with an explicit upgrade message. `pack:local` builds and bundles both components; replacing only an old npm executable is insufficient.

## Preview resources and data flow

The Host serves only enumerated, versioned library resources under `/_filens/<digest>/`. This static route has no document path parameter. DSH reads the selected document using its own Session file service. The **0.1.3 build** imports the shared split runtime once and mounts it directly into the sidebar DOM, passing a **copy** of the bytes so workers cannot detach DSH’s retained input. Version 0.1.6 places the shared viewer’s controls in the existing DSH header action slot, with a compact toolbar and dedicated tool menus. Version **0.1.2** used a viewer iframe; the installation recording above uses **0.1.3**.

The preview fills its pane and follows DSH's colors, fonts and language without reopening the document or resetting its page. Version 0.1.6 keeps **zoom out / percentage / zoom in / fullscreen** beside the address bar for every format. It omits page, rotation and manual Fit / Width / Height buttons. PPTX still uses Page Down / Page Up or arrow keys to navigate. Text, Word, archives and media receive shared view zoom/fullscreen where their driver has no native implementation. Worksheet, archive and attachment controls are grouped under **Tools**; audio/video playback, timeline, volume and speed remain below the player; CAD layers and the 3D inspector keep dedicated entries. Narrow headers scroll horizontally; keyboard focus brings controls into view. Fullscreen brings the controls into the fullscreen preview and restores them to the header on exit. Each tab keeps independent controls and releases them on close. Word pages fit the pane width and preserve reading position on resize. 3D files automatically frame the whole model, including in narrow panes. Drag to orbit, scroll to zoom and double-click to reset. The address-bar model-tools button opens a compact inspector below the header, collapsed by default, with View / Structure / Tools tabs. Model structure, materials, measurement, section and snapshot settings appear on demand without shrinking the canvas. Arrow keys switch tabs and Esc closes the inspector. Loading shows the filename, errors offer details and retry, and late messages from a previous file cannot replace the current state.

The runtime includes archive WASM and its worker. Content-hashed static assets allow cross-origin module/WASM reads for Desktop; this route still exposes no document data. The directly mounted runtime follows DSH’s application policy. Workers remain separate execution contexts, and format drivers retain their own document isolation where needed. Format behavior, password handling and limitations remain FiLens's existing ones. DSH supplies one selected file; multipart archives requiring companion volumes are not covered by this integration's validation. Native codecs and fonts still affect rendering.

FiLens parses locally. Text and requested image attachments returned to the agent can enter DSH's configured model provider; local parsing does not imply the model conversation stays on the device.

## Verification and removal

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
# After installing into a dedicated filens-test profile:
DSH_HOME=/tmp/filens-dsh-test npm run test:integration
# Optional: installed macOS desktop, with the test home initialized/installed:
DSH_TEST_HOME=/tmp/filens-dsh-test npm run test:desktop
```

Browser checks use the real compiled adapter and runtime. Profile checks use DSH's real Loader, tools pipeline, HTTP service and lifecycle. Desktop checks launch the installed app in an isolated home, navigate through its real Session file service and retain screenshots. They do not send a model prompt or use an account. Full reproduction details and tested limits are in [VALIDATION.md](VALIDATION.md).

Remove from the same profile, with Desktop fully quit when applicable:

```sh
dsh plugin --profile web remove dsh-filens
# or: dsh plugin --profile desktop remove dsh-filens
```

FiLens code is MIT. Shipped engines retain their own licenses; see `lib/runtime/THIRD-PARTY-NOTICES.txt`. The repository's [DSH feasibility notes](../../docs/dsh-plugin-feasibility.zh-CN.md) and [community proposal](../../docs/dsh-plugin-proposal.zh-CN.md) cover contribution channels. No revenue-sharing terms have been verified.
