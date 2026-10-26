use super::{RomCandidate, ScanPreview};
use rusqlite::Connection;
use std::path::Path;

pub(super) fn is_pc_platform(platform: &str) -> bool {
    let name: String = platform
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect();
    [
        "pc",
        "pcgames",
        "pcwindows",
        "windows",
        "windowsgames",
        "microsoftwindows",
    ]
    .contains(&name.as_str())
}

pub(super) fn validate_pc_executable(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_absolute()
        || !path.is_file()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err(crate::i18n::text("msg.035e4bce3e").into());
    }
    Ok(())
}

pub(super) fn import_launch_mode(platform: &str, path: &str) -> Result<bool, String> {
    let direct = is_pc_platform(platform);
    if direct {
        validate_pc_executable(path)?;
    }
    Ok(direct)
}

#[tauri::command]
pub async fn select_game_file(
    platform: String,
    extensions: Option<Vec<String>>,
) -> Result<Option<RomCandidate>, String> {
    // A native dialog yields while it is open; no executable is run by importing.
    let mut dialog = rfd::AsyncFileDialog::new().set_title(crate::i18n::text("msg.24772d158f"));
    if is_pc_platform(&platform) {
        dialog = dialog.add_filter(crate::i18n::text("msg.d446c9cf66"), &["exe"]);
    } else {
        let mut extensions: Vec<String> = extensions
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().trim_start_matches('.').to_owned())
            .filter(|value| !value.is_empty())
            .collect();
        if crate::folder_games::supported(&platform) && !extensions.iter().any(|e| e.eq_ignore_ascii_case("bin")) { extensions.push("bin".into()); }
        if !extensions.is_empty() {
            dialog = dialog.add_filter(crate::i18n::text("msg.d5dd7892dc"), &extensions);
        }
        dialog = dialog.add_filter(crate::i18n::text("msg.a4a04914f5"), &["*"]);
    }
    Ok(dialog.pick_file().await.map(|file| RomCandidate { discs: Vec::new(), existing_game_id: None,
        steam: None, epic: None,
        title: if crate::folder_games::supported(&platform) && file.path().file_name().is_some_and(|s| s.eq_ignore_ascii_case("eboot.bin")) {
            crate::folder_games::title(file.path().parent().unwrap_or(file.path()), file.path())
        } else { super::clean_rom_title(
            file.path()
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(crate::i18n::text("msg.f1a19535b4")),
        ) },
        rom_path: file.path().to_string_lossy().into_owned(),
    }))
}

