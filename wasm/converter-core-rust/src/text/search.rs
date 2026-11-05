//! Cross-document retrieval over complete extracted text; no host-side parsing.
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;

#[cfg(feature = "search-simd")]
#[path = "search_simd.rs"]
mod simd;

const MAX_CHUNKS: usize = 65536;
const CHARS: usize = 640;
const OVERLAP: usize = 80;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    query: String,
    mode: String,
    limit: usize,
    format: String,
    files: Vec<Source>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Source {
    path: String,
    sha256: String,
    text: String,
    #[serde(default)]
    relative_path: String,
    #[serde(default)]
    layout: Value,
    #[serde(default)]
    document: Value,
    #[serde(default)]
    warnings: Value,
    #[serde(default)]
    archive: Value,
    complete: bool,
}
impl Source {
    fn name(&self) -> &str {
        if self.relative_path.is_empty() {
            std::path::Path::new(&self.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&self.path)
        } else {
            &self.relative_path
        }
    }
}
#[derive(Clone, Copy)]
struct Span {
    file: usize,
    start: usize,
    end: usize,
}

fn normalized(s: &str) -> String {
    #[cfg(feature = "search-simd")]
    if let Some(value) = simd::ascii_lowercase(s) {
        return value;
    }
    // NFKC leaves ASCII unchanged; avoid the Unicode iterator for this case.
    #[cfg(not(feature = "search-simd"))]
    if s.is_ascii() {
        return s.to_ascii_lowercase();
    }
    s.nfkc().flat_map(char::to_lowercase).collect()
}
fn add_term(result: &mut BTreeMap<String, f64>, term: &str, weight: f64) {
    if let Some(value) = result.get_mut(term) {
        *value += weight;
    } else {
        result.insert(term.into(), weight);
    }
}
fn terms(text: &str) -> BTreeMap<String, f64> {
    let mut result = BTreeMap::new();
    visit_terms(text, |term, weight| add_term(&mut result, term, weight));
    result
}

fn visit_terms(text: &str, emit: impl FnMut(&str, f64)) {
    let text = normalized(text);
    visit_normalized_terms(&text, emit);
}

fn visit_normalized_terms(text: &str, emit: impl FnMut(&str, f64)) {
    #[cfg(feature = "search-simd")]
    let mut emit = emit;
    #[cfg(feature = "search-simd")]
    if simd::visit_ascii_words(text, |word| flush_word(word, &mut emit)) {
        return;
    }
    visit_normalized_terms_scalar(text, emit);
}

fn flush_word(word: &str, emit: &mut impl FnMut(&str, f64)) {
    let trimmed = word.trim_matches(['.', '-', '_']);
    if !trimmed.is_empty() && !super::stopwords::stop(trimmed) {
        emit(trimmed, 1.0);
        if !trimmed.chars().any(|c| c.is_ascii_digit()) {
            for part in trimmed
                .split(['.', '-', '_'])
                .filter(|s| !s.is_empty() && *s != trimmed && !super::stopwords::stop(s))
            {
                emit(part, 0.5);
            }
        }
    }
}

fn visit_normalized_terms_scalar(text: &str, mut emit: impl FnMut(&str, f64)) {
    let mut start = 0;
    let mut previous = None;
    // Words and adjacent CJK pairs are contiguous in normalized UTF-8 text.
    // Borrow those ranges instead of copying each character into buffers.
    for (at, c) in text.char_indices() {
        let end = at + c.len_utf8();
        if matches!(c as u32,0x3400..=0x4dbf|0x4e00..=0x9fff|0xf900..=0xfaff|0x20000..=0x323af) {
            flush_word(&text[start..at], &mut emit);
            let character = &text[at..end];
            if !super::stopwords::stop(character) {
                emit(character, 0.25);
            }
            if let Some(p) = previous {
                emit(&text[p..end], 1.0);
            }
            previous = Some(at);
            start = end;
        } else {
            previous = None;
            if !(c.is_alphanumeric() || matches!(c, '.' | '-' | '_')) {
                flush_word(&text[start..at], &mut emit);
                start = end;
            }
        }
    }
    flush_word(&text[start..], &mut emit);
}

// Chunks arrive in file order. Retain only the current filename's capped terms,
// and skip filenames whose sources emit no searchable chunks.
struct ChunkTerms<'a> {
    files: &'a [Source],
    files_only: bool,
    file: usize,
    path: BTreeMap<String, f64>,
    query_ids: BTreeMap<&'a str, usize>,
    frequencies: Vec<f64>,
}
impl<'a> ChunkTerms<'a> {
    fn new(files: &'a [Source], files_only: bool, query: &'a BTreeMap<String, f64>) -> Self {
        Self { files, files_only, file: usize::MAX, path: BTreeMap::new(),
            query_ids: query.keys().enumerate().map(|(id, term)| (term.as_str(), id)).collect(),
            frequencies: if files_only { Vec::new() } else { vec![0.0; query.len()] } }
    }

