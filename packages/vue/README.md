# @filens/vue

Vue 3 components for the shared preview engines: `Preview` is the all-format entry;
`PptxPreview` and `IworkPreview` provide specialized viewers. For a ready-to-deploy
single JS file or split modules including Vue, see the [standalone builds](../preview/README.md).

## All-format entry

```vue
<script setup lang="ts">
import { Preview } from '@filens/vue';
import '@filens/vue/style.css';
</script>

<template>
  <Preview src="/report.pdf" name="report.pdf" />
</template>
```

`src` also accepts a `File`, `Blob` or byte array; provide `name` or `extension`
when the source has no filename. Legacy Office and RAW previews need a
`converter` configured with `createWasmConverterClient({ wasm, imageWasm, officeWasm })`
from `@filens/converter-client`. See the demo for complete WASM asset wiring.

`officeWasm` points to the optional `converter-office.wasm` asset. The current
core detects encrypted Office documents itself and loads this module only after
password submission. Omitting it retains ordinary conversions and password
prompts; encrypted conversions with a supplied password return `engine_unavailable`.
The standalone `@filens/preview` builds wire the module automatically.

## Languages (source build)

All three preview components accept `locale` and `messages`. Toolbars, model
controls, loading states and password prompts include 28 locale dictionaries,
using the same codes as ZimaOS:

```text
en_US en_GB it_IT nb_NO zh_CN zh_TW ja_JP ko_KR fr_FR de_DE sv_SE da_DK
nl_NL es_ES ca_ES pt_PT pt_BR pl_PL cs_CZ sk_SK hu_HU ro_RO hr_HR ru_RU
tr_TR el_GR ga_IE ml_IN
```

BCP 47 tags such as `zh-CN`, `zh-Hant` and `pt-BR` also work. Omit `locale` to
use the browser's preferred supported language; unsupported languages fall back
to English. Locale changes update controls without reopening the document.
Translations are ordinary strings rendered as text, with no `vue-i18n` dependency.
Document content, source warnings and driver errors retain their original text.

```vue
<Preview :src="file" :locale="zimaosLocale" :messages="{ Next: 'Forward' }" />
```

`messages` maps English source phrases to host strings for that component only.
For example, `Warnings: {count}` preserves its named placeholder. Exported
`previewLocales` lists available codes; `resolvePreviewLocale()` normalizes host
locale tags. Standalone `createPreview()` accepts the same options and supports
`viewer.update({ locale: 'ja_JP' })`.

## Application icons (source build)

APK and IPA packages and Windows EXE/DLL/MUI/MUN resource containers use the
shared WASM core to extract their application icon as PNG, then display it with
the normal image controls. The core also converts ICO to PNG; browser-native ICO
preview and existing ICNS preview remain available. No application is executed.
Configure `converter` as for legacy Office previews. APK archive browsing remains
available through explicit `@filens/archive` routes.

APK extraction follows the application's compiled manifest icon resource through
`resources.arsc`, including obfuscated paths and raster-backed adaptive XML. IPA
extraction uses the main `.app` bundle's XML or binary plist icon declarations,
selects the largest raster and normalizes iOS CgBI PNGs. PE extraction uses resource
RVA mapping and icon group IDs, with PNG and 1/4/8/24/32-bit DIB frames and masks.
Vector-only Android icons, asset-catalog-only IPA icons, legacy ICNS planes,
JPEG 2000 icons and OS-resolved `.app`/`.desktop` folder icons are not decoded.
Missing or unsupported icons produce a parse error.

## Install

```bash
npm install @filens/vue @filens/core @filens/iwork
```

`vue` is a peer dependency and must be provided by the host app.

## Password-protected documents

The generic `Preview` component prompts for passwords when opening encrypted PDFs
and Office documents. Configure its `converter` with `createWasmConverterClient()`
for Office decryption in the browser. Supported Office encryption includes Agile,
Office 2007 Standard, legacy RC4 CryptoAPI and XLS XOR obfuscation; rights-managed
documents and other unsupported encryption methods report a format error.

The password form supports incorrect-password retries, cancellation and reopening.
It clears the entered password after submission, cancellation or changing files.
The optional `password` prop supplies a known password; `requestPassword` replaces
the built-in form with a host callback using `PreviewOptions['requestPassword']`.

## Usage

```vue
<script setup lang="ts">
import { IworkPreview, PptxPreview } from '@filens/vue';
import '@filens/vue/style.css';

const src = '/samples/sample-deck.pptx';
const keySrc = '/samples/a.key';
</script>

<template>
  <PptxPreview :src="src" fit="contain" :toolbar="true" :thumbnails="true" />
  <IworkPreview :src="keySrc" type="key" :toolbar="true" :thumbnails="true" />
</template>
```

## `PptxPreview` Props

```ts
interface PptxPreviewProps {
  src: string | ArrayBuffer | Uint8Array | Blob | File;
  fit?: 'contain' | 'width' | 'none';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  toolbar?: boolean;
  thumbnails?: boolean;
}
```

## `PptxPreview` Emits

- `rendered`
- `error`
- `slide-change`
- `scale-change`
- `warnings`

## `IworkPreview` Props

```ts
interface IworkPreviewProps {
  src: string | ArrayBuffer | Uint8Array | Blob | File;
  type?: 'auto' | 'key' | 'pages' | 'numbers';
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  toolbar?: boolean;
  thumbnails?: boolean;
}
```

## `IworkPreview` Emits

- `rendered`
- `error`
- `warnings`
- `page-change`
- `sheet-change`
- `scale-change`

## Behavior

The components are designed to feel close to the `vue-office` direct-`src` usage pattern:

- pass `src` directly as a URL or binary source
- source changes trigger a fresh preview automatically
- the old preview task is discarded by the viewer lifecycle
- toolbar and thumbnails are built in
- `IworkPreview` automatically switches between paged and sheet-oriented behavior depending on document kind

## Included UI

- top toolbar
- left thumbnail rail
- main preview area
- zoom in / out
- fit to page
- fit to width
- previous / next slide
- previous / next iWork page or sheet where applicable
- keyboard navigation when the shell is focused

## Dist Output

Build output:

- `dist/index.js`
- `dist/style.css`
- `dist/index.d.ts`

Import CSS with:

```ts
import '@filens/vue/style.css';
```

## Scope

This package is for client-side Vue 3 apps in modern browsers. It is not currently positioned as an SSR-first or full Office/iWork-compatibility renderer.
