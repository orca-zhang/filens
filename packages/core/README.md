# @filens/core

ESM PPTX parsing and preview core for browser applications.

## What It Exposes

- `init(container, options)`
- `createViewer(container, options)`
- `loadPptx(source)`
- `renderSlideToElement(slide, presentation, options)`

The package also exports the core runtime types.

Workers can import `openZipArchive` and the `ZipEntry` type from
`@filens/core/zip`. This entry loads ZIP parsing without viewer code or CSS.

## Install

```bash
npm install @filens/core
```

## Usage

```ts
import { init } from '@filens/core';
import '@filens/core/style.css';

const mount = document.getElementById('mount');
if (!mount) {
  throw new Error('Missing mount element.');
}

const viewer = init(mount, {
  fit: 'contain',
  initialScale: 1,
  minScale: 0.4,
  maxScale: 4,
  virtual: true
});

await viewer.preview('/samples/sample-deck.pptx');
```

## Source Types

`preview()` and `loadPptx()` support:

- `string`
- `ArrayBuffer`
- `Uint8Array`
- `Blob`
- `File`

For multi-format previews, `createPreviewer()` coordinates registered drivers and
converters. Opening another file or calling `destroy()` settles superseded
`preview()` calls, aborts their load signals, and ignores late results and events.
The signal remains active after the initial load for background resource work.
Custom drivers must release their own DOM and resources on destruction; work that
ignores cancellation may still finish. Rejected loads release their sessions and
expose the error through `getState()` and the `error` event.

Password-protected PDF and Office documents can be opened through `createPreviewer()`.
Register the Office drivers and configure the WASM converter for encrypted Office
packages. Set `requestPassword` to an async callback that receives `{ name, reason,
attempt, signal }` and returns a password or `null` to cancel. `reason` is
`password_required` or `password_invalid`; respect the signal when a file is replaced.
A known password can be supplied per load with
`previewer.preview(source, { name: 'document.docx', password })`.
Passwords retain spaces and Unicode, are not included in preview state, and are
not reused for subsequent documents. Stable `password_cancelled`, `password_required`
and `password_invalid` errors can be recognized with `previewPasswordErrorCode()`.

With `@filens/archive` registered, encrypted ZIP entries use the same password
callback. ZIP directories are listed without decrypting their files; a password
is requested when an encrypted entry is opened. Both ZipCrypto and AES ZIPs are
supported, including entries with different passwords. A cancelled entry returns
to the archive. Low-level callers can pass `{ password, signal }` as the second
argument to `openZipArchive()`, or supply a password to `entry.bytes(password)`.

DOCX, XLSX and PPTX previews expose files in their package's `embeddings` directory
in an **Attachments** panel. PDF drivers expose PDF attachments through the same
panel. Opening one reuses the registered drivers and converter, so a document can
contain an encrypted ZIP/RAR/7z, another document, or further attachments. OLE Package
objects are unwrapped to their original filename and payload; native OLE Office
objects are identified as DOC/XLS/PPT. Unsupported payloads can be downloaded.
Returning keeps the parent renderer and scroll position. The default nested
previewer shares the parent's registry and converter; custom `previewerFactory`
implementations must forward `containerContext`, `requestPassword`, and other
received options. Custom document drivers may implement `getAttachments()`.

Nested previews share limits of 8 levels, 20,000 entries per container, 128 MiB
per expanded entry, and 512 MiB of expanded data per top-level preview. Office
payloads are read on demand; PDF.js supplies PDF attachment contents when the
attachment list is requested. Linked external objects are not fetched as
attachments. Legacy Office conversion only exposes attachments preserved in its
OpenXML output. RAR 4/5 and 7z use a lazy-loaded 7-Zip WASM worker, including
encrypted filenames, encrypted entries and solid archives. Header passwords are
requested before listing; entry passwords are requested on opening. Cancelling
or exceeding the 60-second operation limit terminates the worker. Multi-volume
archives support RAR `.part01.rar` / `.rar` + `.r00`, 7z `.7z.001`,
byte-split ZIP `.zip.001`, and traditional ZIP `.z01` + `.zip` naming.
The demo and standalone picker accept all parts together in any order; nested
archives automatically find companion volumes in the same directory. Document
attachments can also collect companion parts, including OLE-wrapped parts.
Missing first/intermediate parts identify the missing filename; the WASM engine
validates the final volume. Each set is limited to 256 volumes and 512 MiB of
compressed input, in addition to the expanded-byte limits above.

Hosts can supply companions directly on a source descriptor:

```ts
await previewer.preview({
  source: firstFile, name: 'bundle.7z.001',
  archiveVolumes: [{ name: 'bundle.7z.002', source: secondFile }]
});
```

`selectArchiveVolumes(name, files)` is exported by `@filens/archive` and the
CSS-free `@filens/core/archive-volumes` entry for custom file pickers. It keeps
different families/directories separate and returns the primary part first.
Encrypted ZIP directory metadata is not supported. Corrupt embedded
OLE objects retain an original-byte download even when their preview fails.

PPTX and participating optional drivers also expose `PreviewItemState.fonts`
through the generic runtime. This includes discovered font references,
best-effort availability, application mappings, and layout-drift warnings.
Set `fontLoading: true` on `createPreviewer()` to load optional Latin/CJK webfonts
in the background and refresh layouts after loading. Custom packs and
`fontResolver` URL/byte assets support self-hosting and authorization; adaptive
mirrors and bounded backoff retain local fallback when loading fails.
See [font diagnostics and loading](../../docs/fonts.md) for supported formats,
configuration, helper APIs, provenance semantics, and detection limits.

## Viewer Options

```ts
interface ViewerOptions {
  width?: number;
  height?: number;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
}
```

## Viewer API

```ts
interface ViewerInstance {
  preview(source: PptxSource): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: FitMode): void;
  goToSlide(index: number): void;
  next(): void;
  prev(): void;
  getState(): ViewerState;
  on(event, handler): () => void;
}
```

## Events

- `rendered`
- `error`
- `slidechange`
- `scalechange`
- `warnings`

## Rendering Strategy

The current implementation uses HTML + SVG:

- text, images, and tables render through DOM/CSS
- preset shapes, lines, and connectors render through SVG
- thumbnails reuse the same rendering pipeline as the main viewer

## Current Coverage

Good coverage today:

- common text boxes and placeholders
- images
- grouped shapes
- tables
- theme colors and fonts
- master/layout inheritance
- common preset arrows and polygon shapes
- slide links and external hyperlinks
- cached 2D column, horizontal bar and pie charts, with titles and legends; bar/column charts also support value labels and basic text styles

Still limited:

- animations
- other chart types and advanced chart formatting
- SmartArt
- media playback objects
- embedded fonts
- some long-tail shape formulas

## Dist Output

Build output:

- `dist/index.js`
- `dist/index.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/core/style.css';
```
