//! A small bootstrap file stays next to the executable; data moves only before
//! opening the application's databases. A completed copy can survive a crash
//! between publishing the destination and switching the bootstrap pointer.
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type Result<T> = std::result::Result<T, String>;
const CONFIG_FILE: &str = "opencabinet.config.json";
const MOVE_MARKER: &str = ".opencabinet-move.json";
// Compatibility names only: existing libraries and portable configurations stay valid.
const LEGACY_CONFIG_FILE: &str = crate::profile_compat::CONFIG_FILE;
const LEGACY_DATABASE: &str = crate::profile_compat::DATABASE;
const LEGACY_MOVE_MARKER: &str = crate::profile_compat::MOVE_MARKER;
static STORAGE: OnceLock<Storage> = OnceLock::new();
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(0);

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn token() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT_TOKEN.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Default, Clone, Serialize, Deserialize)]
struct Config {
    #[serde(default)]
    data_directory: Option<PathBuf>,
    #[serde(default)]
    pending_move: Option<PendingMove>,
}

#[derive(Clone, Serialize, Deserialize)]
struct PendingMove {
    destination: PathBuf,
    token: String,
    #[serde(default)]
    action: DirectoryAction,
}

#[derive(Default, Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryAction {
    #[default]
    Move,
    UseExisting,
}

#[derive(Debug, Serialize)]
pub struct DirectorySelection {
    directory: PathBuf,
    action: DirectoryAction,
}

#[derive(Serialize, Deserialize, PartialEq)]
struct MoveMarker {
    source: PathBuf,
    destination: PathBuf,
    token: String,
    complete: bool,
}

pub struct Storage {
    program: PathBuf,
    active: PathBuf,
    config: Mutex<Config>,
    startup_message: Option<String>,
    _instance_locks: Vec<File>,
}

#[derive(Debug, Serialize)]
pub struct DataLocation {
    active_directory: PathBuf,
    default_directory: PathBuf,
    pending_directory: Option<PathBuf>,
    pending_action: Option<DirectoryAction>,
    config_file: PathBuf,
    startup_message: Option<String>,
}

// Remove Windows' extended-path prefix for display and compatibility with paths
// stored by older versions. Canonicalization still resolves junctions/aliases.
fn clean_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(value) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(value);
        }
    }
    path
}

fn canonical(path: &Path) -> Result<PathBuf> {
    fs::canonicalize(path).map(clean_path).map_err(err)
}

fn inside(path: &Path, root: &Path) -> Option<PathBuf> {
    let path = clean_path(path.to_path_buf());
    let root = clean_path(root.to_path_buf());
    let mut parts = path.components();
    for expected in root.components() {
        let actual = parts.next()?;
        #[cfg(windows)]
        let equal = actual
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&expected.as_os_str().to_string_lossy());
        #[cfg(not(windows))]
        let equal = actual == expected;
        if !equal {
            return None;
        }
    }
    Some(parts.collect())
}

fn read_config(program: &Path) -> Result<Config> {
    let current = program.join(CONFIG_FILE);
    let path = if current.exists() { current } else { program.join(LEGACY_CONFIG_FILE) };
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| crate::i18n::i18n_format!("msg.cc5492243b", path.display(), e = e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(err(e)),
    }
}

// Keep the original filename for an existing SQLite database (including its
// WAL/journal companions). New libraries use the new product name.
pub fn database_path(directory: &Path) -> PathBuf {
    let current = directory.join("opencabinet.db");
    let legacy = directory.join(LEGACY_DATABASE);
    if !current.exists() && legacy.exists() { legacy } else { current }
}

fn write_config(program: &Path, config: &Config) -> Result<()> {
    let temporary = program.join(format!(".opencabinet-config-{}.tmp", token()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&serde_json::to_vec_pretty(config).map_err(err)?)
            .map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(&temporary, program.join(CONFIG_FILE)).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn destination_path(source: &Path, selected: &Path) -> Result<PathBuf> {
    if !selected.is_absolute() {
        return Err(crate::i18n::text("msg.02f839b869").into());
    }
    let destination = if selected.exists() {
        if !selected.is_dir() {
            return Err(crate::i18n::text("msg.68f0d700c7").into());
        }
        canonical(selected)?
    } else {
        let parent = canonical(
            selected
                .parent()
                .ok_or(crate::i18n::text("msg.52895fabb4"))?,
        )?;
        parent.join(
            selected
                .file_name()
                .ok_or(crate::i18n::text("msg.19785c9d0e"))?,
        )
    };
    if inside(&destination, source).is_some() || inside(source, &destination).is_some() {
        return Err(
            crate::i18n::text("msg.c32c468dc0")
                .into(),
        );
    }
    Ok(destination)
}

fn require_empty(path: &Path) -> Result<()> {
    if path.exists() && fs::read_dir(path).map_err(err)?.next().is_some() {
        return Err(crate::i18n::text("msg.e3441f583b").into());
    }
    Ok(())
}

pub(crate) fn validate_existing_library(directory: &Path) -> Result<()> {
    let database = database_path(directory);
    if !database.is_file() {
        return Err(crate::i18n::text("msg.6097baaf84").into());
    }
    // Never create or migrate a database during inspection. A SQLite file alone
    // is not sufficient: require the library's baseline schema, allowing older
    // OpenCabinet versions whose optional tables/columns are migrated on startup.
    let conn = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| crate::i18n::i18n_format!("msg.fb5f05f57d", e = e))?;
    conn.busy_timeout(Duration::from_secs(2)).map_err(err)?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| crate::i18n::i18n_format!("msg.39da878784", e = e))?;
    if check != "ok" {
        return Err(crate::i18n::i18n_format!(
            "msg.1d66d65a9e"
        , check = check));
    }
    for (table, required, optional) in [
        (
            "games",
            &[
                "id",
                "title",
                "platform",
                "rom_path",
                "cover_path",
                "play_time",
            ][..],
            false,
        ),
        (
            "emulators",
            &["id", "name", "platform", "executable_path", "arguments"][..],
            false,
        ),
        ("platforms", &["id", "name", "default_extensions"][..], true),
        (
            "game_images",
            &["game_id", "path", "kind", "position"][..],
            true,
        ),
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists && optional {
            // A view with this name cannot be upgraded into the missing table.
            let occupied: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1)",
                    [table],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !occupied {
                continue;
            }
        }
        let columns = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if !exists
            || required
                .iter()
                .any(|column| !columns.iter().any(|name| name == column))
        {
            return Err(crate::i18n::i18n_format!(
                "msg.24a25e53c5"
            , table = table));
        }
    }
    Ok(())
}

