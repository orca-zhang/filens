//! One ZIP reader implementation for files and decrypted/in-memory packages.
//! Type erasure keeps zip's large parser from being instantiated per input type.
use std::io::{Read, Seek};

pub(crate) trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

pub(crate) type Archive<'a> = zip::ZipArchive<Box<dyn ReadSeek + 'a>>;

pub(crate) fn open<'a>(reader: impl Read + Seek + 'a) -> zip::result::ZipResult<Archive<'a>> {
    let mut archive = zip::ZipArchive::new(Box::new(reader) as Box<dyn ReadSeek + 'a>)?;
    archive.validate_header_consistency()?;
    Ok(archive)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    #[test]
    fn rejects_conflicting_local_and_central_entry_names() {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(
                "safe.txt",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(b"content").unwrap();
        let mut bytes = writer.finish().unwrap().into_inner();
        assert!(open(Cursor::new(&bytes)).unwrap().by_index(0).is_ok());
        #[cfg(feature = "text-extraction")]
        assert!(iwork::Package::from_bytes(&bytes).is_ok());
        bytes[30..38].copy_from_slice(b"evil.txt");
        assert!(open(Cursor::new(&bytes)).is_err());
        #[cfg(feature = "text-extraction")]
        assert!(iwork::Package::from_bytes(&bytes).is_err());
    }
}
