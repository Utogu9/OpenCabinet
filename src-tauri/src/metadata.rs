//! Metadata catalogs are cached independently from the user's library.
//! All commands that touch the network or parse the catalog run on blocking workers.
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use quick_xml::{Reader, events::Event};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{Manager, ipc::Channel};
use tokio::sync::Notify;
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

use super::{GameImage, RomCandidate, ScanPreview, ScanProgress, ScanResult};

const IMAGE_BASE: &str = crate::catalog_compat::IMAGE_BASE;
pub mod platforms;
pub mod repository;
mod repository_metadata;
// Older catalogs merged distinct categories into "artwork" or "other".
// Reindex once to recover the original types from the source XML.
const CATALOG_MEDIA_VERSION: i64 = 2;
const GAME_IMAGE_TYPES: &[(&str, &str)] = &[
    ("Box - Front", "cover"),
    ("Clear Logo", "logo"),
    ("Screenshot - Gameplay", "screenshot"),
    ("Screenshot - Game Title", "title_screen"),
    ("Box - Back", "back_cover"),
    ("Box - Inlay", "inlay"),
    ("Box - Spine", "spine"),
    ("Box - 3D", "box_3d"),
    ("Box - Full", "box_full"),
    ("Box - Front - Reconstructed", "cover_reconstructed"),
    ("Box - Back - Reconstructed", "back_cover_reconstructed"),
    ("Cart - Front", "cart_front"),
    ("Cart - Back", "cart_back"),
    ("Cart - 3D", "cart_3d"),
    ("Disc", "disc"),
    ("Banner", "banner"),
    ("Icon", "icon"),
    ("Poster", "poster"),
    ("Square", "square"),
    ("Fanart - Background", "fanart_background"),
    ("Fanart - Box - Front", "fanart_cover"),
    ("Fanart - Box - Back", "fanart_back_cover"),
    ("Fanart - Cart - Front", "fanart_cart_front"),
    ("Fanart - Cart - Back", "fanart_cart_back"),
    ("Fanart - Disc", "fanart_disc"),
    ("Screenshot - Game Select", "game_select"),
    ("Screenshot - Game Over", "game_over"),
    ("Screenshot - High Scores", "high_scores"),
    ("Advertisement Flyer - Front", "flyer_front"),
    ("Advertisement Flyer - Back", "flyer_back"),
    ("Arcade - Cabinet", "arcade_cabinet"),
    ("Arcade - Circuit Board", "arcade_circuit_board"),
    ("Arcade - Control Panel", "arcade_control_panel"),
    ("Arcade - Controls Information", "arcade_controls"),
    ("Arcade - Marquee", "arcade_marquee"),
];

pub(super) fn valid_image_kind(kind: &str) -> bool {
    // Manual cartridge labels remain valid even without a source category.
    kind == "cart_label" || valid_download_image_kind(kind)
}
fn valid_download_image_kind(kind: &str) -> bool {
    matches!(kind, "artwork" | "other" | "cart_label") || GAME_IMAGE_TYPES.iter().any(|(_, key)| *key == kind)
}
#[cfg(test)]
const MAX_CATALOG_BYTES: u64 = 512 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
const IMAGE_DOWNLOAD_WORKERS: usize = 4;
fn cancelled_message() -> &'static str { crate::i18n::text("msg.3a8b27b791") }

type Result<T> = std::result::Result<T, String>;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(super) fn init_library_schema(conn: &Connection) -> rusqlite::Result<()> {
    repository::init_matches(conn)?;
    for (table, column, kind) in [
        ("games", "launch\u{0062}ox_id", "INTEGER"),
        ("platforms", "launch\u{0062}ox_platform", "TEXT"),
    ] {
        let present = conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<HashSet<_>>>()?;
        if !present.contains(column) {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} {kind}"),
                [],
            )?;
        }
    }
    Ok(())
}

#[derive(Default, Clone)]
pub struct MetadataJobs(Arc<Mutex<Option<(String, Arc<ImportJob>)>>>);

impl MetadataJobs {
    pub(super) fn has_active_job(&self) -> bool {
        self.0.lock().map(|state| state.is_some()).unwrap_or(true)
    }

    pub(super) fn get(&self, id: &str) -> Result<Arc<ImportJob>> {
        let state = self.0.lock().map_err(err)?;
        state
            .as_ref()
            .filter(|(key, _)| key == id)
            .map(|(_, job)| job.clone())
            .ok_or_else(|| crate::i18n::text("msg.53d5cbe17c").into())
    }

    fn start(&self, root: PathBuf) -> Result<Arc<ImportJob>> {
        let mut state = self.0.lock().map_err(err)?;
        if state.is_some() {
            return Err(crate::i18n::text("msg.a37bbafd3c").into());
        }
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos()
            .to_string();
        let directory = root.join("metadata").join("staging").join(&id);
        fs::create_dir_all(directory.parent().unwrap()).map_err(err)?;
        fs::create_dir(&directory).map_err(err)?;
        let job = Arc::new(ImportJob {
            personal_catalog: repository::personal(&root),
            platform_hint: Mutex::new(None),
            image_urls: Mutex::new(HashMap::new()),
            id: id.clone(),
            root,
            directory,
            cancelled: Arc::new(AtomicBool::new(false)),
            signal: Notify::new(),
            busy: AtomicBool::new(false),
            commit_gate: Mutex::new(false),
            staged: Mutex::new(None),
            editor_batch: Mutex::new(None),
            platform_import: Mutex::new(None),
        });
        *state = Some((id, job.clone()));
        Ok(job)
    }
}

pub(super) struct ImportJob {
    personal_catalog: bool,
    platform_hint: Mutex<Option<String>>,
    image_urls: Mutex<HashMap<String,String>>,
    id: String,
    root: PathBuf,
    directory: PathBuf,
    cancelled: Arc<AtomicBool>,
    signal: Notify,
    busy: AtomicBool,
    // Cancellation and the final commit use the same gate: a successful cancel
    // can never race with a transaction that subsequently commits.
    commit_gate: Mutex<bool>,
    staged: Mutex<Option<StagedBatch>>,
    editor_batch: Mutex<Option<StagedBatch>>,
    platform_import: Mutex<Option<platforms::PlatformImport>>,
}

impl ImportJob {
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(cancelled_message().into())
        } else {
            Ok(())
        }
    }

    fn enter(&self) -> Result<Busy<'_>> {
        self.check()?;
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(crate::i18n::text("msg.ff3174475f").into());
        }
        Ok(Busy(self))
    }

    fn cancel(&self) -> Result<()> {
        let committed = self.commit_gate.lock().map_err(err)?;
        if !*committed {
            self.cancelled.store(true, Ordering::Release);
            self.signal.notify_waiters();
        }
        Ok(())
    }

    fn progress(
        &self,
        phase: &'static str,
        processed: u64,
        total: Option<u64>,
        current_file: Option<String>,
    ) -> MetadataProgress {
        MetadataProgress {
            job_id: self.id.clone(),
            phase,
            processed,
            total,
            current_file,
        }
    }

    fn catalog_path(&self) -> PathBuf {
        repository::path(&self.root,self.personal_catalog)
    }
}

