# Browser-only media validation — 2026-11-03

Host: Apple M4 Pro, macOS arm64. No conversion service, Files API or Receiver SDK.
[Raw browser/probe results](validation/browser-media-2026-11-03.json).
The host GPU's actual codec execution is unobservable and recorded as unknown.

| Validation | Result |
| --- | --- |
| Media package unit tests | 21 passed, including 10 new source/recovery checks |
| Vue package regression | 61 passed |
| Canonical engine regression | 32 passed; keyframe-safe retention assertions added |
| Photos `npm run selfcheck` | Passed; no visual/token edits |
| Filens conversion architecture policy | 1,691 checks passed |
| Media/Vue/standalone builds | Passed; split and all-in-one runtime |
| Isolated media package JavaScript + declarations | Passed with no workspace peers or mp4box installed |
| Snapshot SHA-256 verification | Passed |

Real playback validation:

| Browser | Native original | MP4/MOV local recovery | 9 GiB virtual Range source / forward/backward paused seeks | Local File with networking blocked | VP9 → AVC WebCodecs |
| --- | --- | --- | --- | --- | --- |
| Chrome 156.0.8078.80 | Passed, zero custom codec instances / JS fetches | Passed | Passed | Passed, zero fetches | Passed |
| Firefox 148.0.2 | Passed | Passed | Passed | Passed, zero fetches | Passed |
| Playwright WebKit 26.4 | Passed | Passed | Passed | Passed, zero fetches | Passed |

Chrome split and all-in-one `createPreview({ browserMedia: true })` each passed
actual File → native failure → local remux → picture/playback → destroy. Even a
configured conversion client was never called. The package includes MP4Box's
license; standalone builds include it in third-party notices. Optional image and
other conversion WASM assets were not requested by these video scenarios.

The Range fixture reports a virtual 9 GiB resource; only a small real 20-second
AVC/AAC clip is populated. This verifies bounded addressing and reads, not a
full-length 9 GiB decode. Source GOPs are 10 seconds; recovery seeks 12 → 3 → 16
seconds while paused, preserving volume and playback rate. Max read is 1 MiB.
The engine's GOP retention fix keeps the dependency keyframe during eviction.

For local-file checks the fixture is materialized before networking is disabled;
that fixture preparation is not the production conversion path. Chrome/Firefox
use Playwright offline mode. WebKit uses request blocking: its offline emulator
can reject even `Blob.slice().arrayBuffer()` with `NotReadableError`. The test
also replaces fetch with a throwing stub. Explicit play confirmation waits for
actual time progress rather than assuming a fixed startup delay.

Chrome local remux reached the first picture in approximately **51 ms** in the
recorded warm run. VP9 → AVC at 640×360 played successfully; its recorded
**4.15 s** includes setup plus a deliberate 500 ms playback confirmation wait.
These are single synthetic fixture observations, not a startup SLA or a quality
comparison. Remote source reads, decode, encode and initialization can dominate
startup independently.

AVC round-trip initialization probes (30 synthetic canvas frames, unpaced,
`prefer-hardware`, no proof of hardware execution):

| Requested configuration | Encoded/decoded frames | Whole-trial throughput | Encode P95 | Outcome |
| --- | --- | --- | --- | --- |
| 1080p30 | 30 / 30 | 172.7 fps | 35.1 ms | Completed |
| 1080p60 | 30 / 30 | 167.7 fps | 40.9 ms | Completed |
| 1440p60 | 29 / 29 | 108.4 fps | 44.4 ms | Incomplete codec trial; not accepted |
| 4K30 | 29 / 29 | 55.8 fps | 68.1 ms | Incomplete codec trial; not accepted |

The final two trials did not produce every submitted frame. Their apparent
throughput does not override that failed acceptance condition. Short, simple
canvas trials cannot establish sustained playback, realistic-content CPU limits,
thermal behavior or video-engine utilization. Unknown CPU/GPU metrics stay null.

Not completed: Windows Ryzen 5 5600G / Intel Arc B580 acceptance, sustained
1080p/1440p/4K real-content conversion, a Filens CPU-only automatic recovery
path, long-running memory/thermal sessions, and broader custom container/audio/
subtitle processing. The shared measured-software retry API is available but is
not automatically wired into this first preview adapter. Safari shipping builds
still need manual validation; Playwright WebKit is not Safari certification.

Reproduce:

```sh
npm run test --workspace @filens/media
npm run test:media:browser
npm run bench:media:browser
npm run build:media
npm run test:media:package
npm run build:preview
npm run test:media:standalone
```

Set `BROWSERS=firefox,webkit` for the other installed Playwright engines and
`FILENS_MEDIA_RESULTS` for raw results. Run the benchmark on each Windows target
and keep the exported JSON, browser version, graphics driver version and whether
acceleration was disabled. This work does not change transport signaling, ICE,
TURN, DataChannel transfer semantics or Photos' native HTTP playback.


Files changed for this integration (pre-existing work in the checkout is excluded):

| Area | Files |
| --- | --- |
| Browser engine and sources | `packages/media/src/engine.ts`, `browser-source.ts`, `browser-video-session.ts`, generated `engine-snapshot/` |
| Viewer integration | `packages/media/src/index.ts`, `codec-preview-driver.ts`, `packages/vue/src/Preview.vue`, `packages/preview/src/index.ts`, `public.d.ts` |
| Packaging | `packages/media/package.json`, `vite.config.ts`, `packages/preview/vite.config.ts`, root `package.json` |
| Tests and update tools | `scripts/sync-media-engine.mjs`, `test-browser-media.mjs`, `test-browser-media-standalone.mjs`, `test-media-engine-package.mjs`, `packages/media/test/browser-source.spec.ts`, `browser-recovery.spec.ts`, `browser.html` |
| Documentation | Root/media/preview README entries, support matrices, this validation record, `browser-media-engine.md`, raw validation JSON and generated preview build sizes |
| Canonical Photos correction | `src/lib/media-engine/mp4-playback.ts`, `mp4-sample-stream.ts`, `tests/media-engine-mp4.test.ts`, `docs/architecture/client-media-engine.md` |

No design token, hardcoded visual color/dimension, px style value or non-bx icon
was added. No dependency, server API or transport protocol was added or changed.
