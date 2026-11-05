//! Optional browser graphics conversion. Hosts only select and invoke this WASM module.
use super::ConvertError;

pub fn supports(source: &str) -> bool {
    matches!(source, "dwg" | "tif" | "tiff" | "tga" | "pgm" | "pbm" | "pnm" | "dds" | "hdr"
        | "dib" | "cur" | "pcx" | "exr" | "jxl" | "qoi" | "ff")
}

pub fn warning(source: &str) -> &'static str {
    match source {
        "dwg" => "DWG is converted to UTF-8 DXF for 2D preview; unsupported CAD entities, proxy objects, external references and SHX fonts may be simplified or omitted.",
        "tif" | "tiff" => "TIFF preview displays the first image; additional pages, geospatial metadata, print profiles and high-bit-depth data are not preserved in the 8-bit PNG preview.",
        "hdr" => "HDR preview is converted to an 8-bit sRGB PNG; the full floating-point dynamic range is not preserved.",
        "dds" => "DDS preview displays the first surface; mipmaps, array layers and additional cube faces are not preserved.",
        "cur" => "Cursor preview displays the largest embedded image; the cursor hotspot is not applied.",
        "exr" => "OpenEXR preview displays the default image and color channels as an 8-bit PNG; additional parts, layers and full floating-point dynamic range are not preserved.",
        "jxl" => "JPEG XL preview displays the first frame as an 8-bit PNG; animation, HDR dynamic range and print profiles are not preserved.",
        _ => "Raster image is decoded to an 8-bit PNG preview in the WASM conversion core.",
    }
}

#[cfg(not(feature = "graphics-preview"))]
pub fn convert(_input: &str, _output: &str, _source: &str) -> Result<(), ConvertError> {
    Err(ConvertError {
        code: "engine_unavailable",
        message: "Graphics preview requires converter-graphics.wasm".into(),
    })
}

