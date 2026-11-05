//! Bounded, name-independent content detection shared by native and WASI builds.
//! A signature is routing evidence, not proof that an entire file is valid.
use serde::Serialize;
use std::io::{self, Read, Seek, SeekFrom};
#[cfg(feature = "format-detection-expanded")]
#[path = "format_detection/probes.rs"]
mod probes;

#[path = "format_detection/signatures.rs"]
mod signatures;
#[cfg(feature = "format-detection-simd")]
#[path = "format_detection/text_scan.rs"]
mod text_scan;

const HEAD_BYTES: usize = 8192;
const READ_BUDGET: u64 = 256 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub format: Option<&'static str>,
    pub container: Option<&'static str>,
    pub evidence: &'static str,
    pub reason: &'static str,
    pub bytes_read: u64,
    pub file_bytes: u64,
}

impl Detection {
    fn new(
        format: Option<&'static str>,
        container: Option<&'static str>,
        evidence: &'static str,
        reason: &'static str,
    ) -> Self {
        Self {
            format,
            container,
            evidence,
            reason,
            bytes_read: 0,
            file_bytes: 0,
        }
    }
    fn signature(format: &'static str) -> Self {
        Self::new(Some(format), None, "signature", "file-header")
    }
    fn container(container: &'static str) -> Self {
        Self::new(None, Some(container), "container", "ambiguous-container")
    }
}

struct Bounded<'a, R> {
    source: &'a mut R,
    read: u64,
}
impl<R: Read> Read for Bounded<'_, R> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let remaining = READ_BUDGET.saturating_sub(self.read) as usize;
        if remaining == 0 && !bytes.is_empty() {
            return Err(io::Error::other("format detection read budget exceeded"));
        }
        let length = bytes.len().min(remaining);
        let count = self.source.read(&mut bytes[..length])?;
        self.read += count as u64;
        Ok(count)
    }
}
impl<R: Seek> Seek for Bounded<'_, R> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.source.seek(position)
    }
}

pub fn detect<R: Read + Seek>(source: &mut R) -> io::Result<Detection> {
    let size = source.seek(SeekFrom::End(0))?;
    source.seek(SeekFrom::Start(0))?;
    let mut reader = Bounded { source, read: 0 };
    let mut head = vec![0; size.min(HEAD_BYTES as u64) as usize];
    reader.read_exact(&mut head)?;
    let mut result = detect_head(&head, size);
    #[cfg(feature = "format-detection-containers")]
    if result.container == Some("zip") {
        if let Some(format) = zip_format(&mut reader) {
            result = Detection::new(
                Some(format),
                Some("zip"),
                "structure",
                "zip-package-metadata",
            );
        }
    }
    #[cfg(feature = "format-detection-expanded")]
    if let Some(detected) = probes::deep(&mut reader, &head, size, &result) {
        result = detected;
    }
    result.bytes_read = reader.read;
    result.file_bytes = size;
    Ok(result)
}

