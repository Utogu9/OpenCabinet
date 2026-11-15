//! Read-only Web API integration. Emulators remain responsible for unlocking achievements.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    sync::LazyLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use unicode_normalization::UnicodeNormalization;

type Result<T> = std::result::Result<T, String>;
const DAY: u64 = 86400;
static REQUEST: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
fn error(key: &str) -> String {
    crate::i18n::text(key).into()
}
fn db_error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn fingerprint(value: &str) -> String {
    let mut hash = DefaultHasher::new();
    value.hash(&mut hash);
    format!("{:016x}", hash.finish())
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ra_links(game_id INTEGER PRIMARY KEY,remote_id INTEGER NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_ra_link AFTER DELETE ON games BEGIN DELETE FROM ra_links WHERE game_id=OLD.id; END;
        CREATE TABLE IF NOT EXISTS ra_cache(cache_key TEXT PRIMARY KEY,fetched INTEGER NOT NULL,data TEXT NOT NULL);")
}
#[derive(Clone, Serialize, Deserialize)]
struct Credentials {
    username: String,
    ulid: String,
    api_key: String,
}
#[derive(Serialize)]
pub struct Account {
    connected: bool,
    username: String,
}
struct Context {
    root: PathBuf,
    owner: String,
    credentials: Option<Credentials>,
}
impl Context {
    fn current() -> Result<Self> {
        let conn = crate::get_db_connection().map_err(db_error)?;
        let root = crate::data_directory().map_err(db_error)?;
        let owner = crate::user_profiles::key(&conn);
        let credentials = read_credentials(&credential_path(&root, &owner)).unwrap_or(None);
        Ok(Self {
            root,
            owner,
            credentials,
        })
    }
    fn check(&self) -> Result<Connection> {
        let conn = crate::get_db_connection().map_err(db_error)?;
        if crate::user_profiles::key(&conn) != self.owner
            || crate::data_directory().map_err(db_error)? != self.root
        {
            return Err(error("ra.profileChanged"));
        }
        Ok(conn)
    }
    fn credentials(&self) -> Result<&Credentials> {
        self.credentials
            .as_ref()
            .ok_or_else(|| error("ra.notConnected"))
    }
    fn account(&self) -> Account {
        Account {
            connected: self.credentials.is_some(),
            username: self
                .credentials
                .as_ref()
                .map(|v| v.username.clone())
                .unwrap_or_default(),
        }
    }
}
fn credential_path(root: &Path, owner: &str) -> PathBuf {
    root.join("credentials")
        .join(format!("retroachievements-{}.dat", fingerprint(owner)))
}
// DPAPI binds the credential to the Windows user. Unix files are restricted to the owner.
// These files are deliberately outside the backup configuration allowlist and diagnostic exports.
#[cfg(windows)]
fn protect(bytes: &[u8], encrypt: bool) -> Result<Vec<u8>> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(error("ra.credentialsError"));
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Ok(result)
    }
}
#[cfg(not(windows))]
fn protect(bytes: &[u8], _encrypt: bool) -> Result<Vec<u8>> {
    Ok(bytes.to_vec())
}
fn read_credentials(path: &Path) -> Result<Option<Credentials>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&protect(&bytes, false)?)
            .map(Some)
            .map_err(|_| error("ra.credentialsError")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(error("ra.credentialsError")),
    }
}
fn write_credentials(path: &Path, value: &Credentials) -> Result<()> {
    let directory = path.parent().unwrap();
    fs::create_dir_all(directory).map_err(|_| error("ra.credentialsError"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| error("ra.credentialsError"))?;
    }
    let temp = path.with_extension("tmp");
    let bytes = protect(
        &serde_json::to_vec(value).map_err(|_| error("ra.credentialsError"))?,
        true,
    )?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows_sys::Win32::Storage::FileSystem::{
                MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
            };
            let from: Vec<_> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
            let to: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            if unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        #[cfg(not(windows))]
        fs::rename(&temp, path)?;
        Ok::<_, std::io::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|_| error("ra.credentialsError"))
}
async fn api(
    credentials: &Credentials,
    endpoint: &str,
    parameters: &[(&str, String)],
) -> Result<Value> {
    let _guard = REQUEST.lock().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!(
            "OpenCabinet/{} ({})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS
        ))
        .build()
        .map_err(|_| error("ra.network"))?;
    // Never propagate reqwest errors: their URL includes the secret query parameter.
    let response = client
        .get(format!("https://retroachievements.org/API/{endpoint}.php"))
        .query(&[("y", &credentials.api_key)])
        .query(parameters)
        .send()
        .await
        .map_err(|_| error("ra.network"))?;
    match response.status().as_u16() {
        401 | 403 => return Err(error("ra.auth")),
        429 => return Err(error("ra.rateLimit")),
        200 => {}
        _ => return Err(error("ra.network")),
    }
    if response
        .content_length()
        .is_some_and(|n| n > 32 * 1024 * 1024)
    {
        return Err(error("ra.response"));
    }
    let bytes = response.bytes().await.map_err(|_| error("ra.network"))?;
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| error("ra.response"))?;
    if data
        .get("Error")
        .is_some_and(|v| !v.is_null() && v.as_str() != Some(""))
        || data.get("Success") == Some(&Value::Bool(false))
    {
        return Err(error("ra.auth"));
    }
    Ok(data)
}
fn cached<T: serde::de::DeserializeOwned>(conn: &Connection, key: &str) -> Option<(u64, T)> {
    let (when, data): (i64, String) = conn
        .query_row(
            "SELECT fetched,data FROM ra_cache WHERE cache_key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok()?;
    Some((when.try_into().ok()?, serde_json::from_str(&data).ok()?))
}
fn store(conn: &Connection, key: &str, value: &impl Serialize) -> Result<()> {
    conn.execute("INSERT INTO ra_cache VALUES(?1,?2,?3) ON CONFLICT(cache_key) DO UPDATE SET fetched=excluded.fetched,data=excluded.data",params![key,now() as i64,serde_json::to_string(value).map_err(db_error)?]).map_err(db_error)?;
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Match {
    pub id: u32,
    pub title: String,
    pub count: u32,
}
fn number(value: &Value) -> u32 {
    value
        .as_u64()
        .and_then(|n| n.try_into().ok())
        .or_else(|| value.as_str()?.parse().ok())
        .unwrap_or(0)
}
fn parse_games(data: &Value) -> Result<Vec<Match>> {
    let rows = data.as_array().ok_or_else(|| error("ra.response"))?;
    rows.iter()
        .map(|v| {
            let id = number(&v["ID"]);
            let title = v["Title"]
                .as_str()
                .filter(|v| !v.is_empty())
                .ok_or_else(|| error("ra.response"))?;
            if id == 0 {
                return Err(error("ra.response"));
            }
            Ok(Match {
                id,
                title: title.into(),
                count: number(&v["NumAchievements"]),
            })
        })
        .collect()
}
fn normalized(value: &str) -> String {
    value
        .nfkd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}
fn title_key(value: &str) -> String {
    let title = crate::clean_rom_title(value);
    let title = title
        .strip_suffix(", The")
        .map(|s| format!("The {s}"))
        .unwrap_or(title);
    normalized(&title)
}
fn exact_match<'a>(games: &'a [Match], title: &str) -> Option<&'a Match> {
    let key = title_key(title);
    if key.is_empty() {
        return None;
    }
    // Special sets/hacks must not be mistaken for the main release.
    let mut candidates = games
        .iter()
        .filter(|g| !g.title.starts_with('~') && title_key(&g.title) == key);
    let first = candidates.next()?;
    if candidates.next().is_some() {
        None
    } else {
        Some(first)
    }
}
fn system_id(platform: &str) -> Option<u32> {
    let systems = [
        (1, "Sega Genesis"),
        (2, "Nintendo 64"),
        (3, "Nintendo SNES"),
        (4, "Nintendo Game Boy"),
        (5, "Nintendo Game Boy Advance"),
        (6, "Nintendo Game Boy Color"),
        (7, "Nintendo NES"),
        (8, "NEC PC Engine / TurboGrafx-16"),
        (9, "Sega CD"),
        (10, "Sega 32X"),
        (11, "Sega Master System"),
        (12, "Sony PlayStation"),
        (13, "Atari Lynx"),
        (14, "SNK Neo Geo Pocket"),
        (14, "SNK Neo Geo Pocket Color"),
        (15, "Sega Game Gear"),
        (16, "Nintendo GameCube"),
        (17, "Atari Jaguar"),
        (18, "Nintendo DS"),
        (21, "Sony PlayStation 2"),
        (23, "Magnavox Odyssey 2"),
        (24, "Nintendo Pokemon Mini"),
        (25, "Atari 2600"),
        (26, "MS-DOS"),
        (27, "Arcade"),
        (28, "Nintendo Virtual Boy"),
        (29, "Microsoft MSX"),
        (30, "Commodore 64"),
        (33, "Sega SG-1000"),
        (35, "Commodore Amiga"),
        (36, "Atari ST"),
        (37, "Amstrad CPC"),
        (38, "Apple II"),
        (39, "Sega Saturn"),
        (40, "Sega Dreamcast"),
        (41, "Sony PSP"),
        (43, "3DO Interactive Multiplayer"),
        (44, "Coleco ColecoVision"),
        (45, "Mattel Intellivision"),
        (46, "GCE Vectrex"),
        (49, "NEC PC-FX"),
        (50, "Atari 5200"),
        (51, "Atari 7800"),
        (53, "Bandai WonderSwan"),
        (53, "Bandai WonderSwan Color"),
        (56, "SNK Neo Geo CD"),
        (59, "Sinclair ZX Spectrum"),
        (61, "Nokia N-Gage"),
        (76, "NEC PC Engine CD"),
        (78, "Nintendo DSi"),
        (81, "Nintendo Famicom Disk System"),
    ];
    systems
        .iter()
        .find(|(_, name)| crate::platform_defaults::equivalent(platform, name))
        .map(|(id, _)| *id)
}
async fn games(context: &Context, system: u32) -> Result<Vec<Match>> {
    let key = format!("system:{system}");
    let saved = cached::<Vec<Match>>(&context.check()?, &key);
    if let Some((when, ref data)) = saved {
        if now().saturating_sub(when) < 7 * DAY {
            return Ok(data.clone());
        }
    }
    match api(
        context.credentials()?,
        "API_GetGameList",
        &[("i", system.to_string()), ("f", "1".into())],
    )
    .await
    .and_then(|v| parse_games(&v))
    {
        Ok(data) => {
            store(&context.check()?, &key, &data)?;
            Ok(data)
        }
        Err(e) => saved.map(|(_, data)| data).ok_or(e),
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Achievement {
    id: u32,
    title: String,
    description: String,
    points: u32,
    badge: String,
    earned: bool,
    hardcore: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Progress {
    id: u32,
    title: String,
    achievements: Vec<Achievement>,
}
fn parse_progress(data: &Value, expected: u32) -> Result<Progress> {
    if number(&data["ID"]) != expected {
        return Err(error("ra.response"));
    }
    let mut rows: Vec<&Value> = match &data["Achievements"] {
        Value::Object(v) => v.values().collect(),
        Value::Array(v) => v.iter().collect(),
        _ => return Err(error("ra.response")),
    };
    rows.sort_by_key(|v| (number(&v["DisplayOrder"]), number(&v["ID"])));
    let achievements = rows
        .into_iter()
        .map(|v| {
            let hardcore = v["DateEarnedHardcore"]
                .as_str()
                .is_some_and(|s| !s.is_empty());
            let earned = hardcore || v["DateEarned"].as_str().is_some_and(|s| !s.is_empty());
            let badge = v["BadgeName"]
                .as_str()
                .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
                .unwrap_or("");
            Achievement {
                id: number(&v["ID"]),
                title: v["Title"].as_str().unwrap_or("").into(),
                description: v["Description"].as_str().unwrap_or("").into(),
                points: number(&v["Points"]),
                badge: if badge.is_empty() {
                    String::new()
                } else {
                    format!(
                        "https://media.retroachievements.org/Badge/{badge}{}.png",
                        if earned { "" } else { "_lock" }
                    )
                },
                earned,
                hardcore,
            }
        })
        .collect();
    Ok(Progress {
        id: expected,
        title: data["Title"]
            .as_str()
            .ok_or_else(|| error("ra.response"))?
            .into(),
        achievements,
    })
}
#[derive(Serialize)]
pub struct GameState {
    account: Account,
    edition_id: i32,
    supported: bool,
    linked: bool,
    progress: Option<Progress>,
    fetched: u64,
    stale: bool,
    warning: String,
}
fn game(conn: &Connection, id: i32) -> Result<(String, String)> {
    conn.query_row("SELECT title,platform FROM games WHERE id=?1", [id], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })
    .map_err(db_error)
}
fn progress_key(credentials: &Credentials, id: u32) -> String {
    format!("progress:{}:{id}", fingerprint(&credentials.ulid))
}

#[tauri::command]
pub async fn get_ra_account() -> Result<Account> {
    Ok(Context::current()?.account())
}
#[tauri::command]
pub async fn connect_ra_account(username: String, api_key: String) -> Result<Account> {
    let mut context = Context::current()?;
    let username = username.trim();
    let api_key = api_key.trim();
    if username.is_empty()
        || username.len() > 80
        || api_key.is_empty()
        || api_key.len() > 256
        || api_key.chars().any(char::is_control)
    {
        return Err(error("ra.auth"));
    }
    let mut credentials = Credentials {
        username: username.into(),
        ulid: username.into(),
        api_key: api_key.into(),
    };
    let profile = api(
        &credentials,
        "API_GetUserProfile",
        &[("u", username.into())],
    )
    .await?;
    credentials.username = profile["User"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("ra.auth"))?
        .into();
    credentials.ulid = profile["ULID"]
        .as_str()
        .filter(|s| !s.is_empty())
        .unwrap_or(&credentials.username)
        .into();
    context.check()?;
    write_credentials(
        &credential_path(&context.root, &context.owner),
        &credentials,
    )?;
    context.credentials = Some(credentials);
    Ok(context.account())
}
#[tauri::command]
pub async fn disconnect_ra_account() -> Result<Account> {
    let mut context = Context::current()?;
    match fs::remove_file(credential_path(&context.root, &context.owner)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(error("ra.credentialsError")),
    }
    context.credentials = None;
    Ok(context.account())
}
#[tauri::command]
pub async fn search_ra_games(id: i32, query: String) -> Result<Vec<Match>> {
    let context = Context::current()?;
    let (_, platform) = game(&context.check()?, id)?;
    let system = system_id(&platform).ok_or_else(|| error("ra.unsupported"))?;
    let key = title_key(&query);
    if key.is_empty() {
        return Ok(Vec::new());
    }
    let mut results = games(&context, system).await?;
    context.check()?;
    results.retain(|v| title_key(&v.title).contains(&key));
    results.sort_by_key(|v| (title_key(&v.title) != key, v.title.clone(), v.id));
    results.truncate(100);
    Ok(results)
}
#[tauri::command]
pub async fn set_ra_game(id: i32, remote_id: Option<u32>) -> Result<()> {
    let context = Context::current()?;
    let conn = context.check()?;
    let (_, platform) = game(&conn, id)?;
    if let Some(remote) = remote_id {
        let system = system_id(&platform).ok_or_else(|| error("ra.unsupported"))?;
        if remote > 0
            && !games(&context, system)
                .await?
                .iter()
                .any(|v| v.id == remote)
        {
            return Err(error("ra.invalidGame"));
        }
        context.check()?.execute("INSERT INTO ra_links VALUES(?1,?2) ON CONFLICT(game_id) DO UPDATE SET remote_id=excluded.remote_id",params![id,remote]).map_err(db_error)?;
    } else {
        conn.execute("DELETE FROM ra_links WHERE game_id=?1", [id])
            .map_err(db_error)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn get_ra_game(id: i32, refresh: bool, cached_only: bool) -> Result<GameState> {
    let context = Context::current()?;
    let conn = context.check()?;
    let (title, platform) = game(&conn, id)?;
    let system = system_id(&platform);
    let mut state = GameState {
        account: context.account(),
        edition_id: id,
        supported: system.is_some(),
        linked: false,
        progress: None,
        fetched: 0,
        stale: false,
        warning: String::new(),
    };
    if !state.account.connected || system.is_none() {
        return Ok(state);
    }
    let manual: Option<u32> = conn
        .query_row(
            "SELECT remote_id FROM ra_links WHERE game_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db_error)?;
    state.linked = manual.is_some();
    let remote = match manual {
        Some(0) => return Ok(state),
        Some(id) => id,
        None => {
            let rows = if cached_only {
                cached::<Vec<Match>>(&conn, &format!("system:{}", system.unwrap()))
                    .map(|(_, v)| v)
                    .unwrap_or_default()
            } else {
                games(&context, system.unwrap()).await?
            };
            let Some(found) = exact_match(&rows, &title) else {
                return Ok(state);
            };
            found.id
        }
    };
    let key = progress_key(context.credentials()?, remote);
    let saved = cached::<Progress>(&conn, &key);
    if let Some((when, data)) = saved {
        state.fetched = when;
        state.progress = Some(data);
        state.stale = now().saturating_sub(when) > 300;
    }
    if cached_only {
        return Ok(state);
    }
    // Manual refreshes may bypass the normal five-minute TTL, but not hammer the server.
    if state.progress.is_some()
        && now().saturating_sub(state.fetched) < if refresh { 10 } else { 300 }
    {
        return Ok(state);
    }
    match api(
        context.credentials()?,
        "API_GetGameInfoAndUserProgress",
        &[
            ("g", remote.to_string()),
            ("u", context.credentials()?.ulid.clone()),
        ],
    )
    .await
    .and_then(|v| parse_progress(&v, remote))
    {
        Ok(data) => {
            store(&context.check()?, &key, &data)?;
            state.progress = Some(data);
            state.fetched = now();
            state.stale = false;
        }
        Err(e) if state.progress.is_some() => {
            state.stale = true;
            state.warning = e;
        }
        Err(e) => return Err(e),
    }
    context.check()?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matching_requires_one_main_game_on_the_correct_system() {
        assert_eq!(system_id("Sony PlayStation 2"), Some(21));
        assert_eq!(system_id("Genesis"), Some(1));
        assert_eq!(system_id("Nintendo Switch"), None);
        let list = vec![
            Match {
                id: 1,
                title: "The Game".into(),
                count: 5,
            },
            Match {
                id: 2,
                title: "~Hack~ The Game".into(),
                count: 3,
            },
        ];
        assert_eq!(exact_match(&list, "Game, The (USA)").unwrap().id, 1);
        assert!(exact_match(&list, "Another Game").is_none());
        let mut duplicate = list.clone();
        duplicate.push(list[0].clone());
        assert!(exact_match(&duplicate, "The Game").is_none());
    }
    #[test]
    fn cache_separates_accounts_and_preserves_offline_progress_and_links() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1);",
        )
        .unwrap();
        init(&conn).unwrap();
        let a = Credentials {
            username: "a".into(),
            ulid: "first".into(),
            api_key: "secret".into(),
        };
        let b = Credentials {
            ulid: "second".into(),
            ..a.clone()
        };
        store(&conn, &progress_key(&a, 3), &serde_json::json!({"test":1})).unwrap();
        assert!(cached::<Value>(&conn, &progress_key(&a, 3)).is_some());
        assert!(cached::<Value>(&conn, &progress_key(&b, 3)).is_none());
        conn.execute("INSERT INTO ra_links VALUES(1,3)", [])
            .unwrap();
        conn.execute("DELETE FROM games WHERE id=1", []).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM ra_links", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn progress_counts_hardcore_as_earned_and_sanitizes_badge_paths() {
        let data = serde_json::json!({"ID":3,"Title":"Test","Achievements":{"9":{"ID":9,"Title":"B","BadgeName":"../secret","DisplayOrder":2},"8":{"ID":8,"Title":"A","Points":5,"BadgeName":"00123","DisplayOrder":1,"DateEarnedHardcore":"2026-01-01"}}});
        let result = parse_progress(&data, 3).unwrap();
        assert_eq!(result.achievements[0].id, 8);
        assert!(result.achievements[0].earned && result.achievements[0].hardcore);
        assert!(result.achievements[0].badge.ends_with("/00123.png"));
        assert!(result.achievements[1].badge.is_empty());
        assert!(parse_progress(&data, 4).is_err());
    }
    #[test]
    fn credentials_are_private_replaceable_and_never_serialized_in_account_responses() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target/ra-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        let path = credential_path(&root, "default");
        let mut value = Credentials {
            username: "Test".into(),
            ulid: "stable-id".into(),
            api_key: "private-test-key".into(),
        };
        write_credentials(&path, &value).unwrap();
        assert_eq!(
            read_credentials(&path).unwrap().unwrap().api_key,
            value.api_key
        );
        value.api_key = "replacement-test-key".into();
        write_credentials(&path, &value).unwrap();
        assert_eq!(
            read_credentials(&path).unwrap().unwrap().api_key,
            value.api_key
        );
        #[cfg(windows)]
        assert!(
            !fs::read(&path)
                .unwrap()
                .windows(value.api_key.len())
                .any(|bytes| bytes == value.api_key.as_bytes())
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let public = serde_json::to_string(&Account {
            connected: true,
            username: value.username,
        })
        .unwrap();
        assert!(!public.contains("key"));
        assert_ne!(
            credential_path(&root, "default"),
            credential_path(&root, "another-profile")
        );
        fs::remove_file(&path).unwrap();
        fs::remove_dir(path.parent().unwrap()).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
