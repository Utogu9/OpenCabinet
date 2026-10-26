//! Disposable thumbnails. Originals and library records are never modified.
use serde::Serialize;
use std::{
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};
use tauri::Manager;

static WRITER: Mutex<()> = Mutex::new(());
static SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn directory(custom: Option<&str>) -> Result<PathBuf, String> {
    let root = match custom.filter(|s| !s.trim().is_empty()) {
        Some(path) => PathBuf::from(path),
        None => crate::storage::active_directory()?.join("cache"),
    };
    if !root.is_absolute() {
        return Err(crate::i18n::text("msg.bba1ffc4e9").into());
    }
    Ok(root.join("covers-v2"))
}

fn hash(value: impl Hash) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn key(source: &Path) -> Result<String, String> {
    let path = fs::canonicalize(source).map_err(error)?;
    let metadata = fs::metadata(&path).map_err(error)?;
    if !metadata.is_file() {
        return Err(crate::i18n::text("msg.a880773a94").into());
    }
    let modified = metadata
        .modified()
        .map_err(error)?
        .duration_since(UNIX_EPOCH)
        .map_err(error)?
        .as_nanos();
    Ok(format!(
        "{}-{}",
        hash(path),
        hash((metadata.len(), modified))
    ))
}

#[derive(Serialize)]
pub struct Entry {
    key: String,
    path: String,
    cached: bool,
}

fn entry(source: &Path, root: &Path) -> Result<Entry, String> {
    let key = key(source)?;
    let path = root
        .join(key.split('-').next().unwrap())
        .join(format!("{key}.webp"));
    Ok(Entry {
        key,
        cached: path.is_file(),
        path: path.to_string_lossy().into_owned(),
    })
}