/// Content-derived inspection shared by CLI WASM hosts. Confidence is an
/// evidence category, not a calibrated probability or a file-validity claim.
pub fn inspect<R: Read + Seek>(source: &mut R, extension: &str) -> io::Result<serde_json::Value> {
    let detected = detect(source)?;
    let format = detected.format.or(detected.container);
    let mime = match format {
        Some("pdf") => Some("application/pdf"),
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("tif" | "tiff") => Some("image/tiff"),
        Some("bmp" | "dib") => Some("image/bmp"),
        Some("ico" | "cur") => Some("image/vnd.microsoft.icon"),
        Some("icns") => Some("image/icns"),
        Some("heic") => Some("image/heic"),
        Some("heif") => Some("image/heif"),
        Some("avif") => Some("image/avif"),
        Some("jxl") => Some("image/jxl"),
        Some("psd" | "psb") => Some("image/vnd.adobe.photoshop"),
        Some("ps" | "eps") => Some("application/postscript"),
        Some("docx") => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        Some("xlsx") => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        Some("pptx") => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        Some("doc") => Some("application/msword"),
        Some("xls") => Some("application/vnd.ms-excel"),
        Some("ppt") => Some("application/vnd.ms-powerpoint"),
        Some("odt") => Some("application/vnd.oasis.opendocument.text"),
        Some("ods") => Some("application/vnd.oasis.opendocument.spreadsheet"),
        Some("odp") => Some("application/vnd.oasis.opendocument.presentation"),
        Some("epub") => Some("application/epub+zip"),
        Some("rtf") => Some("application/rtf"),
        Some("zip") => Some("application/zip"),
        Some("7z") => Some("application/x-7z-compressed"),
        Some("rar") => Some("application/vnd.rar"),
        Some("gz" | "gzip") => Some("application/gzip"),
        Some("bz2") => Some("application/x-bzip2"),
        Some("xz") => Some("application/x-xz"),
        Some("tar") => Some("application/x-tar"),
        Some("zst") => Some("application/zstd"),
        Some("json") => Some("application/json"),
        Some("xml") => Some("application/xml"),
        Some("html") => Some("text/html"),
        Some("svg") => Some("image/svg+xml"),
        Some("wasm") => Some("application/wasm"),
        Some("mp4") => Some("video/mp4"),
        Some("mov") => Some("video/quicktime"),
        Some("webm") => Some("video/webm"),
        Some("mp3") => Some("audio/mpeg"),
        Some("wav") => Some("audio/wav"),
        Some("flac") => Some("audio/flac"),
        Some("ogg") => Some("application/ogg"),
        _ if detected.evidence == "text" => Some("text/plain"),
        _ => None,
    };
    let confidence = match detected.evidence {
        "signature" | "structure" => "high",
        "container" => "container-only",
        "text" => "text-only",
        _ => "unknown",
    };
    let canonical = |value: &str| match value {
        "jpeg" | "jpe" | "jfif" => "jpg".to_owned(),
        "tif" => "tiff".to_owned(),
        "htm" => "html".to_owned(),
        "gzip" => "gz".to_owned(),
        _ => value.to_ascii_lowercase(),
    };
    // A container or ambiguous text is insufficient to rule out a valid
    // subtype extension; leave the comparison unknown in those cases.
    let extension_matches = if !extension.is_empty() && detected.format.is_some()
        && matches!(detected.evidence, "signature" | "structure") {
        Some(canonical(detected.format.unwrap()) == canonical(extension))
    } else { None };
    let mut value = serde_json::to_value(&detected)?;
    value["mime"] = serde_json::json!(mime);
    value["confidence"] = serde_json::json!(confidence);
    value["extension"] = serde_json::json!(extension);
    value["extensionMatches"] = serde_json::json!(extension_matches);
    value["validation"] = serde_json::json!("Format evidence only; not full-file validation.");
    Ok(value)
}

