//! Read-only WASI input plumbing. All format detection lives in the shared core.
use crate::{failure, request::Options, runtime::Runtime};
use anyhow::{Context, Result};
use serde_json::{Value, json};
use std::path::Path;

pub fn execute(o: &Options, mut response: Value, mut engine: Runtime) -> Result<(Value, i32)> {
    let input = std::fs::canonicalize(&o.request.input)?;
    let parent = input.parent().context("input parent directory required")?;
    let name = input.file_name().context("input filename required")?.to_str().context("input filename must be UTF-8")?;
    let extension = Path::new(&o.request.input).extension().unwrap_or_default().to_string_lossy().to_lowercase();
    // Avoid copying the entire file into the temporary workspace. The WASM
    // detector performs bounded seeks/reads, including for large sparse files.
    let args = ["converter-text", "--operation", "inspect-file", "--input", &format!("/scan/{name}"),
        "--source", &extension, "--result", "/work/result.json"].map(String::from);
    let result = engine.run_with_directory(&args, Some(parent))?;
    if result["ok"] == true {
        response["inspection"] = result["payload"].clone();
        response["ok"] = json!(true);
        Ok((response, 0))
    } else {
        failure(&mut response, result["errorCode"].as_str().unwrap_or("inspection_failed"),
            result["errorMessage"].as_str().unwrap_or("inspection failed"));
        Ok((response, 1))
    }
}
