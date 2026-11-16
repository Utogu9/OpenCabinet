//! Read the certificate's Title ID from an original Xbox XBE, without execution.
use super::{
    invalid, u32le,
    xdvdfs::{self, read, Span},
    Budget, Identity,
};
use std::{fs::File, io, path::Path};

pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let mut file = File::open(path)?;
    let source = if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("iso"))
    {
        let Some(span) = xdvdfs::executable(&mut file, b"default.xbe", budget)? else {
            return Ok(None);
        };
        span
    } else {
        Span {
            offset: 0,
            size: file.metadata()?.len(),
        }
    };
    let mut header = [0; 0x11c];
    read(&mut file, source, 0, &mut header, budget)?;
    if &header[..4] != b"XBEH" {
        return Ok(None);
    }
    let base = u32le(&header[0x104..0x108])?;
    let headers = u32le(&header[0x108..0x10c])? as u64;
    let certificate = u32le(&header[0x118..0x11c])?
        .checked_sub(base)
        .ok_or_else(invalid)? as u64;
    if !(0x178..=1024 * 1024).contains(&headers)
        || headers > source.size
        || certificate < 0x178
        || certificate
            .checked_add(0xa4)
            .is_none_or(|end| end > headers)
    {
        return Err(invalid());
    }
    let mut metadata = [0; 0xa4];
    read(&mut file, source, certificate, &mut metadata, budget)?;
    let size = u64::from(u32le(&metadata[..4])?);
    if size < 0xa4
        || certificate
            .checked_add(size)
            .is_none_or(|end| end > headers)
    {
        return Err(invalid());
    }
    let title = u32le(&metadata[8..12])?;
    if title == 0 || title == u32::MAX || title == 0xdeadbeef {
        return Ok(None);
    }
    let mask = u32le(&metadata[0xa0..0xa4])?;
    let mut regions = Vec::new();
    // XBE bits describe permitted console territories, not a unique pressing.
    // Keep the broad Asian and PAL groups broad instead of inventing a country.
    if mask != 0 && mask != 7 && mask & !7 == 0 {
        if mask & 1 != 0 {
            regions.extend(["North America", "Brazil"].map(str::to_owned));
        }
        if mask & 2 != 0 {
            regions.extend(
                ["Asia", "Japan", "Korea", "China", "Taiwan", "Hong Kong"].map(str::to_owned),
            );
        }
        if mask & 4 != 0 {
            regions.extend(["Europe", "Australia"].map(str::to_owned));
        }
    }
    Ok(Some(Identity {
        serial: format!("{title:08X}"),
        regions,
    }))
}

