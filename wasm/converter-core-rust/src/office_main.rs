// Reuse the core's protocol, limits and CFB validation. LTO discards conversion
// code: this module only returns decrypted source bytes to the conversion core.
#![allow(dead_code)]
include!("main.rs");

fn main() {
    office::decrypt_main();
}