fn activate_existing(program: &Path, config: &mut Config) -> Result<()> {
    let pending = config
        .pending_move
        .as_ref()
        .ok_or(crate::i18n::text("msg.3d8eb839dc"))?;
    if !pending.destination.is_absolute() {
        return Err(crate::i18n::text("msg.7e40df5042").into());
    }
    let destination = canonical(&pending.destination)?;
    if inside(program, &destination).is_some() {
        return Err(crate::i18n::text("msg.a910741bf8").into());
    }
    validate_existing_library(&destination)?;
    probe_library_writable(&destination)?;
    let next = Config {
        data_directory: Some(destination),
        pending_move: None,
    };
    write_config(program, &next)?;
    *config = next;
    // Both directories are user-owned libraries. Switching the pointer must
    // never copy, rebase, merge or remove either one's contents.
    Ok(())
}

fn probe_writable(path: &Path) -> Result<()> {
    let probe = path.join(format!(".opencabinet-write-{}", token()));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .map_err(|e| crate::i18n::i18n_format!("msg.2eb7063204", path.display(), e = e))?;
    drop(file);
    fs::remove_file(probe).map_err(err)
}

fn probe_library_writable(directory: &Path) -> Result<()> {
    probe_writable(directory)?;
    // Check the DB file's permissions too, without executing any write SQL.
    // A writable folder can still contain a read-only backup database.
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(database_path(directory))
        .map_err(|error| {
            crate::i18n::i18n_format!("msg.10ef18d202", error = error)
        })?;
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
    for entry in fs::read_dir(source).map_err(err)? {
        let entry = entry.map_err(err)?;
        if entry.file_name() == MOVE_MARKER || entry.file_name() == LEGACY_MOVE_MARKER {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(err)?;
        if is_link(&metadata) {
            return Err(crate::i18n::i18n_format!(
                "msg.8a0e27385e",
                entry.path().display()
            ));
        }
        let target = destination.join(entry.file_name());
        if metadata.is_dir() {
            fs::create_dir(&target).map_err(err)?;
            copy_tree(&entry.path(), &target)?;
        } else if metadata.is_file() {
            if fs::copy(entry.path(), &target).map_err(err)? != metadata.len() {
                return Err(crate::i18n::text("msg.5fa52e6094").into());
            }
            OpenOptions::new()
                .write(true)
                .open(target)
                .map_err(err)?
                .sync_all()
                .map_err(err)?;
        } else {
            return Err(
                crate::i18n::text("msg.000f5efb58").into(),
            );
        }
    }
    Ok(())
}

fn lock_databases(source: &Path) -> Result<Vec<Connection>> {
    let mut locks = Vec::new();
    for relative in ["opencabinet.db", LEGACY_DATABASE, crate::catalog_compat::LEGACY_CATALOG_PATH, "metadata/opencabinet.db", "metadata/personal.db"] {
        let path = source.join(relative);
        if !path.exists() {
            continue;
        }
        let conn =
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(err)?;
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .map_err(err)?;
        let busy: i32 = conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
            .map_err(err)?;
        if busy != 0 {
            return Err(
                crate::i18n::text("msg.7e26ebb00e")
                    .into(),
            );
        }
        conn.execute_batch("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;")
            .map_err(err)?;
        locks.push(conn);
    }
    Ok(locks)
}

fn check_database(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(err)?;
    if check != "ok" {
        return Err(crate::i18n::i18n_format!("msg.b020e084a0", check = check));
    }
    Ok(())
}

pub(crate) fn rebase_library(path: &Path, source: &Path, destination: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut conn = Connection::open(path).map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    for (table, column) in [
        ("games", "rom_path"),
        ("game_discs", "rom_path"),
        ("play_sessions", "rom_path"),
        ("library_folders", "directory"),
        ("games", "steam_client_path"),
        ("games", "epic_client_path"),
        ("games", "epic_manifest_path"),
        ("games", "cover_path"),
        ("game_images", "path"),
        ("platform_images", "path"),
        ("emulators", "executable_path"),
        ("emulators", "retroarch_core_path"),
        ("retroarch_settings", "executable_path"),
    ] {
        let columns = tx
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(err)?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if !columns.iter().any(|name| name == column) {
            continue;
        }
        let rows = tx
            .prepare(&format!(
                "SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(err)?
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        for (id, value) in rows {
            if Path::new(&value).is_absolute() {
                let original =
                    canonical(Path::new(&value)).unwrap_or_else(|_| PathBuf::from(&value));
                if original
                    .components()
                    .any(|part| part == std::path::Component::ParentDir)
                {
                    continue;
                }
                if let Some(relative) = inside(&original, source) {
                    tx.execute(
                        &format!("UPDATE {table} SET {column}=?1 WHERE rowid=?2"),
                        (destination.join(&relative).to_string_lossy().as_ref(), id),
                    )
                    .map_err(err)?;
                    if table == "game_discs" {
                        tx.execute("UPDATE game_discs SET path_key=?1 WHERE rowid=?2",(crate::discs::key(&destination.join(&relative).to_string_lossy()),id)).map_err(err)?;
                    }
                    if table == "library_folders" {
                        tx.execute("UPDATE library_folders SET path_key=?1 WHERE rowid=?2",(crate::discs::key(&destination.join(&relative).to_string_lossy()),id)).map_err(err)?;
                    }
                }
            }
        }
    }
    tx.commit().map_err(err)
}

fn marker_matches(directory: &Path, expected: &MoveMarker) -> bool {
    fs::read(directory.join(MOVE_MARKER))
        .or_else(|error| if error.kind() == std::io::ErrorKind::NotFound {
            fs::read(directory.join(LEGACY_MOVE_MARKER))
        } else { Err(error) })
        .ok()
        .and_then(|bytes| serde_json::from_slice::<MoveMarker>(&bytes).ok())
        .as_ref()
        == Some(expected)
}

fn remove_owned_copy(directory: &Path, marker: &MoveMarker) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    let alternate = MoveMarker {
        source: marker.source.clone(),
        destination: marker.destination.clone(),
        token: marker.token.clone(),
        complete: !marker.complete,
    };
    if is_link(&fs::symlink_metadata(directory).map_err(err)?)
        || canonical(directory)? != directory
        || inside(directory, &marker.source).is_some()
        || !(marker_matches(directory, marker) || marker_matches(directory, &alternate))
    {
        return Err(crate::i18n::text("msg.0c3d3995b9").into());
    }
    fs::remove_dir_all(directory).map_err(err)
}

fn migrate(program: &Path, source: &Path, config: &mut Config) -> Result<Option<String>> {
    let pending = config
        .pending_move
        .as_ref()
        .ok_or(crate::i18n::text("msg.46f70435fb"))?
        .clone();
    if pending.action != DirectoryAction::Move {
        return Err(
            crate::i18n::text("msg.fb4f594c3c")
                .into(),
        );
    }
    if pending.token.is_empty()
        || pending.token.len() > 80
        || !pending
            .token
            .chars()
            .all(|c| c.is_ascii_digit() || c == '-')
    {
        return Err(crate::i18n::text("msg.3670f27a93").into());
    }
    let destination = destination_path(source, &pending.destination)?;
    let mut marker = MoveMarker {
        source: source.into(),
        destination: destination.clone(),
        token: pending.token.clone(),
        complete: true,
    };
    let locks = lock_databases(source)?;
    // The old source remains authoritative until the pointer is committed. A
    // previous published copy may be stale if the user kept working after an
    // unsuccessful startup, so rebuild it instead of silently reusing it.
    if marker_matches(&destination, &marker) {
        remove_owned_copy(&destination, &marker)?;
    }
    {
        require_empty(&destination)?;
        let stage = destination
            .parent()
            .ok_or(crate::i18n::text("msg.a376c84691"))?
            .join(format!(".opencabinet-move-{}", pending.token));
        marker.complete = false;
        if stage.exists() {
            // Delete only an operation-owned staging folder at the checked,
            // absolute destination parent. Never recurse into a linked folder.
            remove_owned_copy(&stage, &marker)?;
        }
        fs::create_dir(&stage).map_err(err)?;
        fs::write(
            stage.join(MOVE_MARKER),
            serde_json::to_vec(&marker).map_err(err)?,
        )
        .map_err(err)?;
        let prepared = (|| {
            copy_tree(source, &stage)?;
            rebase_library(&database_path(&stage), source, &destination)?;
            check_database(&database_path(&stage))?;
            check_database(&stage.join(crate::catalog_compat::LEGACY_CATALOG_PATH))?;
            check_database(&stage.join("metadata/opencabinet.db"))?;
            check_database(&stage.join("metadata/personal.db"))?;
            marker.complete = true;
            let mut file = File::create(stage.join(MOVE_MARKER)).map_err(err)?;
            file.write_all(&serde_json::to_vec(&marker).map_err(err)?)
                .map_err(err)?;
            file.sync_all().map_err(err)?;
            drop(file);
            if destination.exists() {
                require_empty(&destination)?;
                fs::remove_dir(&destination).map_err(err)?;
            }
            fs::rename(&stage, &destination).map_err(err)
        })();
        if let Err(error) = prepared {
            let _ = remove_owned_copy(&stage, &marker);
            return Err(error);
        }
    }
    check_database(&database_path(&destination))?;
    let next = Config {
        data_directory: Some(destination.clone()),
        pending_move: None,
    };
    write_config(program, &next)?;
    *config = next;
    drop(locks);
    // The pointer already refers to the verified copy. Cleanup failure must
    // never make the next launch return to a possibly partially removed source.
    let warning = fs::remove_dir_all(source).err().map(|e| crate::i18n::i18n_format!("msg.2a915fd9f0", source.display(), e = e));
    let _ = fs::remove_file(destination.join(MOVE_MARKER));
    Ok(warning)
}

fn instance_lock(path: &Path) -> Result<File> {
    let instance_lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(err)?;
    // Tauri spawns the replacement process just before exiting the old one.
    // Give that process time to release its OS handles before checking data.
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match instance_lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25))
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err(
                    crate::i18n::text("msg.4ba153cc88")
                        .into(),
                );
            }
            Err(error) => {
                return Err(crate::i18n::i18n_format!(
                    "msg.f7a5935dee"
                , error = error));
            }
        }
    }
    Ok(instance_lock)
}

