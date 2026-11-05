// Use the same protocol and validators; LTO removes unrelated document converters.
#![allow(dead_code)]
include!("main.rs");

fn main() {
    let started = Instant::now();
    let mut request = Request::default();
    let parsed = parse_request(&mut request);
    let input_size = fs::metadata(&request.input).map_or(0, |m| m.len());
    let conversion = parsed.map_err(io_error).and_then(|()| {
        if !graphics::supports(&request.source) {
            return Err(ConvertError {
                code: "unsupported_format",
                message: "Graphics module supports raster-to-PNG and DWG drawing models / DXF only".into(),
            });
        }
        validate_input(&request, input_size)?;
        graphics::convert(&request.input, &request.output, &request.source, &request.target)?;
        validate_output(&request.output, &request.target)
    });
    let result = match conversion {
        Ok(()) => success(
            &request,
            input_size,
            "graphics-preview",
            graphics::warning(&request.source),
        ),
        Err(e) => failure(&request, e.code, e.message, input_size, Some("graphics-preview")),
    };
    let ok = result.ok;
    if let Err(error) = write_result(&request.result, result, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
    process::exit(if ok { 0 } else { 1 });
}
