//! Inspect PSP metadata in ISO/CSO/CHD discs and PBP headers, without keys.
use super::{invalid, iso_file, sfo, u32le, u64le, Budget, Identity, Image, SECTOR};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

fn parse(bytes: &[u8]) -> io::Result<Option<Identity>> {
    // UMD games and official memory-stick games. Homebrew and PS1 Classics
    // can have a DISC_ID too, but must not identify a PSP catalog release.
    if !matches!(
        sfo::string(bytes, b"CATEGORY", &[0x101])?,
        Some("UG" | "EG")
    ) {
        return Ok(None);
    }
    let Some(id) = sfo::string(bytes, b"DISC_ID", &[0x101])? else {
        return Ok(None);
    };
    let compact: String = id.chars().filter(|&c| c != '-' && c != ' ').collect();
    let id = compact.as_bytes();
    if id.len() != 9
        || !id[..4].iter().all(u8::is_ascii_uppercase)
        || !id[4..].iter().all(u8::is_ascii_digit)
        || &id[4..] == b"00000"
        || !(matches!(&id[..2], b"UC" | b"UL")
            || (&id[..2] == b"NP" && matches!(id[3], b'G' | b'H')))
    {
        return Ok(None);
    }
    let region = match id[2] {
        b'U' => Some("North America"),
        b'E' => Some("Europe"),
        b'J' => Some("Japan"),
        b'K' => Some("Korea"),
        _ => None,
    };
    Ok(Some(Identity {
        serial: format!("{}-{}", &compact[..4], &compact[4..]),
        regions: region.into_iter().map(str::to_owned).collect(),
    }))
}

fn pbp(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Vec<u8>>> {
    budget.check()?;
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    let mut header = [0; 40];
    file.read_exact(&mut header)?;
    if &header[..4] != b"\0PBP" {
        return Err(invalid());
    }
    let offsets = header[8..]
        .chunks_exact(4)
        .map(u32le)
        .collect::<io::Result<Vec<_>>>()?;
    if offsets[0] < 40
        || offsets.windows(2).any(|v| v[0] > v[1])
        || u64::from(*offsets.last().unwrap()) > length
    {
        return Err(invalid());
    }
    let size = (offsets[1] - offsets[0]) as usize;
    if size == 0 {
        return Ok(None);
    }
    if size > sfo::MAX_SFO {
        return Err(invalid());
    }
    let mut bytes = vec![0; size];
    file.seek(SeekFrom::Start(u64::from(offsets[0])))?;
    file.read_exact(&mut bytes)?;
    budget.check()?;
    Ok(Some(bytes))
}

pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let bytes = if path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("pbp"))
    {
        pbp(path, budget)?
    } else {
        let mut image = Image::open(path, budget)?;
        iso_file(
            &mut image,
            &[b"PSP_GAME", b"PARAM.SFO"],
            sfo::MAX_SFO,
            budget,
        )?
    };
    budget.check()?;
    bytes
        .map(|bytes| parse(&bytes))
        .transpose()
        .map(Option::flatten)
}

