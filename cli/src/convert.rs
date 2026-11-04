//! Conversion orchestration. Pair policy, format parsers, conversion and output
//! validation are implemented by the same WASM engines used by the frontend.
use crate::workspace::Workspace;
use crate::{failure, ocr::Provider, request::Options, runtime::Runtime};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, atomic::AtomicU32},
};

pub fn capabilities(engine: &mut Runtime) -> Result<Value> {
    let wire = engine.run(
        &[
            "converter-text",
            "--operation",
            "conversion-capabilities",
            "--result",
            "/work/result.json",
        ]
        .map(String::from),
    )?;
    ensure!(
        wire["ok"] == true
            && wire["payload"]["pairs"]
                .as_array()
                .is_some_and(|p| !p.is_empty()),
        "WASM conversion capabilities unavailable; rebuild the core"
    );
    Ok(wire["payload"].clone())
}

pub fn execute(
    o: &Options,
    mut response: Value,
    mut engine: Runtime,
    bundle: &Path,
    work: &Workspace,
    pid: Arc<AtomicU32>,
) -> Result<(Value, i32)> {
    let capacity = capabilities(&mut engine)?;
    let r = &o.request;
    let pair =
        |p: &Value| p["sourceFormat"] == r.source_format && p["targetFormat"] == r.target_format;
    if !capacity["pairs"].as_array().unwrap().iter().any(pair) {
        failure(
            &mut response,
            "unsupported_format",
            format!(
                "unsupported conversion pair: {} -> {}; inspect supportedTargets or capacity --from {} --section conversionPairs",
                r.source_format, r.target_format, r.source_format
            ),
        );
        response["error"]["sourceFormat"] = json!(r.source_format);
        response["error"]["targetFormat"] = json!(r.target_format);
        let mut targets: Vec<_> = capacity["pairs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| {
                p["sourceFormat"] == r.source_format && p["targetFormat"] != r.source_format
            })
            .filter_map(|p| p["targetFormat"].as_str())
            .collect();
        targets.sort_unstable();
        targets.dedup();
        response["error"]["supportedTargets"] = json!(targets);
        response["error"]["reason"] = json!(
            "The installed WASM engines do not declare this conversion pair. No indirect route has been verified."
        );
        return Ok((response, 2));
    }
    let image = capacity["imagePairs"]
        .as_array()
        .is_some_and(|pairs| pairs.iter().any(pair));
    if image {
        let path = std::env::var_os("FILENS_IMAGE_WASM")
            .map(PathBuf::from)
            .unwrap_or_else(|| bundle.join("converter-image.wasm"));
        engine = Runtime::new(&path, work, bundle, Provider::new(bundle, false, pid))?;
    }
    work.load(
        format!("input.{}", r.source_format),
        Path::new(&r.input),
        256 << 20,
    )?;
    let options = if r.options.is_null() {
        json!({})
    } else {
        r.options.clone()
    };
    work.write("options.json", serde_json::to_vec(&options)?)?;
    let args = [
        if image {
            "converter-image"
        } else {
            "converter-text"
        },
        "--input",
        &format!("/work/input.{}", r.source_format),
        "--output",
        &format!("/work/converted.{}", r.target_format),
        "--source",
        &r.source_format,
        "--target",
        &r.target_format,
        "--options",
        "/work/options.json",
        "--result",
        "/work/result.json",
    ]
    .map(String::from);
    work.remove("result.json")?;
    let result = engine.run(&args)?;
    response["conversion"] = result.clone();
    if result["ok"] != true {
        let code = result["errorCode"].as_str().unwrap_or("conversion_failed");
        failure(
            &mut response,
            code,
            result["errorMessage"]
                .as_str()
                .unwrap_or("conversion failed"),
        );
        return Ok((response, if code == "unsupported_format" { 2 } else { 3 }));
    }
    let size = work.len(format!("converted.{}", r.target_format))?;
    ensure!(
        size > 0 && size <= 256 << 20,
        "WASM produced invalid or oversized conversion output"
    );
    response["output"] =
        json!({"path":std::path::absolute(&r.output)?,"format":r.target_format,"bytes":size});
    response["ok"] = json!(true);
    Ok((response, 0))
}

pub fn commit(
    work: &Workspace,
    target: &str,
    output: &Path,
    force: bool,
    canceled: impl Fn() -> bool,
) -> Result<()> {
    let parent = output.parent().unwrap();
    std::fs::create_dir_all(parent)?;
    let mut pending = tempfile::Builder::new()
        .prefix(".filens-output-")
        .tempfile_in(parent)?;
    use std::io::Write;
    pending.write_all(&work.read(format!("converted.{target}"))?)?;
    pending.as_file().sync_all()?;
    ensure!(!canceled(), "request canceled before output commit");
    // Commit only after the supervisor accepted the completed request. A
    // failed conversion or cancellation never replaces a destination file.
    if force {
        pending.persist(output)?;
    } else {
        pending.persist_noclobber(output)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canceled_commit_preserves_destination_and_cleans_staging_file() {
        let directory = tempfile::tempdir().unwrap();
        let work = Workspace::new();
        work.write("converted.docx", b"new output").unwrap();
        let destination = directory.path().join("existing.docx");
        std::fs::write(&destination, b"original output").unwrap();
        assert!(commit(&work, "docx", &destination, true, || true).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original output");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        assert!(commit(&work, "docx", &destination, false, || false).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original output");
    }
}
