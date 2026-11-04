// Share the WASI protocol and design parser with every host. LTO excludes the
// unrelated document converters from this on-demand browser module.
#![allow(dead_code)]
include!("main.rs");

fn main() {
    let started = Instant::now();
    let mut request = Request::default();
    let parsed = parse_request(&mut request);
    let input_size = fs::metadata(&request.input).map_or(0, |m| m.len());
    let conversion = parsed.map_err(|message| io_error(message)).and_then(|()| {
        if request.target != "pdf" || !matches!(request.source.as_str(), "eps" | "ps" | "ai") {
            return Err(ConvertError {
                code: "unsupported_format",
                message: "PostScript module supports EPS/PS/AI to PDF only".into(),
            });
        }
        design::convert(&request.input, &request.output, &request.source)
    });
    let result = match conversion {
        Ok(()) => success(
            &request,
            input_size,
            "design-preview",
            design::warning(&request.source),
        ),
        Err(e) => failure(
            &request,
            e.code,
            e.message,
            input_size,
            Some("design-preview"),
        ),
    };
    let ok = result.ok;
    if let Err(e) = write_result(&request.result, result, started.elapsed().as_millis()) {
        eprintln!("{e}");
        process::exit(1);
    }
    process::exit(if ok { 0 } else { 1 });
}
