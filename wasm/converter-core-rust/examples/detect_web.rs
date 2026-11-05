//! Browser transport for the same detection rules. No paths, CLI or JSON output.
#![cfg(target_arch = "wasm32")]

#[path = "../src/format_detection.rs"]
mod format_detection;

use std::io::{self, Read, Seek, SeekFrom};

#[link(wasm_import_module = "filens")]
unsafe extern "C" {
    /// Copies at most `length` source bytes into valid WASM-owned memory.
    fn read_at(offset: u32, target: *mut u8, length: u32) -> u32;
}

struct Source {
    offset: u64,
    size: u64,
}
impl Read for Source {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        let length = (self.size.saturating_sub(self.offset)).min(target.len() as u64) as u32;
        if length == 0 {
            return Ok(0);
        }
        // The host receives a pointer into this live mutable slice only for this call.
        let count = unsafe { read_at(self.offset as u32, target.as_mut_ptr(), length) };
        if count > length {
            return Err(io::Error::other("invalid source read"));
        }
        self.offset += u64::from(count);
        Ok(count as usize)
    }
}
impl Seek for Source {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let next = match position {
            SeekFrom::Start(n) => i128::from(n),
            SeekFrom::Current(n) => i128::from(self.offset) + i128::from(n),
            SeekFrom::End(n) => i128::from(self.size) + i128::from(n),
        };
        if !(0..=i128::from(u32::MAX)).contains(&next) {
            return Err(io::Error::other("invalid source seek"));
        }
        self.offset = next as u64;
        Ok(self.offset)
    }
}

// Four pointer/length pairs followed by bytesRead and fileBytes, little-endian.
// One instance is called synchronously and reused, never concurrently/reentrantly.
static mut RESULT: [u32; 10] = [0; 10];

fn string(value: Option<&'static str>) -> [u32; 2] {
    value.map_or([0, 0], |s| [s.as_ptr() as u32, s.len() as u32])
}

#[unsafe(no_mangle)]
pub extern "C" fn filens_detect(size: u32) -> *const u32 {
    let Ok(value) = format_detection::detect(&mut Source {
        size: u64::from(size),
        offset: 0,
    }) else {
        return std::ptr::null();
    };
    let [fp, fl] = string(value.format);
    let [cp, cl] = string(value.container);
    let [ep, el] = string(Some(value.evidence));
    let [rp, rl] = string(Some(value.reason));
    unsafe {
        RESULT = [
            fp,
            fl,
            cp,
            cl,
            ep,
            el,
            rp,
            rl,
            value.bytes_read as u32,
            size,
        ];
    }
    std::ptr::addr_of!(RESULT).cast()
}