    fn get(&mut self, span: Span, phrase: &str) -> (f64, Vec<(usize, f64)>, bool) {
        if self.file != span.file {
            self.path = terms(self.files[span.file].name());
            for frequency in self.path.values_mut() {
                *frequency = frequency.min(2.0);
            }
            self.file = span.file;
        }
        if self.files_only {
            let found = self.query_ids.iter().filter_map(|(&term, &id)| {
                self.path.get(term).map(|&frequency| (id, frequency))
            }).collect();
            return (self.path.values().sum(), found, false);
        }
        self.frequencies.fill(0.0);
        let mut length = 0.0;
        // Every emitted weight contributes to length, including non-query
        // terms. Quarter-unit weights sum exactly within the input bounds.
        let query_ids = &self.query_ids;
        let frequencies = &mut self.frequencies;
        let body = normalized(&self.files[span.file].text[span.start..span.end]);
        let body_phrase = body.contains(phrase);
        visit_normalized_terms(&body, |term, weight| {
            length += weight;
            if let Some(&id) = query_ids.get(term) {
                frequencies[id] += weight;
            }
        });
        for (term, &frequency) in &self.path {
            length += frequency;
            if let Some(&id) = self.query_ids.get(term.as_str()) {
                self.frequencies[id] += frequency;
            }
        }
        let found = self.frequencies.iter().enumerate().filter_map(|(id, &frequency)| {
            (frequency > 0.0).then_some((id, frequency))
        }).collect();
        (length, found, body_phrase)
    }
}
fn spans(file: usize, text: &str, emit: &mut Vec<Span>) -> bool {
    let mut start = 0;
    while start < text.len() {
        if emit.len() == MAX_CHUNKS {
            return false;
        }
        let mut end = text[start..]
            .char_indices()
            .nth(CHARS)
            .map_or(text.len(), |(i, _)| start + i);
        if end < text.len() {
            if let Some(line) = text[start..end]
                .rfind('\n')
                .filter(|i| *i >= (end - start) / 2)
            {
                end = start + line + 1;
            }
        }
        emit.push(Span { file, start, end });
        if end == text.len() {
            break;
        }
        let next = text[start..end]
            .char_indices()
            .rev()
            .nth(OVERLAP)
            .map_or(end, |(i, _)| start + i);
        start = next.max(start + text[start..].chars().next().unwrap().len_utf8());
    }
    true
}

// Rank files by their best chunk before sorting excerpts. Keep every chunk of
// the chosen files so the existing greedy non-overlap selection stays intact.
fn rank_matches(scored: &mut Vec<(Span, f64)>, files: &[Source], limit: usize) -> usize {
    let compare = |(a, x): &(Span, f64), (b, y): &(Span, f64)| {
        y.total_cmp(x)
            .then_with(|| files[a.file].path.cmp(&files[b.file].path))
            .then(a.start.cmp(&b.start))
    };
    // Scoring preserves file order, so counting file transitions needs no set.
    let mut bests = Vec::<usize>::new();
    for (index, (span, score)) in scored.iter().enumerate() {
        if let Some(best) = bests.last_mut() {
            if scored[*best].0.file == span.file {
                if score.total_cmp(&scored[*best].1)
                    .then_with(|| scored[*best].0.start.cmp(&span.start)).is_gt()
                {
                    *best = index;
                }
                continue;
            }
        }
        bests.push(index);
    }
    let matched_files = bests.len();
    if matched_files > limit {
        bests.select_nth_unstable_by(limit, |&a, &b| {
            // The original sort is stable: resolve equal rank by input order.
            compare(&scored[a], &scored[b]).then(a.cmp(&b))
        });
        bests.truncate(limit);
        for best in &mut bests {
            *best = scored[*best].0.file;
        }
        bests.sort_unstable();
        let mut next = 0;
        scored.retain(|(span, _)| {
            while next < bests.len() && bests[next] < span.file {
                next += 1;
            }
            next < bests.len() && bests[next] == span.file
        });
    }
    scored.sort_by(compare);
    matched_files
}

fn evaluate(corpus: Corpus) -> Result<Value, String> {
    evaluate_with_feature_budget(corpus, 8 << 20)
}

