//! WASI plumbing and capability dispatch only; no document parsers live here.
use crate::workspace::{Mode, Workspace};
use crate::{ocr::Provider, pdf::Pdf};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use wasmi::{
    Caller, CompilationMode, Config, Engine, Linker, Module, Store, StoreLimits, StoreLimitsBuilder,
};
use wasmi_wasi::{WasiCtx, WasiCtxBuilder};
use zeroize::{Zeroize, Zeroizing};

pub struct State {
    pub wasi: WasiCtx,
    pub limits: StoreLimits,
    pub work: Workspace,
    scratch: Option<Workspace>,
    pub ocr: Provider,
    pub pdf: Option<Pdf>,
    pub pdf_path: PathBuf,
    sensitive: bool,
}
pub fn limits() -> StoreLimits {
    StoreLimitsBuilder::new()
        .memory_size(512 << 20)
        .memories(1)
        .instances(1)
        .build()
}

pub fn read_wasm(path: &Path) -> Result<Vec<u8>> {
    let compressed = path.with_extension("wasm.gz");
    // Accept explicit raw modules and compact npm resources. Decompress only
    // the module being used; PDFium stays lazy for non-PDF requests.
    if path.is_file() && path.extension().is_none_or(|e| e != "gz") {
        return Ok(std::fs::read(path)?);
    }
    let file = std::fs::File::open(if path.extension().is_some_and(|e| e == "gz") {
        path
    } else {
        &compressed
    })?;
    let mut bytes = vec![];
    flate2::read::GzDecoder::new(file)
        .take((64 << 20) + 1)
        .read_to_end(&mut bytes)?;
    ensure!(bytes.len() <= 64 << 20, "decompressed WASM exceeds limit");
    Ok(bytes)
}

impl State {
    fn path<'a>(&self, value: &'a Value) -> Result<(Workspace, &'a str)> {
        let path = value.as_str().unwrap_or("");
        let (mount, relative) = path
            .strip_prefix('/')
            .and_then(|p| p.split_once('/'))
            .ok_or_else(|| anyhow::anyhow!("capability path must be inside /work or /scratch"))?;
        let work = match mount {
            "work" => &self.work,
            "scratch" => self
                .scratch
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("memory scratch is not mounted"))?,
            _ => anyhow::bail!("capability path must be inside /work or /scratch"),
        };
        ensure!(
            !relative.is_empty()
                && relative != "."
                && relative != ".."
                && !relative.contains(['/', '\\', '\0']),
            "capability paths must be flat"
        );
        Ok((work.clone(), relative))
    }
    fn close_pdf(&mut self) -> Result<()> {
        if let Some(pdf) = &mut self.pdf {
            if pdf.protected() {
                self.pdf = None;
                self.ocr.discard_worker();
            } else if let Err(error) = pdf.close_document() {
                self.pdf = None;
                return Err(error);
            }
        }
        Ok(())
    }
    fn call(&mut self, request: Value) -> Result<Value> {
        let operation = request["operation"].as_str().unwrap_or("").to_owned();
        if operation == "pdf_close" {
            self.close_pdf()?;
            return Ok(json!({"ok":true}));
        }
        let (work, path) = if let Some(path) = request.get("path") {
            let (work, relative) = self.path(path)?;
            (work, Some(relative))
        } else {
            (self.work.clone(), None)
        };
        if operation == "ocr" {
            let bytes = Zeroizing::new(
                work.read(path.ok_or_else(|| anyhow::anyhow!("OCR path required"))?)?,
            );
            return self.ocr.call(request, &bytes);
        }
        ensure!(
            ["pdf_open", "pdf_text", "pdf_layout", "pdf_render"].contains(&operation.as_str()),
            "unknown extraction capability"
        );
        if operation == "pdf_open" {
            self.close_pdf()?;
            if self.pdf.is_none() {
                self.pdf = Some(Pdf::new(&self.pdf_path)?);
            }
        }
        let pdf = self
            .pdf
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("PDF is not open"))?;
        ensure!(
            operation != "pdf_render" || !pdf.protected() || work.mode() == Mode::Memory,
            "protected PDF rendering requires memory scratch"
        );
        let result = pdf.call(
            &operation,
            &work,
            path,
            request["page"].as_i64().unwrap_or(0) as i32,
            request["dpi"].as_i64().unwrap_or(0) as i32,
        );
        self.sensitive |= pdf.protected();
        if operation == "pdf_open" && result.is_err() {
            let _ = self.close_pdf();
        }
        result
    }
}

