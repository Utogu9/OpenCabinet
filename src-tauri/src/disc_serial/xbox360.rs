//! Inspect XEX2 headers in Xbox 360 discs and archives without decryption.
mod zar;
use super::{invalid, u32le, Budget, Identity};
use std::{
    collections::HashSet,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

#[derive(Clone, Copy)]
struct Span {
    offset: u64,
    size: u64,
}
fn be32(bytes: &[u8]) -> io::Result<u32> {
    Ok(u32::from_be_bytes(bytes.try_into().map_err(|_| invalid())?))
}
fn be64(bytes: &[u8]) -> io::Result<u64> {
    Ok(u64::from_be_bytes(bytes.try_into().map_err(|_| invalid())?))
}
fn read(
    file: &mut File,
    span: Span,
    offset: u64,
    bytes: &mut [u8],
    budget: &mut Budget<'_>,
) -> io::Result<()> {
    budget.check()?;
    if offset
        .checked_add(bytes.len() as u64)
        .is_none_or(|end| end > span.size)
    {
        return Err(invalid());
    }
    file.seek(SeekFrom::Start(
        span.offset.checked_add(offset).ok_or_else(invalid)?,
    ))?;
    file.read_exact(bytes)?;
    budget.check()
}
enum Source {
    File(File, Span),
    Zar(zar::Archive, Span),
}
impl Source {
    fn size(&self) -> u64 {
        match self {
            Self::File(_, span) | Self::Zar(_, span) => span.size,
        }
    }
    fn read(&mut self, offset: u64, bytes: &mut [u8], budget: &mut Budget<'_>) -> io::Result<()> {
        match self {
            Self::File(file, span) => read(file, *span, offset, bytes, budget),
            Self::Zar(archive, span) => archive.read(*span, offset, bytes, budget),
        }
    }
}
fn disc(file: &mut File, budget: &mut Budget<'_>) -> io::Result<Option<Span>> {
    let whole = Span {
        offset: 0,
        size: file.metadata()?.len(),
    };
    for base in [0, 0xfb20, 0x20600, 0x2080000, 0xfd90000, 0x18300000] {
        let offset = base + 32 * 2048;
        if offset + 32 > whole.size {
            continue;
        }
        let mut header = [0; 32];
        read(file, whole, offset, &mut header, budget)?;
        if &header[..20] != b"MICROSOFT*XBOX*MEDIA" {
            continue;
        }
        let root = Span {
            offset: base + u64::from(u32le(&header[20..24])?) * 2048,
            size: u64::from(u32le(&header[24..28])?),
        };
        if !(14..=4 * 1024 * 1024).contains(&root.size)
            || root
                .offset
                .checked_add(root.size)
                .is_none_or(|end| end > whole.size)
        {
            return Err(invalid());
        }
        let mut directory = vec![0; root.size as usize];
        read(file, root, 0, &mut directory, budget)?;
        let mut stack = vec![0usize];
        let mut visited = HashSet::new();
        let mut found = None;
        while let Some(offset) = stack.pop() {
            budget.check()?;
            if visited.len() >= 65536 || !visited.insert(offset) {
                return Err(invalid());
            }
            let entry = directory
                .get(offset..)
                .filter(|b| b.len() >= 14)
                .ok_or_else(invalid)?;
            let name = entry.get(14..14 + entry[13] as usize).ok_or_else(invalid)?;
            if entry[12] & 0x10 == 0 && name.eq_ignore_ascii_case(b"default.xex") {
                let span = Span {
                    offset: base + u64::from(u32le(&entry[4..8])?) * 2048,
                    size: u64::from(u32le(&entry[8..12])?),
                };
                if span.size < 24
                    || span
                        .offset
                        .checked_add(span.size)
                        .is_none_or(|end| end > whole.size)
                    || found.is_some()
                {
                    return Err(invalid());
                }
                found = Some(span);
            }
            for child in [
                u16::from_le_bytes([entry[0], entry[1]]),
                u16::from_le_bytes([entry[2], entry[3]]),
            ] {
                if child != 0 {
                    stack.push(child as usize * 4);
                }
            }
        }
        return Ok(found);
    }
    Ok(None)
}
fn xex(source: &mut Source, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    let mut header = [0; 24];
    source.read(0, &mut header, budget)?;
    if &header[..4] != b"XEX2" {
        return Ok(None);
    }
    let length = be32(&header[8..12])? as usize;
    let security = be32(&header[16..20])? as usize;
    let count = be32(&header[20..24])? as usize;
    if count > 1024
        || length < 24 + count * 8
        || length > 1024 * 1024
        || length as u64 > source.size()
    {
        return Err(invalid());
    }
    let mut bytes = vec![0; length];
    source.read(0, &mut bytes, budget)?;
    let mut execution = None;
    for entry in bytes[24..24 + count * 8].chunks_exact(8) {
        if be32(&entry[..4])? != 0x40006 {
            continue;
        }
        let offset = be32(&entry[4..])? as usize;
        if offset < 24 + count * 8
            || offset.checked_add(24).is_none_or(|end| end > length)
            || execution.is_some()
        {
            return Err(invalid());
        }
        execution = Some(offset);
    }
    let Some(offset) = execution else {
        return Ok(None);
    };
    let title = be32(&bytes[offset + 12..offset + 16])?;
    if title == 0 || title == u32::MAX || title == 0xdeadbeef {
        return Ok(None);
    }
    let mut regions = Vec::new();
    if security >= 24 + count * 8 && security.checked_add(0x17c).is_some_and(|end| end <= length) {
        let mask = be32(&bytes[security + 0x178..security + 0x17c])?;
        // These are permitted execution territories, not a unique release.
        // Unknown bits or a region-free mask must not discard catalog editions.
        if mask != 0 && mask & !0x00ff03ff == 0 {
            for (bits, name) in [
                (0xff, "North America"),
                (0x100, "Japan"),
                (0x200, "China"),
                (0xfe0000, "Europe"),
                (0x10000, "Australia"),
            ] {
                if mask & bits != 0 {
                    regions.push(name.to_owned());
                }
            }
        }
    }
    Ok(Some(Identity {
        serial: format!("{title:08X}"),
        regions,
    }))
}
/// Retail product codes encode the ASCII publisher and decimal title ordinal.
/// Keep the exact hexadecimal ID first; never apply this to other platforms.
pub(crate) fn product_code(serial: &str) -> Option<String> {
    if serial.len() != 8 || !serial.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let id = u32::from_str_radix(serial, 16).ok()?;
    let bytes = id.to_be_bytes();
    let ordinal = id & 0xffff;
    if !bytes[..2].iter().all(u8::is_ascii_uppercase)
        || !(2000..=9999).contains(&ordinal)
        || matches!(&bytes[..2], b"XA" | b"XH")
    {
        return None;
    }
    Some(format!(
        "{}{}-{ordinal:04}",
        bytes[0] as char, bytes[1] as char
    ))
}
pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let mut source = if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("zar"))
    {
        let mut archive = zar::Archive::open(path, budget)?;
        let Some(executable) = archive.executable(budget)? else {
            return Ok(None);
        };
        Source::Zar(archive, executable)
    } else {
        let mut file = File::open(path)?;
        let span = if path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("iso"))
        {
            let Some(span) = disc(&mut file, budget)? else {
                return Ok(None);
            };
            span
        } else {
            Span {
                offset: 0,
                size: file.metadata()?.len(),
            }
        };
        Source::File(file, span)
    };
    xex(&mut source, budget)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{cached_identity, identity_checked, init, tests::Files, System};
    use std::{fs, io::Write};

    pub fn xex(title: u32, regions: u32) -> Vec<u8> {
        let mut bytes = vec![0; 0x2000];
        bytes[..4].copy_from_slice(b"XEX2");
        for (offset, value) in [
            (8, 0x2000u32),
            (16, 0x100),
            (20, 1),
            (24, 0x40006),
            (28, 0x40),
            (0x40, 0x12345678),
            (0x4c, title),
            (0x278, regions),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
        }
        bytes[0x52] = 1;
        bytes[0x53] = 2;
        bytes
    }
    pub fn iso(executable: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; 80 * 2048];
        let header = &mut bytes[32 * 2048..33 * 2048];
        header[..20].copy_from_slice(b"MICROSOFT*XBOX*MEDIA");
        header[20..24].copy_from_slice(&40u32.to_le_bytes());
        header[24..28].copy_from_slice(&128u32.to_le_bytes());
        let record = &mut bytes[40 * 2048..40 * 2048 + 128];
        record[4..8].copy_from_slice(&48u32.to_le_bytes());
        record[8..12].copy_from_slice(&(executable.len() as u32).to_le_bytes());
        record[13] = 11;
        record[14..25].copy_from_slice(b"DeFaUlT.XeX");
        bytes[48 * 2048..48 * 2048 + executable.len()].copy_from_slice(executable);
        bytes
    }
    // Independent Zstandard frame fixture: a raw prefix followed by RLE zeroes.
    // Store a frame directly when its compressed representation would be larger.
    fn frame(bytes: &[u8]) -> Vec<u8> {
        let prefix = bytes
            .iter()
            .rposition(|&byte| byte != 0)
            .map_or(0, |i| i + 1);
        if prefix + 14 >= 65536 {
            return bytes.to_vec();
        }
        let mut out = vec![0x28, 0xb5, 0x2f, 0xfd, 0x60, 0x00, 0xff];
        if prefix != 0 {
            let header = (prefix as u32) << 3;
            out.extend_from_slice(&header.to_le_bytes()[..3]);
            out.extend_from_slice(&bytes[..prefix]);
        }
        let header = (((65536 - prefix) as u32) << 3) | 3;
        out.extend_from_slice(&header.to_le_bytes()[..3]);
        out.push(0);
        out
    }
    pub fn zar(executable: &[u8], file_offset: usize) -> Vec<u8> {
        let mut logical = vec![0; (file_offset + executable.len()).next_multiple_of(65536)];
        logical[file_offset..file_offset + executable.len()].copy_from_slice(executable);
        let blocks = logical.chunks(65536).map(frame).collect::<Vec<_>>();
        let mut bytes = Vec::new();
        let mut records = vec![0; blocks.len().div_ceil(16) * 40];
        for (index, block) in blocks.iter().enumerate() {
            let record = index / 16 * 40;
            if index % 16 == 0 {
                records[record..record + 8].copy_from_slice(&(bytes.len() as u64).to_be_bytes());
            }
            let slot = record + 8 + (index % 16) * 2;
            records[slot..slot + 2].copy_from_slice(&((block.len() - 1) as u16).to_be_bytes());
            bytes.extend_from_slice(block);
        }
        let data = Span {
            offset: 0,
            size: bytes.len() as u64,
        };
        let offsets = Span {
            offset: bytes.len() as u64,
            size: records.len() as u64,
        };
        bytes.extend_from_slice(&records);
        let names = Span {
            offset: bytes.len() as u64,
            size: 12,
        };
        bytes.push(11);
        bytes.extend_from_slice(b"DEFAULT.XEX");
        let tree = Span {
            offset: bytes.len() as u64,
            size: 32,
        };
        for word in [
            0x7fffffffu32,
            1,
            1,
            0,
            0x80000000,
            file_offset as u32,
            executable.len() as u32,
            ((file_offset as u64 >> 32) as u32) | (((executable.len() as u64 >> 32) as u32) << 16),
        ] {
            bytes.extend_from_slice(&word.to_be_bytes());
        }
        let empty = Span {
            offset: bytes.len() as u64,
            size: 0,
        };
        let mut footer = vec![0; 144];
        for (index, span) in [data, offsets, names, tree, empty, empty]
            .into_iter()
            .enumerate()
        {
            footer[index * 16..index * 16 + 8].copy_from_slice(&span.offset.to_be_bytes());
            footer[index * 16 + 8..index * 16 + 16].copy_from_slice(&span.size.to_be_bytes());
        }
        footer[128..136].copy_from_slice(&(bytes.len() as u64 + 144).to_be_bytes());
        footer[136..140].copy_from_slice(&0x61bf3a01u32.to_be_bytes());
        footer[140..144].copy_from_slice(&0x169f52d6u32.to_be_bytes());
        bytes.extend_from_slice(&footer);
        bytes
    }
    #[test]
    fn xbox360_reads_xex_iso_and_compressed_or_stored_zar_blocks_independently_of_names() {
        let files = Files::new();
        let executable = xex(0x4d530805, 0xff);
        for (name, bytes) in [
            ("Wrong (Japan).xex", executable.clone()),
            ("Wrong.iso", iso(&executable)),
            ("Small.zar", zar(&executable, 0)),
            ("Crossing.zar", zar(&executable, 65523)),
            ("Far.zar", zar(&executable, 17 * 65536 + 7)),
        ] {
            let path = files.write(name, &bytes);
            let id = identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).unwrap();
            assert_eq!(id.serial, "4D530805", "{name}");
            assert_eq!(id.regions, vec!["North America"]);
            assert!(identity_checked(path.to_str().unwrap(), "Sony PSP", &|| false).is_none());
            assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| true).is_none());
        }
        assert_eq!(product_code("4D530805").as_deref(), Some("MS-2053"));
        assert_eq!(product_code("415407D7").as_deref(), Some("AT-2007"));
        for invalid in ["DEADBEEF", "00000000", "58410800", "4d530001", "4D53ZZZZ"] {
            assert!(product_code(invalid).is_none());
        }
    }
    #[test]
    fn xbox360_finds_xgd_partitions_without_reading_or_allocating_the_rest_of_the_disc() {
        let files = Files::new();
        let image = iso(&xex(0x53450813, 0xfe0000));
        for base in [0xfb20u64, 0x20600, 0x2080000, 0xfd90000, 0x18300000] {
            let path = files.0.join(format!("partition-{base}.iso"));
            let mut file = File::create(&path).unwrap();
            file.seek(SeekFrom::Start(base)).unwrap();
            file.write_all(&image).unwrap();
            drop(file);
            let id =
                identity_checked(path.to_str().unwrap(), "Microsoft Xbox 360", &|| false).unwrap();
            assert_eq!(id.serial, "53450813");
            assert_eq!(id.regions, vec!["Europe"]);
        }
    }
    #[test]
    fn xbox360_rejects_bad_xex_iso_and_zar_bounds_and_caches_only_unchanged_files() {
        let files = Files::new();
        let executable = xex(0x4d530805, u32::MAX);
        let path = files.write("good.xex", &executable);
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert!(
            cached_identity(&path, System::Xbox360, Some(&conn), &|| false)
                .unwrap()
                .regions
                .is_empty()
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&path, System::Xbox360, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        assert_eq!(fs::read(&path).unwrap(), executable);
        let mut changed = xex(0x415407d7, 0x100);
        changed.push(0);
        fs::write(&path, changed).unwrap();
        assert_eq!(
            cached_identity(&path, System::Xbox360, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "415407D7"
        );
        for (offset, value) in [(8, u32::MAX), (20, 2000), (28, 1), (28, 0x1ff0)] {
            let mut bad = executable.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
            let path = files.write("bad.xex", &bad);
            assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
        }
        let mut cyclic = iso(&executable);
        cyclic[40 * 2048..40 * 2048 + 2].copy_from_slice(&8u16.to_le_bytes());
        cyclic[40 * 2048 + 32..40 * 2048 + 34].copy_from_slice(&8u16.to_le_bytes());
        let path = files.write("cycle.iso", &cyclic);
        assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
        let archive = zar(&executable, 65523);
        for (offset, value) in [
            (archive.len() - 4, 0u32),
            (archive.len() - 8, 0),
            (archive.len() - 144 + 8, u32::MAX),
        ] {
            let mut bad = archive.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
            let path = files.write("bad.zar", &bad);
            assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
        }
        let mut corrupt = archive.clone();
        corrupt[65536] = 0xff;
        let path = files.write("bad.zar", &corrupt);
        assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
        let mut missing = archive.clone();
        let footer = missing.len() - 144;
        let name = be64(&missing[footer + 32..footer + 40]).unwrap() as usize;
        missing[name + 1] = b'Z';
        let path = files.write("missing.zar", &missing);
        assert!(identity_checked(path.to_str().unwrap(), "Xbox 360", &|| false).is_none());
        let path = files.write("not-a-game.god", &executable);
        assert!(
            identity_checked(path.to_str().unwrap(), "Xbox 360", &|| panic!(
                "unsupported containers must skip identification"
            ))
            .is_none()
        );
    }
}
