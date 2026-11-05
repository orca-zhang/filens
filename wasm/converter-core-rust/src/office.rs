//! Office decryption belongs to the shared WASM core, including legacy formats.
use super::*;
use msoffice_crypto::{Family, classify};
#[cfg(feature = "office-crypto")]
use msoffice_crypto::{Error, decrypt_binary_office, decrypt_ooxml};

pub(super) fn convert_encrypted(request: &Request) -> Option<Result<(), ConvertError>> {
    decrypt(request).map(|result| {
        let (decrypted, envelope) = result?;
        if envelope {
            normalize_package_reader(
                std::io::Cursor::new(&decrypted),
                &request.output,
                &request.target,
            )
        } else if is_word_binary_source(&request.source) {
            convert_word_binary_bytes(&decrypted, &request.output)
        } else if is_biff_source(&request.source) {
            convert_biff_bytes(&decrypted, &request.output)
        } else {
            convert_ppt_binary_bytes(&decrypted, &request.output)
        }
    })
}

fn decrypt(request: &Request) -> Option<Result<(Vec<u8>, bool), ConvertError>> {
    if !(is_openxml_source(&request.source)
        || is_word_binary_source(&request.source)
        || is_biff_source(&request.source)
        || is_ppt_binary_source(&request.source))
    {
        return None;
    }
    let mut header = [0; 8];
    File::open(&request.input)
        .ok()?
        .read_exact(&mut header)
        .ok()?;
    if header != [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] {
        return None;
    }
    if fs::metadata(&request.input).ok()?.len() > MAX_PACKAGE_BYTES {
        return Some(Err(parse_error(
            "Encrypted document exceeds the 256 MiB limit.".into(),
        )));
    }
    let input = match fs::read(&request.input) {
        Ok(input) => input,
        Err(_) => return Some(Err(io_error("Could not read encrypted document.".into()))),
    };
    let class = classify(&input);
    // Also recognize damaged OOXML envelopes, without calling a wrong password
    // the cause of a malformed encryption header.
    let envelope = CompoundFile::parse(&input).ok().is_some_and(|file| {
        file.entries
            .iter()
            .filter(|entry| entry.kind == 2 && !entry.path.contains('/'))
            .any(|entry| entry.name == "EncryptionInfo" || entry.name == "EncryptedPackage")
    });
    if !class.is_encrypted() && !envelope {
        return None;
    }
    Some((|| {
        if matches!(class.family, Family::Unsupported | Family::Irm) {
            return Err(ConvertError {
                code: "unsupported_format",
                message: "This document's encryption method is not supported.".into(),
            });
        }
        if request.password.is_empty() {
            return Err(ConvertError {
                code: "password_required",
                message: "This document requires a password.".into(),
            });
        }
        if class
            .password_key
            .as_ref()
            .and_then(|key| key.spin_count)
            .is_some_and(|count| count > 1_000_000)
        {
            return Err(parse_error(
                "Document password derivation exceeds the supported work limit.".into(),
            ));
        }
        // Check the declared plaintext length before the crypto library allocates it.
        if envelope {
            let file = CompoundFile::parse(&input)?;
            let entry = file
                .entries
                .iter()
                .filter(|entry| entry.kind == 2 && !entry.path.contains('/'))
                .find(|entry| entry.name == "EncryptedPackage")
                .ok_or_else(|| parse_error("Encrypted package is missing.".into()))?;
            if entry.size > MAX_PACKAGE_BYTES + (1 << 20) {
                return Err(parse_error(
                    "Encrypted package exceeds the supported size limit.".into(),
                ));
            }
            let package = file.read_stream(entry)?;
            let size = package
                .get(..8)
                .and_then(|bytes| bytes.try_into().ok())
                .map(u64::from_le_bytes)
                .ok_or_else(|| parse_error("Encrypted package is truncated.".into()))?;
            if size > MAX_PACKAGE_BYTES {
                return Err(parse_error(
                    "Decrypted package exceeds the 256 MiB limit.".into(),
                ));
            }
        }
        #[cfg(not(feature = "office-crypto"))]
        return Err(ConvertError {
            code: "engine_unavailable",
            message: "Office decryption requires the optional converter-office WASM module.".into(),
        });
        #[cfg(feature = "office-crypto")]
        {
            let decrypted = if envelope {
                decrypt_ooxml(&input, &request.password)
            } else {
                decrypt_binary_office(&input, &request.password)
            }
            .map_err(map_error)?;
            if decrypted.len() as u64 > MAX_PACKAGE_BYTES {
                return Err(parse_error(
                    "Decrypted document exceeds the 256 MiB limit.".into(),
                ));
            }
            Ok((decrypted, envelope))
        }
    })())
}

#[cfg(feature = "office-crypto")]
fn map_error(error: Error) -> ConvertError {
    match error {
        Error::WrongPassword => ConvertError {
            code: "password_invalid",
            message: "Incorrect password. Please try again.".into(),
        },
        Error::UnsupportedEncryptionVersion(..)
        | Error::UnsupportedAlgorithm { .. }
        | Error::UnsupportedEncryptedContent(_) => ConvertError {
            code: "unsupported_format",
            message: "This document's encryption method is not supported.".into(),
        },
        Error::IntegrityCheckFailed => parse_error(
            "Encrypted document integrity check failed; the file may be damaged.".into(),
        ),
        _ => {
            parse_error("The encrypted document is damaged or has invalid encryption data.".into())
        }
    }
}

/// WASI entry for the optional decrypt-only engine. Parsing and cryptography stay
/// in Rust; hosts simply pass its output back through the ordinary converter.
#[cfg(feature = "office-crypto")]
#[allow(dead_code)] // Only converter-office uses this shared entry point.
pub(super) fn decrypt_main() {
    let started = Instant::now();
    let mut request = Request::default();
    let parsed = parse_request(&mut request);
    let input_size = fs::metadata(&request.input).map_or(0, |metadata| metadata.len());
    let converted = match parsed {
        Err(message) => Err(io_error(message)),
        Ok(()) => decrypt(&request)
            .unwrap_or_else(|| Err(ConvertError {
                code: "unsupported_format",
                message: "The Office decryption module requires an encrypted Office document.".into(),
            }))
            .and_then(|(bytes, _)| fs::write(&request.output, bytes)
                .map_err(|_| io_error("Could not write decrypted document.".into()))),
    };
    let result = match converted {
        Ok(()) => success(&request, input_size, "office-encryption", ""),
        Err(error) => failure(&request, error.code, error.message, input_size, Some("office-encryption")),
    };
    let ok = result.ok;
    if let Err(error) = write_result(&request.result, result, started.elapsed().as_millis()) {
        eprintln!("{error}");
        process::exit(1);
    }
    process::exit(if ok { 0 } else { 1 });
}
