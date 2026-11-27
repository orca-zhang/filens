# Font diagnostics and on-demand loading

The generic preview runtime exposes optional `PreviewItemState.fonts` metadata.
PPTX, Keynote, Pages, Numbers, DXF, DOCX, XLSX, and PDF currently populate it.
Hosts receive the same metadata through `getState()`, `rendered`, and `statechange`, including the
Vue wrapper's `state-change` event. Missing, substituted, and browser-unsupported
fonts also produce ordinary `warnings` describing possible layout drift.

```ts
previewer.on('statechange', (state) => {
  for (const font of state.fonts ?? []) {
    console.log(font.fontFamily ?? font.fontFile, font.status, font.source);
  }
});
```

An absent `fonts` field means the driver does not expose an inventory. An empty
array means no references were discovered in its current parsed model; it does
not certify that the original file contains no fonts. Numbers diagnostics cover
the sheets parsed so far and update when another sheet finishes loading. PDF
diagnostics cover rendered pages so far; optional metadata work never blocks the
first preview and results from replaced documents are ignored.

Font downloads are opt-in. Set `fontLoading: true` on `createPreviewer()` or a
participating driver's options to enable the built-in font packs and font-ready
relayout. The Vue `<Preview>` component accepts `:font-loading="true"`; the demo
enables it. The low-level `init()` / `createViewer()` API does not manage packs.
See [automatic loading](#automatic-font-loading) for custom sources and defaults.

## Metadata

| Field | Meaning |
| --- | --- |
| `fontFamily` | Original family referenced by parsed text, or the PDF font name reported by PDF.js, when known. |
| `fontFile` | Original file reference, such as a DXF style's `romans.shx`. |
| `styleName` | Original named style, when provided by the format. |
| `resolvedFontFamily` | Application mapping or detected automatic substitute; explicit targets are retained even when availability cannot be verified. |
| `classification` | Serif, monospace, style and script traits, with `metadata`, `known`, `name` or `unknown` evidence. |
| `substitutionReason` | Reason for an automatic substitute, such as `serif`, `monospace`, or `decorative`. |
| `matchScore` | Relative similarity score for an automatically selected candidate; not a confidence percentage. |
| `coverage` | `matched` when candidate cmap ranges cover the supplied local sample, otherwise `unknown`; does not certify whole-document coverage or shaping. |
| `embedded` | The driver found an embedded font declaration or program. Check `source` for verified provenance and `status` for availability. |
| `fontId` | Rendering-engine identifier, currently used for PDF.js font inventories. |
| `status` | `available`, `missing`, `substituted`, `unsupported`, or `unknown`. |
| `source` | `embedded`, `application`, `environment`, `fallback`, or `unknown`. |

`available` means that local measurements suggest the requested family is
available, a managed `FontFace` has loaded, the CAD driver has used a supplied
SHX stroke font, or PDF.js has provided an embedded face or glyph program for rendering. `substituted` means a different application mapping or automatically
selected named target appears available. `missing` means the requested family or mapping target was not
detected. `unsupported` identifies references such as unmapped SHX files that
cannot be rendered directly by the browser. `unknown` means that availability
could not be determined; a CSS family stack is also left unknown because it
does not identify a single font.

`environment` deliberately does not identify an operating-system font: the same
family could come from a system installation, a page stylesheet, or an existing
`FontFace`. `application` identifies a driver-known host mapping or a supplied
SHX sidecar used to draw glyphs. `fallback`
identifies an automatic similar-font substitute, missing or unsupported font
fallback, or a requested CSS generic family. `embedded` identifies active font data
from the document when the renderer establishes that provenance. DOCX and PPTX report
declarations using `embedded: true` and reports `source: 'embedded'` after the
browser decodes and registers a face for that family. A declaration without
load proof retains ordinary local availability or `unknown`.
A mapping whose availability is unknown retains its application
provenance and `unknown` status.

## Discovery and availability limits

Scene discovery includes explicit or parser-resolved family names on text runs,
shape text, table cells, and bullet labels across parsed slides/pages. PPTX also
includes chart and axis titles, legends, visible axis ticks and visible
column/bar data labels. Chart text participates in face matching and relayout after a
host-managed font loads. Mixed-script ticks and legends retain the chart's
Latin, East Asian and complex-script faces and use language hints for theme
fonts. The loader tracks the visible faces by weight and style. PPTX chart and
axis titles keep source edge coordinates or offsets from automatic placement.
Vertical titles use browser shaping for East Asian and Mongolian flow and
upright WordArt columns. Browser font metrics affect the painted text bounds.
Grouped PPTX objects are already flattened into those scenes. DOCX reuses
decoded font-table declarations and font
references in parsed document parts and styles, including header/footer/notes and
numbering parts. It also reads PANOSE and pitch from the font table in the existing
document package, since docx-preview discards those fields; optional metadata
failure does not prevent rendering. XLSX reads font-table family classes, bold
states, theme Latin names/PANOSE/pitch-family values, and
cell, row, column and base-style font inheritance. Rich-text runs retain their
own font references and typography. Renderers can apply
additional script, symbol, or emoji fallbacks; the inventory records references,
not the actual font used for each glyph. DXF and DWG drawing models include
declared text styles and available Big Font references.

PDF previews pair text-style identifiers with PDF.js font objects from the
rendered page. Where available, `fontFamily` contains the engine's PDF font name,
including its subset prefix. Decoded embedded outline fonts and Type 3 fonts with
PDF glyph programs report `source: 'embedded'`. Entries with unverified
provenance retain `unknown`, including standard fonts using system fallback.
On a cached first-page reopen, the preview can request that page's rendering
operators in the background to recover font metadata. PDF.js manages font bytes,
glyph selection and substitution.

Availability compares a fixed multilingual sample's canvas width against several
generic fallback baselines. It never treats `document.fonts.check()` as proof of
an installed font: that API can return success for a missing font that falls back.
Unavailable canvas contexts, failed measurements, and non-browser environments
produce `unknown`, without claiming that the font is present or missing.

Measurements are a heuristic for family availability at normal weight/style,
not a guarantee of exact font identity, glyph coverage, font version, shaping,
wrapping, pagination, or layout fidelity. The same font file can render
differently across browser/platform combinations. Diagnostic snapshots do not
block the first preview on downloads or `document.fonts.ready`. With `fontLoading`
enabled, managed loads update diagnostics and trigger the participating driver's
text/layout refresh. The preview also follows relevant faces loaded by the host
page, even when optional downloads are disabled.

## Shared helpers

Custom frontend drivers can import `collectSlideFontReferences(slides)` and
`analyzePreviewFonts(references, host.ownerDocument)` from `@filens/core`. The
analysis returns `{ fonts, warnings }`; drivers merge the warnings with their
existing format warnings. `getPreviewFontWarnings(fonts)` can also produce
warnings from selected diagnostics, avoiding duplicate format-specific warnings.
References can carry an explicit
`resolvedFontFamily`, known `source`, or `browserUnsupported` flag. Drivers should
provide a source only when they know its provenance, and preserve original
references alongside mapping targets.

Analysis deduplicates family/file/style references and warnings. Probe results
are cached only within one analysis call; calling it again rechecks availability.
The preview sessions retain their diagnostic snapshot for the loaded scenes so
ordinary navigation and zoom do not rescan all text. A replacement document,
destruction, or a newly loaded Numbers sheet updates or clears that snapshot.

Diagnostics alone do not fetch fonts, upload text, add font assets, or persist a font
cache. Document text is excluded from diagnostic output and the availability
measurement sample. A host may supply an optional local `text` sample to the
similarity matcher for checking candidate glyph coverage; it is never returned
in diagnostics.
The loader below supports optional Latin, CJK, Emoji and math packs, authorized
font URL/byte loading, and font-ready relayout. Document-specific subset
generation and embedded font support in other Office and iWork drivers remain
roadmap F1/F2 work.


## Automatic similar-font substitution

DOCX and XLSX enable local similar-font selection when a referenced family is
confirmed missing. The shared matcher considers:

- serif versus sans-serif and fixed versus proportional spacing;
- ordinary text, handwriting, decorative display styles, and symbol fonts;
- known CJK regions and scripts, keeping Japanese/Korean and SC/TC candidates distinct;
- common compatible substitutes, such as Times New Roman → Liberation Serif or
  Tinos, Calibri → Carlito, and Courier New → Liberation Mono or Cousine;
- family-specific PANOSE descriptors, weight, stretch and average advance width
  when available, including condensed sans-serif candidates;
- optional candidate Unicode cmap coverage, rejecting candidates known to miss
  sampled characters and prioritizing covered candidates over unknown coverage.

File metadata takes priority over a known-family catalog; font-name heuristics
are labelled `name`. DOCX and XLSX merge broad Office family classes, then
PANOSE traits, then explicit pitch; XLSX style weight takes priority over PANOSE
weight estimates. PANOSE's Any, No Fit and
reserved dimensions provide no trait; symbol and decorative descriptors are
not interpreted using text-family dimensions.
An unfamiliar family with no usable traits remains unknown in classification.
The matcher only records a named candidate after detecting it locally; a generic
`serif`, `monospace`, `cursive` or `fantasy` CSS fallback is not presented as an
installed substitute. Without reliable measurement, availability stays unknown.

```ts
import { analyzePreviewFonts, buildPreviewFontStack } from '@filens/core';

const refs = [{ fontFamily: 'Custom Book Face', traits: { serif: true } }];
const { fonts, warnings } = analyzePreviewFonts(refs, document, { substitute: true });
const preferred = fonts.flatMap(font => font.resolvedFontFamily ? [font.resolvedFontFamily] : []);
const cssStack = buildPreviewFontStack('Custom Book Face', { serif: true }, preferred);
```

`classifyPreviewFont`, `officeFontTraits`, `getFontFallbackCandidates`, and
`splitPreviewFontFamilies` are also exported for frontend drivers and hosts.
`fontTraitsFromPanose` decodes supported descriptors, and
`rankPreviewFontCandidates(reference, candidates)` ranks metadata candidates
without claiming that they are loaded. `analyzePreviewFonts` accepts an optional
`candidates` array and still checks local availability before recording a target.
Each candidate supplies `fontFamily`, optional `traits`, and optional inclusive
Unicode `coverage` ranges. Specific monospace/handwriting/decorative requests
require a candidate known to match that trait; known serif and regional script
conflicts are rejected.

`readPreviewFontMetadata(bytes)` inspects a single SFNT TTF/OTF locally, returning
family/subfamily names, OS/2 PANOSE/weight/width/average-width properties,
`post` fixed-pitch metadata, and supported Unicode cmap format 4/12 ranges.
For example, after a host has loaded its font under a CSS family name:

```ts
import { readPreviewFontMetadata } from '@filens/core';

const metadata = readPreviewFontMetadata(hostFontBytes);
const candidate = { fontFamily: loadedCssFamily, traits: metadata.traits, coverage: metadata.coverage };
const result = analyzePreviewFonts(
  [{ fontFamily: 'Custom Book Face', traits: { serif: true }, text: localTextSample }],
  document, { substitute: true, candidates: [candidate] }
);
```

The metadata reader does not load fonts, extract outlines or open embedded font resources.
`readPreviewFontEmbeddingFlags()` reads the raw OS/2 `fsType` flags of a single SFNT.
Malformed tables throw; unsupported WOFF/WOFF2/TTC containers are explicit errors.
Missing or unsupported Unicode cmap formats leave coverage unknown. Coverage
checks sample at most 256 distinct non-control code points and omit joiners and
variation selectors; they do not validate shaping, variation sequences or a
complete document. Candidate metadata must describe the font the host actually
loaded under that CSS family name.

PPTX/iWork rendering appends classified CSS fallbacks for families outside its
existing fallback catalog; its diagnostic inventory continues to describe source
references rather than claim an exact per-glyph replacement.

Explicit application mapping targets are not replaced by the automatic matcher.
DOCX keeps theme-variable stacks and embedded declarations out of automatic
substitution. Explicit CSS family order precedes selected targets, and selected
targets precede other classified fallback candidates. XLSX uses that same target
order for rendered cells and applies parsed bold states.
Legacy Symbol/Wingdings and SHX encodings require glyph mapping, so they are not
automatically exchanged for unrelated text fonts.

This is metadata-based typography matching. It does not compare font outlines or
certify identical shaping, measured text metrics, line wrapping or pagination.
Substitution reasons remain visible in diagnostics/warnings. The optional loader
uses the same ranking for downloadable candidates and refreshes supported layouts
after a selected face loads.

## Automatic font loading

```ts
import { createPreviewer, createWebFontPacks } from '@filens/core';

// Reuse this configuration object across previews to share route measurements
// and active/inflight font assets within the same ownerDocument.
const fontLoading = {
  packs: createWebFontPacks(),
  concurrency: 3,
  timeoutMs: 4000,
  hedgeDelayMs: 200,
  budgetMs: 12000,
  maxAttempts: 3,
  backoffMs: 500,
  maxBackoffMs: 30000,
  maxFontBytes: 16 * 1024 * 1024,
  preferLocal: true
};
const previewer = createPreviewer(mount, { fontLoading });
await previewer.preview('/slides.pptx'); // Returns after the first preview.
// Listen to statechange for later font diagnostics and layout updates.
```

`fontLoading: true` uses these defaults and built-in packs. `false` or omission
disables loading. Omit `packs` to use the built-in manifests; `packs: []` restricts
loading to assets supplied by `fontResolver`. Register optional format drivers as
usual for DOCX, XLSX, iWork, or CAD; the font option does not register them.

Only required references enter the queue. XLSX loads fonts attached to parsed
cells while retaining the full font-table inventory in diagnostics. DOCX loads
families in rewritable parsed CSS declarations, excluding font-table-only entries,
theme-variable stacks and embedded declarations. Scene references distinguish
regular/bold and normal/italic variants; samples for coverage matching stay local
and are capped at 4096 characters per family/variant. Unclassified families without
an exact asset, unmapped SHX, and legacy symbol encodings retain their fallback.

The loader first checks the original or explicit host alias. An available original
needs no download. For automatic substitutions, an equally or better ranked
available local substitute takes precedence by default; `preferLocal: false`
allows a pack candidate instead. Explicit host targets are retained. If every
source for the best compatible family fails, the loader can try one other
compatible family before retaining local fallback and publishing a warning.

### Built-in packs and self-hosting

The manifests contain URLs for versioned WOFF2 files on jsDelivr and unpkg.
The Latin and CJK families pin `@fontsource/*` packages to **5.2.6**. They are Carlito, Caladea,
Arimo, Tinos, Cousine, Noto Sans, Noto Serif, Noto Sans Mono, and Noto Sans/Serif
SC, TC, JP and KR. All include weights 400/700; Latin families include italic
except Noto Sans Mono. CJK faces currently provide normal style only. Latin packs
declare their subset's nominal Unicode ranges.

Emoji packs include Noto Color Emoji (400, about 5.8 MB) and outline Noto Emoji
(400/700, about 0.48 MB per face) at **5.3.2**. Math packs include STIX Two Math
and Noto Sans Math (400, about 0.40 MB and 0.27 MB) at **5.3.0**. These are
normal faces. A declared Emoji or math family can use
these candidates, and automatic substitutions stay within that category. Fonts
already detected locally follow the same availability and `preferLocal` rules.
Math packs load complete faces. Hosts can supply additional styles, including
handwriting and decorative faces.

PPTX, XLSX and DOCX use the versioned Fontsource Unicode index to select the WOFF2
subsets of an Emoji or CJK face that cover a complete font sample. A complete
sample holds all text recorded for that face, up to 4096 UTF-16 code units.
XLSX collects from stored cells across sheets, including rich-text runs, cached
results, static display formats, saved formula text, and the Normal font's width
probe digits. Repeated strings share a sample entry. Uncached formulas and
conditional rules that can change the output text, weight, or style use full
faces for affected fonts. DOCX samples the renderer's first layout, including
inherited styles, headers, footers, footnotes, endnotes and offscreen pages.
It uses full faces when generated list or note markers may use the font, when
the family has mixed weights or non-normal styles, when CSS transforms the text,
or when the DOM scan exceeds 8192 nodes. The loader also uses the full
face for truncated or incomplete samples, combining characters, joined Emoji,
flags, variation selectors, more than six needed subsets, or an unavailable index
or subset. Noto Color Emoji uses the full face when the browser lacks SVG font
support. Other drivers currently use complete faces. The text and code points
stay in the browser. A mirror can infer the broad Unicode ranges from the
versioned subset file names requested. Selecting an asset establishes family
availability, with glyph and sequence coverage dependent on the font and browser.

Each manifest includes an upstream `LICENSE` URL. Hosts must review those licenses
before redistribution or subsetting. To self-host the same versioned NPM directory
layout, replace the mirror bases:

```ts
const packs = createWebFontPacks({
  mirrors: ['https://fonts.example.com/npm', 'https://backup.example.com/npm']
});
// e.g. /npm/@fontsource/carlito@5.2.6/files/carlito-latin-400-normal.woff2
```

Self-hosting subset selection uses the same `unicode.json` index and `files/`
directory for the pinned package, along with the full face for fallback.

Arbitrary file layouts use custom `PreviewFontPack` manifests. Supply accurate
`traits`, optional Unicode `coverage`, and CSS `descriptors` for each face. Fonts
with unrelated outlines or legacy glyph encodings do not become compatible merely
by sharing a family alias.

### Host fonts, aliases and authorization

```ts
import type { PreviewFontAsset, PreviewFontResolver } from '@filens/core';

const book: PreviewFontAsset = {
  id: 'company-book-v3-regular',
  fontFamily: 'Company Book',
  traits: { serif: true, style: 'text', weight: 400 },
  descriptors: { weight: '400', style: 'normal' },
  sources: [
    { url: '/fonts/company-book-v3.woff2', priority: 0 },
    { url: 'https://fonts.example.com/company-book-v3.woff2', priority: 1,
      credentials: 'include', headers: { Authorization: fontAccessToken } }
  ]
};
const fontResolver: PreviewFontResolver = ({ fontFamily }) =>
  fontFamily === 'Original Book'
    ? { fontFamily: book.fontFamily, assets: [book] }
    : undefined;
const previewer = createPreviewer(mount, {
  fontLoading: { packs: [] }, fontResolver
});
```

An asset may supply `data: ArrayBuffer | Uint8Array` instead of sources, for
example bytes read from a host-selected local file. No upload is involved.
`fontResolver` remains synchronous; it supplies already known aliases/manifests,
and the loader handles fetching and decoding afterward. Return stable asset
objects to share inflight loads across sessions. An alias to an already available
family also triggers layout refresh without a download.

### CAD SHX sidecars

Select the DXF or DWG and its `.shx` files together in the demo or packaged
browser preview. A host can supply the same files through
`createFileSetResourceResolver(files)` or return bytes, a file, or an explicit
URL from `resourceResolver` for requests with `family: 'cad'` and
`relation: 'font'`. Extensionless CAD references such as `txt` look up `txt.shx`.
The drawing's file references do not trigger network requests on their own.

FiLens draws horizontal text from AutoCAD-86 `shapes` 1.0/1.1, `unifont` 1.0,
and `bigfont` 1.0 files as SVG strokes, including arcs and scaled Big Font
primitives. Non-ASCII glyphs in legacy SHX files use a supported drawing code
page. Supported East Asian mappings include Shift JIS, GBK, Big5, and EUC-KR.
Explicit `fontResolver` aliases take precedence. When a text entity has a missing
glyph, a missing or unreadable sidecar, or an unsupported writing mode, it stays
readable as browser text and the preview reports the fallback. Vertical SHX
layout and other legacy encodings have partial coverage.

### Routing, retry and fallback

Lower source `priority` wins among healthy sources. Within a priority, the loader
uses an exponentially weighted moving average of successful request/decode times,
origin latency, and failure penalties. Same-origin sources have a cold-start
preference; measured faster mirrors can supersede it. There are no global probes
or HEAD requests. When a route is still pending after `hedgeDelayMs`, one alternate
healthy source starts. The first successfully decoded face wins and cancels the
loser; a cancelled slow request contributes a latency lower bound, not a failure.
This adapts to observed routes; it cannot guarantee the global fastest network path.

Each asset has a total time budget and a bounded number of attempts, including
hedged requests. Downloads, body reads and decoding respect time limits. Network,
CORS, HTTP, decode and oversized-response failures try healthy alternatives before
waiting. Failed routes use exponential backoff with jitter (0.75–1.25), respect
`Retry-After`, and cool down at least five minutes after 401/403/404/410. The budget
ends an attempt sequence when the next cooldown would take too long. Concurrency
limits font jobs per preview, and a job has at most two active mirror requests.
Failure leaves the readable preview and local CSS fallbacks active, with a font
warning rather than a document error. Navigation events do not restart exhausted
font jobs for that document; later documents can retry using shared route health.

Fetch uses CORS, `credentials: 'omit'`, no referrer and the browser HTTP cache
(`force-cache`) by default. Host sources may explicitly provide credentials and
headers. Cross-origin hosts must allow the corresponding CORS requests. Versioned
URLs provide cache isolation; there is no additional persistent font database or
service worker. No document text or local coverage sample is placed in font
requests, URLs or diagnostics. Loader warnings omit source URLs and authorization.

### DOCX embedded fonts

DOCX preview loads internal TrueType and OpenType font parts, including Word's
GUID-obfuscated files. It preserves regular, bold, italic and bold italic faces
and applies them to direct, inherited, theme and symbol font references. The
first preview opens with fallback fonts while the browser decodes embedded
faces. Each preview registers its own CSS families, so another document can
embed different data under the same source name. These loads are independent of
the optional `fontLoading` setting.

DOCX honors OS/2 `fsType` for preview use. Restricted embedding, bitmap-only
embedding and missing permission metadata leave the fallback active, as do
missing, corrupt, external or unsupported font parts. FiLens uses permitted
fonts within the preview and releases them on replacement, cancellation or
close. A registered face establishes family availability. Glyph coverage still
depends on the embedded face and browser.

### PPTX embedded fonts

PPTX follows internal font relationships from `p:embeddedFontLst` in the
presentation. It loads single-face SFNT TTF/OTF and EOT, including XOR-wrapped
and MTX-compressed parts, in their authored regular, bold, italic and bold
italic variants. The first slide appears before font decoding completes. A font
with restricted embedding, bitmap-only permission or a web binding keeps its
fallback. External and unreadable parts also keep the fallback. An enabled
optional loader can try a substitute when an embedded family fails to load.

The native Viewer and generic preview share this path. After the browser
registers an embedded face, mounted slides recalculate font-dependent layout
and retain their page, scale and scroll. Legacy Vue thumbnails refresh with the
same faces. Each preview releases its fonts when replaced, cancelled or closed.
MTX decoding runs in a short-lived browser worker with a WASM memory limit and
a timeout. The decoder and fonts work offline. [Browser regression](../apps/demo/e2e/pptx-fonts.e2e.ts)

The MTX decoder uses libeot 0.0.4. Rebuild or verify the checked-in WebAssembly
with `WASI_SDK_PATH=/path/to/wasi-sdk node scripts/build-pptx-font-wasm.mjs`
or add `--check` with WASI SDK 27.0. [Source and licenses](../packages/pptx/vendor/libeot/NOTICE.txt)

### Layout refresh and lifetime

PPTX remounts visible slides to recalculate text metrics/autofit. Keynote and Pages
refresh their scenes; Numbers and XLSX rebuild the active table while keeping its
loaded rows. DOCX reuses the parsed document and renders an attached hidden staging
container before swapping it into view. CAD redraws SVG text while preserving
layer visibility and viewport. These paths retain the current page/sheet, supported
zoom and viewport position. A sheet keeps its visible row when fonts change the
row height. PDF fonts remain under PDF.js control.

PPTX, DOCX, XLSX, iWork and CAD preview sessions follow the host page's font
loading events for referenced families and known aliases. They coalesce font
loads before refreshing and keep explicit host mappings. An authored face can
take over from an automatically chosen font pack when the host makes it
available. These refreshes use the faces already registered by the page.

Call `previewer.refreshFonts?.()` after registering an already loaded `FontFace`
or removing a host face with `document.fonts.delete()`. The Vue `Preview` ref
and the object returned by `createPreview()` expose the same method. The method
schedules a refresh for the current document and publishes its updated state
through the usual preview events. The legacy PPTX Viewer also observes relevant
font loads and exposes `refreshFonts()` for an explicit relayout. Host faces
remain available after the preview closes.

Managed `FontFace` objects and inflight requests are leased per document and
configuration object. Replacement, abort and destruction release that preview's
leases; the final owner cancels pending work and removes only its managed faces.
Late responses cannot modify a replacement document. Font loading and optional
refresh errors do not invalidate an already readable preview.

Custom drivers can provide `getFontReferences()` and `refreshFonts(update)`, then
call `bindPreviewFontLoading(session, ownerDocument, options)`. Call its
`reset(signal, sourceFormat)` for each new input and `destroy()` on teardown.
`analyzeLoadedPreviewFonts()` merges load proof with ordinary diagnostics;
`collectSlideFontLoadingReferences()` / `applySlideFontMappings()` preserve original
scene names while collecting variants and applying targets. Font changes can alter
wrapping and pagination; this refresh is not a guarantee of exact Office layout.
Embedded extraction for other Office and iWork drivers, WOFF2 metadata
inspection, custom glyph subsetting and measured candidate-layout comparison
remain future work.

`npm run test:fonts:browser` builds core/XLSX and checks actual Chromium font
decoding, mirror failover, changed text metrics, table replacement, retained rows
and scroll, and managed-face cleanup. It requires Playwright Chromium to be installed.
