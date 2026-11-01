//! Application icon extraction, shared by browser WASM and backend WASM hosts.
//! No package code is executed and no paths from a package are written to disk.
use crate::{ConvertError, best_icns_png, io_error, parse_error, png_bounds, png_dimensions};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read},
};
use crate::zip_io::{self, Archive};

const MAX_ICON_BYTES: u64 = 16 << 20;
const MAX_PIXELS: usize = 4096 * 4096;
type IconResult<T> = Result<T, ConvertError>;

pub fn supports(source: &str) -> bool {
    matches!(
        source,
        "apk" | "ipa" | "exe" | "dll" | "mui" | "mun" | "ico"
    )
}

pub fn convert(input: &str, output: &str, source: &str) -> IconResult<()> {
    let bytes = fs::read(input).map_err(|e| io_error(format!("read application: {e}")))?;
    let icon = extract(&bytes, source)?;
    fs::write(output, icon).map_err(|e| io_error(format!("write application icon: {e}")))
}

fn invalid(message: &str) -> ConvertError {
    parse_error(format!("Application icon: {message}"))
}
fn u16le(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        b.get(at..at.checked_add(2)?)?.try_into().ok()?,
    ))
}
fn u32le(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        b.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}
fn be_int(b: &[u8]) -> Option<usize> {
    if b.len() > 8 {
        return None;
    }
    b.iter()
        .try_fold(0usize, |n, v| n.checked_mul(256)?.checked_add(*v as usize))
}

fn extract(bytes: &[u8], source: &str) -> IconResult<Vec<u8>> {
    match source {
        "apk" | "ipa" => package_icon(bytes, source),
        "ico" => {
            if u16le(bytes, 0) != Some(0) || u16le(bytes, 2) != Some(1) {
                return Err(invalid("invalid ICO header"));
            }
            let count = u16le(bytes, 4).unwrap_or(0) as usize;
            if count > 4096 {
                return Err(invalid("too many ICO frames"));
            }
            largest((0..count).filter_map(|i| {
                let at = 6 + i * 16;
                let len = u32le(bytes, at + 8)? as usize;
                let start = u32le(bytes, at + 12)? as usize;
                decode_icon(bytes.get(start..start.checked_add(len)?)?).ok()
            }))
        }
        _ => pe_icon(bytes),
    }
}

fn largest(icons: impl Iterator<Item = Vec<u8>>) -> IconResult<Vec<u8>> {
    icons
        .filter_map(|png| {
            let (w, h) = png_dimensions(&png)?;
            Some((u64::from(w) * u64::from(h), png))
        })
        .max_by_key(|(area, _)| *area)
        .map(|(_, png)| png)
        .ok_or_else(|| invalid("no supported raster icon found"))
}

fn decode_icon(bytes: &[u8]) -> IconResult<Vec<u8>> {
    if png_bounds(bytes) == Some(bytes.len()) {
        if bytes.get(12..16) == Some(b"CgBI") {
            return decode_cgbi(bytes);
        }
        return Ok(bytes.to_vec());
    }
    if let Some(png) = best_icns_png(bytes) {
        return Ok(png.to_vec());
    }
    // Windows icons contain a bottom-up DIB followed by an AND transparency mask.
    let header = u32le(bytes, 0).ok_or_else(|| invalid("truncated icon"))? as usize;
    let w = u32le(bytes, 4).unwrap_or(0) as usize;
    let stored_h = u32le(bytes, 8).unwrap_or(0) as usize;
    let h = stored_h / 2;
    let depth = u16le(bytes, 14).unwrap_or(0) as usize;
    if header < 40
        || header > bytes.len()
        || w == 0
        || h == 0
        || stored_h % 2 != 0
        || w.checked_mul(h).is_none_or(|p| p > MAX_PIXELS)
        || !matches!(depth, 1 | 4 | 8 | 24 | 32)
        || u16le(bytes, 12) != Some(1)
        || u32le(bytes, 16) != Some(0)
    {
        return Err(invalid("unsupported DIB icon"));
    }
    let colors = if depth <= 8 {
        u32le(bytes, 32).unwrap_or(0) as usize
    } else {
        0
    };
    let colors = if depth <= 8 && colors == 0 {
        1 << depth
    } else {
        colors
    };
    if colors > 256 {
        return Err(invalid("invalid icon palette"));
    }
    let start = header + colors * 4;
    let stride = (w * depth).div_ceil(32) * 4;
    let mask_start = start + stride * h;
    let mask_stride = w.div_ceil(32) * 4;
    let raster = bytes
        .get(start..mask_start)
        .ok_or_else(|| invalid("truncated DIB raster"))?;
    let mask = bytes.get(mask_start..mask_start + mask_stride * h);
    if depth != 32 && mask.is_none() {
        return Err(invalid("truncated DIB mask"));
    }
    let has_alpha =
        depth == 32 && (0..h).any(|y| (0..w).any(|x| raster[y * stride + x * 4 + 3] != 0));
    let mut rgba = vec![0; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let row = (h - y - 1) * stride;
            let color = if depth >= 24 {
                let at = row + x * (depth / 8);
                [
                    raster[at + 2],
                    raster[at + 1],
                    raster[at],
                    if has_alpha { raster[at + 3] } else { 255 },
                ]
            } else {
                let index = match depth {
                    8 => raster[row + x] as usize,
                    4 => ((raster[row + x / 2] >> (4 * (1 - x % 2))) & 15) as usize,
                    _ => ((raster[row + x / 8] >> (7 - x % 8)) & 1) as usize,
                };
                if index >= colors {
                    return Err(invalid("invalid palette index"));
                }
                let at = header + index * 4;
                [bytes[at + 2], bytes[at + 1], bytes[at], 255]
            };
            let at = (y * w + x) * 4;
            rgba[at..at + 4].copy_from_slice(&color);
            if mask.is_some_and(|m| m[(h - y - 1) * mask_stride + x / 8] & (0x80 >> (x % 8)) != 0) {
                rgba[at + 3] = 0;
            }
        }
    }
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, w as u32, h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| invalid("PNG header encoding failed"))?;
        writer
            .write_image_data(&rgba)
            .map_err(|_| invalid("PNG raster encoding failed"))?;
    }
    Ok(png)
}

