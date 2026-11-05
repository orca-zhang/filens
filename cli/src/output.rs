//! Response serialization; document exports are rendered by converter-text.
use anyhow::Result;
use serde_json::Value;
use std::io::Write;

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn xml(value: &Value, out: &mut String) {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                out.push_str(&format!("<field name=\"{}\">", escape(key)));
                xml(value, out);
                out.push_str("</field>");
            }
        }
        Value::Array(values) => {
            for value in values {
                out.push_str("<item>");
                xml(value, out);
                out.push_str("</item>");
            }
        }
        Value::Null => (),
        Value::String(s) => out.push_str(&escape(s)),
        other => out.push_str(&other.to_string()),
    }
}
pub fn write(format: &str, response: &Value) -> Result<()> {
    let mut stdout = std::io::stdout().lock();
    match format {
        "json" => {
            serde_json::to_writer(&mut stdout, response)?;
            writeln!(stdout)?;
        }
        "yaml" => serde_yaml::to_writer(&mut stdout, response)?,
        "xml" => {
            let mut output = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<filens>");
            xml(response, &mut output);
            output.push_str("</filens>\n");
            stdout.write_all(output.as_bytes())?;
        }
        _ => {
            if let Some(path) = response["output"]["path"].as_str() {
                writeln!(stdout, "{path}")?;
            }
            if let Some(warnings) = response["conversion"]["warnings"].as_array() {
                for warning in warnings {
                    eprintln!("warning: {}", warning.as_str().unwrap_or(""));
                }
            }
            if let Some(capacity) = response.get("capacity").or_else(|| response.get("inspection")) {
                let title = if response.get("inspection").is_some() { "inspection" } else { "capabilities" };
                let data = serde_json::to_string_pretty(response)?;
                match format {
                    "html" => writeln!(
                        stdout,
                        "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>filens {title}</title></head><body><pre>{}</pre></body></html>",
                        escape(&data)
                    )?,
                    "markdown" => {
                        writeln!(stdout, "# filens {title}\n\n```json\n{data}\n```")?
                    }
                    "csv" | "tsv" => {
                        let sep = if format == "csv" { ',' } else { '\t' };
                        writeln!(stdout, "section{sep}key{sep}value")?;
                        for row in crate::capacity::rows(capacity) {
                            let cells: Vec<_> = row
                                .iter()
                                .map(|v| {
                                    if format == "csv" {
                                        format!("\"{}\"", v.replace('"', "\"\""))
                                    } else {
                                        v.replace('\\', "\\\\")
                                            .replace('\t', "\\t")
                                            .replace('\r', "\\r")
                                            .replace('\n', "\\n")
                                    }
                                })
                                .collect();
                            writeln!(stdout, "{}", cells.join(&sep.to_string()))?;
                        }
                    }
                    _ => {
                        let rows = crate::capacity::rows(capacity);
                        let pairs = rows
                            .iter()
                            .filter(|[section, key, _]| {
                                section == "conversionPairs" && !key.is_empty()
                            })
                            .map(|[_, key, value]| format!("{key}>{value}"))
                            .collect::<Vec<_>>()
                            .join(";");
                        let mut wrote_pairs = false;
                        for [section, key, value] in rows {
                            match section.as_str() {
                                "operations" if !key.is_empty() => {
                                    writeln!(stdout, "{key}{value}")?
                                }
                                "conversionPairs" if !key.is_empty() => {
                                    if !wrote_pairs {
                                        writeln!(stdout, "{pairs}")?;
                                        wrote_pairs = true;
                                    }
                                }
                                "formats" if !key.is_empty() => writeln!(stdout, "{key}: {value}")?,
                                _ => writeln!(stdout, "{section}={value}")?,
                            }
                        }
                    }
                }
            }
            if let Some(content) = response.get("content") {
                let key = if format == "text" { "text" } else { "rendered" };
                stdout.write_all(content[key].as_str().unwrap_or("").as_bytes())?;
                if let Some(warnings) = content["warnings"].as_array() {
                    for warning in warnings {
                        eprintln!("warning: {}", warning.as_str().unwrap_or(""));
                    }
                }
            }
            if let Some(error) = response.get("error") {
                eprintln!(
                    "{}: {}",
                    error["code"].as_str().unwrap_or("error"),
                    error["message"].as_str().unwrap_or("")
                );
            }
        }
    }
    stdout.flush()?;
    Ok(())
}
