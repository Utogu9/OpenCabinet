//! Ordered manual lists are user data and travel with database backups.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub games: Vec<i32>,
}
fn owners(conn: &Connection) -> Result<HashMap<i32, i32>, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_regions')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        return Ok(HashMap::new());
    }
    conn.prepare("SELECT game_id,parent_id FROM game_regions")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)
}
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS playlist_games(playlist_id TEXT NOT NULL,game_id INTEGER NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(playlist_id,game_id));
        CREATE TRIGGER IF NOT EXISTS remove_playlist_games AFTER DELETE ON games BEGIN DELETE FROM playlist_games WHERE game_id=OLD.id; END;
        CREATE TRIGGER IF NOT EXISTS remove_playlist AFTER DELETE ON playlists BEGIN DELETE FROM playlist_games WHERE playlist_id=OLD.id; END;")
}
pub fn read(conn: &Connection) -> Result<Vec<Playlist>, String> {
    init(conn).map_err(err)?;
    let owners = owners(conn)?;
    let mut lists: Vec<Playlist> = conn
        .prepare("SELECT id,name FROM playlists ORDER BY name COLLATE NOCASE,id")
        .map_err(err)?
        .query_map([], |r| {
            Ok(Playlist {
                id: r.get(0)?,
                name: r.get(1)?,
                games: vec![],
            })
        })
        .map_err(err)?
        .collect::<rusqlite::Result<_>>()
        .map_err(err)?;
    for list in &mut lists {
        let ids: Vec<i32> = conn
            .prepare(
                "SELECT game_id FROM playlist_games WHERE playlist_id=?1 ORDER BY position,game_id",
            )
            .map_err(err)?
            .query_map([&list.id], |r| r.get(0))
            .map_err(err)?
            .collect::<rusqlite::Result<_>>()
            .map_err(err)?;
        let mut seen = HashSet::new();
        for id in ids {
            let owner = owners.get(&id).copied().unwrap_or(id);
            if seen.insert(owner) {
                list.games.push(owner);
            }
        }
    }
    Ok(lists)
}
pub fn save(conn: &mut Connection, list: &Playlist) -> Result<(), String> {
    if list.id.is_empty()
        || list.id.len() > 100
        || list.name.trim().is_empty()
        || list.name.chars().count() > 100
        || list.games.len() > 100000
    {
        return Err(crate::i18n::text("playlists.invalid").into());
    }
    init(conn).map_err(err)?;
    let tx = conn.transaction().map_err(err)?;
    let owners = owners(&tx)?;
    tx.execute(
        "INSERT INTO playlists VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        params![list.id, list.name.trim()],
    )
    .map_err(err)?;
    tx.execute(
        "DELETE FROM playlist_games WHERE playlist_id=?1",
        [&list.id],
    )
    .map_err(err)?;
    let mut seen = HashSet::new();
    for (position, id) in list.games.iter().enumerate() {
        let owner = owners.get(id).copied().unwrap_or(*id);
        if !seen.insert(owner) {
            continue;
        }
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",
                [owner],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err(crate::i18n::text("playlists.missing").into());
        }
        tx.execute(
            "INSERT INTO playlist_games VALUES(?1,?2,?3)",
            params![list.id, owner, position as i64],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
pub async fn get_playlists() -> Result<Vec<Playlist>, String> {
    tauri::async_runtime::spawn_blocking(move || read(&crate::get_db_connection().map_err(err)?))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn save_playlist(playlist: Playlist) -> Result<Vec<Playlist>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = crate::get_db_connection().map_err(err)?;
        save(&mut conn, &playlist)?;
        read(&conn)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn delete_playlist(id: String) -> Result<Vec<Playlist>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(err)?;
        init(&conn).map_err(err)?;
        conn.execute("DELETE FROM playlists WHERE id=?1", [id])
            .map_err(err)?;
        read(&conn)
    })
    .await
    .map_err(err)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn order_atomic_updates_and_delete_cleanup() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1),(2),(3)",
        )
        .unwrap();
        let mut list = Playlist {
            id: "one".into(),
            name: "My list".into(),
            games: vec![3, 1, 3, 2],
        };
        save(&mut conn, &list).unwrap();
        assert_eq!(read(&conn).unwrap()[0].games, vec![3, 1, 2]);
        list.games = vec![99];
        assert!(save(&mut conn, &list).is_err());
        assert_eq!(read(&conn).unwrap()[0].games, vec![3, 1, 2]);
        conn.execute("DELETE FROM games WHERE id=1", []).unwrap();
        assert_eq!(read(&conn).unwrap()[0].games, vec![3, 2]);
        conn.execute("DELETE FROM playlists", []).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM playlist_games", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn grouped_editions_share_a_single_playlist_entry() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1),(2),(3)",
        )
        .unwrap();
        let list = Playlist {
            id: "regions".into(),
            name: "Regions".into(),
            games: vec![2, 3, 1],
        };
        save(&mut conn, &list).unwrap();
        crate::game_regions::init(&conn).unwrap();
        conn.execute_batch("INSERT INTO game_regions VALUES(1,1,'EU',0,1),(2,1,'USA',1,0)")
            .unwrap();
        assert_eq!(read(&conn).unwrap()[0].games, vec![1, 3]);
        save(&mut conn, &list).unwrap();
        assert_eq!(read(&conn).unwrap()[0].games, vec![1, 3]);
    }
}
