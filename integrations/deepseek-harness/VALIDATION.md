# DSH integration validation

Date: **2026-11-04**. Release candidate validation for `dsh-filens@0.1.0`, CLI **0.5.2** and preview **0.3.2**. Publication status and exact registry hashes are recorded in the repository publication reports. No community post, model prompt or DSH account was used.

## Environments

| Environment | Result |
| --- | --- |
| Installed `/Applications/DeepSeek Harness.app`, **0.2.1-rc.5**, macOS arm64 | Real Desktop sidebar and packaged CLI/Host tested in an isolated `DSH_HOME`. |
| Same installed runtime, **0.2.1-rc.5**, Web profile | Real Loader, module graph, HTTP routes, tools and independent lifecycle tested. |
| npm `@deepseek-ai/dsh@0.2.2-alpha.3`, Node **24.11.0**, Web profile | Same profile checks tested against the newer API. |
| Chromium, Playwright **1.59.1**, React **18.3.1** | Compiled adapter, iframe, shared-source preview runtime (version **0.3.2**), file switching and cleanup tested. |

Release artifact: universal `dsh-filens@0.1.0`, depending on `filens-cli@0.5.2` and its matching byte-input RapidOCR platform libraries/models. Preview is built from the shared frontend workspace at version `0.3.2`. The plugin ships no duplicate CLI binary; npm selects its platform dependencies. The earlier bundled macOS test artifact remains historical evidence in `docs/dsh-plugin-validation.json`. The client registers 397 extensions from the shared FiLens manifest. This count is **not** 397 independently validated formats.

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
