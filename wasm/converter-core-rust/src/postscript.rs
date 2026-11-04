//! Compact PostScript-to-vector-PDF conversion; no host file/network capabilities.
use crate::{ConvertError, conversion_error, parse_error};
use efterscript_remelt::{Options, distill};
use efterscript_vm::{Config, Outcome};

const MAX_INPUT: usize = 16 << 20;
const MAX_STEPS: u64 = 5_000_000;

pub fn convert(bytes: &[u8], source: &str) -> Result<Vec<u8>, ConvertError> {
    if bytes.len() > MAX_INPUT {
        return Err(parse_error(
            "PostScript input exceeds the 16 MiB preview limit".into(),
        ));
    }
    let bytes = postscript_section(bytes)?;
    if !bytes.starts_with(b"%!") {
        return Err(parse_error("Missing PostScript %! signature".into()));
    }
    let is_eps = source == "eps"
        || bytes[..bytes.len().min(256)]
            .windows(8)
            .any(|w| w == b"EPSF-3.0" || w == b"EPSF-2.0");
    let program = if is_eps {
        encapsulate(bytes)?
    } else {
        bytes.to_vec()
    };
    let mut config = Config::default();
    config.limits.steps = Some(MAX_STEPS);
    config.fonts.substitute = false;
    // Default capabilities grant neither file access nor a clock. Keep all font
    // outline assets disabled through Cargo features, including transitive ones.
    let (report, pdf) = distill(
        &program,
        config,
        &Options::compress(true).unversioned_producer(),
        Vec::new(),
    )
    .map_err(|e| conversion_error(format!("PostScript: {e}")))?;
    if report.budget_exceeded {
        return Err(parse_error(
            "PostScript preview exceeded its execution budget".into(),
        ));
    }
    if let Outcome::Error(error) = &report.outcome {
        let font_hint = if error.name == "invalidfont" {
            ". This compact build omits resident font outlines; embed fonts or convert text to paths before export."
        } else {
            ""
        };
        return Err(parse_error(format!(
            "PostScript {} in {}{}",
            error.name, error.command, font_hint
        )));
    }
    if report.outcome != Outcome::Ok || report.pages == 0 {
        return Err(parse_error(
            "PostScript did not produce a complete page (missing showpage or incomplete program)"
                .into(),
        ));
    }
    if is_eps && report.pages != 1 {
        return Err(parse_error(
            "EPS must produce exactly one encapsulated page".into(),
        ));
    }
    // Refuse known fidelity losses instead of presenting incomplete artwork.
    if !report.notes.is_empty() {
        return Err(parse_error(format!(
            "PostScript contains unsupported artwork: {}",
            report.notes.join("; ")
        )));
    }
    Ok(pdf)
}

fn postscript_section(bytes: &[u8]) -> Result<&[u8], ConvertError> {
    if !bytes.starts_with(&[0xc5, 0xd0, 0xd3, 0xc6]) {
        return Ok(bytes);
    }
    let header = bytes
        .get(..30)
        .ok_or_else(|| parse_error("Truncated binary EPS header".into()))?;
    let start = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    let length = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
    let end = start
        .checked_add(length)
        .ok_or_else(|| parse_error("Invalid binary EPS section length".into()))?;
    if start < 30 {
        return Err(parse_error("Invalid binary EPS section offset".into()));
    }
    bytes
        .get(start..end)
        .ok_or_else(|| parse_error("Truncated binary EPS PostScript section".into()))
}

fn bounding_box(bytes: &[u8]) -> Result<[f64; 4], ConvertError> {
    let mut integer = None;
    let mut hires = None;
    let mut nested = 0usize;
    for line in bytes.split(|b| matches!(b, b'\r' | b'\n')) {
        if line.starts_with(b"%%BeginDocument:") {
            nested += 1;
            continue;
        }
        if line.starts_with(b"%%EndDocument") {
            nested = nested.saturating_sub(1);
            continue;
        }
        if nested > 0 {
            continue;
        }
        let (target, value) = if let Some(value) = line.strip_prefix(b"%%HiResBoundingBox:") {
            (&mut hires, value)
        } else if let Some(value) = line.strip_prefix(b"%%BoundingBox:") {
            (&mut integer, value)
        } else {
            continue;
        };
        let Ok(value) = std::str::from_utf8(value) else {
            continue;
        };
        let Ok(numbers) = value
            .split_whitespace()
            .take(5)
            .map(str::parse::<f64>)
            .collect::<Result<Vec<_>, _>>()
        else {
            continue;
        };
        if numbers.len() != 4
            || numbers
                .iter()
                .any(|n| !n.is_finite() || n.abs() > 1_000_000.0)
        {
            continue;
        }
        let [x0, y0, x1, y1] = [numbers[0], numbers[1], numbers[2], numbers[3]];
        if x1 <= x0 || y1 <= y0 || x1 - x0 > 30_000.0 || y1 - y0 > 30_000.0 {
            continue;
        }
        *target = Some([x0, y0, x1, y1]);
    }
    hires
        .or(integer)
        .ok_or_else(|| parse_error("EPS requires a valid BoundingBox or HiResBoundingBox".into()))
}

