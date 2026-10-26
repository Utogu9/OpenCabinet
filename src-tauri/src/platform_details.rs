use super::{GameImage, PendingImageCopies};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct BoxStyle {
    model: Option<String>,
    color: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    depth: Option<f64>,
    spine_face: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BoxSettings {
    base: BoxStyle,
    regions: BTreeMap<String, BoxStyle>,
}

impl BoxSettings {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self
            .regions
            .keys()
            .any(|region| !["europe", "north_america", "japan"].contains(&region.as_str()))
        {
            return Err(crate::i18n::text("msg.7fdb51f762").into());
        }
        for style in std::iter::once(&self.base).chain(self.regions.values()) {
            if let Some(model) = style.model.as_deref() {
                if ![
                    "dvd",
                    "bluray",
                    "jewel",
                    "jewelPal",
                    "longbox",
                    "switch",
                    "ds",
                    "dsPal",
                    "threeDs",
                    "psp",
                    "vita",
                    "nes",
                    "snes",
                    "sfc",
                    "n64",
                    "gameBoy",
                    "gbaJapan",
                    "genesis",
                    "masterSystem",
                    "gameCubeJapan",
                    "custom",
                ]
                .contains(&model)
                {
                    return Err(crate::i18n::text("msg.b248eae9d6").into());
                }
            }
            if style.color.as_deref().is_some_and(|color| {
                color.len() != 7
                    || !color.starts_with('#')
                    || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            }) {
                return Err(crate::i18n::text("msg.fa0993783c").into());
            }
            if style
                .spine_face
                .as_deref()
                .is_some_and(|face| !["left", "top"].contains(&face))
            {
                return Err(crate::i18n::text("msg.fd68195723").into());
            }
            if style.model.as_deref() == Some("custom") {
                let valid = |value: Option<f64>, min: f64, max: f64| {
                    value.is_some_and(|v| v.is_finite() && v >= min && v <= max)
                };
                if !valid(style.width, 20.0, 500.0)
                    || !valid(style.height, 20.0, 500.0)
                    || !valid(style.depth, 1.0, 150.0)
                {
                    return Err(crate::i18n::text("msg.a6faaa5b13").into());
                }
            } else if style.width.is_some() || style.height.is_some() || style.depth.is_some() {
                return Err(crate::i18n::text("msg.2dd67ce42e").into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlatformDetails {
    #[serde(default)]
    variables: Option<crate::entity_variables::Variables>,
    platform_id: i32,
    release_date: Option<String>,
    developer: Option<String>,
    manufacturer: Option<String>,
    #[serde(default)]
    default_emulator_id: Option<i32>,
    #[serde(default)]
    box_3d: Option<BoxSettings>,
    #[serde(default)]
    pub(super) images: Vec<GameImage>,
}

pub(super) fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS platform_details (
            platform_id INTEGER PRIMARY KEY, release_date TEXT, developer TEXT, manufacturer TEXT
         );
         CREATE TABLE IF NOT EXISTS platform_images (
            platform_id INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
            position INTEGER NOT NULL, PRIMARY KEY(platform_id, path)
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_logo ON platform_images(platform_id) WHERE kind='logo';
         CREATE TRIGGER IF NOT EXISTS remove_platform_details AFTER DELETE ON platforms
         BEGIN
            DELETE FROM platform_details WHERE platform_id=OLD.id;
            DELETE FROM platform_images WHERE platform_id=OLD.id;
         END;"
    )?;
    let columns = conn
        .prepare("PRAGMA table_info(platform_details)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|column| column == "default_emulator_id") {
        conn.execute(
            "ALTER TABLE platform_details ADD COLUMN default_emulator_id INTEGER",
            [],
        )?;
    }
    if !columns.iter().any(|column| column == "box_3d") {
        conn.execute("ALTER TABLE platform_details ADD COLUMN box_3d TEXT", [])?;
    }
    let emulators_exist: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='emulators')",
        [],
        |row| row.get(0),
    )?;
    if emulators_exist {
        conn.execute_batch("CREATE TRIGGER IF NOT EXISTS clear_deleted_default_emulator AFTER DELETE ON emulators
            BEGIN UPDATE platform_details SET default_emulator_id=NULL WHERE default_emulator_id=OLD.rowid; END;
            CREATE TRIGGER IF NOT EXISTS clear_moved_default_emulator AFTER UPDATE OF platform ON emulators
            BEGIN UPDATE platform_details SET default_emulator_id=NULL WHERE default_emulator_id=OLD.rowid
              AND NOT EXISTS(SELECT 1 FROM platforms p WHERE p.id=platform_details.platform_id AND LOWER(p.name)=LOWER(NEW.platform)); END;")?;
    }
    Ok(())
}

// Resolve one emulator for both the executable and the RetroArch core. Legacy
// libraries without console metadata keep their original first-registered choice.
pub(super) fn default_emulator(conn: &Connection, platform: &str) -> Result<Option<i64>, String> {
    let columns = conn
        .prepare("PRAGMA table_info(platform_details)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    let query = if columns.iter().any(|column| column == "default_emulator_id") {
        "SELECT e.rowid FROM emulators e LEFT JOIN platforms p ON LOWER(p.name)=LOWER(e.platform)
         LEFT JOIN platform_details d ON d.platform_id=p.id WHERE LOWER(e.platform)=LOWER(?1)
         ORDER BY CASE WHEN e.rowid=d.default_emulator_id THEN 0 ELSE 1 END,e.rowid LIMIT 1"
    } else {
        "SELECT rowid FROM emulators WHERE LOWER(platform)=LOWER(?1) ORDER BY rowid LIMIT 1"
    };
    conn.query_row(query, [platform], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

pub(super) fn read(conn: &Connection, id: i32, root: &Path) -> Result<PlatformDetails, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM platforms WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err(crate::i18n::text("msg.2566da2e5d").into());
    }
    let mut details = conn
        .query_row(
            "SELECT release_date,developer,manufacturer,default_emulator_id,box_3d FROM platform_details WHERE platform_id=?1",
            [id],
            |row| {
                Ok(PlatformDetails {
                    variables: None,
                    platform_id: id,
                    release_date: row.get(0)?,
                    developer: row.get(1)?,
                    manufacturer: row.get(2)?,
                    default_emulator_id: row.get(3)?,
                    box_3d: row.get::<_, Option<String>>(4)?.map(|json| serde_json::from_str(&json)).transpose()
                        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error)))?,
                    images: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(PlatformDetails {
            variables: None,
            platform_id: id,
            release_date: None,
            developer: None,
            manufacturer: None,
            default_emulator_id: None,
            box_3d: None,
            images: Vec::new(),
        });
    details.variables = Some(crate::entity_variables::read(conn, "platform", id)?);
    details.images = conn
        .prepare("SELECT path,kind FROM platform_images WHERE platform_id=?1 ORDER BY position")
        .map_err(|e| e.to_string())?
        .query_map([id], |row| {
            Ok(GameImage {
                path: row.get(0)?,
                kind: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    for image in &mut details.images {
        image.path = super::resolve_image_path(root, &image.path);
    }
    Ok(details)
}

fn save(
    conn: &mut Connection,
    mut details: PlatformDetails,
    root: &Path,
) -> Result<PlatformDetails, String> {
    let optional_text = |value: Option<String>| {
        value
            .map(|text| text.trim().to_owned())
            .filter(|text| !text.is_empty())
    };
    details.release_date = optional_text(details.release_date);
    details.developer = optional_text(details.developer);
    details.manufacturer = optional_text(details.manufacturer);
    if let Some(settings) = &details.box_3d {
        settings.validate()?;
    }
    let box_3d = details
        .box_3d
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    if details
        .release_date
        .as_deref()
        .is_some_and(|date| !super::valid_release_date(date))
    {
        return Err(
            crate::i18n::text("msg.866ad773b5").into(),
        );
    }
    if details
        .images
        .iter()
        .any(|image| !["logo", "screenshot", "artwork", "other"].contains(&image.kind.as_str()))
    {
        return Err(crate::i18n::text("msg.4c7b49b27f").into());
    }
    super::validate_game_images(&details.images)?;
    let existing = read(conn, details.platform_id, root)?;
    let mut copies = PendingImageCopies(Vec::new());
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    for (index, image) in details.images.iter_mut().enumerate() {
        if existing.images.iter().any(|saved| saved.path == image.path) {
            // Previously managed paths are always stored relative to data/.
            image.path = Path::new(&image.path)
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            continue;
        }
        let source = Path::new(&image.path);
        let extension = super::image_extension(source)?;
        let filename=super::metadata::repository::retained_console_filename(source)
            .map(|name|format!("{unique}-{index}-{name}"))
            .unwrap_or_else(||format!("{unique}-{index}.{extension}"));
        let relative = format!("images/platforms/{}/{filename}",details.platform_id);
        let destination = root.join(&relative);
        fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|e| e.to_string())?;
        copies.0.push(destination);
        std::io::copy(
            &mut fs::File::open(source).map_err(|e| e.to_string())?,
            &mut output,
        )
        .map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        image.path = relative;
    }
    // Copy first so large photos do not lock gameplay statistics while being saved.
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    read(&tx, details.platform_id, root)?;
    if let Some(ref variables) = details.variables {
        crate::entity_variables::save(&tx, "platform", details.platform_id, variables)?;
    }
    if let Some(emulator) = details.default_emulator_id {
        let valid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM emulators e JOIN platforms p ON LOWER(p.name)=LOWER(e.platform) WHERE p.id=?1 AND e.rowid=?2)",
            params![details.platform_id, emulator], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !valid {
            return Err(crate::i18n::text("msg.62a91680c7").into());
        }
    }
    tx.execute("INSERT INTO platform_details(platform_id,release_date,developer,manufacturer,default_emulator_id,box_3d) VALUES (?1,?2,?3,?4,?5,?6)
        ON CONFLICT(platform_id) DO UPDATE SET release_date=excluded.release_date,developer=excluded.developer,manufacturer=excluded.manufacturer,default_emulator_id=excluded.default_emulator_id,box_3d=excluded.box_3d",
        params![details.platform_id, details.release_date, details.developer, details.manufacturer, details.default_emulator_id, box_3d]).map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM platform_images WHERE platform_id=?1",
        [details.platform_id],
    )
    .map_err(|e| e.to_string())?;
    for (position, image) in details.images.iter().enumerate() {
        tx.execute(
            "INSERT INTO platform_images(platform_id,path,kind,position) VALUES (?1,?2,?3,?4)",
            params![details.platform_id, image.path, image.kind, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    // Read before commit: any failure still rolls back the records and copied files.
    let saved = read(&tx, details.platform_id, root)?;
    tx.commit().map_err(|e| e.to_string())?;
    copies.0.clear();
    Ok(saved)
}

#[tauri::command]
pub async fn get_platform_details(platform_id: i32) -> Result<PlatformDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = super::get_db_connection().map_err(|e| e.to_string())?;
        read(
            &conn,
            platform_id,
            &super::data_directory().map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_platform_details(details: PlatformDetails) -> Result<PlatformDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = super::get_db_connection().map_err(|e| e.to_string())?;
        save(
            &mut conn,
            details,
            &super::data_directory().map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    static NEXT_LIBRARY: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    struct Library {
        conn: Connection,
        root: std::path::PathBuf,
    }
    impl Library {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "opencabinet-platform-{}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_LIBRARY.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).unwrap();
            let conn = Connection::open(root.join("library.sqlite")).unwrap();
            conn.execute_batch(
                "CREATE TABLE platforms(id INTEGER PRIMARY KEY, name TEXT);
                INSERT INTO platforms VALUES (1,'SNES'); INSERT INTO platforms VALUES (2,'NES');",
            )
            .unwrap();
            init_schema(&conn).unwrap();
            Self { conn, root }
        }
        fn details(&self) -> PlatformDetails {
            PlatformDetails {
                variables: None,
                platform_id: 1,
                release_date: Some("1990-11-21".into()),
                developer: Some(" Nintendo ".into()),
                manufacturer: Some("Nintendo".into()),
                default_emulator_id: None,
                box_3d: None,
                images: vec![],
            }
        }
        fn image(&self, kind: &str) -> GameImage {
            let path = self.root.join(format!("source-{kind}.png"));
            fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
            GameImage {
                path: path.to_string_lossy().into_owned(),
                kind: kind.into(),
            }
        }
        fn emulators(&self) {
            self.conn.execute_batch("CREATE TABLE emulators(id INTEGER PRIMARY KEY,name TEXT,platform TEXT,executable_path TEXT,arguments TEXT,retroarch_core_path TEXT);
                INSERT INTO emulators VALUES(1,'First','SNES','first.exe','%ROM%',NULL);
                INSERT INTO emulators VALUES(2,'Chosen','SNES','chosen.exe','%ROM%',NULL);
                INSERT INTO emulators VALUES(3,'Other console','NES','other.exe','%ROM%',NULL);").unwrap();
            init_schema(&self.conn).unwrap();
        }
    }
    impl Drop for Library {
        fn drop(&mut self) {
            drop(std::mem::replace(
                &mut self.conn,
                Connection::open_in_memory().unwrap(),
            ));
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn image_files(root: &Path) -> usize {
        fs::read_dir(root)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| {
                if entry.path().is_dir() {
                    image_files(&entry.path())
                } else {
                    1
                }
            })
            .sum()
    }

    #[test]
    fn migrations_are_repeatable_and_existing_platforms_start_without_metadata() {
        let library = Library::new();
        init_schema(&library.conn).unwrap();
        let details = read(&library.conn, 1, &library.root).unwrap();
        assert!(details.release_date.is_none());
        assert!(details.images.is_empty());
        assert!(details.default_emulator_id.is_none());
        assert!(details.box_3d.is_none());
        assert!(read(&library.conn, 999, &library.root).is_err());
    }
    #[test]
    fn downloaded_console_marks_keep_their_catalog_identity_after_saving_and_reopening() {
        let mut library=Library::new();
        let filename=crate::metadata::repository::console_image_filename("Nintendo - GameCube","logo2.svg");
        let source=library.root.join(&filename);
        fs::write(&source,b"<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0'/></svg>").unwrap();
        let mut details=library.details();
        details.images.push(GameImage{path:source.to_string_lossy().into_owned(),kind:"other".into()});
        let saved=save(&mut library.conn,details,&library.root).unwrap();
        let managed=Path::new(&saved.images[0].path);
        assert!(managed.is_file());assert_ne!(managed,source);
        assert_eq!(crate::metadata::repository::retained_console_filename(managed).as_deref(),Some(filename.as_str()));
        let again=save(&mut library.conn,saved,&library.root).unwrap();
        let reopened=Connection::open(library.root.join("library.sqlite")).unwrap();
        assert_eq!(read(&reopened,1,&library.root).unwrap().images[0].path,again.images[0].path);
    }

    #[test]
    fn variables_survive_reopening_and_validation_failures_roll_back_other_details() {
        let mut library = Library::new();
        let mut details = library.details();
        let vars=crate::entity_variables::Variables::from([("portatil".into(),"yes".into())]);
        details.variables=Some(vars.clone());
        save(&mut library.conn,details,&library.root).unwrap();
        let reopened=Connection::open(library.root.join("library.sqlite")).unwrap();
        assert_eq!(read(&reopened,1,&library.root).unwrap().variables,Some(vars.clone()));
        let mut invalid=library.details();invalid.manufacturer=Some("Must roll back".into());
        invalid.variables=Some(crate::entity_variables::Variables::from([("invalid name".into(),"yes".into())]));
        assert!(save(&mut library.conn,invalid,&library.root).is_err());
        let saved=read(&reopened,1,&library.root).unwrap();
        assert_eq!(saved.manufacturer.as_deref(),Some("Nintendo"));assert_eq!(saved.variables,Some(vars));
    }

    #[test]
    fn metadata_survives_rename_and_restart_and_is_removed_with_the_platform() {
        let mut library = Library::new();
        let details = library.details();
        save(&mut library.conn, details, &library.root).unwrap();
        library
            .conn
            .execute("UPDATE platforms SET name='Super Nintendo' WHERE id=1", [])
            .unwrap();
        let reopened = Connection::open(library.root.join("library.sqlite")).unwrap();
        let saved = read(&reopened, 1, &library.root).unwrap();
        assert_eq!(saved.developer.as_deref(), Some("Nintendo"));
        assert_eq!(saved.release_date.as_deref(), Some("1990-11-21"));
        assert!(read(&reopened, 2, &library.root)
            .unwrap()
            .manufacturer
            .is_none());
        library
            .conn
            .execute("DELETE FROM platforms WHERE id=1", [])
            .unwrap();
        let remaining: i64 = library
            .conn
            .query_row("SELECT COUNT(*) FROM platform_details", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn box_styles_survive_restart_rename_and_other_metadata_changes_and_can_be_reset() {
        let mut library = Library::new();
        let mut details = library.details();
        details.box_3d = Some(serde_json::from_value(serde_json::json!({
            "base":{"model":"custom","width":155.5,"height":200,"depth":25,"color":"#123456","spine_face":"top"},
            "regions":{"europe":{"model":"dvd","color":"#163c78"},"north_america":{"model":"dvd"},"japan":{"model":null}}
        })).unwrap());
        save(&mut library.conn, details, &library.root).unwrap();
        library
            .conn
            .execute("UPDATE platforms SET name='Renamed' WHERE id=1", [])
            .unwrap();
        let reopened = Connection::open(library.root.join("library.sqlite")).unwrap();
        let mut saved = read(&reopened, 1, &library.root).unwrap();
        assert_eq!(saved.box_3d.as_ref().unwrap().base.width, Some(155.5));
        assert_eq!(
            saved.box_3d.as_ref().unwrap().regions["europe"]
                .color
                .as_deref(),
            Some("#163c78")
        );
        assert!(read(&reopened, 2, &library.root).unwrap().box_3d.is_none());
        saved.developer = Some("Changed developer".into());
        let mut saved = save(&mut library.conn, saved, &library.root).unwrap();
        assert_eq!(saved.box_3d.as_ref().unwrap().regions.len(), 3);
        saved.box_3d = None;
        assert!(save(&mut library.conn, saved, &library.root)
            .unwrap()
            .box_3d
            .is_none());
    }

    #[test]
    fn tall_jewel_and_square_master_system_formats_survive_storage() {
        let mut library = Library::new();
        for model in ["longbox", "masterSystem"] {
            let mut details = library.details();
            details.box_3d = Some(
                serde_json::from_value(serde_json::json!({
                    "base": {"model": model}, "regions": {}
                }))
                .unwrap(),
            );
            save(&mut library.conn, details, &library.root).unwrap();
            let reopened = Connection::open(library.root.join("library.sqlite")).unwrap();
            assert_eq!(
                read(&reopened, 1, &library.root)
                    .unwrap()
                    .box_3d
                    .unwrap()
                    .base
                    .model
                    .as_deref(),
                Some(model)
            );
        }
    }

    #[test]
    fn invalid_box_styles_never_replace_data_or_copy_images() {
        let mut library = Library::new();
        let details = library.details();
        save(&mut library.conn, details, &library.root).unwrap();
        for style in [
            serde_json::json!({"model":"unknown"}),
            serde_json::json!({"color":"red"}),
            serde_json::json!({"spine_face":"right"}),
            serde_json::json!({"model":"custom","width":0,"height":200,"depth":25}),
            serde_json::json!({"model":"custom","width":100,"height":501,"depth":25}),
            serde_json::json!({"model":"custom","width":100,"height":200,"depth":151}),
            serde_json::json!({"model":"custom","width":100,"height":200}),
            serde_json::json!({"model":"dvd","width":150}),
        ] {
            let mut details = library.details();
            details.developer = Some("Must not save".into());
            details.box_3d = Some(
                serde_json::from_value(serde_json::json!({"base":{},"regions":{"europe":style}}))
                    .unwrap(),
            );
            details.images = vec![library.image("logo")];
            assert!(save(&mut library.conn, details, &library.root).is_err());
            assert_eq!(
                read(&library.conn, 1, &library.root)
                    .unwrap()
                    .developer
                    .as_deref(),
                Some("Nintendo")
            );
            assert_eq!(image_files(&library.root.join("images")), 0);
        }
        let invalid: BoxSettings =
            serde_json::from_value(serde_json::json!({"regions":{"unknown":{}}})).unwrap();
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn images_are_portable_classified_and_reused_without_copying_again() {
        let mut library = Library::new();
        let mut details = library.details();
        details.images = vec![library.image("logo"), library.image("screenshot")];
        let source = details.images[0].path.clone();
        let saved = save(&mut library.conn, details, &library.root).unwrap();
        assert_eq!(saved.images[0].kind, "logo");
        assert_eq!(saved.images[1].kind, "screenshot");
        assert_ne!(source, saved.images[0].path);
        assert!(Path::new(&source).is_file());
        assert_eq!(image_files(&library.root.join("images")), 2);
        save(&mut library.conn, saved, &library.root).unwrap();
        assert_eq!(image_files(&library.root.join("images")), 2);
        let relative: String = library
            .conn
            .query_row(
                "SELECT path FROM platform_images WHERE kind='logo'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!Path::new(&relative).is_absolute());
        let moved = library.root.join("restored-backup");
        assert_eq!(
            read(&library.conn, 1, &moved).unwrap().images[0].path,
            moved.join(relative).to_string_lossy()
        );
        library
            .conn
            .execute("DELETE FROM platforms WHERE id=1", [])
            .unwrap();
        assert_eq!(
            library
                .conn
                .query_row("SELECT COUNT(*) FROM platform_images", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn invalid_dates_duplicate_logos_and_invalid_images_never_replace_saved_details() {
        let mut library = Library::new();
        let details = library.details();
        save(&mut library.conn, details, &library.root).unwrap();
        let mut invalid = library.details();
        invalid.release_date = Some("2026-02-30".into());
        assert!(save(&mut library.conn, invalid, &library.root).is_err());
        let mut invalid = library.details();
        invalid.images = vec![library.image("logo"), library.image("logo")];
        assert!(save(&mut library.conn, invalid, &library.root).is_err());
        let mut invalid = library.details();
        invalid.images = vec![library.image("cover")];
        assert!(save(&mut library.conn, invalid, &library.root).is_err());
        let mut invalid = library.details();
        let image = library.image("screenshot");
        fs::write(&image.path, b"Not an image").unwrap();
        invalid.images = vec![image];
        assert!(save(&mut library.conn, invalid, &library.root).is_err());
        assert_eq!(
            read(&library.conn, 1, &library.root)
                .unwrap()
                .release_date
                .as_deref(),
            Some("1990-11-21")
        );
        assert_eq!(image_files(&library.root.join("images")), 0);
    }

    #[test]
    fn database_failure_rolls_back_metadata_and_removes_copied_images() {
        let mut library = Library::new();
        library.emulators();
        let mut details = library.details();
        details.default_emulator_id = Some(2);
        details.images = vec![library.image("logo")];
        library.conn.execute_batch("CREATE TRIGGER fail_image BEFORE INSERT ON platform_images BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(save(&mut library.conn, details, &library.root).is_err());
        assert!(read(&library.conn, 1, &library.root)
            .unwrap()
            .release_date
            .is_none());
        assert_eq!(image_files(&library.root.join("images")), 0);
        assert!(library.root.join("source-logo.png").is_file());
        assert!(read(&library.conn, 1, &library.root)
            .unwrap()
            .default_emulator_id
            .is_none());
    }

    #[test]
    fn default_emulator_is_persisted_and_invalid_or_foreign_choices_never_replace_it() {
        let mut library = Library::new();
        library.emulators();
        assert_eq!(default_emulator(&library.conn, "snes").unwrap(), Some(1));
        let mut details = library.details();
        details.default_emulator_id = Some(2);
        save(&mut library.conn, details, &library.root).unwrap();
        let reopened = Connection::open(library.root.join("library.sqlite")).unwrap();
        assert_eq!(
            read(&reopened, 1, &library.root)
                .unwrap()
                .default_emulator_id,
            Some(2)
        );
        assert_eq!(default_emulator(&reopened, "SNES").unwrap(), Some(2));
        for id in [3, 999] {
            let mut invalid = library.details();
            invalid.default_emulator_id = Some(id);
            assert!(save(&mut library.conn, invalid, &library.root).is_err());
            assert_eq!(default_emulator(&library.conn, "SNES").unwrap(), Some(2));
        }
        let details = library.details();
        save(&mut library.conn, details, &library.root).unwrap();
        assert_eq!(default_emulator(&library.conn, "SNES").unwrap(), Some(1));
    }

    #[test]
    fn renaming_a_console_preserves_its_default_and_deleting_or_moving_an_emulator_clears_it() {
        let mut library = Library::new();
        library.emulators();
        let mut details = library.details();
        details.default_emulator_id = Some(2);
        save(&mut library.conn, details, &library.root).unwrap();
        library.conn.execute_batch("BEGIN; UPDATE platforms SET name='Super Nintendo' WHERE id=1; UPDATE emulators SET platform='Super Nintendo' WHERE platform='SNES'; COMMIT;").unwrap();
        assert_eq!(
            default_emulator(&library.conn, "Super Nintendo").unwrap(),
            Some(2)
        );
        library
            .conn
            .execute("UPDATE emulators SET platform='NES' WHERE id=2", [])
            .unwrap();
        assert!(read(&library.conn, 1, &library.root)
            .unwrap()
            .default_emulator_id
            .is_none());
        assert_eq!(
            default_emulator(&library.conn, "Super Nintendo").unwrap(),
            Some(1)
        );
        library
            .conn
            .execute(
                "UPDATE emulators SET platform='Super Nintendo' WHERE id=2",
                [],
            )
            .unwrap();
        let mut details = library.details();
        details.default_emulator_id = Some(2);
        save(&mut library.conn, details, &library.root).unwrap();
        library
            .conn
            .execute("DELETE FROM emulators WHERE id=2", [])
            .unwrap();
        assert!(read(&library.conn, 1, &library.root)
            .unwrap()
            .default_emulator_id
            .is_none());
        library
            .conn
            .execute("DELETE FROM emulators WHERE id=1", [])
            .unwrap();
        assert_eq!(
            default_emulator(&library.conn, "Super Nintendo").unwrap(),
            None
        );
    }

    #[test]
    fn launching_uses_the_chosen_executable_arguments_and_its_own_retroarch_core() {
        let mut library = Library::new();
        library.emulators();
        library.conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT,play_time INTEGER DEFAULT 0); INSERT INTO games(id,title,platform,rom_path) VALUES(1,'Game','SNES','C:/ROMs/Game with spaces.sfc');").unwrap();
        super::super::init_game_metadata(&library.conn).unwrap();
        // A core belonging to another emulator must never be mixed into this command.
        library
            .conn
            .execute(
                "UPDATE emulators SET retroarch_core_path='missing.dll' WHERE id=1",
                [],
            )
            .unwrap();
        library
            .conn
            .execute(
                "UPDATE emulators SET arguments='--fullscreen \"%ROM%\"' WHERE id=2",
                [],
            )
            .unwrap();
        let mut details = library.details();
        details.default_emulator_id = Some(2);
        save(&mut library.conn, details, &library.root).unwrap();
        super::super::launch_game_record(&library.conn, 1, |exe, args, _| {
            assert_eq!(exe, "chosen.exe");
            assert_eq!(args, ["--fullscreen", "C:/ROMs/Game with spaces.sfc"]);
            Ok(())
        })
        .unwrap();
        let mut pe = vec![0u8; 80];
        pe[..2].copy_from_slice(b"MZ");
        pe[60..64].copy_from_slice(&64u32.to_le_bytes());
        pe[64..68].copy_from_slice(b"PE\0\0");
        pe[68..70].copy_from_slice(&0x8664u16.to_le_bytes());
        let exe = library.root.join("retroarch.exe");
        let core = library.root.join("snes9x_libretro.dll");
        fs::write(&exe, &pe).unwrap();
        fs::write(&core, &pe).unwrap();
        library.conn.execute("UPDATE emulators SET executable_path=?1,arguments='%ROM%',retroarch_core_path=?2 WHERE id=2",params![exe.to_string_lossy(),core.to_string_lossy()]).unwrap();
        super::super::launch_game_record(&library.conn, 1, |path, args, _| {
            assert_eq!(Path::new(path), exe);
            assert_eq!(
                args,
                ["-L", core.to_str().unwrap(), "C:/ROMs/Game with spaces.sfc"]
            );
            Ok(())
        })
        .unwrap();
    }
}
