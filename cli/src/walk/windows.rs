//! NTFS batched directory enumeration through documented Windows APIs.
use super::{NativeEntry, Scan, WalkOptions, native_or_portable, ntfs, portable};
use std::{
    fs::{File, OpenOptions},
    io,
    mem::size_of,
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{
        ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER, ERROR_NO_MORE_FILES, ERROR_NOT_SUPPORTED,
    },
    Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_LIST_DIRECTORY,
        FILE_READ_ATTRIBUTES, FileAttributeTagInfo, FileFullDirectoryInfo,
        GetFileInformationByHandleEx, GetVolumeInformationByHandleW,
    },
};

fn open_directory(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
    // File owns the handle; info is writable for its exact SDK struct size.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileAttributeTagInfo,
            (&mut info as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),
            size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    if info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY == 0
    {
        return Err(io::Error::other(
            "directory was replaced by a reparse point or non-directory",
        ));
    }
    Ok(file)
}
fn is_ntfs(root: &Path) -> bool {
    let Ok(file) = open_directory(root) else {
        return false;
    };
    let mut name = [0u16; 32];
    // Query only the root's mounted filesystem; no volume/raw device is opened.
    let ok = unsafe {
        GetVolumeInformationByHandleW(
            file.as_raw_handle(),
            ptr::null_mut(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        )
    };
    ok != 0 && name[..5] == [b'N' as u16, b'T' as u16, b'F' as u16, b'S' as u16, 0]
}
pub(super) fn scan(root: &Path, options: WalkOptions) -> io::Result<Scan> {
    if !is_ntfs(root) {
        return portable(root, options);
    }
    native_or_portable(root, options, "ntfs", &Directory::open)
}
struct Directory {
    file: File,
    // u64 storage supplies the 8-byte alignment required by the Windows API.
    buffer: Vec<u64>,
    offset: Option<usize>,
    done: bool,
}
impl Directory {
    fn open(path: &Path) -> io::Result<Self> {
        Ok(Self {
            file: open_directory(path)?,
            buffer: vec![0; ntfs::BUFFER_BYTES / 8],
            offset: None,
            done: false,
        })
    }
}
impl Iterator for Directory {
    type Item = io::Result<NativeEntry>;
    fn next(&mut self) -> Option<Self::Item> {
        while !self.done {
            if self.offset.is_none() {
                // Clear stale records because this API returns no byte count.
                self.buffer.fill(0);
                let ok = unsafe {
                    GetFileInformationByHandleEx(
                        self.file.as_raw_handle(),
                        FileFullDirectoryInfo,
                        self.buffer.as_mut_ptr().cast(),
                        ntfs::BUFFER_BYTES as u32,
                    )
                };
                if ok == 0 {
                    self.done = true;
                    let error = io::Error::last_os_error();
                    return match error.raw_os_error().map(|code| code as u32) {
                        Some(ERROR_NO_MORE_FILES) => None,
                        Some(
                            ERROR_INVALID_FUNCTION | ERROR_INVALID_PARAMETER | ERROR_NOT_SUPPORTED,
                        ) => Some(Err(io::Error::new(io::ErrorKind::Unsupported, error))),
                        _ => Some(Err(error)),
                    };
                }
                self.offset = Some(0);
            }
            // Buffer is initialized, alive and unchanged while decoding.
            let buffer = unsafe {
                std::slice::from_raw_parts(self.buffer.as_ptr().cast::<u8>(), ntfs::BUFFER_BYTES)
            };
            let offset = self.offset.unwrap();
            match ntfs::record(&buffer[offset..]) {
                Ok((next, entry)) => {
                    self.offset = next.map(|next| offset + next);
                    if entry.name == "." || entry.name == ".." {
                        continue;
                    }
                    return Some(Ok(entry));
                }
                Err(error) => {
                    self.done = true;
                    return Some(Err(error));
                }
            }
        }
        None
    }
}
