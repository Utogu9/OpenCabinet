use super::{RomCandidate, ScanPreview, ScanProgress};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

const PREFIX: &str = "com.epicgames.launcher://apps/";
const SUFFIX: &str = "?action=launch&silent=true";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EpicSource {
    pub app_id: String,
    pub client_path: String,
    pub manifest_path: String,
}

#[derive(Serialize)]
pub struct EpicScan {
    manifests_path: String,
    ignored_count: usize,
    warnings: Vec<String>,
    preview: ScanPreview,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Manifest {
    app_name: String,
    display_name: String,
    catalog_namespace: String,
    catalog_item_id: String,
    install_location: PathBuf,
    launch_executable: String,
    #[serde(default, rename = "bIsIncompleteInstall")]
    incomplete: bool,
    #[serde(default, rename = "bIsApplication")]
    application: Option<bool>,
    #[serde(default)]
    app_categories: Vec<String>,
    #[serde(default)]
    main_game_app_name: String,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 512
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
}

fn uri(manifest: &Manifest) -> Result<String, String> {
    if ![
        &manifest.catalog_namespace,
        &manifest.catalog_item_id,
        &manifest.app_name,
    ]
    .iter()
    .all(|id| valid_id(id))
    {
        return Err(crate::i18n::text("msg.5fec844716").into());
    }
    Ok(format!(
        "{PREFIX}{}%3A{}%3A{}{SUFFIX}",
        manifest.catalog_namespace, manifest.catalog_item_id, manifest.app_name
    ))
}

pub fn app_id(path: &str) -> Option<String> {
    let parts: Vec<_> = path
        .strip_prefix(PREFIX)?
        .strip_suffix(SUFFIX)?
        .split("%3A")
        .collect();
    (parts.len() == 3 && parts.iter().all(|part| valid_id(part))).then(|| parts[2].to_owned())
}

fn read_manifest(path: &Path) -> Result<Option<Manifest>, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("item"))
    {
        return Err(crate::i18n::text("msg.bc3cc58eda").into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(crate::i18n::text("msg.5b36219b16").into());
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    let data: Manifest =
        serde_json::from_slice(bytes).map_err(|e| crate::i18n::i18n_format!("msg.0864d9ad16", e = e))?;
    uri(&data)?;
    let launchable_addon = data
        .app_categories
        .iter()
        .any(|category| category == "addons/launchable");
    if data.incomplete
        || data.application == Some(false)
        || data.catalog_namespace == "ue"
        || data.app_name.starts_with("UE_")
        || data.app_categories.iter().any(|category| {
            matches!(
                category.as_str(),
                "plugins" | "plugins/engine" | "engines" | "digitalextras"
            )
        })
        || (!launchable_addon
            && (data
                .app_categories
                .iter()
                .any(|category| category == "addons")
                || (!data.main_game_app_name.is_empty()
                    && data.main_game_app_name != data.app_name)))
    {
        return Ok(None);
    }
    if data.display_name.trim().is_empty() {
        return Err(crate::i18n::text("msg.53550d2c3b").into());
    }
    if !data.install_location.is_absolute() || !data.install_location.is_dir() {
        return Ok(None);
    }
    // Epic launches the game, never execute this manifest's arbitrary arguments.
    // Only use its executable to confirm a complete installation and track playtime.
    let relative = PathBuf::from(data.launch_executable.replace('\\', "/"));
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(crate::i18n::text("msg.2ea2fb4454").into());
    }
    let executable = data.install_location.join(relative);
    if !executable
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        || !executable.is_file()
    {
        return Ok(None);
    }
    let root = data
        .install_location
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !executable
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(&root)
    {
        return Err(crate::i18n::text("msg.f129b42f89").into());
    }
    Ok(Some(data))
}

fn valid_client(path: &Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("EpicGamesLauncher.exe"))
}

fn default_manifest_folder() -> Option<PathBuf> {
    std::env::var_os("PROGRAMDATA")
        .map(|root| PathBuf::from(root).join("Epic/EpicGamesLauncher/Data/Manifests"))
}

