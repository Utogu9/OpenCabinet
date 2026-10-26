use std::path::{Path, PathBuf};

pub fn supported(platform: &str) -> bool {
    let key: String = platform
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect();
    [
        "ps3",
        "playstation3",
        "sonyplaystation3",
        "ps4",
        "playstation4",
        "sonyplaystation4",
    ]
    .contains(&key.as_str())
}

fn named(path: &Path, value: &str) -> bool {
    path.file_name()
        .is_some_and(|s| s.eq_ignore_ascii_case(value))
}

pub fn title(root: &Path, executable: &Path) -> String {
    let parent = executable.parent().unwrap_or(root);
    let game_folder = parent
        .ancestors()
        .take_while(|p| p.starts_with(root))
        .find_map(|p| {
            (named(p, "PS3_GAME") || named(p, "USRDIR"))
                .then(|| p.parent())
                .flatten()
        })
        .map(|p| {
            if named(p, "PS3_GAME") {
                p.parent().unwrap_or(p)
            } else {
                p
            }
        })
        .map(Path::to_path_buf)
        .unwrap_or_else(|| {
            let relative = parent.strip_prefix(root).unwrap_or(parent);
            // In a library of folders the first component is the game name;
            // selecting the game's folder itself also works.
            relative
                .components()
                .next()
                .map(|c| root.join(c))
                .unwrap_or_else(|| root.to_path_buf())
        });
    super::clean_rom_title(
        game_folder
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(crate::i18n::text("msg.f1a19535b4")),
    )
}

fn ordinary(path: &Path, directory: bool) -> Result<bool, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(false);
        }
        Err(error) => {
            return Err(crate::i18n::i18n_format!(
                "msg.95d85faa99",
                path.display()
            , error = error));
        }
    };
    if metadata.file_type().is_symlink() {
        return Ok(false);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Ok(false);
        }
    }
    Ok(if directory {
        metadata.is_dir()
    } else {
        metadata.is_file()
    })
}

fn component(parent: &Path, name: &str, directory: bool) -> Result<Option<PathBuf>, String> {
    let candidate = parent.join(name);
    if ordinary(&candidate, directory)? {
        return Ok(Some(candidate));
    }
    // Windows already resolves case-insensitively. On other filesystems only
    // inspect this one known level to retain that same filename behaviour.
    #[cfg(not(windows))]
    for entry in std::fs::read_dir(parent).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if named(&path, name) && ordinary(&path, directory)? {
            return Ok(Some(path));
        }
    }
    Ok(None)
}

fn boot(directory: &Path, ps3: bool) -> Result<Option<PathBuf>, String> {
    let mut parent = directory.to_path_buf();
    if ps3 {
        for name in ["PS3_GAME", "USRDIR"] {
            let Some(path) = component(&parent, name, true)? else {
                return Ok(None);
            };
            parent = path;
        }
    }
    component(&parent, "EBOOT.BIN", false)
}

/// Probe the selected folder and its immediate game folders at fixed paths.
/// No recursive search through game assets, invalid folders or update trees.
pub fn discover(
    root: &Path,
    platform: &str,
    mut progress: impl FnMut(&Path),
) -> Result<Vec<(PathBuf, String)>, String> {
    if !supported(platform) {
        return Ok(Vec::new());
    }
    let ps3 = platform.chars().filter(char::is_ascii_alphanumeric).last() == Some('3');
    let game = |directory: &Path, executable: PathBuf| {
        let name = directory
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(crate::i18n::text("msg.f1a19535b4"));
        (executable, super::clean_rom_title(name))
    };
    progress(root);
    if let Some(executable) = boot(root, ps3)? {
        return Ok(vec![game(root, executable)]);
    }
    let mut games = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if named(&path, "PS3_UPDATE") || !ordinary(&path, true)? {
            continue;
        }
        progress(&path);
        if let Some(executable) = boot(&path, ps3)? {
            games.push(game(&path, executable));
        }
    }
    games.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(games)
}
