use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
mod playtime;
mod metadata;
mod catalog_compat;
mod profile_compat;
mod svg_image;
mod box_brands;
mod storage;
mod platform_details;
mod platform_defaults;
mod retroarch;
mod manual_import;
mod backups;
mod game_availability;
mod library_files;
mod session_history;
mod steam;
mod epic;
mod media_library;
mod manuals;
mod cbz;
mod discs;
mod game_execution;
mod platform_runtime;
mod linux_execution;
mod linux_process;
mod emulator_defaults;
mod folder_games;
mod library_navigation;
mod entity_variables;
mod cover_cache;
mod game_regions;
mod i18n;
mod game_box_settings;
mod game_order;
mod temporary_files;
mod app_updates;
mod themes;
#[cfg(windows)]
mod branding;
#[cfg(windows)]
mod windows_fullscreen;
use playtime::{PlayStatistics, PlayTracker};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Game {
    pub order_group: Option<game_order::Group>,
    pub box_3d: Option<platform_details::BoxSettings>,
    #[serde(default)]
    pub regions: Vec<game_regions::Region>,
    #[serde(default)]
    pub default_region_id: Option<i32>,
    #[serde(default)]
    pub execution: game_execution::ExecutionOptions,
    pub discs: Vec<discs::Disc>,
    pub id: i32,
    pub title: String,
    pub platform: String,
    pub rom_path: String,
    pub cover_path: Option<String>,
    pub play_time: i32,
    pub release_date: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub images: Vec<GameImage>,
    pub genre: Option<String>,
    pub game_mode: Option<String>,
    pub max_players: Option<i32>,
    pub description: Option<String>,
    pub last_played: Option<String>,
    pub play_time_seconds: i64,
    pub session_count: i64,
    pub is_running: bool,
    pub launch_directly: bool,
    #[serde(default)]
    pub recomp: bool,
    pub steam_app_id: Option<u32>,
    pub epic_app_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GameImage {
    path: String,
    kind: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Emulator {
    pub id: Option<i32>,
    pub name: String,
    pub platform: String,
    pub executable_path: String,
    pub arguments: String,
    pub retroarch_core_path: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDetails {
    #[serde(default)]
    rom_path: Option<String>,
    #[serde(default)]
    order_group: Option<game_order::Patch>,
    #[serde(default, deserialize_with="game_box_settings::deserialize_patch")]
    box_3d: Option<Option<platform_details::BoxSettings>>,
    #[serde(default)]
    regions: Option<game_regions::Settings>,
    #[serde(default)]
    variables: Option<entity_variables::Variables>,
    #[serde(default)]
    execution: Option<game_execution::ExecutionOptions>,
    #[serde(default)]
    discs: Option<Vec<discs::Disc>>,
    id: i32,
    title: String,
    platform: String,
    release_date: Option<String>,
    developer: Option<String>,
    publisher: Option<String>,
    #[serde(default)]
    images: Option<Vec<GameImage>>,
    #[serde(default)]
    manuals: Option<Vec<String>>,
    genre: Option<String>,
    game_mode: Option<String>,
    max_players: Option<i32>,
    description: Option<String>,
    #[serde(default, alias = "launch\u{0062}oxId")]
    catalog_id: Option<i64>,
}

#[derive(Serialize)]
pub struct LaunchResult {
    message: String,
    #[serde(flatten)]
    stats: PlayStatistics,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Platform {
    pub id: Option<i32>,
    pub name: String,
    pub default_extensions: String,
}

#[derive(Serialize, Debug)]
pub struct ScanResult {
    pub attached_count: usize,
    pub added_count: usize,
    pub skipped_count: usize,
    pub total_found: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enrichment: Option<metadata::ImportSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RomCandidate {
    #[serde(default)]
    recomp: bool,
    #[serde(default)]
    launch_directly: bool,
    #[serde(default)]
    discs: Vec<discs::Disc>,
    #[serde(default)]
    existing_game_id: Option<i32>,
    title: String,
    rom_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    steam: Option<steam::SteamSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    epic: Option<epic::EpicSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    linux_execution: Option<linux_execution::Options>,
}

fn candidate_launch_mode(candidate: &RomCandidate, platform: &str) -> Result<bool, String> {
    let direct = if candidate.launch_directly {
        if candidate.steam.is_some() || candidate.epic.is_some() || candidate.existing_game_id.is_some() {
            return Err(crate::i18n::text("msg.035e4bce3e").into());
        }
        manual_import::validate_pc_executable(&candidate.rom_path)?;
        true
    } else if candidate.epic.is_some() {
        if candidate.steam.is_some() || !manual_import::is_pc_platform(platform) {
            return Err(crate::i18n::text("msg.f864230dbe").into());
        }
        epic::validate(candidate)?;
        true
    } else {
        steam::launch_mode(candidate, platform)?
    };
    if candidate.recomp && (!candidate.launch_directly || !direct) { return Err(crate::i18n::text("recomp.invalidImport").into()); }
    if cfg!(target_os="linux") {
        if candidate.epic.is_some(){return Err(crate::i18n::text("linux.epicUnavailable").into());}
        if let Some(options)=&candidate.linux_execution {
            if !direct||candidate.steam.is_some(){return Err(crate::i18n::text("linux.directOnly").into());}
            linux_execution::validate(options)?;
        }
    }
    if !candidate.discs.is_empty() {
        if direct || discs::key(&candidate.discs[0].rom_path)!=discs::key(&candidate.rom_path) {
            return Err(crate::i18n::text("msg.83d5697d91").into());
        }
        discs::validate_sources(&candidate.discs,false)?;
    }
    Ok(direct)
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ScanPreview {
    games: Vec<RomCandidate>,
    total_found: usize,
    skipped_count: usize,
}

#[derive(Serialize, Debug)]
pub struct ScanProgress {
    phase: &'static str,
    processed: usize,
    total: Option<usize>,
    added_count: usize,
    skipped_count: usize,
    current_file: Option<String>,
}

fn data_directory() -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    storage::active_directory().map_err(Into::into)
}

fn get_db_connection() -> Result<Connection, Box<dyn std::error::Error>> {
    let db_path = storage::database_path(&data_directory()?);
    let conn = Connection::open(db_path)?;
    Ok(conn)
}

fn init_database(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let conn = get_db_connection()?;
    // Tabla de juegos
    conn.execute(
        "CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            platform TEXT NOT NULL,
            rom_path TEXT NOT NULL UNIQUE,
            cover_path TEXT,
            play_time INTEGER DEFAULT 0,
            release_date TEXT,
            developer TEXT,
            publisher TEXT
        )",
        [],
    )?;
    let _ = conn.execute("ALTER TABLE games ADD COLUMN release_date TEXT", []);
    let _ = conn.execute("ALTER TABLE games ADD COLUMN developer TEXT", []);
    let _ = conn.execute("ALTER TABLE games ADD COLUMN publisher TEXT", []);
    init_game_metadata(&conn)?;
    discs::init(&conn)?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_games_title ON games(title)",
        [],
    )?;
    // Tabla de emuladores
    conn.execute(
        "CREATE TABLE IF NOT EXISTS emulators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            platform TEXT NOT NULL,
            executable_path TEXT NOT NULL,
            arguments TEXT DEFAULT '\"%ROM%\"'
        )",
        [],
    )?;
    retroarch::init_schema(&conn)?;
    init_platforms(&conn)?;
    platform_details::init_schema(&conn)?;
    library_navigation::init_schema(&conn)?;
    entity_variables::init_schema(&conn)?;
    game_execution::init_schema(&conn)?;
    game_regions::init(&conn)?;
    library_files::init(&conn)?;
    session_history::recover(&conn)?;
    metadata::init_library_schema(&conn)?;
    init_game_images(&conn)?;
    media_library::init_schema(&conn)?;
    let image_dir = data_directory()?.join("images");
    fs::create_dir_all(&image_dir)?;
    app.asset_protocol_scope().allow_directory(&image_dir, true)?;
    // Permitir también las portadas locales guardadas por versiones anteriores.
    for path in conn.prepare("SELECT path FROM game_images")?.query_map([], |row| row.get::<_, String>(0))? {
        let path = path?;
        if Path::new(&path).is_absolute() { app.asset_protocol_scope().allow_file(path)?; }
    }
    Ok(())
}

fn init_game_metadata(conn: &Connection) -> rusqlite::Result<()> {
    linux_execution::init(conn)?;
    game_order::init(conn)?;
    game_box_settings::init(conn)?;
    let columns: std::collections::HashSet<String> = conn.prepare("PRAGMA table_info(games)")?
        .query_map([], |row| row.get(1))?.collect::<Result<_, _>>()?;
    for (name, column_type) in [
        ("genre", "TEXT"), ("game_mode", "TEXT"), ("max_players", "INTEGER"),
        ("description", "TEXT"), ("last_played", "TEXT"),
        ("play_time_seconds", "INTEGER NOT NULL DEFAULT 0"),
        ("session_count", "INTEGER NOT NULL DEFAULT 0"),
        ("launch_directly", "INTEGER NOT NULL DEFAULT 0"),
        ("steam_client_path", "TEXT"),
        ("epic_client_path", "TEXT"), ("epic_manifest_path", "TEXT"),
        ("emulator_override_id", "INTEGER"), ("arguments_override", "TEXT"),
    ] {
        if !columns.contains(name) {
            conn.execute(&format!("ALTER TABLE games ADD COLUMN {} {}", name, column_type), [])?;
            if name == "play_time_seconds" {
                conn.execute("UPDATE games SET play_time_seconds = MAX(0, COALESCE(play_time, 0)) * 60", [])?;
            }
        }
    }
    Ok(())
}

fn init_game_images(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS game_images (
            game_id INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
            position INTEGER NOT NULL, PRIMARY KEY (game_id, path)
         );
         DROP INDEX IF EXISTS idx_game_primary_image;
         CREATE TRIGGER IF NOT EXISTS remove_game_images AFTER DELETE ON games
         BEGIN DELETE FROM game_images WHERE game_id = OLD.id; END;
         INSERT OR IGNORE INTO game_images (game_id, path, kind, position)
         SELECT id, cover_path, 'cover', 0 FROM games WHERE cover_path IS NOT NULL AND cover_path <> '';",
    )
}

fn read_game_images(conn: &Connection, id: i32) -> Result<Vec<GameImage>, String> {
    conn.prepare("SELECT path, kind FROM game_images WHERE game_id = ?1 ORDER BY position")
        .map_err(|e| e.to_string())?.query_map([id], |row| Ok(GameImage { path: row.get(0)?, kind: row.get(1)? }))
        .map_err(|e| e.to_string())?.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn resolve_image_path(root: &Path, path: &str) -> String {
    if Path::new(path).is_absolute() || path.starts_with("https://") || path.starts_with("http://") {
        path.to_string()
    } else {
        root.join(path).to_string_lossy().into_owned()
    }
}

fn hydrate_game_images(game: &mut Game, root: &Path) {
    game.cover_path = game.cover_path.as_ref().map(|path| resolve_image_path(root, path));
    for image in &mut game.images { image.path = resolve_image_path(root, &image.path); }
}

fn init_platforms(conn: &Connection) -> rusqlite::Result<()> {
    platform_defaults::init(conn)
}

#[tauri::command]
async fn get_games(tracker: tauri::State<'_, PlayTracker>) -> Result<Vec<Game>, String> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = get_db_connection().map_err(|e| e.to_string())?;
        let root = data_directory().map_err(|e| e.to_string())?;
        read_library_games(&conn, &root, &tracker)
    }).await.map_err(|e| e.to_string())?
}

