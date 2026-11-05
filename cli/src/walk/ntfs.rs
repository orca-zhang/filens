//! Decode Windows FILE_FULL_DIR_INFO metadata, independent of the host OS.
use super::{Kind, NativeEntry};
use std::{ffi::OsString, io};

pub(super) const BUFFER_BYTES: usize = 64 * 1024;
pub(super) const NAME_OFFSET: usize = 68;
const DIRECTORY: u32 = 0x10;
const DEVICE: u32 = 0x40;
const REPARSE_POINT: u32 = 0x400;

// Use byte reads: records have variable lengths and must never be cast to
// aligned Rust references. Offsets follow the Windows SDK FILE_FULL_DIR_INFO.
pub(super) fn record(buffer: &[u8]) -> io::Result<(Option<usize>, NativeEntry)> {
    let invalid = || {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Windows directory record",
        )
    };
    if buffer.len() < NAME_OFFSET {
        return Err(invalid());
    }
    let u32_at = |offset| u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap());
    let next = u32_at(0) as usize;
    let length = u32_at(60) as usize;
    let end = NAME_OFFSET.checked_add(length).ok_or_else(invalid)?;
    if length == 0
        || length % 2 != 0
        || end > buffer.len()
        || (next != 0
            && (next % 8 != 0 || next < end || next > buffer.len().saturating_sub(NAME_OFFSET)))
    {
        return Err(invalid());
    }
    let wide: Vec<u16> = buffer[NAME_OFFSET..end]
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .collect();
    // Retain unpaired surrogates on Windows; the shared walker reports them as
    // unrepresentable rather than silently changing the name or dropping peers.
    #[cfg(windows)]
    let name = {
        use std::os::windows::ffi::OsStringExt;
        OsString::from_wide(&wide)
    };
    #[cfg(not(windows))]
    let name = OsString::from(String::from_utf16(&wide).map_err(|_| invalid())?);
    // Names from a directory record must be single components. Dot entries are
    // handled by the caller; separators/NUL can never become filesystem paths.
    if wide.iter().any(|c| matches!(*c, 0 | 47 | 92)) {
        return Err(invalid());
    }
    let attributes = u32_at(56);
    let kind = if attributes & REPARSE_POINT != 0 {
        Kind::Other
    } else if attributes & DIRECTORY != 0 {
        Kind::Directory
    } else if attributes & DEVICE != 0 {
        Kind::Other
    } else {
        Kind::File
    };
    let bytes = i64::from_le_bytes(buffer[40..48].try_into().unwrap());
    if bytes < 0 {
        return Err(invalid());
    }
    Ok((
        (next != 0).then_some(next),
        NativeEntry {
            name,
            kind,
            bytes: bytes as u64,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(name: &str, bytes: i64, attributes: u32, next: bool) -> Vec<u8> {
        let wide: Vec<_> = name.encode_utf16().collect();
        let size = (NAME_OFFSET + wide.len() * 2).next_multiple_of(8);
        let mut data = vec![0; size];
        if next {
            data[..4].copy_from_slice(&(size as u32).to_le_bytes());
        }
        data[40..48].copy_from_slice(&bytes.to_le_bytes());
        data[56..60].copy_from_slice(&attributes.to_le_bytes());
        data[60..64].copy_from_slice(&((wide.len() * 2) as u32).to_le_bytes());
        for (dst, c) in data[NAME_OFFSET..].chunks_exact_mut(2).zip(wide) {
            dst.copy_from_slice(&c.to_le_bytes());
        }
        data
    }
    #[test]
    fn batch_preserves_unicode_large_sizes_and_reparse_attributes() {
        let mut data = encoded("中文 🦀.TXT", 5 << 30, 0, true);
        let second = data.len();
        data.extend(encoded("junction", 0, 0x410, true));
        data.extend(encoded("nested", 0, 0x10, false));
        let (next, entry) = record(&data).unwrap();
        assert_eq!(next, Some(second));
        assert_eq!(entry.name, "中文 🦀.TXT");
        assert_eq!(entry.bytes, 5 << 30);
        assert!(entry.kind == Kind::File);
        let data = &data[next.unwrap()..];
        let (next, entry) = record(data).unwrap();
        assert!(entry.kind == Kind::Other);
        let (next, entry) = record(&data[next.unwrap()..]).unwrap();
        assert!(next.is_none());
        assert!(entry.kind == Kind::Directory);
    }
    #[test]
    fn malformed_lengths_offsets_names_and_sizes_are_rejected() {
        let valid = encoded("file.txt", 1, 0, false);
        for n in 0..NAME_OFFSET + 16 {
            assert!(record(&valid[..n]).is_err());
        }
        for (offset, value) in [
            (0, 8u32),
            (0, 81),
            (0, u32::MAX),
            (60, 0),
            (60, 1),
            (60, u32::MAX),
        ] {
            let mut data = valid.clone();
            data[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            assert!(record(&data).is_err());
        }
        for name in ["../out", "a\\b", "a\0b"] {
            assert!(record(&encoded(name, 1, 0, false)).is_err());
        }
        assert!(record(&encoded("file", -1, 0, false)).is_err());
    }
    #[test]
    fn sdk_offsets_match_decoder() {
        assert_eq!(BUFFER_BYTES, 65536);
        #[cfg(windows)]
        {
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_ATTRIBUTE_DEVICE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
                FILE_FULL_DIR_INFO,
            };
            assert_eq!(DIRECTORY, FILE_ATTRIBUTE_DIRECTORY);
            assert_eq!(DEVICE, FILE_ATTRIBUTE_DEVICE);
            assert_eq!(REPARSE_POINT, FILE_ATTRIBUTE_REPARSE_POINT);
            assert_eq!(
                std::mem::offset_of!(FILE_FULL_DIR_INFO, FileName),
                NAME_OFFSET
            );
            assert_eq!(std::mem::offset_of!(FILE_FULL_DIR_INFO, EndOfFile), 40);
            assert_eq!(std::mem::offset_of!(FILE_FULL_DIR_INFO, FileAttributes), 56);
            assert_eq!(std::mem::offset_of!(FILE_FULL_DIR_INFO, FileNameLength), 60);
        }
    }
}
