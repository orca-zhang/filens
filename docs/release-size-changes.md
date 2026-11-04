# Release size changes: v0.6.3

Measured 2026-11-04. All tables use MiB (1,048,576 bytes). Compare the exact published v0.6.0 preview/SDK artifacts and CLI 0.5.0 with current candidates. Download compression and installed file bytes are separate; filesystem overhead and caches are excluded.

| Artifact | Previous download | Current download | Change | Previous installed | Current installed | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| browser-split | 3.49 | 4.31 | +23.4% | 11.99 | 13.81 | +15.2% |
| browser-all-in-one | 3.50 | 4.20 | +19.8% | 9.71 | 9.84 | +1.3% |
| source-sdk-ios | 3.51 | 4.33 | +23.4% | 12.02 | 13.85 | +15.2% |
| source-sdk-android | 3.51 | 4.33 | +23.4% | 12.02 | 13.85 | +15.2% |

Runtime rows exclude notices, HTML and archive sidecars. Compression uses gzip level 9 and Brotli quality 11; actual HTTP transfer depends on the server.

| Main runtime | Raw MiB before / after | gzip MiB before / after | Brotli MiB before / after |
| --- | ---: | ---: | ---: |
| split | 10.71 / 12.46 | 3.11 / 3.92 | 2.45 / 3.05 |
| all-in-one | 8.44 / 8.50 | 3.10 / 3.79 | 2.77 / 3.49 |

| CLI platform | Executable before / after | Lite installed before / after | Full installed before / after |
| --- | ---: | ---: | ---: |
| darwin-arm64 | 2.17 / 2.20 | 8.05 / 8.64 | 31.25 / 31.87 |
| linux-x64 | 1.90 / 1.93 | 7.78 / 8.38 | 36.74 / 37.34 |
| linux-arm64 | 1.80 / 1.82 | 7.68 / 8.27 | 31.10 / 31.70 |
| win32-x64 | 1.82 / 1.85 | 7.70 / 8.29 | 36.48 / 37.07 |

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
