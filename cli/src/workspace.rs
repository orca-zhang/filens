//! Selectable request-local scratch storage. Memory is the default; disk is
//! explicit, and memory exhaustion never silently switches the backend.
mod memory;

use anyhow::{Result, ensure};
use memory::MemoryFs;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use wasmi_wasi::WasiDir;

pub use memory::LIMIT;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Memory,
    Disk,
}
impl std::str::FromStr for Mode {
    type Err = anyhow::Error;
    fn from_str(value: &str) -> Result<Self> {
        match value {
            "memory" => Ok(Self::Memory),
            "disk" => Ok(Self::Disk),
            _ => anyhow::bail!("workspace must be memory or disk"),
        }
    }
}

struct DiskWorkspace {
    directory: tempfile::TempDir,
    // A worker must keep its parent alive even if other request handles drop.
    _parent: Option<Arc<DiskWorkspace>>,
}
#[derive(Clone)]
enum Backend {
    Memory(MemoryFs),
    Disk(Arc<DiskWorkspace>),
}
#[derive(Clone)]
pub struct Workspace(Backend);
pub struct CleanupGuard(Workspace);
impl Drop for CleanupGuard {
    fn drop(&mut self) {
        if let Backend::Disk(work) = &self.0.0 {
            // The supervisor owns cleanup, including when a timed-out request
            // thread has not unwound before the CLI process exits.
            let _ = std::fs::remove_dir_all(work.directory.path());
        }
    }
}
impl Workspace {
    pub fn new() -> Self {
        Self(Backend::Memory(MemoryFs::new()))
    }
    pub fn with_mode(mode: Mode) -> Result<Self> {
        match mode {
            Mode::Memory => Ok(Self::new()),
            Mode::Disk => Ok(Self(Backend::Disk(Arc::new(DiskWorkspace {
                directory: tempfile::Builder::new().prefix("filens-work-").tempdir()?,
                _parent: None,
            })))),
        }
    }
    pub fn mode(&self) -> Mode {
        match self.0 {
            Backend::Memory(_) => Mode::Memory,
            Backend::Disk(_) => Mode::Disk,
        }
    }
    pub fn cleanup_guard(&self) -> CleanupGuard {
        CleanupGuard(self.clone())
    }
    pub fn fork(&self) -> Result<Self> {
        Ok(Self(match &self.0 {
            Backend::Memory(fs) => Backend::Memory(fs.fork()),
            Backend::Disk(parent) => Backend::Disk(Arc::new(DiskWorkspace {
                directory: tempfile::Builder::new()
                    .prefix("search-worker-")
                    .tempdir_in(parent.directory.path())?,
                _parent: Some(parent.clone()),
            })),
        }))
    }
    pub fn directory(&self) -> Result<Box<dyn WasiDir>> {
        Ok(match &self.0 {
            Backend::Memory(fs) => Box::new(fs.clone()),
            Backend::Disk(work) => Box::new(wasmi_wasi::wasi_common::sync::dir::Dir::from_cap_std(
                wasmi_wasi::Dir::open_ambient_dir(
                    work.directory.path(),
                    wasmi_wasi::ambient_authority(),
                )?,
            )),
        })
    }
    fn disk_path(work: &DiskWorkspace, name: &str) -> Result<PathBuf> {
        MemoryFs::name(name)?;
        let path = work.directory.path().join(name);
        if let Ok(metadata) = std::fs::symlink_metadata(&path) {
            ensure!(
                metadata.is_file() && !metadata.file_type().is_symlink(),
                "scratch files must be regular files"
            );
        }
        Ok(path)
    }
    pub fn write(&self, name: impl AsRef<str>, bytes: impl AsRef<[u8]>) -> Result<()> {
        match &self.0 {
            Backend::Memory(fs) => fs.write(name, bytes),
            Backend::Disk(work) => Ok(std::fs::File::create(Self::disk_path(
                work,
                name.as_ref(),
            )?)?
            .write_all(bytes.as_ref())?),
        }
    }
    pub fn read(&self, name: impl AsRef<str>) -> Result<Vec<u8>> {
        self.read_bounded(name, LIMIT)
    }
    pub fn read_bounded(&self, name: impl AsRef<str>, limit: usize) -> Result<Vec<u8>> {
        match &self.0 {
            Backend::Memory(fs) => fs.read_bounded(name, limit),
            Backend::Disk(work) => {
                let mut bytes = Vec::new();
                std::fs::File::open(Self::disk_path(work, name.as_ref())?)?
                    .take(limit as u64 + 1)
                    .read_to_end(&mut bytes)?;
                ensure!(
                    bytes.len() <= limit,
                    "scratch file exceeds {limit} byte limit"
                );
                Ok(bytes)
            }
        }
    }
    pub fn len(&self, name: impl AsRef<str>) -> Result<usize> {
        match &self.0 {
            Backend::Memory(fs) => fs.len(name),
            Backend::Disk(work) => Ok(std::fs::metadata(Self::disk_path(work, name.as_ref())?)?
                .len()
                .try_into()?),
        }
    }
    pub fn remove(&self, name: &str) -> Result<()> {
        match &self.0 {
            Backend::Memory(fs) => fs.remove(name),
            Backend::Disk(work) => match std::fs::remove_file(Self::disk_path(work, name)?) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            },
        }
        Ok(())
    }
    pub fn load(&self, name: impl AsRef<str>, source: &Path, limit: usize) -> Result<()> {
        match &self.0 {
            Backend::Memory(fs) => fs.load(name, source, limit),
            Backend::Disk(work) => {
                let mut input = std::fs::File::open(source)?.take(limit as u64 + 1);
                let mut output = std::fs::File::create(Self::disk_path(work, name.as_ref())?)?;
                ensure!(
                    std::io::copy(&mut input, &mut output)? <= limit as u64,
                    "input exceeded size limit while copying"
                );
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disk_workers_are_isolated_and_keep_the_parent_alive_until_cleanup() {
        let work = Workspace::with_mode(Mode::Disk).unwrap();
        let Backend::Disk(root) = &work.0 else {
            panic!("disk workspace required")
        };
        let root_path = root.directory.path().to_owned();
        let worker = work.fork().unwrap();
        work.write("input.txt", b"parent").unwrap();
        worker.write("input.txt", b"worker").unwrap();
        assert_eq!(work.read("input.txt").unwrap(), b"parent");
        assert_eq!(worker.read("input.txt").unwrap(), b"worker");
        assert!(worker.read_bounded("input.txt", 2).is_err());
        assert!(worker.write("../escape", b"x").is_err());
        drop(work);
        assert!(root_path.exists());
        assert_eq!(worker.read("input.txt").unwrap(), b"worker");
        drop(worker);
        assert!(!root_path.exists());
    }
}
