# Converter WASM size attribution

The combined `converter-core-full.wasm` retains all conversion routes, application
icons and modern/legacy Office decryption in one WASM. Its current size is
**476,846 bytes gzip / 386,568 bytes Brotli**, down from **542,228 / 427,685**
before optimization. The preferred approximately 300 KB target has **not** been
reached. KB here means 1,000 bytes; the old 308,888-byte figure used Brotli and
corresponded to 381,175 bytes gzip before the recent functionality additions.

## Combined build optimization

| Stage | Raw bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| Before optimization, same full functionality | 1,220,359 | 542,228 | 427,685 |
| Share miniz and quick-xml; converge Binaryen | 1,122,703 | 496,055 | 397,043 |
| Share ZIP readers | 1,104,698 | 487,990 | 390,766 |
| Share XML rewriting and OpenXML normalization | 1,098,906 | 486,074 | 390,245 |
| Use ASCII case conversion for ASCII markers/format names (current) | 1,078,852 | 476,846 | 386,568 |

The ZIP `deflate-flate2` feature shares the existing miniz backend used by PNG,
instead of also linking zopfli and zlib-rs. The core shares quick-xml 0.41 with
the Office dependency. Files and decrypted in-memory packages now use one ZIP
reader type, and XML rewriting uses a shared non-generic loop. ASCII-only
heading markers and format names no longer need full Unicode case conversion;
Unicode text and heading-letter classification remain supported. Document/Office
artifacts use Binaryen `-Oz --converge`; the image engine retains `-O3`.

These changes save **65,382 bytes gzip (12.1%) / 41,117 bytes Brotli** without
removing formats or encryption algorithms. A comparison of all **306 controlled
conversion fixtures** found identical decompressed OpenXML members, identical
PNG scanlines and non-IDAT chunks, and identical other output bytes. ZIP/PNG
compression bytes may differ. Generated outputs in that fixture set total
632,050 bytes versus 636,167 before optimization (0.65% smaller).
[Validation report](converter-monolithic-validation.json).

Compact RustCrypto AES/SHA-2 backends were measured but not adopted. On the
first-stage source they saved about 5 KB gzip combined; the SHA-2 option made
the local cached-module Agile DOCX password test about 46% slower (28.66 to
41.87 ms median). This is a local Node/V8 test, not a cross-device performance
claim. [Size experiment](converter-crypto-size.json),
[timing experiment](converter-crypto-benchmark.json).

The measurements do not establish a minimum possible size. Reaching approximately
300 KB with all current functionality requires further work beyond the adopted
dependency and parser sharing. The analysis build without icons and without the
Office handler still measures 346,461 bytes gzip / 287,497 bytes Brotli; this is
an attribution probe, not a proposed product configuration.

## Production artifacts and attribution

All counts below use the current source, Rust release profile, Binaryen
`-Oz --converge`, gzip level 9 and Brotli quality 11.

| Artifact or analysis variant | Raw bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| production core (Office detection only) | 916,303 | 412,942 | 335,464 |
| optional Office decrypt-only module | 379,079 | 163,967 | 130,417 |
| combined core (all-in-one alternative) | 1,078,852 | 476,846 | 386,568 |
| without application icons | 1,018,601 | 450,070 | 363,631 |
| without application icons or Office decryption | 772,569 | 346,461 | 287,497 |

The complete Office handler contributes approximately **103,609 bytes gzip /
76,134 bytes Brotli** in this same-source comparison. `msoffice-crypto` provides
AES, hashing, CFB and legacy RC4/XOR support. Application icon extraction adds
approximately **26,776 bytes gzip / 22,937 bytes Brotli**. Locale dictionaries
live in the Vue/JS host and do not contribute to WASM size. The optional image
engine is measured separately.

## Optional split deployment

The existing split preview loads `converter-office.wasm` only after an encrypted
Office document has a supplied password. The core retains detection, password
prompts and input/work limits. The addon returns decrypted bytes to the same
core for conversion. Parsing and cryptography stay in frontend Rust/WASM;
TypeScript and Go route WASM results and input/output bytes.

Ordinary converted previews save **63,904 bytes gzip / 51,104 bytes Brotli**
compared with the combined core. The optional module is fetched once per client,
shared across concurrent conversions and reused for password retries. Failed loads
can be retried; cancellation does not break subsequent conversions. An omitted
addon returns `engine_unavailable` with `requiredModule: "office"` after password
submission; ordinary conversion and missing-password prompts still work.

Loading both modules costs **100,063 bytes gzip / 79,313 bytes Brotli** more than
the combined core because runtime, CFB and detection code overlap. The all-in-one
preview uses `converter-core-full.wasm` and omits the addon. Hosts can also use
that combined core directly without an Office companion. Native/text CLI builds
retain integrated crypto through the default `office-crypto` feature; the slim
production build uses `--no-default-features`.

## Reproduce

```sh
npm run build:wasm
npm run report:converter-size-impact
```

[Current exact measurements](converter-size-impact.json). The first three rows
measure production artifacts. The last two use a temporary source tree with icon
dispatch/manifest entries removed and then the Office handler stubbed. Small
path-related codegen differences are possible. No production artifact is replaced.

[Dependency experiment snapshot](converter-monolithic-size.json) and
[parser optimization stages](converter-parser-size.json) record the earlier
stages. `npm run report:converter-monolithic-size` repeats the dependency
comparison against the source at the time of execution.

## 中文说明

不拆包的完整核心已从 542 KB gzip / 428 KB Brotli 缩到 **477 KB gzip /
387 KB Brotli**，保留全部转换、安装包图标和现代/旧版 Office 解密。
此前约 300 KB 的历史数字是 Brotli 体积，对应 gzip 约 381 KB；当前仍未达到
约 300 KB 的目标。本次缩减来自依赖和解析器去重，没有采用会明显降低本机
密码测试速度的小体积 SHA-2 实现。分包方案仍可选；单文件预览使用合并核心。
