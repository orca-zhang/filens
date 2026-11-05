use anyhow::{Result, bail, ensure};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{io::Read, time::Duration};

pub const FORMATS: [&str; 8] = [
    "text", "json", "markdown", "html", "yaml", "xml", "csv", "tsv",
];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub workspace: crate::workspace::Mode,
    pub intent: String,
    pub input: String,
    #[serde(rename = "op")]
    pub operation: String,
    pub format: String,
    pub max_bytes: i64,
    pub layout: bool,
    pub output: String,
    pub source_format: String,
    pub target_format: String,
    pub options: serde_json::Value,
    pub force: bool,
    pub query: String,
    pub summary_chars: Option<usize>,
    pub summary_ratio: Option<f64>,
    pub search_mode: String,
    pub max_results: Option<usize>,
    pub max_files: Option<usize>,
    pub max_depth: Option<usize>,
    pub include_hidden: bool,
    pub cache: Option<bool>,
    pub similarity_mode: String,
    pub threshold: Option<u32>,
    pub ocr: String,
    pub ocr_min_confidence: Option<f64>,
    pub slides: String,
    pub pages: String,
    pub media: Option<bool>,
    pub images: bool,
    pub max_images: Option<usize>,
    pub image_names: Vec<String>,
    pub full: bool,
    pub section: String,
    pub fields: String,
    #[serde(rename = "forOp")]
    pub for_operation: String,
}

#[derive(Clone)]
pub struct Options {
    pub request: Request,
    pub wasm: String,
    pub ocr: bool,
    pub timeout: Duration,
    pub help: bool,
    pub structured: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            request: Request::default(),
            wasm: String::new(),
            ocr: true,
            timeout: Duration::from_secs(120),
            help: false,
            structured: false,
        }
    }
}

fn re(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid request expression")
}
fn has(s: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| s.contains(term))
}
fn infer_output_format(options: &str, layout: bool) -> String {
    let output = re(
        r"(?i)(?:(?-u:\b)(?:as|in|output|return)\s+(?:plain\s+)?|(?:以|用|为|输出|返回)\s*)(json|yaml|yml|markdown|md|html|htm|csv|tsv|xml|text|txt)(?-u:\b)",
    );
    let suffix = re(
        r"(?i)(?-u:\b)(json|yaml|yml|markdown|md|html|csv|tsv|xml|text)\s*(?:format|output|格式|输出|返回)",
    );
    output
        .captures(options)
        .or_else(|| suffix.captures(options))
        .map(|c| c[1].to_owned())
        .unwrap_or_else(|| if layout { "json" } else { "text" }.into())
}
pub fn normalize(s: &str) -> String {
    match s.trim().to_lowercase().as_str() {
        "txt" | "plain" | "plain text" => "text".into(),
        "md" => "markdown".into(),
        "yml" => "yaml".into(),
        "htm" => "html".into(),
        other => other.into(),
    }
}

