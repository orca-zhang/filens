# DSH release demos · 中文 / English

Six new recordings for the proposed FiLens DSH 0.1.7 release. [Review page](../../releases/dsh-filens-0.1.7/review.html) · [Release packet](../../releases/dsh-filens-0.1.7/README.md).

中文和英文分别使用对应语言的 DSH 界面、文件名、合成会话和字幕。三个主题分别提供 GIF、全彩动画 WebP、完整 MP4、封面 PNG 和录制证据 JSON。素材来自真实安装的 DSH Desktop 0.2.1-rc.5，使用独立临时配置，不读取个人会话，不调用模型。预览内容由共享内核实际解析、渲染；缩略图不是预先贴入的图片。

Office 中文录屏使用中文 Word 正文、Excel 表头及工作表名称，以及已有的 `filens-introduction.zh-CN.pptx`；英文录屏使用对应英文样例和 `filens-introduction.en.pptx`。工作台的分组封面和相关文件也使用这些真实文档。封面 PNG 展示 FiLens 介绍 PPT 的第一页。

| Topic | 中文 | English |
| --- | --- | --- |
| Office sidebar | [GIF](office-preview.zh-CN.gif) / [MP4](office-preview.zh-CN.mp4) | [GIF](office-preview.en.gif) / [MP4](office-preview.en.mp4) |
| 3D / 360° | [GIF](3d-and-panorama.zh-CN.gif) / [MP4](3d-and-panorama.zh-CN.mp4) | [GIF](3d-and-panorama.en.gif) / [MP4](3d-and-panorama.en.mp4) |
| File workspace | [GIF](file-workspace.zh-CN.gif) / [MP4](file-workspace.zh-CN.mp4) | [GIF](file-workspace.en.gif) / [MP4](file-workspace.en.mp4) |

The demos use unpublished source whose clients and runtime match the installed 0.1.7-workspace.8 candidate. Source package metadata still reads 0.1.6 and is retained honestly in the evidence; this is not the public npm 0.1.6 payload. The older public-package installation video remains in [the historical media directory](../dsh-plugin/README.md); its package version and measured performance retain their original scope.

Captions are a single language per recording, in a separate strip below the application. No additional pointer overlay is used. The isolated native window uses an opaque background so screencasting does not turn macOS sidebar translucency black. GIFs are 20 fps, 960 pixels wide, with per-scene 256-color palettes and Sierra dithering; frame merging checks displayed colors and durations. WebP retains full color. Setup, file loading between scenes and idle waits may be cut; retained actions use their recorded speed. These are demonstrations, not timing comparisons.

## Sources and licenses

| Material | Source / license |
| --- | --- |
| Aurora Guide DOCX, Observatory XLSX, Cosmic Atlas PDF | FiLens-authored samples, MIT; embedded photo credits retained. Chinese DOCX/XLSX authored with `scripts/localize-dsh-showcase.mjs`, preserving images and formulas. [Sample source list](../../../apps/demo/public/samples/SOURCES.md). |
| FiLens introduction PPTX · 中文 / English | Existing project introduction decks, rendered directly as editable PPTX. Figures inside the decks retain their original measurement scope. Sources: `apps/demo/public/samples/filens-introduction.zh-CN.pptx` and `filens-introduction.en.pptx`. |
| Alpine Lake JPG | Repository sample; original creator and license in the [source list](../../../apps/demo/public/samples/SOURCES.md). |
| Orbital Bot GLB / Planetary Gearbox 3MF | FiLens-authored models, MIT. [Model sources](../../../apps/demo/public/samples/models/SOURCES.md). |
| Milky Way panorama | Rogland Clear Night, Greg Zaal / Poly Haven, [CC0](https://polyhaven.com/license), [original](https://polyhaven.com/a/rogland_clear_night). |
| Black-hole panorama video | NASA / Goddard Space Flight Center, public domain. [NASA](https://svs.gsfc.nasa.gov/14576/) / [WebM source](https://commons.wikimedia.org/wiki/File:NASA_Black_Hole_Visualization_Takes_Viewers_Beyond_the_Brink_(SVS14576_BHPlunge_360_FINAL_1080).webm). |
| Session titles, questions and Python snippet | Synthetic recording fixtures, MIT. |

Localized filenames preserve the original file bytes. Panorama JPEG/video are renamed `.pano` / `.360v` to select supported spherical routes; ordinary `.jpg` / `.webm` use regular image/video previews. This does not demonstrate automatic detection of panoramic metadata.

The [manifest](manifest.json) lists sizes, SHA-256 hashes, dimensions, durations and the tested environment. [Final validation](validation.json) covers playback, language switching, frame timing and links; [source equivalence](source-candidate-equivalence.json) compares all 67 built files. Per-recording JSON files retain sample hashes and successful interaction assertions. Reproduction commands are in the [release packet](../../releases/dsh-filens-0.1.7/README.md).
