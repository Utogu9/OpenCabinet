//! Default artwork source and explicitly imported personal catalogs.
use super::*;
mod matching;
mod regions;
mod sources;
mod sqlite;
#[cfg(test)]
mod sqlite_tests;
pub(super) use matching::{finish_search_results, search_candidate, shortest_match};
const ROOT_URL: &str = "https://api.github.com/repos/Utogu9/OpenCabinet-BDD/contents?ref=main";
const RAW_URL: &str = "https://raw.githubusercontent.com/Utogu9/OpenCabinet-BDD/main/";
const CONFIG: &str = "metadata/source.json";
const MIN_REPOSITORY_ID: i64 = 1_000_000_000_000;
// Retain release names and canonical title aliases for regional ROM matching.
const REPOSITORY_GAME_VERSION: i64 = 9;

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
    #[serde(default)]
    dat_name: String,
    #[serde(default)]
    region: Option<String>,
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
    provider: Option<String>,
    #[serde(default)]
    uploader_hidden: bool,
    #[serde(default)]
    uploader: Option<String>,
    #[serde(default)]
    file_page: Option<String>,
    #[serde(default)]
    page: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    dat_name: String,
    #[serde(default)]
    region: String,
}

fn libretro_image_url(platform: &str, source: &RepoImageSource) -> Option<String> {
    if source.provider.as_deref().is_some_and(|provider| provider != "libretro-thumbnails") {
        return None;
    }
    let path = source.source.as_deref()?;
    let (directory, filename) = path.split_once('/')?;
    if !["Named_Boxarts", "Named_Snaps", "Named_Titles", "Named_Logos"].contains(&directory)
        || !valid_relative(path) || filename.contains('/')
        || !valid_relative(platform) || platform.contains('/') {
        return None;
    }
    Some(format!("https://github.com/libretro-thumbnails/{}/blob/master/{}",
        url_path(&platform.replace(' ', "_")), url_path(path)))
}

fn image_origin(platform: &str, sources: &[RepoImageSource]) -> Option<crate::media_provenance::Source> {
    let make = |source: &RepoImageSource| {
        crate::media_provenance::Source {
            uploader: if source.uploader_hidden { None } else { source.uploader.clone() },
            url: [&source.file_page, &source.page, &source.source, &source.url].into_iter()
                .filter_map(|s| s.as_deref()).find_map(crate::media_provenance::web_url)
                .or_else(|| libretro_image_url(platform, source)),
        }.clean()
    };
    sources.iter().filter_map(make).find(|s| s.uploader.is_some())
        .or_else(|| sources.iter().find_map(make))
}

pub(super) fn attach_image_sources(conn: &Connection, images: &mut [CatalogImage]) -> Result<()> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='repository_image_sources')", [], |r|r.get(0)).map_err(err)?;
    if !exists { return Ok(()); }
    let mut query = conn.prepare("SELECT details FROM repository_image_sources WHERE filename=?1").map_err(err)?;
    for image in images {
        image.source = crate::media_provenance::decode(query.query_row([&image.filename], |r|r.get(0)).optional().map_err(err)?);
    }
    Ok(())
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
        "label" | "cart_label" => "cart_label",
        other => other,
    };
    valid_image_kind(mapped).then(|| mapped.into())
}
fn create_repository(conn: &Connection) -> Result<()> {
    catalog_schema(conn)?;
    sources::schema(conn)?;
    conn.execute_batch("CREATE TABLE image_urls(filename TEXT PRIMARY KEY,url TEXT NOT NULL);CREATE TABLE repository_keys(id INTEGER PRIMARY KEY,source_key TEXT UNIQUE NOT NULL);CREATE TABLE ready_platforms(name TEXT PRIMARY KEY);CREATE INDEX idx_names_normalized ON names(normalized);CREATE INDEX idx_games_platform ON games(platform);CREATE INDEX idx_images_game ON images(game_id);CREATE VIRTUAL TABLE names_fts USING fts5(name,content='names',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');INSERT INTO catalog_info VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'));").map_err(err)
}
fn metadata_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_image_sources(filename TEXT PRIMARY KEY, details TEXT NOT NULL);").map_err(err)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_versions(name TEXT PRIMARY KEY,version INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS repository_console_metadata(name TEXT PRIMARY KEY,details TEXT NOT NULL);CREATE TABLE IF NOT EXISTS repository_platform_images(platform TEXT NOT NULL,filename TEXT PRIMARY KEY,kind TEXT NOT NULL,region TEXT NOT NULL,crc TEXT NOT NULL);").map_err(err)
}

const CATALOG_FILES: [&str;2] = ["catalog.sqlite","catalog.json"];

// Fall back only when a format is absent (HTTP 404). A failed or damaged SQLite
// download must never silently replace a usable catalog with unrelated data.
fn fetch_catalog_with(raw:&str,file:&Path,mut fetch:impl FnMut(&str,&Path)->Result<bool>)->Result<()> {
    for name in CATALOG_FILES {
        if fetch(&format!("{raw}{name}"),file)? {return Ok(());}
    }
    Err(crate::i18n::text("source.invalid").into())
}

fn catalog_filename(conn:&Connection,source:&str)->String {
    conn.query_row("SELECT filename FROM repository_catalog_files WHERE name=?1",[source],|r|r.get::<_,String>(0)).ok()
        .filter(|name|CATALOG_FILES.contains(&name.as_str())).unwrap_or_else(||"catalog.json".into())
}
pub(super) fn prepare(
    job: &ImportJob,
    refresh: bool,
    progress: impl FnMut(MetadataProgress),
) -> Result<CatalogSummary> {
    prepare_with_index(job,refresh,progress,|index,progress| {
        download(&http_client()?,ROOT_URL,index,2*1024*1024,job,
            |n,total|progress(job.progress("catalog",n,total,None)))
    })
}

fn weekly_check_due(conn: &Connection) -> Result<bool> {
    let checked: Option<String> = conn.query_row("SELECT checked_at FROM repository_update_check LIMIT 1",[],|r|r.get(0)).ok();
    conn.query_row("SELECT COALESCE(julianday('now')-julianday(COALESCE(?1,(SELECT downloaded_at FROM catalog_info LIMIT 1)))>7,1)",[checked],|r|r.get(0)).map_err(err)
}

pub(super) fn prepare_for_import(job: &ImportJob, refresh: bool, automatic: bool, mut progress: impl FnMut(MetadataProgress)) -> Result<CatalogSummary> {
    let path=job.catalog_path();
    let due=automatic&&!refresh&&!job.personal_catalog&&path.exists()&&weekly_check_due(&open_catalog(&path)?)?;
    let previous_date=if due {Some(cached_catalog_summary(&path)?.downloaded_at)}else{None};
    let summary=prepare(job,refresh,&mut progress)?;
    if !due { return Ok(summary); }
    // Stage the entire refresh. Network/validation failures keep the previous
    // catalog usable offline; cancellation still ends the import immediately.
    match update_cached_platforms(job,previous_date.as_deref(),&mut progress) {
        Ok(())=>cached_catalog_summary(&path),
        Err(error)=>{ job.check()?;eprintln!("Automatic catalog check: {error}");Ok(summary) }
    }
}

