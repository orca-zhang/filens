//! Native design-file previews shared by browser and backend WASM hosts.
//! Photoshop previews use the saved composite, never a demo-specific sidecar.
use crate::{ConvertError, conversion_error, io_error, parse_error};
use flate2::read::ZlibDecoder;
use std::{fs, io::Read};

const MAX_BYTES: usize = 128 << 20;
pub const WARNING: &str = "Photoshop preview uses the saved merged image (8-bit RGB or grayscale, raw/RLE/ZIP compression). Layers are not editable; custom color profiles are not applied. Save with Maximize Compatibility enabled.";
pub const AI_WARNING: &str = "Illustrator preview preserves saved PDF-compatible artwork or interprets legacy PostScript artwork. Illustrator-only editing data is not interpreted. PostScript resident font outlines are omitted in this compact build.";
pub const POSTSCRIPT_WARNING: &str = "PostScript artwork is interpreted to vector PDF with a bounded execution budget. Built-in font outlines are omitted; standard PDF fonts and document-embedded fonts are supported. Resident-font charpath and features requiring unavailable fonts are rejected.";

pub fn warning(source: &str) -> &'static str {
    match source {
        "ai" => AI_WARNING,
        "eps" | "ps" => POSTSCRIPT_WARNING,
        _ => WARNING,
    }
}

pub fn supports(source: &str) -> bool {
    matches!(source, "psd" | "psb" | "ai" | "eps" | "ps")
}

pub fn convert(input: &str, output: &str, source: &str) -> Result<(), ConvertError> {
    let bytes = fs::read(input).map_err(|e| io_error(format!("read design file: {e}")))?;
    if source == "ai" && bytes.starts_with(b"%PDF-") {
        validate_pdf(&bytes)?;
        return fs::write(output, bytes).map_err(|e| io_error(format!("write AI PDF: {e}")));
    }
    if matches!(source, "ai" | "eps" | "ps") {
        #[cfg(feature = "postscript")]
        {
            let pdf = crate::postscript::convert(&bytes, source)?;
            return fs::write(output, pdf)
                .map_err(|e| io_error(format!("write PostScript PDF: {e}")));
        }
        #[cfg(not(feature = "postscript"))]
        return Err(ConvertError {
            code: "engine_unavailable",
            message: "PostScript preview requires converter-postscript.wasm".into(),
        });
    }
    let (width, height, pixels) = decode(&bytes, source)?;
    let file = fs::File::create(output).map_err(|e| io_error(format!("create design PNG: {e}")))?;
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|e| conversion_error(e.to_string()))?;
    writer
        .write_image_data(&pixels)
        .map_err(|e| conversion_error(e.to_string()))?;
    writer.finish().map_err(|e| conversion_error(e.to_string()))
}

pub fn validate_pdf(bytes: &[u8]) -> Result<(), ConvertError> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(unsupported(
            "Invalid PDF-compatible AI document: missing PDF signature.",
        ));
    }
    if !bytes.windows(5).rev().take(1024).any(|w| w == b"%%EOF") {
        return Err(parse_error(
            "PDF-compatible AI file is truncated (missing PDF EOF marker)".into(),
        ));
    }
    Ok(())
}

fn unsupported(message: &str) -> ConvertError {
    ConvertError {
        code: "unsupported_format",
        message: message.into(),
    }
}

fn invalid(message: &str) -> ConvertError {
    parse_error(format!("Photoshop: {message}"))
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], ConvertError> {
        let end = self
            .at
            .checked_add(length)
            .ok_or_else(|| invalid("section is too large"))?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| invalid("truncated file"))?;
        self.at = end;
        Ok(bytes)
    }
    fn u16(&mut self) -> Result<u16, ConvertError> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn length(&mut self, large: bool) -> Result<usize, ConvertError> {
        let value = if large {
            u64::from_be_bytes(self.take(8)?.try_into().unwrap())
        } else {
            u32::from_be_bytes(self.take(4)?.try_into().unwrap()) as u64
        };
        usize::try_from(value).map_err(|_| invalid("section is too large"))
    }
}

