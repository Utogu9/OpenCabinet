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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SteamSource {
    pub app_id: u32,
    pub client_path: String,
    pub manifest_path: String,
}

#[derive(Serialize)]
pub struct SteamScan {
    steam_path: String,
    library_count: usize,
    ignored_count: usize,
    warnings: Vec<String>,
    preview: ScanPreview,
}

#[derive(Debug)]
enum Value {
    Text(String),
    Object(Vec<(String, Value)>),
}
impl Value {
    fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Self::Object(items) => items
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .map(|(_, value)| value),
            _ => None,
        }
    }
    fn text(&self) -> Option<&str> {
        if let Self::Text(text) = self {
            Some(text)
        } else {
            None
        }
    }
    fn field(&self, key: &str) -> Option<&str> {
        self.get(key)?.text()
    }
}

// Valve's text KeyValues files have nested objects, escaped Windows paths and
// comments. Keep object boundaries: a regex can confuse AppState with a depot.
fn parse_vdf(input: &str) -> Result<Value, String> {
    #[derive(Debug)]
    enum Token {
        Text(String),
        Open,
        Close,
    }
    let bytes = input.trim_start_matches('\u{feff}').as_bytes();
    let mut cursor = 0;
    let mut tokens = Vec::new();
    while cursor < bytes.len() {
        if bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
            continue;
        }
        if bytes[cursor..].starts_with(b"//") {
            while cursor < bytes.len() && bytes[cursor] != b'\n' {
                cursor += 1;
            }
            continue;
        }
        match bytes[cursor] {
            b'{' => {
                tokens.push(Token::Open);
                cursor += 1;
            }
            b'}' => {
                tokens.push(Token::Close);
                cursor += 1;
            }
            b'"' => {
                cursor += 1;
                let mut text = Vec::new();
                let mut closed = false;
                while cursor < bytes.len() {
                    let ch = bytes[cursor];
                    cursor += 1;
                    if ch == b'"' {
                        closed = true;
                        break;
                    }
                    if ch == b'\\' && cursor < bytes.len() && [b'\\', b'"'].contains(&bytes[cursor])
                    {
                        text.push(bytes[cursor]);
                        cursor += 1;
                    } else {
                        text.push(ch);
                    }
                }
                if !closed {
                    return Err("Texto VDF sin cerrar.".into());
                }
                tokens.push(Token::Text(
                    String::from_utf8(text).map_err(|e| e.to_string())?,
                ));
            }
            _ => {
                let start = cursor;
                while cursor < bytes.len()
                    && !bytes[cursor].is_ascii_whitespace()
                    && ![b'{', b'}'].contains(&bytes[cursor])
                {
                    cursor += 1;
                }
                tokens.push(Token::Text(
                    String::from_utf8(bytes[start..cursor].to_vec()).map_err(|e| e.to_string())?,
                ));
            }
        }
        if tokens.len() > 200_000 {
            return Err("El archivo VDF es demasiado grande.".into());
        }
    }
    fn object(tokens: &[Token], cursor: &mut usize, depth: usize) -> Result<Value, String> {
        if depth > 32 {
            return Err("Demasiados niveles en el archivo VDF.".into());
        }
        let mut items = Vec::new();
        while *cursor < tokens.len() {
            if matches!(tokens[*cursor], Token::Close) {
                if depth == 0 {
                    return Err("Llave VDF inesperada.".into());
                }
                *cursor += 1;
                return Ok(Value::Object(items));
            }
            let Some(Token::Text(key)) = tokens.get(*cursor) else {
                return Err("Clave VDF inválida.".into());
            };
            let key = key.clone();
            *cursor += 1;
            let value = match tokens.get(*cursor) {
                Some(Token::Text(value)) => {
                    *cursor += 1;
                    Value::Text(value.clone())
                }
                Some(Token::Open) => {
                    *cursor += 1;
                    object(tokens, cursor, depth + 1)?
                }
                _ => return Err("Valor VDF inválido.".into()),
            };
            items.push((key, value));
        }
        if depth != 0 {
            return Err("Objeto VDF sin cerrar.".into());
        }
        Ok(Value::Object(items))
    }
    object(&tokens, &mut 0, 0)
}

