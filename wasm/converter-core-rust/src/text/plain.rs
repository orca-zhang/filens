//! Shared text decoding for browser WASM and native Agent search.
pub fn decode_text(input: &[u8]) -> String {
    let mut decoded = if input.starts_with(&[0xff, 0xfe]) {
        decode_utf16(&input[2..], true)
    } else if input.starts_with(&[0xfe, 0xff]) {
        decode_utf16(&input[2..], false)
    } else if let Ok(text) = std::str::from_utf8(input) {
        text.to_string()
    } else {
        input.iter().map(|byte| windows_1252_char(*byte)).collect()
    };
    let start = decoded.len() - decoded.trim_start_matches('\u{feff}').len();
    decoded.drain(..start);
    if decoded.contains('\r') {
        let mut normalized = String::with_capacity(decoded.len());
        let mut parts = decoded.split('\r');
        normalized.push_str(parts.next().unwrap());
        for part in parts {
            normalized.push('\n');
            normalized.push_str(part.strip_prefix('\n').unwrap_or(part));
        }
        decoded = normalized;
    }
    decoded.truncate(decoded.trim_end_matches(char::is_whitespace).len());
    decoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodings_boms_line_endings_and_unicode_offsets_stay_identical() {
        for (input, expected) in [
            (
                "\u{feff}\u{feff}中文 🦀\r\nA\rB\r\r\nC\u{2003}\t".as_bytes(),
                "中文 🦀\nA\nB\n\nC",
            ),
            (b"\xff\xfeA\0\r\0\n\0B\0 \0".as_slice(), "A\nB"),
            (b"\xfe\xff\0A\0\r\0B\0\n".as_slice(), "A\nB"),
            (b"\x80\x85\r\ncaf\xe9\r\n".as_slice(), "€…\ncafé"),
            (b"\xff\xfe\0\xd8A\0".as_slice(), "�A"),
            (b"".as_slice(), ""),
            (b"\r\n\r \t".as_slice(), ""),
        ] {
            let decoded = decode_text(input);
            assert_eq!(decoded, expected);
            assert_eq!(decoded.as_bytes(), expected.as_bytes());
        }
    }
}

pub fn decode_utf16(input: &[u8], little_endian: bool) -> String {
    let units = input.chunks_exact(2).map(|pair| {
        if little_endian {
            u16::from_le_bytes([pair[0], pair[1]])
        } else {
            u16::from_be_bytes([pair[0], pair[1]])
        }
    });
    char::decode_utf16(units)
        .map(|value| value.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

pub fn windows_1252_char(byte: u8) -> char {
    match byte {
        0x80 => '\u{20ac}',
        0x82 => '\u{201a}',
        0x83 => '\u{0192}',
        0x84 => '\u{201e}',
        0x85 => '\u{2026}',
        0x86 => '\u{2020}',
        0x87 => '\u{2021}',
        0x88 => '\u{02c6}',
        0x89 => '\u{2030}',
        0x8a => '\u{0160}',
        0x8b => '\u{2039}',
        0x8c => '\u{0152}',
        0x8e => '\u{017d}',
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201c}',
        0x94 => '\u{201d}',
        0x95 => '\u{2022}',
        0x96 => '\u{2013}',
        0x97 => '\u{2014}',
        0x98 => '\u{02dc}',
        0x99 => '\u{2122}',
        0x9a => '\u{0161}',
        0x9b => '\u{203a}',
        0x9c => '\u{0153}',
        0x9e => '\u{017e}',
        0x9f => '\u{0178}',
        _ => char::from_u32(byte as u32).unwrap_or(char::REPLACEMENT_CHARACTER),
    }
}

// Only native search uses this; WASM converters share the decoders above.
#[allow(dead_code)]
pub fn supported(source: &str) -> bool {
    matches!(
        source,
        "txt"
            | "text"
            | "log"
            | "ini"
            | "cfg"
            | "conf"
            | "toml"
            | "yaml"
            | "yml"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "rs"
            | "go"
            | "py"
            | "js"
            | "ts"
            | "tsx"
            | "jsx"
            | "css"
            | "sh"
            | "bat"
            | "ps1"
    )
}
