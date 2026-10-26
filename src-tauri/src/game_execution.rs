use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ExecutionOptions {
    pub emulator_id: Option<i64>,
    pub arguments: Option<String>,
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TRIGGER IF NOT EXISTS clear_deleted_game_emulator AFTER DELETE ON emulators
        BEGIN UPDATE games SET emulator_override_id=NULL WHERE emulator_override_id=OLD.rowid; END;
        CREATE TRIGGER IF NOT EXISTS clear_moved_game_emulator AFTER UPDATE OF platform ON emulators
        BEGIN UPDATE games SET emulator_override_id=NULL WHERE emulator_override_id=OLD.rowid AND LOWER(platform)<>LOWER(NEW.platform); END;")
}

pub fn read(conn: &Connection, id: i32) -> Result<ExecutionOptions, String> {
    // Retain compatibility with older launch-only databases and fixtures.
    let present: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('games') WHERE name='emulator_override_id')", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !present {
        return Ok(ExecutionOptions::default());
    }
    conn.query_row(
        "SELECT emulator_override_id,arguments_override FROM games WHERE id=?1",
        [id],
        |r| {
            Ok(ExecutionOptions {
                emulator_id: r.get(0)?,
                arguments: r.get(1)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub fn save(
    conn: &Connection,
    id: i32,
    platform: &str,
    options: &ExecutionOptions,
) -> Result<(), String> {
    let (path, direct): (String, bool) = conn
        .query_row(
            "SELECT rom_path,launch_directly FROM games WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if crate::steam::app_id(&path).is_some() || crate::epic::app_id(&path).is_some() {
        if options.emulator_id.is_some() || options.arguments.is_some() {
            return Err(crate::i18n::text("msg.b4adf411c8").into());
        }
    }
    if let Some(emulator) = options.emulator_id {
        if direct {
            return Err(crate::i18n::text("msg.808f466f16").into());
        }
        let valid: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM emulators WHERE rowid=?1 AND LOWER(platform)=LOWER(?2))", (emulator,platform), |r|r.get(0)).map_err(|e|e.to_string())?;
        if !valid {
            return Err(crate::i18n::text("msg.c10e7c77cf").into());
        }
    }
    conn.execute(
        "UPDATE games SET emulator_override_id=?1,arguments_override=?2 WHERE id=?3",
        (&options.emulator_id, &options.arguments, id),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn folders(conn: &Connection, id: i32) -> Result<Vec<PathBuf>, String> {
    let members=crate::game_regions::expanded(conn,&[id])?;
    if members.len()>1 {
        let mut result=Vec::new();
        // Single editions keep their normal resolution (including discs).
        for member in members {
            let discs=crate::discs::read(conn,member as i64)?;
            let paths=if discs.is_empty(){vec![conn.query_row("SELECT rom_path FROM games WHERE id=?1",[member],|row|row.get::<_,String>(0)).map_err(|e|e.to_string())?]}else{discs.into_iter().map(|disc|disc.rom_path).collect()};
            for path in paths {
                let parent=Path::new(&path).parent().filter(|p|p.is_dir()).ok_or_else(||crate::i18n::i18n_format!("msg.042cc49861", path = path))?.canonicalize().map_err(|e|e.to_string())?;
                if !result.contains(&parent){result.push(parent);}
            }
        }
        return Ok(result);
    }
    let path: String = conn
        .query_row("SELECT rom_path FROM games WHERE id=?1", [id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or(crate::i18n::text("msg.d73324547f"))?;
    if let Some(app_id) = crate::steam::app_id(&path) {
        return Ok(vec![crate::steam::installed_directory(conn, id, app_id)?]);
    }
    if crate::epic::app_id(&path).is_some() {
        return Ok(vec![
            crate::epic::launch_plan(conn, id, &path)?.install_directory,
        ]);
    }
    let discs = crate::discs::read(conn, id as i64)?;
    let paths: Vec<_> = if discs.is_empty() {
        vec![path]
    } else {
        discs.into_iter().map(|disc| disc.rom_path).collect()
    };
    let mut result = Vec::new();
    for path in paths {
        let parent = Path::new(&path)
            .parent()
            .filter(|p| p.is_dir())
            .ok_or_else(|| crate::i18n::i18n_format!("msg.042cc49861", path = path))?;
        let parent = parent.canonicalize().map_err(|e| e.to_string())?;
        if !result.contains(&parent) {
            result.push(parent);
        }
    }
    Ok(result)
}

fn open_emulator_with(conn: &Connection, id: i32, open: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    let (platform, path, direct): (String,String,bool) = conn.query_row(
        "SELECT platform,rom_path,launch_directly FROM games WHERE id=?1", [id],
        |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
    ).optional().map_err(|e|e.to_string())?.ok_or(crate::i18n::text("msg.d73324547f"))?;
    if direct || crate::steam::app_id(&path).is_some() || crate::epic::app_id(&path).is_some() {
        return Err(crate::i18n::text("msg.f15594175a").into());
    }
    let emulator = match read(conn,id)?.emulator_id {
        Some(id) => Some(id), None => crate::platform_details::default_emulator(conn,&platform)?,
    };
    let executable: String = conn.query_row(
        "SELECT executable_path FROM emulators WHERE rowid=?1 AND LOWER(platform)=LOWER(?2)",
        (emulator,platform), |r|r.get(0),
    ).optional().map_err(|e|e.to_string())?.ok_or(crate::i18n::text("msg.da83ac501d"))?;
    // No ROM, launch template, RetroArch core arguments or gameplay session.
    open(Path::new(&executable))
}

#[tauri::command]
pub async fn open_game_emulator(id: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(|e|e.to_string())?;
        open_emulator_with(&conn,id,|executable| {
            let executable = executable.canonicalize().map_err(|e|crate::i18n::i18n_format!("msg.bddaf7dd2a", e = e))?;
            let mut command = std::process::Command::new(&executable);
            if let Some(parent) = executable.parent() { command.current_dir(parent); }
            command.spawn().map_err(|e|crate::i18n::i18n_format!("msg.52a4fc6777", e = e))?;
            Ok(())
        })
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)]
mod emulator_tests {
    use super::*;
    #[test]
    fn opening_alone_respects_overrides_and_console_defaults_without_recording_a_session() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,platform TEXT,rom_path TEXT,launch_directly INTEGER,emulator_override_id INTEGER,arguments_override TEXT,session_count INTEGER,play_time_seconds INTEGER,last_played TEXT);
            CREATE TABLE platforms(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE platform_details(platform_id INTEGER,default_emulator_id INTEGER);
            CREATE TABLE emulators(id INTEGER PRIMARY KEY,platform TEXT,executable_path TEXT,arguments TEXT);
            INSERT INTO games VALUES(1,'PS2','missing-game.iso',0,NULL,NULL,7,1200,'2026-10-20');
            INSERT INTO platforms VALUES(1,'PS2'); INSERT INTO platform_details VALUES(1,2);
            INSERT INTO emulators VALUES(1,'PS2','first.exe','--fullscreen %ROM%'),(2,'PS2','preferred.exe','--fullscreen %ROM%'),(3,'Other','wrong.exe','%ROM%');").unwrap();
        open_emulator_with(&conn,1,|p|{assert_eq!(p,Path::new("preferred.exe"));Ok(())}).unwrap();
        conn.execute("UPDATE games SET emulator_override_id=1",[]).unwrap();
        open_emulator_with(&conn,1,|p|{assert_eq!(p,Path::new("first.exe"));Ok(())}).unwrap();
        assert!(open_emulator_with(&conn,1,|_|Err("Cannot spawn".into())).is_err());
        let history:(i64,i64,String)=conn.query_row("SELECT session_count,play_time_seconds,last_played FROM games",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
        assert_eq!(history,(7,1200,"2026-10-20".into()));
        conn.execute("UPDATE games SET emulator_override_id=3",[]).unwrap();
        assert!(open_emulator_with(&conn,1,|_|panic!("foreign emulator")).is_err());
        conn.execute("UPDATE games SET launch_directly=1",[]).unwrap();
        assert!(open_emulator_with(&conn,1,|_|panic!("direct game")).is_err());
        conn.execute("UPDATE games SET launch_directly=0,rom_path='steam://rungameid/10'",[]).unwrap();
        assert!(open_emulator_with(&conn,1,|_|panic!("Steam game")).is_err());
    }
}

#[tauri::command]
pub async fn open_game_files(app: tauri::AppHandle, id: i32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        for folder in folders(&conn, id)? {
            app.opener()
                .open_path(folder.to_string_lossy().into_owned(), None::<String>)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
