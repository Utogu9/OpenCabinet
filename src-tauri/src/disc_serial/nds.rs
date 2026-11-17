//! Nintendo DS cartridge metadata. No secure-area decryption or ROM extraction.
use super::{invalid, limited, u32le, Budget, Identity};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

const HEADER: usize = 0x160;
const MAX_ENTRIES: usize = 4096;
const MAX_ZIP_READ: u64 = 4 * 1024 * 1024;

// Bound archive indexing as well as decompression, checking cancellation at
// every read/seek. Large ROM payloads are never read into memory.
struct ArchiveFile<'a, 'b> {
    file: File,
    left: u64,
    budget: &'a mut Budget<'b>,
}
impl Read for ArchiveFile<'_, '_> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.budget.check()?;
        if self.left == 0 {
            return Err(limited());
        }
        let length = bytes.len().min(self.left as usize);
        let read = self.file.read(&mut bytes[..length])?;
        self.left -= read as u64;
        self.budget.check()?;
        Ok(read)
    }
}
impl Seek for ArchiveFile<'_, '_> {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.budget.check()?;
        self.file.seek(position)
    }
}

fn crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0xffffu16;
    for byte in bytes {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 != 0 { 0xa001 } else { 0 };
        }
    }
    crc
}

fn header_identity(header: &[u8; HEADER], size: u64) -> io::Result<Option<Identity>> {
    let code = &header[0x0c..0x10];
    let maker = &header[0x10..0x12];
    let alphanumeric = |bytes: &[u8]| {
        bytes
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    };
    if !alphanumeric(code)
        || !alphanumeric(maker)
        || maker == b"00"
        || matches!(code, b"0000" | b"AAAA" | b"PASS")
        // DSi-enhanced cartridges remain DS games; DSi-only titles do not.
        || !matches!(header[0x12], 0 | 2)
        || crc16(&header[..0x15e]) != u16::from_le_bytes([header[0x15e], header[0x15f]])
    {
        return Ok(None);
    }
    let header_size = u32le(&header[0x84..0x88])? as u64;
    if header_size < HEADER as u64 || header_size > size {
        return Ok(None);
    }
    for (offset_field, size_field) in [(0x20, 0x2c), (0x30, 0x3c)] {
        let start = u32le(&header[offset_field..offset_field + 4])? as u64;
        let length = u32le(&header[size_field..size_field + 4])? as u64;
        if start < header_size || length == 0 || start + length > size {
            return Ok(None);
        }
    }
    // The card-capacity/ROM-size fields need not equal the physical length:
    // trimmed dumps are common. Unknown territory letters stay unknown.
    let region = match code[3] {
        b'E' => Some("North America"),
        b'J' => Some("Japan"),
        b'P' | b'D' | b'F' | b'I' | b'S' => Some("Europe"),
        b'K' => Some("Korea"),
        b'C' => Some("China"),
        b'U' => Some("Australia"),
        _ => None,
    };
    Ok(Some(Identity {
        serial: std::str::from_utf8(code).map_err(|_| invalid())?.to_owned(),
        regions: region.into_iter().map(str::to_owned).collect(),
    }))
}

pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let mut file = File::open(path)?;
    let mut header = [0; HEADER];
    let size;
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        // Ordinary ZIPs start at offset zero. Avoid the library's generic
        // prepended-data detection, which otherwise scans the whole archive.
        let mut archive = zip::ZipArchive::with_config(
            zip::read::Config {
                archive_offset: zip::read::ArchiveOffset::Known(0),
            },
            ArchiveFile {
                file,
                left: MAX_ZIP_READ,
                budget,
            },
        )
        .map_err(io::Error::other)?;
        if archive.len() > MAX_ENTRIES {
            return Err(limited());
        }
        let mut selected = None;
        for index in 0..archive.len() {
            let entry = archive.by_index_raw(index).map_err(io::Error::other)?;
            if !entry.is_dir()
                && entry
                    .name_raw()
                    .get(entry.name_raw().len().saturating_sub(4)..)
                    .is_some_and(|suffix| suffix.eq_ignore_ascii_case(b".nds"))
            {
                if selected.replace(index).is_some() {
                    return Ok(None); // Never pick an arbitrary ROM in a collection.
                }
            }
        }
        let Some(index) = selected else {
            return Ok(None);
        };
        let mut entry = archive.by_index(index).map_err(io::Error::other)?;
        size = entry.size();
        entry.read_exact(&mut header)?;
        // Stop after the header: no extraction, full CRC check or payload scan.
    } else if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("nds"))
    {
        size = file.metadata()?.len();
        file.read_exact(&mut header)?;
    } else {
        return Ok(None);
    }
    budget.account(HEADER)?;
    header_identity(&header, size)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{cached_identity, identity_checked, init, tests::Files, System};
    use std::io::{Cursor, Write};

    pub(crate) fn rom(code: &str) -> Vec<u8> {
        let mut bytes = vec![0; 0x4200];
        bytes[0x0c..0x10].copy_from_slice(code.as_bytes());
        bytes[0x10..0x12].copy_from_slice(b"01");
        for (offset, value) in [
            (0x20, 0x4000u32),
            (0x2c, 0x100),
            (0x30, 0x4100),
            (0x3c, 0x100),
            (0x80, 0x2000000),
            (0x84, 0x4000),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        checksum(&mut bytes);
        bytes
    }
    fn checksum(bytes: &mut [u8]) {
        let crc = crc16(&bytes[..0x15e]);
        bytes[0x15e..0x160].copy_from_slice(&crc.to_le_bytes());
    }
    pub(crate) fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(
                    *name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
    #[test]
    fn nds_headers_identify_regions_trimmed_dumps_and_dsi_enhanced_cartridges() {
        let files = Files::new();
        for (code, region) in [
            ("YW2E", "North America"),
            ("AWRP", "Europe"),
            ("ADAJ", "Japan"),
            ("ADAK", "Korea"),
            ("ADAC", "China"),
            ("ADAU", "Australia"),
            ("ADAD", "Europe"),
        ] {
            let mut bytes = rom(code);
            for unit in [0, 2] {
                bytes[0x12] = unit;
                checksum(&mut bytes);
                for (name, data) in [
                    ("Wrong title (Japan).NDS", bytes.clone()),
                    (
                        "Wrong title.ZIP",
                        zip(&[("folder/actually.NdS", &bytes), ("readme.txt", b"ignored")]),
                    ),
                ] {
                    let path = files.write(name, &data);
                    let id =
                        identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false).unwrap();
                    assert_eq!(id.serial, code);
                    assert_eq!(id.regions, [region]);
                    assert_eq!(std::fs::read(&path).unwrap(), data);
                }
            }
        }
        let path = files.write("unknown-region.nds", &rom("ADAX"));
        assert!(
            identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false)
                .unwrap()
                .regions
                .is_empty()
        );
    }
    #[test]
    fn nds_rejects_corruption_foreign_headers_homebrew_and_ambiguous_archives() {
        let files = Files::new();
        let valid = rom("YW2E");
        let mut invalid_headers = Vec::new();
        for (offset, value) in [
            (0x0c, b'#'),
            (0x10, b'?'),
            (0x12, 3),
            (0x12, 255),
            (0x21, 0),
            (0x2f, 255),
            (0x87, 255),
        ] {
            let mut bytes = valid.clone();
            bytes[offset] = value;
            checksum(&mut bytes);
            invalid_headers.push(bytes);
        }
        for code in ["####", "0000", "AAAA", "PASS"] {
            invalid_headers.push(rom(code));
        }
        let mut homebrew = valid.clone();
        homebrew[0x10..0x12].copy_from_slice(b"00");
        checksum(&mut homebrew);
        invalid_headers.push(homebrew);
        let mut damaged = valid.clone();
        damaged[0x0c] = b'X'; // Bad header CRC, even though the code looks plausible.
        invalid_headers.push(damaged);
        invalid_headers.push(valid[..0x15f].to_vec());
        invalid_headers.push(valid[..0x4101].to_vec());
        for bytes in invalid_headers {
            let path = files.write("bad.nds", &bytes);
            assert!(identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false).is_none());
        }
        for entries in [
            vec![("one.nds", valid.as_slice()), ("two.nds", valid.as_slice())],
            vec![("readme.txt", b"no ROM".as_slice())],
        ] {
            let path = files.write("collection.zip", &zip(&entries));
            assert!(identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false).is_none());
        }
        let path = files.write("damaged.zip", b"not a zip");
        assert!(identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false).is_none());
        let path = files.write("other.gba", &valid);
        assert!(identity_checked(path.to_str().unwrap(), "Nintendo DS", &|| false).is_none());
        let path = files.write("good.nds", &valid);
        assert!(identity_checked(path.to_str().unwrap(), "Nintendo 3DS", &|| false).is_none());
    }
    #[test]
    fn nds_cache_invalidates_and_cancelled_reads_are_not_saved() {
        let files = Files::new();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        let path = files.write("cached.zip", &zip(&[("game.nds", &rom("YW2E"))]));
        assert!(cached_identity(&path, System::Nds, Some(&conn), &|| true).is_none());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM disc_identities", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            cached_identity(&path, System::Nds, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "YW2E"
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&path, System::Nds, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        let mut changed = zip(&[("game.nds", &rom("AWRP"))]);
        changed.push(0);
        std::fs::write(&path, changed).unwrap();
        assert_eq!(
            cached_identity(&path, System::Nds, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "AWRP"
        );
        let path = files.write("cancel.nds", &rom("YW2E"));
        let calls = std::cell::Cell::new(0);
        assert!(cached_identity(&path, System::Nds, Some(&conn), &|| {
            calls.set(calls.get() + 1);
            calls.get() > 2
        })
        .is_none());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM disc_identities", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
