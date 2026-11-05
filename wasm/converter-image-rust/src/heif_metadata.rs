//! Bounded primary-item HEVC VUI color hints.
//! Read configuration SPSs only; compressed image samples stay with libheif.
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, &'static str>;
const INVALID: &str = "Invalid HEIF color metadata";

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Color {
    primaries: u16,
    transfer: u16,
    matrix: u16,
    full_range: bool,
}

struct BoxRef<'a> {
    kind: &'a [u8],
    data: &'a [u8],
}
struct Boxes {
    remaining: usize,
}
impl Boxes {
    fn read<'a>(&mut self, mut data: &'a [u8]) -> Result<Vec<BoxRef<'a>>> {
        let mut result = Vec::new();
        while !data.is_empty() {
            if self.remaining == 0 || data.len() < 8 {
                return Err(INVALID);
            }
            self.remaining -= 1;
            let size = u32::from_be_bytes(data[..4].try_into().unwrap());
            let (header, size) = match size {
                0 => (8, data.len() as u64),
                1 => (
                    16,
                    u64::from_be_bytes(data.get(8..16).ok_or(INVALID)?.try_into().unwrap()),
                ),
                _ => (8, u64::from(size)),
            };
            if size < header as u64 || size > data.len() as u64 {
                return Err(INVALID);
            }
            result.push(BoxRef {
                kind: &data[4..8],
                data: &data[header..size as usize],
            });
            data = &data[size as usize..];
        }
        Ok(result)
    }
}
fn find<'a>(boxes: &'a [BoxRef<'a>], kind: &[u8]) -> Result<Option<&'a [u8]>> {
    let mut matches = boxes.iter().filter(|item| item.kind == kind);
    let result = matches.next().map(|item| item.data);
    if matches.next().is_some() {
        return Err(INVALID);
    }
    Ok(result)
}
struct Cursor<'a> {
    data: &'a [u8],
    at: usize,
}
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let result = self
            .data
            .get(self.at..self.at.checked_add(n).ok_or(INVALID)?)
            .ok_or(INVALID)?;
        self.at += n;
        Ok(result)
    }
    fn number(&mut self, n: usize) -> Result<u32> {
        Ok(self
            .take(n)?
            .iter()
            .fold(0, |acc, byte| acc << 8 | u32::from(*byte)))
    }
}

