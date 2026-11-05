# DSH Desktop installation, Office and PDF preview

[Animated WebP](install-and-preview.webp) · [GIF](install-and-preview.gif) · [Full MP4](install-and-preview.mp4) · [Recording evidence](demo-recording.json) · [Office timings](office-preview-benchmark.json) · [PDF timings](pdf-preview-benchmark.json)

Recorded on **2026-11-05**, using the installed **DeepSeek Harness Desktop 0.2.1-rc.5**, Electron **44.7.0**, macOS arm64 and the public npm package **dsh-filens@0.1.3**. The installed CLI is **0.5.6** and the shared preview runtime is **0.3.4**, registering **450 extensions**. All work used isolated temporary DSH profiles, with no model calls or changes to the normal user profile.

The recording shows the actual Desktop installer using its **default installation source**: Plugins → Add plugin → `dsh-filens@0.1.3` → Install → Enable now. It then opens Word, switches Excel worksheets and presents all three PPT slides in actual fullscreen: click the slide to focus, use **Page Down**, then **Esc** to return to DSH. For the reverse direction, use **Page Up**. The visible pointer and bilingual captions are recording annotations. Download waits and workspace setup are cut; the retained actions play at their recorded speed. The edited recording is not a speed benchmark.

中文：演示使用默认安装源，包含真实桌面安装、立即启用、Word 预览、Excel 工作表切换，以及 PPT 全屏翻页和 Esc 退出。全屏后点击画面，再用 **Page Down / Page Up** 翻页。下载等待与工作区准备已剪去，字幕与鼠标标记为录制注释；速度对比单独测量。

README embeds **25 fps, full-color animated WebP** at 960 px wide. The GIF alternative also runs at **25 fps**, with a separate adaptive 256-entry palette per scene and Sierra error-diffusion dithering. Keeping each scene's palette stable avoids palette flicker. Lossless frame optimization verifies displayed colors and timing. The loops keep short, actual-speed highlights; MP4 retains the full walkthrough at 25 fps. No motion interpolation or speed-up is used. GIF still has a palette color limit, so WebP is the default for gradients, stars and model materials.

The capture viewport matches the display's aspect ratio, so native fullscreen slides fill the recorded picture without gray recorder padding. The captions occupy a separate strip below the picture.

中文：README 默认展示 **25 fps 的全彩动画 WebP**；GIF 同样为 **25 fps**，每段单独生成稳定的 256 色调色板并采用误差扩散抖色。通过缩短停留和片段控制帧数，保留真实操作速度；完整过程见 MP4。

录制画布跟随显示器比例，PPT 全屏画面填满录制区域，不补灰边；字幕单独放在画面下方。

The historical 0.1.2 installation recording and its hashes remain in [history/0.1.2](history/0.1.2/demo-recording.json); performance tables below retain their original measurement stages.

## 3D and 360 gallery

[Gallery animated WebP](3d-and-panorama.webp) · [Gallery GIF](3d-and-panorama.gif) · [Full gallery MP4](3d-and-panorama.mp4) · [Recording evidence and hashes](3d-and-panorama-recording.json)

The companion gallery was re-recorded on **2026-11-05** in the installed **DSH Desktop 0.2.1-rc.5**, using an isolated **current source build** with base version 0.1.3 and CLI 0.5.6. Its runtime hash is recorded in the evidence; this source build differs from public 0.1.3. Its exact preview runtime and client are shipped in 0.1.5, verified by hash. It expands the document pane, orbits and zooms a GLB space robot, opens model tools beside the address bar to change view/projection and section, then inspects a multi-part 3MF gearbox. It also looks around a Milky Way panorama, uses header zoom, then seeks and plays a spherical NASA black-hole video using the header timeline and playback controls. These are actual pointer, wheel and control interactions; the video is muted.

The copied photo and video keep their original JPEG/WebM bytes, with `.pano` / `.360v` filenames selecting FiLens's spherical routes. Ordinary `.jpg` / `.webm` files open in the normal image/video viewer. This recording does not demonstrate automatic panorama detection.