/// Original Xbox catalogs use three-digit decimal product ordinals, unlike 360.
pub(crate) fn product_code(serial: &str) -> Option<String> {
    if serial.len() != 8 || !serial.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let id = u32::from_str_radix(serial, 16).ok()?;
    let bytes = id.to_be_bytes();
    let ordinal = id & 0xffff;
    if !bytes[..2].iter().all(u8::is_ascii_uppercase) || !(1..2000).contains(&ordinal) {
        return None;
    }
    Some(format!(
        "{}{}-{ordinal:03}",
        bytes[0] as char, bytes[1] as char
    ))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{
        cached_identity, identity_checked, init, tests::Files, xbox360, System,
    };
    use std::{
        fs,
        io::{Seek, SeekFrom, Write},
    };

    pub fn xbe(title: u32, region: u32) -> Vec<u8> {
        let mut bytes = vec![0; 4096];
        bytes[..4].copy_from_slice(b"XBEH");
        for (offset, value) in [
            (0x104, 0x10000u32),
            (0x108, 4096),
            (0x110, 0x178),
            (0x118, 0x10178),
            (0x178, 0x1d0),
            (0x180, title),
            (0x218, region),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
    pub fn iso(executable: &[u8]) -> Vec<u8> {
        let mut bytes = xbox360::tests::iso(executable);
        bytes[40 * 2048 + 14..40 * 2048 + 25].copy_from_slice(b"DeFaUlT.XbE");
        bytes
    }
    #[test]
    fn xbox_reads_loose_xbe_iso_and_xiso_iso_certificates_without_using_names() {
        let files = Files::new();
        let executable = xbe(0x41430001, 4);
        for (name, bytes) in [
            ("Wrong (USA).xbe", executable.clone()),
            ("Wrong (USA).iso", iso(&executable)),
            ("Wrong (USA).xiso.iso", iso(&executable)),
        ] {
            let path = files.write(name, &bytes);
            let identity =
                identity_checked(path.to_str().unwrap(), "Microsoft Xbox", &|| false).unwrap();
            assert_eq!(identity.serial, "41430001");
            assert_eq!(identity.regions, vec!["Europe", "Australia"]);
            assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
            assert!(identity_checked(path.to_str().unwrap(), "Xbox", &|| true).is_none());
        }
        let path = files.0.join("partition.iso");
        let mut file = File::create(&path).unwrap();
        file.seek(SeekFrom::Start(0x2080000)).unwrap();
        file.write_all(&iso(&executable)).unwrap();
        drop(file);
        assert_eq!(
            identity_checked(path.to_str().unwrap(), "Xbox", &|| false)
                .unwrap()
                .serial,
            "41430001"
        );
        assert_eq!(product_code("41430001").as_deref(), Some("AC-001"));
        assert_eq!(product_code("4D530085").as_deref(), Some("MS-133"));
        assert_eq!(product_code("4D530004").as_deref(), Some("MS-004"));
        for id in [
            "4D530805", "00000000", "FFFFFFFF", "DEADBEEF", "41430000", "invalid",
        ] {
            assert!(product_code(id).is_none(), "{id}");
        }
    }
    #[test]
    fn xbox_validates_virtual_certificate_addresses_header_limits_and_title_ids() {
        let files = Files::new();
        let valid = xbe(0x4d530004, 1);
        for (offset, value) in [
            (0x108, 0u32),
            (0x108, 1024 * 1024 + 1),
            (0x108, 8192),
            (0x118, 0xffff),
            (0x118, 0x10000),
            (0x118, 0x11000),
            (0x178, 0),
            (0x178, 4096),
            (0x180, 0),
            (0x180, u32::MAX),
            (0x180, 0xdeadbeef),
        ] {
            let mut bad = valid.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            let path = files.write("invalid.xbe", &bad);
            assert!(
                identity_checked(path.to_str().unwrap(), "Xbox", &|| false).is_none(),
                "offset {offset:x}, value {value:x}"
            );
        }
        for length in [0, 4, 0x11b, 0x178, 0x21b, 4095] {
            let path = files.write("truncated.xbe", &valid[..length]);
            assert!(identity_checked(path.to_str().unwrap(), "Xbox", &|| false).is_none());
        }
        let wrong = files.write(
            "actually-360.iso",
            &xbox360::tests::iso(&xbox360::tests::xex(0x4d530805, 0xff)),
        );
        assert!(identity_checked(wrong.to_str().unwrap(), "Xbox", &|| false).is_none());
        for mask in [0, 7, 0x80000000] {
            let path = files.write("region-free.xbe", &xbe(0x4d530004, mask));
            assert!(identity_checked(path.to_str().unwrap(), "Xbox", &|| false)
                .unwrap()
                .regions
                .is_empty());
        }
        let path = files.write("asia.xbe", &xbe(0x4d530004, 2));
        let regions = identity_checked(path.to_str().unwrap(), "Xbox", &|| false)
            .unwrap()
            .regions;
        assert!(regions.contains(&"Asia".into()));
        assert!(regions.contains(&"Japan".into()));
    }
    #[test]
    fn xbox_cached_certificates_preserve_files_and_do_not_share_xbox360_identities() {
        let files = Files::new();
        let original = iso(&xbe(0x41430001, 7));
        let path = files.write("same.xiso.iso", &original);
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_identity(&path, System::Xbox, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "41430001"
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&path, System::Xbox, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        assert!(cached_identity(&path, System::Xbox360, Some(&conn), &|| false).is_none());
        let mut changed = iso(&xbe(0x4d530004, 7));
        changed.push(0);
        fs::write(&path, changed).unwrap();
        assert_eq!(
            cached_identity(&path, System::Xbox, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "4D530004"
        );
    }
}
