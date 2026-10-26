//! Portable image collections. SQLite is the working index; each committed
//! snapshot is also published beside its images, independently of game rows.
use crate::{GameImage, PendingImageCopies, ScanPreview};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    hash::{BuildHasher, Hasher},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

type Result<T> = std::result::Result<T, String>;
static IO: Mutex<()> = Mutex::new(());
pub(crate) fn cleanup_lock() -> std::sync::MutexGuard<'static, ()> {
    IO.lock().unwrap_or_else(|error| error.into_inner())
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn key(s: &str) -> String {
    s.replace('\\', "/").to_lowercase()
}
fn filename(s: &str) -> String {
    s.rsplit(['/', '\\']).next().unwrap_or(s).to_string()
}
fn identifier() -> String {
    use std::collections::hash_map::RandomState;
    format!(
        "{:016x}{:016x}",
        RandomState::new().build_hasher().finish(),
        RandomState::new().build_hasher().finish()
    )
}
fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|c| c.is_ascii_hexdigit())
}
fn relative(path: &Path) -> Result<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.is_empty()
        || Path::new(&value)
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err(crate::i18n::text("msg.a3f9554dae").into());
    }
    if value.contains(':') {
        return Err(crate::i18n::text("msg.80b6009921").into());
    }
    Ok(value)
}
pub(crate) fn directory(root: &Path, name: &str) -> Result<PathBuf> {
    let rel = relative(Path::new(name))?;
    if !rel.starts_with("images/") {
        return Err(crate::i18n::text("msg.b2b2a42f38").into());
    }
    let path = root.join(rel);
    // Canonical checks also reject directory junctions escaping the image root.
    if path.exists()
        && !path
            .canonicalize()
            .map_err(err)?
            .starts_with(root.join("images").canonicalize().map_err(err)?)
    {
        return Err(crate::i18n::text("msg.bbce9fb6fd").into());
    }
    Ok(path)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    version: u32,
    id: String,
    title: String,
    platform: String,
    #[serde(alias = "launch\u{0062}ox_id")]
    catalog_id: Option<i64>,
    #[serde(default)]
    artwork_id: Option<i64>,
    rom_path: String,
    #[serde(default)]
    discs: Vec<DiscIdentity>,
    filename: String,
    file_size: Option<u64>,
    regions: Vec<String>,
    images: Vec<GameImage>,
    #[serde(default)]
    manuals: Vec<String>,
    #[serde(default)]
    statistics: Option<SavedStatistics>,
    #[serde(default)]
    box_3d: Option<crate::platform_details::BoxSettings>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct SavedStatistics {
    play_time_seconds: i64,
    session_count: i64,
    last_played: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct DiscIdentity {
    rom_path: String,
    filename: String,
    file_size: Option<u64>,
    regions: Vec<String>,
    label: String,
    number: Option<u32>,
}
impl DiscIdentity {
    fn from_disc(disc: crate::discs::Disc) -> Self {
        Self { filename: filename(&disc.rom_path), file_size: fs::metadata(&disc.rom_path).ok().filter(|m|m.is_file()).map(|m|m.len()),
            regions: crate::metadata::rom_regions(&disc.rom_path).into_iter().map(str::to_string).collect(),
            rom_path: disc.rom_path, label: disc.label, number: disc.number }
    }
}
#[derive(Default, Serialize)]
pub struct LibraryReport {
    pub warnings: Vec<String>,
    pub collections: usize,
}
#[derive(Clone, Serialize)]
pub struct CollectionChoice {
    id: String,
    title: String,
    platform: String,
    filename: String,
    rom_path: String,
    regions: Vec<String>,
    image_count: usize,
    manual_count: usize,
    catalog_id: Option<i64>,
    has_statistics: bool,
}
#[derive(Deserialize, Clone, Debug)]
pub struct RecoverySelection {
    pub rom_path: String,
    pub collection_id: Option<String>,
}
#[derive(Deserialize)]
pub struct LookupSource {
    pub rom_path: String,
    pub id: Option<i64>,
}
#[derive(Serialize)]
pub struct RecoveryRow {
    rom_path: String,
    recommended_id: Option<String>,
    collections: Vec<CollectionChoice>,
}
#[derive(Serialize)]
pub struct RecoveryReport {
    rows: Vec<RecoveryRow>,
    warnings: Vec<String>,
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    let columns: HashSet<String> = conn
        .prepare("PRAGMA table_info(games)")
        .map_err(err)?
        .query_map([], |r| r.get(1))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    for (name, ty) in [("media_collection_id", "TEXT"), ("launch\u{0062}ox_id", "INTEGER")] {
        if !columns.contains(name) {
            conn.execute(&format!("ALTER TABLE games ADD COLUMN {name} {ty}"), [])
                .map_err(err)?;
        }
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_collections (
        id TEXT PRIMARY KEY, directory TEXT NOT NULL UNIQUE, manifest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media_manifest_outbox (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS media_collection_trash (id TEXT PRIMARY KEY, directory TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_game_media_collection ON games(media_collection_id)
        WHERE media_collection_id IS NOT NULL;",
    )
    .map_err(err)
}

pub fn ensure_game(conn: &Connection, root: &Path, game_id: i64) -> Result<(String, String)> {
    let current: Option<String> = conn
        .query_row(
            "SELECT media_collection_id FROM games WHERE id=?1",
            [game_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if let Some(id) = current {
        let dir: String = conn
            .query_row(
                "SELECT directory FROM media_collections WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(err)?;
        directory(root, &dir)?;
        return Ok((id, dir));
    }
    let id = identifier();
    let old = crate::read_game_images(conn, game_id as i32)?;
    let legacy = format!("images/{game_id}");
    let occupied: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM media_collections WHERE directory=?1)",
            [&legacy],
            |r| r.get(0),
        )
        .map_err(err)?;
    let can_keep = !occupied
        && !root.join(&legacy).join("manifest.json").exists()
        && !old.is_empty()
        && old.iter().all(|i| {
            Path::new(&crate::resolve_image_path(root, &i.path)).parent()
                == Some(root.join(&legacy).as_path())
        });
    let dir = if can_keep {
        legacy
    } else {
        format!("images/{id}")
    };
    directory(root, &dir)?;
    conn.execute(
        "INSERT INTO media_collections(id,directory,manifest) VALUES (?1,?2,'{}')",
        params![id, dir],
    )
    .map_err(err)?;
    conn.execute(
        "UPDATE games SET media_collection_id=?1 WHERE id=?2",
        params![id, game_id],
    )
    .map_err(err)?;
    Ok((id, dir))
}

/// Called inside the same transaction as game/image edits. The outbox is only
/// visible after commit; rollback can never publish an unfinished manifest.
pub fn sync_game(
    conn: &Connection,
    root: &Path,
    game_id: i64,
    copies: &mut PendingImageCopies,
) -> Result<()> {
    let images = crate::read_game_images(conn, game_id as i32)?;
    let bound: bool = conn
        .query_row(
            "SELECT media_collection_id IS NOT NULL FROM games WHERE id=?1",
            [game_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if images.is_empty() && !bound {
        return Ok(());
    }
    let (id, dir) = ensure_game(conn, root, game_id)?;
    let folder = directory(root, &dir)?;
    let (title, platform, rom_path, catalog_id): (String, String, String, Option<i64>) = conn
        .query_row(
            "SELECT title,platform,rom_path,launch\u{0062}ox_id FROM games WHERE id=?1",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(err)?;
    let mut entries = Vec::new();
    for image in images {
        let source = PathBuf::from(crate::resolve_image_path(root, &image.path));
        let rel = match source
            .strip_prefix(&folder)
            .ok()
            .and_then(|p| relative(p).ok())
        {
            Some(rel) => rel,
            None => {
                // Old external files are copied so an images-only backup is complete.
                if !source.is_file() {
                    continue;
                }
                let extension = crate::image_extension(&source)?;
                let rel = format!("{}.{}", identifier(), extension);
                fs::create_dir_all(&folder).map_err(err)?;
                let destination = folder.join(&rel);
                let mut out = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&destination)
                    .map_err(err)?;
                copies.0.push(destination);
                std::io::copy(&mut fs::File::open(&source).map_err(err)?, &mut out).map_err(err)?;
                let stored = format!("{dir}/{rel}");
                conn.execute(
                    "UPDATE game_images SET path=?1 WHERE game_id=?2 AND path=?3",
                    params![stored, game_id, image.path],
                )
                .map_err(err)?;
                conn.execute(
                    "UPDATE games SET cover_path=?1 WHERE id=?2 AND cover_path=?3",
                    params![stored, game_id, image.path],
                )
                .map_err(err)?;
                rel
            }
        };
        entries.push(GameImage {
            path: rel,
            kind: image.kind,
        });
    }
    let manifest = Manifest {
        artwork_id: crate::metadata::repository::match_id(conn,game_id,false),
        discs: crate::discs::read(conn,game_id)?.into_iter().map(DiscIdentity::from_disc).collect(),
        version: 1,
        id: id.clone(),
        title,
        platform,
        filename: filename(&rom_path),
        file_size: fs::metadata(&rom_path)
            .ok()
            .filter(|m| m.is_file())
            .map(|m| m.len()),
        regions: crate::metadata::rom_regions(&rom_path)
            .into_iter()
            .map(str::to_string)
            .collect(),
        rom_path,
        catalog_id,
        images: entries,
        manuals: crate::manuals::scan(&folder)?
            .into_iter()
            .map(|p| relative(p.strip_prefix(&folder).unwrap()))
            .collect::<Result<_>>()?,
        statistics: Some(conn.query_row("SELECT play_time_seconds,session_count,last_played FROM games WHERE id=?1", [game_id], |row| Ok(SavedStatistics {
            play_time_seconds: row.get(0)?, session_count: row.get(1)?, last_played: row.get(2)?,
        })).map_err(err)?),
        box_3d: crate::game_box_settings::read(conn,game_id as i32)?,
    };
    let body = serde_json::to_string_pretty(&manifest).map_err(err)?;
    conn.execute(
        "UPDATE media_collections SET manifest=?1 WHERE id=?2",
        params![body, id],
    )
    .map_err(err)?;
    conn.execute("INSERT INTO media_manifest_outbox(id,body) VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![id,body]).map_err(err)?;
    Ok(())
}

fn publish(folder: &Path, body: &str) -> Result<()> {
    use std::io::Write;
    fs::create_dir_all(folder).map_err(err)?;
    let next = folder.join("manifest.next");
    let current = folder.join("manifest.json");
    let previous = folder.join("manifest.previous");
    // Remove the entry itself, never follow a restored symbolic link on write.
    if fs::symlink_metadata(&next).is_ok() {
        fs::remove_file(&next).map_err(err)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&next)
        .map_err(err)?;
    file.write_all(body.as_bytes()).map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    if current.exists() {
        fs::rename(&current, &previous).map_err(err)?;
    }
    if let Err(error) = fs::rename(&next, &current) {
        if previous.exists() {
            let _ = fs::rename(&previous, &current);
        }
        return Err(err(error));
    }
    Ok(())
}
fn flush_locked(conn: &Connection, root: &Path) -> Vec<String> {
    let rows = (|| -> Result<Vec<(String, String, String)>> {
        conn.prepare("SELECT o.id,c.directory,o.body FROM media_manifest_outbox o JOIN media_collections c ON c.id=o.id").map_err(err)?
            .query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)
    })();
    let mut warnings = Vec::new();
    match rows {
        Err(error) => warnings.push(error),
        Ok(rows) => {
            for (id, dir, body) in rows {
                let result = directory(root, &dir)
                    .and_then(|folder| publish(&folder, &body))
                    .and_then(|_| {
                        conn.execute(
                            "DELETE FROM media_manifest_outbox WHERE id=?1 AND body=?2",
                            params![id, body],
                        )
                        .map(|_| ())
                        .map_err(err)
                    });
                if let Err(e) = result {
                    warnings.push(crate::i18n::i18n_format!(
                        "msg.e274511f06"
                    , dir = dir, e = e));
                }
            }
        }
    }
    warnings
}
pub fn flush(conn: &Connection, root: &Path) -> Vec<String> {
    let _guard = IO.lock().unwrap_or_else(|p| p.into_inner());
    flush_locked(conn, root)
}
pub fn flush_logged(conn: &Connection, root: &Path) {
    for warning in flush(conn, root) {
        eprintln!("{warning}");
    }
}

fn valid_manifest(manifest: &Manifest) -> Result<()> {
    if let Some(stats) = &manifest.statistics {
        if stats.play_time_seconds < 0 || stats.session_count < 0 { return Err(crate::i18n::text("msg.261256a65b").into()); }
    }
    if let Some(settings) = &manifest.box_3d { settings.validate()?; }
    if manifest.version != 1
        || !valid_id(&manifest.id)
        || manifest.catalog_id.is_some_and(|id| id <= 0)
        || manifest.artwork_id.is_some_and(|id| !crate::metadata::repository::repository_id(id))
    {
        return Err(crate::i18n::text("msg.f980063b23").into());
    }
    if manifest.images.len() > 50_000 {
        return Err(crate::i18n::text("msg.c21ba93a16").into());
    }
    let mut paths = HashSet::new();
    for manual in &manifest.manuals {
        let path = relative(Path::new(manual))?;
        if !path.starts_with("manuals/") || !path.to_lowercase().ends_with(".pdf") {
            return Err(crate::i18n::text("msg.0ec2fc74f2").into());
        }
    }
    for image in &manifest.images {
        relative(Path::new(&image.path))?;
        if !crate::metadata::valid_image_kind(&image.kind) || !paths.insert(key(&image.path)) {
            return Err(crate::i18n::text("msg.19e14098ff").into());
        }
    }
    Ok(())
}
fn available(root: &Path, dir: &str, manifest: &Manifest) -> Vec<GameImage> {
    let Ok(folder) = directory(root, dir) else {
        return Vec::new();
    };
    let Ok(canonical) = folder.canonicalize() else {
        return Vec::new();
    };
    manifest
        .images
        .iter()
        .filter_map(|image| {
            let rel = relative(Path::new(&image.path)).ok()?;
            let path = folder.join(rel);
            if !path.canonicalize().ok()?.starts_with(&canonical)
                || crate::image_extension(&path).is_err()
            {
                return None;
            }
            Some(GameImage {
                path: format!("{dir}/{}", image.path),
                kind: image.kind.clone(),
            })
        })
        .collect()
}

/// Replays committed snapshots, indexes portable manifests and upgrades active
/// legacy games. Unreferenced old files are deliberately never guessed/deleted.
pub fn reconcile(conn: &mut Connection, root: &Path) -> Result<LibraryReport> {
    reconcile_index(conn, root, true)
}

// Startup rebuilds the portable index, without opening thousands of image files.
// Recovery validates actual files when they are offered or attached to a ROM.
fn reconcile_index(
    conn: &mut Connection,
    root: &Path,
    validate_images: bool,
) -> Result<LibraryReport> {
    let _guard = IO.lock().unwrap_or_else(|p| p.into_inner());
    init_schema(conn)?;
    fs::create_dir_all(root.join("images")).map_err(err)?;
    let image_root = root.join("images").canonicalize().map_err(err)?;
    let mut report = LibraryReport {
        warnings: flush_locked(conn, root),
        collections: 0,
    };
    report.warnings.extend(clean_trash(conn, root));
    let pending_trash: HashSet<String> = conn.prepare("SELECT directory FROM media_collection_trash").map_err(err)?
        .query_map([], |row| row.get(0)).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
    let mut folders = vec![root.join("images")];
    let mut visited = HashSet::new();
    while let Some(folder) = folders.pop() {
        if folder.strip_prefix(root).ok().is_some_and(|path| pending_trash.contains(&path.to_string_lossy().replace('\\', "/"))) { continue; }
        if !visited.insert(folder.canonicalize().map_err(err)?) {
            continue;
        }
        let entries = match fs::read_dir(&folder) {
            Ok(entries) => entries,
            Err(e) => {
                report.warnings.push(format!("{}: {e}", folder.display()));
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(e) => {
                    report.warnings.push(e.to_string());
                    continue;
                }
            };
            if entry.file_type().map_err(err)?.is_dir() {
                let path = entry.path();
                if path.canonicalize().map_err(err)?.starts_with(&image_root) {
                    folders.push(path);
                }
            }
        }
        let candidates = ["manifest.json", "manifest.next", "manifest.previous"];
        let had_manifest = candidates.iter().any(|name| folder.join(name).is_file());
        let mut found = None;
        for name in candidates {
            let file = folder.join(name);
            if !file.is_file() {
                continue;
            }
            let mut incompatible = false;
            let read = (|| -> Result<Manifest> {
                if !file
                    .canonicalize()
                    .map_err(err)?
                    .starts_with(folder.canonicalize().map_err(err)?)
                {
                    return Err(crate::i18n::text("msg.67954426a2").into());
                }
                if file.metadata().map_err(err)?.len() > 8 * 1024 * 1024 {
                    return Err("Manifiesto demasiado grande.".into());
                }
                let manifest: Manifest =
                    serde_json::from_slice(&fs::read(&file).map_err(err)?).map_err(err)?;
                incompatible = manifest.version != 1;
                valid_manifest(&manifest)?;
                Ok(manifest)
            })();
            match read {
                Ok(m) => {
                    found = Some(m);
                    break;
                }
                Err(e) => report.warnings.push(format!("{}: {e}", file.display())),
            }
            if incompatible {
                break;
            }
        }
        if had_manifest && found.is_none() {
            let dir = relative(folder.strip_prefix(root).map_err(err)?)?;
            conn.execute(
                "DELETE FROM media_collections WHERE directory=?1
                AND NOT EXISTS(SELECT 1 FROM games WHERE media_collection_id=media_collections.id)
                AND NOT EXISTS(SELECT 1 FROM media_manifest_outbox WHERE id=media_collections.id)",
                [dir],
            )
            .map_err(err)?;
        }
        if let Some(manifest) = found {
            let dir = relative(folder.strip_prefix(root).map_err(err)?)?;
            if let Err(error) = directory(root, &dir) {
                report.warnings.push(crate::i18n::i18n_format!("msg.ea93fce003", dir = dir, error = error));
                continue;
            }
            let owner: Option<String> = conn
                .query_row(
                    "SELECT directory FROM media_collections WHERE id=?1",
                    [&manifest.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            if owner.as_ref().is_some_and(|existing| existing != &dir) {
                report
                    .warnings
                    .push(crate::i18n::i18n_format!("msg.d60bfbf555", dir = dir));
                continue;
            }
            let bound: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM games WHERE media_collection_id=?1)",
                    [&manifest.id],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !bound {
                conn.execute("DELETE FROM media_collections WHERE directory=?1 AND id<>?2
                    AND NOT EXISTS(SELECT 1 FROM games WHERE media_collection_id=media_collections.id)
                    AND NOT EXISTS(SELECT 1 FROM media_manifest_outbox WHERE id=media_collections.id)",params![dir,manifest.id]).map_err(err)?;
                let body = serde_json::to_string(&manifest).map_err(err)?;
                if let Err(e) = conn.execute(
                    "INSERT INTO media_collections(id,directory,manifest) VALUES (?1,?2,?3)
                    ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest
                    WHERE media_collections.manifest<>excluded.manifest",
                    params![manifest.id, dir, body],
                ) {
                    report
                        .warnings
                        .push(crate::i18n::i18n_format!("msg.ac0e40302b", dir = dir, e = e));
                    continue;
                }
            }
            // Bound collections cannot be recovered by another game. Their
            // current image associations already come from SQLite.
            if validate_images && !bound {
                let good = available(root, &dir, &manifest).len();
                if good < manifest.images.len() {
                    report.warnings.push(crate::i18n::i18n_format!(
                        "msg.232d357068",
                        manifest.title,
                        manifest.images.len() - good
                    ));
                }
            }
            report.collections += 1;
        }
    }
    let has_discs:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_discs')",[],|r|r.get(0)).map_err(err)?;
    let disc_difference=if has_discs { " OR EXISTS(SELECT 1 FROM game_discs d WHERE d.game_id=g.id AND NOT EXISTS(SELECT 1 FROM json_each(c.manifest,'$.discs') j WHERE json_extract(j.value,'$.rom_path')=d.rom_path))" } else { "" };
    let ids=conn.prepare(&format!("SELECT id FROM games g WHERE
        (media_collection_id IS NULL AND EXISTS(SELECT 1 FROM game_images WHERE game_id=g.id)) OR
        EXISTS(SELECT 1 FROM media_collections c WHERE c.id=g.media_collection_id AND
        (json_extract(c.manifest,'$.rom_path') IS NOT g.rom_path OR json_extract(c.manifest,'$.title') IS NOT g.title
        OR json_extract(c.manifest,'$.discs') IS NULL OR json_extract(c.manifest,'$.platform') IS NOT g.platform OR COALESCE(json_extract(c.manifest,'$.catalog_id'),json_extract(c.manifest,'$.launch\u{0062}ox_id')) IS NOT g.launch\u{0062}ox_id {disc_difference}))")).map_err(err)?
        .query_map([],|r|r.get::<_,i64>(0)).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    for id in ids {
        let mut copies = PendingImageCopies(Vec::new());
        let result = (|| -> Result<()> {
            let tx = conn.transaction().map_err(err)?;
            sync_game(&tx, root, id, &mut copies)?;
            tx.commit().map_err(err)?;
            copies.0.clear();
            Ok(())
        })();
        if let Err(e) = result {
            report.warnings.push(crate::i18n::i18n_format!(
                "msg.69181cd79b"
            , id = id, e = e));
        }
    }
    report.warnings.extend(flush_locked(conn, root));
    report.collections = conn
        .query_row("SELECT COUNT(*) FROM media_collections", [], |r| {
            r.get::<_, i64>(0)
        })
        .map_err(err)? as usize;
    Ok(report)
}

pub fn collection_images(conn: &Connection, root: &Path, id: &str) -> Result<Vec<GameImage>> {
    let (dir, body): (String, String) = conn
        .query_row(
            "SELECT directory,manifest FROM media_collections WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or(crate::i18n::text("msg.c89188b094"))?;
    let manifest: Manifest = serde_json::from_str(&body).map_err(err)?;
    valid_manifest(&manifest)?;
    Ok(available(root, &dir, &manifest))
}
pub fn attach(conn: &Connection, root: &Path, game_id: i64, id: &str) -> Result<usize> {
    let used: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM games WHERE media_collection_id=?1 AND id<>?2)",
            params![id, game_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if used {
        return Err(crate::i18n::text("msg.8a7b44b0c9").into());
    }
    let images = collection_images(conn, root, id)?;
    let has: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM game_images WHERE game_id=?1)",
            [game_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if has {
        return Err(crate::i18n::text("msg.5b99191fc3").into());
    }
    let body: String = conn
        .query_row(
            "SELECT manifest FROM media_collections WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let manifest: Manifest = serde_json::from_str(&body).map_err(err)?;
    let changed=conn.execute("UPDATE games SET media_collection_id=?1,launch\u{0062}ox_id=COALESCE(launch\u{0062}ox_id,?3) WHERE id=?2",params![id,game_id,manifest.catalog_id]).map_err(err)?;
    if let Some(source)=manifest.artwork_id {if crate::metadata::repository::match_id(conn,game_id,false).is_none(){crate::metadata::repository::record_match(conn,game_id,source)?;}}
    if changed == 0 {
        return Err(crate::i18n::text("msg.d73324547f").into());
    }
    if let Some(stats) = &manifest.statistics {
        // Recovery is for a new entry, never overwrite a played entry's statistics.
        conn.execute("UPDATE games SET play_time_seconds=?1,play_time=?2,session_count=?3,last_played=?4 WHERE id=?5 AND COALESCE(play_time_seconds,0)=0 AND COALESCE(session_count,0)=0 AND last_played IS NULL",
            params![stats.play_time_seconds.max(0), (stats.play_time_seconds.max(0)/60).min(i32::MAX as i64), stats.session_count.max(0), stats.last_played, game_id]).map_err(err)?;
    }
    if crate::game_box_settings::read(conn,game_id as i32)?.is_none() {
        if let Some(settings) = &manifest.box_3d { crate::game_box_settings::save(conn,game_id as i32,Some(settings))?; }
    }
    for (position, image) in images.iter().enumerate() {
        conn.execute(
            "INSERT INTO game_images(game_id,path,kind,position) VALUES (?1,?2,?3,?4)",
            params![game_id, image.path, image.kind, position as i64],
        )
        .map_err(err)?;
    }
    if let Some(image) = images.iter().find(|i| i.kind == "cover") {
        conn.execute(
            "UPDATE games SET cover_path=?1 WHERE id=?2",
            params![image.path, game_id],
        )
        .map_err(err)?;
    }
    Ok(images.len())
}
pub fn selection_for(selections: &[RecoverySelection], path: &str) -> Option<String> {
    selections
        .iter()
        .find(|s| s.rom_path == path)
        .and_then(|s| s.collection_id.clone())
}
pub fn validate_selections(preview: &ScanPreview, selections: &[RecoverySelection]) -> Result<()> {
    let mut paths = HashSet::new();
    let mut ids = HashSet::new();
    for s in selections {
        if !preview.games.iter().any(|g| g.rom_path == s.rom_path)
            || !paths.insert(&s.rom_path)
            || s.collection_id
                .as_ref()
                .is_some_and(|id| !valid_id(id) || !ids.insert(id))
        {
            return Err(crate::i18n::text("msg.6e003f5aa2").into());
        }
    }
    Ok(())
}
fn lookup(
    conn: &Connection,
    root: &Path,
    preview: &ScanPreview,
    platform: &str,
    sources: &[LookupSource],
    warnings: Vec<String>,
) -> Result<RecoveryReport> {
    let saved=conn.prepare("SELECT id,directory,manifest FROM media_collections c WHERE NOT EXISTS(SELECT 1 FROM games WHERE media_collection_id=c.id)").map_err(err)?
        .query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
    let mut collections = Vec::new();
    for (id, dir, body) in saved {
        let Ok(m) = serde_json::from_str::<Manifest>(&body) else {
            continue;
        };
        if valid_manifest(&m).is_err() {
            continue;
        }
        let count = available(root, &dir, &m).len();
        let manual_count = crate::manuals::scan(&directory(root, &dir)?)?.len();
        if count > 0 || manual_count > 0 || m.statistics.is_some() {
            collections.push((
                m.clone(),
                CollectionChoice {
                    id,
                    title: m.title,
                    platform: m.platform,
                    filename: m.filename,
                    rom_path: m.rom_path,
                    regions: m.regions,
                    image_count: count,
                    manual_count,
                    catalog_id: m.catalog_id,
                    has_statistics: m.statistics.is_some(),
                },
            ));
        }
    }
    let mut rows = Vec::new();
    for game in &preview.games {
        if game.existing_game_id.is_some() {
            rows.push(RecoveryRow { rom_path: game.rom_path.clone(), recommended_id: None, collections: Vec::new() });
            continue;
        }
        let source = sources
            .iter()
            .find(|s| s.rom_path == game.rom_path)
            .and_then(|s| s.id);
        let sources = crate::discs::candidate_discs(game).into_iter().map(DiscIdentity::from_disc).collect::<Vec<_>>();
        let exact: Vec<_> = collections.iter().filter(|(m,_)| {
            crate::platform_defaults::equivalent(&m.platform,platform) && source.is_none_or(|id|if id<0 {m.artwork_id.is_none_or(|saved|saved==id)}else{m.catalog_id==Some(id)}) &&
            sources.iter().any(|s| key(&m.rom_path)==key(&s.rom_path) || m.discs.iter().any(|d|key(&d.rom_path)==key(&s.rom_path)))
        }).collect();
        let moved: Vec<_> = collections.iter().filter(|(m,_)| {
            source.is_some() && (if source.is_some_and(|id|id<0){m.artwork_id==source}else{m.catalog_id==source}) && crate::platform_defaults::equivalent(&m.platform,platform) && sources.iter().any(|s| {
                let same=|name:&str,size:Option<u64>,regions:&[String]| key(name)==key(&s.filename) && s.file_size.is_some() && size==s.file_size && regions==s.regions;
                same(&m.filename,m.file_size,&m.regions) || m.discs.iter().any(|d|same(&d.filename,d.file_size,&d.regions))
            })
        }).collect();
        let matches = if exact.is_empty() { moved } else { exact };
        let recommended_id = if matches.len() == 1 {
            Some(matches[0].1.id.clone())
        } else {
            None
        };
        let mut choices: Vec<_> = collections.iter().map(|(_, c)| c.clone()).collect();
        choices.sort_by_key(|c| {
            (
                Some(&c.id) != recommended_id.as_ref(),
                c.catalog_id != source,
                c.title.to_lowercase(),
                c.id.clone(),
            )
        });
        rows.push(RecoveryRow {
            rom_path: game.rom_path.clone(),
            recommended_id,
            collections: choices,
        });
    }
    // Two input ROMs must never claim the same independent selection automatically.
    let mut seen = HashSet::new();
    let mut repeated = HashSet::new();
    for row in &rows {
        if let Some(id) = &row.recommended_id {
            if !seen.insert(id.clone()) {
                repeated.insert(id.clone());
            }
        }
    }
    for row in &mut rows {
        if row
            .recommended_id
            .as_ref()
            .is_some_and(|id| repeated.contains(id))
        {
            row.recommended_id = None;
        }
    }
    Ok(RecoveryReport { rows, warnings })
}

pub fn preserve_before_delete(conn: &mut Connection, root: &Path, ids: &[i32]) -> Result<()> {
    init_schema(conn)?;
    let mut copies = PendingImageCopies(Vec::new());
    let tx = conn.transaction().map_err(err)?;
    for id in ids {
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if exists {
            ensure_game(&tx, root, *id as i64)?;
            sync_game(&tx, root, *id as i64, &mut copies)?;
        }
    }
    tx.commit().map_err(err)?;
    copies.0.clear();
    let warnings = flush(conn, root);
    if !warnings.is_empty() {
        return Err(warnings.join("\n"));
    }
    Ok(())
}

// Register cleanup in the same transaction as deleting the games. A failed
// cleanup is retried at startup and cannot resurrect an unwanted collection.
pub fn discard_collections(conn: &Connection, ids: &[i32]) -> Result<()> {
    for game in ids {
        let collection: Option<(String,String)> = conn.query_row(
            "SELECT c.id,c.directory FROM media_collections c JOIN games g ON g.media_collection_id=c.id WHERE g.id=?1", [game],
            |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(err)?;
        if let Some((id, dir)) = collection {
            let overlapping: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM media_collections WHERE id<>?1 AND (directory LIKE ?2 OR ?3 LIKE directory || '/%'))",
                params![id,format!("{dir}/%"),dir], |row| row.get(0)).map_err(err)?;
            if overlapping { return Err(crate::i18n::text("msg.0b60371b56").into()); }
            conn.execute("INSERT OR REPLACE INTO media_collection_trash(id,directory) VALUES (?1,?2)",params![id,dir]).map_err(err)?;
            conn.execute("DELETE FROM media_manifest_outbox WHERE id=?1",[&id]).map_err(err)?;
            conn.execute("DELETE FROM media_collections WHERE id=?1",[&id]).map_err(err)?;
        }
    }
    Ok(())
}

pub fn clean_trash(conn: &Connection, root: &Path) -> Vec<String> {
    let result = (|| -> Result<Vec<String>> {
        let entries = conn.prepare("SELECT id,directory FROM media_collection_trash").map_err(err)?
            .query_map([], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
        let mut warnings = Vec::new();
        for (id, dir) in entries {
            let cleanup = (|| -> Result<()> {
                let path = directory(root,&dir)?;
                if path.exists() && path.canonicalize().map_err(err)? == root.join("images").canonicalize().map_err(err)? {
                    return Err(crate::i18n::text("msg.7a73835c69").into());
                }
                if path.exists() { fs::remove_dir_all(&path).map_err(err)?; }
                conn.execute("DELETE FROM media_collection_trash WHERE id=?1",[id]).map_err(err)?;
                Ok(())
            })();
            if let Err(error) = cleanup { warnings.push(crate::i18n::i18n_format!("msg.c730b7b4fe", dir = dir, error = error)); }
        }
        Ok(warnings)
    })();
    result.unwrap_or_else(|error| vec![error])
}

#[tauri::command]
pub async fn get_media_library_status() -> Result<LibraryReport> {
    tauri::async_runtime::spawn_blocking(|| {
        let root = crate::data_directory().map_err(err)?;
        let mut conn = crate::get_db_connection().map_err(err)?;
        reconcile_index(&mut conn, &root, false)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn find_media_collections(
    preview: ScanPreview,
    platform: String,
    sources: Option<Vec<LookupSource>>,
) -> Result<RecoveryReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::data_directory().map_err(err)?;
        let mut conn = crate::get_db_connection().map_err(err)?;
        let report = reconcile(&mut conn, &root)?;
        lookup(
            &conn,
            &root,
            &preview,
            &platform,
            &sources.unwrap_or_default(),
            report.warnings,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn link_media_collection(game_id: i32, collection_id: String) -> Result<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::data_directory().map_err(err)?;
        let mut conn = crate::get_db_connection().map_err(err)?;
        reconcile(&mut conn, &root)?;
        let mut copies = PendingImageCopies(Vec::new());
        let tx = conn.transaction().map_err(err)?;
        let count = attach(&tx, &root, game_id as i64, &collection_id)?;
        sync_game(&tx, &root, game_id as i64, &mut copies)?;
        tx.commit().map_err(err)?;
        copies.0.clear();
        flush_logged(&conn, &root);
        Ok(count)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deletion_preserves_statistics_without_images_and_recovers_from_manifests_only() {
        let files = Sandbox::new(); let mut conn = db();
        let rom = files.rom("Statistics (USA).iso"); let id = game(&conn,&rom,None);
        conn.execute("UPDATE games SET play_time_seconds=7261,play_time=121,session_count=7,last_played='2026-10-22T20:00:00Z' WHERE id=?1",[id]).unwrap();
        let settings: crate::platform_details::BoxSettings = serde_json::from_str(r##"{"base":{"color":"#c12732"}}"##).unwrap();
        crate::game_box_settings::save(&conn,id as i32,Some(&settings)).unwrap();
        preserve_before_delete(&mut conn,&files.0,&[id as i32]).unwrap();
        let (uuid,dir)=collection(&conn,id);
        assert!(files.0.join(&dir).join("manifest.json").is_file());
        crate::delete_game_records(&mut conn,&[id as i32]).unwrap();
        let mut restored=db();reconcile(&mut restored,&files.0).unwrap();
        let choices=lookup(&restored,&files.0,&preview(&rom),"PS2",&[],vec![]).unwrap();
        assert_eq!(choices.rows[0].recommended_id.as_deref(),Some(uuid.as_str()));
        assert!(choices.rows[0].collections[0].has_statistics);
        let new_id=game(&restored,&rom,None);attach(&restored,&files.0,new_id,&uuid).unwrap();
        let stats:(i64,i64,Option<String>)=restored.query_row("SELECT play_time_seconds,session_count,last_played FROM games WHERE id=?1",[new_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(stats,(7261,7,Some("2026-10-22T20:00:00Z".into())));
        assert!(crate::game_box_settings::read(&restored,new_id as i32).unwrap().is_some());
        assert!(Path::new(&rom).is_file());
    }

    #[test]
    fn discard_removes_only_managed_collection_and_is_atomic_with_game_deletion() {
        let files=Sandbox::new();let mut conn=db();let rom=files.rom("Discard.iso");let id=game(&conn,&rom,None);
        let original=files.png("original.png");image(&conn,id,&original,"cover",0);
        preserve_before_delete(&mut conn,&files.0,&[id as i32]).unwrap();let (_,dir)=collection(&conn,id);
        conn.execute_batch("CREATE TRIGGER stop_delete BEFORE DELETE ON games BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(crate::delete_game_records_with_options(&mut conn,&[id as i32],Some(&files.0)).is_err());
        assert!(files.0.join(&dir).exists());assert!(collection(&conn,id).0.len()>0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM media_collection_trash",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        conn.execute_batch("DROP TRIGGER stop_delete").unwrap();
        crate::delete_game_records_with_options(&mut conn,&[id as i32],Some(&files.0)).unwrap();
        assert!(!files.0.join(&dir).exists());assert!(Path::new(&original).exists());assert!(Path::new(&rom).exists());
        reconcile(&mut conn,&files.0).unwrap();
        assert!(lookup(&conn,&files.0,&preview(&rom),"PS2",&[],vec![]).unwrap().rows[0].collections.is_empty());
    }

    #[test]
    fn unfinished_discard_is_retried_before_reindexing_and_old_manifests_remain_compatible() {
        let files=Sandbox::new();let mut conn=db();let id=game(&conn,&files.rom("Cleanup.iso"),None);
        preserve_before_delete(&mut conn,&files.0,&[id as i32]).unwrap();let (_,dir)=collection(&conn,id);
        let tx=conn.transaction().unwrap();discard_collections(&tx,&[id as i32]).unwrap();tx.execute("DELETE FROM games WHERE id=?1",[id]).unwrap();tx.commit().unwrap();
        assert!(files.0.join(&dir).exists());reconcile(&mut conn,&files.0).unwrap();assert!(!files.0.join(&dir).exists());
        let id=game(&conn,&files.rom("Old.iso"),None);preserve_before_delete(&mut conn,&files.0,&[id as i32]).unwrap();
        let (_,dir)=collection(&conn,id);let body=fs::read_to_string(files.0.join(dir).join("manifest.json")).unwrap();
        let mut json:serde_json::Value=serde_json::from_str(&body).unwrap();json.as_object_mut().unwrap().remove("statistics");json.as_object_mut().unwrap().remove("box_3d");
        let old:Manifest=serde_json::from_value(json).unwrap();valid_manifest(&old).unwrap();assert!(old.statistics.is_none());
    }

    #[test]
    fn grouped_regions_archive_and_restore_their_own_statistics_without_adding_totals_twice() {
        let files=Sandbox::new();let mut conn=db();
        let europe=files.rom("Game (Europe).iso");let usa=files.rom("Game (USA).iso");
        let a=game(&conn,&europe,Some(42));let b=game(&conn,&usa,Some(42));
        conn.execute("UPDATE games SET play_time_seconds=100,session_count=2 WHERE id=?1",[a]).unwrap();
        conn.execute("UPDATE games SET play_time_seconds=200,session_count=3 WHERE id=?1",[b]).unwrap();
        crate::game_regions::init(&conn).unwrap();
        crate::game_regions::merge(&mut conn,&[a as i32,b as i32],a as i32,&[
            crate::game_regions::Label{id:a as i32,label:"Europa".into()},crate::game_regions::Label{id:b as i32,label:"USA".into()}]).unwrap();
        let members=crate::game_regions::expanded(&conn,&[a as i32]).unwrap();
        preserve_before_delete(&mut conn,&files.0,&members).unwrap();
        let (first,_)=collection(&conn,a);let (second,_)=collection(&conn,b);
        crate::delete_game_records(&mut conn,&[a as i32]).unwrap();
        let aa=game(&conn,&europe,Some(42));let bb=game(&conn,&usa,Some(42));
        attach(&conn,&files.0,aa,&first).unwrap();attach(&conn,&files.0,bb,&second).unwrap();
        assert_eq!(conn.query_row("SELECT play_time_seconds FROM games WHERE id=?1",[aa],|r|r.get::<_,i64>(0)).unwrap(),100);
        assert_eq!(conn.query_row("SELECT play_time_seconds FROM games WHERE id=?1",[bb],|r|r.get::<_,i64>(0)).unwrap(),200);
        conn.execute("UPDATE games SET play_time_seconds=250,session_count=4 WHERE id=?1",[bb]).unwrap();
        attach(&conn,&files.0,bb,&second).unwrap();
        assert_eq!(conn.query_row("SELECT play_time_seconds FROM games WHERE id=?1",[bb],|r|r.get::<_,i64>(0)).unwrap(),250);
    }
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("opencabinet-media-{}", identifier()));
            fs::create_dir_all(path.join("images")).unwrap();
            Self(path)
        }
        fn png(&self, relative: &str) -> String {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"\x89PNG\r\n\x1a\nimage fixture").unwrap();
            path.to_string_lossy().into_owned()
        }
        fn rom(&self, name: &str) -> String {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"ROM content").unwrap();
            path.to_string_lossy().into_owned()
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert!(self.0.is_absolute() && self.0.starts_with(std::env::temp_dir()));
            assert!(
                self.0
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("opencabinet-media-")
            );
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,platform TEXT,rom_path TEXT UNIQUE,cover_path TEXT,play_time INTEGER DEFAULT 0,release_date TEXT,developer TEXT,publisher TEXT);
            CREATE TABLE platforms(name TEXT); INSERT INTO platforms VALUES ('PS2');").unwrap();
        crate::init_game_metadata(&conn).unwrap();
        crate::init_game_images(&conn).unwrap();
        init_schema(&conn).unwrap();
        conn
    }
    fn game(conn: &Connection, path: &str, source: Option<i64>) -> i64 {
        conn.execute("INSERT INTO games(title,platform,rom_path,launch\u{0062}ox_id) VALUES ('My title','PS2',?1,?2)",params![path,source]).unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn old_manifest_catalog_keys_restore_images_and_do_not_trigger_repeated_snapshot_updates() {
        let files=Sandbox::new();let mut conn=db();
        let rom=files.rom("Game (USA).iso");let id=game(&conn,&rom,Some(77));
        files.png("images/1/cover.png");image(&conn,id,"images/1/cover.png","cover",0);
        snapshot(&mut conn,&files.0,id);
        let(uuid,dir)=collection(&conn,id);
        let path=files.0.join(&dir).join("manifest.json");
        let mut previous:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let value=previous.as_object_mut().unwrap().remove("catalog_id").unwrap();
        previous["launch\u{0062}ox_id"]=value;
        let body=serde_json::to_string(&previous).unwrap();
        fs::write(&path,&body).unwrap();
        conn.execute("UPDATE media_collections SET manifest=?1 WHERE id=?2",params![body,uuid]).unwrap();
        assert_eq!(serde_json::from_str::<Manifest>(&body).unwrap().catalog_id,Some(77));
        assert!(reconcile(&mut conn,&files.0).unwrap().warnings.is_empty());
        conn.execute_batch("CREATE TRIGGER reject_unnecessary_snapshot BEFORE UPDATE OF manifest ON media_collections BEGIN SELECT RAISE(ABORT,'unexpected snapshot update'); END;").unwrap();
        assert!(reconcile(&mut conn,&files.0).unwrap().warnings.is_empty());
        let mut restored=db();
        assert!(reconcile(&mut restored,&files.0).unwrap().warnings.is_empty());
        let report=lookup(&restored,&files.0,&preview(&rom),"PS2",&[LookupSource{rom_path:rom.clone(),id:Some(77)}],vec![]).unwrap();
        assert_eq!(report.rows[0].recommended_id.as_deref(),Some(uuid.as_str()));
    }
    fn image(conn: &Connection, id: i64, path: &str, kind: &str, pos: i64) {
        conn.execute(
            "INSERT INTO game_images VALUES (?1,?2,?3,?4)",
            params![id, path, kind, pos],
        )
        .unwrap();
    }
    fn collection(conn: &Connection, id: i64) -> (String, String) {
        conn.query_row("SELECT c.id,c.directory FROM media_collections c JOIN games g ON g.media_collection_id=c.id WHERE g.id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap()
    }
    fn preview(path: &str) -> ScanPreview {
        ScanPreview {
            games: vec![crate::RomCandidate { discs: Vec::new(), existing_game_id: None,
                title: "Reviewed title".into(),
                rom_path: path.into(),
                steam: None,
                epic: None,
            }],
            total_found: 1,
            skipped_count: 0,
        }
    }
    fn snapshot(conn: &mut Connection, root: &Path, id: i64) {
        let mut copies = PendingImageCopies(Vec::new());
        let tx = conn.transaction().unwrap();
        sync_game(&tx, root, id, &mut copies).unwrap();
        tx.commit().unwrap();
        copies.0.clear();
        assert!(flush(conn, root).is_empty());
    }
    fn pdf(path: &Path, content: &str) -> String {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, format!("%PDF-1.7\n{content}\n%%EOF")).unwrap();
        path.to_string_lossy().into_owned()
    }
    fn manual_edit(id: i64, paths: Vec<String>) -> crate::GameDetails {
        serde_json::from_value(
            serde_json::json!({"id":id,"title":"Reviewed title","platform":"PS2","manuals":paths}),
        )
        .unwrap()
    }
    #[test]
    fn repository_matches_recover_from_manifests_without_overwriting_legacy_references() {
        let files=Sandbox::new();let mut conn=db();let path=files.rom("Game (USA).iso");let id=game(&conn,&path,Some(77));
        let source=-1_234_567_890_123i64;crate::metadata::repository::record_match(&conn,id,source).unwrap();
        files.png("images/1/cover.png");image(&conn,id,"images/1/cover.png","cover",0);snapshot(&mut conn,&files.0,id);
        let(uuid,_)=collection(&conn,id);crate::delete_game_records(&mut conn,&[id as i32]).unwrap();
        let mut restored=db();reconcile(&mut restored,&files.0).unwrap();
        let sources=[LookupSource{rom_path:path.clone(),id:Some(source)}];
        let report=lookup(&restored,&files.0,&preview(&path),"PS2",&sources,vec![]).unwrap();assert_eq!(report.rows[0].recommended_id.as_deref(),Some(uuid.as_str()));
        let new=game(&restored,&path,None);attach(&restored,&files.0,new,&uuid).unwrap();
        assert_eq!(crate::metadata::repository::match_id(&restored,new,false),Some(source));assert_eq!(crate::metadata::repository::match_id(&restored,new,true),Some(77));
    }
    #[test]
    fn old_platform_names_recover_from_manifests_after_brand_first_rename() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("Game (USA).iso");
        let id = game(&conn, &path, None);
        files.png("images/1/cover.png");
        image(&conn, id, "images/1/cover.png", "cover", 0);
        snapshot(&mut conn, &files.0, id);
        let (uuid, _) = collection(&conn, id);
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        let mut restored = db();
        reconcile(&mut restored, &files.0).unwrap();
        let report = lookup(&restored, &files.0, &preview(&path), "Sony PlayStation 2", &[], vec![]).unwrap();
        assert_eq!(report.rows[0].recommended_id.as_deref(), Some(uuid.as_str()));
        assert_eq!(report.rows[0].collections[0].image_count, 1);
    }

    #[test]
    fn startup_indexes_portable_collections_without_opening_images_and_recovery_validates_them() {
        let files = Sandbox::new();
        let mut conn = db();
        let id = game(&conn, &files.rom("Game.iso"), None);
        files.png("images/1/good.png");
        fs::write(files.0.join("images/1/bad.png"), b"not an image").unwrap();
        image(&conn, id, "images/1/good.png", "cover", 0);
        image(&conn, id, "images/1/bad.png", "disc", 1);
        snapshot(&mut conn, &files.0, id);
        let (uuid, _) = collection(&conn, id);
        // Neither routine startup nor recovery should revalidate artwork of an active ROM.
        assert!(
            reconcile_index(&mut conn, &files.0, false)
                .unwrap()
                .warnings
                .is_empty()
        );
        assert!(reconcile(&mut conn, &files.0).unwrap().warnings.is_empty());
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        // A restored index is available at startup, even when its disk has bad files.
        let mut fresh = db();
        let report = reconcile_index(&mut fresh, &files.0, false).unwrap();
        assert_eq!(report.collections, 1);
        assert!(report.warnings.is_empty());
        // Import/recovery still diagnoses those files and exposes only the valid images.
        assert_eq!(collection_images(&fresh, &files.0, &uuid).unwrap().len(), 1);
        assert!(!reconcile(&mut fresh, &files.0).unwrap().warnings.is_empty());
        // The unchanged working index does not incur SQLite writes on every rescan.
        let before = fresh.total_changes();
        reconcile_index(&mut fresh, &files.0, false).unwrap();
        assert_eq!(fresh.total_changes(), before);
    }
    #[test]
    fn manuals_keep_names_skip_duplicates_and_do_not_overwrite_or_remove_originals() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("Manual game.iso");
        let id = game(&conn, &path, None);
        let first = pdf(&files.0.join("source-a/Manual.pdf"), "First document");
        let second = pdf(&files.0.join("source-b/Manual.pdf"), "Other document");
        let duplicate = pdf(&files.0.join("source-b/Other name.PDF"), "First document");
        crate::save_game_with_media(
            &mut conn,
            manual_edit(id, vec![first.clone(), second.clone(), duplicate]),
            &files.0,
        )
        .unwrap();
        let (uuid, dir) = collection(&conn, id);
        let folder = files.0.join(&dir);
        let saved = crate::manuals::scan(&folder).unwrap();
        assert_eq!(saved.len(), 2);
        assert!(saved.iter().any(|p| p.ends_with("Manual.pdf")));
        assert!(saved.iter().any(|p| p.ends_with("Manual (2).pdf")));
        assert!(Path::new(&first).exists());
        assert!(Path::new(&second).exists());
        let body = fs::read_to_string(folder.join("manifest.json")).unwrap();
        let manifest: Manifest = serde_json::from_str(&body).unwrap();
        assert_eq!(manifest.manuals.len(), 2);
        assert!(manifest.manuals.iter().all(|p| p.starts_with("manuals/")));
        crate::save_game_with_media(&mut conn, manual_edit(id, vec![first]), &files.0).unwrap();
        assert_eq!(collection(&conn, id).0, uuid);
        assert_eq!(crate::manuals::scan(&folder).unwrap().len(), 2);
        // Explorer additions are discovered even before another edit updates the manifest.
        pdf(&folder.join("manuals/Controls.pdf"), "Controls");
        fs::write(folder.join("manuals/bad.pdf"), b"not a pdf").unwrap();
        fs::write(folder.join("manuals/notes.txt"), b"%PDF-1.7").unwrap();
        assert_eq!(crate::manuals::scan(&folder).unwrap().len(), 3);
    }
    #[test]
    fn manuals_only_collections_recover_after_deletion_and_database_loss() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("Game (USA).iso");
        let id = game(&conn, &path, Some(77));
        let manual = pdf(&files.0.join("incoming/Guide.pdf"), "Guide");
        crate::save_game_with_media(&mut conn, manual_edit(id, vec![manual]), &files.0).unwrap();
        let (uuid, dir) = collection(&conn, id);
        // Include a document added directly in Explorer, without saving the game again.
        pdf(&files.0.join(&dir).join("manuals/Extra.pdf"), "Extra");
        preserve_before_delete(&mut conn, &files.0, &[id as i32]).unwrap();
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        let mut restored = db();
        reconcile(&mut restored, &files.0).unwrap();
        let report = lookup(&restored, &files.0, &preview(&path), "PS2", &[], vec![]).unwrap();
        assert_eq!(
            report.rows[0].recommended_id.as_deref(),
            Some(uuid.as_str())
        );
        assert_eq!(report.rows[0].collections[0].image_count, 0);
        assert_eq!(report.rows[0].collections[0].manual_count, 2);
        let selection = [RecoverySelection {
            rom_path: path.clone(),
            collection_id: Some(uuid.clone()),
        }];
        crate::import_roms_with_media(
            &mut restored,
            preview(&path),
            "PS2",
            Some((&files.0, &selection)),
            |_| {},
        )
        .unwrap();
        let new_id: i64 = restored
            .query_row("SELECT id FROM games", [], |r| r.get(0))
            .unwrap();
        assert_eq!(collection(&restored, new_id), (uuid, dir.clone()));
        assert_eq!(crate::manuals::scan(&files.0.join(dir)).unwrap().len(), 2);
    }
    #[test]
    fn failed_game_edits_roll_back_manual_copies_and_reject_non_pdf_files() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("Game.iso");
        let id = game(&conn, &path, None);
        let manual = pdf(&files.0.join("incoming/Guide.pdf"), "Guide");
        let mut edit = manual_edit(id, vec![manual.clone()]);
        edit.title = " ".into();
        assert!(crate::save_game_with_media(&mut conn, edit, &files.0).is_err());
        assert!(collection_images(&conn, &files.0, "missing").is_err());
        let collection_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_collections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(collection_count, 0);
        for entry in fs::read_dir(files.0.join("images")).unwrap() {
            assert!(
                crate::manuals::scan(&entry.unwrap().path())
                    .unwrap()
                    .is_empty()
            );
        }
        let invalid = files.0.join("incoming/Invalid.pdf");
        fs::write(&invalid, b"fake PDF").unwrap();
        assert!(
            crate::save_game_with_media(
                &mut conn,
                manual_edit(id, vec![invalid.to_string_lossy().into_owned()]),
                &files.0
            )
            .is_err()
        );
        assert!(Path::new(&manual).is_file());
    }
    #[test]
    fn legacy_migration_delete_reimport_and_images_only_backup_keep_types_order_and_source() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("Game (USA).iso");
        let id = game(&conn, &path, Some(77));
        files.png("images/1/cover.png");
        files.png("images/1/disc.png");
        image(&conn, id, "images/1/disc.png", "disc", 0);
        image(&conn, id, "images/1/cover.png", "cover", 1);
        let report = reconcile(&mut conn, &files.0).unwrap();
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        let (uuid, dir) = collection(&conn, id);
        assert!(valid_id(&uuid));
        assert_eq!(dir, "images/1");
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(files.0.join(&dir).join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(manifest.images[0].kind, "disc");
        assert_eq!(manifest.images[1].kind, "cover");
        preserve_before_delete(&mut conn, &files.0, &[id as i32]).unwrap();
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        assert!(files.0.join(&dir).join("disc.png").is_file());
        assert!(
            crate::read_game_images(&conn, id as i32)
                .unwrap()
                .is_empty()
        );
        // The working index is entirely disposable, just like opencabinet.db.
        let mut restored = db();
        reconcile(&mut restored, &files.0).unwrap();
        let report = lookup(&restored, &files.0, &preview(&path), "PS2", &[], vec![]).unwrap();
        assert_eq!(
            report.rows[0].recommended_id.as_deref(),
            Some(uuid.as_str())
        );
        let choices = vec![RecoverySelection {
            rom_path: path.clone(),
            collection_id: Some(uuid.clone()),
        }];
        let result = crate::import_roms_with_media(
            &mut restored,
            preview(&path),
            "PS2",
            Some((&files.0, &choices)),
            |_| {},
        )
        .unwrap();
        assert_eq!(result.added_count, 1);
        assert_eq!(result.enrichment.unwrap().image_count, 2);
        let (title, source, seconds, sessions): (String, i64, i64, i64) = restored
            .query_row(
                "SELECT title,launch\u{0062}ox_id,play_time_seconds,session_count FROM games",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            (title, source, seconds, sessions),
            ("Reviewed title".into(), 77, 0, 0)
        );
        let saved = crate::read_game_images(&restored, 1).unwrap();
        assert_eq!(saved[0].kind, "disc");
        assert_eq!(saved[1].kind, "cover");
        assert_eq!(collection(&restored, 1).0, uuid);
    }
    #[test]
    fn regional_roms_recover_separately_after_a_move_and_renames_require_manual_choice() {
        let files = Sandbox::new();
        let mut conn = db();
        let usa = files.rom("old/Game (USA).iso");
        let pal = files.rom("old/Game (Europe).iso");
        let a = game(&conn, &usa, Some(88));
        let b = game(&conn, &pal, Some(88));
        let source = files.png("source.png");
        image(&conn, a, &source, "cover", 0);
        image(&conn, b, &source, "cover", 0);
        reconcile(&mut conn, &files.0).unwrap();
        let ca = collection(&conn, a).0;
        let cb = collection(&conn, b).0;
        assert_ne!(ca, cb);
        preserve_before_delete(&mut conn, &files.0, &[a as i32, b as i32]).unwrap();
        crate::delete_game_records(&mut conn, &[a as i32, b as i32]).unwrap();
        let moved = files.rom("new/Game (Europe).iso");
        let sources = vec![LookupSource {
            rom_path: moved.clone(),
            id: Some(88),
        }];
        let result = lookup(&conn, &files.0, &preview(&moved), "PS2", &sources, vec![]).unwrap();
        assert_eq!(result.rows[0].recommended_id.as_deref(), Some(cb.as_str()));
        assert!(
            lookup(&conn, &files.0, &preview(&moved), "PS2", &[], vec![])
                .unwrap()
                .rows[0]
                .recommended_id
                .is_none()
        );
        let renamed = files.rom("new/Renamed.iso");
        let sources = vec![LookupSource {
            rom_path: renamed.clone(),
            id: Some(88),
        }];
        let result = lookup(&conn, &files.0, &preview(&renamed), "PS2", &sources, vec![]).unwrap();
        assert!(result.rows[0].recommended_id.is_none());
        assert_eq!(result.rows[0].collections.len(), 2);
        // A freshly reconstructed index in a different data directory uses relative image paths.
        let backup = Sandbox::new();
        for dir in fs::read_dir(files.0.join("images")).unwrap().flatten() {
            let target = backup.0.join("images").join(dir.file_name());
            fs::create_dir_all(&target).unwrap();
            for file in fs::read_dir(dir.path()).unwrap().flatten() {
                fs::copy(file.path(), target.join(file.file_name())).unwrap();
            }
        }
        let mut fresh = db();
        reconcile(&mut fresh, &backup.0).unwrap();
        assert_eq!(collection_images(&fresh, &backup.0, &ca).unwrap().len(), 1);
    }
    #[test]
    fn no_source_only_recovers_by_original_path_and_platform_and_ambiguous_collections_stay_manual()
    {
        let files = Sandbox::new();
        let mut conn = db();
        let rom = files.rom("game.iso");
        let id = game(&conn, &rom, None);
        let png = files.png("manual.png");
        image(&conn, id, &png, "logo", 0);
        reconcile(&mut conn, &files.0).unwrap();
        let (uuid, dir) = collection(&conn, id);
        preserve_before_delete(&mut conn, &files.0, &[id as i32]).unwrap();
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        assert_eq!(
            lookup(&conn, &files.0, &preview(&rom), "PS2", &[], vec![])
                .unwrap()
                .rows[0]
                .recommended_id
                .as_ref(),
            Some(&uuid)
        );
        assert!(
            lookup(
                &conn,
                &files.0,
                &preview(&rom),
                "Another console",
                &[],
                vec![]
            )
            .unwrap()
            .rows[0]
                .recommended_id
                .is_none()
        );
        let mut other: Manifest =
            serde_json::from_slice(&fs::read(files.0.join(&dir).join("manifest.json")).unwrap())
                .unwrap();
        other.id = identifier();
        let new = files.0.join("images").join(&other.id);
        fs::create_dir(&new).unwrap();
        for i in &other.images {
            fs::copy(files.0.join(&dir).join(&i.path), new.join(&i.path)).unwrap();
        }
        publish(&new, &serde_json::to_string(&other).unwrap()).unwrap();
        reconcile(&mut conn, &files.0).unwrap();
        let result = lookup(&conn, &files.0, &preview(&rom), "PS2", &[], vec![]).unwrap();
        assert!(result.rows[0].recommended_id.is_none());
        assert_eq!(result.rows[0].collections.len(), 2);
    }
    #[test]
    fn failed_transactions_never_publish_and_failed_publication_replays_committed_snapshot() {
        let files = Sandbox::new();
        let mut conn = db();
        let rom = files.rom("game.iso");
        let id = game(&conn, &rom, Some(3));
        let png = files.png("one.png");
        image(&conn, id, &png, "cover", 0);
        let mut copies = PendingImageCopies(Vec::new());
        {
            let tx = conn.transaction().unwrap();
            sync_game(&tx, &files.0, id, &mut copies).unwrap();
        }
        drop(copies);
        assert!(flush(&conn, &files.0).is_empty());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media_collections", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        snapshot(&mut conn, &files.0, id);
        let (_, dir) = collection(&conn, id);
        let folder = files.0.join(&dir);
        let original = fs::read(folder.join("manifest.json")).unwrap();
        conn.execute("UPDATE games SET title='Changed locally' WHERE id=?1", [id])
            .unwrap();
        let mut copies = PendingImageCopies(Vec::new());
        {
            let tx = conn.transaction().unwrap();
            sync_game(&tx, &files.0, id, &mut copies).unwrap();
            tx.commit().unwrap();
        }
        copies.0.clear();
        fs::create_dir(folder.join("manifest.next")).unwrap();
        assert!(!flush(&conn, &files.0).is_empty());
        assert_eq!(fs::read(folder.join("manifest.json")).unwrap(), original);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media_manifest_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        fs::remove_dir(folder.join("manifest.next")).unwrap();
        reconcile(&mut conn, &files.0).unwrap();
        let final_manifest: Manifest =
            serde_json::from_slice(&fs::read(folder.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(final_manifest.title, "Changed locally");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media_manifest_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn missing_invalid_and_malicious_media_are_reported_without_losing_good_images_or_old_orphans()
    {
        let files = Sandbox::new();
        let mut conn = db();
        let rom = files.rom("game.iso");
        let id = game(&conn, &rom, Some(3));
        let good = files.png("images/1/good.png");
        files.png("images/1/missing.png");
        fs::write(files.0.join("images/1/bad.png"), b"not image").unwrap();
        image(&conn, id, "images/1/good.png", "disc", 0);
        image(&conn, id, "images/1/missing.png", "logo", 1);
        image(&conn, id, "images/1/bad.png", "cover", 2);
        reconcile(&mut conn, &files.0).unwrap();
        let (uuid, dir) = collection(&conn, id);
        fs::remove_file(files.0.join(&dir).join("missing.png")).unwrap();
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        files.png("images/orphan/unknown.png");
        fs::create_dir_all(files.0.join("images/corrupt")).unwrap();
        fs::write(files.0.join("images/corrupt/manifest.json"), b"bad json").unwrap();
        let mut malicious: Manifest =
            serde_json::from_slice(&fs::read(files.0.join(&dir).join("manifest.json")).unwrap())
                .unwrap();
        malicious.id = identifier();
        malicious.images[0].path = "../../secret.png".into();
        let bad = files.0.join("images/escape");
        fs::create_dir(&bad).unwrap();
        fs::write(
            bad.join("manifest.json"),
            serde_json::to_vec(&malicious).unwrap(),
        )
        .unwrap();
        let mut fresh = db();
        let report = reconcile(&mut fresh, &files.0).unwrap();
        assert!(report.warnings.len() >= 3);
        let recovered = collection_images(&fresh, &files.0, &uuid).unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].kind, "disc");
        assert!(Path::new(&good).is_file());
        assert!(files.0.join("images/orphan/unknown.png").is_file());
        assert!(collection_images(&fresh, &files.0, &malicious.id).is_err());
    }
    #[test]
    fn attach_is_transactional_exclusive_and_never_resurrects_removed_images() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("one.iso");
        let id = game(&conn, &path, Some(4));
        let source = files.png("image.png");
        image(&conn, id, &source, "cover", 0);
        snapshot(&mut conn, &files.0, id);
        let (uuid, dir) = collection(&conn, id);
        let original_images = collection_images(&conn, &files.0, &uuid).unwrap();
        let other = game(&conn, &files.rom("two.iso"), None);
        assert!(attach(&conn, &files.0, other, &uuid).is_err());
        preserve_before_delete(&mut conn, &files.0, &[id as i32]).unwrap();
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_media BEFORE INSERT ON game_images BEGIN SELECT RAISE(ABORT,'failure');END;").unwrap();
        {
            let tx = conn.transaction().unwrap();
            assert!(attach(&tx, &files.0, other, &uuid).is_err());
        }
        assert!(
            conn.query_row(
                "SELECT media_collection_id FROM games WHERE id=?1",
                [other],
                |r| r.get::<_, Option<String>>(0)
            )
            .unwrap()
            .is_none()
        );
        conn.execute_batch("DROP TRIGGER fail_media").unwrap();
        {
            let tx = conn.transaction().unwrap();
            assert_eq!(attach(&tx, &files.0, other, &uuid).unwrap(), 1);
            tx.commit().unwrap();
        }
        conn.execute("DELETE FROM game_images WHERE game_id=?1", [other])
            .unwrap();
        conn.execute("UPDATE games SET cover_path=NULL WHERE id=?1", [other])
            .unwrap();
        snapshot(&mut conn, &files.0, other);
        let manifest: Manifest =
            serde_json::from_slice(&fs::read(files.0.join(dir).join("manifest.json")).unwrap())
                .unwrap();
        assert!(manifest.images.is_empty());
        assert!(files.0.join(&original_images[0].path).is_file());
        assert!(
            lookup(&conn, &files.0, &preview(&path), "PS2", &[], vec![])
                .unwrap()
                .rows[0]
                .collections
                .is_empty()
        );
    }

    #[test]
    fn future_manifests_are_not_downgraded_to_previous_versions_or_recovered_from_stale_index() {
        let files = Sandbox::new();
        let mut conn = db();
        let path = files.rom("one.iso");
        let id = game(&conn, &path, Some(4));
        let png = files.png("original.png");
        image(&conn, id, &png, "cover", 0);
        snapshot(&mut conn, &files.0, id);
        let (uuid, dir) = collection(&conn, id);
        snapshot(&mut conn, &files.0, id);
        crate::delete_game_records(&mut conn, &[id as i32]).unwrap();
        let file = files.0.join(&dir).join("manifest.json");
        let mut m: Manifest = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        m.version = 99;
        fs::write(&file, serde_json::to_vec(&m).unwrap()).unwrap();
        let report = reconcile(&mut conn, &files.0).unwrap();
        assert!(!report.warnings.is_empty());
        assert!(collection_images(&conn, &files.0, &uuid).is_err());
        assert_eq!(
            serde_json::from_slice::<Manifest>(&fs::read(&file).unwrap())
                .unwrap()
                .version,
            99
        );
        assert!(files.0.join(&dir).join("manifest.previous").is_file());
        m.version = 1;
        m.id = identifier();
        fs::write(
            files.0.join("images/manifest.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        let report = reconcile(&mut conn, &files.0).unwrap();
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.contains("no pertenece"))
        );
    }

    #[test]
    fn traversal_and_duplicate_collection_selections_are_rejected_before_import() {
        for path in [
            "../outside.png",
            "..\\outside.png",
            "images/../../outside",
            "C:/private.png",
            "/outside.png",
            "https://example.com/x.png",
        ] {
            assert!(relative(Path::new(path)).is_err(), "{path}");
        }
        let p = preview("one.iso");
        let id = identifier();
        let wrong = RecoverySelection {
            rom_path: "other.iso".into(),
            collection_id: Some(id.clone()),
        };
        assert!(validate_selections(&p, &[wrong]).is_err());
        let mut p = p;
        p.games.push(crate::RomCandidate { discs: Vec::new(), existing_game_id: None,
            title: "Two".into(),
            rom_path: "two.iso".into(),
            steam: None,
            epic: None,
        });
        let same = vec![
            RecoverySelection {
                rom_path: "one.iso".into(),
                collection_id: Some(id.clone()),
            },
            RecoverySelection {
                rom_path: "two.iso".into(),
                collection_id: Some(id),
            },
        ];
        assert!(validate_selections(&p, &same).is_err());
    }
    #[test]
    fn multidisc_manifests_recover_from_any_disc_after_database_loss_and_folder_moves() {
        let files=Sandbox::new(); let mut conn=db();
        let a=files.rom("Game (USA) (Disc 1).chd"); let b=files.rom("Game (USA) (Disc 2).chd");
        let id=game(&conn,&a,Some(45)); crate::discs::init(&conn).unwrap();
        crate::discs::replace(&conn,id,&[crate::discs::source(&a),crate::discs::source(&b)]).unwrap();
        let png=files.png("cover.png"); image(&conn,id,&png,"cover",0); snapshot(&mut conn,&files.0,id);
        let (uuid,dir)=collection(&conn,id);
        let m:Manifest=serde_json::from_slice(&fs::read(files.0.join(&dir).join("manifest.json")).unwrap()).unwrap();
        assert_eq!(m.discs.len(),2); assert_eq!(m.discs[1].rom_path,b);
        // A fresh main database reconstructs the media index solely from images.
        let mut restored=db(); reconcile(&mut restored,&files.0).unwrap();
        let found=lookup(&restored,&files.0,&preview(&b),"PS2",&[],vec![]).unwrap();
        assert_eq!(found.rows[0].recommended_id.as_deref(),Some(uuid.as_str()));
        let mut attachment=preview(&b);attachment.games[0].existing_game_id=Some(77);
        let existing=lookup(&restored,&files.0,&attachment,"PS2",&[],vec![]).unwrap();
        assert!(existing.rows[0].recommended_id.is_none());assert!(existing.rows[0].collections.is_empty());
        let moved=files.rom("moved/Game (USA) (Disc 2).chd");
        assert!(lookup(&restored,&files.0,&preview(&moved),"PS2",&[],vec![]).unwrap().rows[0].recommended_id.is_none());
        let sources=[LookupSource{rom_path:moved.clone(),id:Some(45)}];
        assert_eq!(lookup(&restored,&files.0,&preview(&moved),"PS2",&sources,vec![]).unwrap().rows[0].recommended_id.as_deref(),Some(uuid.as_str()));
        let wrong=files.rom("moved/Game (Europe) (Disc 2).chd");
        assert!(lookup(&restored,&files.0,&preview(&wrong),"PS2",&[LookupSource{rom_path:wrong.clone(),id:Some(45)}],vec![]).unwrap().rows[0].recommended_id.is_none());
    }
    #[test]
    fn merging_discs_preserves_principal_artwork_and_retains_secondary_collection_and_manuals() {
        let files=Sandbox::new();let mut conn=db();let a=files.rom("Game (Disc 1).chd");let b=files.rom("Game (Disc 2).chd");
        let first=game(&conn,&a,Some(45));let second=game(&conn,&b,Some(45));crate::discs::init(&conn).unwrap();
        let png=files.png("one.png");image(&conn,first,&png,"cover",0);let other=files.png("two.png");image(&conn,second,&other,"back_cover",0);
        snapshot(&mut conn,&files.0,first);snapshot(&mut conn,&files.0,second);
        let principal=collection(&conn,first);let secondary=collection(&conn,second);
        pdf(&files.0.join(&secondary.1).join("manuals/Guide.pdf"),"guide");
        crate::discs::merge(&mut conn,&files.0,&[first as i32,second as i32],first as i32,&[crate::discs::source(&a),crate::discs::source(&b)]).unwrap();
        assert_eq!(collection(&conn,first),principal);assert_eq!(crate::read_game_images(&conn,first as i32).unwrap().len(),1);
        assert!(files.0.join(&secondary.1).join("manuals/Guide.pdf").is_file());
        assert_eq!(collection_images(&conn,&files.0,&secondary.0).unwrap().len(),1);
        assert_eq!(conn.query_row("SELECT count(*) FROM games WHERE media_collection_id=?1",[&secondary.0],|r|r.get::<_,i32>(0)).unwrap(),0);
    }

}
