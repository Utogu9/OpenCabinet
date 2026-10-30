//! AppImage desktop identity must remain available outside its temporary mount.
//! GNOME/Wayland resolves running applications through installed desktop entries.
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

const MANAGED: &str = "X-OpenCabinet-Managed=true";
const ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");

pub fn initialize() -> io::Result<()> {
    // Distribution packages already install their desktop files. Development
    // builds must not register an installed application in the user's menu.
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let Some(image) = std::env::var_os("APPIMAGE") else {
        return Ok(());
    };
    let root =
        crate::platform_runtime::xdg("XDG_DATA_HOME", ".local/share").map_err(io::Error::other)?;
    register(&root, &PathBuf::from(image))
}

fn desktop_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\t', "\\t")
}

fn exec_path(path: &Path) -> io::Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| io::Error::other("Non-UTF-8 AppImage path"))?;
    if text.chars().any(char::is_control) || text.contains('=') {
        return Err(io::Error::other(
            "AppImage path cannot be represented in a desktop entry",
        ));
    }
    // Desktop strings and Exec arguments have separate escaping layers.
    // Never use a shell, expand variables, or let '%' become a field code.
    let mut quoted = String::from("\"");
    for character in text.chars() {
        match character {
            '%' => quoted.push_str("%%"),
            '\\' | '"' | '$' | '`' => {
                quoted.push('\\');
                quoted.push(character);
            }
            _ => quoted.push(character),
        }
    }
    quoted.push('"');
    Ok(desktop_value(&quoted))
}

fn write_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing desktop directory"))?;
    fs::create_dir_all(parent)?;
    let token = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(".opencabinet-{}-{token}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn register(root: &Path, image: &Path) -> io::Result<()> {
    if !root.is_absolute() || !image.is_absolute() || !image.is_file() {
        return Err(io::Error::other("Invalid AppImage desktop location"));
    }
    // Preserve the user's path, including symlinks, so a launcher continues to
    // work when an updater replaces the AppImage at that same location.
    let executable = exec_path(image)?;
    let entry = root.join("applications/opencabinet.desktop");
    match fs::symlink_metadata(&entry) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Ok(());
            }
            let contents = fs::read_to_string(&entry)?;
            if !contents.lines().any(|line| line == MANAGED) {
                return Ok(());
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let icon = root.join("icons/hicolor/256x256/apps/opencabinet.png");
    let icon_name = icon
        .to_str()
        .ok_or_else(|| io::Error::other("Non-UTF-8 icon path"))?;
    let contents = format!(
        // Desktop loaders validate argv[0] before expanding percent codes.
        // A fixed executable preserves literal '%' in the AppImage filename.
        "[Desktop Entry]\nType=Application\nName=OpenCabinet\nExec=/usr/bin/env -- {executable}\nIcon={}\nTerminal=false\nCategories=Game;\nStartupWMClass=opencabinet\nX-AppImage-Name=OpenCabinet\n{MANAGED}\n",
        desktop_value(icon_name),
    );
    write_changed(&icon, ICON)?;
    write_changed(&entry, contents.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let token = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "opencabinet-desktop-{}-{token}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn image(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, b"fixture").unwrap();
            path
        }
        fn data(&self) -> PathBuf {
            self.0.join("Data ñ")
        }
        fn entry(&self) -> PathBuf {
            self.data().join("applications/opencabinet.desktop")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn registers_persistent_icon_and_updates_only_its_own_launcher_after_a_move() {
        let f = Fixture::new();
        let first = f.image("First version.AppImage");
        register(&f.data(), &first).unwrap();
        assert_eq!(
            fs::read(f.data().join("icons/hicolor/256x256/apps/opencabinet.png")).unwrap(),
            ICON
        );
        let initial = fs::read_to_string(f.entry()).unwrap();
        assert!(initial.contains("StartupWMClass=opencabinet\n"));
        assert!(initial.contains(&exec_path(&first).unwrap()));
        let modified = fs::metadata(f.entry()).unwrap().modified().unwrap();
        register(&f.data(), &first).unwrap();
        assert_eq!(
            modified,
            fs::metadata(f.entry()).unwrap().modified().unwrap()
        );
        let moved = f.image("New location.AppImage");
        register(&f.data(), &moved).unwrap();
        let current = fs::read_to_string(f.entry()).unwrap();
        assert!(current.contains(&exec_path(&moved).unwrap()));
        assert!(!current.contains("First version"));
    }

    #[test]
    fn preserves_a_custom_desktop_entry_and_rejects_invalid_paths_without_partial_files() {
        let f = Fixture::new();
        let image = f.image("OpenCabinet.AppImage");
        fs::create_dir_all(f.entry().parent().unwrap()).unwrap();
        fs::write(f.entry(), "[Desktop Entry]\nName=My custom launcher\n").unwrap();
        register(&f.data(), &image).unwrap();
        assert_eq!(
            fs::read_to_string(f.entry()).unwrap(),
            "[Desktop Entry]\nName=My custom launcher\n"
        );
        assert!(!f.data().join("icons").exists());
        let invalid = f.image("Name\nExec=unrelated.AppImage");
        let data = f.0.join("Fresh data");
        assert!(register(&data, &invalid).is_err());
        assert!(!data.exists());
        assert!(register(&data, Path::new("relative.AppImage")).is_err());
    }

    #[test]
    fn desktop_launcher_executes_literal_paths_with_spaces_unicode_and_reserved_characters() {
        let f = Fixture::new();
        let image = f.image(r#"App ñ 日本 %f $HOME `printf nope` \".AppImage"#);
        fs::write(
            &image,
            "#!/bin/sh\nprintf '%s' \"$0\" > \"$OPENCABINET_DESKTOP_TEST\"\n",
        )
        .unwrap();
        fs::set_permissions(&image, fs::Permissions::from_mode(0o755)).unwrap();
        register(&f.data(), &image).unwrap();
        let output = f.0.join("launched.txt");
        let result = std::process::Command::new("gio")
            .arg("launch")
            .arg(f.entry())
            .env("OPENCABINET_DESKTOP_TEST", &output)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stderr),
            fs::read_to_string(f.entry()).unwrap()
        );
        for _ in 0..100 {
            if output.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(fs::read_to_string(output).unwrap(), image.to_str().unwrap());
    }
}
