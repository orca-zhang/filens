# FiLens for DeepSeek Harness

[中文](README.zh-CN.md)

One `dsh-filens` bundle adds two independently switchable plugins:

| Entry | What it does |
| --- | --- |
| `filens-tools` (`dsh-filens/tools`) | Agent tools for local document reading, OCR, search, original excerpts and conversion. |
| `filens-preview` (`dsh-filens`) | FiLens renderer in the existing document sidebar, using the file bytes DSH loads. |

The adapter reuses `filens-cli@0.5.2` and builds the `filens-preview@0.3.2` runtime from the shared frontend source. It adds no parsing or conversion algorithms. Registered extensions come from FiLens's shared support manifest: **397**, including conversion-assisted previews. Registration does not guarantee fidelity for every file. See the [support matrix](../../docs/support-matrix.md) and [validation record](VALIDATION.md).

Tested on macOS arm64 with DSH **Desktop/Web 0.2.1-rc.5**, **Web 0.2.2-alpha.3** and Node 24. Other DSH versions remain unverified.

## Install and build

Install [`dsh-filens@0.1.0`](https://www.npmjs.com/package/dsh-filens) in the target profile, then restart DSH:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.0
# For a Web profile:
dsh plugin --profile web add dsh-filens@0.1.0
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
dsh plugin --profile web add /absolute/path/dsh-filens-0.1.0.tgz
dsh web
```

For Desktop, open the app once to initialize its profile, fully quit it, then:

```sh
dsh plugin --profile desktop add /absolute/path/dsh-filens-0.1.0.tgz
```

On macOS, the installed app also carries a CLI at `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` if `dsh` is not on PATH. Reopen Desktop after installation. The profile manager may print peer warnings because DSH supplies shared packages from its own runtime; startup and the checks below verify the actual shared instances.

Use an isolated home for testing, for example `DSH_HOME=/tmp/filens-dsh-test`; use the same value when launching and managing that test instance. For repeated local builds, use a fresh tarball filename: pnpm can retain the previous contents of an unchanged `file:` specifier.

## Use

Ask the agent to use these tools explicitly during a first test:

| Tool | Example arguments |
| --- | --- |
| `filens_capacity` | `{}` — installed formats, conversion pairs, OCR health |
| `filens_read` | `{"path":"report.pdf","layout":true}` |
| `filens_search` | `{"path":"docs","query":"annual revenue","max_results":10}` |
| `filens_excerpt` | `{"path":"report.docx","query":"risks","max_chars":4000}` |
| `filens_convert` | `{"path":"data.csv","output":"data.xlsx"}` |

Paths resolve in the calling Session's execution environment and working directory. Document paths and queries travel over stdin as JSON, never inside shell syntax. Conversion refuses existing output files; discover supported pairs with `filens_capacity`. Excerpts select original passages, with the CLI's ranking and omission metadata.

Canonical results are `{ exit_code, response }`. Inspect `response.ok`, completeness, truncation, warnings and provenance. CLI exit **3** preserves partial results. Invalid JSON, sandbox runner errors, output overflow, timeout and cancellation become tool errors. Model-visible JSON has a display limit; structured tool values retain the complete response. Request smaller results if the displayed text is clipped.

Open a file through DSH's Files tab or a file link. The existing viewer menu includes **FiLens** and applicable built-in alternatives. FiLens takes extension priority for its registered formats.

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

Either row can set `disabled: true`, including through DSH's plugin UI. A tools-only/headless profile should disable `filens-preview`; preview requires the Web/Desktop client and `webServer`. Unloading Tools unregisters its five tools and cancels active calls. Unloading Preview removes its client registration, route and startup injection; unmounting a viewer releases its iframe and workers.

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

The preview fills its pane and follows DSH's colors, fonts and language without reopening the document or resetting its page. Documents retain the navigation, zoom and keyboard controls supported by their format; Word pages fit the pane width and preserve reading position on resize. 3D files have no top toolbar and automatically frame the whole model, including in narrow panes. Drag to orbit, scroll to zoom and double-click to reset. Loading shows the filename, errors offer details and retry, and late messages from a previous file cannot replace the current state.

The runtime includes archive WASM and its worker. CSP restricts resources and connections to local/self/blob/data sources; the packaged iWork glue needs `unsafe-eval` inside the viewer. Format behavior, password handling and limitations remain FiLens's existing ones. DSH supplies one selected file; multipart archives requiring companion volumes are not covered by this integration's validation. Native codecs and fonts still affect rendering.

FiLens parses locally. Text returned to the agent can enter DSH's configured model provider; local parsing does not imply the model conversation stays on the device.

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
