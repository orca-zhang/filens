fn main() {
    println!("cargo:rerun-if-changed=src/fts.c");
    println!("cargo:rerun-if-changed=capacity.json");
    let capacity: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("capacity.json").unwrap()).unwrap();
    std::fs::write(
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("capacity.json"),
        serde_json::to_vec(&capacity).unwrap(),
    )
    .unwrap();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/fts.c").compile("filens_fts");
    }
}
