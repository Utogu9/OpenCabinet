//! Box markings come only from artwork saved by the user, never bundled assets.
use rusqlite::Connection;
use std::{collections::BTreeMap, path::Path};
use tauri::Manager;

const MARKS: &[(&str, &str, &str)] = &[
    ("bluray", "Sony - PlayStation 3", "logo8.svg"),
    ("gamecube-logo", "Nintendo - GameCube", "logo2.svg"),
    ("gamecube-mark", "Nintendo - GameCube", "logo3.svg"),
    ("three-ds", "Nintendo - Nintendo 3DS", "logo.svg"),
    ("ds", "Nintendo - Nintendo DS", "logo.svg"),
    ("nintendo", "Nintendo - Wii U", "logo9.svg"),
    ("playstation", "Sony - PlayStation 2", "logo2.svg"),
    ("sega", "Sega - Mega Drive - Genesis", "logo9.svg"),
    ("wii", "Nintendo - Wii", "logo2.svg"),
];

fn read(conn: &Connection, root: &Path) -> Result<BTreeMap<String, String>, String> {
    let wanted: BTreeMap<_, _> = MARKS
        .iter()
        .map(|&(key, system, image)| {
            (
                crate::metadata::repository::console_image_filename(system, image),
                key,
            )
        })
        .collect();
    let mut marks = BTreeMap::new();
    let mut query = conn
        .prepare("SELECT path FROM platform_images ORDER BY rowid DESC")
        .map_err(|e| e.to_string())?;
    for row in query
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
    {
        let stored = row.map_err(|e| e.to_string())?;
        let Some(identity) =
            crate::metadata::repository::retained_console_filename(Path::new(&stored))
        else {
            continue;
        };
        let Some(&key) = wanted.get(&identity) else {
            continue;
        };
        if marks.contains_key(key) {
            continue;
        }
        let path = crate::resolve_image_path(root, &stored);
        if crate::image_extension(Path::new(&path)).is_ok() {
            marks.insert(key.to_owned(), path);
        }
    }
    Ok(marks)
}

#[tauri::command]
pub async fn get_box_brand_images(
    app: tauri::AppHandle,
) -> Result<BTreeMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        let root = crate::data_directory().map_err(|e| e.to_string())?;
        let marks = read(&conn, &root)?;
        for path in marks.values() {
            app.asset_protocol_scope()
                .allow_file(path)
                .map_err(|e| e.to_string())?;
        }
        Ok(marks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_all_downloaded_marks_without_platform_names_and_ignores_missing_or_removed_files() {
        let root = std::env::current_dir()
            .unwrap()
            .join("target/box-brand-tests")
            .join(format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
        std::fs::create_dir_all(&root).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE platform_images(platform_id INTEGER,path TEXT)")
            .unwrap();
        for &(key, system, image) in MARKS {
            let filename = crate::metadata::repository::console_image_filename(system, image);
            let relative = format!("saved-{filename}");
            std::fs::write(
                root.join(&relative),
                b"<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>",
            )
            .unwrap();
            conn.execute("INSERT INTO platform_images VALUES(1,?1)", [&relative])
                .unwrap();
            assert!(read(&conn, &root).unwrap().contains_key(key));
        }
        assert_eq!(read(&conn, &root).unwrap().len(), MARKS.len());
        let marks = read(&conn, &root).unwrap();
        let relocated=root.join("relocated");
        std::fs::create_dir(&relocated).unwrap();
        for path in marks.values() {
            let path=Path::new(path);
            std::fs::copy(path,relocated.join(path.file_name().unwrap())).unwrap();
        }
        let restored=read(&conn,&relocated).unwrap();
        assert_eq!(restored.len(),MARKS.len());
        assert!(restored.values().all(|p|Path::new(p).starts_with(&relocated)));
        std::fs::remove_file(&marks["bluray"]).unwrap();
        assert!(!read(&conn, &root).unwrap().contains_key("bluray"));
        conn.execute("DELETE FROM platform_images", []).unwrap();
        assert!(read(&conn, &root).unwrap().is_empty());
        assert!(root.parent().unwrap().ends_with("box-brand-tests"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
