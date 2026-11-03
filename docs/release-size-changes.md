# Release size changes: v0.6.1

Measured 2026-11-03. All tables use MiB (1,048,576 bytes). Compare the exact published v0.6.0 preview/SDK artifacts and CLI 0.5.0 with current candidates. Download compression and installed file bytes are separate; filesystem overhead and caches are excluded.

| Artifact | Previous download | Current download | Change | Previous installed | Current installed | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| browser-split | 3.49 | 3.56 | +2.1% | 11.99 | 11.38 | -5.0% |
| browser-all-in-one | 3.50 | 3.58 | +2.2% | 9.71 | 9.00 | -7.4% |
| npm | 6.98 | 7.14 | +2.3% | 21.72 | 20.40 | -6.1% |
| source-sdk-ios | 3.51 | 3.59 | +2.2% | 12.02 | 11.43 | -5.0% |
| source-sdk-android | 3.51 | 3.59 | +2.2% | 12.02 | 11.42 | -5.0% |

Runtime rows exclude notices, HTML and archive sidecars. Compression uses gzip level 9 and Brotli quality 11; actual HTTP transfer depends on the server.

| Main runtime | Raw MiB before / after | gzip MiB before / after | Brotli MiB before / after |
| --- | ---: | ---: | ---: |
| split | 10.71 / 10.06 | 3.11 / 3.18 | 2.45 / 2.54 |
| all-in-one | 8.44 / 7.68 | 3.10 / 3.18 | 2.77 / 2.88 |

| CLI platform | Executable before / after | Lite installed before / after | Full installed before / after |
| --- | ---: | ---: | ---: |
| darwin-arm64 | 2.17 / 2.17 | 8.05 / 7.86 | 31.25 / 31.06 |
| linux-x64 | 1.90 / 1.90 | 7.78 / 7.59 | 36.74 / 36.54 |
| linux-arm64 | 1.80 / 1.79 | 7.68 / 7.48 | 31.10 / 30.91 |
| win32-x64 | 1.82 / 1.82 | 7.70 / 7.51 | 36.48 / 36.29 |

## Savings from this review

The published release predates HEIF color handling and optional browser video recovery. Those additions still increase compressed preview downloads. Compare the same current source before and after optimization to isolate the savings below.

| Measurement | Before review | Final candidate | Change |
| --- | ---: | ---: | ---: |
| singleJs | 8.98 | 7.68 | -14.5% |
| previewDownload | 7.46 | 7.14 | -4.3% |
| previewInstalled | 23.00 | 20.40 | -11.3% |
| iworkDownload | 2.29 | 1.48 | -35.7% |
| iworkInstalled | 9.95 | 3.52 | -64.6% |

Optimizations: compact final standalone JS without changing the existing chunk graph; gzip level 9 for CLI resources; protobuf interface types instead of huge literal declarations; omit debug maps and their references from production module tarballs. Local builds retain their maps. Mobile SDKs remain source SDKs with offline assets, rather than AAR/XCFramework binaries.

share-front review: FiLens already carries the current canonical Media Engine inputs, including binary-search keyframe lookup and bounded range reads. Ported playback position, paused state, volume, mute and speed continuity at native-to-MSE recovery. No new runtime dependency. Receiver reconnect-specific deadlines and additional audio codec plugins remain outside this adapter.

[Exact byte deltas](release-size-changes.json) · [Runtime measurements](preview-build-sizes.json) · [CLI measurements](agent-cli-npm-release.json).

Reproduce current comparisons: `npm run report:release-size-changes`. The optional script argument records a saved before-review measurement directory; the report retains that snapshot for later regeneration.
