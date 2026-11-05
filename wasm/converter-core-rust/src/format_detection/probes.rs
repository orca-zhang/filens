//! Optional broader probes. All input is content; names/extensions never enter.
use super::*;

fn identified(
    format: &'static str,
    container: Option<&'static str>,
    reason: &'static str,
) -> Detection {
    Detection::new(Some(format), container, "structure", reason)
}
fn u16le(b: &[u8], p: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(p..p + 2)?.try_into().ok()?))
}
fn u16be(b: &[u8], p: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(p..p + 2)?.try_into().ok()?))
}

pub(super) fn header(h: &[u8], size: u64, fixed: Option<&'static str>) -> Option<Detection> {
    if at(h, 0, b"\0\0\0\x0cjP  \r\n\x87\n") {
        let brand = be32(h, 12)
            .filter(|&n| n >= 20 && n % 4 == 0 && n as usize <= h.len() - 12)
            .filter(|_| at(h, 16, b"ftyp"))
            .and_then(|_| h.get(20..24));
        return Some(match brand {
            Some(b"jp2 ") => Detection::signature("jp2"),
            Some(b"jpx " | b"jpxb") => Detection::signature("jpx"),
            Some(b"jpm ") => Detection::signature("jpm"),
            Some(b"mjp2" | b"mj2s") => Detection::signature("mj2"),
            _ => Detection::container("jpeg2000"),
        });
    }
    if let Some(format) = fixed {
        return Some(Detection::signature(format));
    }
    if h.len() >= 16
        && at(h, 0, b"\x7fELF")
        && [1, 2].contains(&h[4])
        && [1, 2].contains(&h[5])
        && h[6] == 1
    {
        return Some(Detection::signature("elf"));
    }
    if h.len() >= 12
        && at(h, 0, b"\0\x01\0\0")
        && u16be(h, 4).is_some_and(|n| n > 0 && n < 256)
        && size >= 12 + u64::from(u16be(h, 4)?) * 16
    {
        return Some(Detection::signature("ttf"));
    }
    if h.len() >= 10
        && at(h, 0, b"\xca\xfe\xba\xbe")
        && u16be(h, 6).is_some_and(|n| (45..=100).contains(&n))
    {
        return Some(Detection::signature("class"));
    }
    if h.len() >= 64 && at(h, 0, b"MZ") {
        let p = le32(h, 0x3c)? as usize;
        if p >= 64 && at(h, p, b"PE\0\0") && h.get(p..p.checked_add(24)?).is_some() {
            return Some(identified(
                if u16le(h, p + 22)? & 0x2000 != 0 {
                    "dll"
                } else {
                    "exe"
                },
                Some("pe"),
                "pe-file-header",
            ));
        }
    }
    if h.len() >= 512 && at(h, 0, b"SIMPLE  =") && h.get(29) == Some(&b'T') && size % 2880 == 0 {
        return Some(Detection::signature("fits"));
    }
    if h.len() >= 12 && at(h, 0, b"FORM") && (at(h, 8, b"AIFF") || at(h, 8, b"AIFC")) {
        return Some(Detection::signature("aif"));
    }
    if h.len() >= 16 && at(h, 0, b"FRM8") && at(h, 12, b"DSD ") {
        return Some(Detection::signature("dff"));
    }
    if h.len() >= 12 && at(h, 0, b"RIFF") && at(h, 8, b"QLCM") {
        return Some(Detection::signature("qcp"));
    }
    if h.len() >= 9 && at(h, 0, b"FLV\x01") && h[4] & !5 == 0 && be32(h, 5)? >= 9 {
        return Some(Detection::signature("flv"));
    }
    if h.len() >= 8
        && [b"FWS", b"CWS", b"ZWS"].iter().any(|m| at(h, 0, *m))
        && (1..=50).contains(&h[3])
        && le32(h, 4)? >= 8
    {
        return Some(Detection::signature("swf"));
    }
    if h.len() >= 23 && at(h, 0, b"Kaydara FBX Binary  \0\x1a\0") {
        return Some(Detection::signature("fbx"));
    }
    if h.len() >= 12
        && at(h, 0, b"BLENDER")
        && [b'_', b'-'].contains(&h[7])
        && [b'v', b'V'].contains(&h[8])
        && h[9..12].iter().all(u8::is_ascii_digit)
    {
        return Some(Detection::signature("blend"));
    }
    if h.len() >= 20 && at(h, 0, b"L\0\0\0\x01\x14\x02\0\0\0\0\0\xc0\0\0\0\0\0\0F") {
        return Some(Detection::signature("lnk"));
    }
    if h.len() >= 12 && at(h, 0, b"LZIP") && h[4] <= 1 {
        return Some(Detection::signature("lz"));
    }
    if h.len() >= 7 && at(h, 0, b"\x04\x22\x4d\x18") && h[4] >> 6 == 1 {
        return Some(Detection::signature("lz4"));
    }
    if h.len() >= 3 && at(h, 0, b"\x1f\x9d") && (9..=16).contains(&(h[2] & 31)) && h[2] & 0x60 == 0
    {
        return Some(Detection::signature("z"));
    }
    if h.len() >= 110
        && (at(h, 0, b"070701") || at(h, 0, b"070702"))
        && h[6..110].iter().all(u8::is_ascii_hexdigit)
    {
        return Some(Detection::signature("cpio"));
    }
    if h.len() >= 76 && at(h, 0, b"070707") && h[6..76].iter().all(|b| (b'0'..=b'7').contains(b)) {
        return Some(Detection::signature("cpio"));
    }
    if h.len() >= 14 && at(h, 7, b"**ACE**") {
        return Some(Detection::signature("ace"));
    }
    if h.len() >= 7 && at(h, 2, b"-lh") && h[6] == b'-' && h[2..7].iter().all(u8::is_ascii) {
        return Some(Detection::signature("lzh"));
    }
    if h.len() >= 72 && at(h, 0, b"!<arch>\n") && at(h, 8, b"debian-binary") && at(h, 68, b"2.0\n")
    {
        return Some(identified("deb", Some("ar"), "debian-package-marker"));
    }
    if h.len() >= 16 && at(h, 4, b"ftyp") {
        be32(h, 0).filter(|&n| n >= 16 && n % 4 == 0 && n as usize <= h.len())?;
        let format = match h.get(8..12)? {
            b"3g2a" | b"3g2b" | b"3g2c" => "3g2",
            b"M4V " => "m4v",
            b"M4B " => "m4b",
            b"M4P " => "m4p",
            b"F4V " => "f4v",
            b"F4A " => "f4a",
            b"F4B " => "f4b",
            b"F4P " => "f4p",
            b"mj2s" | b"mjp2" => "mj2",
            _ => return None,
        };
        return Some(identified(format, Some("isobmff"), "ftyp-major-brand"));
    }
    None
}

