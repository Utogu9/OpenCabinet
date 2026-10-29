//! Read CBZ pages on demand without extracting an archive into user data.
use serde::Serialize;
use std::{cmp::Ordering, fs, io::Read, path::Path};

type Result<T> = std::result::Result<T, String>;
const MAX_PAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;

#[derive(Serialize)]
pub struct Page {
    index: usize,
    name: String,
}
#[derive(Serialize)]
pub struct Manifest {
    pages: Vec<Page>,
    fingerprint: String,
}

fn image_name(name: &str) -> bool {
    let name = name.replace('\\', "/");
    !name
        .split('/')
        .any(|part| part.starts_with('.') || part == "__MACOSX")
        && Path::new(&name).extension().is_some_and(|ext| {
            matches!(
                ext.to_string_lossy().to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
            )
        })
}
fn open(path: &Path) -> Result<(zip::ZipArchive<fs::File>, String)> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cbz"))
    {
        return Err(crate::i18n::text("cbz.invalid").into());
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|v| v.as_nanos())
        .unwrap_or_default();
    let fingerprint = format!("{}-{modified}", metadata.len());
    let zip =
        zip::ZipArchive::new(file).map_err(|_| crate::i18n::text("cbz.invalid").to_owned())?;
    if zip.len() > MAX_ENTRIES {
        return Err(crate::i18n::text("cbz.tooLarge").into());
    }
    Ok((zip, fingerprint))
}
fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (a, b) = (a.to_lowercase(), b.to_lowercase());
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (start_i, start_j) = (i, j);
            while i < a.len() && a[i].is_ascii_digit() {
                i += 1;
            }
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let mut p = start_i;
            while p < i && a[p] == b'0' {
                p += 1;
            }
            let mut q = start_j;
            while q < j && b[q] == b'0' {
                q += 1;
            }
            let order = (i - p)
                .cmp(&(j - q))
                .then_with(|| a[p..i].cmp(&b[q..j]))
                .then_with(|| (i - start_i).cmp(&(j - start_j)));
            if order != Ordering::Equal {
                return order;
            }
        } else {
            let order = a[i].cmp(&b[j]);
            if order != Ordering::Equal {
                return order;
            }
            i += 1;
            j += 1;
        }
    }
    a.len().cmp(&b.len())
}
pub fn inspect(path: &Path) -> Result<Manifest> {
    let (mut zip, fingerprint) = open(path)?;
    let mut pages = Vec::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().map_err(|e| e.to_string())?;
        if file.is_dir() || file.enclosed_name().is_none() || !image_name(&name) {
            continue;
        }
        if file.size() > MAX_PAGE_BYTES {
            return Err(crate::i18n::text("cbz.tooLarge").into());
        }
        pages.push(Page {
            index,
            name: name.into_owned(),
        });
    }
    if pages.is_empty() {
        return Err(crate::i18n::text("cbz.empty").into());
    }
    pages.sort_by(|a, b| natural_cmp(&a.name, &b.name).then_with(|| a.index.cmp(&b.index)));
    Ok(Manifest { pages, fingerprint })
}
fn read_page(path: &Path, index: usize, fingerprint: &str) -> Result<Vec<u8>> {
    let (mut zip, current) = open(path)?;
    if current != fingerprint {
        return Err(crate::i18n::text("cbz.changed").into());
    }
    let mut file = zip.by_index(index).map_err(|e| e.to_string())?;
    if file.is_dir()
        || file.enclosed_name().is_none()
        || !image_name(&file.name().map_err(|e| e.to_string())?)
    {
        return Err(crate::i18n::text("cbz.invalidPage").into());
    }
    if file.size() > MAX_PAGE_BYTES {
        return Err(crate::i18n::text("cbz.tooLarge").into());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_PAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PAGE_BYTES {
        return Err(crate::i18n::text("cbz.tooLarge").into());
    }
    Ok(bytes)
}
#[tauri::command]
pub async fn get_cbz_manifest(path: String) -> Result<Manifest> {
    tauri::async_runtime::spawn_blocking(move || inspect(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_cbz_page(
    path: String,
    index: usize,
    fingerprint: String,
) -> Result<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        read_page(Path::new(&path), index, &fingerprint).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;
    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(
                *name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }
    #[test]
    fn pages_use_natural_order_skip_metadata_and_read_one_unchanged_entry() {
        let root = std::env::temp_dir().join(format!(
            "opencabinet-cbz-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("Manual.CBZ");
        archive(
            &file,
            &[
                ("scan/10.JPG", b"ten"),
                ("scan/2.jpg", b"two"),
                ("scan/01.png", b"one"),
                ("ComicInfo.xml", b"metadata"),
                ("__MACOSX/cover.png", b"ignored"),
                ("../outside.jpg", b"ignored"),
                (".hidden.png", b"ignored"),
            ],
        );
        let manifest = inspect(&file).unwrap();
        assert_eq!(
            manifest
                .pages
                .iter()
                .map(|p| p.name.as_str())
                .collect::<Vec<_>>(),
            ["scan/01.png", "scan/2.jpg", "scan/10.JPG"]
        );
        assert_eq!(
            read_page(&file, manifest.pages[1].index, &manifest.fingerprint).unwrap(),
            b"two"
        );
        assert!(read_page(&file, 3, &manifest.fingerprint).is_err());
        assert!(read_page(&file, usize::MAX, &manifest.fingerprint).is_err());
        archive(&file, &[("new.jpg", b"changed content")]);
        assert!(read_page(&file, 0, &manifest.fingerprint).is_err());
        assert_eq!(
            fs::read_dir(&root).unwrap().count(),
            1,
            "reading does not extract pages"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_empty_or_corrupt_archives_and_numeric_runs_do_not_overflow() {
        let root = std::env::temp_dir().join(format!(
            "opencabinet-cbz-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("Manual.cbz");
        archive(&file, &[("notes.txt", b"no images")]);
        assert!(inspect(&file).is_err());
        fs::write(&file, b"broken zip").unwrap();
        assert!(inspect(&file).is_err());
        assert_eq!(
            natural_cmp("page9.jpg", "page100000000000000000000000000.jpg"),
            Ordering::Less
        );
        fs::remove_dir_all(root).unwrap();
    }
    pub(crate) fn fixture(path: &Path) {
        archive(path, &[("page1.png", b"test page")]);
    }
}
