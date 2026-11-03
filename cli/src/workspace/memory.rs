//! Request-local WASI scratch storage. No disk fallback, including for workers.
use std::{
    any::Any,
    collections::BTreeMap,
    io::{IoSlice, IoSliceMut, Read, SeekFrom},
    path::Path,
    sync::{Arc, Mutex},
};
use wasmi_wasi::{
    WasiDir, WasiFile,
    wasi_common::{
        Error, ErrorExt,
        dir::{OpenResult, ReaddirCursor, ReaddirEntity},
        file::{FdFlags, FileType, Filestat, OFlags},
    },
};

pub const LIMIT: usize = 512 << 20;
const MAX_FILES: usize = 4096;

struct Budget {
    used: Mutex<usize>,
    limit: usize,
}
struct Data {
    bytes: Vec<u8>,
    budget: Arc<Budget>,
}
impl Data {
    fn resize(&mut self, size: usize) -> Result<(), Error> {
        let mut used = self.budget.used.lock().unwrap();
        let next = used
            .checked_sub(self.bytes.len())
            .and_then(|n| n.checked_add(size))
            .filter(|n| *n <= self.budget.limit)
            .ok_or_else(Error::too_big)?;
        if size > self.bytes.len() {
            self.bytes
                .try_reserve_exact(size - self.bytes.len())
                .map_err(|_| Error::too_big())?;
        }
        self.bytes.resize(size, 0);
        // Release the allocation as well as the quota on truncation.
        if size < self.bytes.capacity() / 2 {
            self.bytes.shrink_to_fit();
        }
        *used = next;
        Ok(())
    }
}
impl Drop for Data {
    fn drop(&mut self) {
        *self.budget.used.lock().unwrap() -= self.bytes.len();
    }
}

