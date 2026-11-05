//! Rebuild original demo DWGs from the repository's cafe floor plan.
//! cargo run --no-default-features --features graphics-preview --example generate-cad-samples
use acadrust::{DwgWriter, DxfReader, types::DxfVersion};
use std::{fs, path::Path};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = root.join("apps/demo/public/samples/graphics");
    fs::create_dir_all(&output).unwrap();
    for (version, name) in [
        (DxfVersion::AC1015, "filens-cafe-2000.dwg"),
        (DxfVersion::AC1032, "filens-cafe-2018.dwg"),
    ] {
        let mut document = DxfReader::from_file(root.join("apps/demo/public/samples/filens-cafe.dxf"))
            .unwrap().read().unwrap();
        document.version = version;
        DwgWriter::write_to_file(output.join(name), &document).unwrap();
        println!("Generated {name}");
    }
}
