//! OS directory/metadata plumbing. Document parsing stays in the shared core.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, ffi::OsString, io, path::Path};

#[cfg(any(windows, test))]
mod ntfs;
#[cfg(windows)]
mod windows;

#[derive(Deserialize, Serialize)]
pub struct Entry {
    pub path: String,
    pub bytes: u64,
}
#[derive(Deserialize, Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub backend: String,
    pub entries: Vec<Entry>,
    pub errors: Vec<Issue>,
    pub error_count: usize,
    pub visited: usize,
    pub skipped: usize,
    pub truncated: bool,
}
impl Scan {
    pub fn issue(&mut self, path: String, message: String) {
        self.error_count += 1;
        if self.errors.len() < 64 {
            self.errors.push(Issue { path, message });
        }
    }
}
fn default_backend() -> &'static str {
    if cfg!(target_os = "macos") {
        "fts"
    } else if cfg!(windows) {
        "ntfs"
    } else {
        "read-dir"
    }
}
pub fn capacity() -> Value {
    json!({"backend":default_backend(),"hdrwEmbedded":false,
        "rawDevices":false,"followSymlinks":false,
        "ntfs":{"available":cfg!(windows),"requiresAdmin":false,
            "directoryBufferBytes":65536,"fallback":"read-dir"}})
}
pub fn scan(root: &Path, config: &Value) -> Result<Scan> {
    let backend = std::env::var("FILENS_WALKER").unwrap_or_else(|_| default_backend().into());
    scan_with_backend(root, config, &backend)
}
fn scan_with_backend(root: &Path, config: &Value, backend: &str) -> Result<Scan> {
    // Bound recursion even for direct callers, independently of request validation.
    let options: WalkOptions = serde_json::from_value(config.clone())?;
    ensure!(
        (1..=256).contains(&options.max_depth),
        "invalid directory scan depth"
    );
    let mut result = match backend {
        "read-dir" => portable(root, options)?,
        #[cfg(target_os = "macos")]
        "fts" => native(root, config)?,
        #[cfg(windows)]
        "ntfs" => windows::scan(root, options)?,
        _ => anyhow::bail!("directory walker {backend:?} is unavailable on this platform"),
    };
    result.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WalkOptions {
    max_files: usize,
    max_entries: usize,
    max_depth: usize,
    include_hidden: bool,
    extensions: HashSet<String>,
    exclude: HashSet<String>,
}
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Directory,
    File,
    Other,
}
struct NativeEntry {
    name: OsString,
    kind: Kind,
    bytes: u64,
}
struct Walker {
    options: WalkOptions,
    result: Scan,
}
impl Walker {
    fn new(options: WalkOptions, backend: &str) -> Self {
        Self {
            options,
            result: Scan {
                backend: backend.into(),
                ..Default::default()
            },
        }
    }
    // Same callback actions as the FTS adapter: continue, prune, stop.
    fn visit(&mut self, relative: &Path, entry: &NativeEntry) -> i32 {
        self.result.visited += 1;
        if self.result.visited > self.options.max_entries {
            self.result.truncated = true;
            return 2;
        }
        let Some(name) = entry.name.to_str() else {
            self.result
                .issue("<non-UTF-8>".into(), "Filename is not valid Unicode".into());
            return 1;
        };
        if relative.components().count() > self.options.max_depth
            || (!self.options.include_hidden && name.starts_with('.'))
            || self.options.exclude.contains(name)
        {
            self.result.skipped += 1;
            return 1;
        }
        if entry.kind != Kind::File {
            return 0;
        }
        let ext = Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !self.options.extensions.contains("*") && !self.options.extensions.contains(&ext) {
            self.result.skipped += 1;
            return 0;
        }
        if self.result.entries.len() >= self.options.max_files {
            self.result.truncated = true;
            return 2;
        }
        self.result.entries.push(Entry {
            path: relative_name(relative),
            bytes: entry.bytes,
        });
        0
    }
    fn issue(&mut self, path: &Path, error: io::Error) {
        self.result.issue(relative_name(path), error.to_string());
    }
}
fn relative_name(path: &Path) -> String {
    if path.as_os_str().is_empty() {
        return ".".into();
    }
    let name = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let name = name.replace('\\', "/");
    name
}
// Streaming DFS bounds open readers by depth and stops immediately at scan limits.
// An unsupported native API propagates to the Windows adapter, which restarts
// the entire scan with read_dir so entries/counters are never duplicated.
fn descend<I: Iterator<Item = io::Result<NativeEntry>>>(
    root: &Path,
    relative: &Path,
    walker: &mut Walker,
    open: &impl Fn(&Path) -> io::Result<I>,
) -> io::Result<bool> {
    let directory = match open(&root.join(relative)) {
        Ok(directory) => directory,
        Err(error) if error.kind() == io::ErrorKind::Unsupported => return Err(error),
        Err(error) => {
            walker.issue(relative, error);
            return Ok(false);
        }
    };
    for entry in directory {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) if error.kind() == io::ErrorKind::Unsupported => return Err(error),
            Err(error) => {
                walker.issue(relative, error);
                continue;
            }
        };
        let child = relative.join(&entry.name);
        match walker.visit(&child, &entry) {
            2 => return Ok(true),
            0 if entry.kind == Kind::Directory => {
                if descend(root, &child, walker, open)? {
                    return Ok(true);
                }
            }
            _ => {}
        }
    }
    Ok(false)
}
#[cfg(any(windows, test))]
fn native_or_portable<I: Iterator<Item = io::Result<NativeEntry>>>(
    root: &Path,
    options: WalkOptions,
    backend: &str,
    open: &impl Fn(&Path) -> io::Result<I>,
) -> io::Result<Scan> {
    let mut walker = Walker::new(options, backend);
    match descend(root, Path::new(""), &mut walker, open) {
        Ok(_) => Ok(walker.result),
        Err(error) if error.kind() == io::ErrorKind::Unsupported => portable(root, walker.options),
        Err(error) => Err(error),
    }
}
fn portable(root: &Path, options: WalkOptions) -> io::Result<Scan> {
    let mut walker = Walker::new(options, "read-dir");
    descend(root, Path::new(""), &mut walker, &|path| {
        Ok(std::fs::read_dir(path)?.map(|entry| {
            let entry = entry?;
            // Windows DirEntry metadata is cached by the OS enumeration.
            let metadata = entry.metadata()?;
            #[cfg(windows)]
            let reparse = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes()
                    & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
                    != 0
            };
            #[cfg(not(windows))]
            let reparse = metadata.is_symlink();
            let kind = if reparse {
                Kind::Other
            } else if metadata.is_dir() {
                Kind::Directory
            } else if metadata.is_file() {
                Kind::File
            } else {
                Kind::Other
            };
            Ok(NativeEntry {
                name: entry.file_name(),
                kind,
                bytes: metadata.len(),
            })
        }))
    })?;
    Ok(walker.result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Value {
        json!({"maxFiles":2000,"maxEntries":20000,"maxDepth":8,
            "extensions":["txt"],"exclude":[".git","node_modules","target","dist"],"includeHidden":false})
    }
    fn backends() -> Vec<&'static str> {
        let mut backends = vec!["read-dir"];
        if default_backend() != "read-dir" {
            backends.push(default_backend());
        }
        backends
    }
    fn paths(scan: &Scan) -> Vec<&str> {
        scan.entries.iter().map(|e| e.path.as_str()).collect()
    }
    #[test]
    fn native_walkers_preserve_scope_unicode_sizes_and_current_files() {
        let root = tempfile::tempdir().unwrap();
        for name in [
            "nested",
            ".hidden",
            "node_modules",
            "dist",
            "target",
            ".git",
        ] {
            std::fs::create_dir(root.path().join(name)).unwrap();
            std::fs::write(root.path().join(name).join("child.txt"), b"child").unwrap();
        }
        for name in ["中文 🦀.TXT", ".secret.txt", "ignored.bin"] {
            std::fs::write(root.path().join(name), b"evidence").unwrap();
        }
        for backend in backends() {
            let mut options = config();
            let result = scan_with_backend(root.path(), &options, backend).unwrap();
            assert_eq!(result.error_count, 0);
            assert!(!result.truncated);
            assert_eq!(paths(&result), ["nested/child.txt", "中文 🦀.TXT"]);
            assert_eq!(result.entries[1].bytes, 8);
            options["includeHidden"] = json!(true);
            let result = scan_with_backend(root.path(), &options, backend).unwrap();
            assert_eq!(
                paths(&result),
                [
                    ".hidden/child.txt",
                    ".secret.txt",
                    "nested/child.txt",
                    "中文 🦀.TXT"
                ]
            );
            options["maxDepth"] = json!(1);
            assert_eq!(
                paths(&scan_with_backend(root.path(), &options, backend).unwrap()),
                [".secret.txt", "中文 🦀.TXT"]
            );
            options["extensions"] = json!(["*"]);
            assert!(
                paths(&scan_with_backend(root.path(), &options, backend).unwrap())
                    .contains(&"ignored.bin")
            );
        }
        std::fs::remove_file(root.path().join("中文 🦀.TXT")).unwrap();
        std::fs::write(root.path().join("new.txt"), b"new").unwrap();
        for backend in backends() {
            assert_eq!(
                paths(&scan_with_backend(root.path(), &config(), backend).unwrap()),
                ["nested/child.txt", "new.txt"]
            );
        }
    }
    #[test]
    fn file_and_entry_limits_are_reported_without_false_truncation() {
        let root = tempfile::tempdir().unwrap();
        for name in ["a.txt", "b.txt", "c.txt"] {
            std::fs::write(root.path().join(name), b"x").unwrap();
        }
        for backend in backends() {
            let mut options = config();
            options["maxFiles"] = json!(3);
            assert!(
                !scan_with_backend(root.path(), &options, backend)
                    .unwrap()
                    .truncated
            );
            options["maxFiles"] = json!(2);
            let result = scan_with_backend(root.path(), &options, backend).unwrap();
            assert!(result.truncated);
            assert_eq!(result.entries.len(), 2);
            options["maxFiles"] = json!(10);
            options["maxEntries"] = json!(1);
            let result = scan_with_backend(root.path(), &options, backend).unwrap();
            assert!(result.truncated);
            assert_eq!(result.visited, 2);
            assert_eq!(result.entries.len(), 1);
        }
    }
    #[test]
    fn many_entries_match_portable_scan_across_native_batches() {
        let root = tempfile::tempdir().unwrap();
        for i in 0..512 {
            std::fs::write(
                root.path()
                    .join(format!("{i:04}-{}.txt", "中文".repeat(40))),
                format!("{i}"),
            )
            .unwrap();
        }
        let expected = scan_with_backend(root.path(), &config(), "read-dir").unwrap();
        for backend in backends() {
            let result = scan_with_backend(root.path(), &config(), backend).unwrap();
            assert_eq!(result.error_count, 0);
            assert_eq!(result.entries.len(), 512);
            assert_eq!(paths(&result), paths(&expected));
            assert_eq!(
                result.entries.iter().map(|e| e.bytes).collect::<Vec<_>>(),
                expected.entries.iter().map(|e| e.bytes).collect::<Vec<_>>()
            );
            assert_eq!(result.visited, expected.visited);
        }
    }
    #[test]
    fn unsupported_native_api_restarts_without_duplicate_entries_or_counters() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.txt"), b"a").unwrap();
        std::fs::write(root.path().join("b.txt"), b"b").unwrap();
        let mut result = native_or_portable(
            root.path(),
            serde_json::from_value(config()).unwrap(),
            "test-native",
            &|_| {
                Ok(vec![
                    Ok(NativeEntry {
                        name: "a.txt".into(),
                        kind: Kind::File,
                        bytes: 99,
                    }),
                    Err(io::Error::other("discard this native error too")),
                    Err(io::Error::from(io::ErrorKind::Unsupported)),
                ]
                .into_iter())
            },
        )
        .unwrap();
        result.entries.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(result.backend, "read-dir");
        assert_eq!(result.visited, 2);
        assert_eq!(result.error_count, 0);
        assert!(result.errors.is_empty());
        assert_eq!(paths(&result), ["a.txt", "b.txt"]);
        assert!(result.entries.iter().all(|e| e.bytes == 1));
    }
    #[test]
    fn missing_directory_is_a_partial_error_and_issue_storage_is_bounded() {
        let root = tempfile::tempdir().unwrap();
        for backend in backends() {
            let result =
                scan_with_backend(&root.path().join("missing"), &config(), backend).unwrap();
            assert_eq!(result.error_count, 1);
            assert!(result.entries.is_empty());
        }
        let mut result = Scan::default();
        for _ in 0..100 {
            result.issue(".".into(), "error".into());
        }
        assert_eq!(result.error_count, 100);
        assert_eq!(result.errors.len(), 64);
        assert_eq!(capacity()["hdrwEmbedded"], false);
        assert!(scan_with_backend(root.path(), &config(), "unknown").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_and_cycles_are_not_followed() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("outside.txt"), "outside").unwrap();
        std::fs::write(root.path().join("inside.txt"), "inside").unwrap();
        symlink(outside.path(), root.path().join("escape")).unwrap();
        symlink(
            outside.path().join("outside.txt"),
            root.path().join("link.txt"),
        )
        .unwrap();
        symlink(root.path(), root.path().join("cycle")).unwrap();
        for backend in backends() {
            let result = scan_with_backend(root.path(), &config(), backend).unwrap();
            assert_eq!(result.error_count, 0);
            assert_eq!(paths(&result), ["inside.txt"]);
        }
    }
    #[cfg(windows)]
    #[test]
    fn junctions_are_not_followed_without_developer_mode() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("outside.txt"), "outside").unwrap();
        let result = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(root.path().join("escape"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        for backend in backends() {
            let result = scan_with_backend(root.path(), &config(), backend).unwrap();
            assert_eq!(result.error_count, 0);
            assert!(result.entries.is_empty());
        }
        // Remove only the junction before TempDir cleanup.
        std::fs::remove_dir(root.path().join("escape")).unwrap();
    }
}