fn client_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::*};
        if let Ok(key) = RegKey::predef(HKEY_CLASSES_ROOT)
            .open_subkey(r"com.epicgames.launcher\shell\open\command")
        {
            if let Ok(command) = key.get_value::<String, _>("") {
                // Extract only the registered executable; do not pass a shell command through.
                let command = command.trim();
                if let Some(quoted) = command.strip_prefix('"') {
                    if let Some(end) = quoted.find('"') {
                        paths.push(PathBuf::from(&quoted[..end]));
                    }
                } else if let Some(end) = command.to_ascii_lowercase().find(".exe") {
                    paths.push(PathBuf::from(&command[..end + 4]));
                }
            }
        }
    }
    for variable in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Some(root) = std::env::var_os(variable) {
            for arch in ["Win32", "Win64"] {
                paths.push(PathBuf::from(&root).join(format!(
                    "Epic Games/Launcher/Portal/Binaries/{arch}/EpicGamesLauncher.exe"
                )));
            }
        }
    }
    paths
}

pub fn validate(candidate: &RomCandidate) -> Result<(), String> {
    let source = candidate
        .epic
        .as_ref()
        .ok_or("Falta el origen Epic Games.")?;
    if app_id(&candidate.rom_path).as_deref() != Some(&source.app_id) {
        return Err(crate::i18n::text("msg.4080fbecc1").into());
    }
    if !valid_client(Path::new(&source.client_path)) {
        return Err(crate::i18n::text("msg.41efee28ed").into());
    }
    let manifest = read_manifest(Path::new(&source.manifest_path))?
        .ok_or(crate::i18n::text("msg.68d557be37"))?;
    if uri(&manifest)? != candidate.rom_path {
        return Err(crate::i18n::text("msg.1adf934ea6").into());
    }
    Ok(())
}

fn scan(
    conn: &Connection,
    folder: &Path,
    client: &Path,
    mut progress: impl FnMut(ScanProgress),
) -> Result<EpicScan, String> {
    if !folder.is_absolute() || !folder.is_dir() {
        return Err(crate::i18n::text("msg.738173347d").into());
    }
    if !valid_client(client) {
        return Err(
            crate::i18n::text("msg.00cd63c21a").into(),
        );
    }
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        match entry {
            Ok(entry)
                if entry
                    .path()
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("item")) =>
            {
                files.push(entry.path())
            }
            Err(error) => warnings.push(error.to_string()),
            _ => (),
        }
    }
    files.sort();
    let total = files.len();
    let mut ids = HashSet::new();
    let mut games = Vec::new();
    let mut skipped = 0;
    let mut ignored = 0;
    let mut last_update = Instant::now();
    progress(ScanProgress {
        phase: "discovering",
        processed: 0,
        total: Some(total),
        added_count: 0,
        skipped_count: 0,
        current_file: None,
    });
    for (index, path) in files.into_iter().enumerate() {
        match read_manifest(&path) {
            Ok(Some(manifest)) if ids.insert(manifest.app_name.clone()) => {
                let rom_path = uri(&manifest)?;
                let exists: bool = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM games WHERE rom_path=?1)",
                        [&rom_path],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exists {
                    skipped += 1;
                } else {
                    games.push(RomCandidate { discs: Vec::new(), existing_game_id: None,
                        title: manifest.display_name.trim().to_owned(),
                        rom_path,
                        steam: None,
                        epic: Some(EpicSource {
                            app_id: manifest.app_name,
                            client_path: client.to_string_lossy().into_owned(),
                            manifest_path: path.to_string_lossy().into_owned(),
                        }),
                    });
                }
            }
            Ok(_) => ignored += 1,
            Err(error) => {
                ignored += 1;
                warnings.push(crate::i18n::i18n_format!("msg.7817472218", path.display(), error = error));
            }
        }
        if last_update.elapsed() >= Duration::from_millis(100) || index + 1 == total {
            progress(ScanProgress {
                phase: "discovering",
                processed: index + 1,
                total: Some(total),
                added_count: 0,
                skipped_count: skipped,
                current_file: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned()),
            });
            last_update = Instant::now();
        }
    }
    games.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then(a.rom_path.cmp(&b.rom_path))
    });
    Ok(EpicScan {
        manifests_path: folder.to_string_lossy().into_owned(),
        ignored_count: ignored,
        warnings,
        preview: ScanPreview {
            total_found: games.len() + skipped,
            games,
            skipped_count: skipped,
        },
    })
}