#[derive(Clone)]
pub(super) struct MemoryFs {
    files: Arc<Mutex<BTreeMap<String, Arc<Mutex<Data>>>>>,
    budget: Arc<Budget>,
}
impl MemoryFs {
    pub fn new() -> Self {
        Self::with_budget(Arc::new(Budget {
            used: Mutex::new(0),
            limit: LIMIT,
        }))
    }
    fn with_budget(budget: Arc<Budget>) -> Self {
        Self {
            files: Arc::default(),
            budget,
        }
    }
    pub fn fork(&self) -> Self {
        Self::with_budget(self.budget.clone())
    }
    pub(super) fn name(path: &str) -> Result<&str, Error> {
        // The conversion ABI only uses a flat /work directory. No aliases,
        // symlinks, absolute paths or parent traversal can escape this store.
        if path.is_empty()
            || path == "."
            || path == ".."
            || path.len() > 255
            || path.contains(['/', '\\', '\0'])
        {
            return Err(Error::invalid_argument());
        }
        Ok(path)
    }
    fn file(&self, name: &str) -> Result<Arc<Mutex<Data>>, Error> {
        self.files
            .lock()
            .unwrap()
            .get(Self::name(name)?)
            .cloned()
            .ok_or_else(Error::not_found)
    }
    pub fn write(&self, name: impl AsRef<str>, bytes: impl AsRef<[u8]>) -> anyhow::Result<()> {
        let file = self.open(
            name.as_ref(),
            OFlags::CREATE | OFlags::TRUNCATE,
            true,
            true,
            FdFlags::empty(),
        )?;
        file.write_at(&[IoSlice::new(bytes.as_ref())], 0)?;
        Ok(())
    }
    #[cfg(test)]
    pub fn read(&self, name: impl AsRef<str>) -> anyhow::Result<Vec<u8>> {
        self.read_bounded(name, LIMIT)
    }
    pub fn read_bounded(&self, name: impl AsRef<str>, limit: usize) -> anyhow::Result<Vec<u8>> {
        let file = self.file(name.as_ref())?;
        let data = file.lock().unwrap();
        anyhow::ensure!(
            data.bytes.len() <= limit,
            "memory file exceeds {limit} byte limit"
        );
        Ok(data.bytes.clone())
    }
    pub fn len(&self, name: impl AsRef<str>) -> anyhow::Result<usize> {
        Ok(self.file(name.as_ref())?.lock().unwrap().bytes.len())
    }
    pub fn remove(&self, name: &str) {
        self.files.lock().unwrap().remove(name);
    }
    pub fn load(&self, name: impl AsRef<str>, source: &Path, limit: usize) -> anyhow::Result<()> {
        let mut input = std::fs::File::open(source)?.take(limit as u64 + 1);
        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes)?;
        anyhow::ensure!(
            bytes.len() <= limit,
            "input exceeded size limit while reading"
        );
        self.write(name, bytes)
    }
    fn open(
        &self,
        path: &str,
        flags: OFlags,
        read: bool,
        write: bool,
        fdflags: FdFlags,
    ) -> Result<MemoryFile, Error> {
        let name = Self::name(path)?;
        if flags.contains(OFlags::DIRECTORY) {
            return Err(Error::not_dir());
        }
        if flags.intersects(OFlags::CREATE | OFlags::TRUNCATE) && !write {
            return Err(Error::perm());
        }
        let mut files = self.files.lock().unwrap();
        let data = if let Some(data) = files.get(name) {
            if flags.contains(OFlags::CREATE | OFlags::EXCLUSIVE) {
                return Err(Error::exist());
            }
            data.clone()
        } else {
            if !flags.contains(OFlags::CREATE) {
                return Err(Error::not_found());
            }
            if files.len() >= MAX_FILES {
                return Err(Error::too_big());
            }
            let data = Arc::new(Mutex::new(Data {
                bytes: Vec::new(),
                budget: self.budget.clone(),
            }));
            files.insert(name.into(), data.clone());
            data
        };
        if flags.contains(OFlags::TRUNCATE) {
            data.lock().unwrap().resize(0)?;
        }
        Ok(MemoryFile {
            data,
            cursor: Mutex::new(0),
            flags: fdflags,
            read,
            write,
        })
    }
}
fn stat(kind: FileType, size: usize) -> Filestat {
    Filestat {
        device_id: 0,
        inode: 0,
        filetype: kind,
        nlink: 1,
        size: size as u64,
        atim: None,
        mtim: None,
        ctim: None,
    }
}
#[wiggle::async_trait]
impl WasiDir for MemoryFs {
    fn as_any(&self) -> &dyn Any {
        self
    }
    async fn open_file(
        &self,
        _: bool,
        path: &str,
        flags: OFlags,
        read: bool,
        write: bool,
        fdflags: FdFlags,
    ) -> Result<OpenResult, Error> {
        if path == "." && !flags.intersects(OFlags::CREATE | OFlags::TRUNCATE) {
            return Ok(OpenResult::Dir(Box::new(self.clone())));
        }
        Ok(OpenResult::File(Box::new(
            self.open(path, flags, read, write, fdflags)?,
        )))
    }
    async fn unlink_file(&self, path: &str) -> Result<(), Error> {
        self.files
            .lock()
            .unwrap()
            .remove(Self::name(path)?)
            .map(|_| ())
            .ok_or_else(Error::not_found)
    }
    async fn get_filestat(&self) -> Result<Filestat, Error> {
        Ok(stat(FileType::Directory, 0))
    }
    async fn get_path_filestat(&self, path: &str, _: bool) -> Result<Filestat, Error> {
        if path == "." {
            return Ok(stat(FileType::Directory, 0));
        }
        Ok(stat(
            FileType::RegularFile,
            self.file(path)?.lock().unwrap().bytes.len(),
        ))
    }
    async fn readdir(
        &self,
        cursor: ReaddirCursor,
    ) -> Result<Box<dyn Iterator<Item = Result<ReaddirEntity, Error>> + Send>, Error> {
        let items: Vec<_> = self
            .files
            .lock()
            .unwrap()
            .keys()
            .enumerate()
            .skip(u64::from(cursor) as usize)
            .map(|(i, name)| {
                Ok(ReaddirEntity {
                    next: ((i + 1) as u64).into(),
                    inode: 0,
                    name: name.clone(),
                    filetype: FileType::RegularFile,
                })
            })
            .collect();
        Ok(Box::new(items.into_iter()))
    }
}
struct MemoryFile {
    data: Arc<Mutex<Data>>,
    cursor: Mutex<u64>,
    flags: FdFlags,
    read: bool,
    write: bool,
}
impl MemoryFile {
    fn read_at(&self, bufs: &mut [IoSliceMut<'_>], offset: u64) -> Result<u64, Error> {
        if !self.read {
            return Err(Error::badf());
        }
        let data = self.data.lock().unwrap();
        let mut start = usize::try_from(offset)
            .map_err(|_| Error::overflow())?
            .min(data.bytes.len());
        let initial = start;
        for buf in bufs {
            let n = buf.len().min(data.bytes.len() - start);
            buf[..n].copy_from_slice(&data.bytes[start..start + n]);
            start += n;
        }
        Ok((start - initial) as u64)
    }
    fn write_at(&self, bufs: &[IoSlice<'_>], offset: u64) -> Result<(u64, u64), Error> {
        if !self.write {
            return Err(Error::badf());
        }
        let mut data = self.data.lock().unwrap();
        let start = if self.flags.contains(FdFlags::APPEND) {
            data.bytes.len()
        } else {
            usize::try_from(offset).map_err(|_| Error::overflow())?
        };
        let size = bufs
            .iter()
            .try_fold(0usize, |n, b| n.checked_add(b.len()))
            .ok_or_else(Error::too_big)?;
        if size == 0 {
            return Ok((0, offset));
        }
        let end = start.checked_add(size).ok_or_else(Error::too_big)?;
        let len = data.bytes.len();
        data.resize(len.max(end))?;
        let mut at = start;
        for buf in bufs {
            data.bytes[at..at + buf.len()].copy_from_slice(buf);
            at += buf.len();
        }
        Ok((size as u64, end as u64))
    }
}
#[wiggle::async_trait]
impl WasiFile for MemoryFile {
    fn as_any(&self) -> &dyn Any {
        self
    }
    async fn get_filetype(&self) -> Result<FileType, Error> {
        Ok(FileType::RegularFile)
    }
    async fn get_fdflags(&self) -> Result<FdFlags, Error> {
        Ok(self.flags)
    }
    async fn set_fdflags(&mut self, flags: FdFlags) -> Result<(), Error> {
        self.flags = flags;
        Ok(())
    }
    async fn get_filestat(&self) -> Result<Filestat, Error> {
        Ok(stat(
            FileType::RegularFile,
            self.data.lock().unwrap().bytes.len(),
        ))
    }
    async fn set_filestat_size(&self, size: u64) -> Result<(), Error> {
        if !self.write {
            return Err(Error::badf());
        }
        self.data
            .lock()
            .unwrap()
            .resize(usize::try_from(size).map_err(|_| Error::too_big())?)
    }
    async fn read_vectored<'a>(&self, bufs: &mut [IoSliceMut<'a>]) -> Result<u64, Error> {
        let mut cursor = self.cursor.lock().unwrap();
        let n = self.read_at(bufs, *cursor)?;
        *cursor += n;
        Ok(n)
    }
    async fn read_vectored_at<'a>(
        &self,
        bufs: &mut [IoSliceMut<'a>],
        offset: u64,
    ) -> Result<u64, Error> {
        self.read_at(bufs, offset)
    }
    async fn write_vectored<'a>(&self, bufs: &[IoSlice<'a>]) -> Result<u64, Error> {
        let mut cursor = self.cursor.lock().unwrap();
        let (n, end) = self.write_at(bufs, *cursor)?;
        *cursor = end;
        Ok(n)
    }
    async fn write_vectored_at<'a>(&self, bufs: &[IoSlice<'a>], offset: u64) -> Result<u64, Error> {
        Ok(self.write_at(bufs, offset)?.0)
    }
    async fn seek(&self, pos: SeekFrom) -> Result<u64, Error> {
        let mut cursor = self.cursor.lock().unwrap();
        let next = match pos {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::Current(n) => *cursor as i128 + n as i128,
            SeekFrom::End(n) => self.data.lock().unwrap().bytes.len() as i128 + n as i128,
        };
        *cursor = u64::try_from(next).map_err(|_| Error::invalid_argument())?;
        Ok(*cursor)
    }
    async fn readable(&self) -> Result<(), Error> {
        if self.read {
            Ok(())
        } else {
            Err(Error::badf())
        }
    }
    async fn writable(&self) -> Result<(), Error> {
        if self.write {
            Ok(())
        } else {
            Err(Error::badf())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready<T>(f: impl std::future::Future<Output = T>) -> T {
        wiggle::run_in_dummy_executor(f).unwrap()
    }
    #[test]
    fn wasi_file_semantics_and_paths() {
        let work = MemoryFs::new();
        let f = work
            .open(
                "a",
                OFlags::CREATE | OFlags::EXCLUSIVE,
                true,
                true,
                FdFlags::empty(),
            )
            .unwrap();
        ready(f.write_vectored(&[IoSlice::new(b"abc")])).unwrap();
        ready(f.seek(SeekFrom::Start(5))).unwrap();
        ready(f.write_vectored(&[IoSlice::new(b"z")])).unwrap();
        assert_eq!(work.read("a").unwrap(), b"abc\0\0z");
        ready(f.seek(SeekFrom::End(-3))).unwrap();
        let mut b = [0; 3];
        assert_eq!(
            ready(f.read_vectored(&mut [IoSliceMut::new(&mut b)])).unwrap(),
            3
        );
        assert_eq!(&b, b"\0\0z");
        assert!(
            work.open(
                "a",
                OFlags::CREATE | OFlags::EXCLUSIVE,
                true,
                true,
                FdFlags::empty()
            )
            .is_err()
        );
        let append = work
            .open("a", OFlags::empty(), false, true, FdFlags::APPEND)
            .unwrap();
        ready(append.write_vectored(&[IoSlice::new(b"!")])).unwrap();
        assert_eq!(work.read("a").unwrap(), b"abc\0\0z!");
        ready(f.set_filestat_size(2)).unwrap();
        assert_eq!(work.read("a").unwrap(), b"ab");
        assert!(ready(f.seek(SeekFrom::End(-3))).is_err());
        assert!(ready(f.set_filestat_size(u64::MAX)).is_err());
        assert!(ready(f.write_vectored_at(&[IoSlice::new(b"x")], u64::MAX)).is_err());
        assert_eq!(work.read("a").unwrap(), b"ab");
        for name in ["../a", "a/b", "/tmp/a", "a\\b", "..", "", "a\0b"] {
            assert!(work.write(name, b"x").is_err());
        }
    }
    #[test]
    fn workers_share_budget_and_unlinked_open_files_keep_their_charge() {
        let work = MemoryFs::with_budget(Arc::new(Budget {
            used: Mutex::new(0),
            limit: 10,
        }));
        work.write("a", b"123456").unwrap();
        let file = work
            .open("a", OFlags::empty(), true, false, FdFlags::empty())
            .unwrap();
        let child = work.fork();
        assert!(child.read("a").is_err());
        work.remove("a");
        assert!(child.write("a", b"12345").is_err());
        assert!(ready(file.set_filestat_size(0)).is_err());
        drop(file);
        child.write("a", b"12345").unwrap();
        assert_eq!(*work.budget.used.lock().unwrap(), 5);
        drop(child);
        assert_eq!(*work.budget.used.lock().unwrap(), 0);
    }
}