#[cfg(feature = "graphics-preview")]
pub fn convert(input: &str, output: &str, source: &str) -> Result<(), ConvertError> {
    use super::{conversion_error, io_error, parse_error};
    use std::{fs::File, io::{BufReader, Cursor}};
    if source == "dwg" {
        let options = acadrust::DwgReadOptions::default()
            .with_max_decompressed_bytes(256 << 20)
            .with_mesh_limits(1_000_000, 4_000_000);
        let document = acadrust::DwgReader::from_file_with_options(input, options)
            .and_then(|mut reader| reader.read())
            .map_err(|e| parse_error(format!("Read DWG: {e}")))?;
        // Modern DXF uses UTF-8; retaining an older DWG code page would garble
        // non-ASCII text in the browser's existing DXF reader.
        return acadrust::DxfWriter::new(&document)
            .with_version(acadrust::types::DxfVersion::AC1032)
            .write_to_file(output)
            .map_err(|e| conversion_error(format!("Write DXF: {e}")));
    }
    use raster_codec::{ImageDecoder, ImageFormat, ImageReader, Limits};
    if source == "pcx" {
        return write_png(output, read_pcx(input)?);
    }
    let format = match source {
        "tif" | "tiff" => ImageFormat::Tiff,
        "tga" => ImageFormat::Tga,
        "pgm" | "pbm" | "pnm" => ImageFormat::Pnm,
        "dds" => ImageFormat::Dds,
        "hdr" => ImageFormat::Hdr,
        "exr" => ImageFormat::OpenExr,
        "qoi" => ImageFormat::Qoi,
        "ff" => ImageFormat::Farbfeld,
        "dib" | "cur" | "jxl" => ImageFormat::Bmp, // Handled by explicit decoders below.
        _ => return Err(parse_error(format!("Unsupported raster source: {source}"))),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(256 << 20);
    let file = BufReader::new(File::open(input).map_err(|e| io_error(e.to_string()))?);
    let mut decoder: Box<dyn ImageDecoder> = match source {
        "dib" => Box::new(raster_codec::codecs::bmp::BmpDecoder::new_without_file_header(file)
            .map_err(|e| parse_error(e.to_string()))?),
        "cur" => {
            let mut bytes = std::fs::read(input).map_err(|e| io_error(e.to_string()))?;
            if bytes.len() < 6 || bytes[..4] != [0, 0, 2, 0] {
                return Err(parse_error("Invalid CUR header".into()));
            }
            let count = usize::from(u16::from_le_bytes([bytes[4], bytes[5]]));
            if count == 0 || count > 256 || bytes.len() < 6 + count * 16 {
                return Err(parse_error("Invalid CUR image directory".into()));
            }
            // CUR shares ICO image data and directories; hotspot fields replace
            // planes/bit depth. Normalize those fields before using the ICO decoder.
            bytes[2] = 1;
            for entry in bytes[6..6 + count * 16].chunks_exact_mut(16) {
                entry[4..8].copy_from_slice(&[1, 0, 32, 0]);
            }
            Box::new(raster_codec::codecs::ico::IcoDecoder::new(Cursor::new(bytes))
                .map_err(|e| parse_error(e.to_string()))?)
        }
        "jxl" => Box::new(jxl_oxide::integration::JxlDecoder::new(file)
            .map_err(|e| parse_error(e.to_string()))?),
        _ => {
            let mut reader = ImageReader::with_format(file, format);
            reader.limits(limits.clone());
            Box::new(reader.into_decoder().map_err(|e| parse_error(e.to_string()))?)
        }
    };
    decoder.set_limits(limits).map_err(|e| parse_error(e.to_string()))?;
    let (width, height) = decoder.dimensions();
    // Bound both decoded samples and the final RGBA buffer before allocating.
    if u64::from(width) * u64::from(height) > 32_000_000 || decoder.total_bytes() > 256 << 20 {
        return Err(parse_error("Raster image exceeds the 32 megapixel / 256 MiB preview limit".into()));
    }
    let orientation = decoder.orientation().map_err(|e| parse_error(e.to_string()))?;
    let mut image = raster_codec::DynamicImage::from_decoder(decoder)
        .map_err(|e| parse_error(e.to_string()))?;
    image.apply_orientation(orientation);
    if matches!(source, "hdr" | "exr") {
        // Floating-point lighting formats store linear samples. Apply the sRGB
        // transfer function so the browser does not display midtones too dark.
        let rgba = image.into_rgba32f();
        let preview = raster_codec::RgbaImage::from_fn(rgba.width(), rgba.height(), |x, y| {
            let pixel = rgba.get_pixel(x, y);
            let encode = |value: f32| {
                let value = if value.is_finite() { value.clamp(0.0, 1.0) } else { 0.0 };
                let srgb = if value <= 0.0031308 { value * 12.92 } else { 1.055 * value.powf(1.0 / 2.4) - 0.055 };
                (srgb * 255.0).round() as u8
            };
            raster_codec::Rgba([encode(pixel[0]), encode(pixel[1]), encode(pixel[2]), (pixel[3].clamp(0.0, 1.0) * 255.0).round() as u8])
        });
        return write_png(output, preview);
    }
    write_png(output, image.to_rgba8())
}

#[cfg(feature = "graphics-preview")]
fn write_png(output: &str, rgba: raster_codec::RgbaImage) -> Result<(), ConvertError> {
    use super::{conversion_error, io_error};
    use std::{fs::File, io::BufWriter};
    let file = File::create(output).map_err(|e| io_error(e.to_string()))?;
    let mut encoder = png::Encoder::new(BufWriter::new(file), rgba.width(), rgba.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().and_then(|mut writer| writer.write_image_data(rgba.as_raw()))
        .map_err(|e| conversion_error(format!("Write PNG: {e}")))
}

#[cfg(feature = "graphics-preview")]
fn read_pcx(input: &str) -> Result<raster_codec::RgbaImage, ConvertError> {
    use super::parse_error;
    let mut reader = pcx::Reader::from_file(input).map_err(|e| parse_error(e.to_string()))?;
    let (width, height) = reader.dimensions();
    let (width, height) = (u32::from(width), u32::from(height));
    if width == 0 || height == 0 || width > 32_768 || height > 32_768 || u64::from(width) * u64::from(height) > 32_000_000 {
        return Err(parse_error("PCX exceeds the 32 megapixel preview limit".into()));
    }
    if !reader.is_paletted() {
        let mut rgb = vec![0; width as usize * height as usize * 3];
        reader.read_rgb_pixels(&mut rgb).map_err(|e| parse_error(e.to_string()))?;
        let image = raster_codec::RgbImage::from_raw(width, height, rgb)
            .ok_or_else(|| parse_error("Invalid PCX raster".into()))?;
        return Ok(raster_codec::DynamicImage::ImageRgb8(image).to_rgba8());
    }
    let mut palette = [0; 256 * 3];
    let colors = reader.get_palette(&mut palette).map_err(|e| parse_error(e.to_string()))?;
    let mut image = raster_codec::RgbaImage::new(width, height);
    let mut row = vec![0; width as usize];
    for y in 0..height {
        // Do not use pcx's convenience indexed decoder: it tolerates truncated
        // scanlines. Preview must report damaged files instead of inventing pixels.
        reader.next_row_paletted(&mut row).map_err(|e| parse_error(e.to_string()))?;
        for (x, index) in row.iter().copied().enumerate() {
            let index = usize::from(index);
            if index >= colors { return Err(parse_error("PCX palette index is out of bounds".into())); }
            image.put_pixel(x as u32, y, raster_codec::Rgba([palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2], 255]));
        }
    }
    Ok(image)
}
