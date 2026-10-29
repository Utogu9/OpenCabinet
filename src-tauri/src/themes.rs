//! Portable, declarative themes. Imported files cannot supply CSS, scripts or asset paths.
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};

type Result<T> = std::result::Result<T, String>;
static LOCK: Mutex<()> = Mutex::new(());
const BUILTINS: &[&str] = &["builtin-dark", "builtin-light", "builtin-forest", "builtin-spotlight", "builtin-gallery"];
const COLORS: &[&str] = &[
    "background",
    "surface",
    "hover",
    "dialog",
    "sidebar",
    "titlebar",
    "accent",
    "accentHover",
    "text",
    "muted",
    "border",
    "danger",
    "dangerHover",
    "success",
    "warning",
    "buttonText",
];
const SECTIONS: &[&str] = &[
    "logo",
    "identity",
    "media",
    "play",
    "summary",
    "information",
    "description",
];
const FIELDS: &[&str] = &[
    "release",
    "developer",
    "publisher",
    "playtime",
    "genre",
    "mode",
    "file",
    "lastPlayed",
    "players",
    "totalGames",
    "emulator",
    "lastGame",
    "sessions",
    "totalTime",
    "mostPlayed",
];
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn invalid() -> String {
    crate::i18n::text("themes.invalid").into()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    id: String,
    visible: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    panels: Vec<String>,
    library_width: u32,
    details_width: u32,
    cover_size: u32,
    gap: u32,
    radius: u32,
    sections: Vec<Section>,
    hidden_fields: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    format: String,
    version: u32,
    id: String,
    name: String,
    author: String,
    colors: BTreeMap<String, String>,
    layout: Layout,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Library {
    format: String,
    version: u32,
    active: String,
    themes: Vec<Theme>,
}
impl Default for Library {
    fn default() -> Self {
        Self {
            format: "OpenCabinet Themes".into(),
            version: 1,
            active: BUILTINS[0].into(),
            themes: vec![],
        }
    }
}
fn permutation(values: &[String], allowed: &[&str]) -> bool {
    values.len() == allowed.len()
        && values.iter().map(String::as_str).collect::<BTreeSet<_>>()
            == allowed.iter().copied().collect()
}
fn validate(theme: &Theme) -> Result<()> {
    let l = &theme.layout;
    if theme.format != "OpenCabinet Theme"
        || theme.version != 1
        || theme.id.is_empty()
        || theme.id.len() > 80
        || !theme
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        || theme.name.trim().is_empty()
        || theme.name.chars().count() > 100
        || theme.author.chars().count() > 100
        || theme.colors.len() != COLORS.len()
        || COLORS.iter().any(|key| !theme.colors.contains_key(*key))
        || theme.colors.values().any(|color| {
            color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
        })
        || !permutation(&l.panels, &["library", "catalog", "details"])
        || !(160..=420).contains(&l.library_width)
        || !(260..=800).contains(&l.details_width)
        || !(100..=320).contains(&l.cover_size)
        || l.gap > 48
        || l.radius > 24
        || !permutation(
            &l.sections.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            SECTIONS,
        )
        || l.hidden_fields.len() > FIELDS.len()
        || l.hidden_fields
            .iter()
            .any(|s| !FIELDS.contains(&s.as_str()))
        || l.hidden_fields.iter().collect::<BTreeSet<_>>().len() != l.hidden_fields.len()
    {
        return Err(invalid());
    }
    Ok(())
}
fn validate_library(library: &Library) -> Result<()> {
    if library.format != "OpenCabinet Themes" || library.version != 1 || library.themes.len() > 100
    {
        return Err(invalid());
    }
    let mut ids = BTreeSet::new();
    for theme in &library.themes {
        validate(theme)?;
        if !theme.id.starts_with("user-") || !ids.insert(&theme.id) {
            return Err(invalid());
        }
    }
    if !BUILTINS.contains(&library.active.as_str())
        && !library.themes.iter().any(|t| t.id == library.active)
    {
        return Err(invalid());
    }
    Ok(())
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Result<T> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(err)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > limit {
        return Err(invalid());
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}
fn read(root: &Path) -> Result<Library> {
    let path = root.join("themes.json");
    let pending = root.join("themes.pending.json");
    if !path.exists() && pending.exists() {
        let recovered: Library = read_json(&pending, 2 * 1024 * 1024)?;
        validate_library(&recovered)?;
        fs::rename(&pending, &path).map_err(err)?;
    }
    let library = if path.exists() {
        read_json(&path, 2 * 1024 * 1024)?
    } else {
        Library::default()
    };
    validate_library(&library)?;
    if pending.exists() {
        fs::remove_file(pending).map_err(err)?;
    }
    Ok(library)
}
fn write(root: &Path, library: &Library) -> Result<()> {
    validate_library(library)?;
    let bytes = serde_json::to_vec_pretty(library).map_err(err)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(invalid());
    }
    fs::create_dir_all(root).map_err(err)?;
    let pending = root.join("themes.pending.json");
    let mut file = fs::File::create(&pending).map_err(err)?;
    file.write_all(&bytes).map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    fs::rename(pending, root.join("themes.json")).map_err(err)
}
#[tauri::command]
pub async fn get_theme_library() -> Result<Library> {
    tauri::async_runtime::spawn_blocking(|| {
        let _lock = LOCK.lock().map_err(err)?;
        read(&crate::storage::active_directory()?)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn save_theme_library(library: Library) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = LOCK.lock().map_err(err)?;
        write(&crate::storage::active_directory()?, &library)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn import_theme() -> Result<Option<Theme>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .set_title(crate::i18n::text("themes.import"))
            .add_filter("OpenCabinet Theme", &["json"])
            .pick_file()
        else {
            return Ok(None);
        };
        let theme = read_json(&path, 64 * 1024)?;
        validate(&theme)?;
        Ok(Some(theme))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn export_theme(theme: Theme) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        validate(&theme)?;
        let Some(path) = rfd::FileDialog::new()
            .set_title(crate::i18n::text("themes.export"))
            .set_file_name("theme.opencabinet-theme.json")
            .add_filter("OpenCabinet Theme", &["json"])
            .save_file()
        else {
            return Ok(false);
        };
        fs::write(path, serde_json::to_vec_pretty(&theme).map_err(err)?).map_err(err)?;
        Ok(true)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn theme() -> Theme {
        Theme {
            format: "OpenCabinet Theme".into(),
            version: 1,
            id: "user-test".into(),
            name: "Test".into(),
            author: "Utogu".into(),
            colors: COLORS
                .iter()
                .map(|k| (k.to_string(), "#123456".into()))
                .collect(),
            layout: Layout {
                panels: vec!["details".into(), "catalog".into(), "library".into()],
                library_width: 220,
                details_width: 420,
                cover_size: 180,
                gap: 24,
                radius: 8,
                sections: SECTIONS
                    .iter()
                    .map(|id| Section {
                        id: id.to_string(),
                        visible: *id != "logo",
                    })
                    .collect(),
                hidden_fields: vec!["genre".into()],
            },
        }
    }
    #[test]
    fn shared_portable_example_is_valid_and_unknown_properties_are_rejected() {
        let text = include_str!("../../docs/example.opencabinet-theme.json");
        let example: Theme = serde_json::from_str(text).unwrap();
        validate(&example).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(text).unwrap();
        value["css"] = "body { display: none; }".into();
        assert!(serde_json::from_value::<Theme>(value).is_err());
    }
    #[test]
    fn invalid_layouts_versions_colors_and_duplicate_ids_cannot_replace_a_library() {
        let original = theme();
        validate(&original).unwrap();
        for mutate in [
            |t: &mut Theme| t.version = 2,
            |t: &mut Theme| t.layout.panels[0] = "catalog".into(),
            |t: &mut Theme| {
                t.colors
                    .insert("accent".into(), "url(https://example.com)".into())
                    .map(|_| ())
                    .unwrap()
            },
            |t: &mut Theme| t.layout.details_width = 99999,
            |t: &mut Theme| t.layout.hidden_fields.push("script".into()),
        ] {
            let mut changed = original.clone();
            mutate(&mut changed);
            assert!(validate(&changed).is_err());
        }
        let mut library = Library {
            active: original.id.clone(),
            themes: vec![original.clone()],
            ..Library::default()
        };
        validate_library(&library).unwrap();
        library.themes.push(original);
        assert!(validate_library(&library).is_err());
    }
    #[test]
    fn themes_survive_restart_and_reconcile_interrupted_writes() {
        let root = std::env::temp_dir().join(format!(
            "opencabinet-theme-tests-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let library = Library {
            active: "user-test".into(),
            themes: vec![theme()],
            ..Library::default()
        };
        write(&root, &library).unwrap();
        assert_eq!(read(&root).unwrap().themes[0].name, "Test");
        fs::write(root.join("themes.pending.json"), b"interrupted").unwrap();
        assert_eq!(read(&root).unwrap().active, "user-test");
        assert!(!root.join("themes.pending.json").exists());
        fs::rename(root.join("themes.json"), root.join("themes.pending.json")).unwrap();
        assert_eq!(read(&root).unwrap().active, "user-test");
        let mut bad = library.clone();
        bad.active = "unknown".into();
        assert!(write(&root, &bad).is_err());
        assert_eq!(read(&root).unwrap().active, "user-test");
        fs::remove_dir_all(&root).unwrap();
    }
}
