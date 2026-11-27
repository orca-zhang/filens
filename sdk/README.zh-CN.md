# iOS / Android SDK（源码接入）

[English](README.md) · 简体中文

在 iOS 和 Android 应用内离线预览本地文件。两端都封装同一份 `filens-preview`
前端运行时与 WASM，不上传文件，也不在 Swift / Java 内实现格式解析或转换。
这是预览组件；目前不提供原生读取、OCR、搜索或独立转换结果 API。

SDK 版本 **0.1.9**，共享预览运行时 **0.3.8**。Release 中的 SDK ZIP 已携带离线资源，
解压后先在 ZIP 根目录运行一次 `node prepare-runtime.mjs`，再接入对应的
`sdk/ios` 或 `sdk/android` 模块。准备过程完全离线，在开发机上运行，需要 Node.js 18+
和 C++17 编译器（Xcode Command Line Tools、clang++、g++ 或 MSVC，可用 `CXX`
指定编译器）。脚本校验资源完整性，重复运行复用已准备的资源。手机端不运行强解压。
源码构建和打包方式见下文。
[下载包与解压体积](../docs/mobile-sdk-sizes.json) · [运行时与 npm 包体积](../docs/preview-sizes.md)。

## 构建共享资源

在仓库根目录执行（需要 Node.js、npm 和 WASM 构建工具链）：

```sh
npm ci
npm run build:wasm
rustup toolchain install 1.93.0 --component rust-src
npm run build:wasm:mobile
npm run build:sdk:mobile
```

生成携带离线资源的两个源码 SDK ZIP：`npm run package:sdk:mobile`，输出到
`dist/mobile-sdk/`；该命令不生成预编译 AAR / XCFramework。

最后一步构建移动端专用分包运行时，把共享的完整转换核心、独立压缩包引擎及 Worker、
移动端入口、MIT 和第三方许可复制到两个 SDK 的资源目录。生成的资源不提交 Git；
发布 SDK 时必须包含它们。已有 WASM 时只需执行最后一步，SDK 无需在启动时下载运行时。

移动端构建将 JS / WASM 和完整第三方许可正文保存为 `.br`，保留按格式加载的模块和
独立 Worker。iOS 使用原始资源 URL 与 `Content-Encoding: br`，由 WebKit 解码；
Android 使用 `org.brotli:dec:0.1.2` 的 `BrotliInputStream` 按流解码。XLSX 正则公式
从同一套本地资源按需读取 `xlsx/pcre2.wasm`。两端都无需
把资源解压到应用缓存。`THIRD-PARTY-NOTICES.txt.br` 可用 `brotli -d` 还原查看，
原始 `.txt` URL 也会由宿主解码提供。MIT 许可保持明文；完整许可正文与上游链接一并保留。
升级时请同步替换原生宿主源码和生成资源；宿主仍兼容旧的 gzip 和未压缩资源。

打包脚本要求每端完整源码 SDK ZIP 小于 **3 MiB**。[已发布包的精确体积](../docs/mobile-sdk-sizes.json)。
转换模块合并为同一份共享 WASM，减少重复代码并保留全部格式能力；首次转换会编译
较大的完整核心，解析时的内存仍取决于文件和格式。ZIP 包含开发机准备工具和全部资源；
准备后仅将原生模块及 Brotli 资源打入应用，ZIP 下载体积不等于应用安装体积。
上述数字不包含编译后的原生代码及 Maven 依赖，最终应用体积需以 AAR / IPA / APK 构建为准。

## iOS：Swift Package

要求 iOS 15+、Swift 5.9+、Xcode。在 Xcode 中通过 **Add Local Package** 添加
本仓库的 `sdk/ios`，将 `FilensPreview` 链接到应用。先生成上述资源再构建应用。
当前提供本地 Swift Package，尚未发布远程 SPM 包或 XCFramework。

```swift
import FilensPreview

let preview = FilensPreviewView(frame: view.bounds)
preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
view.addSubview(preview)
preview.onRendered = { print("预览完成") }
preview.onError = { error in print(error.code, error.message) }
preview.open(fileURL: localFileURL, options: .init(locale: "zh_CN"))

// 切换文件：再次调用 open(fileURL:)。
// 暂时关闭：preview.close()；视图还可以重新打开文件。
// 永久释放：preview.destroy()。
```

`open()` 接收本地文件 URL，也支持系统文档选择器返回的 security-scoped URL。
文件复制在后台执行，调用方无需把文件读入内存。所有公开视图 API 在主线程调用。
视图关闭或释放时删除自己的临时副本，不删除传入的源文件。

iOS 使用只监听 `127.0.0.1`、随机端口和随机会话路径的本机 HTTP 服务承载 WKWebView，
保留模块 Worker 与 iWork 支持。服务只暴露运行时及当前文件，不开放源文件所在目录。
应用的 `Info.plist` 添加本地网络 ATS 配置，无需全局关闭 ATS：

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

仅访问本机回环地址，不访问局域网设备。
两端使用分包运行时，保留独立的 iWork 模块 Worker，避免 WebKit 对内联 Worker 的限制。

## Android：Java / Kotlin

要求 Android 8.0 / API 26+、支持 WebAssembly、Worker 和 AndroidX
`WEB_MESSAGE_LISTENER` 的 Android System WebView。旧 WebView 会通过错误回调提示更新。
构建环境为 JDK 17+、Gradle 8.9 和 Android SDK 35。

可以在现有 Gradle 项目中包含模块（仓库需配置 `google()` 和 `mavenCentral()`）：

