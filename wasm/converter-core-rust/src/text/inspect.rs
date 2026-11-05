//! Office package inventory. All ZIP/XML and image metadata parsing stays in the core.
use super::*;
use std::io::Cursor;

pub(super) fn validate(request: &Request) -> Result<(), ConvertError> {
    let o = &request.options_json;
    if let Some(value) = o.get("ocr") {
        if !matches!(value.as_str(), Some("auto" | "never" | "always")) {
            return Err(provenance::invalid("ocr must be auto, never or always"));
        }
    }
    if let Some(value) = o.get("ocrMinConfidence") {
        if !value
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
        {
            return Err(provenance::invalid(
                "ocrMinConfidence must be between 0 and 1",
            ));
        }
    }
    for key in ["slides", "pages"] {
        if o.get(key).is_some_and(|v| !v.is_string()) {
            return Err(provenance::invalid("slides/pages must be range strings"));
        }
    }
    if o.get("media").is_some_and(|v| !v.is_boolean()) {
        return Err(provenance::invalid("media must be boolean"));
    }
    if o.get("images").is_some_and(|v| !v.is_boolean()) {
        return Err(provenance::invalid("images must be boolean"));
    }
    if o.get("maxImages").is_some_and(|v| !v.as_u64().is_some_and(|n| (1..=16).contains(&n))) {
        return Err(provenance::invalid("maxImages must be an integer from 1 to 16"));
    }
    if o.get("imageNames").is_some_and(|v| !v.as_array().is_some_and(|a| a.len() <= 16 && a.iter().all(|v|v.as_str().is_some_and(|s|!s.is_empty()&&s.len()<=4096)))) {
        return Err(provenance::invalid("imageNames must contain at most 16 exact media names"));
    }
    if o["images"] == true && !matches!(request.source.as_str(), "pptx"|"pptm"|"ppsx"|"ppsm"|"potx"|"potm"|"docx"|"docm"|"dotx"|"dotm"|"xlsx"|"xlsm"|"xltx"|"xltm") {
        return Err(provenance::invalid("images currently requires an OpenXML Office document; use the image reader for standalone images"));
    }
    let slides = o["slides"].as_str().unwrap_or("");
    let pages = o["pages"].as_str().unwrap_or("");
    if !slides.is_empty()
        && !matches!(
            request.source.as_str(),
            "pptx" | "pptm" | "ppsx" | "ppsm" | "potx" | "potm"
        )
    {
        return Err(provenance::invalid(
            "slides selection currently requires an OpenXML presentation",
        ));
    }
    if !pages.is_empty() && request.source != "pdf" {
        return Err(provenance::invalid(
            "pages selection currently requires PDF; use slides for OpenXML presentations",
        ));
    }
    Ok(())
}
pub(super) fn slide_parts(z: &mut ZipArchive<File>) -> Result<Vec<String>, ConvertError> {
    let rels = relationships(z, "ppt/presentation.xml")?;
    let bytes = xml_entry(z, "ppt/presentation.xml")?;
    let mut reader = Reader::from_reader(bytes.as_slice());
    let mut result = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(v)) | Ok(Event::Empty(v))
                if local_name(v.name().as_ref()) == b"sldId" =>
            {
                if let Some(id) = v
                    .attributes()
                    .flatten()
                    .find(|a| a.key.as_ref().ends_with(b":id"))
                {
                    let id = String::from_utf8_lossy(&id.value);
                    result.push(
                        rels.get(id.as_ref())
                            .ok_or_else(|| parse_error("slide relationship is missing".into()))?
                            .clone(),
                    );
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(parse_error(e.to_string())),
            _ => {}
        }
    }
    Ok(result)
}

