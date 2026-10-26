//! Default artwork source and explicitly imported personal catalogs.
use super::*;
mod matching;
pub(super) use matching::{finish_search_results, search_candidate};
const ROOT_URL: &str = "https://api.github.com/repos/Utogu9/OpenCabinet-BDD/contents";
const RAW_URL: &str = "https://raw.githubusercontent.com/Utogu9/OpenCabinet-BDD/main/";
const CONFIG: &str = "metadata/source.json";
const MIN_REPOSITORY_ID: i64 = 1_000_000_000_000;

#[derive(Default, Serialize, Deserialize)]
struct Settings {
    #[serde(default)]
    personal: bool,
}
pub(super) fn personal(root: &Path) -> bool {
    fs::read(root.join(CONFIG))
        .ok()
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .is_some_and(|s| s.personal)
}
pub(super) fn path(root: &Path, local: bool) -> PathBuf {
    root.join(if local {
        "metadata/personal.db"
    } else {
        "metadata/opencabinet.db"
    })
}
pub(crate) fn repository_id(id: i64) -> bool {
    id <= -MIN_REPOSITORY_ID && id >= -9_007_199_254_740_991
}
pub(crate) fn init_matches(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS artwork_matches(game_id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS artwork_platforms(local_name TEXT PRIMARY KEY, source_platform TEXT NOT NULL);")
}
pub(super) fn platform_mapping(conn: &Connection, name: &str, local: bool) -> Option<String> {
    let sql = if local {
        "SELECT launch\u{0062}ox_platform FROM platforms WHERE LOWER(name)=LOWER(?1)"
    } else {
        "SELECT source_platform FROM artwork_platforms WHERE LOWER(local_name)=LOWER(?1)"
    };
    conn.query_row(sql, [name], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}
pub(super) fn record_platform(
    conn: &Connection,
    name: &str,
    source: &str,
    local: bool,
) -> Result<()> {
    if local {
        conn.execute(
            "UPDATE platforms SET launch\u{0062}ox_platform=?1 WHERE LOWER(name)=LOWER(?2)",
            params![source, name],
        )
        .map_err(err)?;
    } else {
        init_matches(conn).map_err(err)?;
        conn.execute("INSERT INTO artwork_platforms VALUES(?1,?2) ON CONFLICT(local_name) DO UPDATE SET source_platform=excluded.source_platform",params![name,source]).map_err(err)?;
    }
    Ok(())
}
pub(crate) fn record_match(conn: &Connection, game: i64, id: i64) -> Result<()> {
    if repository_id(id) {
        init_matches(conn).map_err(err)?;
        conn.execute("INSERT INTO artwork_matches VALUES (?1,?2) ON CONFLICT(game_id) DO UPDATE SET source_id=excluded.source_id",params![game,id]).map_err(err)?;
    } else {
        conn.execute(
            "UPDATE games SET launch\u{0062}ox_id=?1 WHERE id=?2",
            params![id, game],
        )
        .map_err(err)?;
    }
    Ok(())
}
pub(crate) fn match_id(conn: &Connection, game: i64, local: bool) -> Option<i64> {
    let sql = if local {
        "SELECT launch\u{0062}ox_id FROM games WHERE id=?1"
    } else {
        "SELECT source_id FROM artwork_matches WHERE game_id=?1"
    };
    conn.query_row(sql, [game], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}
fn catalog_is_repository(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='image_urls')",
        [],
        |r| r.get(0),
    )
    .unwrap_or(false)
}
pub(super) fn is_repository_catalog(conn: &Connection) -> bool {
    catalog_is_repository(conn)
}
pub(super) fn saved_match(conn: &Connection, catalog: &Connection, game: i64) -> Option<i64> {
    match_id(conn, game, !catalog_is_repository(catalog))
}
#[derive(Serialize)]
pub struct SourceStatus {
    personal: bool,
    label: String,
}
fn status(root: &Path) -> SourceStatus {
    let local = personal(root);
    SourceStatus {
        personal: local,
        label: if local {
            crate::i18n::text("source.personal").into()
        } else {
            "OpenCabinet-BDD".into()
        },
    }
}
#[tauri::command]
pub fn get_metadata_source() -> Result<SourceStatus> {
    Ok(status(&super::super::data_directory().map_err(err)?))
}
#[tauri::command]
pub async fn choose_metadata_catalog() -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title(crate::i18n::text("source.choose"))
            .add_filter(
                crate::i18n::text("source.catalog"),
                &["zip", "db", "sqlite", "sqlite3"],
            )
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(err)?
}
fn validate_personal(path: &Path) -> Result<()> {
    let conn = open_catalog(path)?;
    if conn
        .query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
        .map_err(err)?
        != "ok"
    {
        return Err(crate::i18n::text("source.invalid").into());
    }
    for query in [
        "SELECT id,title,platform,details FROM games LIMIT 1",
        "SELECT game_id,name,normalized FROM names LIMIT 1",
        "SELECT game_id,filename,kind,region,crc FROM images LIMIT 1",
        "SELECT name FROM platforms LIMIT 1",
        "SELECT downloaded_at FROM catalog_info LIMIT 1",
        "SELECT name FROM names_fts LIMIT 1",
    ] {
        conn.prepare(query)
            .map_err(|_| crate::i18n::text("source.invalid").to_string())?;
    }
    if catalog_is_repository(&conn)
        || conn
            .query_row("SELECT COUNT(*) FROM games WHERE id>0", [], |r| {
                r.get::<_, i64>(0)
            })
            .map_err(err)?
            == 0
    {
        return Err(crate::i18n::text("source.invalid").into());
    }
    let mut games = conn
        .prepare("SELECT id,platform,details FROM games")
        .map_err(err)?;
    for row in games
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?
    {
        let (id, platform, json) = row.map_err(err)?;
        let game: CatalogGame = serde_json::from_str(&json)
            .map_err(|_| crate::i18n::text("source.invalid").to_string())?;
        if id <= 0 || game.id != id || game.platform != platform || game.title.trim().is_empty() {
            return Err(crate::i18n::text("source.invalid").into());
        }
    }
    catalog_summary(path)?;
    Ok(())
}
#[tauri::command]
pub async fn set_metadata_catalog(
    catalog: Option<String>,
    on_progress: Channel<CatalogImportProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<SourceStatus> {
    let jobs = jobs.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = jobs.0.lock().map_err(err)?;
        if state.is_some() {
            return Err(crate::i18n::text("source.busy").into());
        }
        let root = super::super::data_directory().map_err(err)?;
        publish_selection_with_progress(&root, catalog.as_deref().map(Path::new), |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(err)?
}
#[derive(Serialize)]
pub struct CatalogImportProgress {
    phase: &'static str,
    processed: u64,
}
#[cfg(test)]
fn publish_selection(root: &Path, catalog: Option<&Path>) -> Result<SourceStatus> {
    publish_selection_with_progress(root, catalog, |_| ())
}
fn publish_selection_with_progress(
    root: &Path,
    catalog: Option<&Path>,
    mut progress: impl FnMut(CatalogImportProgress),
) -> Result<SourceStatus> {
    struct Scratch {
        directory: PathBuf,
        boundary: PathBuf,
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            if let Ok(path) = fs::canonicalize(&self.directory) {
                if path != self.boundary && path.starts_with(&self.boundary) {
                    let _ = fs::remove_dir_all(path);
                }
            }
        }
    }
    let boundary = root.join("metadata/staging");
    fs::create_dir_all(&boundary).map_err(err)?;
    let directory = boundary.join(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos()
            .to_string(),
    );
    fs::create_dir(&directory).map_err(err)?;
    let scratch = Scratch {
        directory,
        boundary: fs::canonicalize(boundary).map_err(err)?,
    };
    let next = scratch.directory.join("catalog.db");
    if let Some(file) = catalog {
        progress(CatalogImportProgress {
            phase: "validating",
            processed: 0,
        });
        let input = File::open(file).map_err(err)?;
        input.try_lock_shared().map_err(err)?;
        if file
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            if input.metadata().map_err(err)?.len() > 512 * 1024 * 1024 {
                return Err(crate::i18n::text("source.archive.too_large").into());
            }
            // A detached parser context supplies cancellation checks and a
            // private operation ID without taking the active-session lock.
            let parser_jobs = MetadataJobs::default();
            let parser = parser_jobs.start(root.to_owned())?;
            build_catalog(file, &next, &parser, |value| {
                progress(CatalogImportProgress {
                    phase: value.phase,
                    processed: value.processed,
                })
            })?;
        } else {
            validate_personal(file)?;
            fs::copy(file, &next).map_err(err)?;
        }
        drop(input);
        progress(CatalogImportProgress {
            phase: "validating",
            processed: 0,
        });
        validate_personal(&next)?;
    }
    progress(CatalogImportProgress {
        phase: "publishing",
        processed: 0,
    });
    let config = scratch.directory.join("source.json");
    fs::write(
        &config,
        serde_json::to_vec(&Settings {
            personal: catalog.is_some(),
        })
        .map_err(err)?,
    )
    .map_err(err)?;
    let target = path(root, true);
    let previous = target.with_extension("previous.db");
    let had_previous = target.exists();
    if catalog.is_some() {
        if previous.exists() {
            fs::remove_file(&previous).map_err(err)?;
        }
        if had_previous {
            fs::rename(&target, &previous).map_err(err)?;
        }
        if let Err(error) = fs::rename(&next, &target) {
            if had_previous {
                let _ = fs::rename(&previous, &target);
            }
            return Err(err(error));
        }
    }
    if let Err(error) = fs::rename(config, root.join(CONFIG)) {
        if catalog.is_some() {
            let _ = fs::remove_file(&target);
            if had_previous {
                let _ = fs::rename(&previous, &target);
            }
        }
        return Err(err(error));
    }
    if catalog.is_some() && had_previous {
        let _ = fs::remove_file(previous);
    }
    if let Some(cache) = SUMMARY_CACHE.get() {
        cache.lock().map_err(err)?.remove(&target);
    }
    Ok(status(root))
}

