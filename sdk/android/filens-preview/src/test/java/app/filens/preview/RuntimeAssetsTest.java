package app.filens.preview;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.GZIPOutputStream;

/** Runs with a JDK and the declared Brotli dependency, without Android stubs. */
public final class RuntimeAssetsTest {
    private static final byte[] TEXT = "export const answer = 42;".getBytes(StandardCharsets.UTF_8);
    private static final byte[] BROTLI = Base64.getDecoder().decode("CwyAZXhwb3J0IGNvbnN0IGFuc3dlciA9IDQyOwM=");

    public static void main(String[] args) throws Exception {
        Map<String, byte[]> files = new HashMap<>();
        List<String> closed = new ArrayList<>();
        RuntimeAssets.Opener opener = name -> {
            byte[] bytes = files.get(name);
            if (bytes == null) throw new FileNotFoundException(name);
            return new ByteArrayInputStream(bytes) {
                @Override public void close() throws IOException { closed.add(name); super.close(); }
            };
        };
        files.put("entry.br", BROTLI);
        files.put("entry.gz", gzip(TEXT));
        if (args.length > 0 && args[0].equals("--without-brotli")) {
            check(opener, "entry", TEXT);
            if (!closed.contains("entry.br")) throw new AssertionError("Missing decoder leaked its input");
            System.out.println("Missing Brotli dependency falls back to gzip without crashing");
            return;
        }
        files.put("entry", "plain".getBytes(StandardCharsets.UTF_8));
        check(opener, "entry", "plain".getBytes(StandardCharsets.UTF_8));
        files.remove("entry");
        check(opener, "entry", TEXT);
        files.put("entry.br", new byte[]{(byte) 255});
        check(opener, "entry", TEXT);
        if (!closed.contains("entry.br")) throw new AssertionError("Broken Brotli input was not closed");
        files.put("entry.gz", new byte[]{1, 2, 3});
        try { RuntimeAssets.open(opener, "entry"); throw new AssertionError("Corrupt assets were accepted"); }
        catch (RuntimeAssets.MissingAssetException expected) {
            if (!expected.getMessage().contains("entry")) throw new AssertionError("Missing actionable asset name");
        }
        if (!closed.contains("entry.gz")) throw new AssertionError("Broken gzip input was not closed");
        missing(opener, "mobile.html");
        files.put("filens/mobile.html", TEXT);
        missing(opener, "mobile.js");
        files.put("filens/mobile.js", TEXT);
        missing(opener, "filens.js");
        files.put("filens/filens.js.br", BROTLI);
        RuntimeAssets.validate(opener);
        files.put("filens/mobile.js", new byte[0]);
        missing(opener, "mobile.js");
        System.out.println("Runtime asset precedence, Brotli/gzip decoding, corruption cleanup and startup validation passed");
    }

    private static void missing(RuntimeAssets.Opener opener, String name) throws Exception {
        try { RuntimeAssets.validate(opener); throw new AssertionError("Missing entry was accepted: " + name); }
        catch (RuntimeAssets.MissingAssetException expected) {
            if (!expected.getMessage().contains(name)) throw new AssertionError(expected);
        }
    }

    private static void check(RuntimeAssets.Opener opener, String name, byte[] expected) throws Exception {
        try (InputStream input = RuntimeAssets.open(opener, name)) {
            if (!Arrays.equals(input.readAllBytes(), expected)) throw new AssertionError(name);
        }
        try (InputStream input = RuntimeAssets.open(opener, name)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            output.write(input.read());
            output.write(input.read());
            byte[] buffer = new byte[7];
            for (int size; (size = input.read(buffer)) != -1;) output.write(buffer, 0, size);
            if (!Arrays.equals(output.toByteArray(), expected)) throw new AssertionError("Mixed stream reads lost bytes: " + name);
        }
    }

    private static byte[] gzip(byte[] bytes) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(output)) { gzip.write(bytes); }
        return output.toByteArray();
    }
}
