//! Identify linear Mega Drive/Genesis ROMs from their small, unencrypted header.
use super::{Budget, Identity};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

fn console(header: &[u8]) -> bool {
    matches!(
        std::str::from_utf8(&header[0x100..0x110])
            .ok()
            .map(str::trim),
        Some("SEGA GENESIS" | "SEGA MEGA DRIVE" | "SEGA MEGADRIVE")
    )
}
fn product(field: &[u8]) -> Option<String> {
    let raw = std::str::from_utf8(field)
        .ok()?
        .split('\0')
        .next()?
        .trim()
        .to_ascii_uppercase();
    let value = if raw.starts_with("MK-") || raw.starts_with("T-") || raw.starts_with("G-") {
        raw.as_str()
    } else {
        raw.strip_prefix("GM")
            .or_else(|| raw.strip_prefix("GK"))
            .or_else(|| raw.strip_prefix("MK"))
            .or_else(|| raw.strip_prefix("AI"))?
            .trim()
    };
    let parts: Vec<_> = value.split_ascii_whitespace().collect();
    // Some licensed headers separate the revision with a space, not a dash:
    // "T-081096 00" must still match the catalog's "T-081096-00".
    let serial = if parts.len() > 1
        && parts
            .last()
            .is_some_and(|s| s.len() == 2 && s.bytes().all(|b| b.is_ascii_digit()))
    {
        let base = parts[..parts.len() - 1].concat();
        format!("{}-{}", base.trim_end_matches('-'), parts.last()?)
    } else {
        parts.concat()
    };
    if !(4..=14).contains(&serial.len())
        || !serial
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !serial.bytes().any(|b| b.is_ascii_digit())
    {
        return None;
    }
    let base = serial
        .rsplit_once('-')
        .filter(|(_, rev)| rev.len() == 2 && rev.bytes().all(|b| b.is_ascii_digit()))
        .map_or(serial.as_str(), |(base, _)| base);
    let number = base.trim_start_matches(|c: char| c.is_ascii_alphabetic() || c == '-');
    // Placeholder codes are shared by unrelated commercial prototypes and
    // homebrew entries in preservation catalogs. They cannot identify a game.
    if number.is_empty()
        || (number.bytes().all(|b| b.is_ascii_digit())
            && number.parse::<u64>().ok().is_some_and(|n| n <= 1))
    {
        return None;
    }
    Some(serial)
}
fn regions(field: &[u8]) -> Vec<String> {
    let Ok(text) = std::str::from_utf8(field) else {
        return Vec::new();
    };
    let text = text.trim_matches(['\0', ' ']).to_ascii_uppercase();
    let mask = match text.as_str() {
        "USA" | "US" => 4,
        "EUR" | "EUROPE" => 8,
        "JAP" | "JPN" | "JAPAN" => 1,
        _ => {
            let mut mask = 0;
            for byte in text.bytes() {
                mask |= match byte {
                    b'J' => 1,
                    b'U' => 4,
                    b'E' => 8,
                    b'0'..=b'9' => byte - b'0',
                    b'A'..=b'F' => byte - b'A' + 10,
                    b' ' | b'\0' | b'/' | b',' | b';' => 0,
                    _ => return Vec::new(),
                };
            }
            mask
        }
    };
    [(1, "Japan"), (4, "North America"), (8, "Europe")]
        .into_iter()
        .filter(|(bit, _)| mask & bit != 0)
        .map(|(_, region)| region.to_owned())
        .collect()
}
pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let mut header = [0; 512];
    File::open(path)?.read_exact(&mut header)?;
    budget.check()?;
    if !console(&header) {
        // A few linear dumps are stored with each 16-bit word byte-swapped.
        for pair in header.chunks_exact_mut(2) {
            pair.swap(0, 1);
        }
        if !console(&header) {
            return Ok(None);
        }
    }
    Ok(product(&header[0x180..0x18e]).map(|serial| Identity {
        serial,
        regions: regions(&header[0x1f0..0x200]),
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{System, cached_identity, init, tests::Files};
    use rusqlite::Connection;
    use std::time::Instant;
    pub(crate) fn rom(product: &str, region: &str) -> Vec<u8> {
        let mut data = vec![0; 1024];
        data[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        data[0x180..0x18e].fill(b' ');
        data[0x180..0x180 + product.len()].copy_from_slice(product.as_bytes());
        data[0x1f0..0x200].fill(b' ');
        data[0x1f0..0x1f0 + region.len()].copy_from_slice(region.as_bytes());
        data
    }
    #[test]
    fn megadrive_linear_and_swapped_roms_keep_product_revisions_and_cache_independently() {
        let files = Files::new();
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        for (raw, expected) in [
            ("GM MK-1042 -00", "MK-1042-00"),
            ("GM T-081096 00", "T-081096-00"),
            ("MK 00001019-00", "00001019-00"),
            ("Gk 00001015-00", "00001015-00"),
            ("MK-1136", "MK-1136"),
        ] {
            let data = rom(raw, "JUE");
            for extension in ["gen", "md", "bin"] {
                let path = files.write(&format!("wrong.{extension}"), &data);
                let id = cached_identity(&path, System::MegaDrive, Some(&conn), &|| false).unwrap();
                assert_eq!(id.serial, expected);
                assert_eq!(id.regions, ["Japan", "North America", "Europe"]);
                assert_eq!(std::fs::read(&path).unwrap(), data);
            }
        }
        let mut swapped = rom("GM 00001009-00", "F");
        for pair in swapped.chunks_exact_mut(2) {
            pair.swap(0, 1);
        }
        let path = files.write("swapped.gen", &swapped);
        let id = cached_identity(&path, System::MegaDrive, Some(&conn), &|| false).unwrap();
        assert_eq!(id.serial, "00001009-00");
        assert_eq!(id.regions.len(), 3);
        let mut changed = rom("GM 00001009-01", "8");
        changed.push(0);
        std::fs::write(&path, changed).unwrap();
        let id = cached_identity(&path, System::MegaDrive, Some(&conn), &|| false).unwrap();
        assert_eq!(id.serial, "00001009-01");
        assert_eq!(id.regions, ["Europe"]);
        assert!(cached_identity(&path, System::SegaCd, Some(&conn), &|| false).is_none());
        assert!(cached_identity(&path, System::MegaDrive, Some(&conn), &|| true).is_none());
    }
    #[test]
    fn megadrive_placeholders_invalid_headers_and_unknown_regions_fall_back() {
        let files = Files::new();
        for code in [
            "GM 00000000-00",
            "GM 00000001-00",
            "GM T-000000-00",
            "FINAL      -01",
            "GM HOMEBREW",
            "GM T-12016,0.0",
        ] {
            assert!(product(code.as_bytes()).is_none(), "{code}");
        }
        for (field, expected) in [
            ("U", vec!["North America"]),
            ("A", vec!["Europe"]),
            ("EUR", vec!["Europe"]),
            ("JPN", vec!["Japan"]),
            ("UNKNOWN", vec![]),
        ] {
            assert_eq!(regions(field.as_bytes()), expected);
        }
        let mut data = rom("GM MK-1042 -00", "U");
        data[0x100..0x110].copy_from_slice(b"SEGA 32X        ");
        let path = files.write("wrong.gen", &data);
        let mut budget = Budget {
            started: Instant::now(),
            inflated: 0,
            cancelled: &|| false,
        };
        assert!(identity(&path, &mut budget).unwrap().is_none());
        let path = files.write("truncated.gen", b"SEGA");
        assert!(identity(&path, &mut budget).is_err());
        let mut budget = Budget {
            started: Instant::now(),
            inflated: 0,
            cancelled: &|| true,
        };
        assert_eq!(
            identity(&path, &mut budget).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
    }
}