fn evaluate_with_feature_budget(corpus: Corpus, feature_budget: usize) -> Result<Value, String> {
    if corpus.query.trim().is_empty()
        || corpus.query.len() > 4096
        || !(1..=100).contains(&corpus.limit)
        || !["bm25", "exact", "files"].contains(&corpus.mode.as_str())
    {
        return Err("invalid search query, limit or mode".into());
    }
    let query = if corpus.mode == "exact" {
        BTreeMap::new()
    } else {
        terms(&corpus.query)
    };
    if query.is_empty() && corpus.mode != "exact" {
        return Err("query contains no searchable terms".into());
    }
    let mut chunks = Vec::new();
    let mut complete = true;
    for (i, file) in corpus.files.iter().enumerate() {
        if chunks.len() >= MAX_CHUNKS {
            complete = false;
            break;
        }
        if corpus.mode == "files" {
            chunks.push(Span {
                file: i,
                start: 0,
                end: 0,
            });
        } else if corpus.mode == "exact" {
            let first_chunk = chunks.len();
            for (at, phrase) in file.text.match_indices(corpus.query.trim()) {
                if chunks.len() >= MAX_CHUNKS {
                    complete = false;
                    break;
                }
                let start = file.text[..at]
                    .char_indices()
                    .rev()
                    .nth(80)
                    .map_or(0, |(i, _)| i);
                let end = at + phrase.len();
                let end = file.text[end..]
                    .char_indices()
                    .nth(160)
                    .map_or(file.text.len(), |(i, _)| end + i);
                chunks.push(Span {
                    file: i,
                    start,
                    end,
                });
            }
            if chunks.len() == first_chunk && file.name().contains(corpus.query.trim()) {
                let end = file
                    .text
                    .char_indices()
                    .nth(CHARS)
                    .map_or(file.text.len(), |(i, _)| i);
                chunks.push(Span {
                    file: i,
                    start: 0,
                    end,
                });
            }
        } else if !spans(i, &file.text, &mut chunks) {
            complete = false;
            break;
        }
    }
    let mut tokens = ChunkTerms::new(&corpus.files, corpus.mode == "files", &query);
    let exact = normalized(corpus.query.trim());
    // Retain one phrase-hit byte per BM25 chunk, at most MAX_CHUNKS bytes.
    // Reuse its tokenization normalization without retaining body strings.
    let mut body_phrases = Vec::with_capacity(if corpus.mode == "bm25" { chunks.len() } else { 0 });
    // Query keys have a stable order, so frequencies need no per-chunk map lookup.
    let mut df = vec![0usize; query.len()];
    let mut total = 0.0;
    let mut lengths = Vec::with_capacity(chunks.len());
    let mut features = Vec::with_capacity(chunks.len());
    let mut feature_bytes = 0usize;
    // Only query-term document frequencies are needed: memory remains bounded.
    for &span in &chunks {
        if corpus.mode == "exact" {
            lengths.push(0.0);
            features.push(None);
            continue;
        }
        let (length, current, body_phrase) = tokens.get(span, &exact);
        if corpus.mode == "bm25" {
            body_phrases.push(body_phrase);
        }
        total += length;
        lengths.push(length);
        for &(index, _) in &current {
            df[index] += 1;
        }
        // Reuse query TFs for scoring instead of tokenizing every chunk twice.
        // Keep a bounded cache; over-budget chunks follow the original path.
        let bytes = current.capacity() * std::mem::size_of::<(usize, f64)>();
        if feature_bytes.saturating_add(bytes) <= feature_budget {
            feature_bytes += bytes;
            features.push(Some(current));
        } else {
            features.push(None);
        }
    }
    let average = (total / chunks.len().max(1) as f64).max(1.0);
    let query_weights: Vec<_> = query.values().zip(df).map(|(weight, freq)| {
        let freq = freq as f64;
        let idf = (1.0 + (chunks.len() as f64 - freq + 0.5) / (freq + 0.5)).ln();
        weight.min(2.0) * idf
    }).collect();
    let precise: Vec<_> = query
        .keys().enumerate()
        .filter(|(_, t)| t.chars().any(|c| c.is_ascii_digit()))
        .map(|(index, _)| index)
        .collect();
    let strong: Vec<_> = query.keys().enumerate().filter(|(_, t)| t.chars().count() > 1).map(|(index, _)| index).collect();
    let mut scored = Vec::<(Span, f64)>::new();
    // Chunks are emitted in file order. Cache only the last filename phrase;
    // body hits and rejected chunks still avoid filename normalization entirely.
    let mut phrase_file = usize::MAX;
    let mut filename_phrase = false;
    for (chunk_index, &span) in chunks.iter().enumerate() {
        let source = &corpus.files[span.file];
        let value = &source.text[span.start..span.end];
        let score = if corpus.mode == "exact" {
            if value.contains(corpus.query.trim()) || source.name().contains(corpus.query.trim()) {
                1.0
            } else {
                0.0
            }
        } else {
            let fallback;
            let found = if let Some(found) = &features[chunk_index] {
                found
            } else {
                fallback = tokens.get(span, &exact).1;
                &fallback
            };
            if !precise.iter().all(|t| found.binary_search_by_key(t, |(index, _)| *index).is_ok())
                || (!strong.is_empty() && !strong.iter().any(|t| found.binary_search_by_key(t, |(index, _)| *index).is_ok()))
            {
                continue;
            }
            let length = lengths[chunk_index];
            let phrase = (corpus.mode == "bm25" && body_phrases[chunk_index]) || {
                if phrase_file != span.file {
                    filename_phrase = normalized(source.name()).contains(&exact);
                    phrase_file = span.file;
                }
                filename_phrase
            };
            let mut feature_index = 0;
            query_weights
                .iter()
                .enumerate()
                .map(|(index, &weight)| {
                    let tf = if feature_index < found.len() && found[feature_index].0 == index {
                        let frequency = found[feature_index].1;
                        feature_index += 1;
                        frequency
                    } else {
                        0.0
                    };
                    weight * (tf * 2.2)
                        / (tf + 1.2 * (0.25 + 0.75 * length / average))
                })
                .sum::<f64>()
                + if phrase { 3.0 } else { 0.0 }
        };
        if score > 0.0 {
            scored.push((span, score));
        }
    }
    let matched_files = rank_matches(&mut scored, &corpus.files, corpus.limit);
    let mut order = Vec::new();
    let mut selected = HashMap::<usize, Vec<(Span, f64)>>::new();
    for (span, score) in scored {
        if !selected.contains_key(&span.file) {
            if order.len() >= corpus.limit {
                continue;
            }
            order.push(span.file);
        }
        let list = selected.entry(span.file).or_default();
        if list.len() < 3
            && !list
                .iter()
                .any(|(other, _)| span.start < other.end && other.start < span.end)
        {
            list.push((span, score));
        }
    }
    let mut results = Vec::new();
    for i in order {
        let file = &corpus.files[i];
        let excerpts:Vec<_>=selected[&i].iter().enumerate().filter(|_|corpus.mode!="files").map(|(j,(span,score))|{
            let start_line=file.text[..span.start].bytes().filter(|c|*c==b'\n').count()+1;
            let text=&file.text[span.start..span.end];
            let end_line=start_line+text.bytes().filter(|c|*c==b'\n').count()-usize::from(text.ends_with('\n'));
            let layout_blocks:Vec<_>=file.layout["blocks"].as_array().into_iter().flatten().filter(|block|{
                block["startByte"].as_u64().zip(block["endByte"].as_u64()).is_some_and(|(a,b)|a<span.end as u64 && b>span.start as u64)
            }).map(|block|{let mut value=block.clone();value["boundsScope"]=json!("source-block");value}).collect();
            // Evidence here addresses the full extracted source. Normalize adjacent
            // chunks of the same origin so native/WASM extraction stays identical.
            let mut blocks:Vec<Value>=Vec::new();
            for block in file.document["blocks"].as_array().into_iter().flatten() {
                let Some((a,b))=block["startByte"].as_u64().zip(block["endByte"].as_u64()) else {continue};
                if a>=span.end as u64 || b<=span.start as u64 {continue;}
                let start=a.max(span.start as u64); let end=b.min(span.end as u64);
                let mut value=json!({"startByte":start,"endByte":end});
                for key in ["source","confidence","confidenceKind","page","slide","shape","sourcePart","media"] {
                    if let Some(v)=block.get(key){value[key]=v.clone();}
                }
                let same=blocks.last().is_some_and(|last|last["endByte"]==start && ["source","confidence","confidenceKind","page","slide","shape","sourcePart","media"].iter().all(|key|last[*key]==value[*key]));
                if same {blocks.last_mut().unwrap()["endByte"]=json!(end);}else{blocks.push(value);}
            }
            if blocks.is_empty() && file.document.is_null() {blocks.push(json!({"startByte":span.start,"endByte":span.end,"source":"text","confidence":null}));}
            json!({"blocks":blocks,"id":format!("s{}",j+1),"startByte":span.start,"endByte":span.end,"startLine":start_line,"endLine":end_line,"text":text,"score":score,
                "layout":{"blocks":layout_blocks,"pages":file.layout["pages"],"images":file.layout["images"]}})
        }).collect();
        let mut result = json!({"path":file.path,"sha256":if file.sha256.is_empty(){Value::Null}else{json!(file.sha256)},"score":selected[&i][0].1,"sourceComplete":file.complete,"warnings":file.warnings.as_array().cloned().unwrap_or_default(),"excerpts":excerpts});
        if !file.archive.is_null() {
            result["archive"] = file.archive.clone();
        }
        results.push(result);
    }
    let mut text = String::new();
    for (i, file) in results.iter().enumerate() {
        text.push_str(&format!("{}. {}\n", i + 1, file["path"].as_str().unwrap()));
        for excerpt in file["excerpts"].as_array().unwrap() {
            text.push_str(&format!(
                "  #{} · lines {}–{} · bytes {}:{}\n{}\n\n",
                excerpt["id"].as_str().unwrap(),
                excerpt["startLine"],
                excerpt["endLine"],
                excerpt["startByte"],
                excerpt["endByte"],
                excerpt["text"].as_str().unwrap()
            ));
        }
    }
    let search = json!({"version":"filens-search-v1","method":if corpus.mode=="files" {"filename-bm25"} else if corpus.mode=="exact" {"literal"} else {"bm25-exact"},
        "semantic":false,"query":corpus.query,"indexedFiles":corpus.files.len(),"matchedFiles":matched_files,"returnedFiles":results.len(),
        "chunks":chunks.len(),"complete":complete,"truncated":!complete,"noLexicalMatch":results.is_empty(),"results":results});
    let rendered = render(&search, &text, &corpus.format);
    Ok(
        json!({"search":search,"content":{"text":text,"rendered":rendered,"complete":complete,"truncated":!complete,"warnings":[]}}),
    )
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn render(search: &Value, text: &str, format: &str) -> String {
    match format {
        "html" => format!(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>FiLens search</title></head><body><pre>{}</pre></body></html>\n",
            escape(text)
        ),
        "markdown" => text
            .lines()
            .map(|line| format!("> {}\n", line.replace('<', "&lt;").replace('>', "&gt;")))
            .collect(),
        "csv" | "tsv" => {
            let separator = if format == "csv" { "," } else { "\t" };
            let row = |cells: Vec<String>| {
                cells
                    .iter()
                    .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(separator)
                    + "\n"
            };
            let mut out = row([
                "path",
                "score",
                "startByte",
                "endByte",
                "startLine",
                "endLine",
                "text",
            ]
            .into_iter()
            .map(String::from)
            .collect());
            for hit in search["results"].as_array().unwrap() {
                let excerpts = hit["excerpts"].as_array().unwrap();
                if excerpts.is_empty() {
                    out += &row(vec![
                        hit["path"].as_str().unwrap().into(),
                        hit["score"].to_string(),
                        "".into(),
                        "".into(),
                        "".into(),
                        "".into(),
                        "".into(),
                    ]);
                }
                for e in excerpts {
                    out += &row(vec![
                        hit["path"].as_str().unwrap().into(),
                        e["score"].to_string(),
                        e["startByte"].to_string(),
                        e["endByte"].to_string(),
                        e["startLine"].to_string(),
                        e["endLine"].to_string(),
                        e["text"].as_str().unwrap().into(),
                    ]);
                }
            }
            out
        }
        _ => text.into(),
    }
}

pub(super) fn evaluate_value(value: Value) -> Result<Value, String> {
    serde_json::from_value::<Corpus>(value)
        .map_err(|e| e.to_string())
        .and_then(evaluate)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(path: &str, text: &str) -> Source {
        Source {
            path: path.into(),
            relative_path: path.into(),
            sha256: "fixture".into(),
            text: text.into(),
            layout: Value::Null,
            document: Value::Null,
            warnings: Value::Null,
            archive: Value::Null,
            complete: true,
        }
    }
    fn run(query: &str, mode: &str, files: Vec<Source>) -> Value {
        run_limited(query, mode, files, 10)
    }
    fn run_limited(query: &str, mode: &str, files: Vec<Source>, limit: usize) -> Value {
        evaluate(Corpus {
            query: query.into(),
            mode: mode.into(),
            limit,
            format: "json".into(),
            files,
        })
        .unwrap()
    }
    #[test]
    fn file_limit_preserves_lexical_ranking_and_total_matches() {
        for limit in [1, 2, 100] {
            let value = run_limited("budget", "files", (0..101).rev()
                .map(|i| source(&format!("budget {i:03}.txt"), "")).collect(), limit);
            assert_eq!(value["search"]["matchedFiles"], 101);
            assert_eq!(value["search"]["returnedFiles"], limit);
            let results = value["search"]["results"].as_array().unwrap();
            for (index, result) in results.iter().enumerate() {
                assert_eq!(result["path"], format!("budget {index:03}.txt"));
            }
        }
    }
    #[test]
    fn duplicate_paths_rank_by_start_then_stable_source_order() {
        let mut later = source("same.txt", &format!("{}needle", "x".repeat(200)));
        later.sha256 = "later-offset".into();
        let mut first = source("same.txt", "needle first");
        first.sha256 = "first-early".into();
        let mut second = source("same.txt", "needle second");
        second.sha256 = "second-early".into();
        let value = run_limited("needle", "exact", vec![source("z.txt", "needle"), later, first, second], 1);
        assert_eq!(value["search"]["matchedFiles"], 4);
        assert_eq!(value["search"]["returnedFiles"], 1);
        assert_eq!(value["search"]["results"][0]["sha256"], "first-early");
        assert_eq!(value["search"]["results"][0]["excerpts"][0]["startByte"], 0);
    }
    #[test]
    fn limiting_files_keeps_three_greedy_nonoverlapping_excerpts() {
        let text = format!("needle needle{}", "x".repeat(400)).repeat(4);
        let mut files = vec![source("a.txt", &text)];
        files.extend((0..20).map(|i| source(&format!("z-{i}.txt"), "needle")));
        let value = run_limited("needle", "exact", files, 1);
        assert_eq!(value["search"]["matchedFiles"], 21);
        assert_eq!(value["search"]["chunks"], 28);
        assert_eq!(value["search"]["returnedFiles"], 1);
        let excerpts = value["search"]["results"][0]["excerpts"].as_array().unwrap();
        assert_eq!(excerpts.len(), 3);
        assert_eq!(excerpts[0]["startByte"], 0);
        for pair in excerpts.windows(2) {
            assert!(pair[0]["endByte"].as_u64().unwrap() <= pair[1]["startByte"].as_u64().unwrap());
        }
    }
    #[test]
    fn normalization_preserves_ascii_and_unicode_compatibility() {
        for byte in 0..=127u8 {
            let text = format!("AZ budget_42{}x.Y-Z", char::from(byte));
            let reference: String = text.nfkc().flat_map(char::to_lowercase).collect();
            assert_eq!(normalized(&text), reference);
        }
        for text in ["ＢＵＤＧＥＴ １２３.４５", "预算审批", "İSTANBUL Straße ① ﬁ", "cafe\u{301} ﬃ"] {
            let reference: String = text.nfkc().flat_map(char::to_lowercase).collect();
            assert_eq!(normalized(text), reference);
        }
    }
    #[cfg(feature = "search-simd")]
    #[test]
    fn simd_matches_scalar_for_every_ascii_byte_at_vector_boundaries() {
        for length in [0usize, 1, 15, 16, 17, 31, 32, 33, 47, 48, 63, 64, 65, 127, 128, 129, 640] {
            for position in [0, 1, 14, 15, 16, 17, 30, 31, 32, 47, 48, 63, 64, length.saturating_sub(1)] {
                if position >= length { continue; }
                for byte in 0..=127u8 {
                    let mut bytes = b"__AbC-deF.gHi_123 /".iter().copied().cycle().take(length).collect::<Vec<_>>();
                    bytes[position] = byte;
                    let text = String::from_utf8(bytes).unwrap();
                    assert_eq!(normalized(&text), text.to_ascii_lowercase());
                    let text = normalized(&text);
                    let mut expected = Vec::new();
                    visit_normalized_terms_scalar(&text, |t, w| expected.push((t.to_owned(), w)));
                    let mut found = Vec::new();
                    visit_normalized_terms(&text, |t, w| found.push((t.to_owned(), w)));
                    assert_eq!(found, expected, "byte {byte} at {position}/{length}");
                }
            }
        }
    }
    #[cfg(feature = "search-simd")]
    #[test]
    fn simd_unicode_fallback_preserves_normalization_and_emission_order() {
        for prefix in [0, 1, 15, 16, 17, 31, 32, 63, 64, 127] {
            for unicode in ["é", "预算𠀀𠮷", "İSTANBUL", "ＢＵＤＧＥＴ １２３.４５", "cafe\u{301} ﬃ", "🦀"] {
                let text = format!("{}{}{}", "A".repeat(prefix), unicode, " budget-budget ".repeat(6));
                let expected: String = text.nfkc().flat_map(char::to_lowercase).collect();
                assert_eq!(normalized(&text), expected);
                let mut scalar = Vec::new();
                visit_normalized_terms_scalar(&expected, |t, w| scalar.push((t.to_owned(), w)));
                let mut found = Vec::new();
                visit_terms(&text, |t, w| found.push((t.to_owned(), w)));
                assert_eq!(found, scalar);
            }
        }
    }
    #[cfg(feature = "search-simd")]
    #[test]
    fn simd_accepts_unaligned_slices_and_carries_words_across_vectors() {
        for shift in 0..16 {
            for length in [31, 32, 33, 63, 64, 65, 127, 128, 129] {
                let padded = format!("{}{}", "x".repeat(shift), "B".repeat(length));
                let text = &padded[shift..];
                assert_eq!(normalized(text), "b".repeat(length));
                let mut found = Vec::new();
                visit_terms(text, |t, w| found.push((t.to_owned(), w)));
                assert_eq!(found, vec![("b".repeat(length), 1.0)]);
            }
        }
    }
    #[test]
    fn term_weights_preserve_repeats_identifiers_and_supplementary_cjk() {
        let found = terms("Budget-Budget budget_budget 123.45 123.45 的预算𠀀𠮷");
        let expected = [
            ("budget-budget", 1.0), ("budget_budget", 1.0), ("budget", 2.0), ("123.45", 2.0),
            ("预", 0.25), ("算", 0.25), ("𠀀", 0.25), ("𠮷", 0.25),
            ("的预", 1.0), ("预算", 1.0), ("算𠀀", 1.0), ("𠀀𠮷", 1.0),
        ].into_iter().map(|(term, weight)| (term.to_owned(), weight)).collect();
        assert_eq!(found, expected);
    }
    #[test]
    fn borrowed_token_ranges_preserve_emission_order_and_weights() {
        let mut emitted = Vec::new();
        visit_terms("__BUDGET-budget_的预算𠀀𠮷/foo.bar A12-B34/İSTANBUL/cafe\u{301}/ﬁ 预a算 𠀀é𠮷",
            |term, weight| emitted.push((term.to_owned(), weight)));
        let expected: Vec<_> = [
            ("budget-budget", 1.0), ("budget", 0.5), ("budget", 0.5),
            ("预", 0.25), ("的预", 1.0), ("算", 0.25), ("预算", 1.0),
            ("𠀀", 0.25), ("算𠀀", 1.0), ("𠮷", 0.25), ("𠀀𠮷", 1.0),
            ("foo.bar", 1.0), ("foo", 0.5), ("bar", 0.5), ("a12-b34", 1.0),
            ("stanbul", 1.0), ("café", 1.0), ("fi", 1.0),
            ("预", 0.25), ("算", 0.25), ("𠀀", 0.25), ("é", 1.0), ("𠮷", 0.25),
        ].into_iter().map(|(term, weight)| (term.to_owned(), weight)).collect();
        assert_eq!(emitted, expected);
    }
    #[test]
    fn cjk_pairs_do_not_cross_non_cjk_characters() {
        assert_eq!(terms("预算").get("预算"), Some(&1.0));
        for separator in ["/", "-", "a", "é", "1", "🦀", "\u{301}"] {
            let found = terms(&format!("预{separator}算"));
            assert!(!found.contains_key("预算"), "separator: {separator}");
            assert_eq!(found.get("预"), Some(&0.25));
            assert_eq!(found.get("算"), Some(&0.25));
        }
    }
    #[test]
    fn streamed_features_match_full_vocabulary_lengths_and_frequencies() {
        let files = vec![
            source("budget budget 预算预算预算预算预算预算预算预算 123.45.txt",
                "  .BUDGET-BUDGET_ budget_budget. 123.45 123.45 的预算𠀀𠮷 ＢＵＤＧＥＴ １２３.４５"),
            source("ordinary.txt", &format!("budget approval {}", (0..512).map(|i| format!("other{i} ")).collect::<String>())),
            source("café ffi.txt", "Istanbul cafe\u{301} ﬃ unrelated background"),
        ];
        for query in ["budget 123.45 预算𠀀𠮷", "unobtainium", "budget-budget", "café ffi"] {
            let exact = normalized(query);
            let query = terms(query);
            for files_only in [false, true] {
                let mut streamed = ChunkTerms::new(&files, files_only, &query);
                // Revisit files to exercise scratch reset and filename replacement.
                for file in [0, 1, 2, 0, 2, 1] {
                    let span = Span { file, start: 0, end: if files_only { 0 } else { files[file].text.len() } };
                    let mut full = terms(&files[file].text[span.start..span.end]);
                    for (term, frequency) in terms(files[file].name()) {
                        add_term(&mut full, &term, frequency.min(2.0));
                    }
                    let expected: Vec<_> = query.keys().enumerate().filter_map(|(id, term)| {
                        full.get(term).map(|&frequency| (id, frequency))
                    }).collect();
                    let (length, found, phrase) = streamed.get(span, &exact);
                    assert_eq!(length, full.values().sum::<f64>());
                    assert_eq!(found, expected);
                    assert_eq!(phrase, !files_only && normalized(&files[file].text).contains(&exact));
                }
            }
        }
    }
    #[test]
    fn unmatched_body_terms_still_reduce_length_normalized_scores() {
        let varied = (0..128).map(|i| format!("other{i} ")).collect::<String>();
        let value = run("budget approval", "bm25", vec![
            source("long.txt", &format!("budget approval {varied}")),
            source("short.txt", "budget approval"),
        ]);
        let results = value["search"]["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["path"], "short.txt");
        assert!(results[0]["score"].as_f64().unwrap() > results[1]["score"].as_f64().unwrap());
    }
    #[test]
    fn chinese_numbers_and_original_offsets() {
        let original =
            "会议记录\n预算不得超过12345.67元；需要负责人审批。\n风险：扫描小字可能漏字。";
        let v = run(
            "预算 12345.67",
            "bm25",
            vec![
                source("wrong.txt", "预算12345.76元"),
                source("right.txt", original),
            ],
        );
        assert_eq!(v["search"]["matchedFiles"], 1);
        let hit = &v["search"]["results"][0];
        assert_eq!(hit["path"], "right.txt");
        let e = &hit["excerpts"][0];
        assert_eq!(
            &original[e["startByte"].as_u64().unwrap() as usize
                ..e["endByte"].as_u64().unwrap() as usize],
            e["text"].as_str().unwrap()
        );
    }
    #[test]
    fn exact_search_crosses_chunks_and_is_literal() {
        let needle = "AbC.".repeat(60);
        let text = format!("{}{}{}", "x".repeat(630), needle, "y".repeat(300));
        let v = run(&needle, "exact", vec![source("one.txt", &text)]);
        assert!(
            v["search"]["results"][0]["excerpts"][0]["text"]
                .as_str()
                .unwrap()
                .contains(&needle)
        );
        assert_eq!(
            run("abc.", "exact", vec![source("one.txt", &text)])["search"]["matchedFiles"],
            0
        );
    }
    #[test]
    fn exact_filename_fallback_is_per_file_and_keeps_literal_semantics() {
        let value = run(
            "the!",
            "exact",
            vec![
                source("a.txt", "the!\nthe!\n"),
                source("the!-empty.txt", ""),
                source("the!-body.txt", "the!"),
                source("THE!-case.txt", "ＴＨＥ！"),
            ],
        );
        assert_eq!(value["search"]["chunks"], 4);
        assert_eq!(value["search"]["matchedFiles"], 3);
        assert_eq!(value["search"]["complete"], true);
        let results = value["search"]["results"].as_array().unwrap();
        let empty = results.iter().find(|v| v["path"] == "the!-empty.txt").unwrap();
        assert_eq!(empty["score"], 1.0);
        assert_eq!(empty["excerpts"][0]["text"], "");
        assert_eq!(empty["excerpts"][0]["startByte"], 0);
        assert_eq!(empty["excerpts"][0]["endByte"], 0);
    }
    #[test]
    fn exact_chunk_limit_includes_filename_matches() {
        let value = run(
            "n",
            "exact",
            vec![
                source("n-one.txt", &"n".repeat(MAX_CHUNKS)),
                source("n-empty.txt", ""),
                source("n-three.txt", &"n".repeat(100)),
            ],
        );
        assert_eq!(value["search"]["chunks"], MAX_CHUNKS);
        assert_eq!(value["search"]["complete"], false);
        assert_eq!(value["search"]["matchedFiles"], 1);
        let filenames = run(
            "n",
            "exact",
            (0..=MAX_CHUNKS).map(|_| source("n.txt", "")).collect(),
        );
        assert_eq!(filenames["search"]["chunks"], MAX_CHUNKS);
        assert_eq!(filenames["search"]["complete"], false);
        assert_eq!(filenames["search"]["matchedFiles"], MAX_CHUNKS);
    }
    #[test]
    fn no_matches_and_numeric_identifier_traps() {
        assert_eq!(
            run(
                "FILENS2026",
                "bm25",
                vec![source("one.txt", "FILENS2027 approved")]
            )["search"]["matchedFiles"],
            0
        );
        let value = run(
            "unobtainium",
            "bm25",
            vec![source("one.txt", "ordinary text")],
        );
        assert_eq!(value["search"]["noLexicalMatch"], true);
        assert_eq!(value["content"]["complete"], true);
    }
    #[test]
    fn bounded_feature_cache_preserves_scores_and_evidence() {
        let corpus = || Corpus {
            query: "预算 approval".into(),
            mode: "bm25".into(),
            limit: 10,
            format: "json".into(),
            files: vec![
                source("one.txt", "现行预算需要 approval。"),
                source("two.txt", "approval budget notes"),
                source("none.txt", "ordinary background"),
                source("预算 approval fourth.txt", &"预算需要审核，等待负责人 approval。\n".repeat(100)),
                source("预算-approval fifth.txt", &format!("预算 approval\n{}", "预算仍需审核，等待 approval。\n".repeat(100))),
            ],
        };
        assert_eq!(
            evaluate_with_feature_budget(corpus(), 0).unwrap(),
            evaluate(corpus()).unwrap()
        );
        assert_eq!(
            evaluate_with_feature_budget(corpus(), 128).unwrap(),
            evaluate(corpus()).unwrap()
        );
    }
    #[test]
    fn phrase_hits_preserve_normalization_and_single_character_matches() {
        let corpus = |query: &str| Corpus {
            query: query.into(), mode: "bm25".into(), limit: 10, format: "json".into(),
            files: vec![
                source("body.txt", "sequence ＢＵＤＧＥＴ ＡＰＰＲＯＶＡＬ café ﬃ"),
                source("miss.txt", "unrelated background"),
                source("q filename.txt", "ordinary text"),
            ],
        };
        let single = evaluate(corpus("q")).unwrap();
        assert_eq!(single["search"]["matchedFiles"], 2);
        let results = single["search"]["results"].as_array().unwrap();
        let body = results.iter().find(|v| v["path"] == "body.txt").unwrap();
        // A single-character substring may earn a phrase score without a TF.
        assert_eq!(body["score"], 3.0);
        for query in ["q", "budget approval", "café ffi"] {
            let expected = evaluate(corpus(query)).unwrap();
            for budget in [0, 1, 128] {
                assert_eq!(evaluate_with_feature_budget(corpus(query), budget).unwrap(), expected);
            }
        }
    }
    #[test]
    fn filename_frequency_caps_and_body_isolation_survive_cache_fallback() {
        let corpus = |repeats: usize, text: &str| {
            let mut file = source("stable.txt", text);
            file.relative_path = format!("{}{} notes.txt", "budget ".repeat(repeats), "预算".repeat(repeats * 4));
            let mut fallback = source("/archive/BUDGET fallback.txt", text);
            fallback.relative_path.clear();
            Corpus {
                query: "budget".into(), mode: "files".into(), limit: 10, format: "json".into(),
                files: vec![file, source("unrelated.txt", "budget"), fallback],
            }
        };
        let expected = evaluate(corpus(2, "")).unwrap();
        assert_eq!(expected["search"]["matchedFiles"], 2);
        for budget in [0, 128, 8 << 20] {
            assert_eq!(evaluate_with_feature_budget(corpus(12, "budget approval"), budget).unwrap(), expected);
        }
    }
    #[test]
    fn empty_bm25_sources_do_not_supply_filename_matches() {
        let value = run("budget", "bm25", vec![
            source("budget empty.txt", ""), source("ordinary.txt", "ordinary"),
            source("budget included.txt", "ordinary"), source("budget skipped.txt", ""),
            source("other.txt", "ordinary"),
        ]);
        assert_eq!(value["search"]["indexedFiles"], 5);
        assert_eq!(value["search"]["chunks"], 3);
        assert_eq!(value["search"]["matchedFiles"], 1);
        assert_eq!(value["search"]["results"][0]["path"], "budget included.txt");
        let empty = run("budget", "bm25", vec![source("budget.txt", "")]);
        assert_eq!(empty["search"]["chunks"], 0);
        assert_eq!(empty["search"]["matchedFiles"], 0);
        assert_eq!(empty["search"]["complete"], true);
    }
    #[test]
    fn bm25_filename_cap_still_adds_to_body_frequency() {
        let corpus = |repeats: usize| {
            let mut file = source("stable.txt", &"budget background\n".repeat(100));
            file.relative_path = format!("{}notes.txt", "budget ".repeat(repeats));
            Corpus {
                query: "budget".into(), mode: "bm25".into(), limit: 10, format: "json".into(),
                files: vec![file, source("none.txt", "ordinary background")],
            }
        };
        let expected = evaluate(corpus(2)).unwrap();
        for budget in [0, 128, 8 << 20] {
            assert_eq!(evaluate_with_feature_budget(corpus(12), budget).unwrap(), expected);
        }
    }
    #[test]
    fn full_text_tail_and_file_deduplication() {
        let text = format!(
            "{}\nneedle budget\n{}\nneedle risk",
            "boring text\n".repeat(500),
            "more text\n".repeat(500)
        );
        let value = run(
            "needle",
            "bm25",
            vec![source("large.txt", &text), source("second.txt", "needle")],
        );
        assert_eq!(value["search"]["matchedFiles"], 2);
        assert_eq!(value["search"]["returnedFiles"], 2);
        for hit in value["search"]["results"].as_array().unwrap() {
            assert!(hit["excerpts"].as_array().unwrap().len() <= 3);
        }
    }
    #[test]
    fn filename_mode_and_source_layout() {
        let names = run(
            "budget",
            "files",
            vec![source("budget.pdf", ""), source("other.exe", "")],
        );
        assert_eq!(names["search"]["matchedFiles"], 1);
        assert_eq!(names["search"]["results"][0]["excerpts"], json!([]));
        let mut file = source("contract.txt", "预算上限");
        file.layout = json!({"blocks":[{"startByte":0,"endByte":12,"page":2,"bounds":{"x":10}}],"pages":[{"index":2}]});
        let v = run("预算", "bm25", vec![file]);
        assert_eq!(
            v["search"]["results"][0]["excerpts"][0]["layout"]["blocks"][0]["page"],
            2
        );
    }
}