fn at(bytes: &[u8], offset: usize, signature: &[u8]) -> bool {
    bytes.get(offset..offset.saturating_add(signature.len())) == Some(signature)
}
fn be32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}
fn le32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn detect_head(h: &[u8], size: u64) -> Detection {
    let fixed = signatures::lookup(h);
    #[cfg(feature = "format-detection-expanded")]
    if let Some(detected) = probes::header(h, size, fixed.expanded) {
        return detected;
    }
    // Require the format's identifying header, rather than a short text prefix.
    if let Some(format) = fixed.base {
        return Detection::signature(format);
    }
    if h.len() >= 33
        && at(h, 0, b"\x89PNG\r\n\x1a\n")
        && be32(h, 8) == Some(13)
        && at(h, 12, b"IHDR")
    {
        let mut offset = 8usize;
        while let Some(length) = be32(h, offset) {
            if at(h, offset + 4, b"acTL") && length == 8 {
                return Detection::signature("apng");
            }
            if at(h, offset + 4, b"IDAT") {
                break;
            }
            let Some(next) = offset
                .checked_add(length as usize)
                .and_then(|v| v.checked_add(12))
            else {
                break;
            };
            if next <= offset || next > h.len() {
                break;
            }
            offset = next;
        }
        return Detection::signature("png");
    }
    if h.len() >= 12 && at(h, 0, b"RIFF") {
        for (magic, format) in [(b"WEBP", "webp"), (b"WAVE", "wav"), (b"AVI ", "avi")] {
            if at(h, 8, magic) {
                return Detection::signature(format);
            }
        }
        return Detection::container("riff");
    }
    if h.len() >= 16 && at(h, 4, b"ftyp") {
        if let Some(length) = be32(h, 0).filter(|&n| n >= 16 && n as usize <= h.len() && n % 4 == 0)
        {
            let format = bmff_format(h, length as usize);
            return Detection::new(format, Some("isobmff"), "signature", "ftyp-brands");
        }
        return Detection::container("isobmff");
    }
    if at(h, 0, b"PK\x03\x04") || at(h, 0, b"PK\x05\x06") || at(h, 0, b"PK\x07\x08") {
        return Detection::container("zip");
    }
    if at(h, 0, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") {
        return Detection::container("cfb");
    }
    if h.len() >= 8
        && (at(h, 0, b"II\x2a\0")
            || at(h, 0, b"MM\0\x2a")
            || at(h, 0, b"II\x2b\0")
            || at(h, 0, b"MM\0\x2b"))
    {
        if at(h, 8, b"CR\x02\0") {
            return Detection::signature("cr2");
        }
        return Detection::container("tiff"); // DNG/NEF/ARW/etc. require IFD metadata, not filename guesses.
    }
    if h.len() >= 8 && (at(h, 0, b"IIRO") || at(h, 0, b"IIRS") || at(h, 0, b"MMOR")) {
        return Detection::signature("orf");
    }
    if h.len() >= 8 && at(h, 0, b"IIU\0") {
        return Detection::signature("rw2");
    }
    if h.len() >= 26 && at(h, 0, b"II\xbc\x01") {
        return Detection::signature("jxr");
    }
    if h.len() >= 54
        && at(h, 0, b"BM")
        && le32(h, 14).is_some_and(|n| [12, 40, 52, 56, 108, 124].contains(&n))
    {
        return Detection::signature("bmp");
    }
    if h.len() >= 22 && at(h, 0, b"\0\0\x01\0") {
        return Detection::signature("ico");
    }
    if h.len() >= 22 && at(h, 0, b"\0\0\x02\0") {
        return Detection::signature("cur");
    }
    if h.len() >= 26 && at(h, 0, b"8BPS\0") {
        if h[5] == 1 {
            return Detection::signature("psd");
        }
        if h[5] == 2 {
            return Detection::signature("psb");
        }
    }
    if h.len() >= 4 && h.starts_with(b"%!PS") {
        return Detection::signature("ps");
    }
    if h.len() >= 128
        && h[0] == 10
        && [0, 2, 3, 4, 5].contains(&h[1])
        && h[2] == 1
        && [1, 2, 4, 8].contains(&h[3])
    {
        return Detection::signature("pcx");
    }
    if h.len() >= 4 && h[0] == b'P' && (b'1'..=b'6').contains(&h[1]) && h[2].is_ascii_whitespace() {
        return Detection::signature(match h[1] {
            b'1' | b'4' => "pbm",
            b'2' | b'5' => "pgm",
            _ => "ppm",
        });
    }
    if h.len() >= 28 && at(h, 0, b"OggS\0") {
        return Detection::container("ogg");
    }
    if at(h, 0, b"\x1a\x45\xdf\xa3") {
        return Detection::container("ebml");
    }
    if h.len() >= 4 && at(h, 0, b"\0\0\x01\xba") {
        return Detection::signature("mpg");
    }
    // A valid ustar checksum avoids classifying arbitrary bytes with one embedded token.
    if h.len() >= 512 && at(h, 257, b"ustar") {
        let stored = std::str::from_utf8(&h[148..156])
            .ok()
            .and_then(|s| u64::from_str_radix(s.trim_matches(['\0', ' ']), 8).ok());
        let sum: u64 = h[..512]
            .iter()
            .enumerate()
            .map(|(i, &v)| {
                if (148..156).contains(&i) {
                    32
                } else {
                    v as u64
                }
            })
            .sum();
        if stored == Some(sum) {
            return Detection::signature("tar");
        }
    }
    if h.len() >= 84 && le32(h, 80).is_some_and(|count| 84 + u64::from(count) * 50 == size) {
        return Detection::signature("stl");
    }
    text_format(h, size)
}

