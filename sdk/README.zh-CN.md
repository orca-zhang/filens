# iOS / Android SDK（源码接入）

[English](README.md) · 简体中文

在 iOS 和 Android 应用内离线预览本地文件。两端都封装同一份 `filens-preview`
前端运行时与 WASM，不上传文件，也不在 Swift / Java 内实现格式解析或转换。
这是预览组件；目前不提供原生读取、OCR、搜索或独立转换结果 API。

SDK 版本 **0.1.7**，共享预览运行时 **0.3.7**。Release 中的 SDK ZIP 已携带离线资源，
解压后可直接接入对应的 `sdk/ios` 或 `sdk/android` 模块。源码构建和打包方式见下文。
[下载包与解压体积](../docs/mobile-sdk-sizes.json) · [运行时与 npm 包体积](../docs/preview-sizes.md)。

## 构建共享资源

在仓库根目录执行（需要 Node.js、npm 和 WASM 构建工具链）：

```sh
npm ci
npm run build:wasm
npm run build:preview
npm run build:sdk:mobile
```

生成携带离线资源的两个源码 SDK ZIP：`npm run package:sdk:mobile`，输出到
`dist/mobile-sdk/`；该命令不生成预编译 AAR / XCFramework。

最后一步把分包预览运行时、独立压缩包引擎及 Worker、移动端入口、MIT 和第三方
许可复制到两个 SDK 的资源目录。生成的资源不提交 Git；发布 SDK 时必须包含它们。
已有构建资源时只需执行最后一步。SDK 没有启动时下载运行时的步骤。

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

直接使用 AAR 时，宿主还需声明 `implementation("androidx.webkit:webkit:1.12.1")`；
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
