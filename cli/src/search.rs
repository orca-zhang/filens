//! Search orchestration only; no persistent index, cache or source hashing. Extraction, chunks, ranking and exports use WASM.
use crate::workspace::Workspace;
use crate::{request::Options, runtime::Runtime, walk};
use anyhow::{Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path},
};

const TEXT_BUDGET: usize = 32 << 20;
const WAVE_SOURCE_BYTES: usize = 4 << 20;

#[derive(Default)]
struct Extracted {
    content: HashMap<usize, Value>,
    errors: Vec<(usize, String)>,
    truncated: bool,
    batches: usize,
    native_files: usize,
    text_bytes: usize,
}
impl Extracted {
    fn merge(&mut self, other: Self) {
        self.content.extend(other.content);
        self.errors.extend(other.errors);
        self.truncated |= other.truncated;
        self.batches += other.batches;
        self.native_files += other.native_files;
        self.bound_text(TEXT_BUDGET);
    }
    fn insert(&mut self, id: usize, outcome: Value) {
        self.text_bytes += outcome_bytes(&outcome);
        self.content.insert(id, outcome);
    }
    fn bound_text(&mut self, limit: usize) {
        let mut ids: Vec<_> = self.content.keys().copied().collect();
        ids.sort_unstable();
        let mut bytes = 0;
        for id in ids {
            bytes += outcome_bytes(&self.content[&id]);
            if bytes > limit {
                // Keep the crossing outcome: an archive can still contribute a
                // prefix of its members when the ordered corpus is assembled.
                self.content.retain(|&key, _| key <= id);
                self.truncated = true;
                break;
            }
        }
        self.text_bytes = bytes;
    }
}

fn outcome_bytes(outcome: &Value) -> usize {
    if let Some(members) = outcome["archive"]["files"].as_array() {
        members.iter().map(|item| item["content"]["text"].as_str().map_or(0, str::len)).sum()
    } else {
        outcome["content"]["text"].as_str().map_or(0, str::len)
    }
}

fn wave_end(entries: &[walk::Entry], start: usize, max_files: usize, source_bytes: usize) -> usize {
    let mut end = start;
    let mut bytes = 0u64;
    while end < entries.len() && end - start < max_files {
        let next = bytes.saturating_add(entries[end].bytes);
        if end > start && next > source_bytes as u64 {
            break;
        }
        bytes = next;
        end += 1;
    }
    end
}

fn batches(
    engine: &mut Runtime,
    work: &Workspace,
    root: &Path,
    entries: &[walk::Entry],
    ids: &[usize],
    ocr_formats: &HashSet<String>,
    options: &Value,
    text_budget: usize,
) -> Result<Extracted> {
    let mut result = Extracted::default();
    for ids in ids.chunks(256) {
        let mut inputs = Vec::new();
        for &id in ids {
            let relative = Path::new(&entries[id].path);
            let extension = relative
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if engine.uses_native_search()
                && options["includeLayout"] != true
                && crate::native_search::supports_plain(&extension)
            {
                result.native_files += 1;
                let mut outcome = Value::Null;
                outcome["content"] = crate::native_search::extract_plain(
                    &root.join(relative), options["maxBytes"].as_u64().unwrap_or(8 << 20) as usize);
                result.insert(id, outcome);
                if result.text_bytes > text_budget {
                    result.truncated = true;
                    break;
                }
                continue;
            }
            inputs.push(
                json!({"id":id,"input":format!("/scan/{}", entries[id].path.replace('\\', "/")),
                "source":extension,"copyInput":ocr_formats.contains(&extension)}),
            );
        }
        if inputs.is_empty() {
            if result.truncated { break; }
            continue;
        }
        work.write(
            "extract-batch.json",
            serde_json::to_vec(&json!({"files":inputs,"options":options}))?,
        )?;
        work.remove("result.json")?;
        result.batches += 1;
        let wire = engine.run_with_directory(
            &[
                "converter-text",
                "--operation",
                "extract-batch",
                "--input",
                "/work/extract-batch.json",
                "--output",
                "/work/text.txt",
                "--source",
                "json",
                "--target",
                "text",
                "--result",
                "/work/result.json",
            ]
            .map(String::from),
            Some(root),
        );
        match wire {
            Ok(mut wire) if wire["ok"] == true => {
                result.truncated |= wire["payload"]["truncated"] == true;
                let Value::Array(outcomes) = wire["payload"]["files"].take() else {
                    anyhow::bail!("missing extraction batch outcomes");
                };
                for file in outcomes {
                    let id = file["id"]
                        .as_u64()
                        .ok_or_else(|| anyhow::anyhow!("missing extraction batch id"))?
                        as usize;
                    ensure!(ids.contains(&id), "unexpected extraction batch id");
                    result.insert(id, file);
                }
                result.bound_text(text_budget);
            }
            error => {
                for input in &inputs {
                    result.errors.push((
                        input["id"].as_u64().unwrap() as usize,
                        format!("WASM extraction batch: {error:?}"),
                    ));
                }
            }
        }
        if result.truncated {
            break;
        }
    }
    Ok(result)
}

