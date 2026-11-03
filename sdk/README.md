# iOS / Android SDK (Source Integration)

English · [简体中文](README.zh-CN.md)

Preview local files offline in iOS and Android apps. Both SDKs wrap the same
`filens-preview` frontend and WASM runtime. Files are not uploaded, and Swift / Java
code does not implement format parsing or conversion. These are preview components;
they currently do not expose native APIs for reading, OCR, search, or standalone
conversion results.

SDK version: **0.1.0**. Shared preview runtime: **0.3.0**. The SDK ZIPs in Releases
already include the offline assets. Extract an archive and integrate its `sdk/ios`
or `sdk/android` module directly. See below for building and packaging from source.
[Download and extracted sizes](../docs/mobile-sdk-sizes.json) ·
[Runtime and npm package sizes](../docs/preview-sizes.md).

## Build the shared assets

Run these commands from the repository root. Node.js, npm, and the WASM build
toolchain are required:

```sh
npm ci
npm run build:wasm
npm run build:preview
npm run build:sdk:mobile
```

To create both source SDK ZIPs with offline assets, run
`npm run package:sdk:mobile`. The archives are written to `dist/mobile-sdk/`.
This command does not produce a precompiled AAR or XCFramework.

The final build step copies the split preview runtime, separate archive engine and
worker, mobile entry point, MIT license, and third-party notices into both SDKs'
resource directories. Generated assets are not committed to Git and must be
included when distributing an SDK. If the runtime has already been built, only the
final build step is needed. The SDK does not download the runtime at startup.

## iOS: Swift Package

Requires iOS 15+, Swift 5.9+, and Xcode. In Xcode, use **Add Local Package** to add
`sdk/ios` from this repository, then link `FilensPreview` to your app. Generate the
assets above before building the app. A local Swift Package is provided; a remote
SPM package and an XCFramework have not been published.

```swift
import FilensPreview

let preview = FilensPreviewView(frame: view.bounds)
preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
view.addSubview(preview)
preview.onRendered = { print("Preview rendered") }
preview.onError = { error in print(error.code, error.message) }
preview.open(fileURL: localFileURL, options: .init(locale: "en_US"))

// Switch files by calling open(fileURL:) again.
// Close temporarily with preview.close(); the view can open another file later.
// Release the view permanently with preview.destroy().
```

`open()` accepts a local file URL, including a security-scoped URL returned by the
system document picker. File copying runs in the background; the caller does not
need to load the file into memory. Call all public view APIs on the main thread.
Closing or releasing the view deletes its temporary copy, leaving the source file
intact.

On iOS, WKWebView loads the runtime through a local HTTP server that listens only
on `127.0.0.1`, with a random port and session path. This preserves module worker
and iWork support. The server exposes only the runtime and current file, without
exposing the source file's directory. Add the following local networking ATS
setting to your app's `Info.plist`; there is no need to disable ATS globally:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

Only the loopback address is accessed; the SDK does not access devices on your
local network. Both platforms use the split runtime and retain a separate iWork
module worker to avoid WebKit's restrictions on inline workers.

## Android: Java / Kotlin

Requires Android 8.0 / API 26+ and an Android System WebView with WebAssembly,
worker, and AndroidX `WEB_MESSAGE_LISTENER` support. Older WebView versions report
an update requirement through the error callback. The build environment uses
JDK 17+, Gradle 8.9, and Android SDK 35.

Include the module in an existing Gradle project. Configure `google()` and
`mavenCentral()` in your repositories:

```kotlin
// settings.gradle.kts: adjust the path to your local checkout.
include(":filens-preview")
project(":filens-preview").projectDir = file("../filens/sdk/android/filens-preview")

// App build.gradle.kts
dependencies { implementation(project(":filens-preview")) }
```

The host project must already declare a compatible Android Gradle Plugin. The
standalone project pins version 8.7.3. Alternatively, build an AAR first:

```sh
gradle -p sdk/android :filens-preview:assembleRelease
# sdk/android/filens-preview/build/outputs/aar/filens-preview-release.aar
```

When using the AAR directly, the host must also declare
`implementation("androidx.webkit:webkit:1.12.1")`; a plain AAR does not bundle its
Maven dependencies. Maven coordinates have not been published.

```kotlin
import app.filens.preview.FilensPreviewView

val preview = FilensPreviewView(this)
container.addView(preview, android.view.ViewGroup.LayoutParams(-1, -1))
preview.setListener(object : FilensPreviewView.Listener {
    override fun onRendered() { /* The file has rendered. */ }
    override fun onError(code: String, message: String) { /* Display the error. */ }
})
// Pass a content:// URI from the system document picker, or a readable file:// URI.
preview.open(documentUri, "report.pdf", FilensPreviewView.Options("en_US", true))

// Call open() again to switch files; close() releases the file and keeps the view.
// Call preview.destroy() in Activity.onDestroy / Fragment.onDestroyView.
```

Pass `null` for `name` to let the SDK query the URI's display name. Call all public
APIs on the UI thread; file copying runs on a background thread. The SDK needs
read access to the supplied URI, without requesting broad storage permissions.
Android uses a local HTTPS origin through `WebViewAssetLoader`, with cleartext
HTTP and cross-origin file access disabled. Manifest merging adds the `INTERNET`
permission for WebView; all preview resources come from app assets and the current
file.

## Capabilities and limitations

- Format support and fidelity follow the [frontend format matrix](../docs/support-matrix.md),
  including Office, PDF, iWork, images, CAD / 3D, ebooks, and archives. Password
  prompts for Office, PDF, and archives reuse the frontend UI.
- APIs include `open`, `close`, `destroy`, locale and toolbar options, and rendered
  and error callbacks. The rendered callback may fire multiple times when pages
  change or frontend state updates. Callbacks from stale sessions are ignored.
- A translucent `FiLens © IceWhale` watermark appears in the lower-right corner of
  the preview by default. It remains visible when the toolbar is hidden.
- Large files use local URLs, with byte-range reads for media. Memory use after
  parsing still depends on the format and file size. Video codecs, WebGL, fonts,
  and device memory affect mobile behavior.
- External resource requests and navigation away from the preview page are
  blocked by default. There is currently no native API for passing multiple
  sidecar files or multipart archives. Use supported self-contained files or ZIPs.
- `close` / `destroy` remove the SDK's temporary copies. The OS or host app is
  responsible for clearing caches left after an app crash.
- These are source SDKs. Browser automation, native compilation, and simulator
  validation do not replace large-file, codec, and memory testing on physical
  iPhone and Android devices.

## Validation

```sh
npm run build:sdk:mobile
npm run test:sdk:mobile                  # Chromium / WebKit: real runtime and both message bridges
swift test --package-path sdk/ios       # macOS: loopback HTTP, path restrictions, and media ranges
```

The Android byte-range tests are plain Java and can run with the JDK alone:

```sh
javac -d /tmp/filens-sdk-tests \
  sdk/android/filens-preview/src/main/java/app/filens/preview/ByteRange.java \
  sdk/android/filens-preview/src/test/java/app/filens/preview/ByteRangeTest.java
java -cp /tmp/filens-sdk-tests app.filens.preview.ByteRangeTest
```

Source validation recorded on 2026-11-02: 22 real-runtime and message-bridge checks
passed across Chromium / WebKit, covering text, CSV, HTML, DOCX, PDF, Pages, EPUB,
MP4, APK icons, encrypted RAR, and error callbacks. Three Swift tests passed on
macOS. The Swift component passed compilation for an iOS Simulator arm64 target
(iOS 26 SDK, minimum deployment target iOS 15). The Android Java component passed
compilation against Android API 35 / AndroidX WebKit 1.12.1 and its byte-range
tests. That validation did not include a full Gradle AAR build, a simulator app,
or physical-device tests.