fn read_library_games(conn: &Connection, root: &Path, tracker: &PlayTracker) -> Result<Vec<Game>, String> {
    let order_groups=game_order::groups(conn)?;
    let order_index=game_order::index(&order_groups);
    let mut box_settings = game_box_settings::all(conn)?;
    let variables = entity_variables::all(conn,"game")?;
    let mut stmt = conn
        .prepare("SELECT id, title, platform, rom_path, cover_path, play_time, release_date, developer, publisher, genre, game_mode, max_players, description, last_played, play_time_seconds, session_count, launch_directly, emulator_override_id, arguments_override FROM games ORDER BY title ASC")
        .map_err(|e| e.to_string())?;
    let games_iter = stmt
        .query_map([], |row| {
            Ok(Game { order_group:None, box_3d:None, regions:Vec::new(), default_region_id:None, execution: game_execution::ExecutionOptions { emulator_id: row.get(17)?, arguments: row.get(18)? , linux: None }, discs: Vec::new(),
                id: row.get(0)?,
                title: row.get(1)?,
                platform: row.get(2)?,
                rom_path: row.get(3)?,
                cover_path: row.get(4)?,
                play_time: row.get(5)?,
                release_date: row.get(6)?,
                developer: row.get(7)?,
                publisher: row.get(8)?,
                images: Vec::new(),
                genre: row.get(9)?, game_mode: row.get(10)?, max_players: row.get(11)?,
                description: row.get(12)?, last_played: row.get(13)?,
                play_time_seconds: row.get(14)?, session_count: row.get(15)?, is_running: false,
                launch_directly: row.get(16)?,
                recomp: false,
                steam_app_id: None,
                epic_app_id: None,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut games = Vec::new();
    // Read artwork in one batch instead of preparing one query for every game.
    let mut by_game = std::collections::HashMap::<i32, Vec<GameImage>>::new();
    let mut artwork = conn.prepare("SELECT game_id,path,kind FROM game_images ORDER BY game_id,position,path")
        .map_err(|e| e.to_string())?;
    let rows = artwork.query_map([], |row| Ok((row.get::<_,i32>(0)?, GameImage { path: row.get(1)?, kind: row.get(2)? })))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, image) = row.map_err(|e| e.to_string())?;
        by_game.entry(id).or_default().push(image);
    }
    let mut linux_options = linux_execution::all(conn)?;
    let mut disc_lists = discs::all(conn)?;
    for game in games_iter {
        let mut game = game.map_err(|e| e.to_string())?;
        game.discs = disc_lists.remove(&game.id).unwrap_or_default();
        game.execution.linux = linux_options.remove(&game.id);
        game.recomp = entity_variables::truth(variables.get(&game.id).and_then(|values|values.get("recomp")));
        game.box_3d = box_settings.remove(&game.id);
        game.order_group = order_index.get(&game_order::key(&game.title)).map(|index|order_groups[*index].clone());
        game.is_running = tracker.is_running(game.id);
        game.steam_app_id = steam::app_id(&game.rom_path);
        game.epic_app_id = epic::app_id(&game.rom_path);
        game.images = by_game.remove(&game.id).unwrap_or_default();
        hydrate_game_images(&mut game, root);
        games.push(game);
    }
    game_regions::assemble(conn, &mut games)?;
    Ok(games)
}

#[tauri::command]
fn get_emulators() -> Result<Vec<Emulator>, String> {
    let conn = get_db_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, platform, executable_path, arguments, retroarch_core_path FROM emulators ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let emulators_iter = stmt
        .query_map([], |row| {
            Ok(Emulator {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                platform: row.get(2)?,
                executable_path: row.get(3)?,
                arguments: row.get(4)?,
                retroarch_core_path: row.get(5)?,
                is_default: false,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut emulators = Vec::new();
    for emu in emulators_iter {
        if let Ok(mut e) = emu {
            e.is_default = platform_details::default_emulator(&conn, &e.platform)? == e.id.map(i64::from);
            emulators.push(e);
        }
    }
    Ok(emulators)
}

#[tauri::command]
fn get_platforms() -> Result<Vec<Platform>, String> {
    let conn = get_db_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, default_extensions FROM platforms ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let platforms_iter = stmt
        .query_map([], |row| {
            Ok(Platform {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                default_extensions: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    platforms_iter.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_platform(name: String, default_extensions: String) -> Result<Platform, String> {
    let mut conn = get_db_connection().map_err(|e| e.to_string())?;
    save_platform(&mut conn, None, &name, &default_extensions)
}

#[tauri::command]
fn update_platform(id: i32, name: String, default_extensions: String) -> Result<Platform, String> {
    let mut conn = get_db_connection().map_err(|e| e.to_string())?;
    save_platform(&mut conn, Some(id), &name, &default_extensions)
}

fn save_platform(
    conn: &mut Connection,
    id: Option<i32>,
    name: &str,
    default_extensions: &str,
) -> Result<Platform, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(crate::i18n::text("msg.b2fa682c6e").to_string());
    }
    let exts = if default_extensions.trim().is_empty() {
        ".iso, .zip, .7z, .bin".to_string()
    } else {
        default_extensions.trim().to_string()
    };
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let duplicate: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM platforms WHERE LOWER(name) = LOWER(?1) AND (?2 IS NULL OR id <> ?2))",
        (name, id),
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if duplicate {
        return Err(crate::i18n::text("msg.5102ecf63b").to_string());
    }
    let saved_id = if let Some(id) = id {
        let previous_name: String = tx.query_row(
            "SELECT name FROM platforms WHERE id = ?1", [id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?
            .ok_or(crate::i18n::text("msg.2566da2e5d"))?;
        tx.execute(
            "UPDATE platforms SET name = ?1, default_extensions = ?2 WHERE id = ?3",
            (name, &exts, id),
        ).map_err(|e| e.to_string())?;
        for table in ["games", "emulators"] {
            tx.execute(
                &format!("UPDATE {} SET platform = ?1 WHERE LOWER(platform) = LOWER(?2)", table),
                (name, &previous_name),
            ).map_err(|e| e.to_string())?;
        }
        id
    } else {
        tx.execute(
            "INSERT INTO platforms (name, default_extensions) VALUES (?1, ?2)",
            (name, &exts),
        ).map_err(|e| e.to_string())?;
        tx.last_insert_rowid() as i32
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Platform {
        id: Some(saved_id),
        name: name.to_string(),
        default_extensions: exts,
    })
}

#[tauri::command]
fn delete_platform(id: i32) -> Result<(), String> {
    let mut conn = get_db_connection().map_err(|e| e.to_string())?;
    remove_platform(&mut conn, id)
}

fn remove_platform(conn: &mut Connection, id: i32) -> Result<(), String> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let name: String = tx.query_row(
        "SELECT name FROM platforms WHERE id = ?1", [id], |row| row.get(0),
    ).optional().map_err(|e| e.to_string())?.ok_or(crate::i18n::text("msg.2566da2e5d"))?;
    let in_use: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM games WHERE LOWER(platform) = LOWER(?1))
         OR EXISTS(SELECT 1 FROM emulators WHERE LOWER(platform) = LOWER(?1))",
        [&name], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if in_use {
        return Err(crate::i18n::text("msg.1858a939b8").to_string());
    }
    tx.execute("DELETE FROM platforms WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_emulator(
    name: String,
    platform: String,
    executable_path: String,
    arguments: String,
    retroarch_core_path: Option<String>,
) -> Result<Emulator, String> {
    let mut conn = get_db_connection().map_err(|e| e.to_string())?;
    let args = if arguments.trim().is_empty() {
        emulator_defaults::recommended(&name, &executable_path)
    } else {
        arguments
    };
    retroarch::validate_configuration(&executable_path, &args, retroarch_core_path.as_deref())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO emulators (name, platform, executable_path, arguments, retroarch_core_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&name, &platform, &executable_path, &args, &retroarch_core_path),
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid() as i32;
    retroarch::remember_configuration(&tx, &executable_path, retroarch_core_path.as_deref())?;
    let is_default = platform_details::default_emulator(&tx, &platform)? == Some(i64::from(id));
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Emulator {
        id: Some(id),
        name,
        platform,
        executable_path,
        arguments: args,
        retroarch_core_path,
        is_default,
    })
}

#[tauri::command]
fn update_emulator(
    id: i32,
    name: String,
    platform: String,
    executable_path: String,
    arguments: String,
    retroarch_core_path: Option<String>,
) -> Result<(), String> {
    let mut conn = get_db_connection().map_err(|e| e.to_string())?;
    let args = if arguments.trim().is_empty() {
        emulator_defaults::recommended(&name, &executable_path)
    } else {
        arguments
    };
    retroarch::validate_configuration(&executable_path, &args, retroarch_core_path.as_deref())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE emulators SET name = ?1, platform = ?2, executable_path = ?3, arguments = ?4, retroarch_core_path = ?6 WHERE id = ?5",
        (&name, &platform, &executable_path, &args, id, &retroarch_core_path),
    )
    .map_err(|e| e.to_string())?;
    retroarch::remember_configuration(&tx, &executable_path, retroarch_core_path.as_deref())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_emulator(id: i32) -> Result<(), String> {
    let conn = get_db_connection().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM emulators WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn update_game(details: GameDetails, tracker: tauri::State<'_, PlayTracker>) -> Result<Game, String> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_db_connection().map_err(|e| e.to_string())?;
        let parent = game_regions::owner(&conn, details.id)?;
        let reservation = if details.discs.is_some() || details.regions.is_some() || details.rom_path.is_some() { Some(tracker.reserve(parent)?) } else { None };
        let root = data_directory().map_err(|e| e.to_string())?;
        let mut game = save_game_with_media(&mut conn, details, &root)?;
        drop(reservation);
        if game_regions::expanded(&conn, &[parent])?.len() > 1 {
            game = read_library_games(&conn, &root, &tracker)?.into_iter().find(|g|g.id==parent).ok_or(crate::i18n::text("msg.ca011b02e6"))?;
        }
        game.is_running = tracker.is_running(game.id);
        Ok(game)
    }).await.map_err(|e| e.to_string())?
}

fn valid_release_date(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2
        || !parts.iter().all(|part| part.bytes().all(|byte| byte.is_ascii_digit())) {
        return false;
    }
    let year: u32 = parts[0].parse().unwrap_or(0);
    let month: usize = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    year > 0 && (1..=12).contains(&month) && day > 0 && day <= days[month - 1]
}

#[cfg(test)]
fn save_game_details(conn: &mut Connection, details: GameDetails) -> Result<Game, String> {
    if details.rom_path.is_some(){discs::init(conn).map_err(|e|e.to_string())?;}
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    let game = save_game_details_in_transaction(&tx, details)?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(game)
}

fn save_game_details_in_transaction(conn: &Connection, details: GameDetails) -> Result<Game, String> {
    if let Some(path)=&details.rom_path { library_files::replace_source(conn,details.id,None,path)?; }
    if let Some(order) = &details.order_group { game_order::save(conn,order)?; }
    if let Some(settings) = &details.box_3d { game_box_settings::save(conn,details.id,settings.as_ref())?; }
    game_regions::validate_platform(conn, details.id, &details.platform)?;
    if let Some(ref settings) = details.regions { game_regions::save(conn,details.id,settings)?; }
    let title = details.title.trim();
    if title.is_empty() {
        return Err(crate::i18n::text("msg.40d5fb252e").to_string());
    }
    let optional_text = |text: Option<String>| {
        text.map(|value| value.trim().to_string()).filter(|value| !value.is_empty())
    };
    let release_date = optional_text(details.release_date);
    let developer = optional_text(details.developer);
    let publisher = optional_text(details.publisher);
    let genre = optional_text(details.genre);
    let game_mode = optional_text(details.game_mode);
    let description = optional_text(details.description);
    if details.max_players.is_some_and(|players| players < 1) {
        return Err(crate::i18n::text("msg.427b00d77e").into());
    }
    if details.catalog_id.is_some_and(|id| id <= 0 && !metadata::repository::repository_id(id)) {
        return Err(crate::i18n::text("msg.8a6f6cd9c5").into());
    }
    if release_date.as_deref().is_some_and(|date| !valid_release_date(date)) {
        return Err(crate::i18n::text("msg.866ad773b5").to_string());
    }
    let tx = conn;
    let platform: String = tx.query_row(
        "SELECT name FROM platforms WHERE LOWER(name) = LOWER(?1)",
        [details.platform.trim()], |row| row.get(0),
    ).optional().map_err(|e| e.to_string())?
        .ok_or(crate::i18n::text("msg.6d7512c1a1"))?;
    let affected = tx.execute(
        "UPDATE games SET title = ?1, platform = ?2, release_date = ?3, developer = ?4, publisher = ?5,
         genre = ?6, game_mode = ?7, max_players = ?8, description = ?9 WHERE id = ?10",
        (title, &platform, &release_date, &developer, &publisher, &genre, &game_mode, details.max_players, &description, details.id),
    ).map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err(crate::i18n::text("msg.66087bc5c8").to_string());
    }
    if let Some(ref variables) = details.variables {
        entity_variables::save(tx, "game", details.id, variables)?;
    }
    if let Some(ref execution) = details.execution {
        game_execution::save(tx, details.id, &platform, execution)?;
    } else if let Some(emulator) = game_execution::read(tx, details.id)?.emulator_id {
        tx.execute("UPDATE games SET emulator_override_id=NULL WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM emulators WHERE rowid=?2 AND LOWER(platform)=LOWER(?3))",
            (details.id,emulator,&platform)).map_err(|e|e.to_string())?;
    }
    if let Some(ref sources) = details.discs {
        let direct: bool = tx.query_row("SELECT launch_directly FROM games WHERE id=?1", [details.id], |r|r.get(0)).map_err(|e|e.to_string())?;
        if direct { return Err(crate::i18n::text("msg.a203190e7f").into()); }
        let old = discs::read(tx, details.id as i64)?;
        for disc in sources {
            if !old.iter().any(|d|discs::key(&d.rom_path)==discs::key(&disc.rom_path)) && !Path::new(&disc.rom_path).is_file() {
                return Err(crate::i18n::text("msg.1e08c52fd4").into());
            }
        }
        discs::replace(tx,details.id as i64,sources)?;
    }
    if let Some(source_id) = details.catalog_id {
        metadata::repository::record_match(tx,details.id as i64,source_id)?;
    }
    if let Some(images) = &details.images {
        validate_game_images(images)?;
        tx.execute("DELETE FROM game_images WHERE game_id = ?1", [details.id]).map_err(|e| e.to_string())?;
        for (position, image) in images.iter().enumerate() {
            tx.execute("INSERT INTO game_images (game_id, path, kind, position) VALUES (?1, ?2, ?3, ?4)",
                (details.id, &image.path, &image.kind, i64::try_from(position).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
        }
        let cover = images.iter().find(|image| image.kind == "cover").map(|image| image.path.as_str());
        tx.execute("UPDATE games SET cover_path = ?1 WHERE id = ?2", (cover, details.id)).map_err(|e| e.to_string())?;
    }
    let mut game = tx.query_row(
        "SELECT id, title, platform, rom_path, cover_path, play_time, release_date, developer, publisher, genre, game_mode, max_players, description, last_played, play_time_seconds, session_count, launch_directly, emulator_override_id, arguments_override FROM games WHERE id = ?1",
        [details.id], |row| Ok(Game { order_group:None, box_3d:None, regions:Vec::new(), default_region_id:None, execution: game_execution::ExecutionOptions { emulator_id: row.get(17)?, arguments: row.get(18)? , linux: None }, discs: Vec::new(),
            id: row.get(0)?, title: row.get(1)?, platform: row.get(2)?,
            rom_path: row.get(3)?, cover_path: row.get(4)?, play_time: row.get(5)?,
            release_date: row.get(6)?, developer: row.get(7)?, publisher: row.get(8)?,
            images: Vec::new(),
            genre: row.get(9)?, game_mode: row.get(10)?, max_players: row.get(11)?,
            description: row.get(12)?, last_played: row.get(13)?,
            play_time_seconds: row.get(14)?, session_count: row.get(15)?, is_running: false,
            launch_directly: row.get(16)?,
            recomp: false,
            steam_app_id: None,
            epic_app_id: None,
        }),
    ).map_err(|e| e.to_string())?;
    game.execution.linux = linux_execution::read(tx, game.id)?;
    game.steam_app_id = steam::app_id(&game.rom_path);
    game.recomp = entity_variables::truth(entity_variables::read(tx,"game",details.id)?.get("recomp"));
    game.epic_app_id = epic::app_id(&game.rom_path);
    game.images = read_game_images(&tx, details.id)?;
    game.discs = discs::read(&tx, details.id as i64)?;
    game.box_3d = game_box_settings::read(&tx, details.id)?;
    game.order_group = game_order::matching(&game_order::groups(tx)?,&game.title).cloned();
    Ok(game)
}

fn validate_game_images(images: &[GameImage]) -> Result<(), String> {
    let mut paths = std::collections::HashSet::new();
    for image in images {
        if !metadata::valid_image_kind(&image.kind) {
            return Err(crate::i18n::text("msg.37005185d3").into());
        }
        if image.path.trim().is_empty() || !paths.insert(&image.path) {
            return Err(crate::i18n::text("msg.df05bfdae5").into());
        }
    }
    Ok(())
}

fn image_extension(path: &Path) -> Result<String, String> {
    use std::io::Read;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
    let mut header = [0u8; 12];
    let mut file = fs::File::open(path).map_err(|e| crate::i18n::i18n_format!("msg.1c822d5720", e))?;
    let size = file.read(&mut header).map_err(|e| e.to_string())?;
    let valid = match extension.as_str() {
        "png" => size >= 8 && header[..8] == *b"\x89PNG\r\n\x1a\n",
        "jpg" | "jpeg" => size >= 3 && header[..3] == [0xff, 0xd8, 0xff],
        "gif" => size >= 6 && (&header[..6] == b"GIF87a" || &header[..6] == b"GIF89a"),
        "webp" => size >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP",
        "bmp" => size >= 2 && &header[..2] == b"BM",
        "svg" => svg_image::valid(path),
        _ => false,
    };
    if !valid { return Err(crate::i18n::text("msg.ff9fb24a20").into()); }
    Ok(extension)
}

struct PendingImageCopies(Vec<std::path::PathBuf>);

impl Drop for PendingImageCopies {
    fn drop(&mut self) {
        for path in &self.0 { let _ = fs::remove_file(path); }
    }
}

fn save_game_with_media(conn: &mut Connection, mut details: GameDetails, root: &Path) -> Result<Game, String> {
    discs::init(conn).map_err(|e|e.to_string())?;
    media_library::init_schema(conn)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    let mut copied = PendingImageCopies(Vec::new());
    if let Some(paths) = details.manuals.take() {
        manuals::copy_into_collection(&tx, root, details.id as i64, &paths, &mut copied)?;
    }
    if let Some(images) = &mut details.images {
        validate_game_images(images)?;
        let existing = read_game_images(&tx, details.id)?;
        let (_, collection_dir) = media_library::ensure_game(&tx, root, details.id as i64)?;
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        for (index, image) in images.iter_mut().enumerate() {
            if let Some(saved) = existing.iter().find(|saved| resolve_image_path(root, &saved.path) == image.path) {
                image.path = saved.path.clone();
                continue;
            }
            let source = Path::new(&image.path);
            let extension = image_extension(source)?;
            let relative = format!("{collection_dir}/{}-{}.{}", unique, index, extension);
            let destination = root.join(&relative);
            fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
            // create_new impide sobrescribir imágenes ya guardadas.
            let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|e| e.to_string())?;
            copied.0.push(destination);
            let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
            std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
            image.path = relative;
        }
    }
    let game_id = details.id;
    let mut game = save_game_details_in_transaction(&tx, details)?;
    media_library::sync_game(&tx, root, game_id as i64, &mut copied)?;
    game.images = read_game_images(&tx, game_id)?;
    game.cover_path = game.images.iter().find(|i|i.kind=="cover").map(|i|i.path.clone());
    tx.commit().map_err(|e|e.to_string())?;
    copied.0.clear();
    media_library::flush_logged(conn, root);
    hydrate_game_images(&mut game, root);
    Ok(game)
}

#[tauri::command]
async fn select_game_images(app: tauri::AppHandle, kind: String) -> Result<Vec<String>, String> {
    validate_game_images(&[GameImage { path: "selection".into(), kind: kind.clone() }])?;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new().set_title(crate::i18n::text("msg.cfe995fb19"))
            .add_filter(crate::i18n::text("msg.98f60447c3"), &["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
        let paths = if ["cover", "logo"].contains(&kind.as_str()) {
            dialog.pick_file().map(|path| vec![path]).unwrap_or_default()
        } else { dialog.pick_files().unwrap_or_default() };
        paths.into_iter().map(|path| {
            image_extension(&path)?;
            app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())?;
            Ok(path.to_string_lossy().into_owned())
        }).collect()
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_game(id: i32, preserve_data: Option<bool>, tracker: tauri::State<'_, PlayTracker>) -> Result<(), String> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_db_connection().map_err(|e|e.to_string())?;
        let _active = tracker.reserve(game_regions::owner(&conn,id)?)?;
        let root = data_directory().map_err(|e|e.to_string())?;
        let members = game_regions::expanded(&conn,&[id])?;
        if preserve_data.unwrap_or(true) { media_library::preserve_before_delete(&mut conn, &root, &members)?; }
        delete_game_records_with_options(&mut conn, &[id], (!preserve_data.unwrap_or(true)).then_some(root.as_path())).map(|_|())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn delete_games(ids: Vec<i32>, preserve_data: Option<bool>, tracker: tauri::State<'_, PlayTracker>) -> Result<usize, String> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_db_connection().map_err(|e| e.to_string())?;
        let roots = ids.iter().map(|id|game_regions::owner(&conn,*id)).collect::<Result<std::collections::HashSet<_>,_>>()?;
        let _active = roots.into_iter().map(|id|tracker.reserve(id)).collect::<Result<Vec<_>,_>>()?;
        let root = data_directory().map_err(|e|e.to_string())?;
        let members = game_regions::expanded(&conn,&ids)?;
        if preserve_data.unwrap_or(true) { media_library::preserve_before_delete(&mut conn, &root, &members)?; }
        delete_game_records_with_options(&mut conn, &ids, (!preserve_data.unwrap_or(true)).then_some(root.as_path()))
    }).await.map_err(|e| e.to_string())?
}

fn delete_game_records(conn: &mut Connection, ids: &[i32]) -> Result<usize, String> {
    delete_game_records_with_options(conn, ids, None)
}

fn delete_game_records_with_options(conn: &mut Connection, ids: &[i32], discard_root: Option<&Path>) -> Result<usize, String> {
    let _cleanup_lock = discard_root.map(|_| media_library::cleanup_lock());
    if ids.is_empty() {
        return Err(crate::i18n::text("msg.3fc9b7a4d5").to_string());
    }
    let members = game_regions::expanded(conn,ids)?;
    let logical: std::collections::HashSet<_> = ids.iter().map(|id|game_regions::owner(conn,*id)).collect::<Result<_,_>>()?;
    let logical_count = logical.iter().map(|id|conn.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",[id],|row|row.get::<_,bool>(0)).map(|exists|usize::from(exists))).collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?.into_iter().sum::<usize>();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if discard_root.is_some() { media_library::discard_collections(&tx,&members)?; }
    let mut deleted = 0;
    {
        let mut statement = tx.prepare("DELETE FROM games WHERE id = ?1").map_err(|e| e.to_string())?;
        for id in &members {
            deleted += statement.execute([id]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    if let Some(root) = discard_root {
        for warning in media_library::clean_trash(conn,root) { eprintln!("{warning}"); }
    }
    Ok(deleted.min(logical_count))
}

#[tauri::command]
async fn launch_game(game_id: i32, disc_id: Option<i64>, region_id: Option<i32>, app: tauri::AppHandle, tracker: tauri::State<'_, PlayTracker>) -> Result<LaunchResult, String> {
    let active = tracker.reserve(game_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = get_db_connection().map_err(|e| e.to_string())?;
        let source_id = game_regions::selected(&conn,game_id,region_id)?;
        let steam_id = conn.query_row("SELECT rom_path FROM games WHERE id=?1", [source_id], |row| row.get::<_, String>(0)).ok().and_then(|path| steam::app_id(&path));
        let game_path: String = conn.query_row("SELECT rom_path FROM games WHERE id=?1", [source_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let direct:bool=conn.query_row("SELECT launch_directly FROM games WHERE id=?1",[source_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let linux_options=linux_execution::read(&conn,source_id)?.unwrap_or_default();
        let epic_directory = if epic::app_id(&game_path).is_some() { Some(epic::launch_plan(&conn, game_id, &game_path)?.install_directory) } else { None };
        let (mut result, (mut child, started, diagnostic_log, process_session, error_output)) = launch_game_record_with_region(&conn, game_id, region_id, disc_id, |emu_path, args, working_directory| {
            let mut args=args.to_vec();let log=retroarch::diagnostic_log(emu_path,&mut args,game_id);
            let runtime=if cfg!(target_os="linux")&&direct&&steam_id.is_none()&&epic::app_id(&game_path).is_none(){Some(linux_execution::plan(&data_directory().map_err(|e|e.to_string())?,source_id,emu_path,&args,&linux_options)?)}else{None};
            let mut command = std::process::Command::new(runtime.as_ref().map(|p|p.executable.as_path()).unwrap_or(Path::new(emu_path)));
            platform_runtime::configure_child(&mut command);
            if let Some(plan)=&runtime {
                if let Some(prefix)=&plan.prefix {fs::create_dir_all(prefix).map_err(|e|e.to_string())?;}
                command.args(&plan.args).envs(&plan.environment).current_dir(&plan.directory);
            } else {command.args(&args);if let Some(parent) = working_directory { command.current_dir(parent); }}
            let token=format!("{}-{}-{}",std::process::id(),source_id,std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
            #[cfg(target_os="linux")] {
                use std::os::unix::process::CommandExt;
                if !platform_runtime::executable(command.get_program().as_ref()) {return Err(crate::i18n::text("linux.notExecutable").into());}
                command.process_group(0).env("OPENCABINET_SESSION",&token).stderr(std::process::Stdio::piped());
            }
            let mut child = command.spawn()
                .map_err(|e| crate::i18n::i18n_format!("msg.ebe0ff502e", emu_path, e))?;
            let errors=child.stderr.take().map(linux_process::capture_errors);
            let session=cfg!(target_os="linux").then(||linux_process::Session::new(child.id(),token));
            Ok((child, Instant::now(),log,session,errors))
        })?;
        result.stats = game_regions::statistics(&conn,game_id,result.stats)?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut active = Some(active);
            let mut diagnostic_sent=false;
            let process_session=std::cell::RefCell::new(process_session);
            let steam_session = std::cell::RefCell::new(steam_id.map(steam::SteamSession::new));
            let epic_session = std::cell::RefCell::new(epic_directory.map(epic::EpicSession::new));
            if let Err(error) = playtime::monitor_session(&conn, source_id,
                || {
                    if let Some(session) = steam_session.borrow_mut().as_mut() { let _ = child.try_wait(); Ok(session.poll()) }
                    else if let Some(session) = epic_session.borrow_mut().as_mut() { let _ = child.try_wait(); Ok(session.poll()) }
                    else {
                        let status=child.try_wait().map_err(|e|e.to_string())?;
                        let running=process_session.borrow_mut().as_mut().map(|s|s.poll(status.is_none())).unwrap_or(status.is_none());
                        if cfg!(target_os="linux")&&!running&&!diagnostic_sent&&started.elapsed()<Duration::from_secs(20)&&status.as_ref().is_some_and(|s|!s.success()) {
                            diagnostic_sent=true;
                            let message=crate::i18n::i18n_format!("linux.launchFailed",linux_process::error_text(&error_output));
                            let _=app.emit("launch-diagnostic",serde_json::json!({"game_id":game_id,"message":message}));
                        }
                        if !diagnostic_sent&&diagnostic_log.is_some()&&started.elapsed()<Duration::from_secs(15) {
                            let details=retroarch::failure_details(diagnostic_log.as_deref());
                            if details.is_some()||status.as_ref().is_some_and(|status|!status.success()) {
                                let message=if let Some(status)=&status {crate::i18n::i18n_format!("launch.earlyExit",status,details.unwrap_or_default())}
                                    else{crate::i18n::i18n_format!("launch.report",details.unwrap_or_default())};
                                diagnostic_sent=true;
                                let _=app.emit("launch-diagnostic",serde_json::json!({"game_id":game_id,"message":message}));
                            }
                        }
                        Ok(running)
                    }
                },
                || steam_session.borrow().as_ref().map(|session| session.elapsed())
                    .or_else(|| epic_session.borrow().as_ref().map(|session| session.elapsed())).or_else(||process_session.borrow().as_ref().map(|session|session.elapsed())).unwrap_or_else(|| started.elapsed()), || std::thread::sleep(Duration::from_secs(1)),
                |stats| {
                    if !stats.is_running { drop(active.take()); }
                    if let Ok(stats) = game_regions::statistics(&conn,game_id,stats) { let _ = app.emit("play-statistics-updated", stats); }
                },
            ) {
                drop(active.take());
                eprintln!("Error al medir el tiempo de juego: {}", error);
                // Liberar también el estado visual si el proceso ya no se puede supervisar.
                let mut saved = 0;
                if let Ok(Some(stats)) = playtime::save_elapsed(&conn, source_id, 0, &mut saved, false) {
                    if let Ok(stats) = game_regions::statistics(&conn,game_id,stats) { let _ = app.emit("play-statistics-updated", stats); }
                }
            }
        });
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
fn launch_game_record<T>(conn: &Connection, game_id: i32, spawn: impl FnOnce(&str, &[String], Option<&Path>) -> Result<T,String>) -> Result<(LaunchResult,T),String> {
    launch_game_record_with_disc(conn,game_id,None,spawn)
}
#[cfg(test)]
fn launch_game_record_with_disc<T>(
    conn: &Connection,
    game_id: i32,
    disc_id: Option<i64>,
    spawn: impl FnOnce(&str, &[String], Option<&Path>) -> Result<T, String>,
) -> Result<(LaunchResult, T), String> {
    launch_game_record_with_region(conn,game_id,None,disc_id,spawn)
}
fn launch_game_record_with_region<T>(
    conn: &Connection, game_id:i32, region_id:Option<i32>, disc_id:Option<i64>,
    spawn: impl FnOnce(&str, &[String], Option<&Path>) -> Result<T, String>,
) -> Result<(LaunchResult,T),String> {
    let source_id = game_regions::selected(conn,game_id,region_id)?;
    let mut stmt = conn
        .prepare("SELECT title, platform, rom_path, launch_directly FROM games WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let game_info: (String, String, String, bool) = stmt
        .query_row([source_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map_err(|_| crate::i18n::i18n_format!("msg.4cc7a81c78", game_id))?;
    let (title, platform, rom_path, launch_directly) = game_info;
    if launch_directly && disc_id.is_some() { return Err(crate::i18n::text("msg.11fbfacfff").into()); }
    if let Some(id) = steam::app_id(&rom_path) {
        let (executable, args) = steam::launch_plan(conn, game_id, id)?;
        let process = spawn(&executable.to_string_lossy(), &args, executable.parent())?;
        let stats = playtime::start_session(conn, game_id).map_err(|e| crate::i18n::i18n_format!("msg.1de35aa617", e = e))?;
        return Ok((LaunchResult { message: crate::i18n::i18n_format!("msg.d05295766f", title), stats }, process));
    }
    if epic::app_id(&rom_path).is_some() {
        let plan = epic::launch_plan(conn, game_id, &rom_path)?;
        let process = spawn(&plan.client.to_string_lossy(), &plan.args, plan.client.parent())?;
        let stats = playtime::start_session(conn, game_id).map_err(|e| crate::i18n::i18n_format!("msg.b701ca1150", e = e))?;
        return Ok((LaunchResult { message: crate::i18n::i18n_format!("msg.03b96fb258", title), stats }, process));
    }
    if launch_directly {
        manual_import::validate_pc_executable(&rom_path)?;
        let options = game_execution::read(conn, source_id)?;
        let args = shlex_split(options.arguments.as_deref().unwrap_or("")).into_iter().map(|arg|arg.replace("%ROM%", &rom_path)).collect::<Vec<_>>();
        let process = spawn(&rom_path, &args, Path::new(&rom_path).parent())?;
        let stats = playtime::start_session(conn, source_id)
            .map_err(|e| crate::i18n::i18n_format!("msg.32e05611f6", e))?;
        return Ok((LaunchResult { message: format!("Ejecutando {}", title), stats }, process));
    }
    let source_path: String = conn.query_row("SELECT rom_path FROM games WHERE id=?1",[source_id],|r|r.get(0)).map_err(|e|e.to_string())?;
    let rom_path = discs::selected_path(conn,source_id,disc_id,&source_path)?;
    let execution = game_execution::read(conn, source_id)?;
    let emulator_id = match execution.emulator_id {
        Some(id) => Some(id),
        None => platform_details::default_emulator(conn, &platform)?,
    };
    let mut emu_stmt = conn
        .prepare("SELECT executable_path, arguments FROM emulators WHERE rowid=?1 AND LOWER(platform)=LOWER(?2)")
        .map_err(|e| e.to_string())?;
    let emulator: (String, String) = emu_stmt
        .query_row((emulator_id,&platform), |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|_| {
            crate::i18n::i18n_format!(
                "msg.e639fea8d2",
                platform
            )
        })?;
    let (emu_path, emu_args_template) = emulator;
    let emu_args_template = execution.arguments.unwrap_or(emu_args_template);
    let core = retroarch::launch_core_for_emulator(conn, emulator_id.unwrap())?;
    let mut raw_args = if core.is_some() {
        let mut args: Vec<String> = shlex_split(&emu_args_template).into_iter().map(|part| part.replace("%ROM%", &rom_path)).collect();
        if !emu_args_template.contains("%ROM%") { args.push(rom_path.clone()); }
        args
    } else if emu_args_template.is_empty() || emu_args_template.trim() == "%ROM%" {
        vec![rom_path.clone()]
    } else {
        // Tokenize the template first: a ROM path is always one argument,
        // even with spaces or a legacy unquoted placeholder.
        shlex_split(&emu_args_template).into_iter().map(|arg| arg.replace("%ROM%", &rom_path)).collect()
    };
    if let Some(core) = core {
        if !Path::new(&core).is_file(){return Err(crate::i18n::i18n_format!("launch.coreMissing",core));}
        retroarch::validate_configuration(&emu_path, &emu_args_template, Some(&core))?;
        retroarch::validate_firmware(&emu_path,&core,&raw_args)?;
        raw_args.splice(0..0, ["-L".to_owned(), core]);
    }
    let working_directory = if Path::new(&emu_path).is_absolute() && platform_runtime::is_retroarch(Path::new(&emu_path)) {
        Path::new(&emu_path).parent()
    } else { None };
    let process = spawn(&emu_path, &raw_args, working_directory)?;
    let stats = playtime::start_session_path(conn, source_id, &rom_path)
        .map_err(|e| crate::i18n::i18n_format!("msg.32e05611f6", e))?;
    Ok((LaunchResult { message: crate::i18n::i18n_format!("msg.32bb8b5556", title, emu_path), stats }, process))
}

#[tauri::command]
fn select_folder() -> Result<Option<String>, String> {
    if let Some(path) = rfd::FileDialog::new()
        .set_title(crate::i18n::text("msg.cdb142b951"))
        .pick_folder()
    {
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
async fn select_emulator_executable() -> Result<Option<String>, String> {
    let dialog=rfd::AsyncFileDialog::new().set_title(crate::i18n::text("msg.aa9498be60"));
    let dialog=if cfg!(windows) {dialog.add_filter(crate::i18n::text("msg.7043823cee"), &["exe"])}else{dialog};
    Ok(dialog.pick_file().await
        .map(|path| path.path().to_string_lossy().into_owned()))
}

fn clean_rom_title(file_stem: &str) -> String {
    let mut cleaned = String::new();
    let mut in_parentheses = false;
    let mut in_brackets = false;
    for c in file_stem.chars() {
        match c {
            '(' => in_parentheses = true,
            ')' => in_parentheses = false,
            '[' => in_brackets = true,
            ']' => in_brackets = false,
            _ if !in_parentheses && !in_brackets => cleaned.push(c),
            _ => {}
        }
    }
    // file_stem() solo quita la última extensión: .iso.gz aún deja .iso.
    // Quitar únicamente sufijos conocidos para conservar puntos del título.
    const ROM_EXTENSIONS: &[&str] = &[
        "iso", "bin", "cue", "chd", "cso", "pbp", "gcm", "rvz", "wbfs", "nkit",
        "md", "gen", "smd", "sfc", "smc", "nes", "gba", "gbc", "gb", "n64", "z64",
        "v64", "nds", "3ds", "cia", "nsp", "xci", "xbe", "xex", "god", "cdi", "gdi",
        "v40", "zip", "7z", "gz", "bz2", "xz", "zst", "rar", "xiso", "zcci", "cci", "cxi",
    ];
    let mut stem = cleaned.trim();
    while let Some((name, extension)) = stem.rsplit_once('.') {
        if name.trim().is_empty()
            || !ROM_EXTENSIONS.iter().any(|known| extension.eq_ignore_ascii_case(known))
        {
            break;
        }
        stem = name.trim_end();
    }
    let result = stem.replace('_', " ").replace('-', " ");
    let trimmed = result.trim();
    if trimmed.is_empty() {
        file_stem.to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
async fn scan_roms_folder(
    folder_path: String,
    custom_extensions: Option<Vec<String>>,
    platform: Option<String>,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<ScanPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = get_db_connection().map_err(|e| e.to_string())?;
        discover_roms_for_platform(&conn, &folder_path, custom_extensions, platform.as_deref(), |progress| {
            let _ = on_progress.send(progress);
        })
    }).await.map_err(|e| crate::i18n::i18n_format!("msg.35f591d720", e))?
}

#[cfg(test)]
fn discover_roms(
    conn: &Connection,
    folder_path: &str,
    custom_extensions: Option<Vec<String>>,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<ScanPreview, String> {
    discover_roms_for_platform(conn, folder_path, custom_extensions, None, &mut on_progress)
}

fn discover_roms_for_platform(
    conn: &Connection,
    folder_path: &str,
    custom_extensions: Option<Vec<String>>,
    platform: Option<&str>,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<ScanPreview, String> {
    let path = Path::new(&folder_path);
    if !path.exists() || !path.is_dir() {
        return Err(crate::i18n::i18n_format!("msg.f6a95d8823", folder_path));
    }
    let default_exts = vec![
        "iso", "cue", "chd", "md", "bin", "sfc", "smc", "gba", "gbc", "gb",
        "n64", "z64", "nds", "3ds", "zcci", "cci", "cxi", "cia", "nsp", "xbe", "zip", "7z", "v40", "nes"
    ];
    let exts_to_check: Vec<String> = match custom_extensions {
        Some(list) if !list.is_empty() => list.into_iter().map(|e| e.trim().to_lowercase().replace('.', "")).collect(),
        _ => default_exts.into_iter().map(|s| s.to_string()).collect(),
    };
    let entries = fs::read_dir(path).map_err(|e| crate::i18n::i18n_format!("msg.efec44aedc", e))?;
    let cue_tracks = discs::cue_tracks(path,&exts_to_check)?;
    let existing = discs::paths(conn)?;
    let mut candidates = Vec::new();
    let mut total_found = 0;
    let mut skipped_count = 0;
    let mut last_update = Instant::now();
    let folder_layout = platform.is_some_and(folder_games::supported);
    on_progress(ScanProgress { phase: "discovering", processed: 0, total: None,
        added_count: 0, skipped_count: 0, current_file: None });
    for (index, entry) in entries.enumerate() {
        let entry = entry.map_err(|e| crate::i18n::i18n_format!("msg.9a496ed8c2", e))?;
        let entry_path = entry.path();
        if entry_path.is_file() && (!folder_layout || !entry_path.extension().is_some_and(|e| e.eq_ignore_ascii_case("bin"))) && entry_path.extension().and_then(|e| e.to_str())
            .is_some_and(|ext| exts_to_check.contains(&ext.to_lowercase())) {
            let rom_path = entry_path.to_string_lossy().into_owned();
            if cue_tracks.contains(&discs::key(&rom_path)) { continue; }
            total_found += 1;
            if existing.contains(&discs::key(&rom_path)) {
                skipped_count += 1;
            } else {
                let file_stem = entry_path.file_stem().and_then(|name| name.to_str()).unwrap_or(crate::i18n::text("msg.4d1a7c9832"));
                candidates.push(RomCandidate { linux_execution: None, recomp: false, launch_directly: false, discs: Vec::new(), existing_game_id: None, title: clean_rom_title(file_stem), rom_path, steam: None, epic: None });
            }
        }
        if last_update.elapsed() >= Duration::from_millis(100) {
            on_progress(ScanProgress { phase: "discovering", processed: index + 1, total: None,
                added_count: 0, skipped_count: 0, current_file: None });
            last_update = Instant::now();
        }
    }
    if folder_layout {
        let mut processed = 0;
        for (file, title) in folder_games::discover(path, platform.unwrap_or(""), |file| {
            processed += 1;
            if last_update.elapsed() >= Duration::from_millis(100) {
                on_progress(ScanProgress { phase: "discovering", processed, total: None, added_count: 0,
                    skipped_count, current_file: Some(file.to_string_lossy().into_owned()) });
                last_update = Instant::now();
            }
        })? {
            let rom_path = file.to_string_lossy().into_owned();
            total_found += 1;
            if existing.contains(&discs::key(&rom_path)) { skipped_count += 1; }
            else { candidates.push(RomCandidate { linux_execution: None, recomp: false, launch_directly: false, discs: Vec::new(), existing_game_id: None, title, rom_path, steam: None, epic: None }); }
        }
    }
    let mut candidates = discs::group(candidates);
    candidates.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()).then(a.rom_path.cmp(&b.rom_path)));
    Ok(ScanPreview { games: candidates, total_found, skipped_count })
}

#[tauri::command]
async fn import_scanned_roms(
    preview: ScanPreview,
    platform: String,
    on_progress: tauri::ipc::Channel<ScanProgress>,
    job_id: Option<String>,
    media_selections: Option<Vec<media_library::RecoverySelection>>,
    jobs: tauri::State<'_, metadata::MetadataJobs>,
    tracker: tauri::State<'_, PlayTracker>,
) -> Result<ScanResult, String> {
    let job = job_id.map(|id| jobs.get(&id)).transpose()?;
    let target_ids = preview.games.iter().filter_map(|g|g.existing_game_id).collect::<std::collections::HashSet<_>>();
    let tracker=tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_db_connection().map_err(|e| e.to_string())?;
        let parents = target_ids.into_iter().map(|id|game_regions::owner(&conn,id)).collect::<Result<std::collections::HashSet<_>,_>>()?;
        let _reservations = parents.into_iter().map(|id|tracker.reserve(id)).collect::<Result<Vec<_>,_>>()?;
        let root = data_directory().map_err(|e|e.to_string())?;
        media_library::reconcile(&mut conn, &root)?;
        let selections = media_selections.unwrap_or_default();
        media_library::validate_selections(&preview, &selections)?;
        if let Some(job) = job {
            return metadata::commit_import(&mut conn, &job, preview, &platform, |progress| {
                let _ = on_progress.send(progress);
            });
        }
        import_roms_with_media(&mut conn, preview, &platform, Some((&root, &selections)), |progress| {
            let _ = on_progress.send(progress);
        })
    }).await.map_err(|e| crate::i18n::i18n_format!("msg.34ab13dba1", e))?
}

#[cfg(test)]
fn import_roms(
    conn: &mut Connection,
    preview: ScanPreview,
    platform: &str,
    on_progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    import_roms_with_media(conn, preview, platform, None, on_progress)
}

fn import_roms_with_media(
    conn: &mut Connection, preview: ScanPreview, platform: &str,
    recovery: Option<(&Path, &[media_library::RecoverySelection])>,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    discs::init(conn).map_err(|e|e.to_string())?;
    if recovery.is_some() { media_library::init_schema(conn)?; }
    let mut copied = PendingImageCopies(Vec::new());
    let mut recovered_count = 0;
    let mut attached_count = 0;
    let mut candidates = preview.games;
    for candidate in &mut candidates {
        candidate.title = candidate.title.trim().to_string();
        if candidate.title.is_empty() {
            return Err(crate::i18n::i18n_format!("msg.958fbbc8bd", candidate.rom_path));
        }
    }
    let total = candidates.len();
    let total_found = candidates.iter().map(|c|c.discs.len().max(1)).sum::<usize>() + preview.skipped_count;
    let mut added_count = 0;
    let mut skipped_count = preview.skipped_count;
    let mut last_update = Instant::now();
    on_progress(ScanProgress { phase: "importing", processed: 0, total: Some(total),
        added_count, skipped_count, current_file: None });
    // Una transacción evita escribir a disco por separado para cada ROM.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut insert = tx.prepare(
            "INSERT INTO games (title, platform, rom_path, play_time, launch_directly, steam_client_path, epic_client_path, epic_manifest_path) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)
             ON CONFLICT(rom_path) DO NOTHING",
        ).map_err(|e| e.to_string())?;
        for (index, candidate) in candidates.iter().enumerate() {
            let entry_path = Path::new(&candidate.rom_path);
            if candidate.steam.is_none() && candidate.epic.is_none() && !entry_path.is_file() {
                return Err(crate::i18n::i18n_format!("msg.99f4ad8584", candidate.rom_path));
            }
            if let Some(id) = discs::attach_candidate(&tx,candidate,platform)? {
                if let Some((root,_))=recovery { media_library::sync_game(&tx,root,id,&mut copied)?; }
                attached_count += 1; continue;
            }
            let sources = discs::candidate_discs(candidate);
            let direct = candidate_launch_mode(candidate, platform)?;
            if !direct { discs::validate_sources(&sources,true)?; }
            let mut duplicate=false;
            for disc in &sources { if discs::owner(&tx,&disc.rom_path)?.is_some() { duplicate=true; } }
            if duplicate { skipped_count += 1; continue; }

            let rows = insert.execute((&candidate.title, platform, &candidate.rom_path, direct, candidate.steam.as_ref().map(|source| &source.client_path), candidate.epic.as_ref().map(|source| &source.client_path), candidate.epic.as_ref().map(|source| &source.manifest_path)))
                .map_err(|e| crate::i18n::i18n_format!("msg.b2c5ef1d99", candidate.title, e))?;
            if rows > 0 {
                added_count += 1;
                let id = tx.last_insert_rowid();
                entity_variables::save_recomp(&tx,id as i32,candidate.recomp)?;
                linux_execution::save(&tx,id as i32,candidate.linux_execution.as_ref())?;
                if !direct { discs::replace(&tx,id,&sources)?; }
                if let Some((root,selections)) = recovery {
                    if let Some(collection)=media_library::selection_for(selections, &candidate.rom_path) {
                        recovered_count += media_library::attach(&tx,root,id,&collection)?;
                    }
                    media_library::sync_game(&tx,root,id,&mut copied)?;
                }
            } else { skipped_count += 1; }
            if last_update.elapsed() >= Duration::from_millis(100) || index + 1 == total {
                on_progress(ScanProgress { phase: "importing", processed: index + 1, total: Some(total),
                    added_count, skipped_count,
                    current_file: entry_path.file_name().map(|name| name.to_string_lossy().into_owned()) });
                last_update = Instant::now();
            }
        }
    }
    tx.commit().map_err(|e| crate::i18n::i18n_format!("msg.02f6e164b4", e))?;
    copied.0.clear();
    if let Some((root,_))=recovery {media_library::flush_logged(conn,root);}
    on_progress(ScanProgress { phase: "done", processed: total, total: Some(total),
        added_count, skipped_count, current_file: None });
    Ok(ScanResult {
        attached_count,
        added_count,
        skipped_count,
        total_found,
        enrichment: (recovered_count > 0).then_some(metadata::ImportSummary {
            metadata_count: 0, image_count: recovered_count, failed_image_count: 0,
        }),
    })
}

#[cfg(test)]
fn scan_roms(
    conn: &mut Connection,
    folder_path: &str,
    platform: &str,
    custom_extensions: Option<Vec<String>>,
    mut on_progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    let preview = discover_roms(conn, folder_path, custom_extensions, &mut on_progress)?;
    import_roms(conn, preview, platform, on_progress)
}

fn shlex_split(input: &str) -> Vec<String> {
    if cfg!(target_os="linux"){return platform_runtime::split_arguments(input);}
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in input.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
            }
            ' ' if !in_quotes => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    struct ScanFolder(std::path::PathBuf);

    impl ScanFolder {
        fn new() -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("opencabinet-scan-test-{}-{}", std::process::id(), unique));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &str { self.0.to_str().unwrap() }
    }

    impl Drop for ScanFolder {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT NOT NULL,
             platform TEXT NOT NULL, rom_path TEXT NOT NULL UNIQUE, play_time INTEGER);",
        ).unwrap();
        init_game_metadata(&conn).unwrap();
        conn
    }

    #[test]
    fn scans_zcci_and_xiso_iso_without_altering_the_game_files() {
        let folder=ScanFolder::new();
        for file in ["Zelda (Europe).ZCCI","Halo (USA).xiso.iso"] { fs::write(folder.0.join(file),"ROM contents").unwrap(); }
        let conn=database();
        let preview=discover_roms(&conn,folder.path(),None,|_|{}).unwrap();
        assert_eq!(preview.games.len(),2);
        assert!(preview.games.iter().any(|g|g.title=="Zelda"));
        assert!(preview.games.iter().any(|g|g.title=="Halo"));
        assert!(preview.games.iter().all(|g|Path::new(&g.rom_path).is_file()));
    }

    #[test]
    fn import_preserves_reviewed_titles_without_renaming_files() {
        let folder = ScanFolder::new();
        let rom_path = folder.0.join("Original (USA).iso");
        fs::write(&rom_path, "ROM contents").unwrap();
        let mut conn = database();
        let mut preview = discover_roms(&conn, folder.path(), None, |_| {}).unwrap();
        preview.games[0].title = "  Corrected Title .iso <Edition>  ".into();
        import_roms(&mut conn, preview, "PS2", |_| {}).unwrap();
        let stored: (String, String) = conn.query_row("SELECT title, rom_path FROM games", [],
            |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(stored.0, "Corrected Title .iso <Edition>");
        assert_eq!(stored.1, rom_path.to_string_lossy());
        assert_eq!(fs::read_to_string(rom_path).unwrap(), "ROM contents");
    }

    #[test]
    fn ps3_ps4_folder_scan_finds_only_boot_files_uses_game_folders_and_skips_duplicates() {
        let folder = ScanFolder::new();
        for file in ["First Game (USA)/PS3_GAME/USRDIR/EBOOT.BIN", "Second Game/eboot.bin", "First Game (USA)/PS3_GAME/USRDIR/assets.bin", "PS3_UPDATE/EBOOT.BIN", "other.bin",
            "Invalid PS3/USRDIR/EBOOT.BIN", "Deeply/Nested/PS3_GAME/USRDIR/EBOOT.BIN", "Invalid PS4/Assets/eboot.bin"] {
            let path=folder.0.join(file);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,"boot").unwrap();
        }
        let mut conn=database();
        let preview=discover_roms_for_platform(&conn,folder.path(),Some(vec!["pkg".into()]),Some("Sony PlayStation 3"), |_|{}).unwrap();
        assert_eq!(preview.games.iter().map(|g|g.title.as_str()).collect::<Vec<_>>(),vec!["First Game"]);
        assert_eq!(preview.total_found,1);
        let first=&preview.games[0];assert!(first.rom_path.ends_with("EBOOT.BIN"));
        import_roms(&mut conn,preview,"Sony PlayStation 3", |_|{}).unwrap();
        let again=discover_roms_for_platform(&conn,folder.path(),None,Some("PS3"), |_|{}).unwrap();
        assert_eq!(again.skipped_count,1);assert!(again.games.is_empty());
        let mut checked=Vec::new();
        let ps4=folder_games::discover(&folder.0,"PS4",|path| checked.push(path.to_path_buf())).unwrap();
        assert_eq!(ps4.len(),1);assert_eq!(ps4[0].1,"Second Game");
        assert!(checked.iter().all(|path| path==&folder.0 || path.parent()==Some(folder.0.as_path())),"only the selected folder and immediate children are checked");
        let direct=folder.0.join("First Game (USA)");
        assert_eq!(folder_games::discover(&direct,"PS3", |_|{}).unwrap().len(),1);
        let standalone=folder.0.join("Second Game");
        let preview=discover_roms_for_platform(&database(),standalone.to_str().unwrap(),None,Some("PS4"), |_|{}).unwrap();
        assert_eq!(preview.games[0].title,"Second Game");
        assert!(folder_games::supported("Sony PlayStation 4"));assert!(!folder_games::supported("Sony PlayStation 2"));
        assert_eq!(folder_games::title(&folder.0,&folder.0.join("Installed/USRDIR/EBOOT.BIN")),"Installed");
    }

    #[test]
    fn empty_reviewed_title_prevents_the_entire_import() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("A.iso"), "").unwrap();
        fs::write(folder.0.join("B.iso"), "").unwrap();
        let mut conn = database();
        let mut preview = discover_roms(&conn, folder.path(), None, |_| {}).unwrap();
        preview.games[1].title = "   ".into();
        assert!(import_roms(&mut conn, preview, "PS2", |_| {}).is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn discovery_does_not_import_and_confirmation_uses_only_reviewed_files() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("Zelda (USA).iso"), "").unwrap();
        fs::write(folder.0.join("FIFA (USA).iso.gz"), "").unwrap();
        let mut conn = database();
        let preview = discover_roms(&conn, folder.path(), Some(vec!["iso".into(), "gz".into()]), |_| {}).unwrap();
        assert_eq!(preview.games.len(), 2);
        assert_eq!(preview.games[0].title, "FIFA");
        assert_eq!(preview.games[1].title, "Zelda");
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        // Un archivo aparecido después de la revisión no debe importarse sin revisión.
        fs::write(folder.0.join("Unreviewed.iso"), "").unwrap();
        let result = import_roms(&mut conn, preview, "PS2", |_| {}).unwrap();
        assert_eq!(result.added_count, 2);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games WHERE title = 'Unreviewed'", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn preview_excludes_existing_games_and_import_rechecks_duplicates() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("Existing.iso"), "").unwrap();
        let mut conn = database();
        scan_roms(&mut conn, folder.path(), "PS2", None, |_| {}).unwrap();
        fs::write(folder.0.join("New.iso"), "").unwrap();
        let preview = discover_roms(&conn, folder.path(), None, |_| {}).unwrap();
        assert_eq!(preview.total_found, 2);
        assert_eq!(preview.skipped_count, 1);
        assert_eq!(preview.games.len(), 1);
        assert_eq!(preview.games[0].title, "New");
        // Otra importación puede haber agregado el mismo juego mientras se revisaba.
        conn.execute("INSERT INTO games (title, platform, rom_path) VALUES ('New', 'PS2', ?1)", [&preview.games[0].rom_path]).unwrap();
        let result = import_roms(&mut conn, preview, "PS2", |_| {}).unwrap();
        assert_eq!(result.added_count, 0);
        assert_eq!(result.skipped_count, 2);
    }

    #[test]
    fn missing_reviewed_file_rolls_back_import() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("A.iso"), "").unwrap();
        fs::write(folder.0.join("B.iso"), "").unwrap();
        let mut conn = database();
        let preview = discover_roms(&conn, folder.path(), None, |_| {}).unwrap();
        fs::remove_file(folder.0.join("B.iso")).unwrap();
        assert!(import_roms(&mut conn, preview, "PS2", |_| {}).is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn batch_delete_removes_only_selected_records_and_preserves_rom_files() {
        let folder = ScanFolder::new();
        for name in ["first.iso", "second.iso", "third.iso"] {
            fs::write(folder.0.join(name), "ROM contents").unwrap();
        }
        let mut conn = database();
        scan_roms(&mut conn, folder.path(), "PS2", None, |_| {}).unwrap();
        let ids: Vec<i32> = conn.prepare("SELECT id FROM games ORDER BY id").unwrap()
            .query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(delete_game_records(&mut conn, &ids[..2]).unwrap(), 2);
        let remaining: i32 = conn.query_row("SELECT id FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(remaining, ids[2]);
        for name in ["first.iso", "second.iso", "third.iso"] {
            assert_eq!(fs::read_to_string(folder.0.join(name)).unwrap(), "ROM contents");
        }
    }

    #[test]
    fn batch_delete_handles_duplicates_and_missing_ids() {
        let mut conn = database();
        conn.execute("INSERT INTO games(id,title,platform,rom_path,play_time) VALUES (1, 'Game', 'PS2', 'game.iso', 0)", []).unwrap();
        assert!(delete_game_records(&mut conn, &[]).is_err());
        assert_eq!(delete_game_records(&mut conn, &[1, 1, 999]).unwrap(), 1);
        assert_eq!(delete_game_records(&mut conn, &[1]).unwrap(), 0);
    }

    #[test]
    fn batch_delete_rolls_back_if_any_delete_fails() {
        let mut conn = database();
        conn.execute_batch(
            "INSERT INTO games(id,title,platform,rom_path,play_time) VALUES (1, 'Game', 'PS2', 'game.iso', 0);
             INSERT INTO games(id,title,platform,rom_path,play_time) VALUES (2, 'Protected', 'PS2', 'protected.iso', 0);
             CREATE TRIGGER reject_delete BEFORE DELETE ON games WHEN OLD.id = 2
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        ).unwrap();
        assert!(delete_game_records(&mut conn, &[1, 2]).is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn imports_with_progress_and_skips_duplicates() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("2002 FIFA World Cup (USA).iso.gz"), "").unwrap();
        fs::write(folder.0.join("Sonic (USA).ISO"), "").unwrap();
        fs::write(folder.0.join("readme.txt"), "").unwrap();
        fs::create_dir(folder.0.join("directory.iso")).unwrap();
        let mut conn = database();
        let mut progress = Vec::new();
        let extensions = Some(vec![".iso".into(), ".gz".into()]);
        let result = scan_roms(&mut conn, folder.path(), "PS2", extensions.clone(), |p| progress.push(p)).unwrap();
        assert_eq!(result.total_found, 2);
        assert_eq!(result.added_count, 2);
        assert_eq!(result.skipped_count, 0);
        assert_eq!(progress.first().unwrap().phase, "discovering");
        let final_progress = progress.last().unwrap();
        assert_eq!(final_progress.phase, "done");
        assert_eq!(final_progress.processed, 2);
        assert_eq!(final_progress.total, Some(2));
        assert_eq!(final_progress.added_count, 2);
        let importing: Vec<_> = progress.iter().filter(|p| p.phase == "importing").collect();
        assert!(importing.windows(2).all(|pair| pair[0].processed <= pair[1].processed));
        let title: String = conn.query_row("SELECT title FROM games WHERE rom_path LIKE '%.gz'", [], |row| row.get(0)).unwrap();
        assert_eq!(title, "2002 FIFA World Cup");
        let result = scan_roms(&mut conn, folder.path(), "PS2", extensions, |_| {}).unwrap();
        assert_eq!(result.added_count, 0);
        assert_eq!(result.skipped_count, 2);
    }

    #[test]
    fn empty_folder_finishes_and_invalid_folder_returns_error() {
        let folder = ScanFolder::new();
        let mut conn = database();
        let mut progress = Vec::new();
        let result = scan_roms(&mut conn, folder.path(), "PS2", None, |p| progress.push(p)).unwrap();
        assert_eq!(result.total_found, 0);
        assert_eq!(progress.last().unwrap().phase, "done");
        let missing = folder.0.join("missing");
        assert!(scan_roms(&mut conn, missing.to_str().unwrap(), "PS2", None, |_| {}).is_err());
    }

    #[test]
    fn database_errors_roll_back_instead_of_counting_as_duplicates() {
        let folder = ScanFolder::new();
        fs::write(folder.0.join("good.iso"), "").unwrap();
        fs::write(folder.0.join("bad.iso"), "").unwrap();
        let mut conn = database();
        conn.execute_batch("CREATE TRIGGER reject_import BEFORE INSERT ON games WHEN NEW.title = 'bad'
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        let mut progress = Vec::new();
        assert!(scan_roms(&mut conn, folder.path(), "PS2", None, |p| progress.push(p)).is_err());
        assert!(progress.iter().all(|p| p.phase != "done"));
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}

#[cfg(test)]
mod rom_title_tests {
    use super::*;

    #[test]
    fn removes_compound_extensions_and_rom_tags() {
        for (filename, expected) in [
            ("2002 FIFA World Cup (USA) (En,Es).iso.gz", "2002 FIFA World Cup"),
            ("Game (USA) [!].ISO.GZ", "Game"),
            ("Sonic (USA).md.zip", "Sonic"),
            ("Game (Europe).nkit.iso", "Game"),
            ("Game (USA).iso.gz.zip", "Game"),
            ("Game.iso (USA).gz", "Game"),
            ("Halo (USA).xiso.iso", "Halo"),
            ("Halo (USA).XISO.ISO", "Halo"),
            ("Zelda (Europe).zcci", "Zelda"),
            ("Zelda (Europe).zcci.gz", "Zelda"),
        ] {
            let stem = Path::new(filename).file_stem().unwrap().to_str().unwrap();
            assert_eq!(clean_rom_title(stem), expected, "{filename}");
        }
    }

    #[test]
    fn preserves_titles_with_dots_and_existing_cleanup() {
        for (filename, expected) in [
            ("Dr. Mario (USA).nes", "Dr. Mario"),
            ("Super Mario Bros. (World).nes", "Super Mario Bros."),
            ("Version 1.2 (USA).iso.gz", "Version 1.2"),
            ("Game.v1 (USA).iso.gz", "Game.v1"),
            ("Fútbol_2002-Edición (USA).iso.gz", "Fútbol 2002 Edición"),
            ("Sonic (USA) [!].md", "Sonic"),
            ("Game.zip", "Game"),
        ] {
            let stem = Path::new(filename).file_stem().unwrap().to_str().unwrap();
            assert_eq!(clean_rom_title(stem), expected, "{filename}");
        }
    }
}

#[cfg(test)]
mod platform_tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games (platform TEXT NOT NULL);
             CREATE TABLE emulators (platform TEXT NOT NULL);
             CREATE TABLE platforms (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL UNIQUE,
                 default_extensions TEXT NOT NULL
             );",
        ).unwrap();
        conn
    }

    #[test]
    fn create_validate_and_reject_duplicates_without_replacing() {
        let mut conn = database();
        assert!(save_platform(&mut conn, None, "   ", "").is_err());
        let platform = save_platform(&mut conn, None, "  SNES  ", "").unwrap();
        assert_eq!(platform.name, "SNES");
        assert_eq!(platform.default_extensions, ".iso, .zip, .7z, .bin");
        assert!(save_platform(&mut conn, None, "snes", ".smc").is_err());
        let stored: (i32, String) = conn.query_row(
            "SELECT id, default_extensions FROM platforms", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(stored, (platform.id.unwrap(), platform.default_extensions));
    }

    #[test]
    fn rename_keeps_id_and_updates_games_and_emulators() {
        let mut conn = database();
        let platform = save_platform(&mut conn, None, "SNES", ".smc").unwrap();
        conn.execute("INSERT INTO games VALUES ('snes')", []).unwrap();
        conn.execute("INSERT INTO emulators VALUES ('SNES')", []).unwrap();
        let updated = save_platform(&mut conn, platform.id, "Super Nintendo", ".sfc, .smc").unwrap();
        assert_eq!(updated.id, platform.id);
        for table in ["games", "emulators"] {
            let name: String = conn.query_row(&format!("SELECT platform FROM {}", table), [], |row| row.get(0)).unwrap();
            assert_eq!(name, "Super Nintendo");
        }
        assert_eq!(updated.default_extensions, ".sfc, .smc");
        assert!(save_platform(&mut conn, Some(999), "Missing", "").is_err());
    }

    #[test]
    fn rename_rolls_back_all_changes_if_an_association_fails() {
        let mut conn = database();
        let platform = save_platform(&mut conn, None, "SNES", ".smc").unwrap();
        conn.execute_batch(
            "INSERT INTO games VALUES ('SNES');
             INSERT INTO emulators VALUES ('SNES');
             CREATE TRIGGER reject_rename BEFORE UPDATE ON emulators
             BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        ).unwrap();
        assert!(save_platform(&mut conn, platform.id, "Super Nintendo", ".sfc").is_err());
        let stored: (String, String) = conn.query_row(
            "SELECT name, default_extensions FROM platforms", [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(stored, ("SNES".into(), ".smc".into()));
        let game_platform: String = conn.query_row("SELECT platform FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(game_platform, "SNES");
    }

    #[test]
    fn duplicate_rename_preserves_existing_platforms() {
        let mut conn = database();
        let snes = save_platform(&mut conn, None, "SNES", ".sfc").unwrap();
        save_platform(&mut conn, None, "Genesis", ".md").unwrap();
        assert!(save_platform(&mut conn, snes.id, "genesis", ".bin").is_err());
        let name: String = conn.query_row("SELECT name FROM platforms WHERE id = ?1", [snes.id], |row| row.get(0)).unwrap();
        assert_eq!(name, "SNES");
    }

    #[test]
    fn deletion_blocks_associated_games_and_emulators() {
        let mut conn = database();
        let id = save_platform(&mut conn, None, "SNES", ".sfc").unwrap().id.unwrap();
        conn.execute("INSERT INTO games VALUES ('snes')", []).unwrap();
        assert!(remove_platform(&mut conn, id).is_err());
        conn.execute("DELETE FROM games", []).unwrap();
        conn.execute("INSERT INTO emulators VALUES ('snes')", []).unwrap();
        assert!(remove_platform(&mut conn, id).is_err());
        conn.execute("DELETE FROM emulators", []).unwrap();
        remove_platform(&mut conn, id).unwrap();
        assert!(remove_platform(&mut conn, id).is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn defaults_are_seeded_once_and_legacy_platforms_are_imported() {
        let conn = database();
        conn.execute("DROP TABLE platforms", []).unwrap();
        init_platforms(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0)).unwrap();
        assert!(count > 0);
        conn.execute("DELETE FROM platforms", []).unwrap();
        init_platforms(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
        conn.execute_batch("INSERT INTO games VALUES ('Custom Console'); INSERT INTO emulators VALUES ('custom console');").unwrap();
        init_platforms(&conn).unwrap();
        init_platforms(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM platforms", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}

#[cfg(test)]
mod game_edit_tests {
    use super::*;

    struct MediaDirectory(std::path::PathBuf);
    impl MediaDirectory {
        fn new() -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let root = std::env::temp_dir().join(format!("opencabinet-media-test-{}-{}", std::process::id(), unique));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn image(&self, name: &str) -> String {
            let path = self.0.join(name);
            fs::write(&path, b"\x89PNG\r\n\x1a\nimage contents").unwrap();
            path.to_string_lossy().into_owned()
        }
    }
    impl Drop for MediaDirectory {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE platforms (name TEXT NOT NULL);
             INSERT INTO platforms VALUES ('SNES'), ('Genesis');
             CREATE TABLE games (
                 id INTEGER PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
                 rom_path TEXT NOT NULL, cover_path TEXT, play_time INTEGER,
                 release_date TEXT, developer TEXT, publisher TEXT
             );
             INSERT INTO games VALUES (1, 'Old Title', 'SNES', 'C:/roms/game.sfc', 'cover.png', 42, NULL, NULL, NULL);",
        ).unwrap();
        init_game_images(&conn).unwrap();
        init_game_metadata(&conn).unwrap();
        conn
    }

    fn details() -> GameDetails {
        GameDetails { rom_path:None, order_group:None, box_3d:None, regions:None, variables: None, execution: None, discs: None,
            id: 1, title: "  New Title  ".into(), platform: "genesis".into(),
            release_date: Some("1992-11-24".into()),
            developer: Some("  Developer  ".into()), publisher: Some("Publisher".into()),
            images: None, manuals: None,
            genre: None, game_mode: None, max_players: None, description: None, catalog_id: None,
        }
    }

    #[test]
    fn renamed_catalog_input_still_accepts_previous_saved_requests() {
        let previous:GameDetails=serde_json::from_value(serde_json::json!({"id":1,"title":"Game","platform":"PS2","launch\u{0062}oxId":77})).unwrap();
        let current:GameDetails=serde_json::from_value(serde_json::json!({"id":1,"title":"Game","platform":"PS2","catalogId":88})).unwrap();
        assert_eq!(previous.catalog_id,Some(77));assert_eq!(current.catalog_id,Some(88));
    }

    #[test]
    fn game_box_edits_are_atomic_preserve_omitted_values_and_follow_the_default_region() {
        let mut conn=region_database();
        let mut edit=details();edit.platform="SNES".into();
        edit.box_3d=Some(Some(serde_json::from_str(r##"{"base":{"color":"#cc0011"}}"##).unwrap()));
        save_game_details(&mut conn,edit).unwrap();
        let mut omitted=details();omitted.platform="SNES".into();save_game_details(&mut conn,omitted).unwrap();
        assert!(game_box_settings::read(&conn,1).unwrap().is_some());
        let mut bad=details();bad.platform="SNES".into();bad.title="".into();bad.box_3d=Some(None);
        assert!(save_game_details(&mut conn,bad).is_err());assert!(game_box_settings::read(&conn,1).unwrap().is_some());
        game_regions::merge(&mut conn,&[1,2],1,&region_labels()).unwrap();
        let mut edit=details();edit.platform="SNES".into();edit.regions=Some(game_regions::Settings{parent_id:1,default_id:2,labels:region_labels()});
        save_game_details(&mut conn,edit).unwrap();
        let group=read_library_games(&conn,Path::new("C:/data"),&PlayTracker::default()).unwrap();
        assert!(group[0].box_3d.is_none());assert!(group[0].regions[0].game.box_3d.is_some());
        let mut reset=details();reset.platform="SNES".into();reset.box_3d=Some(None);save_game_details(&mut conn,reset).unwrap();
        assert!(game_box_settings::read(&conn,1).unwrap().is_none());
        let parsed:GameDetails=serde_json::from_value(serde_json::json!({"id":1,"title":"Game","platform":"SNES","box3d":{"base":{"color":"#aabbcc"}}})).unwrap();
        assert!(matches!(parsed.box_3d,Some(Some(_))));
    }

    fn region_database() -> Connection {
        let conn=database();
        conn.execute("INSERT INTO games(id,title,platform,rom_path,play_time_seconds,session_count,last_played) VALUES (2,'Regional title','SNES','C:/roms/Game (USA).chd',600,3,'2026-10-21T10:00:00Z')",[]).unwrap();
        conn.execute("INSERT INTO game_images(game_id,path,kind,position) VALUES (2,'usa.png','cover',0)",[]).unwrap();
        conn.execute("UPDATE games SET play_time=0 WHERE id=2",[]).unwrap();
        conn.execute("UPDATE games SET play_time_seconds=120,session_count=2,last_played='2026-10-20T10:00:00Z' WHERE id=1",[]).unwrap();
        discs::init(&conn).unwrap();game_regions::init(&conn).unwrap();conn
    }
    fn region_labels() -> Vec<game_regions::Label> {
        vec![game_regions::Label{id:1,label:"Europa".into()},game_regions::Label{id:2,label:"USA".into()}]
    }

    #[test]
    fn shared_game_order_is_atomic_with_metadata_and_leaves_statistics_untouched() {
        let mut conn=region_database();let mut edit=details();edit.platform="SNES".into();
        edit.order_group=Some(game_order::Patch{id:None,titles:vec!["Regional title".into(),"New Title".into()]});
        let updated=save_game_details(&mut conn,edit).unwrap();let id=updated.order_group.unwrap().id;
        let games=read_library_games(&conn,Path::new("C:/data"),&PlayTracker::default()).unwrap();
        assert!(games.iter().all(|game|game.order_group.as_ref().unwrap().id==id));
        assert_eq!(games.iter().map(|game|game.play_time_seconds).sum::<i64>(),720);
        assert_eq!(games.iter().map(|game|game.session_count).sum::<i64>(),5);
        let mut invalid=details();invalid.platform="SNES".into();invalid.title="".into();
        invalid.order_group=Some(game_order::Patch{id:Some(id),titles:vec!["New Title".into(),"Regional title".into()]});
        assert!(save_game_details(&mut conn,invalid).is_err());
        assert_eq!(game_order::groups(&conn).unwrap()[0].titles[0],"Regional title");
        let omitted=details();save_game_details(&mut conn,omitted).unwrap();assert_eq!(game_order::groups(&conn).unwrap().len(),1);
    }

    #[test]
    fn regions_keep_media_and_discs_separate_and_default_selection_is_atomic() {
        let mut conn=region_database();
        conn.execute("UPDATE games SET developer='USA Developer',publisher='USA Publisher',release_date='1998-03-01',genre='RPG',game_mode='Single Player',max_players=1,description='USA synopsis' WHERE id=2",[]).unwrap();
        game_regions::merge(&mut conn,&[1,2],1,&region_labels()).unwrap();
        let mut edit=details();edit.platform="SNES".into();edit.regions=Some(game_regions::Settings{parent_id:1,default_id:2,labels:region_labels()});
        save_game_details(&mut conn,edit).unwrap();
        let games=read_library_games(&conn,Path::new("C:/data"),&PlayTracker::default()).unwrap();
        assert_eq!(games.len(),1);let grouped=&games[0];assert_eq!(grouped.id,1);assert_eq!(grouped.default_region_id,Some(2));
        assert_eq!(grouped.title,"Regional title");assert_eq!(grouped.play_time_seconds,720);assert_eq!(grouped.session_count,5);
        assert_eq!(grouped.rom_path,"C:/roms/Game (USA).chd");
        assert_eq!(grouped.regions[0].game.title,"New Title");
        assert_eq!(grouped.developer.as_deref(),Some("USA Developer"));
        assert_eq!(grouped.publisher.as_deref(),Some("USA Publisher"));
        assert_eq!(grouped.release_date.as_deref(),Some("1998-03-01"));
        assert_eq!(grouped.genre.as_deref(),Some("RPG"));
        assert_eq!(grouped.game_mode.as_deref(),Some("Single Player"));
        assert_eq!(grouped.max_players,Some(1));
        assert_eq!(grouped.description.as_deref(),Some("USA synopsis"));
        assert_eq!(grouped.last_played.as_deref(),Some("2026-10-21T10:00:00Z"));
        assert_eq!(grouped.regions.len(),2);assert_eq!(grouped.regions[1].game.discs[0].rom_path,"C:/roms/Game (USA).chd");
        assert!(grouped.regions[1].game.images.iter().any(|image|image.path.ends_with("usa.png")));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM games",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        let mut bad=details();bad.platform="SNES".into();bad.title="Should not save".into();bad.regions=Some(game_regions::Settings{parent_id:1,default_id:999,labels:region_labels()});
        assert!(save_game_details(&mut conn,bad).is_err());
        assert_eq!(conn.query_row("SELECT title FROM games WHERE id=1",[],|r|r.get::<_,String>(0)).unwrap(),"New Title");
        game_regions::save(&conn,1,&game_regions::Settings{parent_id:1,default_id:1,labels:region_labels()}).unwrap();
        let reverted=read_library_games(&conn,Path::new("C:/data"),&PlayTracker::default()).unwrap();
        assert_eq!(reverted[0].title,"New Title");
        assert_eq!(reverted[0].developer.as_deref(),Some("Developer"));
        assert_eq!(reverted[0].description,None);
        assert_eq!(reverted[0].play_time_seconds,720);
        let mut moved=details();moved.platform="Genesis".into();assert!(save_game_details(&mut conn,moved).is_err());
    }

    #[test]
    fn region_launch_validates_membership_then_disc_and_records_only_the_chosen_region() {
        let mut conn=region_database();let files=MediaDirectory::new();
        let europe=files.image("Game (Europe).chd");let usa1=files.image("Game (USA) (Disc 1).chd");let usa2=files.image("Game (USA) (Disc 2).chd");
        discs::replace(&conn,1,&[discs::source(&europe)]).unwrap();discs::replace(&conn,2,&[discs::source(&usa1),discs::source(&usa2)]).unwrap();
        conn.execute_batch("CREATE TABLE emulators(name TEXT,platform TEXT,executable_path TEXT,arguments TEXT);INSERT INTO emulators VALUES ('Test','SNES','emu.exe','--full \"%ROM%\"');").unwrap();
        game_regions::merge(&mut conn,&[1,2],1,&region_labels()).unwrap();
        let target=discs::read(&conn,2).unwrap()[1].id;
        assert!(launch_game_record_with_region(&conn,1,None,None,|_,_,_|Ok(())).is_err());
        assert!(launch_game_record_with_region(&conn,1,Some(77),None,|_,_,_|Ok(())).is_err());
        assert!(launch_game_record_with_region(&conn,1,Some(2),None,|_,_,_|Ok(())).is_err());
        let wrong=discs::read(&conn,1).unwrap()[0].id;
        assert!(launch_game_record_with_region(&conn,1,Some(2),wrong,|_,_,_|Ok(())).is_err());
        let (result,())=launch_game_record_with_region(&conn,1,Some(2),target,|_,args,_|{assert_eq!(args,&["--full".to_string(),usa2.clone()]);Ok(())}).unwrap();
        assert_eq!(result.stats.id,2);assert_eq!(result.stats.session_count,4);
        let combined=game_regions::statistics(&conn,1,result.stats).unwrap();assert_eq!(combined.id,1);assert_eq!(combined.session_count,6);
        assert_eq!(combined.region_statistics.len(),2);
        let europe_stats=combined.region_statistics.iter().find(|s|s.id==1).unwrap();
        let usa_stats=combined.region_statistics.iter().find(|s|s.id==2).unwrap();
        assert_eq!(europe_stats.session_count,2);assert!(!europe_stats.is_running);
        assert_eq!(usa_stats.session_count,4);assert!(usa_stats.is_running);
        fs::remove_file(&usa2).unwrap();
        assert!(launch_game_record_with_region(&conn,1,Some(2),target,|_,_,_|Ok(())).is_err());
        assert_eq!(conn.query_row("SELECT session_count FROM games WHERE id=2",[],|r|r.get::<_,i64>(0)).unwrap(),4);
        assert!(launch_game_record_with_region(&conn,1,Some(1),None,|_,args,_|{assert_eq!(args.last(),Some(&europe));Ok(())}).is_ok());
    }

    #[test]
    fn recomp_merge_preserves_both_versions_and_launches_the_selected_source_with_its_own_arguments() {
        for primary in [1,2] {
            let mut conn=region_database();let files=MediaDirectory::new();
            let rom=files.image("Original (Europe).chd");let executable=files.image("Recomp.exe");
            discs::replace(&conn,1,&[discs::source(&rom)]).unwrap();
            conn.execute("UPDATE games SET launch_directly=1,rom_path=?1,arguments_override='--native-test' WHERE id=2",[&executable]).unwrap();
            conn.execute_batch("CREATE TABLE emulators(name TEXT,platform TEXT,executable_path TEXT,arguments TEXT);INSERT INTO emulators VALUES ('Test','SNES','emu.exe','--full \"%ROM%\"');").unwrap();
            assert!(game_regions::merge_recomp(&mut conn,&[1,2],primary,&region_labels()).is_err());
            entity_variables::save_recomp(&conn,2,true).unwrap();
            game_regions::merge_recomp(&mut conn,&[1,2],primary,&region_labels()).unwrap();
            let library=read_library_games(&conn,&files.0,&PlayTracker::default()).unwrap();
            assert_eq!(library.len(),1);assert_eq!(library[0].id,primary);assert_eq!(library[0].regions.len(),2);
            assert!(library[0].regions.iter().find(|region|region.game.id==2).unwrap().game.recomp);
            assert_eq!(library[0].session_count,5);assert_eq!(library[0].play_time_seconds,720);
            assert!(launch_game_record_with_region(&conn,primary,None,None,|_,_,_|Ok(())).is_err());
            let (result,())=launch_game_record_with_region(&conn,primary,Some(2),None,|path,args,working|{
                assert_eq!(path,executable);assert_eq!(args,&["--native-test"]);assert_eq!(working,Path::new(&executable).parent());Ok(())
            }).unwrap();
            assert_eq!(result.stats.id,2);assert_eq!(result.stats.session_count,4);
            let mut saved=0;playtime::save_elapsed(&conn,2,10,&mut saved,false).unwrap();
            let (result,())=launch_game_record_with_region(&conn,primary,Some(1),None,|path,args,_|{
                assert_eq!(path,"emu.exe");assert_eq!(args,&["--full".to_string(),rom.clone()]);Ok(())
            }).unwrap();assert_eq!(result.stats.id,1);assert_eq!(result.stats.session_count,3);
            assert!(Path::new(&rom).is_file()&&Path::new(&executable).is_file());
            assert_eq!(entity_variables::read(&conn,"game",2).unwrap().get("recomp").map(String::as_str),Some("yes"));
        }
    }

    #[test]
    fn recomp_merge_rejects_other_platforms_native_only_entries_and_store_launchers_without_partial_groups() {
        let mut conn=region_database();entity_variables::save_recomp(&conn,2,true).unwrap();
        conn.execute("UPDATE games SET launch_directly=1,rom_path='Native.exe',platform='Other' WHERE id=2",[]).unwrap();
        assert!(game_regions::merge_recomp(&mut conn,&[1,2],1,&region_labels()).is_err());
        conn.execute("UPDATE games SET platform='SNES' WHERE id=2",[]).unwrap();
        conn.execute("UPDATE games SET launch_directly=1 WHERE id=1",[]).unwrap();entity_variables::save_recomp(&conn,1,true).unwrap();
        assert!(game_regions::merge_recomp(&mut conn,&[1,2],1,&region_labels()).is_err());
        conn.execute("UPDATE games SET launch_directly=0 WHERE id=1",[]).unwrap();conn.execute("UPDATE games SET rom_path=?1 WHERE id=2",[steam::uri(10)]).unwrap();
        assert!(game_regions::merge_recomp(&mut conn,&[1,2],1,&region_labels()).is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM game_regions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn several_recomps_can_merge_at_once_or_join_an_existing_group_and_keep_independent_launches() {
        for gradual in [false,true] {
            let mut conn=region_database();let files=MediaDirectory::new();
            let first=files.image("First.exe");let second=files.image("Second.exe");
            conn.execute("UPDATE games SET launch_directly=1,rom_path=?1,arguments_override='--first' WHERE id=2",[&first]).unwrap();
            conn.execute("INSERT INTO games(id,title,platform,rom_path,launch_directly,arguments_override,play_time,play_time_seconds,session_count) VALUES(3,'Second recomp','SNES',?1,1,'--second',1,90,2)",[&second]).unwrap();
            for id in [2,3]{entity_variables::save_recomp(&conn,id,true).unwrap();}
            let mut labels=region_labels();labels[1].label="My first build".into();
            if gradual{game_regions::merge_recomp(&mut conn,&[1,2],1,&labels).unwrap();}
            labels.push(game_regions::Label{id:3,label:"My second build".into()});
            game_regions::merge_recomp(&mut conn,if gradual{&[1,3]}else{&[1,2,3]},1,&labels).unwrap();
            let library=read_library_games(&conn,&files.0,&PlayTracker::default()).unwrap();
            assert_eq!(library.len(),1);assert_eq!(library[0].regions.len(),3);assert_eq!(library[0].session_count,7);assert_eq!(library[0].play_time_seconds,810);
            assert_eq!(library[0].regions[1].label,"My first build");
            for (id,path,arg) in [(2,&first,"--first"),(3,&second,"--second")] {
                let (result,())=launch_game_record_with_region(&conn,1,Some(id),None,|exe,args,_|{assert_eq!(exe,path);assert_eq!(args,&[arg]);Ok(())}).unwrap();
                assert_eq!(result.stats.id,id);let mut saved=0;playtime::save_elapsed(&conn,id,5,&mut saved,false).unwrap();
            }
            assert_eq!(conn.query_row("SELECT session_count FROM games WHERE id=1",[],|r|r.get::<_,i64>(0)).unwrap(),2);
            assert_eq!(conn.query_row("SELECT session_count FROM games WHERE id=2",[],|r|r.get::<_,i64>(0)).unwrap(),4);
            assert_eq!(conn.query_row("SELECT session_count FROM games WHERE id=3",[],|r|r.get::<_,i64>(0)).unwrap(),3);
            // An invalid extra build must leave all existing associations intact.
            conn.execute("INSERT INTO games(id,title,platform,rom_path,launch_directly,play_time) VALUES(4,'Unmarked','SNES','Unmarked.exe',1,0)",[]).unwrap();
            labels.push(game_regions::Label{id:4,label:"Unmarked".into()});
            assert!(game_regions::merge_recomp(&mut conn,&[1,4],1,&labels).is_err());
            assert_eq!(game_regions::expanded(&conn,&[1]).unwrap(),vec![1,2,3]);
            assert!(game_regions::merge_recomp(&mut conn,&[1,2],1,&labels).is_err());
        }
    }

    #[test]
    fn regrouping_and_invalid_merges_preserve_every_regional_record_and_statistics() {
        let mut conn=region_database();game_regions::merge(&mut conn,&[1,2],1,&region_labels()).unwrap();
        conn.execute("INSERT INTO games(id,title,platform,rom_path,play_time_seconds,session_count) VALUES (3,'Japan','Genesis','C:/Game (Japan).chd',20,1)",[]).unwrap();
        conn.execute("UPDATE games SET play_time=0 WHERE id=3",[]).unwrap();
        discs::init(&conn).unwrap();let mut labels=region_labels();labels.push(game_regions::Label{id:3,label:"Japón".into()});
        assert!(game_regions::merge(&mut conn,&[1,3],2,&labels).is_err());
        assert_eq!(game_regions::owner(&conn,2).unwrap(),1);
        conn.execute("UPDATE games SET platform='SNES' WHERE id=3",[]).unwrap();
        game_regions::merge(&mut conn,&[1,3],2,&labels).unwrap();
        assert_eq!(game_regions::expanded(&conn,&[2]).unwrap(),vec![1,2,3]);
        let games=read_library_games(&conn,Path::new("C:/data"),&PlayTracker::default()).unwrap();
        assert_eq!(games.len(),1);assert_eq!(games[0].id,2);assert_eq!(games[0].session_count,6);assert_eq!(games[0].play_time_seconds,740);
        assert_eq!(delete_game_records(&mut conn,&[2]).unwrap(),1);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM games",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM game_discs",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM game_regions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn regional_configuration_survives_reopening_without_touching_media_or_manifests() {
        let mut conn=region_database();let files=MediaDirectory::new();
        let manual=files.0.join("manual.pdf");fs::write(&manual,b"%PDF manual").unwrap();
        let manifest=files.0.join("manifest.json");fs::write(&manifest,b"preserved collection").unwrap();
        let before=fs::read(&manual).unwrap();
        game_regions::merge(&mut conn,&[1,2],1,&region_labels()).unwrap();
        let settings=game_regions::Settings{parent_id:1,default_id:2,labels:region_labels()};game_regions::save(&conn,1,&settings).unwrap();
        let backup=files.0.join("library.sqlite");conn.execute("VACUUM INTO ?1",[backup.to_string_lossy().as_ref()]).unwrap();
        let reopened=Connection::open(&backup).unwrap();
        let games=read_library_games(&reopened,&files.0,&PlayTracker::default()).unwrap();
        assert_eq!(games.len(),1);assert_eq!(games[0].default_region_id,Some(2));assert_eq!(games[0].regions[0].label,"Europa");
        assert_eq!(fs::read(manual).unwrap(),before);assert_eq!(fs::read(manifest).unwrap(),b"preserved collection");
    }

    #[test]
    fn game_variable_edits_are_atomic_and_omitted_variables_are_preserved() {
        let mut conn = database();
        let variables = entity_variables::Variables::from([("favorito".into(),"yes".into())]);
        let mut edit = details(); edit.variables = Some(variables.clone());
        save_game_details(&mut conn,edit).unwrap();
        assert_eq!(entity_variables::read(&conn,"game",1).unwrap(),variables);
        let mut edit = details(); edit.title = "Another title".into();
        save_game_details(&mut conn,edit).unwrap();
        assert_eq!(entity_variables::read(&conn,"game",1).unwrap(),variables);
        let mut invalid = details(); invalid.title = "Must roll back".into();
        invalid.variables = Some(entity_variables::Variables::from([("Invalid Name".into(),"no".into())]));
        assert!(save_game_details(&mut conn,invalid).is_err());
        assert_eq!(conn.query_row("SELECT title FROM games WHERE id=1",[],|r|r.get::<_,String>(0)).unwrap(),"Another title");
        assert_eq!(entity_variables::read(&conn,"game",1).unwrap(),variables);
    }

    #[test]
    fn library_batch_read_keeps_game_and_image_order_and_sessions_without_opening_image_files() {
        let conn = database(); let root = MediaDirectory::new();
        conn.execute_batch("INSERT INTO games(id,title,platform,rom_path,play_time) VALUES (2,'AAA','Genesis','second.md',0);
            DELETE FROM game_images;
            INSERT INTO game_images VALUES (1,'images/missing-disc.png','disc',10), (1,'images/missing-cover.png','cover',5), (999,'orphan.png','cover',0);
            UPDATE games SET cover_path='images/missing-cover.png',developer='Developer' WHERE id=1;").unwrap();
        let external = root.0.join("missing.png").to_string_lossy().into_owned();
        conn.execute("INSERT INTO game_images VALUES (2,?1,'cover',0)",[&external]).unwrap();
        let tracker = PlayTracker::default(); let _session = tracker.reserve(1).unwrap();
        let games = read_library_games(&conn,&root.0,&tracker).unwrap();
        assert_eq!(games.len(),2); assert_eq!(games[0].id,2); assert_eq!(games[1].id,1);
        assert!(!games[0].is_running); assert!(games[1].is_running);
        assert_eq!(games[1].developer.as_deref(),Some("Developer")); assert_eq!(games[1].play_time,42);
        assert_eq!(games[1].images.iter().map(|i|i.kind.as_str()).collect::<Vec<_>>(),vec!["cover","disc"]);
        assert_eq!(games[0].images[0].path,external);
        assert_eq!(games[1].cover_path.as_deref(),Some(root.0.join("images/missing-cover.png").to_string_lossy().as_ref()));
        assert!(games[1].images.iter().all(|image|!Path::new(&image.path).exists()));
    }

    #[test]
    fn detailed_metadata_can_be_saved_cleared_and_migrated_without_losing_history() {
        let mut conn = database();
        conn.execute("UPDATE games SET last_played = '2026-10-16T12:00:00.000Z' WHERE id = 1", []).unwrap();
        let mut edit = details();
        edit.genre = Some("  Deportes  ".into());
        edit.game_mode = Some("Cooperativo".into());
        edit.max_players = Some(4);
        edit.description = Some("  Una sinopsis.\nSegunda línea.  ".into());
        let game = save_game_details(&mut conn, edit).unwrap();
        assert_eq!(game.genre.as_deref(), Some("Deportes"));
        assert_eq!(game.game_mode.as_deref(), Some("Cooperativo"));
        assert_eq!(game.max_players, Some(4));
        assert_eq!(game.description.as_deref(), Some("Una sinopsis.\nSegunda línea."));
        assert_eq!(game.last_played.as_deref(), Some("2026-10-16T12:00:00.000Z"));
        assert_eq!(game.play_time, 42);
        init_game_metadata(&conn).unwrap();
        init_game_metadata(&conn).unwrap();
        let genre: String = conn.query_row("SELECT genre FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(genre, "Deportes");
        let game = save_game_details(&mut conn, details()).unwrap();
        assert!(game.genre.is_none());
        assert!(game.game_mode.is_none());
        assert!(game.max_players.is_none());
        assert!(game.description.is_none());
        assert_eq!(game.last_played.as_deref(), Some("2026-10-16T12:00:00.000Z"));
    }

    #[test]
    fn metadata_selection_is_saved_atomically_and_ordinary_edits_keep_the_link() {
        let mut conn = database();
        metadata::init_library_schema(&conn).unwrap();
        let mut edit = details(); edit.catalog_id = Some(77);
        let saved = save_game_details(&mut conn, edit).unwrap();
        assert_eq!(saved.play_time_seconds, 42 * 60);
        let linked = || conn.query_row("SELECT launch\u{0062}ox_id FROM games WHERE id=1", [], |row| row.get::<_, i64>(0)).unwrap();
        assert_eq!(linked(), 77);
        save_game_details(&mut conn, details()).unwrap();
        assert_eq!(conn.query_row("SELECT launch\u{0062}ox_id FROM games WHERE id=1", [], |row| row.get::<_, i64>(0)).unwrap(), 77);
        let mut invalid = details(); invalid.catalog_id = Some(-1);
        assert!(save_game_details(&mut conn, invalid).is_err());
        let mut invalid = details(); invalid.catalog_id = Some(88);
        invalid.images = Some(vec![GameImage { path: "invalid".into(), kind: "invalid".into() }]);
        assert!(save_game_details(&mut conn, invalid).is_err());
        assert_eq!(conn.query_row("SELECT launch\u{0062}ox_id FROM games WHERE id=1", [], |row| row.get::<_, i64>(0)).unwrap(), 77);
    }

    #[test]
    fn invalid_player_count_does_not_change_the_game() {
        let mut conn = database();
        for count in [0, -1] {
            let mut edit = details();
            edit.max_players = Some(count);
            assert!(save_game_details(&mut conn, edit).is_err());
        }
        let title: String = conn.query_row("SELECT title FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(title, "Old Title");
    }

    #[test]
    fn execution_overrides_save_atomically_inherit_defaults_and_keep_disc_arguments() {
        let root = MediaDirectory::new();
        let first = root.image("Game (Disc 1).chd");
        let second = root.image("Game (Disc 2).chd");
        let mut conn = database();
        conn.execute_batch("CREATE TABLE emulators(id INTEGER PRIMARY KEY, platform TEXT, executable_path TEXT, arguments TEXT);
            INSERT INTO emulators VALUES(1,'SNES','first.exe','--default \"%ROM%\"'),(2,'SNES','second.exe','--second \"%ROM%\"'),(3,'Genesis','foreign.exe','%ROM%');").unwrap();
        game_execution::init_schema(&conn).unwrap();
        conn.execute("UPDATE games SET rom_path=?1",[&first]).unwrap();
        discs::init(&conn).unwrap();
        discs::replace(&conn,1,&[discs::source(&first),discs::source(&second)]).unwrap();
        let mut edit = details(); edit.platform="SNES".into();
        edit.execution=Some(game_execution::ExecutionOptions { emulator_id:Some(2),arguments:Some("--custom \"%ROM%\"".into()) , linux: None });
        let saved=save_game_details(&mut conn,edit).unwrap();
        assert_eq!(saved.execution.emulator_id,Some(2));
        let disc=discs::read(&conn,1).unwrap()[1].id;
        launch_game_record_with_disc(&conn,1,disc,|exe,args,_|{
            assert_eq!(exe,"second.exe"); assert_eq!(args,&["--custom".to_string(),second.clone()]); Ok(())
        }).unwrap();
        let mut edit=details(); edit.platform="SNES".into();
        edit.execution=Some(game_execution::ExecutionOptions { emulator_id:Some(3),arguments:None , linux: None });
        assert!(save_game_details(&mut conn,edit).is_err());
        assert_eq!(game_execution::read(&conn,1).unwrap().emulator_id,Some(2));
        let mut edit=details(); edit.platform="SNES".into();
        edit.execution=Some(game_execution::ExecutionOptions { emulator_id:Some(2),arguments:None , linux: None });
        save_game_details(&mut conn,edit).unwrap();
        launch_game_record_with_disc(&conn,1,disc,|exe,args,_|{
            assert_eq!(exe,"second.exe"); assert_eq!(args,&["--second".to_string(),second.clone()]); Ok(())
        }).unwrap();
        let mut edit=details(); edit.platform="SNES".into(); edit.execution=Some(Default::default());
        save_game_details(&mut conn,edit).unwrap();
        launch_game_record_with_disc(&conn,1,disc,|exe,args,_|{
            assert_eq!(exe,"first.exe"); assert_eq!(args,&["--default".to_string(),second.clone()]); Ok(())
        }).unwrap();
        assert_eq!(game_execution::folders(&conn,1).unwrap(),vec![root.0.canonicalize().unwrap()]);
        fs::create_dir(root.0.join("second-folder")).unwrap();
        let moved=root.0.join("second-folder/disc.chd"); fs::rename(&second,&moved).unwrap();
        discs::replace(&conn,1,&[discs::source(&first),discs::source(&moved.to_string_lossy())]).unwrap();
        assert_eq!(game_execution::folders(&conn,1).unwrap().len(),2);
        fs::remove_dir_all(root.0.join("second-folder")).unwrap();
        assert!(game_execution::folders(&conn,1).is_err());
    }

    #[test]
    fn execution_migration_and_emulator_removal_preserve_defaults_and_arguments() {
        let conn=database();
        conn.execute_batch("CREATE TABLE emulators(id INTEGER PRIMARY KEY,platform TEXT);
            INSERT INTO emulators VALUES(1,'SNES'),(2,'SNES');").unwrap();
        game_execution::init_schema(&conn).unwrap();
        game_execution::save(&conn,1,"SNES",&game_execution::ExecutionOptions{emulator_id:Some(2),arguments:Some(String::new()), linux: None }).unwrap();
        init_game_metadata(&conn).unwrap();
        assert_eq!(game_execution::read(&conn,1).unwrap().arguments.as_deref(),Some(""));
        conn.execute("UPDATE games SET platform='Super Nintendo'",[]).unwrap();
        conn.execute("UPDATE emulators SET platform='Super Nintendo'",[]).unwrap();
        assert_eq!(game_execution::read(&conn,1).unwrap().emulator_id,Some(2));
        conn.execute("UPDATE emulators SET platform='Genesis' WHERE id=2",[]).unwrap();
        assert_eq!(game_execution::read(&conn,1).unwrap().emulator_id,None);
        game_execution::save(&conn,1,"Super Nintendo",&game_execution::ExecutionOptions{emulator_id:Some(1),arguments:None, linux: None }).unwrap();
        conn.execute("DELETE FROM emulators WHERE id=1",[]).unwrap();
        assert_eq!(game_execution::read(&conn,1).unwrap().emulator_id,None);
        conn.execute("UPDATE games SET launch_directly=1,rom_path='steam://run/42'",[]).unwrap();
        assert!(game_execution::save(&conn,1,"PC",&game_execution::ExecutionOptions{emulator_id:None,arguments:Some("--windowed".into()), linux: None }).is_err());
    }

    #[test]
    fn successful_launch_records_utc_timestamp_without_changing_play_time() {
        let conn = database();
        conn.execute_batch("CREATE TABLE emulators (platform TEXT, executable_path TEXT, arguments TEXT);
            INSERT INTO emulators VALUES ('SNES', 'emulator.exe', '%ROM%');").unwrap();
        let (result, ()) = launch_game_record(&conn, 1, |executable, args, _| {
            assert_eq!(executable, "emulator.exe");
            assert_eq!(args, &["C:/roms/game.sfc"]);
            Ok(())
        }).unwrap();
        assert!(result.stats.last_played.as_ref().unwrap().ends_with('Z'));
        assert!(result.stats.last_played.as_ref().unwrap().contains('T'));
        let stored: (String, i32) = conn.query_row("SELECT last_played, play_time FROM games WHERE id = 1", [],
            |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(Some(stored.0), result.stats.last_played);
        assert_eq!(stored.1, 42);
        assert_eq!(result.stats.session_count, 1);
        assert_eq!(result.stats.play_time_seconds, 42 * 60);
    }

    #[test]
    fn emulator_templates_keep_spaced_rom_paths_as_one_argument_with_or_without_quotes() {
        let conn=database();
        conn.execute_batch("CREATE TABLE emulators (platform TEXT, executable_path TEXT, arguments TEXT);
            INSERT INTO emulators VALUES ('SNES', 'emulator.exe', '');").unwrap();
        let rom="C:/Juegos con espacios/It's a Game (USA).sfc";
        conn.execute("UPDATE games SET rom_path=?1",[rom]).unwrap();
        for (template,expected) in [
            ("--fullscreen \"%ROM%\"",vec!["--fullscreen".to_string(),rom.to_string()]),
            ("--fullscreen %ROM%",vec!["--fullscreen".to_string(),rom.to_string()]),
            ("--exec=\"%ROM%\"",vec![format!("--exec={rom}")]),
        ] {
            conn.execute("UPDATE emulators SET arguments=?1",[template]).unwrap();
            launch_game_record(&conn,1,|_,args,_|{assert_eq!(args,expected);Ok(())}).unwrap();
        }
    }

    #[test]
    fn failed_launch_preserves_previous_timestamp() {
        let conn = database();
        conn.execute_batch("CREATE TABLE emulators (platform TEXT, executable_path TEXT, arguments TEXT);
            INSERT INTO emulators VALUES ('SNES', 'missing.exe', '%ROM%');
            UPDATE games SET last_played = '2026-10-16T12:00:00.000Z' WHERE id = 1;").unwrap();
        assert!(launch_game_record(&conn, 1, |_, _, _| Err::<(), _>("Cannot start emulator".into())).is_err());
        let stored: String = conn.query_row("SELECT last_played FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(stored, "2026-10-16T12:00:00.000Z");
        let count: i64 = conn.query_row("SELECT session_count FROM games", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn play_time_migration_preserves_legacy_minutes_and_does_not_run_twice() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games (id INTEGER PRIMARY KEY, play_time INTEGER);
            INSERT INTO games VALUES (1, 42), (2, NULL);").unwrap();
        init_game_metadata(&conn).unwrap();
        let seconds: i64 = conn.query_row("SELECT play_time_seconds FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(seconds, 42 * 60);
        conn.execute("UPDATE games SET play_time_seconds = 2527, session_count = 3 WHERE id = 1", []).unwrap();
        init_game_metadata(&conn).unwrap();
        let stats: (i64, i64) = conn.query_row("SELECT play_time_seconds, session_count FROM games WHERE id = 1", [],
            |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(stats, (2527, 3));
        let seconds: i64 = conn.query_row("SELECT play_time_seconds FROM games WHERE id = 2", [], |row| row.get(0)).unwrap();
        assert_eq!(seconds, 0);
    }

    #[test]
    fn saves_classified_images_as_portable_copies_and_reuses_them_on_edit() {
        let directory = MediaDirectory::new();
        let root = directory.0.join("library");
        let cover = directory.image("cover.PNG");
        let logo = directory.image("logo.png");
        let screenshot = directory.image("screenshot.png");
        let mut conn = database();
        let mut edit = details();
        edit.images = Some(vec![
            GameImage { path: cover.clone(), kind: "cover".into() },
            GameImage { path: logo.clone(), kind: "logo".into() },
            GameImage { path: screenshot.clone(), kind: "screenshot".into() },
        ]);
        let saved = save_game_with_media(&mut conn, edit, &root).unwrap();
        assert_eq!(saved.images.len(), 3);
        assert_eq!(saved.cover_path.as_deref(), Some(saved.images[0].path.as_str()));
        for image in &saved.images {
            assert!(Path::new(&image.path).starts_with(root.join("images")));
            assert!(Path::new(&image.path).is_file());
        }
        assert!(Path::new(&cover).is_file());
        let stored = read_game_images(&conn, 1).unwrap();
        let collection_dir: String = conn.query_row("SELECT directory FROM media_collections WHERE id=(SELECT media_collection_id FROM games WHERE id=1)",[],|r|r.get(0)).unwrap();
        assert!(stored.iter().all(|image| image.path.starts_with(&format!("{collection_dir}/"))));
        let mut edit = details();
        edit.images = Some(saved.images.clone());
        let again = save_game_with_media(&mut conn, edit, &root).unwrap();
        assert_eq!(again.images[0].path, saved.images[0].path);
        assert_eq!(fs::read_dir(root.join(&collection_dir)).unwrap().filter_map(Result::ok).filter(|entry|entry.path().extension().is_some_and(|e|e=="png")).count(), 3);
        assert!(root.join(&collection_dir).join("manifest.json").is_file());
        // La biblioteca puede moverse: las rutas persistidas son relativas.
        let mut moved = again;
        moved.images = stored;
        moved.cover_path = Some(moved.images[0].path.clone());
        let new_root = directory.0.join("moved-library");
        hydrate_game_images(&mut moved, &new_root);
        assert!(Path::new(&moved.images[0].path).starts_with(new_root));
    }

    #[test]
    fn cartridge_label_survives_portable_save_and_manifest_serialization() {
        let directory = MediaDirectory::new();
        let root = directory.0.join("library");
        let label = directory.image("sticker.png");
        let mut conn = database();
        let mut edit = details();
        edit.images = Some(vec![GameImage { path: label.clone(), kind: "cart_label".into() }]);
        let saved = save_game_with_media(&mut conn, edit, &root).unwrap();
        assert_eq!(saved.images[0].kind, "cart_label");
        assert!(Path::new(&saved.images[0].path).is_file());
        assert!(Path::new(&label).is_file());
        assert_eq!(read_game_images(&conn, 1).unwrap()[0].kind, "cart_label");
        let collection_dir: String = conn.query_row("SELECT directory FROM media_collections WHERE id=(SELECT media_collection_id FROM games WHERE id=1)", [], |row| row.get(0)).unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&fs::read(root.join(collection_dir).join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["images"][0]["kind"], "cart_label");
    }

    #[test]
    fn inlay_survives_portable_save_and_manifest_serialization() {
        let directory = MediaDirectory::new();
        let root = directory.0.join("library");
        let original = directory.image("inlay.png");
        let mut conn = database();
        let mut edit = details();
        edit.images = Some(vec![GameImage { path: original.clone(), kind: "inlay".into() }]);
        let saved = save_game_with_media(&mut conn, edit, &root).unwrap();
        assert_eq!(saved.images[0].kind, "inlay");
        assert!(Path::new(&saved.images[0].path).is_file());
        assert!(Path::new(&original).is_file());
        assert_eq!(read_game_images(&conn, 1).unwrap()[0].kind, "inlay");
        let collection_dir: String = conn.query_row("SELECT directory FROM media_collections WHERE id=(SELECT media_collection_id FROM games WHERE id=1)", [], |row| row.get(0)).unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&fs::read(root.join(collection_dir).join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["images"][0]["kind"], "inlay");
    }

    #[test]
    fn removing_images_updates_the_cover_and_survives_schema_initialization() {
        let directory = MediaDirectory::new();
        let root = directory.0.join("library");
        let original = directory.image("cover.png");
        let mut conn = database();
        let mut edit = details();
        edit.images = Some(vec![GameImage { path: original.clone(), kind: "cover".into() }]);
        let saved = save_game_with_media(&mut conn, edit, &root).unwrap();
        let copy = saved.images[0].path.clone();
        let mut edit = details();
        edit.images = Some(Vec::new());
        let saved = save_game_with_media(&mut conn, edit, &root).unwrap();
        assert!(saved.cover_path.is_none());
        assert!(saved.images.is_empty());
        init_game_images(&conn).unwrap();
        assert!(read_game_images(&conn, 1).unwrap().is_empty());
        assert!(Path::new(&original).is_file());
        assert!(Path::new(&copy).is_file());
    }

    #[test]
    fn failed_save_discards_new_copies_and_preserves_existing_game() {
        let directory = MediaDirectory::new();
        let root = directory.0.join("library");
        let original = directory.image("new.png");
        let mut conn = database();
        let mut edit = details();
        edit.title = "   ".into();
        edit.images = Some(vec![GameImage { path: original.clone(), kind: "cover".into() }]);
        assert!(save_game_with_media(&mut conn, edit, &root).is_err());
        assert_eq!(fs::read_dir(root.join("images")).unwrap().filter_map(Result::ok)
            .flat_map(|entry|fs::read_dir(entry.path()).unwrap()).count(), 0);
        assert!(Path::new(&original).is_file());
        assert_eq!(read_game_images(&conn, 1).unwrap()[0].path, "cover.png");
        let title: String = conn.query_row("SELECT title FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(title, "Old Title");
    }

    #[test]
    fn rejects_invalid_images_and_allows_multiple_cover_and_logo_variants() {
        let make = |path: &str, kind: &str| GameImage { path: path.into(), kind: kind.into() };
        assert!(validate_game_images(&[make("one.png", "invalid")]).is_err());
        assert!(validate_game_images(&[make("one.png", "cover"), make("two.png", "cover")]).is_ok());
        assert!(validate_game_images(&[make("one.png", "logo"), make("two.png", "logo")]).is_ok());
        assert!(validate_game_images(&[make("one.png", "screenshot"), make("one.png", "other")]).is_err());
        let directory = MediaDirectory::new();
        let fake = directory.0.join("fake.png");
        fs::write(&fake, "not an image").unwrap();
        assert!(image_extension(&fake).is_err());
    }

    #[test]
    fn migrates_legacy_cover_once_and_deletes_image_records_with_game() {
        let conn = database();
        init_game_images(&conn).unwrap();
        let images = read_game_images(&conn, 1).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].path, "cover.png");
        assert_eq!(images[0].kind, "cover");
        conn.execute("DELETE FROM games WHERE id = 1", []).unwrap();
        assert!(read_game_images(&conn, 1).unwrap().is_empty());
    }

    #[test]
    fn persists_metadata_and_preserves_rom_cover_and_play_time() {
        let mut conn = database();
        let game = save_game_details(&mut conn, details()).unwrap();
        assert_eq!(game.title, "New Title");
        assert_eq!(game.platform, "Genesis");
        assert_eq!(game.release_date.as_deref(), Some("1992-11-24"));
        assert_eq!(game.developer.as_deref(), Some("Developer"));
        assert_eq!(game.publisher.as_deref(), Some("Publisher"));
        assert_eq!(game.rom_path, "C:/roms/game.sfc");
        assert_eq!(game.cover_path.as_deref(), Some("cover.png"));
        assert_eq!(game.play_time, 42);
        let stored: String = conn.query_row("SELECT title FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(stored, "New Title");
    }

    #[test]
    fn optional_metadata_can_be_cleared() {
        let mut conn = database();
        save_game_details(&mut conn, details()).unwrap();
        let mut edit = details();
        edit.release_date = Some("  ".into());
        edit.developer = None;
        edit.publisher = Some("".into());
        let game = save_game_details(&mut conn, edit).unwrap();
        assert!(game.release_date.is_none());
        assert!(game.developer.is_none());
        assert!(game.publisher.is_none());
    }

    #[test]
    fn invalid_edits_leave_the_game_unchanged() {
        let mut conn = database();
        let mut edit = details();
        edit.title = "  ".into();
        assert!(save_game_details(&mut conn, edit).is_err());
        let mut edit = details();
        edit.platform = "Missing".into();
        assert!(save_game_details(&mut conn, edit).is_err());
        let mut edit = details();
        edit.release_date = Some("2025-02-29".into());
        assert!(save_game_details(&mut conn, edit).is_err());
        let mut edit = details();
        edit.id = 999;
        assert!(save_game_details(&mut conn, edit).is_err());
        let stored: String = conn.query_row("SELECT title FROM games WHERE id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(stored, "Old Title");
    }

    #[test]
    fn validates_calendar_dates() {
        for date in ["1992-11-24", "2000-02-29", "2024-02-29", "0001-01-01"] {
            assert!(valid_release_date(date), "{date}");
        }
        for date in ["1900-02-29", "2025-02-29", "2024-04-31", "2024-13-01", "2024-00-01", "2024-01-00", "0000-01-01", "24-1-1", "not-a-date"] {
            assert!(!valid_release_date(date), "{date}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    i18n::initialize();
    if let Err(error) = storage::initialize() {
        rfd::MessageDialog::new().set_title(crate::i18n::text("msg.47dd28ae40"))
            .set_description(&error).set_level(rfd::MessageLevel::Error).show();
        return;
    }
    i18n::initialize();
    // Storage holds its instance lock and has completed any data move. Clean
    // before creating a webview so no download command can run concurrently.
    if let Ok(root) = data_directory() {
        for error in temporary_files::cleanup(&root) {
            eprintln!("{}: {}", crate::i18n::text("cleanup.warning"), error);
        }
    }
    let mut context = tauri::generate_context!();
    #[cfg(target_os="linux")]
    if let Ok((configuration,_))=platform_runtime::locations() {
        // Keep the webview profile stable when the game library is relocated.
        for window in &mut context.config_mut().app.windows {
            window.data_directory=Some(configuration.join("webview"));
        }
    }
    #[cfg(windows)]
    if let Some(profile) = branding::legacy_webview_directory() {
        for window in &mut context.config_mut().app.windows {
            if window.data_directory.is_none() { window.data_directory = Some(profile.clone()); }
        }
    }
    tauri::Builder::default()
        .manage(PlayTracker::default())
        .manage(metadata::MetadataJobs::default())
        .manage(retroarch::RetroArchJobs::default())
        .manage(app_updates::AppUpdates::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                // setup runs on the window thread, as required by SetWindowSubclass.
                windows_fullscreen::install(window.hwnd()?.0 as _)?;
            }
            if let Err(e) = init_database(app) {
                eprintln!("Error al inicializar la base de datos portable: {}", e);
            }
            backups::start_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            themes::get_theme_library,
            themes::save_theme_library,
            themes::import_theme,
            themes::export_theme,
            backups::get_backup_status,
            backups::save_backup_settings,
            backups::save_backup_preferences,
            backups::get_restored_preferences,
            backups::acknowledge_restored_preferences,
            backups::create_backup,
            backups::choose_backup,
            backups::open_backup_directory,
            backups::restore_backup,
            game_availability::get_game_availability,
            library_files::get_library_folders,
            library_files::save_library_folder,
            library_files::remove_library_folder,
            library_files::replace_game_source,
            session_history::get_play_sessions,
            session_history::delete_play_session,
            session_history::reset_play_sessions,
            app_updates::check_app_update,
            app_updates::install_app_update,
            metadata::repository::get_metadata_source,
            metadata::repository::choose_metadata_catalog,
            metadata::repository::set_metadata_catalog,
            i18n::set_ui_language,
            i18n::save_ui_language,
            cover_cache::cover_cache_entry,
            cover_cache::store_cover_thumbnail,
            cover_cache::validate_cover_cache_directory,
            cover_cache::choose_cache_directory,
            storage::get_data_location,
            storage::schedule_data_directory,
            storage::inspect_data_directory,
            storage::choose_data_directory,
            storage::restart_for_data_move,
            storage::restart_app,
            get_games,
            library_navigation::get_library_navigation,
            library_navigation::save_library_categories,
            media_library::get_media_library_status,
            media_library::find_media_collections,
            media_library::link_media_collection,
            get_emulators,
            retroarch::get_retroarch_status,
            retroarch::get_retroarch_cores,
            retroarch::install_retroarch,
            retroarch::install_retroarch_core,
            retroarch::cancel_retroarch_operation,
            get_platforms,
            platform_details::get_platform_details,
            box_brands::get_box_brand_images,
            platform_details::save_platform_details,
            metadata::platforms::download_platform_images,
            metadata::platforms::get_platform_image_types,
            metadata::platforms::get_catalog_platform_metadata,
            add_platform,
            update_platform,
            delete_platform,
            add_emulator,
            update_emulator,
            delete_emulator,
            delete_game,
            delete_games,
            update_game,
            select_game_images,
            manuals::select_game_manuals,
            manuals::get_game_manuals,
            cbz::get_cbz_manifest,
            cbz::read_cbz_page,
            manuals::open_game_folder,
            game_execution::open_game_files,
            game_execution::open_game_emulator,
            manuals::open_game_manual,
            launch_game,
            discs::prepare_disc_import,
            discs::get_game_discs,
            discs::pick_disc_files,
            discs::merge_game_discs,
            game_regions::merge_game_regions,
            game_regions::merge_game_recomp,
            scan_roms_folder,
            emulator_defaults::get_emulator_argument_presets,
            manual_import::select_game_file,
            manual_import::preview_single_game,
            steam::scan_steam_games,
            steam::select_steam_folder,
            epic::scan_epic_games,
            epic::select_epic_folder,
            import_scanned_roms,
            metadata::start_metadata_import,
            metadata::preload_metadata_catalog,
            metadata::prepare_metadata_catalog,
            metadata::match_metadata_games,
            metadata::search_metadata_games,
            metadata::stage_metadata_import,
            metadata::retry_metadata_images,
            metadata::end_metadata_import,
            metadata::download_editor_game_images,
            metadata::get_metadata_image_types,
            metadata::download_bulk_game_images,
            metadata::retry_editor_game_images,
            select_folder,
            platform_runtime::get_runtime_capabilities,
            platform_runtime::open_project_repository,
            platform_runtime::choose_runtime_path,
            linux_execution::get_linux_runners,
            select_emulator_executable
        ])
        .run(context)
        .expect(crate::i18n::text("msg.d9fdbcc4f8"));
}