pub fn execute(
    o: &Options,
    mut response: Value,
    engine: &mut Runtime,
    work: &Workspace,
    capacity: &Value,
) -> Result<(Value, i32)> {
    let input = Path::new(response["source"]["path"].as_str().unwrap());
    let single_archive = input.is_file();
    let root = if single_archive {
        input.parent().unwrap()
    } else {
        input
    };
    let files_only = matches!(o.request.search_mode.as_str(), "files" | "glob");
    let extensions: Vec<_> = if files_only {
        vec![json!("*")]
    } else {
        capacity
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["textExtraction"] == true || c["archiveSearch"] == true)
            .map(|c| c["format"].clone())
            .collect()
    };
    let max_files = o.request.max_files.unwrap_or(2000);
    let mut config = json!({"extensions":extensions,"maxFiles":max_files,"maxEntries":(max_files*100).min(1000000),
        "maxDepth":o.request.max_depth.unwrap_or(32),"includeHidden":o.request.include_hidden,"exclude":[".git","node_modules","target","dist"]});
    if o.request.search_mode == "glob" {
        config["glob"] = json!(o.request.query);
    }
    let started = std::time::Instant::now();
    let mut scan = if single_archive {
        walk::Scan {
            backend: "single-archive".into(),
            visited: 1,
            entries: vec![walk::Entry {
                path: input.file_name().unwrap().to_string_lossy().into_owned(),
                bytes: input.metadata()?.len(),
            }],
            ..Default::default()
        }
    } else {
        walk::scan(root, &config)?
    };
    let discovery_ms = started.elapsed().as_millis();
    let mut files = Vec::new();
    let mut text_bytes = 0;
    let mut extraction_errors = Vec::new();
    let mut extraction_error_count = 0;
    let mut incomplete_sources = 0;
    let mut entries = std::mem::take(&mut scan.entries);
    entries.retain(|entry| {
        let valid = Path::new(&entry.path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
        if !valid {
            scan.issue(entry.path.clone(), "invalid relative discovery path".into());
        }
        valid
    });
    let configured_jobs = std::env::var("FILENS_SEARCH_JOBS")
        .ok()
        .map(|s| s.parse::<usize>())
        .transpose()?;
    ensure!(
        configured_jobs.is_none_or(|n| (1..=8).contains(&n)),
        "FILENS_SEARCH_JOBS must be between 1 and 8"
    );
    let extraction_started = std::time::Instant::now();
    let mut jobs = 1;
    let mut extracted = Extracted::default();
    if !files_only {
        let ocr_formats: HashSet<String> = capacity
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["ocr"] == true || c["archiveSearch"] == true)
            .filter_map(|c| c["format"].as_str().map(String::from))
            .collect();
        let options = json!({"ocr":o.request.ocr,"ocrMinConfidence":o.request.ocr_min_confidence.unwrap_or(0.8),"media":false,"maxBytes":if o.request.max_bytes == 0 { 8 << 20 } else { o.request.max_bytes },
            "maxOCRPages":200,"includeStructure":true,"includeLayout":o.request.layout,"outputFormat":"json",
            "maxArchiveFiles":max_files,"includeHidden":o.request.include_hidden,"maxDepth":o.request.max_depth.unwrap_or(32)});
        jobs = configured_jobs.unwrap_or_else(|| {
            let source_bytes = entries.iter().map(|entry| entry.bytes).sum::<u64>();
            if source_bytes <= 8 << 20 {
                1
            } else {
                std::thread::available_parallelism()
                    .map_or(1, usize::from)
                    .min(4)
            }
        });
        if configured_jobs.is_none() && entries.len() < 32 {
            jobs = 1;
        }
        if jobs == 1 {
            extracted = batches(
                engine,
                work,
                root,
                &entries,
                &(0..entries.len()).collect::<Vec<_>>(),
                &ocr_formats,
                &options,
                TEXT_BUDGET,
            )?;
        } else {
            let (ocr_ids, plain_ids): (Vec<_>, Vec<_>) = (0..entries.len()).partition(|&id| {
                let extension = Path::new(&entries[id].path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                o.request.ocr != "never" && ocr_formats.contains(&extension)
            });
            let plain_workers = jobs
                .saturating_sub(usize::from(!ocr_ids.is_empty()))
                .max(1)
                .min(plain_ids.len());
            if entries.iter().any(|entry| {
                let extension = Path::new(&entry.path)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                !engine.uses_native_search()
                    || o.request.layout
                    || !crate::native_search::supports_plain(&extension)
            }) {
                engine.ensure_loaded()?;
            }
            let mut workers = Vec::new();
            for _ in 0..plain_workers {
                let directory = work.fork()?;
                let runtime = engine.fork_without_ocr(&directory)?;
                workers.push((runtime, directory));
            }
            let max_wave_files = jobs * 256;
            jobs = 0;
            let mut start = 0;
            while start < entries.len() && extracted.text_bytes <= TEXT_BUDGET {
                let remaining = TEXT_BUDGET.saturating_sub(extracted.text_bytes);
                let end = wave_end(&entries, start, max_wave_files, remaining.min(WAVE_SOURCE_BYTES));
                let (ocr_wave, plain_wave): (Vec<_>, Vec<_>) =
                    (start..end).partition(|id| ocr_ids.binary_search(id).is_ok());
                let active = plain_workers.min(plain_wave.len());
                let chunks = plain_wave.chunks(plain_wave.len().div_ceil(active.max(1)).max(1));
                jobs = jobs.max(chunks.len() + usize::from(!ocr_wave.is_empty()));
                // Join each ordered window before scheduling more paths. Reuse
                // runtimes, but never let every worker consume a full corpus.
                std::thread::scope(|scope| -> Result<()> {
                    let handles: Vec<_> = workers.iter_mut()
                        .zip(chunks)
                        .map(|((runtime, directory), ids)| {
                            let entries = &entries;
                            let options = &options;
                            let ocr_formats = &ocr_formats;
                            scope.spawn(move || batches(runtime, directory, root, entries, ids, ocr_formats, options, remaining))
                        }).collect();
                    if !ocr_wave.is_empty() {
                        extracted.merge(batches(engine, work, root, &entries, &ocr_wave, &ocr_formats, &options, remaining)?);
                    }
                    for handle in handles {
                        extracted.merge(handle.join().map_err(|_| anyhow::anyhow!("search worker failed"))??);
                    }
                    Ok(())
                })?;
                start = end;
            }
        }
        scan.truncated |= extracted.truncated;
        for (id, error) in &extracted.errors {
            scan.issue(entries[*id].path.clone(), error.clone());
        }
    }
    if files_only {
        let ids: Vec<_> = entries
            .iter()
            .enumerate()
            .filter(|(_, entry)| {
                crate::text_catalog::is_archive(
                    &Path::new(&entry.path)
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase(),
                )
            })
            .map(|(id, _)| id)
            .collect();
        if !ids.is_empty() {
            extracted = batches(
                engine,
                work,
                root,
                &entries,
                &ids,
                &HashSet::new(),
                &json!({
                    "archiveNamesOnly":true,"maxArchiveFiles":max_files,"includeHidden":o.request.include_hidden,
                    "maxDepth":o.request.max_depth.unwrap_or(32)
                }),
                TEXT_BUDGET,
            )?;
            scan.truncated |= extracted.truncated;
            for (id, error) in &extracted.errors {
                scan.issue(entries[*id].path.clone(), error.clone());
            }
        }
    }
    let extraction_ms = extraction_started.elapsed().as_millis();
    let assembly_started = std::time::Instant::now();
    let extraction_batches = extracted.batches;
    let native_files = extracted.native_files;
    let mut archive_files = 0;
    let mut archive_visited = 0;
    let mut archive_expanded_bytes = 0;
    'sources: for (id, entry) in entries.iter().enumerate() {
        let path = root.join(&entry.path);
        if files_only {
            if files.len() >= max_files {
                scan.truncated = true;
                break;
            }
            files.push(json!({"path":path,"relativePath":entry.path,"sha256":"","text":"","layout":null,"complete":true}));
        }
        let Some(mut outcome) = extracted.content.remove(&id) else {
            continue;
        };
        let archive = &mut outcome["archive"];
        let outcomes = if archive.is_object() {
            archive_visited += archive["visited"].as_u64().unwrap_or(0);
            archive_expanded_bytes += archive["expandedBytes"].as_u64().unwrap_or(0);
            scan.truncated |= archive["truncated"] == true;
            extraction_error_count += archive["errorCount"].as_u64().unwrap_or(0) as usize;
            for error in archive["errors"].as_array().into_iter().flatten() {
                if extraction_errors.len() < 64 {
                    let suffix = error["members"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(crate::text_catalog::escape_archive_path)
                        .collect::<Vec<_>>()
                        .join("!/");
                    extraction_errors.push(json!({"path":if suffix.is_empty(){path.to_string_lossy().into_owned()}else{format!("{}!/{suffix}",crate::text_catalog::escape_archive_path(&path.to_string_lossy()))},"error":{"code":error["code"],"message":error["message"]}}));
                }
            }
            std::mem::take(archive["files"].as_array_mut().unwrap())
        } else {
            vec![outcome]
        };
        for mut item in outcomes {
            if files.len() >= max_files {
                scan.truncated = true;
                break 'sources;
            }
            let virtual_path = item["memberPath"].as_str().map(|s| {
                format!(
                    "{}!/{s}",
                    crate::text_catalog::escape_archive_path(&path.to_string_lossy())
                )
            });
            let source_path = virtual_path
                .clone()
                .unwrap_or_else(|| path.to_string_lossy().into_owned());
            let content = &mut item["content"];
            if content["complete"] != true || content["truncated"] == true {
                extraction_error_count += 1;
                if extraction_errors.len() < 64 {
                    extraction_errors.push(json!({"path":source_path,"error":{"code":content["errorCode"],"message":content["errorMessage"]}}));
                }
            }
            let text = content["text"].as_str().unwrap_or("");
            if text_bytes + text.len() > TEXT_BUDGET {
                scan.truncated = true;
                break 'sources;
            }
            text_bytes += text.len();
            let source_complete = content["complete"] == true && content["truncated"] != true;
            if !source_complete {
                incomplete_sources += 1;
            }
            let mut source = json!({"path":source_path,"relativePath":virtual_path.as_ref().map_or_else(||entry.path.clone(),|_|format!("{}!/{}",entry.path,item["members"].as_array().unwrap().iter().filter_map(Value::as_str).collect::<Vec<_>>().join("!/"))),"sha256":"","complete":source_complete});
            for key in ["text", "layout", "document", "warnings"] {
                source[key] = item["content"][key].take();
            }
            if virtual_path.is_some() {
                archive_files += 1;
                source["archive"] = json!({"path":path,"members":item["members"]});
            }
            files.push(source);
        }
    }
    let mut corpus = json!({"query":o.request.query,"mode":o.request.search_mode,"limit":o.request.max_results.unwrap_or(10),"format":o.request.format});
    corpus["files"] = Value::Array(files);
    let assembly_ms = assembly_started.elapsed().as_millis();
    let ranking_started = std::time::Instant::now();
    let payload = if engine.uses_native_search() {
        match crate::native_search::evaluate(corpus) {
            Ok(value) => value,
            Err(error) => {
                crate::failure(&mut response, "search_failed", error);
                return Ok((response, 2));
            }
        }
    } else {
        work.write("search-corpus.json", serde_json::to_vec(&corpus)?)?;
        work.remove("result.json")?;
        let wire = engine.run(
            &[
                "converter-text",
                "--operation",
                "search-text",
                "--input",
                "/work/search-corpus.json",
                "--output",
                "/work/search.txt",
                "--source",
                "json",
                "--target",
                "text",
                "--result",
                "/work/result.json",
            ]
            .map(String::from),
        )?;
        if wire["ok"] != true {
            crate::failure(
                &mut response,
                "search_failed",
                wire["errorMessage"]
                    .as_str()
                    .unwrap_or("WASM search failed"),
            );
            return Ok((response, 2));
        }
        wire["payload"].clone()
    };
    let ranking_ms = ranking_started.elapsed().as_millis();
    response["search"] = payload["search"].clone();
    response["content"] = payload["content"].clone();
    response["search"]["scan"] = json!({"backend":scan.backend,"visited":scan.visited,"discoveredFiles":entries.len(),"skipped":scan.skipped,"prunedDirectories":scan.pruned_directories,"truncated":scan.truncated,
        "discoveryMs":discovery_ms,"extractionMs":extraction_ms,"assemblyMs":assembly_ms,"rankingMs":ranking_ms,"errors":scan.errors,"errorCount":scan.error_count,"extractionErrors":extraction_errors,"extractionErrorCount":extraction_error_count,
        "incompleteSources":incomplete_sources,"textBytes":text_bytes,"archives":{"files":archive_files,"visited":archive_visited,"expandedBytes":archive_expanded_bytes,"maxDepth":8,"maxExpandedBytesPerBatch":268435456},"cache":{"enabled":false,"storage":"none","hits":0,"writes":0,"errors":0},"integrity":"assumed","execution":{"workers":jobs,"sharedTextModules":engine.loaded_modules(),"nativeFiles":native_files,"ranking":if engine.uses_native_search(){"native-rust"}else{"wasm"},"extractionBatches":extraction_batches,"batchSize":256}});
    response["search"]["scope"] = config;
    response["search"]["scope"]["textScope"] = json!(if o.request.ocr == "never" {
        "native-text"
    } else {
        "native-and-ocr"
    });
    response["content"]["textScope"] = response["search"]["scope"]["textScope"].clone();
    let complete = response["search"]["complete"] == true
        && !scan.truncated
        && scan.error_count == 0
        && extraction_error_count == 0
        && incomplete_sources == 0;
    response["search"]["complete"] = json!(complete);
    response["content"]["complete"] = json!(complete);
    response["content"]["truncated"] =
        json!(scan.truncated || response["search"]["truncated"] == true);
    response["search"]["truncated"] = response["content"]["truncated"].clone();
    response["ok"] = json!(complete);
    if !complete {
        crate::failure(
            &mut response,
            "search_incomplete",
            "search coverage is incomplete; inspect search.scan and sourceComplete before using the results",
        );
    }
    Ok((response, if complete { 0 } else { 3 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordered_windows_bound_speculation_and_always_make_progress() {
        let entries: Vec<_> = [2, 2, 9, 0, 0, u64::MAX, 1].into_iter().enumerate()
            .map(|(id, bytes)| walk::Entry { path: format!("{id}.txt"), bytes }).collect();
        assert_eq!(wave_end(&entries, 0, 256, 4), 2);
        assert_eq!(wave_end(&entries, 2, 256, 4), 3);
        assert_eq!(wave_end(&entries, 3, 1, 4), 4);
        assert_eq!(wave_end(&entries, 3, 256, 0), 5);
        assert_eq!(wave_end(&entries, 5, 256, 4), 6);
        assert_eq!(wave_end(&entries, 6, 256, 0), 7);
    }

    #[test]
    fn text_budget_retains_the_ordered_prefix_when_workers_finish_out_of_order() {
        let mut extracted = Extracted::default();
        for id in [3, 1, 4, 2, 0] {
            extracted.insert(id, json!({"content":{"text":"abcd"}}));
            extracted.bound_text(8);
        }
        let mut ids: Vec<_> = extracted.content.keys().copied().collect();
        ids.sort_unstable();
        assert_eq!(ids, [0, 1, 2]);
        assert_eq!(extracted.text_bytes, 12);
        assert!(extracted.truncated);
    }

    #[test]
    fn budget_keeps_the_crossing_archive_for_partial_member_coverage() {
        let mut extracted = Extracted::default();
        extracted.insert(0, json!({"content":{"text":"1234"}}));
        extracted.insert(1, json!({"archive":{"files":[
            {"content":{"text":"abcd"}}, {"content":{"text":"efgh"}}
        ]}}));
        extracted.insert(2, json!({"content":{"text":"later"}}));
        extracted.bound_text(8);
        assert_eq!(extracted.content.len(), 2);
        assert_eq!(extracted.content[&1]["archive"]["files"].as_array().unwrap().len(), 2);
        assert!(extracted.truncated);
    }
}
