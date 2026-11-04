# FiLens for DeepSeek Harness

[中文](README.zh-CN.md)

One `dsh-filens` bundle adds two independently switchable plugins:

| Entry | What it does |
| --- | --- |
| `filens-tools` (`dsh-filens/tools`) | Agent tools for local document reading, OCR, search, original excerpts and conversion. |
| `filens-preview` (`dsh-filens`) | FiLens renderer in the existing document sidebar, using the file bytes DSH loads. |

The adapter reuses `filens-cli@0.5.4` and builds the `filens-preview@0.3.3` runtime from the shared frontend source. It adds no parsing or conversion algorithms. Registered extensions come from FiLens's shared support manifest: **402**, including conversion-assisted previews. Registration does not guarantee fidelity for every file. See the [support matrix](../../docs/support-matrix.md) and [validation record](VALIDATION.md).

Tested on macOS arm64 with DSH **Desktop/Web 0.2.1-rc.5**, **Web 0.2.2-alpha.3** and Node 24. Other DSH versions remain unverified.

## Install and build

Install [`dsh-filens@0.1.1`](https://www.npmjs.com/package/dsh-filens) directly from Desktop:

1. Open **Plugins** and click **Add plugin**.
2. Enter `dsh-filens`, or `dsh-filens@0.1.1` to pin the version, and click **Install**.
3. Follow the installation prompts and restart DSH. The bundle provides separate FiLens Tools and FiLens Preview entries that can be enabled independently.

If the China mainland mirror reports a missing package or version, switch the installation source to the official npm registry and retry.

The CLI also installs into a specific profile. Fully quit Desktop before managing its profile from the CLI, then reopen it after installation:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.1
# For a Web profile:
dsh plugin --profile web add dsh-filens@0.1.1
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
dsh plugin --profile web add /absolute/path/dsh-filens-0.1.1.tgz
dsh web
```

For Desktop, open the app once to initialize its profile, fully quit it, then:

```sh
dsh plugin --profile desktop add /absolute/path/dsh-filens-0.1.1.tgz
```

If macOS reports `dsh: command not found`, use the Desktop UI above or invoke the app's bundled CLI directly:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add dsh-filens@0.1.1
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

**Available in plugin 0.1.1 / CLI 0.5.4:** `filens_read`, `filens_search` and `filens_excerpt` accept a per-call `ocr` parameter:

```json
{"path":"report.docx","ocr":"never"}
```

Per-call `ocr` is `"auto"`, `"never"` or `"always"`; global `ocr: false` takes precedence. DSH defaults OpenXML Office paths to `never`, including named archive members; PDF, scans and other paths keep `auto`. Set `ocr: "auto"` explicitly when embedded image text matters. `never` retains native text and skips images/scans; `always` forces PDF page OCR. `ocr_min_confidence` defaults to 0.8; low/unscored lines are omitted with partial-result warnings. Scores are detector confidence, not recognition accuracy. OCR blocks are marked `source: "ocr"`; verify even high-scoring text.

Plugin **0.1.1** requires its matching CLI **0.5.4** and WASM. Version 0.1.0 / CLI 0.5.2 only supported the global `ocr: false` setting or `--no-ocr`; update the complete package together.

Plugin 0.1.1 treats intentional `ocr: "never"` as a successful native-text request: `textScope: "native-text"`, exit 0 and `complete: true` unless another failure/limit occurs. It still reports skipped image text. OCR-enabled scope is `"native-and-ocr"`; actual OCR errors and low-confidence omissions remain partial (exit 3). `content.ocr.results[]` locates each skipped/complete/partial/failed attempt by page, slide, shape and media where available. Published 0.1.0 / CLI 0.5.2 retain the earlier partial status for skipped OCR. Sidebar previews are unaffected.

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

Either row can set `disabled: true`, including through DSH's plugin UI. A tools-only/headless profile should disable `filens-preview`; preview requires the Web/Desktop client and `webServer`. Unloading Tools unregisters its seven tools and cancels active calls. Unloading Preview removes its client registration, route and startup injection; unmounting a viewer releases its iframe and workers.

Default command: DSH Host's Node/Electron executable plus the packaged CLI launcher. For a remote shell/container, configure `command: [filens]` and install the matching CLI **inside that execution environment**. A Host installation path is not assumed to exist remotely. Execution requires DSH's Bash-compatible `shell` provider; a PowerShell-only composition is not supported. The default CLI prebuild supports macOS arm64, Linux x64/arm64 and Windows x64; platform coverage here is inherited, not independently tested.

The command uses `ctx.shell`, Session cwd, `shellEnv` and the resolved sandbox policy. Escalation uses DSH's approval service. The plugin does not grant filesystem permissions itself. OCR and native binaries are optional npm platform dependencies: do not install with `--omit=optional`. OCR models ship with the full CLI; normal reads do not download models. Check `filens_capacity` when OCR is unavailable; the `ocr: false` option disables it.

The current CLI keeps CLI input copies, options, results, PDF render images and OCR image transport in process memory. Search workers share a **512 MiB workspace file-data quota** with no disk fallback. This quota excludes WASM linear memory, OCR runtime memory and transport copies. Capacity, reads, OCR, search and excerpts pass DSH's strict `read-only` sandbox. Conversion finishes in memory, then requires permission to write the requested output using a sibling staging file and atomic commit. Preview uses DSH's file-read service. This does not control operating-system swapping.

Workspace selection is a runtime option:

```sh
filens read report.pdf --json                    # memory by default
filens read report.pdf --workspace disk --json   # disk scratch explicitly
filens read report.pdf --workspace memory --json # memory explicitly
```

stdin JSON also accepts `"workspace": "disk"`. The `hdrw.wasm` walker exchanges options/results over stdin/stdout and mounts only `/scan`; it creates no option/result files. Disk mode invokes the same WASM core and cleans scratch directories after completion or cancellation. A read-only sandbox rejects disk mode; neither mode silently switches backends. In DSH, fixed arguments can be supplied through the existing `command` option, for example `command: [filens, --workspace, disk]` when the CLI is installed in that shell's environment. The bundled default command needs no configuration.

The new CLI requires the matching OCR byte-input ABI. An old OCR library fails its health check with an explicit upgrade message. `pack:local` builds and bundles both components; replacing only an old npm executable is insufficient.

## Preview resources and data flow

The Host serves only enumerated, versioned library resources under `/_filens/<digest>/`. This static route has no document path parameter. DSH reads the selected document using its own Session file service, then the client transfers a **copy** of the bytes to the viewer iframe. The iframe verifies parent origin, source window and a per-view channel. Viewer messages contain no Host credentials or direct file URL. In Web mode, this trusted runtime shares the DSH origin; the iframe is not a separate authentication boundary.

The preview fills its pane and follows DSH's colors, fonts and language without reopening the document or resetting its page. The preview toolbar contains only zoom out/in and fullscreen where supported; fit, rotation and page buttons are removed, while keyboard page navigation remains. Word pages fit the pane width and preserve reading position on resize. 3D files have no top toolbar and automatically frame the whole model, including in narrow panes. Drag to orbit, scroll to zoom and double-click to reset. The top-left button opens a compact inspector, collapsed by default, with View / Structure / Tools tabs. Model structure, materials, measurement, section and snapshot settings appear on demand without shrinking the canvas. Arrow keys switch tabs and Esc closes the inspector. Loading shows the filename, errors offer details and retry, and late messages from a previous file cannot replace the current state.

The runtime includes archive WASM and its worker. CSP restricts resources and connections to local/self/blob/data sources; the packaged iWork glue needs `unsafe-eval` inside the viewer. Format behavior, password handling and limitations remain FiLens's existing ones. DSH supplies one selected file; multipart archives requiring companion volumes are not covered by this integration's validation. Native codecs and fonts still affect rendering.

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