pub(super) fn media(request: &Request) -> Result<(), ConvertError> {
    let family = match request.source.as_str() {
        "pptx" | "pptm" | "ppsx" | "ppsm" | "potx" | "potm" => "ppt",
        "docx" | "docm" | "dotx" | "dotm" => "word",
        "xlsx" | "xlsm" | "xltx" | "xltm" => "xl",
        _ => return Ok(()),
    };
    let mut z = archive(&request.input)?;
    let family_prefix = format!("{family}/");
    let media_prefix = format!("{family}/media/");
    let mut media: Vec<_> = names(&z)
        .into_iter()
        .filter(|v| v.starts_with(&media_prefix) && !v.ends_with('/'))
        .collect();
    media.sort();
    let mut refs: HashMap<String, Vec<Value>> = HashMap::new();
    let slides = if family == "ppt" {
        slide_parts(&mut z)?
    } else {
        vec![]
    };
    // A repeated relationship to the same part still uses its first position.
    let mut slide_positions = HashMap::with_capacity(slides.len());
    for (i, part) in slides.iter().enumerate() {
        slide_positions.entry(part.as_str()).or_insert(i + 1);
    }
    let parts: Vec<_> = names(&z)
        .into_iter()
        .filter(|v| {
            v.starts_with(&family_prefix) && v.ends_with(".xml") && !v.contains("/_rels/")
        })
        .collect();
    for part in parts {
        let rels = relationships(&mut z, &part)?;
        if !rels
            .values()
            .any(|v| v.starts_with(&media_prefix))
        {
            continue;
        }
        let bytes = xml_entry(&mut z, &part)?;
        let mut reader = Reader::from_reader(bytes.as_slice());
        let slide = slide_positions.get(part.as_str()).copied();
        let mut shape = None;
        loop {
            match reader.read_event() {
                Ok(Event::Start(v)) | Ok(Event::Empty(v)) => {
                    let local = local_name(v.name().as_ref()).to_vec();
                    if local == b"cNvPr" {
                        shape = attribute(&v, b"id");
                    }
                    if matches!(local.as_slice(), b"blip" | b"imagedata" | b"image") {
                        if let Some((id, target)) = attribute(&v, b"embed")
                            .or_else(|| attribute(&v, b"id"))
                            .and_then(|id| rels.get(&id).map(|v| (id, v)))
                        {
                            if target.starts_with(&media_prefix) {
                                refs.entry(target.clone()).or_default().push(json!({"sourcePart":part,"slide":slide,"shape":shape,"relationship":id}));
                            }
                        }
                    }
                }
                Ok(Event::End(v))
                    if matches!(
                        local_name(v.name().as_ref()),
                        b"sp" | b"pic" | b"graphicFrame"
                    ) =>
                {
                    shape = None
                }
                Ok(Event::Eof) => break,
                Err(e) => return Err(parse_error(e.to_string())),
                _ => {}
            }
        }
    }
    let mut output = Vec::new();
    let mut images = Vec::new();
    let mut image_bytes = 0usize;
    let mut available = 0usize;
    let mut selected_count = 0usize;
    let max_images = request.options_json["maxImages"].as_u64().unwrap_or(4) as usize;
    let wanted: Vec<_> = request.options_json["imageNames"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    if wanted.iter().any(|name|!media.iter().any(|v|v==name)) {
        return Err(provenance::invalid("imageNames contains an unknown media name"));
    }
    let selected_slides = if family == "ppt" {
        provenance::selected(request.options_json["slides"].as_str().unwrap_or(""), slides.len() as u64)?
    } else { vec![] };
    // Cache each reference scan once. Stable sorting preserves the lexical
    // order established above for media on the same slide or without a slide.
    media.sort_by_cached_key(|name| refs.get(name).into_iter().flatten().filter_map(|r|r["slide"].as_u64()).min().unwrap_or(u64::MAX));
    let mut total = 0u64;
    for name in media {
        let size = z
            .by_name(&name)
            .map_err(|e| parse_error(e.to_string()))?
            .size();
        total = total
            .checked_add(size)
            .ok_or_else(|| parse_error("media size overflow".into()))?;
        if output.len() >= 2048 || total > MAX_INPUT {
            partial(
                "media_limit",
                "Media inventory reached its 2048-entry / 256 MiB expanded-byte limit.".into(),
            );
            break;
        }
        let bytes = entry(&mut z, &name)?;
        let dimensions = raster_codec::ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .ok()
            .and_then(|r| r.into_dimensions().ok());
        let format = raster_codec::guess_format(&bytes)
            .map(|v| format!("{v:?}").to_lowercase())
            .unwrap_or_else(|_| {
                Path::new(&name)
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_lowercase()
            });
        let (dpi, icc) = density_profile(&bytes);
        let used = refs.remove(&name).unwrap_or_default();
        let supported = matches!(format.as_str(), "png"|"jpeg"|"jpg"|"webp"|"gif"|"bmp"|"tiff"|"pnm"|"hdr"|"openexr");
        let mut record = json!({"name":name,"format":format,"width":dimensions.map(|v|v.0),"height":dimensions.map(|v|v.1),"dpi":dpi,"hasIccProfile":if bytes.starts_with(b"\x89PNG\r\n\x1a\n")||bytes.starts_with(b"\xff\xd8"){Some(icc)}else{None},"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes)),"referenced":!used.is_empty(),"usedBy":used,"inspection":if dimensions.is_some(){"header"}else if supported{"failed"}else{"unsupported"}});
        if supported && dimensions.is_none() {
            let warning = format!("[media={name}] Image header unreadable or truncated; dimensions are unavailable.");
            record["warning"] = json!(warning);
            provenance::warn(&warning);
        }
        let selected = if wanted.is_empty() {
            used.iter().any(|r| family != "ppt" || r["slide"].as_u64().is_some_and(|n|selected_slides.binary_search(&n).is_ok()))
        } else { wanted.contains(&name.as_str()) };
        if request.options_json["images"] == true && selected {
            available += 1;
            if selected_count < max_images {
                selected_count += 1;
                let mut image = json!({"name":name,"usedBy":used,"sourceSha256":record["sha256"],"sourceBytes":bytes.len()});
                match visual_image(&bytes) {
                    Ok((data, mime, width, height)) if image_bytes + data.len() <= 8 << 20 => {
                        image_bytes += data.len();
                        image["status"] = json!("ready"); image["mediaType"] = json!(mime);
                        image["width"] = json!(width); image["height"] = json!(height);
                        image["bytes"] = json!(data.len()); image["data"] = json!(encode_base64(&data));
                        record["inspection"] = json!("decoded");
                    }
                    result => {
                        let reason = match result { Err(e) => e, _ => "image payload exceeds the 8 MiB batch limit".into() };
                        image["status"] = json!("failed"); image["error"] = json!(reason);
                        record["inspection"] = json!("failed"); record["warning"] = json!(reason);
                        partial("image_unavailable", format!("[media={name}] {reason}"));
                    }
                }
                images.push(image);
            }
        }
        output.push(record);
    }
    if request.options_json["images"] == true && available > selected_count {
        partial("image_limit", format!("Returned {selected_count} of {available} selected images; narrow slides/imageNames or raise maxImages (max 16)."));
    }
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let r = &mut s.as_mut().unwrap().result;
        if request.options_json["media"] != false {
            r.media = Some(output);
            r.media_scope = Some("whole-package");
        }
        if request.options_json["images"] == true {
            r.images_info = Some(json!({"available":available,"returned":images.iter().filter(|v|v["status"]=="ready").count(),"remaining":available-selected_count,"scope":"embedded-media; Office layout is not rendered"}));
            r.images = Some(images);
        }
    });
    Ok(())
}

fn visual_image(bytes: &[u8]) -> Result<(Vec<u8>, &'static str, u32, u32), String> {
    use raster_codec::ImageDecoder;
    let mut reader = raster_codec::ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;
    let format = reader.format();
    let mut limits = raster_codec::Limits::default();
    limits.max_alloc = Some(128 << 20); limits.max_image_width = Some(32768); limits.max_image_height = Some(32768);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|e|e.to_string())?;
    let (width,height) = decoder.dimensions();
    if u64::from(width)*u64::from(height) > 32_000_000 { return Err("image exceeds the 32 million pixel decode limit".into()); }
    let orientation = decoder.orientation().map_err(|e|e.to_string())?;
    let mut decoded = raster_codec::DynamicImage::from_decoder(decoder).map_err(|e|e.to_string())?;
    // Decode fully even on passthrough: a readable header does not prove valid pixels.
    if width.max(height) <= 1600 && bytes.len() <= 2 << 20 {
        let mime = match format { Some(raster_codec::ImageFormat::Png)=>Some("image/png"),Some(raster_codec::ImageFormat::Jpeg)=>Some("image/jpeg"),Some(raster_codec::ImageFormat::WebP)=>Some("image/webp"),Some(raster_codec::ImageFormat::Gif)=>Some("image/gif"),_=>None };
        if let Some(mime) = mime { return Ok((bytes.into(),mime,width,height)); }
    }
    decoded.apply_orientation(orientation);
    let decoded = decoded.thumbnail(1600,1600);
    let (width,height) = (decoded.width(),decoded.height());
    let mut output = Vec::new();
    let mime = if decoded.color().has_alpha() {
        decoded.write_to(&mut Cursor::new(&mut output),raster_codec::ImageFormat::Png).map_err(|e|e.to_string())?;
        "image/png"
    } else {
        raster_codec::codecs::jpeg::JpegEncoder::new_with_quality(&mut output,85).encode_image(&decoded.to_rgb8()).map_err(|e|e.to_string())?;
        "image/jpeg"
    };
    Ok((output,mime,width,height))
}
fn encode_base64(bytes: &[u8]) -> String {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(bytes.len().div_ceil(3)*4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0])<<16) | (u32::from(*chunk.get(1).unwrap_or(&0))<<8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 { result.push(if i > chunk.len() { '=' } else { ABC[((n>>(18-6*i))&63) as usize] as char }); }
    }
    result
}

