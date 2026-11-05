//! Optional SIMD byte scanning; Unicode normalization and term weights stay in search.rs.
//! WASM callers explicitly select a SIMD128 module. Native x86-64 SSE2 and
//! AArch64 NEON are baseline target features; other targets keep scalar code.

// All three backends expose the same bounded 16-byte operations.
#[cfg(target_arch = "wasm32")]
mod vector {
    use std::arch::wasm32::*;
    pub(super) type Block = v128;
    #[inline]
    #[target_feature(enable = "simd128")]
    pub(super) unsafe fn load(p: *const u8) -> Block {
        unsafe { v128_load(p.cast()) }
    }
    #[inline]
    #[target_feature(enable = "simd128")]
    pub(super) unsafe fn store(p: *mut u8, v: Block) {
        unsafe { v128_store(p.cast(), v) }
    }
    #[inline]
    #[target_feature(enable = "simd128")]
    pub(super) fn non_ascii(v: Block) -> bool {
        i8x16_bitmask(v) != 0
    }
    #[inline]
    #[target_feature(enable = "simd128")]
    pub(super) fn lower(v: Block) -> Block {
        let upper = v128_and(
            u8x16_ge(v, u8x16_splat(b'A')),
            u8x16_le(v, u8x16_splat(b'Z')),
        );
        v128_or(v, v128_and(upper, u8x16_splat(32)))
    }
    #[inline]
    #[target_feature(enable = "simd128")]
    pub(super) fn separators(v: Block) -> u32 {
        let alpha = u8x16_le(
            u8x16_sub(v128_or(v, u8x16_splat(32)), u8x16_splat(b'a')),
            u8x16_splat(25),
        );
        let digit = u8x16_le(u8x16_sub(v, u8x16_splat(b'0')), u8x16_splat(9));
        let punctuation = v128_or(
            v128_or(
                i8x16_eq(v, u8x16_splat(b'.')),
                i8x16_eq(v, u8x16_splat(b'-')),
            ),
            i8x16_eq(v, u8x16_splat(b'_')),
        );
        u32::from(i8x16_bitmask(v128_not(v128_or(
            v128_or(alpha, digit),
            punctuation,
        ))))
    }
}

#[cfg(all(target_arch = "x86_64", target_feature = "sse2"))]
mod vector {
    use std::arch::x86_64::*;
    pub(super) type Block = __m128i;
    #[inline]
    pub(super) unsafe fn load(p: *const u8) -> Block {
        unsafe { _mm_loadu_si128(p.cast()) }
    }
    #[inline]
    pub(super) unsafe fn store(p: *mut u8, v: Block) {
        unsafe { _mm_storeu_si128(p.cast(), v) }
    }
    #[inline]
    pub(super) fn non_ascii(v: Block) -> bool {
        unsafe { _mm_movemask_epi8(v) != 0 }
    }
    #[inline]
    pub(super) fn lower(v: Block) -> Block {
        unsafe {
            let upper = _mm_and_si128(
                _mm_cmpgt_epi8(v, _mm_set1_epi8(b'A' as i8 - 1)),
                _mm_cmpgt_epi8(_mm_set1_epi8(b'Z' as i8 + 1), v),
            );
            _mm_or_si128(v, _mm_and_si128(upper, _mm_set1_epi8(32)))
        }
    }
    #[inline]
    pub(super) fn separators(v: Block) -> u32 {
        unsafe {
            let folded = _mm_or_si128(v, _mm_set1_epi8(32));
            let alpha = _mm_and_si128(
                _mm_cmpgt_epi8(folded, _mm_set1_epi8(b'a' as i8 - 1)),
                _mm_cmpgt_epi8(_mm_set1_epi8(b'z' as i8 + 1), folded),
            );
            let digit = _mm_and_si128(
                _mm_cmpgt_epi8(v, _mm_set1_epi8(b'0' as i8 - 1)),
                _mm_cmpgt_epi8(_mm_set1_epi8(b'9' as i8 + 1), v),
            );
            let punctuation = _mm_or_si128(
                _mm_or_si128(
                    _mm_cmpeq_epi8(v, _mm_set1_epi8(b'.' as i8)),
                    _mm_cmpeq_epi8(v, _mm_set1_epi8(b'-' as i8)),
                ),
                _mm_cmpeq_epi8(v, _mm_set1_epi8(b'_' as i8)),
            );
            (!_mm_movemask_epi8(_mm_or_si128(_mm_or_si128(alpha, digit), punctuation)) as u32)
                & 0xffff
        }
    }
}

