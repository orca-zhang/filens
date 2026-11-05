//! Static two-byte prefix indexes for fixed header signatures.
//! Tables are sorted at compile time; loading and lookups allocate no memory.
//! Equal keys keep declaration order: minimum lengths/guards can reject an
//! earlier candidate, so a lexicographic predecessor alone is not sufficient.

#[derive(Clone, Copy)]
struct Signature {
    magic: &'static [u8],
    format: &'static str,
    minimum: u16,
    check: Check,
    phase: Phase,
}
#[derive(Clone, Copy)]
enum Phase {
    Base,
    #[cfg(feature = "format-detection-expanded")]
    Expanded,
}
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Matches {
    pub base: Option<&'static str>,
    #[cfg(feature = "format-detection-expanded")]
    pub expanded: Option<&'static str>,
}
impl Matches {
    fn record(&mut self, rule: Signature) {
        let slot = match rule.phase {
            Phase::Base => &mut self.base,
            #[cfg(feature = "format-detection-expanded")]
            Phase::Expanded => &mut self.expanded,
        };
        if slot.is_none() {
            *slot = Some(rule.format);
        }
    }
}
#[derive(Clone, Copy)]
enum Check {
    None,
    Bzip2,
    Dwg,
}
impl Signature {
    const fn new(magic: &'static [u8], minimum: u16, format: &'static str) -> Self {
        assert!(magic.len() >= 2 && magic.len() <= minimum as usize);
        Self {
            magic,
            minimum,
            format,
            check: Check::None,
            phase: Phase::Base,
        }
    }
    const fn guarded(mut self, check: Check) -> Self {
        self.check = check;
        self
    }
    const fn key(self) -> u16 {
        u16::from_be_bytes([self.magic[0], self.magic[1]])
    }
    fn matches(self, head: &[u8]) -> bool {
        head.len() >= self.minimum as usize
            && head.starts_with(self.magic)
            && match self.check {
                Check::None => true,
                Check::Bzip2 => head.get(3).is_some_and(|b| (b'1'..=b'9').contains(b)),
                Check::Dwg => head
                    .get(..6)
                    .and_then(|b| <&[u8; 6]>::try_from(b).ok())
                    .is_some_and(|version| DWG_VERSIONS.binary_search(version).is_ok()),
            }
    }
}

struct Table<const N: usize> {
    keys: [u16; N],
    rules: [Signature; N],
}
impl<const N: usize> Table<N> {
    const fn new(mut rules: [Signature; N]) -> Self {
        // Stable insertion sort runs only in const evaluation, never at startup.
        let mut i = 1;
        while i < N {
            let entry = rules[i];
            let mut p = i;
            while p > 0 && rules[p - 1].key() > entry.key() {
                rules[p] = rules[p - 1];
                p -= 1;
            }
            rules[p] = entry;
            i += 1;
        }
        let mut keys = [0; N];
        i = 0;
        while i < N {
            keys[i] = rules[i].key();
            i += 1;
        }
        Self { keys, rules }
    }
    fn find(&self, head: &[u8]) -> Matches {
        find(&self.keys, &self.rules, head)
    }
}

fn find(keys: &[u16], rules: &[Signature], head: &[u8]) -> Matches {
    let mut found = Matches::default();
    let Some(prefix) = head.get(..2) else {
        return found;
    };
    let key = u16::from_be_bytes([prefix[0], prefix[1]]);
    let mut index = keys.partition_point(|&candidate| candidate < key);
    while keys.get(index) == Some(&key) {
        let rule = rules[index];
        if rule.matches(head) {
            found.record(rule);
        }
        index += 1;
    }
    found
}

static DWG_VERSIONS: [[u8; 6]; 13] = [
    *b"AC1002", *b"AC1003", *b"AC1004", *b"AC1006", *b"AC1009", *b"AC1012", *b"AC1014", *b"AC1015",
    *b"AC1018", *b"AC1021", *b"AC1024", *b"AC1027", *b"AC1032",
];

// One dispatch finds both phases, while callers retain their original order.
pub(super) fn lookup(head: &[u8]) -> Matches {
    HEADERS.find(head)
}

#[cfg(not(feature = "format-detection-expanded"))]
static HEADERS: Table<38> = Table::new(BASE);
#[cfg(feature = "format-detection-expanded")]
static HEADERS: Table<66> = Table::new(combine(BASE, EXPANDED));

