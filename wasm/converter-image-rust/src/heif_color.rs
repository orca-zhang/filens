//! Fixed HEIF SDR preview policy in the frontend image core.
//! libheif owns container/codec parsing and YCbCr conversion. ICC takes priority
//! over NCLX; alpha never passes through a transfer curve or tone mapper.
use moxcms::{
    ColorProfile, DataColorSpace, Layout, ParsingOptions, ProfileClass, RenderingIntent,
    TransformOptions,
};
use serde::Deserialize;

const MAX_ICC: usize = 4 << 20;
const MAX_PIXELS: usize = 64_000_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raster {
    width: usize,
    height: usize,
    stride: usize,
    bits: u8,
    primaries: u16,
    transfer: u16,
    icc_length: usize,
}

pub fn normalize_packet(packet: &[u8]) -> Result<Vec<u8>, String> {
    let header = packet.get(..4).ok_or("Missing HEIF raster metadata")?;
    let length = u32::from_le_bytes(header.try_into().unwrap()) as usize;
    if length > 4096 {
        return Err("HEIF raster metadata exceeds its limit".into());
    }
    let end = 4 + length;
    let raster: Raster = serde_json::from_slice(
        packet
            .get(4..end)
            .ok_or("Incomplete HEIF raster metadata")?,
    )
    .map_err(|_| "Invalid HEIF raster metadata")?;
    if raster.icc_length > MAX_ICC {
        return Err("HEIF ICC profile exceeds its limit".into());
    }
    let profile_end = end + raster.icc_length;
    let profile = packet
        .get(end..profile_end)
        .ok_or("Incomplete HEIF ICC profile")?;
    let rgba = normalize(
        &raster,
        profile,
        packet.get(profile_end..).unwrap_or_default(),
    )?;
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, raster.width as u32, raster.height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_source_srgb(png::SrgbRenderingIntent::RelativeColorimetric);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(&rgba)
            .map_err(|error| error.to_string())?;
    }
    Ok(output)
}