// iOS packages may use Apple's raw-deflate, premultiplied BGRA PNG variant.
fn decode_cgbi(bytes: &[u8]) -> IconResult<Vec<u8>> {
    let mut at = 8;
    let mut header = None;
    let mut compressed = Vec::new();
    while at + 12 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let end = at
            .checked_add(12)
            .and_then(|v| v.checked_add(len))
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid("truncated CgBI PNG"))?;
        match &bytes[at + 4..at + 8] {
            b"IHDR" => header = Some(&bytes[at + 8..end - 4]),
            b"IDAT" => compressed.extend_from_slice(&bytes[at + 8..end - 4]),
            _ => {}
        }
        at = end;
    }
    let header = header
        .filter(|h| h.len() == 13)
        .ok_or_else(|| invalid("missing CgBI dimensions"))?;
    let w = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
    let h = u32::from_be_bytes(header[4..8].try_into().unwrap()) as usize;
    let channels = match header[9] {
        2 => 3,
        6 => 4,
        _ => return Err(invalid("unsupported CgBI color type")),
    };
    if w == 0
        || h == 0
        || w.checked_mul(h).is_none_or(|n| n > MAX_PIXELS)
        || header[8] != 8
        || header[10..] != [0, 0, 0]
    {
        return Err(invalid("unsupported CgBI raster"));
    }
    let stride = w * channels;
    let expected = (stride + 1) * h;
    let mut filtered = Vec::new();
    flate2::read::DeflateDecoder::new(compressed.as_slice())
        .take(expected as u64 + 1)
        .read_to_end(&mut filtered)
        .map_err(|_| invalid("invalid CgBI deflate stream"))?;
    if filtered.len() != expected {
        return Err(invalid("invalid CgBI raster length"));
    }
    let mut pixels = vec![0u8; stride * h];
    for y in 0..h {
        let filter = filtered[y * (stride + 1)];
        for x in 0..stride {
            let left = if x >= channels {
                pixels[y * stride + x - channels]
            } else {
                0
            };
            let above = if y > 0 {
                pixels[(y - 1) * stride + x]
            } else {
                0
            };
            let upper_left = if x >= channels && y > 0 {
                pixels[(y - 1) * stride + x - channels]
            } else {
                0
            };
            let predict = match filter {
                0 => 0,
                1 => left,
                2 => above,
                3 => ((left as u16 + above as u16) / 2) as u8,
                4 => {
                    let p = left as i32 + above as i32 - upper_left as i32;
                    let (a, b, c) = (
                        (p - left as i32).abs(),
                        (p - above as i32).abs(),
                        (p - upper_left as i32).abs(),
                    );
                    if a <= b && a <= c {
                        left
                    } else if b <= c {
                        above
                    } else {
                        upper_left
                    }
                }
                _ => return Err(invalid("unknown CgBI PNG filter")),
            };
            pixels[y * stride + x] = filtered[y * (stride + 1) + 1 + x].wrapping_add(predict);
        }
    }
    for color in pixels.chunks_exact_mut(channels) {
        color.swap(0, 2);
        if channels == 4 && color[3] != 0 {
            let alpha = color[3] as u32;
            for channel in &mut color[..3] {
                *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, w as u32, h as u32);
        encoder.set_color(if channels == 4 {
            png::ColorType::Rgba
        } else {
            png::ColorType::Rgb
        });
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .and_then(|mut writer| writer.write_image_data(&pixels))
            .map_err(|_| invalid("CgBI PNG encoding failed"))?;
    }
    Ok(png)
}