#[cfg(feature = "format-detection-expanded")]
const fn combine(base: [Signature; 38], expanded: [Signature; 28]) -> [Signature; 66] {
    let mut rules = [base[0]; 66];
    let mut index = 0;
    while index < base.len() {
        rules[index] = base[index];
        index += 1;
    }
    index = 0;
    while index < expanded.len() {
        let mut rule = expanded[index];
        rule.phase = Phase::Expanded;
        rules[base.len() + index] = rule;
        index += 1;
    }
    rules
}

const BASE: [Signature; 38] = [
    Signature::new(b"\xff\xd8\xff", 4, "jpg"),
    Signature::new(b"GIF87a", 13, "gif"),
    Signature::new(b"GIF89a", 13, "gif"),
    Signature::new(b"%PDF-", 8, "pdf"),
    Signature::new(b"icns", 8, "icns"),
    Signature::new(b"\x76\x2f\x31\x01", 8, "exr"),
    Signature::new(b"qoif", 14, "qoi"),
    Signature::new(b"farbfeld", 16, "ff"),
    Signature::new(b"DDS ", 128, "dds"),
    Signature::new(b"FUJIFILMCCD-RAW", 16, "raf"),
    Signature::new(b"\0MRM", 8, "mrw"),
    Signature::new(b"FOVb", 16, "x3f"),
    Signature::new(b"fLaC", 8, "flac"),
    Signature::new(b"ID3", 10, "mp3"),
    Signature::new(b"MThd\0\0\0\x06", 14, "mid"),
    Signature::new(b"7z\xbc\xaf\x27\x1c", 32, "7z"),
    Signature::new(b"Rar!\x1a\x07\0", 7, "rar"),
    Signature::new(b"Rar!\x1a\x07\x01\0", 8, "rar"),
    Signature::new(b"\x1f\x8b\x08", 10, "gz"),
    Signature::new(b"BZh", 4, "bz2").guarded(Check::Bzip2),
    Signature::new(b"\xfd7zXZ\0", 12, "xz"),
    Signature::new(b"\x28\xb5\x2f\xfd", 5, "zst"),
    Signature::new(b"MSCF", 36, "cab"),
    Signature::new(b"!<arch>\n", 8, "ar"),
    Signature::new(b"xar!", 28, "xar"),
    Signature::new(b"MSWIM\0\0\0", 48, "wim"),
    Signature::new(b"\xed\xab\xee\xdb", 96, "rpm"),
    Signature::new(b"glTF\x02\0\0\0", 12, "glb"),
    Signature::new(b"AC10", 6, "dwg").guarded(Check::Dwg),
    Signature::new(b"ply\n", 4, "ply"),
    Signature::new(b"ply\r\n", 5, "ply"),
    Signature::new(b"ISO-10303-21;", 13, "step"),
    Signature::new(b"#?RADIANCE\n", 11, "hdr"),
    Signature::new(b"#?RGBE\n", 7, "hdr"),
    Signature::new(b"{\\rtf", 6, "rtf"),
    Signature::new(b"\0\0\0\x0cjP  \r\n\x87\n", 12, "jp2"),
    Signature::new(b"\0\0\0\x0cJXL \r\n\x87\n", 12, "jxl"),
    Signature::new(b"\xff\x0a", 2, "jxl"),
];

