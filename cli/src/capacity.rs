//! Capability projection only; format and conversion support come from WASM.
use crate::request::Request;
use anyhow::{Result, ensure};
use serde_json::{Value, json};

/// Directional catalog shorthand, not a conversion or an inferred route.
pub fn resolve_query(request: &mut Request) -> Result<()> {
    let Some((from, to)) = request.query.split_once('>') else {
        return Ok(());
    };
    let normalize = |value: &str| -> Result<String> {
        let value = value.trim().trim_start_matches('.').to_ascii_lowercase();
        ensure!(
            value == "?"
                || (!value.is_empty()
                    && value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_+-".contains(&b))),
            "capacity direction must be FROM>TO; use ? for either unknown format"
        );
        Ok(if value == "?" { String::new() } else { value })
    };
    let from = normalize(from)?;
    let to = normalize(to)?;
    for (current, parsed) in [
        (&mut request.source_format, from),
        (&mut request.target_format, to),
    ] {
        ensure!(
            current.is_empty() || parsed.is_empty() || *current == parsed,
            "capacity direction conflicts with --from/--to"
        );
        if !parsed.is_empty() {
            *current = parsed;
        }
    }
    request.query.clear();
    if !request.full
        && request.section.is_empty()
        && request.fields.is_empty()
        && request.for_operation.is_empty()
    {
        request.section = "conversionPairs".into();
    }
    Ok(())
}

fn searchable(value: &Value, output: &mut String) {
    match value {
        Value::String(text) => {
            output.push_str(text);
            output.push(' ');
        }
        Value::Array(values) => {
            for value in values {
                searchable(value, output);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if value == true {
                    output.push_str(key);
                    output.push(' ');
                } else if value != false {
                    searchable(value, output);
                }
            }
        }
        _ => (),
    }
}

pub fn view(mut metadata: Value, request: &Request) -> Result<Value> {
    // Resolve exact catalog terms across facets, so `pptx read` can express
    // the same condition as --from pptx --op read. Other words remain AND terms.
    let mut request = request.clone();
    let query = request.query.to_lowercase();
    let words: Vec<_> = query.split_whitespace().collect();
    let operations: Vec<_> = words
        .iter()
        .enumerate()
        .filter_map(|(index, word)| {
            let rows = metadata["operations"].as_array()?;
            let row = rows.iter().find(|v| v["name"] == *word).or_else(|| {
                rows.iter().find(|v| {
                    v["aliases"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|v| v == *word))
                })
            })?;
            Some((index, row["name"].as_str()?.to_owned()))
        })
        .collect();
    let formats: Vec<_> = words
        .iter()
        .enumerate()
        .filter_map(|(index, word)| {
            let format = word.trim_start_matches('.');
            metadata["formats"]
                .as_array()?
                .iter()
                .any(|v| v["format"] == format)
                .then(|| (index, format.to_owned()))
        })
        .collect();
    if let ([(op_index, operation)], [(format_index, format)]) =
        (operations.as_slice(), formats.as_slice())
    {
        if (request.for_operation.is_empty() || request.for_operation == *operation)
            && (request.source_format.is_empty() || request.source_format == *format)
        {
            request.for_operation = operation.clone();
            request.source_format = format.clone();
            request.query = words
                .iter()
                .enumerate()
                .filter(|(index, _)| index != op_index && index != format_index)
                .map(|(_, word)| *word)
                .collect::<Vec<_>>()
                .join(" ");
        }
    }
    if let Some(pairs) = metadata["conversionPairs"].as_array_mut() {
        pairs.retain(|p| p["sourceFormat"] != p["targetFormat"]);
    }
    let from = &request.source_format;
    let to = &request.target_format;
    let operation = &request.for_operation;
    if !operation.is_empty() {
        if let Some(operations) = metadata["operations"].as_array_mut() {
            let exact = operations.iter().any(|v| v["name"] == *operation);
            operations.retain(|v| {
                if exact {
                    v["name"] == *operation
                } else {
                    v["aliases"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|v| v == operation))
                }
            });
            ensure!(
                !operations.is_empty(),
                "unknown capability operation {operation:?}"
            );
        }
    }
    if !from.is_empty() || !to.is_empty() {
        if let Some(pairs) = metadata["conversionPairs"].as_array_mut() {
            pairs.retain(|p| {
                (from.is_empty() || p["sourceFormat"] == *from)
                    && (to.is_empty() || p["targetFormat"] == *to)
            });
        }
        let sources: Vec<_> = metadata["conversionPairs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| p["sourceFormat"].clone())
            .collect();
        if let Some(formats) = metadata["formats"].as_array_mut() {
            formats.retain(|v| {
                (from.is_empty() || v["format"] == *from)
                    && (to.is_empty() || sources.contains(&v["format"]))
            });
        }
    }
    let query = request.query.to_lowercase();
    let terms: Vec<_> = query.split_whitespace().collect();
    if !terms.is_empty() {
        for section in ["operations", "formats", "conversionPairs"] {
            if let Some(rows) = metadata[section].as_array_mut() {
                rows.retain(|row| {
                    let mut haystack = String::new();
                    searchable(row, &mut haystack);
                    let haystack = haystack.to_lowercase();
                    terms.iter().all(|term| haystack.contains(term))
                });
            }
        }
    }
    let sections = format!("{},{}", request.section, request.fields);
    let sections: Vec<_> = sections
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .collect();
    if !sections.is_empty() {
        let mut selected = serde_json::Map::new();
        for key in sections {
            ensure!(
                metadata.get(key).is_some(),
                "unknown capacity section {key:?}"
            );
            selected.insert(key.into(), metadata[key].clone());
        }
        return Ok(Value::Object(selected));
    }
    if request.full {
        return Ok(metadata);
    }
    let filtered = !from.is_empty() || !to.is_empty() || !terms.is_empty();
    if filtered || !operation.is_empty() {
        let mut result = json!({});
        if !operation.is_empty() || !terms.is_empty() {
            result["operations"] = metadata["operations"].clone();
        }
        if !from.is_empty() || !terms.is_empty() {
            result["formats"] = metadata["formats"].clone();
        }
        if filtered {
            result["conversionPairs"] = metadata["conversionPairs"].clone();
        }
        return Ok(result);
    }
    for op in metadata["operations"].as_array_mut().into_iter().flatten() {
        op.as_object_mut().unwrap().remove("description");
    }
    let result = json!({
        "description":metadata["description"], "profile":metadata["profile"],
        "operations":metadata["operations"], "execution":metadata["execution"],
        "ocr":metadata["ocr"], "outputFormats":metadata["outputFormats"],
        "formats":{"count":metadata["formats"].as_array().map_or(0,Vec::len)},
        "conversionPairs":{"count":metadata["conversionPairs"].as_array().map_or(0,Vec::len)},
        "details":"Filter: --op, --query (keywords or docx>?, ?>pdf), --from, --to. Select: --section/--fields. Details: --full. Empty filtered arrays mean no matches."
    });
    Ok(result)
}