fn density_profile(bytes: &[u8]) -> (Option<Value>, bool) {
    let mut dpi = None;
    let mut icc = false;
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let mut at = 8usize;
        while let Some(header) = bytes.get(at..at.saturating_add(8)) {
            let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
            let Some(end) = at
                .checked_add(12)
                .and_then(|v| v.checked_add(length))
                .filter(|v| *v <= bytes.len())
            else {
                break;
            };
            let data = &bytes[at + 8..end - 4];
            if &header[4..] == b"iCCP" {
                icc = true;
            }
            if &header[4..] == b"pHYs" && data.len() == 9 && data[8] == 1 {
                dpi = Some(
                    json!({"x":u32::from_be_bytes(data[..4].try_into().unwrap()) as f64*0.0254,"y":u32::from_be_bytes(data[4..8].try_into().unwrap()) as f64*0.0254}),
                );
            }
            at = end;
        }
    } else if bytes.starts_with(b"\xff\xd8") {
        let mut at = 2;
        while bytes.get(at) == Some(&0xff) {
            while bytes.get(at) == Some(&0xff) {
                at += 1;
            }
            let Some(&marker) = bytes.get(at) else { break };
            at += 1;
            if matches!(marker, 0xda | 0xd9) {
                break;
            }
            if matches!(marker, 0x01 | 0xd0..=0xd8) {
                continue;
            }
            let Some(len) = bytes.get(at..at + 2) else {
                break;
            };
            let length = u16::from_be_bytes(len.try_into().unwrap()) as usize;
            if length < 2 {
                break;
            }
            let Some(data) = bytes.get(at + 2..at + length) else {
                break;
            };
            if marker == 0xe2 && data.starts_with(b"ICC_PROFILE\0") {
                icc = true;
            }
            if marker == 0xe0 && data.starts_with(b"JFIF\0") && data.len() >= 12 {
                let unit = match data[7] {
                    1 => 1.0,
                    2 => 2.54,
                    _ => 0.0,
                };
                if unit > 0.0 {
                    dpi = Some(
                        json!({"x":u16::from_be_bytes(data[8..10].try_into().unwrap()) as f64*unit,"y":u16::from_be_bytes(data[10..12].try_into().unwrap()) as f64*unit}),
                    );
                }
            }
            if marker == 0xe1 && data.starts_with(b"Exif\0\0") {
                dpi = exif_density(&data[6..]).or(dpi);
            }
            at += length;
        }
    }
    (dpi, icc)
}
fn exif_density(bytes: &[u8]) -> Option<Value> {
    let little = match bytes.get(..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16at = |at: usize| -> Option<u16> {
        let b = bytes.get(at..at.checked_add(2)?)?.try_into().ok()?;
        Some(if little {
            u16::from_le_bytes(b)
        } else {
            u16::from_be_bytes(b)
        })
    };
    let u32at = |at: usize| -> Option<u32> {
        let b = bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
        Some(if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        })
    };
    if u16at(2)? != 42 {
        return None;
    }
    let base = u32at(4)? as usize;
    let count = (u16at(base)? as usize).min(4096);
    let mut x = None;
    let mut y = None;
    let mut unit = 2;
    for i in 0..count {
        let at = base + 2 + i * 12;
        let tag = u16at(at)?;
        let kind = u16at(at + 2)?;
        if u32at(at + 4)? != 1 {
            continue;
        }
        if tag == 0x128 && kind == 3 {
            unit = u16at(at + 8)?;
        }
        if matches!(tag, 0x11a | 0x11b) && kind == 5 {
            let p = u32at(at + 8)? as usize;
            let a = u32at(p)?;
            let b = u32at(p + 4)?;
            if b > 0 {
                let value = a as f64 / b as f64;
                if tag == 0x11a {
                    x = Some(value)
                } else {
                    y = Some(value)
                }
            }
        }
    }
    let factor = match unit {
        2 => 1.0,
        3 => 2.54,
        _ => return None,
    };
    Some(json!({"x":x?*factor,"y":y?*factor}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn visual_payloads_decode_resize_and_reject_corrupt_pixels() {
        for length in 0..10 {
            let bytes: Vec<_> = (0..length).map(|i|i as u8).collect();
            assert_eq!(decode_base64(&encode_base64(&bytes)).unwrap(), bytes);
        }
        let mut small = Cursor::new(Vec::new());
        raster_codec::DynamicImage::ImageRgba8(raster_codec::RgbaImage::from_pixel(2,3,raster_codec::Rgba([3,7,11,255]))).write_to(&mut small,raster_codec::ImageFormat::Png).unwrap();
        let bytes = small.into_inner();
        let (data,mime,w,h) = visual_image(&bytes).unwrap();
        assert_eq!((mime,w,h),("image/png",2,3)); assert_eq!(data,bytes);
        assert!(visual_image(&bytes[..bytes.len()/2]).is_err());
        let mut large = Cursor::new(Vec::new());
        raster_codec::DynamicImage::ImageRgb8(raster_codec::RgbImage::from_pixel(2000,10,raster_codec::Rgb([0,128,255]))).write_to(&mut large,raster_codec::ImageFormat::Png).unwrap();
        let (data,mime,w,h) = visual_image(&large.into_inner()).unwrap();
        assert_eq!((mime,w,h),("image/jpeg",1600,8));
        assert_eq!(raster_codec::ImageReader::new(Cursor::new(data)).with_guessed_format().unwrap().into_dimensions().unwrap(),(w,h));
    }
    #[test]
    fn png_density_and_profile_are_from_headers_not_assumed() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend(9u32.to_be_bytes());
        bytes.extend(b"pHYs");
        bytes.extend(6300u32.to_be_bytes());
        bytes.extend(6300u32.to_be_bytes());
        bytes.push(1);
        bytes.extend([0; 4]);
        bytes.extend(0u32.to_be_bytes());
        bytes.extend(b"iCCP");
        bytes.extend([0; 4]);
        let (dpi, icc) = density_profile(&bytes);
        assert!(icc);
        assert!((dpi.unwrap()["x"].as_f64().unwrap() - 160.02).abs() < 0.001);
        assert_eq!(density_profile(b"no metadata"), (None, false));
        for length in 0..bytes.len() {
            let _ = density_profile(&bytes[..length]);
        }
    }
    #[test]
    fn exif_density_supports_both_byte_orders() {
        for little in [true, false] {
            let u16b = |v: u16| {
                if little {
                    v.to_le_bytes()
                } else {
                    v.to_be_bytes()
                }
            };
            let u32b = |v: u32| {
                if little {
                    v.to_le_bytes()
                } else {
                    v.to_be_bytes()
                }
            };
            let mut b = if little {
                b"II".to_vec()
            } else {
                b"MM".to_vec()
            };
            b.extend(u16b(42));
            b.extend(u32b(8));
            b.extend(u16b(3));
            for (tag, kind, value) in [(0x11a, 5, 50), (0x11b, 5, 58), (0x128, 3, 2)] {
                b.extend(u16b(tag));
                b.extend(u16b(kind));
                b.extend(u32b(1));
                if kind == 3 {
                    b.extend(u16b(value as u16));
                    b.extend([0; 2]);
                } else {
                    b.extend(u32b(value));
                }
            }
            b.extend([0; 4]);
            for n in [160, 1, 160, 1] {
                b.extend(u32b(n));
            }
            assert_eq!(exif_density(&b), Some(json!({"x":160.0,"y":160.0})));
            for length in 0..b.len() {
                let _ = exif_density(&b[..length]);
            }
        }
    }
}
