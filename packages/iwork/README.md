# @filens/iwork

Native front-end iWork preview core for `.key`, `.pages`, and `.numbers`.

To our knowledge, as of November 24, 2026, this is the only **open-source iWork preview library**, supporting **pure frontend native rendering**, and the first library to truly parse the **iWork 15 protocol**. Keynote, Pages and Numbers are parsed and displayed in the browser without Apple hardware or iCloud conversion. See [current coverage](#current-coverage) for rendering limits.

## What It Exposes

- `detectIworkType(source, options?)`
- `loadIwork(source, options?)`
- `createIworkViewer(container, options?)`

The package also exports the iWork document and viewer runtime types.

## Install

```bash
npm install @filens/iwork @filens/core
```

`@filens/core` is a runtime dependency because the iWork viewer reuses the shared DOM/SVG render primitives and media registry.

## Usage

```ts
import { createIworkViewer, loadIwork } from '@filens/iwork';
import '@filens/iwork/style.css';

const mount = document.getElementById('mount');
if (!mount) {
  throw new Error('Missing mount element.');
}

const viewer = createIworkViewer(mount, {
  type: 'auto',
  fit: 'contain',
  initialScale: 1,
  minScale: 0.4,
  maxScale: 4
});

await viewer.preview('/samples/a.key');

const numbers = await loadIwork('/samples/a.numbers');
```

Pass `{ password }` as the second argument to `preview()` or `loadIwork()` to open a modern `.iwpv2`-encrypted iWork ZIP package. Content-based `detectIworkType()` accepts the same option. The shared preview runtime prompts and retries for missing or incorrect passwords. Decryption uses Web Crypto, and previews opened with a password bypass the shared parsed-model cache. [Fixture coverage](test/encryption.spec.ts)

## Source Types

`preview()`, `detectIworkType()`, and `loadIwork()` support:

- `string`
- `ArrayBuffer`
- `Uint8Array`
- `Blob`
- `File`

For unencrypted Numbers files opened from HTTP(S) or from a local Blob or File larger than 128 KiB, `preview()` reads media when a sheet opens. The viewer's document state accumulates the media for opened sheets. `loadIwork()` returns all sheets and package media, including unused assets.

## Viewer Options

```ts
interface IworkViewerOptions {
  type?: 'auto' | 'key' | 'pages' | 'numbers';
  width?: number;
  height?: number;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
}
```

## Viewer API

```ts
interface IworkViewerInstance {
  preview(source: IworkSource, options?: { signal?: AbortSignal; cache?: boolean; password?: string }): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: IworkFitMode): void;
  goToPage(index: number): void;
  goToSheet(index: number): void;
  next(): void;
  prev(): void;
  getState(): IworkViewerState;
  on(event, handler): () => void;
}
```

## Events

- `rendered`
- `error`
- `warnings`
- `pagechange`
- `sheetchange`
- `scalechange`

## Rendering Model

The package uses a split architecture:

- parsing runs in a `Web Worker`
- `.iwa` archive decode uses vendored protobuf/type-map assets derived from `iwork-converter`
- semantic extraction builds dedicated Keynote, Pages, and Numbers document models
- rendering reuses shared DOM + SVG primitives from `@filens/core`

## Current Coverage

Good coverage today:

- Keynote slide order and basic slide canvas rendering
- text boxes and paragraph extraction
- images and media asset lookup
- basic shapes and lines
- tables
- Numbers sheet navigation and positioned tables
- large Numbers table row/column windows, including variable-height picture rows; resize and font refresh preserve reading position (`virtual: false` retains incremental rows)
- rectangular Numbers grid merges, including offscreen anchors and merged pictures; incremental batches retain earlier anchors
- Numbers merge parsing stores ranges rather than blank covered-cell objects; sparse models keep merge anchors and stored continuation records (Pages retains its dense grid)
- parsed Numbers rich runs, font replacements, paragraph layout, solid/gradient/basic pattern fills and per-side borders in the grid; stored empty style cells retain their inherited/explicit fills
- Numbers source column widths in virtual and incremental grids, including narrow columns, very wide columns, merged text/gradient coordinates and small sibling tables; resizing retains source widths
- warning-based downgrade behavior for unsupported records

Still limited:

- exact Pages body flow and pagination parity
- omitted Numbers rich-text/style metadata, advanced effects, hidden-track layout and number formats
- implicit unstored blank cells still use grid defaults; picture cells retain fitted previews rather than exact crop/tile/text-overlay geometry
- archive/decoded records and source row/column track arrays remain resident; dense data memory remains outside the sparse-merge optimization
- full Keynote placeholder/template fidelity
- charts, comments, collaboration metadata, and animation behavior

## Dist Output

Build output:

- `dist/index.js`
- `dist/index.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/iwork/style.css';
```

## Notes

This package targets modern browsers with `Web Worker` support. It does not use Go, WASM, or converted HTML fallbacks.

The sparse-merge checks use synthetic serialized ZIP/Snappy/IWA archives with three
stored cells: 100,000 rows × 1,024 columns through the real browser worker, and up
to one million rows in the built frontend parser under a 128 MiB Node V8 old-space
cap. This measures merge coverage costs, not dense archives or total peak memory.
See [measurements and reproduction](../../benchmarks/frontend/2026-11-25/numbers-merge-memory-review.json).