fn pe_icon(bytes: &[u8]) -> IconResult<Vec<u8>> {
    let parse = || -> Option<Vec<(u32, u32, &[u8])>> {
        if bytes.get(..2)? != b"MZ" {
            return None;
        }
        let pe = u32le(bytes, 0x3c)? as usize;
        if bytes.get(pe..pe.checked_add(4)?)? != b"PE\0\0" {
            return None;
        }
        let sections = u16le(bytes, pe + 6)? as usize;
        let optional_size = u16le(bytes, pe + 20)? as usize;
        let optional = pe + 24;
        let directories = match u16le(bytes, optional)? {
            0x10b => optional + 96,
            0x20b => optional + 112,
            _ => return None,
        };
        if directories + 24 > optional + optional_size || sections > 4096 {
            return None;
        }
        let section_table = optional + optional_size;
        let offset = |rva: u32, size: usize| -> Option<usize> {
            for i in 0..sections {
                let at = section_table + i * 40;
                let va = u32le(bytes, at + 12)?;
                let raw_size = u32le(bytes, at + 16)?;
                if rva >= va && rva - va < raw_size && size <= (raw_size - (rva - va)) as usize {
                    let result = u32le(bytes, at + 20)? as usize + (rva - va) as usize;
                    bytes.get(result..result.checked_add(size)?)?;
                    return Some(result);
                }
            }
            None
        };
        let resource_size = u32le(bytes, directories + 20)? as usize;
        let root = offset(u32le(bytes, directories + 16)?, resource_size)?;
        let resources = bytes.get(root..root + resource_size)?;
        fn walk<'a>(
            data: &[u8],
            at: usize,
            level: usize,
            kind: u32,
            id: u32,
            offset: &impl Fn(u32, usize) -> Option<usize>,
            bytes: &'a [u8],
            out: &mut Vec<(u32, u32, &'a [u8])>,
            budget: &mut usize,
        ) -> Option<()> {
            let count = u16le(data, at + 12)? as usize + u16le(data, at + 14)? as usize;
            for i in 0..count {
                *budget = budget.checked_sub(1)?;
                let name = u32le(data, at + 16 + i * 8)?;
                let child = u32le(data, at + 20 + i * 8)?;
                let kind = if level == 0 { name } else { kind };
                let id = if level == 1 { name } else { id };
                if !matches!(kind, 3 | 14) {
                    continue;
                }
                let child_at = (child & 0x7fff_ffff) as usize;
                if child & 0x8000_0000 != 0 {
                    if level >= 2 {
                        return None;
                    }
                    walk(
                        data,
                        child_at,
                        level + 1,
                        kind,
                        id,
                        offset,
                        bytes,
                        out,
                        budget,
                    )?;
                } else if level == 2 {
                    let size = u32le(data, child_at + 4)? as usize;
                    if size as u64 > MAX_ICON_BYTES {
                        continue;
                    }
                    let start = offset(u32le(data, child_at)?, size)?;
                    out.push((kind, id, bytes.get(start..start + size)?));
                }
            }
            Some(())
        }
        let mut out = Vec::new();
        walk(resources, 0, 0, 0, 0, &offset, bytes, &mut out, &mut 30_000)?;
        Some(out)
    };
    let resources = parse().ok_or_else(|| invalid("invalid PE resource directory"))?;
    let group = resources
        .iter()
        .find(|(kind, _, _)| *kind == 14)
        .map(|(_, _, data)| *data);
    let ids: Vec<u32> = group
        .into_iter()
        .flat_map(|data| {
            (0..u16le(data, 4).unwrap_or(0).min(4096) as usize)
                .filter_map(move |i| u16le(data, 6 + i * 14 + 12).map(u32::from))
        })
        .collect();
    largest(
        resources
            .iter()
            .filter(|(kind, id, _)| *kind == 3 && (ids.is_empty() || ids.contains(id)))
            .filter_map(|(_, _, data)| decode_icon(data).ok()),
    )
}

fn read_entry(archive: &mut Archive<'_>, name: &str) -> IconResult<Vec<u8>> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| invalid("missing icon resource"))?;
    if entry.size() > MAX_ICON_BYTES {
        return Err(invalid("icon resource exceeds 16 MiB"));
    }
    let mut bytes = Vec::new();
    entry
        .by_ref()
        .take(MAX_ICON_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid("could not read icon resource"))?;
    if bytes.len() as u64 > MAX_ICON_BYTES {
        return Err(invalid("icon resource exceeds 16 MiB"));
    }
    Ok(bytes)
}