fn decode(bytes: &[u8], source: &str) -> Result<(u32, u32, Vec<u8>), ConvertError> {
    let mut r = Reader { bytes, at: 0 };
    if r.take(4)? != b"8BPS" {
        return Err(invalid("missing 8BPS signature"));
    }
    let version = r.u16()?;
    if version != if source == "psb" { 2 } else { 1 } {
        return Err(invalid("file version does not match the PSD/PSB extension"));
    }
    if r.take(6)? != [0; 6] {
        return Err(invalid("invalid reserved header bytes"));
    }
    let channels = r.u16()? as usize;
    let height = r.length(false)?;
    let width = r.length(false)?;
    let depth = r.u16()?;
    let mode = r.u16()?;
    if depth != 8 || !matches!(mode, 1 | 3) {
        return Err(unsupported(
            "Photoshop preview currently supports 8-bit RGB and grayscale documents. Convert the document color mode/depth and save with Maximize Compatibility enabled.",
        ));
    }
    let base_channels = if mode == 3 { 3 } else { 1 };
    let dimension_limit = if version == 1 { 30_000 } else { 300_000 };
    let count = width
        .checked_mul(height)
        .filter(|&n| n > 0 && n <= MAX_BYTES / 4)
        .ok_or_else(|| invalid("image dimensions exceed the preview memory limit"))?;
    if width > dimension_limit
        || height > dimension_limit
        || channels < base_channels
        || channels > 56
    {
        return Err(invalid("invalid dimensions or channel count"));
    }
    let planar_size = count
        .checked_mul(channels)
        .filter(|&n| n <= MAX_BYTES)
        .ok_or_else(|| invalid("channel data exceeds the preview memory limit"))?;
    let color_length = r.length(false)?;
    r.take(color_length)?;
    let resource_length = r.length(false)?;
    r.take(resource_length)?;
    let layer_length = r.length(version == 2)?;
    let layers = r.take(layer_length)?;
    // A negative layer count marks the first extra composite channel as alpha.
    // Positive counts may have spot/selection channels, which are not alpha.
    let merged_alpha = if layers.is_empty() {
        false
    } else {
        let mut layer = Reader {
            bytes: layers,
            at: 0,
        };
        let info_length = layer.length(version == 2)?;
        let info = layer.take(info_length)?;
        info.get(..2)
            .is_some_and(|b| i16::from_be_bytes(b.try_into().unwrap()) < 0)
    };
    let compression = r.u16()?;
    let mut planar = Vec::new();
    match compression {
        0 => planar.extend_from_slice(r.take(planar_size)?),
        1 => {
            let rows = channels * height;
            let mut lengths = Vec::with_capacity(rows);
            for _ in 0..rows {
                lengths.push(if version == 2 {
                    r.length(false)?
                } else {
                    r.u16()? as usize
                });
            }
            planar.reserve(planar_size);
            for length in lengths {
                let row = r.take(length)?;
                unpack_row(row, width, &mut planar)?;
            }
        }
        2 | 3 => {
            let mut decoder = ZlibDecoder::new(&bytes[r.at..]);
            (&mut decoder)
                .take(planar_size as u64 + 1)
                .read_to_end(&mut planar)
                .map_err(|e| invalid(&format!("invalid ZIP composite: {e}")))?;
            if planar.len() != planar_size {
                return Err(invalid("invalid ZIP composite length"));
            }
            if compression == 3 {
                for row in planar.chunks_exact_mut(width) {
                    for x in 1..width {
                        row[x] = row[x].wrapping_add(row[x - 1]);
                    }
                }
            }
        }
        _ => return Err(unsupported("Unsupported Photoshop composite compression")),
    }
    let mut rgba = vec![255; count * 4];
    for i in 0..count {
        for c in 0..3 {
            rgba[i * 4 + c] = planar[if mode == 3 { c * count + i } else { i }];
        }
        if merged_alpha && channels > base_channels {
            rgba[i * 4 + 3] = planar[base_channels * count + i];
        }
    }
    Ok((width as u32, height as u32, rgba))
}

