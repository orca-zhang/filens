//! Filename glob matching and conservative directory pruning, shared by all hosts.
pub struct PathGlob {
    segments: Vec<Segment>,
    basename_only: bool,
}

enum Segment {
    Recursive,
    Literal(String),
    Wildcard(String),
}

impl PathGlob {
    pub fn new(pattern: &str) -> Result<Self, String> {
        if pattern.is_empty()
            || pattern.len() > 4096
            || pattern.contains('\0')
            || pattern.split('/').any(|s| matches!(s, "" | "." | ".."))
        {
            return Err("glob must be a relative path pattern of 1–4096 UTF-8 bytes without empty, . or .. segments".into());
        }
        let basename_only = !pattern.contains('/');
        let segments = pattern
            .split('/')
            .map(|s| {
                if s == "**" {
                    Segment::Recursive
                } else if s.contains(['*', '?']) {
                    Segment::Wildcard(s.into())
                } else {
                    Segment::Literal(s.into())
                }
            })
            .collect();
        Ok(Self {
            segments,
            basename_only,
        })
    }

    pub fn is_match(&self, path: &str) -> bool {
        if self.basename_only {
            return self.segments[0].is_match(path.rsplit('/').next().unwrap_or(path));
        }
        self.matches(path, false)
    }

    pub fn could_match_descendant(&self, directory: &str) -> bool {
        self.basename_only || self.matches(directory, true)
    }

    fn matches(&self, path: &str, descendant: bool) -> bool {
        let mut active = vec![false; self.segments.len() + 1];
        let mut next = active.clone();
        active[0] = true;
        self.expand_recursive(&mut active);
        for name in path.split('/') {
            next.fill(false);
            for (i, segment) in self.segments.iter().enumerate() {
                if active[i] {
                    if matches!(segment, Segment::Recursive) {
                        next[i] = true;
                    } else if segment.is_match(name) {
                        next[i + 1] = true;
                    }
                }
            }
            self.expand_recursive(&mut next);
            if !next.iter().any(|&v| v) {
                return false;
            }
            std::mem::swap(&mut active, &mut next);
        }
        if descendant {
            active[..self.segments.len()].iter().any(|&v| v)
        } else {
            active[self.segments.len()]
        }
    }

    fn expand_recursive(&self, active: &mut [bool]) {
        for (i, segment) in self.segments.iter().enumerate() {
            if active[i] && matches!(segment, Segment::Recursive) {
                active[i + 1] = true;
            }
        }
    }
}

impl Segment {
    fn is_match(&self, name: &str) -> bool {
        let pattern = match self {
            Self::Recursive => return true,
            Self::Literal(pattern) => return pattern == name,
            Self::Wildcard(pattern) => pattern,
        };
        // Common extension/prefix globs need only two string comparisons.
        if let Some((prefix, suffix)) = pattern.split_once('*') {
            if !prefix.contains('?') && !suffix.contains(['*', '?']) {
                return name.len() >= prefix.len() + suffix.len()
                    && name.starts_with(prefix)
                    && name.ends_with(suffix);
            }
        }
        let (mut pattern, mut text) = (pattern.as_str(), name);
        let mut retry = None;
        while !text.is_empty() {
            let p = pattern.chars().next();
            let c = text.chars().next().unwrap();
            if p == Some('*') {
                pattern = &pattern[1..];
                retry = Some((pattern, text));
            } else if p == Some('?') || p == Some(c) {
                pattern = &pattern[p.unwrap().len_utf8()..];
                text = &text[c.len_utf8()..];
            } else if let Some((rest, tail)) = retry {
                let Some(c) = tail.chars().next() else {
                    return false;
                };
                let tail = &tail[c.len_utf8()..];
                retry = Some((rest, tail));
                pattern = rest;
                text = tail;
            } else {
                return false;
            }
        }
        pattern.bytes().all(|b| b == b'*')
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greedy_wildcards_agree_with_exhaustive_expansion() {
        fn reference(pattern: &[char], text: &[char]) -> bool {
            match pattern.split_first() {
                None => text.is_empty(),
                Some(('*', rest)) => {
                    reference(rest, text) || (!text.is_empty() && reference(pattern, &text[1..]))
                }
                Some((p, rest)) => {
                    !text.is_empty() && (*p == '?' || *p == text[0]) && reference(rest, &text[1..])
                }
            }
        }
        fn words(alphabet: &[char], length: usize) -> Vec<String> {
            let mut words = vec![String::new()];
            for _ in 0..length {
                words = words
                    .iter()
                    .flat_map(|word| alphabet.iter().map(move |c| format!("{word}{c}")))
                    .collect();
            }
            words
        }
        let names: Vec<_> = (0..=3).flat_map(|n| words(&['a', 'b', '🦀'], n)).collect();
        for pattern in (1..=4).flat_map(|n| words(&['a', 'b', '🦀', '*', '?'], n)) {
            let glob = PathGlob::new(&pattern).unwrap();
            let chars: Vec<_> = pattern.chars().collect();
            for name in &names {
                assert_eq!(
                    glob.is_match(name),
                    reference(&chars, &name.chars().collect::<Vec<_>>()),
                    "{pattern}: {name}"
                );
            }
        }
    }

    #[test]
    fn matching_and_pruning_preserve_path_and_unicode_semantics() {
        for (pattern, hits, misses, keep, prune) in [
            (
                "*.pdf",
                vec!["a.pdf", "资料/合同.pdf"],
                vec!["a.PDF", "a.pdf.txt"],
                vec!["any/depth"],
                vec![],
            ),
            (
                "reports/202?/合同*.pdf",
                vec!["reports/2026/合同.pdf"],
                vec!["reports/2026/deep/合同.pdf", "else/2026/合同.pdf"],
                vec!["reports", "reports/2026"],
                vec!["else", "reports/2026/deep", "reports/20266"],
            ),
            (
                "reports/**/合同?.pdf",
                vec!["reports/合同甲.pdf", "reports/a/b/合同🦀.pdf"],
                vec!["reports/合同.pdf", "reports/合同甲乙.pdf"],
                vec!["reports/a/b"],
                vec!["other"],
            ),
            (
                "**/a/**/b/*.txt",
                vec!["a/b/c.txt", "x/a/a/y/b/c.txt"],
                vec!["a/b/x/c.txt"],
                vec!["x/a/a/y/b"],
                vec![],
            ),
            (
                "a.zip!/**/*.pdf",
                vec!["a.zip!/合同.pdf", "a.zip!/b.zip!/合同.pdf"],
                vec!["b.zip!/合同.pdf"],
                vec!["a.zip!", "a.zip!/b.zip!"],
                vec!["b.zip!"],
            ),
            (
                "*ab*?c",
                vec!["abxc", "ababxc"],
                vec!["abc", "abxx"],
                vec!["folder"],
                vec![],
            ),
        ] {
            let glob = PathGlob::new(pattern).unwrap();
            for path in hits {
                assert!(glob.is_match(path), "{pattern}: {path}");
            }
            for path in misses {
                assert!(!glob.is_match(path), "{pattern}: {path}");
            }
            for path in keep {
                assert!(glob.could_match_descendant(path), "{pattern}: {path}");
            }
            for path in prune {
                assert!(!glob.could_match_descendant(path), "{pattern}: {path}");
            }
        }
        for pattern in ["", "/abs/*", "a//b", "a/../b", "./a", "a/", "a\0b"] {
            assert!(PathGlob::new(pattern).is_err(), "{pattern}");
        }
    }
}