// Rank each brand once; a compatible brand can override a less specific major
// brand. Minor-version bytes are deliberately excluded from this iterator.
fn bmff_format(head: &[u8], length: usize) -> Option<&'static str> {
    let mut best = u8::MAX;
    for brand in std::iter::once(&head[8..12]).chain(head[16..length].chunks_exact(4)) {
        let rank = match brand {
            b"avif" | b"avis" => 0,
            b"crx " => 1,
            b"heic" | b"heix" | b"hevc" | b"hevx" => 2,
            b"mif1" | b"msf1" | b"mif3" => 3,
            b"qt  " => 4,
            _ if brand.starts_with(b"3gp") => 5,
            b"M4A " | b"M4B " => 6,
            b"isom" | b"iso2" | b"mp41" | b"mp42" | b"avc1" | b"M4V " | b"dash" => 7,
            _ => continue,
        };
        best = best.min(rank);
        if best == 0 {
            break;
        }
    }
    ["avif", "cr3", "heic", "heif", "mov", "3gp", "m4a", "mp4"]
        .get(best as usize)
        .copied()
}

fn text_format(h: &[u8], size: u64) -> Detection {
    let text = h.strip_prefix(b"\xef\xbb\xbf").unwrap_or(h);
    #[cfg(feature = "format-detection-simd")]
    let decoded = text_scan::decode(text, size > h.len() as u64);
    #[cfg(not(feature = "format-detection-simd"))]
    let decoded = utf8_sample(text, size > h.len() as u64);
    let Ok(value) = decoded else {
        return Detection::new(None, None, "unknown", "unrecognized-binary");
    };
    #[cfg(feature = "format-detection-simd")]
    let (value, has_controls) = (value.value, value.has_controls);
    #[cfg(not(feature = "format-detection-simd"))]
    let has_controls = value
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t' | '\u{c}'));
    if value.is_empty() || has_controls {
        return Detection::new(None, None, "unknown", "empty-or-binary");
    }
    text_document(value, size == h.len() as u64)
}

fn utf8_sample(text: &[u8], partial: bool) -> Result<&str, std::str::Utf8Error> {
    // A sample can end in the middle of one UTF-8 character.
    std::str::from_utf8(text).or_else(|error| {
        if error.error_len().is_none() && partial {
            std::str::from_utf8(&text[..error.valid_up_to()])
        } else {
            Err(error)
        }
    })
}