fn normalize(raster: &Raster, icc: &[u8], source: &[u8]) -> Result<Vec<u8>, String> {
    let Raster {
        width,
        height,
        stride,
        bits,
        primaries,
        transfer,
        ..
    } = *raster;
    let unit = if bits > 8 { 2 } else { 1 };
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || width
            .checked_mul(height)
            .is_none_or(|pixels| pixels > MAX_PIXELS)
        || !(8..=16).contains(&bits)
        || stride < width * 4 * unit
        || stride > width * 4 * unit + 4096
        || stride.checked_mul(height) != Some(source.len())
    {
        return Err("Invalid HEIF raster dimensions, depth or stride".into());
    }
    let transform = if !icc.is_empty() {
        let profile = ColorProfile::new_from_slice_with_options(
            icc,
            ParsingOptions {
                max_profile_size: MAX_ICC + 1,
                max_allowed_clut_size: MAX_ICC,
                ..Default::default()
            },
        )
        .map_err(|_| "Invalid HEIF ICC profile")?;
        if profile.color_space != DataColorSpace::Rgb
            || !matches!(
                profile.profile_class,
                ProfileClass::InputDevice | ProfileClass::DisplayDevice | ProfileClass::ColorSpace
            )
        {
            return Err("HEIF ICC profile must describe RGB input".into());
        }
        Some(
            profile
                .create_transform_f32(
                    Layout::Rgba,
                    &ColorProfile::new_srgb(),
                    Layout::Rgba,
                    TransformOptions {
                        rendering_intent: RenderingIntent::RelativeColorimetric,
                        allow_use_cicp_transfer: false,
                        prefer_fixed_point: false,
                        ..Default::default()
                    },
                )
                .map_err(|_| "Unsupported HEIF ICC profile")?,
        )
    } else {
        None
    };
    let hdr = transform.is_none() && matches!(transfer, 16 | 18);
    let color = source_color(primaries);
    if hdr && color.is_none() {
        return Err("Unknown HEIF HDR color primaries".into());
    }
    let convert_nclx =
        transform.is_none() && color.is_some() && matches!(transfer, 1 | 4 | 8 | 13 | 16 | 18);
    let maximum = ((1u32 << bits) - 1) as f64;
    let mut output = vec![0u8; width * height * 4];
    // Fixed scratch, independent of raster size. Never allocate a full float image.
    let mut input = [0f32; 256 * 4];
    let mut converted = [0f32; 256 * 4];
    for y in 0..height {
        for x in (0..width).step_by(256) {
            let count = (width - x).min(256);
            for i in 0..count {
                let at = y * stride + (x + i) * 4 * unit;
                for channel in 0..4 {
                    let at = at + channel * unit;
                    let value = if unit == 2 {
                        u16::from_le_bytes([source[at], source[at + 1]]) as u32
                    } else {
                        source[at] as u32
                    };
                    if value as f64 > maximum {
                        return Err("HEIF sample exceeds its declared bit depth".into());
                    }
                    input[i * 4 + channel] = (value as f64 / maximum) as f32;
                }
            }
            if let Some(transform) = &transform {
                transform
                    .transform(&input[..count * 4], &mut converted[..count * 4])
                    .map_err(|_| "HEIF ICC conversion failed")?;
            } else {
                converted[..count * 4].copy_from_slice(&input[..count * 4]);
                if convert_nclx {
                    let (matrix, luma) = color.unwrap();
                    for pixel in converted[..count * 4].chunks_exact_mut(4) {
                        let mut rgb = [pixel[0] as f64, pixel[1] as f64, pixel[2] as f64];
                        for value in &mut rgb {
                            *value = linearize(*value, transfer);
                        }
                        if transfer == 18 {
                            let luminance = dot(luma, rgb);
                            let ootf = 10.0 * luminance.powf(0.2);
                            for value in &mut rgb {
                                *value *= ootf;
                            }
                        }
                        if hdr {
                            let signal = rgb[0].max(rgb[1]).max(rgb[2]);
                            let gain = if signal > 0.0 {
                                hable(signal) / hable(10.0) / signal
                            } else {
                                0.0
                            };
                            for value in &mut rgb {
                                *value *= gain;
                            }
                        }
                        for c in 0..3 {
                            pixel[c] = srgb(dot(matrix[c], rgb)) as f32;
                        }
                    }
                }
            }
            for i in 0..count {
                let at = (y * width + x + i) * 4;
                for c in 0..3 {
                    output[at + c] = quantize(converted[i * 4 + c]);
                }
                output[at + 3] = quantize(input[i * 4 + 3]);
            }
        }
    }
    Ok(output)
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn quantize(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}
fn srgb(value: f64) -> f64 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}
fn linearize(value: f64, transfer: u16) -> f64 {
    match transfer {
        16 => {
            let p = value.powf(32.0 / 2523.0);
            100.0
                * ((p - 3424.0 / 4096.0).max(0.0) / (2413.0 / 128.0 - 2392.0 / 128.0 * p))
                    .powf(16384.0 / 2610.0)
        }
        18 => {
            let a = 0.17883277;
            let b = 1.0 - 4.0 * a;
            let c = 0.5 - a * (4.0f64 * a).ln();
            if value <= 0.5 {
                value * value / 3.0
            } else {
                (((value - c) / a).exp() + b) / 12.0
            }
        }
        1 => {
            if value < 0.081 {
                value / 4.5
            } else {
                ((value + 0.099) / 1.099).powf(1.0 / 0.45)
            }
        }
        4 => value.powf(2.2),
        8 => value,
        _ => {
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        }
    }
}
fn hable(value: f64) -> f64 {
    (value * (0.15 * value + 0.10 * 0.50) + 0.20 * 0.02)
        / (value * (0.15 * value + 0.50) + 0.20 * 0.30)
        - 0.02 / 0.30
}

