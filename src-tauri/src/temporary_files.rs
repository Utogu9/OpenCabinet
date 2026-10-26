//! Startup-only cleanup of operation-owned download scratch space.
//! Never sweep the image library, installed emulators or the system temp folder.
use std::{
    fs, io,
    path::{Path, PathBuf},
};

fn ordinary(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        } // junction/reparse point
    }
    true
}

fn ordinary_directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && ordinary(&m))
}

fn operation_id(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_digit()) && name.parse::<u128>().is_ok()
}

// Check the resolved boundary before every recursive descent/removal. Links,
// including Windows junctions, are left intact along with their parent folder.
fn remove_owned_tree(path: &Path, boundary: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !ordinary(&metadata) {
        return Err(io::Error::other("linked temporary entry"));
    }
    let resolved = fs::canonicalize(path)?;
    if resolved == boundary || !resolved.starts_with(boundary) {
        return Err(io::Error::other(
            "temporary entry outside staging directory",
        ));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            remove_owned_tree(&entry?.path(), boundary)?;
        }
        fs::remove_dir(path)
    } else if metadata.is_file() {
        fs::remove_file(path)
    } else {
        Err(io::Error::other("unsupported temporary entry"))
    }
}

fn partial_core(name: &str) -> Option<&str> {
    let (core, id) = name
        .strip_prefix('.')?
        .strip_suffix(".part")?
        .rsplit_once('-')?;
    (operation_id(id)
        && core.ends_with("_libretro")
        && core.len() <= 100
        && core.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
    .then_some(id)
}

fn remove_partial(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(io::Error::other("invalid core temporary directory"));
    }
    match fs::symlink_metadata(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
        Ok(m)
            if m.is_file()
                && ordinary(&m)
                && ordinary_directory(path.parent().unwrap_or(Path::new(""))) =>
        {
            fs::remove_file(path)
        }
        _ => Err(io::Error::other("linked or invalid core temporary file")),
    }
}

