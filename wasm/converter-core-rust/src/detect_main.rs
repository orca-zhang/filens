//! Optional research entry point. Production preview routing does not invoke it.
mod format_detection;

use serde::Serialize;
use std::{env, fs, io, process};

#[derive(Serialize)]
struct Row {
    path: String,
    #[serde(flatten)]
    detection: format_detection::Detection,
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().skip(1).collect();
    let paths: Vec<String> = match args.as_slice() {
        [flag, path] if flag == "--input" => vec![path.clone()],
        [flag, path] if flag == "--batch" => serde_json::from_slice(&fs::read(path)?)?,
        _ => return Err("usage: converter-detect --input FILE | --batch PATHS.json".into()),
    };
    let mut output = Vec::with_capacity(paths.len());
    for path in paths {
        let mut file = fs::File::open(&path)?;
        if !file.metadata()?.is_file() {
            return Err("detection input must be a regular file".into());
        }
        output.push(Row {
            path,
            detection: format_detection::detect(&mut file)?,
        });
    }
    serde_json::to_writer(io::stdout().lock(), &output)?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}
