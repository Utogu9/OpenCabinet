//! Saved scan folders and replacement source associations. ROM files are never moved.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

fn canonical(path: &Path) -> Result<String, String> {
    let path = path
        .canonicalize()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();
    Ok(if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        path.strip_prefix(r"\\?\").unwrap_or(&path).to_owned()
    })
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS library_folders(id INTEGER PRIMARY KEY,platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,directory TEXT NOT NULL,path_key TEXT NOT NULL,extensions TEXT NOT NULL,UNIQUE(platform_id,path_key));CREATE TRIGGER IF NOT EXISTS remove_library_folders AFTER DELETE ON platforms BEGIN DELETE FROM library_folders WHERE platform_id=OLD.id;END;")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Folder {
    pub id: i64,
    pub platform_id: i32,
    pub directory: String,
    pub extensions: Vec<String>,
}

pub fn folders(conn: &Connection, platform_id: i32) -> Result<Vec<Folder>, String> {
    init(conn).map_err(|e| e.to_string())?;
    conn.prepare("SELECT id,platform_id,directory,extensions FROM library_folders WHERE platform_id=?1 ORDER BY directory COLLATE NOCASE").map_err(|e|e.to_string())?
        .query_map([platform_id],|r|{let json:String=r.get(3)?;Ok(Folder{id:r.get(0)?,platform_id:r.get(1)?,directory:r.get(2)?,extensions:serde_json::from_str(&json).unwrap_or_default()})}).map_err(|e|e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())
}

