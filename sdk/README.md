# iOS / Android SDK (Source Integration)

English · [简体中文](README.zh-CN.md)

Preview local files offline in iOS and Android apps. Both SDKs wrap the same
`filens-preview` frontend and WASM runtime. Files are not uploaded, and Swift / Java
code does not implement format parsing or conversion. These are preview components;
they currently do not expose native APIs for reading, OCR, search, or standalone
conversion results.

SDK version: **0.1.9**. Shared preview runtime: **0.3.8**. The SDK ZIPs in Releases
include all offline assets in a compressed distribution archive. Extract the ZIP
and run `node prepare-runtime.mjs` once at its root before integrating `sdk/ios`
or `sdk/android`. Preparation runs entirely offline on the developer computer and
requires Node.js 18+ and a C++17 compiler (Xcode Command Line Tools, clang++, g++,
or MSVC; set `CXX` if needed). It verifies checksums and reuses intact resources
on subsequent runs. Strong decompression never runs in the phone app.
See below for building and packaging from source.
[Download and extracted sizes](../docs/mobile-sdk-sizes.json) ·
[Runtime and npm package sizes](../docs/preview-sizes.md).

## Build the shared assets

Run these commands from the repository root. Node.js, npm, and the WASM build
toolchain are required:

```sh
npm ci
npm run build:wasm
rustup toolchain install 1.93.0 --component rust-src
npm run build:wasm:mobile
npm run build:sdk:mobile
```

To create both source SDK ZIPs with offline assets, run
`npm run package:sdk:mobile`. The archives are written to `dist/mobile-sdk/`.
This command does not produce a precompiled AAR or XCFramework.

The final step builds the mobile split runtime with one complete shared conversion
core, separate archive engine and workers, then stages it with the mobile entry,
MIT license and third-party notices in both SDKs. Generated assets are not committed
to Git and must be distributed with the SDK. When WASM is already built, only the
final step is needed. Runtime assets are available offline at startup.

Mobile builds store JS / WASM and full third-party notices as `.br`, retaining lazy
format modules and separate workers. iOS serves the original URLs with
`Content-Encoding: br` for WebKit; Android streams a `BrotliInputStream` from
`org.brotli:dec:0.1.2`. XLSX regular expression formulas load `xlsx/pcre2.wasm`
on demand from those same local resources. Neither host extracts another copy
to app storage. Decode
`THIRD-PARTY-NOTICES.txt.br` with `brotli -d` to read it; the host also serves decoded
text at the original `.txt` URL. The MIT license remains plain text, and complete
required notices and upstream links are retained. Update native host source and
assets together; older gzip and uncompressed resources remain supported.

Packaging enforces a **3 MiB** ceiling for each complete source SDK ZIP.
See the [measured release sizes](../docs/mobile-sdk-sizes.json). One shared complete conversion
WASM removes duplicate code while retaining format support. Its first conversion
compiles a larger core; parsing memory still depends on the document and format.
The ZIP bundles a host-only preparation tool and all resources; after preparation,
only the native module and its Brotli resources go into the app. ZIP size does not
represent installed app size. Measurements exclude compiled native code and Maven
dependencies. Measure the
final AAR / IPA / APK to determine application size.

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
`implementation("androidx.webkit:webkit:1.12.1")` and
`implementation("org.brotli:dec:0.1.2")`; a plain AAR does not bundle its
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
- A translucent `FiLens` watermark appears in the lower-right corner of
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

Source validation recorded on 2026-11-04: 22 real-runtime and message-bridge checks
passed across Chromium / WebKit, covering text, CSV, HTML, DOCX, PDF, Pages, EPUB,
MP4, APK icons, encrypted RAR, and error callbacks. Three Swift tests passed on
macOS. The Swift component passed compilation for an iOS Simulator arm64 target
(iOS 26 SDK, minimum deployment target iOS 15). The Android Java component passed
compilation against Android API 35 / AndroidX WebKit 1.12.1 and its byte-range
tests. That validation did not include a full Gradle AAR build, a simulator app,
or physical-device tests.

SDK 0.1.9 validation (2026-11-25): both complete ZIPs are below 3 MiB. Offline
preparation restores every resource exactly and recovers incomplete or corrupted
prepared files. All 34 Chromium / WebKit checks pass, including DOC, EPS, TIFF,
DWG, JPEG XL and HEIC. The compact WASM core/image pass 328 conversion fixtures.
Sixteen native Swift HTTP checks cover Brotli, legacy gzip, HEAD, ranges and path
restrictions. Android compiles against API 35 / WebKit 1.12.1; stream tests cover
mixed single/bulk reads and safe fallback when the Brotli dependency is missing.
Full Gradle AAR / IPA builds and physical-device tests were not run. The local
`swift test` command is blocked by a SwiftPM manifest linker failure; direct
Swift compilation and the HTTP harness were used instead. Host preparation was
validated on macOS; Windows/Linux compiler paths have not been executed.
