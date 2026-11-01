# Default truck STEP recheck / 默认 truck STEP 复测

Apple M4 Pro, Chromium 147.0.7727.15, seven paired reads per file. The final rotating group
contains 126 reads: 42 current truck, 42 upstream OCCT and 42 previous JSON truck
reads. All six files have a stable lead over occt-import-js 0.0.23 after lossless
binary Float32 mesh transport. `as1-oc-214.stp` falls from 278.9 to 224.2 ms,
versus OCCT at 243.8 ms. The 42 JSON engineering reads are excluded from cumulative
peer measurement totals; current reads are counted once. All six pass the independent
approximate geometry screen. These are scoped geometry-import results, excluding
network, WASM compilation, scene construction and drawing.

- [Initial JSON measurements](step-default-json-baseline.json.gz) and
  [initial summary](step-default-json-baseline-summary.json), preserved before the optimization.
- [Raw measurements](step-default.json.gz), compressed JSON.
- [Summary](step-default-summary.json), including input/artifact SHA-256 hashes,
  triangle counts, geometry checks, initialization-inclusive read totals and
  paired bootstrap 95% ratio intervals.
- [English analysis](../../../docs/performance-comparison.md#step-default-truck-geometry-import)
  / [中文说明](../../../docs/performance-comparison.zh-CN.md#step默认-truck-几何导入).

Reproduce from the repository root:

```sh
npm ci
# Prepares the pinned public corpus and three-mesh-bvh geometry-check tools.
node benchmarks/rust-engines/prepare.mjs
npm run build:step
node scripts/benchmark-step-default.mjs
npm run build:converter-client
# Checks binary transport against the core's retained JSON diagnostic route.
node scripts/test-step-binary.mjs

# Default demo and standalone sizes; includes checks that OCCT is absent.
npm run build:vercel
npm run report:bundle-sizes
npm run build:preview
node scripts/package-preview-npm.mjs --no-build
```

The benchmark writes to the current Asia/Shanghai date directory. Source package
measurements are local candidates; these commands do not publish to npm.

To repeat the old/new engineering comparison, retain the previous matching
reader/core before rebuilding: `baseline-reader.mjs` and `baseline.wasm` under
`tmp/step-assembly-opt/`. The recorded JSON baseline WASM hash is
`d192785227f33bbb3ab135dabfe80ea936e5e2f18f42b9478271bc51d2ff5aa6`.
Run `node scripts/benchmark-step-default.mjs --baseline=tmp/step-assembly-opt`
and `node scripts/test-step-binary.mjs tmp/step-assembly-opt/baseline.wasm`.
The release report requires this previous-core comparison to retain the link to
the earlier normal-fallback regression; a same-core ABI check alone is insufficient.

本次用当前浏览器 `createStepReader` 复测，不沿用旧 OCCT 实现的速度。
truck 计时包含 WASI 实例、解析、三角化、二进制 Float32 网格传递及类型数组检查；
OCCT 初始化另列。两者采用 0.1 mm 容差，三角化结果不同，不能解释为完整网格、
材质或元数据等价。几何筛查不是最大误差保证，更广语料仍有 1/44 个已知差异。

The binary/JSON geometry preservation check covers all 44 embedded-solid inputs
and 11 external-only rejections: [exact-output evidence](../../../docs/assets/rust-engines/binary-transport-regression.json).