/// Select the actual libheif primary handle's properties. Never scan unrelated
/// SPSs or apply a thumbnail's color metadata to a full-sized image.
pub fn item_color(input: &[u8], item_id: u32) -> Result<Option<Color>> {
    if input.is_empty() || input.len() > 64 << 20 {
        return Err(INVALID);
    }
    let mut parser = Boxes { remaining: 4096 };
    let top = parser.read(input)?;
    let Some(meta) = find(&top, b"meta")? else {
        return Ok(None);
    };
    if meta.get(..4) != Some(&[0, 0, 0, 0]) {
        return Err(INVALID);
    }
    let children = parser.read(&meta[4..])?;
    let Some(iprp) = find(&children, b"iprp")? else {
        return Ok(None);
    };
    let iprp = parser.read(iprp)?;
    let Some(ipco) = find(&iprp, b"ipco")? else {
        return Ok(None);
    };
    let properties = parser.read(ipco)?;
    let Some(ipma) = find(&iprp, b"ipma")? else {
        return Ok(None);
    };
    let mut cursor = Cursor { data: ipma, at: 0 };
    let version = cursor.number(1)?;
    let flags = cursor.number(3)?;
    let count = cursor.number(4)?;
    if version > 1 || flags > 1 || count > 4096 {
        return Err(INVALID);
    }
    let mut total = 0;
    let mut colors = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for _ in 0..count {
        let id = cursor.number(if version == 0 { 2 } else { 4 })?;
        if id == 0 || !seen.insert(id) {
            return Err(INVALID);
        }
        let n = cursor.number(1)?;
        total += n;
        if total > 16384 {
            return Err(INVALID);
        }
        let mut hvcc = None;
        let mut declared = None;
        for _ in 0..n {
            let index = cursor.number(if flags == 0 { 1 } else { 2 })?
                & if flags == 0 { 127 } else { 32767 };
            if index == 0 {
                continue;
            }
            let property = properties.get(index as usize - 1).ok_or(INVALID)?;
            if property.kind == b"hvcC" {
                if hvcc.replace(property.data).is_some() {
                    return Err(INVALID);
                }
            }
            if property.kind == b"colr" && property.data.starts_with(b"nclx") {
                if declared.is_some() || property.data.len() != 11 {
                    return Err(INVALID);
                }
                let data = property.data;
                declared = Some(Color {
                    primaries: u16::from_be_bytes([data[4], data[5]]),
                    transfer: u16::from_be_bytes([data[6], data[7]]),
                    matrix: u16::from_be_bytes([data[8], data[9]]),
                    full_range: data[10] & 128 != 0,
                });
            }
        }
        colors.insert(id, (declared, hvcc));
    }
    if cursor.at != ipma.len() {
        return Err(INVALID);
    }
    let grids = grid_references(&mut parser, &children)?;
    let mut resolved = BTreeMap::new();
    let mut active = BTreeSet::new();
    let mut pending = vec![(item_id, false, 0)];
    while let Some((id, expanded, depth)) = pending.pop() {
        if resolved.contains_key(&id) {
            continue;
        }
        if depth > 32 {
            return Err(INVALID);
        }
        let (declared, configuration) = colors.get(&id).ok_or(INVALID)?;
        if let Some(color) = declared {
            resolved.insert(id, Some(*color));
            continue;
        }
        if let Some(tiles) = grids.get(&id) {
            if !expanded {
                if !active.insert(id) {
                    return Err(INVALID);
                }
                pending.push((id, true, depth));
                for child in tiles.iter().rev() {
                    pending.push((*child, false, depth + 1));
                }
                continue;
            }
            active.remove(&id);
            let common = *resolved.get(&tiles[0]).ok_or(INVALID)?;
            if tiles
                .iter()
                .any(|child| resolved.get(child) != Some(&common))
            {
                return Err(INVALID);
            }
            resolved.insert(id, common);
        } else {
            resolved.insert(
                id,
                configuration
                    .map(configuration_color)
                    .transpose()?
                    .flatten(),
            );
        }
    }
    Ok(resolved.remove(&item_id).flatten())
}

