package app.filens.preview;

import java.io.IOException;
import java.io.InputStream;
import java.io.BufferedInputStream;
import java.util.zip.GZIPInputStream;
import org.brotli.dec.BrotliInputStream;

/** Resource transport only; decoders stream with bounded buffers and own their input. */
final class RuntimeAssets {
    interface Opener { InputStream open(String path) throws IOException; }

    // Keep verification of the optional AAR dependency inside the guarded call.
    private static final class BrotliDecoder {
        static InputStream open(InputStream input) throws IOException { return new BrotliInputStream(input, 1); }
    }

    static final class MissingAssetException extends IOException {
        MissingAssetException(String path, Throwable cause) {
            super("Cannot load SDK asset " + path + ". Run node prepare-runtime.mjs at the SDK ZIP root or rebuild resources; Brotli assets require org.brotli:dec:0.1.2.", cause);
        }
    }

    static InputStream open(Opener opener, String path) throws IOException {
        IOException failure = null;
        String[] suffixes = {"", ".br", ".gz"};
        for (int format = 0; format < suffixes.length; format++) {
            InputStream input;
            try { input = opener.open(path + suffixes[format]); }
            catch (IOException error) {
                if (failure == null) failure = error;
                else failure.addSuppressed(error);
                continue;
            }
            if (format == 0) return input;
            InputStream decoded = input;
            try {
                decoded = format == 1 ? BrotliDecoder.open(input) : new GZIPInputStream(input, 65536);
                // Brotli 0.1.2 must receive bulk reads even when WebView mixes read() and read(byte[]).
                BufferedInputStream verified = new BufferedInputStream(decoded, 65536);
                verified.mark(1);
                int first = verified.read();
                if (first >= 0) verified.reset();
                return verified;
            }
            catch (IOException | RuntimeException | LinkageError error) {
                try { decoded.close(); } catch (IOException closeError) { error.addSuppressed(closeError); }
                IOException cause = error instanceof IOException ? (IOException) error : new IOException("Runtime decoder unavailable", error);
                if (failure == null) failure = cause;
                else failure.addSuppressed(cause);
            }
        }
        throw new MissingAssetException(path, failure);
    }

    static void validate(Opener opener) throws IOException {
        // Missing entry scripts cannot report through the JavaScript bridge.
        for (String name : new String[]{"mobile.html", "mobile.js", "filens.js"}) {
            String path = "filens/" + name;
            try (InputStream input = open(opener, path)) {
                if (input.read() < 0) throw new IOException("Empty SDK asset");
            } catch (IOException error) { throw new MissingAssetException(path, error); }
        }
    }
}
