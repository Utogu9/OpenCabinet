//! Attribution stays with managed artwork, including portable collection manifests.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
pub type Sources = std::collections::BTreeMap<String, Source>;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Source {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uploader: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

pub fn web_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value.trim()).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| value.trim().to_owned())
}

impl Source {
    pub fn clean(&self) -> Option<Self> {
        let source = Self {
            uploader: self
                .uploader
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            url: self.url.as_deref().and_then(web_url),
        };
        (source.uploader.is_some() || source.url.is_some()).then_some(source)
    }
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS image_sources(path TEXT PRIMARY KEY, details TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS game_metadata_sources(game_id INTEGER PRIMARY KEY, details TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_game_metadata_source AFTER DELETE ON games
        BEGIN DELETE FROM game_metadata_sources WHERE game_id=OLD.id; END;")
}

pub fn decode(json: Option<String>) -> Option<Source> {
    json.and_then(|s| serde_json::from_str::<Source>(&s).ok())
        .and_then(|s| s.clean())
}

pub fn save_image(conn: &Connection, path: &str, source: Option<&Source>) -> Result<(), String> {
    if let Some(source) = source.and_then(Source::clean) {
        conn.execute(
            "INSERT OR REPLACE INTO image_sources VALUES(?1,?2)",
            params![
                path,
                serde_json::to_string(&source).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Keep the existing index compatible while also tracking PDF/CBZ attribution.
pub fn save_file(conn: &Connection, path: &str, source: Option<&Source>) -> Result<(), String> {
    save_image(conn, path, source)
}

pub fn read_file(conn: &Connection, path: &str) -> Result<Option<Source>, String> {
    let json = conn.query_row("SELECT details FROM image_sources WHERE path=?1", [path], |r|r.get(0))
        .optional().map_err(|e|e.to_string())?;
    Ok(decode(json))
}

pub fn save_metadata(conn: &Connection, game: i64, source: Option<&Source>) -> Result<(), String> {
    let Some(source) = source else {
        return Ok(());
    };
    if let Some(source) = source.clean() {
        conn.execute(
            "INSERT OR REPLACE INTO game_metadata_sources VALUES(?1,?2)",
            params![
                game,
                serde_json::to_string(&source).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM game_metadata_sources WHERE game_id=?1", [game])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_game_metadata_source(id: i32) -> Result<Option<Source>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        let json = conn
            .query_row(
                "SELECT details FROM game_metadata_sources WHERE game_id=?1",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(decode(json))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_source_url(url: String) -> Result<(), String> {
    let url = web_url(&url).ok_or_else(|| crate::i18n::text("source.invalid").to_string())?;
    crate::platform_runtime::open_web_url(&url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sources_validate_web_links_and_preserve_optional_uploaders() {
        for url in [
            "javascript:alert(1)",
            "file:///tmp/scan.png",
            "https://user:password@example.org/scan",
            "https://",
        ] {
            assert!(web_url(url).is_none(), "{url}");
        }
        let source = Source {
            uploader: Some(" Scanner ".into()),
            url: Some("https://segaretro.org/File:Exact.jpg?oldid=12#history".into()),
        }
        .clean()
        .unwrap();
        assert_eq!(source.uploader.as_deref(), Some("Scanner"));
        assert!(source.url.unwrap().ends_with("?oldid=12#history"));
        assert!(Source::default().clean().is_none());
    }
}