fn package_icon(bytes: &[u8], source: &str) -> IconResult<Vec<u8>> {
    let mut archive =
        zip_io::open(Cursor::new(bytes)).map_err(|_| invalid("invalid package ZIP"))?;
    if archive.len() > crate::MAX_PACKAGE_ENTRIES {
        return Err(invalid("too many package entries"));
    }
    let names: Vec<String> = archive.file_names().map(String::from).collect();
    let mut candidates = Vec::new();
    if source == "ipa" {
        let info = names
            .iter()
            .filter(|n| {
                n.starts_with("Payload/")
                    && n.ends_with(".app/Info.plist")
                    && n.split('/').count() == 3
            })
            .min()
            .ok_or_else(|| invalid("IPA has no main application bundle"))?;
        let root = info.trim_end_matches("Info.plist");
        let plist = read_entry(&mut archive, info)?;
        let stems = plist_icons(&plist);
        for name in &names {
            if !name.starts_with(root) || name[root.len()..].contains('/') {
                continue;
            }
            let filename = &name[root.len()..];
            if stems.iter().any(|stem| {
                filename == stem
                    || filename
                        .strip_prefix(stem.trim_end_matches(".png"))
                        .is_some_and(|suffix| {
                            suffix == ".png" || suffix.starts_with('@') || suffix.starts_with('~')
                        })
            }) {
                candidates.push(name.clone());
            }
        }
        if candidates.is_empty() {
            candidates.extend(
                names
                    .iter()
                    .filter(|n| {
                        n.starts_with(root)
                            && !n[root.len()..].contains('/')
                            && n[root.len()..].to_ascii_lowercase().starts_with("appicon")
                            && n.ends_with(".png")
                    })
                    .cloned(),
            );
        }
    } else {
        let manifest = read_entry(&mut archive, "AndroidManifest.xml")?;
        let refs = xml_references(&manifest, true);
        let table = read_entry(&mut archive, "resources.arsc").ok();
        let resources = table.as_deref().map(resource_paths).unwrap_or_default();
        let mut pending: Vec<(u32, usize)> = refs.into_iter().map(|id| (id, 0)).collect();
        let mut visited = std::collections::HashSet::new();
        while let Some((id, depth)) = pending.pop() {
            if depth > 8 || !visited.insert(id) || visited.len() > 4096 {
                continue;
            }
            for value in resources.get(&id).into_iter().flatten() {
                match value {
                    Resource::Reference(next) => pending.push((*next, depth + 1)),
                    Resource::Path(path) if path.ends_with(".xml") => {
                        if let Ok(xml) = read_entry(&mut archive, path) {
                            pending.extend(
                                xml_references(&xml, false)
                                    .into_iter()
                                    .map(|id| (id, depth + 1)),
                            );
                        }
                    }
                    Resource::Path(path) => candidates.push(path.clone()),
                }
            }
        }
        if candidates.is_empty() {
            candidates.extend(
                names
                    .iter()
                    .filter(|name| {
                        let file = name.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
                        name.starts_with("res/")
                            && (file.starts_with("ic_launcher")
                                || file == "icon.png"
                                || file == "app_icon.png")
                            && file.ends_with(".png")
                    })
                    .cloned(),
            );
        }
    }
    candidates.sort();
    candidates.dedup();
    let mut remaining = 64 << 20;
    largest(candidates.iter().take(256).filter_map(|name| {
        let size = archive.by_name(name).ok()?.size();
        if size > remaining {
            return None;
        }
        remaining -= size;
        read_entry(&mut archive, name)
            .ok()
            .and_then(|data| decode_icon(&data).ok())
    }))
}

// Android compiled XML and resource tables share little-endian chunk headers.
fn chunks(bytes: &[u8], start: usize) -> Vec<(u16, &[u8])> {
    let mut out = Vec::new();
    let mut at = start;
    while at + 8 <= bytes.len() && out.len() < 30_000 {
        let Some(kind) = u16le(bytes, at) else { break };
        let size = u32le(bytes, at + 4).unwrap_or(0) as usize;
        let header = u16le(bytes, at + 2).unwrap_or(0) as usize;
        if header < 8 || size < header || size > bytes.len() - at {
            break;
        }
        out.push((kind, &bytes[at..at + size]));
        at += size;
    }
    out
}

fn string_pool(bytes: &[u8]) -> Vec<String> {
    let count = u32le(bytes, 8).unwrap_or(0).min(100_000) as usize;
    let utf8 = u32le(bytes, 16).unwrap_or(0) & 0x100 != 0;
    let start = u32le(bytes, 20).unwrap_or(0) as usize;
    let header = u16le(bytes, 2).unwrap_or(0) as usize;
    let mut budget = 4 << 20;
    (0..count)
        .map(|i| {
            let mut parse = || -> Option<String> {
                let mut at = start.checked_add(u32le(bytes, header + i * 4)? as usize)?;
                let length = |at: &mut usize| -> Option<usize> {
                    if utf8 {
                        let v = *bytes.get(*at)? as usize;
                        *at += 1;
                        if v & 0x80 == 0 {
                            Some(v)
                        } else {
                            let low = *bytes.get(*at)?;
                            *at += 1;
                            Some(((v & 0x7f) << 8) | low as usize)
                        }
                    } else {
                        let v = u16le(bytes, *at)? as usize;
                        *at += 2;
                        if v & 0x8000 == 0 {
                            Some(v)
                        } else {
                            let low = u16le(bytes, *at)?;
                            *at += 2;
                            Some(((v & 0x7fff) << 16) | low as usize)
                        }
                    }
                };
                let len = length(&mut at)?;
                if len > 4096 || len > budget {
                    return None;
                }
                budget -= len;
                if utf8 {
                    let len = length(&mut at)?;
                    String::from_utf8(bytes.get(at..at.checked_add(len)?)?.to_vec()).ok()
                } else {
                    let data = bytes.get(at..at.checked_add(len.checked_mul(2)?)?)?;
                    String::from_utf16(
                        &data
                            .chunks_exact(2)
                            .map(|p| u16::from_le_bytes([p[0], p[1]]))
                            .collect::<Vec<_>>(),
                    )
                    .ok()
                }
            };
            parse().unwrap_or_default()
        })
        .collect()
}

