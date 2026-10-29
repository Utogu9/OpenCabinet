use rusqlite::{Connection, params};
use serde::Serialize;

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS play_sessions(id INTEGER PRIMARY KEY,game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,rom_path TEXT NOT NULL,started_at TEXT NOT NULL,last_checkpoint TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'running');CREATE INDEX IF NOT EXISTS play_sessions_game ON play_sessions(game_id,id DESC);CREATE TRIGGER IF NOT EXISTS remove_play_sessions AFTER DELETE ON games BEGIN DELETE FROM play_sessions WHERE game_id=OLD.id;END;")
}
pub fn recover(conn: &Connection) -> rusqlite::Result<()> {
    init(conn)?;
    conn.execute("UPDATE play_sessions SET ended_at=last_checkpoint,state='interrupted' WHERE state='running'",[])?;
    Ok(())
}
pub fn begin(conn: &Connection, id: i32, path: &str, started: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO play_sessions(game_id,rom_path,started_at,last_checkpoint) VALUES(?1,?2,?3,?3)",params![id,path,started])?;
    Ok(())
}
pub fn checkpoint(conn: &Connection, id: i32, elapsed: i64, running: bool) -> rusqlite::Result<()> {
    conn.execute("UPDATE play_sessions SET duration_seconds=max(duration_seconds,?1),last_checkpoint=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_at=CASE WHEN ?2 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END,state=CASE WHEN ?2 THEN 'running' ELSE 'finished' END WHERE id=(SELECT id FROM play_sessions WHERE game_id=?3 AND state='running' ORDER BY id DESC LIMIT 1)",params![elapsed,running,id])?;
    Ok(())
}
pub fn atomic<T>(
    conn: &Connection,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("SAVEPOINT session_record")
        .map_err(|e| e.to_string())?;
    match action() {
        Ok(result) => {
            conn.execute_batch("RELEASE session_record")
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO session_record;RELEASE session_record");
            Err(error)
        }
    }
}
#[derive(Serialize, Debug)]
pub struct Session {
    id: i64,
    game_id: i32,
    title: String,
    rom_path: String,
    started_at: String,
    ended_at: Option<String>,
    duration_seconds: i64,
    state: String,
}

pub fn read(
    conn: &Connection,
    id: i32,
    combine: bool,
    offset: usize,
) -> Result<Vec<Session>, String> {
    init(conn).map_err(|e| e.to_string())?;
    let ids = if combine {
        crate::game_regions::expanded(conn, &[id])?
    } else {
        vec![id]
    };
    let json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    conn.prepare("SELECT s.id,s.game_id,g.title,s.rom_path,s.started_at,s.ended_at,s.duration_seconds,s.state FROM play_sessions s JOIN games g ON g.id=s.game_id WHERE s.game_id IN (SELECT value FROM json_each(?1)) ORDER BY s.started_at DESC,s.id DESC LIMIT 100 OFFSET ?2").map_err(|e|e.to_string())?
        .query_map(params![json,offset.min(i64::MAX as usize) as i64],|r|Ok(Session{id:r.get(0)?,game_id:r.get(1)?,title:r.get(2)?,rom_path:r.get(3)?,started_at:r.get(4)?,ended_at:r.get(5)?,duration_seconds:r.get(6)?,state:r.get(7)?})).map_err(|e|e.to_string())?.collect::<rusqlite::Result<_>>().map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn get_play_sessions(
    game_id: i32,
    combine_regions: Option<bool>,
    offset: Option<usize>,
) -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(
            &crate::get_db_connection().map_err(|e| e.to_string())?,
            game_id,
            combine_regions.unwrap_or(true),
            offset.unwrap_or(0),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,rom_path TEXT,play_time INTEGER DEFAULT 0,play_time_seconds INTEGER DEFAULT 0,session_count INTEGER DEFAULT 0,last_played TEXT);INSERT INTO games(id,title,rom_path) VALUES(1,'EU','eu.chd'),(2,'US','us.chd');").unwrap();
        c
    }
    #[test]
    fn checkpoints_preserve_individual_sessions_actual_disc_and_region_totals() {
        let c = db();
        crate::playtime::start_session_path(&c, 1, "EU (Disc 2).chd").unwrap();
        let mut saved = 0;
        crate::playtime::save_elapsed(&c, 1, 5, &mut saved, true).unwrap();
        crate::playtime::save_elapsed(&c, 1, 12, &mut saved, false).unwrap();
        crate::playtime::start_session(&c, 1).unwrap();
        saved = 0;
        crate::playtime::save_elapsed(&c, 1, 20, &mut saved, false).unwrap();
        let rows = read(&c, 1, false, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].duration_seconds, 20);
        assert_eq!(rows[1].duration_seconds, 12);
        assert_eq!(rows[1].rom_path, "EU (Disc 2).chd");
        assert!(
            rows.iter()
                .all(|row| row.state == "finished" && row.ended_at.is_some())
        );
        assert_eq!(
            c.query_row(
                "SELECT play_time_seconds,session_count FROM games WHERE id=1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            )
            .unwrap(),
            (32, 2)
        );
        crate::game_regions::init(&c).unwrap();
        c.execute_batch("INSERT INTO game_regions VALUES(1,1,'Europe',0,1),(2,1,'USA',1,0)")
            .unwrap();
        crate::playtime::start_session(&c, 2).unwrap();
        assert_eq!(read(&c, 1, true, 0).unwrap().len(), 3);
        assert_eq!(read(&c, 2, false, 0).unwrap().len(), 1);
        recover(&c).unwrap();
        let interrupted = read(&c, 2, false, 0).unwrap();
        assert_eq!(interrupted[0].state, "interrupted");
        assert_eq!(interrupted[0].duration_seconds, 0);
    }
    #[test]
    fn a_failed_history_write_rolls_back_the_game_checkpoint_and_can_be_retried() {
        let c = db();
        crate::playtime::start_session(&c, 1).unwrap();
        c.execute_batch("CREATE TRIGGER fail_history BEFORE UPDATE ON play_sessions BEGIN SELECT RAISE(ABORT,'fixture');END;").unwrap();
        let mut saved = 0;
        assert!(crate::playtime::save_elapsed(&c, 1, 5, &mut saved, true).is_err());
        assert_eq!(saved, 0);
        assert_eq!(
            c.query_row("SELECT play_time_seconds FROM games WHERE id=1", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        c.execute("DROP TRIGGER fail_history", []).unwrap();
        crate::playtime::save_elapsed(&c, 1, 12, &mut saved, false).unwrap();
        assert_eq!(read(&c, 1, false, 0).unwrap()[0].duration_seconds, 12);
        c.execute("DELETE FROM games WHERE id=1", []).unwrap();
        assert!(read(&c, 1, false, 0).unwrap().is_empty());
    }
}