#[tauri::command]
pub async fn preview_single_game(
    file_path: String,
    platform: String,
    title: String,
) -> Result<ScanPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = super::get_db_connection().map_err(|e| e.to_string())?;
        preview_file(&conn, &file_path, &platform, &title)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn preview_file(
    conn: &Connection,
    file_path: &str,
    platform: &str,
    title: &str,
) -> Result<ScanPreview, String> {
    let path = Path::new(file_path);
    if platform.trim().is_empty() {
        return Err(crate::i18n::text("msg.a48a7d3fe3").into());
    }
    if !path.is_absolute() || !path.is_file() {
        return Err(crate::i18n::text("msg.49c63cfbe9").into());
    }
    import_launch_mode(platform, file_path)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(crate::i18n::text("msg.d5bb3e5960").into());
    }
    let exists = crate::discs::owner(conn,file_path)?.is_some();
    Ok(ScanPreview {
        games: if exists {
            vec![]
        } else {
            vec![RomCandidate { discs: if !is_pc_platform(platform) && crate::discs::identify(file_path).is_some() { vec![crate::discs::source(file_path)] } else { Vec::new() }, existing_game_id: None,
                steam: None, epic: None,
                title: title.into(),
                rom_path: file_path.into(),
            }]
        },
        total_found: 1,
        skipped_count: usize::from(exists),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    struct Files(PathBuf);
    impl Files {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "opencabinet-manual-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str) -> String {
            let path = self.0.join(name);
            fs::write(&path, b"test file").unwrap();
            path.to_string_lossy().into_owned()
        }
        fn database(&self) -> Connection {
            let conn = Connection::open(self.0.join("library.db")).unwrap();
            conn.execute_batch("CREATE TABLE IF NOT EXISTS games(id INTEGER PRIMARY KEY,title TEXT NOT NULL,platform TEXT NOT NULL,rom_path TEXT NOT NULL UNIQUE,cover_path TEXT,play_time INTEGER DEFAULT 0,release_date TEXT,developer TEXT,publisher TEXT);").unwrap();
            crate::init_game_metadata(&conn).unwrap();
            conn
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            assert!(self.0.is_absolute() && self.0.starts_with(std::env::temp_dir()));
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn pc_preview_is_manual_preserves_reviewed_titles_and_skips_duplicates() {
        let files = Files::new();
        let mut conn = files.database();
        let path = files.file("Game with spaces.EXE");
        files.file("Unselected.exe");
        let preview = preview_file(&conn, &path, "PC", "  Título revisado  ").unwrap();
        assert_eq!(preview.games.len(), 1);
        assert_eq!(preview.games[0].title, "Título revisado");
        assert_eq!(preview.games[0].rom_path, path);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        crate::import_roms(&mut conn, preview.clone(), "PC", |_| {}).unwrap();
        assert!(
            conn.query_row("SELECT launch_directly FROM games", [], |r| r
                .get::<_, bool>(0))
                .unwrap()
        );
        let duplicate = preview_file(&conn, &path, "PC", "Other title").unwrap();
        assert!(duplicate.games.is_empty());
        assert_eq!(duplicate.skipped_count, 1);
        let result = crate::import_roms(&mut conn, preview, "PC", |_| {}).unwrap();
        assert_eq!(result.added_count, 0);
        assert_eq!(result.skipped_count, 1);
        assert_eq!(
            conn.query_row("SELECT title FROM games", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Título revisado"
        );
    }

    #[test]
    fn direct_launch_survives_restart_and_platform_rename_and_uses_the_game_directory() {
        let files = Files::new();
        let path = files.file("Game with spaces.exe");
        {
            let mut conn = files.database();
            let preview = preview_file(&conn, &path, "Windows", "Reviewed game").unwrap();
            crate::import_roms(&mut conn, preview, "Windows", |_| {}).unwrap();
        }
        let conn = files.database();
        crate::game_execution::save(&conn, 1, "Windows", &crate::game_execution::ExecutionOptions {
            emulator_id: None, arguments: Some("--windowed --profile \"My Profile\"".into()),
        }).unwrap();
        conn.execute("UPDATE games SET platform='My renamed platform'", [])
            .unwrap();
        let (launch, ()) =
            crate::launch_game_record(&conn, 1, |executable, args, working_directory| {
                assert_eq!(executable, path);
                assert_eq!(args, &["--windowed", "--profile", "My Profile"]);
                assert_eq!(working_directory, Path::new(&path).parent());
                Ok(())
            })
            .unwrap();
        assert_eq!(launch.stats.session_count, 1);
        assert!(launch.stats.last_played.is_some());
        let before: (i64, String) = conn
            .query_row("SELECT session_count,last_played FROM games", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert!(
            crate::launch_game_record(&conn, 1, |_, _, _| Err::<(), _>("Launch failed".into()))
                .is_err()
        );
        let after: (i64, String) = conn
            .query_row("SELECT session_count,last_played FROM games", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(before, after);
        fs::remove_file(path).unwrap();
        assert!(crate::launch_game_record(&conn, 1, |_, _, _| Ok(())).is_err());
    }

    #[test]
    fn invalid_or_missing_files_and_empty_titles_are_rejected_without_importing() {
        let files = Files::new();
        let mut conn = files.database();
        let exe = files.file("game.exe");
        let rom = files.file("game.sfc");
        let disc_named_exe = files.file("Setup (Disc 1).exe");
        assert!(preview_file(&conn,&disc_named_exe,"PC","PC game").unwrap().games[0].discs.is_empty());
        for (path, platform, title) in [
            (&rom[..], "PC", "Game"),
            (&exe[..], "PC", " "),
            (&exe[..], "", "Game"),
            ("relative.exe", "PC", "Game"),
            (files.0.to_str().unwrap(), "PC", "Game"),
        ] {
            assert!(preview_file(&conn, path, platform, title).is_err());
        }
        let preview = preview_file(&conn, &exe, "PC", "Game").unwrap();
        fs::remove_file(&exe).unwrap();
        assert!(crate::import_roms(&mut conn, preview, "PC", |_| {}).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        let preview = preview_file(&conn, &rom, "SNES", "Reviewed ROM").unwrap();
        crate::import_roms(&mut conn, preview, "SNES", |_| {}).unwrap();
        assert!(
            !conn
                .query_row("SELECT launch_directly FROM games", [], |r| r
                    .get::<_, bool>(0))
                .unwrap()
        );
        for platform in ["PC", "PC (Windows)", "Microsoft Windows", "Windows Games"] {
            assert!(is_pc_platform(platform));
        }
        for platform in ["DOS", "PS2", "PC Engine", "PC-98"] {
            assert!(!is_pc_platform(platform));
        }
    }
}
