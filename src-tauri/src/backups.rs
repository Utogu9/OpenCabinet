//! Portable SQLite snapshots. Restore publishes a new library, never overwrites the active one.
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, ipc::Channel};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};
type Result<T> = std::result::Result<T, String>;
static BUSY: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
const CONFIGS: &[&str] = &[
    "language.json",
    "frontend_preferences.json",
    "backup_settings.json",
    "themes.json",
];
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn token() -> String {
    format!(
        "{}-{}",
        now(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
fn failure() -> String {
    crate::i18n::text("backup.invalid").into()
}
struct Operation;
impl Operation {
    fn begin() -> Result<Self> {
        BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| crate::i18n::text("backup.busy").to_owned())?;
        Ok(Self)
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
pub fn busy() -> bool {
    BUSY.load(Ordering::Acquire)
}

pub fn safety_snapshot() -> Result<()> {
    let _operation = Operation::begin()?;
    create(&crate::storage::active_directory()?, false, false, None)?;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Settings {
    pub automatic: bool,
    pub keep: usize,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            automatic: true,
            keep: 7,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    created: u64,
    source: PathBuf,
    full: bool,
    automatic: bool,
}
#[derive(Serialize)]
pub struct Entry {
    name: String,
    created: u64,
    full: bool,
    automatic: bool,
    bytes: u64,
}
#[derive(Serialize)]
pub struct Status {
    settings: Settings,
    directory: PathBuf,
    entries: Vec<Entry>,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Progress {
    phase: &'static str,
    files: u64,
    bytes: u64,
}
fn settings(root: &Path) -> Settings {
    fs::read(root.join("backup_settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .filter(|s| (1..=30).contains(&s.keep))
        .unwrap_or_default()
}
fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temp = path.with_extension(format!("{}.tmp", token()));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(err)?;
        f.write_all(&serde_json::to_vec_pretty(value).map_err(err)?)
            .map_err(err)?;
        f.sync_all().map_err(err)?;
        drop(f);
        fs::rename(&temp, path).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
fn ordinary(path: &Path) -> Result<fs::Metadata> {
    let m = fs::symlink_metadata(path).map_err(err)?;
    if m.file_type().is_symlink() {
        return Err(failure());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err(failure());
        }
    }
    Ok(m)
}
fn backup_dir(root: &Path) -> Result<PathBuf> {
    let dir = root.join("backups");
    fs::create_dir_all(&dir).map_err(err)?;
    ordinary(&dir)?;
    Ok(dir)
}
fn manifest(path: &Path) -> Result<Manifest> {
    ordinary(path)?;
    let mut zip = ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(err)?;
    if zip.len() > 1_000_000 {
        return Err(failure());
    }
    let mut file = zip.by_name("manifest.json").map_err(err)?;
    if file.size() > 65536 {
        return Err(failure());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(err)?;
    let m: Manifest = serde_json::from_slice(&bytes).map_err(err)?;
    if m.format != "OpenCabinet backup" || m.version != 1 || !m.source.is_absolute() {
        return Err(failure());
    }
    Ok(m)
}
fn entries(root: &Path) -> Result<Vec<Entry>> {
    let dir = backup_dir(root)?;
    let mut result = Vec::new();
    for e in fs::read_dir(dir).map_err(err)? {
        let e = e.map_err(err)?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with("opencabinet-") && name.ends_with(".ocbackup") {
            if let Ok(m) = manifest(&e.path()) {
                result.push(Entry {
                    name,
                    created: m.created,
                    full: m.full,
                    automatic: m.automatic,
                    bytes: e.metadata().map_err(err)?.len(),
                });
            }
        }
    }
    result.sort_by(|a, b| b.created.cmp(&a.created).then(b.name.cmp(&a.name)));
    Ok(result)
}
fn snapshot(source: &Path, target: &Path) -> Result<()> {
    let source = Connection::open_with_flags(
        crate::storage::database_path(source),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(err)?;
    source.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    let mut target = Connection::open(target).map_err(err)?;
    let backup = rusqlite::backup::Backup::new(&source, &mut target).map_err(err)?;
    backup
        .run_to_completion(256, Duration::from_millis(10), None)
        .map_err(err)
}
fn walk(root: &Path, path: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    let m = ordinary(path)?;
    if !fs::canonicalize(path)
        .map_err(err)?
        .starts_with(fs::canonicalize(root).map_err(err)?)
    {
        return Err(failure());
    }
    if m.is_dir() {
        for e in fs::read_dir(path).map_err(err)? {
            walk(root, &e.map_err(err)?.path(), files)?;
        }
    } else if m.is_file() {
        files.push(path.to_owned());
    } else {
        return Err(failure());
    }
    Ok(())
}
fn create(
    root: &Path,
    full: bool,
    automatic: bool,
    progress: Option<&Channel<Progress>>,
) -> Result<PathBuf> {
    let dir = backup_dir(root)?;
    let name = format!(
        "opencabinet-{}-{}.ocbackup",
        if automatic { "auto" } else { "manual" },
        token()
    );
    let destination = dir.join(&name);
    let partial = dir.join(format!(".{name}.tmp"));
    let database = dir.join(format!(".{name}.db.tmp"));
    let result = (|| {
        if let Some(p) = progress {
            let _ = p.send(Progress {
                phase: "database",
                files: 0,
                bytes: 0,
            });
        }
        snapshot(root, &database)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .map_err(err)?;
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options).map_err(err)?;
        zip.write_all(
            &serde_json::to_vec(&Manifest {
                format: "OpenCabinet backup".into(),
                version: 1,
                created: now(),
                source: root.into(),
                full,
                automatic,
            })
            .map_err(err)?,
        )
        .map_err(err)?;
        let mut files = vec![database.clone()];
        for name in CONFIGS {
            let p = root.join(name);
            if p.exists() {
                ordinary(&p)?;
                files.push(p);
            }
        }
        if full && root.join("images").exists() {
            walk(root, &root.join("images"), &mut files)?;
        }
        let mut bytes = 0;
        for (i, path) in files.iter().enumerate() {
            let name = if path == &database {
                "library.db".into()
            } else {
                path.strip_prefix(root)
                    .map_err(err)?
                    .to_string_lossy()
                    .replace('\\', "/")
            };
            zip.start_file(name, options).map_err(err)?;
            bytes +=
                std::io::copy(&mut fs::File::open(path).map_err(err)?, &mut zip).map_err(err)?;
            if let Some(p) = progress {
                if i % 32 == 0 || i + 1 == files.len() {
                    let _ = p.send(Progress {
                        phase: "copying",
                        files: (i + 1) as u64,
                        bytes,
                    });
                }
            }
        }
        zip.finish().map_err(err)?.sync_all().map_err(err)?;
        fs::rename(&partial, &destination).map_err(err)?;
        Ok(destination.clone())
    })();
    let _ = fs::remove_file(database);
    if result.is_err() {
        let _ = fs::remove_file(partial);
    }
    result
}
fn idle(app: &tauri::AppHandle) -> Result<()> {
    if app.state::<crate::PlayTracker>().has_active_sessions()
        || app
            .state::<crate::metadata::MetadataJobs>()
            .has_active_job()
        || app.state::<crate::retroarch::RetroArchJobs>().busy()
        || crate::storage::has_pending_directory()?
    {
        return Err(crate::i18n::text("backup.finish_tasks").into());
    }
    Ok(())
}
fn automatic(root: &Path) -> Result<()> {
    automatic_at(root, now())
}
fn automatic_at(root: &Path, time: u64) -> Result<()> {
    let config = settings(root);
    if !config.automatic || !crate::storage::database_path(root).is_file() {
        return Ok(());
    }
    let old = entries(root)?;
    if old
        .iter()
        .any(|e| e.automatic && time.saturating_sub(e.created) < 86400)
    {
        return Ok(());
    }
    create(root, false, true, None)?;
    // Only prune our validated automatic archives, and only after publishing a new one.
    for e in entries(root)?
        .into_iter()
        .filter(|e| e.automatic)
        .skip(config.keep)
    {
        fs::remove_file(root.join("backups").join(e.name)).map_err(err)?;
    }
    Ok(())
}
fn cleanup_interrupted(root: &Path) -> Result<()> {
    let dir = backup_dir(root)?;
    for e in fs::read_dir(&dir).map_err(err)? {
        let e = e.map_err(err)?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with(".opencabinet-")
            && (name.ends_with(".ocbackup.tmp") || name.ends_with(".ocbackup.db.tmp"))
            && ordinary(&e.path()).is_ok_and(|m| m.is_file())
        {
            fs::remove_file(e.path()).map_err(err)?;
        }
    }
    if let Some(parent) = root.parent() {
        let expected = fs::canonicalize(root).map_err(err)?;
        for e in fs::read_dir(parent).map_err(err)? {
            let e = e.map_err(err)?;
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(".opencabinet-restore-")
                && ordinary(&e.path()).is_ok_and(|m| m.is_dir())
            {
                if fs::read(e.path().join(".restore-owner.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<PathBuf>(&b).ok())
                    .as_ref()
                    == Some(&expected)
                {
                    remove_stage(&e.path(), parent)?;
                }
            }
        }
    }
    Ok(())
}
pub fn start_worker(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            if idle(&app).is_ok() {
                if let Ok(_operation) = Operation::begin() {
                    if let Ok(root) = crate::storage::active_directory() {
                        let outcome = cleanup_interrupted(&root).and_then(|_| automatic(&root));
                        if let Ok(mut slot) = LAST_ERROR.lock() {
                            *slot = outcome.err();
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}
#[tauri::command]
pub async fn get_backup_status() -> Result<Status> {
    tauri::async_runtime::spawn_blocking(|| {
        let root = crate::storage::active_directory()?;
        Ok(Status {
            settings: settings(&root),
            directory: backup_dir(&root)?,
            entries: entries(&root)?,
            error: LAST_ERROR.lock().map_err(err)?.clone(),
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn save_backup_settings(settings: Settings) -> Result<()> {
    if !(1..=30).contains(&settings.keep) {
        return Err(failure());
    }
    tauri::async_runtime::spawn_blocking(move || {
        atomic_json(
            &crate::storage::active_directory()?.join("backup_settings.json"),
            &settings,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn save_backup_preferences(preferences: serde_json::Value) -> Result<()> {
    if !preferences.is_object() {
        return Err(failure());
    }
    tauri::async_runtime::spawn_blocking(move || {
        atomic_json(
            &crate::storage::active_directory()?.join("frontend_preferences.json"),
            &preferences,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn get_restored_preferences() -> Result<Option<serde_json::Value>> {
    let path = crate::storage::active_directory()?.join("restored_preferences.json");
    if !path.exists() {
        return Ok(None);
    }
    serde_json::from_slice(&fs::read(path).map_err(err)?)
        .map(Some)
        .map_err(err)
}
#[tauri::command]
pub fn acknowledge_restored_preferences() -> Result<()> {
    fs::remove_file(crate::storage::active_directory()?.join("restored_preferences.json"))
        .map_err(err)
}
#[tauri::command]
pub async fn create_backup(
    app: tauri::AppHandle,
    full: bool,
    on_progress: Channel<Progress>,
) -> Result<String> {
    let operation = Operation::begin()?;
    idle(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        create(
            &crate::storage::active_directory()?,
            full,
            false,
            Some(&on_progress),
        )
        .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn choose_backup() -> Result<Option<String>> {
    Ok(rfd::AsyncFileDialog::new()
        .add_filter("OpenCabinet backup", &["ocbackup"])
        .pick_file()
        .await
        .map(|p| p.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn open_backup_directory(app: tauri::AppHandle) -> Result<()> {
    crate::platform_runtime::open_path(&app,&backup_dir(&crate::storage::active_directory()?)?)
}
fn allowed(name: &str) -> bool {
    if name.contains(['\\', ':']) {
        return false;
    }
    let path = Path::new(name);
    if !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return false;
    }
    matches!(name, "manifest.json" | "library.db")
        || CONFIGS.contains(&name)
        || name.starts_with("images/")
}
fn copy_media(
    source: &Path,
    destination: &Path,
    progress: Option<&Channel<Progress>>,
) -> Result<()> {
    let mut files = Vec::new();
    if !source.exists() {
        return Ok(());
    }
    walk(source, source, &mut files)?;
    let mut bytes = 0;
    for (i, p) in files.into_iter().enumerate() {
        let target = destination.join(p.strip_prefix(source).map_err(err)?);
        fs::create_dir_all(target.parent().ok_or_else(failure)?).map_err(err)?;
        let expected = ordinary(&p)?.len();
        let copied = fs::copy(p, &target).map_err(err)?;
        if copied != expected {
            return Err(failure());
        }
        fs::OpenOptions::new()
            .write(true)
            .open(target)
            .map_err(err)?
            .sync_all()
            .map_err(err)?;
        bytes += copied;
        if i % 32 == 0 {
            if let Some(p) = progress {
                let _ = p.send(Progress {
                    phase: "copying",
                    files: (i + 1) as u64,
                    bytes,
                });
            }
        }
    }
    Ok(())
}
fn remove_stage(stage: &Path, parent: &Path) -> Result<()> {
    // Called only for our freshly created sibling. Never follow reparse points.
    ordinary(stage)?;
    if stage.parent() != Some(parent)
        || !stage
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with(".opencabinet-restore-"))
    {
        return Err(failure());
    }
    let mut files = Vec::new();
    walk(stage, stage, &mut files)?;
    fs::remove_dir_all(stage).map_err(err)
}
fn prepare_restore(
    root: &Path,
    archive: &Path,
    progress: Option<&Channel<Progress>>,
) -> Result<PathBuf> {
    let m = manifest(archive)?;
    let parent = root.parent().ok_or_else(failure)?;
    let id = token();
    let stage = parent.join(format!(".opencabinet-restore-{id}"));
    let destination = parent.join(format!("opencabinet-restored-{id}"));
    fs::create_dir(&stage).map_err(err)?;
    let result = (|| {
        fs::write(
            stage.join(".restore-owner.json"),
            serde_json::to_vec(&fs::canonicalize(root).map_err(err)?).map_err(err)?,
        )
        .map_err(err)?;
        let mut zip = ZipArchive::new(fs::File::open(archive).map_err(err)?).map_err(err)?;
        let mut seen = std::collections::HashSet::new();
        let mut bytes = 0;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(err)?;
            let name = entry.name().map_err(err)?.into_owned();
            if !allowed(&name)
                || !seen.insert(name.to_lowercase())
                || entry.is_dir()
                || entry
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(failure());
            }
            bytes += entry.size();
            if bytes > 128 * 1024 * 1024 * 1024 {
                return Err(failure());
            }
            let target = stage.join(&name);
            fs::create_dir_all(target.parent().ok_or_else(failure)?).map_err(err)?;
            let mut output = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(target)
                .map_err(err)?;
            std::io::copy(&mut entry, &mut output).map_err(err)?;
            output.sync_all().map_err(err)?;
            if let Some(p) = progress {
                if i % 32 == 0 {
                    let _ = p.send(Progress {
                        phase: "restoring",
                        files: (i + 1) as u64,
                        bytes,
                    });
                }
            }
        }
        fs::rename(stage.join("library.db"), stage.join("opencabinet.db")).map_err(err)?;
        crate::storage::validate_existing_library(&stage)?;
        if !m.full {
            copy_media(&root.join("images"), &stage.join("images"), progress)?;
        }
        // Managed emulator binaries remain local, like external ROMs. Preserve them when possible.
        copy_media(&root.join("emulators"), &stage.join("emulators"), progress)?;
        crate::storage::rebase_library(&stage.join("opencabinet.db"), &m.source, &destination)?;
        if stage.join("frontend_preferences.json").is_file() {
            let mut preferences: serde_json::Value = serde_json::from_slice(
                &fs::read(stage.join("frontend_preferences.json")).map_err(err)?,
            )
            .map_err(err)?;
            if !preferences.is_object() {
                return Err(failure());
            }
            if let Some(path) = preferences["cacheDirectory"].as_str().map(PathBuf::from) {
                if let Ok(relative) = path.strip_prefix(&m.source) {
                    preferences["cacheDirectory"] = serde_json::json!(destination.join(relative));
                }
            }
            atomic_json(&stage.join("restored_preferences.json"), &preferences)?;
        }
        fs::rename(&stage, &destination).map_err(err)?;
        Ok(destination.clone())
    })();
    if result.is_err() {
        let _ = remove_stage(&stage, parent);
    }
    result
}
#[tauri::command]
pub async fn restore_backup(
    app: tauri::AppHandle,
    path: String,
    on_progress: Channel<Progress>,
) -> Result<String> {
    let operation = Operation::begin()?;
    idle(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let root = crate::storage::active_directory()?;
        // Preserve a rollback snapshot before scheduling a different library.
        manifest(Path::new(&path))?;
        create(&root, false, false, None)?;
        let destination = prepare_restore(&root, Path::new(&path), Some(&on_progress))?;
        idle(&app)?;
        crate::storage::schedule_restored_library(&destination)?;
        Ok(destination.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Library {
        base: PathBuf,
        root: PathBuf,
    }
    impl Library {
        fn new() -> Self {
            // Parallel Windows tests can share the same clock tick.
            static NEXT_LIBRARY: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let base = std::env::temp_dir().join(format!("opencabinet-backup-tests-{}-{}-{}", std::process::id(), token(), NEXT_LIBRARY.fetch_add(1, Ordering::Relaxed)));
            let root = base.join("data");
            fs::create_dir_all(&root).unwrap();
            let db = Connection::open(root.join("opencabinet.db")).unwrap();
            db.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT,cover_path TEXT,play_time INTEGER,session_count INTEGER);
                CREATE TABLE emulators(id INTEGER PRIMARY KEY,name TEXT,platform TEXT,executable_path TEXT,arguments TEXT);
                INSERT INTO games VALUES(1,'Original','PS2','D:/ROMs/game.iso','images/one/cover.webp',120,4);").unwrap();
            fs::create_dir_all(root.join("images/one/manuals")).unwrap();
            fs::write(root.join("images/one/cover.webp"), b"cover original").unwrap();
            fs::write(
                root.join("images/one/manuals/manual.pdf"),
                b"manual original",
            )
            .unwrap();
            atomic_json(
                &root.join("frontend_preferences.json"),
                &serde_json::json!({"language":"en-US","maxCachedCovers":200}),
            )
            .unwrap();
            atomic_json(&root.join("themes.json"), &crate::themes::Library::default()).unwrap();
            Self { base, root }
        }
        fn zip(&self, name: &str, entries: &[(&str, &[u8])]) -> PathBuf {
            let p = self.base.join(name);
            let mut zip = ZipWriter::new(fs::File::create(&p).unwrap());
            let m = Manifest {
                format: "OpenCabinet backup".into(),
                version: 1,
                created: now(),
                source: self.root.clone(),
                full: true,
                automatic: false,
            };
            zip.start_file("manifest.json", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
            for (name, bytes) in entries {
                zip.start_file(*name, SimpleFileOptions::default()).unwrap();
                zip.write_all(bytes).unwrap();
            }
            zip.finish().unwrap();
            p
        }
    }
    impl Drop for Library {
        fn drop(&mut self) {
            assert!(
                self.base.starts_with(std::env::temp_dir()) && self.base != std::env::temp_dir()
            );
            let _ = fs::remove_dir_all(&self.base);
        }
    }
    #[test]
    fn sqlite_snapshot_includes_committed_wal_and_excludes_media_in_light_backups() {
        let f = Library::new();
        let db = Connection::open(f.root.join("opencabinet.db")).unwrap();
        db.execute_batch(
            "PRAGMA journal_mode=WAL; UPDATE games SET title='WAL title',session_count=9",
        )
        .unwrap();
        let path = create(&f.root, false, false, None).unwrap();
        assert!(!manifest(&path).unwrap().full);
        let mut zip = ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
        assert!(zip.by_name("images/one/cover.webp").is_err());
        assert!(zip.by_name("frontend_preferences.json").is_ok());
        assert!(zip.by_name("themes.json").is_ok());
        let destination = prepare_restore(
            &f.root,
            &f.root
                .join("backups")
                .join(entries(&f.root).unwrap()[0].name.clone()),
            None,
        )
        .unwrap();
        let restored = Connection::open(destination.join("opencabinet.db")).unwrap();
        assert_eq!(
            restored
                .query_row("SELECT title,session_count FROM games", [], |r| Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?
                )))
                .unwrap(),
            ("WAL title".into(), 9)
        );
        assert_eq!(
            fs::read(destination.join("images/one/manuals/manual.pdf")).unwrap(),
            b"manual original"
        );
        assert_eq!(fs::read(destination.join("themes.json")).unwrap(), fs::read(f.root.join("themes.json")).unwrap());
    }
    #[test]
    fn full_restore_recovers_media_statistics_and_preferences_without_touching_current_library() {
        let f = Library::new();
        let archive = create(&f.root, true, false, None).unwrap();
        fs::write(f.root.join("images/one/cover.webp"), b"changed").unwrap();
        let conn = Connection::open(f.root.join("opencabinet.db")).unwrap();
        conn.execute("UPDATE games SET session_count=99", [])
            .unwrap();
        drop(conn);
        let destination = prepare_restore(&f.root, &archive, None).unwrap();
        assert_eq!(
            fs::read(destination.join("images/one/cover.webp")).unwrap(),
            b"cover original"
        );
        assert_eq!(
            fs::read(f.root.join("images/one/cover.webp")).unwrap(),
            b"changed"
        );
        let restored = Connection::open(destination.join("opencabinet.db")).unwrap();
        assert_eq!(
            restored
                .query_row("SELECT session_count FROM games", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            4
        );
        assert!(destination.join("restored_preferences.json").is_file());
        assert_eq!(
            Connection::open(f.root.join("opencabinet.db"))
                .unwrap()
                .query_row("SELECT session_count FROM games", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            99
        );
    }
    #[test]
    fn automatic_backups_default_to_daily_seven_and_never_prune_manual_copies() {
        let f = Library::new();
        assert!(settings(&f.root).automatic);
        assert_eq!(settings(&f.root).keep, 7);
        automatic(&f.root).unwrap();
        automatic(&f.root).unwrap();
        assert_eq!(entries(&f.root).unwrap().len(), 1);
        let manual = create(&f.root, false, false, None).unwrap();
        for _ in 0..3 {
            create(&f.root, false, true, None).unwrap();
        }
        atomic_json(
            &f.root.join("backup_settings.json"),
            &Settings {
                automatic: true,
                keep: 2,
            },
        )
        .unwrap();
        automatic_at(&f.root, now() + 86401).unwrap();
        let list = entries(&f.root).unwrap();
        assert_eq!(list.iter().filter(|e| e.automatic).count(), 2);
        assert!(manual.is_file());
        atomic_json(
            &f.root.join("backup_settings.json"),
            &Settings {
                automatic: false,
                keep: 2,
            },
        )
        .unwrap();
        automatic_at(&f.root, now() + 172801).unwrap();
        assert_eq!(entries(&f.root).unwrap().len(), 3);
    }
    #[test]
    fn restore_rejects_traversal_duplicates_corrupt_databases_and_leaves_no_stage() {
        let f = Library::new();
        for (i, name) in [
            "../escape",
            "images/../../escape",
            "images\\escape",
            "C:/escape",
            "unexpected.exe",
        ]
        .iter()
        .enumerate()
        {
            let zip = f.zip(&format!("invalid{i}.ocbackup"), &[(name, b"bad")]);
            assert!(prepare_restore(&f.root, &zip, None).is_err());
        }
        let zip = f.zip("corrupt.ocbackup", &[("library.db", b"not a database")]);
        assert!(prepare_restore(&f.root, &zip, None).is_err());
        assert!(fs::read_dir(&f.base).unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".opencabinet-restore-")
        }));
        assert!(!f.base.join("escape").exists());
        assert_eq!(entries(&f.root).unwrap().len(), 0);
    }
    #[test]
    fn cleanup_only_removes_owned_interrupted_operations() {
        let f = Library::new();
        let dir = backup_dir(&f.root).unwrap();
        fs::write(dir.join(".opencabinet-manual-1.ocbackup.tmp"), b"partial").unwrap();
        fs::write(dir.join("other.tmp"), b"keep").unwrap();
        let archive = create(&f.root, false, false, None).unwrap();
        cleanup_interrupted(&f.root).unwrap();
        assert!(archive.exists());
        assert!(dir.join("other.tmp").exists());
        assert!(!dir.join(".opencabinet-manual-1.ocbackup.tmp").exists());
    }
}