fn open_storage(program: &Path) -> Result<Storage> {
    let program = canonical(program)?;
    let mut instance_locks = vec![instance_lock(&program.join(".opencabinet-instance.lock"))?];
    // Do not allow the previous executable to access the same data concurrently.
    let legacy_lock = program.join(crate::profile_compat::INSTANCE_LOCK);
    if legacy_lock.exists() { instance_locks.push(instance_lock(&legacy_lock)?); }
    let mut config = read_config(&program)?;
    if !program.join(CONFIG_FILE).exists() && program.join(LEGACY_CONFIG_FILE).is_file() {
        write_config(&program, &config)?;
    }
    let mut startup_message = None;
    if config
        .pending_move
        .as_ref()
        .is_some_and(|pending| pending.action == DirectoryAction::UseExisting)
    {
        if let Err(error) = activate_existing(&program, &mut config) {
            startup_message = Some(crate::i18n::i18n_format!(
                "msg.f85272a2de"
            , error = error));
        }
    }
    let selected = config
        .data_directory
        .clone()
        .unwrap_or_else(|| program.join("data"));
    if !selected.is_absolute() {
        return Err(crate::i18n::text("msg.7e40df5042").into());
    }
    if config.data_directory.is_none() {
        fs::create_dir_all(&selected).map_err(err)?;
    }
    let source = canonical(&selected).map_err(|e| {
        crate::i18n::i18n_format!(
            "msg.c2ede1e0ac",
            selected.display()
        , e = e)
    })?;
    if !source.is_dir() {
        return Err(crate::i18n::text("msg.c7a7380473").into());
    }
    if inside(&program, &source).is_some() {
        return Err(crate::i18n::text("msg.a910741bf8").into());
    }
    if config
        .pending_move
        .as_ref()
        .is_some_and(|pending| pending.action == DirectoryAction::Move)
    {
        match migrate(&program, &source, &mut config) {
            Ok(warning) => startup_message = warning,
            Err(e) => {
                startup_message = Some(crate::i18n::i18n_format!(
                    "msg.dd7bd3eb1f",
                    source.display()
                , e = e))
            }
        }
    }
    let active = canonical(config.data_directory.as_deref().unwrap_or(&source))?;
    Ok(Storage {
        program,
        active,
        config: Mutex::new(config),
        startup_message,
        _instance_locks: instance_locks,
    })
}