```kotlin
// settings.gradle.kts，按本地仓库位置调整路径
include(":filens-preview")
project(":filens-preview").projectDir = file("../filens/sdk/android/filens-preview")

// 应用 build.gradle.kts
dependencies { implementation(project(":filens-preview")) }
```

宿主项目需已声明兼容的 Android Gradle Plugin；独立示例固定为 8.7.3。或先生成 AAR：

```sh
gradle -p sdk/android :filens-preview:assembleRelease
# sdk/android/filens-preview/build/outputs/aar/filens-preview-release.aar
```

直接使用 AAR 时，宿主还需声明 `implementation("androidx.webkit:webkit:1.12.1")`
和 `implementation("org.brotli:dec:0.1.2")`；
普通 AAR 不会内嵌其 Maven 依赖。目前未发布 Maven 坐标。

```kotlin
import app.filens.preview.FilensPreviewView

val preview = FilensPreviewView(this)
container.addView(preview, android.view.ViewGroup.LayoutParams(-1, -1))
preview.setListener(object : FilensPreviewView.Listener {
    override fun onRendered() { /* 文件已渲染 */ }
    override fun onError(code: String, message: String) { /* 显示错误 */ }
})
// 使用系统文档选择器返回的 content:// URI，或应用可读的 file:// URI。
preview.open(documentUri, "report.pdf", FilensPreviewView.Options("zh_CN", true))

// 再次 open() 切换文件；close() 释放文件并保留视图。
// 在 Activity.onDestroy / Fragment.onDestroyView 中调用 preview.destroy()。
```

`name` 可以传 `null`，SDK 会查询 URI 的显示名称。所有公开 API 在 UI 线程调用，
文件复制在后台线程执行。只需要传入 URI 的读取授权，不需要申请全盘存储权限。
Android 使用 `WebViewAssetLoader` 的本地 HTTPS 源，不开启 HTTP 明文流量或文件跨域访问。
Manifest 合并 `INTERNET` 权限供 WebView 使用；预览资源全部来自应用 assets 与当前文件。

## 能力与边界

- 格式与保真度沿用[前端格式矩阵](../docs/support-matrix.zh-CN.md)，包括 Office、PDF、
  iWork、图片、CAD / 3D、电子书和压缩包等。Office / PDF / 压缩包密码提示复用前端 UI。
- 提供 `open`、`close`、`destroy`、语言、工具栏开关、渲染和错误回调。渲染回调可能
  随翻页或前端状态更新多次触发。过期会话的回调会被忽略。
- 预览区右下角默认显示半透明 `FiLens` 水印，关闭工具栏后仍显示。
- 大文件使用本地 URL，并支持媒体字节范围读取；解析后内存仍取决于格式和文件大小。
  视频编码、WebGL、字体及设备内存会影响移动端表现。
- 默认禁止外部资源请求与离开预览页面的导航。多文件 sidecar 和多卷压缩包目前没有
  原生传入接口；使用受支持的自包含文件或 ZIP。
- `close` / `destroy` 清理 SDK 自己的临时副本；应用崩溃后的缓存由系统或宿主清理。
- 当前为源码 SDK。浏览器自动化、原生编译与模拟器验证不能替代 iPhone / Android
  真机的大文件、编解码器和内存回归测试。

## 验证

```sh
npm run build:sdk:mobile
npm run test:sdk:mobile                  # Chromium / WebKit，真实引擎与两种消息桥
swift test --package-path sdk/ios       # macOS 上验证回环 HTTP、路径限制和媒体 Range
```

Android 的纯 Java 字节范围测试可以用 JDK 独立运行：

```sh
javac -d /tmp/filens-sdk-tests \
  sdk/android/filens-preview/src/main/java/app/filens/preview/ByteRange.java \
  sdk/android/filens-preview/src/test/java/app/filens/preview/ByteRangeTest.java
java -cp /tmp/filens-sdk-tests app.filens.preview.ByteRangeTest
```

2026-11-04 源码验证：Chromium / WebKit 共 22 项真实运行时与消息桥检查通过，覆盖
文本、CSV、HTML、DOCX、PDF、Pages、EPUB、MP4、APK 图标、加密 RAR 与错误回调；
macOS 上 3 项 Swift 测试通过。Swift 组件通过 iOS Simulator arm64 目标编译检查
（iOS 26 SDK，最低目标 iOS 15），Android Java 组件通过 Android API 35 / AndroidX
WebKit 1.12.1 编译检查及字节范围测试。本次未运行完整 Gradle AAR 构建、模拟器应用或真机测试。

SDK 0.1.9 验证（2026-11-25）：两个完整 ZIP 均小于 3 MiB，离线准备后全部资源
逐字节一致，脚本能恢复缺失或损坏的已准备资源。34 项 Chromium / WebKit 检查通过，
覆盖 DOC、EPS、TIFF、DWG、JPEG XL、HEIC 和原有格式；精简 WASM 核心及图像模块
通过 328 个转换样例。16 项 Swift HTTP 请求自检覆盖 Brotli、gzip 兼容、HEAD、
Range 和路径限制。Android 通过 API 35 / WebKit 1.12.1 编译，流读取测试覆盖
单字节与批量混合读取、缺少 Brotli 依赖时安全回退。
未运行完整 Gradle AAR / IPA 构建或真机测试。本机 `swift test` 受 SwiftPM manifest
链接异常影响未完成，改用直接编译和 HTTP 自检。开发机准备流程已在 macOS 验证，
Windows / Linux 编译器路径尚未实测。
