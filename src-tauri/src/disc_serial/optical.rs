//! Cook CD data sectors into the same 2048-byte ISO view used by DVD images.
use super::{Budget, SECTOR, invalid};
use chd::metadata::MetadataTag;
use std::{
    fs::File,
    io::{self, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const MAX_CUE: u64 = 1024 * 1024;
const MAX_HUNK: u32 = 16 * 1024 * 1024;

fn dreamcast_header(bytes: &[u8]) -> Option<super::Identity> {
    if bytes.len() < 0x50 || &bytes[..16] != b"SEGA SEGAKATANA " {
        return None;
    }
    let serial = std::str::from_utf8(&bytes[0x40..0x4a])
        .ok()?
        .split('\0')
        .next()?
        .trim()
        .to_ascii_uppercase();
    if !(4..=10).contains(&serial.len())
        || !serial
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !serial.bytes().any(|b| b.is_ascii_digit())
    {
        return None;
    }
    let regions = [(b'J', "Japan"), (b'U', "North America"), (b'E', "Europe")]
        .into_iter()
        .filter(|(key, _)| bytes[0x30..0x38].contains(key))
        .map(|(_, name)| name.to_owned())
        .collect();
    Some(super::Identity { serial, regions })
}
pub(super) fn dreamcast_identity(
    path: &Path,
    budget: &mut Budget<'_>,
) -> io::Result<Option<super::Identity>> {
    let mut header = [0; 256];
    if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cue"))
    {
        for track in cue_tracks(path)? {
            budget.check()?;
            let mut track = DataTrack::cue_track(track)?;
            track.read_at(0, &mut header, budget)?;
            if let Some(id) = dreamcast_header(&header) {
                return Ok(Some(id));
            }
        }
    } else if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("chd"))
    {
        let mut track = DataTrack::chd(path, budget)?;
        let layouts = std::iter::once((track.payload, track.base / track.stride, track.frames))
            .chain(std::mem::take(&mut track.alternatives));
        for (payload, first, frames) in layouts {
            track.payload = payload;
            track.base = first * track.stride;
            track.frames = frames;
            track.read_at(0, &mut header, budget)?;
            if let Some(id) = dreamcast_header(&header) {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}
#[derive(Clone)]
struct CueEntry {
    file: PathBuf,
    binary: bool,
    mode: String,
    index0: Option<u64>,
    index1: Option<u64>,
}
pub(super) struct CueTrack {
    pub file: PathBuf,
    stride: u64,
    payload: u64,
    index: u64,
    end: Option<u64>,
}
fn command(line: &str) -> (&str, &str) {
    let line = line.trim();
    line.split_once(char::is_whitespace)
        .map(|(key, value)| (key, value.trim()))
        .unwrap_or((line, ""))
}
fn file_field(value: &str) -> io::Result<(&str, &str)> {
    if let Some(value) = value.strip_prefix('"') {
        let end = value.find('"').ok_or_else(invalid)?;
        Ok((&value[..end], value[end + 1..].trim()))
    } else {
        value
            .split_once(char::is_whitespace)
            .map(|(name, kind)| (name, kind.trim()))
            .ok_or_else(invalid)
    }
}
fn timestamp(value: &str) -> io::Result<u64> {
    let values: Vec<u64> = value
        .split(':')
        .map(str::parse)
        .collect::<Result<_, _>>()
        .map_err(|_| invalid())?;
    if values.len() != 3 || values[0] > 999 || values[1] >= 60 || values[2] >= 75 {
        return Err(invalid());
    }
    Ok((values[0] * 60 + values[1]) * 75 + values[2])
}
fn layout(mode: &str) -> Option<(u64, u64)> {
    match mode {
        "MODE1/2048" => Some((2048, 0)),
        "MODE1/2352" => Some((2352, 16)),
        "MODE2/2336" => Some((2336, 8)),
        "MODE2/2352" => Some((2352, 24)),
        _ => None,
    }
}
pub(super) fn cue_tracks(path: &Path) -> io::Result<Vec<CueTrack>> {
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_CUE {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take(MAX_CUE + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_CUE {
        return Err(invalid());
    }
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        if bytes.len() % 2 != 0 {
            return Err(invalid());
        }
        String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|b| {
                    if little {
                        u16::from_le_bytes([b[0], b[1]])
                    } else {
                        u16::from_be_bytes([b[0], b[1]])
                    }
                })
                .collect::<Vec<_>>(),
        )
        .map_err(|_| invalid())?
    } else {
        String::from_utf8(bytes.clone())
            .unwrap_or_else(|_| bytes.into_iter().map(char::from).collect())
    };
    let mut source: Option<(PathBuf, bool)> = None;
    let mut tracks: Vec<CueEntry> = Vec::new();
    let mut number = 0;
    for line in text.trim_start_matches('\u{feff}').lines() {
        let (key, value) = command(line);
        match key.to_ascii_uppercase().as_str() {
            "FILE" => {
                let (name, kind) = file_field(value)?;
                if name.is_empty() || name.contains(['\0', '\n', '\r']) || name.contains("://") {
                    return Err(invalid());
                }
                let name = if cfg!(windows) {
                    name.to_owned()
                } else {
                    name.replace('\\', "/")
                };
                let mut file = PathBuf::from(name);
                if !file.is_absolute() {
                    file = path.parent().unwrap_or_else(|| Path::new(".")).join(file);
                }
                source = Some((file, kind.eq_ignore_ascii_case("BINARY")));
            }
            "TRACK" => {
                let (next, mode) = command(value);
                let next = next.parse::<u32>().map_err(|_| invalid())?;
                if next <= number || next > 99 {
                    return Err(invalid());
                }
                number = next;
                let (file, binary) = source.clone().ok_or_else(invalid)?;
                tracks.push(CueEntry {
                    file,
                    binary,
                    mode: mode.to_ascii_uppercase(),
                    index0: None,
                    index1: None,
                });
            }
            "INDEX" => {
                let (index, time) = command(value);
                let track = tracks.last_mut().ok_or_else(invalid)?;
                match index {
                    "00" => track.index0 = Some(timestamp(time)?),
                    "01" => track.index1 = Some(timestamp(time)?),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    let mut data = Vec::new();
    for (position, track) in tracks
        .iter()
        .enumerate()
        .filter(|(_, t)| t.binary && layout(&t.mode).is_some())
    {
        let (stride, payload) = layout(&track.mode).unwrap();
        let index = track.index1.ok_or_else(invalid)?;
        if track.index0.is_some_and(|zero| zero > index) {
            return Err(invalid());
        }
        // INDEX times are frames in the shared BIN, not in the whole disc.
        if tracks[..position].iter().any(|t| {
            t.file == track.file
                && if t.mode == "AUDIO" {
                    stride != 2352
                } else {
                    layout(&t.mode).is_none_or(|v| v.0 != stride)
                }
        }) {
            return Err(invalid());
        }
        let end = tracks[position + 1..]
            .iter()
            .find(|t| t.file == track.file)
            .and_then(|t| t.index0.or(t.index1));
        if end.is_some_and(|end| end <= index) {
            return Err(invalid());
        }
        data.push(CueTrack {
            file: track.file.clone(),
            stride,
            payload,
            index,
            end,
        });
    }
    if data.is_empty() {
        return Err(invalid());
    }
    Ok(data)
}

enum Source {
    Raw(File),
    Chd(ChdReader),
}
pub(super) struct DataTrack {
    source: Source,
    stride: u64,
    payload: u64,
    base: u64,
    frames: u64,
    alternatives: Vec<(u64, u64, u64)>,
}
impl DataTrack {
    pub fn cue(path: &Path) -> io::Result<Self> {
        Self::cue_track(cue_tracks(path)?.remove(0))
    }
    fn cue_track(track: CueTrack) -> io::Result<Self> {
        let file = File::open(&track.file)?;
        let size = file.metadata()?.len();
        let total = size / track.stride;
        if track.index >= total {
            return Err(invalid());
        }
        let end = track.end.unwrap_or(total).min(total);
        Ok(Self {
            source: Source::Raw(file),
            stride: track.stride,
            payload: track.payload,
            base: track.index * track.stride,
            frames: end - track.index,
            alternatives: Vec::new(),
        })
    }
    pub fn chd(path: &Path, budget: &mut Budget<'_>) -> io::Result<Self> {
        let mut file = BufReader::new(File::open(path)?);
        let header = chd::header::Header::try_read_header(&mut file).map_err(|_| invalid())?;
        if header.hunk_size() < SECTOR as u32
            || header.hunk_size() > MAX_HUNK
            || header.hunk_count() == 0
            || header.hunk_count() > 4_194_304
            || header.logical_bytes() > 64 * 1024 * 1024 * 1024
            || header.has_parent()
        {
            return Err(invalid());
        }
        if let chd::header::Header::V5Header(v5) = &header {
            if v5.compression[0] != 0 {
                file.seek(SeekFrom::Start(v5.map_offset))?;
                let mut length = [0; 4];
                file.read_exact(&mut length)?;
                if u32::from_be_bytes(length) > 64 * 1024 * 1024 {
                    return Err(invalid());
                }
            }
        }
        budget.check()?;
        let mut chd = chd::Chd::open(file, None).map_err(|_| invalid())?;
        budget.check()?;
        let unit = chd.header().unit_bytes() as u64;
        let mut layouts = Vec::new();
        let mut track_offset = 0u64;
        let mut number = 0u32;
        let references = chd
            .metadata_refs()
            .take(256)
            .collect::<chd::Result<Vec<_>>>()
            .map_err(|_| invalid())?;
        for reference in references {
            budget.check()?;
            if ![
                u32::from_be_bytes(*b"CHTR"),
                u32::from_be_bytes(*b"CHT2"),
                u32::from_be_bytes(*b"CHGD"),
                u32::from_be_bytes(*b"CHGT"),
            ]
            .contains(&reference.metatag())
            {
                continue;
            }
            let metadata = reference.read(chd.inner()).map_err(|_| invalid())?;
            budget.account(metadata.value.len())?;
            let text = std::str::from_utf8(&metadata.value)
                .map_err(|_| invalid())?
                .trim_matches('\0');
            let field = |name| {
                text.split_ascii_whitespace().find_map(|part| {
                    part.split_once(':')
                        .filter(|(key, _)| *key == name)
                        .map(|(_, value)| value)
                })
            };
            let next = field("TRACK")
                .ok_or_else(invalid)?
                .parse::<u32>()
                .map_err(|_| invalid())?;
            if next != number + 1 || next > 99 {
                return Err(invalid());
            }
            number = next;
            let kind = field("TYPE").ok_or_else(invalid)?;
            let parse = |key, default| {
                field(key)
                    .unwrap_or(default)
                    .parse::<u64>()
                    .map_err(|_| invalid())
            };
            let frames = parse("FRAMES", "0")?;
            let pregap = parse("PREGAP", "0")?;
            let pad = parse("PAD", "0")?;
            let stored = field("PGTYPE").is_some_and(|value| value.starts_with('V'));
            let first = if stored { pregap } else { 0 };
            let playable = frames
                .checked_sub(first)
                .and_then(|n| n.checked_sub(pad))
                .filter(|n| *n > 0)
                .ok_or_else(invalid)?;
            let end = track_offset.checked_add(frames).ok_or_else(invalid)?;
            if unit < SECTOR || end > chd.header().logical_bytes() / unit {
                return Err(invalid());
            }
            let payload = match kind {
                "MODE1" | "MODE1/2048" | "MODE2_FORM1" => Some(0),
                "MODE1_RAW" | "MODE1/2352" => Some(16),
                "MODE2" | "MODE2/2336" | "MODE2_FORM_MIX" => Some(8),
                "MODE2_RAW" | "MODE2/2352" => Some(24),
                "AUDIO" => None,
                _ => return Err(invalid()),
            };
            if let Some(payload) = payload {
                if payload + SECTOR > unit {
                    return Err(invalid());
                }
                layouts.push((payload, track_offset + first, playable));
            }
            // CHD padding is present after every track, independently of virtual
            // pregaps/postgaps. GD-ROM PAD frames are already included in FRAMES.
            track_offset = track_offset
                .checked_add(frames.checked_add(3).ok_or_else(invalid)? / 4 * 4)
                .ok_or_else(invalid)?;
        }
        if layouts.is_empty() && number == 0 && unit == SECTOR {
            layouts.push((0, 0, chd.header().logical_bytes() / unit));
        }
        if layouts.is_empty() {
            return Err(invalid());
        }
        let (payload, first, frames) = layouts.remove(0);
        let hunk_size = chd.header().hunk_size() as usize;
        Ok(Self {
            source: Source::Chd(ChdReader {
                chd,
                buffer: vec![0; hunk_size],
                compressed: Vec::new(),
                loaded: None,
            }),
            stride: unit,
            payload,
            base: first * unit,
            frames,
            alternatives: layouts,
        })
    }
    pub fn read_at(
        &mut self,
        offset: u64,
        bytes: &mut [u8],
        budget: &mut Budget<'_>,
    ) -> io::Result<()> {
        let end = offset.checked_add(bytes.len() as u64).ok_or_else(invalid)?;
        if end > self.frames.checked_mul(SECTOR).ok_or_else(invalid)? {
            return Err(invalid());
        }
        let mut written = 0;
        while written < bytes.len() {
            budget.check()?;
            let logical = offset + written as u64;
            let block = logical / SECTOR;
            let inside = logical % SECTOR;
            let physical = self.base + block * self.stride + self.payload + inside;
            let count = (SECTOR - inside).min((bytes.len() - written) as u64) as usize;
            let output = &mut bytes[written..written + count];
            match &mut self.source {
                Source::Raw(file) => {
                    file.seek(SeekFrom::Start(physical))?;
                    file.read_exact(output)?;
                }
                Source::Chd(source) => source.read_at(physical, output, budget)?,
            }
            written += count;
        }
        Ok(())
    }
}
struct ChdReader {
    chd: chd::Chd<BufReader<File>>,
    buffer: Vec<u8>,
    compressed: Vec<u8>,
    loaded: Option<u32>,
}
impl ChdReader {
    fn read_at(
        &mut self,
        offset: u64,
        output: &mut [u8],
        budget: &mut Budget<'_>,
    ) -> io::Result<()> {
        if offset
            .checked_add(output.len() as u64)
            .is_none_or(|end| end > self.chd.header().logical_bytes())
        {
            return Err(invalid());
        }
        let mut written = 0;
        while written < output.len() {
            budget.check()?;
            let position = offset + written as u64;
            let hunk = (position / self.buffer.len() as u64) as u32;
            let start = (position % self.buffer.len() as u64) as usize;
            if self.loaded != Some(hunk) {
                let count = self
                    .chd
                    .hunk(hunk)
                    .map_err(|_| invalid())?
                    .read_hunk_in(&mut self.compressed, &mut self.buffer)
                    .map_err(|_| invalid())?;
                budget.account(count)?;
                if count != self.buffer.len() {
                    return Err(invalid());
                }
                self.loaded = Some(hunk);
            }
            let count = (self.buffer.len() - start).min(output.len() - written);
            output[written..written + count].copy_from_slice(&self.buffer[start..start + count]);
            written += count;
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::{
        cached_serial, file_stamp, init, inspect,
        tests::{Files, iso},
    };
    use super::*;
    use rusqlite::Connection;
    use std::fs;

    pub(crate) fn sectors(data: &[u8], stride: usize, payload: usize, pregap: usize) -> Vec<u8> {
        let mut bytes = vec![0; (pregap + data.len() / 2048) * stride];
        for (index, sector) in data.chunks_exact(2048).enumerate() {
            let start = (index + pregap) * stride + payload;
            bytes[start..start + 2048].copy_from_slice(sector);
        }
        bytes
    }
    fn serial(path: &Path) -> Option<String> {
        inspect(path, &|| false).ok().flatten()
    }

    // A small, valid CHD v5 with an uncompressed map. Real compressed hunks are
    // also exercised by the opt-in read-only local-media test in the parent.
    pub(crate) fn chd(data: &[u8], unit: usize, metadata: Option<&str>) -> Vec<u8> {
        let metadata = metadata
            .map(|text| vec![(*b"CHT2", text)])
            .unwrap_or_default();
        chd_tracks(data, unit, &metadata)
    }
    pub(crate) fn chd_tracks(data: &[u8], unit: usize, metadata: &[([u8; 4], &str)]) -> Vec<u8> {
        let hunk = unit * 8;
        let count = data.len().div_ceil(hunk);
        let metadata_offset = 124 + count * 4;
        let data_start = (metadata_offset
            + metadata
                .iter()
                .map(|(_, m)| 16 + m.len() + 1)
                .sum::<usize>())
        .div_ceil(hunk)
            * hunk;
        let mut out = vec![0; data_start + count * hunk];
        out[..8].copy_from_slice(b"MComprHD");
        out[8..12].copy_from_slice(&124u32.to_be_bytes());
        out[12..16].copy_from_slice(&5u32.to_be_bytes());
        out[32..40].copy_from_slice(&(data.len() as u64).to_be_bytes());
        out[40..48].copy_from_slice(&124u64.to_be_bytes());
        out[56..60].copy_from_slice(&(hunk as u32).to_be_bytes());
        out[60..64].copy_from_slice(&(unit as u32).to_be_bytes());
        if !metadata.is_empty() {
            out[48..56].copy_from_slice(&(metadata_offset as u64).to_be_bytes());
            let mut offset = metadata_offset;
            for (index, (tag, text)) in metadata.iter().enumerate() {
                out[offset..offset + 4].copy_from_slice(tag);
                out[offset + 4..offset + 8]
                    .copy_from_slice(&((text.len() + 1) as u32).to_be_bytes());
                let next = offset + 16 + text.len() + 1;
                if index + 1 < metadata.len() {
                    out[offset + 8..offset + 16].copy_from_slice(&(next as u64).to_be_bytes());
                }
                out[offset + 16..offset + 16 + text.len()].copy_from_slice(text.as_bytes());
                offset = next;
            }
        }
        for index in 0..count {
            out[124 + index * 4..128 + index * 4]
                .copy_from_slice(&((data_start / hunk + index) as u32).to_be_bytes());
        }
        out[data_start..data_start + data.len()].copy_from_slice(data);
        out
    }

    #[test]
    fn cue_sector_modes_pregaps_and_additional_audio_tracks_preserve_iso_offsets() {
        let files = Files::new();
        let data = iso("SLES_543.21");
        for (mode, stride, payload) in [
            ("MODE1/2048", 2048, 0),
            ("MODE1/2352", 2352, 16),
            ("MODE2/2336", 2336, 8),
            ("MODE2/2352", 2352, 24),
        ] {
            for pregap in [0, 150] {
                let bin = format!("disc {stride} {payload} {pregap}.bin");
                let mut bytes = sectors(&data, stride, payload, pregap);
                bytes.extend(vec![0; 10 * stride]);
                files.write(&bin, &bytes);
                let cue = format!(
                    "FILE \"{bin}\" BINARY\n TRACK 01 {mode}\n PREGAP 00:02:00\n INDEX 00 00:00:00\n INDEX 01 00:0{}:00\n TRACK 02 AUDIO\n INDEX 00 00:0{}:40\n INDEX 01 00:0{}:41\n",
                    pregap / 75,
                    pregap / 75,
                    pregap / 75
                );
                let path = files.write("game.cue", cue.as_bytes());
                let before = fs::read(&path).unwrap();
                assert_eq!(
                    serial(&path).as_deref(),
                    Some("SLES-54321"),
                    "{mode} gap={pregap}"
                );
                assert_eq!(fs::read(&path).unwrap(), before);
            }
        }
    }

    #[test]
    fn cue_encoding_bounds_missing_tracks_and_bin_cache_invalidation() {
        let files = Files::new();
        let bin = files.write("d\u{00ed}sc.bin", &iso("SLUS_209.98"));
        let text = "FILE \"d\u{00ed}sc.bin\" BINARY\nTRACK 01 MODE1/2048\nINDEX 01 00:00:00\n";
        let mut utf16 = vec![255, 254];
        for unit in text.encode_utf16() {
            utf16.extend(unit.to_le_bytes());
        }
        let path = files.write("game.cue", &utf16);
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("SLUS-20998")
        );
        let old = file_stamp(&path).unwrap();
        let mut changed = iso("SLES_543.21");
        changed.extend([0; 2048]);
        fs::write(&bin, changed).unwrap();
        assert_ne!(file_stamp(&path).unwrap(), old);
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("SLES-54321")
        );
        fs::remove_file(&bin).unwrap();
        assert!(serial(&path).is_none());
        assert!(file_stamp(&path).is_none());
        for invalid in [
            "FILE \"missing.bin\" BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00",
            "FILE \"missing.bin\" BINARY\nTRACK 01 MODE2/2352\nINDEX 01 00:60:00",
            "TRACK 01 MODE1/2048",
            "FILE \"unterminated BINARY",
        ] {
            let path = files.write("bad.cue", invalid.as_bytes());
            assert!(serial(&path).is_none());
        }
    }

    #[test]
    fn chd_cd_raw_and_cooked_tracks_dvd_and_stored_pregaps_read_only_needed_hunks() {
        let files = Files::new();
        let data = iso("SLUS_209.98");
        for (kind, payload) in [
            ("MODE1", 0),
            ("MODE1_RAW", 16),
            ("MODE2", 8),
            ("MODE2_RAW", 24),
        ] {
            for gap in [0, 150] {
                let raw = sectors(&data, 2448, payload, gap);
                let metadata = format!(
                    "TRACK:1 TYPE:{kind} SUBTYPE:NONE FRAMES:{} PREGAP:{gap} PGTYPE:VMODE1 PGSUB:NONE POSTGAP:0",
                    raw.len() / 2448
                );
                let bytes = chd(&raw, 2448, Some(&metadata));
                let path = files.write("disc.chd", &bytes);
                assert_eq!(
                    serial(&path).as_deref(),
                    Some("SLUS-20998"),
                    "{kind} gap={gap}"
                );
                assert_eq!(fs::read(&path).unwrap(), bytes);
            }
        }
        let path = files.write("dvd.chd", &chd(&data, 2048, None));
        assert_eq!(serial(&path).as_deref(), Some("SLUS-20998"));
        let mut budget = Budget {
            started: std::time::Instant::now(),
            inflated: 0,
            cancelled: &|| false,
        };
        let mut image = DataTrack::chd(&path, &mut budget).unwrap();
        let mut bytes = [0; 10];
        image
            .read_at(16 * 2048 + 1, &mut bytes, &mut budget)
            .unwrap();
        assert_eq!(&bytes[..5], b"CD001");
        assert_eq!(budget.inflated, 8 * 2048);
        image
            .read_at(16 * 2048 + 20, &mut bytes, &mut budget)
            .unwrap();
        assert_eq!(
            budget.inflated,
            8 * 2048,
            "reuse the last decompressed hunk"
        );
        assert!(
            image
                .read_at(data.len() as u64, &mut bytes, &mut budget)
                .is_err()
        );
        assert_eq!(
            inspect(&path, &|| true).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        let mut parent = chd(&data, 2048, None);
        parent[104] = 1;
        assert!(serial(&files.write("parent.chd", &parent)).is_none());
        let mut excessive = chd(&data, 2048, None);
        excessive[56..60].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(serial(&files.write("bad.chd", &excessive)).is_none());
        let audio = chd(
            &sectors(&data, 2448, 0, 0),
            2448,
            Some("TRACK:1 TYPE:AUDIO SUBTYPE:NONE FRAMES:40"),
        );
        assert!(serial(&files.write("audio.chd", &audio)).is_none());
    }
    pub(crate) fn dreamcast_data(serial: &str, area: &str) -> Vec<u8> {
        let mut data = vec![b' '; 2048 * 8];
        data[..16].copy_from_slice(b"SEGA SEGAKATANA ");
        data[0x30..0x38].fill(b' ');
        data[0x30..0x30 + area.len()].copy_from_slice(area.as_bytes());
        data[0x40..0x4a].fill(b' ');
        data[0x40..0x40 + serial.len()].copy_from_slice(serial.as_bytes());
        data
    }
    #[test]
    fn dreamcast_tracks_skip_audio_and_low_density_data_with_chd_padding_and_stored_pregaps() {
        let files = Files::new();
        let data = dreamcast_data("MK-51035", "E");
        let mut raw = vec![0; 16 * 2448];
        raw.extend(sectors(&data, 2448, 16, 2));
        let metadata = [
            (
                *b"CHGD",
                "TRACK:1 TYPE:MODE1_RAW SUBTYPE:NONE FRAMES:5 PAD:1",
            ),
            (*b"CHGD", "TRACK:2 TYPE:AUDIO SUBTYPE:NONE FRAMES:7 PAD:1"),
            (
                *b"CHGD",
                "TRACK:3 TYPE:MODE1_RAW SUBTYPE:NONE FRAMES:10 PAD:0 PREGAP:2 PGTYPE:VMODE1",
            ),
        ];
        let path = files.write("gd.chd", &chd_tracks(&raw, 2448, &metadata));
        let mut budget = Budget {
            started: std::time::Instant::now(),
            inflated: 0,
            cancelled: &|| false,
        };
        let identity = dreamcast_identity(&path, &mut budget).unwrap().unwrap();
        assert_eq!(identity.serial, "MK-51035");
        assert_eq!(identity.regions, ["Europe"]);
        files.write("track1.bin", &vec![0; 8 * 2352]);
        files.write("track3.bin", &sectors(&data, 2352, 16, 0));
        let cue=files.write("gd.cue",b"FILE \"track1.bin\" BINARY\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00\nFILE \"audio.wav\" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00\nFILE \"track3.bin\" BINARY\nTRACK 03 MODE1/2352\nINDEX 01 00:00:00\n");
        assert_eq!(
            dreamcast_identity(&cue, &mut budget)
                .unwrap()
                .unwrap()
                .serial,
            "MK-51035"
        );
        let mut bin = vec![0; 7 * 2352];
        bin.extend(sectors(&data, 2352, 24, 0));
        files.write("mil.bin", &bin);
        let cue=files.write("mil.cue",b"FILE \"mil.bin\" BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 MODE2/2352\nINDEX 01 00:00:07\n");
        assert_eq!(
            dreamcast_identity(&cue, &mut budget)
                .unwrap()
                .unwrap()
                .regions,
            ["Europe"]
        );
        let mut invalid = data.clone();
        invalid[0] = 0;
        assert!(dreamcast_header(&invalid).is_none());
        let mut invalid = data;
        invalid[0x40..0x4a].fill(b' ');
        assert!(dreamcast_header(&invalid).is_none());
    }
}