// A CSO is an indexed ISO: only read two index entries and the requested
// compressed frame. No full image/index allocation or temporary extraction.
pub(super) struct Cso {
    file: File,
    length: u64,
    total: u64,
    frame_size: u64,
    align: u8,
    index_end: u64,
    cached: Option<(u64, Vec<u8>)>,
}
impl Cso {
    pub(super) fn open(path: &Path, budget: &mut Budget<'_>) -> io::Result<Self> {
        budget.check()?;
        let mut file = File::open(path)?;
        let length = file.metadata()?.len();
        let mut header = [0; 24];
        file.read_exact(&mut header)?;
        let total = u64le(&header[8..16])?;
        let frame_size = u64::from(u32le(&header[16..20])?);
        let align = header[21];
        // Common CSO writers leave header_size at zero. Both layouts place
        // the index at byte 24. CSO 0/1 use raw DEFLATE or stored frames.
        if &header[..4] != b"CISO"
            || !matches!(u32le(&header[4..8])?, 0 | 24)
            || header[20] > 1
            || align > 20
            || !(SECTOR..=1024 * 1024).contains(&frame_size)
            || !frame_size.is_power_of_two()
            || !(17 * SECTOR..=8 * 1024 * 1024 * 1024).contains(&total)
        {
            return Err(invalid());
        }
        let index_end = 24 + (total.div_ceil(frame_size) + 1) * 4;
        if index_end > length {
            return Err(invalid());
        }
        budget.check()?;
        Ok(Self {
            file,
            length,
            total,
            frame_size,
            align,
            index_end,
            cached: None,
        })
    }
    fn frame(&mut self, index: u64, budget: &mut Budget<'_>) -> io::Result<()> {
        budget.check()?;
        if self
            .cached
            .as_ref()
            .is_some_and(|(cached, _)| *cached == index)
        {
            return Ok(());
        }
        let mut entries = [0; 8];
        self.file.seek(SeekFrom::Start(24 + index * 4))?;
        self.file.read_exact(&mut entries)?;
        let first = u32le(&entries[..4])?;
        let start = u64::from(first & 0x7fff_ffff) << self.align;
        let end = u64::from(u32le(&entries[4..])? & 0x7fff_ffff) << self.align;
        let expected = self.frame_size.min(self.total - index * self.frame_size) as usize;
        if start < self.index_end
            || end <= start
            || end > self.length
            || end - start > self.frame_size * 2 + (1u64 << self.align)
        {
            return Err(invalid());
        }
        self.file.seek(SeekFrom::Start(start))?;
        budget.account(self.frame_size as usize)?;
        let bytes = if first & 0x8000_0000 != 0 {
            if end - start < expected as u64 {
                return Err(invalid());
            }
            let mut bytes = vec![0; expected];
            self.file.read_exact(&mut bytes)?;
            bytes
        } else {
            let mut compressed = vec![0; (end - start) as usize];
            self.file.read_exact(&mut compressed)?;
            let mut bytes = vec![0; self.frame_size as usize + 1];
            let mut decoder = flate2::Decompress::new(false);
            let status = decoder
                .decompress(&compressed, &mut bytes, flate2::FlushDecompress::Finish)
                .map_err(|_| invalid())?;
            if status != flate2::Status::StreamEnd
                || decoder.total_out() < expected as u64
                || decoder.total_out() > self.frame_size
            {
                return Err(invalid());
            }
            bytes.truncate(expected);
            bytes
        };
        budget.check()?;
        self.cached = Some((index, bytes));
        Ok(())
    }
    pub(super) fn read_at(
        &mut self,
        offset: u64,
        mut bytes: &mut [u8],
        budget: &mut Budget<'_>,
    ) -> io::Result<()> {
        if offset
            .checked_add(bytes.len() as u64)
            .is_none_or(|end| end > self.total)
        {
            return Err(invalid());
        }
        let mut offset = offset;
        while !bytes.is_empty() {
            let index = offset / self.frame_size;
            self.frame(index, budget)?;
            let cached = &self.cached.as_ref().ok_or_else(invalid)?.1;
            let start = (offset % self.frame_size) as usize;
            let count = bytes.len().min(cached.len() - start);
            bytes[..count].copy_from_slice(&cached[start..start + count]);
            offset += count as u64;
            bytes = &mut bytes[count..];
        }
        budget.check()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{cached_identity, identity_checked, init, ps3, tests::Files, System};
    use std::{fs, io::Write};

    pub fn metadata(id: &str, category: &str) -> Vec<u8> {
        ps3::tests::fields(&[
            ("CATEGORY", category),
            ("DISC_ID", id),
            ("TITLE", "Example title"),
        ])
    }
    fn record(name: &[u8], block: u32, size: usize, directory: bool) -> Vec<u8> {
        let mut bytes = vec![0; 33 + name.len() + usize::from(name.len() % 2 == 0)];
        bytes[0] = bytes.len() as u8;
        for (offset, value) in [(2, block), (10, size as u32)] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            bytes[offset + 4..offset + 8].copy_from_slice(&value.to_be_bytes());
        }
        bytes[25] = if directory { 2 } else { 0 };
        bytes[32] = name.len() as u8;
        bytes[33..33 + name.len()].copy_from_slice(name);
        bytes
    }
    pub fn iso_sfo(sfo: &[u8]) -> Vec<u8> {
        let mut bytes = crate::disc_serial::tests::iso("SLUS_123.45");
        bytes.resize(
            bytes
                .len()
                .max((32 * 2048 + sfo.len()).next_multiple_of(2048)),
            0,
        );
        bytes[20 * 2048..21 * 2048].fill(0);
        let root = [
            record(&[0], 20, 2048, true),
            record(b"PSP_GAME", 24, 2048, true),
        ]
        .concat();
        bytes[20 * 2048..20 * 2048 + root.len()].copy_from_slice(&root);
        let game = [
            record(&[0], 24, 2048, true),
            record(b"PARAM.SFO;1", 32, sfo.len(), false),
        ]
        .concat();
        bytes[24 * 2048..24 * 2048 + game.len()].copy_from_slice(&game);
        bytes[32 * 2048..32 * 2048 + sfo.len()].copy_from_slice(sfo);
        bytes
    }
    pub fn iso(id: &str) -> Vec<u8> {
        iso_sfo(&metadata(id, "UG"))
    }
    pub fn pbp_sfo(sfo: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; 40];
        bytes[..4].copy_from_slice(b"\0PBP");
        bytes[4..8].copy_from_slice(&0x10000u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&40u32.to_le_bytes());
        for offset in (12..40).step_by(4) {
            bytes[offset..offset + 4].copy_from_slice(&(40u32 + sfo.len() as u32).to_le_bytes());
        }
        bytes.extend_from_slice(sfo);
        bytes
    }
    pub fn cso(iso: &[u8], frame_size: usize, align: u8) -> Vec<u8> {
        let frames = iso.len().div_ceil(frame_size);
        let mut bytes = vec![0; 24 + (frames + 1) * 4];
        bytes[..4].copy_from_slice(b"CISO");
        bytes[8..16].copy_from_slice(&(iso.len() as u64).to_le_bytes());
        bytes[16..20].copy_from_slice(&(frame_size as u32).to_le_bytes());
        bytes[20] = 1;
        bytes[21] = align;
        let boundary = 1usize << align;
        for (index, frame) in iso.chunks(frame_size).enumerate() {
            bytes.resize(bytes.len().next_multiple_of(boundary), 0);
            let entry =
                (bytes.len() as u32 >> align) | if index % 3 == 0 { 0x8000_0000 } else { 0 };
            bytes[24 + index * 4..28 + index * 4].copy_from_slice(&entry.to_le_bytes());
            if index % 3 == 0 {
                bytes.extend_from_slice(frame);
            } else {
                let mut encoder =
                    flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::fast());
                encoder.write_all(frame).unwrap();
                bytes.extend(encoder.finish().unwrap());
            }
        }
        bytes.resize(bytes.len().next_multiple_of(boundary), 0);
        let end = bytes.len() as u32 >> align;
        bytes[24 + frames * 4..28 + frames * 4].copy_from_slice(&end.to_le_bytes());
        bytes
    }
    #[test]
    fn psp_iso_cso_chd_and_pbp_read_disc_id_without_using_the_filename() {
        let files = Files::new();
        let mut sfo = metadata("ULES-10002", "UG");
        sfo.resize(sfo.len() + 5000, 0);
        let disc = iso_sfo(&sfo);
        for (name, bytes) in [
            ("Wrong title (USA).iso", disc.clone()),
            ("Wrong title (USA).cso", cso(&disc, 2048, 0)),
            ("Aligned.cso", cso(&disc, 4096, 3)),
            ("Large frames.cso", cso(&disc, 65536, 0)),
            (
                "DVD.chd",
                crate::disc_serial::optical::tests::chd(&disc, 2048, None),
            ),
            ("EBOOT.PBP", pbp_sfo(&metadata("ULES10002", "EG"))),
        ] {
            let path = files.write(name, &bytes);
            let id = identity_checked(path.to_str().unwrap(), "Sony PlayStation Portable", &|| {
                false
            })
            .unwrap();
            assert_eq!(id.serial, "ULES-10002", "{name}");
            assert_eq!(id.regions, vec!["Europe"]);
            assert!(identity_checked(path.to_str().unwrap(), "PS3", &|| false).is_none());
        }
        for (id, region) in [
            ("ULUS10001", Some("North America")),
            ("ULJM12345", Some("Japan")),
            ("ULKS12345", Some("Korea")),
            ("UCAS12345", None),
            ("NPUG12345", Some("North America")),
        ] {
            let id = parse(&metadata(id, "EG")).unwrap().unwrap();
            assert_eq!(
                id.regions,
                region.into_iter().map(str::to_owned).collect::<Vec<_>>()
            );
        }
    }
    #[test]
    fn psp_skips_homebrew_ps1_classics_other_consoles_missing_and_malformed_metadata() {
        for (id, category) in [
            ("ULUS10001", "MG"),
            ("SLUS10001", "ME"),
            ("ULUS10001", "ME"),
            ("ULUS10001", "UV"),
            ("BLUS30581", "EG"),
            ("CUSA12345", "EG"),
            ("NPUB12345", "EG"),
            ("NPUJ12345", "EG"),
            ("ULUS00000", "UG"),
            ("ULUS12X45", "UG"),
            ("", "UG"),
        ] {
            assert!(
                parse(&metadata(id, category)).unwrap().is_none(),
                "{id} {category}"
            );
        }
        assert!(parse(&ps3::tests::sfo("ULUS10001")).unwrap().is_none());
        let files = Files::new();
        let sfo = metadata("ULUS10001", "UG");
        for length in 0..sfo.len() {
            assert!(parse(&sfo[..length]).is_err());
        }
        let invalid = files.write(
            "not-a-psp.iso",
            &crate::disc_serial::tests::iso("SLUS_123.45"),
        );
        assert!(identity_checked(invalid.to_str().unwrap(), "PSP", &|| false).is_none());
        let path = files.write("game.iso", &iso("ULUS10001"));
        assert!(identity_checked(path.to_str().unwrap(), "PSP", &|| true).is_none());
        let valid = pbp_sfo(&metadata("ULUS10001", "EG"));
        for (offset, value) in [(8, 0u32), (12, 39), (16, u32::MAX)] {
            let mut bad = valid.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            let path = files.write("bad.pbp", &bad);
            assert!(identity_checked(path.to_str().unwrap(), "PSP", &|| false).is_none());
        }
        let oversized = files.write("oversized.pbp", &pbp_sfo(&vec![0; sfo::MAX_SFO + 1]));
        assert!(identity_checked(oversized.to_str().unwrap(), "PSP", &|| false).is_none());
    }
    #[test]
    fn psp_cso_validates_headers_offsets_deflate_and_bounded_random_reads() {
        let files = Files::new();
        let valid = cso(&iso("ULUS10001"), 2048, 0);
        for (offset, value) in [
            (4, 25u32),
            (16, 0),
            (16, 1025),
            (16, 2 * 1024 * 1024),
            (24 + 16 * 4, 0),
        ] {
            let mut bad = valid.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            let path = files.write("bad.cso", &bad);
            assert!(identity_checked(path.to_str().unwrap(), "PSP", &|| false).is_none());
        }
        for (offset, value) in [(20, 2), (21, 21)] {
            let mut bad = valid.clone();
            bad[offset] = value;
            let path = files.write("bad.cso", &bad);
            assert!(identity_checked(path.to_str().unwrap(), "PSP", &|| false).is_none());
        }
        let mut bad = valid.clone();
        let data = u32le(&bad[24 + 16 * 4..28 + 16 * 4]).unwrap() as usize;
        bad[data..data + 4].fill(0xff);
        let path = files.write("bad.cso", &bad);
        assert!(identity_checked(path.to_str().unwrap(), "PSP", &|| false).is_none());
        let path = files.write("good.cso", &valid);
        let mut budget = Budget {
            started: std::time::Instant::now(),
            inflated: 0,
            cancelled: &|| false,
        };
        let mut reader = Cso::open(&path, &mut budget).unwrap();
        let mut bytes = [0; 5000];
        reader
            .read_at(16 * SECTOR + 123, &mut bytes, &mut budget)
            .unwrap();
        assert_eq!(bytes, iso("ULUS10001")[16 * 2048 + 123..16 * 2048 + 5123]);
        assert!(budget.inflated <= 3 * SECTOR);
        assert!(reader
            .read_at(reader.total, &mut [0; 1], &mut budget)
            .is_err());
    }
    #[test]
    fn psp_cache_reuses_unchanged_identity_and_invalidates_changed_images() {
        let files = Files::new();
        let path = files.write("same.iso", &iso("ULUS10001"));
        let original = fs::read(&path).unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_identity(&path, System::Psp, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "ULUS-10001"
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&path, System::Psp, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        let mut changed = iso("ULES10002");
        changed.push(0);
        fs::write(&path, changed).unwrap();
        assert_eq!(
            cached_identity(&path, System::Psp, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "ULES-10002"
        );
        assert!(cached_identity(&path, System::Ps1, Some(&conn), &|| false).is_none());
    }
}