#[tauri::command]
pub async fn select_epic_folder() -> Option<String> {
    let dialog =
        rfd::AsyncFileDialog::new().set_title(crate::i18n::text("msg.2b852fb7e7"));
    let dialog = if let Some(folder) = default_manifest_folder().filter(|path| path.is_dir()) {
        dialog.set_directory(folder)
    } else {
        dialog
    };
    dialog
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn scan_epic_games(
    manifests_path: Option<String>,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<EpicScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = manifests_path
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .or_else(default_manifest_folder)
            .ok_or(
                crate::i18n::text("msg.244ab1da70"),
            )?;
        let client = client_candidates()
            .into_iter()
            .find(|path| valid_client(path))
            .ok_or(crate::i18n::text("msg.48a208c393"))?;
        let conn = super::get_db_connection().map_err(|e| e.to_string())?;
        scan(&conn, &folder, &client, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub struct LaunchPlan {
    pub client: PathBuf,
    pub args: Vec<String>,
    pub install_directory: PathBuf,
}

pub fn launch_plan(conn: &Connection, game_id: i32, game_uri: &str) -> Result<LaunchPlan, String> {
    if app_id(game_uri).is_none() {
        return Err(crate::i18n::text("msg.4ba782444b").into());
    }
    let (saved_client, saved_manifest): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT epic_client_path,epic_manifest_path FROM games WHERE id=?1",
            [game_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let client = saved_client
        .map(PathBuf::from)
        .into_iter()
        .chain(client_candidates())
        .find(|path| valid_client(path))
        .ok_or(crate::i18n::text("msg.41efee28ed"))?;
    let mut paths = Vec::new();
    let mut folders = Vec::new();
    if let Some(path) = saved_manifest.map(PathBuf::from) {
        if let Some(parent) = path.parent() {
            folders.push(parent.to_owned());
        }
        paths.push(path);
    }
    if let Some(folder) = default_manifest_folder() {
        folders.push(folder);
    }
    for folder in folders {
        if let Ok(entries) = fs::read_dir(folder) {
            paths.extend(entries.flatten().map(|entry| entry.path()).filter(|path| {
                path.extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("item"))
            }));
        }
    }
    let mut seen = HashSet::new();
    for path in paths.into_iter().filter(|path| seen.insert(path.clone())) {
        if let Some(manifest) = read_manifest(&path).ok().flatten() {
            if uri(&manifest).ok().as_deref() == Some(game_uri) {
                return Ok(LaunchPlan {
                    client,
                    args: vec![game_uri.to_owned()],
                    install_directory: manifest.install_location,
                });
            }
        }
    }
    Err(crate::i18n::text("msg.c01f7805de").into())
}

fn is_game_process(root: &Path, executable: &Path) -> bool {
    if !executable.starts_with(root) {
        return false;
    }
    let name = executable
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    // Persistent services, uninstallers and crash reporters must not keep a session open.
    ![
        "crash",
        "report",
        "unins",
        "epicwebhelper",
        "epicgameslauncher",
        "eosoverlay",
        "easyanticheat",
        "battleye",
        "beservice",
    ]
    .iter()
    .any(|part| name.contains(part))
}

#[cfg(windows)]
fn running(root: &Path) -> Option<bool> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_NO_MORE_FILES, GetLastError, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
        },
    };
    // Each owned snapshot/process handle is closed on every path. Read-only queries
    // need no elevation; inaccessible processes elsewhere are deliberately ignored.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut next = Process32FirstW(snapshot, &mut entry);
        while next != 0 {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
            if !process.is_null() {
                let mut buffer = vec![0u16; 32768];
                let mut length = buffer.len() as u32;
                let success =
                    QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
                CloseHandle(process);
                if success != 0 {
                    let path =
                        PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
                    // Canonicalization normalizes drive-letter casing and junctions.
                    if path
                        .canonicalize()
                        .ok()
                        .is_some_and(|path| is_game_process(root, &path))
                    {
                        CloseHandle(snapshot);
                        return Some(true);
                    }
                }
            }
            next = Process32NextW(snapshot, &mut entry);
        }
        let ended = GetLastError() == ERROR_NO_MORE_FILES;
        CloseHandle(snapshot);
        ended.then_some(false)
    }
}
#[cfg(not(windows))]
fn running(_: &Path) -> Option<bool> {
    None
}

