//! Read ROM and optical disc identities without mounting or launching emulators.
//! PCSX2's packed gzip index is read as a file format, never as native pointers.
pub(crate) mod megadrive;
pub(crate) mod nintendo;
pub(crate) mod optical;
pub(crate) mod ps3;
pub(crate) mod ps4;
pub(crate) mod psp;
mod sfo;
use flate2::read::MultiGzDecoder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

const SECTOR: u64 = 2048;
const INDEX_MAGIC: &[u8] = b"PCSX2.index.gzip.v1|";
const WINDOW: usize = 32768;
const POINT_SIZE: u64 = (20 + WINDOW) as u64;
const MAX_DIRECTORY: usize = 256 * 1024;
const MAX_CNF: usize = 64 * 1024;
const MAX_INFLATED: u64 = 256 * 1024 * 1024;
const FORMAT: i32 = 1;

fn matching_enabled_in(root: &Path) -> bool {
    #[derive(Deserialize)]
    struct Preferences {
        #[serde(default = "default_enabled", rename = "useSerialMatching")]
        enabled: bool,
    }
    fn default_enabled() -> bool {
        true
    }
    let read = || -> Option<bool> {
        let file = File::open(root.join("frontend_preferences.json")).ok()?;
        if file.metadata().ok()?.len() > 256 * 1024 {
            return None;
        }
        serde_json::from_reader::<_, Preferences>(file.take(256 * 1024))
            .ok()
            .map(|p| p.enabled)
    };
    read().unwrap_or(true)
}
pub(crate) fn matching_enabled() -> bool {
    // Unit tests use isolated preferences and never read the debug library.
    #[cfg(test)]
    {
        true
    }
    #[cfg(not(test))]
    {
        crate::storage::active_directory()
            .ok()
            .map(|root| matching_enabled_in(&root))
            .unwrap_or(true)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum System {
    Ps1,
    Ps2,
    Ps3,
    Ps4,
    Psp,
    Dreamcast,
    Wii,
    GameCube,
    Saturn,
    SegaCd,
    MegaDrive,
}
impl System {
    fn from_platform(platform: &str) -> Option<Self> {
        [
            ("Sony PlayStation", Self::Ps1),
            ("Sony PlayStation 2", Self::Ps2),
            ("Sony PlayStation 3", Self::Ps3),
            ("Sony PlayStation 4", Self::Ps4),
            ("Sony PSP", Self::Psp),
            ("Sega Dreamcast", Self::Dreamcast),
            ("Nintendo Wii", Self::Wii),
            ("Nintendo GameCube", Self::GameCube),
            ("Sega Saturn", Self::Saturn),
            ("Sega CD", Self::SegaCd),
            ("Sega Genesis", Self::MegaDrive),
        ]
        .into_iter()
        .find_map(|(name, system)| {
            crate::platform_defaults::equivalent(platform, name).then_some(system)
        })
    }
    fn key(self) -> &'static str {
        match self {
            Self::Ps1 => "ps1",
            Self::Ps2 => "ps2",
            Self::Ps3 => "ps3",
            Self::Ps4 => "ps4",
            Self::Psp => "psp",
            Self::Dreamcast => "dreamcast",
            Self::Wii => "wii",
            Self::GameCube => "gamecube",
            Self::Saturn => "saturn",
            Self::SegaCd => "segacd",
            Self::MegaDrive => "megadrive",
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Identity {
    pub serial: String,
    #[serde(default)]
    pub regions: Vec<String>,
}

fn invalid() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        "Invalid disc metadata or gzip index",
    )
}
fn limited() -> io::Error {
    io::Error::new(
        io::ErrorKind::TimedOut,
        "Disc identity inspection budget exceeded",
    )
}
fn u32le(bytes: &[u8]) -> io::Result<u32> {
    Ok(u32::from_le_bytes(bytes.try_into().map_err(|_| invalid())?))
}
fn u64le(bytes: &[u8]) -> io::Result<u64> {
    Ok(u64::from_le_bytes(bytes.try_into().map_err(|_| invalid())?))
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS disc_identities(path TEXT NOT NULL,platform TEXT NOT NULL,stamp TEXT NOT NULL,identity TEXT,format INTEGER NOT NULL,PRIMARY KEY(path,platform));")?;
    if conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='ps2_disc_identities')",[],|r|r.get::<_,bool>(0))? {
        conn.execute_batch("INSERT OR IGNORE INTO disc_identities SELECT path,'ps2',stamp,CASE WHEN serial IS NULL THEN NULL ELSE json_object('serial',serial,'regions',json('[]')) END,format FROM ps2_disc_identities;")?;
    }
    Ok(())
}
#[derive(Serialize, Deserialize, PartialEq)]
struct Stamp {
    bytes: u64,
    modified: String,
}
fn stamp(path: &Path) -> Option<Stamp> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some(Stamp {
        bytes: metadata.len(),
        modified: metadata
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_nanos()
            .to_string(),
    })
}
fn index_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".pindex.tmp");
    PathBuf::from(name)
}
fn file_stamp(path: &Path) -> Option<String> {
    if path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("cue"))
    {
        let tracks = optical::cue_tracks(path).ok()?;
        let tracks = tracks
            .iter()
            .map(|track| {
                Some((
                    track.file.to_string_lossy().to_string(),
                    stamp(&track.file)?,
                ))
            })
            .collect::<Option<Vec<_>>>()?;
        return serde_json::to_string(&(stamp(path)?, tracks)).ok();
    }
    serde_json::to_string(&(stamp(path)?, stamp(&index_path(path)))).ok()
}
fn eligible(path: &Path, platform: &str) -> bool {
    let system = System::from_platform(platform);
    if system == Some(System::Ps3) {
        return ps3::game_directory(path).is_some();
    }
    if system == Some(System::Ps4) {
        return ps4::game_directory(path).is_some();
    }
    system.is_some()
        && path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|name| {
                let name = name.to_ascii_lowercase();
                if system == Some(System::Psp) {
                    return [".iso", ".cso", ".pbp", ".chd"]
                        .iter()
                        .any(|ext| name.ends_with(ext));
                }
                if system == Some(System::MegaDrive) {
                    return [".gen", ".md", ".bin"]
                        .iter()
                        .any(|ext| name.ends_with(ext));
                }
                if matches!(system, Some(System::Saturn | System::SegaCd)) {
                    return name.ends_with(".chd") || name.ends_with(".cue");
                }
                if system == Some(System::GameCube) {
                    return name.ends_with(".iso") || name.ends_with(".rvz");
                }
                if system == Some(System::Wii) {
                    return [".iso", ".rvz", ".wbfs"]
                        .iter()
                        .any(|ext| name.ends_with(ext));
                }
                name.ends_with(".iso")
                    || name.ends_with(".iso.gz")
                    || name.ends_with(".chd")
                    || name.ends_with(".cue")
            })
}
fn identity_stamp(path: &Path, system: System) -> Option<String> {
    let sfo = match system {
        System::Ps3 => ps3::metadata_path(path).ok()?,
        System::Ps4 => ps4::metadata_path(path).ok()?,
        _ => return file_stamp(path),
    };
    // EBOOT can remain unchanged while PARAM.SFO is added, replaced or removed.
    let metadata = match sfo {
        Some(sfo) => Some((sfo.to_string_lossy().to_string(), stamp(&sfo)?)),
        None => None,
    };
    serde_json::to_string(&(stamp(path)?, metadata)).ok()
}
/// Cache is optional: a read-only/unavailable library must not prevent matching.
pub(crate) fn identity_checked(
    path: &str,
    platform: &str,
    cancelled: &dyn Fn() -> bool,
) -> Option<Identity> {
    let path = Path::new(path);
    if !eligible(path, platform) {
        return None;
    }
    #[cfg(not(test))]
    let cache = crate::get_db_connection().ok();
    #[cfg(test)]
    let cache: Option<Connection> = None; // Tests never mutate the real debug library.
    cached_identity(
        path,
        System::from_platform(platform)?,
        cache.as_ref(),
        cancelled,
    )
}
#[cfg(test)]
fn cached_serial(
    path: &Path,
    cache: Option<&Connection>,
    cancelled: &dyn Fn() -> bool,
) -> Option<String> {
    cached_identity(path, System::Ps2, cache, cancelled).map(|id| id.serial)
}
fn cached_identity(
    path: &Path,
    system: System,
    cache: Option<&Connection>,
    cancelled: &dyn Fn() -> bool,
) -> Option<Identity> {
    if cancelled() {
        return None;
    }
    let signature = identity_stamp(path, system)?;
    let key = crate::platform_runtime::path_key(&path.to_string_lossy());
    if let Some(conn) = cache {
        let saved: Option<Option<String>> = conn
            .query_row(
                "SELECT identity FROM disc_identities WHERE path=?1 AND platform=?2 AND stamp=?3 AND format=?4",
                params![key,system.key(), signature, FORMAT],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if let Some(serial) = saved {
            return serial.and_then(|value| serde_json::from_str(&value).ok());
        }
    }
    let result = inspect_for(path, system, cancelled).ok()?;
    if !cancelled() && identity_stamp(path, system).as_deref() == Some(&signature) {
        if let Some(conn) = cache {
            let encoded = result
                .as_ref()
                .and_then(|id| serde_json::to_string(id).ok());
            let _=conn.execute("INSERT INTO disc_identities VALUES(?1,?2,?3,?4,?5) ON CONFLICT(path,platform) DO UPDATE SET stamp=excluded.stamp,identity=excluded.identity,format=excluded.format",params![key,system.key(),signature,encoded,FORMAT]);
        }
        result
    } else {
        None
    }
}
struct Budget<'a> {
    started: Instant,
    inflated: u64,
    cancelled: &'a dyn Fn() -> bool,
}
impl Budget<'_> {
    fn check(&self) -> io::Result<()> {
        if (self.cancelled)() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "Cancelled"));
        }
        if self.started.elapsed() > Duration::from_secs(3) {
            return Err(limited());
        }
        Ok(())
    }
    fn account(&mut self, bytes: usize) -> io::Result<()> {
        self.check()?;
        self.inflated += bytes as u64;
        if self.inflated > MAX_INFLATED {
            return Err(limited());
        }
        Ok(())
    }
}

