package app.filens.preview;

/** Single HTTP byte ranges, with an exclusive end. No format-specific behavior. */
final class ByteRange {
    final long start;
    final long end;
    private ByteRange(long start, long end) { this.start = start; this.end = end; }

    static ByteRange parse(String value, long length) {
        if (value == null) return new ByteRange(0, length);
        if (length <= 0 || !value.startsWith("bytes=")) throw new IllegalArgumentException("Invalid range");
        String[] parts = value.substring(6).split("-", -1);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid range");
        if (parts[0].isEmpty()) {
            long suffix = number(parts[1]);
            if (suffix == 0) throw new IllegalArgumentException("Invalid suffix");
            return new ByteRange(length - Math.min(suffix, length), length);
        }
        long start = number(parts[0]);
        if (start >= length) throw new IllegalArgumentException("Range outside file");
        if (parts[1].isEmpty()) return new ByteRange(start, length);
        long end = number(parts[1]);
        if (end < start) throw new IllegalArgumentException("Reversed range");
        return new ByteRange(start, Math.min(end, length - 1) + 1);
    }

    private static long number(String value) {
        if (value.isEmpty()) throw new IllegalArgumentException("Empty range");
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) < '0' || value.charAt(i) > '9') throw new IllegalArgumentException("Invalid range");
        }
        return Long.parseLong(value);
    }
}