fn validate_thumbnail(bytes: &[u8]) -> Result<(), String> {
    let invalid = || crate::i18n::text("msg.b6879469aa").to_string();
    if bytes.len() < 20
        || bytes.len() > 2_000_000
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WEBP"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize != bytes.len() - 8
    {
        return Err(invalid());
    }
    let mut offset = 12;
    let mut image = false;
    while offset < bytes.len() {
        let header = bytes.get(offset..offset + 8).ok_or_else(invalid)?;
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
        let end = offset + 8 + length;
        let data = bytes.get(offset + 8..end).ok_or_else(invalid)?;
        let dimensions = match &header[..4] {
            b"VP8X" if data.len() == 10 && data[0] & 0x02 == 0 => {
                let width = u32::from_le_bytes([data[4], data[5], data[6], 0]) + 1;
                let height = u32::from_le_bytes([data[7], data[8], data[9], 0]) + 1;
                Some((width, height))
            }
            b"VP8 " if data.len() >= 10 && data[0] & 1 == 0 && &data[3..6] == b"\x9d\x01\x2a" => {
                image = true;
                Some((
                    (u16::from_le_bytes([data[6], data[7]]) & 0x3fff) as u32,
                    (u16::from_le_bytes([data[8], data[9]]) & 0x3fff) as u32,
                ))
            }
            b"VP8L" if data.len() >= 5 && data[0] == 0x2f => {
                image = true;
                let bits = u32::from_le_bytes(data[1..5].try_into().unwrap());
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" | b"VP8 " | b"VP8L" | b"ANIM" | b"ANMF" => return Err(invalid()),
            _ => None,
        };
        if let Some((width, height)) = dimensions {
            if width == 0 || height == 0 || width > 1280 || height > 800 {
                return Err(crate::i18n::text("msg.e8627b5d9f").into());
            }
        }
        offset = end + (length & 1);
    }
    if offset != bytes.len() || !image {
        return Err(invalid());
    }
    Ok(())
}

fn store(source: &Path, root: &Path, expected: &str, thumbnail_bytes: &[u8]) -> Result<(), String> {
    // Accept only bounded thumbnail payloads, never arbitrary destination paths.
    validate_thumbnail(thumbnail_bytes)?;
    let _guard = WRITER.lock().map_err(error)?;
    let current = key(source)?;
    if expected != current {
        return Err(crate::i18n::text("msg.84bc878ba7").into());
    }
    // A source-specific folder keeps stale-version cleanup constant-sized even
    // for libraries with thousands of covers.
    let source_root = root.join(current.split('-').next().unwrap());
    fs::create_dir_all(&source_root).map_err(error)?;
    let target = source_root.join(format!("{current}.webp"));
    let temporary = source_root.join(format!(
        "{current}-{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(error)?;
        file.write_all(thumbnail_bytes).map_err(error)?;
        file.sync_all().map_err(error)?;
        drop(file);
        // An existing file can be corrupt; replace it after the new file is complete.
        if target.exists() {
            fs::remove_file(&target).map_err(error)?;
        }
        fs::rename(&temporary, &target).map_err(error)?;
        // Drop obsolete versions of this source only. Other files remain untouched.
        let prefix = format!("{}-", current.split('-').next().unwrap());
        if let Ok(entries) = fs::read_dir(&source_root) {
            for item in entries.flatten() {
                let name = item.file_name().to_string_lossy().into_owned();
                if name.starts_with(&prefix) && name.ends_with(".webp") && item.path() != target {
                    let _ = fs::remove_file(item.path());
                }
            }
        }
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

#[tauri::command]
pub async fn cover_cache_entry(
    app: tauri::AppHandle,
    source: String,
    cache_directory: Option<String>,
    full_cover: Option<bool>,
) -> Result<Entry, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = directory(cache_directory.as_deref())?;
        entry(
            Path::new(&source),
            &if full_cover.unwrap_or(false) {
                root.join("full")
            } else {
                root
            },
        )
    })
    .await
    .map_err(error)??;
    app.asset_protocol_scope()
        .allow_file(&result.path)
        .map_err(error)?;
    Ok(result)
}

#[tauri::command]
pub async fn store_cover_thumbnail(
    source: String,
    cache_directory: Option<String>,
    key: String,
    thumbnail_bytes: Vec<u8>,
    full_cover: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = directory(cache_directory.as_deref())?;
        store(
            Path::new(&source),
            &if full_cover.unwrap_or(false) {
                root.join("full")
            } else {
                root
            },
            &key,
            &thumbnail_bytes,
        )
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub async fn choose_cache_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title(crate::i18n::text("msg.06dd9c9301"))
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(error)
}

#[tauri::command]
pub async fn validate_cover_cache_directory(
    cache_directory: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = directory(cache_directory.as_deref())?;
        fs::create_dir_all(&root).map_err(error)?;
        let probe = root.join(format!(
            "write-{}-{}.tmp",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe)
            .map_err(error)?;
        fs::remove_file(probe).map_err(error)?;
        Ok(root.parent().unwrap().to_string_lossy().into_owned())
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files(PathBuf);
    impl Files {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "opencabinet-cover-cache-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn source(&self) -> PathBuf {
            let path = self.0.join("original.png");
            fs::write(&path, include_bytes!("../icons/32x32.png")).unwrap();
            path
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    const PNG: &[u8] = include_bytes!("../icons/32x32.png");
    const WEBP: &[u8] = include_bytes!("../tests/fixtures/cover-thumbnail.webp");

    fn riff(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&(12 + data.len() as u32 + (data.len() as u32 & 1)).to_le_bytes());
        bytes.extend_from_slice(b"WEBP");
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
        bytes.extend_from_slice(data);
        if data.len() & 1 == 1 {
            bytes.push(0);
        }
        bytes
    }

    #[test]
    fn validates_webp_headers_and_rejects_png_truncation_and_oversized_canvases() {
        assert!(validate_thumbnail(WEBP).is_ok());
        assert!(validate_thumbnail(PNG).is_err());
        assert!(validate_thumbnail(&WEBP[..WEBP.len() - 1]).is_err());
        let lossy = riff(b"VP8 ", &[0, 0, 0, 0x9d, 1, 0x2a, 32, 0, 32, 0]);
        assert!(validate_thumbnail(&lossy).is_ok());
        let lossless = riff(b"VP8L", &[0x2f, 31, 0xc0, 7, 0]);
        assert!(validate_thumbnail(&lossless).is_ok());
        assert!(
            validate_thumbnail(&riff(b"VP8X", &[0; 10])).is_err(),
            "Require an image payload"
        );
        assert!(validate_thumbnail(&riff(b"VP8 ", &[0; 10])).is_err());
        assert!(validate_thumbnail(&riff(b"ANIM", &[0; 6])).is_err());
        let mut extended = riff(b"VP8X", &[0, 0, 0, 0, 0, 5, 0, 31, 0, 0]);
        extended.extend_from_slice(&lossy[12..]);
        let length = (extended.len() - 8) as u32;
        extended[4..8].copy_from_slice(&length.to_le_bytes());
        assert!(
            validate_thumbnail(&extended).is_err(),
            "Validate extended canvas size too"
        );
    }

    #[test]
    fn thumbnails_survive_a_new_lookup_without_altering_originals() {
        let files = Files::new();
        let source = files.source();
        let root = files.0.join("cache");
        let first = entry(&source, &root).unwrap();
        assert!(!first.cached);
        store(&source, &root, &first.key, WEBP).unwrap();
        let reopened = entry(&source, &root).unwrap();
        assert!(reopened.cached);
        assert_eq!(first.key, reopened.key);
        assert_eq!(fs::read(&source).unwrap(), PNG);
        assert_eq!(fs::read(reopened.path).unwrap(), WEBP);
        assert_eq!(fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn modified_images_invalidate_cache_even_with_the_same_file_size() {
        let files = Files::new();
        let source = files.source();
        let root = files.0.join("cache");
        let original = entry(&source, &root).unwrap();
        store(&source, &root, &original.key, WEBP).unwrap();
        fs::File::options()
            .write(true)
            .open(&source)
            .unwrap()
            .set_times(
                fs::FileTimes::new().set_modified(UNIX_EPOCH + std::time::Duration::from_secs(100)),
            )
            .unwrap();
        let changed = entry(&source, &root).unwrap();
        assert!(!changed.cached);
        assert_ne!(original.key, changed.key);
        assert!(
            store(&source, &root, &original.key, WEBP).is_err(),
            "Do not save an obsolete decode"
        );
        store(&source, &root, &changed.key, WEBP).unwrap();
        assert!(!Path::new(&original.path).exists());
        assert!(Path::new(&changed.path).exists());
    }

    #[test]
    fn separate_folders_and_equal_names_do_not_collide() {
        let files = Files::new();
        let source = files.source();
        let other_dir = files.0.join("other");
        fs::create_dir(&other_dir).unwrap();
        let other = other_dir.join("original.png");
        fs::write(&other, PNG).unwrap();
        let root = files.0.join("cache");
        let first = entry(&source, &root).unwrap();
        assert_ne!(first.key, entry(&other, &root).unwrap().key);
        store(&source, &root, &first.key, WEBP).unwrap();
        assert!(!entry(&source, &files.0.join("new-cache")).unwrap().cached);
        assert!(entry(&source, &root).unwrap().cached);
    }

    #[test]
    fn invalid_payloads_and_missing_sources_never_create_cache_files() {
        let files = Files::new();
        let source = files.source();
        let root = files.0.join("cache");
        let first = entry(&source, &root).unwrap();
        assert!(store(&source, &root, &first.key, b"invalid").is_err());
        let oversized = riff(b"VP8 ", &[0, 0, 0, 0x9d, 1, 0x2a, 1, 5, 32, 0]);
        assert!(store(&source, &root, &first.key, &oversized).is_err());
        fs::remove_file(&source).unwrap();
        assert!(entry(&source, &root).is_err());
        assert!(store(&source, &root, &first.key, WEBP).is_err());
        assert!(!root.exists());
    }

    #[test]
    fn corrupt_cache_can_be_replaced_and_unrelated_files_remain_untouched() {
        let files = Files::new();
        let source = files.source();
        let root = files.0.join("cache");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("unrelated.txt"), "keep").unwrap();
        let first = entry(&source, &root).unwrap();
        fs::create_dir_all(Path::new(&first.path).parent().unwrap()).unwrap();
        fs::write(&first.path, b"broken").unwrap();
        store(&source, &root, &first.key, WEBP).unwrap();
        assert_eq!(fs::read(&first.path).unwrap(), WEBP);
        assert!(root.join("unrelated.txt").exists());
        assert_eq!(fs::read_dir(root).unwrap().count(), 2);
    }

    #[test]
    fn full_cover_previews_have_a_separate_cache_and_support_larger_dimensions() {
        let files = Files::new();
        let source = files.source();
        let root = files.0.join("cache");
        let cover = entry(&source, &root).unwrap();
        let full = entry(&source, &root.join("full")).unwrap();
        assert_ne!(cover.path, full.path);
        store(&source, &root.join("full"), &full.key, WEBP).unwrap();
        assert!(entry(&source, &root.join("full")).unwrap().cached);
        assert!(!entry(&source, &root).unwrap().cached);
        assert!(
            validate_thumbnail(&riff(b"VP8 ", &[0, 0, 0, 0x9d, 1, 0x2a, 0, 5, 0x20, 3])).is_ok()
        );
        assert!(
            validate_thumbnail(&riff(b"VP8 ", &[0, 0, 0, 0x9d, 1, 0x2a, 0, 5, 0x21, 3])).is_err()
        );
    }
}