fn encapsulate(bytes: &[u8]) -> Result<Vec<u8>, ConvertError> {
    let [x0, y0, x1, y1] = bounding_box(bytes)?;
    // EPS is placed as one page. Suppress its own showpage and page-device
    // changes, restore the enclosing state, and emit exactly once at EOF.
    let prefix = format!(
        "%!PS\n<< /PageSize [{} {}] >> setpagedevice\n/filens_eps_save save def\n/showpage {{}} bind def\n/setpagedevice {{pop}} bind def\n{} {} translate\n",
        x1 - x0,
        y1 - y0,
        -x0,
        -y0
    );
    let mut program = prefix.into_bytes();
    program.extend_from_slice(bytes);
    program.extend_from_slice(b"\nfilens_eps_save restore\nshowpage\n");
    Ok(program)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_vector_paths_and_standard_font_text() {
        let pdf = convert(b"%!PS\n<< /PageSize [200 100] >> setpagedevice\n/Helvetica findfont 18 scalefont setfont\n20 50 moveto (Vector text) show\n0 0 moveto 200 100 lineto stroke showpage", "ps").unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert!(!pdf.windows(14).any(|w| w == b"/Subtype/Image"));
    }
    #[test]
    fn eps_without_showpage_uses_bbox_and_emits_one_page() {
        let pdf = convert(
            b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 10 20 210 120\n10 20 200 100 rectfill\n%%EOF",
            "eps",
        )
        .unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(
            bounding_box(b"%%BoundingBox: (atend)\n%%HiResBoundingBox: -10.5 20 89.5 220\n")
                .unwrap(),
            [-10.5, 20.0, 89.5, 220.0]
        );
    }
    #[test]
    fn rejects_invalid_bbox_bad_operators_and_missing_font_outlines() {
        assert!(convert(b"%!PS\nshowpage", "eps").is_err());
        assert!(convert(b"%!PS\nunknown_filens_operator showpage", "ps").is_err());
        assert!(convert(b"%!PS\n/Helvetica findfont 20 scalefont setfont 20 20 moveto (Test) true charpath fill showpage", "ps").is_err());
        assert!(bounding_box(b"%%BoundingBox: 0 0 NaN 100").is_err());
        assert!(bounding_box(b"%%BoundingBox: 0 0 100000 100000").is_err());
    }
    #[test]
    fn rejects_truncated_binary_eps_sections() {
        assert!(postscript_section(&[0xc5, 0xd0, 0xd3, 0xc6]).is_err());
        let mut data = vec![0; 30];
        data[..4].copy_from_slice(&[0xc5, 0xd0, 0xd3, 0xc6]);
        data[4..8].copy_from_slice(&30u32.to_le_bytes());
        data[8..12].copy_from_slice(&100u32.to_le_bytes());
        assert!(postscript_section(&data).is_err());
    }

    #[test]
    fn binary_eps_uses_its_own_trailer_bbox_with_mac_line_endings() {
        let ps = b"%!PS-Adobe-3.0 EPSF-3.0\r%%BoundingBox: (atend)\r%%BeginDocument: child.eps\r%%BoundingBox: 0 0 999 999\r%%EndDocument\r10 20 200 100 rectfill\r%%Trailer\r%%BoundingBox: 10 20 210 120\r%%HiResBoundingBox: 10.5 20.5 210.5 120.5\r";
        assert_eq!(bounding_box(ps).unwrap(), [10.5, 20.5, 210.5, 120.5]);
        let mut binary = vec![0; 30];
        binary[..4].copy_from_slice(&[0xc5, 0xd0, 0xd3, 0xc6]);
        binary[4..8].copy_from_slice(&30u32.to_le_bytes());
        binary[8..12].copy_from_slice(&(ps.len() as u32).to_le_bytes());
        binary.extend_from_slice(ps);
        binary.extend_from_slice(b"unused embedded TIFF preview");
        assert_eq!(postscript_section(&binary).unwrap(), ps);
        assert!(convert(&binary, "eps").unwrap().starts_with(b"%PDF-"));
    }
}