pub(super) fn deep<R: Read + Seek>(
    source: &mut R,
    head: &[u8],
    size: u64,
    current: &Detection,
) -> Option<Detection> {
    // A trailer-like byte sequence inside an identified format is not evidence
    // for another format. Avoid unnecessary seeks on ordinary recognized files.
    if current.format.is_some() {
        return None;
    }
    if current.container == Some("cfb") {
        // CFB's allocation tables scale with file length, even with bounded I/O.
        #[cfg(feature = "format-detection-compound")]
        if size <= 64 * 1024 * 1024 {
            return cfb_type(source);
        }
        return None;
    }
    if current.container == Some("tiff") {
        return tiff_type(source, head, size);
    }
    if current.container == Some("ebml") {
        return ebml(head).map(|f| identified(f, Some("ebml"), "ebml-document-type"));
    }
    if current.container == Some("ogg") {
        return ogg(head).map(|f| identified(f, Some("ogg"), "ogg-first-packet"));
    }
    if size >= 12 && (at(head, 0, b"PAR1") || at(head, 0, b"ARROW1")) {
        let marker = if at(head, 0, b"PAR1") {
            &b"PAR1"[..]
        } else {
            &b"ARROW1"[..]
        };
        let mut tail = vec![0; marker.len()];
        source.seek(SeekFrom::End(-(marker.len() as i64))).ok()?;
        source.read_exact(&mut tail).ok()?;
        if tail == marker {
            return Some(identified(
                if marker == b"PAR1" {
                    "parquet"
                } else {
                    "arrow"
                },
                None,
                "matching-file-markers",
            ));
        }
    }
    if size >= 0x8006 {
        let mut marker = [0; 6];
        source.seek(SeekFrom::Start(0x8000)).ok()?;
        source.read_exact(&mut marker).ok()?;
        if marker[0] <= 2 && &marker[1..] == b"CD001" {
            return Some(identified("iso", None, "iso-volume-descriptor"));
        }
    }
    if size >= 512 {
        let mut trailer = [0; 4];
        source.seek(SeekFrom::End(-512)).ok()?;
        source.read_exact(&mut trailer).ok()?;
        if &trailer == b"koly" {
            return Some(identified("dmg", None, "udif-trailer"));
        }
    }
    if head.starts_with(&[0xff, 0xfe]) || head.starts_with(&[0xfe, 0xff]) {
        let little = head[0] == 0xff;
        let values = head[2..].chunks_exact(2).map(|c| {
            if little {
                u16::from_le_bytes([c[0], c[1]])
            } else {
                u16::from_be_bytes([c[0], c[1]])
            }
        });
        let decoded = String::from_utf16(&values.collect::<Vec<_>>()).ok()?;
        return Some(super::text_format(
            decoded.as_bytes(),
            if size == head.len() as u64 {
                decoded.len() as u64
            } else {
                u64::MAX
            },
        ));
    }
    None
}

