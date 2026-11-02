package app.filens.preview;

// Runs with a JDK alone, without an emulator or Android stubs.
public final class ByteRangeTest {
    public static void main(String[] args) {
        check(null, 10, 0, 10);
        check(null, 0, 0, 0);
        check("bytes=2-4", 10, 2, 5);
        check("bytes=7-", 10, 7, 10);
        check("bytes=-3", 10, 7, 10);
        check("bytes=5-999", 10, 5, 10);
        check("bytes=0-9223372036854775807", 10, 0, 10);
        for (String value : new String[]{"bytes=10-", "bytes=-0", "bytes=6-2", "bytes=0-1,3-4", "bytes=a-b", "bytes=+1-2", "bytes=0-9223372036854775808"}) {
            try { ByteRange.parse(value, 10); throw new AssertionError(value); }
            catch (IllegalArgumentException expected) { }
        }
        try { ByteRange.parse("bytes=0-", 0); throw new AssertionError("Empty file range"); }
        catch (IllegalArgumentException expected) { }
        System.out.println("Android byte range checks passed");
    }
    private static void check(String value, long length, long start, long end) {
        ByteRange range = ByteRange.parse(value, length);
        if (range.start != start || range.end != end) throw new AssertionError(value);
    }
}