// Follow only grid dimg dependencies. Auxiliary alpha, thumbnails and tone maps
// have their own sample interpretation and must never supply RGB color hints.
fn grid_references(parser: &mut Boxes, meta: &[BoxRef<'_>]) -> Result<BTreeMap<u32, Vec<u32>>> {
    let mut grids = BTreeSet::new();
    if let Some(iinf) = find(meta, b"iinf")? {
        let mut cursor = Cursor { data: iinf, at: 0 };
        let version = cursor.number(1)?;
        if version > 1 || cursor.number(3)? != 0 {
            return Err(INVALID);
        }
        let count = cursor.number(if version == 0 { 2 } else { 4 })? as usize;
        if count > 4096 {
            return Err(INVALID);
        }
        let entries = parser.read(&iinf[cursor.at..])?;
        if entries.len() != count {
            return Err(INVALID);
        }
        for entry in entries {
            if entry.kind != b"infe" {
                return Err(INVALID);
            }
            let mut cursor = Cursor {
                data: entry.data,
                at: 0,
            };
            let version = cursor.number(1)?;
            cursor.take(3)?;
            if version < 2 {
                continue;
            }
            if version > 3 {
                return Err(INVALID);
            }
            let id = cursor.number(if version == 2 { 2 } else { 4 })?;
            cursor.take(2)?;
            if cursor.take(4)? == b"grid" && !grids.insert(id) {
                return Err(INVALID);
            }
        }
    }
    let mut refs = BTreeMap::new();
    if let Some(iref) = find(meta, b"iref")? {
        let mut cursor = Cursor { data: iref, at: 0 };
        let version = cursor.number(1)?;
        if version > 1 || cursor.number(3)? != 0 {
            return Err(INVALID);
        }
        let width = if version == 0 { 2 } else { 4 };
        let mut total = 0;
        for entry in parser.read(&iref[4..])? {
            if entry.kind != b"dimg" {
                continue;
            }
            let mut cursor = Cursor {
                data: entry.data,
                at: 0,
            };
            let id = cursor.number(width)?;
            let count = cursor.number(2)? as usize;
            total += count;
            if count == 0 || total > 16384 || entry.data.len() != width + 2 + count * width {
                return Err(INVALID);
            }
            let mut children = Vec::with_capacity(count);
            for _ in 0..count {
                children.push(cursor.number(width)?);
            }
            if grids.contains(&id) && refs.insert(id, children).is_some() {
                return Err(INVALID);
            }
        }
    }
    Ok(refs)
}

fn configuration_color(data: &[u8]) -> Result<Option<Color>> {
    if data.len() < 23 || data.len() > 1 << 20 || data[0] != 1 {
        return Err(INVALID);
    }
    let mut cursor = Cursor { data, at: 23 };
    let (mut total, mut seen, mut color) = (0, false, None);
    for _ in 0..data[22] {
        let kind = cursor.number(1)? & 63;
        let count = cursor.number(2)?;
        total += count;
        if total > 256 {
            return Err(INVALID);
        }
        for _ in 0..count {
            let n = cursor.number(2)? as usize;
            if n < 2 {
                return Err(INVALID);
            }
            let nal = cursor.take(n)?;
            if kind == 33 {
                let value = sps_color(nal)?;
                if seen && color != value {
                    return Err(INVALID);
                }
                color = value;
                seen = true;
            }
        }
    }
    if cursor.at != data.len() {
        return Err(INVALID);
    }
    Ok(color)
}

struct Bits {
    data: Vec<u8>,
    at: usize,
}
impl Bits {
    fn get(&mut self, n: usize) -> Result<u32> {
        if n > 32 || n > self.data.len() * 8 - self.at {
            return Err(INVALID);
        }
        let mut value = 0;
        for _ in 0..n {
            value = value << 1 | u32::from(self.data[self.at / 8] >> (7 - self.at % 8) & 1);
            self.at += 1;
        }
        Ok(value)
    }
    fn skip(&mut self, n: usize) -> Result<()> {
        if n > self.data.len() * 8 - self.at {
            return Err(INVALID);
        }
        self.at += n;
        Ok(())
    }
    fn flag(&mut self) -> Result<bool> {
        Ok(self.get(1)? != 0)
    }
    fn ue(&mut self) -> Result<u32> {
        let mut zeros = 0;
        while !self.flag()? {
            zeros += 1;
            if zeros > 30 {
                return Err(INVALID);
            }
        }
        Ok((1 << zeros) - 1 + self.get(zeros)?)
    }
    fn bounded(&mut self, maximum: u32) -> Result<usize> {
        let value = self.ue()?;
        if value > maximum {
            return Err(INVALID);
        }
        Ok(value as usize)
    }
    fn scaling_list(&mut self) -> Result<()> {
        for size in 0..4 {
            for matrix in (0..6).step_by(if size == 3 { 3 } else { 1 }) {
                if !self.flag()? {
                    self.bounded(matrix)?;
                } else {
                    if size > 1 {
                        self.ue()?;
                    }
                    for _ in 0..64.min(1 << (4 + size * 2)) {
                        self.ue()?;
                    }
                }
            }
        }
        Ok(())
    }
}
fn sps_color(nal: &[u8]) -> Result<Option<Color>> {
    if nal.len() < 3
        || nal.len() > 65535
        || nal[0] & 0x81 != 0
        || nal[0] >> 1 != 33
        || nal[1] & 0xf8 != 0
        || nal[1] & 7 == 0
    {
        return Err(INVALID);
    }
    let mut rbsp = Vec::with_capacity(nal.len() - 2);
    let mut zeros = 0;
    for i in 2..nal.len() {
        let value = nal[i];
        if zeros >= 2 && value == 3 {
            if i + 1 == nal.len() || nal[i + 1] > 3 {
                return Err(INVALID);
            }
            zeros = 0;
            continue;
        }
        rbsp.push(value);
        zeros = if value == 0 { zeros + 1 } else { 0 };
    }
    let mut b = Bits { data: rbsp, at: 0 };
    b.skip(4)?;
    let layers = b.get(3)? as usize;
    b.skip(1)?;
    if layers > 6 {
        return Err(INVALID);
    }
    b.skip(96)?;
    let mut sublayers = Vec::new();
    for _ in 0..layers {
        sublayers.push((b.flag()?, b.flag()?));
    }
    if layers > 0 {
        b.skip((8 - layers) * 2)?;
    }
    for (profile, level) in sublayers {
        if profile {
            b.skip(88)?;
        }
        if level {
            b.skip(8)?;
        }
    }
    b.bounded(15)?;
    let chroma = b.bounded(3)?;
    if chroma == 3 {
        b.skip(1)?;
    }
    b.ue()?;
    b.ue()?;
    if b.flag()? {
        for _ in 0..4 {
            b.ue()?;
        }
    }
    b.bounded(8)?;
    b.bounded(8)?;
    let poc_bits = b.bounded(12)? + 4;
    let first = if b.flag()? { 0 } else { layers };
    for _ in first..=layers {
        b.ue()?;
        b.ue()?;
        b.ue()?;
    }
    for _ in 0..6 {
        b.ue()?;
    }
    if b.flag()? && b.flag()? {
        b.scaling_list()?;
    }
    b.skip(2)?;
    if b.flag()? {
        b.skip(8)?;
        b.ue()?;
        b.ue()?;
        b.skip(1)?;
    }
    let sets = b.bounded(64)?;
    let mut previous = 0;
    for i in 0..sets {
        if i > 0 && b.flag()? {
            b.skip(1)?;
            b.ue()?;
            let mut count = 0;
            for _ in 0..=previous {
                if b.flag()? || b.flag()? {
                    count += 1;
                }
            }
            previous = count;
        } else {
            previous = b.bounded(64)? + b.bounded(64)?;
            if previous > 64 {
                return Err(INVALID);
            }
            for _ in 0..previous {
                b.ue()?;
                b.skip(1)?;
            }
        }
        if previous > 64 {
            return Err(INVALID);
        }
    }
    if b.flag()? {
        let count = b.bounded(32)?;
        for _ in 0..count {
            b.skip(poc_bits + 1)?;
        }
    }
    b.skip(2)?;
    if b.flag()? {
        if b.flag()? && b.get(8)? == 255 {
            b.skip(32)?;
        }
        if b.flag()? {
            b.skip(1)?;
        }
        if b.flag()? {
            b.skip(3)?;
            let full_range = b.flag()?;
            if b.flag()? {
                return Ok(Some(Color {
                    primaries: b.get(8)? as u16,
                    transfer: b.get(8)? as u16,
                    matrix: b.get(8)? as u16,
                    full_range,
                }));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn box_bytes(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut output = ((data.len() + 8) as u32).to_be_bytes().to_vec();
        output.extend_from_slice(kind);
        output.extend_from_slice(data);
        output
    }

    fn grid_fixture(items: &[(u16, bool, Option<Color>)], links: &[(u16, &[u16])]) -> Vec<u8> {
        let mut iinf = vec![0; 4];
        iinf.extend_from_slice(&(items.len() as u16).to_be_bytes());
        let mut ipco = Vec::new();
        let mut ipma = vec![0; 4];
        ipma.extend_from_slice(&(items.len() as u32).to_be_bytes());
        let mut property = 0;
        for &(id, grid, color) in items {
            let mut infe = vec![2, 0, 0, 0];
            infe.extend_from_slice(&id.to_be_bytes());
            infe.extend_from_slice(&[0, 0]);
            infe.extend_from_slice(if grid { b"grid" } else { b"hvc1" });
            infe.push(0);
            iinf.extend(box_bytes(b"infe", &infe));
            ipma.extend_from_slice(&id.to_be_bytes());
            ipma.push(u8::from(color.is_some()));
            if let Some(color) = color {
                let mut data = b"nclx".to_vec();
                data.extend_from_slice(&color.primaries.to_be_bytes());
                data.extend_from_slice(&color.transfer.to_be_bytes());
                data.extend_from_slice(&color.matrix.to_be_bytes());
                data.push(if color.full_range { 128 } else { 0 });
                ipco.extend(box_bytes(b"colr", &data));
                property += 1;
                ipma.push(property);
            }
        }
        let mut iref = vec![0; 4];
        for &(id, children) in links {
            let mut dimg = id.to_be_bytes().to_vec();
            dimg.extend_from_slice(&(children.len() as u16).to_be_bytes());
            for child in children {
                dimg.extend_from_slice(&child.to_be_bytes());
            }
            iref.extend(box_bytes(b"dimg", &dimg));
        }
        let mut iprp = box_bytes(b"ipco", &ipco);
        iprp.extend(box_bytes(b"ipma", &ipma));
        let mut meta = vec![0; 4];
        meta.extend(box_bytes(b"iinf", &iinf));
        meta.extend(box_bytes(b"iref", &iref));
        meta.extend(box_bytes(b"iprp", &iprp));
        box_bytes(b"meta", &meta)
    }

    #[test]
    fn nested_grids_inherit_only_rgb_dependencies_and_root_color_wins() {
        let rgb = Color {
            primaries: 12,
            transfer: 13,
            matrix: 6,
            full_range: true,
        };
        let alpha = Color {
            primaries: 2,
            transfer: 8,
            matrix: 2,
            full_range: true,
        };
        let items = [
            (1, true, None),
            (2, true, None),
            (3, false, Some(rgb)),
            (4, false, Some(alpha)),
        ];
        assert_eq!(
            item_color(&grid_fixture(&items, &[(1, &[2]), (2, &[3])]), 1),
            Ok(Some(rgb))
        );
        let mut explicit = items;
        explicit[0].2 = Some(alpha);
        assert_eq!(
            item_color(&grid_fixture(&explicit, &[(1, &[2, 4]), (2, &[3])]), 1),
            Ok(Some(alpha))
        );
        // A non-grid item's dimg relation must not borrow another image's color.
        let ordinary = [(1, false, None), (3, false, Some(rgb))];
        assert_eq!(
            item_color(&grid_fixture(&ordinary, &[(1, &[3])]), 1),
            Ok(None)
        );
    }

    #[test]
    fn rejects_grid_cycles_missing_tiles_mixed_colors_and_excessive_depth() {
        let color = Color {
            primaries: 1,
            transfer: 13,
            matrix: 6,
            full_range: true,
        };
        let other = Color {
            primaries: 12,
            ..color
        };
        let items = [
            (1, true, None),
            (2, true, None),
            (3, false, Some(color)),
            (4, false, Some(other)),
        ];
        for links in [
            vec![(1, &[2][..]), (2, &[1][..])],
            vec![(1, &[9][..])],
            vec![(1, &[3, 4][..])],
        ] {
            assert!(item_color(&grid_fixture(&items, &links), 1).is_err());
        }
        let missing = [(1, true, None), (3, false, Some(color)), (4, false, None)];
        assert!(item_color(&grid_fixture(&missing, &[(1, &[3, 4])]), 1).is_err());
        let items: Vec<_> = (1..=35)
            .map(|id| (id, id < 35, if id == 35 { Some(color) } else { None }))
            .collect();
        let children: Vec<_> = (2..=35).map(|id| vec![id]).collect();
        let links: Vec<_> = children
            .iter()
            .enumerate()
            .map(|(i, ids)| ((i + 1) as u16, ids.as_slice()))
            .collect();
        assert!(item_color(&grid_fixture(&items, &links), 1).is_err());
    }

    #[test]
    fn rejects_truncated_boxes_and_malformed_configuration_records() {
        for bytes in [&[][..], &[0; 7], &[0, 0, 0, 7, b'm', b'e', b't', b'a']] {
            assert!(item_color(bytes, 1).is_err());
        }
        for length in 0..23 {
            assert!(configuration_color(&vec![0; length]).is_err());
        }
        assert!(sps_color(&[66, 1, 0, 0, 3]).is_err());
        assert!(sps_color(&[66, 1, 0, 0, 3, 4]).is_err());
    }
}