/// Flat transport for human/agent consumption. Detailed JSON stays available.
pub fn rows(metadata: &Value) -> Vec<[String; 3]> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut rows = Vec::new();
    for (section, value) in metadata.as_object().into_iter().flatten() {
        match (section.as_str(), value.as_array()) {
            ("operations", Some(operations)) => {
                if operations.is_empty() {
                    rows.push([section.clone(), String::new(), "[]".into()]);
                }
                for op in operations {
                    let required = op["parameters"]["required"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::to_owned);
                    let optional = op["parameters"]["optional"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(|v| format!("{v}?"));
                    let args = required.chain(optional).collect::<Vec<_>>().join(",");
                    let aliases = op["aliases"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(",");
                    rows.push([
                        section.clone(),
                        op["name"].as_str().unwrap_or("").into(),
                        format!(
                            "({args}){}",
                            if aliases.is_empty() {
                                String::new()
                            } else {
                                format!(" aliases={aliases}")
                            }
                        ),
                    ]);
                }
            }
            ("conversionPairs", Some(pairs)) => {
                let mut grouped = BTreeMap::<&str, BTreeSet<&str>>::new();
                for pair in pairs {
                    if let (Some(a), Some(b)) =
                        (pair["sourceFormat"].as_str(), pair["targetFormat"].as_str())
                    {
                        grouped.entry(a).or_default().insert(b);
                    }
                }
                if grouped.is_empty() {
                    rows.push([section.clone(), String::new(), "[]".into()]);
                }
                for (source, targets) in grouped {
                    rows.push([
                        section.clone(),
                        source.into(),
                        targets.into_iter().collect::<Vec<_>>().join(","),
                    ]);
                }
            }
            ("formats", Some(formats)) => {
                if formats.is_empty() {
                    rows.push([section.clone(), String::new(), "[]".into()]);
                }
                for format in formats {
                    let flags = format
                        .as_object()
                        .into_iter()
                        .flatten()
                        .filter(|(key, v)| key.as_str() != "format" && **v != false && !v.is_null())
                        .map(|(k, v)| {
                            if *v == true {
                                k.clone()
                            } else {
                                format!("{k}={v}")
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    rows.push([
                        section.clone(),
                        format["format"].as_str().unwrap_or("").into(),
                        flags,
                    ]);
                }
            }
            _ => rows.push([
                section.clone(),
                String::new(),
                if let Some(s) = value.as_str() {
                    s.into()
                } else {
                    value.to_string()
                },
            ]),
        }
    }
    rows
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn same_format_pairs_are_omitted_before_counts_and_filtering() {
        let data = json!({"operations":[],"formats":[{"format":"docx"},{"format":"csv"}],"conversionPairs":[{"sourceFormat":"docx","targetFormat":"docx"},{"sourceFormat":"csv","targetFormat":"xlsx"}]});
        assert_eq!(
            view(data.clone(), &Request::default()).unwrap()["conversionPairs"]["count"],
            1
        );
        let mut r = Request {
            source_format: "docx".into(),
            section: "conversionPairs".into(),
            ..Default::default()
        };
        assert_eq!(
            view(data.clone(), &r).unwrap()["conversionPairs"],
            json!([])
        );
        r = Request {
            full: true,
            ..Default::default()
        };
        assert_eq!(
            view(data.clone(), &r).unwrap()["conversionPairs"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        r = Request {
            target_format: "pdf".into(),
            section: "formats,conversionPairs".into(),
            ..Default::default()
        };
        assert_eq!(
            view(data, &r).unwrap(),
            json!({"formats":[],"conversionPairs":[]})
        );
    }
    #[test]
    fn filters_pairs_before_projection_and_rejects_unknown_sections() {
        let data = json!({"formats":[{"format":"pptx"},{"format":"png"}],"conversionPairs":[{"sourceFormat":"pptx","targetFormat":"ppt"},{"sourceFormat":"png","targetFormat":"jpg"}]});
        let mut r = Request {
            source_format: "pptx".into(),
            section: "conversionPairs".into(),
            ..Default::default()
        };
        let result = view(data.clone(), &r).unwrap();
        assert_eq!(result["conversionPairs"].as_array().unwrap().len(), 1);
        assert!(result.get("formats").is_none());
        r.section = "missing".into();
        assert!(view(data, &r).is_err());
    }

    #[test]
    fn conditions_compose_and_keywords_do_not_match_false_flags() {
        let data = json!({"operations":[{"name":"read","aliases":["extract"],"description":"OCR text"},{"name":"convert","description":"convert images"}],"formats":[{"format":"pptx","ocr":true},{"format":"txt","ocr":false}],"conversionPairs":[{"sourceFormat":"pptx","targetFormat":"pptx"},{"sourceFormat":"png","targetFormat":"jpg"}]});
        let r = Request {
            query: "OcR".into(),
            ..Default::default()
        };
        let v = view(data.clone(), &r).unwrap();
        assert_eq!(v["formats"], json!([{"format":"pptx","ocr":true}]));
        assert_eq!(v["operations"].as_array().unwrap().len(), 1);
        assert_eq!(v["conversionPairs"], json!([]));
        let r = Request {
            for_operation: "extract".into(),
            ..Default::default()
        };
        let v = view(data.clone(), &r).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 1);
        assert_eq!(v["operations"][0]["name"], "read");
        let r = Request {
            source_format: "pptx".into(),
            target_format: "jpg".into(),
            ..Default::default()
        };
        let v = view(data.clone(), &r).unwrap();
        assert_eq!(v["conversionPairs"], json!([]));
        assert!(v.get("operations").is_none());
        let r = Request {
            query: "pptx jpg".into(),
            ..Default::default()
        };
        let v = view(data.clone(), &r).unwrap();
        assert_eq!(v["formats"], json!([]));
        assert_eq!(v["conversionPairs"], json!([]));
        let r = Request {
            for_operation: "missing".into(),
            ..Default::default()
        };
        assert!(view(data, &r).is_err());
    }

    #[test]
    fn table_groups_only_declared_pairs_and_marks_empty_results() {
        let data = json!({"conversionPairs":[{"sourceFormat":"pptx","targetFormat":"pptx"},{"sourceFormat":"pptx","targetFormat":"odp"},{"sourceFormat":"pptx","targetFormat":"odp"}]});
        assert_eq!(
            rows(&data),
            vec![[
                "conversionPairs".to_owned(),
                "pptx".to_owned(),
                "odp,pptx".to_owned()
            ]]
        );
        assert_eq!(
            rows(&json!({"operations":[]})),
            vec![["operations".to_owned(), "".to_owned(), "[]".to_owned()]]
        );
    }
}