struct Busy<'a>(&'a ImportJob);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}
impl Drop for ImportJob {
    fn drop(&mut self) {
        // This absolute directory was created by start(), from a server-generated ID.
        // Never remove the catalog, the image library, or any user-supplied path.
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[derive(Serialize, Debug)]
pub struct MetadataProgress {
    job_id: String,
    phase: &'static str,
    processed: u64,
    total: Option<u64>,
    current_file: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct CatalogSummary {
    source: String,
    downloaded_at: String,
    game_count: usize,
    platforms: Vec<String>,
}

#[derive(Serialize)]
pub struct ImportSession {
    job_id: String,
    catalog: Option<CatalogSummary>,
    source_platform: Option<String>,
    source_id: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CatalogGame {
    id: i64,
    title: String,
    platform: String,
    release_date: Option<String>,
    developer: Option<String>,
    publisher: Option<String>,
    genre: Option<String>,
    game_mode: Option<String>,
    max_players: Option<i32>,
    description: Option<String>,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    #[serde(flatten)]
    game: CatalogGame,
    exact: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_key: Option<String>,
}

#[derive(Serialize)]
pub struct MatchRow {
    rom_path: String,
    selected_id: Option<i64>,
    candidates: Vec<SearchResult>,
}

#[derive(Deserialize, Clone)]
pub struct MatchSelection {
    rom_path: String,
    id: Option<i64>,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct MediaOptions {
    selected_types: Option<Vec<String>>,
    download_all: bool,
    cover: usize,
    logo: usize,
    screenshot: usize,
    title_screen: usize,
    back_cover: usize,
    #[serde(default)]
    spine: usize,
    artwork: usize,
    other: usize,
    #[serde(flatten)]
    additional: HashMap<String, usize>,
}

impl MediaOptions {
    fn entries(&self) -> Vec<(&str, usize)> {
        if let Some(selected) = &self.selected_types {
            return GAME_IMAGE_TYPES.iter().map(|(_, key)| *key).chain(["artwork", "other", "cart_label"])
                .filter(|kind| selected.iter().any(|selected| selected == kind))
                .map(|kind| (kind, if self.download_all { usize::MAX } else { 1 })).collect();
        }
        let mut entries = vec![
            ("cover", self.cover),
            ("logo", self.logo),
            ("screenshot", self.screenshot),
            ("title_screen", self.title_screen),
            ("back_cover", self.back_cover),
            ("spine", self.spine),
            ("artwork", self.artwork),
            ("other", self.other),
        ];
        // Stable order also keeps de-duplication between categories predictable.
        entries.extend(GAME_IMAGE_TYPES.iter().filter_map(|(_, key)| {
            self.additional.get(*key).map(|count| (*key, *count))
        }));
        entries
    }
    fn validate(&self) -> Result<()> {
        if let Some(selected) = &self.selected_types {
            if selected.iter().any(|kind| !valid_download_image_kind(kind)) {
                return Err(crate::i18n::text("msg.95d1910bbf").into());
            }
            return Ok(());
        }
        if self.additional.keys().any(|kind| !valid_download_image_kind(kind)) {
            return Err(crate::i18n::text("msg.95d1910bbf").into());
        }
        if self.cover > 1 || self.logo > 1 || self.entries().iter().any(|(_, n)| *n > 20) {
            return Err(
                crate::i18n::text("msg.5ff2ef488d")
                    .into(),
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct CatalogImage {
    filename: String,
    kind: String,
    region: String,
    crc: String,
}

struct PreparedGame {
    candidate: RomCandidate,
    metadata: Option<CatalogGame>,
    images: Vec<GameImage>,
    media_collection_id: Option<String>,
}
struct DownloadTask {
    game_index: usize,
    image: CatalogImage,
    path: PathBuf,
    failure: Option<String>,
    done: bool,
}
struct StagedBatch {
    preview: ScanPreview,
    platform: String,
    games: Vec<PreparedGame>,
    tasks: Vec<DownloadTask>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct ImportSummary {
    pub metadata_count: usize,
    pub image_count: usize,
    pub failed_image_count: usize,
}

#[derive(Serialize, Debug)]
pub struct ImageFailure {
    title: String,
    kind: String,
    message: String,
}

#[derive(Serialize, Debug)]
pub struct DownloadReport {
    metadata_count: usize,
    image_count: usize,
    failures: Vec<ImageFailure>,
}

#[derive(Serialize)]
pub struct EditorImageReport {
    images: Vec<GameImage>,
    image_count: usize,
    available_count: usize,
    failures: Vec<ImageFailure>,
}

fn normalize(value: &str) -> String {
    value
        .nfd()
        .filter(|ch| !is_combining_mark(*ch))
        .flat_map(char::to_lowercase)
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn catalog_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=OFF;
         CREATE TABLE catalog_info (downloaded_at TEXT NOT NULL);
         CREATE TABLE platforms (name TEXT PRIMARY KEY);
         CREATE TABLE platform_metadata (name TEXT PRIMARY KEY, release_date TEXT, developer TEXT, manufacturer TEXT);
         CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL, details TEXT NOT NULL);
         CREATE TABLE names (game_id INTEGER NOT NULL, name TEXT NOT NULL, normalized TEXT NOT NULL);
         CREATE TABLE images (game_id INTEGER NOT NULL, filename TEXT NOT NULL, kind TEXT NOT NULL,
           region TEXT NOT NULL, crc TEXT NOT NULL, PRIMARY KEY(game_id,filename));"
    ).map_err(err)?;
    conn.pragma_update(None, "user_version", CATALOG_MEDIA_VERSION).map_err(err)
}

fn catalog_summary(path: &Path) -> Result<CatalogSummary> {
    let conn = open_catalog(path)?;
    let downloaded_at = conn
        .query_row("SELECT downloaded_at FROM catalog_info", [], |r| r.get(0))
        .map_err(err)?;
    let game_count = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get::<_, i64>(0))
        .map_err(err)? as usize;
    let platforms = conn
        .prepare("SELECT name FROM platforms ORDER BY name COLLATE NOCASE")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    Ok(CatalogSummary {
        source: if conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='image_urls')",[],|r|r.get::<_,bool>(0)).unwrap_or(false) { "OpenCabinet-BDD".into() } else { crate::i18n::text("source.personal").into() },
        downloaded_at,
        game_count,
        platforms,
    })
}

type SummaryCache = HashMap<PathBuf, (SystemTime, u64, CatalogSummary)>;
static SUMMARY_CACHE: OnceLock<Mutex<SummaryCache>> = OnceLock::new();

fn cached_catalog_summary(path: &Path) -> Result<CatalogSummary> {
    let metadata = fs::metadata(path).map_err(err)?;
    let modified = metadata.modified().map_err(err)?;
    let mut cache = SUMMARY_CACHE.get_or_init(Mutex::default).lock().map_err(err)?;
    if let Some((stamp, size, summary)) = cache.get(path) {
        if *stamp == modified && *size == metadata.len() { return Ok(summary.clone()); }
    }
    let summary = catalog_summary(path)?;
    cache.insert(path.to_path_buf(), (modified, metadata.len(), summary.clone()));
    Ok(summary)
}

#[tauri::command]
pub async fn preload_metadata_catalog() -> Result<Option<CatalogSummary>> {
    tauri::async_runtime::spawn_blocking(|| {
        let root=super::data_directory().map_err(err)?;
        let path = repository::path(&root,repository::personal(&root));
        recover_catalog(&path)?;
        if !path.exists() { return Ok(None); }
        cached_catalog_summary(&path).map(Some)
    }).await.map_err(err)?
}

fn open_catalog(path: &Path) -> Result<Connection> {
    Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}

#[cfg(test)]
fn catalog_has_current_image_types(path: &Path) -> bool {
    open_catalog(path)
        .and_then(|conn| conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0)).map_err(err))
        .is_ok_and(|version| version >= CATALOG_MEDIA_VERSION)
}

fn recover_catalog(path: &Path) -> Result<()> {
    let previous = path.with_extension("previous.db");
    if !path.exists() && previous.exists() {
        fs::rename(previous, path).map_err(err)?;
    }
    Ok(())
}

fn replace_catalog(staged: &Path, path: &Path) -> Result<()> {
    let previous = path.with_extension("previous.db");
    if previous.exists() {
        fs::remove_file(&previous).map_err(err)?;
    }
    let had_previous = path.exists();
    if had_previous {
        fs::rename(path, &previous).map_err(err)?;
    }
    if let Err(error) = fs::rename(staged, path) {
        if had_previous {
            let _ = fs::rename(&previous, path);
        }
        return Err(crate::i18n::i18n_format!("msg.63cd77f693", error = error));
    }
    if had_previous {
        let _ = fs::remove_file(previous);
    }
    if let Some(cache) = SUMMARY_CACHE.get() { cache.lock().map_err(err)?.remove(path); }
    Ok(())
}

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("OpenCabinet/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(err)
}

fn download(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    limit: u64,
    job: &ImportJob,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<()> {
    job.check()?;
    let outcome = tauri::async_runtime::block_on(async {
        // Register before checking the flag so cancellation wakes every worker,
        // including workers waiting for response headers or a stalled body.
        let cancellation = job.signal.notified();
        tokio::pin!(cancellation);
        cancellation.as_mut().enable();
        job.check()?;
        let mut response = tokio::select! {
            value = client.get(url).timeout(Duration::from_secs(if limit <= MAX_IMAGE_BYTES { 60 } else { 900 })).send() => value.map_err(err)?.error_for_status().map_err(err)?,
            _ = &mut cancellation => return Err(cancelled_message().to_string()),
        };
        job.check()?;
        let total = response.content_length();
        if total.is_some_and(|n| n > limit) {
            return Err(crate::i18n::text("msg.4b0d2e0f9e").into());
        }
        let mut file = File::create(destination).map_err(err)?;
        let mut received = 0;
        let mut last_update = Instant::now();
        progress(0, total);
        loop {
            job.check()?;
            let chunk = tokio::select! {
                value = response.chunk() => value.map_err(err)?,
                _ = &mut cancellation => return Err(cancelled_message().to_string()),
            };
            let Some(chunk) = chunk else {
                break;
            };
            received += chunk.len() as u64;
            if received > limit {
                return Err(crate::i18n::text("msg.4b0d2e0f9e").into());
            }
            file.write_all(&chunk).map_err(err)?;
            if last_update.elapsed() >= Duration::from_millis(100) {
                progress(received, total);
                last_update = Instant::now();
            }
        }
        if total.is_some_and(|n| n != received) {
            return Err(crate::i18n::text("msg.b1d11949cd").into());
        }
        job.check()?;
        file.sync_all().map_err(err)?;
        progress(received, total);
        Ok(())
    });
    if outcome.is_err() {
        let _ = fs::remove_file(destination);
    }
    outcome
}

// Records are small; only one record, not the 500+ MB document, is held in memory.
fn read_records<R: BufRead>(
    input: R,
    job: &ImportJob,
    mut consume: impl FnMut(&str, &HashMap<String, String>) -> Result<()>,
) -> Result<()> {
    let mut reader = Reader::from_reader(input);
    reader.config_mut().expand_empty_elements = true;
    let mut buffer = Vec::new();
    let mut depth = 0usize;
    let mut tag = String::new();
    let mut field = String::new();
    let mut fields = HashMap::<String, String>::new();
    let mut records = 0usize;
    let mut root_seen = false;
    loop {
        match reader.read_event_into(&mut buffer).map_err(|_|crate::i18n::text("source.archive.invalid").to_string())? {
            Event::Start(element) => {
                depth += 1;
                let name = String::from_utf8_lossy(element.name().as_ref()).into_owned();
                if depth == 1 {
                    if root_seen || (name != "Metadata" && name != crate::catalog_compat::XML_ROOT) {
                        return Err(crate::i18n::text("msg.25b0e970d8").into());
                    }
                    root_seen = true;
                } else if depth == 2 {
                    tag = name;
                    fields.clear();
                } else if depth == 3 {
                    field = name;
                    fields.entry(field.clone()).or_default();
                }
            }
            Event::Text(text) if depth == 3 => {
                let text = text.xml_content().map_err(err)?;
                fields.entry(field.clone()).or_default().push_str(&text);
            }
            Event::CData(text) if depth == 3 => {
                fields
                    .entry(field.clone())
                    .or_default()
                    .push_str(&text.decode().map_err(err)?);
            }
            Event::GeneralRef(reference) if depth == 3 => {
                let name = reference.decode().map_err(err)?;
                let character = match name.as_ref() {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "apos" => '\'',
                    "quot" => '"',
                    name => {
                        let value = if let Some(hex) = name.strip_prefix("#x") {
                            u32::from_str_radix(hex, 16).ok()
                        } else {
                            name.strip_prefix('#').and_then(|n| n.parse::<u32>().ok())
                        };
                        value
                            .and_then(char::from_u32)
                            .ok_or(crate::i18n::text("source.archive.entity"))?
                    }
                };
                fields.entry(field.clone()).or_default().push(character);
            }
            Event::End(_) => {
                if depth == 2 {
                    job.check()?;
                    consume(&tag, &fields)?;
                    records += 1;
                }
                depth = depth.checked_sub(1).ok_or(crate::i18n::text("source.archive.incomplete"))?;
            }
            Event::DocType(_) => {
                return Err(crate::i18n::text("source.archive.entities").into());
            }
            Event::Eof => break,
            _ => (),
        }
        if reader.buffer_position() > MAX_XML_BYTES {
            return Err(crate::i18n::text("source.archive.too_large").into());
        }
        buffer.clear();
    }
    if !root_seen || depth != 0 || records == 0 {
        return Err(crate::i18n::text("source.archive.empty").into());
    }
    job.check()?;
    Ok(())
}

fn nonempty(fields: &HashMap<String, String>, field: &str) -> Option<String> {
    fields
        .get(field)
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn image_kind(kind: &str) -> &'static str {
    if let Some((_, key)) = GAME_IMAGE_TYPES.iter().find(|(source, _)| *source == kind) {
        return key;
    }
    match kind {
        value
            if value.starts_with("Fanart")
                || value.contains("Artwork")
                || value == "Background" =>
        {
            "artwork"
        }
        _ => "other",
    }
}

fn safe_image_name(filename: &str) -> bool {
    !filename.is_empty()
        && !filename.starts_with('.')
        && !filename.contains("..")
        && filename
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || "-_.".contains(ch))
        && Path::new(filename)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| {
                ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"]
                    .contains(&ext.to_ascii_lowercase().as_str())
            })
}

fn insert_record(conn: &Connection, tag: &str, fields: &HashMap<String, String>) -> Result<()> {
    let id = fields
        .get("DatabaseID")
        .and_then(|id| id.parse::<i64>().ok())
        .filter(|id| *id > 0);
    match tag {
        "Game" => {
            let (Some(id), Some(title), Some(platform)) =
                (id, nonempty(fields, "Name"), nonempty(fields, "Platform"))
            else {
                return Ok(());
            };
            let game = CatalogGame {
                id,
                title,
                platform,
                release_date: nonempty(fields, "ReleaseDate")
                    .and_then(|s| s.get(..10).map(str::to_owned))
                    .filter(|s| super::valid_release_date(s)),
                developer: nonempty(fields, "Developer"),
                publisher: nonempty(fields, "Publisher"),
                genre: nonempty(fields, "Genres"),
                description: nonempty(fields, "Overview"),
                max_players: fields
                    .get("MaxPlayers")
                    .and_then(|s| s.parse().ok())
                    .filter(|n| *n > 0),
                game_mode: fields
                    .get("Cooperative")
                    .filter(|s| s.eq_ignore_ascii_case("true"))
                    .map(|_| "Cooperativo".into()),
            };
            conn.prepare_cached("INSERT INTO games VALUES (?1,?2,?3,?4)")
                .map_err(err)?
                .execute(params![
                    id,
                    game.title,
                    game.platform,
                    serde_json::to_string(&game).map_err(err)?
                ])
                .map_err(err)?;
            conn.prepare_cached("INSERT OR IGNORE INTO platforms VALUES (?1)")
                .map_err(err)?
                .execute([&game.platform])
                .map_err(err)?;
            conn.prepare_cached("INSERT INTO names VALUES (?1,?2,?3)")
                .map_err(err)?
                .execute(params![id, game.title, normalize(&game.title)])
                .map_err(err)?;
        }
        "GameAlternateName" => {
            if let (Some(id), Some(name)) = (id, nonempty(fields, "AlternateName")) {
                conn.prepare_cached("INSERT INTO names VALUES (?1,?2,?3)")
                    .map_err(err)?
                    .execute(params![id, name, normalize(&name)])
                    .map_err(err)?;
            }
        }
        "GameImage" => {
            if let (Some(id), Some(filename), Some(kind)) =
                (id, nonempty(fields, "FileName"), nonempty(fields, "Type"))
            {
                if safe_image_name(&filename) {
                    conn.prepare_cached("INSERT OR IGNORE INTO images VALUES (?1,?2,?3,?4,?5)")
                        .map_err(err)?
                        .execute(params![
                            id,
                            filename,
                            image_kind(&kind),
                            nonempty(fields, "Region").unwrap_or_default(),
                            nonempty(fields, "CRC32").unwrap_or_default()
                        ])
                        .map_err(err)?;
                }
            }
        }
        "Platform" => {
            if let Some(name) = nonempty(fields, "Name") {
                conn.prepare_cached("INSERT OR IGNORE INTO platforms VALUES (?1)")
                    .map_err(err)?
                    .execute([&name])
                    .map_err(err)?;
                let date = nonempty(fields, "ReleaseDate")
                    .and_then(|value| value.get(..10).map(str::to_owned))
                    .filter(|value| super::valid_release_date(value));
                conn.prepare_cached("INSERT INTO platform_metadata(name,release_date,developer,manufacturer) VALUES (?1,?2,?3,?4)
                    ON CONFLICT(name) DO UPDATE SET release_date=COALESCE(excluded.release_date,platform_metadata.release_date),
                    developer=COALESCE(excluded.developer,platform_metadata.developer),manufacturer=COALESCE(excluded.manufacturer,platform_metadata.manufacturer)")
                    .map_err(err)?.execute(params![name, date, nonempty(fields,"Developer"), nonempty(fields,"Manufacturer")]).map_err(err)?;
            }
        }
        _ => (),
    }
    Ok(())
}

fn build_catalog(
    zip_path: &Path,
    output: &Path,
    job: &ImportJob,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    let mut zip = zip::ZipArchive::new(File::open(zip_path).map_err(err)?).map_err(|_|crate::i18n::text("source.archive.invalid").to_string())?;
    let mut conn = Connection::open(output).map_err(err)?;
    catalog_schema(&conn)?;
    let tx = conn.transaction().map_err(err)?;
    let mut count = 0u64;
    for name in ["Metadata.xml", "Platforms.xml"] {
        job.check()?;
        let input = zip
            .by_name(name)
            .map_err(|_| crate::i18n::text("source.archive.invalid").to_string())?;
        if input.size() > MAX_XML_BYTES {
            return Err(crate::i18n::text("source.archive.too_large").into());
        }
        let total = input.size();
        let mut last_update = Instant::now();
        progress(job.progress("reading", count, None, None));
        read_records(
            BufReader::new(input.take(MAX_XML_BYTES + 1)),
            job,
            |tag, fields| {
                insert_record(&tx, tag, fields)?;
                count += 1;
                if last_update.elapsed() >= Duration::from_millis(100) {
                    progress(job.progress(
                        "reading",
                        count,
                        None,
                        None,
                    ));
                    last_update = Instant::now();
                }
                Ok(())
            },
        )?;
        progress(job.progress("reading", count, None, None));
        if total == 0 {
            return Err(crate::i18n::text("source.archive.empty").into());
        }
    }
    job.check()?;
    progress(job.progress(
        "indexing",
        0,
        None,
        None,
    ));
    // SQLite also checks cancellation while building large indexes.
    tx.progress_handler(
        2000,
        Some({
            let cancelled = job.cancelled.clone();
            move || cancelled.load(Ordering::Acquire)
        }),
    )
    .map_err(err)?;
    tx.execute_batch(
        "CREATE INDEX idx_names_normalized ON names(normalized);
         CREATE INDEX idx_games_platform ON games(platform);
         CREATE INDEX idx_images_game ON images(game_id);
         CREATE VIRTUAL TABLE names_fts USING fts5(name, content='names', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
         INSERT INTO names_fts(names_fts) VALUES ('rebuild');
         INSERT INTO catalog_info VALUES (strftime('%Y-%m-%dT%H:%M:%SZ','now'));"
    ).map_err(err)?;
    tx.progress_handler(0, None::<fn() -> bool>).map_err(err)?;
    let games: i64 = tx
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .map_err(err)?;
    if games == 0 {
        return Err(crate::i18n::text("source.archive.empty").into());
    }
    job.check()?;
    tx.commit().map_err(err)?;
    drop(conn);
    fs::OpenOptions::new()
        .write(true)
        .open(output)
        .map_err(err)?
        .sync_all()
        .map_err(err)?;
    Ok(())
}

fn search_catalog(conn: &Connection, query: &str, platform: &str) -> Result<Vec<SearchResult>> {
    search_catalog_scope(conn, query, Some(platform))
}

// SQLite must observe cancellation while preparing the platform index or
// executing a single query, not only between games. A stalled query is an
// explicit error, never an invented "no matches" result.
fn catalog_search_operation<T>(
    conn: &Connection,
    job: &ImportJob,
    budget: Duration,
    mut heartbeat: impl FnMut() + Send + 'static,
    operation: impl FnOnce() -> Result<T>,
) -> Result<T> {
    job.check()?;
    let cancelled = job.cancelled.clone();
    let started = Instant::now();
    let expired = Arc::new(AtomicBool::new(false));
    let timed_out = expired.clone();
    let mut last_update = Instant::now();
    conn.progress_handler(10_000, Some(move || {
        if last_update.elapsed() >= Duration::from_millis(200) {
            heartbeat();
            last_update = Instant::now();
        }
        let timeout = started.elapsed() >= budget;
        timed_out.store(timeout, Ordering::Relaxed);
        cancelled.load(Ordering::Acquire) || timeout
    })).map_err(err)?;
    let result = operation();
    conn.progress_handler(0, None::<fn() -> bool>).map_err(err)?;
    job.check()?;
    if expired.load(Ordering::Relaxed) {
        return Err(crate::i18n::text("metadata.search_timeout").into());
    }
    result
}

fn prepare_platform_search(conn: &Connection, platform: &str) -> Result<()> {
    let ready: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_temp_master WHERE name='platform_search_scope')",
        [], |row| row.get(0),
    ).map_err(err)?;
    if ready {
        let current: Option<String> = conn.query_row("SELECT platform FROM temp.platform_search_scope", [], |row| row.get(0)).optional().map_err(err)?;
        if current.as_deref() == Some(platform) { return Ok(()); }
    } else {
        conn.execute_batch("PRAGMA temp_store=MEMORY;").map_err(err)?;
    }
    // The main catalog stays read-only. Build this small in-memory index once
    // per connection/platform, only when an exact indexed lookup has failed.
    // Negative searches no longer rank thousands of games on other consoles.
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.platform_names;
         DROP TABLE IF EXISTS temp.platform_search_scope;
         CREATE TEMP TABLE platform_search_scope(platform TEXT NOT NULL);
         CREATE VIRTUAL TABLE temp.platform_names USING fts5(name, game_id UNINDEXED, tokenize='unicode61 remove_diacritics 2');"
    ).map_err(err)?;
    // Materialize IDs using the small covering platform index. Scan names
    // exactly once, without fetching every game's large JSON record or letting
    // SQLite choose a full names scan for each game on a large platform.
    conn.execute(
        "INSERT INTO temp.platform_names(name,game_id)
         SELECT name,game_id FROM names
         WHERE game_id IN (SELECT id FROM games WHERE platform=?1)",
        [platform],
    ).map_err(err)?;
    conn.execute("INSERT INTO temp.platform_search_scope VALUES (?1)", [platform]).map_err(err)?;
    Ok(())
}

fn exact_catalog_matches(
    conn: &Connection,
    query: &str,
    platform: Option<&str>,
) -> Result<Vec<SearchResult>> {
    let normalized = normalize(query);
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = Vec::new();
    let limit = if platform.is_some() { 21 } else { 100 };
    let mut exact = conn
        .prepare(
            "SELECT DISTINCT g.details FROM names n JOIN games g ON g.id=n.game_id
         WHERE n.normalized=?1 AND (?2 IS NULL OR g.platform=?2) ORDER BY g.platform, g.id LIMIT ?3",
        )
        .map_err(err)?;
    for json in exact
        .query_map(params![normalized, platform, limit], |r| {
            r.get::<_, String>(0)
        })
        .map_err(err)?
    {
        let game = repository_metadata::read_game(&json.map_err(err)?)?;
        results.push(SearchResult { game, exact: true, source_key: None });
    }
    repository::finish_search_results(conn, results)
}

fn search_catalog_scope(
    conn: &Connection,
    query: &str,
    platform: Option<&str>,
) -> Result<Vec<SearchResult>> {
    let mut results = exact_catalog_matches(conn, query, platform)?;
    // Most imports match exactly. Avoid a broad full-text search for every
    // already identified game; alternative titles can still be searched manually.
    if !results.is_empty() {
        return Ok(results);
    }
    let normalized = normalize(query);
    if normalized.is_empty() { return Ok(results); }
    let mut seen = HashSet::new();
    let limit = if platform.is_some() { 21 } else { 100 };
    let words = normalized
        .split_whitespace()
        .take(20)
        .map(|word| format!("\"{word}\"*"))
        .collect::<Vec<_>>();
    let sql = if let Some(platform) = platform {
        prepare_platform_search(conn, platform)?;
        "SELECT g.id,g.details FROM temp.platform_names f JOIN games g ON g.id=f.game_id
         WHERE platform_names MATCH ?1 ORDER BY f.rank LIMIT ?2"
    } else {
        "SELECT g.id,g.details FROM names_fts f JOIN names n ON n.rowid=f.rowid JOIN games g ON g.id=n.game_id
         WHERE names_fts MATCH ?1 ORDER BY f.rank LIMIT ?2"
    };
    // rank exposes the same default BM25 relevance but lets FTS5 stop at LIMIT
    // instead of sorting/materializing all matching descriptions first.
    let mut similar = conn.prepare(sql).map_err(err)?;
    for operator in [" AND ", " OR "] {
        let expression = words.join(operator);
        for entry in similar
            .query_map(params![expression, limit * 5], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(err)?
        {
            if results.len() >= limit as usize {
                break;
            }
            let (id, json) = entry.map_err(err)?;
            if seen.insert(id) {
                let game = repository_metadata::read_game(&json)?;
                results.push(SearchResult { game, exact: false, source_key: None });
            }
        }
        if !results.is_empty() {
            break;
        }
    }
    repository::finish_search_results(conn, results)
}

pub(super) fn rom_regions(path: &str) -> Vec<&'static str> {
    let name = Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_ascii_lowercase();
    let mut regions = Vec::new();
    for (tag, region) in [
        ("usa", "North America"),
        ("north america", "North America"),
        ("europe", "Europe"),
        ("japan", "Japan"),
        ("world", "World"),
        ("spain", "Spain"),
        ("france", "France"),
        ("germany", "Germany"),
        ("brazil", "Brazil"),
        ("korea", "Korea"),
    ] {
        if name
            .split(['(', ')', '[', ']', ','])
            .any(|part| part.trim() == tag)
        {
            regions.push(region);
        }
    }
    regions
}

fn select_images(
    mut images: Vec<CatalogImage>,
    options: &MediaOptions,
    rom_path: &str,
) -> Vec<CatalogImage> {
    let mut regions = rom_regions(rom_path);
    for region in ["World", "North America", "Europe", "Japan", ""] {
        if !regions.contains(&region) {
            regions.push(region);
        }
    }
    images.sort_by(|a, b| {
        let rank = |image: &CatalogImage| {
            regions
                .iter()
                .position(|r| r.eq_ignore_ascii_case(&image.region))
                .unwrap_or(regions.len())
        };
        rank(a).cmp(&rank(b)).then(a.filename.cmp(&b.filename))
    });
    let mut selected = Vec::new();
    let mut used = HashSet::new();
    for (kind, count) in options.entries() {
        let mut added = 0;
        for image in &images {
            if added >= count {
                break;
            }
            if image.kind != kind || !safe_image_name(&image.filename) {
                continue;
            }
            let key = if image.crc.is_empty() || image.crc == "0" {
                image.filename.clone()
            } else {
                image.crc.clone()
            };
            if used.insert(key) {
                selected.push(image.clone());
                added += 1;
            }
        }
    }
    selected
}

fn prepare_batch(
    conn: &Connection,
    catalog: &Connection,
    job: &ImportJob,
    mut preview: ScanPreview,
    platform: String,
    source_platform: &str,
    selections: Vec<MatchSelection>,
    options: &MediaOptions,
) -> Result<StagedBatch> {
    options.validate()?;
    if platform.trim().is_empty() {
        return Err(crate::i18n::text("msg.c7fc12e333").into());
    }
    let platform_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM platforms WHERE name=?1)",
            [&platform],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !platform_exists {
        return Err(crate::i18n::text("msg.909d5e7c5b").into());
    }
    let mut chosen = HashMap::new();
    let paths: HashSet<_> = preview.games.iter().map(|g| g.rom_path.as_str()).collect();
    for selection in selections {
        if !paths.contains(selection.rom_path.as_str())
            || chosen.insert(selection.rom_path, selection.id).is_some()
        {
            return Err(crate::i18n::text("msg.711a7426ba").into());
        }
    }
    let mut games = Vec::new();
    let mut tasks = Vec::new();
    let mut seen = HashSet::new();
    for candidate in &mut preview.games {
        job.check()?;
        candidate.title = candidate.title.trim().to_string();
        if candidate.title.is_empty() {
            return Err(crate::i18n::text("msg.40d5fb252e").into());
        }
        if candidate.steam.is_none() && candidate.epic.is_none() && !Path::new(&candidate.rom_path).is_file() {
            return Err(crate::i18n::i18n_format!(
                "msg.bed363ddf6",
                candidate.rom_path
            ));
        }
        super::candidate_launch_mode(candidate, &platform)?;
        let existing: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM games WHERE rom_path=?1)",
                [&candidate.rom_path],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut prepared = PreparedGame {
            candidate: candidate.clone(),
            metadata: None,
            images: Vec::new(),
            media_collection_id: None,
        };
        if !existing && candidate.existing_game_id.is_none() && seen.insert(candidate.rom_path.clone()) {
            if let Some(Some(id)) = chosen.get(&candidate.rom_path) {
                let json: String = catalog.query_row("SELECT details FROM games WHERE id=?1 AND platform=?2",
                    params![id, source_platform], |r| r.get(0)).optional().map_err(err)?
                    .ok_or(crate::i18n::text("msg.d813f346bd"))?;
                prepared.metadata = Some(repository_metadata::read_game(&json)?);
                let images = catalog
                    .prepare("SELECT filename,kind,region,crc FROM images WHERE game_id=?1")
                    .map_err(err)?
                    .query_map([id], |r| {
                        Ok(CatalogImage {
                            filename: r.get(0)?,
                            kind: r.get(1)?,
                            region: r.get(2)?,
                            crc: r.get(3)?,
                        })
                    })
                    .map_err(err)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(err)?;
                for image in select_images(images, options, &candidate.rom_path) {
                    let path = job
                        .directory
                        .join(format!("{}-{}", games.len(), image.filename));
                    tasks.push(DownloadTask {
                        game_index: games.len(),
                        image,
                        path,
                        failure: None,
                        done: false,
                    });
                }
            }
        }
        games.push(prepared);
    }
    Ok(StagedBatch {
        preview,
        platform,
        games,
        tasks,
    })
}

