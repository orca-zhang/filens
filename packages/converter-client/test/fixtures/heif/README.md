# Synthetic HEIF color references

- 15 static 8/10/12-bit PQ/HLG HEICs with independent full-size `.rgba` goldens.
- Eight static 4:2:0/4:2:2 SDR HEICs with independent full-size `.rgba` goldens.
- Eight VUI-only variants with a `-vui` suffix, sharing the SDR goldens above.
- Primary selection with HLG thumbnails (including deliberately oversized
  thumbnail metadata) and mixed collections.
- Oversized auxiliary alpha metadata.
- P3/linear-ICC 10-bit alpha grids and nested VUI variants, with independent
  straight-alpha RGBA references copied from Photos' synthetic grid-profile corpus.
- `chroma10-444.heic`: a generated 128×96 nonlinear color pattern encoded by
  x265 4.2 at 10-bit 4:4:4, lossless YCbCr, matrix 6 / primaries 1 / transfer 13.
  Its `.rgba` reference was decoded independently with native libheif 1.21.2
  and libde265 1.0.18. The test also pins the bundled decoder to libde265 1.0.18.

These are generated color patches, with no personal image data. `cases.json` records
dimensions and SHA-256 of the independent goldens. References use explicit
ST2084/BT.2100, fixed Hable white at 1000 nits, luminance-coupled HLG OOTF and
xy/XYZ-to-sRGB math. ICC precedence uses a linear-sRGB profile. SDR references
use nearest chroma expansion and explicit full/limited YCbCr conversion. The
tolerance is three byte levels per channel, including alpha. No Filens output
is used to generate a golden. The tests also remove a container `colr` property
without changing codec bytes to exercise PQ/HLG VUI fallback.

Do not decode the oversized metadata cases outside a decoder with explicit
context limits. This corpus does not establish real-camera rendering,
gain-map fidelity or sequence playback. Private real-image regression is opt-in;
see `../../../vendor/libheif/README.md` and the `FILENS_EDITED_APPLE_*` variables in
`heif-color.spec.ts`. Personal images are never copied into this corpus.
