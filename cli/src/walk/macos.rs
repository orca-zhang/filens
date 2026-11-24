//! Batched directory metadata, using the same data-fork size as stat/FTS.
use super::{Kind, NativeEntry, Scan, WalkOptions, Walker, descend};
use std::{
    ffi::OsString,
    fs::{File, OpenOptions},
    io,
    os::{
        fd::AsRawFd,
        unix::{ffi::OsStringExt, fs::OpenOptionsExt},
    },
    path::Path,
};

const BUFFER_BYTES: usize = 16 * 1024;
// ATTR_CMN_ERROR from sys/attr.h is not exposed by libc.
const ATTR_CMN_ERROR: u32 = 0x20000000;
const COMMON: u32 =
    libc::ATTR_CMN_RETURNED_ATTRS | libc::ATTR_CMN_NAME | ATTR_CMN_ERROR | libc::ATTR_CMN_OBJTYPE;
// Packed fields have four-byte alignment: length, attribute_set_t, error,
// attrreference_t, fsobj_type_t, then off_t for regular files, then the name.
const NAME_REF: usize = 28;
const HEADER_BYTES: usize = 40;

pub(super) fn scan(root: &Path, options: WalkOptions) -> io::Result<Scan> {
    let mut walker = Walker::new(options, "getattrlistbulk")?;
    descend(root, Path::new(""), &mut walker, &Directory::open)?;
    Ok(walker.result)
}

struct Directory {
    file: File,
    buffer: Vec<u64>,
    offset: usize,
    remaining: usize,
    done: bool,
}
impl Directory {
    fn open(path: &Path) -> io::Result<Self> {
        Ok(Self {
            file: OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(path)?,
            buffer: vec![0; BUFFER_BYTES / 8],
            offset: 0,
            remaining: 0,
            done: false,
        })
    }
    fn read(&mut self) -> io::Result<()> {
        let mut attributes = libc::attrlist {
            bitmapcount: libc::ATTR_BIT_MAP_COUNT,
            reserved: 0,
            commonattr: COMMON,
            volattr: 0,
            dirattr: 0,
            fileattr: libc::ATTR_FILE_DATALENGTH,
            forkattr: 0,
        };
        // The initialized u64 buffer supplies the required eight-byte alignment.
        let count = unsafe {
            libc::getattrlistbulk(
                self.file.as_raw_fd(),
                (&mut attributes as *mut libc::attrlist).cast(),
                self.buffer.as_mut_ptr().cast(),
                BUFFER_BYTES,
                u64::from(libc::FSOPT_PACK_INVAL_ATTRS),
            )
        };
        if count < 0 {
            let error = io::Error::last_os_error();
            return Err(match error.raw_os_error() {
                Some(libc::ENOTSUP | libc::ENOSYS | libc::EINVAL) => {
                    io::Error::new(io::ErrorKind::Unsupported, error)
                }
                _ => error,
            });
        }
        self.offset = 0;
        self.remaining = count as usize;
        self.done = count == 0;
        Ok(())
    }
}
impl Iterator for Directory {
    type Item = io::Result<NativeEntry>;
    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        if self.remaining == 0 {
            if let Err(error) = self.read() {
                self.done = true;
                return Some(Err(error));
            }
            if self.done {
                return None;
            }
        }
        // The buffer stays initialized and unchanged while this record is decoded.
        let buffer =
            unsafe { std::slice::from_raw_parts(self.buffer.as_ptr().cast::<u8>(), BUFFER_BYTES) };
        let record = buffer.get(self.offset..).and_then(|rest| {
            let length = u32::from_ne_bytes(rest.get(..4)?.try_into().ok()?) as usize;
            (length >= HEADER_BYTES).then_some(())?;
            rest.get(..length)
        });
        let Some(record) = record else {
            self.done = true;
            return Some(Err(invalid()));
        };
        self.offset = (self.offset + record.len() + 7) & !7;
        self.remaining -= 1;
        Some(decode(record))
    }
}

fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid macOS directory record")
}
fn decode(record: &[u8]) -> io::Result<NativeEntry> {
    if record.len() < HEADER_BYTES {
        return Err(invalid());
    }
    let u32_at = |at| u32::from_ne_bytes(record[at..at + 4].try_into().unwrap());
    let returned = u32_at(4);
    let error = u32_at(24);
    if returned & ATTR_CMN_ERROR != 0 && error != 0 {
        return Err(io::Error::from_raw_os_error(error as i32));
    }
    if returned & COMMON != COMMON {
        return Err(io::ErrorKind::Unsupported.into());
    }
    let offset = i32::from_ne_bytes(record[NAME_REF..NAME_REF + 4].try_into().unwrap());
    let start = NAME_REF
        .checked_add_signed(offset as isize)
        .ok_or_else(invalid)?;
    let length = u32_at(NAME_REF + 4) as usize;
    let end = start.checked_add(length).ok_or_else(invalid)?;
    let name = record.get(start..end).ok_or_else(invalid)?;
    if start < HEADER_BYTES || name.len() < 2 || name.last() != Some(&0) {
        return Err(invalid());
    }
    let name = &name[..name.len() - 1];
    if name.iter().any(|b| matches!(b, 0 | b'/')) || name == b"." || name == b".." {
        return Err(invalid());
    }
    // fsobj_type_t values from sys/vnode.h: VREG=1, VDIR=2; links stay Other.
    let kind = match u32_at(36) {
        1 => Kind::File,
        2 => Kind::Directory,
        _ => Kind::Other,
    };
    let bytes = if kind == Kind::File {
        if u32_at(16) & libc::ATTR_FILE_DATALENGTH == 0 {
            return Err(io::ErrorKind::Unsupported.into());
        }
        if start < HEADER_BYTES + 8 {
            return Err(invalid());
        }
        let bytes = i64::from_ne_bytes(record[40..48].try_into().unwrap());
        u64::try_from(bytes).map_err(|_| invalid())?
    } else {
        0
    };
    Ok(NativeEntry {
        name: OsString::from_vec(name.to_vec()),
        kind,
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(name: &[u8], kind: u32, bytes: i64) -> Vec<u8> {
        let header = HEADER_BYTES + if kind == 1 { 8 } else { 0 };
        let mut record = vec![0; (header + name.len() + 1).next_multiple_of(8)];
        let length = record.len() as u32;
        for (at, value) in [
            (0, length),
            (4, COMMON),
            (16, libc::ATTR_FILE_DATALENGTH),
            (NAME_REF, (header - NAME_REF) as u32),
            (NAME_REF + 4, name.len() as u32 + 1),
            (36, kind),
        ] {
            record[at..at + 4].copy_from_slice(&value.to_ne_bytes());
        }
        if kind == 1 {
            record[40..48].copy_from_slice(&bytes.to_ne_bytes());
        }
        record[header..header + name.len()].copy_from_slice(name);
        record
    }

    #[test]
    fn packed_attributes_preserve_names_sizes_and_link_types() {
        let entry = decode(&record("中文 🦀.txt".as_bytes(), 1, 5 << 30)).unwrap();
        assert_eq!(entry.name, "中文 🦀.txt");
        assert!(entry.kind == Kind::File);
        assert_eq!(entry.bytes, 5 << 30);
        for kind in [2, 5, 6] {
            let entry = decode(&record(b"entry", kind, 99)).unwrap();
            assert!(
                entry.kind
                    == if kind == 2 {
                        Kind::Directory
                    } else {
                        Kind::Other
                    }
            );
            assert_eq!(entry.bytes, 0);
        }
    }

    #[test]
    fn malformed_and_missing_attributes_never_silently_skip_files() {
        let valid = record(b"file.txt", 1, 1);
        for end in 0..HEADER_BYTES {
            assert!(decode(&valid[..end]).is_err());
        }
        for name in [b"../out".as_slice(), b"a\0b", b".", b".."] {
            assert!(decode(&record(name, 1, 1)).is_err());
        }
        assert!(decode(&record(b"file", 1, -1)).is_err());
        for (at, value) in [(NAME_REF, u32::MAX), (NAME_REF + 4, u32::MAX)] {
            let mut bad = valid.clone();
            bad[at..at + 4].copy_from_slice(&value.to_ne_bytes());
            assert!(decode(&bad).is_err());
        }
        let mut missing = valid.clone();
        missing[16..20].fill(0);
        assert_eq!(
            decode(&missing).err().unwrap().kind(),
            io::ErrorKind::Unsupported
        );
        let mut denied = valid;
        denied[24..28].copy_from_slice(&(libc::EACCES as u32).to_ne_bytes());
        assert_eq!(
            decode(&denied).err().unwrap().kind(),
            io::ErrorKind::PermissionDenied
        );
    }
}