fn download_batch(
    batch: &mut StagedBatch,
    job: &ImportJob,
    image_base: &str,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<DownloadReport> {
    let client = http_client()?;
    let total = batch.tasks.len() as u64;
    job.check()?;
    let pending: Vec<_> = batch
        .tasks
        .iter()
        .enumerate()
        .filter(|(_, task)| !task.done)
        .map(|(index, task)| (index, task.image.filename.clone(), task.path.clone()))
        .collect();
    let cursor = AtomicUsize::new(0);
    let mut processed = total - pending.len() as u64;
    progress(job.progress("images", processed, Some(total), None));
    std::thread::scope(|scope| {
        let (sender, receiver) = std::sync::mpsc::channel();
        for _ in 0..IMAGE_DOWNLOAD_WORKERS.min(pending.len()) {
            let sender = sender.clone();
            let (pending, cursor, client) = (&pending, &cursor, &client);
            scope.spawn(move || loop {
                if job.check().is_err() {
                    break;
                }
                let Some((index, filename, path)) =
                    pending.get(cursor.fetch_add(1, Ordering::Relaxed))
                else {
                    break;
                };
                let result = download(
                    client,
                    &match repository::image_url(job,image_base,filename) {Ok(url)=>url,Err(error)=>{let _=sender.send((*index,Err(error)));continue;}},
                    path,
                    MAX_IMAGE_BYTES,
                    job,
                    |_, _| (),
                )
                .and_then(|_| super::image_extension(path).map(|_| ()));
                if sender.send((*index, result)).is_err() {
                    break;
                }
            });
        }
        drop(sender);
        for (index, result) in receiver {
            let task = &mut batch.tasks[index];
            match result {
                Ok(()) => {
                    task.done = true;
                    task.failure = None;
                }
                Err(message) => {
                    task.failure = Some(message);
                    let _ = fs::remove_file(&task.path);
                }
            }
            processed += 1;
            if job.check().is_ok() {
                let title = batch.games[task.game_index].candidate.title.clone();
                progress(job.progress("images", processed, Some(total), Some(title)));
            }
        }
    }); // All workers have stopped before cancellation can clean up staging files.
    job.check()?;
    // Completion order must not change the carousel order, including on retries.
    for game in &mut batch.games {
        game.images.clear();
    }
    for task in batch.tasks.iter().filter(|task| task.done) {
        batch.games[task.game_index].images.push(GameImage {
            path: task.path.to_string_lossy().into_owned(),
            kind: task.image.kind.clone(),
        });
    }
    Ok(download_report(batch))
}

fn download_report(batch: &StagedBatch) -> DownloadReport {
    DownloadReport {
        metadata_count: batch.games.iter().filter(|g| g.metadata.is_some()).count(),
        image_count: batch.tasks.iter().filter(|t| t.done).count(),
        failures: batch
            .tasks
            .iter()
            .filter_map(|task| {
                task.failure.as_ref().map(|message| ImageFailure {
                    title: batch.games[task.game_index].candidate.title.clone(),
                    kind: task.image.kind.clone(),
                    message: message.clone(),
                })
            })
            .collect(),
    }
}

pub(super) fn commit_import(
    conn: &mut Connection,
    job: &ImportJob,
    mut preview: ScanPreview,
    platform: &str,
    mut progress: impl FnMut(ScanProgress),
) -> Result<ScanResult> {
    crate::media_library::init_schema(conn)?;
    crate::discs::init(conn).map_err(err)?;
    let _busy = job.enter()?;
    let mut staged = job.staged.lock().map_err(err)?;
    let batch = staged
        .as_ref()
        .ok_or(crate::i18n::text("msg.5ed1d97f6b"))?;
    for candidate in &mut preview.games {
        candidate.title = candidate.title.trim().to_owned();
    }
    if batch.preview != preview || batch.platform != platform {
        return Err(crate::i18n::text("msg.bc6a40e930").into());
    }
    let total = batch.games.len();
    let file_count = batch.games.iter().map(|g|g.candidate.discs.len().max(1)).sum::<usize>();
    let mut added_count = 0;
    let mut attached_count = 0;
    let mut skipped_count = preview.skipped_count;
    let mut summary = ImportSummary::default();
    let mut failures_per_game = vec![0; total];
    for task in &batch.tasks {
        if task.failure.is_some() {
            failures_per_game[task.game_index] += 1;
        }
    }
    let mut last_update = Instant::now();
    let mut copied = super::PendingImageCopies(Vec::new());
    let tx = conn.transaction().map_err(err)?;
    for (index, game) in batch.games.iter().enumerate() {
        job.check()?;
        let candidate = &game.candidate;
        if candidate.steam.is_none() && candidate.epic.is_none() && !Path::new(&candidate.rom_path).is_file() {
            return Err(crate::i18n::i18n_format!(
                "msg.bed363ddf6",
                candidate.rom_path
            ));
        }
        if let Some(id)=crate::discs::attach_candidate(&tx,candidate,platform)? {
            crate::media_library::sync_game(&tx,&job.root,id,&mut copied)?;
            attached_count += 1; continue;
        }
        let sources=crate::discs::candidate_discs(candidate);
        let direct = super::candidate_launch_mode(candidate, platform)?;
        if !direct { crate::discs::validate_sources(&sources,true)?; }
        let mut duplicate=false;
        for disc in &sources { if crate::discs::owner(&tx,&disc.rom_path)?.is_some(){duplicate=true;} }
        if duplicate { skipped_count+=1; continue; }

        let inserted = tx.execute(
            "INSERT INTO games (title,platform,rom_path,play_time,launch_directly,steam_client_path,epic_client_path,epic_manifest_path) VALUES (?1,?2,?3,0,?4,?5,?6,?7) ON CONFLICT(rom_path) DO NOTHING",
            params![candidate.title, platform, candidate.rom_path, direct, candidate.steam.as_ref().map(|source| &source.client_path), candidate.epic.as_ref().map(|source| &source.client_path), candidate.epic.as_ref().map(|source| &source.manifest_path)]).map_err(err)?;
        if inserted == 0 {
            skipped_count += 1;
            continue;
        }
        added_count += 1;
        let id = tx.last_insert_rowid();
        if !direct { crate::discs::replace(&tx,id,&sources)?; }
        if let Some(data) = &game.metadata {
            repository::record_match(&tx,id,data.id)?;
            tx.execute("UPDATE games SET release_date=?2,developer=?3,publisher=?4,genre=?5,
                game_mode=?6,max_players=?7,description=?8 WHERE id=?9",
                params![data.id, data.release_date, data.developer, data.publisher, data.genre,
                    data.game_mode, data.max_players, data.description, id]).map_err(err)?;
            summary.metadata_count += 1;
        }
        if let Some(collection) = &game.media_collection_id {
            summary.image_count += crate::media_library::attach(&tx,&job.root,id,collection)?;
        }
        super::validate_game_images(&game.images)?;
        let collection_dir = if game.images.is_empty() { String::new() }
            else { crate::media_library::ensure_game(&tx,&job.root,id)?.1 };
        for (position, image) in game.images.iter().enumerate() {
            job.check()?;
            let extension = super::image_extension(Path::new(&image.path))?;
            let relative = format!("{collection_dir}/catalog-{}-{position}.{extension}", job.id);
            let destination = job.root.join(&relative);
            fs::create_dir_all(destination.parent().unwrap()).map_err(err)?;
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(err)?;
            copied.0.push(destination);
            let mut input = File::open(&image.path).map_err(err)?;
            std::io::copy(&mut input, &mut output).map_err(err)?;
            output.sync_all().map_err(err)?;
            tx.execute(
                "INSERT INTO game_images(game_id,path,kind,position) VALUES (?1,?2,?3,?4)",
                params![id, relative, image.kind, position as i64],
            )
            .map_err(err)?;
            if image.kind == "cover" {
                tx.execute(
                    "UPDATE games SET cover_path=?1 WHERE id=?2 AND cover_path IS NULL",
                    params![relative, id],
                )
                .map_err(err)?;
            }
            summary.image_count += 1;
        }
        crate::media_library::sync_game(&tx,&job.root,id,&mut copied)?;
        summary.failed_image_count += failures_per_game[index];
        if last_update.elapsed() >= Duration::from_millis(100) || index + 1 == total {
            progress(ScanProgress {
                phase: "importing",
                processed: index + 1,
                total: Some(total),
                added_count,
                skipped_count,
                current_file: Some(candidate.title.clone()),
            });
            last_update = Instant::now();
        }
    }
    if added_count > 0 { platforms::commit_auto(&tx, job, &mut copied, &mut summary)?; }
    let mut committed = job.commit_gate.lock().map_err(err)?;
    job.check()?;
    tx.commit().map_err(err)?;
    *committed = true;
    copied.0.clear();
    crate::media_library::flush_logged(conn,&job.root);
    *staged = None;
    progress(ScanProgress {
        phase: "done",
        processed: total,
        total: Some(total),
        added_count,
        skipped_count,
        current_file: None,
    });
    Ok(ScanResult {
        attached_count,
        added_count,
        skipped_count,
        total_found: file_count + preview.skipped_count,
        enrichment: Some(summary),
    })
}

#[tauri::command]
pub async fn start_metadata_import(
    platform: String,
    game_id: Option<i32>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<ImportSession> {
    let jobs = jobs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = super::data_directory().map_err(err)?;
        let conn = super::get_db_connection().map_err(err)?;
        let local=repository::personal(&root);
        let mut source_platform=repository::platform_mapping(&conn,&platform,local);
        let source_id = game_id.and_then(|id|repository::match_id(&conn,id as i64,local));
        let path = repository::path(&root,local);
        recover_catalog(&path)?;
        let catalog = cached_catalog_summary(&path).ok();
        if let Some(id) = source_id {
            if catalog.is_some() {
                // A game-specific choice can come from the title-only search;
                // prefer its actual source platform to a general console mapping.
                source_platform = open_catalog(&path)?
                    .query_row("SELECT platform FROM games WHERE id=?1", [id], |r| {
                        r.get::<_, String>(0)
                    })
                    .optional()
                    .map_err(err)?
                    .or(source_platform);
            }
        }
        let job = jobs.start(root)?;
        *job.platform_hint.lock().map_err(err)?=Some(platform.clone());
        if !local&&catalog.is_some(){source_platform=source_platform.filter(|p|catalog.as_ref().is_some_and(|c|c.platforms.contains(p))).or(repository::equivalent_platform(&job,&platform)?);}
        Ok(ImportSession {
            job_id: job.id.clone(),
            catalog,
            source_platform,
            source_id,
        })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn prepare_metadata_catalog(
    job_id: String,
    refresh: bool,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<CatalogSummary> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        repository::prepare(&job, refresh, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
fn prepare_catalog(
    job: &ImportJob,
    refresh: bool,
    url: &str,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<CatalogSummary> {
    job.check()?;
    let path = job.catalog_path();
    recover_catalog(&path)?;
    if !refresh && catalog_has_current_image_types(&path) {
        if let Ok(summary) = catalog_summary(&path) {
            return Ok(summary);
        }
    }
    let zip_path = job.directory.join("Metadata.zip");
    let temporary = job.directory.join("catalog.new.db");
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(err)?;
    }
    download(&http_client()?, url, &zip_path, MAX_CATALOG_BYTES, job, |processed, total| {
        progress(job.progress("catalog", processed, total, None));
    })?;
    build_catalog(&zip_path, &temporary, job, &mut progress)?;
    job.check()?;
    // All SQLite handles are closed before replacing the file on Windows.
    let summary = catalog_summary(&temporary)?;
    replace_catalog(&temporary, &path)?;
    let _ = fs::remove_file(zip_path);
    Ok(summary)
}

#[tauri::command]
pub async fn match_metadata_games(
    job_id: String,
    preview: ScanPreview,
    platform: String,
    source_platform: String,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<Vec<MatchRow>> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        let total = preview.games.len() as u64;
        repository::ensure_platform(&job,&source_platform,|progress|{let _=on_progress.send(progress);})?;
        let _ = on_progress.send(job.progress("matching", 0, Some(total), Some(crate::i18n::text("msg.9962f80e9d").into())));
        let catalog = open_catalog(&job.catalog_path())?;
        let exists: bool = catalog
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM platforms WHERE name=?1)",
                [&source_platform],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err(crate::i18n::text("msg.92fb29c7fd").into());
        }
        let conn = super::get_db_connection().map_err(err)?;
        repository::record_platform(&conn,&platform,&source_platform,job.personal_catalog)?;
        let mut rows = Vec::new();
        let mut last_update = Instant::now();
        for (index, candidate) in preview.games.into_iter().enumerate() {
            job.check()?;
            if index == 0 || last_update.elapsed() >= Duration::from_millis(100) {
                let _ = on_progress.send(job.progress("matching", index as u64, Some(total), Some(candidate.title.clone())));
                last_update = Instant::now();
            }
            let candidates = if candidate.existing_game_id.is_some() { Vec::new() } else {
                let channel = on_progress.clone();
                let progress_job = job.clone();
                let title = candidate.title.clone();
                catalog_search_operation(&catalog, &job, Duration::from_secs(20), move || {
                    let _ = channel.send(progress_job.progress("matching", index as u64, Some(total), Some(title.clone())));
                }, || repository::search_candidate(&catalog, &candidate.title, &source_platform, &candidate.rom_path))?
            };
            let exact: Vec<_> = candidates.iter().filter(|g| g.exact).collect();
            let selected_id = if exact.len() == 1 {
                Some(exact[0].game.id)
            } else {
                repository::regional_match(&catalog,&candidates,&candidate.rom_path)?
            };
            rows.push(MatchRow {
                rom_path: candidate.rom_path,
                candidates,
                selected_id,
            });
            if last_update.elapsed() >= Duration::from_millis(100) || index as u64 + 1 == total {
                let _ = on_progress.send(job.progress(
                    "matching",
                    index as u64 + 1,
                    Some(total),
                    Some(candidate.title),
                ));
                last_update = Instant::now();
            }
        }
        Ok(rows)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn search_metadata_games(
    job_id: String,
    query: String,
    source_platform: Option<String>,
    preferred_id: Option<i64>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<Vec<SearchResult>> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        repository::ensure_hint(&job,source_platform.as_deref(),|_|())?;
        let conn = open_catalog(&job.catalog_path())?;
        let preferred = preferred_id
            .map(|id| {
                conn.query_row(
                    "SELECT details FROM games WHERE id=?1 AND (?2 IS NULL OR platform=?2)",
                    params![id, source_platform],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(err)
            })
            .transpose()?
            .flatten();
        let result = if let Some(json) = preferred {
            repository::finish_search_results(&conn, vec![SearchResult {
                game: repository_metadata::read_game(&json)?,
                exact: true,
                source_key: None,
            }])?
        } else {
            catalog_search_operation(&conn, &job, Duration::from_secs(20), || (), || {
                search_catalog_scope(&conn, &query, source_platform.as_deref())
            })?
        };
        job.check()?;
        Ok(result)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn stage_metadata_import(
    job_id: String,
    preview: ScanPreview,
    platform: String,
    source_platform: String,
    selections: Vec<MatchSelection>,
    media_selections: Option<Vec<crate::media_library::RecoverySelection>>,
    options: MediaOptions,
    use_catalog_titles: Option<bool>,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<DownloadReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        if job.staged.lock().map_err(err)?.is_some() {
            return Err(crate::i18n::text("msg.91b228ad15").into());
        }
        options.validate()?;
        if options.entries().iter().any(|(_, count)| *count > 0) {
            repository::prepare(&job, false, |progress| {
                let _ = on_progress.send(progress);
            })?;
        }
        let conn = super::get_db_connection().map_err(err)?;
        let catalog = open_catalog(&job.catalog_path())?;
        let mut batch = prepare_batch(
            &conn,
            &catalog,
            &job,
            preview,
            platform,
            &source_platform,
            selections,
            &options,
        )?;
        apply_catalog_titles(&mut batch, use_catalog_titles.unwrap_or(true));
        apply_media_recovery(&mut batch,&conn,&job.root,&media_selections.unwrap_or_default())?;
        let platform_import = platforms::prepare_auto(&conn, &batch.platform, &source_platform)?;
        drop(conn);
        drop(catalog);
        let mut report = download_batch(&mut batch, &job, IMAGE_BASE, |progress| {
            let _ = on_progress.send(progress);
        })?;
        *job.platform_import.lock().map_err(err)? = platform_import;
        platforms::download_auto(&job, &mut report, |progress| { let _ = on_progress.send(progress); })?;
        job.check()?;
        *job.staged.lock().map_err(err)? = Some(batch);
        Ok(report)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn retry_metadata_images(
    job_id: String,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<DownloadReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        let mut batch = job
            .staged
            .lock()
            .map_err(err)?
            .take()
            .ok_or(crate::i18n::text("msg.10a5eecfbc"))?;
        let result = download_batch(&mut batch, &job, IMAGE_BASE, |progress| {
            let _ = on_progress.send(progress);
        });
        *job.staged.lock().map_err(err)? = Some(batch);
        let mut report = result?;
        platforms::download_auto(&job, &mut report, |progress| { let _ = on_progress.send(progress); })?;
        Ok(report)
    })
    .await
    .map_err(err)?
}

fn apply_catalog_titles(batch: &mut StagedBatch, enabled: bool) {
    if !enabled { return; }
    for game in &mut batch.games {
        if let Some(title) = game.metadata.as_ref().map(|data| data.title.trim()).filter(|title| !title.is_empty()) {
            game.candidate.title = title.to_owned();
        }
    }
}

fn apply_media_recovery(batch: &mut StagedBatch, conn: &Connection, root: &Path, selections: &[crate::media_library::RecoverySelection]) -> Result<()> {
    crate::media_library::validate_selections(&batch.preview,selections)?;
    let mut recovered_images = std::collections::HashSet::new();
    for game in &mut batch.games {
        if let Some(id)=crate::media_library::selection_for(selections,&game.candidate.rom_path) {
            if !crate::media_library::collection_images(conn,root,&id)?.is_empty() {
                recovered_images.insert(game.candidate.rom_path.clone());
            }
            game.media_collection_id=Some(id);
        }
    }
    batch.tasks.retain(|task| !recovered_images.contains(&batch.games[task.game_index].candidate.rom_path));
    Ok(())
}

fn prepare_editor_batch(
    conn: &Connection,
    catalog: &Connection,
    job: &ImportJob,
    game_id: i32,
    source_id: i64,
    source_platform: &str,
    options: &MediaOptions,
) -> Result<StagedBatch> {
    prepare_editor_images(conn, catalog, job, game_id, source_id, source_platform, options, None)
}

fn prepare_editor_images(
    conn: &Connection,
    catalog: &Connection,
    job: &ImportJob,
    game_id: i32,
    source_id: i64,
    source_platform: &str,
    options: &MediaOptions,
    existing: Option<&[GameImage]>,
) -> Result<StagedBatch> {
    options.validate()?;
    let (title, platform, rom_path): (String, String, String) = conn
        .query_row(
            "SELECT title,platform,rom_path FROM games WHERE id=?1",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or(crate::i18n::text("msg.d73324547f"))?;
    let exists: bool = catalog
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM games WHERE id=?1 AND platform=?2)",
            params![source_id, source_platform],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        return Err(crate::i18n::text("msg.264b4977ed").into());
    }
    let images = catalog
        .prepare("SELECT filename,kind,region,crc FROM images WHERE game_id=?1")
        .map_err(err)?
        .query_map([source_id], |r| {
            Ok(CatalogImage {
                filename: r.get(0)?,
                kind: r.get(1)?,
                region: r.get(2)?,
                crc: r.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    // Separate rounds retain earlier draft images, even if a later download fails.
    let round = job.directory.join(crate::i18n::i18n_format!(
        "msg.f573c72c3d",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos()
    ));
    fs::create_dir(&round).map_err(err)?;
    // For a batch, walk all candidates until enough NEW images are found.
    // Existing primary images are retained; complementary images are additive.
    let additional;
    let options = if existing.is_some() && options.selected_types.is_some() {
        // Walk every candidate to find the requested number of NEW images.
        additional = MediaOptions { download_all: true, ..options.clone() };
        &additional
    } else if let Some(existing) = existing {
        let all = |count| if count > 0 { usize::MAX } else { 0 };
        additional = MediaOptions {
            cover: if existing.iter().any(|image| image.kind == "cover") { 0 } else { options.cover },
            logo: if existing.iter().any(|image| image.kind == "logo") { 0 } else { options.logo },
            screenshot: all(options.screenshot), title_screen: all(options.title_screen),
            back_cover: all(options.back_cover), spine: all(options.spine),
            artwork: all(options.artwork), other: all(options.other),
            additional: options.additional.iter().map(|(kind, count)| (kind.clone(), all(*count))).collect(),
            ..Default::default()
        };
        &additional
    } else { options };
    let tasks = select_images(images, options, &rom_path)
        .into_iter()
        .map(|image| DownloadTask {
            game_index: 0,
            path: round.join(&image.filename),
            image,
            failure: None,
            done: false,
        })
        .collect();
    let candidate = RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None, title, rom_path, steam: None, epic: None };
    Ok(StagedBatch {
        preview: ScanPreview {
            games: vec![candidate.clone()],
            skipped_count: 0,
            total_found: 1,
        },
        platform,
        games: vec![PreparedGame {
            candidate,
            metadata: None,
            images: Vec::new(),
            media_collection_id: None,
        }],
        tasks,
    })
}

fn identical_images(left: &Path, right: &Path) -> bool {
    fn compare(left: &Path, right: &Path) -> std::io::Result<bool> {
        let mut a = File::open(left)?;
        let mut b = File::open(right)?;
        if a.metadata()?.len() != b.metadata()?.len() {
            return Ok(false);
        }
        let mut a_buffer = [0; 16384];
        let mut b_buffer = [0; 16384];
        loop {
            let a_len = a.read(&mut a_buffer)?;
            if a_len == 0 {
                return Ok(true);
            }
            b.read_exact(&mut b_buffer[..a_len])?;
            if a_buffer[..a_len] != b_buffer[..a_len] {
                return Ok(false);
            }
        }
    }
    compare(left, right).unwrap_or(false)
}

#[derive(Serialize)]
pub struct BulkImageResult {
    game_id: i32,
    title: String,
    added: usize,
    message: String,
}

#[derive(Serialize, Default)]
pub struct BulkImageReport {
    results: Vec<BulkImageResult>,
    image_count: usize,
    cancelled: bool,
}

fn bulk_image_match(conn: &Connection, catalog: &Connection, id: i32) -> Result<(i64, String)> {
    let (title, platform, source,rom_path): (String, String, Option<i64>,String) = conn.query_row(
        "SELECT title,platform,launch\u{0062}ox_id,rom_path FROM games WHERE id=?1", [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?,r.get(3)?)),
    ).map_err(err)?;
    let source=repository::saved_match(conn,catalog,id as i64).or_else(||if repository::is_repository_catalog(catalog){None}else{source});
    if let Some(source) = source {
        if let Some(platform) = catalog.query_row("SELECT platform FROM games WHERE id=?1", [source], |r| r.get(0)).optional().map_err(err)? {
            return Ok((source, platform));
        }
    }
    let mapping=repository::platform_mapping(conn,&platform,!repository::is_repository_catalog(catalog));
    let names=catalog.prepare("SELECT name FROM platforms").map_err(err)?.query_map([],|r|r.get::<_,String>(0)).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    let platform=mapping.filter(|p|names.contains(p)).or_else(||names.into_iter().find(|p|crate::platform_defaults::equivalent(p,&platform))).ok_or(crate::i18n::text("msg.8a7491e5f6"))?;
    let matches: Vec<_> = repository::search_candidate(catalog, &title, &platform, &rom_path)?.into_iter().filter(|game| game.exact).collect();
    let selected=if matches.len()==1{Some(matches[0].game.id)}else{repository::regional_match(catalog,&matches,&rom_path)?};
    Ok((selected.ok_or(crate::i18n::text("msg.33b1ebc7e1"))?, platform))
}

fn download_additional_images(
    batch: &mut StagedBatch, options: &MediaOptions, existing: &[GameImage],
    job: &ImportJob, image_base: &str, mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    let client = http_client()?;
    let limits: HashMap<_, _> = options.entries().into_iter().collect();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for task in &mut batch.tasks {
        job.check()?;
        if counts.get(&task.image.kind).copied().unwrap_or(0) >= limits[task.image.kind.as_str()] { continue; }
        let outcome = repository::image_url(job,image_base,&task.image.filename).and_then(|url|download(&client, &url, &task.path, MAX_IMAGE_BYTES, job, |_, _| ()))
            .and_then(|_| super::image_extension(&task.path));
        job.check()?;
        match outcome {
            Ok(_) => {
                let duplicate = existing.iter().chain(batch.games[0].images.iter())
                    .any(|image| identical_images(&task.path, Path::new(&image.path)));
                if duplicate { let _ = fs::remove_file(&task.path); continue; }
                task.done = true;
                *counts.entry(task.image.kind.clone()).or_default() += 1;
                batch.games[0].images.push(GameImage { path: task.path.to_string_lossy().into_owned(), kind: task.image.kind.clone() });
                progress(job.progress("images", batch.games[0].images.len() as u64, None, Some(batch.games[0].candidate.title.clone())));
            }
            Err(message) => { task.failure = Some(message); let _ = fs::remove_file(&task.path); }
        }
    }
    Ok(())
}

fn append_bulk_images(conn: &mut Connection, job: &ImportJob, id: i32, images: &[GameImage], source_id: Option<i64>) -> Result<usize> {
    crate::media_library::init_schema(conn)?;
    // Cancellation cannot race the final per-game commit. Completed games remain saved.
    let _gate = job.commit_gate.lock().map_err(err)?;
    job.check()?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
    let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)", [id], |r| r.get(0)).map_err(err)?;
    if !exists { return Err(crate::i18n::text("msg.d73324547f").into()); }
    let mut current = super::read_game_images(&tx, id)?;
    for image in &mut current { image.path = super::resolve_image_path(&job.root, &image.path); }
    let mut copies = super::PendingImageCopies(Vec::new());
    let collection_dir = crate::media_library::ensure_game(&tx,&job.root,id as i64)?.1;
    if let Some(source)=source_id {repository::record_match(&tx,id as i64,source)?;}
    let unique = SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_nanos();
    let mut position: i64 = tx.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM game_images WHERE game_id=?1", [id], |r| r.get(0)).map_err(err)?;
    let mut added = 0;
    for (index, image) in images.iter().enumerate() {
        super::validate_game_images(std::slice::from_ref(image))?;
        if current.iter().any(|saved| identical_images(Path::new(&saved.path), Path::new(&image.path))) { continue; }
        let extension = super::image_extension(Path::new(&image.path))?;
        let relative = format!("{collection_dir}/bulk-{unique}-{index}.{extension}");
        let destination = job.root.join(&relative);
        fs::create_dir_all(destination.parent().unwrap()).map_err(err)?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(err)?;
        copies.0.push(destination.clone());
        std::io::copy(&mut File::open(&image.path).map_err(err)?, &mut output).map_err(err)?;
        tx.execute("INSERT INTO game_images(game_id,path,kind,position) VALUES (?1,?2,?3,?4)", params![id, relative, image.kind, position]).map_err(err)?;
        if image.kind == "cover" && !current.iter().any(|saved| saved.kind == "cover") {
            tx.execute("UPDATE games SET cover_path=?1 WHERE id=?2", params![relative, id]).map_err(err)?;
        }
        current.push(GameImage { path: destination.to_string_lossy().into_owned(), kind: image.kind.clone() });
        added += 1; position += 1;
    }
    crate::media_library::sync_game(&tx,&job.root,id as i64,&mut copies)?;
    tx.commit().map_err(err)?;
    copies.0.clear();
    crate::media_library::flush_logged(conn,&job.root);
    Ok(added)
}

fn download_bulk_images(
    conn: &mut Connection, catalog: &Connection, job: &ImportJob, ids: Vec<i32>,
    options: &MediaOptions, image_base: &str, mut progress: impl FnMut(MetadataProgress),
) -> Result<BulkImageReport> {
    options.validate()?;
    let mut seen = HashSet::new();
    let ids: Vec<_> = ids.into_iter().filter(|id| seen.insert(*id)).collect();
    if ids.len() < 2 { return Err(crate::i18n::text("msg.36783a7fcc").into()); }
    if !options.entries().iter().any(|(_, count)| *count > 0) { return Err(crate::i18n::text("msg.c2af09131f").into()); }
    let mut report = BulkImageReport::default();
    let total = ids.len() as u64;
    for (index, id) in ids.into_iter().enumerate() {
        if job.check().is_err() { report.cancelled = true; break; }
        let title: String = conn.query_row("SELECT title FROM games WHERE id=?1", [id], |r| r.get(0)).optional().map_err(err)?.unwrap_or_else(|| crate::i18n::i18n_format!("msg.ceaa5504bb", id = id));
        progress(job.progress("bulk_images", index as u64, Some(total), Some(title.clone())));
        let outcome = (|| -> Result<(usize, String)> {
            let (source, platform) = bulk_image_match(conn, catalog, id)?;
            let mut existing = super::read_game_images(conn, id)?;
            for image in &mut existing { image.path = super::resolve_image_path(&job.root, &image.path); }
            let mut batch = prepare_editor_images(conn, catalog, job, id, source, &platform, options, Some(&existing))?;
            download_additional_images(&mut batch, options, &existing, job, image_base, &mut progress)?;
            let failures = download_report(&batch).failures.len();
            let added = append_bulk_images(conn, job, id, &batch.games[0].images, Some(source))?;
            let message = if failures > 0 { crate::i18n::i18n_format!("msg.03050f8b4f", failures = failures) }
                else if added == 0 { crate::i18n::text("msg.cf21d4c4d5").into() } else { String::new() };
            Ok((added, message))
        })();
        if job.check().is_err() && outcome.is_err() { report.cancelled = true; break; }
        let (added, message) = outcome.unwrap_or_else(|message| (0, message));
        report.image_count += added;
        report.results.push(BulkImageResult { game_id: id, title, added, message });
        progress(job.progress("bulk_images", index as u64 + 1, Some(total), None));
    }
    Ok(report)
}

#[derive(Serialize, Default)]
pub struct AvailableImageTypes {
    counts: HashMap<String, usize>,
    matched_games: usize,
    skipped_games: usize,
}

fn available_image_types(catalog: &Connection, sources: &[i64], job: &ImportJob) -> Result<AvailableImageTypes> {
    let mut report = AvailableImageTypes::default();
    for id in sources.iter().copied().collect::<HashSet<_>>() {
        job.check()?;
        let images = catalog.prepare("SELECT filename,kind,region,crc FROM images WHERE game_id=?1")
            .map_err(err)?.query_map([id], |r| Ok(CatalogImage {
                filename: r.get(0)?, kind: r.get(1)?, region: r.get(2)?, crc: r.get(3)?,
            })).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
        // Availability is independent for each type: the same artwork can be
        // published under two categories, and either can be selected alone.
        let mut seen = HashSet::new();
        for image in images {
            if !valid_download_image_kind(&image.kind) || !safe_image_name(&image.filename) { continue; }
            let content = if image.crc.is_empty() || image.crc == "0" { image.filename } else { image.crc };
            if seen.insert((image.kind.clone(), content)) {
                *report.counts.entry(image.kind).or_default() += 1;
            }
        }
    }
    Ok(report)
}

#[tauri::command]
pub async fn get_metadata_image_types(
    job_id: String, source_ids: Option<Vec<i64>>, game_ids: Option<Vec<i32>>,
    on_progress: Channel<MetadataProgress>, jobs: tauri::State<'_, MetadataJobs>,
) -> Result<AvailableImageTypes> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        repository::prepare(&job, false, |update| { let _ = on_progress.send(update); })?;
        if let Some(ids)=game_ids.as_ref(){repository::ensure_games(&job,ids,|update|{let _=on_progress.send(update);})?;}
        let catalog = open_catalog(&job.catalog_path())?;
        let mut sources = source_ids.unwrap_or_default();
        let mut skipped = 0;
        let mut matched = sources.len();
        if let Some(ids) = game_ids {
            let conn = super::get_db_connection().map_err(err)?;
            let total = ids.len() as u64;
            for (index, id) in ids.into_iter().enumerate() {
                job.check()?;
                match bulk_image_match(&conn, &catalog, id) {
                    Ok((source, _)) => { sources.push(source); matched += 1; },
                    Err(_) => skipped += 1,
                }
                let _ = on_progress.send(job.progress("availability", index as u64 + 1, Some(total), None));
            }
        }
        let mut report = available_image_types(&catalog, &sources, &job)?;
        report.matched_games = matched;
        report.skipped_games = skipped;
        Ok(report)
    }).await.map_err(err)?
}

#[tauri::command]
pub async fn download_bulk_game_images(
    job_id: String, ids: Vec<i32>, options: MediaOptions,
    on_progress: Channel<MetadataProgress>, jobs: tauri::State<'_, MetadataJobs>,
) -> Result<BulkImageReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        options.validate()?;
        if ids.iter().collect::<HashSet<_>>().len() < 2 { return Err(crate::i18n::text("msg.36783a7fcc").into()); }
        if !options.entries().iter().any(|(_, count)| *count > 0) { return Err(crate::i18n::text("msg.c2af09131f").into()); }
        repository::prepare(&job, false, |update| { let _ = on_progress.send(update); })?;
        repository::ensure_games(&job,&ids,|update|{let _=on_progress.send(update);})?;
        let catalog = open_catalog(&job.catalog_path())?;
        let mut conn = super::get_db_connection().map_err(err)?;
        download_bulk_images(&mut conn, &catalog, &job, ids, &options, IMAGE_BASE, |update| { let _ = on_progress.send(update); })
    }).await.map_err(err)?
}

