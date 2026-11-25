# The bridge uses AndroidX WebMessageListener; no JavascriptInterface reflection.
# Preserve lazy Brotli linkage so legacy resources can fall back without the decoder.
-keep,allowshrinking,allowobfuscation class app.filens.preview.RuntimeAssets$BrotliDecoder { *; }