#[derive(Deserialize)]
struct DirectoryEntry {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
struct RepoCatalog {
    schema_version: u32,
    system: String,
    games: HashMap<String, RepoGame>,
    #[serde(default)]
    metadata: HashMap<String, super::repository_metadata::Record>,
    #[serde(default)]
    console_metadata: super::repository_metadata::Record,
}
#[derive(Deserialize)]
struct RepoGame {
    #[serde(default)]
    metadata_id: Option<String>,
    #[serde(default)]
    entries: Vec<RepoEntry>,
    #[serde(default)]
    images: HashMap<String, RepoImage>,
}
#[derive(Deserialize)]
struct RepoEntry {
    name: String,
}
#[derive(Deserialize)]
struct RepoImage {
    path: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    sources: Vec<RepoImageSource>,
}
#[derive(Deserialize)]
struct RepoImageSource {
    #[serde(default)]
    dat_name: String,
}

fn token(value: &str) -> i64 {
    let mut hash = 0xcbf29ce484222325u64;
    for b in value.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    -((hash % 8_000_000_000_000_000) as i64 + MIN_REPOSITORY_ID)
}
fn url_path(value: &str) -> String {
    let mut result = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/".contains(&b) {
            result.push(b as char)
        } else {
            result.push_str(&format!("%{b:02X}"));
        }
    }
    result
}
fn valid_relative(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('/')
        && !value.contains('\\')
        && !value.contains(':')
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn kind(value: &str) -> Option<String> {
    let base = value.trim_end_matches(|c: char| c.is_ascii_digit());
    let mapped = match base {
        "cover_front" => "cover",
        "cover_back" => "back_cover",
        "cover_full" => "box_full",
        "cart_label" => "cart_label",
        other => other,
    };
    valid_image_kind(mapped).then(|| mapped.into())
}
fn create_repository(conn: &Connection) -> Result<()> {
    catalog_schema(conn)?;
    conn.execute_batch("CREATE TABLE image_urls(filename TEXT PRIMARY KEY,url TEXT NOT NULL);CREATE TABLE repository_keys(id INTEGER PRIMARY KEY,source_key TEXT UNIQUE NOT NULL);CREATE TABLE ready_platforms(name TEXT PRIMARY KEY);CREATE INDEX idx_names_normalized ON names(normalized);CREATE INDEX idx_games_platform ON games(platform);CREATE INDEX idx_images_game ON images(game_id);CREATE VIRTUAL TABLE names_fts USING fts5(name,content='names',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');INSERT INTO catalog_info VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'));").map_err(err)
}
fn metadata_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_versions(name TEXT PRIMARY KEY,version INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS repository_console_metadata(name TEXT PRIMARY KEY,details TEXT NOT NULL);CREATE TABLE IF NOT EXISTS repository_platform_images(platform TEXT NOT NULL,filename TEXT PRIMARY KEY,kind TEXT NOT NULL,region TEXT NOT NULL,crc TEXT NOT NULL);").map_err(err)
}
pub(super) fn prepare(
    job: &ImportJob,
    refresh: bool,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<CatalogSummary> {
    if job.personal_catalog {
        let path = job.catalog_path();
        recover_catalog(&path)?;
        return cached_catalog_summary(&path);
    }
    let path = job.catalog_path();
    recover_catalog(&path)?;
    if refresh || !path.exists() {
        let index = job.directory.join("repository-index.json");
        download(
            &http_client()?,
            ROOT_URL,
            &index,
            2 * 1024 * 1024,
            job,
            |n, total| progress(job.progress("catalog", n, total, None)),
        )?;
        let entries: Vec<DirectoryEntry> =
            serde_json::from_reader(BufReader::new(File::open(index).map_err(err)?))
                .map_err(err)?;
        let next = job.directory.join("repository.next.db");
        let _ = fs::remove_file(&next);
        if path.exists() {
            fs::copy(&path, &next).map_err(err)?;
        }
        let conn = Connection::open(&next).map_err(err)?;
        if !path.exists() {
            create_repository(&conn)?;
        }
        for entry in entries
            .into_iter()
            .filter(|e| e.kind == "dir" && !e.name.starts_with('.'))
        {
            if valid_relative(&entry.name) && !entry.name.contains('/') {
                conn.execute("INSERT OR IGNORE INTO platforms VALUES(?1)", [entry.name])
                    .map_err(err)?;
            }
        }
        if refresh {
            conn.execute("DELETE FROM ready_platforms", [])
                .map_err(err)?;
            metadata_schema(&conn)?;
            conn.execute("DELETE FROM repository_versions",[]).map_err(err)?;
        }
        conn.execute(
            "UPDATE catalog_info SET downloaded_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')",
            [],
        )
        .map_err(err)?;
        drop(conn);
        job.check()?;
        replace_catalog(&next, &path)?;
    }
    cached_catalog_summary(&path)
}
fn insert_platform(
    conn: &mut Connection,
    job: &ImportJob,
    source: &str,
    file: &Path,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    let data: RepoCatalog =
        serde_json::from_reader(BufReader::new(File::open(file).map_err(err)?)).map_err(err)?;
    if data.schema_version != 2 || data.system != source {
        return Err(crate::i18n::text("source.invalid").into());
    }
    let tx = conn.transaction().map_err(err)?;
    metadata_schema(&tx)?;
    let mut console_localized=serde_json::Map::new();
    for locale in ["es", "en"] {
        let values=data.console_metadata.values(locale,None,&[]);
        console_localized.insert(locale.into(),serde_json::json!({"name":source,"release_date":values.release_date,"developer":values.developer,"manufacturer":values.manufacturer}));
    }
    tx.execute("INSERT OR REPLACE INTO repository_console_metadata VALUES(?1,?2)",params![source,serde_json::to_string(&console_localized).map_err(err)?]).map_err(err)?;
    tx.execute("DELETE FROM image_urls WHERE filename IN (SELECT filename FROM images WHERE game_id IN (SELECT id FROM games WHERE platform=?1))",[source]).map_err(err)?;
    for table in ["images", "names"] {
        tx.execute(
            &format!(
                "DELETE FROM {table} WHERE game_id IN (SELECT id FROM games WHERE platform=?1)"
            ),
            [source],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM games WHERE platform=?1", [source])
        .map_err(err)?;
    let total = data.games.len() as u64;
    for (i, (serial, game)) in data.games.into_iter().enumerate() {
        job.check()?;
        if i % 100 == 0 {
            progress(job.progress("indexing", i as u64, Some(total), Some(source.into())));
        }
        if !valid_relative(&serial) || serial.contains('/') || game.entries.is_empty() {
            continue;
        }
        let key = format!("{source}/{serial}");
        let id = token(&key);
        let title = game.entries[0].name.trim().to_string();
        if title.is_empty() {
            continue;
        }
        let details = CatalogGame {
            id,
            title: title.clone(),
            platform: source.into(),
            release_date: None,
            developer: None,
            publisher: None,
            genre: None,
            game_mode: None,
            max_players: None,
            description: None,
        };
        let metadata=game.metadata_id.as_ref().and_then(|id|data.metadata.get(id));
        let mut json=serde_json::to_value(&details).map_err(err)?;
        if let Some(metadata)=metadata {
            let region=rom_regions(&game.entries[0].name);
            let mut languages=serde_json::Map::new();
            for locale in ["es", "en"] {
                let fields=metadata.values(locale,data.console_metadata.entity(),&region);
                let mut localized=serde_json::to_value(&fields).map_err(err)?;
                let object=localized.as_object_mut().unwrap();
                object.remove("manufacturer");
                object.insert("id".into(),id.into());object.insert("title".into(),title.clone().into());object.insert("platform".into(),source.into());
                languages.insert(locale.into(),localized);
            }
            json["_localized"]=languages.into();
        }
        tx.execute(
            "INSERT OR IGNORE INTO repository_keys VALUES(?1,?2)",
            params![id, key],
        )
        .map_err(err)?;
        let saved: String = tx
            .query_row(
                "SELECT source_key FROM repository_keys WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if saved != key {
            return Err(crate::i18n::text("source.invalid").into());
        }
        tx.execute(
            "INSERT INTO games VALUES(?1,?2,?3,?4)",
            params![
                id,
                title,
                source,
                serde_json::to_string(&json).map_err(err)?
            ],
        )
        .map_err(err)?;
        let mut names = HashSet::from([serial.clone()]);
        if let Some(metadata)=metadata { for name in metadata.labels.values() { names.insert(name.clone()); } }
        for entry in &game.entries {
            names.insert(entry.name.clone());
            names.insert(super::super::clean_rom_title(&entry.name));
        }
        for name in names {
            tx.execute(
                "INSERT INTO names VALUES(?1,?2,?3)",
                params![id, name, normalize(&name)],
            )
            .map_err(err)?;
        }
        for (image_kind, image) in game.images {
            let Some(kind) = kind(if image.kind.is_empty() {
                &image_kind
            } else {
                &image.kind
            }) else {
                continue;
            };
            if !valid_relative(&image.path) || !image.path.starts_with(&format!("{serial}/")) {
                continue;
            }
            let filename = format!("repo-{}.webp", -token(&format!("{source}/{}", image.path)));
            let url = format!("{RAW_URL}{}", url_path(&format!("{source}/{}", image.path)));
            let names = image
                .sources
                .iter()
                .map(|s| s.dat_name.as_str())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            let region = names
                .iter()
                .find_map(|n| rom_regions(n).first().copied())
                .unwrap_or("World")
                .to_string();
            tx.execute(
                "INSERT INTO images VALUES(?1,?2,?3,?4,?5)",
                params![id, filename, kind, region, image.sha256],
            )
            .map_err(err)?;
            tx.execute(
                "INSERT INTO image_urls VALUES(?1,?2)",
                params![filename, url],
            )
            .map_err(err)?;
        }
    }
    tx.execute(
        "INSERT OR REPLACE INTO ready_platforms VALUES(?1)",
        [source],
    )
    .map_err(err)?;
    tx.execute("INSERT OR REPLACE INTO repository_versions VALUES(?1,1)",[source]).map_err(err)?;
    tx.execute("INSERT INTO names_fts(names_fts) VALUES('rebuild')", [])
        .map_err(err)?;
    tx.commit().map_err(err)
}
pub(super) fn ensure_platform(
    job: &ImportJob,
    source: &str,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    if job.personal_catalog {
        return Ok(());
    }
    prepare(job, false, &mut progress)?;
    let path = job.catalog_path();
    let conn = open_catalog(&path)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ready_platforms WHERE name=?1)",
            [source],
            |r| r.get(0),
        )
        .map_err(err)?;
    let current = conn.query_row("SELECT version FROM repository_versions WHERE name=?1",[source],|r|r.get::<_,i64>(0)).ok()==Some(1);
    if exists && current {
        return Ok(());
    }
    if !valid_relative(source)
        || source.contains('/')
        || !conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM platforms WHERE name=?1)",
                [source],
                |r| r.get::<_, bool>(0),
            )
            .map_err(err)?
    {
        return Err(crate::i18n::text("source.invalid").into());
    }
    drop(conn);
    let json = job.directory.join("platform-catalog.json");
    download(
        &http_client()?,
        &format!("{RAW_URL}{}/catalog.json", url_path(source)),
        &json,
        256 * 1024 * 1024,
        job,
        |n, t| progress(job.progress("catalog", n, t, Some(source.into()))),
    )?;
    let next = job.directory.join("platform.next.db");
    fs::copy(&path, &next).map_err(err)?;
    let mut conn = Connection::open(&next).map_err(err)?;
    insert_platform(&mut conn, job, source, &json, &mut progress)?;
    drop(conn);
    job.check()?;
    replace_catalog(&next, &path)?;
    job.image_urls.lock().map_err(err)?.clear();
    let _ = fs::remove_file(json);
    Ok(())
}
pub(super) fn equivalent_platform(job: &ImportJob, local: &str) -> Result<Option<String>> {
    let summary = cached_catalog_summary(&job.catalog_path())?;
    Ok(summary.platforms.into_iter().find(|p| {
        crate::platform_defaults::equivalent(&canonical_platform(p), &canonical_platform(local))
    }))
}
fn canonical_platform(value: &str) -> String {
    value
        .replace("Nintendo - Nintendo ", "Nintendo ")
        .replace("Nintendo - Super Nintendo ", "Super Nintendo ")
}
pub(super) fn regional_match(
    catalog: &Connection,
    candidates: &[SearchResult],
    path: &str,
) -> Result<Option<i64>> {
    if !catalog_is_repository(catalog) {
        return Ok(None);
    }
    let filename = matching::rom_name(path);
    let region = rom_regions(path);
    for full_name in [true, false] {
        if !full_name && region.is_empty() {
            break;
        }
        let mut matched = Vec::new();
        for candidate in candidates.iter().filter(|c| c.exact) {
            let mut stmt = catalog
                .prepare("SELECT name FROM names WHERE game_id=?1")
                .map_err(err)?;
            let names = stmt
                .query_map([candidate.game.id], |r| r.get::<_, String>(0))
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            if names.iter().any(|name| {
                if full_name {
                    !filename.is_empty() && normalize(name) == normalize(&filename)
                } else {
                    rom_regions(name).first() == region.first()
                }
            }) {
                matched.push(candidate.game.id);
            }
        }
        if matched.len() == 1 {
            return Ok(matched.first().copied());
        }
        if matched.len() > 1 {
            let titles: HashSet<_> = candidates.iter().filter(|candidate| matched.contains(&candidate.game.id))
                .map(|candidate| normalize(&candidate.game.title)).collect();
            if titles.len() == 1 || (full_name && (filename.contains('(') || filename.contains('['))) {
                return Ok(matching::shortest_match(candidates, &matched));
            }
        }
    }
    Ok(None)
}
pub(super) fn ensure_hint(
    job: &ImportJob,
    source: Option<&str>,
    progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    if job.personal_catalog {
        return Ok(());
    }
    let source = source.map(str::to_string).or_else(|| {
        job.platform_hint
            .lock()
            .ok()
            .and_then(|p| p.clone())
            .and_then(|p| equivalent_platform(job, &p).ok().flatten())
    });
    if let Some(source) = source {
        ensure_platform(job, &source, progress)?;
    }
    Ok(())
}
pub(super) fn ensure_games(
    job: &ImportJob,
    ids: &[i32],
    mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    if job.personal_catalog {
        return Ok(());
    }
    let conn = super::super::get_db_connection().map_err(err)?;
    let mut platforms = HashSet::new();
    for id in ids {
        if let Ok(p) = conn.query_row("SELECT platform FROM games WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        }) {
            let mapping = platform_mapping(&conn, &p, false);
            if let Some(p) = mapping
                .filter(|m| {
                    cached_catalog_summary(&job.catalog_path())
                        .is_ok_and(|c| c.platforms.contains(m))
                })
                .or(equivalent_platform(job, &p)?)
            {
                platforms.insert(p);
            }
        }
    }
    for p in platforms {
        ensure_platform(job, &p, &mut progress)?;
    }
    Ok(())
}
pub(super) fn image_url(job: &ImportJob, base: &str, filename: &str) -> Result<String> {
    if job.personal_catalog || (base != IMAGE_BASE && base != platforms::PLATFORM_IMAGES) {
        return Ok(format!("{base}{filename}"));
    }
    let mut urls = job.image_urls.lock().map_err(err)?;
    if !urls.contains_key(filename) {
        let conn = open_catalog(&job.catalog_path())?;
        let mut stmt = conn
            .prepare("SELECT filename,url FROM image_urls")
            .map_err(err)?;
        for row in stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(err)?
        {
            let (k, v) = row.map_err(err)?;
            urls.insert(k, v);
        }
    }
    urls.get(filename)
        .cloned()
        .ok_or_else(|| crate::i18n::text("source.invalid").into())
}

