//! Embedding only: all document parsing and rendering stays in the frontend.
use anyhow::{Context, Result, ensure};
use base64::{engine::general_purpose::STANDARD, write::EncoderWriter};
use serde_json::json;
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
};

const TEMPLATE: &str = include_str!("../../../packages/preview/src/standalone.html");

pub(super) fn runtime(assets: &Path) -> Option<PathBuf> {
    let mut candidates = vec![
        assets.join("all-in-one/filens.js"),
        assets.join("filens-all-in-one.js"),
    ];
    if let Some(parent) = assets.parent() {
        candidates.push(parent.join("all-in-one/filens.js"));
    }
    // A directory explicitly named split is never a standalone runtime. Other
    // custom asset directories may contain a renamed all-in-one distribution.
    if assets.file_name().is_none_or(|name| name != "split") {
        candidates.push(assets.join("filens.js"));
    }
    candidates.into_iter().find(|path| {
        path.is_file()
            && path
                .parent()
                .is_some_and(|directory| directory.join("THIRD-PARTY-NOTICES.txt").is_file())
    })
}

pub(super) fn run(
    input: &Path,
    assets: &Path,
    output: Option<&Path>,
    open: bool,
    structured: bool,
) -> Result<i32> {
    let runtime = runtime(assets).ok_or_else(|| anyhow::anyhow!(
        "HTML preview needs all-in-one assets; run npm run build:preview, set --assets to the all-in-one directory, or use --mode serve with split assets"
    ))?;
    let mut file = match output {
        Some(path) => tempfile::NamedTempFile::new_in(
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or(Path::new(".")),
        )?,
        None => tempfile::Builder::new()
            .prefix("filens-preview-")
            .suffix(".html")
            .tempfile()?,
    };
    {
        let mut writer = BufWriter::new(file.as_file_mut());
        embed(&mut writer, input, &runtime)?;
        writer.flush()?;
    }
    let (_, path) = match output {
        Some(path) => {
            let kept = file.persist_noclobber(path).with_context(|| {
                format!(
                    "cannot save preview to {} (existing files are not overwritten)",
                    path.display()
                )
            })?;
            (kept, std::fs::canonicalize(path)?)
        }
        None => file.keep()?,
    };
    let url = file_url(&path);
    if structured {
        println!(
            "{}",
            json!({"ok":true,"operation":"preview","mode":"html","transport":"file",
            "url":url,"path":path,"temporary":output.is_none(),"containsSource":true,
            "source":{"name":input.file_name().unwrap().to_string_lossy()}})
        );
    } else {
        println!(
            "{url}\nOffline HTML preview (contains a copy of the file). Delete the HTML when no longer needed.\nCompatibility mode: filens preview FILE --mode serve"
        );
    }
    std::io::stdout().flush()?;
    if open && let Err(error) = super::open_browser(&url) {
        eprintln!(
            "Cannot launch the browser: {error}. Open the HTML manually, or use --mode serve."
        );
    }
    Ok(0)
}

fn embed(writer: &mut impl Write, input: &Path, runtime: &Path) -> Result<()> {
    let (prefix, rest) = TEMPLATE.split_once("<!--FILENS_SOURCE-->").unwrap();
    let (middle, suffix) = rest.split_once("<!--FILENS_RUNTIME-->").unwrap();
    let notices =
        std::fs::read_to_string(runtime.parent().unwrap().join("THIRD-PARTY-NOTICES.txt"))
            .context("preview assets are missing THIRD-PARTY-NOTICES.txt")?;
    let prefix = prefix.replace("<!--FILENS_NOTICES-->", &html_text(&notices));
    let name = serde_json::to_string(&input.file_name().unwrap().to_string_lossy())?
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026");
    // The source is streamed as base64; the CLI never parses its format.
    writer.write_all(prefix.as_bytes())?;
    write!(
        writer,
        "<script id=\"filens-source\" type=\"application/json\">{{\"name\":{name},\"data\":\""
    )?;
    {
        let mut encoder = EncoderWriter::new(&mut *writer, &STANDARD);
        std::io::copy(&mut File::open(input)?, &mut encoder)?;
        encoder.finish()?;
    }
    writer.write_all(b"\"}</script>")?;
    writer.write_all(middle.as_bytes())?;
    let code = std::fs::read_to_string(runtime)?;
    ensure!(!code.is_empty(), "preview runtime is empty");
    // An inert template preserves JS containing script end tags or HTML comment
    // tokens. Importing its decoded text from a blob avoids file: module CORS.
    let escaped = html_text(&code);
    writer.write_all(escaped.as_bytes())?;
    writer.write_all(suffix.as_bytes())?;
    Ok(())
}