struct Point {
    output: u64,
    input: u64,
    bits: u8,
    window: Vec<u8>,
}
struct Index {
    file: File,
    header: u64,
    count: u64,
    total: u64,
    compressed: u64,
}
impl Index {
    fn open(path: &Path, source: &mut File) -> io::Result<Self> {
        let mut file = File::open(index_path(path))?;
        let meta = file.metadata()?;
        let source_meta = source.metadata()?;
        if meta.modified()? < source_meta.modified()? {
            return Err(invalid());
        }
        let mut magic = vec![0; INDEX_MAGIC.len()];
        file.read_exact(&mut magic)?;
        if magic != INDEX_MAGIC {
            return Err(invalid());
        }
        let mut bytes = [0; 28];
        file.read_exact(&mut bytes)?;
        let count = u32le(&bytes[0..4])? as u64;
        if count == 0 || count > 65536 || (u32le(&bytes[4..8])? as u64) < count {
            return Err(invalid());
        }
        // Access contains a serialized pointer field: its width varies in old 32-bit builds.
        let header = [28_u64, 24]
            .into_iter()
            .find(|header| meta.len() == INDEX_MAGIC.len() as u64 + header + count * POINT_SIZE)
            .ok_or_else(invalid)?;
        let span = u32le(&bytes[(header - 12) as usize..(header - 8) as usize])?;
        let total = u64le(&bytes[(header - 8) as usize..header as usize])?;
        if span == 0 || span > 64 * 1024 * 1024 || total < 17 * SECTOR || source_meta.len() < 18 {
            return Err(invalid());
        }
        source.seek(SeekFrom::End(-4))?;
        let mut size = [0; 4];
        source.read_exact(&mut size)?;
        if total as u32 != u32le(&size)? {
            return Err(invalid());
        }
        let mut index = Self {
            file,
            header: INDEX_MAGIC.len() as u64 + header,
            count,
            total,
            compressed: source_meta.len(),
        };
        let first = index.header_at(0)?;
        let last = index.header_at(count - 1)?;
        if first.0 != 0 || last.0 >= total {
            return Err(invalid());
        }
        Ok(index)
    }
    fn header_at(&mut self, entry: u64) -> io::Result<(u64, u64, u8)> {
        if entry >= self.count {
            return Err(invalid());
        }
        self.file
            .seek(SeekFrom::Start(self.header + entry * POINT_SIZE))?;
        let mut bytes = [0; 20];
        self.file.read_exact(&mut bytes)?;
        let output = u64le(&bytes[0..8])?;
        let input = u64le(&bytes[8..16])?;
        let bits = u32le(&bytes[16..20])?;
        if output >= self.total || input < 10 || input >= self.compressed - 8 || bits > 7 {
            return Err(invalid());
        }
        Ok((output, input, bits as u8))
    }
    fn point(&mut self, offset: u64) -> io::Result<Point> {
        let mut low = 0;
        let mut high = self.count;
        while low + 1 < high {
            let mid = low + (high - low) / 2;
            if self.header_at(mid)?.0 <= offset {
                low = mid;
            } else {
                high = mid;
            }
        }
        let (output, input, bits) = self.header_at(low)?;
        if output > offset || offset - output > 64 * 1024 * 1024 {
            return Err(invalid());
        }
        if low > 0 && self.header_at(low - 1)?.0 >= output {
            return Err(invalid());
        }
        if low + 1 < self.count && self.header_at(low + 1)?.0 <= offset {
            return Err(invalid());
        }
        self.file
            .seek(SeekFrom::Start(self.header + low * POINT_SIZE + 20))?;
        let mut window = vec![0; WINDOW];
        self.file.read_exact(&mut window)?;
        Ok(Point {
            output,
            input,
            bits,
            window,
        })
    }
}
// Own initialized inflater state and release it exactly once. Buffer pointers below
// are used only during a synchronous inflate call while their Rust slices are alive.
struct Inflater {
    stream: zlib_rs::c_api::z_stream,
}
impl Inflater {
    fn new(window_bits: i32) -> io::Result<Self> {
        let mut stream = zlib_rs::c_api::z_stream::default();
        if zlib_rs::inflate::init(&mut stream, zlib_rs::InflateConfig { window_bits })
            != zlib_rs::ReturnCode::Ok
        {
            return Err(invalid());
        }
        Ok(Self { stream })
    }
    fn inner(&mut self) -> &mut zlib_rs::inflate::InflateStream<'_> {
        // SAFETY: init succeeded, this object owns the live state, and no aliased
        // inflater references survive the returned mutable borrow.
        unsafe {
            zlib_rs::inflate::InflateStream::from_stream_mut(&mut self.stream)
                .expect("initialized inflater")
        }
    }
}
impl Drop for Inflater {
    fn drop(&mut self) {
        zlib_rs::inflate::end(self.inner());
    }
}
struct IndexedReader {
    input: BufReader<File>,
    inflater: Inflater,
    bytes: Vec<u8>,
    start: usize,
    end: usize,
    finished: bool,
}
impl IndexedReader {
    fn new(mut file: File, point: &Point) -> io::Result<Self> {
        let mut inflater = Inflater::new(-15)?;
        file.seek(SeekFrom::Start(point.input - u64::from(point.bits != 0)))?;
        if point.bits != 0 {
            let mut byte = [0];
            file.read_exact(&mut byte)?;
            if zlib_rs::inflate::prime(
                inflater.inner(),
                point.bits.into(),
                (byte[0] >> (8 - point.bits)).into(),
            ) != zlib_rs::ReturnCode::Ok
            {
                return Err(invalid());
            }
        }
        if point.output != 0
            && zlib_rs::inflate::set_dictionary(inflater.inner(), &point.window)
                != zlib_rs::ReturnCode::Ok
        {
            return Err(invalid());
        }
        Ok(Self {
            input: BufReader::new(file),
            inflater,
            bytes: vec![0; 65536],
            start: 0,
            end: 0,
            finished: false,
        })
    }
}
impl Read for IndexedReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() || self.finished {
            return Ok(0);
        }
        loop {
            if self.start == self.end {
                self.end = self.input.read(&mut self.bytes)?;
                self.start = 0;
            }
            let available = (self.end - self.start) as u32;
            let capacity = output.len().min(u32::MAX as usize) as u32;
            self.inflater.stream.next_in = self.bytes[self.start..self.end].as_mut_ptr();
            self.inflater.stream.avail_in = available;
            self.inflater.stream.next_out = output.as_mut_ptr();
            self.inflater.stream.avail_out = capacity;
            // SAFETY: the input/output slices above remain valid and disjoint for
            // this call, with avail_in/out bounded by their actual capacities.
            let status = unsafe {
                zlib_rs::inflate::inflate(self.inflater.inner(), zlib_rs::InflateFlush::NoFlush)
            };
            if ![
                zlib_rs::ReturnCode::Ok,
                zlib_rs::ReturnCode::BufError,
                zlib_rs::ReturnCode::StreamEnd,
            ]
            .contains(&status)
            {
                return Err(invalid());
            }
            let used = (available - self.inflater.stream.avail_in) as usize;
            let produced = (capacity - self.inflater.stream.avail_out) as usize;
            self.start += used;
            self.finished = status == zlib_rs::ReturnCode::StreamEnd;
            if produced > 0 || self.finished {
                return Ok(produced);
            }
            if used == 0 {
                return Err(invalid());
            }
        }
    }
}