fn text_document(value: &str, complete: bool) -> Detection {
    let trimmed = value.trim_start();
    if complete && complete_json_container(trimmed) {
        #[cfg(feature = "format-detection-expanded")]
        if let Some(format) = probes::json_type(trimmed) {
            return Detection::new(Some(format), None, "structure", "json-document-schema");
        }
        return Detection::new(Some("json"), None, "structure", "complete-json");
    }
    #[cfg(feature = "format-detection-expanded")]
    if let Some(detected) = probes::text(trimmed, complete) {
        return detected;
    }
    if trimmed.starts_with('<') {
        use quick_xml::{Reader, events::Event};
        let mut reader = Reader::from_str(trimmed);
        loop {
            match reader.read_event() {
                Ok(Event::Start(element) | Event::Empty(element)) => {
                    #[cfg(feature = "format-detection-expanded")]
                    if let Some(format) = probes::xml_type(&element) {
                        return Detection::new(
                            Some(format),
                            None,
                            "structure",
                            "xml-document-type",
                        );
                    }
                    let name = element.local_name();
                    let format = match name.as_ref() {
                        b"svg" => "svg",
                        b"html" | b"HTML" => "html",
                        b"FictionBook" => "fb2",
                        _ if trimmed.starts_with("<?xml")
                            || element.attributes().flatten().any(|a| {
                                a.key.as_ref() == b"xmlns" || a.key.as_ref().starts_with(b"xmlns:")
                            }) =>
                        {
                            "xml"
                        }
                        // Vue/JSX/templates may begin with an XML-like tag.
                        _ => break,
                    };
                    return Detection::new(Some(format), None, "structure", "xml-root-element");
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }
    // Generic text does not establish a language, spreadsheet dialect or Markdown.
    Detection::new(None, None, "text", "ambiguous-text")
}

// Validate with the existing JSON tokenizer without materializing a Value tree.
// deserialize_any still validates number ranges, escapes and nesting just like
// Value; IgnoredAny alone would skip numeric overflow validation.
fn complete_json_container(text: &str) -> bool {
    use serde::Deserialize;
    if !text.starts_with(['{', '[']) {
        return false;
    }
    let mut reader = serde_json::Deserializer::from_str(text);
    JsonShape::deserialize(&mut reader).is_ok() && reader.end().is_ok()
}

struct JsonShape;
impl<'de> serde::Deserialize<'de> for JsonShape {
    fn deserialize<D: serde::Deserializer<'de>>(reader: D) -> Result<Self, D::Error> {
        reader.deserialize_any(Self)
    }
}
impl<'de> serde::de::Visitor<'de> for JsonShape {
    type Value = Self;
    fn expecting(&self, writer: &mut std::fmt::Formatter) -> std::fmt::Result {
        writer.write_str("JSON value")
    }
    fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Self, E> {
        Ok(self)
    }
    fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut sequence: A) -> Result<Self, A::Error> {
        while sequence.next_element::<Self>()?.is_some() {}
        Ok(self)
    }
    fn visit_map<A: serde::de::MapAccess<'de>>(self, mut map: A) -> Result<Self, A::Error> {
        while map.next_key::<Self>()?.is_some() {
            map.next_value::<Self>()?;
        }
        Ok(self)
    }
}