fn clean_staging(root: &Path, retroarch: bool, warnings: &mut Vec<String>) {
    if !ordinary_directory(&root.join("metadata")) {
        return;
    }
    let stage = root.join(if retroarch {
        "metadata/retroarch-staging"
    } else {
        "metadata/staging"
    });
    if !ordinary_directory(&stage) {
        return;
    }
    let result = (|| -> io::Result<()> {
        let boundary = fs::canonicalize(&stage)?;
        for entry in fs::read_dir(&stage)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if !operation_id(&id) || !ordinary_directory(&entry.path()) {
                continue;
            }
            // A core may live outside the portable data folder. The receipt
            // records the exact operation-specific .part before it is created.
            if retroarch {
                let receipt = entry.path().join("core-partial.json");
                if let Ok(meta) = fs::symlink_metadata(&receipt) {
                    if ordinary(&meta) && meta.is_file() && meta.len() <= 32768 {
                        if let Ok(path) = fs::read(&receipt).and_then(|bytes| {
                            serde_json::from_slice::<PathBuf>(&bytes).map_err(io::Error::other)
                        }) {
                            if path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .and_then(partial_core)
                                == Some(id.as_str())
                            {
                                if let Err(error) = remove_partial(&path) {
                                    warnings.push(format!("{}: {error}", path.display()));
                                    continue; // retain receipt so next startup retries
                                }
                            }
                        }
                    }
                }
            }
            if let Err(error) = remove_owned_tree(&entry.path(), &boundary) {
                warnings.push(format!("{}: {error}", entry.path().display()));
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        warnings.push(format!("{}: {error}", stage.display()));
    }
}

// Compatibility: older builds did not write a receipt for core copies. Inspect
// only core directories of registered RetroArch installations, non-recursively.
fn clean_legacy_cores(root: &Path, warnings: &mut Vec<String>) {
    let mut executables = std::collections::HashSet::<PathBuf>::new();
    if let Ok(conn) = rusqlite::Connection::open_with_flags(
        crate::storage::database_path(root),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        for sql in [
            "SELECT executable_path FROM retroarch_settings",
            "SELECT executable_path FROM emulators",
        ] {
            if let Ok(mut statement) = conn.prepare(sql) {
                if let Ok(rows) = statement.query_map([], |r| r.get::<_, String>(0)) {
                    for value in rows.flatten() {
                        let path = PathBuf::from(value);
                        if path.is_absolute()
                            && path.file_name().is_some_and(|name| {
                                name.to_string_lossy().eq_ignore_ascii_case("retroarch.exe")
                            })
                        {
                            executables.insert(path);
                        }
                    }
                }
            }
        }
    }
    executables.insert(root.join("emulators/RetroArch/retroarch.exe"));
    for executable in executables {
        let directory = crate::retroarch::directories(&executable).0;
        if !ordinary_directory(&directory) {
            continue;
        }
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.flatten() {
                if partial_core(&entry.file_name().to_string_lossy()).is_some() {
                    if let Err(error) = remove_partial(&entry.path()) {
                        warnings.push(format!("{}: {error}", entry.path().display()));
                    }
                }
            }
        }
    }
}

pub fn cleanup(root: &Path) -> Vec<String> {
    let mut warnings = Vec::new();
    if !root.is_absolute() {
        return warnings;
    }
    clean_legacy_cores(root, &mut warnings);
    clean_staging(root, false, &mut warnings);
    clean_staging(root, true, &mut warnings);
    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let base = std::env::current_dir()
                .unwrap()
                .join("target/temporary-cleanup-tests");
            fs::create_dir_all(&base).unwrap();
            let root = base.join(format!(
                "{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(fs::canonicalize(root).unwrap())
        }
        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            assert!(
                self.0.is_absolute()
                    && self
                        .0
                        .parent()
                        .unwrap()
                        .ends_with("temporary-cleanup-tests")
            );
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn startup_removes_only_owned_download_jobs_and_is_repeatable() {
        let files = Sandbox::new();
        files.write("metadata/staging/123/Metadata.zip", b"unfinished");
        files.write("metadata/staging/456/images/cover.jpg", b"unfinished");
        files.write(
            "metadata/retroarch-staging/789/portable/cores/core.dll",
            b"unfinished",
        );
        let orphan_core = files.write(
            "emulators/RetroArch/cores/.snes9x_libretro-123.part",
            b"unfinished",
        );
        for name in [
            crate::catalog_compat::LEGACY_CATALOG_PATH,
            crate::catalog_compat::LEGACY_PREVIOUS_PATH,
            "metadata/retroarch-cores-x86_64.json",
            "metadata/staging/user-backup/keep",
            "metadata/staging/123.zip",
            "images/123/manifest.json",
            "manuals/manual.pdf",
            "cache/covers-v2/cover.webp",
            "emulators/RetroArch/retroarch.exe",
        ] {
            files.write(name, b"keep");
        }
        assert!(cleanup(&files.0).is_empty());
        assert!(!orphan_core.exists());
        assert!(!files.0.join("metadata/staging/123").exists());
        assert!(!files.0.join("metadata/staging/456").exists());
        assert!(!files.0.join("metadata/retroarch-staging/789").exists());
        for name in [
            crate::catalog_compat::LEGACY_CATALOG_PATH,
            crate::catalog_compat::LEGACY_PREVIOUS_PATH,
            "metadata/retroarch-cores-x86_64.json",
            "metadata/staging/user-backup/keep",
            "metadata/staging/123.zip",
            "images/123/manifest.json",
            "manuals/manual.pdf",
            "cache/covers-v2/cover.webp",
            "emulators/RetroArch/retroarch.exe",
        ] {
            assert_eq!(fs::read(files.0.join(name)).unwrap(), b"keep");
        }
        assert!(cleanup(&files.0).is_empty());
    }

    #[test]
    fn registered_and_unregistered_external_core_copies_are_cleaned_but_not_installed_files() {
        let files = Sandbox::new();
        let external = Sandbox::new();
        let exe = external.write("RetroArch/retroarch.exe", b"keep");
        external.write(
            "RetroArch/retroarch.cfg",
            b"libretro_directory = \"my-cores\"",
        );
        let partial = external.write(
            "RetroArch/my-cores/.snes9x_libretro-123.part",
            b"unfinished",
        );
        let conn = rusqlite::Connection::open(crate::storage::database_path(&files.0)).unwrap();
        conn.execute_batch("CREATE TABLE emulators(executable_path TEXT);")
            .unwrap();
        conn.execute("INSERT INTO emulators VALUES (?1)", [exe.to_str().unwrap()])
            .unwrap();
        drop(conn);
        let receipt_partial =
            external.write("other/.pcsx_rearmed_libretro-456.part", b"unfinished");
        files.write(
            "metadata/retroarch-staging/456/core-partial.json",
            &serde_json::to_vec(&receipt_partial).unwrap(),
        );
        for name in [
            "snes9x_libretro.dll",
            "snes9x_libretro.info",
            ".user-download.part",
            ".snes9x_libretro-not-an-id.part",
        ] {
            external.write(&format!("RetroArch/my-cores/{name}"), b"keep");
        }
        assert!(cleanup(&files.0).is_empty());
        assert!(!partial.exists());
        assert!(!receipt_partial.exists());
        for name in [
            "snes9x_libretro.dll",
            "snes9x_libretro.info",
            ".user-download.part",
            ".snes9x_libretro-not-an-id.part",
        ] {
            assert_eq!(
                fs::read(external.0.join("RetroArch/my-cores").join(name)).unwrap(),
                b"keep"
            );
        }
    }

    #[test]
    fn malformed_receipts_cannot_remove_final_files_or_other_operations() {
        let files = Sandbox::new();
        let external = Sandbox::new();
        let keep = external.write("snes9x_libretro.dll", b"keep");
        files.write(
            "metadata/retroarch-staging/123/core-partial.json",
            &serde_json::to_vec(&keep).unwrap(),
        );
        let other = external.write(".snes9x_libretro-789.part", b"keep");
        files.write(
            "metadata/retroarch-staging/456/core-partial.json",
            &serde_json::to_vec(&other).unwrap(),
        );
        files.write(
            "metadata/retroarch-staging/789/core-partial.json",
            b"broken",
        );
        let gone = external
            .0
            .join("removed-installation/.snes9x_libretro-987.part");
        files.write(
            "metadata/retroarch-staging/987/core-partial.json",
            &serde_json::to_vec(&gone).unwrap(),
        );
        assert!(cleanup(&files.0).is_empty());
        assert!(!files.0.join("metadata/retroarch-staging/987").exists());
        assert_eq!(fs::read(keep).unwrap(), b"keep");
        assert_eq!(fs::read(other).unwrap(), b"keep");
    }

    #[test]
    #[cfg(windows)]
    fn locked_external_partial_keeps_its_receipt_and_is_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let files = Sandbox::new();
        let external = Sandbox::new();
        let partial = external.write(".snes9x_libretro-123.part", b"unfinished");
        let receipt = files.write(
            "metadata/retroarch-staging/123/core-partial.json",
            &serde_json::to_vec(&partial).unwrap(),
        );
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&partial)
            .unwrap();
        assert!(!cleanup(&files.0).is_empty());
        assert!(receipt.exists());
        drop(locked);
        assert!(cleanup(&files.0).is_empty());
        assert!(!partial.exists());
        assert!(!receipt.exists());
    }
    #[test]
    fn linked_staging_and_nested_links_do_not_reach_other_folders() {
        let files = Sandbox::new();
        let external = Sandbox::new();
        external.write("keep.bin", b"keep");
        let stage = files.0.join("metadata/staging");
        fs::create_dir_all(&stage).unwrap();
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&external.0, stage.join("123"));
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&external.0, stage.join("123"));
        if linked.is_err() {
            return;
        } // Windows may require Developer Mode.
        assert!(cleanup(&files.0).is_empty());
        assert_eq!(fs::read(external.0.join("keep.bin")).unwrap(), b"keep");
        fs::create_dir(stage.join("456")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&external.0, stage.join("456/link")).unwrap();
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(&external.0, stage.join("456/link")).unwrap();
        assert_eq!(cleanup(&files.0).len(), 1);
        assert_eq!(fs::read(external.0.join("keep.bin")).unwrap(), b"keep");
        // Remove only the links themselves before Sandbox cleans its test tree.
        #[cfg(windows)]
        {
            fs::remove_dir(stage.join("123")).unwrap();
            fs::remove_dir(stage.join("456/link")).unwrap();
        }
        #[cfg(not(windows))]
        {
            fs::remove_file(stage.join("123")).unwrap();
            fs::remove_file(stage.join("456/link")).unwrap();
        }
    }
}