#[derive(Deserialize)]
struct ConsoleArtwork {
    schema_version: u32,
    system: String,
    #[serde(default)]
    images: HashMap<String, RepoImage>,
}
fn insert_console_artwork(conn: &mut Connection, source: &str, file: &Path) -> Result<()> {
    let data: ConsoleArtwork=serde_json::from_reader(BufReader::new(File::open(file).map_err(err)?)).map_err(err)?;
    if data.schema_version!=1 || data.system!=source { return Err(crate::i18n::text("source.invalid").into()); }
    let tx=conn.transaction().map_err(err)?;
    metadata_schema(&tx)?;
    tx.execute("DELETE FROM image_urls WHERE filename IN (SELECT filename FROM repository_platform_images WHERE platform=?1)",[source]).map_err(err)?;
    tx.execute("DELETE FROM repository_platform_images WHERE platform=?1",[source]).map_err(err)?;
    for (key,image) in data.images {
        if !valid_relative(&image.path) || image.path.contains('/') { continue; }
        let kind=match if image.kind.is_empty(){key.as_str()}else{image.kind.as_str()} {
            "logo" if matches!(image.path.as_str(),"logo.svg"|"logo.webp"|"logo.png"|"logo.jpg"|"logo.jpeg")=>"logo",
            "render"|"screenshot"=>"screenshot", "artwork"|"fanart"=>"artwork", _=>"other",
        };
        let extension=Path::new(&image.path).extension().and_then(|s|s.to_str()).unwrap_or("");
        if !["svg","webp","png","jpg","jpeg"].contains(&extension) { continue; }
        let filename=console_image_filename(source,&image.path);
        tx.execute("INSERT INTO repository_platform_images VALUES(?1,?2,?3,'World',?4)",params![source,filename,kind,image.sha256]).map_err(err)?;
        tx.execute("INSERT OR REPLACE INTO image_urls VALUES(?1,?2)",params![filename,format!("{RAW_URL}{}",url_path(&format!("{source}/{}",image.path)))]).map_err(err)?;
    }
    tx.execute("INSERT OR REPLACE INTO repository_versions VALUES(?1,2)",[format!("artwork:{source}")]).map_err(err)?;
    tx.commit().map_err(err)
}
pub(super) fn console_images(job: &ImportJob, source: &str) -> Result<Vec<CatalogImage>> {
    prepare(job,false,|_|())?;
    let path=job.catalog_path();
    let conn=open_catalog(&path)?;
    if !valid_relative(source) || source.contains('/') || !conn.query_row("SELECT EXISTS(SELECT 1 FROM platforms WHERE name=?1)",[source],|r|r.get::<_,bool>(0)).map_err(err)? {
        return Err(crate::i18n::text("source.invalid").into());
    }
    let cached=conn.query_row("SELECT version FROM repository_versions WHERE name=?1",[format!("artwork:{source}")],|r|r.get::<_,i64>(0)).ok()==Some(2);
    drop(conn);
    if !cached {
        let file=job.directory.join("console-artwork.json");
        download(&http_client()?,&format!("{RAW_URL}{}/console_artwork.json",url_path(source)),&file,4*1024*1024,job,|_,_|())?;
        let next=job.directory.join("console.next.db");fs::copy(&path,&next).map_err(err)?;
        let mut conn=Connection::open(&next).map_err(err)?;
        insert_console_artwork(&mut conn,source,&file)?;
        drop(conn);job.check()?;replace_catalog(&next,&path)?;
        job.image_urls.lock().map_err(err)?.clear();
    }
    let conn=open_catalog(&path)?;
    conn.prepare("SELECT filename,kind,region,crc FROM repository_platform_images WHERE platform=?1 ORDER BY kind,filename").map_err(err)?
        .query_map([source],|r|Ok(CatalogImage{filename:r.get(0)?,kind:r.get(1)?,region:r.get(2)?,crc:r.get(3)?})).map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}