pub fn initialize() -> Result<()> {
    let exe = std::env::current_exe().map_err(err)?;
    let storage = open_storage(
        exe.parent()
            .ok_or(crate::i18n::text("msg.3079e9e5f0"))?,
    )?;
    STORAGE
        .set(storage)
        .map_err(|_| crate::i18n::text("msg.7f75fc49f9").to_string())
}

pub fn active_directory() -> Result<PathBuf> {
    Ok(current()?.active.clone())
}
fn current() -> Result<&'static Storage> {
    STORAGE
        .get()
        .ok_or_else(|| crate::i18n::text("msg.8a8c4cb665").into())
}

impl Storage {
    fn location(&self) -> Result<DataLocation> {
        let config = self.config.lock().map_err(err)?;
        Ok(DataLocation {
            active_directory: self.active.clone(),
            default_directory: self.program.join("data"),
            pending_directory: config.pending_move.as_ref().map(|m| m.destination.clone()),
            pending_action: config.pending_move.as_ref().map(|m| m.action),
            config_file: self.program.join(CONFIG_FILE),
            startup_message: self.startup_message.clone(),
        })
    }

    fn inspect(&self, directory: &Path) -> Result<DirectorySelection> {
        if !directory.is_absolute() {
            return Err(crate::i18n::text("msg.02f839b869").into());
        }
        let selected = if directory.exists() {
            canonical(directory)?
        } else {
            directory.to_path_buf()
        };
        if !selected.exists() || require_empty(&selected).is_ok() {
            return Ok(DirectorySelection {
                directory: destination_path(&self.active, &selected)?,
                action: DirectoryAction::Move,
            });
        }
        if inside(&self.program, &selected).is_some() {
            return Err(crate::i18n::text("msg.a910741bf8").into());
        }
        validate_existing_library(&selected)?;
        Ok(DirectorySelection {
            directory: selected,
            action: DirectoryAction::UseExisting,
        })
    }

    fn schedule(
        &self,
        directory: &Path,
        expected_action: Option<DirectoryAction>,
    ) -> Result<DataLocation> {
        if !directory.is_absolute() {
            return Err(crate::i18n::text("msg.02f839b869").into());
        }
        let mut config = self.config.lock().map_err(err)?;
        let selected = if directory.exists() {
            canonical(directory)?
        } else {
            directory.to_path_buf()
        };
        let pending = if inside(&selected, &self.active)
            .is_some_and(|relative| relative.as_os_str().is_empty())
        {
            None
        } else {
            let selection = self.inspect(&selected)?;
            if expected_action.is_some_and(|expected| expected != selection.action) {
                return Err(crate::i18n::text("msg.4d44d4ba17").into());
            }
            let destination = selection.directory;
            if selection.action == DirectoryAction::Move {
                let parent = destination
                    .parent()
                    .ok_or(crate::i18n::text("msg.52895fabb4"))?;
                probe_writable(parent)?;
            }
            if selection.action == DirectoryAction::UseExisting {
                probe_library_writable(&destination)?;
            } else if destination.exists() {
                probe_writable(&destination)?;
            }
            Some(PendingMove {
                destination,
                token: token(),
                action: selection.action,
            })
        };
        let next = Config {
            data_directory: config.data_directory.clone(),
            pending_move: pending,
        };
        write_config(&self.program, &next)
            .map_err(|e| crate::i18n::i18n_format!("msg.bc250fabd7", CONFIG_FILE, e = e))?;
        *config = next;
        drop(config);
        self.location()
    }
}

#[tauri::command]
pub async fn get_data_location() -> Result<DataLocation> {
    current()?.location()
}

pub(crate) fn has_pending_directory() -> Result<bool> {
    Ok(current()?.location()?.pending_directory.is_some())
}

pub(crate) fn schedule_restored_library(directory: &Path) -> Result<()> {
    current()?.schedule(directory, Some(DirectoryAction::UseExisting))?;
    Ok(())
}