fn read_vdf(path: &Path) -> Result<Value, String> {
    const LIMIT: u64 = 4 * 1024 * 1024;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("El archivo de Steam supera el tamaño permitido.".into());
    }
    parse_vdf(std::str::from_utf8(&bytes).map_err(|e| e.to_string())?)
}

pub fn uri(app_id: u32) -> String {
    format!("steam://run/{app_id}")
}
pub fn app_id(path: &str) -> Option<u32> {
    let digits = path.strip_prefix("steam://run/")?;
    let id = digits.parse::<u32>().ok().filter(|id| *id > 0)?;
    (digits == id.to_string()).then_some(id)
}

fn valid_root(root: &Path) -> bool {
    root.is_absolute() && root.join("steam.exe").is_file() && root.join("steamapps").is_dir()
}
fn normalize(path: &Path) -> String {
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

fn default_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        use winreg::{RegKey, enums::*};
        for (hive, key) in [
            (HKEY_CURRENT_USER, "Software\\Valve\\Steam"),
            (HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam"),
            (HKEY_LOCAL_MACHINE, "SOFTWARE\\Valve\\Steam"),
        ] {
            if let Ok(key) = RegKey::predef(hive).open_subkey(key) {
                for field in ["SteamPath", "InstallPath"] {
                    if let Ok(value) = key.get_value::<String, _>(field) {
                        roots.push(PathBuf::from(value));
                    }
                }
            }
        }
    }
    for name in ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"] {
        if let Some(path) = std::env::var_os(name) {
            roots.push(PathBuf::from(path).join("Steam"));
        }
    }
    roots
}

fn libraries(root: &Path, warnings: &mut Vec<String>) -> Vec<PathBuf> {
    let mut paths = vec![root.to_path_buf()];
    for file in [
        root.join("steamapps/libraryfolders.vdf"),
        root.join("config/libraryfolders.vdf"),
    ] {
        if !file.is_file() {
            continue;
        }
        match read_vdf(&file) {
            Ok(data) => {
                if let Some(Value::Object(entries)) = data.get("libraryfolders") {
                    for (index, value) in entries {
                        if index.parse::<u32>().is_err() {
                            continue;
                        }
                        if let Some(path) = value.text().or_else(|| value.field("path")) {
                            let path = PathBuf::from(path);
                            if path.is_absolute() {
                                paths.push(path);
                            }
                        }
                    }
                }
            }
            Err(error) => warnings.push(crate::i18n::i18n_format!("msg.82cc3c1529", file.display(), error = error)),
        }
    }
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(normalize(path)));
    paths
}

fn manifest(path: &Path) -> Result<Option<(u32, String, PathBuf)>, String> {
    let data = read_vdf(path)?;
    let state = data
        .get("AppState")
        .ok_or(crate::i18n::text("msg.da37e5e64e"))?;
    let id = state
        .field("appid")
        .and_then(|id| id.parse::<u32>().ok())
        .filter(|id| *id > 0)
        .ok_or(crate::i18n::text("msg.f3de02dbcc"))?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !filename.eq_ignore_ascii_case(&format!("appmanifest_{id}.acf")) {
        return Err(crate::i18n::text("msg.abd156f102").into());
    }
    let flags = state
        .field("StateFlags")
        .and_then(|flags| flags.parse::<u32>().ok())
        .ok_or(crate::i18n::text("msg.25d9fc72b0"))?;
    if flags & 4 == 0 || flags & 1 != 0 {
        return Ok(None);
    }
    let name = state
        .field("name")
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or(crate::i18n::text("msg.53550d2c3b"))?
        .to_owned();
    let folder = state
        .field("installdir")
        .ok_or(crate::i18n::text("msg.ab72fa0641"))?;
    let folder = Path::new(folder);
    if folder.as_os_str().is_empty()
        || folder
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(crate::i18n::text("msg.7a269a1097").into());
    }
    let installed = path
        .parent()
        .ok_or(crate::i18n::text("msg.80e3545918"))?
        .join("common")
        .join(folder);
    if !installed.is_dir() {
        return Ok(None);
    }
    let lower = name.to_lowercase();
    if id == 228980
        || lower.starts_with("steam linux runtime")
        || lower.starts_with("proton ")
        || lower == "steamworks common redistributables"
    {
        return Ok(None);
    }
    Ok(Some((id, name, installed)))
}