#[cfg(feature = "format-detection-expanded")]
const EXPANDED: [Signature; 28] = [
    Signature::new(b"\0asm\x01\0\0\0", 8, "wasm"),
    Signature::new(b"SQLite format 3\0", 100, "sqlite"),
    Signature::new(b"wOFF", 44, "woff"),
    Signature::new(b"wOF2", 48, "woff2"),
    Signature::new(b"OTTO", 12, "otf"),
    Signature::new(b"ttcf", 12, "ttc"),
    Signature::new(b"\x93NUMPY", 10, "npy"),
    Signature::new(b"MATLAB 5.0 MAT-file", 128, "mat"),
    Signature::new(b"\x89HDF\r\n\x1a\n", 16, "h5"),
    Signature::new(b"\x0e\x03\x13\x01", 4, "hdf"),
    Signature::new(b"CDF\x01", 8, "nc"),
    Signature::new(b"CDF\x02", 8, "nc"),
    Signature::new(b"Obj\x01", 5, "avro"),
    Signature::new(b"fLaC", 8, "flac"),
    Signature::new(b"#!AMR\n", 6, "amr"),
    Signature::new(b"#!AMR-WB\n", 9, "awb"),
    Signature::new(b"caff\0\x01\0\0", 8, "caf"),
    Signature::new(b"DSD ", 28, "dsf"),
    Signature::new(b"BPG\xfb", 4, "bpg"),
    Signature::new(b"gimp xcf ", 14, "xcf"),
    Signature::new(b"\xabKTX 11\xbb\r\n\x1a\n", 64, "ktx"),
    Signature::new(b"\xabKTX 20\xbb\r\n\x1a\n", 80, "ktx2"),
    Signature::new(b"ITSF\x03\0\0\0", 60, "chm"),
    Signature::new(b"NES\x1a", 16, "nes"),
    Signature::new(b"IMPM", 192, "it"),
    Signature::new(b"Extended Module: ", 80, "xm"),
    Signature::new(b"Creative Voice File\x1a", 26, "voc"),
    Signature::new(
        b"\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9\0\xaa\0\x62\xce\x6c",
        30,
        "asf",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefix_collisions_keep_priority_and_try_later_candidates_after_rejection() {
        const TABLE: Table<5> = Table::new([
            Signature::new(b"zz", 2, "last"),
            Signature::new(b"ab", 4, "short"),
            Signature::new(b"abc", 3, "long"),
            Signature::new(b"aa", 2, "first"),
            Signature::new(b"\xff\xff", 2, "binary"),
        ]);
        assert_eq!(TABLE.find(b"abcd").base, Some("short"));
        assert_eq!(TABLE.find(b"abc").base, Some("long"));
        assert_eq!(TABLE.find(b"ab").base, None);
        assert_eq!(TABLE.find(b"aa").base, Some("first"));
        assert_eq!(TABLE.find(b"zz").base, Some("last"));
        assert_eq!(TABLE.find(b"\xff\xff").base, Some("binary"));
        assert_eq!(TABLE.find(b"").base, None);
        assert_eq!(TABLE.find(b"a").base, None);
        assert_eq!(TABLE.find(b"ac").base, None);
        const GUARDED: Table<2> = Table::new([
            Signature::new(b"BZh", 4, "bz2").guarded(Check::Bzip2),
            Signature::new(b"BZhello", 7, "prose"),
        ]);
        assert_eq!(GUARDED.find(b"BZh9").base, Some("bz2"));
        assert_eq!(GUARDED.find(b"BZhello").base, Some("prose"));
    }

    fn verify<const N: usize>(table: &Table<N>) {
        assert!(table.keys.windows(2).all(|pair| pair[0] <= pair[1]));
        for rule in table.rules {
            let mut head = vec![0; rule.minimum as usize];
            head[..rule.magic.len()].copy_from_slice(rule.magic);
            match rule.check {
                Check::Bzip2 => head[3] = b'9',
                Check::Dwg => head[..6].copy_from_slice(b"AC1032"),
                Check::None => {}
            }
            let found = table.find(&head);
            match rule.phase {
                Phase::Base => assert_eq!(found.base, Some(rule.format)),
                #[cfg(feature = "format-detection-expanded")]
                Phase::Expanded => assert_eq!(found.expanded, Some(rule.format)),
            }
            for length in 0..head.len() {
                assert_eq!(
                    table.find(&head[..length]),
                    Matches::default(),
                    "{} cut at {length}",
                    rule.format
                );
            }
        }
        // Exercise every possible dispatch key, including absent keys and both
        // ends of the table. The oracle deliberately has no index or ordering.
        let mut head = [0; 192];
        for key in 0..=u16::MAX {
            head[..2].copy_from_slice(&key.to_be_bytes());
            let mut expected = Matches::default();
            for rule in table.rules.iter().filter(|r| r.matches(&head)) {
                expected.record(*rule);
            }
            assert_eq!(table.find(&head), expected, "key {key:04x}");
        }
    }

    #[test]
    #[cfg(feature = "format-detection-expanded")]
    fn one_lookup_retains_independent_first_matches_for_both_phases() {
        let mut expanded = Signature::new(b"abc", 3, "expanded");
        expanded.phase = Phase::Expanded;
        let table = Table::new([
            Signature::new(b"ab", 4, "base"),
            expanded,
            Signature::new(b"abc", 3, "base-fallback"),
        ]);
        assert_eq!(
            table.find(b"abcd"),
            Matches {
                base: Some("base"),
                expanded: Some("expanded")
            }
        );
        assert_eq!(
            table.find(b"abc"),
            Matches {
                base: Some("base-fallback"),
                expanded: Some("expanded")
            }
        );
    }

    #[test]
    fn every_key_and_signature_boundary_agrees_with_linear_matching() {
        verify(&HEADERS);
        assert!(DWG_VERSIONS.windows(2).all(|p| p[0] < p[1]));
    }
}