fn xml_references(bytes: &[u8], application_only: bool) -> Vec<u32> {
    let mut strings = Vec::new();
    let mut out = Vec::new();
    for (kind, chunk) in chunks(bytes, 8) {
        if kind == 1 {
            strings = string_pool(chunk);
        }
        if kind != 0x102 {
            continue;
        }
        let name = u32le(chunk, 20).unwrap_or(u32::MAX) as usize;
        if application_only && strings.get(name).map(String::as_str) != Some("application") {
            continue;
        }
        let start = 16 + u16le(chunk, 24).unwrap_or(0) as usize;
        let stride = u16le(chunk, 26).unwrap_or(0) as usize;
        let count = u16le(chunk, 28).unwrap_or(0) as usize;
        if stride < 20 || count > 4096 {
            continue;
        }
        for i in 0..count {
            let at = start + i * stride;
            let name = u32le(chunk, at + 4).unwrap_or(u32::MAX) as usize;
            if application_only && strings.get(name).map(String::as_str) != Some("icon") {
                continue;
            }
            if chunk.get(at + 15) == Some(&1) {
                if let Some(id) = u32le(chunk, at + 16) {
                    out.push(id);
                }
            }
        }
    }
    out
}

#[derive(Clone)]
enum Resource {
    Path(String),
    Reference(u32),
}
fn resource_paths(bytes: &[u8]) -> HashMap<u32, Vec<Resource>> {
    let mut strings = Vec::new();
    let mut out: HashMap<u32, Vec<Resource>> = HashMap::new();
    let mut entry_budget = 250_000usize;
    let mut path_budget = 16 << 20;
    for (kind, chunk) in chunks(bytes, u16le(bytes, 2).unwrap_or(12) as usize) {
        if kind == 1 {
            strings = string_pool(chunk);
        }
        if kind != 0x200 {
            continue;
        }
        let package_id = u32le(chunk, 8).unwrap_or(0);
        let header = u16le(chunk, 2).unwrap_or(0) as usize;
        let type_offset = if header >= 288 {
            u32le(chunk, 284).unwrap_or(0)
        } else {
            0
        };
        for (kind, typed) in chunks(chunk, header) {
            if kind != 0x201 {
                continue;
            }
            let type_id = typed.get(8).copied().unwrap_or(0) as u32 + type_offset;
            let flags = typed.get(9).copied().unwrap_or(0);
            let count = u32le(typed, 12).unwrap_or(0).min(65536) as usize;
            let entries = u32le(typed, 16).unwrap_or(0) as usize;
            let offsets = u16le(typed, 2).unwrap_or(0) as usize;
            let offset_stride = if flags & 2 != 0 && flags & 1 == 0 {
                2
            } else {
                4
            };
            if entries > typed.len()
                || entries < offsets
                || count * offset_stride > entries - offsets
            {
                continue;
            }
            for i in 0..count {
                if entry_budget == 0 {
                    return out;
                }
                entry_budget -= 1;
                let (index, offset) = if flags & 1 != 0 {
                    (
                        u16le(typed, offsets + i * 4).unwrap_or(0) as usize,
                        u16le(typed, offsets + i * 4 + 2).map(|v| v as usize * 4),
                    )
                } else if flags & 2 != 0 {
                    (
                        i,
                        u16le(typed, offsets + i * 2)
                            .filter(|v| *v != 0xffff)
                            .map(|v| v as usize * 4),
                    )
                } else {
                    (
                        i,
                        u32le(typed, offsets + i * 4)
                            .filter(|v| *v != u32::MAX)
                            .map(|v| v as usize),
                    )
                };
                let Some(at) = offset
                    .and_then(|n| entries.checked_add(n))
                    .filter(|at| *at <= typed.len().saturating_sub(8))
                else {
                    continue;
                };
                if u16le(typed, at + 2).unwrap_or(1) & 1 != 0 {
                    continue;
                }
                let value_at = at + u16le(typed, at).unwrap_or(0) as usize;
                let Some(value) = u32le(typed, value_at + 4) else {
                    continue;
                };
                let value = match typed.get(value_at + 3) {
                    Some(3) => strings
                        .get(value as usize)
                        .filter(|s| s.len() <= path_budget)
                        .map(|s| {
                            path_budget -= s.len();
                            Resource::Path(s.clone())
                        }),
                    Some(1) => Some(Resource::Reference(value)),
                    _ => None,
                };
                if let Some(value) = value {
                    out.entry((package_id << 24) | (type_id << 16) | index as u32)
                        .or_default()
                        .push(value);
                }
            }
        }
    }
    out
}