enum Image {
    Plain(File),
    Gzip { path: PathBuf, index: Option<Index> },
    Optical(Box<optical::DataTrack>),
    Cso(Box<psp::Cso>),
}
impl Image {
    fn open(path: &Path, budget: &mut Budget<'_>) -> io::Result<Self> {
        budget.check()?;
        if path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("cso"))
        {
            return Ok(Self::Cso(Box::new(psp::Cso::open(path, budget)?)));
        }
        if path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("cue"))
        {
            return Ok(Self::Optical(Box::new(optical::DataTrack::cue(path)?)));
        }
        if path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("chd"))
        {
            return Ok(Self::Optical(Box::new(optical::DataTrack::chd(
                path, budget,
            )?)));
        }
        let mut file = File::open(path)?;
        if path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("gz"))
        {
            let index = Index::open(path, &mut file).ok();
            Ok(Self::Gzip {
                path: path.into(),
                index,
            })
        } else {
            Ok(Self::Plain(file))
        }
    }
    fn read_at(
        &mut self,
        offset: u64,
        bytes: &mut [u8],
        budget: &mut Budget<'_>,
    ) -> io::Result<()> {
        budget.check()?;
        match self {
            Self::Cso(cso) => cso.read_at(offset, bytes, budget),
            Self::Optical(track) => track.read_at(offset, bytes, budget),
            Self::Plain(file) => {
                if offset
                    .checked_add(bytes.len() as u64)
                    .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
                {
                    return Err(invalid());
                }
                file.seek(SeekFrom::Start(offset))?;
                file.read_exact(bytes)
            }
            Self::Gzip { path, index } => {
                if let Some(points) = index {
                    let result = (|| {
                        let point = points.point(offset)?;
                        let mut reader = IndexedReader::new(File::open(&*path)?, &point)?;
                        read_range(&mut reader, offset - point.output, bytes, budget)
                    })();
                    if result.is_ok() {
                        return result;
                    }
                    budget.check()?;
                    *index = None;
                }
                let mut reader = MultiGzDecoder::new(BufReader::new(File::open(path)?));
                read_range(&mut reader, offset, bytes, budget)
            }
        }
    }
}
fn read_range(
    reader: &mut impl Read,
    mut skip: u64,
    output: &mut [u8],
    budget: &mut Budget<'_>,
) -> io::Result<()> {
    if skip + output.len() as u64 > MAX_INFLATED - budget.inflated {
        return Err(limited());
    }
    let mut buffer = [0; 32768];
    while skip > 0 {
        budget.check()?;
        let count = reader.read(&mut buffer[..(skip.min(32768)) as usize])?;
        if count == 0 {
            return Err(invalid());
        }
        budget.account(count)?;
        skip -= count as u64;
    }
    let mut start = 0;
    while start < output.len() {
        budget.check()?;
        let end = (start + 32768).min(output.len());
        let count = reader.read(&mut output[start..end])?;
        if count == 0 {
            return Err(invalid());
        }
        budget.account(count)?;
        start += count;
    }
    Ok(())
}
#[cfg(test)]
fn boot_serial(cnf: &[u8]) -> Option<String> {
    boot_serial_for(cnf, System::Ps2)
}
fn boot_serial_for(cnf: &[u8], system: System) -> Option<String> {
    let cnf = std::str::from_utf8(cnf)
        .ok()?
        .trim_start_matches('\u{feff}');
    for line in cnf.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case(if system == System::Ps1 {
            "BOOT"
        } else {
            "BOOT2"
        }) {
            continue;
        }
        let value = value.trim().trim_matches('"').split(';').next()?.trim();
        let name = value.rsplit(['\\', '/', ':']).next()?;
        let bytes = name.as_bytes();
        if bytes.len() != 11
            || !bytes[..4].iter().all(u8::is_ascii_alphabetic)
            || ![b'_', b'-'].contains(&bytes[4])
            || bytes[8] != b'.'
            || !bytes[5..8]
                .iter()
                .chain(&bytes[9..11])
                .all(|b| b.is_ascii_digit())
        {
            continue;
        }
        return Some(format!(
            "{}-{}{}",
            name[..4].to_ascii_uppercase(),
            &name[5..8],
            &name[9..11]
        ));
    }
    None
}
fn extent(bytes: &[u8]) -> io::Result<(u64, usize)> {
    if bytes.len() < 34 || bytes[0] < 34 {
        return Err(invalid());
    }
    let block = u32le(&bytes[2..6])?;
    let length = u32le(&bytes[10..14])?;
    if block != u32::from_be_bytes(bytes[6..10].try_into().unwrap())
        || length != u32::from_be_bytes(bytes[14..18].try_into().unwrap())
        || bytes[1] != 0
    {
        return Err(invalid());
    }
    Ok((u64::from(block) * SECTOR, length as usize))
}
#[cfg(test)]
fn inspect(path: &Path, cancelled: &dyn Fn() -> bool) -> io::Result<Option<String>> {
    inspect_for(path, System::Ps2, cancelled).map(|id| id.map(|id| id.serial))
}
fn inspect_for(
    path: &Path,
    system: System,
    cancelled: &dyn Fn() -> bool,
) -> io::Result<Option<Identity>> {
    let mut budget = Budget {
        started: Instant::now(),
        inflated: 0,
        cancelled,
    };
    if system == System::Ps3 {
        return ps3::identity(path, &mut budget);
    }
    if system == System::Ps4 {
        return ps4::identity(path, &mut budget);
    }
    if system == System::Psp {
        return psp::identity(path, &mut budget);
    }
    if system == System::MegaDrive {
        return megadrive::identity(path, &mut budget);
    }
    if matches!(system, System::Wii | System::GameCube) {
        return nintendo::identity(path, &mut budget, system);
    }
    if matches!(system, System::Dreamcast | System::Saturn | System::SegaCd) {
        return optical::sega_identity(path, &mut budget, system);
    }
    let mut image = Image::open(path, &mut budget)?;
    let indexed = matches!(&image, Image::Gzip { index: Some(_), .. });
    let result = inspect_image(&mut image, &mut budget, system);
    // An apparently valid but damaged sidecar can decode into invalid ISO data.
    // Retry ordinary gzip without touching the sidecar, within the same budget.
    if indexed
        && result
            .as_ref()
            .is_err_and(|e| e.kind() == io::ErrorKind::InvalidData)
    {
        if let Image::Gzip { index, .. } = &mut image {
            *index = None;
        }
        inspect_image(&mut image, &mut budget, system)
    } else {
        result
    }
}
fn inspect_image(
    image: &mut Image,
    budget: &mut Budget<'_>,
    system: System,
) -> io::Result<Option<Identity>> {
    let Some(cnf) = iso_file(image, &[b"SYSTEM.CNF"], MAX_CNF, budget)? else {
        return Ok(None);
    };
    Ok(boot_serial_for(&cnf, system).map(|serial| Identity {
        serial,
        regions: Vec::new(),
    }))
}