fn update_cached_platforms(job: &ImportJob, since: Option<&str>, progress: impl FnMut(MetadataProgress)) -> Result<()> {
    let client=http_client()?;
    update_cached_platforms_with(job,since,progress,|url,path,limit,progress|download_file(&client,url,path,limit,job,true,progress))
}
fn update_cached_platforms_with(job: &ImportJob, since: Option<&str>, mut progress: impl FnMut(MetadataProgress), mut fetch: impl FnMut(&str,&Path,u64,&mut dyn FnMut(u64,Option<u64>))->Result<bool>) -> Result<()> {
    let path=job.catalog_path();let next=job.directory.join("automatic-catalog.next.db");
    fs::copy(&path,&next).map_err(err)?;
    let mut conn=Connection::open(&next).map_err(err)?;
    let platforms=conn.prepare("SELECT name FROM ready_platforms").map_err(err)?.query_map([],|r|r.get::<_,String>(0)).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_revisions(name TEXT PRIMARY KEY,revision TEXT NOT NULL)").map_err(err)?;
    let mut changed=false;
    for source in platforms {
        job.check()?;
        let raw=sources::base(&conn,&source)?;
        let url=reqwest::Url::parse(&raw).map_err(err)?;
        let segments:Vec<_>=url.path_segments().ok_or("Invalid catalog URL")?.collect();
        if url.host_str()!=Some("raw.githubusercontent.com")||segments.len()<3 {return Err("Invalid catalog URL".into());}
        let saved_file=catalog_filename(&conn,&source);
        let mut commits=serde_json::Value::Null;
        for filename in std::iter::once(saved_file.as_str()).chain(CATALOG_FILES.into_iter().filter(|name|*name!=saved_file)) {
            let mut api=reqwest::Url::parse(&format!("https://api.github.com/repos/{}/{}/commits",segments[0],segments[1])).map_err(err)?;
            let catalog_path=if raw.starts_with(RAW_URL){format!("{source}/{filename}")}else{filename.into()};
            api.query_pairs_mut().append_pair("sha","main").append_pair("path",&catalog_path).append_pair("per_page","1");
            let file=job.directory.join("catalog-commit.json");
            if !fetch(api.as_str(),&file,2*1024*1024,&mut |_,_|())? {return Err(crate::i18n::text("source.invalid").into());}
            commits=serde_json::from_reader(File::open(file).map_err(err)?).map_err(err)?;
            if commits.as_array().is_none() {return Err(crate::i18n::text("source.invalid").into());}
            if commits.as_array().is_some_and(|rows|!rows.is_empty()) {break;}
        }
        let revision=commits[0]["sha"].as_str().filter(|s|!s.is_empty()).ok_or("Missing catalog revision")?;
        let previous:Option<String>=conn.query_row("SELECT revision FROM repository_revisions WHERE name=?1",[&source],|r|r.get(0)).optional().map_err(err)?;
        let newer:bool=conn.query_row("SELECT COALESCE(julianday(?1)>julianday(COALESCE(?2,downloaded_at)),1) FROM catalog_info LIMIT 1",(commits[0]["commit"]["committer"]["date"].as_str(),since),|r|r.get(0)).map_err(err)?;
        if previous.as_deref()!=Some(revision)&&(previous.is_some()||newer) {
            let file=job.directory.join("automatic-platform.catalog");
            fetch_catalog_with(&raw,&file,|url,file|fetch(url,file,MAX_CATALOG_BYTES,&mut |n,total|progress(job.progress("catalog",n,total,Some(source.clone())))))?;
            insert_platform(&mut conn,job,&source,&file,&mut progress)?;
            conn.execute("DELETE FROM repository_versions WHERE name=?1",[format!("artwork:{source}")]).map_err(err)?;
            changed=true;
        }
        conn.execute("INSERT OR REPLACE INTO repository_revisions VALUES(?1,?2)",params![source,revision]).map_err(err)?;
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS repository_update_check(checked_at TEXT NOT NULL);DELETE FROM repository_update_check;INSERT INTO repository_update_check VALUES(strftime('%Y-%m-%dT%H:%M:%SZ','now'));").map_err(err)?;
    if changed {conn.execute("UPDATE catalog_info SET downloaded_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')",[]).map_err(err)?;}
    drop(conn);job.check()?;replace_catalog(&next,&path)?;
    job.image_urls.lock().map_err(err)?.clear();
    Ok(())
}
fn prepare_with_index(
    job: &ImportJob,
    refresh: bool,
    mut progress: impl FnMut(MetadataProgress),
    fetch_index: impl FnOnce(&Path, &mut dyn FnMut(MetadataProgress)) -> Result<()>,
) -> Result<CatalogSummary> {
    job.check()?;
    if job.personal_catalog {
        let path = job.catalog_path();
        recover_catalog(&path)?;
        return cached_catalog_summary(&path);
    }
    let path = job.catalog_path();
    recover_catalog(&path)?;
    let check_index = !job.repository_index_checked.swap(true, Ordering::AcqRel);
    if refresh || !path.exists() || check_index {
        let index = job.directory.join("repository-index.json");
        let outcome = fetch_index(&index,&mut progress);
        if path.exists() && !refresh && outcome.is_err() {
            job.check()?;
            // Check routes once per operation, preserving cached catalogs
            // offline or when GitHub rate-limits the index request.
            return cached_catalog_summary(&path);
        }
        outcome?;
        let entries: Vec<sources::DirectoryEntry> =
            serde_json::from_reader(BufReader::new(File::open(index).map_err(err)?))
                .map_err(err)?;
        if !refresh && path.exists() && sources::unchanged(&open_catalog(&path)?, &entries)? {
            return cached_catalog_summary(&path);
        }
        let next = job.directory.join("repository.next.db");
        let _ = fs::remove_file(&next);
        if path.exists() {
            fs::copy(&path, &next).map_err(err)?;
        }
        let mut conn = Connection::open(&next).map_err(err)?;
        if !path.exists() {
            create_repository(&conn)?;
        }
        sources::apply(&mut conn, entries)?;
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
        job.image_urls.lock().map_err(err)?.clear();
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
    let data=sqlite::Catalog::open(file,job)?;
    if data.version() != 2 || !same_system(data.system(), source) {
        return Err(crate::i18n::text("source.invalid").into());
    }
    let tx = conn.transaction().map_err(err)?;
    metadata_schema(&tx)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS repository_catalog_files(name TEXT PRIMARY KEY,filename TEXT NOT NULL)").map_err(err)?;
    tx.execute("INSERT OR REPLACE INTO repository_catalog_files VALUES(?1,?2)",params![source,data.filename()]).map_err(err)?;
    let raw = sources::base(&tx, source)?;
    let console_entity=data.console().entity().map(str::to_owned);
    let mut console_localized=serde_json::Map::new();
    for locale in ["es", "en"] {
        let values=data.console().values(locale,None,&[]);
        console_localized.insert(locale.into(),serde_json::json!({"name":source,"release_date":values.release_date,"developer":values.developer,"manufacturer":values.manufacturer}));
    }
    tx.execute("INSERT OR REPLACE INTO repository_console_metadata VALUES(?1,?2)",params![source,serde_json::to_string(&console_localized).map_err(err)?]).map_err(err)?;
    tx.execute("DELETE FROM repository_image_sources WHERE filename IN (SELECT filename FROM images WHERE game_id IN (SELECT id FROM games WHERE platform=?1))",[source]).map_err(err)?;
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
    let total = data.len() as u64;
    let mut i=0;
    data.games(|serial,game,metadata| {
        job.check()?;
        if i % 100 == 0 {
            progress(job.progress("indexing", i as u64, Some(total), Some(source.into())));
        }
        i+=1;
        if !valid_relative(&serial) || serial.contains('/') || game.entries.is_empty() {
            return Ok(());
        }
        let key = format!("{source}/{serial}");
        let id = token(&key);
        let title = game.entries[0].name.trim().to_string();
        if title.is_empty() {
            return Ok(());
        }
        let details = CatalogGame { source: None,
            id,
            title: metadata.and_then(|record| record.title("en")).unwrap_or(&title).to_owned(),
            platform: source.into(),
            release_date: None,
            developer: None,
            publisher: None,
            genre: None,
            game_mode: None,
            max_players: None,
            description: None,
        };
        let mut json=serde_json::to_value(&details).map_err(err)?;
        if let Some(origin) = metadata.and_then(repository_metadata::Record::origin) {
            json["source"] = serde_json::to_value(origin).map_err(err)?;
        }
        json["_regions"]=serde_json::to_value(regions::from_entries(&game.entries)).map_err(err)?;
        json["_release_names"]=serde_json::to_value(game.entries.iter()
            .flat_map(|entry|[entry.name.as_str(),entry.dat_name.as_str()]).filter(|name|!name.is_empty()).collect::<Vec<_>>()).map_err(err)?;
        if let Some(metadata)=metadata {
            let region=rom_regions(&game.entries[0].name);
            let mut languages=serde_json::Map::new();
            for locale in ["es", "en"] {
                let fields=metadata.values(locale,console_entity.as_deref(),&region);
                let mut localized=serde_json::to_value(&fields).map_err(err)?;
                let object=localized.as_object_mut().unwrap();
                object.remove("manufacturer");
                object.insert("id".into(),id.into());object.insert("title".into(),metadata.title(locale).unwrap_or(&title).into());object.insert("platform".into(),source.into());
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
            if !entry.dat_name.is_empty() {
                names.insert(entry.dat_name.clone());
                names.insert(super::super::clean_rom_title(&entry.dat_name));
            }
        }
        let aliases:Vec<_>=names.iter().flat_map(|name|matching::title_aliases(name)).filter(|name|!name.is_empty()).collect();
        names.extend(aliases);
        for name in names {
            tx.execute(
                "INSERT INTO names VALUES(?1,?2,?3)",
                params![id, name, normalize(&name)],
            )
            .map_err(err)?;
        }
        for (image_kind, image) in game.images {
            let manual = crate::manuals::supported(Path::new(&image.path));
            let kind = if manual {
                Some("manual".to_string())
            } else {
                kind(if image.kind.is_empty() { &image_kind } else { &image.kind })
            };
            let Some(kind) = kind else {
                continue;
            };
            if !valid_relative(&image.path) || !image.path.starts_with(&format!("{serial}/")) {
                continue;
            }
            let extension = Path::new(&image.path).extension().and_then(|ext|ext.to_str()).unwrap_or("").to_ascii_lowercase();
            if !manual && !["webp","avif","png","jpg","jpeg","gif","bmp","svg"].contains(&extension.as_str()) { continue; }
            let filename = format!("repo-{}.{extension}", -token(&format!("{source}/{}", image.path)));
            let url = format!("{raw}{}", url_path(&image.path));
            if let Some(origin) = image_origin(source, &image.sources) {
                tx.execute("INSERT OR REPLACE INTO repository_image_sources VALUES(?1,?2)",
                    params![filename,serde_json::to_string(&origin).map_err(err)?]).map_err(err)?;
            }
            let names = image
                .sources
                .iter()
                .map(|s| s.dat_name.as_str())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            let region = names
                .iter()
                .find_map(|n| rom_regions(n).first().copied())
                .or_else(|| image.sources.iter().find_map(|s| match s.region.to_ascii_uppercase().as_str() {
                    "US" | "USA" | "NA" => Some("North America"),
                    "EU" | "EUR" | "EUROPE" => Some("Europe"),
                    "JP" | "JPN" | "JAPAN" => Some("Japan"),
                    "ALL" | "WORLD" => Some("World"),
                    _ => None,
                }))
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
        Ok(())
    })?;
    tx.execute(
        "INSERT OR REPLACE INTO ready_platforms VALUES(?1)",
        [source],
    )
    .map_err(err)?;
    tx.execute("INSERT OR REPLACE INTO repository_versions VALUES(?1,?2)",params![source, REPOSITORY_GAME_VERSION]).map_err(err)?;
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
    let current = conn.query_row("SELECT version FROM repository_versions WHERE name=?1",[source],|r|r.get::<_,i64>(0)).ok()==Some(REPOSITORY_GAME_VERSION);
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
    let file = job.directory.join("platform.catalog");
    let raw = sources::base(&open_catalog(&path)?, source)?;
    let client=http_client()?;
    fetch_catalog_with(&raw,&file,|url,file|download_file(&client,url,file,MAX_CATALOG_BYTES,job,true,|n,t|progress(job.progress("catalog",n,t,Some(source.into())))))?;
    let next = job.directory.join("platform.next.db");
    fs::copy(&path, &next).map_err(err)?;
    let mut conn = Connection::open(&next).map_err(err)?;
    insert_platform(&mut conn, job, source, &file, &mut progress)?;
    drop(conn);
    job.check()?;
    replace_catalog(&next, &path)?;
    job.image_urls.lock().map_err(err)?.clear();
    let _ = fs::remove_file(file);
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
fn same_system(a: &str, b: &str) -> bool {
    crate::platform_defaults::equivalent(&canonical_platform(a), &canonical_platform(b))
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
    let query_key=matching::title_aliases(&filename).remove(0);
    let mut releases=Vec::new();
    for candidate in candidates.iter().filter(|c|c.exact) {
        let json:String=catalog.query_row("SELECT details FROM games WHERE id=?1",[candidate.game.id],|r|r.get(0)).map_err(err)?;
        let json:serde_json::Value=serde_json::from_str(&json).map_err(err)?;
        let mut names:Vec<String>=json["_release_names"].as_array().into_iter().flatten().filter_map(|v|v.as_str().map(str::to_owned)).collect();
        if names.is_empty() {
            let mut stmt=catalog.prepare("SELECT name FROM names WHERE game_id=?1").map_err(err)?;
            names=stmt.query_map([candidate.game.id],|r|r.get::<_,String>(0)).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
        }
        let relevant:Vec<_>=names.iter().filter(|name|matching::title_aliases(name).contains(&query_key)||matching::compatible_title(name,&filename)).cloned().collect();
        let alias_only=relevant.is_empty();
        releases.push((candidate.game.id,if alias_only{names}else{relevant},alias_only));
    }
    // Prefer the original filename, identical regions, then a release covering
    // every ROM region. Only then try compatible regions in filename order.
    for mode in 0..3+2*region.len() {
        let full_name=mode==0;
        if !full_name && region.is_empty() {
            break;
        }
        let mut matched = Vec::new();
        for (id,names,alias_only) in &releases {
            let rank=names.iter().filter(|name| {
                if full_name {
                    !filename.is_empty() && normalize(name) == normalize(&filename)
                } else if mode==1 {
                    let other=rom_regions(name);
                    other.len()==region.len() && region.iter().all(|r|other.contains(r))
                } else if mode==2 {
                    let other=rom_regions(name);
                    region.iter().all(|r|other.contains(r))
                } else {
                    let other=rom_regions(name);
                    other.contains(&region[(mode-3)/2]) && ((mode-3)%2==1 || other.len()==1)
                }
            }).map(|name|(*alias_only,matching::release_rank(name,&filename))).min();
            if let Some(rank)=rank {
                matched.push((*id,rank));
            }
        }
        if let Some(best)=matched.iter().map(|(_,rank)|*rank).min() {matched.retain(|(_,rank)|*rank==best);}
        let matched:Vec<_>=matched.into_iter().map(|(id,_)|id).collect();
        if matched.len() == 1 {
            return Ok(matched.first().copied());
        }
        if matched.len() > 1 {
            let titles: HashSet<_> = candidates.iter().filter(|candidate| matched.contains(&candidate.game.id))
                .map(|candidate| matching::title_aliases(&candidate.game.title).remove(0)).collect();
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
    if data.schema_version!=1 || !same_system(&data.system,source) { return Err(crate::i18n::text("source.invalid").into()); }
    let tx=conn.transaction().map_err(err)?;
    metadata_schema(&tx)?;
    let raw=sources::base(&tx,source)?;
    tx.execute("DELETE FROM image_urls WHERE filename IN (SELECT filename FROM repository_platform_images WHERE platform=?1)",[source]).map_err(err)?;
    tx.execute("DELETE FROM repository_platform_images WHERE platform=?1",[source]).map_err(err)?;
    for (key,image) in data.images {
        if !valid_relative(&image.path) || image.path.contains('/') { continue; }
        let kind=match if image.kind.is_empty(){key.as_str()}else{image.kind.as_str()} {
            "logo" if matches!(image.path.as_str(),"logo.svg"|"logo.webp"|"logo.png"|"logo.jpg"|"logo.jpeg"|"logo.avif")=>"logo",
            "render"|"screenshot"=>"screenshot", "artwork"|"fanart"=>"artwork", _=>"other",
        };
        let extension=Path::new(&image.path).extension().and_then(|s|s.to_str()).unwrap_or("");
        if !["svg","webp","png","jpg","jpeg","avif"].contains(&extension) { continue; }
        let filename=console_image_filename(source,&image.path);
        tx.execute("INSERT INTO repository_platform_images VALUES(?1,?2,?3,'World',?4)",params![source,filename,kind,image.sha256]).map_err(err)?;
        tx.execute("INSERT OR REPLACE INTO image_urls VALUES(?1,?2)",params![filename,format!("{raw}{}",url_path(&image.path))]).map_err(err)?;
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
    let raw=sources::base(&conn,source)?;
    drop(conn);
    if !cached {
        let file=job.directory.join("console-artwork.json");
        let present=download_file(&http_client()?,&format!("{raw}console_artwork.json"),&file,4*1024*1024,job,true,|_,_|())?;
        if !present {
            // Some repositories only publish game artwork. Cache an empty
            // console manifest until the next catalog refresh.
            fs::write(&file,serde_json::to_vec(&serde_json::json!({"schema_version":1,"system":source,"images":{}})).map_err(err)?).map_err(err)?;
        }
        let next=job.directory.join("console.next.db");fs::copy(&path,&next).map_err(err)?;
        let mut conn=Connection::open(&next).map_err(err)?;
        insert_console_artwork(&mut conn,source,&file)?;
        drop(conn);job.check()?;replace_catalog(&next,&path)?;
        job.image_urls.lock().map_err(err)?.clear();
    }
    let conn=open_catalog(&path)?;
    conn.prepare("SELECT filename,kind,region,crc FROM repository_platform_images WHERE platform=?1 ORDER BY kind,filename").map_err(err)?
        .query_map([source],|r|Ok(CatalogImage{ source: None,filename:r.get(0)?,kind:r.get(1)?,region:r.get(2)?,crc:r.get(3)?})).map_err(err)?
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
    if number.is_empty() || !number.bytes().all(|b|b.is_ascii_digit()) || !["svg","webp","png","jpg","jpeg","avif"].contains(&extension) {return None;}
    Some(format!("repo-console-{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn libretro_paths_get_exact_file_links_without_guessing_unknown_sources() {
        let origin = |sources: serde_json::Value| image_origin("Sega - Dreamcast", &serde_json::from_value::<Vec<RepoImageSource>>(sources).unwrap());
        for directory in ["Named_Boxarts", "Named_Snaps", "Named_Titles", "Named_Logos"] {
            let source=origin(serde_json::json!([{"source":format!("{directory}/Sonic & Knuckles (USA) #1.png")}])).unwrap();
            assert!(source.uploader.is_none());
            assert_eq!(source.url.unwrap(),format!("https://github.com/libretro-thumbnails/Sega_-_Dreamcast/blob/master/{directory}/Sonic%20%26%20Knuckles%20%28USA%29%20%231.png"));
        }
        for source in serde_json::json!([
            {}, {"source":"Unknown/cover.png"}, {"source":"Named_Boxarts/../cover.png"},
            {"source":"Named_Boxarts/cover.png","provider":"another-source"}
        ]).as_array().unwrap() {
            assert!(origin(serde_json::json!([source])).is_none());
        }
        let known=origin(serde_json::json!([{"source":"Named_Boxarts/cover.png","file_page":"https://segaretro.org/File:Exact.jpg","uploader":"Scanner"}])).unwrap();
        assert_eq!(known.url.as_deref(),Some("https://segaretro.org/File:Exact.jpg"));
        assert_eq!(known.uploader.as_deref(),Some("Scanner"));
        let saturn: Vec<RepoImageSource> = serde_json::from_value(serde_json::json!([{
            "source":"Named_Logos/Sonic 3D Blast (USA).png",
            "dat_name":"Sonic 3D Blast (USA)","match":"exact"
        }])).unwrap();
        let logo=image_origin("Sega - Saturn",&saturn).unwrap();
        assert_eq!(logo.url.as_deref(),Some("https://github.com/libretro-thumbnails/Sega_-_Saturn/blob/master/Named_Logos/Sonic%203D%20Blast%20%28USA%29.png"));
    }
    const SUBMODULES: &str = include_str!("../../tests/fixtures/repository-submodules.json");
    #[test]
    fn localized_catalog_titles_preserve_original_filename_and_serial_matching_after_reopening() {
        let files = Sandbox::new();
        let mut conn = files.catalog();
        let source = "Sony - PlayStation 3";
        let original = "Uncharted - Drake's Fortune (Asia) (En,Zh,Ko)";
        let fixture = files.job.directory.join("localized-titles.json");
        let data = serde_json::json!({"schema_version":2,"system":source,
            "games":{
                "BCAS-20024":{"entries":[{"name":original,"region":"Asia"}],"metadata_id":"gametdb:BCAS20024"},
                "EMPTY":{"entries":[{"name":"Unlabelled (USA)"}],"metadata_id":"empty"},
                "MISSING":{"entries":[{"name":"No metadata (Europe)"}]}
            },
            "metadata":{
                "gametdb:BCAS20024":{"labels":{"en":"Uncharted: Drake's Fortune","es":"Uncharted: El tesoro de Drake","mul":"Uncharted: Drake's Fortune"}},
                "empty":{"labels":{"en":" ","es":""}}
            }});
        fs::write(&fixture, serde_json::to_vec(&data).unwrap()).unwrap();
        insert_platform(&mut conn, &files.job, source, &fixture, |_| ()).unwrap();
        drop(conn);
        let conn = open_catalog(&files.job.catalog_path()).unwrap();
        let id = token(&format!("{source}/BCAS-20024"));
        let json: String = conn.query_row("SELECT details FROM games WHERE id=?1", [id], |r| r.get(0)).unwrap();
        let stored: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(stored["_localized"]["es"]["title"], "Uncharted: El tesoro de Drake");
        assert_eq!(stored["_localized"]["en"]["title"], "Uncharted: Drake's Fortune");
        for title in [original, "BCAS-20024", "Uncharted: El tesoro de Drake", "Uncharted: Drake's Fortune"] {
            let results = search_catalog(&conn, title, source).unwrap();
            assert_eq!(results.len(), 1);
            assert!(results[0].exact);
            assert_eq!(results[0].game.id, id);
            assert!(!results[0].game.title.contains("(Asia)"));
        }
        let matches = search_candidate(&conn, "Wrong title", source, &format!("/roms/{original}.iso")).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].game.id, id);
        assert_eq!(matches[0].regions, vec!["Asia"]);
        for (serial, title) in [("EMPTY", "Unlabelled (USA)"), ("MISSING", "No metadata (Europe)")] {
            assert_eq!(search_catalog(&conn, serial, source).unwrap()[0].game.title, title);
        }
    }
    #[test]
    fn imports_prefer_the_configured_region_only_when_the_filename_has_no_region() {
        let files=Sandbox::new();let mut conn=files.catalog();let source="Nintendo - Switch";
        conn.execute("INSERT INTO platforms VALUES(?1)",[source]).unwrap();
        let fixture=files.job.directory.join("region-default.json");
        let mut data:serde_json::Value=serde_json::from_str(include_str!("../../tests/fixtures/repository-switch-regions.json")).unwrap();
        data["games"]["AAAAC2"]=data["games"]["AAAAC"].clone();
        fs::write(&fixture,serde_json::to_vec(&data).unwrap()).unwrap();
        insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
        let results=search_candidate(&conn,"Switch Example",source,"Renamed.nsp").unwrap();
        for (preferred,key) in [("USA","AAAAC"),("U","AAAAC"),("US","AAAAC"),("North America","AAAAC"),("EU","AAAAE"),("Europe","AAAAE"),("Japan","AAAAJ"),("JPN","AAAAJ"),("ALL","AAAAA")] {
            assert_eq!(import_match(&conn,&results,"Renamed.nsp",preferred).unwrap(),Some(token(&format!("{source}/{key}"))),"{preferred}");
        }
        assert_eq!(import_match(&conn,&results,"Switch Example (Japan).nsp","USA").unwrap(),Some(token(&format!("{source}/AAAAJ"))));
        assert_eq!(import_match(&conn,&results,"Switch Example (E).nsp","Japan").unwrap(),Some(token(&format!("{source}/AAAAE"))));
        let fuzzy=search_catalog(&conn,"Switch Examp",source).unwrap();
        assert_eq!(import_match(&conn,&fuzzy,"Switch Examp.nsp","USA").unwrap(),None,"approximate names still need review");
    }

    #[test]
    fn switch_search_results_keep_release_regions_separate_from_artwork_and_localized_titles() {
        let files=Sandbox::new();let mut conn=files.catalog();let source="Nintendo - Switch";
        conn.execute("INSERT INTO platforms VALUES(?1)",[source]).unwrap();
        let path=files.job.directory.join("switch-regions.json");
        fs::write(&path,include_str!("../../tests/fixtures/repository-switch-regions.json")).unwrap();
        insert_platform(&mut conn,&files.job,source,&path,|_|()).unwrap();
        for (serial,region) in [("AAAAA","World"),("AAAAJ","Japan"),("AAAAE","Europe"),("AAAAC","North America")] {
            let result=search_catalog(&conn,serial,source).unwrap();assert_eq!(result.len(),1);
            assert_eq!(result[0].game.title,"Switch Example");assert_eq!(result[0].regions,vec![region]);
        }
        let unknown=search_catalog(&conn,"AAUNK",source).unwrap();assert!(unknown[0].regions.is_empty());
        assert!(serde_json::to_value(&unknown[0]).unwrap().get("regions").is_none());
        let found=search_candidate(&conn,"Switch Example",source,"renamed.nsp").unwrap();
        assert_eq!(found.len(),4);assert!(found.iter().all(|result|result.regions.len()==1));
        let fuzzy=search_catalog(&conn,"Switch Examp",source).unwrap();
        assert!(!fuzzy.is_empty());assert!(fuzzy.iter().all(|result|result.regions.len()==1));
        // Older indexed platforms are rebuilt once, retaining the same game IDs.
        conn.execute("UPDATE repository_versions SET version=3 WHERE name=?1",[source]).unwrap();
        insert_platform(&mut conn,&files.job,source,&path,|_|()).unwrap();
        assert_eq!(conn.query_row("SELECT version FROM repository_versions WHERE name=?1",[source],|r|r.get::<_,i64>(0)).unwrap(),REPOSITORY_GAME_VERSION);
        drop(conn);
        let conn=open_catalog(&files.job.catalog_path()).unwrap();
        let result=search_catalog(&conn,"AAAAA",source).unwrap();
        assert_eq!(result[0].game.id,token("Nintendo - Switch/AAAAA"));
        assert_eq!(result[0].regions,vec!["World"]);
        // The editor's preferred-match path uses the same persisted regions.
        let selected=finish_search_results(&conn,vec![SearchResult{game:result[0].game.clone(),exact:true,source_key:None,regions:Vec::new()}]).unwrap();
        assert_eq!(selected[0].regions,vec!["World"]);
    }

    #[test]
    fn repository_indexes_pdf_and_cbz_as_manuals_separately_from_artwork() {
        let sandbox = Sandbox::new();
        let mut conn = sandbox.catalog();
        let mut fixture: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        let images = fixture["games"]["SLUS-12345"]["images"].as_object_mut().unwrap();
        images.insert("manual".into(), serde_json::json!({"kind":"manual","path":"SLUS-12345/manual.pdf","sha256":"pdf"}));
        images.insert("manual2".into(), serde_json::json!({"kind":"manual","path":"SLUS-12345/manual2.cbz","sha256":"cbz"}));
        images.insert("manual3".into(), serde_json::json!({"kind":"manual","path":"../manual.pdf"}));
        let file = sandbox.job.directory.join("manuals.json");
        fs::write(&file, serde_json::to_vec(&fixture).unwrap()).unwrap();
        insert_platform(&mut conn, &sandbox.job, "Sony - PlayStation 2", &file, |_| ()).unwrap();
        let id = token("Sony - PlayStation 2/SLUS-12345");
        let available = available_image_types(&conn, &[id], &sandbox.job).unwrap();
        assert_eq!(available.manual_count, 2);
        assert!(!available.counts.contains_key("manual"));
        let manuals: Vec<(String,String)> = conn.prepare("SELECT filename,url FROM images JOIN image_urls USING(filename) WHERE game_id=?1 AND kind='manual' ORDER BY url")
            .unwrap().query_map([id],|row|Ok((row.get(0)?,row.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(manuals.len(),2);
        assert!(manuals.iter().all(|(file,url)|safe_manual_name(file) && (url.ends_with("manual.pdf") || url.ends_with("manual2.cbz"))));
    }
    pub(super) const FIXTURE: &str = r#"{"schema_version":2,"system":"Sony - PlayStation 2","games":{
      "SLUS-12345":{"entries":[{"name":"Example Game (USA)"}],"images":{
        "cover_front":{"kind":"cover_front","path":"SLUS-12345/cover_front.webp","sha256":"a","sources":[{"dat_name":"Example Game (USA)"}]},
        "cover_front2":{"kind":"cover_front2","path":"SLUS-12345/cover_front2.webp","sha256":"b"},
        "disc":{"kind":"disc","path":"SLUS-12345/disc.webp"},
        "bad":{"kind":"logo","path":"../bad.webp"}}},
      "SLES-54321":{"entries":[{"name":"Example Game (Europe)"}],"images":{"logo":{"kind":"logo","path":"SLES-54321/logo.webp"}}}
    }}"#;
    pub(super) struct Sandbox {
        pub(super) root: PathBuf,
        pub(super) job: Arc<ImportJob>,
    }
    impl Sandbox {
        pub(super) fn new() -> Self {
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
        pub(super) fn catalog(&self) -> Connection {
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
            // Fixture catalogs are already prepared; individual index tests
            // opt into a simulated refresh explicitly, without network access.
            self.job.repository_index_checked.store(true, Ordering::Release);
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
    fn weekly_updates_only_download_changed_catalogs_and_preserve_the_previous_one_on_failure() {
        let files=Sandbox::new();let conn=files.catalog();
        assert!(!weekly_check_due(&conn).unwrap());
        conn.execute("UPDATE catalog_info SET downloaded_at=datetime('now','-8 days')",[]).unwrap();assert!(weekly_check_due(&conn).unwrap());
        let before=fs::read(files.job.catalog_path()).unwrap();drop(conn);
        let mut downloads=0;
        update_cached_platforms_with(&files.job,None,|_|(),|url,file,_,_|{
            if url.contains("/commits?") {assert!(url.contains("path=Sony+-+PlayStation+2%2Fcatalog.json"));fs::write(file,r#"[{"sha":"revision-one","commit":{"committer":{"date":"2099-01-01T00:00:00Z"}}}]"#).map(|_|true).map_err(err)}
            else if url.ends_with("catalog.sqlite") {Ok(false)}
            else{downloads+=1;fs::write(file,FIXTURE).map(|_|true).map_err(err)}
        }).unwrap();assert_eq!(downloads,1);
        let conn=open_catalog(&files.job.catalog_path()).unwrap();assert!(!weekly_check_due(&conn).unwrap());drop(conn);
        update_cached_platforms_with(&files.job,None,|_|(),|url,file,_,_|{
            assert!(url.contains("/commits?"));fs::write(file,r#"[{"sha":"revision-one"}]"#).map(|_|true).map_err(err)
        }).unwrap();
        let current=fs::read(files.job.catalog_path()).unwrap();
        assert!(update_cached_platforms_with(&files.job,None,|_|(),|_,_,_,_|Err("offline".into())).is_err());assert_eq!(fs::read(files.job.catalog_path()).unwrap(),current);
        assert!(update_cached_platforms_with(&files.job,None,|_|(),|url,file,_,_|fs::write(file,if url.contains("/commits?"){r#"[{"sha":"revision-two"}]"#}else{"invalid"}).map(|_|true).map_err(err)).is_err());assert_eq!(fs::read(files.job.catalog_path()).unwrap(),current);
        assert_ne!(before,current);
        assert!(prepare_for_import(&files.job,false,false,|_|()).is_ok());
    }

    #[test]
    #[ignore="Reads public SQLite samples downloaded into target; no network or user data"]
    fn indexes_public_ps1_and_ps2_sqlite_samples() {
        for (file,source) in [("ps1-repository.sqlite","Sony - PlayStation"),("ps2-repository.sqlite","Sony - PlayStation 2")] {
            let files=Sandbox::new();let mut conn=files.catalog();
            conn.execute("INSERT OR IGNORE INTO platforms VALUES(?1)",[source]).unwrap();
            let path=Path::new(env!("CARGO_MANIFEST_DIR")).join("../target").join(file);
            let started=Instant::now();
            insert_platform(&mut conn,&files.job,source,&path,|_|()).unwrap();
            let count:i64=conn.query_row("SELECT COUNT(*) FROM games WHERE platform=?1",[source],|r|r.get(0)).unwrap();
            let images:i64=conn.query_row("SELECT COUNT(*) FROM images WHERE game_id IN (SELECT id FROM games WHERE platform=?1)",[source],|r|r.get(0)).unwrap();
            assert!(count>1000);assert!(images>1000);
            assert_eq!(catalog_filename(&conn,source),"catalog.sqlite");
            let key:String=conn.query_row("SELECT source_key FROM repository_keys WHERE source_key LIKE ?1 LIMIT 1",[format!("{source}/%")],|r|r.get(0)).unwrap();
            assert!(!search_catalog(&conn,key.split('/').next_back().unwrap(),source).unwrap().is_empty());
            eprintln!("{source}: {count} games, {images} images in {:?}",started.elapsed());
        }
    }

    #[test]
    fn avif_repository_game_and_console_images_keep_their_extension() {
        let files=Sandbox::new();let mut conn=files.catalog();let source="Sony - PlayStation 2";
        let mut data:serde_json::Value=serde_json::from_str(FIXTURE).unwrap();
        data["games"]["SLUS-12345"]["images"]["cover_front"]["path"]=serde_json::json!("SLUS-12345/cover_front.avif");
        let file=files.job.directory.join("avif.json");fs::write(&file,serde_json::to_vec(&data).unwrap()).unwrap();insert_platform(&mut conn,&files.job,source,&file,|_|()).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM images WHERE game_id=?1 AND kind='cover' AND filename LIKE '%.avif'",[token("Sony - PlayStation 2/SLUS-12345")],|r|r.get::<_,i64>(0)).unwrap(),1);
        fs::write(&file,serde_json::to_vec(&serde_json::json!({"schema_version":1,"system":source,"images":{"logo":{"path":"logo.avif","kind":"logo"}}})).unwrap()).unwrap();
        insert_console_artwork(&mut conn,source,&file).unwrap();
        let filename:String=conn.query_row("SELECT filename FROM repository_platform_images WHERE kind='logo'",[],|r|r.get(0)).unwrap();assert!(filename.ends_with(".avif"));assert_eq!(retained_console_filename(Path::new(&filename)),Some(filename));
    }
    #[test]
    fn discovers_submodules_from_contents_listings_and_uses_child_main_for_games_and_consoles() {
        let files=Sandbox::new();let mut conn=files.catalog();
        sources::apply(&mut conn,serde_json::from_str(SUBMODULES).unwrap()).unwrap();
        assert_eq!(sources::base(&conn,"Nintendo - Switch").unwrap(),"https://raw.githubusercontent.com/Utogu9/Nintendo_-_Switch/main/");
        assert_eq!(sources::base(&conn,"Sega - Dreamcast").unwrap(),"https://raw.githubusercontent.com/Utogu9/Sega_-_Dreamcast/main/");
        for (source,repo) in [("Sony - PlayStation 3","Sony_-_PlayStation_3"),("Nintendo - Switch 2","Nintendo_-_Switch_2"),("Sega - Mega Drive - Genesis","Sega_-_Mega_Drive_-_Genesis")] {
            assert_eq!(sources::base(&conn,source).unwrap(),format!("https://raw.githubusercontent.com/Utogu9/{repo}/main/"));
        }
        assert_eq!(sources::base(&conn,"Sony - PlayStation 2").unwrap(),format!("{RAW_URL}Sony%20-%20PlayStation%202/"));
        let names:Vec<String>=conn.prepare("SELECT name FROM platforms ORDER BY name").unwrap()
            .query_map([],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(names,vec!["Nintendo - Switch","Nintendo - Switch 2","Sega - Dreamcast","Sega - Mega Drive - Genesis","Sony - PlayStation 2","Sony - PlayStation 3"]);
        let file=files.job.directory.join("switch.json");fs::write(&file,include_str!("../../tests/fixtures/repository-switch.json")).unwrap();
        insert_platform(&mut conn,&files.job,"Nintendo - Switch",&file,|_|()).unwrap();
        let result=search_candidate(&conn,"wrong title","Nintendo - Switch","Switch Example (EN,ES).nsp").unwrap();
        assert_eq!(result.len(),1);let game=&result[0].game;
        assert_eq!(game.id,token("Nintendo - Switch/AAAAA"));assert_eq!(game.platform,"Nintendo - Switch");
        assert_eq!(game.release_date.as_deref(),Some("2017-03-03"));assert_eq!(game.developer.as_deref(),Some("Example developer"));
        assert_eq!(game.publisher.as_deref(),Some("Example publisher"));assert_eq!(game.max_players,Some(1));assert!(game.description.is_some());
        let urls:Vec<String>=conn.prepare("SELECT url FROM image_urls WHERE filename IN (SELECT filename FROM images WHERE game_id=?1)").unwrap()
            .query_map([game.id],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(urls.len(),2);assert!(urls.iter().all(|url|url.starts_with("https://raw.githubusercontent.com/Utogu9/Nintendo_-_Switch/main/AAAAA/")));
        let regions:Vec<String>=conn.prepare("SELECT region FROM images WHERE game_id=?1 ORDER BY region").unwrap()
            .query_map([game.id],|r|r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        assert_eq!(regions,vec!["Japan","North America"]);
        fs::write(&file,r#"{"schema_version":1,"system":"Nintendo Switch","images":{"logo":{"path":"logo.svg","kind":"logo"}}}"#).unwrap();
        insert_console_artwork(&mut conn,"Nintendo - Switch",&file).unwrap();
        let logo=console_image_filename("Nintendo - Switch","logo.svg");
        assert_eq!(image_url(&files.job,platforms::PLATFORM_IMAGES,&logo).unwrap(),"https://raw.githubusercontent.com/Utogu9/Nintendo_-_Switch/main/logo.svg");
        // The new source is still usable after restarting, without contacting GitHub.
        drop(conn);ensure_platform(&files.job,"Nintendo - Switch",|_|panic!("must remain cached")).unwrap();
    }

    #[test]
    fn existing_platform_catalogs_relocate_saved_game_and_console_urls_without_changing_identities() {
        for (source,repo) in [("Sega - Dreamcast","Sega_-_Dreamcast"),("Sony - PlayStation 3","Sony_-_PlayStation_3"),("Nintendo - Switch 2","Nintendo_-_Switch_2"),("Sega - Mega Drive - Genesis","Sega_-_Mega_Drive_-_Genesis")] {
            let files=Sandbox::new();let mut conn=files.catalog();
            conn.execute("INSERT INTO platforms VALUES(?1)",[source]).unwrap();
            let fixture=files.job.directory.join("platform.json");fs::write(&fixture,FIXTURE.replace("Sony - PlayStation 2",source)).unwrap();
            insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
            fs::write(&fixture,serde_json::to_vec(&serde_json::json!({"schema_version":1,"system":source,"images":{"logo":{"path":"logo.svg","kind":"logo"}}})).unwrap()).unwrap();
            insert_console_artwork(&mut conn,source,&fixture).unwrap();
            let old_prefix=format!("{RAW_URL}{}/",url_path(source));
            let rows:Vec<(String,String)>=conn.prepare("SELECT filename,url FROM image_urls WHERE substr(url,1,length(?1))=?1 ORDER BY filename").unwrap()
                .query_map([&old_prefix],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
            assert!(rows.len()>1);let before=catalog_summary(&files.job.catalog_path()).unwrap().game_count;
            conn.execute_batch("DROP TABLE repository_sources").unwrap();drop(conn);
            files.job.repository_index_checked.store(false, Ordering::Release);
            assert_eq!(image_url(&files.job,IMAGE_BASE,&rows[0].0).unwrap(),rows[0].1);
            prepare_with_index(&files.job,false,|_|(),|path,_|fs::write(path,SUBMODULES).map_err(err)).unwrap();
            assert!(files.job.image_urls.lock().unwrap().is_empty());
            let reopened=open_catalog(&files.job.catalog_path()).unwrap();
            assert_eq!(catalog_summary(&files.job.catalog_path()).unwrap().game_count,before);
            for (filename,old) in rows {
                let expected=old.replacen(&old_prefix,&format!("https://raw.githubusercontent.com/Utogu9/{repo}/main/"),1);
                assert_eq!(image_url(&files.job,IMAGE_BASE,&filename).unwrap(),expected);
            }
            assert_eq!(search_catalog(&reopened,"Example Game",source).unwrap().len(),2);
            assert!(sources::indexed(&reopened));drop(reopened);
            ensure_platform(&files.job,source,|_|panic!("migration must preserve prepared games")).unwrap();
        }
    }

    #[test]
    fn source_migration_keeps_old_catalogs_offline_and_failed_refreshes_never_replace_them() {
        let files=Sandbox::new();let conn=files.catalog();conn.execute_batch("DROP TABLE repository_sources").unwrap();drop(conn);
        files.job.repository_index_checked.store(false, Ordering::Release);
        let before=fs::read(files.job.catalog_path()).unwrap();
        prepare_with_index(&files.job,false,|_|(),|_,_|Err("offline".into())).unwrap();
        prepare_with_index(&files.job,false,|_|(),|_,_|panic!("only attempt the automatic upgrade once per job")).unwrap();
        assert_eq!(fs::read(files.job.catalog_path()).unwrap(),before);
        assert!(prepare_with_index(&files.job,true,|_|(),|_,_|Err("offline".into())).is_err());
        assert!(prepare_with_index(&files.job,true,|_|(),|path,_|fs::write(path,"[]").map_err(err)).is_err());
        assert_eq!(fs::read(files.job.catalog_path()).unwrap(),before);
        prepare_with_index(&files.job,true,|_|(),|path,_|fs::write(path,SUBMODULES).map_err(err)).unwrap();
        assert!(sources::indexed(&open_catalog(&files.job.catalog_path()).unwrap()));
    }

    #[test]
    fn future_submodules_are_discovered_even_with_an_existing_source_index() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let original=r#"[{"name":"Sony - PlayStation 2","type":"dir"}]"#;
        sources::apply(&mut conn,serde_json::from_str(original).unwrap()).unwrap();
        let before_count=catalog_summary(&files.job.catalog_path()).unwrap().game_count;
        let before_urls:Vec<(String,String)>=conn.prepare("SELECT filename,url FROM image_urls ORDER BY filename").unwrap()
            .query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
        drop(conn);
        let updated=r#"[
            {"name":"Sony - PlayStation 2","type":"file","git_url":"https://api.github.com/repos/example/future-ps2-library/git/trees/pinned-commit"},
            {"name":"Future console","type":"submodule","submodule_git_url":"https://github.com/example/new-console.git"}
        ]"#;
        files.job.repository_index_checked.store(false, Ordering::Release);
        prepare_with_index(&files.job,false,|_|(),|path,_|fs::write(path,updated).map_err(err)).unwrap();
        let conn=open_catalog(&files.job.catalog_path()).unwrap();
        assert_eq!(sources::base(&conn,"Future console").unwrap(),"https://raw.githubusercontent.com/example/new-console/main/");
        assert_eq!(catalog_summary(&files.job.catalog_path()).unwrap().game_count,before_count);
        let old=format!("{RAW_URL}Sony%20-%20PlayStation%202/");
        for (filename,url) in before_urls {
            let actual:String=conn.query_row("SELECT url FROM image_urls WHERE filename=?1",[filename],|r|r.get(0)).unwrap();
            assert_eq!(actual,url.replacen(&old,"https://raw.githubusercontent.com/example/future-ps2-library/main/",1));
        }
        drop(conn);
        ensure_platform(&files.job,"Sony - PlayStation 2",|_|panic!("preserve the indexed game catalog")).unwrap();
        prepare_with_index(&files.job,false,|_|(),|_,_|panic!("check only once per operation")).unwrap();
        let before=fs::read(files.job.catalog_path()).unwrap();
        files.job.repository_index_checked.store(false, Ordering::Release);
        prepare_with_index(&files.job,false,|_|(),|path,_|fs::write(path,updated).map_err(err)).unwrap();
        assert_eq!(fs::read(files.job.catalog_path()).unwrap(),before,"unchanged routes must not rebuild the catalog");
        files.job.repository_index_checked.store(false, Ordering::Release);
        prepare_with_index(&files.job,false,|_|(),|_,_|Err("GitHub unavailable or rate-limited".into())).unwrap();
        assert_eq!(fs::read(files.job.catalog_path()).unwrap(),before);
    }

    #[test]
    fn source_index_rejects_unsafe_endpoints_and_accepts_explicit_submodule_entries() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let entries=serde_json::from_value(serde_json::json!([
            {"name":"Safe","type":"submodule","submodule_git_url":"https://github.com/example/safe.git"},
            {"name":"Wrong host","type":"file","git_url":"https://api.github.com.evil.example/repos/a/b/git/trees/sha"},
            {"name":"Insecure","type":"submodule","submodule_git_url":"http://github.com/a/b.git"},
            {"name":"Credentials","type":"submodule","submodule_git_url":"https://user:password@github.com/a/b.git"},
            {"name":"../Escape","type":"dir"}, {"name":"Ordinary file","type":"file","git_url":"https://api.github.com/repos/a/b/git/blobs/sha"}
        ])).unwrap();
        sources::apply(&mut conn,entries).unwrap();
        let count:i64=conn.query_row("SELECT count(*) FROM repository_sources",[],|r|r.get(0)).unwrap();
        assert_eq!(count,1);assert_eq!(sources::base(&conn,"Safe").unwrap(),"https://raw.githubusercontent.com/example/safe/main/");
        let bad=files.job.directory.join("bad-switch.json");fs::write(&bad,r#"{"schema_version":2,"system":"Nintendo Wii","games":{}}"#).unwrap();
        assert!(insert_platform(&mut conn,&files.job,"Nintendo - Switch",&bad,|_|()).is_err());
    }

    #[test]
    fn missing_optional_console_manifests_are_empty_but_http_failures_still_surface() {
        use std::net::TcpListener;
        let files=Sandbox::new();let mut conn=files.catalog();
        sources::apply(&mut conn,serde_json::from_str(SUBMODULES).unwrap()).unwrap();
        let file=files.job.directory.join("optional-console.json");
        for (status,optional,expected) in [(404,true,Some(false)),(200,true,Some(true)),(500,true,None),(404,false,None)] {
            let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
            let server=std::thread::spawn(move||{
                let (mut socket,_)=listener.accept().unwrap();let mut request=[0u8;2048];socket.read(&mut request).unwrap();
                write!(socket,"HTTP/1.1 {status} Test\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
            });
            fs::write(&file,"stale manifest").unwrap();
            let result=download_file(&http_client().unwrap(),&format!("http://{address}/console_artwork.json"),&file,1024,&files.job,optional,|_,_|());
            server.join().unwrap();assert_eq!(result.ok(),expected);
            assert_eq!(file.exists(),expected==Some(true),"A missing manifest cannot reuse a file from another platform");
        }
        fs::write(&file,r#"{"schema_version":1,"system":"Nintendo Switch","images":{}}"#).unwrap();
        insert_console_artwork(&mut conn,"Nintendo - Switch",&file).unwrap();drop(conn);
        assert!(console_images(&files.job,"Nintendo - Switch").unwrap().is_empty());
    }

    #[test]
    #[ignore="Reads the public submodule samples downloaded into target; no network or user library changes"]
    fn indexes_current_submodule_samples() {
        let files=Sandbox::new();let mut conn=files.catalog();
        let index=Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/bdd-root-index.json");
        let entries=serde_json::from_reader(BufReader::new(File::open(index).unwrap())).unwrap();
        sources::apply(&mut conn,entries).unwrap();
        for (source,repo,title) in [("Nintendo - Switch","Nintendo_-_Switch","The Legend of Zelda: Breath of the Wild"),("Sega - Dreamcast","Sega_-_Dreamcast","Sonic Adventure"),("Sony - PlayStation 3","Sony_-_PlayStation_3","Uncharted"),("Nintendo - Switch 2","Nintendo_-_Switch_2","Mario Kart World"),("Sega - Mega Drive - Genesis","Sega_-_Mega_Drive_-_Genesis","Sonic")] {
            let path=Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../target/{repo}-catalog.json"));
            insert_platform(&mut conn,&files.job,source,&path,|_|()).unwrap();
            let found=search_catalog(&conn,title,source).unwrap();assert!(!found.is_empty());
            let id=found[0].game.id;
            let url:String=conn.query_row("SELECT u.url FROM images i JOIN image_urls u USING(filename) WHERE i.game_id=?1 LIMIT 1",[id],|r|r.get(0)).unwrap();
            assert!(url.starts_with(&format!("https://raw.githubusercontent.com/Utogu9/{repo}/main/")));
            if source=="Nintendo - Switch" {assert!(found[0].game.description.is_some());assert!(found[0].game.developer.is_some());assert_eq!(found[0].regions,vec!["World"]);}
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
    fn genesis_compact_tags_match_the_complete_region_set_before_single_region_variants() {
        let files=Sandbox::new();let mut conn=files.catalog();let source="Sega - Mega Drive - Genesis";
        let fixture=files.job.directory.join("genesis-regions.json");
        fs::write(&fixture,serde_json::json!({"schema_version":2,"system":source,"games":{
            "US":{"entries":[{"name":"Alien 3 (USA)"}]},
            "EU":{"entries":[{"name":"Alien 3 (Europe)"}]},
            "JP":{"entries":[{"name":"Alien 3 (Japan)"}]},
            "WORLD":{"entries":[{"name":"Alien 3 (World)"}]},
            "US-EU":{"entries":[{"name":"Alien 3 (USA, Europe)"}]},
            "JP-US":{"entries":[{"name":"Alien 3 (USA, Japan)"}]}
        }}).to_string()).unwrap();
        insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
        for (tag,serial) in [("U","US"),("E","EU"),("J","JP"),("W","WORLD"),("UE","US-EU"),("JU","JP-US")] {
            let path=format!("M:/Roms/Alien 3 ({tag}) (REV00) [!].gen");
            let found=search_candidate(&conn,"Alien 3",source,&path).unwrap();
            assert_eq!(regional_match(&conn,&found,&path).unwrap(),Some(token(&format!("{source}/{serial}"))),"{path}");
        }
        let found=search_catalog(&conn,"Alien 3",source).unwrap();
        assert_eq!(regional_match(&conn,&found,"Alien 3 (JUE).gen").unwrap(),Some(token(&format!("{source}/JP"))),"when no release covers every region, prefer the first compatible region");
    }

    #[test]
    fn ecco_compact_regions_accept_a_catalog_release_with_additional_regions_and_north_america_aliases() {
        for north_america in ["USA", "North America"] {
            let files=Sandbox::new();let mut conn=files.catalog();let source="Sega - Mega Drive - Genesis";
            let fixture=files.job.directory.join("ecco-regions.json");
            fs::write(&fixture,serde_json::json!({"schema_version":2,"system":source,"games":{
                "G-4106-00":{"entries":[{"name":"Ecco the Dolphin (Japan)"}],"metadata_id":"ecco"},
                "MK-1042-00":{"entries":[{"name":format!("Ecco the Dolphin ({north_america}, Europe, Korea) (En)")}],"metadata_id":"ecco"},
                "SEQUEL":{"entries":[{"name":"Ecco the Dolphin II (USA, Europe)"}]}
            },"metadata":{"ecco":{"labels":{"en":"Ecco the Dolphin","es":"Ecco the Dolphin"}}}}).to_string()).unwrap();
            insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
            for tag in ["UE", "U", "E", "USA, Europe", "North America, Europe"] {
                let path=format!("M:/Roms/ECCO The Dolphin ({tag}) [!].gen");
                let found=search_candidate(&conn,"ECCO The Dolphin",source,&path).unwrap();
                assert_eq!(found.len(),2,"exclude the sequel from exact matches");
                assert_eq!(regional_match(&conn,&found,&path).unwrap(),Some(token(&format!("{source}/MK-1042-00"))),"{path} / {north_america}");
            }
            let found=search_catalog(&conn,"Ecco the Dolphin",source).unwrap();
            assert_eq!(regional_match(&conn,&found,"ECCO The Dolphin (J).gen").unwrap(),Some(token(&format!("{source}/G-4106-00"))));
            let europe=token(&format!("{source}/MK-1042-00"));
            conn.execute("UPDATE names SET name='Ecco the Dolphin (Europe)',normalized=?1 WHERE game_id=?2 AND name LIKE '%Korea%'",params![normalize("Ecco the Dolphin (Europe)"),europe]).unwrap();
            let json:String=conn.query_row("SELECT details FROM games WHERE id=?1",[europe],|r|r.get(0)).unwrap();
            let mut json:serde_json::Value=serde_json::from_str(&json).unwrap();json["_release_names"]=serde_json::json!(["Ecco the Dolphin (Europe)"]);
            conn.execute("UPDATE games SET details=?1 WHERE id=?2",params![json.to_string(),europe]).unwrap();
            assert_eq!(regional_match(&conn,&found,"ECCO The Dolphin (UE).gen").unwrap(),Some(europe),"try Europe when USA is unavailable");
        }
    }

    #[test]
    fn genesis_matching_uses_each_release_title_and_region_instead_of_unrelated_entries_in_the_same_record() {
        let files=Sandbox::new();let mut conn=files.catalog();let source="Sega - Mega Drive - Genesis";
        let fixture=files.job.directory.join("release-preferences.json");
        fs::write(&fixture,serde_json::json!({"schema_version":2,"system":source,"games":{
            "MK-1535-00":{"entries":[{"name":"Adventures of Batman & Robin, The (Europe)"},{"name":"Adventures of Batman & Robin, The (USA)"}],"metadata_id":"batman"},
            "SHORT":{"entries":[{"name":"Battle Squadron (USA, Europe)"},{"name":"Road Rash (Japan)"}]},
            "ROAD-BASE":{"entries":[{"name":"Road Rash (USA, Europe)"}],"metadata_id":"road"},
            "BETA":{"entries":[{"name":"Road Rash (USA, Europe) (Beta)"}]},
            "REV":{"entries":[{"name":"Road Rash (USA, Europe) (Rev A)"}]}
        },"metadata":{"batman":{"labels":{"en":"The Adventures of Batman & Robin","es":"The Adventures of Batman & Robin"}},"road":{"labels":{"en":"Road Rash","es":"Road Rash"}}}}).to_string()).unwrap();
        insert_platform(&mut conn,&files.job,source,&fixture,|_|()).unwrap();
        for (rom,title,serial) in [
            ("Adventures of Batman and Robin, The (U) [!].gen","Adventures of Batman and Robin, The","MK-1535-00"),
            ("Road Rash (UE) [!].gen","Road Rash","ROAD-BASE"),
            ("Road Rash (UE) (REV01) [!].gen","Road Rash","REV"),
            ("Road Rash (J) [!].gen","Road Rash","SHORT"),
        ] {
            let found=search_candidate(&conn,title,source,rom).unwrap();
            let exact:Vec<_>=found.iter().filter(|r|r.exact).collect();
            let selected=if exact.len()==1{Some(exact[0].game.id)}else{regional_match(&conn,&found,rom).unwrap()};
            assert_eq!(selected,Some(token(&format!("{source}/{serial}"))),"{rom}");
        }
    }

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
            ("SLUS-21000.iso", "SLUS-21000"),
            ("SLUS_210.00.iso", "SLUS-21000"),
            ("SLUS21000.chd", "SLUS-21000"),
        ] {
            let found = search_candidate(&conn, "Wrong title", platform, name).unwrap();
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].game.id, token(&format!("{platform}/{serial}")));
        }
        let fallback = search_candidate(&conn, "Dragon Ball Z - Budokai 3", platform, "Renamed.iso").unwrap();
        assert_eq!(fallback.len(), 5);
        assert!(fallback.iter().all(|game| game.exact && game.source_key.is_some()));
        assert_eq!(regional_match(&conn, &fallback, "Renamed.iso").unwrap(), None);
        assert_eq!(regional_match(&conn, &fallback, "Renamed (USA).iso").unwrap(), Some(token(&format!("{platform}/SLUS-20998"))));
        // Existing cached catalogs can be reused: this change needs no reindex/download.
        drop(conn);
        ensure_platform(&files.job, platform, |_| panic!("catalog should work offline")).unwrap();
    }

    #[test]
    fn personal_catalogs_keep_title_matching_and_do_not_expose_repository_serials() {
        let conn = Connection::open_in_memory().unwrap();
        catalog_schema(&conn).unwrap();
        for (id, title) in [(1, "Reviewed title"), (2, "Original filename (USA)"), (3,"Serial game"), (4,"Regional alias game")] {
            let json = serde_json::json!({"id":id,"title":title,"platform":"PS2"}).to_string();
            conn.execute("INSERT INTO games VALUES(?1,?2,'PS2',?3)",params![id,title,json]).unwrap();
            conn.execute("INSERT INTO names VALUES(?1,?2,?3)",params![id,title,normalize(title)]).unwrap();
        }
        let found = search_candidate(&conn,"Reviewed title","PS2","C:/ROMs/Original filename (USA).iso").unwrap();
        assert_eq!(found.len(),1);
        assert_eq!(found[0].game.id,1);
        assert!(found[0].source_key.is_none());
        conn.execute("INSERT INTO names VALUES(3,'SLUS-21000',?1)",[normalize("SLUS-21000")]).unwrap();
        conn.execute("INSERT INTO names VALUES(4,'Alias (Europe) (En,Es)',?1)",[normalize("Alias (Europe) (En,Es)")]).unwrap();
        for (path,id) in [
            ("C:/ROMs/Original filename (USA).iso.gz",2),
            ("C:/ROMs/SLUS_210.00.chd",3),
            ("C:/ROMs/Alias (Europe) (En,Es).iso",4),
            ("C:/ROMs/Reviewed title (Japan).chd",1),
        ] {
            let matches=search_candidate(&conn,"Unrecognized title","PS2",path).unwrap();
            assert_eq!(matches.len(),1);assert!(matches[0].exact);assert_eq!(matches[0].game.id,id);
        }
        let temporary:i64=conn.query_row("SELECT count(*) FROM sqlite_temp_master",[],|r|r.get(0)).unwrap();
        assert_eq!(temporary,0,"filename fallbacks must use exact indexed lookups before preparing fuzzy search");
    }

    #[test]
    fn repository_labels_are_available_for_download_without_replacing_cartridge_photos() {
        let files = Sandbox::new();
        let mut conn = files.catalog();
        let source = "Sony - PlayStation 2";
        let fixture = files.job.directory.join("labels.json");
        fs::write(&fixture, serde_json::json!({
            "schema_version": 2, "system": source, "games": {
                "TEST": {"entries": [{"name": "Example Game"}], "images": {
                    "label": {"path": "TEST/label.webp", "kind": "label"},
                    "label2": {"path": "TEST/label2.webp"},
                    "cart_label3": {"path": "TEST/old-label.webp", "kind": "cart_label"},
                    "cart_front": {"path": "TEST/cart_front.webp", "kind": "cart_front"},
                    "invalid": {"path": "../label.webp", "kind": "label"}
                }}
            }
        }).to_string()).unwrap();
        insert_platform(&mut conn, &files.job, source, &fixture, |_| ()).unwrap();
        let id = token(&format!("{source}/TEST"));
        let available = available_image_types(&conn, &[id], &files.job).unwrap();
        assert_eq!(available.counts["cart_label"], 3);
        assert_eq!(available.counts["cart_front"], 1);
        let images = conn.prepare("SELECT filename,kind,region,crc FROM images WHERE game_id=?1").unwrap()
            .query_map([id], |r| Ok(CatalogImage { source: None, filename: r.get(0)?, kind: r.get(1)?, region: r.get(2)?, crc: r.get(3)? }))
            .unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
        let mut options: MediaOptions = serde_json::from_value(serde_json::json!({"selected_types": ["cart_label"]})).unwrap();
        options.validate().unwrap();
        let selected = select_images(images.clone(), &options, "Game (USA).nds");
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].kind, "cart_label");
        options.download_all = true;
        assert_eq!(select_images(images, &options, "Game (USA).nds").len(), 3);
        assert!(image_url(&files.job, IMAGE_BASE, &selected[0].filename).unwrap().contains("label"));
        assert_eq!(kind("label99").as_deref(), Some("cart_label"));
        assert_eq!(kind("label_other"), None);
        drop(conn);
        ensure_platform(&files.job, source, |_| panic!("indexed labels should work offline")).unwrap();
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
    #[ignore = "Optional filename-only audit using OPENCABINET_MATCH_AUDIT_DIRECTORY and OPENCABINET_MATCH_AUDIT_CATALOG; never modifies the library or ROMs"]
    fn audits_import_matches_against_a_local_directory() {
        let directory=PathBuf::from(std::env::var_os("OPENCABINET_MATCH_AUDIT_DIRECTORY").expect("ROM directory"));
        let catalog=PathBuf::from(std::env::var_os("OPENCABINET_MATCH_AUDIT_CATALOG").expect("Downloaded catalog JSON"));
        let data:serde_json::Value=serde_json::from_reader(BufReader::new(File::open(&catalog).unwrap())).unwrap();
        let source=data["system"].as_str().unwrap();
        let files=Sandbox::new();let mut conn=files.catalog();
        insert_platform(&mut conn,&files.job,source,&catalog,|_|()).unwrap();
        let mut paths:Vec<_>=fs::read_dir(directory).unwrap().map(|entry|entry.unwrap().path()).filter(|path|path.is_file()).collect();
        paths.sort();let mut rows=Vec::new();let mut matched=0;
        for path in paths {
            let path=path.to_string_lossy();let title=crate::clean_rom_title(&matching::rom_name(&path));
            let found=search_candidate(&conn,&title,source,&path).unwrap();
            let exact:Vec<_>=found.iter().filter(|r|r.exact).collect();
            let selected=if exact.len()==1{Some(exact[0].game.id)}else{regional_match(&conn,&found,&path).unwrap()};
            if selected.is_some(){matched+=1;}
            rows.push(serde_json::json!({"filename":matching::rom_name(&path),"title":title,"selected":selected,
                "candidates":found.iter().map(|r|serde_json::json!({"id":r.game.id,"key":r.source_key,"title":r.game.title,"exact":r.exact,"regions":r.regions})).collect::<Vec<_>>()}));
        }
        let report=serde_json::json!({"matched":matched,"total":rows.len(),"rows":rows});
        let output=Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/import-match-audit.json");
        fs::write(&output,serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        eprintln!("Matched {matched}/{}; report: {}",rows.len(),output.display());
        assert!(!rows.is_empty());
        if let Ok(minimum)=std::env::var("OPENCABINET_MATCH_AUDIT_MIN_MATCHES") {
            assert!(matched>=minimum.parse::<usize>().unwrap(),"insufficient automatic matches; inspect the report");
        }
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
