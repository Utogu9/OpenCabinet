use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default, Clone)]
pub struct PlayTracker(Arc<Mutex<HashSet<i32>>>);

impl PlayTracker {
    pub fn has_active_sessions(&self) -> bool {
        !self.0.lock().unwrap_or_else(|error| error.into_inner()).is_empty()
    }

    pub fn is_running(&self, id: i32) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .contains(&id)
    }

    pub fn reserve(&self, id: i32) -> Result<ActiveGame, String> {
        if !self
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(id)
        {
            return Err(crate::i18n::text("msg.f16d0bcba5").into());
        }
        Ok(ActiveGame {
            tracker: self.clone(),
            id,
        })
    }
}

pub struct ActiveGame {
    tracker: PlayTracker,
    id: i32,
}

impl Drop for ActiveGame {
    fn drop(&mut self) {
        self.tracker
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&self.id);
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct PlayStatistics {
    pub id: i32,
    pub play_time_seconds: i64,
    pub session_count: i64,
    pub last_played: Option<String>,
    pub is_running: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub region_statistics: Vec<PlayStatistics>,
}

fn statistics(row: &rusqlite::Row<'_>, is_running: bool) -> rusqlite::Result<PlayStatistics> {
    Ok(PlayStatistics {
        id: row.get(0)?,
        play_time_seconds: row.get(1)?,
        session_count: row.get(2)?,
        last_played: row.get(3)?,
        is_running,
        region_statistics: Vec::new(),
    })
}

pub fn start_session(conn: &Connection, id: i32) -> Result<PlayStatistics, String> {
    conn.query_row(
        "UPDATE games SET session_count = session_count + 1,
         last_played = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1
         RETURNING id, play_time_seconds, session_count, last_played",
        [id],
        |row| statistics(row, true),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or(crate::i18n::text("msg.66087bc5c8").into())
}

pub fn save_elapsed(
    conn: &Connection,
    id: i32,
    elapsed_seconds: i64,
    saved_seconds: &mut i64,
    is_running: bool,
) -> Result<Option<PlayStatistics>, String> {
    let elapsed_seconds = elapsed_seconds.max(*saved_seconds);
    let delta = elapsed_seconds - *saved_seconds;
    let result = conn
        .query_row(
            "UPDATE games SET play_time_seconds = play_time_seconds + ?1,
         play_time = (play_time_seconds + ?1) / 60 WHERE id = ?2
         RETURNING id, play_time_seconds, session_count, last_played",
            (delta, id),
            |row| statistics(row, is_running),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    *saved_seconds = elapsed_seconds;
    Ok(result)
}

// El reloj y la comprobación del proceso se inyectan para probar el cierre sin esperas reales.
pub fn monitor_session(
    conn: &Connection,
    id: i32,
    mut is_running: impl FnMut() -> Result<bool, String>,
    mut elapsed: impl FnMut() -> Duration,
    mut wait: impl FnMut(),
    mut on_statistics: impl FnMut(PlayStatistics),
) -> Result<(), String> {
    let mut saved_seconds = 0;
    loop {
        let running = is_running()?;
        let seconds = elapsed().as_secs().min(i64::MAX as u64) as i64;
        if !running || seconds.saturating_sub(saved_seconds) >= 5 {
            match save_elapsed(conn, id, seconds, &mut saved_seconds, running) {
                Ok(Some(stats)) => on_statistics(stats),
                Ok(None) => return Ok(()), // El usuario eliminó el registro mientras jugaba.
                Err(error) if running => {
                    eprintln!("Se reintentará guardar el tiempo de juego: {}", error)
                }
                Err(error) => return Err(error),
            }
        }
        if !running {
            return Ok(());
        }
        wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games (
            id INTEGER PRIMARY KEY, play_time INTEGER DEFAULT 0,
            play_time_seconds INTEGER DEFAULT 0, session_count INTEGER DEFAULT 0, last_played TEXT);
            INSERT INTO games (id) VALUES (1);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn cumulative_time_keeps_short_sessions_and_never_double_counts_checkpoints() {
        let conn = database();
        start_session(&conn, 1).unwrap();
        let mut saved = 0;
        save_elapsed(&conn, 1, 5, &mut saved, true).unwrap();
        save_elapsed(&conn, 1, 5, &mut saved, true).unwrap();
        let stats = save_elapsed(&conn, 1, 35, &mut saved, false)
            .unwrap()
            .unwrap();
        assert_eq!(stats.play_time_seconds, 35);
        assert_eq!(stats.session_count, 1);
        start_session(&conn, 1).unwrap();
        saved = 0;
        let stats = save_elapsed(&conn, 1, 40, &mut saved, false)
            .unwrap()
            .unwrap();
        assert_eq!(stats.play_time_seconds, 75);
        assert_eq!(stats.session_count, 2);
        let minutes: i64 = conn
            .query_row("SELECT play_time FROM games", [], |row| row.get(0))
            .unwrap();
        assert_eq!(minutes, 1);
    }

    #[test]
    fn monitor_checkpoints_running_process_and_flushes_remainder_on_exit() {
        let conn = database();
        start_session(&conn, 1).unwrap();
        let tick = Cell::new(0u64);
        let mut updates = Vec::new();
        monitor_session(
            &conn,
            1,
            || Ok(tick.get() < 7),
            || Duration::from_secs(tick.get()),
            || tick.set(tick.get() + 1),
            |stats| updates.push(stats),
        )
        .unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0].play_time_seconds, 5);
        assert!(updates[0].is_running);
        assert_eq!(updates[1].play_time_seconds, 7);
        assert!(!updates[1].is_running);
    }

    #[test]
    fn monitor_retries_a_temporary_database_failure_without_losing_time() {
        let conn = database();
        start_session(&conn, 1).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON games
            BEGIN SELECT RAISE(ABORT, 'temporary failure'); END;",
        )
        .unwrap();
        let tick = Cell::new(0u64);
        let mut updates = Vec::new();
        monitor_session(
            &conn,
            1,
            || Ok(tick.get() < 7),
            || Duration::from_secs(tick.get()),
            || {
                tick.set(tick.get() + 1);
                if tick.get() == 6 {
                    conn.execute("DROP TRIGGER reject_checkpoint", []).unwrap();
                }
            },
            |stats| updates.push(stats),
        )
        .unwrap();
        assert_eq!(updates.last().unwrap().play_time_seconds, 7);
        assert!(!updates.last().unwrap().is_running);
    }

    #[cfg(windows)]
    #[test]
    fn detects_the_exit_of_a_real_child_process() {
        let conn = database();
        start_session(&conn, 1).unwrap();
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 0"])
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        let mut updates = Vec::new();
        monitor_session(
            &conn,
            1,
            || {
                child
                    .try_wait()
                    .map(|status| status.is_none())
                    .map_err(|error| error.to_string())
            },
            || started.elapsed(),
            || std::thread::sleep(Duration::from_millis(10)),
            |stats| updates.push(stats),
        )
        .unwrap();
        assert_eq!(updates.last().unwrap().session_count, 1);
        assert!(!updates.last().unwrap().is_running);
    }

    #[test]
    fn duplicate_sessions_are_rejected_until_the_process_finishes() {
        let tracker = PlayTracker::default();
        let session = tracker.reserve(1).unwrap();
        assert!(tracker.is_running(1));
        assert!(tracker.reserve(1).is_err());
        assert!(tracker.reserve(2).is_ok());
        drop(session);
        assert!(!tracker.is_running(1));
        assert!(tracker.reserve(1).is_ok());
    }

    #[test]
    fn deleting_a_game_stops_tracking_without_recreating_it() {
        let conn = database();
        conn.execute("DELETE FROM games", []).unwrap();
        let mut saved = 0;
        assert!(
            save_elapsed(&conn, 1, 5, &mut saved, false)
                .unwrap()
                .is_none()
        );
        assert!(start_session(&conn, 1).is_err());
    }

    #[test]
    fn failed_checkpoint_does_not_advance_saved_time() {
        let conn = database();
        conn.execute_batch(
            "CREATE TRIGGER reject_time BEFORE UPDATE ON games
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
        )
        .unwrap();
        let mut saved = 0;
        assert!(save_elapsed(&conn, 1, 10, &mut saved, true).is_err());
        assert_eq!(saved, 0);
        conn.execute("DROP TRIGGER reject_time", []).unwrap();
        let stats = save_elapsed(&conn, 1, 12, &mut saved, false)
            .unwrap()
            .unwrap();
        assert_eq!(stats.play_time_seconds, 12);
    }
}