pub struct Runtime {
    engine: Option<Engine>,
    module: Option<Module>,
    wasm: PathBuf,
    mode: CompilationMode,
    native_search: bool,
    state: Option<State>,
}
impl Runtime {
    pub fn new(wasm: &Path, work: &Workspace, bundle: &Path, ocr: Provider) -> Result<Self> {
        Self::with_mode(
            wasm,
            work,
            bundle,
            ocr,
            CompilationMode::LazyTranslation,
            false,
            false,
        )
    }
    pub fn for_search(wasm: &Path, work: &Workspace, bundle: &Path, ocr: Provider) -> Result<Self> {
        // Bundled modules are already built and checked. Search validates and
        // translates function bodies only when called, avoiding unrelated codecs.
        Self::with_mode(wasm, work, bundle, ocr, CompilationMode::Lazy, false, false)
    }
    pub fn native_search(
        wasm: &Path,
        work: &Workspace,
        bundle: &Path,
        ocr: Provider,
    ) -> Result<Self> {
        Self::with_mode(wasm, work, bundle, ocr, CompilationMode::Lazy, true, true)
    }
    pub fn uses_native_search(&self) -> bool {
        self.native_search
    }
    pub fn loaded_modules(&self) -> usize {
        usize::from(self.module.is_some())
    }
    pub fn ensure_loaded(&mut self) -> Result<()> {
        if self.module.is_none() {
            let mut config = Config::default();
            config.compilation_mode(self.mode);
            let engine = Engine::new(&config);
            self.module = Some(Module::new(&engine, &read_wasm(&self.wasm)?[..])?);
            self.engine = Some(engine);
        }
        Ok(())
    }
    fn with_mode(
        wasm: &Path,
        work: &Workspace,
        bundle: &Path,
        ocr: Provider,
        mode: CompilationMode,
        defer: bool,
        native_search: bool,
    ) -> Result<Self> {
        let state = State {
            wasi: WasiCtxBuilder::new().build(),
            limits: limits(),
            work: work.clone(),
            scratch: None,
            ocr,
            pdf: None,
            sensitive: false,
            pdf_path: std::env::var_os("FILENS_PDFIUM_WASM")
                .map(PathBuf::from)
                .unwrap_or_else(|| bundle.join("pdfium.wasm")),
        };
        let mut runtime = Self {
            engine: None,
            module: None,
            wasm: wasm.into(),
            mode,
            native_search,
            state: Some(state),
        };
        if !defer {
            runtime.ensure_loaded()?;
        }
        Ok(runtime)
    }
    pub fn ocr_capacity(&mut self) -> Value {
        self.state.as_mut().unwrap().ocr.capacity()
    }
    pub fn fork_without_ocr(&self, work: &Workspace) -> Result<Self> {
        let parent = self.state.as_ref().unwrap();
        Ok(Self {
            engine: self.engine.clone(),
            module: self.module.clone(),
            wasm: self.wasm.clone(),
            mode: self.mode,
            native_search: self.native_search,
            state: Some(State {
                wasi: WasiCtxBuilder::new().build(),
                limits: limits(),
                work: work.clone(),
                scratch: None,
                ocr: parent.ocr.fork_disabled(),
                pdf: None,
                pdf_path: parent.pdf_path.clone(),
                sensitive: false,
            }),
        })
    }
    pub fn run(&mut self, args: &[String]) -> Result<Value> {
        self.run_with_directory(args, None)
    }
    pub fn run_with_directory(&mut self, args: &[String], input: Option<&Path>) -> Result<Value> {
        self.run_with_mounts(args, input, None)
    }
    pub fn run_with_conversion_options(
        &mut self,
        args: &[String],
        options: &Workspace,
    ) -> Result<Value> {
        self.run_with_mounts(args, None, Some(options))
    }
    fn run_with_mounts(
        &mut self,
        args: &[String],
        input: Option<&Path>,
        options: Option<&Workspace>,
    ) -> Result<Value> {
        self.ensure_loaded()?;
        let engine = self.engine.as_ref().unwrap();
        let work = self.state.as_ref().unwrap().work.clone();
        let scratch = work.memory_scratch();
        let mut builder = WasiCtxBuilder::new();
        builder.args(args)?.inherit_stderr();
        if let Some(root) = input {
            builder.preopened_dir(
                wasmi_wasi::Dir::open_ambient_dir(root, wasmi_wasi::ambient_authority())?,
                "/scan",
            )?;
        }
        let wasi = builder.build();
        wasi.push_preopened_dir(work.directory()?, "/work")?;
        wasi.push_preopened_dir(scratch.directory()?, "/scratch")?;
        if let Some(options) = options {
            wasi.push_preopened_dir(options.directory()?, "/convert-options")?;
        }
        let mut linker = Linker::<State>::new(engine);
        wasmi_wasi::add_to_linker(&mut linker, |s| &mut s.wasi)?;
        linker.func_wrap(
            "filens_text",
            "host_call",
            |mut caller: Caller<'_, State>, ptr: i32, len: i32, out: i32, cap: i32| -> i32 {
                let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) else {
                    return 0;
                };
                if !(0..=65536).contains(&len) || cap <= 0 {
                    return 0;
                }
                let mut data = vec![0; len as usize];
                if memory
                    .read(&caller, ptr as u32 as usize, &mut data)
                    .is_err()
                {
                    return 0;
                }
                let result = serde_json::from_slice(&data)
                    .map_err(anyhow::Error::from)
                    .and_then(|request| caller.data_mut().call(request))
                    .unwrap_or_else(|e| {
                        let code = if e.to_string().starts_with("password_required") {
                            "password_required"
                        } else if e.to_string().starts_with("parse_error") {
                            "parse_error"
                        } else {
                            "engine_unavailable"
                        };
                        json!({"error":e.to_string(),"errorCode":code})
                    });
                let Ok(bytes) = serde_json::to_vec(&result).map(Zeroizing::new) else {
                    return 0;
                };
                if bytes.len() > cap as usize
                    || memory
                        .write(&mut caller, out as u32 as usize, &bytes)
                        .is_err()
                {
                    return 0;
                }
                bytes.len() as i32
            },
        )?;
        let mut state = self.state.take().unwrap();
        state.wasi = wasi;
        state.scratch = Some(scratch.clone());
        let mut store = Store::new(engine, state);
        store.limiter(|s| &mut s.limits);
        let mut status = 0;
        let mut instance_memory = None;
        let result = (|| -> Result<()> {
            let instance = linker
                .instantiate(&mut store, self.module.as_ref().unwrap())?
                .start(&mut store)?;
            instance_memory = instance.get_memory(&store, "memory");
            let start = instance.get_typed_func::<(), ()>(&store, "_start")?;
            if let Err(e) = start.call(&mut store, ()) {
                match e.i32_exit_status() {
                    Some(code) => status = code,
                    None => return Err(e.into()),
                }
            }
            Ok(())
        })();
        if store.data().sensitive {
            if let Some(memory) = instance_memory {
                memory.data_mut(&mut store).zeroize();
            }
        }
        let mut state = store.into_data();
        // Old text modules do not close PDFs. A trap can also bypass guest
        // cleanup, so release the document and WASI file handles here.
        let _ = state.close_pdf();
        state.wasi = WasiCtxBuilder::new().build();
        state.scratch = None;
        state.sensitive = false;
        self.state = Some(state);
        result?;
        let result_work = if args
            .windows(2)
            .any(|p| p == ["--result", "/scratch/result.json"])
        {
            scratch
        } else {
            work
        };
        let result = Zeroizing::new(result_work.read_bounded("result.json", 128 << 20)?);
        let value: Value = serde_json::from_slice(&result)?;
        ensure!(
            status == 0 || value["ok"] != true,
            "WASM exited with {status} after reporting success"
        );
        Ok(value)
    }
}
