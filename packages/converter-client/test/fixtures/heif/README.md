# Synthetic HEIF color references

- 15 static 8/10/12-bit PQ/HLG HEICs with independent full-size `.rgba` goldens.
- Eight static 4:2:0/4:2:2 SDR HEICs with independent full-size `.rgba` goldens.
- Eight VUI-only variants with a `-vui` suffix, sharing the SDR goldens above.
- Primary selection with HLG thumbnails (including deliberately oversized
  thumbnail metadata) and mixed collections.
- Oversized auxiliary alpha metadata.

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
gain-map fidelity, sequence playback or grid color inheritance.
