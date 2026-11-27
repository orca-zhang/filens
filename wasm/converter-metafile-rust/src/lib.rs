use std::cell::RefCell;
use std::ptr;

const MAX_INPUT: usize = 8 * 1024 * 1024;
const MAX_SVG: usize = 8 * 1024 * 1024;

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Reserve an entire input buffer in WASM memory for the host to fill.
#[unsafe(no_mangle)]
pub extern "C" fn reserve_input(length: usize) -> *mut u8 {
    if length == 0 || length > MAX_INPUT {
        return ptr::null_mut();
    }
    INPUT.with_borrow_mut(|input| {
        input.resize(length, 0);
        input.as_mut_ptr()
    })
}

/// Decode the current input and return the address of its UTF-8 SVG.
#[unsafe(no_mangle)]
pub extern "C" fn render_svg() -> *const u8 {
    let input = INPUT.take();
    let mut budget = metafile::ReplayBudget::default();
    budget.pixels = budget.pixels.min(16 * 1024 * 1024);
    let mut output_bytes = MAX_SVG;
    let result = metafile::to_svg_with_limits(&input, &mut budget, &mut output_bytes);
    OUTPUT.with_borrow_mut(|output| {
        *output = result.map(|svg| svg.markup).unwrap_or_default();
        if output.is_empty() { ptr::null() } else { output.as_ptr() }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn output_size() -> usize {
    OUTPUT.with_borrow(String::len)
}