fn unpack_row(bytes: &[u8], width: usize, output: &mut Vec<u8>) -> Result<(), ConvertError> {
    let end = output.len() + width;
    let mut r = Reader { bytes, at: 0 };
    while r.at < bytes.len() {
        let control = r.take(1)?[0] as i8;
        if control == -128 {
            continue;
        }
        let length = if control < 0 {
            (1 - control as i16) as usize
        } else {
            control as usize + 1
        };
        if output.len() + length > end {
            return Err(invalid("RLE row exceeds its declared width"));
        }
        if control < 0 {
            let value = r.take(1)?[0];
            output.resize(output.len() + length, value);
        } else {
            output.extend_from_slice(r.take(length)?);
        }
    }
    if output.len() != end {
        return Err(invalid("incomplete RLE row"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(version: u16, compression: u16, channels: u16, mode: u16, pixels: &[u8]) -> Vec<u8> {
        let mut b = b"8BPS".to_vec();
        b.extend(version.to_be_bytes());
        b.extend([0; 6]);
        b.extend(channels.to_be_bytes());
        b.extend(1u32.to_be_bytes());
        b.extend(2u32.to_be_bytes());
        b.extend(8u16.to_be_bytes());
        b.extend(mode.to_be_bytes());
        b.extend([0; 8]);
        b.extend(vec![0; if version == 2 { 8 } else { 4 }]);
        b.extend(compression.to_be_bytes());
        b.extend(pixels);
        b
    }

    #[test]
    fn decodes_raw_and_zip_rgb_without_treating_spot_channel_as_alpha() {
        for version in [1, 2] {
            for compression in [0, 2, 3] {
                let mut pixels = vec![255u8, 0, 0, 255, 0, 0, 42, 42];
                if compression == 3 {
                    for row in pixels.chunks_exact_mut(2) {
                        row[1] = row[1].wrapping_sub(row[0]);
                    }
                }
                if compression != 0 {
                    let mut z =
                        flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
                    z.write_all(&pixels).unwrap();
                    pixels = z.finish().unwrap();
                }
                let b = fixture(version, compression, 4, 3, &pixels);
                assert_eq!(
                    decode(&b, if version == 2 { "psb" } else { "psd" }).unwrap(),
                    (2, 1, vec![255, 0, 0, 255, 0, 255, 0, 255])
                );
            }
        }
    }

    #[test]
    fn decodes_packbits_for_both_versions_and_rejects_overflow() {
        for version in [1, 2] {
            let mut data = if version == 1 {
                vec![0, 3]
            } else {
                vec![0, 0, 0, 3]
            };
            data.extend([1, 12, 34]);
            let b = fixture(version, 1, 1, 1, &data);
            assert_eq!(
                decode(&b, if version == 2 { "psb" } else { "psd" })
                    .unwrap()
                    .2,
                vec![12, 12, 12, 255, 34, 34, 34, 255]
            );
        }
        assert!(unpack_row(&[254, 1], 2, &mut vec![]).is_err());
        assert!(unpack_row(&[1, 1], 2, &mut vec![]).is_err());
    }

    #[test]
    fn rejects_truncation_wrong_versions_and_unsupported_modes() {
        let b = fixture(1, 0, 3, 3, &[255, 0, 0, 255, 0, 0]);
        for end in 0..b.len() {
            assert!(decode(&b[..end], "psd").is_err());
        }
        assert!(decode(&b, "psb").is_err());
        assert!(decode(&fixture(1, 0, 4, 4, &[0; 8]), "psd").is_err());
        let mut huge = b.clone();
        huge[18..22].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(decode(&huge, "psd").is_err());
    }

    #[test]
    fn rejects_legacy_ai_and_incomplete_pdf() {
        assert!(validate_pdf(b"%!PS-Adobe-3.0").is_err());
        assert!(validate_pdf(b"%PDF-1.4\ntruncated").is_err());
        assert!(validate_pdf(b"%PDF-1.4\n%%EOF\n").is_ok());
    }
}