#[cfg(feature = "format-detection-compound")]
fn cfb_type<R: Read + Seek>(source: &mut R) -> Option<Detection> {
    source.seek(SeekFrom::Start(0)).ok()?;
    let mut file = cfb::OpenOptions::new()
        .max_buffer_size(8192)
        .open_with(source)
        .ok()?;
    let mut flags = 0u8;
    for entry in file.read_root_storage().filter(|entry| entry.is_stream()) {
        flags |= match entry.name() {
            "WordDocument" => 1,
            "Workbook" | "Book" => 2,
            "PowerPoint Document" => 4,
            "__properties_version1.0" => 8,
            "EncryptionInfo" => 16,
            "EncryptedPackage" => 32,
            _ => 0,
        };
    }
    if flags & 48 == 48 {
        return None;
    }
    let mut word_format = "doc";
    if flags & 1 != 0 {
        // Preserve the original read sequence even for conflicting families.
        let mut fib = [0; 12];
        file.open_stream("/WordDocument")
            .ok()?
            .read_exact(&mut fib)
            .ok()?;
        if u16le(&fib, 0) != Some(0xa5ec) {
            return None;
        }
        if u16le(&fib, 10)? & 1 != 0 {
            word_format = "dot";
        }
    }
    let format = match flags & 15 {
        1 => word_format,
        2 => "xls",
        4 => "ppt",
        8 => "msg",
        _ => return None,
    };
    Some(identified(format, Some("cfb"), "compound-root-stream"))
}

fn tiff_type<R: Read + Seek>(source: &mut R, h: &[u8], size: u64) -> Option<Detection> {
    let little = at(h, 0, b"II");
    let word = |b: &[u8], p| if little { u16le(b, p) } else { u16be(b, p) };
    let long = |b: &[u8], p| if little { le32(b, p) } else { be32(b, p) };
    if word(h, 2) != Some(42) {
        return None;
    }
    let offset = long(h, 4)? as u64;
    if offset < 8 || offset + 2 > size {
        return None;
    }
    source.seek(SeekFrom::Start(offset)).ok()?;
    let mut count = [0; 2];
    source.read_exact(&mut count).ok()?;
    let count = word(&count, 0)? as usize;
    if count > 512 || offset + 2 + count as u64 * 12 + 4 > size {
        return None;
    }
    let mut entries = vec![0; count * 12];
    source.read_exact(&mut entries).ok()?;
    let mut raw = false;
    for entry in entries.chunks_exact(12) {
        let tag = word(entry, 0)?;
        if tag == 50706 && word(entry, 2) == Some(1) && long(entry, 4) == Some(4) && entry[8] == 1 {
            return Some(identified("dng", Some("tiff"), "dng-version-tag"));
        }
        if [0x14a, 0x828d, 0x828e].contains(&tag) || tag == 0x106 && word(entry, 8) == Some(32803) {
            raw = true;
        }
    }
    if raw {
        None
    } else {
        Some(identified("tiff", Some("tiff"), "standard-tiff-ifd"))
    }
}

