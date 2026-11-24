# iwork dependency patch

Source: crates.io `iwork` 0.4.0, MIT license retained in LICENSE.
Crate SHA-256: `0fc1f8cb86d1cb7c74a79adf9182369018fcb76dbabb63c423d583f96f57d80a`.
Library source and embedded resources are unchanged except that
`Package::from_bytes` validates local/central ZIP header consistency before reading entries.
Cargo.toml changes zip 2 to zip >=9.1.3
and selects its flate2 backend, so iWork uses the same patched ZIP parser as
the conversion core. COOKBOOK.md is included by lib.rs at compile time.

This local dependency is required until upstream supports a patched zip release.
It removes GHSA-m665-v7pm-7grj, GHSA-q7v9-x93c-xqv3 and
GHSA-8hxf-qr8p-62x4 from the iWork dependency chain.