pub fn parse(o: &mut Options, args: &[String], stdin: impl Read) -> Result<()> {
    // Select the error serializer even when an invalid flag precedes --json.
    for (i, arg) in args
        .iter()
        .enumerate()
        .take_while(|(_, a)| a.as_str() != "--")
    {
        let format = if arg == "--json" {
            Some("json")
        } else if arg == "--format" {
            args.get(i + 1).map(String::as_str)
        } else {
            arg.strip_prefix("--format=")
        };
        if let Some(f) = format
            .map(normalize)
            .filter(|f| FORMATS.contains(&f.as_str()))
        {
            o.request.format = f;
        }
    }
    let mut positional = vec![];
    let mut explicit = None;
    let mut piped = false;
    let mut flags = true;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        i += 1;
        if flags && arg == "--" {
            flags = false;
            continue;
        }
        if !flags || !arg.starts_with('-') || arg == "-" {
            if flags && arg == "-" {
                piped = true;
            } else {
                positional.push(arg.clone());
            }
            continue;
        }
        let (name, inline) = arg
            .split_once('=')
            .map_or((arg.as_str(), None), |(k, v)| (k, Some(v)));
        match name {
            "--help" | "-h" => o.help = true,
            "--json" => {
                explicit = Some("json".to_owned());
                o.request.format = "json".into();
            }
            "--capacity" | "--capabilities" => o.request.operation = "capabilities".into(),
            "--no-ocr" => o.ocr = false,
            "--full" => o.request.full = true,
            "--no-media" => o.request.media = Some(false),
            "--images" => o.request.images = true,
            "--layout" => o.request.layout = true,
            "--force" => o.request.force = true,
            "--include-hidden" => o.request.include_hidden = true,
            "--no-cache" => o.request.cache = Some(false),
            "--workspace"
            | "--input"
            | "--format"
            | "--wasm"
            | "--max-bytes"
            | "--timeout"
            | "--output"
            | "-o"
            | "--source"
            | "--from"
            | "--target"
            | "--to"
            | "--password"
            | "--locale"
            | "--query"
            | "--summary-chars"
            | "--summary-ratio"
            | "--search-mode"
            | "--max-results"
            | "--max-files"
            | "--max-depth"
            | "--similarity-mode"
            | "--threshold"
            | "--ocr"
            | "--ocr-min-confidence"
            | "--slides"
            | "--pages"
            | "--max-images"
            | "--image"
            | "--section"
            | "--op"
            | "--fields" => {
                let value = match inline {
                    Some(v) => v,
                    None => {
                        let v = args
                            .get(i)
                            .ok_or_else(|| anyhow::anyhow!("{name} needs a value"))?;
                        i += 1;
                        v
                    }
                };
                match name {
                    "--input" => o.request.input = value.into(),
                    "--format" => {
                        explicit = Some(value.to_owned());
                        o.request.format = value.into();
                    }
                    "--wasm" => o.wasm = value.into(),
                    "--workspace" => o.request.workspace = value.parse()?,
                    "--max-bytes" => o.request.max_bytes = value.parse()?,
                    "--timeout" => o.timeout = duration(value)?,
                    "--output" | "-o" => o.request.output = value.into(),
                    "--source" | "--from" => o.request.source_format = value.into(),
                    "--target" | "--to" => o.request.target_format = value.into(),
                    "--query" => o.request.query = value.into(),
                    "--summary-chars" => o.request.summary_chars = Some(value.parse()?),
                    "--summary-ratio" => o.request.summary_ratio = Some(value.parse()?),
                    "--search-mode" => o.request.search_mode = value.into(),
                    "--max-results" => o.request.max_results = Some(value.parse()?),
                    "--max-files" => o.request.max_files = Some(value.parse()?),
                    "--max-depth" => o.request.max_depth = Some(value.parse()?),
                    "--similarity-mode" => o.request.similarity_mode = value.into(),
                    "--threshold" => o.request.threshold = Some(value.parse()?),
                    "--ocr" => o.request.ocr = value.into(),
                    "--ocr-min-confidence" => o.request.ocr_min_confidence = Some(value.parse()?),
                    "--slides" => o.request.slides = value.into(),
                    "--pages" => o.request.pages = value.into(),
                    "--max-images" => o.request.max_images = Some(value.parse()?),
                    "--image" => {
                        o.request.images = true;
                        o.request.image_names.push(value.into());
                    }
                    "--section" => o.request.section = value.into(),
                    "--op" => o.request.for_operation = value.into(),
                    "--fields" => o.request.fields = value.into(),
                    "--password" | "--locale" => {
                        if o.request.options.is_null() {
                            o.request.options = serde_json::json!({});
                        }
                        o.request.options[name.trim_start_matches('-')] = serde_json::json!(value);
                    }
                    _ => unreachable!(),
                }
            }
            _ => bail!("unknown option {name}; use --help or describe what to read"),
        }
    }
    if piped {
        ensure!(
            positional.is_empty() && o.request.input.is_empty(),
            "stdin request cannot be combined with another input or intent"
        );
        let mut data = String::new();
        stdin.take((1 << 20) + 1).read_to_string(&mut data)?;
        ensure!(data.len() <= 1 << 20, "request exceeds 1 MiB");
        if data.trim_start().starts_with('{') {
            o.structured = true;
            o.request.format = "json".into();
            // Merge fields onto CLI defaults, matching the existing protocol.
            let value: serde_json::Value = serde_json::from_str(&data)?;
            let mut merged = serde_json::to_value(&o.request)?;
            for (key, value) in value.as_object().unwrap() {
                merged[key] = value.clone();
            }
            o.request = serde_json::from_value(merged)?;
        } else {
            ensure!(!data.trim().is_empty(), "stdin request is empty");
            o.request.intent = data.trim().into();
        }
    } else if !positional.is_empty() {
        if positional
            .first()
            .is_some_and(|s| ["capacity", "capabilities"].contains(&s.as_str()))
        {
            o.request.operation = "capabilities".into();
            ensure!(positional.len() <= 2, "capacity accepts one query");
            if let Some(query) = positional.get(1) {
                ensure!(
                    o.request.query.is_empty(),
                    "multiple capacity queries found"
                );
                o.request.query = query.clone();
            }
        } else if positional.first().is_some_and(|s| s == "inspect") {
            o.request.operation = "inspect".into();
            ensure!(positional.len() <= 2, "inspect accepts one local file");
            if let Some(input) = positional.get(1) {
                set_input(&mut o.request, input)?;
            }
        } else if positional
            .first()
            .is_some_and(|s| ["similar", "duplicates", "similar-images"].contains(&s.as_str()))
        {
            o.request.operation = positional[0].clone();
            ensure!(positional.len() <= 2, "similar accepts one directory");
            if let Some(input) = positional.get(1) {
                set_input(&mut o.request, input)?;
            }
        } else if positional.first().is_some_and(|s| s == "search") {
            o.request.operation = "search".into();
            if let Some(input) = positional.get(1) {
                set_input(&mut o.request, input)?;
            }
            if positional.len() > 2 {
                ensure!(o.request.query.is_empty(), "multiple search queries found");
                o.request.query = positional[2..].join(" ");
            }
        } else if positional.len() == 2
            && positional.first().is_some_and(|s| {
                [
                    "read",
                    "extract",
                    "understand",
                    "layout",
                    "excerpt",
                    "summarize",
                    "prune",
                    "summary",
                    "summarise",
                ]
                .contains(&s.as_str())
            })
        {
            o.request.operation = positional[0].clone();
            set_input(&mut o.request, &positional[1])?;
        } else if positional.first().is_some_and(|s| s == "convert") {
            o.request.operation = "convert".into();
            ensure!(
                positional.len() <= 3,
                "convert accepts one input and one output path"
            );
            if let Some(input) = positional.get(1) {
                set_input(&mut o.request, input)?;
            }
            if let Some(output) = positional.get(2) {
                ensure!(
                    o.request.output.is_empty() || o.request.output == *output,
                    "multiple output paths found"
                );
                o.request.output = output.clone();
            }
        } else {
            o.request.intent = positional.join(" ");
            for arg in &positional {
                if std::fs::metadata(arg).is_ok_and(|m| m.is_file())
                    || arg.split_once("!/").is_some_and(|(outer, _)| {
                        std::fs::metadata(crate::text_catalog::unescape_archive_path(outer))
                            .is_ok_and(|m| m.is_file())
                    })
                {
                    set_input(&mut o.request, arg)?;
                }
            }
        }
    }
    if let Some(f) = explicit {
        o.request.format = f;
    }
    if o.help {
        return Ok(());
    }
    if !o.ocr {
        o.request.ocr = "never".into();
    }
    if o.request.ocr.is_empty() {
        o.request.ocr = "auto".into();
    }
    ensure!(
        ["auto", "never", "always"].contains(&o.request.ocr.as_str()),
        "ocr must be auto, never or always"
    );
    ensure!(
        o.request
            .ocr_min_confidence
            .is_none_or(|v| v.is_finite() && (0.0..=1.0).contains(&v)),
        "ocrMinConfidence must be between 0 and 1"
    );
    o.ocr &= o.request.ocr != "never";
    resolve(&mut o.request)?;
    ensure!(
        o.request.max_images.is_none_or(|n| (1..=16).contains(&n)),
        "maxImages must be between 1 and 16"
    );
    ensure!(
        o.request.image_names.len() <= 16
            && o.request
                .image_names
                .iter()
                .all(|s| !s.is_empty() && s.len() <= 4096 && !s.contains('\0')),
        "imageNames accepts at most 16 nonempty media names"
    );
    ensure!(
        o.request.images || (o.request.max_images.is_none() && o.request.image_names.is_empty()),
        "maxImages/imageNames require images=true"
    );
    ensure!(
        !o.request.images
            || matches!(
                o.request.operation.as_str(),
                "read" | "extract" | "understand" | "layout"
            ),
        "images requires read/understand/layout"
    );
    ensure!(!o.timeout.is_zero(), "timeout must be positive");
    ensure!(
        (0..=33554432).contains(&o.request.max_bytes),
        "maxBytes must be between 1 and 33554432, or 0 for the default"
    );
    Ok(())
}