fn vint(b: &[u8], mask: bool) -> Option<(u64, usize)> {
    let n = b.first()?.leading_zeros() as usize + 1;
    if n > 8 || b.len() < n {
        return None;
    }
    let mut value = if mask {
        u64::from(b[0] & (0xffu16 >> n) as u8)
    } else {
        u64::from(b[0])
    };
    for byte in &b[1..n] {
        value = (value << 8) | u64::from(*byte);
    }
    Some((value, n))
}
fn ebml(h: &[u8]) -> Option<&'static str> {
    let (size, n) = vint(h.get(4..)?, true)?;
    let mut p = 4 + n;
    let end = p.checked_add(usize::try_from(size).ok()?)?.min(h.len());
    while p < end {
        let (id, n) = vint(&h[p..end], false)?;
        p += n;
        let (size, n) = vint(&h[p..end], true)?;
        p += n;
        let e = p.checked_add(usize::try_from(size).ok()?)?;
        if e > end {
            return None;
        }
        let value = h.get(p..e)?;
        if id == 0x4282 {
            return match value {
                b"webm" => Some("webm"),
                b"matroska" => Some("mkv"),
                _ => None,
            };
        }
        p = e;
    }
    None
}
fn ogg(h: &[u8]) -> Option<&'static str> {
    if h.get(4) != Some(&0) || h.get(5).is_none_or(|f| f & 3 != 2) {
        return None;
    }
    let count = *h.get(26)? as usize;
    let table = h.get(27..27 + count)?;
    let length: usize = table
        .iter()
        .take_while(|&&n| n == 255)
        .map(|&n| n as usize)
        .sum();
    let last = *table.iter().find(|&&n| n < 255)? as usize;
    let packet = h.get(27 + count..27 + count + length + last)?;
    if packet.starts_with(b"OpusHead") {
        Some("opus")
    } else if packet.starts_with(b"\x80theora") {
        Some("ogv")
    } else if packet.starts_with(b"Speex   ") {
        Some("spx")
    } else if packet.starts_with(b"\x01vorbis") {
        Some("ogg")
    } else {
        None
    }
}

pub(super) fn json_type(text: &str) -> Option<&'static str> {
    #[derive(serde::Deserialize)]
    struct Asset {
        version: String,
    }
    #[derive(serde::Deserialize)]
    struct Hint {
        nbformat: Option<u8>,
        cells: Option<Vec<serde::de::IgnoredAny>>,
        asset: Option<Asset>,
    }
    let hint: Hint = serde_json::from_str(text).ok()?;
    if hint.nbformat.is_some_and(|n| n == 4) && hint.cells.is_some() {
        Some("ipynb")
    } else if hint.asset.is_some_and(|a| a.version == "2.0") {
        Some("gltf")
    } else {
        None
    }
}

fn in_namespace(element: &quick_xml::events::BytesStart<'_>, namespace: &[u8]) -> bool {
    let name = element.name();
    let prefix = name.prefix();
    element.attributes().flatten().any(|a| {
        let key = a.key.as_ref();
        let matches = match prefix {
            None => key == b"xmlns",
            Some(prefix) => key.strip_prefix(b"xmlns:") == Some(prefix.as_ref()),
        };
        matches && a.value.as_ref() == namespace
    })
}