pub fn validate(candidate: &RomCandidate) -> Result<(), String> {
    let source = candidate.steam.as_ref().ok_or("Falta el origen Steam.")?;
    if app_id(&candidate.rom_path) != Some(source.app_id) {
        return Err(crate::i18n::text("msg.0ba8e97d83").into());
    }
    let client = Path::new(&source.client_path);
    if !client
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("steam.exe"))
        || !client.is_file()
        || !client.is_absolute()
    {
        return Err(crate::i18n::text("msg.d42576482f").into());
    }
    let path = Path::new(&source.manifest_path);
    if !path.is_absolute() || manifest(path)?.is_none_or(|(id, _, _)| id != source.app_id) {
        return Err(
            crate::i18n::text("msg.c6b32b171a").into(),
        );
    }
    Ok(())
}

pub fn launch_mode(candidate: &RomCandidate, platform: &str) -> Result<bool, String> {
    if candidate.steam.is_some() {
        validate(candidate)?;
        Ok(true)
    } else {
        super::manual_import::import_launch_mode(platform, &candidate.rom_path)
    }
}

fn scan(
    conn: &Connection,
    root: &Path,
    mut progress: impl FnMut(ScanProgress),
) -> Result<SteamScan, String> {
    if !valid_root(root) {
        return Err(crate::i18n::text("msg.3efc8e1f51").into());
    }
    let mut warnings = Vec::new();
    let libraries = libraries(root, &mut warnings);
    let library_count = libraries.len();
    let mut files = Vec::new();
    for library in libraries {
        match fs::read_dir(library.join("steamapps")) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => {
                            let path = entry.path();
                            let name = entry.file_name().to_string_lossy().to_lowercase();
                            if path.is_file()
                                && name.starts_with("appmanifest_")
                                && name.ends_with(".acf")
                            {
                                files.push(path);
                            }
                        }
                        Err(error) => warnings.push(error.to_string()),
                    }
                }
            }
            Err(error) => warnings.push(crate::i18n::i18n_format!(
                "msg.96860dd2bb",
                library.display()
            , error = error)),
        }
    }
    files.sort();
    let total = files.len();
    progress(ScanProgress {
        phase: "discovering",
        processed: 0,
        total: Some(total),
        added_count: 0,
        skipped_count: 0,
        current_file: None,
    });
    let mut last_update = Instant::now();
    let mut games = Vec::new();
    let mut ids = HashSet::new();
    let mut skipped = 0;
    let mut ignored = 0;
    for (index, path) in files.into_iter().enumerate() {
        match manifest(&path) {
            Ok(Some((id, title, _))) if ids.insert(id) => {
                let rom_path = uri(id);
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
                    games.push(RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None,
                        epic: None,
                        title,
                        rom_path,
                        steam: Some(SteamSource {
                            app_id: id,
                            client_path: root.join("steam.exe").to_string_lossy().into_owned(),
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
    Ok(SteamScan {
        steam_path: root.to_string_lossy().into_owned(),
        library_count,
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
pub async fn select_steam_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title(crate::i18n::text("msg.e308ec7fe0"))
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn scan_steam_games(
    steam_path: Option<String>,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<SteamScan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = if let Some(path) = steam_path.filter(|path| !path.trim().is_empty()) {
            PathBuf::from(path)
        } else {
            default_roots()
                .into_iter()
                .find(|path| valid_root(path))
                .ok_or(crate::i18n::text("msg.dbe3a04971"))?
        };
        let conn = super::get_db_connection().map_err(|e| e.to_string())?;
        scan(&conn, &root, |progress| {
            let _ = on_progress.send(progress);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn launch_plan(
    conn: &Connection,
    game_id: i32,
    id: u32,
) -> Result<(PathBuf, Vec<String>), String> {
    let saved: Option<String> = conn
        .query_row(
            "SELECT steam_client_path FROM games WHERE id=?1",
            [game_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut roots = Vec::new();
    if let Some(saved) = saved {
        if let Some(parent) = Path::new(&saved).parent() {
            roots.push(parent.to_path_buf());
        }
    }
    roots.extend(default_roots());
    let mut seen = HashSet::new();
    for root in roots.into_iter().filter(|root| valid_root(root)) {
        if !seen.insert(normalize(&root)) {
            continue;
        }
        for library in libraries(&root, &mut vec![]) {
            if manifest(&library.join(format!("steamapps/appmanifest_{id}.acf")))
                .ok()
                .flatten()
                .is_some_and(|(installed_id, _, _)| installed_id == id)
            {
                return Ok((
                    root.join("steam.exe"),
                    vec!["-applaunch".into(), id.to_string()],
                ));
            }
        }
    }
    Err(crate::i18n::text("msg.e18a9e340f").into())
}

pub fn installed_directory(conn: &Connection, game_id: i32, id: u32) -> Result<PathBuf, String> {
    let (client, _) = launch_plan(conn, game_id, id)?;
    let root = client.parent().ok_or(crate::i18n::text("msg.68bc559556"))?;
    for library in libraries(root, &mut vec![]) {
        if let Some((installed_id, _, directory)) = manifest(&library.join(format!("steamapps/appmanifest_{id}.acf"))).ok().flatten() {
            if installed_id == id { return Ok(directory); }
        }
    }
    Err(crate::i18n::text("msg.27c6ce8e11").into())
}

#[cfg(windows)]
fn running(id: u32) -> Option<bool> {
    use winreg::{RegKey, enums::*};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!("Software\\Valve\\Steam\\Apps\\{id}"))
        .ok()?
        .get_value::<u32, _>("Running")
        .ok()
        .map(|value| value != 0)
}
#[cfg(not(windows))]
fn running(_: u32) -> Option<bool> {
    None
}

// Steam's command process can exit immediately or stay open with the client.
// Track the individual app's Running state instead; startup time is not playtime.
pub struct SteamSession {
    id: u32,
    requested: Instant,
    began: Option<Instant>,
    last_seen: Option<Instant>,
}
impl SteamSession {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            requested: Instant::now(),
            began: None,
            last_seen: None,
        }
    }
    pub fn poll(&mut self) -> bool {
        self.observe(running(self.id), Instant::now())
    }
    fn observe(&mut self, state: Option<bool>, now: Instant) -> bool {
        if state == Some(true) {
            self.began.get_or_insert(now);
            self.last_seen = Some(now);
            return true;
        }
        if let Some(last) = self.last_seen {
            return state.is_none() && now.duration_since(last) < Duration::from_secs(5);
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
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    pub struct Fixture {
        pub root: PathBuf,
        pub client: PathBuf,
        pub second: PathBuf,
    }
    impl Fixture {
        pub fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "opencabinet-steam-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let client = root.join("Steam");
            let second = root.join("Other library");
            for path in [&client, &second] {
                fs::create_dir_all(path.join("steamapps/common")).unwrap();
            }
            fs::write(
                client.join("steam.exe"),
                b"fake Steam client - never executed",
            )
            .unwrap();
            fs::write(client.join("steamapps/libraryfolders.vdf"),format!(r#""libraryfolders" {{ "0" {{ "path" {} }} "1" {{ "path" {} "apps" {{ "20" "1234" }} }} }}"#,quoted(&client),quoted(&second))).unwrap();
            Self {
                root,
                client,
                second,
            }
        }
        pub fn install(
            &self,
            library: &Path,
            id: u32,
            name: &str,
            flags: u32,
            present: bool,
        ) -> PathBuf {
            let folder = format!("Game {id}");
            if present {
                fs::create_dir_all(library.join("steamapps/common").join(&folder)).unwrap();
            }
            let path = library.join(format!("steamapps/appmanifest_{id}.acf"));
            fs::write(&path,format!(r#"// local fixture
                "AppState" {{ "appid" "{id}" "name" {} "StateFlags" "{flags}" "installdir" "{folder}" "InstalledDepots" {{ "1" {{ "name" "Do not use this name" }} }} }}"#,serde_json::to_string(name).unwrap())).unwrap();
            path
        }
        pub fn database(&self) -> Connection {
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
    fn quoted(path: &Path) -> String {
        serde_json::to_string(path.to_str().unwrap()).unwrap()
    }

    #[test]
    fn keyvalues_parse_nested_objects_comments_unicode_escaped_paths_and_reject_broken_files() {
        let data=parse_vdf("\u{feff}// comment\n\"root\"{\"path\"\"C:\\\\Steam\\\\Games\"\"title\"\"Juégo \\\"Edition\\\"\"\"child\"{\"path\"\"other\"}}").unwrap();
        assert_eq!(
            data.get("ROOT").unwrap().field("path"),
            Some("C:\\Steam\\Games")
        );
        assert_eq!(
            data.get("root").unwrap().field("title"),
            Some("Juégo \"Edition\"")
        );
        for input in ["\"root\"{\"key\"", "\"unterminated", "}", "{bad}"] {
            assert!(parse_vdf(input).is_err());
        }
        let nested = format!("{}{}", "x {".repeat(40), "}".repeat(40));
        assert!(parse_vdf(&nested).is_err());
    }

    #[test]
    fn scans_all_libraries_only_installed_manifests_without_recursing_and_reports_corruption() {
        let fixture = Fixture::new();
        let conn = fixture.database();
        fixture.install(&fixture.client, 10, "Zelda local", 4, true);
        fixture.install(&fixture.second, 20, "Alpha & friends", 6, true);
        fixture.install(&fixture.second, 10, "Duplicate", 4, true);
        fixture.install(&fixture.client, 30, "Downloading", 1026, true);
        fixture.install(&fixture.client, 40, "Removed", 4, false);
        fixture.install(
            &fixture.client,
            228980,
            "Steamworks Common Redistributables",
            4,
            true,
        );
        fs::write(
            fixture.client.join("steamapps/appmanifest_broken.acf"),
            "invalid {",
        )
        .unwrap();
        let nested = fixture
            .client
            .join("steamapps/common/Nested/steamapps/common");
        fs::create_dir_all(&nested).unwrap();
        fixture.install(
            nested.parent().unwrap().parent().unwrap(),
            99,
            "Not a library",
            4,
            false,
        );
        let mut progress = vec![];
        let report = scan(&conn, &fixture.client, |p| progress.push(p)).unwrap();
        assert_eq!(report.library_count, 2);
        assert_eq!(report.preview.games.len(), 2);
        assert_eq!(report.preview.games[0].title, "Alpha & friends");
        assert_eq!(report.preview.games[0].rom_path, "steam://run/20");
        assert!(report.ignored_count >= 4);
        assert_eq!(report.warnings.len(), 1);
        assert!(
            report
                .preview
                .games
                .iter()
                .all(|candidate| candidate.steam.is_some())
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
    }

    #[test]
    fn legacy_library_lists_missing_disks_and_duplicate_paths_are_handled() {
        let fixture = Fixture::new();
        let conn = fixture.database();
        fs::write(
            fixture.client.join("steamapps/libraryfolders.vdf"),
            format!(
                r#""LibraryFolders" {{ "1" {} "2" {} "3" {} "TimeNextStatsReport" "12345" }}"#,
                quoted(&fixture.second),
                quoted(&fixture.second),
                quoted(&fixture.root.join("Missing disk"))
            ),
        )
        .unwrap();
        fixture.install(&fixture.second, 20, "Other disk", 4, true);
        let report = scan(&conn, &fixture.client, |_| {}).unwrap();
        assert_eq!(report.library_count, 3);
        assert_eq!(report.preview.games.len(), 1);
        assert_eq!(report.warnings.len(), 1);
        assert!(scan(&conn, &fixture.second, |_| {}).is_err());
    }

    #[test]
    fn imports_keep_titles_deduplicate_appids_survive_restart_and_library_moves_and_launch_via_steam()
     {
        let fixture = Fixture::new();
        let original = fixture.install(&fixture.client, 10, "Original title", 4, true);
        {
            let mut conn = fixture.database();
            let mut preview = scan(&conn, &fixture.client, |_| {}).unwrap().preview;
            preview.games[0].title = "Reviewed title".into();
            let result = crate::import_roms(&mut conn, preview, "PC", |_| {}).unwrap();
            assert_eq!(result.added_count, 1);
        }
        let conn = fixture.database();
        let preview = scan(&conn, &fixture.client, |_| {}).unwrap().preview;
        assert!(preview.games.is_empty());
        assert_eq!(preview.skipped_count, 1);
        fixture.install(&fixture.second, 10, "Moved game", 4, true);
        fs::remove_file(original).unwrap();
        conn.execute("UPDATE games SET platform='Renamed PC'", [])
            .unwrap();
        let (result, ()) =
            crate::launch_game_record(&conn, 1, |executable, args, working_directory| {
                assert_eq!(Path::new(executable), fixture.client.join("steam.exe"));
                assert_eq!(args, &["-applaunch", "10"]);
                assert_eq!(working_directory, Some(fixture.client.as_path()));
                Ok(())
            })
            .unwrap();
        assert_eq!(result.stats.session_count, 1);
        assert!(result.stats.last_played.is_some());
        assert_eq!(installed_directory(&conn, 1, 10).unwrap(), fixture.second.join("steamapps/common/Game 10"));
        assert_eq!(
            conn.query_row("SELECT title FROM games", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "Reviewed title"
        );
        fs::remove_file(fixture.second.join("steamapps/appmanifest_10.acf")).unwrap();
        assert!(crate::launch_game_record(&conn, 1, |_, _, _| Ok(())).is_err());
        assert_eq!(
            conn.query_row("SELECT session_count FROM games", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn invalid_sources_and_uninstalls_during_review_roll_back_the_entire_import() {
        let fixture = Fixture::new();
        let mut conn = fixture.database();
        fixture.install(&fixture.client, 10, "A", 4, true);
        fixture.install(&fixture.second, 20, "B", 4, true);
        let preview = scan(&conn, &fixture.client, |_| {}).unwrap().preview;
        let mut forged = preview.games[0].clone();
        forged.rom_path = uri(999);
        assert!(validate(&forged).is_err());
        let mut forged = preview.games[0].clone();
        forged.steam.as_mut().unwrap().client_path = fixture
            .client
            .join("not-steam.exe")
            .to_string_lossy()
            .into_owned();
        assert!(validate(&forged).is_err());
        for path in [
            "steam://run/0",
            "steam://run/0010",
            "steam://run/10/",
            "steam://run/10?args=x",
            "steam://run/10;calc.exe",
        ] {
            assert!(app_id(path).is_none());
        }
        fs::remove_dir(fixture.second.join("steamapps/common/Game 20")).unwrap();
        assert!(crate::import_roms(&mut conn, preview, "PC", |_| {}).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn steam_tracking_excludes_client_lifetime_and_startup_and_times_out_without_inventing_playtime()
     {
        let mut session = SteamSession::new(10);
        let start = session.requested;
        assert!(session.observe(Some(false), start + Duration::from_secs(20)));
        assert_eq!(session.elapsed(), Duration::ZERO);
        assert!(session.observe(Some(true), start + Duration::from_secs(30)));
        assert!(session.observe(Some(true), start + Duration::from_secs(45)));
        assert!(!session.observe(Some(false), start + Duration::from_secs(46)));
        assert_eq!(session.elapsed(), Duration::from_secs(15));
        let mut missing = SteamSession::new(20);
        assert!(!missing.observe(None, missing.requested + Duration::from_secs(121)));
        assert_eq!(missing.elapsed(), Duration::ZERO);
    }
}