/// Read one bounded ISO 9660 metadata file through fixed directory components.
fn iso_file(
    image: &mut Image,
    components: &[&[u8]],
    max_file: usize,
    budget: &mut Budget<'_>,
) -> io::Result<Option<Vec<u8>>> {
    let mut sector = [0; SECTOR as usize];
    let mut root = None;
    for block in 16..48 {
        image.read_at(block * SECTOR, &mut sector, budget)?;
        if &sector[1..6] != b"CD001" || sector[6] != 1 {
            return Err(invalid());
        }
        if sector[0] == 255 {
            break;
        }
        if sector[0] == 1 {
            if u16::from_le_bytes([sector[128], sector[129]]) != SECTOR as u16 {
                return Err(invalid());
            }
            root = Some(extent(&sector[156..])?);
            break;
        }
    }
    let Some(mut current) = root else {
        return Ok(None);
    };
    for (index, target) in components.iter().enumerate() {
        let (offset, length) = current;
        if length == 0 || length > MAX_DIRECTORY {
            return Err(invalid());
        }
        let mut directory = vec![0; length];
        image.read_at(offset, &mut directory, budget)?;
        let mut start = 0;
        let mut found = None;
        let last = index + 1 == components.len();
        while start < directory.len() {
            budget.check()?;
            let length = directory[start] as usize;
            if length == 0 {
                start = ((start / SECTOR as usize) + 1) * SECTOR as usize;
                continue;
            }
            let end = start
                .checked_add(length)
                .filter(|end| {
                    *end <= directory.len()
                        && (*end - 1) / SECTOR as usize == start / SECTOR as usize
                })
                .ok_or_else(invalid)?;
            let entry = &directory[start..end];
            start = end;
            if entry.len() < 34 {
                return Err(invalid());
            }
            let name_end = 33 + entry[32] as usize;
            if name_end > entry.len() {
                return Err(invalid());
            }
            let name = entry[33..name_end]
                .split(|b| *b == b';')
                .next()
                .unwrap_or_default();
            if !name.eq_ignore_ascii_case(target) || (entry[25] & 2 != 0) == last {
                continue;
            }
            if entry[25] & 0x80 != 0 {
                return Err(invalid());
            }
            found = Some(extent(entry)?);
            break;
        }
        let Some(entry) = found else { return Ok(None) };
        if last {
            let (offset, length) = entry;
            if length == 0 || length > max_file {
                return Err(invalid());
            }
            let mut bytes = vec![0; length];
            image.read_at(offset, &mut bytes, budget)?;
            return Ok(Some(bytes));
        }
        current = entry;
    }
    Ok(None)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;
    pub struct Files(pub PathBuf);
    impl Files {
        pub fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let root = std::env::current_dir()
                .unwrap()
                .join("target/ps2-serial-tests")
                .join(format!(
                    "{}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        pub fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            assert!(self.0.parent().unwrap().ends_with("ps2-serial-tests"));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn serial_matching_preferences_default_on_and_persist_one_global_switch() {
        let files = Files::new();
        assert!(matching_enabled_in(&files.0));
        for json in [
            b"{}".as_slice(),
            b"{\"useSerialMatching\":true}",
            b"{\"useSerialMatching\":\"false\"}",
            b"invalid",
        ] {
            files.write("frontend_preferences.json", json);
            assert!(matching_enabled_in(&files.0));
        }
        files.write(
            "frontend_preferences.json",
            b"{\"useSerialMatching\":false,\"useCatalogTitles\":true}",
        );
        assert!(!matching_enabled_in(&files.0));
        files.write("frontend_preferences.json", b"{\"useSerialMatching\":true}");
        assert!(matching_enabled_in(&files.0));
    }
    fn both(bytes: &mut [u8], value: u32) {
        bytes[..4].copy_from_slice(&value.to_le_bytes());
        bytes[4..8].copy_from_slice(&value.to_be_bytes());
    }
    fn record(name: &[u8], block: u32, size: u32, directory: bool) -> Vec<u8> {
        let mut entry = vec![0; 33 + name.len() + usize::from(name.len() % 2 == 0)];
        entry[0] = entry.len() as u8;
        both(&mut entry[2..10], block);
        both(&mut entry[10..18], size);
        entry[25] = if directory { 2 } else { 0 };
        entry[32] = name.len() as u8;
        entry[33..33 + name.len()].copy_from_slice(name);
        entry
    }
    pub fn iso(boot: &str) -> Vec<u8> {
        let mut data = vec![0; 40 * SECTOR as usize];
        let pvd = &mut data[16 * SECTOR as usize..17 * SECTOR as usize];
        pvd[0] = 1;
        pvd[1..6].copy_from_slice(b"CD001");
        pvd[6] = 1;
        pvd[128..130].copy_from_slice(&(SECTOR as u16).to_le_bytes());
        pvd[130..132].copy_from_slice(&(SECTOR as u16).to_be_bytes());
        let root = record(&[0], 20, SECTOR as u32, true);
        pvd[156..156 + root.len()].copy_from_slice(&root);
        let end = &mut data[17 * SECTOR as usize..18 * SECTOR as usize];
        end[0] = 255;
        end[1..6].copy_from_slice(b"CD001");
        end[6] = 1;
        let cnf = format!("BOOT2 = cdrom0:\\{boot};1\r\nVER = 1.00\r\nVMODE = NTSC\r\n");
        let records = [
            root,
            record(&[1], 20, SECTOR as u32, true),
            record(b"SYSTEM.CNF;1", 32, cnf.len() as u32, false),
        ]
        .concat();
        data[20 * SECTOR as usize..20 * SECTOR as usize + records.len()].copy_from_slice(&records);
        data[32 * SECTOR as usize..32 * SECTOR as usize + cnf.len()]
            .copy_from_slice(cnf.as_bytes());
        data
    }

    pub fn ps1_iso(boot: &str) -> Vec<u8> {
        let mut data = iso(boot);
        let offset = data.windows(5).position(|b| b == b"BOOT2").unwrap();
        data[offset..offset + 5].copy_from_slice(b"BOOT ");
        data
    }
    #[test]
    fn ps1_boot_serial_uses_the_selected_platform_and_persistent_cache_migrates_ps2() {
        let files = Files::new();
        let data = ps1_iso("SLUS_009.99");
        let path = files.write("Renamed.iso", &data);
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE ps2_disc_identities(path TEXT PRIMARY KEY,stamp TEXT NOT NULL,serial TEXT,format INTEGER NOT NULL);INSERT INTO ps2_disc_identities VALUES('old','stamp','SLUS-20998',1);").unwrap();
        init(&conn).unwrap();
        init(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT json_extract(identity,'$.serial') FROM disc_identities WHERE path='old' AND platform='ps2'",[],|r|r.get::<_,String>(0)).unwrap(),"SLUS-20998");
        assert!(cached_identity(&path, System::Ps2, Some(&conn), &|| false).is_none());
        assert_eq!(
            cached_identity(&path, System::Ps1, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "SLUS-00999"
        );
        let bytes = optical::tests::sectors(&data, 2352, 24, 0);
        files.write("data.bin", &bytes);
        let cue = files.write(
            "game.cue",
            b"FILE \"data.bin\" BINARY\nTRACK 01 MODE2/2352\nINDEX 01 00:00:00\n",
        );
        assert_eq!(
            inspect_for(&cue, System::Ps1, &|| false)
                .unwrap()
                .unwrap()
                .serial,
            "SLUS-00999"
        );
        let chd = files.write(
            "game.chd",
            &optical::tests::chd(
                &optical::tests::sectors(&data, 2448, 24, 0),
                2448,
                Some("TRACK:1 TYPE:MODE2_RAW SUBTYPE:NONE FRAMES:40"),
            ),
        );
        assert_eq!(
            inspect_for(&chd, System::Ps1, &|| false)
                .unwrap()
                .unwrap()
                .serial,
            "SLUS-00999"
        );
        assert!(identity_checked(chd.to_str().unwrap(), "Sega Saturn", &|| false).is_none());
    }
    #[test]
    #[ignore = "Read-only check of explicitly supplied disc paths; never touches the library database"]
    fn inspect_local_disc_images_read_only() {
        let values: Vec<(String, String)> = serde_json::from_str(
            &std::env::var("OPENCABINET_DISC_SAMPLES").expect("JSON array of [platform,path]"),
        )
        .unwrap();
        for (platform, path) in values {
            let now = Instant::now();
            let result = inspect_for(
                Path::new(&path),
                System::from_platform(&platform).unwrap(),
                &|| false,
            )
            .unwrap();
            println!("{path}: {result:?} ({:?})", now.elapsed());
            assert!(result.is_some());
        }
    }
    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }
    fn read(path: &Path) -> Option<String> {
        inspect(path, &|| false).ok().flatten()
    }
    // Generate a valid gzip stream with a flushed block and record real zlib
    // checkpoints. Its stored flush block also exercises bit alignment on resume.
    fn indexed_gzip(data: &[u8], header: usize) -> (Vec<u8>, Vec<u8>) {
        let cut = WINDOW - 8;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(&data[..cut]).unwrap();
        encoder.flush().unwrap();
        encoder.write_all(&data[cut..]).unwrap();
        let source = encoder.finish().unwrap();
        let mut inflater = Inflater::new(47).unwrap();
        let mut output = vec![0; data.len() + 1];
        let mut points = Vec::new();
        inflater.stream.next_in = source.as_ptr() as *mut u8;
        inflater.stream.avail_in = source.len() as u32;
        loop {
            let written = inflater.stream.total_out as usize;
            inflater.stream.next_out = output[written..].as_mut_ptr();
            inflater.stream.avail_out = (output.len() - written) as u32;
            let status = unsafe {
                zlib_rs::inflate::inflate(inflater.inner(), zlib_rs::InflateFlush::Block)
            };
            assert!([zlib_rs::ReturnCode::Ok, zlib_rs::ReturnCode::StreamEnd].contains(&status));
            let out = inflater.stream.total_out as usize;
            let bits = inflater.stream.data_type & 7;
            if inflater.stream.data_type & 128 != 0
                && inflater.stream.data_type & 64 == 0
                && (out == 0 || (out == cut && bits != 0))
            {
                let mut window = vec![0; WINDOW];
                let length = out.min(WINDOW);
                window[WINDOW - length..].copy_from_slice(&data[out - length..out]);
                points.push((out as u64, inflater.stream.total_in as u64, bits, window));
            }
            if status == zlib_rs::ReturnCode::StreamEnd {
                break;
            }
        }
        assert_eq!(&output[..data.len()], data);
        assert_eq!(points.len(), 2);
        assert!(points[1].2 > 0);
        let mut index = INDEX_MAGIC.to_vec();
        let start = index.len();
        index.resize(start + header, 0);
        index[start..start + 4].copy_from_slice(&(points.len() as i32).to_le_bytes());
        index[start + 4..start + 8].copy_from_slice(&(points.len() as i32).to_le_bytes());
        index[start + header - 12..start + header - 8]
            .copy_from_slice(&(4 * 1024 * 1024_i32).to_le_bytes());
        index[start + header - 8..start + header]
            .copy_from_slice(&(data.len() as u64).to_le_bytes());
        for (output, input, bits, window) in points {
            index.extend(output.to_le_bytes());
            index.extend(input.to_le_bytes());
            index.extend(bits.to_le_bytes());
            index.extend(window);
        }
        (source, index)
    }
    #[test]
    fn boot2_is_normalized_without_confusing_ps1_or_homebrew_names() {
        for (cnf, expected) in [
            ("BOOT2 = cdrom0:\\SLUS_209.98;1", Some("SLUS-20998")),
            ("boot2 = \"cdrom:\\dir\\sles-527.30;1\"", Some("SLES-52730")),
            ("BOOT=cdrom:\\SLUS_209.98;1", None),
            ("BOOT2=cdrom0:\\HOMEBREW.ELF;1", None),
            ("BOOT2=cdrom0:\\SLUS_209.9;1", None),
        ] {
            assert_eq!(boot_serial(cnf.as_bytes()).as_deref(), expected);
        }
    }
    #[test]
    fn iso_and_gzip_read_serials_independently_of_filenames_without_writing_sidecars() {
        let files = Files::new();
        let data = iso("SLUS_209.98");
        for (name, bytes) in [
            ("Wrong title (Japan).iso", data.clone()),
            ("Unknown.iso.gz", gzip(&data)),
        ] {
            let path = files.write(name, &bytes);
            assert_eq!(read(&path).as_deref(), Some("SLUS-20998"));
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert!(!index_path(&path).exists());
        }
        assert!(eligible(Path::new("X.ISO.GZ"), "Sony - PlayStation 2"));
        assert!(eligible(Path::new("X.iso"), "Sony PlayStation"));
        assert!(!eligible(Path::new("X.exe"), "Sony PlayStation 2"));
    }
    #[test]
    fn pcsx2_32_and_64_bit_indexes_resume_at_non_byte_aligned_blocks_with_dictionary() {
        let files = Files::new();
        let data = iso("SCES_500.00");
        for header in [24, 28] {
            let (source, index) = indexed_gzip(&data, header);
            let path = files.write(&format!("Indexed{header}.iso.gz"), &source);
            fs::write(index_path(&path), &index).unwrap();
            let mut verify = Vec::new();
            MultiGzDecoder::new(&source[..])
                .read_to_end(&mut verify)
                .unwrap();
            assert_eq!(verify, data);
            let mut input = File::open(&path).unwrap();
            let mut points = Index::open(&path, &mut input).unwrap();
            let point = points.point(16 * SECTOR).unwrap();
            assert_eq!(point.output, (WINDOW - 8) as u64);
            assert!(point.bits > 0);
            let mut reader = IndexedReader::new(input, &point).unwrap();
            let mut bytes = vec![0; data.len() - (WINDOW - 8)];
            reader.read_exact(&mut bytes).unwrap();
            assert_eq!(bytes, data[WINDOW - 8..]);
            assert_eq!(read(&path).as_deref(), Some("SCES-50000"));
            assert_eq!(fs::read(index_path(&path)).unwrap(), index);
        }
    }
    #[test]
    fn missing_stale_and_damaged_indexes_fall_back_without_modifying_user_files() {
        let files = Files::new();
        let data = iso("SLES_123.45");
        let (source, index) = indexed_gzip(&data, 28);
        let path = files.write("Game.iso.gz", &source);
        for index in [b"broken".to_vec(), {
            let mut v = index.clone();
            v[INDEX_MAGIC.len()..INDEX_MAGIC.len() + 4].copy_from_slice(&u32::MAX.to_le_bytes());
            v
        }] {
            fs::write(index_path(&path), &index).unwrap();
            assert_eq!(read(&path).as_deref(), Some("SLES-12345"));
            assert_eq!(fs::read(index_path(&path)).unwrap(), index);
        }
        fs::write(index_path(&path), &index).unwrap();
        File::options()
            .write(true)
            .open(index_path(&path))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(UNIX_EPOCH))
            .unwrap();
        let mut input = File::open(&path).unwrap();
        assert!(Index::open(&path, &mut input).is_err());
        assert_eq!(read(&path).as_deref(), Some("SLES-12345"));
        let mut damaged = index.clone();
        let second = INDEX_MAGIC.len() + 28 + POINT_SIZE as usize;
        damaged[second + 8..second + 16].copy_from_slice(&11_u64.to_le_bytes());
        fs::write(index_path(&path), &damaged).unwrap();
        assert_eq!(read(&path).as_deref(), Some("SLES-12345"));
        assert_eq!(fs::read(index_path(&path)).unwrap(), damaged);
    }
    #[test]
    fn persistent_cache_invalidates_for_source_changes_and_new_sidecars() {
        let files = Files::new();
        let path = files.write("Game.iso", &iso("SLUS_209.98"));
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("SLUS-20998")
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("cached")
        );
        let mut changed = iso("SLES_123.45");
        changed.push(0);
        fs::write(&path, changed).unwrap();
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("SLES-12345")
        );
        let before = file_stamp(&path).unwrap();
        fs::write(index_path(&path), b"invalid index").unwrap();
        assert_ne!(file_stamp(&path).unwrap(), before);
        assert_eq!(
            cached_serial(&path, Some(&conn), &|| false).as_deref(),
            Some("SLES-12345")
        );
        assert!(cached_serial(&path, Some(&conn), &|| true).is_none());
    }
    #[test]
    fn malformed_images_cancellation_and_excessive_inflate_offsets_are_bounded() {
        let files = Files::new();
        for bytes in [vec![], vec![0; 64], vec![0; 40 * SECTOR as usize]] {
            let path = files.write("Broken.iso", &bytes);
            assert!(read(&path).is_none());
        }
        let mut data = iso("SLUS_209.98");
        data[20 * SECTOR as usize] = 255;
        let path = files.write("Broken.iso.gz", &gzip(&data));
        assert!(read(&path).is_none());
        assert_eq!(
            inspect(&path, &|| true).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        let mut reader = &b"x"[..];
        let mut budget = Budget {
            started: Instant::now(),
            inflated: 0,
            cancelled: &|| false,
        };
        assert_eq!(
            read_range(&mut reader, MAX_INFLATED + 1, &mut [0; 1], &mut budget)
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }
    #[test]
    #[ignore = "Reads explicitly supplied local disc images; does not update their files or the debug database"]
    fn inspect_local_ps2_images_read_only() {
        let paths: Vec<String> = serde_json::from_str(
            &std::env::var("OPENCABINET_PS2_SAMPLES").expect("JSON array of image paths"),
        )
        .unwrap();
        for path in paths {
            let start = Instant::now();
            let result = inspect(Path::new(&path), &|| false).unwrap();
            println!("{path}: {result:?} ({:?})", start.elapsed());
            assert!(result.is_some());
        }
    }
}
