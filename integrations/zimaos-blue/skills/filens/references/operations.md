# Inspection, preview, similarity and conversion

## Identify actual file content

```sh
filens inspect '/path/unknown.bin' --json
```

`inspect` (CLI 0.5.6+) reports `inspection.format`, `mime`, `evidence`, `confidence`, `reason`, `extensionMatches`, `fileBytes` and `bytesRead` from the shared WASM content detector. JSON requests use `{"op":"inspect","input":"/path/unknown.bin","format":"json"}`. It reads at most 256 KiB, accepts large local files without copying the whole input, and does not run OCR or extraction. Do not pass extraction, page or OCR options. `format:null` or `extensionMatches:null` means unresolved/ambiguous evidence; an unknown signature or text-only result is not a failure or proof of corruption. A recognized format is not full-file validation. Never silently rename the source based on inspection.

## Open a local preview

`filens preview '/path/report.pdf'` creates an offline HTML containing the source and viewer, opens it and exits. `--output report-preview.html --no-open --json` exports without launching a browser; `--mode serve` uses a loopback HTTP server. Offline release bundles include the viewer; other installs can run `filens setup-preview` once in advance. Preview is a visual rendering path; use `read` or `layout` for evidence and structured text. The same file may have different preview, reading and conversion coverage.

## Find duplicate files and similar image variants

Check `capacity.operations` for `similar`; older builds may lack it. Current Full and Lite bundles include it without OCR or model setup.

```sh
filens duplicates '/path/files' --json
filens similar-images '/path/photos' --threshold 8 --json
```

The aliases return `op: "similar"`. JSON requests use `{"op":"similar","input":"/path/photos","similarityMode":"images","threshold":8}`; mode is `images` (default) or `duplicates`. Full SHA-256 identifies duplicate files after size/prefix filtering. Perceptual image hashes identify possible variants, including different dimensions and compression, for JPEG, PNG, WebP, GIF, BMP and TIFF. This does not compare near-duplicate document text or retrieve different photos by semantic subject.

Use `similarity.groups[].files` and resolve member paths relative to the absolute `source.path`. Image groups have a `reference`; each `distanceToReference` is within `threshold` (0–24, default 8, lower is stricter). Distance is not confidence, and zero perceptual distance does not prove identical files. Groups are disjoint reference matches; not all member pairs are necessarily within the threshold. Review images before treating a match as an interchangeable copy.

Inspect `similarity.complete`, `truncated`, `scan` and `processing`; errors and budgets retain groups with exit 3. Defaults are 2000 candidate files, depth 32 and 100 returned groups; use `--max-files` (max 20000), `--max-depth` (max 256), `--max-results` (max 1000), `--include-hidden` and `--timeout` to adjust scope. Hidden names and the same fixed directory exclusions as search apply. Scans do not follow symbolic links. Unix hard-link aliases are skipped; Windows currently retains them. Images use EXIF orientation and the first frame, with transparent pixels composited on white. Duplicate hashing has a 16 GiB total read budget; images are limited to 32 million pixels and 32768 per side.

Scans only report groups. Their results do not authorize deleting, moving or replacing source files. Similarity fingerprints are recomputed; search-cache flags, `--query` and `--layout` do not apply.

## Convert files

Use `capacity.conversionPairs` from the running build to select an actual source/target pair. The same frontend WASM conversion engines perform parsing, conversion and output validation. Typical routes include legacy Office/OpenDocument/text to OpenXML, CSV/JSON to XLSX, RAW camera files to JPEG and ICNS to PNG. Do not promise arbitrary conversions such as DOCX to PDF.

```sh
filens convert '/path/report.doc' --output '/path/report.docx' --json
filens convert '/path/data.csv' '/path/data.xlsx'
filens convert '/path/photo.dng' --to jpg
```

The output extension infers the target; `--to` / `--target` selects it explicitly and derives an output path if omitted. `--from` / `--source` overrides the input extension. `--format` selects response serialization, not the converted file format. JSON is the default conversion response.

For programmatic conversion, pipe a request such as:

```json
{"op":"convert","input":"/path/report.doc","output":"/path/report.docx","format":"json","options":{"locale":"zh-CN"}}
```

An existing destination requires `--force` or `force:true`; use it only when replacing that file is within the user's request. The input itself cannot be the output. Failed or canceled conversions leave the destination intact. Inspect `ok`, `output.path`, and `conversion.warnings` / `conversion.fidelity`; lightweight conversion can omit source features. Exit codes retain the same 0/1/2/3 categories; `error.code` preserves the core's specific failure. Read the converted document if its contents need further verification or reasoning.