pub fn save_folder(
    conn: &Connection,
    platform_id: i32,
    directory: &str,
    extensions: Vec<String>,
) -> Result<(), String> {
    init(conn).map_err(|e| e.to_string())?;
    if !Path::new(directory).is_dir() {
        return Err(crate::i18n::text("library.folderInvalid").into());
    }
    let directory = canonical(Path::new(directory))?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM platforms WHERE id=?1)",
            [platform_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err(crate::i18n::text("msg.6d7512c1a1").into());
    }
    let extensions: Vec<String> = extensions
        .into_iter()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect();
    conn.execute("INSERT INTO library_folders(platform_id,directory,path_key,extensions) VALUES(?1,?2,?3,?4) ON CONFLICT(platform_id,path_key) DO UPDATE SET extensions=excluded.extensions",
        params![platform_id,directory,crate::discs::key(&directory),serde_json::to_string(&extensions).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}

pub fn replace_source(
    conn: &Connection,
    id: i32,
    disc_id: Option<i64>,
    path: &str,
) -> Result<(), String> {
    let (old, direct): (String, bool) = conn
        .query_row(
            "SELECT rom_path,launch_directly FROM games WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or(crate::i18n::text("msg.66087bc5c8"))?;
    if crate::steam::app_id(&old).is_some() || crate::epic::app_id(&old).is_some() {
        return Err(crate::i18n::text("library.storeSource").into());
    }
    if !Path::new(path).is_absolute() || !Path::new(path).is_file() {
        return Err(crate::i18n::text("library.fileInvalid").into());
    }
    if direct {
        crate::manual_import::validate_pc_executable(path)?;
    }
    let path = canonical(Path::new(path))?;
    let key = crate::discs::key(&path);
    let owner: Option<i32> = conn
        .query_row(
            "SELECT id FROM games WHERE lower(replace(rom_path,char(92),'/'))=?1 AND id<>?2",
            params![key, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if owner.is_some() || crate::discs::owner(conn, &path)?.is_some_and(|owner| owner != id as i64)
    {
        return Err(crate::i18n::text("library.sourceDuplicate").into());
    }
    if direct {
        if disc_id.is_some() {
            return Err(crate::i18n::text("msg.11fbfacfff").into());
        }
        conn.execute(
            "UPDATE games SET rom_path=?1 WHERE id=?2",
            params![path, id],
        )
        .map_err(|e| e.to_string())?;
        let discs = crate::discs::read(conn, id as i64)?;
        if let Some(mut disc) = discs.into_iter().next() {
            disc.rom_path = path;
            crate::discs::replace(conn, id as i64, &[disc])?;
        }
    } else {
        let mut discs = crate::discs::read(conn, id as i64)?;
        if discs.is_empty() {
            discs.push(crate::discs::source(&old));
        }
        let index = if let Some(selected) = disc_id {
            discs
                .iter()
                .position(|disc| disc.id == Some(selected))
                .ok_or(crate::i18n::text("msg.5e0039ec6a"))?
        } else if discs.len() == 1 {
            0
        } else {
            return Err(crate::i18n::text("msg.5ee312ef3e").into());
        };
        discs[index].rom_path = path;
        crate::discs::replace(conn, id as i64, &discs)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_library_folders(platform_id: i32) -> Result<Vec<Folder>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        folders(
            &crate::get_db_connection().map_err(|e| e.to_string())?,
            platform_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_library_folder(
    platform_id: i32,
    directory: String,
    extensions: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_folder(
            &crate::get_db_connection().map_err(|e| e.to_string())?,
            platform_id,
            &directory,
            extensions,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn remove_library_folder(id: i64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::get_db_connection()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM library_folders WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn replace_game_source(
    game_id: i32,
    disc_id: Option<i64>,
    path: String,
    tracker: tauri::State<'_, crate::PlayTracker>,
) -> Result<(), String> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        crate::discs::init(&conn).map_err(|e| e.to_string())?;
        let _active = tracker.reserve(crate::game_regions::owner(&conn, game_id)?)?;
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        replace_source(&tx, game_id, disc_id, &path)?;
        let mut copies = crate::PendingImageCopies(Vec::new());
        crate::media_library::sync_game(
            &tx,
            &crate::data_directory().map_err(|e| e.to_string())?,
            game_id as i64,
            &mut copies,
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        copies.0.clear();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files(std::path::PathBuf);
    impl Files {
        fn new() -> Self {
            let p = std::env::temp_dir().join(format!(
                "opencabinet-library-files-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn file(&self, name: &str) -> String {
            let p = self.0.join(name);
            std::fs::write(&p, b"source").unwrap();
            p.to_string_lossy().to_string()
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            assert!(self.0.starts_with(std::env::temp_dir()));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,rom_path TEXT UNIQUE,launch_directly INTEGER DEFAULT 0,play_time_seconds INTEGER DEFAULT 123,session_count INTEGER DEFAULT 4);CREATE TABLE platforms(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO platforms VALUES(1,'PS2');").unwrap();
        c
    }
    #[test]
    fn replacing_one_disc_preserves_labels_order_identity_and_statistics_and_rejects_duplicates() {
        let files = Files::new();
        let mut c = db();
        c.execute(
            "INSERT INTO games(id,title,rom_path) VALUES(1,'Game','missing.chd'),(2,'Other',?1)",
            [files.file("other.chd")],
        )
        .unwrap();
        crate::discs::init(&c).unwrap();
        let mut sources = crate::discs::read(&c, 1).unwrap();
        sources[0].label = "Disc one".into();
        sources.push(crate::discs::source(&files.file("disc2.chd")));
        crate::discs::replace(&c, 1, &sources).unwrap();
        let before = crate::discs::read(&c, 1).unwrap();
        let replacement = files.file("relocated.chd");
        let tx = c.transaction().unwrap();
        replace_source(&tx, 1, before[0].id, &replacement).unwrap();
        tx.commit().unwrap();
        let after = crate::discs::read(&c, 1).unwrap();
        assert_ne!(
            after[0].id, before[0].id,
            "stale launch requests cannot select the replacement file"
        );
        assert_eq!(after[0].label, "Disc one");
        assert_eq!(after[1].rom_path, before[1].rom_path);
        assert_eq!(after[0].rom_path, replacement);
        assert_eq!(
            c.query_row(
                "SELECT play_time_seconds,session_count,title,rom_path FROM games WHERE id=1",
                [],
                |r| Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?
                ))
            )
            .unwrap(),
            (123, 4, "Game".into(), replacement)
        );
        assert!(replace_source(&c, 1, Some(999), &files.file("new.chd")).is_err());
        assert!(replace_source(&c, 1, before[0].id, &files.file("other.chd")).is_err());
        assert!(replace_source(&c, 1, None, "missing").is_err());
    }
    #[test]
    fn direct_sources_keep_launch_mode_and_remove_the_old_duplicate_association() {
        let files = Files::new();
        let c = db();
        let old = files.file("old.exe");
        let new = files.file("new.exe");
        c.execute(
            "INSERT INTO games(id,title,rom_path,launch_directly) VALUES(1,'Direct',?1,1)",
            [&old],
        )
        .unwrap();
        crate::discs::init(&c).unwrap();
        replace_source(&c, 1, None, &new).unwrap();
        assert_eq!(crate::discs::owner(&c, &old).unwrap(), None);
        assert_eq!(crate::discs::owner(&c, &new).unwrap(), Some(1));
        assert!(
            c.query_row("SELECT launch_directly FROM games", [], |r| r
                .get::<_, bool>(0))
                .unwrap()
        );
        assert!(replace_source(&c, 1, None, &files.file("wrong.chd")).is_err());
        c.execute("UPDATE games SET rom_path='steam://run/42'", [])
            .unwrap();
        assert!(replace_source(&c, 1, None, &new).is_err());
    }
    #[test]
    fn folders_are_deduplicated_update_extensions_and_follow_console_identity() {
        let files = Files::new();
        let c = db();
        let path = files.0.to_string_lossy();
        save_folder(&c, 1, &path, vec![".chd".into()]).unwrap();
        save_folder(&c, 1, &path, vec![".iso".into()]).unwrap();
        let saved = folders(&c, 1).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].extensions, [".iso"]);
        c.execute("UPDATE platforms SET name='Renamed'", [])
            .unwrap();
        assert_eq!(folders(&c, 1).unwrap()[0].id, saved[0].id);
        assert!(save_folder(&c, 999, &path, vec![]).is_err());
        c.execute("DELETE FROM platforms WHERE id=1", []).unwrap();
        assert!(folders(&c, 1).unwrap().is_empty());
    }
}
