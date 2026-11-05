Original Filens graphics samples, distributed under the repository's MIT license.

- `field-notes.tiff`: two RGB pages, Adobe Deflate compression, 1200 × 800.
- `tonal-ramp-16bit.tif`: 16-bit grayscale tonal ramp, LZW compression, 768 × 512.
- `texture-study.tga`: RLE RGBA texture with transparent corners, 1200 × 800.
- `portable-color.pnm`, `portable-gray.pgm`, `portable-ink.pbm`: color, grayscale and monochrome artwork.
- `surface-atlas.dds`: DXT1 compressed texture, 1024 × 512.
- `studio-light.hdr`: floating-point Radiance RGBE lighting study, 256 × 128.
- `filens-cafe-2000.dwg`, `filens-cafe-2018.dwg`: original cafe floor plan in DWG R2000 and R2018, derived from `../filens-cafe.dxf` using acadrust 0.6.8.

Rebuild raster samples: `python3 scripts/generate-graphics-samples.py` (Pillow).
Rebuild CAD samples: `cargo run --manifest-path wasm/converter-core-rust/Cargo.toml --no-default-features --features graphics-preview --example generate-cad-samples`.

Previews use the original files. TIFF currently shows the first page; DWG uses a local WASM conversion to UTF-8 DXF and the existing 2D CAD renderer.

Additional original samples (`python3 scripts/generate-more-graphics-samples.py`):

- `color-archive.dib`, `color-archive.pcx`, `indexed-archive.pcx`: headerless bitmap, RGB PCX and 64-color indexed PCX, 900 × 600.
- `studio-pointer.cur`, `studio-pointer-bmp.cur`: PNG-backed and bitmap-backed RGBA cursors, 64 × 64, hotspot (8, 5).
- `linear-light.exr`: half-float linear RGB artwork; previews apply the sRGB transfer function.
- `color-archive.jxl`, `color-archive.qoi`, `color-archive.ff`: lossless JPEG XL, QOI and 16-bit Farbfeld versions, 900 × 600.
- `color-archive.heic`, `color-archive.heif`: lossless HEVC still image in HEIF containers (extension aliases), 900 × 600. These exercise the existing media decoder.
- `color-archive.jpeg`, `shape-study.svg`: existing browser-image routes, with real JPEG and original vector samples.

The extended generator requires Pillow, ImageMagick, `cjxl` and `heif-enc`. All artwork is original and uses the same MIT license. EXR previews use the default image/color channels; JXL shows the first frame; CUR ignores the hotspot. Raster previews are 8-bit and omit print profiles and full HDR range.