fn plist_icons(bytes: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    if bytes.starts_with(b"bplist00") {
        // Traverse only icon-related values, including nested CFBundleIcons dictionaries.
        let parse = || -> Option<Vec<String>> {
            let trailer = bytes.get(bytes.len().checked_sub(32)?..)?;
            let offset_size = trailer[6] as usize;
            let ref_size = trailer[7] as usize;
            if !(1..=8).contains(&offset_size) || !(1..=8).contains(&ref_size) {
                return None;
            }
            let count = be_int(&trailer[8..16])?;
            if count > 100_000 {
                return None;
            }
            let root = be_int(&trailer[16..24])?;
            let table = be_int(&trailer[24..32])?;
            bytes.get(table..table.checked_add(count.checked_mul(offset_size)?)?)?;
            let mut offsets = Vec::new();
            for i in 0..count {
                offsets.push(be_int(
                    bytes.get(table + i * offset_size..table + (i + 1) * offset_size)?,
                )?);
            }
            fn visit(
                bytes: &[u8],
                offsets: &[usize],
                index: usize,
                ref_size: usize,
                selected: bool,
                depth: usize,
                budget: &mut usize,
                out: &mut Vec<String>,
            ) -> Option<()> {
                if depth > 32 {
                    return None;
                }
                *budget = budget.checked_sub(1)?;
                let mut at = *offsets.get(index)?;
                let marker = *bytes.get(at)?;
                at += 1;
                let mut len = (marker & 15) as usize;
                if len == 15 {
                    let m = *bytes.get(at)?;
                    at += 1;
                    if m >> 4 != 1 || m & 15 > 3 {
                        return None;
                    }
                    let n = 1 << (m & 15);
                    len = be_int(bytes.get(at..at + n)?)?;
                    at += n;
                }
                if len > 100_000 {
                    return None;
                }
                match marker >> 4 {
                    5 if selected => {
                        out.push(String::from_utf8(bytes.get(at..at + len)?.to_vec()).ok()?)
                    }
                    6 if selected => out.push(
                        String::from_utf16(
                            &bytes
                                .get(at..at + len * 2)?
                                .chunks_exact(2)
                                .map(|b| u16::from_be_bytes([b[0], b[1]]))
                                .collect::<Vec<_>>(),
                        )
                        .ok()?,
                    ),
                    10 => {
                        for i in 0..len {
                            let id =
                                be_int(bytes.get(at + i * ref_size..at + (i + 1) * ref_size)?)?;
                            visit(
                                bytes,
                                offsets,
                                id,
                                ref_size,
                                selected,
                                depth + 1,
                                budget,
                                out,
                            )?;
                        }
                    }
                    13 => {
                        for i in 0..len {
                            let key =
                                be_int(bytes.get(at + i * ref_size..at + (i + 1) * ref_size)?)?;
                            let value =
                                be_int(bytes.get(
                                    at + (len + i) * ref_size..at + (len + i + 1) * ref_size,
                                )?)?;
                            let mut keys = Vec::new();
                            visit(
                                bytes,
                                offsets,
                                key,
                                ref_size,
                                true,
                                depth + 1,
                                budget,
                                &mut keys,
                            )?;
                            let selected = keys.iter().any(|k| {
                                matches!(
                                    k.as_str(),
                                    "CFBundleIconFiles" | "CFBundleIconFile" | "CFBundleIconName"
                                )
                            });
                            visit(
                                bytes,
                                offsets,
                                value,
                                ref_size,
                                selected,
                                depth + 1,
                                budget,
                                out,
                            )?;
                        }
                    }
                    _ => {}
                }
                Some(())
            }
            let mut out = Vec::new();
            visit(
                bytes,
                &offsets,
                root,
                ref_size,
                false,
                0,
                &mut 100_000,
                &mut out,
            )?;
            Some(out)
        };
        return parse().unwrap_or_default();
    }
    let mut reader = quick_xml::Reader::from_reader(bytes);
    let mut key = false;
    let mut string = false;
    let mut selected = false;
    let mut icon_array = false;
    loop {
        use quick_xml::events::Event;
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                b"key" => key = true,
                b"string" => string = true,
                b"array" if selected => icon_array = true,
                _ => {}
            },
            Ok(Event::Text(e)) => {
                let text = e.decode().unwrap_or_default();
                if key {
                    selected = matches!(
                        text.as_ref(),
                        "CFBundleIconFiles" | "CFBundleIconFile" | "CFBundleIconName"
                    );
                } else if string && (selected || icon_array) {
                    out.push(
                        quick_xml::escape::unescape(&text)
                            .map(|s| s.into_owned())
                            .unwrap_or_else(|_| text.into_owned()),
                    );
                }
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                b"key" => key = false,
                b"string" => {
                    string = false;
                    selected = false;
                }
                b"array" => icon_array = false,
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(&mut out, w, h);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header()
                .unwrap()
                .write_image_data(&vec![255; (w * h * 4) as usize])
                .unwrap();
        }
        out
    }
    fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in files {
            z.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap().into_inner()
    }
    fn set16(b: &mut [u8], at: usize, n: u16) {
        b[at..at + 2].copy_from_slice(&n.to_le_bytes());
    }
    fn set32(b: &mut [u8], at: usize, n: u32) {
        b[at..at + 4].copy_from_slice(&n.to_le_bytes());
    }
    fn pool(strings: &[&str]) -> Vec<u8> {
        let start = 28 + strings.len() * 4;
        let mut out = vec![0; start];
        set16(&mut out, 0, 1);
        set16(&mut out, 2, 28);
        set32(&mut out, 8, strings.len() as u32);
        set32(&mut out, 16, 0x100);
        set32(&mut out, 20, start as u32);
        for (i, text) in strings.iter().enumerate() {
            let offset = out.len() - start;
            set32(&mut out, 28 + i * 4, offset as u32);
            out.extend_from_slice(&[text.len() as u8, text.len() as u8]);
            out.extend_from_slice(text.as_bytes());
            out.push(0);
        }
        let len = out.len() as u32;
        set32(&mut out, 4, len);
        out
    }
    fn manifest() -> Vec<u8> {
        let mut out = vec![3, 0, 8, 0, 0, 0, 0, 0];
        out.extend(pool(&["application", "icon"]));
        let mut element = vec![0; 56];
        set16(&mut element, 0, 0x102);
        set16(&mut element, 2, 16);
        set32(&mut element, 4, 56);
        set32(&mut element, 20, 0);
        set16(&mut element, 24, 20);
        set16(&mut element, 26, 20);
        set16(&mut element, 28, 1);
        set32(&mut element, 40, 1);
        element[51] = 1;
        set32(&mut element, 52, 0x7f010000);
        out.extend(element);
        let len = out.len() as u32;
        set32(&mut out, 4, len);
        out
    }
    fn resources(path: &str) -> Vec<u8> {
        let mut out = vec![2, 0, 12, 0, 0, 0, 0, 0, 1, 0, 0, 0];
        out.extend(pool(&[path]));
        let mut package = vec![0; 288];
        set16(&mut package, 0, 0x200);
        set16(&mut package, 2, 288);
        set32(&mut package, 8, 0x7f);
        let mut typed = vec![0; 104];
        set16(&mut typed, 0, 0x201);
        set16(&mut typed, 2, 84);
        set32(&mut typed, 4, 104);
        typed[8] = 1;
        set32(&mut typed, 12, 1);
        set32(&mut typed, 16, 88);
        set32(&mut typed, 20, 64);
        set16(&mut typed, 88, 8);
        set16(&mut typed, 96, 8);
        typed[99] = 3;
        package.extend(typed);
        let len = package.len() as u32;
        set32(&mut package, 4, len);
        out.extend(package);
        let len = out.len() as u32;
        set32(&mut out, 4, len);
        out
    }
    #[test]
    fn apk_resolves_obfuscated_resource_from_application_manifest() {
        let expected = png(32, 32);
        let unrelated = png(128, 128);
        let apk = zip(&[
            ("AndroidManifest.xml", &manifest()),
            ("resources.arsc", &resources("r/a.png")),
            ("r/a.png", &expected),
            ("res/drawable/splash.png", &unrelated),
        ]);
        assert_eq!(extract(&apk, "apk").unwrap(), expected);
    }
    #[test]
    fn ipa_uses_main_bundle_declared_icons_and_largest_scale() {
        let expected = png(32, 32);
        let small = png(16, 16);
        let unrelated = png(128, 128);
        let ipa=zip(&[("Payload/Test.app/Info.plist",b"<plist><dict><key>CFBundleIcons</key><dict><key>CFBundlePrimaryIcon</key><dict><key>CFBundleIconFiles</key><array><string>Main</string></array></dict></dict></dict></plist>"),("Payload/Test.app/Main@2x.png",&expected),("Payload/Test.app/Main.png",&small),("Payload/Test.app/Splash.png",&unrelated),("Payload/Test.app/PlugIns/Other.appex/AppIcon.png",&unrelated)]);
        assert_eq!(extract(&ipa, "ipa").unwrap(), expected);
    }
    #[test]
    fn reads_binary_plist_icon_arrays() {
        let objects: Vec<Vec<u8>> = vec![
            vec![0xd1, 1, 2],
            [vec![0x5f, 0x10, 17], b"CFBundleIconFiles".to_vec()].concat(),
            vec![0xa1, 3],
            [vec![0x54], b"Main".to_vec()].concat(),
        ];
        // The key contains 17 ASCII bytes.
        let mut b = b"bplist00".to_vec();
        let mut offsets = Vec::new();
        for obj in objects {
            offsets.push(b.len() as u8);
            b.extend(obj);
        }
        let table = b.len();
        b.extend(offsets);
        let mut trailer = vec![0; 32];
        trailer[6] = 1;
        trailer[7] = 1;
        trailer[15] = 4;
        trailer[31] = table as u8;
        b.extend(trailer);
        assert_eq!(plist_icons(&b), ["Main"]);
    }
    #[test]
    fn normalizes_ios_cgbi_colors_and_premultiplied_alpha() {
        let mut raw = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::fast());
        raw.write_all(&[0, 0, 0, 128, 128, 0, 255, 0, 255]).unwrap();
        let mut cgbi = b"\x89PNG\r\n\x1a\n".to_vec();
        for (kind, data) in [
            (b"CgBI", vec![0; 4]),
            (
                b"IHDR",
                [
                    2u32.to_be_bytes().to_vec(),
                    1u32.to_be_bytes().to_vec(),
                    vec![8, 6, 0, 0, 0],
                ]
                .concat(),
            ),
            (b"IDAT", raw.finish().unwrap()),
            (b"IEND", vec![]),
        ] {
            cgbi.extend_from_slice(&(data.len() as u32).to_be_bytes());
            cgbi.extend_from_slice(kind);
            cgbi.extend(data);
            cgbi.extend_from_slice(&[0; 4]);
        }
        let output = decode_icon(&cgbi).unwrap();
        let mut reader = png::Decoder::new(Cursor::new(output)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixels).unwrap();
        assert_eq!(pixels, [255, 0, 0, 128, 0, 255, 0, 255]);
    }
    #[test]
    fn ico_selects_largest_png_frame() {
        let small = png(16, 16);
        let large = png(32, 32);
        let mut ico = vec![0; 38];
        set16(&mut ico, 2, 1);
        set16(&mut ico, 4, 2);
        set32(&mut ico, 14, small.len() as u32);
        set32(&mut ico, 18, 38);
        set32(&mut ico, 30, large.len() as u32);
        set32(&mut ico, 34, (38 + small.len()) as u32);
        ico.extend(small);
        ico.extend(&large);
        assert_eq!(extract(&ico, "ico").unwrap(), large);
    }
    #[test]
    fn dib_preserves_palette_mask_and_reserved_alpha() {
        for depth in [1, 4, 8, 24, 32] {
            let colors = if depth <= 8 { 1 << depth } else { 0 };
            let stride = if depth == 32 {
                8
            } else if depth == 24 {
                8
            } else {
                4
            };
            let mut b = vec![0; 40 + colors * 4 + stride + 4];
            set32(&mut b, 0, 40);
            set32(&mut b, 4, 2);
            set32(&mut b, 8, 2);
            set16(&mut b, 12, 1);
            set16(&mut b, 14, depth as u16);
            b[40 + colors * 4 + stride] = 0x40;
            let p = decode_icon(&b).unwrap();
            let mut reader = png::Decoder::new(Cursor::new(p)).read_info().unwrap();
            let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
            reader.next_frame(&mut pixels).unwrap();
            assert_eq!(pixels, [0, 0, 0, 255, 0, 0, 0, 0]);
        }
    }
    #[test]
    fn pe_uses_resource_rvas_and_group_ids() {
        let expected = png(32, 32);
        let unrelated = png(128, 128);
        let mut b = vec![0; 0x500];
        b[..2].copy_from_slice(b"MZ");
        set32(&mut b, 0x3c, 0x80);
        b[0x80..0x84].copy_from_slice(b"PE\0\0");
        set16(&mut b, 0x86, 1);
        set16(&mut b, 0x94, 224);
        set16(&mut b, 0x98, 0x10b);
        set32(&mut b, 0x98 + 112, 0x1000);
        let section = 0x98 + 224;
        set32(&mut b, section + 12, 0x1000);
        set32(&mut b, section + 20, 0x200);
        // Root directories for RT_ICON and RT_GROUP_ICON.
        set16(&mut b, 0x200 + 14, 2);
        set32(&mut b, 0x210, 3);
        set32(&mut b, 0x214, 0x80000020);
        set32(&mut b, 0x218, 14);
        set32(&mut b, 0x21c, 0x80000090);
        set16(&mut b, 0x220 + 14, 2);
        set32(&mut b, 0x230, 1);
        set32(&mut b, 0x234, 0x80000040);
        set32(&mut b, 0x238, 2);
        set32(&mut b, 0x23c, 0x80000060);
        for (dir, leaf) in [(0x240, 0xf0), (0x260, 0x100), (0x2b0, 0x110)] {
            set16(&mut b, dir + 14, 1);
            set32(&mut b, dir + 16, 1033);
            set32(&mut b, dir + 20, leaf);
        }
        set16(&mut b, 0x290 + 14, 1);
        set32(&mut b, 0x2a0, 1);
        set32(&mut b, 0x2a4, 0x800000b0);
        let mut group = vec![0; 20];
        set16(&mut group, 2, 1);
        set16(&mut group, 4, 1);
        set16(&mut group, 18, 2);
        for (leaf, data) in [
            (0x2f0, unrelated),
            (0x300, expected.clone()),
            (0x310, group),
        ] {
            let offset = b.len();
            set32(&mut b, leaf, 0x1000 + (offset - 0x200) as u32);
            set32(&mut b, leaf + 4, data.len() as u32);
            b.extend(data);
        }
        let size = (b.len() - 0x200) as u32;
        set32(&mut b, 0x98 + 116, size);
        set32(&mut b, section + 16, size);
        assert_eq!(extract(&b, "exe").unwrap(), expected);
    }
    #[test]
    fn rejects_damaged_packages_and_bounds_resource_traversal() {
        for source in ["apk", "ipa", "ico", "exe", "dll", "mui", "mun"] {
            assert!(extract(b"broken", source).is_err());
        }
        let unsupported = zip(&[
            ("AndroidManifest.xml", b"manifest"),
            ("res/drawable/splash.png", &png(128, 128)),
        ]);
        assert!(extract(&unsupported, "apk").is_err());
        let mut huge = vec![0; 40];
        set32(&mut huge, 0, 40);
        set32(&mut huge, 4, u32::MAX);
        set32(&mut huge, 8, u32::MAX);
        assert!(decode_icon(&huge).is_err());
        assert!(plist_icons(b"bplist00").is_empty());
    }
}
