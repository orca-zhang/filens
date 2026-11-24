# Shared converter assets

This directory contains data shared by the Rust/WASM converter and Agent CLI:

- `text-formats.json` is the input catalog embedded by the Rust text WASM core.
- `rapidocr/models.json` and `rapidocr/runtime.json` pin OCR models and native
  runtime downloads used by the Rust CLI packaging scripts.
- `rapidocr/testdata/` supplies OCR and document regressions for CLI tests,
  benchmarks, and integrations.

Parsing, extraction, conversion, and OCR policy live in the Rust/WASM core.
