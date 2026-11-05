//! Index detector records once per OCR result instead of rescanning for each line.
pub(super) fn confidences(raw: &str, count: usize) -> Vec<Option<f64>> {
    let mut records = vec![None; count];
    for line in raw.lines() {
        let Some((digits, _)) = line.strip_prefix("TextBox[").and_then(|s| s.split_once(']')) else {
            continue;
        };
        // Match the canonical decimal IDs emitted by format!("TextBox[{i}]").
        if digits.is_empty() || (digits.len() > 1 && digits.starts_with('0'))
            || !digits.bytes().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if let Some(slot) = digits.parse::<usize>().ok().and_then(|i| records.get_mut(i)) {
            // Preserve first-record wins, including a first record with no score.
            slot.get_or_insert(line);
        }
    }
    records.into_iter().map(|line| {
        line.and_then(|v| v.split_once("score("))
            .and_then(|(_, v)| v.split_once(')'))
            .and_then(|(v, _)| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_order_missing_scores_and_first_record_wins() {
        let raw = "TextBox[2]score(0.2)\nTextBox[0]score(0.96)\nTextBox[1]missing\nTextBox[1]score(0.99)\nTextBox[9999999999999999999999999999]score(1)";
        assert_eq!(confidences(raw, 4), vec![Some(0.96), None, Some(0.2), None]);
        assert!(confidences(raw, 0).is_empty());
    }

    #[test]
    fn rejects_noncanonical_ids_and_nonfinite_or_out_of_range_scores() {
        let raw = "TextBox[00]score(1)\nTextBox[+0]score(1)\n TextBox[0]score(1)\nTextBox[0]score(NaN)\nTextBox[1]score(inf)\nTextBox[2]score(-0.1)\nTextBox[3]score(1.1)\nTextBox[4]score(0)\nTextBox[5]score(1)";
        assert_eq!(confidences(raw, 6), vec![None, None, None, None, Some(0.0), Some(1.0)]);
    }

    #[test]
    fn agrees_with_linear_lookup_on_sparse_reordered_records() {
        let mut raw = String::new();
        for i in (0..300).rev().filter(|i| i % 7 != 0) {
            raw.push_str(&format!("TextBox[{i}]score({})\nTextBox[{i}]score(0.9)\n", if i % 3 == 0 { "invalid" } else { "0.82" }));
        }
        let expected: Vec<_> = (0..320).map(|i| {
            raw.lines().find(|v| v.starts_with(&format!("TextBox[{i}]")))
                .and_then(|v| v.split_once("score("))
                .and_then(|(_, v)| v.split_once(')'))
                .and_then(|(v, _)| v.parse::<f64>().ok())
                .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
        }).collect();
        assert_eq!(confidences(&raw, 320), expected);
    }
}
