//! Extraction origins and page selection are core policy, independent of layout output.
use super::*;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Origin {
    pub source: &'static str,
    pub confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_explicit_font_size_pt: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_part: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
}
impl Default for Origin {
    fn default() -> Self {
        Self {
            source: "text",
            confidence: None,
            confidence_kind: None,
            page: None,
            slide: None,
            shape: None,
            shape_name: None,
            placeholder: None,
            max_explicit_font_size_pt: None,
            source_part: None,
            media: None,
        }
    }
}
#[derive(Clone)]
pub(super) struct Span {
    pub start: usize,
    pub end: usize,
    pub origin: Origin,
}

pub(super) fn record(s: &mut State, start: usize, end: usize) {
    if start == end {
        return;
    }
    if let Some(last) = s
        .result
        .spans
        .last_mut()
        .filter(|v| v.end == start && v.origin == s.origin)
    {
        last.end = end;
    } else {
        s.result.spans.push(Span {
            start,
            end,
            origin: s.origin.clone(),
        });
    }
}
pub(super) fn warn(message: &str) {
    STATE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let s = slot.as_mut().unwrap();
        if s.result.warnings.len() < 32 && !s.result.warnings.iter().any(|v| v == message) {
            s.result.warnings.push(message.into());
        }
    });
}
pub(super) fn scoped(message: &str) -> String {
    STATE.with(|slot| {
        let s = slot.borrow();
        let o = &s.as_ref().unwrap().origin;
        let mut location = Vec::new();
        if let Some(slide) = o.slide { location.push(format!("slide={slide}")); }
        else if let Some(page) = o.page { location.push(format!("page={page}")); }
        if let Some(shape) = &o.shape { location.push(format!("shape={shape}")); }
        if let Some(media) = &o.media { location.push(format!("media={media}")); }
        if location.is_empty() { message.into() } else { format!("[{}] {message}", location.join(" ")) }
    })
}
pub(super) fn ocr_result(status: &str, accepted: usize, dropped: usize, reason: Option<&str>) {
    STATE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let s = slot.as_mut().unwrap();
        if s.result.ocr_results.len() >= 2048 { return; }
        let origin = serde_json::to_value(&s.origin).unwrap();
        let mut row = json!({"status":status,"acceptedLines":accepted,"droppedLines":dropped});
        for key in ["page","slide","shape","sourcePart","media"] {
            if !origin[key].is_null() { row[key] = origin[key].clone(); }
        }
        if let Some(reason) = reason { row["reason"] = json!(reason); }
        s.result.ocr_results.push(row);
    });
}
pub(super) fn skip_ocr(reason: &str) {
    warn(reason);
    ocr_result("skipped", 0, 0, Some("ocr=never"));
}
pub(super) fn selected(range: &str, total: u64) -> Result<Vec<u64>, ConvertError> {
    if range.is_empty() {
        return Ok((1..=total).collect());
    }
    if range.len() > 4096 {
        return Err(invalid("page range exceeds 4096 bytes"));
    }
    let mut chosen = std::collections::BTreeSet::new();
    for part in range.split(',') {
        let mut numbers = part.trim().split('-');
        let a = numbers
            .next()
            .unwrap_or("")
            .trim()
            .parse::<u64>()
            .map_err(|_| invalid("use one-based ranges such as 1-3,5"))?;
        let b = numbers
            .next()
            .map(|v| v.trim().parse::<u64>())
            .transpose()
            .map_err(|_| invalid("invalid page range"))?
            .unwrap_or(a);
        if numbers.next().is_some() || a == 0 || a > b || b > total {
            return Err(invalid(&format!("range {part:?} is outside 1..{total}")));
        }
        chosen.extend(a..=b);
    }
    Ok(chosen.into_iter().collect())
}
pub(super) fn invalid(message: &str) -> ConvertError {
    ConvertError {
        code: "invalid_request",
        message: message.into(),
    }
}
pub(super) fn page(index: u64, kind: &str) {
    STATE.with(|slot| {
        let mut slot = slot.borrow_mut();
        let s = slot.as_mut().unwrap();
        s.origin.page = Some(index);
        s.origin.slide = (kind == "slide").then_some(index);
        s.origin.shape = None;
    });
}
pub(super) fn finish_page(index: u64, kind: &str, start: usize, part: Option<&str>) {
    STATE.with(|slot| { let mut slot=slot.borrow_mut(); let s=slot.as_mut().unwrap();
        s.result.pages.push(json!({"index":index,"kind":kind,"sourcePart":part,"startByte":start,"endByte":s.result.text.len()}));
    });
}
pub(super) fn remap(spans: &mut Vec<Span>, excerpts: &[(usize, usize, usize)]) {
    let original = std::mem::take(spans);
    for &(a, b, out) in excerpts {
        for span in &original {
            let start = span.start.max(a);
            let end = span.end.min(b);
            if start < end {
                spans.push(Span {
                    start: out + start - a,
                    end: out + end - a,
                    origin: span.origin.clone(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_bounded_ordered_and_deduplicated() {
        assert_eq!(selected("3,1-2,2", 4).unwrap(), vec![1, 2, 3]);
        for range in ["0", "2-1", "5", "1-999999999999", "1,,2", "1-2-3"] {
            assert!(selected(range, 4).is_err(), "{range}");
        }
    }
}
