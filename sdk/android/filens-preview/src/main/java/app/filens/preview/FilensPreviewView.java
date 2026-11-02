package app.filens.preview;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Looper;
import android.os.Handler;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.MimeTypeMap;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline preview host. Call public methods on the UI thread. */
public final class FilensPreviewView extends FrameLayout {
    private static final String ORIGIN = "https://appassets.androidplatform.net";

    public interface Listener {
        void onRendered();
        void onError(String code, String message);
    }

    public static final class Options {
        public final String locale;
        public final boolean toolbar;
        public Options() { this(null, true); }
        public Options(String locale, boolean toolbar) { this.locale = locale; this.toolbar = toolbar; }
    }

    private static final class Source {
        final String id;
        final File file;
        final byte[] metadata;
        final String contentType;
        Source(String id, File file, byte[] metadata, String contentType) {
            this.id = id; this.file = file; this.metadata = metadata; this.contentType = contentType;
        }
    }

    private final WebView webView;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final WebViewAssetLoader assets;
    private volatile String requestId = UUID.randomUUID().toString();
    private volatile Source source;
    private Listener listener;
    private boolean destroyed;
    private final boolean bridgeAvailable;

    @SuppressLint("SetJavaScriptEnabled")
    public FilensPreviewView(Context context) {
        super(context);
        requireMainThread();
        webView = new WebView(context);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        assets = new WebViewAssetLoader.Builder().addPathHandler("/filens/", this::asset).build();
        bridgeAvailable = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        if (bridgeAvailable) {
            WebViewCompat.addWebMessageListener(webView, "filensNative", Collections.singleton(ORIGIN),
                (view, message, origin, mainFrame, reply) -> {
                    if (!mainFrame || !ORIGIN.equals(origin.toString())) return;
                    try {
                        JSONObject event = new JSONObject(message.getData());
                        if (!requestId.equals(event.optString("requestId")) || source == null) return;
                        if ("rendered".equals(event.optString("type"))) {
                            if (listener != null) listener.onRendered();
                        } else if ("error".equals(event.optString("type"))) {
                            JSONObject error = event.optJSONObject("error");
                            if (error != null) report(error.optString("code", "preview_failed"), error.optString("message", "Preview failed"));
                        }
                    } catch (Exception ignored) { /* Reject malformed bridge messages. */ }
                });
        }
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!ORIGIN.equals(url.getScheme() + "://" + url.getAuthority())) return empty(403, "Forbidden");
                if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) return empty(405, "Method Not Allowed");
                Source current = source;
                if (current != null && ("/filens/" + current.id + "/document").equals(url.getPath())) {
                    return document(current, request);
                }
                WebResourceResponse response = assets.shouldInterceptRequest(url);
                return response == null ? empty(404, "Not Found") : response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!request.isForMainFrame() && (url.toString().equals("about:srcdoc") || url.toString().equals("about:blank")
                    || "blob".equals(url.getScheme()) || "data".equals(url.getScheme())
                    || (ORIGIN + "/filens/" + requestId + "/document").equals(url.toString()))) return false;
                return !pageURL().equals(request.getUrl().toString());
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && pageURL().equals(request.getUrl().toString())) {
                    report("webview_error", error.getDescription().toString());
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                Listener callback = listener;
                destroy();
                if (callback != null) callback.onError("webview_terminated", "The preview process stopped. Create a new preview view to retry.");
                return true;
            }
        });
        addView(webView, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    }

    public void setListener(Listener listener) { requireMainThread(); this.listener = listener; }

    public void open(Uri uri) { open(uri, null, new Options()); }

    /** Copies a content:// or file:// source off the UI thread; no filesystem permission is requested. */
    public void open(Uri uri, String name, Options options) {
        requireMainThread();
        if (destroyed) { report("view_destroyed", "Create a new FilensPreviewView after destroy()."); return; }
        close();
        if (!bridgeAvailable) { report("engine_unavailable", "Update Android System WebView to enable WebMessageListener."); return; }
        if (uri == null || !("content".equals(uri.getScheme()) || "file".equals(uri.getScheme()))) {
            report("io_error", "A local content:// or file:// URI is required."); return;
        }
        final String id = requestId;
        final Options settings = options == null ? new Options() : options;
        io.execute(() -> {
            File copy = null;
            try {
                // Fail explicitly when the generated runtime has not been staged.
                try (InputStream ignored = getContext().getAssets().open("filens/mobile.html")) { }
                copy = File.createTempFile("filens-", ".input", getContext().getCacheDir());
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     FileOutputStream output = new FileOutputStream(copy)) {
                    if (input == null) throw new IOException("Cannot open source URI");
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (!id.equals(requestId)) throw new IOException("Preview cancelled");
                        output.write(buffer, 0, count);
                    }
                }
                String displayName = name == null ? displayName(uri) : name;
                int dot = displayName.lastIndexOf('.');
                String contentType = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(displayName.substring(dot + 1).toLowerCase(java.util.Locale.ROOT));
                if (contentType == null) contentType = "application/octet-stream";
                JSONObject metadata = new JSONObject().put("requestId", id).put("url", "./document")
                    .put("name", displayName).put("toolbar", settings.toolbar);
                if (settings.locale != null) metadata.put("locale", settings.locale);
                Source next = new Source(id, copy, metadata.toString().getBytes(StandardCharsets.UTF_8), contentType);
                main.post(() -> {
                    if (!id.equals(requestId) || destroyed) { next.file.delete(); return; }
                    source = next;
                    webView.loadUrl(pageURL());
                });
            } catch (Exception error) {
                if (copy != null) copy.delete();
                main.post(() -> { if (id.equals(requestId) && !destroyed) report("io_error", error.getMessage()); });
            }
        });
    }

    /** Cancels the current preview, clears the page and deletes its private file copy. */
    public void close() {
        requireMainThread();
        requestId = UUID.randomUUID().toString();
        Source previous = source;
        source = null;
        if (!destroyed) { webView.stopLoading(); webView.loadUrl("about:blank"); }
        if (previous != null) previous.file.delete();
    }

    /** Call from Activity/Fragment teardown. The view cannot reopen after this call. */
    public void destroy() {
        requireMainThread();
        if (destroyed) return;
        destroyed = true;
        close();
        io.shutdownNow();
        if (bridgeAvailable) WebViewCompat.removeWebMessageListener(webView, "filensNative");
        removeView(webView);
        webView.destroy();
        listener = null;
    }

    private String pageURL() { return ORIGIN + "/filens/" + requestId + "/mobile.html?requestId=" + requestId; }

    private String displayName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
            } catch (Exception ignored) { }
        }
        return uri.getLastPathSegment() == null ? "document" : uri.getLastPathSegment();
    }

    private WebResourceResponse asset(String path) {
        Source current = source;
        if (current == null || !path.startsWith(current.id + "/")) return empty(404, "Not Found");
        String relative = path.substring(current.id.length() + 1);
        for (String part : relative.split("/", -1)) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.contains("\\") || part.indexOf(0) >= 0) return empty(404, "Not Found");
        }
        if (relative.equals("source.json")) return response("application/json", new ByteArrayInputStream(current.metadata));
        // The selected source is exposed only by document(), never by arbitrary URI/path resolution.
        if (relative.equals("document")) return empty(404, "Not Found");
        try { return response(mime(relative), getContext().getAssets().open("filens/" + relative)); }
        catch (IOException error) { return empty(404, "Not Found"); }
    }

    private WebResourceResponse document(Source current, WebResourceRequest request) {
        try {
            String value = null;
            for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
                if (header.getKey().equalsIgnoreCase("Range")) value = header.getValue();
            }
            long size = current.file.length();
            ByteRange range;
            try { range = ByteRange.parse(value, size); }
            catch (IllegalArgumentException error) {
                Map<String, String> headers = headers();
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse("text/plain", null, 416, "Range Not Satisfiable", headers, new ByteArrayInputStream(new byte[0]));
            }
            Map<String, String> headers = headers();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Content-Length", Long.toString(range.end - range.start));
            if (value != null) headers.put("Content-Range", "bytes " + range.start + "-" + (range.end - 1) + "/" + size);
            InputStream stream = new ByteArrayInputStream(new byte[0]);
            if (!"HEAD".equals(request.getMethod())) {
                FileInputStream file = new FileInputStream(current.file);
                file.getChannel().position(range.start);
                stream = new LimitedInputStream(file, range.end - range.start);
            }
            return new WebResourceResponse(current.contentType, null, value == null ? 200 : 206,
                value == null ? "OK" : "Partial Content", headers, stream);
        } catch (IOException error) { return empty(404, "Not Found"); }
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long remaining;
        LimitedInputStream(InputStream input, long remaining) { super(input); this.remaining = remaining; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int value = in.read(); if (value >= 0) remaining--; return value;
        }
        @Override public int read(byte[] bytes, int offset, int length) throws IOException {
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = in.read(bytes, offset, (int) Math.min(length, remaining));
            if (count > 0) remaining -= count;
            return count;
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'self' blob: data:; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'none'; form-action 'none'");
        return headers;
    }
    private static WebResourceResponse response(String mime, InputStream stream) {
        return new WebResourceResponse(mime, null, 200, "OK", headers(), stream);
    }
    private static WebResourceResponse empty(int status, String reason) {
        return new WebResourceResponse("text/plain", null, status, reason, headers(), new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
    private void report(String code, String message) {
        if (listener != null) listener.onError(code, message == null ? "Preview failed" : message);
    }
    private static void requireMainThread() {
        if (Looper.myLooper() != Looper.getMainLooper()) throw new IllegalStateException("Use FilensPreviewView on the UI thread");
    }
}