#[tauri::command]
pub async fn schedule_data_directory(
    directory: String,
    directory_action: Option<DirectoryAction>,
) -> Result<DataLocation> {
    tauri::async_runtime::spawn_blocking(move || {
        current()?.schedule(Path::new(&directory), directory_action)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn inspect_data_directory(directory: String) -> Result<DirectorySelection> {
    tauri::async_runtime::spawn_blocking(move || current()?.inspect(Path::new(&directory)))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn choose_data_directory() -> Result<Option<String>> {
    let active = active_directory()?;
    tauri::async_runtime::spawn_blocking(move || {
        Ok(rfd::FileDialog::new()
            .set_title(crate::i18n::text("msg.e08342003c"))
            .set_directory(active)
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn restart_for_data_move(
    app: tauri::AppHandle,
    tracker: tauri::State<'_, crate::PlayTracker>,
    jobs: tauri::State<'_, crate::metadata::MetadataJobs>,
    retroarch: tauri::State<'_, crate::retroarch::RetroArchJobs>,
) -> Result<()> {
    if tracker.has_active_sessions() || jobs.has_active_job() || retroarch.busy() || crate::backups::busy() {
        return Err(crate::i18n::text("msg.bcfea2fcc9").into());
    }
    if current()?.location()?.pending_directory.is_none() {
        return Err(
            crate::i18n::text("msg.6b2d5eae74").into(),
        );
    }
    app.request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previous_product_configuration_and_database_are_reused_without_copying_the_library() {
        let sandbox = Sandbox::new();
        let legacy = sandbox.source.join(LEGACY_DATABASE);
        fs::rename(sandbox.source.join("opencabinet.db"), &legacy).unwrap();
        let bytes = fs::read(&legacy).unwrap();
        let config = Config { data_directory: Some(sandbox.source.clone()), pending_move: None };
        fs::write(sandbox.program.join(LEGACY_CONFIG_FILE), serde_json::to_vec(&config).unwrap()).unwrap();
        // Older executables leave this lock file next to the program.
        File::create(sandbox.program.join(crate::profile_compat::INSTANCE_LOCK)).unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert_eq!(storage._instance_locks.len(), 2);
        assert!(sandbox.program.join(CONFIG_FILE).is_file());
        assert_eq!(database_path(&storage.active), legacy);
        validate_existing_library(&storage.active).unwrap();
        probe_library_writable(&storage.active).unwrap();
        assert_eq!(fs::read(&legacy).unwrap(), bytes);
        assert!(!sandbox.source.join("opencabinet.db").exists());
        assert!(sandbox.program.join(LEGACY_CONFIG_FILE).is_file());
        drop(storage);
        let reopened = open_storage(&sandbox.program).unwrap();
        assert_eq!(reopened.active, sandbox.source);
    }

    #[test]
    fn legacy_libraries_can_still_be_relocated_and_restored_as_existing_backups() {
        let sandbox = Sandbox::new();
        fs::rename(sandbox.source.join("opencabinet.db"), sandbox.source.join(LEGACY_DATABASE)).unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, Some(DirectoryAction::Move)).unwrap();
        drop(storage);
        let moved = open_storage(&sandbox.program).unwrap();
        assert_eq!(moved.active, sandbox.destination);
        assert_eq!(database_path(&moved.active), sandbox.destination.join(LEGACY_DATABASE));
        validate_existing_library(&moved.active).unwrap();
        assert!(!sandbox.source.exists());
    }

    #[test]
    fn renamed_configuration_and_database_take_precedence_without_silently_using_old_data() {
        let sandbox = Sandbox::new();
        fs::write(sandbox.source.join(LEGACY_DATABASE), b"unrelated old file").unwrap();
        assert_eq!(database_path(&sandbox.source), sandbox.source.join("opencabinet.db"));
        validate_existing_library(&sandbox.source).unwrap();
        fs::write(sandbox.program.join(CONFIG_FILE), b"invalid JSON").unwrap();
        fs::write(sandbox.program.join(LEGACY_CONFIG_FILE), b"{}").unwrap();
        assert!(read_config(&sandbox.program).is_err());
    }

    struct Sandbox {
        root: PathBuf,
        program: PathBuf,
        source: PathBuf,
        destination: PathBuf,
    }
    impl Sandbox {
        fn new() -> Self {
            let parent = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/storage-tests");
            fs::create_dir_all(&parent).unwrap();
            let root = canonical(&parent).unwrap().join(token());
            fs::create_dir(&root).unwrap();
            let program = root.join("program");
            let source = program.join("data");
            fs::create_dir_all(source.join("images")).unwrap();
            fs::create_dir_all(source.join("metadata")).unwrap();
            let conn = Connection::open(source.join("opencabinet.db")).unwrap();
            conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY, title TEXT, platform TEXT DEFAULT 'PS2', rom_path TEXT UNIQUE, cover_path TEXT, play_time INTEGER DEFAULT 0, play_time_seconds INTEGER, session_count INTEGER);
                CREATE TABLE game_images(game_id INTEGER, path TEXT, kind TEXT, position INTEGER DEFAULT 0);
                CREATE TABLE emulators(id INTEGER PRIMARY KEY, name TEXT DEFAULT 'Emulator', platform TEXT DEFAULT 'PS2', executable_path TEXT, arguments TEXT DEFAULT '%ROM%');
                CREATE TABLE platforms(id INTEGER PRIMARY KEY, name TEXT, default_extensions TEXT DEFAULT '.iso');
                INSERT INTO platforms (name) VALUES ('PS2');").unwrap();
            conn.execute(
                "INSERT INTO games (id,title,rom_path,cover_path,play_time_seconds,session_count) VALUES (1,'Reviewed title',?1,?2,12345,9)",
                (
                    source.join("inside.rom").to_string_lossy().as_ref(),
                    source.join("images/cover.png").to_string_lossy().as_ref(),
                ),
            )
            .unwrap();
            conn.execute(
                "INSERT INTO game_images (game_id,path,kind) VALUES (1, 'images/relative.png', 'logo')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO game_images (game_id,path,kind) VALUES (1, ?1, 'cover')",
                [source.join("images/cover.png").to_string_lossy().as_ref()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO emulators (executable_path) VALUES (?1)",
                [root
                    .join("external/emulator.exe")
                    .to_string_lossy()
                    .as_ref()],
            )
            .unwrap();
            drop(conn);
            let catalog = Connection::open(source.join(crate::catalog_compat::LEGACY_CATALOG_PATH)).unwrap();
            catalog
                .execute_batch(
                    "CREATE TABLE games(title TEXT); INSERT INTO games VALUES ('Source title');",
                )
                .unwrap();
            fs::write(source.join("images/cover.png"), b"cover bytes").unwrap();
            fs::write(source.join("inside.rom"), b"rom bytes").unwrap();
            Self {
                destination: root.join("New data ñ"),
                root,
                program,
                source,
            }
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let parent = canonical(
                &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/storage-tests"),
            )
            .unwrap();
            assert!(inside(&self.root, &parent).is_some());
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn default_location_and_scheduling_do_not_move_live_data() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert!(!sandbox.program.join(CONFIG_FILE).exists());
        let scheduled = storage.schedule(&sandbox.destination, None).unwrap();
        assert_eq!(scheduled.active_directory, sandbox.source);
        assert_eq!(
            scheduled.pending_directory,
            Some(sandbox.destination.clone())
        );
        assert!(sandbox.source.join("opencabinet.db").is_file());
        assert!(!sandbox.destination.exists());
        let config = read_config(&sandbox.program).unwrap();
        assert!(config.data_directory.is_none());
        assert_eq!(
            config.pending_move.unwrap().destination,
            sandbox.destination
        );
    }

    #[test]
    fn restart_moves_all_data_rebases_managed_absolute_paths_and_preserves_statistics() {
        let sandbox = Sandbox::new();
        for catalog in ["metadata/opencabinet.db","metadata/personal.db"] {
            let conn=Connection::open(sandbox.source.join(catalog)).unwrap();
            conn.execute_batch("CREATE TABLE sample(value TEXT);INSERT INTO sample VALUES('catalog preserved');").unwrap();
        }
        fs::write(sandbox.source.join("metadata/source.json"),b"{\"personal\":true}").unwrap();
        let managed_executable = sandbox.source.join("emulators/RetroArch/retroarch.exe");
        let managed_core = sandbox.source.join("emulators/RetroArch/cores/snes9x_libretro.dll");
        fs::create_dir_all(managed_core.parent().unwrap()).unwrap();
        fs::write(&managed_executable, b"exe fixture").unwrap();
        fs::write(&managed_core, b"core fixture").unwrap();
        let conn = Connection::open(sandbox.source.join("opencabinet.db")).unwrap();
        crate::retroarch::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO emulators(id,executable_path,retroarch_core_path) VALUES(2,?1,?2)",
            (managed_executable.to_string_lossy().as_ref(),managed_core.to_string_lossy().as_ref())).unwrap();
        crate::retroarch::remember_configuration(&conn, managed_executable.to_str().unwrap(), Some(managed_core.to_str().unwrap())).unwrap();
        drop(conn);
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, None).unwrap();
        drop(storage);
        let relocated = open_storage(&sandbox.program).unwrap();
        assert_eq!(relocated.active, sandbox.destination);
        assert!(relocated.location().unwrap().pending_directory.is_none());
        assert!(!sandbox.source.exists());
        assert_eq!(
            fs::read(sandbox.destination.join("images/cover.png")).unwrap(),
            b"cover bytes"
        );
        assert!(sandbox.destination.join(crate::catalog_compat::LEGACY_CATALOG_PATH).is_file());
        for catalog in ["metadata/opencabinet.db","metadata/personal.db"] {
            let conn=Connection::open(sandbox.destination.join(catalog)).unwrap();
            assert_eq!(conn.query_row("SELECT value FROM sample",[],|r|r.get::<_,String>(0)).unwrap(),"catalog preserved");
        }
        assert_eq!(fs::read(sandbox.destination.join("metadata/source.json")).unwrap(),b"{\"personal\":true}");
        let conn = Connection::open(sandbox.destination.join("opencabinet.db")).unwrap();
        let game: (String, String, String, i64, i64) = conn
            .query_row(
                "SELECT title,rom_path,cover_path,play_time_seconds,session_count FROM games",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(game.0, "Reviewed title");
        assert_eq!(Path::new(&game.1), sandbox.destination.join("inside.rom"));
        assert_eq!(
            Path::new(&game.2),
            sandbox.destination.join("images/cover.png")
        );
        assert_eq!((game.3, game.4), (12345, 9));
        let relative: String = conn
            .query_row("SELECT path FROM game_images WHERE kind='logo'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(relative, "images/relative.png");
        let emulator: String = conn
            .query_row("SELECT executable_path FROM emulators", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&emulator),
            sandbox.root.join("external/emulator.exe")
        );
        let core: String = conn.query_row("SELECT retroarch_core_path FROM emulators WHERE id=2", [], |r| r.get(0)).unwrap();
        assert_eq!(Path::new(&core), sandbox.destination.join("emulators/RetroArch/cores/snes9x_libretro.dll"));
        let remembered: String = conn.query_row("SELECT executable_path FROM retroarch_settings WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(Path::new(&remembered), sandbox.destination.join("emulators/RetroArch/retroarch.exe"));
        assert_eq!(fs::read(&core).unwrap(), b"core fixture");
        drop(conn);
        drop(relocated);
        let reopened = open_storage(&sandbox.program).unwrap();
        assert_eq!(reopened.active, sandbox.destination);
        assert!(
            !sandbox.source.exists(),
            "Do not recreate data next to the exe after relocation"
        );
    }

    #[test]
    fn cancel_pending_move_and_return_to_default_location() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, None).unwrap();
        assert!(
            storage
                .schedule(&sandbox.source, None)
                .unwrap()
                .pending_directory
                .is_none()
        );
        drop(storage);
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        storage.schedule(&sandbox.destination, None).unwrap();
        drop(storage);
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.source, None).unwrap();
        drop(storage);
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert!(!sandbox.destination.exists());
    }

    #[test]
    fn rejects_nonempty_nested_ancestor_and_relative_destinations() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        fs::create_dir(&sandbox.destination).unwrap();
        fs::write(sandbox.destination.join("important.txt"), b"untouched").unwrap();
        for path in [
            &sandbox.destination,
            &sandbox.source.join("nested"),
            &sandbox.program,
            Path::new("relative"),
        ] {
            assert!(storage.schedule(path, None).is_err(), "{}", path.display());
        }
        assert!(!sandbox.program.join(CONFIG_FILE).exists());
        assert_eq!(
            fs::read(sandbox.destination.join("important.txt")).unwrap(),
            b"untouched"
        );
    }

    #[test]
    fn changed_destination_or_database_lock_keeps_original_library() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, None).unwrap();
        drop(storage);
        fs::create_dir(&sandbox.destination).unwrap();
        fs::write(sandbox.destination.join("other.txt"), b"other data").unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert!(storage.startup_message.as_ref().unwrap().contains("vacía"));
        assert!(sandbox.source.join("images/cover.png").is_file());
        drop(storage);
        fs::remove_file(sandbox.destination.join("other.txt")).unwrap();
        let connection = Connection::open(sandbox.source.join("opencabinet.db")).unwrap();
        connection.execute_batch("BEGIN EXCLUSIVE").unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert!(storage.startup_message.is_some());
        assert!(sandbox.source.join("opencabinet.db").is_file());
    }

    #[test]
    fn failed_pointer_commit_recovers_without_losing_later_source_edits() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, None).unwrap();
        let mut config = read_config(&sandbox.program).unwrap();
        let saved_config = fs::read(sandbox.program.join(CONFIG_FILE)).unwrap();
        fs::remove_file(sandbox.program.join(CONFIG_FILE)).unwrap();
        fs::create_dir(sandbox.program.join(CONFIG_FILE)).unwrap(); // Inject a failure after copying.
        assert!(migrate(&sandbox.program, &sandbox.source, &mut config).is_err());
        assert!(sandbox.source.join("opencabinet.db").is_file());
        assert!(sandbox.destination.join(MOVE_MARKER).is_file());
        let connection = Connection::open(sandbox.source.join("opencabinet.db")).unwrap();
        connection
            .execute(
                "UPDATE games SET title='Edited after failure', play_time_seconds=15000",
                [],
            )
            .unwrap();
        drop(connection);
        drop(storage);
        fs::remove_dir(sandbox.program.join(CONFIG_FILE)).unwrap();
        fs::write(sandbox.program.join(CONFIG_FILE), saved_config).unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.destination);
        let connection = Connection::open(sandbox.destination.join("opencabinet.db")).unwrap();
        let game: (String, i64) = connection
            .query_row("SELECT title,play_time_seconds FROM games", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(game, ("Edited after failure".into(), 15000));
    }

    #[test]
    fn interrupted_owned_staging_is_rebuilt_and_unowned_staging_is_untouched() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&sandbox.destination, None).unwrap();
        let config = read_config(&sandbox.program).unwrap();
        let pending = config.pending_move.unwrap();
        let stage = sandbox
            .root
            .join(format!(".opencabinet-move-{}", pending.token));
        fs::create_dir(&stage).unwrap();
        fs::write(stage.join("important"), b"unowned").unwrap();
        drop(storage);
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.source);
        assert_eq!(fs::read(stage.join("important")).unwrap(), b"unowned");
        drop(storage);
        let marker = MoveMarker {
            source: sandbox.source.clone(),
            destination: sandbox.destination.clone(),
            token: pending.token,
            complete: false,
        };
        fs::write(
            stage.join(MOVE_MARKER),
            serde_json::to_vec(&marker).unwrap(),
        )
        .unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.destination);
        assert!(!sandbox.destination.join("important").exists());
    }

    #[test]
    fn missing_configured_location_and_invalid_config_never_create_a_blank_library() {
        let sandbox = Sandbox::new();
        write_config(
            &sandbox.program,
            &Config {
                data_directory: Some(sandbox.destination.clone()),
                pending_move: None,
            },
        )
        .unwrap();
        assert!(open_storage(&sandbox.program).is_err());
        assert!(!sandbox.destination.exists());
        fs::write(sandbox.program.join(CONFIG_FILE), b"invalid json").unwrap();
        assert!(open_storage(&sandbox.program).is_err());
        assert!(sandbox.source.join("opencabinet.db").is_file());
    }

    #[test]
    fn prevents_two_instances_from_accessing_data_during_a_move() {
        let sandbox = Sandbox::new();
        let first = open_storage(&sandbox.program).unwrap();
        assert!(open_storage(&sandbox.program).is_err());
        drop(first);
        assert!(open_storage(&sandbox.program).is_ok());
    }

    #[test]
    fn restart_waits_for_the_previous_process_to_release_its_lock() {
        let sandbox = Sandbox::new();
        let previous = open_storage(&sandbox.program).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(120));
            drop(previous);
        });
        let restarted = open_storage(&sandbox.program).unwrap();
        release.join().unwrap();
        assert_eq!(restarted.active, sandbox.source);
    }

    fn backup(sandbox: &Sandbox) -> PathBuf {
        let directory = sandbox.root.join("Backup existente");
        fs::create_dir(&directory).unwrap();
        copy_tree(&sandbox.source, &directory).unwrap();
        let conn = Connection::open(directory.join("opencabinet.db")).unwrap();
        conn.execute(
            "UPDATE games SET title='Backup title', play_time_seconds=98765, session_count=30",
            [],
        )
        .unwrap();
        directory
    }

    #[test]
    fn existing_library_is_inspected_read_only_and_opened_without_moving_or_merging() {
        let sandbox = Sandbox::new();
        let existing = backup(&sandbox);
        let source_bytes = fs::read(sandbox.source.join("opencabinet.db")).unwrap();
        let backup_bytes = fs::read(existing.join("opencabinet.db")).unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(
            storage.inspect(&existing).unwrap().action,
            DirectoryAction::UseExisting
        );
        assert_eq!(
            storage.inspect(&sandbox.destination).unwrap().action,
            DirectoryAction::Move
        );
        let pending = storage
            .schedule(&existing, Some(DirectoryAction::UseExisting))
            .unwrap();
        assert_eq!(pending.active_directory, sandbox.source);
        assert_eq!(pending.pending_action, Some(DirectoryAction::UseExisting));
        assert_eq!(
            fs::read(existing.join("opencabinet.db")).unwrap(),
            backup_bytes
        );
        drop(storage);
        let selected = open_storage(&sandbox.program).unwrap();
        assert_eq!(selected.active, existing);
        assert!(selected.location().unwrap().pending_directory.is_none());
        assert_eq!(
            fs::read(sandbox.source.join("opencabinet.db")).unwrap(),
            source_bytes
        );
        assert_eq!(
            fs::read(existing.join("opencabinet.db")).unwrap(),
            backup_bytes
        );
        assert_eq!(
            fs::read(sandbox.source.join("images/cover.png")).unwrap(),
            b"cover bytes"
        );
        assert!(existing.join(crate::catalog_compat::LEGACY_CATALOG_PATH).is_file());
        let conn = Connection::open(existing.join("opencabinet.db")).unwrap();
        let game: (String, i64, i64) = conn
            .query_row(
                "SELECT title,play_time_seconds,session_count FROM games",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(game, ("Backup title".into(), 98765, 30));
        drop(conn);
        drop(selected);
        let reopened = open_storage(&sandbox.program).unwrap();
        assert_eq!(reopened.active, existing);
        reopened
            .schedule(&sandbox.source, Some(DirectoryAction::UseExisting))
            .unwrap();
        drop(reopened);
        assert_eq!(
            open_storage(&sandbox.program).unwrap().active,
            sandbox.source
        );
        assert_eq!(
            fs::read(existing.join("opencabinet.db")).unwrap(),
            backup_bytes
        );
    }

    #[test]
    fn rejects_nonempty_folders_with_missing_corrupt_or_unrelated_databases() {
        let sandbox = Sandbox::new();
        fs::create_dir(&sandbox.destination).unwrap();
        fs::write(sandbox.destination.join("important.txt"), b"other data").unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        assert!(
            storage
                .inspect(&sandbox.destination)
                .unwrap_err()
                .contains("falta opencabinet.db")
        );
        assert!(!sandbox.destination.join("opencabinet.db").exists());
        fs::write(sandbox.destination.join("opencabinet.db"), b"corrupt sqlite").unwrap();
        assert!(storage.schedule(&sandbox.destination, None).is_err());
        fs::remove_file(sandbox.destination.join("opencabinet.db")).unwrap();
        let conn = Connection::open(sandbox.destination.join("opencabinet.db")).unwrap();
        conn.execute_batch("CREATE TABLE games(title TEXT); CREATE TABLE unrelated(value TEXT);")
            .unwrap();
        drop(conn);
        let bytes = fs::read(sandbox.destination.join("opencabinet.db")).unwrap();
        assert!(storage.schedule(&sandbox.destination, None).is_err());
        assert_eq!(
            fs::read(sandbox.destination.join("opencabinet.db")).unwrap(),
            bytes
        );
        assert!(!sandbox.program.join(CONFIG_FILE).exists());
    }

    #[test]
    fn recognizes_older_libraries_without_optional_tables_or_new_metadata() {
        let sandbox = Sandbox::new();
        let existing = backup(&sandbox);
        let conn = Connection::open(existing.join("opencabinet.db")).unwrap();
        conn.execute_batch("DROP TABLE platforms; DROP TABLE game_images; ALTER TABLE games DROP COLUMN play_time_seconds; ALTER TABLE games DROP COLUMN session_count;").unwrap();
        drop(conn);
        assert!(validate_existing_library(&existing).is_ok());
        let conn = Connection::open(existing.join("opencabinet.db")).unwrap();
        conn.execute_batch("ALTER TABLE games DROP COLUMN platform;")
            .unwrap();
        drop(conn);
        assert!(validate_existing_library(&existing).is_err());
    }

    #[test]
    fn changed_backup_is_revalidated_on_restart_and_original_location_is_kept() {
        let sandbox = Sandbox::new();
        let existing = backup(&sandbox);
        let storage = open_storage(&sandbox.program).unwrap();
        storage
            .schedule(&existing, Some(DirectoryAction::UseExisting))
            .unwrap();
        drop(storage);
        fs::write(existing.join("opencabinet.db"), b"corrupted after scheduling").unwrap();
        let reopened = open_storage(&sandbox.program).unwrap();
        assert_eq!(reopened.active, sandbox.source);
        assert!(
            reopened
                .startup_message
                .as_ref()
                .unwrap()
                .contains("biblioteca seleccionada")
        );
        assert!(reopened.location().unwrap().pending_directory.is_some());
        assert_eq!(
            fs::read(existing.join("opencabinet.db")).unwrap(),
            b"corrupted after scheduling"
        );
    }

    #[test]
    fn automatic_detection_cannot_silently_change_a_previously_reviewed_operation() {
        let sandbox = Sandbox::new();
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(
            storage.inspect(&sandbox.destination).unwrap().action,
            DirectoryAction::Move
        );
        fs::create_dir(&sandbox.destination).unwrap();
        copy_tree(&sandbox.source, &sandbox.destination).unwrap();
        assert!(
            storage
                .schedule(&sandbox.destination, Some(DirectoryAction::Move))
                .unwrap_err()
                .contains("contenido de la carpeta cambió")
        );
        assert!(!sandbox.program.join(CONFIG_FILE).exists());
        assert!(
            storage
                .schedule(&sandbox.destination, Some(DirectoryAction::UseExisting))
                .is_ok()
        );
    }

    #[test]
    fn existing_library_can_be_selected_even_if_the_previous_folder_disappears() {
        let sandbox = Sandbox::new();
        let existing = backup(&sandbox);
        let storage = open_storage(&sandbox.program).unwrap();
        storage.schedule(&existing, None).unwrap();
        drop(storage);
        assert!(inside(&sandbox.source, &sandbox.root).is_some());
        fs::remove_dir_all(&sandbox.source).unwrap();
        let reopened = open_storage(&sandbox.program).unwrap();
        assert_eq!(reopened.active, existing);
        assert!(!sandbox.source.exists());
    }

    #[test]
    fn old_pending_configurations_default_to_move_instead_of_adopting_a_destination() {
        let sandbox = Sandbox::new();
        let old_config = serde_json::json!({ "data_directory": null, "pending_move": { "destination": sandbox.destination, "token": token() } });
        fs::write(
            sandbox.program.join(CONFIG_FILE),
            serde_json::to_vec(&old_config).unwrap(),
        )
        .unwrap();
        assert_eq!(
            read_config(&sandbox.program)
                .unwrap()
                .pending_move
                .unwrap()
                .action,
            DirectoryAction::Move
        );
        let storage = open_storage(&sandbox.program).unwrap();
        assert_eq!(storage.active, sandbox.destination);
        assert!(!sandbox.source.exists());
    }

    #[cfg(windows)]
    #[test]
    fn read_only_backup_cannot_replace_the_active_location() {
        let sandbox = Sandbox::new();
        let existing = backup(&sandbox);
        let database = existing.join("opencabinet.db");
        let original_permissions = fs::metadata(&database).unwrap().permissions();
        let mut readonly = original_permissions.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&database, readonly).unwrap();
        let storage = open_storage(&sandbox.program).unwrap();
        let inspected = storage.inspect(&existing);
        let scheduled = storage.schedule(&existing, Some(DirectoryAction::UseExisting));
        fs::set_permissions(&database, original_permissions).unwrap();
        assert_eq!(inspected.unwrap().action, DirectoryAction::UseExisting);
        assert!(
            scheduled
                .unwrap_err()
                .contains("no permite guardar cambios")
        );
        assert!(!sandbox.program.join(CONFIG_FILE).exists());
        assert_eq!(storage.active, sandbox.source);
    }
    #[test]
    fn relocation_updates_all_disc_paths_and_duplicate_keys_without_changing_order_or_labels() {
        let sandbox=Sandbox::new();let db=sandbox.source.join("opencabinet.db");let conn=Connection::open(&db).unwrap();
        crate::discs::init(&conn).unwrap();
        let external=sandbox.root.join("outside/Disc 1.chd").to_string_lossy().into_owned();
        let internal=sandbox.source.join("roms/Disc 2.chd").to_string_lossy().into_owned();
        let mut sources=vec![crate::discs::source(&external),crate::discs::source(&internal)]; sources[1].label="Bonus".into();
        crate::discs::replace(&conn,1,&sources).unwrap();drop(conn);
        rebase_library(&db,&sandbox.source,&sandbox.destination).unwrap();let conn=Connection::open(&db).unwrap();
        let saved=crate::discs::read(&conn,1).unwrap();assert_eq!(saved[0].rom_path,external);assert_eq!(saved[1].label,"Bonus");
        assert_eq!(Path::new(&saved[1].rom_path),sandbox.destination.join("roms/Disc 2.chd"));
        assert_eq!(crate::discs::owner(&conn,&saved[1].rom_path).unwrap(),Some(1));
    }

}
