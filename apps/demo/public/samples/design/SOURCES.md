# Native design file sources

The gallery contains twelve project-authored design studies: six native PSD files,
two native PSB files, two PDF-compatible AI files, one EPS and one two-page PS file. Previews load those original
binary files through the shared frontend WASM conversion core. WebP files are
gallery thumbnails only. No SVG sidecar or external image request is used to
display a document.

PSD/PSB samples are valid flattened 8-bit RGB Photoshop documents with saved
composite pixels, not layered templates. The decoder also accepts compatible
uploaded RGB/grayscale files with raw, PackBits RLE, ZIP and ZIP-prediction
compression. It displays the saved composite; layer editing, 16/32-bit color,
CMYK/Lab and custom color-profile processing are outside this preview path.
Save with Photoshop's Maximize Compatibility option enabled.

AI samples are project-authored PDF-compatible artwork generated with Chromium's
vector PDF writer, not Adobe-authored proprietary editing documents. Their paths
and type remain vector content. The WASM core retains those PDF bytes exactly,
and the PDF viewer renders again at each zoom level. EPS, PS and legacy PostScript AI use the compact on-demand WASM interpreter
to produce vector PDF. EPS uses its bounding box; PS preserves multiple pages.
Standard PDF fonts and document-embedded fonts are supported. Resident font
outlines and automatic font substitution are omitted; documents needing them
(such as resident-font `charpath`) fail explicitly. This is a preview subset,
not complete Illustrator or Ghostscript compatibility.

Generate them with `node scripts/generate-photoshop-samples.mjs` (Playwright
Chromium required). The script downloads the three licensed photographs below
into an OS temporary cache; the original photo files are not bundled separately.
Regenerate only EPS/PS files and thumbnails without those downloads with
`node scripts/generate-photoshop-samples.mjs --postscript-only`. EPS/PS authoring
programs are in `scripts/postscript-samples.mjs`; no font outline files are bundled
with those documents.

## Project-authored work

The layouts, copy, vector shapes, coffee-package illustration and unbranded
trainer illustration were created for this project and use the project MIT
license. No existing PSD template or third-party brand identity was copied.
All twelve names are fictional demo identities;
prices and product descriptions are fictional design copy, not real sales offers
or claims about the photographed products. No affiliation or endorsement is
asserted. The shoe illustration has no third-party logos.

Raster Photoshop artwork uses installed Arial/Helvetica and Georgia/Times New
Roman font families; only rendered pixels are distributed. Vector AI artwork
embeds subsets of DM Sans and Lora under the SIL Open Font License 1.1. Their
licenses are bundled as [OFL-DMSANS.txt](OFL-DMSANS.txt) and
[OFL-LORA.txt](OFL-LORA.txt); sources are
<https://github.com/google/fonts/tree/main/ofl/dmsans> and
<https://github.com/google/fonts/tree/main/ofl/lora>.

| Original file | Study | Encoding |
| --- | --- | --- |
| `still-form.psd` | Skincare campaign | PSD v1 / RLE |
| `pace-store.psd` | Sneaker launch | PSD v1 / RLE |
| `sunday-roast.psd` | Coffee branding | PSD v1 / RLE |
| `mono-sound.psd` | Headphone product page | PSD v1 / RLE |
| `terra-studio.psd` | Interior editorial | PSD v1 / RLE |
| `bloom-market.psd` | Flower shop poster | PSD v1 / ZIP |
| `after-hours.psb` | Music festival identity | PSB v2 / RLE with 32-bit row lengths |
| `alpine-journal.psb` | Outdoor travel editorial | PSB v2 / RLE with 32-bit row lengths |
| `forma-identity.ai` | Brand identity | PDF-compatible vector artwork |
| `kinfolk-menu.ai` | Restaurant menu | PDF-compatible vector artwork |
| `orbit-marks.eps` | Vector brand identity | EPS with nonzero bounding-box origin, no showpage; vector paths and standard PDF font names |
| `studio-editions.ps` | Print design | Two-page PostScript with vector paths and standard PDF font names |

## Photography licensed separately

The photographs retain their original rights and the **Unsplash License**;
embedding them in a Photoshop document or thumbnail does not relicense them under MIT. The
license permits downloading, copying, modifying, distributing and commercial
use. It prohibits selling images without significant modification and compiling
them into a similar or competing image service. Attribution is not required by
the license; exact asset URLs are provided here for traceability.

License source: <https://unsplash.com/license>, checked 2026-11-03. The quoted
license and usage conditions are also bundled in [UNSPLASH-LICENSE.txt](UNSPLASH-LICENSE.txt).
All photos below use the free `images.unsplash.com/photo-…` source; no Unsplash+
asset, watermarked image, or photo downloaded from a search-result thumbnail is used.

| Design / thumbnail | Embedded photograph | Source |
| --- | --- | --- |
| `still-form.psd`, `still-form.webp` | Amber bottle on a pedestal with window shadows | [Unsplash asset photo-1608571423902-eed4a5ad8108](https://images.unsplash.com/photo-1608571423902-eed4a5ad8108) |
| `pace-store.psd`, `pace-store.webp` | None; project-authored unbranded trainer illustration | Project MIT license |
| `sunday-roast.psd`, `sunday-roast.webp` | Coffee beans, cropped into a circle behind the original package illustration | [Unsplash asset photo-1447933601403-0c6688de566e](https://images.unsplash.com/photo-1447933601403-0c6688de566e) |
| `mono-sound.psd`, `mono-sound.webp` | Headphones on a desk, cropped into the product panel | [Unsplash asset photo-1546435770-a3e426bf472b](https://images.unsplash.com/photo-1546435770-a3e426bf472b) |

The other nine designs contain project-authored shapes and typography only.

The three photos were resized and embedded in the original layouts; they were
not generated by AI. The Unsplash license concerns the photographs and is not a
blanket clearance for trademarks, depicted product designs, or other third-party
rights. These files are supplied as fictional preview examples, not as a
clearance for a real product advertising campaign.
