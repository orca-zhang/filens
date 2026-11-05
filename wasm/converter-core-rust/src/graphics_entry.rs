// Use the same protocol and validators; LTO removes unrelated document converters.
include!("main.rs");

fn graphics_entry<const CAD: bool, const RASTER: bool>() {
    let started = Instant::now();
    let mut request = Request::default();
    let parsed = parse_request(&mut request);
    let input_size = fs::metadata(&request.input).map_or(0, |m| m.len());
    let conversion = parsed.map_err(io_error).and_then(|()| {
        if !graphics::supports(&request.source) || (request.source == "dwg" && !CAD) || (request.source != "dwg" && !RASTER) {
            return Err(ConvertError {
                code: "unsupported_format",
                message: "Graphics module supports raster-to-PNG and DWG drawing models / DXF only".into(),
            });
        }
        validate_input(&request, input_size)?;
        if CAD && request.source == "dwg" {
            graphics::convert_dwg(&request.input, &request.output, &request.target)?;
            match request.target.as_str() {
                "dxf" => validate_output(&request.output, "dxf"),
                "cad-json" => validate_output(&request.output, "cad-json"),
                _ => Err(ConvertError { code: "unsupported_format", message: "Unsupported CAD target".into() }),
            }
        } else if RASTER {
            graphics::convert_raster(&request.input, &request.output, &request.source)?;
            validate_output(&request.output, "png")
        } else {
            unreachable!()
        }
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
