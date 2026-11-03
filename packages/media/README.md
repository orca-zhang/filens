# @filens/media

Audio, video, image and panorama preview drivers for Filens.

HEIC/HEIF photos first use native browser decoding. When unavailable, a dedicated
libheif WASM decoder and the shared image WASM core supply an sRGB PNG preview.
Both engines load only after native decoding fails in the split build. Source
8–16-bit RGB is retained until ICC conversion or the fixed PQ/HLG-to-SDR mapping;
ICC takes priority, and alpha is preserved independently. HEVC VUI color hints
are read in the image WASM core when container NCLX is absent.

Fallback admission limits are 64 MiB of input, 64 million pixels, 16,384 pixels
per edge and 4 MiB of ICC data. A 30-second decode timeout terminates the worker;
replacement, destruction and cancellation also stop it. Only the primary still
image is shown; sequence-only files are unsupported. Gain maps and camera-specific
HDR rendering are not reproduced. No upload or cross-origin isolation is required.

MOV videos use browser codecs. Codec support
depends on the browser, operating system and hardware; unsupported video reports
an error, including containers whose audio plays but video cannot be decoded.
Video dimensions may arrive after metadata; a zero width at metadata alone does
not trigger conversion. Videos play inline on mobile browsers.
Ordinary, recovered and panorama videos share a Photos-style control bar with
play/pause, a seek slider, elapsed/total time, five-second skips, volume, playback
speed and fullscreen. Ordinary videos also expose picture in picture and subtitle
selection when available. Space/K toggles playback, arrow keys seek, M mutes and F
toggles fullscreen when the player itself has focus. Narrow containers keep the
primary buttons visible; fullscreen retains the control bar and panorama canvas.
Applications that need transcoding can supply an optional `mediaConverter` to
`createMediaPreviewDrivers`, the Vue `Preview` component or `createPreview`.
The converter must return browser-playable media for MOV-to-MP4 requests and
handle HEIC/HEIF-to-PNG requests if used for image fallback too.

The dedicated decoder is distributed with `@filens/converter-client` (libheif-js,
LGPL-3.0). Applications must serve `libheif.wasm` and `converter-image.wasm`
alongside its JavaScript; the standalone single-file build embeds both. Keep the
image core's `THIRD-PARTY-NOTICES.txt` and decoder license when redistributing.
Dependencies retain their own licenses.

Images support pointer-anchored wheel zoom and pinch-midpoint zoom, alongside
single-finger panning, rotation and fit controls.

Audio previews include artwork, track information, synchronized LRC lyrics, click-to-seek,
lyric timing adjustment, repeat and playback speed alongside the native audio controls.
The player adapts to narrow containers and uses Chinese or English labels according to
the document's `lang` attribute. It does not autoplay.

```ts
import { createPreviewer } from '@filens/core';
import { createMediaPreviewDrivers } from '@filens/media';
import '@filens/media/style.css';

const previewer = createPreviewer(host, {
  drivers: createMediaPreviewDrivers(),
  audio: {
    title: 'My song',
    artist: 'Artist',
    album: 'Album',
    cover: '/music/cover.jpg', // URL, Blob, File, or bytes
    lyrics: '[00:01.00]First line\n[00:04.50]Second line' // LRC content
  }
});
await previewer.preview('/music/song.mp3');
```

The Vue `Preview` component accepts the same options through its `audio` prop.

Local MP3 ID3v2 APIC artwork is read automatically. With `resourceResolver`, the player
also looks for `<track>.lrc`, `<track>.jpg/.png/.webp`, `cover.jpg/.png` and `folder.jpg`
in the track's directory (`relation: 'lyrics'` or `'cover'`). Use
`createFileSetResourceResolver(files)` to supply related local files; the demo accepts
audio, LRC and artwork in one selection. Resource resolvers return a URL, Blob or bytes
in `source`; literal LRC content belongs in `audio.lyrics`.

Users can import or replace lyrics and artwork from inside the player. Manual imports
take precedence over pending companion reads; explicit options take precedence over
companion and embedded artwork. Optional resource failures do not stop audio playback.
No companion URLs are fetched unless supplied by the host's resolver.

LRC supports `ti`, `ar`, `al`, `offset`, repeated timestamps and same-time translations.
Enhanced LRC word timestamps are displayed as line lyrics. Positive LRC offsets advance
lyrics; the player's positive timing adjustment delays them. Lyric imports are limited
to 2 MB and 10,000 timestamped entries; artwork imports to 20 MB. Audio codec support
depends on the browser. Remote resources must permit browser access (CORS).


## Optional browser-only video recovery

Enable `createMediaPreviewDrivers({ browserMedia: true })`, `<Preview :browser-media="true" />`
or `createPreview(host, { src: file, browserMedia: true })`. Native playback is always
attempted first. Recovery is opt-in and bypasses `mediaConverter` for video, even
when one is configured. Image conversion is unchanged.

The first adapter supports bounded MP4/MOV remuxing, preserving one video and up
to one compatible audio track. It can convert incompatible SDR video to AVC at
up to 720p30 when WebCodecs supports the exact configurations. Unsupported audio,
subtitles, multiple tracks, rotated tracks, encrypted and fragmented inputs are
rejected rather than silently discarded. WebM/MKV retain native playback; custom
recovery for those containers is not implemented yet.

`@filens/media/engine` is a framework-free entry for `recoverBrowserVideo`,
`createBrowserMediaSource` and the six shared policy/probe/monitor modules. It
accepts File/Blob, existing bytes, HTTP Range URLs, and borrowed bounded sources
from a host P2P transport. It never creates signaling or conversion requests.
See [integration, measurements and remaining work](../../docs/browser-media-engine.md).
