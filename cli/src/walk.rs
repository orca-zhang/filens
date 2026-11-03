//! Directory discovery: native FTS on macOS, embedded private hdrw WASI elsewhere.
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
#[cfg(target_os = "macos")]
use std::collections::HashSet;
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
use std::io::Read;
use std::path::Path;

#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
const HDRW: &[u8] = include_bytes!("../assets/hdrw.wasm.gz");

#[cfg(all(test, any(not(target_os = "macos"), feature = "hdrw-wasi")))]
mod stdio_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn stdout_limit_is_sticky_and_never_keeps_a_partial_write() {
        let mut out = BoundedOutput {
            bytes: Vec::new(),
            limit: 4,
            exceeded: false,
        };
        out.write_all(b"123").unwrap();
        assert!(out.write_all(b"45").is_err());
        assert_eq!(out.bytes, b"123");
        assert!(out.write_all(b"4").is_err());
        assert!(out.exceeded);
    }
    #[test]
    fn embedded_hdrw_reads_stdin_and_emits_one_json_result_without_work_files() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("中文.txt"), "evidence").unwrap();
        std::fs::write(root.path().join("ignored.bin"), "other").unwrap();
        let scan = wasm(root.path(), &json!({"maxFiles":10,"maxEntries":100,"maxDepth":8,"extensions":["txt"],"exclude":[],"includeHidden":false})).unwrap();
        assert_eq!(scan.backend, "hdrw-wasi");
        assert_eq!(scan.error_count, 0);
        assert_eq!(scan.entries.len(), 1);
        assert_eq!(scan.entries[0].path, "中文.txt");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 2);
        let invalid: Scan =
            serde_json::from_slice(&run_hdrw(root.path(), b"not JSON".to_vec()).unwrap()).unwrap();
        assert_eq!(invalid.error_count, 1);
        assert!(invalid.entries.is_empty());
        assert!(run_hdrw(root.path(), vec![b'x'; (1 << 20) + 1]).is_err());
    }
}

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
pub fn capacity() -> Value {
    json!({"backend": if cfg!(target_os="macos") { "fts" } else { "hdrw-wasi" },
        "hdrwEmbedded": cfg!(any(not(target_os="macos"), feature="hdrw-wasi")),
        "rawDevices":false,"followSymlinks":false})
}
pub fn scan(root: &Path, config: &Value) -> Result<Scan> {
    let backend = std::env::var("FILENS_WALKER").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "fts"
        } else {
            "hdrw-wasi"
        }
        .into()
    });
    let mut result = if backend == "hdrw-wasi" {
        wasm(root, config)?
    } else {
        ensure!(backend == "fts", "unknown directory walker");
        #[cfg(target_os = "macos")]
        {
            native(root, config)?
        }
        #[cfg(not(target_os = "macos"))]
        {
            anyhow::bail!("FTS walker is only available on macOS")
        }
    };
    result.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}
#[cfg(not(any(not(target_os = "macos"), feature = "hdrw-wasi")))]
fn wasm(_root: &Path, _config: &Value) -> Result<Scan> {
    anyhow::bail!("This macOS build uses native FTS and does not embed hdrw")
}
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
fn wasm(root: &Path, config: &Value) -> Result<Scan> {
    Ok(serde_json::from_slice(&run_hdrw(
        root,
        serde_json::to_vec(config)?,
    )?)?)
}
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
#[derive(Debug)]
struct BoundedOutput {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
impl std::io::Write for BoundedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.exceeded || bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(std::io::Error::other("hdrw stdout exceeds limit"));
        }
        self.bytes
            .try_reserve_exact(bytes.len())
            .map_err(|_| std::io::Error::other("allocate hdrw stdout"))?;
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
#[cfg(any(not(target_os = "macos"), feature = "hdrw-wasi"))]
fn run_hdrw(root: &Path, request: Vec<u8>) -> Result<Vec<u8>> {
    use wasmi::{Engine, Linker, Module, Store};
    use wasmi_wasi::wasi_common::pipe::{ReadPipe, WritePipe};
    use wasmi_wasi::{Dir, WasiCtx, WasiCtxBuilder, ambient_authority};
    struct State {
        wasi: WasiCtx,
        limits: wasmi::StoreLimits,
    }
    ensure!(request.len() <= 1 << 20, "hdrw stdin exceeds 1 MiB");
    let mut bytes = vec![];
    flate2::read::GzDecoder::new(HDRW)
        .take((32 << 20) + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 32 << 20, "hdrw module exceeds limit");
    let engine = Engine::default();
    let module = Module::new(&engine, &bytes[..])?;
    let stdout = WritePipe::new(BoundedOutput {
        bytes: Vec::new(),
        limit: 16 << 20,
        exceeded: false,
    });
    let wasi = WasiCtxBuilder::new()
        .arg("hdrw-wasi")?
        .stdin(Box::new(ReadPipe::from(request)))
        .stdout(Box::new(stdout.clone()))
        .inherit_stderr()
        .preopened_dir(Dir::open_ambient_dir(root, ambient_authority())?, "/scan")?
        .build();
    let mut store = Store::new(
        &engine,
        State {
            wasi,
            limits: crate::runtime::limits(),
        },
    );
    store.limiter(|state| &mut state.limits);
    let mut linker = Linker::<State>::new(&engine);
    wasmi_wasi::add_to_linker(&mut linker, |state| &mut state.wasi)?;
    let instance = linker.instantiate(&mut store, &module)?.start(&mut store)?;
    let result = instance
        .get_typed_func::<(), ()>(&store, "_start")?
        .call(&mut store, ());
    drop(store);
    let output = stdout
        .try_into_inner()
        .map_err(|_| anyhow::anyhow!("hdrw stdout pipe still in use"))?;
    ensure!(!output.exceeded, "hdrw stdout exceeds 16 MiB");
    if let Err(error) = result {
        ensure!(error.i32_exit_status() == Some(0), "hdrw WASI: {error}");
    }
    Ok(output.bytes)
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
