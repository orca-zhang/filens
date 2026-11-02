#if canImport(UIKit)
import Foundation
import UIKit
import WebKit
import UniformTypeIdentifiers

public struct FilensPreviewOptions: Sendable {
    public var locale: String?
    public var toolbar: Bool

    public init(locale: String? = nil, toolbar: Bool = true) {
        self.locale = locale
        self.toolbar = toolbar
    }
}

public struct FilensPreviewError: LocalizedError, Sendable {
    public let code: String
    public let message: String
    public var errorDescription: String? { message }
}

/// Offline previews backed by the same frontend and WASM as filens-preview.
/// Create, open and close this view on the main thread.
@MainActor
public final class FilensPreviewView: UIView, WKNavigationDelegate {
    public var onRendered: (() -> Void)?
    public var onError: ((FilensPreviewError) -> Void)?

    private let webView: WKWebView
    private let messages = PreviewMessages()
    private var server: PreviewServer?
    private var directory: URL?
    private var requestId = UUID().uuidString
    private var pageURL: URL?
    private var activeNavigation: WKNavigation?
    private var destroyed = false

    public override init(frame: CGRect) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init(frame: frame)
        messages.owner = self
        configuration.userContentController.add(messages, name: "filens")
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init(frame:)") }

    /// Copies a file (including a security-scoped document-picker URL) off the UI thread.
    /// The private copy lasts until the next open(), close() or view deallocation.
    public func open(fileURL: URL, name: String? = nil, options: FilensPreviewOptions = .init()) {
        guard !destroyed else { report("view_destroyed", "Create a new FilensPreviewView after destroy()."); return }
        close()
        guard fileURL.isFileURL else { report("io_error", "A local file URL is required."); return }
        guard let assets = Bundle.module.resourceURL?.appendingPathComponent("filens"),
              FileManager.default.fileExists(atPath: assets.appendingPathComponent("mobile.html").path) else {
            report("engine_unavailable", "Missing SDK assets. Run npm run build:sdk:mobile before building the app.")
            return
        }
        let id = requestId
        let displayName = name ?? fileURL.lastPathComponent
        let contentType = UTType(filenameExtension: (displayName as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let work = FileManager.default.temporaryDirectory.appendingPathComponent("filens-\(UUID().uuidString)", isDirectory: true)
            let input = work.appendingPathComponent("document")
            do {
                try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
                let scoped = fileURL.startAccessingSecurityScopedResource()
                defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
                let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey])
                guard values.isRegularFile == true else { throw CocoaError(.fileReadUnsupportedScheme) }
                try FileManager.default.copyItem(at: fileURL, to: input)
                var metadata: [String: Any] = ["requestId": id, "url": "./document", "name": displayName, "toolbar": options.toolbar]
                if let locale = options.locale { metadata["locale"] = locale }
                let data = try JSONSerialization.data(withJSONObject: metadata)
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.requestId == id, !self.destroyed else {
                        try? FileManager.default.removeItem(at: work); return
                    }
                    self.directory = work
                    let server = PreviewServer(assets: assets, document: input, metadata: data, contentType: contentType)
                    self.server = server
                    do {
                        try server.start { [weak self] result in
                            guard let self, self.requestId == id else { return }
                            switch result {
                            case .success(let url):
                                var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
                                components.queryItems = [URLQueryItem(name: "requestId", value: id)]
                                self.pageURL = components.url!
                                self.activeNavigation = self.webView.load(URLRequest(url: components.url!))
                            case .failure(let error):
                                self.close()
                                self.report("io_error", error.localizedDescription)
                            }
                        }
                    } catch {
                        self.close()
                        self.report("io_error", error.localizedDescription)
                    }
                }
            } catch {
                try? FileManager.default.removeItem(at: work)
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.requestId == id else { return }
                    self.report("io_error", error.localizedDescription)
                }
            }
        }
    }

    /// Cancels loading and releases the file copy and loopback listener. The view can reopen.
    public func close() {
        requestId = UUID().uuidString
        pageURL = nil
        activeNavigation = nil
        webView.stopLoading()
        webView.loadHTMLString("", baseURL: nil)
        server?.stop()
        server = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil
    }

    public func destroy() {
        guard !destroyed else { return }
        close()
        destroyed = true
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "filens")
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
        onRendered = nil
        onError = nil
    }

    deinit {
        server?.stop()
        if let directory { try? FileManager.default.removeItem(at: directory) }
    }

    fileprivate func receive(_ message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let pageURL,
              message.frameInfo.securityOrigin.host == pageURL.host,
              message.frameInfo.securityOrigin.port == pageURL.port,
              let body = message.body as? String, let data = body.data(using: .utf8),
              let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              event["requestId"] as? String == requestId else { return }
        if event["type"] as? String == "rendered" { onRendered?() }
        else if event["type"] as? String == "error", let error = event["error"] as? [String: String] {
            report(error["code"] ?? "preview_failed", error["message"] ?? "Preview failed")
        }
    }

    private func report(_ code: String, _ message: String) {
        onError?(FilensPreviewError(code: code, message: message))
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if navigationAction.targetFrame?.isMainFrame == false,
           url.absoluteString == "about:srcdoc" || url.scheme == "blob" || url.scheme == "data"
               || url == pageURL?.deletingLastPathComponent().appendingPathComponent("document") {
            decisionHandler(.allow); return
        }
        // User links never navigate away from the private runtime or open another app.
        decisionHandler(url == pageURL ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if navigation === activeNavigation, (error as NSError).code != NSURLErrorCancelled, pageURL != nil {
            report("webview_error", error.localizedDescription)
        }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if navigation === activeNavigation, (error as NSError).code != NSURLErrorCancelled, pageURL != nil {
            report("webview_error", error.localizedDescription)
        }
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        close()
        report("webview_terminated", "The preview process stopped. Reopen the file to retry.")
    }
}

@MainActor
private final class PreviewMessages: NSObject, WKScriptMessageHandler {
    weak var owner: FilensPreviewView?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receive(message)
    }
}
#endif
