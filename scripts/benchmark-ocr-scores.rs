// Included by benchmark-batch-matching.mjs after either production score helper.
use std::{hint::black_box, time::Instant};

fn main() {
    let mut results = Vec::new();
    for count in [32usize, 512, 4000] {
        let raw: String = (0..count).rev().map(|i| {
            format!("TextBox[{i}](+padding)[score({}),box(0,0,100,20)]\n", if i % 5 == 0 { "0.2" } else { "0.96" })
        }).collect();
        let expected = scores::confidences(&raw, count);
        let checksum: u64 = expected.iter().flatten().map(|v| (v * 100.0).round() as u64).sum();
        let start = Instant::now();
        black_box(scores::confidences(black_box(&raw), count));
        let repeats = (15.0 / (start.elapsed().as_secs_f64() * 1000.0).max(0.001)).ceil().clamp(1.0, 1000.0) as usize;
        let mut samples = Vec::new();
        for iteration in 0..12 {
            let start = Instant::now();
            for _ in 0..repeats {
                black_box(scores::confidences(black_box(&raw), count));
            }
            let ms = start.elapsed().as_secs_f64() * 1000.0 / repeats as f64;
            if iteration >= 3 { samples.push(ms); }
        }
        let unsorted = samples.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",");
        samples.sort_by(f64::total_cmp);
        results.push(format!("{{\"lines\":{count},\"checksum\":{checksum},\"repeats\":{repeats},\"medianMs\":{},\"samplesMs\":[{unsorted}]}}", samples[samples.len() / 2]));
    }
    println!("[{}]", results.join(","));
}