#[cfg(feature = "format-detection-containers")]
fn zip_format<R: Read + Seek>(source: &mut R) -> Option<&'static str> {
    // Reuse the conversion core's ZIP parser; never scan arbitrary compressed bytes.
    let mut archive = zip::ZipArchive::new(source).ok()?;
    if archive.len() > 4096 {
        return None;
    }
    let mimetype = read_zip_part(&mut archive, "mimetype");
    if let Some(value) = mimetype
        .as_deref()
        .and_then(|b| std::str::from_utf8(b).ok())
    {
        let format = match value.trim() {
            "application/epub+zip" => Some("epub"),
            "application/vnd.oasis.opendocument.text" => Some("odt"),
            "application/vnd.oasis.opendocument.text-template" => Some("ott"),
            "application/vnd.oasis.opendocument.spreadsheet" => Some("ods"),
            "application/vnd.oasis.opendocument.spreadsheet-template" => Some("ots"),
            "application/vnd.oasis.opendocument.presentation" => Some("odp"),
            "application/vnd.oasis.opendocument.presentation-template" => Some("otp"),
            "application/vnd.oasis.opendocument.graphics" => Some("odg"),
            "application/vnd.oasis.opendocument.graphics-template" => Some("otg"),
            "application/vnd.oasis.opendocument.text-master" => Some("odm"),
            "application/vnd.oasis.opendocument.text-web" => Some("oth"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.writer" => Some("sxw"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.writer.template" => Some("stw"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.calc" => Some("sxc"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.calc.template" => Some("stc"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.impress" => Some("sxi"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.impress.template" => Some("sti"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.draw" => Some("sxd"),
            #[cfg(feature = "format-detection-expanded")]
            "application/vnd.sun.xml.draw.template" => Some("std"),
            _ => None,
        };
        if format.is_some() {
            return format;
        }
    }
    if let Some(xml) = read_zip_part(&mut archive, "[Content_Types].xml") {
        if let Some((format, part)) = openxml_type(&xml) {
            if archive.index_for_name(part).is_some() {
                #[cfg(feature = "format-detection-expanded")]
                if format == "docx" && probes::docxf_marker(&xml) {
                    return Some("docxf");
                }
                return Some(format);
            }
        }
    }
    let has = |name| archive.index_for_name(name).is_some();
    if has("AndroidManifest.xml") && (has("classes.dex") || has("resources.arsc")) {
        return Some("apk");
    }
    if has("3D/3dmodel.model") && has("[Content_Types].xml") {
        return Some("3mf");
    }
    #[cfg(feature = "format-detection-expanded")]
    return probes::zip_type(&mut archive);
    #[cfg(not(feature = "format-detection-expanded"))]
    // ZIP families without reliable metadata remain ambiguous (JAR/WAR/XPI/iWork).
    None
}

#[cfg(feature = "format-detection-containers")]
fn read_zip_part<R: Read + Seek>(archive: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut file = archive.by_name(name).ok()?;
    if file.size() > HEAD_BYTES as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(HEAD_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= HEAD_BYTES).then_some(bytes)
}

#[cfg(feature = "format-detection-containers")]
fn openxml_type(xml: &[u8]) -> Option<(&'static str, &'static str)> {
    use quick_xml::{Reader, events::Event};
    let mut reader = Reader::from_reader(xml);
    let mut found = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(element) | Event::Empty(element))
                if element.local_name().as_ref() == b"Override" =>
            {
                let mut part = None;
                let mut content_type = None;
                for attribute in element.attributes() {
                    let attribute = attribute.ok()?;
                    match attribute.key.as_ref() {
                        b"PartName" => part = Some(attribute.value.into_owned()),
                        b"ContentType" => content_type = Some(attribute.value.into_owned()),
                        _ => {}
                    }
                }
                let matched = match (part.as_deref(), content_type.as_deref()) {
                    (Some(b"/word/document.xml"), Some(b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")) => Some(("docx", "word/document.xml")),
                    (Some(b"/word/document.xml"), Some(b"application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml")) => Some(("dotx", "word/document.xml")),
                    (Some(b"/word/document.xml"), Some(b"application/vnd.ms-word.document.macroEnabled.main+xml")) => Some(("docm", "word/document.xml")),
                    (Some(b"/word/document.xml"), Some(b"application/vnd.ms-word.template.macroEnabledTemplate.main+xml")) => Some(("dotm", "word/document.xml")),
                    (Some(b"/xl/workbook.xml"), Some(b"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml")) => Some(("xlsx", "xl/workbook.xml")),
                    (Some(b"/xl/workbook.xml"), Some(b"application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml")) => Some(("xltx", "xl/workbook.xml")),
                    (Some(b"/xl/workbook.xml"), Some(b"application/vnd.ms-excel.sheet.macroEnabled.main+xml")) => Some(("xlsm", "xl/workbook.xml")),
                    (Some(b"/xl/workbook.xml"), Some(b"application/vnd.ms-excel.template.macroEnabled.main+xml")) => Some(("xltm", "xl/workbook.xml")),
                    (Some(b"/xl/workbook.bin"), Some(b"application/vnd.ms-excel.sheet.binary.macroEnabled.main")) => Some(("xlsb", "xl/workbook.bin")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")) => Some(("pptx", "ppt/presentation.xml")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml")) => Some(("ppsx", "ppt/presentation.xml")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.openxmlformats-officedocument.presentationml.template.main+xml")) => Some(("potx", "ppt/presentation.xml")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml")) => Some(("pptm", "ppt/presentation.xml")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml")) => Some(("ppsm", "ppt/presentation.xml")),
                    (Some(b"/ppt/presentation.xml"), Some(b"application/vnd.ms-powerpoint.template.macroEnabled.main+xml")) => Some(("potm", "ppt/presentation.xml")),
                    _ => None,
                };
                if let Some(pair) = matched {
                    if found.is_some_and(|previous| previous != pair) {
                        return None;
                    }
                    found = Some(pair);
                }
            }
            Ok(Event::Eof) => return found,
            Err(_) => return None,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn compatible_bmff_brands_have_order_independent_priority_and_skip_minor_version() {
        for (brands, expected) in [
            (&[b"isom", b"heic", b"avif"][..], Some("avif")),
            (&[b"heic", b"crx "][..], Some("cr3")),
            (&[b"mif1", b"heix"][..], Some("heic")),
            (&[b"qt  ", b"mif3"][..], Some("heif")),
            (&[b"3gp6", b"qt  "][..], Some("mov")),
            (&[b"M4A ", b"3gp6"][..], Some("3gp")),
            (&[b"isom", b"M4B "][..], Some("m4a")),
            (&[b"zzzz", b"mp42"][..], Some("mp4")),
            (&[b"zzzz"][..], None),
        ] {
            for reverse in [false, true] {
                let mut order = brands.to_vec();
                if reverse {
                    order.reverse();
                }
                let mut head = vec![0; 12 + order.len() * 4];
                head[4..8].copy_from_slice(b"ftyp");
                head[8..12].copy_from_slice(order[0]);
                head[12..16].copy_from_slice(b"avif"); // Minor version is not a brand.
                for (index, brand) in order[1..].iter().enumerate() {
                    head[16 + index * 4..20 + index * 4].copy_from_slice(*brand);
                }
                assert_eq!(bmff_format(&head, head.len()), expected);
            }
        }
    }

    #[test]
    fn utf8_sampling_only_trims_an_incomplete_character_in_a_partial_sample() {
        for bom in [&b""[..], &b"\xef\xbb\xbf"[..]] {
            let mut head = bom.to_vec();
            head.extend_from_slice(b"<svg xmlns='http://www.w3.org/2000/svg'/>\xe4\xb8");
            assert_eq!(
                text_format(&head, head.len() as u64 + 1).format,
                Some("svg")
            );
            assert_eq!(text_format(&head, head.len() as u64).evidence, "unknown");
            *head.last_mut().unwrap() = 0xff;
            assert_eq!(
                text_format(&head, head.len() as u64 + 1).evidence,
                "unknown"
            );
        }
    }

    #[test]
    fn does_not_guess_text_languages_or_short_binary_prefixes() {
        for bytes in [
            &b"PK"[..],
            b"BM",
            b"RIFF",
            b"%PDF",
            b"",
            b"function hello() {}",
            b"# Notes\nA sentence",
            b"\0\xff\0",
        ] {
            assert!(
                detect(&mut Cursor::new(bytes)).unwrap().format.is_none(),
                "{bytes:?}"
            );
        }
    }

    #[test]
    fn names_do_not_enter_the_content_detector() {
        let detection = detect(&mut Cursor::new(b"%PDF-1.7\n")).unwrap();
        assert_eq!(detection.format, Some("pdf"));
        assert_eq!(detection.bytes_read, 9);
    }

    #[test]
    fn tiff_raw_and_cfb_are_ambiguous() {
        for (bytes, expected) in [
            (&b"II\x2a\0\x08\0\0\0"[..], "tiff"),
            (&b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"[..], "cfb"),
        ] {
            let result = detect(&mut Cursor::new(bytes)).unwrap();
            assert!(result.format.is_none());
            assert_eq!(result.container, Some(expected));
        }
    }

    #[test]
    fn embedded_magic_and_non_utf8_are_not_text() {
        assert!(
            detect(&mut Cursor::new(b"arbitrary word/ ppt/ PK\x03\x04"))
                .unwrap()
                .format
                .is_none()
        );
        let result = detect(&mut Cursor::new(b"\xff\xff\0\xff")).unwrap();
        assert_eq!(result.evidence, "unknown");
    }

    #[test]
    fn source_components_do_not_become_xml_from_an_opening_tag() {
        for source in [
            "<script setup lang='ts'>let a = 1;</script>",
            "<template><p>{{ message }}</p></template>",
            "<div className='app'>{value}</div>",
        ] {
            let result = detect(&mut Cursor::new(source.as_bytes())).unwrap();
            assert!(result.format.is_none());
            assert_eq!(result.evidence, "text");
        }
    }

    #[test]
    fn streaming_json_validation_agrees_with_value_parser() {
        for text in [
            "{}",
            "[]",
            "{\"a\":[null,true,false,1,-2,3.5,1e-10]}",
            "{\"a\":1,\"a\":2}",
            "[184467440737095516160000000000000000000000]",
            "[1e400]",
            "[1e-400]",
            "[NaN]",
            "[01]",
            "[1,]",
            "[1] garbage",
            "true",
            r#"{"escaped\"key":"\uD83D\uDE00"}"#,
            r#"["\uD800"]"#,
            r#"{"\uD800":1}"#,
            r#"{"1e400":null}"#,
            "{\"a\":",
            "",
            "{} {}",
            "{1:2}",
            "[\"unterminated]",
        ] {
            let expected = serde_json::from_str::<serde_json::Value>(text)
                .is_ok_and(|value| value.is_object() || value.is_array());
            assert_eq!(complete_json_container(text), expected, "{text:?}");
        }
        let deep = format!("{}0{}", "[".repeat(150), "]".repeat(150));
        assert!(!complete_json_container(&deep));
    }

    #[test]
    fn xml_root_beats_embedded_svg_and_json_requires_a_complete_value() {
        assert_eq!(
            detect(&mut Cursor::new(
                b"<?xml version='1.0'?><root><svg/></root>"
            ))
            .unwrap()
            .format,
            Some("xml")
        );
        assert_eq!(
            detect(&mut Cursor::new(
                b"<svg xmlns='http://www.w3.org/2000/svg'/>"
            ))
            .unwrap()
            .format,
            Some("svg")
        );
        assert!(
            detect(&mut Cursor::new(b"{\"broken\":"))
                .unwrap()
                .format
                .is_none()
        );
    }

    #[cfg(feature = "format-detection-containers")]
    fn package(content_type: &str, part: &str) -> Vec<u8> {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            "[Content_Types].xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        write!(zip, "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'><Override PartName='/{part}' ContentType='{content_type}'/></Types>").unwrap();
        zip.start_file(part, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"<root/>").unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    #[cfg(feature = "format-detection-containers")]
    fn validates_zip_metadata_instead_of_searching_for_path_strings() {
        let bytes = package(
            "application/vnd.ms-word.document.macroEnabled.main+xml",
            "word/document.xml",
        );
        let result = detect(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(result.format, Some("docm"));
        let bytes = package(
            "application/vnd.ms-word.document.macroEnabled.main+xml",
            "other/document.xml",
        );
        assert!(detect(&mut Cursor::new(bytes)).unwrap().format.is_none());
        assert!(
            detect(&mut Cursor::new(b"PK\x03\x04word/document.xml"))
                .unwrap()
                .format
                .is_none()
        );
    }

    #[test]
    fn hostile_and_truncated_inputs_do_not_panic_or_exceed_the_budget() {
        let mut state = 0x12345678u32;
        for length in 0..1024 {
            let mut bytes = vec![0; length];
            for byte in &mut bytes {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = state as u8;
            }
            for magic in [
                &b"PK\x03\x04"[..],
                b"\0\0\0\x18ftyp",
                b"\x89PNG\r\n\x1a\n",
                b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
                b"II\x2a\0",
                b"MM\0\x2a",
                b"\x1a\x45\xdf\xa3",
                b"OggS",
                b"MZ",
                b"\0\0\0\x0cjP  \r\n\x87\n",
                b"",
            ] {
                let count = magic.len().min(bytes.len());
                bytes[..count].copy_from_slice(&magic[..count]);
                let result = detect(&mut Cursor::new(&bytes)).unwrap();
                assert!(result.bytes_read <= READ_BUDGET);
            }
        }
    }
}
