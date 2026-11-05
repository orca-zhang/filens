//! Optional ASCII prefix scan. The remaining UTF-8 uses the shared decoder.
//! The WASM variant requires SIMD128; the default detector remains portable.

#[derive(Clone, Copy)]
pub(super) struct ScannedText<'a> {
    pub value: &'a str,
    pub has_controls: bool,
}

pub(super) fn decode(bytes: &[u8], partial: bool) -> Result<ScannedText<'_>, std::str::Utf8Error> {
    #[cfg(target_arch = "wasm32")]
    // This function is only linked into the explicitly requested SIMD module.
    let (prefix, mut has_controls) = unsafe { scan_simd(bytes) };
    #[cfg(not(target_arch = "wasm32"))]
    let (prefix, mut has_controls) = scan_tail(bytes);
    let length = if prefix == bytes.len() {
        prefix
    } else {
        // Validate before using has_controls: invalid UTF-8 must retain its
        // original classification even when the ASCII prefix has controls.
        let tail = super::utf8_sample(&bytes[prefix..], partial)?;
        has_controls |= tail
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\u{c}'));
        prefix + tail.len()
    };
    // SAFETY: The prefix is proven ASCII; the tail is validated UTF-8 and ends
    // at a character boundary, including a truncated final sampled character.
    let value = unsafe { std::str::from_utf8_unchecked(&bytes[..length]) };
    Ok(ScannedText {
        value,
        has_controls,
    })
}

fn scan_tail(bytes: &[u8]) -> (usize, bool) {
    let mut has_controls = false;
    for (index, &byte) in bytes.iter().enumerate() {
        if !byte.is_ascii() {
            return (index, has_controls);
        }
        has_controls |= (byte < 32 || byte == 127) && !matches!(byte, 9 | 10 | 12 | 13);
    }
    (bytes.len(), has_controls)
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
unsafe fn scan_simd(bytes: &[u8]) -> (usize, bool) {
    use std::arch::wasm32::*;
    let mut controls = i8x16_splat(0);
    let mut offset = 0;
    while bytes.len() - offset >= 64 {
        // Check four vectors with one high-bit reduction. Every load remains
        // inside the slice, including when the input begins after a UTF-8 BOM.
        let a = unsafe { v128_load(bytes.as_ptr().add(offset).cast()) };
        let b = unsafe { v128_load(bytes.as_ptr().add(offset + 16).cast()) };
        let c = unsafe { v128_load(bytes.as_ptr().add(offset + 32).cast()) };
        let d = unsafe { v128_load(bytes.as_ptr().add(offset + 48).cast()) };
        if i8x16_bitmask(v128_or(v128_or(a, b), v128_or(c, d))) != 0 {
            return (offset, v128_any_true(controls));
        }
        controls = v128_or(
            controls,
            v128_or(
                v128_or(control_mask(a), control_mask(b)),
                v128_or(control_mask(c), control_mask(d)),
            ),
        );
        offset += 64;
    }
    while bytes.len() - offset >= 16 {
        // SAFETY: The complete 16-byte load is inside the input slice.
        let block = unsafe { v128_load(bytes.as_ptr().add(offset).cast()) };
        if i8x16_bitmask(block) != 0 {
            return (offset, v128_any_true(controls));
        }
        controls = v128_or(controls, control_mask(block));
        offset += 16;
    }
    let (tail, tail_controls) = scan_tail(&bytes[offset..]);
    (offset + tail, tail_controls || v128_any_true(controls))
}

#[cfg(target_arch = "wasm32")]
#[target_feature(enable = "simd128")]
fn control_mask(block: std::arch::wasm32::v128) -> std::arch::wasm32::v128 {
    use std::arch::wasm32::*;
    let allowed = v128_or(
        v128_or(
            i8x16_eq(block, i8x16_splat(9)),
            i8x16_eq(block, i8x16_splat(10)),
        ),
        // Clearing the low bit recognizes both form feed (12) and CR (13).
        i8x16_eq(v128_and(block, i8x16_splat(-2)), i8x16_splat(12)),
    );
    v128_andnot(
        v128_or(
            i8x16_lt(block, i8x16_splat(32)),
            i8x16_eq(block, i8x16_splat(127)),
        ),
        allowed,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_proof_and_control_policy_hold_at_vector_and_sample_boundaries() {
        for length in [
            0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 8192,
        ] {
            let mut bytes = vec![b'a'; length];
            assert_eq!(decode(&bytes, false).unwrap().value.as_bytes(), bytes);
            for position in [
                0, 1, 14, 15, 16, 17, 30, 31, 32, 47, 48, 62, 63, 64, 127, 128, 8191,
            ] {
                if position >= length {
                    continue;
                }
                for byte in 0..=255u8 {
                    bytes[position] = byte;
                    let result = decode(&bytes, false).ok();
                    assert_eq!(result.is_some(), byte.is_ascii());
                    if let Some(result) = result {
                        let reference = result
                            .value
                            .chars()
                            .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\u{c}'));
                        assert_eq!(result.has_controls, reference);
                        assert_eq!(result.value.as_bytes(), bytes);
                    }
                }
                bytes[position] = b'a';
            }
        }
    }

    #[test]
    fn mixed_utf8_and_controls_match_full_validation_at_every_prefix_and_cut() {
        for prefix in [0, 1, 15, 16, 17, 47, 48, 63, 64, 65, 127, 128, 8191] {
            for suffix in [
                "中文😀",
                "\u{85}",
                "\0中",
                "中\0",
                "\u{c}中\r\n",
                "\u{fffd}",
            ] {
                let mut input = vec![b'a'; prefix];
                input.extend_from_slice(suffix.as_bytes());
                for control_prefix in [false, true] {
                    if control_prefix && prefix > 0 {
                        input[0] = 0;
                    }
                    for cut in 0..=suffix.len() {
                        let input = &input[..input.len() - cut];
                        for partial in [false, true] {
                            let expected = super::super::utf8_sample(input, partial);
                            let actual = decode(input, partial);
                            assert_eq!(actual.is_ok(), expected.is_ok());
                            if let (Ok(actual), Ok(expected)) = (actual, expected) {
                                assert_eq!(actual.value, expected);
                                assert_eq!(
                                    actual.has_controls,
                                    expected.chars().any(|c| c.is_control()
                                        && !matches!(c, '\t' | '\n' | '\r' | '\u{c}'))
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}