pub struct EpicSession {
    directory: PathBuf,
    requested: Instant,
    began: Option<Instant>,
    last_seen: Option<Instant>,
}
impl EpicSession {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory: directory.canonicalize().unwrap_or(directory),
            requested: Instant::now(),
            began: None,
            last_seen: None,
        }
    }
    pub fn poll(&mut self) -> bool {
        self.observe(running(&self.directory), Instant::now())
    }
    fn observe(&mut self, state: Option<bool>, now: Instant) -> bool {
        if state == Some(true) {
            self.began.get_or_insert(now);
            self.last_seen = Some(now);
            return true;
        }
        // Allow a short bootstrap-to-game handoff. Never time the Epic client itself.
        if let Some(last) = self.last_seen {
            return now.duration_since(last) < Duration::from_secs(5);
        }
        now.duration_since(self.requested) < Duration::from_secs(120)
    }
    pub fn elapsed(&self) -> Duration {
        match (self.began, self.last_seen) {
            (Some(start), Some(last)) => last.duration_since(start),
            _ => Duration::ZERO,
        }
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub struct Fixture {
        pub root: PathBuf,
        pub manifests: PathBuf,
        pub client: PathBuf,
    }
    impl Fixture {
        pub fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "opencabinet-epic-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let manifests = root.join("Manifests");
            fs::create_dir_all(&manifests).unwrap();
            let client = root.join("EpicGamesLauncher.exe");
            fs::write(&client, b"Fake client, never executed").unwrap();
            Self {
                root,
                manifests,
                client,
            }
        }
        pub fn install(&self, id: &str, title: &str) -> PathBuf {
            let directory = self.root.join("Games on another disk").join(id);
            fs::create_dir_all(directory.join("bin")).unwrap();
            fs::write(directory.join("bin/Game.exe"), b"Fake game, never executed").unwrap();
            let path = self.manifests.join(format!("{id}.item"));
            fs::write(&path, serde_json::to_vec(&serde_json::json!({
                "AppName": id, "DisplayName": title, "CatalogNamespace": "sandbox", "CatalogItemId": format!("item-{id}"),
                "InstallLocation": directory, "LaunchExecutable": "bin\\Game.exe", "bIsIncompleteInstall": false,
                "bIsApplication": true, "AppCategories": ["games", "applications"], "MainGameAppName": id,
                "LaunchCommand": "Untrusted manifest arguments must not be executed"
            })).unwrap()).unwrap();
            path
        }
        pub fn preview(&self, conn: &Connection) -> ScanPreview {
            scan(conn, &self.manifests, &self.client, |_| {})
                .unwrap()
                .preview
        }
        fn database(&self) -> Connection {
            let conn = Connection::open(self.root.join("opencabinet.db")).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS games(id INTEGER PRIMARY KEY,title TEXT NOT NULL,platform TEXT NOT NULL,rom_path TEXT NOT NULL UNIQUE,cover_path TEXT,play_time INTEGER DEFAULT 0,release_date TEXT,developer TEXT,publisher TEXT);").unwrap();
            crate::init_game_metadata(&conn).unwrap();
            conn
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert!(self.root.is_absolute() && self.root.starts_with(std::env::temp_dir()));
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn edit(path: &Path, key: &str, value: serde_json::Value) {
        let mut data: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        data[key] = value;
        fs::write(path, serde_json::to_vec(&data).unwrap()).unwrap();
    }

    #[test]
    fn scans_only_complete_games_filters_components_sorts_deduplicates_and_reports_invalid_manifests()
     {
        let f = Fixture::new();
        let conn = f.database();
        f.install("z", "Zelda");
        let alpha = f.install("a", "Álpha & friends");
        fs::copy(alpha, f.manifests.join("duplicate.item")).unwrap();
        let incomplete = f.install("incomplete", "Downloading");
        edit(&incomplete, "bIsIncompleteInstall", true.into());
        let addon = f.install("addon", "DLC");
        edit(&addon, "AppCategories", serde_json::json!(["addons"]));
        let engine = f.install("UE_5.6", "Unreal Engine");
        edit(&engine, "CatalogNamespace", "ue".into());
        let plugin = f.install("plugin", "Engine plugin");
        edit(
            &plugin,
            "AppCategories",
            serde_json::json!(["plugins/engine"]),
        );
        let gone = f.install("missing", "Uninstalled");
        fs::remove_file(f.root.join("Games on another disk/missing/bin/Game.exe")).unwrap();
        assert!(gone.exists());
        fs::write(f.manifests.join("bad.item"), b"not JSON").unwrap();
        let mut progress = vec![];
        let report = scan(&conn, &f.manifests, &f.client, |p| progress.push(p)).unwrap();
        assert_eq!(report.preview.games.len(), 2);
        assert_eq!(report.ignored_count, 7);
        assert_eq!(report.warnings.len(), 1);
        assert_eq!(report.preview.games[0].title, "Zelda");
        assert!(
            report
                .preview
                .games
                .iter()
                .all(|g| g.epic.is_some() && g.steam.is_none())
        );
        assert_eq!(
            progress.last().unwrap().processed,
            progress.last().unwrap().total.unwrap()
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert!(scan(&conn, &f.root.join("Missing"), &f.client, |_| {}).is_err());
    }

    #[test]
    fn optional_flags_and_launchable_addons_are_supported_but_traversal_and_invalid_uris_are_rejected()
     {
        let f = Fixture::new();
        let path = f.install("game", "Title");
        let mut data: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        data.as_object_mut().unwrap().remove("bIsApplication");
        data.as_object_mut().unwrap().remove("bIsIncompleteInstall");
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        assert!(read_manifest(&path).unwrap().is_some());
        edit(
            &path,
            "AppCategories",
            serde_json::json!(["addons", "addons/launchable"]),
        );
        edit(&path, "MainGameAppName", "base".into());
        assert!(read_manifest(&path).unwrap().is_some());
        edit(&path, "LaunchExecutable", "../EpicGamesLauncher.exe".into());
        assert!(read_manifest(&path).is_err());
        for path in [
            "com.epicgames.launcher://apps/a%3Ab%3Ac?action=launch&silent=true&evil=1",
            "com.epicgames.launcher://apps/a%3Ab%3A../bad?action=launch&silent=true",
            "com.epicgames.launcher://apps/a%3Ab%3Ac%3Ad?action=launch&silent=true",
            "com.epicgames.launcher://apps/a%3Ab%3Ac;calc.exe?action=launch&silent=true",
        ] {
            assert!(app_id(path).is_none());
        }
    }

    #[test]
    fn imports_survive_restart_and_manifest_replacement_launch_through_epic_and_never_run_manifest_arguments()
     {
        let f = Fixture::new();
        let original = f.install("game-id", "Epic title");
        {
            let mut conn = f.database();
            let mut preview = f.preview(&conn);
            preview.games[0].title = "Reviewed title".into();
            assert_eq!(
                crate::import_roms(&mut conn, preview, "PC", |_| {})
                    .unwrap()
                    .added_count,
                1
            );
        }
        let conn = f.database();
        let preview = f.preview(&conn);
        assert!(preview.games.is_empty());
        assert_eq!(preview.skipped_count, 1);
        // Epic can change manifest filenames or installation directories after a move.
        let moved = f.root.join("Moved game");
        fs::create_dir_all(moved.join("bin")).unwrap();
        fs::write(moved.join("bin/Game.exe"), b"game").unwrap();
        edit(
            &original,
            "InstallLocation",
            serde_json::to_value(&moved).unwrap(),
        );
        fs::rename(original, f.manifests.join("new-name.item")).unwrap();
        let stored: String = conn
            .query_row("SELECT rom_path FROM games", [], |row| row.get(0))
            .unwrap();
        assert_eq!(app_id(&stored).as_deref(), Some("game-id"));
        assert_eq!(
            launch_plan(&conn, 1, &stored).unwrap().install_directory,
            moved
        );
        let (result, ()) = crate::launch_game_record(&conn, 1, |exe, args, cwd| {
            assert_eq!(Path::new(exe), f.client);
            assert_eq!(args, &[stored.clone()]);
            assert_eq!(cwd, Some(f.root.as_path()));
            Ok(())
        })
        .unwrap();
        assert_eq!(result.stats.session_count, 1);
        assert!(result.stats.last_played.is_some());
        assert_eq!(
            conn.query_row("SELECT title FROM games", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "Reviewed title"
        );
        fs::remove_file(moved.join("bin/Game.exe")).unwrap();
        assert!(crate::launch_game_record(&conn, 1, |_, _, _| Ok(())).is_err());
        assert_eq!(
            conn.query_row("SELECT session_count FROM games", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn invalid_sources_uninstalls_and_sql_errors_roll_back_the_whole_import_without_touching_epic_files()
     {
        let f = Fixture::new();
        let mut conn = f.database();
        f.install("a", "A");
        let second = f.install("b", "B");
        let preview = f.preview(&conn);
        let mut forged = preview.games[0].clone();
        forged.epic.as_mut().unwrap().app_id = "other".into();
        assert!(validate(&forged).is_err());
        let mut forged = preview.games[0].clone();
        forged.rom_path = preview.games[1].rom_path.clone();
        forged.epic.as_mut().unwrap().app_id = "b".into();
        assert!(validate(&forged).is_err());
        assert!(crate::candidate_launch_mode(&preview.games[0], "PS2").is_err());
        let mut forged = preview.games[0].clone();
        forged.steam = Some(crate::steam::SteamSource {
            app_id: 10,
            client_path: String::new(),
            manifest_path: String::new(),
        });
        assert!(crate::candidate_launch_mode(&forged, "PC").is_err());
        let mut forged = preview.games[0].clone();
        forged.epic.as_mut().unwrap().client_path = second.to_string_lossy().into_owned();
        assert!(validate(&forged).is_err());
        edit(&second, "bIsIncompleteInstall", true.into());
        assert!(crate::import_roms(&mut conn, preview.clone(), "PC", |_| {}).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        edit(&second, "bIsIncompleteInstall", false.into());
        conn.execute_batch("CREATE TRIGGER fail_epic BEFORE INSERT ON games WHEN NEW.title='B' BEGIN SELECT RAISE(ABORT,'simulated'); END;").unwrap();
        assert!(crate::import_roms(&mut conn, preview.clone(), "PC", |_| {}).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER fail_epic").unwrap();
        assert_eq!(
            crate::import_roms(&mut conn, preview.clone(), "PC", |_| {})
                .unwrap()
                .added_count,
            2
        );
        assert_eq!(
            crate::import_roms(&mut conn, preview, "PC", |_| {})
                .unwrap()
                .skipped_count,
            2
        );
        assert_eq!(fs::read(&f.client).unwrap(), b"Fake client, never executed");
    }

    #[test]
    fn tracking_times_game_processes_only_handles_bootstrap_gaps_and_times_out_failed_launches() {
        let root = Path::new("C:/Games/Example");
        assert!(is_game_process(root, &root.join("bin/Game.exe")));
        assert!(!is_game_process(
            root,
            Path::new("C:/Games/Example2/Game.exe")
        ));
        for name in [
            "CrashReportClient.exe",
            "unins000.exe",
            "EasyAntiCheat.exe",
            "EpicGamesLauncher.exe",
        ] {
            assert!(!is_game_process(root, &root.join(name)));
        }
        let mut session = EpicSession::new(root.to_owned());
        let now = session.requested;
        assert!(session.observe(Some(false), now + Duration::from_secs(100)));
        assert_eq!(session.elapsed(), Duration::ZERO);
        assert!(session.observe(Some(true), now + Duration::from_secs(110)));
        assert!(session.observe(Some(false), now + Duration::from_secs(112)));
        assert!(session.observe(Some(true), now + Duration::from_secs(114)));
        assert_eq!(session.elapsed(), Duration::from_secs(4));
        assert!(!session.observe(None, now + Duration::from_secs(120)));
        let mut failed = EpicSession::new(root.to_owned());
        assert!(!failed.observe(Some(false), failed.requested + Duration::from_secs(121)));
        assert_eq!(failed.elapsed(), Duration::ZERO);
    }

    #[cfg(windows)]
    #[test]
    fn windows_process_snapshot_can_observe_this_test_process_without_elevation() {
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        assert_eq!(running(executable.parent().unwrap()), Some(true));
    }
}