fn editor_image_report(
    batch: &StagedBatch,
    existing_images: &[GameImage],
    job: &ImportJob,
) -> Result<EditorImageReport> {
    let mut images: Vec<GameImage> = Vec::new();
    for image in &batch.games[0].images {
        job.check()?;
        let path = Path::new(&image.path);
        if !existing_images
            .iter()
            .chain(images.iter())
            .any(|existing| identical_images(path, Path::new(&existing.path)))
        {
            images.push(image.clone());
        }
    }
    let report = download_report(batch);
    Ok(EditorImageReport {
        images,
        image_count: report.image_count,
        available_count: batch.tasks.len(),
        failures: report.failures,
    })
}

#[tauri::command]
pub async fn download_editor_game_images(
    job_id: String,
    game_id: i32,
    source_id: i64,
    source_platform: String,
    options: MediaOptions,
    existing_images: Vec<GameImage>,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
    app: tauri::AppHandle,
) -> Result<EditorImageReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        options.validate()?;
        if options.entries().iter().any(|(_, count)| *count > 0) {
            repository::prepare(&job, false, |progress| {
                let _ = on_progress.send(progress);
            })?;
        }
        let conn = super::get_db_connection().map_err(err)?;
        let catalog = open_catalog(&job.catalog_path())?;
        let mut batch = prepare_editor_batch(
            &conn,
            &catalog,
            &job,
            game_id,
            source_id,
            &source_platform,
            &options,
        )?;
        drop(conn);
        drop(catalog);
        download_batch(&mut batch, &job, IMAGE_BASE, |progress| {
            let _ = on_progress.send(progress);
        })?;
        let report = editor_image_report(&batch, &existing_images, &job)?;
        for image in &report.images {
            app.asset_protocol_scope()
                .allow_file(&image.path)
                .map_err(err)?;
        }
        *job.editor_batch.lock().map_err(err)? = Some(batch);
        Ok(report)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn retry_editor_game_images(
    job_id: String,
    existing_images: Vec<GameImage>,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
    app: tauri::AppHandle,
) -> Result<EditorImageReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        let mut batch = job
            .editor_batch
            .lock()
            .map_err(err)?
            .take()
            .ok_or(crate::i18n::text("msg.d67dfcc4de"))?;
        let result = download_batch(&mut batch, &job, IMAGE_BASE, |progress| {
            let _ = on_progress.send(progress);
        });
        let report = result.and_then(|_| editor_image_report(&batch, &existing_images, &job));
        *job.editor_batch.lock().map_err(err)? = Some(batch);
        let report = report?;
        for image in &report.images {
            app.asset_protocol_scope()
                .allow_file(&image.path)
                .map_err(err)?;
        }
        Ok(report)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn end_metadata_import(
    job_id: String,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<()> {
    let jobs = jobs.inner().clone();
    let job = jobs.get(&job_id)?;
    job.cancel()?;
    tauri::async_runtime::spawn_blocking(move || {
        while job.busy.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(25));
        }
        let mut state = jobs.0.lock().map_err(err)?;
        if state.as_ref().is_some_and(|(key, _)| key == &job_id) {
            *state = None;
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

    const XML: &str = include_str!("../tests/fixtures/metadata-catalog.xml");
    const PNG: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
        0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 248, 15, 0, 1, 5,
        1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    struct Sandbox {
        root: PathBuf,
        job: Arc<ImportJob>,
        _jobs: MetadataJobs,
    }
    impl Sandbox {
        fn new() -> Self {
            static NEXT_SANDBOX: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "opencabinet-metadata-test-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_SANDBOX.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            let jobs = MetadataJobs::default();
            let job = jobs.start(root.clone()).unwrap();
            Self {
                root,
                job,
                _jobs: jobs,
            }
        }
        fn zip(&self, xml: &str) -> PathBuf {
            let path = self.root.join("fixture.zip");
            let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
            for (name, content) in [
                ("Metadata.xml", xml),
                (
                    "Platforms.xml",
                    "<Metadata><Platform><Name>Sega Genesis</Name></Platform></Metadata>",
                ),
            ] {
                zip.start_file(
                    name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .unwrap();
                zip.write_all(content.as_bytes()).unwrap();
            }
            zip.finish().unwrap();
            path
        }
        fn catalog(&self) -> Connection {
            let path = self.job.catalog_path();
            build_catalog(&self.zip(XML), &path, &self.job, |_| ()).unwrap();
            open_catalog(&path).unwrap()
        }
        fn preview(&self, count: usize) -> ScanPreview {
            let games = (0..count)
                .map(|index| {
                    let path = self.root.join(format!("Sonic {index} (Europe).rom"));
                    fs::write(&path, b"original ROM").unwrap();
                    RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None,
                        steam: None, epic: None,
                        title: format!("My reviewed title {index}"),
                        rom_path: path.to_string_lossy().into_owned(),
                    }
                })
                .collect();
            ScanPreview {
                games,
                skipped_count: 2,
                total_found: count + 2,
            }
        }
        fn batch(
            &self,
            conn: &Connection,
            catalog: &Connection,
            count: usize,
            options: MediaOptions,
        ) -> StagedBatch {
            let preview = self.preview(count);
            let selections = preview
                .games
                .iter()
                .map(|game| MatchSelection {
                    rom_path: game.rom_path.clone(),
                    id: Some(1),
                })
                .collect();
            prepare_batch(
                conn,
                catalog,
                &self.job,
                preview,
                "My Genesis".into(),
                "Sega Genesis",
                selections,
                &options,
            )
            .unwrap()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert!(self.root.is_absolute() && self.root.starts_with(std::env::temp_dir()));
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
            rom_path TEXT UNIQUE NOT NULL, cover_path TEXT, play_time INTEGER DEFAULT 0,
            release_date TEXT,developer TEXT,publisher TEXT);
            CREATE TABLE platforms(id INTEGER PRIMARY KEY, name TEXT UNIQUE,default_extensions TEXT);
            INSERT INTO platforms(name) VALUES ('My Genesis');").unwrap();
        crate::init_game_metadata(&conn).unwrap();
        crate::init_game_images(&conn).unwrap();
        init_library_schema(&conn).unwrap();
        conn
    }

    fn options() -> MediaOptions {
        MediaOptions {
            cover: 1,
            logo: 1,
            screenshot: 3,
            title_screen: 0,
            back_cover: 0,
            spine: 0,
            artwork: 0,
            other: 0,
            ..Default::default()
        }
    }

    fn count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap()
    }

    fn files_in(path: &Path) -> Vec<PathBuf> {
        let mut files = Vec::new();
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    files.extend(files_in(&entry.path()));
                } else {
                    files.push(entry.path());
                }
            }
        }
        files
    }

    #[test]
    fn parses_metadata_entities_aliases_and_classified_images() {
        let sandbox = Sandbox::new();
        let conn = sandbox.catalog();
        let result = search_catalog(&conn, "SONIC!", "Sega Genesis").unwrap();
        assert_eq!(result.iter().filter(|g| g.exact).count(), 1);
        let game = &result[0].game;
        assert_eq!(game.id, 1);
        assert_eq!(game.release_date.as_deref(), Some("1991-06-23"));
        assert_eq!(game.game_mode, None);
        assert_eq!(game.max_players, Some(1));
        assert_eq!(game.developer.as_deref(), Some("Sonic Team"));
        assert!(
            game.description
                .as_ref()
                .unwrap()
                .contains("Sonic & friends: <fast> adventures. <script>plain text</script>")
        );
        let types: Vec<String> = conn
            .prepare("SELECT DISTINCT kind FROM images ORDER BY kind")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            types,
            [
                "back_cover",
                "cover",
                "fanart_background",
                "flyer_front",
                "logo",
                "screenshot",
                "spine",
                "title_screen"
            ]
        );
        let unsafe_names: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM images WHERE filename LIKE '%..%'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(unsafe_names, 0);
        let bad = search_catalog(&conn, "Sonic the Hedgehog", "Sega Master System").unwrap();
        assert_eq!(bad[0].game.release_date, None);
        assert_eq!(bad[0].game.max_players, None);
        let cooperative = search_catalog(&conn, "Sonic the Hedgehog 2", "Sega Genesis").unwrap();
        assert_eq!(
            cooperative[0].game.game_mode.as_deref(),
            Some("Cooperativo")
        );
        let year_only = search_catalog(&conn, "Shared Name", "Sega Genesis").unwrap();
        assert_eq!(year_only[0].game.release_date, None);
    }

    #[test]
    fn accepts_legacy_xml_root_after_neutral_fixture_rename() {
        let sandbox=Sandbox::new();
        let legacy=XML.replace("<Metadata>",&format!("<{}>",crate::catalog_compat::XML_ROOT))
            .replace("</Metadata>",&format!("</{}>",crate::catalog_compat::XML_ROOT));
        let output=sandbox.job.directory.join("legacy-format.db");
        build_catalog(&sandbox.zip(&legacy),&output,&sandbox.job,|_|()).unwrap();
        let conn=open_catalog(&output).unwrap();
        let found=search_catalog(&conn,"Sonic the Hedgehog","Sega Genesis").unwrap();
        assert_eq!(found[0].game.id,1);
        assert_eq!(found[0].game.developer.as_deref(),Some("Sonic Team"));
        assert_eq!(found[0].game.release_date.as_deref(),Some("1991-06-23"));
    }

    #[test]
    fn exact_matches_are_platform_specific_and_ambiguous_aliases_stay_ambiguous() {
        let sandbox = Sandbox::new();
        let conn = sandbox.catalog();
        let exact = search_catalog(&conn, "Sonic the Hedgehog", "Sega Genesis").unwrap();
        assert_eq!(
            exact
                .iter()
                .filter(|g| g.exact)
                .map(|g| g.game.id)
                .collect::<Vec<_>>(),
            [1]
        );
        let similar = search_catalog(&conn, "Sonic the", "Sega Genesis").unwrap();
        assert!(similar.iter().any(|g| g.game.id == 2 && !g.exact));
        assert!(!exact.iter().any(|g| g.game.id == 3));
        let ambiguous = search_catalog(&conn, "Ambiguous", "Sega Genesis").unwrap();
        assert_eq!(ambiguous.iter().filter(|g| g.exact).count(), 2);
        assert!(
            search_catalog(&conn, "unrelated nonexistent", "Sega Genesis")
                .unwrap()
                .is_empty()
        );
        assert_ne!(normalize("Game 2"), normalize("Game 3"));
        assert!(search_catalog(&conn, "\" OR * : -", "Sega Genesis").is_ok());
    }

    #[test]
    fn approximate_search_reuses_platform_index_and_keeps_aliases_and_scopes_separate() {
        let sandbox = Sandbox::new();
        let conn = sandbox.catalog();
        search_catalog(&conn, "Sonic the Hedgehog", "Sega Genesis").unwrap();
        let temporary_tables: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_temp_master WHERE name='platform_names'", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(temporary_tables, 0, "exact lookups must not prepare approximate searches");

        let aliases = search_catalog(&conn, "Ambigu", "Sega Genesis").unwrap();
        assert_eq!(aliases.len(), 2);
        assert!(aliases.iter().all(|r| !r.exact && [4, 5].contains(&r.game.id)));
        // A marker proves subsequent misses reuse the index instead of rebuilding it.
        conn.execute("INSERT INTO temp.platform_names(name,game_id) VALUES ('CacheMarker',1)", []).unwrap();
        assert_eq!(search_catalog(&conn, "CacheMark", "Sega Genesis").unwrap()[0].game.id, 1);

        let other = search_catalog(&conn, "Sonic the", "Sega Master System").unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].game.id, 3);
        assert!(search_catalog(&conn, "CacheMark", "Sega Master System").unwrap().is_empty());
        let original = search_catalog(&conn, "Sonic the", "Sega Genesis").unwrap();
        assert!(original.iter().any(|r| r.game.id == 2));
        assert!(original.iter().all(|r| r.game.platform == "Sega Genesis"));
        assert!(conn.execute("DELETE FROM games", []).is_err(), "catalog must remain read-only");
    }

    #[test]
    fn slow_or_cancelled_catalog_queries_interrupt_sqlite_and_remove_the_handler() {
        let sandbox = Sandbox::new();
        let conn = sandbox.catalog();
        let expensive = || conn.query_row(
            "WITH RECURSIVE numbers(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM numbers WHERE n<100000000)
             SELECT SUM(n) FROM numbers", [], |r| r.get::<_, i64>(0),
        ).map_err(err);
        let timeout = catalog_search_operation(&conn, &sandbox.job, Duration::ZERO, || (), expensive).unwrap_err();
        assert!(timeout.contains("tardó demasiado"));
        assert!(!search_catalog(&conn, "Sonic the Hedgehog", "Sega Genesis").unwrap().is_empty());
        let cancelled = catalog_search_operation(&conn, &sandbox.job, Duration::from_secs(20), || (), || {
            sandbox.job.cancelled.store(true, Ordering::Release);
            expensive()
        }).unwrap_err();
        assert_eq!(cancelled, cancelled_message());
        // Even an interrupted operation must leave the connection usable.
        assert_eq!(conn.query_row("SELECT 42", [], |r| r.get::<_, i64>(0)).unwrap(), 42);
    }

    #[test]
    fn platform_search_preparation_scans_names_once_for_large_platforms() {
        let sandbox = Sandbox::new();
        let mut xml = XML.replace("</Metadata>", "");
        for id in 100..8100 {
            let platform = if id < 4100 { "Sega Genesis" } else { "Other console" };
            xml.push_str(&format!("<Game><DatabaseID>{id}</DatabaseID><Name>Adventure {id}</Name><Platform>{platform}</Platform></Game>"));
        }
        xml.push_str("</Metadata>");
        let path = sandbox.job.catalog_path();
        build_catalog(&sandbox.zip(&xml), &path, &sandbox.job, |_| ()).unwrap();
        let conn = open_catalog(&path).unwrap();
        let callbacks = Arc::new(AtomicUsize::new(0));
        let observed = callbacks.clone();
        // Bound SQLite work rather than wall-clock time. Repeated full scans
        // for each game exceed this budget even on a fast development machine.
        conn.progress_handler(20_000, Some(move || observed.fetch_add(1, Ordering::Relaxed) >= 200)).unwrap();
        let started = Instant::now();
        let result = prepare_platform_search(&conn, "Sega Genesis");
        conn.progress_handler(0, None::<fn() -> bool>).unwrap();
        assert!(result.is_ok(), "platform preparation exceeded its work budget: {result:?}");
        eprintln!("Indexing 4,000 platform games: {:?}, SQLite work callbacks: {}", started.elapsed(), callbacks.load(Ordering::Relaxed));
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM temp.platform_names", [], |r| r.get(0)).unwrap();
        assert!(count >= 4000);
        assert!(search_catalog(&conn, "Unobtainium Adventure", "Sega Genesis").unwrap().iter().all(|r| r.game.platform == "Sega Genesis"));
    }

    #[test]
    fn absent_titles_do_not_rank_matches_from_thousands_of_games_on_other_platforms() {
        let sandbox = Sandbox::new();
        let mut xml = XML.replace("</Metadata>", "");
        for id in 100..8100 {
            xml.push_str(&format!("<Game><DatabaseID>{id}</DatabaseID><Name>Adventure {id}</Name><Platform>Other console</Platform></Game>"));
        }
        xml.push_str("</Metadata>");
        let path = sandbox.job.catalog_path();
        build_catalog(&sandbox.zip(&xml), &path, &sandbox.job, |_| ()).unwrap();
        let conn = open_catalog(&path).unwrap();
        let started = Instant::now();
        for id in 0..50 {
            assert!(search_catalog(&conn, &format!("Unobtainium{id} Adventure"), "Sega Genesis").unwrap().is_empty());
        }
        eprintln!("50 absent-title searches with 8,000 unrelated games: {:?}", started.elapsed());
        let indexed: i64 = conn.query_row("SELECT COUNT(*) FROM temp.platform_names", [], |r| r.get(0)).unwrap();
        assert!(indexed < 20, "only the selected platform's titles and aliases should be searched");
        // Verify the scoped ranked query can stop at LIMIT without a temporary sort.
        let mut explain = conn.prepare(
            "EXPLAIN QUERY PLAN SELECT g.id,g.details FROM temp.platform_names f JOIN games g ON g.id=f.game_id
             WHERE platform_names MATCH ?1 ORDER BY f.rank LIMIT ?2",
        ).unwrap();
        let steps: Vec<String> = explain.query_map(params!["Adventure*", 105], |r| r.get(3)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert!(!steps.iter().any(|s| s.contains("TEMP B-TREE")), "{steps:?}");
        // Broader manual searches still offer approximate matches from other consoles.
        assert!(!search_catalog_scope(&conn, "Unobtainium Adventure", None).unwrap().is_empty());
    }

    #[test]
    fn all_catalog_categories_remain_distinct_across_platforms_and_survive_import() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        drop(sandbox.catalog());
        let catalog = Connection::open(sandbox.job.catalog_path()).unwrap();
        catalog.execute("DELETE FROM images", []).unwrap();
        let mut xml = String::from("<Metadata>");
        for id in [1, 3] {
            for (index, (source, _)) in GAME_IMAGE_TYPES.iter().enumerate() {
                xml.push_str(&format!("<GameImage><DatabaseID>{id}</DatabaseID><FileName>type-{id}-{index}.png</FileName><Type>{source}</Type><Region>World</Region></GameImage>"));
            }
        }
        xml.push_str("</Metadata>");
        read_records(BufReader::new(xml.as_bytes()), &sandbox.job, |tag, fields| insert_record(&catalog, tag, fields)).unwrap();
        let selected: MediaOptions = serde_json::from_value(serde_json::Value::Object(
            GAME_IMAGE_TYPES.iter().map(|(_, key)| (key.to_string(), 1.into())).collect()
        )).unwrap();
        selected.validate().unwrap();
        for id in [1, 3] {
            let distinct: i64 = catalog.query_row("SELECT COUNT(DISTINCT kind) FROM images WHERE game_id=?1", [id], |r| r.get(0)).unwrap();
            assert_eq!(distinct, GAME_IMAGE_TYPES.len() as i64);
        }
        let mut batch = sandbox.batch(&conn, &catalog, 1, selected);
        assert_eq!(batch.tasks.len(), GAME_IMAGE_TYPES.len());
        let paths: Vec<_> = batch.tasks.iter().map(|task| task.image.filename.clone()).collect();
        let responses = paths.iter().enumerate().map(|(index, path)| {
            let mut bytes = PNG.to_vec(); bytes.extend_from_slice(&(index as u32).to_le_bytes());
            (path.as_str(), vec![(200, bytes)])
        }).collect();
        let server = MockServer::new(responses, false);
        let report = download_batch(&mut batch, &sandbox.job, &server.base, |_| ()).unwrap();
        assert!(report.failures.is_empty());
        assert_eq!(report.image_count, GAME_IMAGE_TYPES.len());
        let preview = batch.preview.clone();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        let saved = crate::read_game_images(&conn, 1).unwrap();
        assert_eq!(saved.len(), GAME_IMAGE_TYPES.len());
        for (_, key) in GAME_IMAGE_TYPES {
            assert!(saved.iter().any(|image| image.kind == *key));
        }
        // Existing generic classifications still validate without being renamed.
        crate::validate_game_images(&[
            GameImage { path: "legacy-art.png".into(), kind: "artwork".into() },
            GameImage { path: "legacy-other.png".into(), kind: "other".into() },
        ]).unwrap();
    }

    #[test]
    fn availability_reports_only_downloadable_types_without_repeating_shared_matches() {
        let sandbox = Sandbox::new();
        let catalog = sandbox.catalog();
        let report = available_image_types(&catalog, &[1, 1, 3, 999], &sandbox.job).unwrap();
        assert_eq!(report.counts["cover"], 2);
        assert_eq!(report.counts["logo"], 1);
        assert_eq!(report.counts["screenshot"], 2); // Duplicate CRC counts once.
        assert!(!report.counts.contains_key("disc"));
        assert!(!report.counts.contains_key("cart_front"));
        assert!(available_image_types(&catalog, &[], &sandbox.job).unwrap().counts.is_empty());
        sandbox.job.cancel().unwrap();
        assert!(available_image_types(&catalog, &[1], &sandbox.job).is_err());
    }

    #[test]
    fn selected_types_default_to_one_image_and_bulk_skips_duplicates_to_find_one_new_image() {
        let sandbox = Sandbox::new();
        let catalog = sandbox.catalog();
        let mut conn = library();
        let options: MediaOptions = serde_json::from_value(serde_json::json!({
            "selected_types": ["cover", "logo", "screenshot"]
        })).unwrap();
        assert!(!options.download_all);
        let batch = sandbox.batch(&conn, &catalog, 1, options.clone());
        assert_eq!(batch.tasks.len(), 3);
        assert_eq!(batch.tasks[0].image.filename, "cover-eu.png");
        assert_eq!(batch.tasks.iter().filter(|task| task.image.kind == "screenshot").count(), 1);
        let all = MediaOptions { download_all: true, ..options };
        let batch = sandbox.batch(&conn, &catalog, 1, all);
        assert_eq!(batch.tasks.len(), 5);

        let ids = bulk_games(&conn);
        let id = ids[0];
        let existing = sandbox.root.join("already-downloaded.png");
        fs::write(&existing, PNG).unwrap();
        conn.execute("INSERT INTO game_images VALUES (?1,?2,'screenshot',0)",
            params![id, existing.to_string_lossy()]).unwrap();
        let mut new_image = PNG.to_vec(); new_image.push(42);
        let server = MockServer::new(vec![
            ("screen-duplicate.png", vec![(200, PNG.to_vec())]),
            ("screen-1.png", vec![(200, PNG.to_vec())]),
            ("screen-2.png", vec![(200, new_image)]),
        ], false);
        let options: MediaOptions = serde_json::from_value(serde_json::json!({
            "selected_types": ["screenshot"]
        })).unwrap();
        let report = download_bulk_images(&mut conn, &catalog, &sandbox.job, ids.clone(), &options, &server.base, |_| ()).unwrap();
        assert_eq!(report.image_count, 2);
        assert_eq!(crate::read_game_images(&conn, id).unwrap().len(), 2);
        assert_eq!(crate::read_game_images(&conn, ids[1]).unwrap().len(), 1);
        assert_eq!(server.seen.lock().unwrap().len(), 3);
    }

    #[test]
    fn checked_types_download_every_variant_and_preserve_the_first_cover_after_restart() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        drop(sandbox.catalog());
        let catalog = Connection::open(sandbox.job.catalog_path()).unwrap();
        for index in 0..25 {
            catalog.execute("INSERT INTO images VALUES (1,?1,'disc','World',?2)",
                params![format!("disc-{index}.png"), format!("disc-crc-{index}")]).unwrap();
        }
        catalog.execute("INSERT INTO images VALUES (1,'logo-second.png','logo','Europe','second-logo')", []).unwrap();
        let options: MediaOptions = serde_json::from_value(serde_json::json!({
            "selected_types": ["cover", "logo", "disc"], "download_all": true
        })).unwrap();
        options.validate().unwrap();
        let mut batch = sandbox.batch(&conn, &catalog, 1, options.clone());
        assert_eq!(batch.tasks.len(), 29); // Two covers, two logos, 25 discs; no old 20-image limit.
        assert!(batch.tasks.iter().all(|task| ["cover", "logo", "disc"].contains(&task.image.kind.as_str())));
        assert_eq!(batch.tasks[0].image.filename, "cover-eu.png");
        let paths: Vec<_> = batch.tasks.iter().map(|task| task.image.filename.clone()).collect();
        let responses = paths.iter().enumerate().map(|(index, path)| {
            let mut bytes = PNG.to_vec(); bytes.extend_from_slice(&(index as u32).to_le_bytes());
            (path.as_str(), vec![(200, bytes)])
        }).collect();
        let server = MockServer::new(responses, false);
        let report = download_batch(&mut batch, &sandbox.job, &server.base, |_| ()).unwrap();
        assert!(report.failures.is_empty());
        assert_eq!(report.image_count, 29);
        let preview = batch.preview.clone();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        let saved = crate::read_game_images(&conn, 1).unwrap();
        assert_eq!(saved.iter().filter(|image| image.kind == "cover").count(), 2);
        assert_eq!(saved.iter().filter(|image| image.kind == "logo").count(), 2);
        let primary: String = conn.query_row("SELECT cover_path FROM games WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(primary, saved[0].path);
        crate::init_game_images(&conn).unwrap();
        assert_eq!(crate::read_game_images(&conn, 1).unwrap().len(), 29);
        // Bulk preparation must keep these categories enabled even if primary images already exist.
        let mut prepared = prepare_editor_images(&conn, &catalog, &sandbox.job, 1, 1, "Sega Genesis", &options, Some(&saved)).unwrap();
        assert_eq!(prepared.tasks.len(), 29);
        let existing: Vec<_> = saved.iter().map(|image| GameImage {
            path: crate::resolve_image_path(&sandbox.root, &image.path), kind: image.kind.clone(),
        }).collect();
        // All candidates already present: do not add duplicates or replace the primary cover.
        let responses = paths.iter().enumerate().map(|(index, path)| {
            let mut bytes = PNG.to_vec(); bytes.extend_from_slice(&(index as u32).to_le_bytes());
            (path.as_str(), vec![(200, bytes)])
        }).collect();
        let second = MockServer::new(responses, false);
        download_additional_images(&mut prepared, &options, &existing, &sandbox.job, &second.base, |_| ()).unwrap();
        assert!(prepared.games[0].images.is_empty());
        let unknown: MediaOptions = serde_json::from_value(serde_json::json!({"selected_types": ["unknown"]})).unwrap();
        assert!(unknown.validate().is_err());
    }

    #[test]
    fn extra_media_limits_reject_unknown_types_and_default_to_no_downloads() {
        for value in [
            serde_json::json!({"disc": 21}),
            serde_json::json!({"arcade_marquee": 21}),
            serde_json::json!({"unknown_image": 1}),
        ] {
            assert!(serde_json::from_value::<MediaOptions>(value).unwrap().validate().is_err());
        }
        let empty: MediaOptions = serde_json::from_value(serde_json::json!({})).unwrap();
        empty.validate().unwrap();
        assert!(empty.entries().iter().all(|(_, count)| *count == 0));
        assert!(serde_json::from_value::<MediaOptions>(serde_json::json!({"disc": -1})).is_err());
        assert!(serde_json::from_value::<MediaOptions>(serde_json::json!({"disc": 1.5})).is_err());
    }

    #[test]
    fn spine_images_are_opt_in_classified_and_follow_regional_preferences() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        assert_eq!(image_kind("Box - Spine"), "spine");
        let legacy: MediaOptions = serde_json::from_value(serde_json::json!({
            "cover": 1, "logo": 1, "screenshot": 3, "title_screen": 0,
            "back_cover": 0, "artwork": 0, "other": 0
        })).unwrap();
        assert_eq!(legacy.spine, 0);
        let default_batch = sandbox.batch(&conn, &catalog, 1, legacy);
        assert!(default_batch.tasks.iter().all(|task| task.image.kind != "spine"));
        let mut selected = options();
        selected.spine = 1;
        let batch = sandbox.batch(&conn, &catalog, 1, selected.clone());
        let spines: Vec<_> = batch.tasks.iter().filter(|task| task.image.kind == "spine").collect();
        assert_eq!(spines.len(), 1);
        assert_eq!(spines[0].image.filename, "spine-eu.png");
        crate::validate_game_images(&[GameImage { path: "spine.png".into(), kind: "spine".into() }]).unwrap();
        selected.spine = 21;
        assert!(selected.validate().is_err());
    }

    #[test]
    fn cartridge_labels_can_be_downloaded_without_inventing_a_legacy_category() {
        assert!(valid_image_kind("cart_label"));
        assert!(valid_download_image_kind("cart_label"));
        assert_eq!(image_kind("Cart - Front"), "cart_front");
        assert!(!GAME_IMAGE_TYPES.iter().any(|(_, kind)| *kind == "cart_label"));
        let selected: MediaOptions = serde_json::from_value(serde_json::json!({"selected_types": ["cart_label"]})).unwrap();
        assert!(selected.validate().is_ok());
    }

    #[test]
    fn inlay_images_are_classified_and_can_be_selected_for_download() {
        assert!(valid_image_kind("inlay"));
        assert!(valid_download_image_kind("inlay"));
        assert_eq!(image_kind("Box - Inlay"), "inlay");
        let selected: MediaOptions = serde_json::from_value(serde_json::json!({"selected_types": ["inlay"]})).unwrap();
        assert!(selected.validate().is_ok());
    }

    #[test]
    fn image_selection_honors_regions_limits_and_duplicate_content() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let batch = sandbox.batch(&conn, &catalog, 1, options());
        assert_eq!(batch.tasks.len(), 4); // cover + logo + two distinct screenshots
        assert_eq!(batch.tasks[0].image.filename, "cover-eu.png");
        assert_eq!(batch.tasks[1].image.kind, "logo");
        assert_eq!(
            batch
                .tasks
                .iter()
                .filter(|t| t.image.kind == "screenshot")
                .count(),
            2
        );
        let mut zero = options();
        zero.cover = 0;
        zero.logo = 0;
        zero.screenshot = 0;
        let empty = sandbox.batch(&conn, &catalog, 1, zero);
        assert!(empty.tasks.is_empty());
        let mut invalid = options();
        invalid.cover = 2;
        assert!(invalid.validate().is_err());
        let mut invalid = options();
        invalid.other = 21;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn title_only_search_includes_other_platforms_and_alternate_titles() {
        let sandbox = Sandbox::new();
        let conn = sandbox.catalog();
        let results = search_catalog_scope(&conn, "Sonic the Hedgehog", None).unwrap();
        assert_eq!(
            results.iter().map(|game| game.game.id).collect::<Vec<_>>(),
            [1, 3]
        );
        assert!(results.iter().all(|game| game.exact));
        assert_eq!(results[0].game.platform, "Sega Genesis");
        assert_eq!(results[1].game.platform, "Sega Master System");
        let alias = search_catalog_scope(&conn, "Sónic!", None).unwrap();
        assert_eq!(alias[0].game.id, 1);
        let approximate = search_catalog_scope(&conn, "Sonic the", None).unwrap();
        assert!(approximate.iter().any(|game| game.game.id == 2));
        assert!(approximate.iter().any(|game| game.game.id == 3));
        assert!(approximate.iter().all(|game| !game.exact));
        assert!(search_catalog_scope(&conn, "", None).unwrap().is_empty());
    }

    #[test]
    fn corrupt_or_cancelled_updates_leave_the_previous_catalog_usable() {
        let sandbox = Sandbox::new();
        drop(sandbox.catalog());
        let original = fs::read(sandbox.job.catalog_path()).unwrap();
        let staged = sandbox.job.directory.join("broken.db");
        assert!(
            build_catalog(
                &sandbox.zip("<Metadata><Game>"),
                &staged,
                &sandbox.job,
                |_| ()
            )
            .is_err()
        );
        assert_eq!(fs::read(sandbox.job.catalog_path()).unwrap(), original);
        let cancelled = sandbox.job.directory.join("cancelled.db");
        assert!(
            build_catalog(&sandbox.zip(XML), &cancelled, &sandbox.job, |progress| {
                if progress.phase == "indexing" {
                    sandbox.job.cancel().unwrap();
                }
            })
            .is_err()
        );
        assert_eq!(
            catalog_summary(&sandbox.job.catalog_path())
                .unwrap()
                .game_count,
            5
        );
    }

    #[test]
    fn catalog_preload_is_read_only_reusable_and_invalidated_after_replacement() {
        let sandbox = Sandbox::new();
        let path = sandbox.job.catalog_path();
        assert!(cached_catalog_summary(&path).is_err());
        assert!(!path.exists());
        drop(sandbox.catalog());
        let original = fs::read(&path).unwrap();
        let stamp = fs::metadata(&path).unwrap().modified().unwrap();
        let first = cached_catalog_summary(&path).unwrap();
        assert_eq!(first.game_count, 5);
        assert_eq!(cached_catalog_summary(&path).unwrap().downloaded_at, first.downloaded_at);
        assert_eq!(fs::read(&path).unwrap(), original);
        let replacement = sandbox.job.directory.join("updated-summary.db");
        build_catalog(&sandbox.zip(XML), &replacement, &sandbox.job, |_| ()).unwrap();
        let conn = Connection::open(&replacement).unwrap();
        conn.execute("UPDATE catalog_info SET downloaded_at='new-date'", []).unwrap();
        drop(conn);
        fs::OpenOptions::new().write(true).open(&replacement).unwrap().set_modified(stamp).unwrap();
        replace_catalog(&replacement, &path).unwrap();
        assert_eq!(cached_catalog_summary(&path).unwrap().downloaded_at, "new-date");
    }

    #[test]
    fn catalog_replacement_and_recovery_keep_a_readable_database() {
        let sandbox = Sandbox::new();
        drop(sandbox.catalog());
        let path = sandbox.job.catalog_path();
        let replacement = sandbox.job.directory.join("replacement.db");
        build_catalog(&sandbox.zip(XML), &replacement, &sandbox.job, |_| ()).unwrap();
        replace_catalog(&replacement, &path).unwrap();
        let previous = path.with_extension("previous.db");
        fs::rename(&path, &previous).unwrap();
        recover_catalog(&path).unwrap();
        assert_eq!(catalog_summary(&path).unwrap().game_count, 5);
        assert!(!previous.exists());
    }

    fn legacy_catalog(sandbox: &Sandbox) {
        drop(sandbox.catalog());
        let conn = Connection::open(sandbox.job.catalog_path()).unwrap();
        conn.execute_batch("UPDATE images SET kind='other' WHERE kind='spine'; PRAGMA user_version=0;").unwrap();
    }

    #[test]
    fn legacy_catalogs_rebuild_image_types_once_before_spine_downloads() {
        let sandbox = Sandbox::new();
        legacy_catalog(&sandbox);
        assert!(!catalog_has_current_image_types(&sandbox.job.catalog_path()));
        let bytes = fs::read(sandbox.zip(XML)).unwrap();
        let server = MockServer::new(vec![("Metadata.zip", vec![(200, bytes)])], false);
        let url = format!("{}Metadata.zip", server.base);
        let mut phases = HashSet::new();
        prepare_catalog(&sandbox.job, false, &url, |update| { phases.insert(update.phase); }).unwrap();
        assert!(phases.contains("catalog") && phases.contains("indexing"));
        assert!(catalog_has_current_image_types(&sandbox.job.catalog_path()));
        let conn = library();
        let catalog = open_catalog(&sandbox.job.catalog_path()).unwrap();
        let id = editor_game(&conn);
        let mut selected = options();
        selected.spine = 1;
        let batch = prepare_editor_batch(&conn, &catalog, &sandbox.job, id, 1, "Sega Genesis", &selected).unwrap();
        assert!(batch.tasks.iter().any(|task| task.image.kind == "spine"));
        // The mock has only one response: subsequent uses must stay offline.
        prepare_catalog(&sandbox.job, false, &url, |_| ()).unwrap();
        assert_eq!(server.seen.lock().unwrap().len(), 1);
    }

    #[test]
    fn version_one_catalogs_recover_specific_categories_and_reuse_the_upgraded_cache() {
        let sandbox = Sandbox::new();
        drop(sandbox.catalog());
        let catalog = Connection::open(sandbox.job.catalog_path()).unwrap();
        catalog.execute_batch("UPDATE images SET kind='artwork' WHERE kind='fanart_background';
            UPDATE images SET kind='other' WHERE kind='flyer_front'; PRAGMA user_version=1;").unwrap();
        drop(catalog);
        assert!(!catalog_has_current_image_types(&sandbox.job.catalog_path()));
        let bytes = fs::read(sandbox.zip(XML)).unwrap();
        let server = MockServer::new(vec![("Metadata.zip", vec![(200, bytes)])], false);
        let url = format!("{}Metadata.zip", server.base);
        prepare_catalog(&sandbox.job, false, &url, |_| ()).unwrap();
        let catalog = open_catalog(&sandbox.job.catalog_path()).unwrap();
        let options: MediaOptions = serde_json::from_value(serde_json::json!({"fanart_background": 1, "flyer_front": 1})).unwrap();
        let batch = sandbox.batch(&library(), &catalog, 1, options);
        assert_eq!(batch.tasks.len(), 2);
        assert_eq!(batch.tasks[0].image.kind, "fanart_background");
        assert_eq!(batch.tasks[1].image.kind, "flyer_front");
        prepare_catalog(&sandbox.job, false, &url, |_| ()).unwrap();
        assert_eq!(server.seen.lock().unwrap().len(), 1);
    }

    #[test]
    fn failed_or_cancelled_image_type_upgrades_preserve_the_old_catalog() {
        let sandbox = Sandbox::new();
        legacy_catalog(&sandbox);
        let original = fs::read(sandbox.job.catalog_path()).unwrap();
        let bytes = fs::read(sandbox.zip(XML)).unwrap();
        let server = MockServer::new(vec![("Metadata.zip", vec![(503, b"Unavailable".to_vec()), (200, bytes)])], false);
        let url = format!("{}Metadata.zip", server.base);
        assert!(prepare_catalog(&sandbox.job, false, &url, |_| ()).is_err());
        assert_eq!(fs::read(sandbox.job.catalog_path()).unwrap(), original);
        assert!(!catalog_has_current_image_types(&sandbox.job.catalog_path()));
        assert!(prepare_catalog(&sandbox.job, false, &url, |update| {
            if update.phase == "indexing" { sandbox.job.cancel().unwrap(); }
        }).is_err());
        assert_eq!(fs::read(sandbox.job.catalog_path()).unwrap(), original);
    }

    #[test]
    fn pc_import_with_metadata_and_images_preserves_direct_launch_and_rolls_back_on_failure() {
        for fail in [false, true] {
            let sandbox = Sandbox::new();
            let mut conn = library();
            conn.execute("INSERT INTO platforms(name,default_extensions) VALUES ('PC','.exe')", []).unwrap();
            let catalog = sandbox.catalog();
            let file = sandbox.root.join("Game with spaces.exe");
            fs::write(&file, b"original executable").unwrap();
            let preview = ScanPreview { games: vec![RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None, title: "Reviewed PC title".into(), rom_path: file.to_string_lossy().into_owned(), steam: None, epic: None }], total_found: 1, skipped_count: 0 };
            let selected = vec![MatchSelection { rom_path: preview.games[0].rom_path.clone(), id: Some(1) }];
            // The small mock catalog supplies the metadata; its source platform
            // must never replace the local PC platform or its launch behavior.
            let mut batch = prepare_batch(&conn, &catalog, &sandbox.job, preview.clone(), "PC".into(), "Sega Genesis", selected, &options()).unwrap();
            for task in &mut batch.tasks {
                fs::write(&task.path, PNG).unwrap(); task.done = true;
                batch.games[task.game_index].images.push(GameImage { path: task.path.to_string_lossy().into_owned(), kind: task.image.kind.clone() });
            }
            *sandbox.job.staged.lock().unwrap() = Some(batch);
            if fail { conn.execute_batch("CREATE TRIGGER fail_pc_import BEFORE UPDATE OF launch\u{0062}ox_id ON games BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").unwrap(); }
            let result = commit_import(&mut conn, &sandbox.job, preview, "PC", |_| {});
            if fail { assert!(result.is_err()); assert_eq!(count(&conn), 0); }
            else {
                let result = result.unwrap(); assert_eq!(result.added_count, 1); assert!(result.enrichment.unwrap().image_count > 0);
                let row: (String,String,bool,i64) = conn.query_row("SELECT title,platform,launch_directly,session_count FROM games", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
                assert_eq!(row, ("Reviewed PC title".into(), "PC".into(), true, 0));
            }
            assert_eq!(fs::read(&file).unwrap(), b"original executable");
        }
    }

    #[test]
    fn steam_import_can_enrich_images_and_metadata_without_losing_its_identity_or_accepting_an_uninstall() {
        for uninstall in [false,true] {
            let sandbox=Sandbox::new();let mut conn=library();let catalog=sandbox.catalog();
            conn.execute("INSERT INTO platforms(name,default_extensions) VALUES ('PC','.exe')",[]).unwrap();
            let client=sandbox.root.join("Steam");fs::create_dir_all(client.join("steamapps/common/Test Game")).unwrap();fs::write(client.join("steam.exe"),b"mock client").unwrap();
            let manifest=client.join("steamapps/appmanifest_730.acf");fs::write(&manifest,b"\"AppState\"{\"appid\"\"730\"\"name\"\"Steam title\"\"installdir\"\"Test Game\"\"StateFlags\"\"4\"}").unwrap();
            let preview=ScanPreview {games:vec![RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None,title:"Reviewed Steam title".into(),rom_path:crate::steam::uri(730),epic:None,steam:Some(crate::steam::SteamSource {app_id:730,client_path:client.join("steam.exe").to_string_lossy().into_owned(),manifest_path:manifest.to_string_lossy().into_owned()})}],total_found:1,skipped_count:0};
            let selected=vec![MatchSelection {rom_path:preview.games[0].rom_path.clone(),id:Some(1)}];
            let mut batch=prepare_batch(&conn,&catalog,&sandbox.job,preview.clone(),"PC".into(),"Sega Genesis",selected,&options()).unwrap();
            for task in &mut batch.tasks {fs::write(&task.path,PNG).unwrap();task.done=true;batch.games[task.game_index].images.push(GameImage {path:task.path.to_string_lossy().into_owned(),kind:task.image.kind.clone()});}
            *sandbox.job.staged.lock().unwrap()=Some(batch);
            if uninstall {fs::remove_file(&manifest).unwrap();}
            let result=commit_import(&mut conn,&sandbox.job,preview.clone(),"PC",|_|{});
            if uninstall {assert!(result.is_err());assert_eq!(count(&conn),0);} else {
                assert!(result.unwrap().enrichment.unwrap().image_count>0);
                let stored:(String,bool,String)=conn.query_row("SELECT rom_path,launch_directly,steam_client_path FROM games",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();assert_eq!(stored.0,"steam://run/730");assert!(stored.1);assert_eq!(Path::new(&stored.2),client.join("steam.exe"));
                let details=serde_json::from_value(serde_json::json!({"id":1,"title":"Edited Steam title","platform":"PC"})).unwrap();
                let game=crate::save_game_details(&mut conn,details).unwrap();assert_eq!(game.steam_app_id,Some(730));assert!(game.launch_directly);assert_eq!(game.session_count,0);
                let duplicate=crate::import_roms(&mut conn,preview,"PC",|_|{}).unwrap();assert_eq!(duplicate.added_count,0);assert_eq!(duplicate.skipped_count,1);
            }
        }
    }

    #[test]
    fn epic_import_enriches_images_preserves_launch_details_and_rolls_back_on_uninstall_or_save_failure() {
        for failure in ["none", "uninstall", "save"] {
            let sandbox = Sandbox::new();
            let epic = crate::epic::tests::Fixture::new();
            let mut conn = library();
            let catalog = sandbox.catalog();
            conn.execute("INSERT INTO platforms(name,default_extensions) VALUES ('PC','.exe')", []).unwrap();
            let manifest = epic.install("game-id", "Epic title");
            let mut preview = epic.preview(&conn);
            preview.games[0].title = "Reviewed Epic title".into();
            let selected = vec![MatchSelection { rom_path: preview.games[0].rom_path.clone(), id: Some(1) }];
            let mut batch = prepare_batch(&conn, &catalog, &sandbox.job, preview.clone(), "PC".into(), "Sega Genesis", selected, &options()).unwrap();
            for task in &mut batch.tasks {
                fs::write(&task.path, PNG).unwrap(); task.done = true;
                batch.games[task.game_index].images.push(GameImage { path: task.path.to_string_lossy().into_owned(), kind: task.image.kind.clone() });
            }
            *sandbox.job.staged.lock().unwrap() = Some(batch);
            if failure == "uninstall" { fs::remove_file(&manifest).unwrap(); }
            if failure == "save" { conn.execute_batch("CREATE TRIGGER fail_epic_images BEFORE INSERT ON game_images BEGIN SELECT RAISE(ABORT,'simulated'); END;").unwrap(); }
            let result = commit_import(&mut conn, &sandbox.job, preview.clone(), "PC", |_| {});
            if failure != "none" {
                assert!(result.is_err()); assert_eq!(count(&conn), 0);
                assert!(files_in(&sandbox.root.join("images")).is_empty());
            } else {
                let summary = result.unwrap().enrichment.unwrap(); assert!(summary.image_count > 0); assert_eq!(summary.metadata_count, 1);
                let stored: (String, bool, String, String) = conn.query_row("SELECT rom_path,launch_directly,epic_client_path,epic_manifest_path FROM games", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
                assert_eq!(stored.0, preview.games[0].rom_path); assert!(stored.1); assert_eq!(Path::new(&stored.2), epic.client); assert_eq!(Path::new(&stored.3), manifest);
                let details = serde_json::from_value(serde_json::json!({ "id": 1, "title": "Edited Epic title", "platform": "PC" })).unwrap();
                let game = crate::save_game_details(&mut conn, details).unwrap();
                assert_eq!(game.epic_app_id.as_deref(), Some("game-id")); assert_eq!(game.steam_app_id, None); assert!(game.launch_directly); assert_eq!(game.session_count, 0);
                assert!(crate::epic::launch_plan(&conn, 1, &game.rom_path).is_ok());
                let duplicate = crate::import_roms(&mut conn, preview, "PC", |_| {}).unwrap(); assert_eq!(duplicate.added_count, 0); assert_eq!(duplicate.skipped_count, 1);
            }
            assert_eq!(fs::read(&epic.client).unwrap(), b"Fake client, never executed");
        }
    }

    #[test]
    fn import_keeps_reviewed_titles_local_platform_and_independent_roms() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let mut batch = sandbox.batch(&conn, &catalog, 2, options());
        for task in &mut batch.tasks {
            fs::write(&task.path, PNG).unwrap();
            task.done = true;
            batch.games[task.game_index].images.push(GameImage {
                path: task.path.to_string_lossy().into_owned(),
                kind: task.image.kind.clone(),
            });
        }
        let preview = batch.preview.clone();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        assert_eq!(count(&conn), 0);
        let result = commit_import(
            &mut conn,
            &sandbox.job,
            preview.clone(),
            "My Genesis",
            |_| (),
        )
        .unwrap();
        assert_eq!(result.added_count, 2);
        assert_eq!(result.skipped_count, 2);
        assert_eq!(result.enrichment.as_ref().unwrap().image_count, 8);
        let rows: Vec<(String, String, i64, i64, i64)> = conn.prepare("SELECT title,platform,launch\u{0062}ox_id,play_time_seconds,session_count FROM games ORDER BY id").unwrap()
            .query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(
            rows[0],
            ("My reviewed title 0".into(), "My Genesis".into(), 1, 0, 0)
        );
        assert_eq!(rows[1].2, 1); // External IDs deliberately are not unique.
        for game in &preview.games {
            assert_eq!(fs::read(&game.rom_path).unwrap(), b"original ROM");
        }
        let images = crate::read_game_images(&conn, 1).unwrap();
        assert_eq!(images.len(), 4);
        assert!(
            images
                .iter()
                .all(|image| sandbox.root.join(&image.path).is_file())
        );
        assert!(commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).is_err());
    }

    #[test]
    fn import_uses_selected_catalog_titles_when_enabled_and_keeps_unmatched_titles() {
        for enabled in [true,false] {
            let sandbox=Sandbox::new();
            let mut conn=library();
            let catalog=sandbox.catalog();
            let mut batch=sandbox.batch(&conn,&catalog,2,MediaOptions::default());
            batch.games[1].metadata=None;
            let preview=batch.preview.clone();
            apply_catalog_titles(&mut batch,enabled);
            assert_eq!(batch.preview,preview,"retain the original review for commit validation");
            *sandbox.job.staged.lock().unwrap()=Some(batch);
            let result=commit_import(&mut conn,&sandbox.job,preview,"My Genesis",|_|()).unwrap();
            assert_eq!(result.added_count,2);
            let rows:Vec<(String,String,i64,i64)>=conn.prepare("SELECT title,platform,play_time_seconds,session_count FROM games ORDER BY id").unwrap()
                .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
            assert_eq!(rows[0],(if enabled {"Sonic the Hedgehog"}else{"My reviewed title 0"}.into(),"My Genesis".into(),0,0));
            assert_eq!(rows[1].0,"My reviewed title 1");
        }
        let sandbox=Sandbox::new();let conn=library();let catalog=sandbox.catalog();
        let mut batch=sandbox.batch(&conn,&catalog,1,MediaOptions::default());
        batch.games[0].metadata.as_mut().unwrap().title="  ".into();
        apply_catalog_titles(&mut batch,true);assert_eq!(batch.games[0].candidate.title,"My reviewed title 0");
    }

    #[test]
    fn duplicates_are_checked_again_at_commit_and_existing_history_is_untouched() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let batch = sandbox.batch(&conn, &catalog, 1, options());
        let preview = batch.preview.clone();
        conn.execute("INSERT INTO games(title,platform,rom_path,play_time_seconds,session_count) VALUES ('Existing','My Genesis',?1,123,4)", [&preview.games[0].rom_path]).unwrap();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        let result = commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        assert_eq!(result.added_count, 0);
        assert_eq!(result.skipped_count, 3);
        let history: (String, i64, i64) = conn
            .query_row(
                "SELECT title,play_time_seconds,session_count FROM games",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(history, ("Existing".into(), 123, 4));
        assert_eq!(result.enrichment.unwrap().metadata_count, 0);
    }

    #[test]
    fn failed_commit_and_cancelled_commit_roll_back_rows_and_image_copies() {
        for cancel in [false, true] {
            let sandbox = Sandbox::new();
            let mut conn = library();
            let catalog = sandbox.catalog();
            let mut batch = sandbox.batch(&conn, &catalog, 2, options());
            let image = sandbox.job.directory.join("local.png");
            fs::write(&image, PNG).unwrap();
            batch.games[0].images.push(GameImage {
                path: image.to_string_lossy().into_owned(),
                kind: "cover".into(),
            });
            let preview = batch.preview.clone();
            if !cancel {
                fs::remove_file(&preview.games[1].rom_path).unwrap();
            }
            *sandbox.job.staged.lock().unwrap() = Some(batch);
            let result = commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| {
                if cancel {
                    sandbox.job.cancel().unwrap();
                }
            });
            assert!(result.is_err());
            assert_eq!(count(&conn), 0);
            assert!(files_in(&sandbox.root.join("images")).is_empty());
            assert!(image.exists());
        }
    }

    #[test]
    fn recovered_manuals_do_not_prevent_downloading_new_images() {
        let sandbox=Sandbox::new(); let mut conn=library(); let catalog=sandbox.catalog();
        let mut batch=sandbox.batch(&conn,&catalog,1,options());
        crate::media_library::init_schema(&conn).unwrap();
        let candidate=&batch.preview.games[0];
        conn.execute("INSERT INTO games(title,platform,rom_path,launch\u{0062}ox_id) VALUES ('Title','My Genesis',?1,1)",[&candidate.rom_path]).unwrap();
        let old=conn.last_insert_rowid();
        let (uuid,dir)=crate::media_library::ensure_game(&conn,&sandbox.root,old).unwrap();
        let folder=sandbox.root.join(&dir).join("manuals"); fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("Guide.pdf"),b"%PDF-1.7\nGuide\n%%EOF").unwrap();
        crate::media_library::preserve_before_delete(&mut conn,&sandbox.root,&[old as i32]).unwrap();
        crate::delete_game_records(&mut conn,&[old as i32]).unwrap();
        let count=batch.tasks.len(); assert!(count>0);
        let selection=crate::media_library::RecoverySelection{rom_path:candidate.rom_path.clone(),collection_id:Some(uuid.clone())};
        apply_media_recovery(&mut batch,&conn,&sandbox.root,&[selection]).unwrap();
        assert_eq!(batch.tasks.len(),count); assert_eq!(batch.games[0].media_collection_id,Some(uuid));
    }

    #[test]
    fn recovered_collections_skip_http_tasks_and_commit_without_copying_or_renaming_the_artwork() {
        let sandbox=Sandbox::new();let mut conn=library();let catalog=sandbox.catalog();
        let mut batch=sandbox.batch(&conn,&catalog,1,options());
        crate::media_library::init_schema(&conn).unwrap();
        let candidate=&batch.preview.games[0];
        conn.execute("INSERT INTO games(title,platform,rom_path,launch\u{0062}ox_id) VALUES ('Old title','My Genesis',?1,1)",[&candidate.rom_path]).unwrap();let old=conn.last_insert_rowid();
        let image=sandbox.root.join("images/1/disc.png");fs::create_dir_all(image.parent().unwrap()).unwrap();fs::write(&image,PNG).unwrap();
        conn.execute("INSERT INTO game_images VALUES (?1,'images/1/disc.png','disc',0)",[old]).unwrap();
        crate::media_library::preserve_before_delete(&mut conn,&sandbox.root,&[old as i32]).unwrap();
        let uuid:String=conn.query_row("SELECT media_collection_id FROM games WHERE id=?1",[old],|r|r.get(0)).unwrap();
        crate::delete_game_records(&mut conn,&[old as i32]).unwrap();
        assert!(!batch.tasks.is_empty());
        let selection=crate::media_library::RecoverySelection{rom_path:candidate.rom_path.clone(),collection_id:Some(uuid.clone())};
        apply_media_recovery(&mut batch,&conn,&sandbox.root,&[selection]).unwrap();assert!(batch.tasks.is_empty());
        // An unreachable image server is never contacted for a recovered game.
        assert!(download_batch(&mut batch,&sandbox.job,"http://127.0.0.1:1/",|_|{}).unwrap().failures.is_empty());
        let preview=batch.preview.clone();*sandbox.job.staged.lock().unwrap()=Some(batch);
        let result=commit_import(&mut conn,&sandbox.job,preview,"My Genesis",|_|{}).unwrap();assert_eq!(result.enrichment.unwrap().image_count,1);
        let (id,title,source):(i32,String,i64)=conn.query_row("SELECT id,title,launch\u{0062}ox_id FROM games",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(title,"My reviewed title 0");assert_eq!(source,1);
        let saved=crate::read_game_images(&conn,id).unwrap();assert_eq!(saved[0].kind,"disc");assert_eq!(saved[0].path,"images/1/disc.png");assert!(image.is_file());
    }

    #[test]
    fn database_errors_remove_new_image_files_and_roll_back_the_game() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let mut batch = sandbox.batch(&conn, &catalog, 1, options());
        let image = sandbox.job.directory.join("local.png");
        fs::write(&image, PNG).unwrap();
        batch.games[0].images.push(GameImage {
            path: image.to_string_lossy().into_owned(),
            kind: "cover".into(),
        });
        let preview = batch.preview.clone();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        conn.execute_batch("CREATE TRIGGER reject_image BEFORE INSERT ON game_images BEGIN SELECT RAISE(ABORT,'Test failure'); END;").unwrap();
        assert!(commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).is_err());
        assert_eq!(count(&conn), 0);
        assert!(files_in(&sandbox.root.join("images")).is_empty());
        assert!(image.exists());
    }

    #[test]
    fn a_prepared_batch_cannot_be_committed_with_changed_titles_or_platform() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let batch = sandbox.batch(&conn, &catalog, 1, options());
        let preview = batch.preview.clone();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        let mut changed = preview.clone();
        changed.games[0].title = "Changed after review".into();
        assert!(commit_import(&mut conn, &sandbox.job, changed, "My Genesis", |_| ()).is_err());
        assert!(
            commit_import(&mut conn, &sandbox.job, preview, "Another platform", |_| ()).is_err()
        );
        assert_eq!(count(&conn), 0);
    }

    #[test]
    fn unmatched_games_import_without_metadata_and_wrong_platform_matches_are_rejected() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let preview = sandbox.preview(1);
        let wrong = vec![MatchSelection {
            rom_path: preview.games[0].rom_path.clone(),
            id: Some(3),
        }];
        assert!(
            prepare_batch(
                &conn,
                &catalog,
                &sandbox.job,
                preview.clone(),
                "My Genesis".into(),
                "Sega Genesis",
                wrong,
                &options()
            )
            .is_err()
        );
        let batch = prepare_batch(
            &conn,
            &catalog,
            &sandbox.job,
            preview.clone(),
            "My Genesis".into(),
            "Sega Genesis",
            vec![],
            &options(),
        )
        .unwrap();
        assert!(batch.tasks.is_empty());
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        let result = commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        assert_eq!(result.added_count, 1);
        assert_eq!(result.enrichment.unwrap().metadata_count, 0);
    }

    #[test]
    fn migrations_are_repeatable_and_preserve_existing_values() {
        let conn = library();
        conn.execute("UPDATE platforms SET launch\u{0062}ox_platform='Sega Genesis'", [])
            .unwrap();
        init_library_schema(&conn).unwrap();
        let value: String = conn
            .query_row("SELECT launch\u{0062}ox_platform FROM platforms", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "Sega Genesis");
        let sandbox = Sandbox::new();
        assert!(sandbox._jobs.get("another-session").is_err());
        assert!(sandbox._jobs.start(sandbox.root.clone()).is_err());
    }

    fn editor_game(conn: &Connection) -> i32 {
        conn.execute("INSERT INTO games(title,platform,rom_path,description,play_time_seconds,session_count,launch\u{0062}ox_id)
            VALUES ('Custom title','My Genesis','C:/missing/game (Europe).rom','Custom description',123,4,1)", []).unwrap();
        conn.last_insert_rowid() as i32
    }

    fn bulk_games(conn: &Connection) -> Vec<i32> {
        let first = editor_game(conn);
        conn.execute("INSERT INTO games(title,platform,rom_path,play_time_seconds,session_count,launch\u{0062}ox_id) VALUES ('Second title','My Genesis','C:/missing/second.rom',222,7,1)", []).unwrap();
        vec![first, conn.last_insert_rowid() as i32]
    }

    fn screenshot_options() -> MediaOptions {
        MediaOptions { screenshot: 1, ..Default::default() }
    }

    #[test]
    fn bulk_downloads_add_new_images_for_selected_games_without_changing_metadata_or_history() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let ids = bulk_games(&conn);
        let old = sandbox.root.join("existing.png");
        fs::write(&old, PNG).unwrap();
        conn.execute("INSERT INTO game_images VALUES (?1,'existing.png','screenshot',0)", [ids[0]]).unwrap();
        let mut different = PNG.to_vec(); different.push(1);
        let server = MockServer::new(vec![
            ("screen-duplicate.png", vec![(200, PNG.to_vec())]),
            ("screen-1.png", vec![(200, PNG.to_vec())]),
            ("screen-2.png", vec![(200, different.clone())]),
        ], false);
        let report = download_bulk_images(&mut conn, &catalog, &sandbox.job, ids.clone(), &screenshot_options(), &server.base, |_| ()).unwrap();
        assert_eq!(report.image_count, 2);
        assert_eq!(report.results.len(), 2);
        assert!(report.results.iter().all(|result| result.added == 1));
        assert!(report.results.iter().all(|result| result.message.is_empty()));
        assert_eq!(super::super::read_game_images(&conn, ids[0]).unwrap().len(), 2);
        assert_eq!(super::super::read_game_images(&conn, ids[1]).unwrap().len(), 1);
        let details: (String, String, i64, i64) = conn.query_row("SELECT title,description,play_time_seconds,session_count FROM games WHERE id=?1", [ids[0]],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(details, ("Custom title".into(), "Custom description".into(), 123, 4));
        assert_eq!(fs::read(old).unwrap(), PNG);
        for id in ids {
            for image in super::super::read_game_images(&conn, id).unwrap() {
                assert!(!Path::new(&image.path).is_absolute());
                assert!(sandbox.root.join(image.path).is_file());
            }
        }
    }

    #[test]
    fn bulk_matching_uses_saved_choices_or_exact_platform_matches_and_reports_missing_games() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let ids = bulk_games(&conn);
        // A saved per-game choice works even when the local platform has another name.
        assert_eq!(bulk_image_match(&conn, &catalog, ids[0]).unwrap(), (1, "Sega Genesis".into()));
        conn.execute("UPDATE games SET launch\u{0062}ox_id=NULL,title='Sónic!' WHERE id=?1", [ids[0]]).unwrap();
        assert!(bulk_image_match(&conn, &catalog, ids[0]).is_err());
        conn.execute("UPDATE platforms SET launch\u{0062}ox_platform='Sega Genesis'", []).unwrap();
        assert_eq!(bulk_image_match(&conn, &catalog, ids[0]).unwrap().0, 1);
        conn.execute("UPDATE games SET title='Ambiguous' WHERE id=?1", [ids[0]]).unwrap();
        conn.execute("UPDATE games SET launch\u{0062}ox_id=NULL,title='No match' WHERE id=?1", [ids[1]]).unwrap();
        let report = download_bulk_images(&mut conn, &catalog, &sandbox.job, ids, &screenshot_options(), "http://127.0.0.1:1/", |_| ()).unwrap();
        assert_eq!(report.image_count, 0);
        assert_eq!(report.results.len(), 2);
        assert!(report.results.iter().all(|result| result.message.contains("coincidencia")));
    }

    #[test]
    fn cancelling_a_bulk_download_preserves_completed_games_and_skips_remaining_games() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let ids = bulk_games(&conn);
        let server = MockServer::new(vec![("screen-duplicate.png", vec![(200, PNG.to_vec())])], false);
        let report = download_bulk_images(&mut conn, &catalog, &sandbox.job, ids.clone(), &screenshot_options(), &server.base, |update| {
            if update.phase == "bulk_images" && update.processed == 1 { sandbox.job.cancel().unwrap(); }
        }).unwrap();
        assert!(report.cancelled);
        assert_eq!(report.image_count, 1);
        assert_eq!(report.results.len(), 1);
        assert_eq!(super::super::read_game_images(&conn, ids[0]).unwrap().len(), 1);
        assert!(super::super::read_game_images(&conn, ids[1]).unwrap().is_empty());
        assert_eq!(server.seen.lock().unwrap().len(), 1);
    }

    #[test]
    fn bulk_image_commit_rolls_back_rows_and_cleans_new_files_after_a_database_failure() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let id = editor_game(&conn);
        let source = sandbox.job.directory.join("screen.png");
        fs::write(&source, PNG).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_bulk_image BEFORE INSERT ON game_images BEGIN SELECT RAISE(ABORT,'Failure'); END;").unwrap();
        assert!(append_bulk_images(&mut conn, &sandbox.job, id, &[GameImage { path: source.to_string_lossy().into_owned(), kind: "screenshot".into() }], None).is_err());
        assert!(super::super::read_game_images(&conn, id).unwrap().is_empty());
        assert!(files_in(&sandbox.root.join("images")).is_empty());
    }

    #[test]
    fn cancelling_during_a_game_never_saves_an_incomplete_set_of_images() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let ids = bulk_games(&conn);
        let server = MockServer::new(vec![("screen-duplicate.png", vec![(200, PNG.to_vec())])], false);
        let report = download_bulk_images(&mut conn, &catalog, &sandbox.job, ids.clone(), &screenshot_options(), &server.base, |update| {
            if update.phase == "images" { sandbox.job.cancel().unwrap(); }
        }).unwrap();
        assert!(report.cancelled);
        assert_eq!(report.image_count, 0);
        assert!(report.results.is_empty());
        assert!(super::super::read_game_images(&conn, ids[0]).unwrap().is_empty());
        assert!(files_in(&sandbox.root.join("images")).is_empty());
    }

    #[test]
    fn bulk_downloads_keep_primary_images_and_continue_after_a_failed_candidate() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let id = editor_game(&conn);
        let existing = vec![GameImage { path: "cover.png".into(), kind: "cover".into() }, GameImage { path: "logo.png".into(), kind: "logo".into() }];
        let mut batch = prepare_editor_images(&conn, &catalog, &sandbox.job, id, 1, "Sega Genesis", &options(), Some(&existing)).unwrap();
        assert!(batch.tasks.iter().all(|task| !["cover", "logo"].contains(&task.image.kind.as_str())));
        let server = MockServer::new(vec![("screen-duplicate.png", vec![(503, b"Unavailable".to_vec())]), ("screen-2.png", vec![(200, PNG.to_vec())])], false);
        download_additional_images(&mut batch, &screenshot_options(), &existing, &sandbox.job, &server.base, |_| ()).unwrap();
        assert_eq!(batch.games[0].images.len(), 1);
        assert_eq!(download_report(&batch).failures.len(), 1);
    }

    #[test]
    fn editor_images_do_not_require_an_available_rom_or_modify_game_metadata() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let id = editor_game(&conn);
        let batch = prepare_editor_batch(
            &conn,
            &catalog,
            &sandbox.job,
            id,
            1,
            "Sega Genesis",
            &options(),
        )
        .unwrap();
        assert_eq!(batch.tasks.len(), 4);
        assert_eq!(batch.tasks[0].image.filename, "cover-eu.png");
        assert!(batch.games[0].metadata.is_none());
        assert!(!Path::new(&batch.games[0].candidate.rom_path).exists());
        let stored: (String, String, i64, i64) = conn
            .query_row(
                "SELECT title,description,play_time_seconds,session_count FROM games WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            stored,
            ("Custom title".into(), "Custom description".into(), 123, 4)
        );
        assert!(
            prepare_editor_batch(
                &conn,
                &catalog,
                &sandbox.job,
                999,
                1,
                "Sega Genesis",
                &options()
            )
            .is_err()
        );
        assert!(
            prepare_editor_batch(
                &conn,
                &catalog,
                &sandbox.job,
                id,
                3,
                "Sega Genesis",
                &options()
            )
            .is_err()
        );
    }

    #[test]
    fn editor_reports_omit_images_with_identical_content_in_the_current_draft() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let id = editor_game(&conn);
        let mut batch = prepare_editor_batch(
            &conn,
            &catalog,
            &sandbox.job,
            id,
            1,
            "Sega Genesis",
            &options(),
        )
        .unwrap();
        let old_image = sandbox.root.join("original.png");
        fs::write(&old_image, PNG).unwrap();
        let same = batch.tasks[0].path.clone();
        fs::write(&same, PNG).unwrap();
        let different = batch.tasks[1].path.clone();
        let mut other = PNG.to_vec();
        other.push(1);
        fs::write(&different, &other).unwrap();
        for (index, path) in [same, different].iter().enumerate() {
            batch.tasks[index].done = true;
            batch.games[0].images.push(GameImage {
                path: path.to_string_lossy().into_owned(),
                kind: batch.tasks[index].image.kind.clone(),
            });
        }
        let existing = vec![GameImage {
            path: old_image.to_string_lossy().into_owned(),
            kind: "cover".into(),
        }];
        let report = editor_image_report(&batch, &existing, &sandbox.job).unwrap();
        assert_eq!(report.image_count, 2);
        assert_eq!(report.images.len(), 1);
        assert_eq!(report.images[0].kind, "logo");
        let mut all = existing;
        all.extend(report.images);
        assert!(
            editor_image_report(&batch, &all, &sandbox.job)
                .unwrap()
                .images
                .is_empty()
        );
        assert_eq!(crate::read_game_images(&conn, id).unwrap().len(), 0);
    }

    #[test]
    fn separate_editor_download_rounds_preserve_earlier_draft_files() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let id = editor_game(&conn);
        let first = prepare_editor_batch(
            &conn,
            &catalog,
            &sandbox.job,
            id,
            1,
            "Sega Genesis",
            &options(),
        )
        .unwrap();
        fs::write(&first.tasks[0].path, PNG).unwrap();
        let next = prepare_editor_batch(
            &conn,
            &catalog,
            &sandbox.job,
            id,
            1,
            "Sega Genesis",
            &options(),
        )
        .unwrap();
        assert_ne!(first.tasks[0].path, next.tasks[0].path);
        fs::write(&next.tasks[0].path, b"failed request").unwrap();
        fs::remove_file(&next.tasks[0].path).unwrap();
        assert_eq!(fs::read(&first.tasks[0].path).unwrap(), PNG);
    }

    #[test]
    fn saving_editor_downloads_creates_portable_images_without_changing_history() {
        let sandbox = Sandbox::new();
        let mut conn = library();
        let catalog = sandbox.catalog();
        let id = editor_game(&conn);
        let batch = prepare_editor_batch(
            &conn,
            &catalog,
            &sandbox.job,
            id,
            1,
            "Sega Genesis",
            &options(),
        )
        .unwrap();
        let source = &batch.tasks[0].path;
        fs::write(source, PNG).unwrap();
        let details = crate::GameDetails { order_group:None, box_3d:None, regions: None, variables: None, execution: None, discs: None,
            manuals: None,
            id,
            title: "Custom title".into(),
            platform: "My Genesis".into(),
            release_date: None,
            developer: None,
            publisher: None,
            genre: None,
            game_mode: None,
            max_players: None,
            description: Some("Custom description".into()),
            catalog_id: None,
            images: Some(vec![GameImage {
                path: source.to_string_lossy().into_owned(),
                kind: "cover".into(),
            }]),
        };
        let saved = crate::save_game_with_media(&mut conn, details, &sandbox.root).unwrap();
        fs::remove_file(source).unwrap();
        assert_eq!(saved.title, "Custom title");
        assert_eq!(saved.description.as_deref(), Some("Custom description"));
        assert_eq!(saved.play_time_seconds, 123);
        assert_eq!(saved.session_count, 4);
        assert!(Path::new(&saved.images[0].path).is_file());
        let linked_id: i64 = conn
            .query_row("SELECT launch\u{0062}ox_id FROM games WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(linked_id, 1);
    }

    struct MockServer {
        base: String,
        seen: Arc<Mutex<Vec<String>>>,
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }
    impl MockServer {
        fn parallel(gate: Arc<AtomicBool>) -> (Self, Arc<AtomicUsize>) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = format!("http://{}/", listener.local_addr().unwrap());
            let seen = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(AtomicBool::new(false));
            let active = Arc::new(AtomicUsize::new(0));
            let peak = Arc::new(AtomicUsize::new(0));
            let (captured, stopped, maximum) = (seen.clone(), stop.clone(), peak.clone());
            let thread = thread::spawn(move || {
                std::thread::scope(|scope| {
                    while !stopped.load(Ordering::Acquire) {
                        let Ok((mut stream, _)) = listener.accept() else {
                            thread::sleep(Duration::from_millis(5));
                            continue;
                        };
                        let (seen, stop, active, peak, gate) = (
                            captured.clone(),
                            stopped.clone(),
                            active.clone(),
                            maximum.clone(),
                            gate.clone(),
                        );
                        scope.spawn(move || {
                            // Accepted sockets can inherit nonblocking mode on Windows.
                            stream.set_nonblocking(false).unwrap();
                            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                            let mut request = Vec::new();
                            let mut buffer = [0u8; 1024];
                            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                                let size = stream.read(&mut buffer).unwrap_or(0);
                                if size == 0 {
                                    return;
                                }
                                request.extend_from_slice(&buffer[..size]);
                            }
                            let path = String::from_utf8_lossy(&request)
                                .split_whitespace().nth(1).unwrap_or("/")
                                .trim_start_matches('/').to_owned();
                            seen.lock().unwrap().push(path);
                            peak.fetch_max(active.fetch_add(1, Ordering::AcqRel) + 1, Ordering::AcqRel);
                            let header = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", PNG.len());
                            let _ = stream.write_all(header.as_bytes());
                            while !gate.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                                thread::sleep(Duration::from_millis(5));
                            }
                            active.fetch_sub(1, Ordering::AcqRel);
                            if !stop.load(Ordering::Acquire) {
                                let _ = stream.write_all(PNG);
                            }
                        });
                    }
                })
            });
            (
                Self {
                    base,
                    seen,
                    stop,
                    thread: Some(thread),
                },
                peak,
            )
        }

        fn new(responses: Vec<(&str, Vec<(u16, Vec<u8>)>)>, stall: bool) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = format!("http://{}/", listener.local_addr().unwrap());
            let seen = Arc::new(Mutex::new(Vec::new()));
            let stop = Arc::new(AtomicBool::new(false));
            let mut responses: HashMap<String, VecDeque<_>> = responses
                .into_iter()
                .map(|(path, replies)| (path.into(), replies.into()))
                .collect();
            let captured = seen.clone();
            let stopped = stop.clone();
            let thread = thread::spawn(move || {
                while !stopped.load(Ordering::Acquire) {
                    let Ok((mut stream, _)) = listener.accept() else {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    };
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(2)))
                        .unwrap();
                    let mut request = [0u8; 4096];
                    let size = stream.read(&mut request).unwrap_or(0);
                    let text = String::from_utf8_lossy(&request[..size]);
                    let path = text
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or("/")
                        .trim_start_matches('/')
                        .to_string();
                    captured.lock().unwrap().push(path.clone());
                    let (status, body) = responses
                        .get_mut(&path)
                        .and_then(VecDeque::pop_front)
                        .unwrap_or((404, b"Missing".to_vec()));
                    let header = format!(
                        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(header.as_bytes());
                    if stall {
                        while !stopped.load(Ordering::Acquire) {
                            thread::sleep(Duration::from_millis(5));
                        }
                    } else {
                        let _ = stream.write_all(&body);
                    }
                }
            });
            Self {
                base,
                seen,
                stop,
                thread: Some(thread),
            }
        }
    }
    impl Drop for MockServer {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Release);
            self.thread.take().unwrap().join().unwrap();
        }
    }

    const PLATFORM_INDEX: &str = include_str!("../tests/fixtures/platform-index.html");
    const PLATFORM_IMAGES_HTML: &str = include_str!("../tests/fixtures/platform-images.html");

    #[test]
    fn public_platform_pages_use_canonical_links_full_images_and_explicit_types() {
        let values = platforms::parse_index(PLATFORM_INDEX);
        assert_eq!(values.len(), 2);
        assert_eq!(values[0].name, "Sega Genesis");
        assert_eq!(values[0].slug, "42-sega-genesis");
        let images = platforms::parse_images(PLATFORM_IMAGES_HTML);
        assert_eq!(images.len(), 3);
        assert_eq!(images[0].kind, "logo"); assert_eq!(images[0].filename, "platform-logo.png");
        assert_eq!(images[1].kind, "screenshot"); assert_eq!(images[1].filename, "platform-device.png");
        assert_eq!(images[2].kind, "artwork");
    }

    #[test]
    fn catalog_platform_metadata_keeps_dates_entities_and_absent_fields() {
        let sandbox = Sandbox::new(); let catalog = sandbox.catalog();
        let data = platforms::platform_metadata(&catalog, "Sega Genesis").unwrap();
        assert_eq!(data.release_date.as_deref(), Some("1988-10-29"));
        assert_eq!(data.developer.as_deref(), Some("Sega"));
        assert_eq!(data.manufacturer.as_deref(), Some("Sega & partners"));
        let conn = Connection::open_in_memory().unwrap(); catalog_schema(&conn).unwrap();
        let xml = b"<Metadata><Platform><Name>Missing data</Name><ReleaseDate>2026-02-30</ReleaseDate><Manufacturer>Maker</Manufacturer></Platform></Metadata>";
        read_records(BufReader::new(&xml[..]), &sandbox.job, |tag, fields| insert_record(&conn, tag, fields)).unwrap();
        let missing = platforms::platform_metadata(&conn, "Missing data").unwrap();
        assert!(missing.release_date.is_none()); assert!(missing.developer.is_none());
        assert_eq!(missing.manufacturer.as_deref(), Some("Maker"));
        assert!(platforms::platform_metadata(&conn, "Unknown").is_err());
    }

    #[test]
    fn old_catalogs_upgrade_platform_metadata_once_and_preserve_the_old_catalog_on_failure() {
        for fail in [false, true] {
            let sandbox = Sandbox::new(); drop(sandbox.catalog());
            Connection::open(sandbox.job.catalog_path()).unwrap().execute("DROP TABLE platform_metadata", []).unwrap();
            assert!(!platforms::catalog_has_platform_metadata(&sandbox.job.catalog_path()));
            let archive = fs::read(sandbox.zip(XML)).unwrap();
            let server = MockServer::new(vec![("catalog.zip", vec![if fail { (503,b"Offline".to_vec()) } else { (200,archive) }])], false);
            let url = format!("{}catalog.zip", server.base);
            let result = platforms::ensure_platform_metadata(&sandbox.job, &url, |_| ());
            assert_eq!(result.is_err(), fail);
            let catalog = open_catalog(&sandbox.job.catalog_path()).unwrap();
            assert!(!search_catalog(&catalog, "Sonic the Hedgehog", "Sega Genesis").unwrap().is_empty());
            if !fail {
                assert!(platforms::platform_metadata(&catalog, "Sega Genesis").unwrap().developer.is_some());
                platforms::ensure_platform_metadata(&sandbox.job, &url, |_| ()).unwrap();
            }
            assert_eq!(server.seen.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn empty_platform_galleries_are_distinguished_from_invalid_success_pages() {
        for (html, valid) in [("<html><div class='image-list'></div></html>", true), ("<html>Service unavailable</html>", false)] {
            let sandbox = Sandbox::new();
            let server = MockServer::new(vec![
                ("",vec![(200,PLATFORM_INDEX.as_bytes().to_vec())]),
                ("platforms/images/42-sega-genesis",vec![(200,html.as_bytes().to_vec())]),
            ], false);
            let result = platforms::prepare(&sandbox.job, "Sega Genesis", &options(), &server.base);
            assert_eq!(result.is_ok(), valid);
            if valid { assert!(result.unwrap().tasks.is_empty()); }
        }
    }

    #[test]
    #[ignore = "Reads a downloaded public Metadata.zip; never modifies the real library"]
    fn real_platform_metadata_smoke() {
        let path = std::env::var("OPENCABINET_CATALOG_ZIP").expect("Set OPENCABINET_CATALOG_ZIP");
        let sandbox = Sandbox::new(); let conn = Connection::open_in_memory().unwrap(); catalog_schema(&conn).unwrap();
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let input = archive.by_name("Platforms.xml").unwrap();
        read_records(BufReader::new(input), &sandbox.job, |tag, fields| insert_record(&conn, tag, fields)).unwrap();
        let ps2 = platforms::platform_metadata(&conn, "Sony Playstation 2").unwrap();
        assert_eq!(ps2.release_date.as_deref(), Some("2000-03-04"));
        assert!(ps2.developer.is_some()); assert!(ps2.manufacturer.is_some());
        eprintln!("PS2 metadata: {:?}", ps2);
    }

    fn platform_server(fail_photo: bool) -> MockServer {
        let mut photo = PNG.to_vec(); photo.extend_from_slice(b"Different console photo");
        let replies = if fail_photo { vec![(503, b"Unavailable".to_vec()), (200, photo)] } else { vec![(200, photo)] };
        MockServer::new(vec![
            ("", vec![(200, PLATFORM_INDEX.as_bytes().to_vec())]),
            ("platforms/images/42-sega-genesis", vec![(200, PLATFORM_IMAGES_HTML.as_bytes().to_vec())]),
            ("platform-logo.png", vec![(200, PNG.to_vec())]),
            ("platform-device.png", replies),
        ], false)
    }

    fn stage_platform_fixture(sandbox: &Sandbox, conn: &Connection, catalog: &Connection) -> ScanPreview {
        let mut selected = options(); selected.cover = 0; selected.logo = 0; selected.screenshot = 0;
        let batch = sandbox.batch(conn, catalog, 1, selected);
        let preview = batch.preview.clone();
        *sandbox.job.platform_import.lock().unwrap() = platforms::prepare_auto(conn, "My Genesis", "Sega Genesis").unwrap();
        *sandbox.job.staged.lock().unwrap() = Some(batch);
        preview
    }

    #[test]
    fn first_platform_import_downloads_images_retries_only_failures_and_commits_with_games() {
        let sandbox = Sandbox::new(); let mut conn = library(); let catalog = sandbox.catalog();
        let preview = stage_platform_fixture(&sandbox, &conn, &catalog);
        let server = platform_server(true);
        let mut first = DownloadReport { metadata_count: 1, image_count: 0, failures: vec![] };
        platforms::download_auto_from(&sandbox.job, &mut first, |_| (), &server.base, &server.base).unwrap();
        assert_eq!(first.image_count, 1); assert_eq!(first.failures.len(), 1);
        let mut retry = DownloadReport { metadata_count: 1, image_count: 0, failures: vec![] };
        platforms::download_auto_from(&sandbox.job, &mut retry, |_| (), &server.base, &server.base).unwrap();
        assert_eq!(retry.image_count, 2); assert!(retry.failures.is_empty());
        let seen = server.seen.lock().unwrap();
        assert_eq!(seen.iter().filter(|path| *path == "platform-logo.png").count(), 1);
        assert_eq!(seen.iter().filter(|path| *path == "platform-device.png").count(), 2);
        drop(seen);
        let result = commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        assert_eq!(result.added_count, 1); assert_eq!(result.enrichment.unwrap().image_count, 2);
        let saved = crate::platform_details::read(&conn, 1, &sandbox.root).unwrap();
        assert_eq!(saved.images.len(), 2); assert!(saved.images.iter().all(|image| Path::new(&image.path).is_file()));
        assert!(platforms::prepare_auto(&conn, "My Genesis", "Sega Genesis").unwrap().is_none());
    }

    #[test]
    fn platform_image_database_failure_rolls_back_games_and_managed_files() {
        let sandbox = Sandbox::new(); let mut conn = library(); let catalog = sandbox.catalog();
        crate::platform_details::init_schema(&conn).unwrap();
        let preview = stage_platform_fixture(&sandbox, &conn, &catalog); let server = platform_server(false);
        let mut report = DownloadReport { metadata_count: 1, image_count: 0, failures: vec![] };
        platforms::download_auto_from(&sandbox.job, &mut report, |_| (), &server.base, &server.base).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_platform_image BEFORE INSERT ON platform_images BEGIN SELECT RAISE(ABORT,'Failure'); END;").unwrap();
        assert!(commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).is_err());
        assert_eq!(count(&conn), 0); assert!(files_in(&sandbox.root.join("images")).is_empty());
        assert!(crate::platform_details::read(&conn, 1, &sandbox.root).unwrap().images.is_empty());
    }

    #[test]
    fn offline_platform_lookup_can_be_retried_or_skipped_without_losing_games() {
        let sandbox = Sandbox::new(); let mut conn = library(); let catalog = sandbox.catalog();
        let preview = stage_platform_fixture(&sandbox, &conn, &catalog);
        let server = MockServer::new(vec![("", vec![(503, b"Offline".to_vec())])], false);
        let mut report = DownloadReport { metadata_count: 1, image_count: 0, failures: vec![] };
        platforms::download_auto_from(&sandbox.job, &mut report, |_| (), &server.base, &server.base).unwrap();
        assert_eq!(report.failures.len(), 1);
        let result = commit_import(&mut conn, &sandbox.job, preview, "My Genesis", |_| ()).unwrap();
        assert_eq!(result.added_count, 1); assert_eq!(result.enrichment.unwrap().failed_image_count, 1);
    }

    #[test]
    #[ignore = "Downloads one public console image; never modifies the real library"]
    fn real_platform_image_smoke() {
        let sandbox = Sandbox::new(); let mut selected = options(); selected.cover = 0;
        let mut batch = platforms::prepare(&sandbox.job, "Super Nintendo Entertainment System", &selected, crate::catalog_compat::SITE).unwrap();
        assert!(batch.tasks.iter().any(|task| task.image.kind == "screenshot"));
        let report = download_batch(&mut batch, &sandbox.job, crate::catalog_compat::PLATFORM_IMAGE_BASE, |_| ()).unwrap();
        assert!(report.failures.is_empty(), "{:?}", report.failures); assert!(report.image_count > 0);
        eprintln!("{} console images downloaded and validated", report.image_count);
    }

    #[test]
    fn parallel_image_downloads_are_bounded_and_preserve_progress_and_carousel_order() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let mut batch = sandbox.batch(&conn, &catalog, 2, options());
        let gate = Arc::new(AtomicBool::new(false));
        let (server, peak) = MockServer::parallel(gate.clone());
        let mut processed = Vec::new();
        let report = std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                download_batch(&mut batch, &sandbox.job, &server.base, |progress| {
                    processed.push(progress.processed)
                })
            });
            let deadline = Instant::now() + Duration::from_secs(5);
            while peak.load(Ordering::Acquire) < IMAGE_DOWNLOAD_WORKERS && Instant::now() < deadline
            {
                thread::sleep(Duration::from_millis(5));
            }
            thread::sleep(Duration::from_millis(30));
            gate.store(true, Ordering::Release);
            worker.join().unwrap().unwrap()
        });
        assert_eq!(peak.load(Ordering::Acquire), 4);
        assert_eq!(server.seen.lock().unwrap().len(), batch.tasks.len(), "{:?}", report.failures);
        assert_eq!(
            report.image_count,
            batch.tasks.len(),
            "{:?}",
            report.failures
        );
        assert_eq!(
            processed,
            (0..=batch.tasks.len() as u64).collect::<Vec<_>>()
        );
        for (index, game) in batch.games.iter().enumerate() {
            let expected: Vec<_> = batch
                .tasks
                .iter()
                .filter(|task| task.game_index == index)
                .map(|task| task.path.to_string_lossy().into_owned())
                .collect();
            assert_eq!(
                game.images
                    .iter()
                    .map(|image| image.path.clone())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }

    #[test]
    fn cancellation_wakes_all_four_stalled_downloads_and_does_not_start_more() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let mut batch = sandbox.batch(&conn, &catalog, 2, options());
        let (server, peak) = MockServer::parallel(Arc::new(AtomicBool::new(false)));
        let outcome = std::thread::scope(|scope| {
            let (sender, receiver) = std::sync::mpsc::channel();
            let (batch, job, base) = (&mut batch, &sandbox.job, &server.base);
            scope.spawn(move || {
                sender
                    .send(download_batch(batch, job, base, |_| ()))
                    .unwrap();
            });
            let deadline = Instant::now() + Duration::from_secs(5);
            while peak.load(Ordering::Acquire) < 4 && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(5));
            }
            sandbox.job.cancel().unwrap();
            let outcome = receiver.recv_timeout(Duration::from_secs(2));
            server.stop.store(true, Ordering::Release); // Also unblock the mock if the assertion fails.
            outcome
        })
        .expect("all workers should stop promptly");
        assert_eq!(outcome.unwrap_err(), cancelled_message());
        assert_eq!(peak.load(Ordering::Acquire), 4);
        assert_eq!(server.seen.lock().unwrap().len(), 4);
        assert!(batch.tasks.iter().all(|task| !task.path.exists()));
        assert!(batch.games.iter().all(|game| game.images.is_empty()));
    }

    #[test]
    fn failed_images_can_be_retried_without_downloading_successful_images_again() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let mut config = options();
        config.screenshot = 0;
        let mut batch = sandbox.batch(&conn, &catalog, 1, config);
        let server = MockServer::new(
            vec![
                (
                    "cover-eu.png",
                    vec![(503, b"offline".to_vec()), (200, PNG.to_vec())],
                ),
                ("logo.png", vec![(200, PNG.to_vec())]),
            ],
            false,
        );
        let first = download_batch(&mut batch, &sandbox.job, &server.base, |_| ()).unwrap();
        assert_eq!(first.image_count, 1);
        assert_eq!(first.failures.len(), 1);
        let second = download_batch(&mut batch, &sandbox.job, &server.base, |_| ()).unwrap();
        assert_eq!(second.image_count, 2, "{:?}", second.failures);
        assert!(second.failures.is_empty());
        let mut requests = server.seen.lock().unwrap().clone();
        requests.sort();
        assert_eq!(requests, ["cover-eu.png", "cover-eu.png", "logo.png"]);
        assert_eq!(batch.games[0].images.len(), 2);
        assert_eq!(count(&conn), 0);
    }

    #[test]
    fn invalid_image_content_is_reported_and_cancellation_interrupts_a_stalled_download() {
        let sandbox = Sandbox::new();
        let conn = library();
        let catalog = sandbox.catalog();
        let mut config = options();
        config.logo = 0;
        config.screenshot = 0;
        let mut batch = sandbox.batch(&conn, &catalog, 1, config);
        let server = MockServer::new(
            vec![(
                "cover-eu.png",
                vec![(200, b"<html>not an image</html>".to_vec())],
            )],
            false,
        );
        let report = download_batch(&mut batch, &sandbox.job, &server.base, |_| ()).unwrap();
        assert_eq!(report.failures.len(), 1);
        assert_eq!(report.image_count, 0);
        assert!(!batch.tasks[0].path.exists());
        drop(server);
        let server = MockServer::new(vec![("stall.png", vec![(200, PNG.to_vec())])], true);
        let cancel_job = sandbox.job.clone();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            cancel_job.cancel().unwrap();
        });
        let start = Instant::now();
        let target = sandbox.job.directory.join("stall.png");
        let error = download(
            &http_client().unwrap(),
            &format!("{}stall.png", server.base),
            &target,
            MAX_IMAGE_BYTES,
            &sandbox.job,
            |_, _| (),
        )
        .unwrap_err();
        canceller.join().unwrap();
        assert_eq!(error, cancelled_message());
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(!target.exists());
        assert_eq!(count(&conn), 0);
    }

    #[test]
    #[ignore = "Requires a downloaded public Metadata.zip; never modifies the real library"]
    fn real_catalog_smoke() {
        let zip = PathBuf::from(
            std::env::var("OPENCABINET_CATALOG_ZIP").expect("Set OPENCABINET_CATALOG_ZIP"),
        );
        let sandbox = Sandbox::new();
        let started = Instant::now();
        build_catalog(&zip, &sandbox.job.catalog_path(), &sandbox.job, |_| ()).unwrap();
        let summary = catalog_summary(&sandbox.job.catalog_path()).unwrap();
        assert!(summary.game_count > 100_000);
        let catalog = open_catalog(&sandbox.job.catalog_path()).unwrap();
        let matches = search_catalog(&catalog, "Sonic the Hedgehog", "Sega Genesis").unwrap();
        assert!(matches.iter().any(|g| g.exact));
        let images: i64 = catalog
            .query_row(
                "SELECT COUNT(*) FROM images WHERE game_id=?1",
                [matches[0].game.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(images > 0);
        assert!(catalog_has_current_image_types(&sandbox.job.catalog_path()));
        let spine_count: i64 = catalog.query_row("SELECT COUNT(*) FROM images WHERE kind='spine'", [], |r| r.get(0)).unwrap();
        assert!(spine_count > 0);
        let matches = search_catalog(&catalog, "Dragon Ball Z: Budokai", "Sony Playstation 2").unwrap();
        let game = matches.iter().find(|g| g.exact).unwrap();
        let conn = library();
        let id = editor_game(&conn);
        let selected = MediaOptions { spine: 1, ..Default::default() };
        let batch = prepare_editor_batch(&conn, &catalog, &sandbox.job, id, game.game.id, "Sony Playstation 2", &selected).unwrap();
        assert_eq!(batch.tasks.len(), 1);
        assert_eq!(batch.tasks[0].image.kind, "spine");
        eprintln!("Public catalog: {spine_count} spines; selected {}", batch.tasks[0].image.filename);
        eprintln!(
            "Public catalog: {} games, {} platforms, {:?}",
            summary.game_count,
            summary.platforms.len(),
            started.elapsed()
        );
    }

    #[test]
    #[ignore = "Downloads one public image from metadata catalog; never modifies the real library"]
    fn real_image_smoke() {
        let sandbox = Sandbox::new();
        let filename = "41ba4239-f39b-4428-8568-4b09d46c23df.jpg";
        let destination = sandbox.job.directory.join(filename);
        download(
            &http_client().unwrap(),
            &format!("{IMAGE_BASE}{filename}"),
            &destination,
            MAX_IMAGE_BYTES,
            &sandbox.job,
            |_, _| (),
        )
        .unwrap();
        assert_eq!(crate::image_extension(&destination).unwrap(), "jpg");
        assert!(destination.metadata().unwrap().len() > 1000);
    }
    #[test]
    fn enriched_multidisc_import_searches_once_keeps_reviewed_title_and_saves_all_sources() {
        let sandbox=Sandbox::new();let catalog=sandbox.catalog();let mut conn=library();
        let mut preview=sandbox.preview(1);
        let first=preview.games[0].rom_path.clone(); let second=sandbox.root.join("Second (Disc 2).chd");fs::write(&second,b"second disc").unwrap();
        preview.games[0].discs=vec![crate::discs::source(&first),crate::discs::source(&second.to_string_lossy())];
        let mut batch=prepare_batch(&conn,&catalog,&sandbox.job,preview.clone(),"My Genesis".into(),"Sega Genesis",vec![MatchSelection{rom_path:first.clone(),id:Some(1)}],&MediaOptions::default()).unwrap();
        assert_eq!(batch.games.len(),1);batch.tasks.clear();
        *sandbox.job.staged.lock().unwrap()=Some(batch);
        commit_import(&mut conn,&sandbox.job,preview.clone(),"My Genesis",|_|{}).unwrap();
        let (id,title):(i64,String)=conn.query_row("SELECT id,title FROM games",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(title,preview.games[0].title);assert_eq!(crate::discs::read(&conn,id).unwrap().len(),2);
        assert_eq!(crate::discs::owner(&conn,&second.to_string_lossy()).unwrap(),Some(id));
    }

}
