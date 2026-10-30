//! Host capabilities and paths. Never infer filesystem semantics from a game title.
use serde::Serialize;
use std::path::{Path, PathBuf};

pub fn path_key(path: &str) -> String {
    if cfg!(windows) {
        path.replace('\\', "/").to_lowercase()
    } else {
        path.to_owned()
    }
}

/// Split a Linux argument template without executing a shell or expanding variables.
pub fn split_arguments(input: &str) -> Vec<String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some('\''), '\'') | (Some('"'), '"') => {
                quote = None;
            }
            (None, '\'') | (None, '"') => {
                quote = Some(c);
                started = true;
            }
            (Some('\''), _) => {
                current.push(c);
                started = true;
            }
            (_, '\\') => {
                started = true;
                if let Some(next) = chars.next() {
                    if quote == Some('"') && !['"', '\\', '$', '`', '\n'].contains(&next) {
                        current.push('\\');
                    }
                    if next != '\n' {
                        current.push(next);
                    }
                } else {
                    current.push('\\');
                }
            }
            (None, c) if c.is_whitespace() => {
                if started {
                    arguments.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            _ => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        arguments.push(current);
    }
    arguments
}

pub fn xdg(variable: &str, fallback: &str) -> Result<PathBuf, String> {
    if let Some(value) = std::env::var_os(variable)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
    {
        return Ok(value);
    }
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .map(|home| home.join(fallback))
        .ok_or_else(|| crate::i18n::text("linux.noHome").into())
}

pub fn locations() -> Result<(PathBuf, PathBuf), String> {
    if cfg!(target_os = "linux") {
        Ok((
            xdg("XDG_CONFIG_HOME", ".config")?.join("opencabinet"),
            xdg("XDG_DATA_HOME", ".local/share")?.join("opencabinet"),
        ))
    } else {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let parent = exe
            .parent()
            .ok_or("Executable has no parent directory")?
            .to_path_buf();
        Ok((parent.clone(), parent.join("data")))
    }
}

pub fn is_windows_executable(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
}
pub fn executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return std::fs::metadata(path).is_ok_and(|m| m.permissions().mode() & 0o111 != 0);
    }
    #[cfg(not(unix))]
    {
        true
    }
}
pub fn find_program(name: &str) -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    if cfg!(target_os = "linux") {
        directories.extend([
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
        if let Some(home) = std::env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/bin"));
        }
    }
    directories
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| executable(p))
}
pub fn retroarch_name() -> &'static str {
    if cfg!(target_os = "linux") {
        "RetroArch-Linux-x86_64.AppImage"
    } else {
        "retroarch.exe"
    }
}
pub fn is_retroarch(path: &Path) -> bool {
    path.file_name().is_some_and(|v| {
        let name = v.to_string_lossy().to_lowercase();
        name == "retroarch.exe"
            || name == "retroarch"
            || name.starts_with("retroarch") && name.ends_with(".appimage")
    })
}
pub fn core_extension() -> &'static str {
    if cfg!(target_os = "linux") {
        "so"
    } else {
        "dll"
    }
}
pub fn buildbot_os() -> &'static str {
    if cfg!(target_os = "linux") {
        "linux"
    } else {
        "windows"
    }
}

/// AppImage's private libraries belong to this application, not to launched games.
pub fn configure_child(command: &mut std::process::Command) {
    #[cfg(target_os = "linux")]
    {
        if let Some(directory) = std::env::var_os("APPDIR").map(PathBuf::from) {
            for name in [
                "LD_LIBRARY_PATH",
                "GTK_PATH",
                "GIO_EXTRA_MODULES",
                "GST_PLUGIN_PATH",
            ] {
                if let Some(value) = std::env::var_os(name) {
                    let paths: Vec<_> = std::env::split_paths(&value)
                        .filter(|p| !p.starts_with(&directory))
                        .collect();
                    if paths.is_empty() {
                        command.env_remove(name);
                    } else if let Ok(value) = std::env::join_paths(paths) {
                        command.env(name, value);
                    }
                }
            }
            command.env_remove("APPDIR").env_remove("APPIMAGE");
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = command;
}

#[cfg(target_os = "linux")]
fn desktop_open(target: &std::ffi::OsStr) -> Result<(), String> {
    let executable = find_program("xdg-open").ok_or(crate::i18n::text("linux.desktopMissing"))?;
    let mut command = std::process::Command::new(executable);
    configure_child(&mut command);
    command.arg(target);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
pub fn open_path(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        path.metadata().map_err(|e| e.to_string())?;
        desktop_open(path.as_os_str())
    }
    #[cfg(not(target_os = "linux"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<String>)
            .map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub fn open_project_repository() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        desktop_open(std::ffi::OsStr::new(
            "https://github.com/Utogu9/OpenCabinet",
        ))
    }
    #[cfg(not(target_os = "linux"))]
    {
        tauri_plugin_opener::open_url("https://github.com/Utogu9/OpenCabinet", None::<&str>)
            .map_err(|e| e.to_string())
    }
}

#[derive(Serialize)]
pub struct Capabilities {
    os: &'static str,
    arch: &'static str,
    epic: bool,
    wine: bool,
    proton: bool,
}
#[tauri::command]
pub fn get_runtime_capabilities() -> Capabilities {
    Capabilities {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        epic: cfg!(windows),
        wine: cfg!(target_os = "linux"),
        proton: cfg!(target_os = "linux"),
    }
}
#[tauri::command]
pub async fn choose_runtime_path(directory: bool) -> Option<String> {
    let dialog = rfd::AsyncFileDialog::new();
    let picked = if directory {
        dialog.pick_folder().await
    } else {
        dialog.pick_file().await
    };
    picked.map(|file| file.path().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_identity_follows_host_semantics() {
        assert_eq!(path_key("Game.iso") == path_key("game.iso"), cfg!(windows));
        assert_eq!(path_key("a\\b") == path_key("a/b"), cfg!(windows));
    }
    #[test]
    fn artifact_names_match_host() {
        assert_eq!(
            core_extension(),
            if cfg!(target_os = "linux") {
                "so"
            } else {
                "dll"
            }
        );
        assert!(is_retroarch(Path::new("RetroArch-x86_64.AppImage")));
    }
    #[test]
    fn linux_arguments_preserve_quotes_empty_values_and_literal_shell_text() {
        assert_eq!(
            split_arguments(
                "--profile 'My Profile' --empty \"\" path\\ with\\ spaces \"%ROM%\" $(echo)"
            ),
            [
                "--profile",
                "My Profile",
                "--empty",
                "",
                "path with spaces",
                "%ROM%",
                "$(echo)"
            ]
        );
    }
}
