//! PDF/CBZ manuals live inside the portable media collection, not under the game ID.
use crate::{PendingImageCopies, media_library};
use rusqlite::Connection;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub(crate) fn supported(path: &Path) -> bool {
    path.extension().is_some_and(|e|e.eq_ignore_ascii_case("pdf")||e.eq_ignore_ascii_case("cbz"))
}
fn validate(path: &Path) -> Result<()> {
    if !supported(path)||!path.is_file(){return Err(crate::i18n::text("msg.767a2ac791").into());}
    if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("cbz"))
    {
        return crate::cbz::inspect(path).map(|_|());
    }
    let mut header = [0; 1024];
    let size = fs::File::open(path)
        .map_err(err)?
        .read(&mut header)
        .map_err(err)?;
    if !header[..size].windows(5).any(|s| s == b"%PDF-") {
        return Err(crate::i18n::i18n_format!("msg.131c7d38ed", path.display()));
    }
    Ok(())
}

fn folder(collection: &Path) -> Result<PathBuf> {
    let path = collection.join("manuals");
    if path.exists()
        && !path
            .canonicalize()
            .map_err(err)?
            .starts_with(collection.canonicalize().map_err(err)?)
    {
        return Err(crate::i18n::text("msg.7f1f088415").into());
    }
    Ok(path)
}

/// Discover manuals dropped in Explorer as well as files added through the editor.
pub(crate) fn scan(collection: &Path) -> Result<Vec<PathBuf>> {
    let folder = folder(collection)?;
    if !folder.exists() {
        return Ok(Vec::new());
    }
    let canonical = folder.canonicalize().map_err(err)?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(&folder).map_err(err)? {
        let path = entry.map_err(err)?.path();
        if path.canonicalize().is_ok_and(|p| p.starts_with(&canonical)) && validate(&path).is_ok() {
            paths.push(path);
        }
    }
    paths.sort_by_key(|p| {
        p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    });
    Ok(paths)
}

fn existing_collection(conn: &Connection, root: &Path, id: i64) -> Result<Option<PathBuf>> {
    let dir: Option<String> = conn.query_row("SELECT c.directory FROM games g LEFT JOIN media_collections c ON c.id=g.media_collection_id WHERE g.id=?1", [id], |r| r.get(0)).map_err(err)?;
    dir.map(|d| media_library::directory(root, &d)).transpose()
}

fn same_contents(a: &Path, b: &Path) -> Result<bool> {
    if fs::metadata(a).map_err(err)?.len() != fs::metadata(b).map_err(err)?.len() {
        return Ok(false);
    }
    let mut a = fs::File::open(a).map_err(err)?;
    let mut b = fs::File::open(b).map_err(err)?;
    let (mut left, mut right) = ([0; 65536], [0; 65536]);
    loop {
        let count = a.read(&mut left).map_err(err)?;
        b.read_exact(&mut right[..count]).map_err(err)?;
        if left[..count] != right[..count] {
            return Ok(false);
        }
        if count == 0 {
            return Ok(true);
        }
    }
}

/// Called inside the edit transaction; failures remove only newly created copies.
pub(crate) fn copy_into_collection(
    conn: &Connection,
    root: &Path,
    id: i64,
    paths: &[String],
    copies: &mut PendingImageCopies,
) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    for path in paths {
        validate(Path::new(path))?;
    }
    let (_, dir) = media_library::ensure_game(conn, root, id)?;
    let collection = media_library::directory(root, &dir)?;
    let destination = folder(&collection)?;
    fs::create_dir_all(&destination).map_err(err)?;
    let mut saved = scan(&collection)?;
    for path in paths {
        let source = Path::new(path);
        let mut duplicate = false;
        for existing in &saved {
            if same_contents(source, existing)? {
                duplicate = true;
                break;
            }
        }
        if duplicate {
            continue;
        }
        let name = source
            .file_stem()
            .ok_or(crate::i18n::text("msg.d6c26a3f9c"))?
            .to_string_lossy();
        let extension=source.extension().unwrap().to_string_lossy().to_ascii_lowercase();
        let mut suffix = 1;
        loop {
            let filename = if suffix == 1 {
                format!("{name}.{extension}")
            } else {
                format!("{name} ({suffix}).{extension}")
            };
            let target = destination.join(filename);
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
            {
                Ok(mut out) => {
                    copies.0.push(target.clone());
                    std::io::copy(&mut fs::File::open(source).map_err(err)?, &mut out)
                        .map_err(err)?;
                    out.flush().map_err(err)?;
                    validate(&target)?;
                    saved.push(target);
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    suffix += 1;
                }
                Err(e) => return Err(err(e)),
            }
        }
    }
    Ok(())
}

fn prepare_folder(conn: &mut Connection, root: &Path, id: i64, kind: &str) -> Result<PathBuf> {
    if !["images", "manuals"].contains(&kind) {
        return Err(crate::i18n::text("msg.45bd0464ab").into());
    }
    media_library::init_schema(conn)?;
    let mut copies = PendingImageCopies(Vec::new());
    let tx = conn.transaction().map_err(err)?;
    let (_, dir) = media_library::ensure_game(&tx, root, id)?;
    let collection = media_library::directory(root, &dir)?;
    let path = if kind == "manuals" {
        folder(&collection)?
    } else {
        collection
    };
    fs::create_dir_all(&path).map_err(err)?;
    media_library::sync_game(&tx, root, id, &mut copies)?;
    tx.commit().map_err(err)?;
    copies.0.clear();
    let warnings = media_library::flush(conn, root);
    if !warnings.is_empty() {
        return Err(warnings.join(" · "));
    }
    Ok(path)
}

#[tauri::command]
pub async fn select_game_manuals() -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::i18n::text("msg.ba25164eb0"))
            .add_filter(crate::i18n::text("msg.dbd228271d"), &["pdf","cbz"])
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|path| {
                validate(&path)?;
                Ok(path.to_string_lossy().into_owned())
            })
            .collect()
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn get_game_manuals(id: i64) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(err)?;
        let root = crate::data_directory().map_err(err)?;
        let paths = match existing_collection(&conn, &root, id)? {
            Some(collection) => scan(&collection)?,
            None => Vec::new(),
        };
        Ok(paths
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn open_game_folder(app: tauri::AppHandle, id: i64, kind: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = crate::get_db_connection().map_err(err)?;
        let root = crate::data_directory().map_err(err)?;
        let path = prepare_folder(&mut conn, &root, id, &kind)?;
        crate::platform_runtime::open_path(&app,&path)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn open_game_manual(app: tauri::AppHandle, id: i64, path: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(err)?;
        let root = crate::data_directory().map_err(err)?;
        let collection = existing_collection(&conn, &root, id)?
            .ok_or(crate::i18n::text("msg.a610277d50"))?;
        let requested = Path::new(&path).canonicalize().map_err(err)?;
        let allowed = scan(&collection)?
            .iter()
            .any(|p| p.canonicalize().is_ok_and(|p| p == requested));
        if !allowed {
            return Err(crate::i18n::text("msg.52ae8b6cfe").into());
        }
        crate::platform_runtime::open_path(&app,&requested)
    })
    .await
    .map_err(err)?
}