fn html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn file_url(path: &Path) -> String {
    #[cfg(windows)]
    let bytes = {
        let path = path.to_string_lossy();
        let normalized = if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            format!("//{unc}")
        } else {
            path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
        }
        .replace('\\', "/");
        normalized.into_bytes()
    };
    #[cfg(not(windows))]
    let bytes = path.as_os_str().as_encoded_bytes();
    #[cfg(windows)]
    let mut url = String::from(if bytes.starts_with(b"//") {
        "file:"
    } else {
        "file:///"
    });
    #[cfg(not(windows))]
    let mut url = String::from("file://");
    for &byte in bytes.iter() {
        if byte.is_ascii_alphanumeric() || b"/-._~:".contains(&byte) {
            url.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(&mut url, "%{byte:02X}").unwrap();
        }
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn source_and_runtime_cannot_close_their_script_elements() {
        let work = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "x&name.txt"
        } else {
            "x<&\".txt"
        };
        let input = work.path().join(name);
        let runtime = work.path().join("filens.js");
        let bytes: Vec<u8> = (0..=255).cycle().take(100_001).collect();
        std::fs::write(&input, &bytes).unwrap();
        std::fs::write(
            &runtime,
            "export const text = '<!--<ScRiPt></ScRiPt><script>bad()</script>--> & value';",
        )
        .unwrap();
        std::fs::write(
            work.path().join("THIRD-PARTY-NOTICES.txt"),
            "License <script>not code</script> & notice",
        )
        .unwrap();
        let mut output = Vec::new();
        embed(&mut output, &input, &runtime).unwrap();
        let html = String::from_utf8(output).unwrap();
        let source = html
            .split_once("<script id=\"filens-source\" type=\"application/json\">")
            .unwrap()
            .1
            .split_once("</script>")
            .unwrap()
            .0;
        let source: serde_json::Value = serde_json::from_str(source).unwrap();
        assert_eq!(source["name"], name);
        assert_eq!(
            STANDARD.decode(source["data"].as_str().unwrap()).unwrap(),
            bytes
        );
        assert!(!html.contains("</ScRiPt>"));
        assert!(html.contains("&lt;!--&lt;ScRiPt&gt;&lt;/ScRiPt&gt;&lt;script&gt;bad()&lt;/script&gt;--&gt; &amp; value"));
        assert!(html.contains("License &lt;script&gt;not code&lt;/script&gt; &amp; notice"));
    }

    #[cfg(not(windows))]
    #[test]
    fn file_urls_escape_spaces_unicode_and_url_delimiters() {
        assert_eq!(
            file_url(Path::new("/tmp/中文 #?%.html")),
            "file:///tmp/%E4%B8%AD%E6%96%87%20%23%3F%25.html"
        );
    }

    #[cfg(windows)]
    #[test]
    fn file_urls_support_windows_drives_and_unc() {
        assert_eq!(
            file_url(Path::new(r"\\?\C:\Temp\a #.html")),
            "file:///C:/Temp/a%20%23.html"
        );
        assert_eq!(
            file_url(Path::new(r"\\?\UNC\server\share\a.html")),
            "file://server/share/a.html"
        );
    }
}
