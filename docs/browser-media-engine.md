# Browser media without a conversion server

This is an optional, incremental MP4/MOV recovery adapter for Filens. Processing
runs in the browser; there is no Files API, Receiver SDK, conversion endpoint,
service worker or COOP/COEP requirement. Shared TypeScript parsing/muxing and
WebCodecs processing remain on the frontend. No backend code was added.

## Use the existing viewer

```ts
import { createPreview } from 'filens-preview';

const viewer = createPreview('#preview', {
  src: file, // File/Blob, existing bytes, or an ordinary media URL
  name: file.name,
  browserMedia: true
});
// viewer.update({ src: anotherFile, name: anotherFile.name });
// viewer.destroy();
```

The Vue component accepts `:browser-media="true"`. Framework integrations using
`@filens/core` can register `createMediaPreviewDrivers({ browserMedia: true })`.
The option defaults to false for compatibility. Even when enabled, the first
attempt is the original browser-native player. Successful native playback loads
no custom decoder, encoder or MP4 parser and makes no JavaScript fetch request.
Photos HTTP original playback continues to use its existing native-first path.

After a native error, the local adapter first copies playable samples into MSE.
Only video whose original codec is incompatible with MSE is considered for AVC
encoding. This mode never calls the optional `mediaConverter` for video; failures
are reported through the existing error lifecycle and the original download
capability remains available. HEIF image conversion retains its existing behavior.

The browser-local runtime can work offline with local files after its JavaScript
has loaded. The split distribution needs its optional chunks available or cached;
the all-in-one distribution embeds this video runtime. Remote URLs still need
normal browser access, CORS where applicable, and valid HTTP Range responses for
custom recovery. A server that ignores Range is rejected before its body is read.

## Framework-free and P2P use

```ts
import { recoverBrowserVideo } from '@filens/media/engine';

// Explicit recovery: call after the host's original playback attempt fails.
const playback = await recoverBrowserVideo(file, video, {
  signal: controller.signal,
  allowTranscoding: true,
  autoplay: false,
  onError: reportError,
  onMetrics: reportMetrics
});
await playback.seek(30, false);
await playback.close();
```

The same entry exports `MediaCapabilityDetector`, `MediaFormatInspector`,
`CodecNegotiator`, `TranscodingPolicy`, `HardwareAccelerationProbe`,
`RuntimePerformanceMonitor`, `BoundedVideoTranscoder` and transport adapters.
Existing files and bytes stay caller-owned. For authenticated URLs, pass a
`fetch` implementation that preserves Range and cancellation.

A host using WebRTC DataChannel can supply an existing bounded source:

```ts
const playback = await recoverBrowserVideo({
  identity: shareId,
  size: fileSize,
  read: (start, endExclusive, signal) => receiver.readRange(start, endExclusive, { signal }),
  close() {} // The host owns the receiver and connection.
}, video, { signal });
```

The host must preserve its own integrity, ordering, retries, backpressure and
reconnection semantics. This adapter neither establishes a connection nor closes
the borrowed transport. No RTP packetization is involved. A fully automatic
WebRTC connection still needs an existing signaling mechanism (or manual SDP/ICE
exchange); this engine removes the conversion backend requirement, not signaling.
The preview's `src` type remains backward compatible; custom range sources use
the framework-free recovery entry.

## Supported scope and budgets

| Path | Current behavior |
| --- | --- |
| Browser-native video/audio | Existing browser codecs, all existing formats/routes |
| MP4/MOV recovery | Unfragmented input; one video, at most one compatible audio track |
| Playable video/audio samples | Copy/remux; no WebCodecs required |
| Incompatible SDR video | Exact source decode + AVC encode support; output at most 1280×720 / 30 fps |
| Unsupported audio / subtitles / extra tracks | Report unsupported; never silently drop |
| Rotated/scaled track geometry, DRM, HDR conversion, fragmented input | Custom recovery unavailable; native path retained |
| WebM, MKV, AVI and other containers | Native path only; no custom demux adapter yet |
| Software fallback | Measured-budget helper exposed in the shared core; automatic preview retry is not implemented |

The preview requests `prefer-hardware`; browsers may still execute software.
Neither the option nor a fast probe proves hardware execution. Hardware execution,
CPU and GPU utilization remain unknown when the platform does not expose evidence.
There is no claim of universal HEVC, AV1 or hardware availability. The shared
negotiator supports their evidence-based priorities; this first fMP4 conversion
adapter emits AVC only. Automatic runtime resolution/bitrate adaptation is also
not wired into this preview adapter yet.

Reads are at most 1 MiB, MP4 metadata at most 16 MiB, and indexed samples at most
250,000 per track. Queues allow at most four raw frames / 64 MiB and 8 MiB encoded
output. MSE targets 8 seconds ahead and 4 seconds behind. Copied video retains the
preceding actual keyframe; long GOPs can extend retention behind that target.
Removal ends at a keyframe boundary so it cannot delete the frame dependencies
of the current picture. Operations have a 10-second deadline. No whole File/Blob
is read into memory for conversion. Existing ArrayBuffer/Uint8Array inputs have
already been materialized by their caller and are copied only in bounded slices.

Seek and eviction use bounded, sorted sample indexes with binary search instead of scanning the full movie on every fragment.

Cancellation propagates through reads, demux, codecs and playback. Seeks restart
an output epoch from a real keyframe. Closing releases frames, codecs, owned URLs
and sources without revoking caller URLs or stopping caller P2P connections.

## Reproducible shared implementation

`packages/media/src/engine-snapshot` is generated from the canonical Photos Media
Engine, with source-input and output SHA-256 hashes in `source-lock.json`.
It is not a second handwritten engine. Updating needs the source checkout only
at development time; building, testing and using the snapshot do not.

```sh
npm run sync:media-engine  # MEDIA_ENGINE_SOURCE can override the Photos checkout
npm run check:media-engine
npm run build:media
npm run test:media:package
```

The parser and its public TypeScript declarations are bundled with the snapshot;
no npm runtime dependency was added. MP4Box's BSD license is included in the media
package and the standalone third-party notices. Re-exported adapters are browser
interfaces, not application-specific API calls.

## Validation and measurements

Run `npm run test --workspace @filens/media`, `npm run test:media:browser` and,
after `npm run build:preview`, `npm run test:media:standalone`.
`npm run bench:media:browser` also runs AVC encode/decode initialization trials for
1080p30, 1080p60, 1440p60 and 4K30. It needs ffmpeg to generate its fixtures and
Playwright plus installed Chrome (override `FILENS_MEDIA_TEST_BROWSER`). Set
`BROWSERS=firefox,webkit` to exercise other installed Playwright browsers.
`FILENS_MEDIA_RESULTS` selects the raw JSON report path.

The fixture server is an ordinary static/Range server used only for tests. No
conversion service is started. Native container rejection / MSE VP9 rejection
are deterministic test injections, followed by real MP4 parsing, MSE append,
codec execution and picture presentation. These injections do not claim Chrome
naturally rejects those originals.

[Recorded validation and raw results](browser-media-validation-2026-11-03.md).

Remaining work: broader demux/audio/subtitle support, measured automatic software
retry, wiring adaptive output changes, long-duration/thermal/memory testing, and
manual Windows acceptance on Ryzen 5 5600G and Intel Arc B580. Local browser
results cannot replace those hardware tests.