#[cfg(target_os = "macos")]
fn native(root: &Path, config: &Value) -> Result<Scan> {
    use std::{
        ffi::{CStr, CString},
        os::unix::ffi::OsStrExt,
    };
    struct Context<'a> {
        root: &'a Path,
        config: &'a Value,
        extensions: HashSet<String>,
        excluded: HashSet<String>,
        result: Scan,
    }
    unsafe extern "C" {
        fn filens_fts_walk(
            root: *const libc::c_char,
            context: *mut libc::c_void,
            callback: extern "C" fn(
                *mut libc::c_void,
                *const libc::c_char,
                libc::c_int,
                i64,
                libc::c_int,
            ) -> libc::c_int,
        ) -> libc::c_int;
    }
    extern "C" fn entry(
        context: *mut libc::c_void,
        path: *const libc::c_char,
        kind: libc::c_int,
        bytes: i64,
        error: libc::c_int,
    ) -> libc::c_int {
        let c = unsafe { &mut *(context as *mut Context<'_>) };
        let Ok(path) = unsafe { CStr::from_ptr(path) }.to_str() else {
            c.result
                .issue("<non-UTF-8>".into(), "Filename is not valid UTF-8".into());
            return 0;
        };
        let Ok(relative) = Path::new(path).strip_prefix(c.root) else {
            c.result
                .issue(".".into(), "FTS returned a path outside the root".into());
            return 2;
        };
        let relative = relative.to_str().unwrap();
        if error != 0 {
            c.result.issue(
                relative.into(),
                std::io::Error::from_raw_os_error(error).to_string(),
            );
            return 0;
        }
        if relative.is_empty() {
            return 0;
        }
        c.result.visited += 1;
        if c.result.visited > c.config["maxEntries"].as_u64().unwrap() as usize {
            c.result.truncated = true;
            return 2;
        }
        let name = Path::new(relative).file_name().unwrap().to_str().unwrap();
        let depth = Path::new(relative).components().count();
        if depth > c.config["maxDepth"].as_u64().unwrap() as usize
            || (!c.config["includeHidden"].as_bool().unwrap() && name.starts_with('.'))
            || c.excluded.contains(name)
        {
            c.result.skipped += 1;
            return i32::from(kind == 1);
        }
        if kind != 2 {
            return 0;
        }
        let ext = Path::new(name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !c.extensions.contains("*") && !c.extensions.contains(&ext) {
            c.result.skipped += 1;
            return 0;
        }
        if c.result.entries.len() >= c.config["maxFiles"].as_u64().unwrap() as usize {
            c.result.truncated = true;
            return 2;
        }
        c.result.entries.push(Entry {
            path: relative.into(),
            bytes: bytes.max(0) as u64,
        });
        0
    }
    let set = |key: &str| {
        config[key]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    };
    let mut context = Context {
        root,
        config,
        extensions: set("extensions"),
        excluded: set("exclude"),
        result: Scan {
            backend: "fts".into(),
            ..Default::default()
        },
    };
    let root_string = CString::new(root.as_os_str().as_bytes())?;
    let error = unsafe {
        filens_fts_walk(
            root_string.as_ptr(),
            &mut context as *mut _ as *mut libc::c_void,
            entry,
        )
    };
    if error != 0 {
        context.result.issue(
            ".".into(),
            std::io::Error::from_raw_os_error(error).to_string(),
        );
    }
    Ok(context.result)
}
