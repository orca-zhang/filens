# @filens/cad

Browser-native CAD preview driver for the filens multi-format preview runtime.

## Current Scope

The package currently parses supported DXF drawings directly in the browser and renders them as SVG. It covers common geometry, text, blocks, dimensions, fills, raster references, drawing bounds, layers, colors, line types, and line weights, with explicit warnings for unsupported or unresolved content.

This direct path does not require a desktop CAD application, native conversion process, or remote conversion server. The optional `converter-cad.wasm` reader decodes DWG directly into a drawing model consumed by the same SVG renderer, without generating or reparsing DXF. Configure `createWasmConverterClient({ wasm, cadWasm })`; the demo and bundled browser preview include it automatically. `graphicsWasm` remains a compatible combined-engine fallback. DWG provides a partial 2D preview; complex entities, proxy objects, xrefs and SHX fonts may be simplified or omitted. DGN remains unavailable.

The reader supports R14 through AC1032 (the 2018 DWG file format, also used by newer CAD applications). Tests cover 13 drawings across AC1014, AC1015, AC1018, AC1021, AC1024, AC1027 and AC1032. File-format versions describe the saved file, rather than the application's release year. R12 is unsupported and R13 is unverified on this reader. Repeated block definitions are cached; model/paper-space content, placed attributes, dimension blocks, layers, colors and common geometry are retained. Visible constant attributes are rendered; invisible metadata and variable attribute templates are omitted. RAY/XLINE geometry is recovered from the native reader's properties. Multi-leaders, CAD tables, ACIS solids and some proxy objects remain partial or unavailable, with diagnostics. See the [DWG audit](../../docs/dwg-preview-optimization.md).

See the root [support matrix](../../docs/support-matrix.md) for detailed coverage and limits.

## CAD Conversion Lineage

The CAD conversion work and SVG-first preview direction are derived from [`orcastor/cad2x-converter`](https://github.com/orcastor/cad2x-converter), an LGPL-2.1-licensed, compact DXF/DWG converter derived from LibreCAD. cad2x supports DXF/DWG input and DXF/PDF/PNG/SVG output, including practical handling for fonts, code pages, paper sizing, fitting, and scale.

filens builds on that experience with a separate pure-browser DXF parser and SVG renderer for supported drawings. The current DWG preview uses the MIT-licensed cadkit reader in the shared frontend WASM core. Explicit DWG-to-DXF export remains available through the same core; previews use the direct drawing model. A host can still add a cad2x-style route for print-oriented PDF output, PNG thumbnails or broader CAD compatibility.

## Architecture Boundary

- CAD parsing and rendering stay in the front-end package or front-end WASM modules.
- Backend wrappers may host the same conversion core, but must not introduce a separate format-specific conversion implementation.
- Unsupported content produces warnings or an explicit host fallback instead of silently pretending to render correctly.
