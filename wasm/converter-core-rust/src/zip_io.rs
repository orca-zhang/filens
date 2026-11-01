//! One ZIP reader implementation for files and decrypted/in-memory packages.
//! Type erasure keeps zip's large parser from being instantiated per input type.
use std::io::{Read, Seek};

pub(crate) trait ReadSeek: Read + Seek {}
impl<T: Read + Seek> ReadSeek for T {}

pub(crate) type Archive<'a> = zip::ZipArchive<Box<dyn ReadSeek + 'a>>;

pub(crate) fn open<'a>(reader: impl Read + Seek + 'a) -> zip::result::ZipResult<Archive<'a>> {
    zip::ZipArchive::new(Box::new(reader) as Box<dyn ReadSeek + 'a>)
}