pub(crate) fn console_image_filename(source: &str, image: &str) -> String {
    let extension=Path::new(image).extension().and_then(|e|e.to_str()).unwrap_or("");
    format!("repo-console-{}.{extension}",-token(&format!("{source}/{image}")))
}
// Keep the downloaded identity when a staged image becomes a managed image.
// The unique operation prefix can change without losing the catalog reference.
pub(crate) fn retained_console_filename(path: &Path) -> Option<String> {
    let filename=path.file_name()?.to_str()?;
    let (_,suffix)=filename.rsplit_once("repo-console-")?;
    let (number,extension)=suffix.split_once('.')?;
    if number.is_empty() || !number.bytes().all(|b|b.is_ascii_digit()) || !["svg","webp","png","jpg","jpeg"].contains(&extension) {return None;}
    Some(format!("repo-console-{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &str = r#"{"schema_version":2,"system":"Sony - PlayStation 2","games":{
      "SLUS-12345":{"entries":[{"name":"Example Game (USA)"}],"images":{
        "cover_front":{"kind":"cover_front","path":"SLUS-12345/cover_front.webp","sha256":"a","sources":[{"dat_name":"Example Game (USA)"}]},
        "cover_front2":{"kind":"cover_front2","path":"SLUS-12345/cover_front2.webp","sha256":"b"},
        "disc":{"kind":"disc","path":"SLUS-12345/disc.webp"},
        "bad":{"kind":"logo","path":"../bad.webp"}}},
      "SLES-54321":{"entries":[{"name":"Example Game (Europe)"}],"images":{"logo":{"kind":"logo","path":"SLES-54321/logo.webp"}}}
    }}"#;
    struct Sandbox {
        root: PathBuf,
        job: Arc<ImportJob>,
    }
    impl Sandbox {
        fn new() -> Self {
            let root = std::env::current_dir()
                .unwrap()
                .join("target/repository-tests")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ));
            fs::create_dir_all(&root).unwrap();
            let job = MetadataJobs::default().start(root.clone()).unwrap();
            Self { root, job }
        }
        fn catalog(&self) -> Connection {
            let mut conn = Connection::open(self.job.catalog_path()).unwrap();
            create_repository(&conn).unwrap();
            conn.execute("INSERT INTO platforms VALUES('Sony - PlayStation 2')", [])
                .unwrap();
            let fixture = self.job.directory.join("fixture.json");
            fs::write(&fixture, FIXTURE).unwrap();
            insert_platform(
                &mut conn,
                &self.job,
                "Sony - PlayStation 2",
                &fixture,
                |_| (),
            )
            .unwrap();
            conn
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert!(
                self.root.is_absolute()
                    && self.root.parent().unwrap().ends_with("repository-tests")
            );
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn new_source_is_default_and_legacy_files_do_not_enable_personal_catalogs() {
        let files = Sandbox::new();
        fs::write(files.root.join(crate::catalog_compat::LEGACY_CATALOG_PATH), b"old").unwrap();
        assert!(!personal(&files.root));
        assert_eq!(
            files.job.catalog_path(),
            files.root.join("metadata/opencabinet.db")
        );
        fs::write(files.root.join(CONFIG), b"{\"personal\":true}").unwrap();
        assert!(personal(&files.root));
    }
    #[test]
    fn imports_shared_metadata_and_console_facts_preserving_titles_and_missing_fields() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let source="Sony - PlayStation 2";
        let fixture=files.job.directory.join("new-metadata.json");
        fs::write(&fixture,include_str!("../../tests/fixtures/repository-metadata.json")).unwrap();
        // An older artwork cache has no version marker, and must be reindexed.
        conn.execute_batch("DROP TABLE repository_versions").unwrap();
        insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
        let results=search_catalog(&conn,"Gran Turismo 3: A-Spec",source).unwrap();
        let game=&results[0].game;
        assert!(results[0].exact);
        assert_eq!(game.id,token("Sony - PlayStation 2/PBPX-95502"));
        assert!(game.title.contains("Gran Turismo 3"));
        assert_eq!(game.developer.as_deref(),Some("Polyphony Digital"));
        assert_eq!(game.release_date.as_deref(),Some("2001-04-28"));
        assert!(game.genre.is_some());assert!(game.description.is_some());
        assert_eq!(game.max_players,None);
        let missing=search_catalog(&conn,"Unknown Game",source).unwrap();
        assert_eq!(missing[0].game.developer,None);
        let console=platforms::platform_metadata(&conn,source).unwrap();
        assert_eq!(console.release_date.as_deref(),Some("2000-03-04"));
        assert!(console.developer.unwrap().contains("Sony"));
        assert!(console.manufacturer.unwrap().contains("Sony"));
        drop(conn);
        ensure_platform(&files.job,source,|_|panic!("current catalog should be reused offline")).unwrap();
        let reopened=open_catalog(&files.job.catalog_path()).unwrap();
        assert_eq!(search_catalog(&reopened,"Gran Turismo 3: A-Spec",source).unwrap()[0].game.developer.as_deref(),Some("Polyphony Digital"));
    }
    #[test]
    fn indexes_console_artwork_with_svg_extensions_and_uses_repository_urls() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let fixture=files.job.directory.join("console.json");
        fs::write(&fixture,r#"{"schema_version":1,"system":"Sony - PlayStation 2","images":{
            "logo":{"path":"logo.svg","kind":"logo","sha256":"a"},
            "logo2":{"path":"logo2.svg","kind":"logo","sha256":"a"},
            "logo3":{"path":"logo3.svg","kind":"logo","sha256":"a"},
            "render":{"path":"render.webp","kind":"render"},
            "bad":{"path":"../outside.svg","kind":"logo"}}}"#).unwrap();
        insert_console_artwork(&mut conn,"Sony - PlayStation 2",&fixture).unwrap();drop(conn);
        let images=console_images(&files.job,"Sony - PlayStation 2").unwrap();
        assert_eq!(images.len(),4);
        assert_eq!(images.iter().filter(|i|i.kind=="logo").count(),1);
        assert_eq!(images.iter().filter(|i|i.kind=="other").count(),2);
        let batch=platforms::prepare(&files.job,"Sony - PlayStation 2",&MediaOptions{logo:1,other:20,..Default::default()},crate::catalog_compat::SITE).unwrap();
        assert_eq!(batch.tasks.iter().filter(|task|task.image.kind=="other").count(),2);
        let logo=images.iter().find(|i|i.kind=="logo").unwrap();
        assert!(logo.filename.ends_with(".svg"));assert!(safe_image_name(&logo.filename));
        let url=image_url(&files.job,platforms::PLATFORM_IMAGES,&logo.filename).unwrap();
        assert!(url.starts_with(RAW_URL));assert!(url.ends_with("/logo.svg"));
        assert!(image_url(&files.job,platforms::PLATFORM_IMAGES,"missing.svg").is_err());
        fs::write(&fixture,r#"{"schema_version":1,"system":"Wrong","images":{}}"#).unwrap();
        let mut conn=Connection::open(files.job.catalog_path()).unwrap();
        assert!(insert_console_artwork(&mut conn,"Sony - PlayStation 2",&fixture).is_err());drop(conn);
        assert_eq!(console_images(&files.job,"Sony - PlayStation 2").unwrap().len(),4);
    }
    const SERIAL_FIXTURE: &str = r#"{"schema_version":2,"system":"Sony - PlayStation 2","games":{
      "SLUS-20998":{"entries":[{"name":"Dragon Ball Z - Budokai 3 (USA)"}]},
      "SLUS-20998GH":{"entries":[{"name":"Dragon Ball Z - Budokai 3 (USA)"},{"name":"Dragon Ball Z - Budokai 3 (USA) (Greatest Hits)"}]},
      "SLUS-20998R1":{"entries":[{"name":"Dragon Ball Z - Budokai 3 (USA) (Rev 1)"}]},
      "SLES-52730":{"entries":[{"name":"Dragon Ball Z - Budokai 3 (Europe, Australia) (En,Fr,De,Es,It)"}]},
      "SLES-52730-ANZ":{"entries":[{"name":"Dragon Ball Z - Budokai 3 (Europe, Australia) (En,Fr,De,Es,It)"}]},
      "SLUS-21000":{"entries":[{"name":"Dragon Ball Z - Budokai 2 (USA)"}]}
    }}"#;

    #[test]
    fn original_rom_names_take_priority_and_shortest_serial_breaks_exact_ties() {
        let files = Sandbox::new();
        let mut conn = files.catalog();
        let fixture = files.job.directory.join("serials.json");
        fs::write(&fixture, SERIAL_FIXTURE).unwrap();
        let platform = "Sony - PlayStation 2";
        insert_platform(&mut conn, &files.job, platform, &fixture, |_| ()).unwrap();
        let path = r"C:\ROMs\Dragon Ball Z - Budokai 3 (USA).iso.gz";
        let found = search_candidate(&conn, "A title changed by the user", platform, path).unwrap();
        assert_eq!(found.len(), 2); // Distinct IDs remain available, including the longer variant.
        assert!(found.iter().all(|result| result.exact && result.source_key.is_some()));
        assert_eq!(regional_match(&conn, &found, path).unwrap(), Some(token(&format!("{platform}/SLUS-20998"))));

        let europe = "C:/ROMs/Dragon Ball Z - Budokai 3 (Europe, Australia) (En,Fr,De,Es,It).chd";
        let found = search_candidate(&conn, "Wrong title", platform, europe).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(regional_match(&conn, &found, europe).unwrap(), Some(token(&format!("{platform}/SLES-52730"))));

        for (name, serial) in [
            ("Dragon Ball Z - Budokai 3 (USA) (Rev 1).iso", "SLUS-20998R1"),
            ("Dragon Ball Z - Budokai 3 (USA) (Greatest Hits).iso", "SLUS-20998GH"),
            ("Dragon Ball Z - Budokai 2 (USA).iso", "SLUS-21000"),
        ] {
            let found = search_candidate(&conn, "Wrong title", platform, name).unwrap();
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].game.id, token(&format!("{platform}/{serial}")));
        }
        let fallback = search_candidate(&conn, "Dragon Ball Z - Budokai 3", platform, "Renamed.iso").unwrap();
        assert_eq!(fallback.len(), 5);
        assert!(fallback.iter().all(|game| game.exact && game.source_key.is_some()));
        assert_eq!(regional_match(&conn, &fallback, "Renamed.iso").unwrap(), None);
        assert_eq!(regional_match(&conn, &fallback, "Renamed (USA).iso").unwrap(), None);
        // Existing cached catalogs can be reused: this change needs no reindex/download.
        drop(conn);
        ensure_platform(&files.job, platform, |_| panic!("catalog should work offline")).unwrap();
    }

    #[test]
    fn personal_catalogs_keep_title_matching_and_do_not_expose_repository_serials() {
        let conn = Connection::open_in_memory().unwrap();
        catalog_schema(&conn).unwrap();
        for (id, title) in [(1, "Reviewed title"), (2, "Original filename (USA)")] {
            let json = serde_json::json!({"id":id,"title":title,"platform":"PS2"}).to_string();
            conn.execute("INSERT INTO games VALUES(?1,?2,'PS2',?3)",params![id,title,json]).unwrap();
            conn.execute("INSERT INTO names VALUES(?1,?2,?3)",params![id,title,normalize(title)]).unwrap();
        }
        let found = search_candidate(&conn,"Reviewed title","PS2","C:/ROMs/Original filename (USA).iso").unwrap();
        assert_eq!(found.len(),1);
        assert_eq!(found[0].game.id,1);
        assert!(found[0].source_key.is_none());
    }

    #[test]
    fn parses_variants_regions_and_safe_urls_without_inventing_metadata() {
        let files = Sandbox::new();
        let conn = files.catalog();
        let found = search_catalog(&conn, "Example Game", "Sony - PlayStation 2").unwrap();
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|g| g.exact
            && repository_id(g.game.id)
            && g.game.description.is_none()
            && g.game.developer.is_none()));
        let usa = regional_match(&conn, &found, "C:/roms/Example Game (USA).iso")
            .unwrap()
            .unwrap();
        let eu = regional_match(&conn, &found, "C:/roms/Example Game (Europe).iso")
            .unwrap()
            .unwrap();
        assert_ne!(usa, eu);
        assert_eq!(
            regional_match(&conn, &found, "Example Game.iso").unwrap(),
            None
        );
        let types = available_image_types(&conn, &[usa], &files.job).unwrap();
        assert_eq!(types.counts["cover"], 2);
        assert_eq!(types.counts["disc"], 1);
        assert!(!types.counts.contains_key("logo"));
        let (filename, url): (String, String) = conn
            .query_row(
                "SELECT filename,url FROM image_urls ORDER BY filename LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!(safe_image_name(&filename));
        assert!(url.starts_with(RAW_URL));
        assert!(url.contains("Sony%20-%20PlayStation%202/"));
        assert_eq!(image_url(&files.job, IMAGE_BASE, &filename).unwrap(), url);
        assert!(image_url(&files.job, IMAGE_BASE, "missing.webp").is_err());
        assert_eq!(
            cached_catalog_summary(&files.job.catalog_path())
                .unwrap()
                .source,
            "OpenCabinet-BDD"
        );
        assert!(validate_personal(&files.job.catalog_path()).is_err());
        let id = found[0].game.id;
        drop(conn);
        assert_eq!(token("Sony - PlayStation 2/SLUS-12345"), usa);
        assert!(repository_id(id));
    }
    #[test]
    fn invalid_or_cancelled_platform_updates_preserve_the_previous_catalog() {
        let files = Sandbox::new();
        let mut conn = files.catalog();
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap();
        let bad = files.job.directory.join("bad.json");
        fs::write(
            &bad,
            b"{\"schema_version\":99,\"system\":\"Sony - PlayStation 2\",\"games\":{}}",
        )
        .unwrap();
        assert!(
            insert_platform(&mut conn, &files.job, "Sony - PlayStation 2", &bad, |_| ()).is_err()
        );
        files.job.cancel().unwrap();
        fs::write(&bad, FIXTURE).unwrap();
        assert!(
            insert_platform(&mut conn, &files.job, "Sony - PlayStation 2", &bad, |_| ()).is_err()
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM images", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            before
        );
    }
    #[test]
    fn provider_identifiers_are_independent_and_survive_reopening() {
        let files = Sandbox::new();
        let path = files.root.join("library.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,launch\u{0062}ox_id INTEGER);INSERT INTO games VALUES(1,77);").unwrap();
        let id = token("Sony - PlayStation 2/SLUS-12345");
        record_match(&conn, 1, id).unwrap();
        assert_eq!(match_id(&conn, 1, true), Some(77));
        assert_eq!(match_id(&conn, 1, false), Some(id));
        drop(conn);
        let conn = Connection::open(path).unwrap();
        assert_eq!(match_id(&conn, 1, false), Some(id));
        assert!(!repository_id(-1));
        assert!(token("Sony - PlayStation 2/SLUS-12345") != token("Sony - PlayStation/SLUS-12345"));
        assert!(!valid_relative("a/../b.webp"));
        assert!(!valid_relative("C:/image.webp"));
        assert!(valid_relative("SLES-12345/cover_front2.webp"));
    }
    #[test]
    fn bulk_matches_use_the_rom_region_and_keep_both_providers_independent() {
        let files = Sandbox::new();
        let catalog = files.catalog();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT,launch\u{0062}ox_id INTEGER);CREATE TABLE platforms(name TEXT,launch\u{0062}ox_platform TEXT);INSERT INTO platforms VALUES('PS2','Personal PS2');INSERT INTO games VALUES(1,'Example Game','PS2','C:/Example Game (USA).iso',77);").unwrap();
        let (source, platform) = bulk_image_match(&conn, &catalog, 1).unwrap();
        assert_eq!(source, token("Sony - PlayStation 2/SLUS-12345"));
        assert_eq!(platform, "Sony - PlayStation 2");
        record_match(&conn, 1, source).unwrap();
        record_platform(&conn, "PS2", "Sony - PlayStation 2", false).unwrap();
        assert_eq!(
            platform_mapping(&conn, "PS2", true).as_deref(),
            Some("Personal PS2")
        );
        assert_eq!(
            platform_mapping(&conn, "PS2", false).as_deref(),
            Some("Sony - PlayStation 2")
        );
        conn.execute("UPDATE games SET title='Personal title'", [])
            .unwrap();
        assert_eq!(bulk_image_match(&conn, &catalog, 1).unwrap().0, source);
        assert_eq!(match_id(&conn, 1, true), Some(77));
    }
    #[test]
    #[ignore = "Reads the current PS2 sample in target; no network or real library changes"]
    fn original_filename_matches_real_ps2_serials() {
        let files = Sandbox::new();
        let mut conn = files.catalog();
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/repository-ps2-catalog.json");
        let platform = "Sony - PlayStation 2";
        insert_platform(&mut conn, &files.job, platform, &sample, |_| ()).unwrap();
        let path = r"C:\ROMs\Dragon Ball Z - Budokai 3 (USA).iso.gz";
        let results = search_candidate(&conn, "Changed title", platform, path).unwrap();
        let ids: HashSet<_> = results.iter().map(|result| result.source_key.as_deref().unwrap()).collect();
        assert!(ids.contains("SLUS-20998"));
        assert!(ids.contains("SLUS-20998GH"));
        assert!(results.iter().all(|result| result.exact));
        assert_eq!(regional_match(&conn, &results, path).unwrap(), Some(token(&format!("{platform}/SLUS-20998"))));
        let path = "C:/ROMs/Dragon Ball Z - Budokai 3 (Europe, Australia) (En,Fr,De,Es,It).chd";
        let results = search_candidate(&conn, "Changed title", platform, path).unwrap();
        assert!(results.iter().any(|result| result.source_key.as_deref() == Some("SLES-52730-ANZ")));
        assert_eq!(regional_match(&conn, &results, path).unwrap(), Some(token(&format!("{platform}/SLES-52730"))));
    }

    #[test]
    #[ignore = "Reads the repository sample downloaded into target; no network or real library changes"]
    fn indexes_real_repository_sample() {
        let files = Sandbox::new();
        let mut conn = Connection::open(files.job.catalog_path()).unwrap();
        create_repository(&conn).unwrap();
        let sample = std::env::current_dir()
            .unwrap()
            .parent()
            .unwrap()
            .join("target/bdd-ps2.json");
        insert_platform(
            &mut conn,
            &files.job,
            "Sony - PlayStation 2",
            &sample,
            |_| (),
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
            .unwrap();
        assert!(count > 10000);
        let games = search_catalog(&conn, "Gran Turismo 4", "Sony - PlayStation 2").unwrap();
        assert!(games.iter().any(|g| g.exact));
    }
    #[test]
    #[ignore = "Reads the updated repository sample downloaded into target; no network or real library changes"]
    fn indexes_real_repository_metadata_sample() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let sample=Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/repo-ps2-metadata.json");
        insert_platform(&mut conn,&files.job,"Sony - PlayStation 2",&sample,|_|()).unwrap();
        let results=search_catalog(&conn,"Gran Turismo 3: A-Spec","Sony - PlayStation 2").unwrap();
        assert!(!results.is_empty());
        assert!(results.iter().any(|r|r.game.id==token("Sony - PlayStation 2/SCUS-97102") && r.game.developer.as_deref()==Some("Polyphony Digital")));
        let console=platforms::platform_metadata(&conn,"Sony - PlayStation 2").unwrap();
        assert_eq!(console.release_date.as_deref(),Some("2000-03-04"));
        assert!(conn.query_row("SELECT COUNT(*) FROM games",[],|r|r.get::<_,i64>(0)).unwrap()>10000);
        let artwork=Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/repo-console-artwork.json");
        insert_console_artwork(&mut conn,"Sony - PlayStation 2",&artwork).unwrap();drop(conn);
        assert!(console_images(&files.job,"Sony - PlayStation 2").unwrap().iter().any(|i|i.kind=="logo"&&i.filename.ends_with(".svg")));
    }
    #[test]
    fn explicit_personal_import_validates_copies_and_can_return_to_the_default_source() {
        let files = Sandbox::new();
        let source = files.root.join("input.db");
        let conn = Connection::open(&source).unwrap();
        catalog_schema(&conn).unwrap();
        conn.execute_batch("INSERT INTO catalog_info VALUES('2026-01-01');INSERT INTO platforms VALUES('PS2');CREATE VIRTUAL TABLE names_fts USING fts5(name);INSERT INTO games VALUES(77,'Personal title','PS2','{}');").unwrap();
        conn.execute(
            "UPDATE games SET details=?1",
            [serde_json::json!({"id":77,"title":"Personal title","platform":"PS2"}).to_string()],
        )
        .unwrap();
        drop(conn);
        let original = fs::read(&source).unwrap();
        assert!(!personal(&files.root));
        publish_selection(&files.root, Some(&source)).unwrap();
        assert!(personal(&files.root));
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(fs::read(path(&files.root, true)).unwrap(), original);
        let bad = files.root.join("bad.db");
        fs::write(&bad, b"broken").unwrap();
        assert!(publish_selection(&files.root, Some(&bad)).is_err());
        assert!(personal(&files.root));
        assert_eq!(fs::read(path(&files.root, true)).unwrap(), original);
        publish_selection(&files.root, None).unwrap();
        assert!(!personal(&files.root));
        assert!(path(&files.root, true).exists());
        let dirs = fs::read_dir(files.root.join("metadata/staging"))
            .unwrap()
            .count();
        assert_eq!(dirs, 1, "only the test's own running job remains");
    }
    #[test]
    fn failed_settings_publication_restores_the_previous_personal_catalog() {
        let files = Sandbox::new();
        let source = files.root.join("input.db");
        let conn = Connection::open(&source).unwrap();
        catalog_schema(&conn).unwrap();
        conn.execute_batch("INSERT INTO catalog_info VALUES('old');INSERT INTO platforms VALUES('PS2');CREATE VIRTUAL TABLE names_fts USING fts5(name);INSERT INTO games VALUES(77,'Personal title','PS2','{}');").unwrap();
        conn.execute(
            "UPDATE games SET details=?1",
            [serde_json::json!({"id":77,"title":"Personal title","platform":"PS2"}).to_string()],
        )
        .unwrap();
        drop(conn);
        publish_selection(&files.root, Some(&source)).unwrap();
        let before = fs::read(path(&files.root, true)).unwrap();
        let conn = Connection::open(&source).unwrap();
        conn.execute("UPDATE catalog_info SET downloaded_at='new'", [])
            .unwrap();
        drop(conn);
        fs::remove_file(files.root.join(CONFIG)).unwrap();
        fs::create_dir(files.root.join(CONFIG)).unwrap();
        assert!(publish_selection(&files.root, Some(&source)).is_err());
        assert_eq!(fs::read(path(&files.root, true)).unwrap(), before);
    }
    fn zip_fixture(files: &Sandbox, name: &str, metadata: &str) -> PathBuf {
        let path = files.root.join(name);
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("Metadata.xml", options).unwrap();
        zip.write_all(metadata.as_bytes()).unwrap();
        zip.start_file("Platforms.xml", options).unwrap();
        zip.write_all(b"<Metadata><Platform><Name>Sega Genesis</Name></Platform></Metadata>")
            .unwrap();
        // Extra entries are not extracted or interpreted as filesystem paths.
        zip.start_file("../../should-not-exist.txt", options)
            .unwrap();
        zip.write_all(b"ignored").unwrap();
        zip.finish().unwrap();
        path
    }
    #[test]
    fn imports_zip_directly_builds_search_and_keeps_the_original_archive() {
        let files = Sandbox::new();
        let source = zip_fixture(
            &files,
            "catalog.ZIP",
            include_str!("../../tests/fixtures/metadata-catalog.xml"),
        );
        let bytes = fs::read(&source).unwrap();
        let mut phases = Vec::new();
        let mut records = 0;
        publish_selection_with_progress(&files.root, Some(&source), |p| {
            phases.push(p.phase);
            records = records.max(p.processed);
        })
        .unwrap();
        assert!(personal(&files.root));
        assert_eq!(fs::read(source).unwrap(), bytes);
        let conn = open_catalog(&path(&files.root, true)).unwrap();
        assert!(
            !search_catalog(&conn, "Sonic the Hedgehog", "Sega Genesis")
                .unwrap()
                .is_empty()
        );
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap();
        assert!(count > 0);
        for phase in ["reading", "indexing", "validating", "publishing"] {
            assert!(phases.contains(&phase));
        }
        assert!(records > 0);
        assert!(
            !files
                .root
                .parent()
                .unwrap()
                .join("should-not-exist.txt")
                .exists()
        );
        assert_eq!(
            fs::read_dir(files.root.join("metadata/staging"))
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    fn damaged_missing_or_incomplete_zip_keeps_the_current_catalog_and_cleans_its_work() {
        let files = Sandbox::new();
        let source = zip_fixture(
            &files,
            "valid.zip",
            include_str!("../../tests/fixtures/metadata-catalog.xml"),
        );
        publish_selection(&files.root, Some(&source)).unwrap();
        let original = fs::read(path(&files.root, true)).unwrap();
        let broken = files.root.join("broken.zip");
        fs::write(&broken, b"not a zip").unwrap();
        let incomplete = zip_fixture(
            &files,
            "incomplete.zip",
            "<Metadata><Game><DatabaseID>1</DatabaseID>",
        );
        let empty = files.root.join("empty.zip");
        zip::ZipWriter::new(File::create(&empty).unwrap())
            .finish()
            .unwrap();
        for file in [broken, incomplete, empty] {
            assert!(publish_selection(&files.root, Some(&file)).is_err());
            assert!(personal(&files.root));
            assert_eq!(fs::read(path(&files.root, true)).unwrap(), original);
            assert_eq!(
                fs::read_dir(files.root.join("metadata/staging"))
                    .unwrap()
                    .count(),
                1
            );
        }
    }
    #[test]
    #[ignore = "Reads the locally downloaded catalog archive; no network or real library changes"]
    fn imports_real_personal_archive() {
        let files = Sandbox::new();
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/metadata-audit-20261018.zip");
        publish_selection(&files.root, Some(&source)).unwrap();
        let summary = catalog_summary(&path(&files.root, true)).unwrap();
        assert!(summary.game_count > 100000);
    }
}