fn duration(s: &str) -> Result<Duration> {
    // Accept Go duration syntax used by existing callers, including 1m30s.
    let parts = re(r"([0-9]+(?:\.[0-9]*)?|\.[0-9]+)(ns|us|µs|μs|ms|s|m|h)");
    let mut seconds = 0.0;
    let mut end = 0;
    for cap in parts.captures_iter(s) {
        ensure!(cap.get(0).unwrap().start() == end, "invalid timeout");
        end = cap.get(0).unwrap().end();
        seconds += cap[1].parse::<f64>()?
            * match &cap[2] {
                "h" => 3600.0,
                "m" => 60.0,
                "s" => 1.0,
                "ms" => 1e-3,
                "ns" => 1e-9,
                _ => 1e-6,
            };
    }
    ensure!(
        end == s.len() && end != 0 && seconds > 0.0 && seconds <= i64::MAX as f64 / 1e9,
        "invalid timeout; use e.g. 2m or 30s"
    );
    Duration::try_from_secs_f64(seconds).map_err(Into::into)
}

fn set_input(r: &mut Request, value: &str) -> Result<()> {
    ensure!(
        r.input.is_empty() || r.input == value,
        "one file per request; multiple input paths found"
    );
    r.input = value.into();
    Ok(())
}

fn resolve(r: &mut Request) -> Result<()> {
    let intent = r.intent.trim().to_lowercase();
    if r.operation == "capacity"
        || (r.operation.is_empty()
            && (r.full
                || !r.section.is_empty()
                || !r.fields.is_empty()
                || !r.for_operation.is_empty()
                || ["capacity", "capabilities"].contains(&intent.as_str())))
    {
        r.operation = "capabilities".into();
    }
    if r.operation == "capabilities" {
        ensure!(
            r.input.is_empty() && r.output.is_empty() && r.options.is_null() && !r.force,
            "capabilities does not accept input/output/conversion options"
        );
        if r.format.is_empty() {
            r.format = infer_output_format(&r.intent, false);
        }
        r.format = normalize(&r.format);
        ensure!(
            FORMATS.contains(&r.format.as_str()),
            "unsupported output format"
        );
        r.source_format = r.source_format.trim_start_matches('.').to_lowercase();
        r.target_format = r.target_format.trim_start_matches('.').to_lowercase();
        r.for_operation = r.for_operation.trim().to_lowercase();
        ensure!(
            r.query.len() <= 4096,
            "capacity query must be at most 4096 UTF-8 bytes"
        );
        crate::capacity::resolve_query(r)?;
        return Ok(());
    }
    ensure!(
        !r.full && r.section.is_empty() && r.fields.is_empty() && r.for_operation.is_empty(),
        "full/section/fields/op require capacity"
    );

    let search_words = re(
        r"(?i)^\s*(?:please\s+)?(?:search|find)(?-u:\b)|^\s*(?:请|帮我)?\s*(?:搜索|查找|检索)|^\s*在.*(?:搜索|查找|检索)",
    );
    let mut unquoted = re(r#"["'“‘][^"'”’]+["'”’]"#)
        .replace_all(&r.intent, "")
        .into_owned();
    if !r.input.is_empty() {
        unquoted = unquoted.replace(&r.input, "");
    }
    if ["similar", "duplicates", "similar-images"].contains(&r.operation.as_str())
        || (r.operation.is_empty() && re(r"(?i)重复文件|相同文件|相似图片|相近图片|\bduplicate\s+files\b|\bsimilar\s+images\b").is_match(&unquoted)) {
        return resolve_similarity(r);
    }
    ensure!(
        r.similarity_mode.is_empty() && r.threshold.is_none(),
        "similarity options require the similar operation"
    );
    if r.operation == "search" || (r.operation.is_empty() && search_words.is_match(&unquoted)) {
        return resolve_search(r);
    }
    ensure!(
        r.search_mode.is_empty()
            && r.max_results.is_none()
            && r.max_files.is_none()
            && r.max_depth.is_none()
            && !r.include_hidden
            && r.cache.is_none(),
        "search options require the search operation"
    );
    if r.operation == "convert" {
        ensure!(
            r.query.is_empty() && r.summary_chars.is_none() && r.summary_ratio.is_none(),
            "summary options require the summarize operation"
        );
        return resolve_conversion(r);
    }
    ensure!(
        r.output.is_empty()
            && r.source_format.is_empty()
            && r.target_format.is_empty()
            && !r.force
            && r.options.is_null(),
        "conversion options require the convert operation"
    );
    if r.operation == "inspect" {
        ensure!(!r.input.is_empty() && !r.input.contains("://"), "inspect requires one local file path");
        ensure!(r.intent.is_empty() && !r.layout && r.query.is_empty()
            && r.summary_chars.is_none() && r.summary_ratio.is_none()
            && r.ocr != "always" && r.ocr_min_confidence.is_none()
            && r.slides.is_empty() && r.pages.is_empty() && r.media.is_none()
            && !r.images && r.max_images.is_none() && r.image_names.is_empty()
            && r.max_bytes == 0, "inspect accepts a file and output format, not extraction or OCR options");
        if r.format.is_empty() { r.format = "text".into(); }
        r.format = normalize(&r.format);
        ensure!(FORMATS.contains(&r.format.as_str()), "unsupported output format");
        return Ok(());
    }
    let intent = r.intent.trim().to_owned();
    let lower = intent.to_lowercase();
    let quoted = re(r#"["'“‘]([^"'”’]+)["'”’]"#);
    // Remove a quoted focus phrase before resolving file paths. It is a lexical
    // query, never a second input file or a semantic question to a model.
    let focus = re(r#"(?i)(?:聚焦|关注|围绕|focus(?:ing)?\s+on|about)\s*["'“‘]([^"'”’]+)["'”’]"#);
    let mut path_intent = intent.clone();
    if let Some(cap) = focus.captures(&intent) {
        if r.query.is_empty() {
            r.query = cap[1].trim().into();
        }
        path_intent = path_intent.replace(&cap[0], "");
    }
    let mut options = quoted.replace_all(&path_intent, "").into_owned();
    if !r.input.is_empty() {
        options = options.replace(&r.input, "");
    }
    r.layout |= r.operation == "layout"
        || re(r"(?i)(?-u:\b)(?:layout|coordinates|bounding\s+boxes)(?-u:\b)|布局|版面|坐标")
            .is_match(&options);
    if r.format.is_empty() {
        r.format = infer_output_format(&options, r.layout);
    }
    r.format = normalize(&r.format);
    ensure!(
        FORMATS.contains(&r.format.as_str()),
        "unsupported output format {:?}; choose {}",
        r.format,
        FORMATS.join(", ")
    );
    ensure!(
        !(r.layout && r.format == "text"),
        "plain text cannot represent layout metadata; choose json, yaml, xml, markdown, html, csv or tsv"
    );
    if r.operation == "capacity" {
        r.operation = "capabilities".into();
    }
    if r.operation == "extract" {
        r.operation = "read".into();
    }
    if matches!(r.operation.as_str(), "prune" | "summary" | "summarise") {
        r.operation = "summarize".into();
    }
    let summary_intent = re(r"(?i)(?-u:\b)(?:summarize|summarise|summary|prune|key\s+points)(?-u:\b)|总结|摘要|关键内容|关键片段|提炼要点").is_match(&options);
    if r.operation.is_empty() {
        r.operation = if summary_intent {
            "summarize"
        } else if intent.is_empty()
            || lower == "capacity"
            || lower == "capabilities"
            || lower.starts_with("capacity ")
            || lower.starts_with("capabilities ")
            || has(
                &lower,
                &[
                    "你能做什么",
                    "有什么能力",
                    "支持哪些",
                    "what can you do",
                    "your capabilities",
                ],
            )
        {
            if r.input.is_empty() {
                "capabilities"
            } else {
                "read"
            }
        } else if has(&lower, &["understand", "理解", "检查文档"]) {
            "understand"
        } else if r.layout {
            "layout"
        } else {
            "read"
        }
        .into();
    }
    ensure!(
        [
            "read",
            "understand",
            "capabilities",
            "layout",
            "summarize",
            "excerpt"
        ]
        .contains(&r.operation.as_str()),
        "unsupported operation {:?}",
        r.operation
    );
    if matches!(r.operation.as_str(), "summarize" | "excerpt") {
        if r.query.is_empty() {
            let unquoted_focus =
                re(r"(?i)(?:聚焦|关注|围绕|focus(?:ing)?\s+on)\s*([^，,。；;\n]+)");
            if let Some(cap) = unquoted_focus.captures(&options) {
                r.query = re(r"(?i)\s+(?:as|in|output|return|keep|retain|at\s+most|max)\b.*$|(?:以|用|输出|返回|保留|最多|不超过|限制).*$")
                    .replace(&cap[1], "")
                    .trim()
                    .trim_end_matches(['？', '?'])
                    .into();
            }
        }
        if r.summary_ratio.is_none() {
            if let Some(cap) =
                re(r"(?i)(?:保留|retain|keep)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*[%％]").captures(&options)
            {
                r.summary_ratio = Some(cap[1].parse::<f64>()? / 100.0);
            }
        }
        if r.summary_chars.is_none() {
            if let Some(cap) = re(
                r"(?i)(?:不超过|最多|限制|at most|max)\s*([0-9]+)\s*(?:字|字符|characters|chars)",
            )
            .captures(&options)
            {
                r.summary_chars = Some(cap[1].parse()?);
            }
        }
        ensure!(
            r.query.len() <= 4096,
            "query must be at most 4096 UTF-8 bytes"
        );
        ensure!(
            r.summary_chars.is_none_or(|n| (1..=20000).contains(&n)),
            "summaryChars must be between 1 and 20000"
        );
        ensure!(
            r.summary_ratio
                .is_none_or(|n| n.is_finite() && n > 0.0 && n <= 1.0),
            "summaryRatio must be >0 and <=1"
        );
    } else {
        ensure!(
            r.query.is_empty() && r.summary_chars.is_none() && r.summary_ratio.is_none(),
            "summary options require the summarize operation"
        );
    }
    if r.operation == "capabilities" {
        ensure!(
            r.input.is_empty(),
            "capabilities does not accept an input file"
        );
        return Ok(());
    }
    let mut search = if r.input.is_empty() {
        path_intent.clone()
    } else {
        path_intent.replace(&r.input, "")
    };
    for cap in quoted.captures_iter(&search.clone()) {
        set_input(r, &cap[1])?;
        search = search.replace(&cap[0], "");
    }
    for found in re(r#"[^\s"'“”‘’，。；：！？,;?<>]+\.[a-zA-Z0-9]{1,12}"#).find_iter(&search)
    {
        let mut path = found.as_str();
        for prefix in ["读取", "提取", "理解", "读一下", "总结", "摘要", "读"] {
            path = path.strip_prefix(prefix).unwrap_or(path);
        }
        set_input(r, path)?;
    }
    ensure!(
        !r.input.is_empty(),
        "name the local file to read, for example: filens read report.pdf --json"
    );
    ensure!(!r.input.contains("://"), "input must be a local file path");
    ensure!(
        !has(
            &lower.replace(&r.input.to_lowercase(), ""),
            &[
                "问答",
                "翻译",
                "translate",
                "回答",
                "how many",
                "多少",
                "为什么",
                "why "
            ]
        ),
        "semantic reasoning belongs to the calling agent; request read/understand, then use the returned text and evidence blocks to answer"
    );
    Ok(())
}

fn resolve_similarity(r: &mut Request) -> Result<()> {
    ensure!(
        r.query.is_empty()
            && r.summary_chars.is_none()
            && r.summary_ratio.is_none()
            && r.output.is_empty()
            && r.source_format.is_empty()
            && r.target_format.is_empty()
            && r.options.is_null()
            && !r.force
            && !r.layout
            && r.search_mode.is_empty()
            && r.cache.is_none(),
        "similar does not accept query, summary, conversion, layout or search-cache options"
    );
    let quoted = re(r#"["'“‘]([^"'”’]+)["'”’]"#);
    let paths: Vec<_> = quoted
        .captures_iter(&r.intent)
        .map(|c| c[1].to_owned())
        .collect();
    for path in paths {
        set_input(r, &path)?;
    }
    let options = quoted.replace_all(&r.intent, "");
    let inferred = if r.operation == "duplicates"
        || re(r"(?i)重复文件|相同文件|\bduplicate\s+files\b").is_match(&options)
    {
        "duplicates"
    } else {
        "images"
    };
    ensure!(
        r.operation != "duplicates"
            || r.similarity_mode.is_empty()
            || r.similarity_mode == "duplicates",
        "duplicates requires similarityMode=duplicates"
    );
    ensure!(
        r.operation != "similar-images"
            || r.similarity_mode.is_empty()
            || r.similarity_mode == "images",
        "similar-images requires similarityMode=images"
    );
    if r.similarity_mode.is_empty() {
        r.similarity_mode = inferred.into();
    }
    r.operation = "similar".into();
    ensure!(
        ["duplicates", "images"].contains(&r.similarity_mode.as_str()),
        "similarityMode must be duplicates or images"
    );
    ensure!(
        r.threshold.is_none_or(|n| n <= 24),
        "threshold must be between 0 and 24 (default 8)"
    );
    ensure!(
        r.similarity_mode == "images" || r.threshold.is_none(),
        "threshold applies only to similar images"
    );
    if r.format.is_empty() {
        r.format = re(r"(?i)(?:\b(?:as|in|output|return)\s+|(?:以|用|输出|返回)\s*)(json|yaml|yml|markdown|md|html|csv|tsv|xml|text|txt)\b")
            .captures(&options).map_or_else(|| "text".into(), |c| c[1].to_owned());
    }
    r.format = normalize(&r.format);
    ensure!(
        FORMATS.contains(&r.format.as_str()),
        "unsupported output format"
    );
    ensure!(
        !r.input.is_empty() && !r.input.contains("://"),
        "similar requires a local directory; quote the path or use --input"
    );
    ensure!(
        (1..=1000).contains(&r.max_results.unwrap_or(100)),
        "maxResults must be between 1 and 1000"
    );
    ensure!(
        (1..=20000).contains(&r.max_files.unwrap_or(2000)),
        "maxFiles must be between 1 and 20000"
    );
    ensure!(
        (1..=256).contains(&r.max_depth.unwrap_or(32)),
        "maxDepth must be between 1 and 256"
    );
    Ok(())
}

fn resolve_search(r: &mut Request) -> Result<()> {
    r.operation = "search".into();
    ensure!(
        r.summary_chars.is_none()
            && r.summary_ratio.is_none()
            && r.output.is_empty()
            && r.source_format.is_empty()
            && r.target_format.is_empty()
            && r.options.is_null()
            && !r.force,
        "search does not accept summary or conversion options"
    );
    ensure!(
        r.cache != Some(true),
        "search uses request-local memory only; persistent cache is unavailable (omit cache or use cache:false)"
    );
    let quoted = re(r#"["'“‘]([^"'”’]+)["'”’]"#);
    let values: Vec<_> = quoted
        .captures_iter(&r.intent)
        .map(|c| c[1].to_owned())
        .collect();
    ensure!(
        values.len() <= 2,
        "search accepts one directory or archive and one query; quote them separately"
    );
    if let Some(input) = values.first() {
        set_input(r, input)?;
    }
    if let Some(query) = values.get(1) {
        ensure!(
            r.query.is_empty() || r.query == *query,
            "multiple search queries found"
        );
        r.query = query.clone();
    }
    let options = quoted.replace_all(&r.intent, "");
    if r.format.is_empty() {
        r.format = re(r"(?i)(?:\b(?:as|in|output|return)\s+|(?:以|用|输出|返回)\s*)(json|yaml|yml|markdown|md|html|csv|tsv|xml|text|txt)\b")
            .captures(&options).map_or_else(|| if r.layout {"json"} else {"text"}.into(),|c|c[1].to_owned());
    }
    r.format = normalize(&r.format);
    ensure!(
        FORMATS.contains(&r.format.as_str()),
        "unsupported output format"
    );
    ensure!(
        !r.input.is_empty() && !r.input.contains("://"),
        "search requires a local directory or archive; quote the path and query, or use --input and --query"
    );
    ensure!(
        !r.query.trim().is_empty() && r.query.len() <= 4096,
        "search query must contain 1–4096 UTF-8 bytes"
    );
    if r.search_mode.is_empty() {
        r.search_mode = "bm25".into();
    }
    ensure!(
        ["bm25", "exact", "files"].contains(&r.search_mode.as_str()),
        "searchMode must be bm25, exact or files; embedding retrieval is not installed"
    );
    ensure!(
        (1..=100).contains(&r.max_results.unwrap_or(10)),
        "maxResults must be between 1 and 100"
    );
    ensure!(
        (1..=20000).contains(&r.max_files.unwrap_or(2000)),
        "maxFiles must be between 1 and 20000"
    );
    ensure!(
        (1..=256).contains(&r.max_depth.unwrap_or(32)),
        "maxDepth must be between 1 and 256"
    );
    Ok(())
}

fn resolve_conversion(r: &mut Request) -> Result<()> {
    if r.format.is_empty() {
        r.format = "json".into();
    }
    r.format = normalize(&r.format);
    ensure!(
        ["text", "json", "yaml", "xml"].contains(&r.format.as_str()),
        "conversion responses support text, json, yaml or xml; use --to for the file format"
    );
    ensure!(
        !r.layout,
        "convert does not accept --layout; inspect the output with filens layout"
    );
    ensure!(
        !r.input.is_empty() && !r.input.contains("://"),
        "convert requires one local input file"
    );
    ensure!(
        r.options.is_null() || r.options.is_object(),
        "conversion options must be a JSON object"
    );
    fn extension(path: &str) -> String {
        std::path::Path::new(path)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    }
    if r.source_format.is_empty() {
        r.source_format = extension(&r.input);
    }
    if r.target_format.is_empty() {
        r.target_format = extension(&r.output);
    }
    for format in [&mut r.source_format, &mut r.target_format] {
        *format = format.trim().trim_start_matches('.').to_ascii_lowercase();
        if *format == "jpeg" {
            *format = "jpg".into();
        }
        ensure!(
            !format.is_empty()
                && format.len() <= 12
                && format.bytes().all(|b| b.is_ascii_alphanumeric()),
            "source and target formats must be file extensions"
        );
    }
    if r.output.is_empty() {
        r.output = std::path::Path::new(&r.input)
            .with_extension(&r.target_format)
            .to_string_lossy()
            .into();
    }
    ensure!(
        r.output != "-" && !r.output.contains("://"),
        "convert output must be a local file path"
    );
    let input = std::path::absolute(&r.input)?;
    let output = std::path::absolute(&r.output)?;
    ensure!(
        input != output,
        "conversion output must differ from the input file"
    );
    if let (Ok(a), Ok(b)) = (
        std::fs::canonicalize(&input),
        std::fs::canonicalize(&output),
    ) {
        ensure!(a != b, "conversion output must differ from the input file");
    }
    ensure!(
        r.force || std::fs::symlink_metadata(&output).is_err(),
        "output already exists; choose another path or pass --force"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_arguments_are_bounded_and_read_scoped() {
        let r = options(
            &[
                "read",
                "deck.pptx",
                "--images",
                "--max-images",
                "2",
                "--image",
                "ppt/media/a.png",
            ],
            "",
        )
        .unwrap()
        .request;
        assert!(r.images);
        assert_eq!(r.max_images, Some(2));
        assert_eq!(r.image_names, vec!["ppt/media/a.png"]);
        for args in [
            vec!["read", "deck.pptx", "--images", "--max-images", "0"],
            vec!["read", "deck.pptx", "--max-images", "2"],
            vec!["capacity", "--images"],
            vec!["excerpt", "deck.pptx", "--images"],
        ] {
            assert!(options(&args, "").is_err());
        }
    }
    #[test]
    fn capability_conditions_are_scoped_and_match_json_requests() {
        let r = options(
            &[
                "capacity", "--op", "READ", "--query", "ocr", "--from", "PPTX", "--to", "PDF",
            ],
            "",
        )
        .unwrap()
        .request;
        assert_eq!(
            (
                r.operation.as_str(),
                r.for_operation.as_str(),
                r.query.as_str(),
                r.source_format.as_str(),
                r.target_format.as_str(),
                r.format.as_str()
            ),
            ("capabilities", "read", "ocr", "pptx", "pdf", "text")
        );
        let r = options(
            &["-"],
            r#"{"op":"capacity","forOp":"read","query":"ocr","sourceFormat":"pptx"}"#,
        )
        .unwrap()
        .request;
        assert_eq!(r.for_operation, "read");
        assert_eq!(r.query, "ocr");
        assert_eq!(r.format, "json");
        assert!(options(&["read", "report.pdf", "--op", "read"], "").is_err());
        assert!(options(&["capacity", "--query", &"x".repeat(4097)], "").is_err());
    }
    #[test]
    fn capability_directions_match_positional_flag_and_json() {
        for (args, stdin) in [
            (vec!["capacity", " .DOCX > ? "], ""),
            (vec!["capabilities", "--query", "docx>?"], ""),
            (vec!["-"], r#"{"op":"capacity","query":"docx>?"}"#),
        ] {
            let r = options(&args, stdin).unwrap().request;
            assert_eq!(r.source_format, "docx");
            assert!(r.target_format.is_empty() && r.query.is_empty());
            assert_eq!(r.section, "conversionPairs");
        }
        let r = options(&["capacity", "?>PDF"], "").unwrap().request;
        assert!(r.source_format.is_empty());
        assert_eq!(r.target_format, "pdf");
        let r = options(&["capacity", "?>?", "--section", "formats"], "")
            .unwrap()
            .request;
        assert_eq!(r.section, "formats");
        assert!(options(&["capacity", "docx>pdf", "--from", "pptx"], "").is_err());
        for query in ["docx>", ">pdf", "docx>pdf>png", "docx>pdf ocr"] {
            assert!(options(&["capacity", query], "").is_err(), "{query}");
        }
    }
    #[test]
    fn search_intents_and_boundaries() {
        let request = options(&["在 \"./文档\" 中搜索 \"预算 风险\"，以 JSON 输出"], "")
            .unwrap()
            .request;
        assert_eq!(
            (
                request.operation.as_str(),
                request.input.as_str(),
                request.query.as_str(),
                request.format.as_str()
            ),
            ("search", "./文档", "预算 风险", "json")
        );
        let request = options(
            &["search", "./documents", "--query", "budget risk", "--json"],
            "",
        )
        .unwrap()
        .request;
        assert_eq!(request.query, "budget risk");
        assert!(
            options(
                &[
                    "search",
                    "docs",
                    "--query",
                    "x",
                    "--search-mode",
                    "semantic"
                ],
                ""
            )
            .is_err()
        );
        assert!(
            options(
                &["search", "docs", "--query", "x", "--max-results", "0"],
                ""
            )
            .is_err()
        );
        let mut request = Request {
            input: "/tmp/search files/budget.txt".into(),
            intent: "read /tmp/search files/budget.txt".into(),
            ..Default::default()
        };
        resolve(&mut request).unwrap();
        assert_eq!(request.operation, "read");
    }
    fn options(args: &[&str], stdin: &str) -> Result<Options> {
        let mut o = Options::default();
        parse(
            &mut o,
            &args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            stdin.as_bytes(),
        )?;
        Ok(o)
    }
    #[test]
    fn workspace_modes_are_explicit_and_validated_for_flags_and_json() {
        use crate::workspace::Mode;
        assert_eq!(
            options(&["capacity"], "").unwrap().request.workspace,
            Mode::Memory
        );
        assert_eq!(
            options(&["capacity", "--workspace", "disk"], "")
                .unwrap()
                .request
                .workspace,
            Mode::Disk
        );
        assert_eq!(
            options(&["capacity", "--workspace=memory"], "")
                .unwrap()
                .request
                .workspace,
            Mode::Memory
        );
        assert_eq!(
            options(&["-"], r#"{"op":"capabilities","workspace":"disk"}"#)
                .unwrap()
                .request
                .workspace,
            Mode::Disk
        );
        assert!(options(&["capacity", "--workspace", "auto"], "").is_err());
        assert!(options(&["capacity", "--workspace"], "").is_err());
        assert!(options(&["-"], r#"{"op":"capabilities","workspace":"auto"}"#).is_err());
    }
    #[test]
    fn requests_and_errors() {
        let o = options(&["理解 “meeting notes.docx”，以 JSON 输出"], "").unwrap();
        assert_eq!(
            (
                o.request.operation.as_str(),
                o.request.input.as_str(),
                o.request.format.as_str()
            ),
            ("understand", "meeting notes.docx", "json")
        );
        assert_eq!(
            options(&["-"], r#"{"input":"report.pdf","layout":true}"#)
                .unwrap()
                .request
                .format,
            "json"
        );
        assert!(options(&["-"], r#"{"input":"x.txt","typo":true}"#).is_err());
        assert!(options(&["-"], "{} {}").is_err());
        assert!(options(&["read a.pdf b.docx"], "").is_err());
        assert_eq!(
            options(&["summarize report.pdf"], "")
                .unwrap()
                .request
                .operation,
            "summarize"
        );
        assert!(options(&["layout", "report.pdf", "--format", "text"], "").is_err());
        assert!(options(&["--max-bytes=-1", "x.txt"], "").is_err());
        assert_eq!(duration("1m30.5s").unwrap(), Duration::from_millis(90500));
        assert!(duration("999999999999999h").is_err());
    }
    #[test]
    fn extractive_summary_intents_and_budgets() {
        let r=options(&["提取 \"meeting notes.docx\" 的关键内容，关注预算和风险，保留30%，最多500字，以 JSON 输出"],"").unwrap().request;
        assert_eq!(r.operation, "summarize");
        assert_eq!(r.input, "meeting notes.docx");
        assert_eq!(r.query, "预算和风险");
        assert_eq!(r.summary_ratio, Some(0.3));
        assert_eq!(r.summary_chars, Some(500));
        let r = options(
            &["summarize 'report.pdf' focusing on 'budget risk' as json"],
            "",
        )
        .unwrap()
        .request;
        assert_eq!(r.query, "budget risk");
        assert_eq!(r.input, "report.pdf");
        assert!(options(&["summarize", "report.pdf", "--summary-ratio", "2"], "").is_err());
        assert!(options(&["summarize", "report.pdf", "--summary-ratio", "NaN"], "").is_err());
        assert!(options(&["read", "report.pdf", "--query", "risk"], "").is_err());
        assert!(options(&["总结 'report.pdf' 并翻译成英文"], "").is_err());
        assert_eq!(
            options(&["read '总结报告.txt'"], "")
                .unwrap()
                .request
                .operation,
            "read"
        );
    }
    #[test]
    fn archive_member_paths_are_single_inputs() {
        let path = "资料.zip!/附件.tar.gz!/meeting notes.docx";
        assert_eq!(
            options(&["read", path, "--layout", "--json"], "")
                .unwrap()
                .request
                .input,
            path
        );
        assert_eq!(
            options(&["summarize", path, "--query", "预算"], "")
                .unwrap()
                .request
                .operation,
            "summarize"
        );
        assert_eq!(
            options(
                &["读取 \"资料.zip!/附件.tar.gz!/meeting notes.docx\"，以 JSON 输出"],
                ""
            )
            .unwrap()
            .request
            .input,
            path
        );
        assert_eq!(
            options(&["read bundle.zip!/inner.zip!/note.txt as json"], "")
                .unwrap()
                .request
                .input,
            "bundle.zip!/inner.zip!/note.txt"
        );
    }
    #[test]
    fn conversion_request_and_path_validation() {
        let o = options(
            &[
                "convert",
                "/source/report.rtf",
                "--to",
                "docx",
                "--locale",
                "zh-CN",
            ],
            "",
        )
        .unwrap();
        assert_eq!(o.request.output, "/source/report.docx");
        assert_eq!(o.request.options["locale"], "zh-CN");
        assert_eq!(o.request.format, "json");
        assert!(options(&["convert", "input.doc", "--to", "../docx"], "").is_err());
        assert!(options(&["convert", "input.doc", "input.doc", "--force"], "").is_err());
        assert!(options(&["read", "input.doc", "--to", "docx"], "").is_err());
    }
}