type Matrix = [[f64; 3]; 3];
fn source_color(primaries: u16) -> Option<(Matrix, [f64; 3])> {
    // D65 source linear RGB -> linear sRGB. Derived from CICP chromaticities.
    Some(match primaries {
        1 => (
            [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            [0.21263900587151033, 0.715168678767756, 0.07219231536073371],
        ),
        5 => (
            [
                [1.0440432088, -0.0440432088, 0.],
                [0., 1., 0.],
                [0., 0.0117933783, 0.9882066217],
            ],
            [0.2220043099982309, 0.7066547659252829, 0.07134092407648637],
        ),
        9 => (
            [
                [1.6604910021, -0.5876411388, -0.0728498633],
                [-0.1245504745, 1.1328998971, -0.0083494226],
                [-0.0181507634, -0.100578898, 1.1187296614],
            ],
            [0.26270021201126703, 0.6779980715188708, 0.05930171646986196],
        ),
        12 => (
            [
                [1.2249401763, -0.2249401763, 0.],
                [-0.0420569547, 1.0420569547, 0.],
                [-0.0196375546, -0.0786360456, 1.0982736002],
            ],
            [0.22897456406974875, 0.6917385218365064, 0.079286914093745],
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn raster(bits: u8, primaries: u16, transfer: u16) -> Raster {
        Raster {
            width: 1,
            height: 1,
            stride: if bits > 8 { 8 } else { 4 },
            bits,
            primaries,
            transfer,
            icc_length: 0,
        }
    }

    #[test]
    fn rejects_unbounded_or_inconsistent_rasters_and_unknown_hdr() {
        let mut image = raster(10, 9, 16);
        assert!(normalize(&image, &[], &[0; 7]).is_err());
        assert!(normalize(&image, &[], &[255; 8]).is_err());
        image.width = usize::MAX;
        assert!(normalize(&image, &[], &[]).is_err());
        assert!(normalize(&raster(8, 2, 16), &[], &[0, 0, 0, 255]).is_err());
        assert!(normalize(&raster(8, 9, 16), &[0; 128], &[0, 0, 0, 255]).is_err());
    }

    #[test]
    fn fixed_hdr_white_and_independent_alpha() {
        // ST2084 encodes 1000 nits as 0.751827096, fixed Hable white is 1000 nits.
        assert!((linearize(0.751827096, 16) - 10.0).abs() < 0.00001);
        assert!((linearize(1.0, 18) - 1.0).abs() < 0.00001);
        for transfer in [16, 18] {
            let result = normalize(
                &raster(10, 9, transfer),
                &[],
                &[255, 3, 255, 3, 255, 3, 0, 2],
            )
            .unwrap();
            assert_eq!(result, [255, 255, 255, 128]);
        }
    }

    #[test]
    fn icc_takes_priority_over_hdr_and_keeps_source_precision() {
        let mut profile = ColorProfile::new_srgb();
        let icc = profile.encode().unwrap();
        let source = [0, 2, 0, 2, 0, 2, 255, 3];
        let rgb = normalize(&raster(10, 9, 16), &icc, &source).unwrap();
        assert_eq!(rgb, [128, 128, 128, 255]);
        profile.color_space = DataColorSpace::Gray;
        assert!(normalize(&raster(10, 9, 16), &profile.encode().unwrap(), &source).is_err());
    }

    #[test]
    fn packet_validates_lengths_and_emits_tagged_lossless_png() {
        let json = br#"{"width":1,"height":1,"stride":4,"bits":8,"primaries":1,"transfer":13,"iccLength":0}"#;
        let mut packet = (json.len() as u32).to_le_bytes().to_vec();
        packet.extend_from_slice(json);
        assert!(normalize_packet(&packet).is_err());
        packet.extend_from_slice(&[32, 64, 128, 99]);
        let png = normalize_packet(&packet).unwrap();
        let mut decoder = png::Decoder::new(Cursor::new(png)).read_info().unwrap();
        assert_eq!(
            decoder.info().srgb,
            Some(png::SrgbRenderingIntent::RelativeColorimetric)
        );
        let mut pixels = [0; 4];
        decoder.next_frame(&mut pixels).unwrap();
        assert_eq!(pixels, [32, 64, 128, 99]);
        packet[..4].copy_from_slice(&4097u32.to_le_bytes());
        assert!(normalize_packet(&packet).is_err());
    }
}