中文：画廊已于 2026-11-05 使用隔离的当前源码构建重新录制，展示太空机器人、行星齿轮箱、银河全景照片与 NASA 黑洞全景视频；新增地址栏模型工具、视图 / 剖切、全景缩放、视频进度与播放控件的真实操作。录制时的源码版本与公开 npm 0.1.3 分别标记；相同运行时与客户端已用于 0.1.5，并以校验值核对。照片、视频仅使用 `.pano` / `.360v` 扩展名选择球面预览，原始字节不变。

| Sample | Source and license |
| --- | --- |
| `Orbital Bot.glb`, `Planetary Gearbox.3mf` | Original FiLens models, MIT. [Generation and sources](../../../apps/demo/public/samples/models/SOURCES.md). |
| `Milky Way.pano` | **Rogland Clear Night**, Greg Zaal / Poly Haven, [CC0](https://polyhaven.com/license), [original asset](https://polyhaven.com/a/rogland_clear_night). The repository's resized 4096×2048 JPEG preserves the complete equirectangular image. |
| `NASA Black Hole.360v` | NASA / Goddard Space Flight Center, public domain. [NASA visualization](https://svs.gsfc.nasa.gov/14576/) · [Wikimedia WebM source](https://commons.wikimedia.org/wiki/File:NASA_Black_Hole_Visualization_Takes_Viewers_Beyond_the_Brink_(SVS14576_BHPlunge_360_FINAL_1080).webm). |

Office imagery credits are preserved in the samples and listed in [sample sources](../../../apps/demo/public/samples/SOURCES.md).

## Package sizes and coverage

| Plugin | Preview extensions | CLI / preview | npm download | Unpacked plugin |
| --- | ---: | --- | ---: | ---: |
| 0.1.1 | 402 | 0.5.4 / 0.3.3 | 4.23 MiB | 9.98 MiB |
| 0.1.2 | 450 | 0.5.5 / 0.3.4 | 11.93 MiB | 16.40 MiB |
| 0.1.3 | 450 | 0.5.6 / 0.3.4 | 6.53 MiB | 19.57 MiB |
| 0.1.4 | 450 | 0.5.6 / 0.3.4 | 6.53 MiB | 19.58 MiB |
| 0.1.5 | 450 | 0.5.6 / 0.3.4 | 6.53 MiB | 19.58 MiB |

Sizes cover the adapter and its embedded preview runtime; separately installed CLI/OCR platform components, DSH shared dependencies and package-manager stores/caches are excluded. MiB = 1,048,576 bytes. Extension counts include direct previews and local WASM conversion routes, not independently validated files for every extension. [Exact public package integrity and byte counts](../../dsh-plugin-publication.json).

The 0.1.2 package carried the main JavaScript plus both gzip and Brotli representations, as well as archive WASM/worker sidecars. In 0.1.2, those extra representations account for most of the npm download increase. A compressed main-JS figure does not describe the entire npm package or the DSH pane's transferred bytes.

中文：0.1.2 的预览扩展名从 402 增至 450；插件本体下载与解包体积见上表，CLI/OCR 等依赖另计。包内同时保留 JS 原文件和 gzip/Brotli 产物，主要下载增量来自额外的预压缩文件；主 JS 压缩体积不能当作整个插件体积。

The 0.1.3 plugin embeds the split runtime and loads matching format engines on demand. The current README highlights [larger workloads against named public baselines](../../featured-performance.md); the following tables preserve historical versions and controls.

## First preview and cached preview

The DOCX/PPTX path renders directly in FiLens. DSH's built-in Office renderer uses its bundled LibreOffice kit to convert these files to PDF, then paints a PDF canvas. This comparison does not cover DSH's separate Excel renderer.

First opening of each file in a fresh process, median (minimum–maximum in ms) of **9 processes per renderer**:

| File | Bytes | FiLens 0.1.1 | FiLens 0.1.2 | DSH built in |
| --- | ---: | ---: | ---: | ---: |
| Field Notes.pptx | 659,484 | 356 ms (341–359) | 540 ms (521–542) | 1,828 ms (1,811–2,331) |
| Aurora Guide.docx | 601,507 | 245 ms (244–262) | 294 ms (278–295) | 1,812 ms (1,326–1,828) |

Cached openings, median (minimum–maximum in ms) of the next **27 samples per file/renderer** across those processes:

| File | FiLens 0.1.1 | FiLens 0.1.2 | DSH built in |
| --- | ---: | ---: | ---: |
| Field Notes.pptx | 228 ms (228–236) | 311 ms (261–319) | 112 ms (110–204) |
| Aurora Guide.docx | 245 ms (228–245) | 278 ms (277–328) | 112 ms (110–222) |

In paired rounds, 0.1.2's first opening took longer than 0.1.1 in **9/9 PPTX rounds** and **9/9 DOCX rounds**. The earlier [three-round dataset](office-preview-benchmark-3-rounds.json) is retained separately. This repetition checks variability on this machine; it does not establish a cause or a universal version regression.

Compared with 0.1.1, 0.1.2's first-open medians increased by **52% (PPTX) / 20% (DOCX)**; cached medians increased by **36% / 13%**. Built-in first opens took **3.4× / 6.2×** as long as 0.1.2, while built-in cached openings were faster.

Measured on **Apple M4 Pro**, macOS arm64, DSH **0.2.1-rc.5**. All **216 actual Office opens** are retained in the [JSON report](office-preview-benchmark.json). These two authored files on one machine measure latency, not rendering fidelity or performance for other documents/platforms.

Each round rotates renderer order and launches a fresh DSH process for each renderer. In each process, PPTX then DOCX are opened four times each, closing the document tab between opens. Timing starts immediately before `sidebarRight.openResource` and ends when the plugin's real iframe reports ready, followed by two animation frames; the built-in path waits for its visible PDF canvas and two frames. Application startup is excluded. “First” is the first opening of that file in each process; the engine may already be warm for DOCX after PPTX. OS filesystem and persistent application caches are not cleared, so this is not a cold-disk/conversion-cache test. Video encoding and benchmark execution do not overlap.

中文：9 轮轮换测试顺序，每种渲染器每轮新开一个 DSH 进程，每份文件打开四次，共 216 次。首开取 9 个进程的首个样本中位数；缓存取其余 27 个样本中位数。计时包含文件读取、转换/解析与渲染，不含应用启动；未清空系统和持久缓存，DOCX 前已打开 PPTX，因此不能把它解释为完全冷启动。原始数据保留新旧插件和内置预览的全部结果。

### PDF preview

PDF was measured separately with the PDF as the first document in each fresh DSH process: **9 rounds, 108 actual opens**, including 9 first openings and 27 cached openings per renderer. DSH uses its direct PDF renderer here, with no Office conversion.

Sample: **Cosmic Atlas.pdf**, **689,455 bytes**. [File hash, environment, every sample and method](pdf-preview-benchmark.json). Table values are medians, with minimum–maximum in parentheses, in ms.

| Opening | FiLens 0.1.1 | FiLens 0.1.2 | DSH built in |
| --- | ---: | ---: | ---: |
| First per process | 1,623 ms (1,615–1,642) | 684 ms (673–691) | 328 ms (322–338) |
| Cached | 1,408 ms (387–1,613) | 443 ms (393–483) | 111 ms (109–112) |

中文：PDF 单独测试 9 轮、108 次，每个进程先打开 PDF；内置预览直接渲染 PDF，不经过 Office 转换。表中为中位数及完整范围。Office 与 PDF 两组最新实测合计 **324 次打开**，原始数据分别保存。

### PDF without a viewer iframe

**Version 0.1.3 was developed after the public 0.1.2 measurements above.** npm versions are immutable; the 0.1.2 tarball is retained unchanged. The tables below retain their original measurement stages.

The adapter mounts the shared preview directly into DSH's document body. Version 0.1.5 moves the format controls to `sidebar.right.tab.document.action`, beside the address bar: document navigation, rotation, sheet tabs, archive tools, attachments, audio/video controls and the model inspector. Fullscreen restores controls inside its own preview until exit. Module initialization is reused across file opens; stylesheet references and viewer controls are released per tab. Desktop imports the same local runtime through its content-hashed static route, with CORS for modules/WASM and Blob workers for iWork/archives. Format drivers retain their own document isolation where required.

Profiling found two main delays in 0.1.2: each new viewer iframe initialized a **7,244,309-byte all-in-one JavaScript**, even when its download was cached, and PDF loading waited for **three visible pages** to finish. The split runtime removes packed-asset initialization from this path. The shared PDF driver now reveals the first **actually painted** page and continues nearby pages in the background. Non-virtual print/export previews still wait for all pages. The earlier split/iframe candidate's separate [108-open dataset](pdf-preview-optimization.json) is retained as an intermediate result; the following data measure the final direct-DOM candidate.

| Sample · first / cached median (ms) | Published 0.1.2 | Candidate 0.1.3 | DSH built in |
| --- | ---: | ---: | ---: |
| PPTX | 509 / 295 | 160 / 78 | 1826 / 111 |
| DOCX | 278 / 278 | 111 / 94 | 1326 / 111 |
| PDF | 641 / 410 | 261 / 144 | 326 / 110 |

The prepared 0.1.3 plugin tarball downloads **6.52 MiB** and unpacks to **19.54 MiB**, retaining **450 extensions**. CLI/OCR, DSH shared dependencies and package-manager caches are separate. [Candidate package bytes and SHA-256](../../dsh-plugin-package.json).

The new run again uses **9 rounds per format, 324 actual opens**, rotating renderer order with a fresh DSH process per renderer/round. PDF runs separately as the first document in its process; Office opens PPTX before DOCX. First per-process medians use 9 samples and cached medians use the remaining 27 per file/renderer. System and persistent caches are retained, and app startup is excluded. [All PDF samples](pdf-preview-direct.json) · [All Office samples](office-preview-direct.json) · [Source and validation hashes](../../dsh-pdf-optimization-validation.json).

The final Office baseline process failed to create a Desktop window and produced no timing. Its two missing observations were resumed with the same public 0.1.2 payload in a fresh isolated Electron profile; that process therefore had fresh browser/profile caches. All 52 earlier observations remain, with no successfully timed samples discarded. The recovery is recorded in the Office JSON.

PDF medians and observed minimum–maximum, in ms:

| Opening | Published 0.1.2 | Candidate 0.1.3 | DSH built in |
| --- | ---: | ---: | ---: |
| First per process | 641 (634–663) | 261 (237–266) | 326 (322–329) |
| Cached | 410 (377–436) | 144 (142–181) | 110 (108–114) |

PDF first-open time fell by **59%**, and cached time by **65%**, versus 0.1.2 in this run. The candidate's first opening is faster than the built-in preview on this file; cached opening is still **34 ms** slower. These files on one machine do not establish general performance or fidelity for other files/platforms.

Validation: **19 PDF tests**, **61 Vue tests**, **18 DSH tests** (using the public 0.5.5 CLI/OCR payload), **12 browser formats** with live controls/passwords/theme/lifecycle, independent concurrent tabs and unchanged PDF pixels across reopen, plus **6 real Desktop formats** with header zoom/fullscreen and 3D interaction. The public 0.1.2 installation evidence remains separate.

中文：0.1.3 候选版移除了侧栏查看器的外层 iframe，复用 DSH 外部工具栏；改为分包并复用模块初始化，PDF 首张真正绘制完成就显示，其余页后台继续。9 轮、324 次实测见上表，PDF 首开 / 缓存耗时较同轮 0.1.2 减少约 59% / 65%；首开已快于内置，缓存仍慢 34 ms。0.1.2 包保持不变；各表保留原始测量阶段。

### Historical 0.1.1 timing

The former **5–6.5×** first-open statement describes the [2026-11-04 0.1.1 measurement](office-preview-benchmark-0.1.1.json): PPTX 357 ms versus 2,330 ms built in, DOCX 263 ms versus 1,321 ms. Those observations remain historical; the current tables use the repeated 0.1.2 measurements and retain their ranges.

## Reproduce

Requirements: macOS with DSH Desktop installed, Node >=24.9, the repository's npm dependencies, Playwright Chromium, ffmpeg, ffprobe, libwebp's `img2webp` and Python 3 with Pillow. The samples come from `apps/demo/public/samples`; their hashes are recorded alongside the artifacts.

```sh
# Install the current public plugin through the actual UI in its own temporary profile.
node scripts/capture-dsh-plugin-demo.mjs --capture-only

# Run before encoding; use the isolated home from dist/dsh-demo/recording.json.
# The optional baseline is a separate isolated installation of dsh-filens@0.1.1.
node scripts/benchmark-dsh-office-preview.mjs \
  --home /path/to/isolated-0.1.2-profile \
  --baseline-home /path/to/isolated-0.1.1-profile --rounds 9

# Measure PDF separately with the same isolated profiles and --only-pdf.
node scripts/benchmark-dsh-office-preview.mjs \
  --home /path/to/isolated-0.1.2-profile \
  --baseline-home /path/to/isolated-0.1.1-profile --rounds 9 --only-pdf

# Compare the direct-DOM implementation against the public 0.1.2.
# Use separate isolated profiles; do not replace the normal user installation.
node scripts/benchmark-dsh-office-preview.mjs \
  --home /path/to/isolated-0.1.3-profile \
  --baseline-home /path/to/isolated-0.1.2-profile --rounds 9 --only-pdf \
  --output docs/assets/dsh-plugin/pdf-preview-direct.json
node scripts/benchmark-dsh-office-preview.mjs \
  --home /path/to/isolated-0.1.3-profile \
  --baseline-home /path/to/isolated-0.1.2-profile --rounds 9 \
  --output docs/assets/dsh-plugin/office-preview-direct.json

# Encode the completed capture without reinstalling or reopening DSH.
node scripts/capture-dsh-plugin-demo.mjs --encode-only

# Optional: make a new gallery using that isolated installation.
node scripts/capture-dsh-visual-demo.mjs
```

Run the commands from the repository root. Set `DSH_DESKTOP_EXECUTABLE` if the app is installed elsewhere. The benchmark changes the test profile's FiLens enable switch to compare the real renderers, then restores it. The recording script writes raw video and intermediate frames under ignored `dist/dsh-demo/`, and the WebP, GIF, MP4 and evidence JSON under this directory.

## Load formats on demand

The **0.1.3 implementation** combines the direct sidebar DOM and
DSH header controls with per-format dynamic imports. Lightweight route metadata
registers all **450 extensions** first; renderers load only when selected. Shared
Vue, native drivers and compression remain reusable. Converted documents and
nested archive entries use the same registry. The complete package still carries
all format assets for local/offline use; chunking reduces opening-time loading.

Actual raw runtime requests in fresh browser contexts, compared with the earlier
preceding direct-DOM build:

| Open | Earlier direct DOM | Format loading | Reduction |
| --- | ---: | ---: | ---: |
| Entry JS only | 3110.6 KiB | 344.6 KiB | 88.9% |
| TXT | 3164.3 KiB | 448.8 KiB | 85.8% |
| PDF | 4655.5 KiB | 1914.1 KiB | 58.9% |
| DOCX | 3280.9 KiB | 580.2 KiB | 82.3% |
| PPTX | 3164.3 KiB | 778.7 KiB | 75.4% |

Entry excludes CSS; the file rows include CSS and requested workers/WASM but
exclude the document and DSH itself. PDF includes its 1.03 MiB worker. These are
loading sizes, not compressed network transfers or elapsed-time speedups.
[Exact files, hashes and gzip/Brotli estimates](format-loading.json). Reproduce
with `node scripts/report-dsh-format-loading.mjs --baseline <previous-lib/runtime> --output <report.json>`.

The DSH browser harness tests **15 format categories in separate fresh contexts**,
then reopens every file to verify module reuse: text, image, PDF, DOCX, XLSX, PPTX,
iWork, STEP, ZIP, CAD, EPUB, mindmap, diagram, video and DNG. Text/PDF do not load
unrelated Office, iWork, CAD or Three.js code. RAW/panorama legitimately shares
Three.js for panoramic rendering; it does not load model format loaders.

Separate Desktop comparisons use **9 PDF rounds** and **4 matched Office rounds**
(**204 matched opens**), measuring first / cached milliseconds against public
**0.1.2** and the actual built-in preview. Including the unmatched round-five
baseline samples, all **212 recorded opens** are retained:

| Format | 0.1.2 | 0.1.3 format loading | Built-in |
| --- | ---: | ---: | ---: |
| PPTX | 511 / 295 | **119.5 / 78** | 1,825 / 110 |
| DOCX | 279 / 278 | **110 / 93.5** | 1,317.5 / 111 |
| PDF | 646 / 411 | **214 / 159** | 324 / 110 |

[PDF samples](pdf-preview-lazy.json) · [Office samples](office-preview-lazy.json) ·
[Package and validation](../../dsh-format-loading-validation.json).

Each round starts a fresh process per renderer and rotates renderer order.
PDF opens first in its process; Office opens PPTX then DOCX. Each document is
opened four times, closing its tab between opens. PDF medians use nine first opens and 27 cached opens per renderer/file; Office
uses four first opens and 12 cached opens. OS and persistent caches remain; application
startup is excluded. One PDF and two authored Office files on the same macOS M4 Pro
machine do not establish a universal speedup or rendering fidelity.

Office round 5 encountered a Desktop native startup error before timing its
built-in preview. Four complete rounds provide 96 matched Office opens; the two
additional baseline observations (8 opens) remain in the raw report but do not
enter the matched summaries. Recovery also failed during initialization, before
opening a document. No included timing was replaced or moved to a fresh profile.
The comparison has fewer Office rounds than planned and cannot establish small
regressions or differences near the observed variability.

A preliminary PDF setup run overlapped functional checks and was stopped in full;
all final nine rounds began after the checks finished. Its recorded samples are
[retained separately](pdf-preview-lazy-calibration.json), outside the 212 recorded opens.
The earlier direct-DOM 261 / 144 ms PDF results above describe an older source
snapshot and a separate run; they are not a controlled comparison with the new
loading boundaries. The installation GIF still records published **0.1.2**.

## Latest PDF reopen optimization

The 2026-11-05 candidate adds bounded, content-keyed first-page pixel reuse while
continuing to release each document/worker on close. The preceding format-loading
measurements above retain their original source snapshots.

| Renderer | First (ms) | Reopened (ms) |
| --- | ---: | ---: |
| 已发布 0.1.2 | 654 | 426 |
| 0.1.3 优化前 | 208 | 159 |
| 0.1.3 优化后 | 190 | 77 |
| DSH 内置 PDF | 329 | 110 |

Nine matched rounds, 144 opens across four renderers, no failures or removed samples.
Reopens take **51.6% less time** than the preceding 0.1.3 candidate and
**30.0% less** than built-in PDF for the tested document.
[Implementation, full ranges and validation](pdf-reopen-optimization.zh-CN.md) ·
[Raw samples](pdf-preview-page-cache.json) ·
[Earlier nine-round Word/PPT/PDF retest](performance-retest.zh-CN.md).
