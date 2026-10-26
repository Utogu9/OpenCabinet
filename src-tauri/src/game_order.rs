//! Shared title-based ordering rules, independent of ROM paths and statistics.
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Group {
    pub id: i64,
    pub titles: Vec<String>,
}
#[derive(Deserialize)]
pub struct Patch {
    pub id: Option<i64>,
    pub titles: Vec<String>,
}
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS game_order_groups(id INTEGER PRIMARY KEY AUTOINCREMENT, titles TEXT NOT NULL)")
}
pub fn key(title: &str) -> String {
    title.trim().nfc().collect::<String>().to_lowercase()
}

pub fn groups(conn: &Connection) -> Result<Vec<Group>, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_order_groups')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(Vec::new());
    }
    let rows = conn
        .prepare("SELECT id,titles FROM game_order_groups ORDER BY id")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|(id, json)| {
            serde_json::from_str(&json)
                .map(|titles| Group { id, titles })
                .map_err(|e| e.to_string())
        })
        .collect()
}
pub fn matching<'a>(groups: &'a [Group], title: &str) -> Option<&'a Group> {
    let title = key(title);
    groups
        .iter()
        .find(|group| group.titles.iter().any(|value| key(value) == title))
}
pub fn index(groups: &[Group]) -> std::collections::HashMap<String, usize> {
    groups
        .iter()
        .enumerate()
        .flat_map(|(position, group)| group.titles.iter().map(move |title| (key(title), position)))
        .collect()
}
// The caller's game-edit transaction also commits or rolls back the group.
pub fn save(conn: &Connection, patch: &Patch) -> Result<(), String> {
    let titles: Vec<_> = patch
        .titles
        .iter()
        .map(|title| title.trim().to_owned())
        .collect();
    if !titles.is_empty() && !(2..=200).contains(&titles.len()) {
        return Err(crate::i18n::text("order.invalid_count").into());
    }
    let mut keys = std::collections::HashSet::new();
    for title in &titles {
        if title.is_empty() || title.chars().count() > 500 {
            return Err(crate::i18n::text("order.invalid_title").into());
        }
        if !keys.insert(key(title)) {
            return Err(crate::i18n::text("order.duplicates").into());
        }
    }
    let saved = groups(conn)?;
    if patch
        .id
        .is_some_and(|id| !saved.iter().any(|group| group.id == id))
    {
        return Err(crate::i18n::text("order.stale").into());
    }
    if saved
        .iter()
        .filter(|group| Some(group.id) != patch.id)
        .any(|group| group.titles.iter().any(|title| keys.contains(&key(title))))
    {
        return Err(crate::i18n::text("order.overlap").into());
    }
    if titles.is_empty() {
        if let Some(id) = patch.id {
            conn.execute("DELETE FROM game_order_groups WHERE id=?1", [id])
                .map_err(|e| e.to_string())?;
        }
    } else {
        let body = serde_json::to_string(&titles).map_err(|e| e.to_string())?;
        if let Some(id) = patch.id {
            conn.execute(
                "UPDATE game_order_groups SET titles=?1 WHERE id=?2",
                (body, id),
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute("INSERT INTO game_order_groups(titles) VALUES (?1)", [body])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn patch(id: Option<i64>, titles: &[&str]) -> Patch {
        Patch {
            id,
            titles: titles.iter().map(|value| (*value).into()).collect(),
        }
    }
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    #[test]
    fn shared_orders_match_titles_without_changing_case_or_confusing_accents() {
        let conn = db();
        save(
            &conn,
            &patch(
                None,
                &[
                    " Gran Turismo 4 ",
                    "Gran Turismo 3",
                    "Gran Turismo 2",
                    "Gran Turismo",
                ],
            ),
        )
        .unwrap();
        let rows = groups(&conn).unwrap();
        assert_eq!(rows[0].titles[0], "Gran Turismo 4");
        assert_eq!(matching(&rows, " GRAN TURISMO 2 ").unwrap().id, rows[0].id);
        assert!(matching(&rows, "Gran Turismo 20").is_none());
        assert_eq!(key("Poke\u{301}mon"), key("Pokémon"));
        assert_ne!(key("Pokemon"), key("Pokémon"));
    }

    #[test]
    fn validation_rejects_duplicates_overlapping_groups_and_stale_edits_without_partial_updates() {
        let conn = db();
        save(&conn, &patch(None, &["A", "B"])).unwrap();
        let id = groups(&conn).unwrap()[0].id;
        for invalid in [
            patch(None, &["A", "C"]),
            patch(Some(id), &[" A ", "a"]),
            patch(Some(id), &["Only"]),
            patch(Some(999), &["C", "D"]),
            patch(Some(id), &["", "B"]),
        ] {
            assert!(save(&conn, &invalid).is_err());
            assert_eq!(groups(&conn).unwrap()[0].titles, vec!["A", "B"]);
        }
        save(&conn, &patch(Some(id), &["B", "A", "Future game"])).unwrap();
        assert_eq!(groups(&conn).unwrap()[0].titles[0], "B");
        save(&conn, &patch(Some(id), &[])).unwrap();
        assert!(groups(&conn).unwrap().is_empty());
    }

    #[test]
    fn order_rules_persist_when_the_database_is_reopened() {
        let root =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../target/order-tests");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(format!(
            "{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let conn = Connection::open(&path).unwrap();
        init(&conn).unwrap();
        save(&conn, &patch(None, &["GT4", "GT3", "Future"])).unwrap();
        drop(conn);
        let reopened = Connection::open(&path).unwrap();
        assert_eq!(
            groups(&reopened).unwrap()[0].titles,
            vec!["GT4", "GT3", "Future"]
        );
        drop(reopened);
        std::fs::remove_file(path).unwrap();
    }
}