pub(super) fn xml_type(element: &quick_xml::events::BytesStart<'_>) -> Option<&'static str> {
    let ns = |value: &[u8]| in_namespace(element, value);
    let name = element.local_name();
    match name.as_ref() {
        b"feed" if ns(b"http://www.w3.org/2005/Atom") => Some("atom"),
        b"rss"
            if element
                .attributes()
                .flatten()
                .any(|a| a.key.as_ref() == b"version" && a.value.as_ref() == b"2.0") =>
        {
            Some("rss")
        }
        b"kml"
            if ns(b"http://www.opengis.net/kml/2.2")
                || ns(b"http://earth.google.com/kml/2.1")
                || ns(b"http://earth.google.com/kml/2.0") =>
        {
            Some("kml")
        }
        b"gpx"
            if ns(b"http://www.topografix.com/GPX/1/0")
                || ns(b"http://www.topografix.com/GPX/1/1") =>
        {
            Some("gpx")
        }
        b"schema" if ns(b"http://www.w3.org/2001/XMLSchema") => Some("xsd"),
        b"stylesheet" | b"transform" if ns(b"http://www.w3.org/1999/XSL/Transform") => Some("xsl"),
        b"plist"
            if element
                .attributes()
                .flatten()
                .any(|a| a.key.as_ref() == b"version") =>
        {
            Some("plist")
        }
        b"html" if ns(b"http://www.w3.org/1999/xhtml") => Some("xhtml"),
        b"COLLADA"
            if ns(b"http://www.collada.org/2005/11/COLLADASchema")
                || ns(b"http://www.collada.org/2008/03/COLLADASchema") =>
        {
            Some("dae")
        }
        b"tt" if ns(b"http://www.w3.org/ns/ttml") || ns(b"http://www.w3.org/2006/10/ttaf1") => {
            Some("ttml")
        }
        b"document" if ns(b"urn:oasis:names:tc:opendocument:xmlns:office:1.0") => {
            let mime = element
                .attributes()
                .flatten()
                .find(|a| a.key.local_name().as_ref() == b"mimetype")?;
            match mime.value.as_ref() {
                b"application/vnd.oasis.opendocument.text" => Some("fodt"),
                b"application/vnd.oasis.opendocument.spreadsheet" => Some("fods"),
                b"application/vnd.oasis.opendocument.presentation" => Some("fodp"),
                b"application/vnd.oasis.opendocument.graphics" => Some("fodg"),
                _ => None,
            }
        }
        _ => None,
    }
}

pub(super) fn text(value: &str, complete: bool) -> Option<Detection> {
    let format = if value.lines().next() == Some("BEGIN:VCALENDAR")
        && value.lines().any(|l| l == "VERSION:2.0")
    {
        Some("ics")
    } else if value.lines().next() == Some("BEGIN:VCARD")
        && value
            .lines()
            .any(|l| matches!(l, "VERSION:2.1" | "VERSION:3.0" | "VERSION:4.0"))
    {
        Some("vcf")
    } else if value.starts_with("WEBVTT")
        && value.as_bytes().get(6).is_none_or(u8::is_ascii_whitespace)
    {
        Some("vtt")
    } else if value.starts_with("<?php")
        && value.as_bytes().get(5).is_some_and(u8::is_ascii_whitespace)
    {
        Some("php")
    } else if value.starts_with("[Script Info]") && value.contains("[Events]") {
        if value.contains("[V4+ Styles]") {
            Some("ass")
        } else if value.contains("[V4 Styles]") {
            Some("ssa")
        } else {
            None
        }
    } else if complete && json_lines(value) {
        Some("jsonl")
    } else {
        None
    };
    if let Some(format) = format {
        return Some(identified(format, None, "structured-text-header"));
    }
    if let Some(line) = value.strip_prefix("#!").and_then(|v| v.lines().next()) {
        let mut words = line.split_whitespace();
        let first = words.next()?;
        let command = if first.ends_with("/env") {
            words.next()?
        } else {
            first
        };
        let base = command.rsplit('/').next()?;
        let format = match base {
            "python" | "python3" | "python2" => "py",
            "node" | "nodejs" => "js",
            "bash" => "bash",
            "sh" => "sh",
            "zsh" => "zsh",
            "fish" => "fish",
            "ruby" => "rb",
            "perl" => "pl",
            "pwsh" => "ps1",
            _ => return None,
        };
        return Some(identified(format, None, "interpreter-shebang"));
    }
    None
}

fn json_lines(value: &str) -> bool {
    let mut lines = value.lines().map(str::trim).filter(|line| !line.is_empty());
    let (Some(first), Some(second)) = (lines.next(), lines.next()) else {
        return false;
    };
    super::complete_json_container(first)
        && super::complete_json_container(second)
        && lines.all(super::complete_json_container)
}

pub(super) fn zip_type<R: Read + Seek>(archive: &mut zip::ZipArchive<R>) -> Option<&'static str> {
    if archive.index_for_name("Index/Document.iwa").is_some()
        && archive
            .index_for_name("Metadata/Properties.plist")
            .is_some()
    {
        let mut file = archive.by_name("Index/Document.iwa").ok()?;
        if file.size() > 64 * 1024 {
            return None;
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        return iwork_type(&bytes);
    }
    if archive.file_names().any(|n| {
        n.starts_with("Payload/") && n.ends_with(".app/Info.plist") && n.split('/').count() == 3
    }) {
        return Some("ipa");
    }
    if archive.index_for_name("META-INF/application.xml").is_some() {
        return Some("ear");
    }
    if archive.index_for_name("WEB-INF/web.xml").is_some() {
        return Some("war");
    }
    if archive.index_for_name("AndroidManifest.xml").is_some() {
        let bytes = super::read_zip_part(archive, "AndroidManifest.xml")?;
        if bytes.starts_with(b"\x03\0\x08\0") {
            return Some("apk");
        }
    }
    // Signed Android packages can also carry JAR signing metadata.
    if archive.index_for_name("META-INF/MANIFEST.MF").is_some() {
        return Some("jar");
    }
    if let Some(bytes) = super::read_zip_part(archive, "manifest.json") {
        #[derive(serde::Deserialize)]
        struct Manifest {
            manifest_version: u8,
            name: String,
            version: String,
        }
        if serde_json::from_slice::<Manifest>(&bytes).is_ok_and(|m| {
            (2..=3).contains(&m.manifest_version) && !m.name.is_empty() && !m.version.is_empty()
        }) {
            return Some("xpi");
        }
    }
    // Only selected document names must outlive the immutable archive borrow.
    let documents: Vec<_> = archive
        .file_names()
        .filter(|n| n.ends_with(".fdseq"))
        .take(4)
        .map(str::to_owned)
        .collect();
    for name in &documents {
        let Some(bytes) = super::read_zip_part(archive, name) else {
            continue;
        };
        let mut reader = quick_xml::Reader::from_reader(bytes.as_slice());
        loop {
            use quick_xml::events::Event;
            match reader.read_event() {
                Ok(Event::Start(element) | Event::Empty(element)) => {
                    if element.local_name().as_ref() != b"FixedDocumentSequence" {
                        break;
                    }
                    if in_namespace(&element, b"http://schemas.openxps.org/oxps/v1.0") {
                        return Some("oxps");
                    }
                    if in_namespace(&element, b"http://schemas.microsoft.com/xps/2005/06") {
                        return Some("xps");
                    }
                    break;
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }
    None
}

pub(super) fn docxf_marker(bytes: &[u8]) -> bool {
    let mut reader = quick_xml::Reader::from_reader(bytes);
    loop {
        use quick_xml::events::Event;
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if e.local_name().as_ref() == b"Default" => {
                if e.attributes().flatten().any(|a| a.key.as_ref() == b"Extension" && a.value.as_ref() == b"docxf")
                    && e.attributes().flatten().any(|a| a.key.as_ref() == b"ContentType" && a.value.as_ref() == b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.docxf") {
                    return true;
                }
            }
            Ok(Event::Eof) | Err(_) => return false,
            _ => {}
        }
    }
}

fn varint(b: &[u8], p: &mut usize) -> Option<u64> {
    let mut value = 0;
    for shift in (0..64).step_by(7) {
        let byte = *b.get(*p)?;
        *p += 1;
        if shift == 63 && byte > 1 {
            return None;
        }
        value |= u64::from(byte & 127) << shift;
        if byte < 128 {
            return Some(value);
        }
    }
    None
}
fn fields<'a>(bytes: &'a [u8]) -> Option<Vec<(u64, &'a [u8], u64)>> {
    let mut output = Vec::new();
    let mut p = 0;
    while p < bytes.len() {
        if output.len() > 128 {
            return None;
        }
        let key = varint(bytes, &mut p)?;
        match key & 7 {
            0 => {
                let n = varint(bytes, &mut p)?;
                output.push((key >> 3, &[][..], n));
            }
            2 => {
                let n = usize::try_from(varint(bytes, &mut p)?).ok()?;
                let end = p.checked_add(n)?;
                output.push((key >> 3, bytes.get(p..end)?, 0));
                p = end;
            }
            _ => return None,
        }
    }
    Some(output)
}
fn iwork_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() < 4 || bytes[0] != 0 {
        return None;
    }
    let length =
        usize::from(bytes[1]) | (usize::from(bytes[2]) << 8) | (usize::from(bytes[3]) << 16);
    let compressed = bytes.get(4..4 + length)?;
    if snap::raw::decompress_len(compressed).ok()? > 64 * 1024 {
        return None;
    }
    let unpacked = snap::raw::Decoder::new().decompress_vec(compressed).ok()?;
    let mut p = 0;
    let header = usize::try_from(varint(&unpacked, &mut p)?).ok()?;
    for (field, message, _) in fields(unpacked.get(p..p.checked_add(header)?)?)? {
        if field != 2 {
            continue;
        }
        for (key, _, id) in fields(message)? {
            if key == 1 {
                return match id {
                    10000..=10999 => Some("pages"),
                    12000..=12999 | 3061 | 6030 | 6316 => Some("numbers"),
                    2 | 4..=148 => Some("key"),
                    _ => None,
                };
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn classify(bytes: &[u8]) -> Detection {
        let result = detect(&mut Cursor::new(bytes)).unwrap();
        assert!(result.bytes_read <= READ_BUDGET);
        result
    }

    #[test]
    fn prose_does_not_satisfy_compression_or_cad_headers() {
        for bytes in [
            &b"AC10 is a sentence"[..],
            b"AC1099 is unassigned",
            b"BZhello world",
            b"BZh0",
        ] {
            assert!(classify(bytes).format.is_none());
        }
        assert_eq!(classify(b"BZh9").format, Some("bz2"));
        assert_eq!(classify(b"AC1032").format, Some("dwg"));
    }

    #[test]
    fn jsonl_requires_two_complete_container_lines_and_checks_every_remaining_line() {
        for (source, expected) in [
            ("\n{}\n[]\n", true),
            ("  {\"n\":1}\r\n{\"n\":2}\r\n", true),
            ("{}\n[]\n\n", true),
            ("\n \n{} \n ", false),
            ("{}\n", false),
            ("null\nnull", false),
            ("{}\n[]\n[1e400]", false),
            ("{}\n{\n", false),
            ("", false),
        ] {
            assert_eq!(json_lines(source), expected, "{source:?}");
        }
        assert!(text("{}\n[]\n", false).is_none());
    }

    #[cfg(feature = "format-detection-compound")]
    fn compound(streams: &[(&str, &[u8])]) -> Vec<u8> {
        let mut file = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
        for (path, bytes) in streams {
            if let Some((parent, _)) = path.rsplit_once('/') {
                file.create_storage_all(parent).unwrap();
            }
            file.create_stream(path).unwrap().write_all(bytes).unwrap();
        }
        file.into_inner().into_inner()
    }

    #[test]
    #[cfg(feature = "format-detection-compound")]
    fn compound_requires_root_evidence_and_rejects_conflicting_or_encrypted_families() {
        let mut fib = [0; 12];
        fib[..2].copy_from_slice(&0xa5ecu16.to_le_bytes());
        assert_eq!(
            classify(&compound(&[("/WordDocument", &fib)])).format,
            Some("doc")
        );
        fib[10] = 1;
        assert_eq!(
            classify(&compound(&[("/WordDocument", &fib)])).format,
            Some("dot")
        );
        for streams in [
            vec![("/nested/WordDocument", &fib[..])],
            vec![("/WordDocument", &b"invalid"[..])],
            vec![("/WordDocument", &fib[..]), ("/Workbook", &b"data"[..])],
            vec![
                ("/WordDocument", &fib[..]),
                ("/EncryptionInfo", &b"data"[..]),
                ("/EncryptedPackage", &b"data"[..]),
            ],
        ] {
            let result = classify(&compound(&streams));
            assert_eq!(result.container, Some("cfb"));
            assert!(result.format.is_none());
        }
    }

    #[test]
    #[cfg(feature = "format-detection-compound")]
    fn large_compound_files_do_not_allocate_tables_from_unbounded_file_sizes() {
        struct LargeFile(Cursor<Vec<u8>>);
        impl Read for LargeFile {
            fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
                self.0.read(output)
            }
        }
        impl Seek for LargeFile {
            fn seek(&mut self, offset: SeekFrom) -> io::Result<u64> {
                match offset {
                    SeekFrom::End(n) => self
                        .0
                        .seek(SeekFrom::Start((128 * 1024 * 1024i64 + n) as u64)),
                    other => self.0.seek(other),
                }
            }
        }
        let mut head = compound(&[("/Workbook", b"data")]);
        head.resize(HEAD_BYTES, 0);
        let result = detect(&mut LargeFile(Cursor::new(head))).unwrap();
        assert_eq!(result.container, Some("cfb"));
        assert!(result.format.is_none());
        assert_eq!(result.bytes_read, HEAD_BYTES as u64);
    }

    #[test]
    fn tiff_metadata_respects_offsets_and_leaves_raw_ambiguous() {
        // Two baseline dimension entries and an end-of-IFD pointer.
        let mut bytes = b"II\x2a\0\x08\0\0\0\x02\0".to_vec();
        for tag in [256u16, 257] {
            bytes.extend_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&[3, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
        }
        bytes.extend_from_slice(&[0; 4]);
        assert_eq!(classify(&bytes).format, Some("tiff"));
        let mut raw = bytes.clone();
        raw[10..12].copy_from_slice(&0x14au16.to_le_bytes());
        assert!(classify(&raw).format.is_none());
        raw[10..22].copy_from_slice(&[0x12, 0xc6, 1, 0, 4, 0, 0, 0, 1, 4, 0, 0]);
        assert_eq!(classify(&raw).format, Some("dng"));
        bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(classify(&bytes).format.is_none());
        raw[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(classify(&raw).format.is_none());
    }

    #[test]
    fn ebml_parent_boundaries_and_eight_byte_sizes_are_checked() {
        let bytes = b"\x1a\x45\xdf\xa3\x87\x42\x82\x84webm";
        assert_eq!(classify(bytes).format, Some("webm"));
        let mut wrong = bytes.to_vec();
        wrong[4] = 0x83; // Child extends past the declared parent.
        assert!(classify(&wrong).format.is_none());
        let mut wide = b"\x1a\x45\xdf\xa3\x01\0\0\0\0\0\0\x07".to_vec();
        wide.extend_from_slice(&bytes[5..]);
        assert_eq!(classify(&wide).format, Some("webm"));
        for length in 0..bytes.len() {
            assert!(classify(&bytes[..length]).format.is_none());
        }
    }

    #[test]
    fn ogg_needs_a_complete_first_packet_on_a_beginning_page() {
        let mut bytes = vec![0; 27];
        bytes[..4].copy_from_slice(b"OggS");
        bytes[5] = 2;
        bytes[26] = 1;
        bytes.push(8);
        bytes.extend_from_slice(b"OpusHead");
        assert_eq!(classify(&bytes).format, Some("opus"));
        bytes[5] = 1;
        assert!(classify(&bytes).format.is_none());
        bytes[5] = 2;
        bytes[27] = 255;
        assert!(classify(&bytes).format.is_none());
    }

    #[test]
    fn xml_uses_the_root_namespace_binding_and_json_requires_its_schema() {
        for (text, expected) in [
            ("<a:feed xmlns:a='http://www.w3.org/2005/Atom'/>", "atom"),
            ("<feed xmlns:a='http://www.w3.org/2005/Atom'/>", "xml"),
            (
                "<schema hint='http://www.w3.org/2001/XMLSchema' xmlns='urn:other'/>",
                "xml",
            ),
            (
                "<xs:schema xmlns:xs='http://www.w3.org/2001/XMLSchema'/>",
                "xsd",
            ),
            ("{\"nbformat\":4,\"cells\":[]}", "ipynb"),
            ("{\"nbformat\":4,\"cells\":false}", "json"),
            ("{\"asset\":{\"version\":\"2.0\"}}", "gltf"),
            ("{\"asset\":{\"version\":\"3.0\"}}", "json"),
        ] {
            assert_eq!(classify(text.as_bytes()).format, Some(expected), "{text}");
        }
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for ch in "<svg xmlns='http://www.w3.org/2000/svg'/>".encode_utf16() {
                bytes.extend_from_slice(&if little {
                    ch.to_le_bytes()
                } else {
                    ch.to_be_bytes()
                });
            }
            assert_eq!(classify(&bytes).format, Some("svg"));
        }
    }

    fn package(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut file = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in parts {
            file.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            file.write_all(bytes).unwrap();
        }
        file.finish().unwrap().into_inner()
    }

    #[test]
    fn xps_needs_document_structure_not_only_a_package_path() {
        for (xml, expected) in [
            (
                &b"<FixedDocumentSequence xmlns='http://schemas.microsoft.com/xps/2005/06'/>"[..],
                Some("xps"),
            ),
            (
                &b"<FixedDocumentSequence xmlns='http://schemas.openxps.org/oxps/v1.0'/>"[..],
                Some("oxps"),
            ),
            (&b"<unrelated/>"[..], None),
        ] {
            let bytes = package(&[("FixedDocumentSequence.fdseq", xml)]);
            assert_eq!(classify(&bytes).format, expected);
        }
    }

    #[test]
    fn signed_resource_only_apks_take_precedence_over_jar_signing_metadata() {
        let bytes = package(&[
            ("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\n"),
            ("AndroidManifest.xml", b"\x03\0\x08\0\x08\0\0\0"),
        ]);
        assert_eq!(classify(&bytes).format, Some("apk"));
    }

    #[test]
    fn iwork_rejects_overflow_and_oversize_compressed_metadata() {
        assert!(varint(&[0xff; 12], &mut 0).is_none());
        assert!(fields(&[0x12, 0xff, 0x7f]).is_none());
        // Snappy's length prefix advertises 128 KiB without supplying a payload.
        assert!(iwork_type(&[0, 3, 0, 0, 0x80, 0x80, 0x08]).is_none());
        let archive_info = [0x12, 3, 0x08, 0x90, 0x4e]; // type 10000 (Pages).
        let mut unpacked = vec![archive_info.len() as u8];
        unpacked.extend_from_slice(&archive_info);
        let compressed = snap::raw::Encoder::new().compress_vec(&unpacked).unwrap();
        let mut bytes = vec![0, compressed.len() as u8, 0, 0];
        bytes.extend_from_slice(&compressed);
        assert_eq!(iwork_type(&bytes), Some("pages"));
        bytes[1] += 1;
        assert!(iwork_type(&bytes).is_none());
    }

    #[test]
    fn unrelated_trailers_do_not_override_identified_files() {
        let mut bytes = vec![0; 0x9000];
        bytes[..9].copy_from_slice(b"%PDF-1.7\n");
        bytes[0x8000..0x8006].copy_from_slice(b"\x01CD001");
        let end = bytes.len();
        bytes[end - 512..end - 508].copy_from_slice(b"koly");
        let result = classify(&bytes);
        assert_eq!(result.format, Some("pdf"));
        assert_eq!(result.bytes_read, HEAD_BYTES as u64);
        bytes[..9].fill(0);
        assert_eq!(classify(&bytes).format, Some("iso"));
        bytes[0x8000] = 3;
        assert_eq!(classify(&bytes).format, Some("dmg"));
    }
}
