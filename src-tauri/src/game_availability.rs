//! Inspect only the selected library entry, including its regions and discs.
use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
pub struct Availability {
    pub available: bool,
    pub missing_paths: Vec<String>,
}

fn inspect(conn: &Connection, game_id: i32) -> Result<Availability, String> {
    let ids = crate::game_regions::expanded(conn, &[game_id])?;
    let mut missing_paths = Vec::new();
    let mut available = false;
    for id in ids {
        let path: String = conn
            .query_row("SELECT rom_path FROM games WHERE id=?1", [id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if let Some(app_id) = crate::steam::app_id(&path) {
            available |= crate::steam::installed_directory(conn, id, app_id).is_ok();
        } else if crate::epic::app_id(&path).is_some() {
            available |= crate::epic::launch_plan(conn, id, &path).is_ok();
        } else {
            let discs = crate::discs::read(conn, id as i64)?;
            let paths = if discs.is_empty() {
                vec![path]
            } else {
                discs.into_iter().map(|d| d.rom_path).collect()
            };
            for path in paths {
                if std::path::Path::new(&path).is_file() {
                    available = true;
                } else {
                    missing_paths.push(path);
                }
            }
        }
    }
    Ok(Availability {
        available,
        missing_paths,
    })
}

#[tauri::command]
pub async fn get_game_availability(game_id: i32) -> Result<Availability, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        inspect(&conn, game_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_files_and_remaining_discs_are_checked_without_writing_statistics() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games(id INTEGER PRIMARY KEY, rom_path TEXT);
            INSERT INTO games VALUES(1,'missing.iso'),(2,'missing2.iso');",
        )
        .unwrap();
        crate::discs::init(&conn).unwrap();
        assert!(!inspect(&conn, 1).unwrap().available);
        assert_eq!(
            inspect(&conn, 1).unwrap().missing_paths,
            vec!["missing.iso"]
        );
        let existing = std::env::current_exe()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        crate::discs::replace(
            &conn,
            1,
            &[
                crate::discs::source("missing.iso"),
                crate::discs::source(&existing),
            ],
        )
        .unwrap();
        assert!(inspect(&conn, 1).unwrap().available);
        crate::game_regions::init(&conn).unwrap();
        conn.execute("UPDATE games SET rom_path=?1 WHERE id=2", [&existing])
            .unwrap();
        conn.execute("DELETE FROM game_discs WHERE game_id=2", [])
            .unwrap();
        conn.execute_batch("INSERT INTO game_regions VALUES(1,1,'USA',0,1),(2,1,'Europe',1,0)")
            .unwrap();
        conn.execute("DELETE FROM game_discs WHERE game_id=1", [])
            .unwrap();
        assert!(inspect(&conn, 1).unwrap().available);
        assert!(inspect(&conn, 999).is_err());
    }
}