#[cfg(all(target_arch = "aarch64", target_feature = "neon"))]
mod vector {
    use std::arch::aarch64::*;
    pub(super) type Block = uint8x16_t;
    #[inline]
    pub(super) unsafe fn load(p: *const u8) -> Block {
        unsafe { vld1q_u8(p) }
    }
    #[inline]
    pub(super) unsafe fn store(p: *mut u8, v: Block) {
        unsafe { vst1q_u8(p, v) }
    }
    #[inline]
    pub(super) fn non_ascii(v: Block) -> bool {
        unsafe { vmaxvq_u8(v) > 127 }
    }
    #[inline]
    pub(super) fn lower(v: Block) -> Block {
        unsafe {
            let upper = vandq_u8(vcgeq_u8(v, vdupq_n_u8(b'A')), vcleq_u8(v, vdupq_n_u8(b'Z')));
            vorrq_u8(v, vandq_u8(upper, vdupq_n_u8(32)))
        }
    }
    #[inline]
    pub(super) fn separators(v: Block) -> u32 {
        unsafe {
            let alpha = vcleq_u8(
                vsubq_u8(vorrq_u8(v, vdupq_n_u8(32)), vdupq_n_u8(b'a')),
                vdupq_n_u8(25),
            );
            let digit = vcleq_u8(vsubq_u8(v, vdupq_n_u8(b'0')), vdupq_n_u8(9));
            let punctuation = vorrq_u8(
                vorrq_u8(vceqq_u8(v, vdupq_n_u8(b'.')), vceqq_u8(v, vdupq_n_u8(b'-'))),
                vceqq_u8(v, vdupq_n_u8(b'_')),
            );
            let weights = [1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128];
            let bits = vandq_u8(
                vmvnq_u8(vorrq_u8(vorrq_u8(alpha, digit), punctuation)),
                vld1q_u8(weights.as_ptr()),
            );
            u32::from(vaddv_u8(vget_low_u8(bits))) | (u32::from(vaddv_u8(vget_high_u8(bits))) << 8)
        }
    }
}

pub(super) fn ascii_lowercase(text: &str) -> Option<String> {
    #[cfg(any(
        target_arch = "wasm32",
        all(target_arch = "x86_64", target_feature = "sse2"),
        all(target_arch = "aarch64", target_feature = "neon")
    ))]
    if text.len() >= 32 {
        // SAFETY: The selected backend is a baseline native feature or belongs
        // to the explicitly selected SIMD128 WASM artifact.
        return unsafe { lower_vectors(text.as_bytes()) };
    }
    text.is_ascii().then(|| text.to_ascii_lowercase())
}

pub(super) fn visit_ascii_words(text: &str, emit: impl FnMut(&str)) -> bool {
    #[cfg(any(
        target_arch = "wasm32",
        all(target_arch = "x86_64", target_feature = "sse2"),
        all(target_arch = "aarch64", target_feature = "neon")
    ))]
    if text.len() >= 32 && text.is_ascii() {
        // No callbacks run before the complete ASCII proof. A mixed UTF-8
        // input therefore falls back without emitting duplicate terms.
        unsafe { visit_vectors(text, emit) };
        return true;
    }
    let _ = emit;
    false
}

#[cfg(any(
    target_arch = "wasm32",
    all(target_arch = "x86_64", target_feature = "sse2"),
    all(target_arch = "aarch64", target_feature = "neon")
))]
#[cfg_attr(target_arch = "wasm32", target_feature(enable = "simd128"))]
unsafe fn lower_vectors(bytes: &[u8]) -> Option<String> {
    // SAFETY: The caller guarantees at least 32 bytes; the first full load is
    // in bounds. Reject common non-ASCII input before allocating an output.
    let first = unsafe { vector::load(bytes.as_ptr()) };
    if vector::non_ascii(first) {
        return None;
    }
    let mut output = Vec::<u8>::with_capacity(bytes.len());
    unsafe { vector::store(output.as_mut_ptr(), vector::lower(first)) };
    let mut at = 16;
    while bytes.len() - at >= 16 {
        // SAFETY: Both source and destination contain a complete 16-byte range.
        let block = unsafe { vector::load(bytes.as_ptr().add(at)) };
        if vector::non_ascii(block) {
            return None;
        }
        unsafe { vector::store(output.as_mut_ptr().add(at), vector::lower(block)) };
        at += 16;
    }
    for (i, &byte) in bytes[at..].iter().enumerate() {
        if !byte.is_ascii() {
            return None;
        }
        unsafe {
            output
                .as_mut_ptr()
                .add(at + i)
                .write(byte.to_ascii_lowercase())
        };
    }
    // SAFETY: Every byte has been initialized and proved ASCII, hence UTF-8.
    unsafe {
        output.set_len(bytes.len());
        Some(String::from_utf8_unchecked(output))
    }
}

#[cfg(any(
    target_arch = "wasm32",
    all(target_arch = "x86_64", target_feature = "sse2"),
    all(target_arch = "aarch64", target_feature = "neon")
))]
#[cfg_attr(target_arch = "wasm32", target_feature(enable = "simd128"))]
unsafe fn visit_vectors(text: &str, mut emit: impl FnMut(&str)) {
    let bytes = text.as_bytes();
    let mut start = 0;
    let mut at = 0;
    while bytes.len() - at >= 16 {
        // SAFETY: The complete vector is in bounds; all byte offsets in this
        // function are UTF-8 boundaries because the wrapper proved ASCII.
        let mut mask = vector::separators(unsafe { vector::load(bytes.as_ptr().add(at)) });
        while mask != 0 {
            let end = at + mask.trailing_zeros() as usize;
            if start < end {
                emit(&text[start..end]);
            }
            start = end + 1;
            mask &= mask - 1;
        }
        at += 16;
    }
    for (i, &byte) in bytes[at..].iter().enumerate() {
        if !(byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')) {
            let end = at + i;
            if start < end {
                emit(&text[start..end]);
            }
            start = end + 1;
        }
    }
    if start < text.len() {
        emit(&text[start..]);
    }
}
