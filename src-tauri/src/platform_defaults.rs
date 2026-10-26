//! Built-in console names and the one-time catalog upgrade. User data stays on its original IDs.
use rusqlite::{Connection, OptionalExtension};
use std::{collections::HashMap, sync::LazyLock};

struct Platform {
    name: &'static str,
    extensions: &'static str,
    aliases: &'static [&'static str],
}
const DEFAULTS: &[Platform] = &[
    Platform {
        name: "Arcade",
        extensions: ".zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Atari 2600",
        extensions: ".a26, .bin, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Atari 5200",
        extensions: ".a52, .bin, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Atari 7800",
        extensions: ".a78, .bin, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Atari Jaguar",
        extensions: ".j64, .jag, .rom, .abs, .cof, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Atari Lynx",
        extensions: ".lnx, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Bandai WonderSwan",
        extensions: ".ws, .zip, .7z",
        aliases: &["WonderSwan"],
    },
    Platform {
        name: "Bandai WonderSwan Color",
        extensions: ".wsc, .zip, .7z",
        aliases: &["WonderSwan Color"],
    },
    Platform {
        name: "Coleco ColecoVision",
        extensions: ".col, .rom, .zip, .7z",
        aliases: &["ColecoVision"],
    },
    Platform {
        name: "Mattel Intellivision",
        extensions: ".int, .bin, .rom, .zip, .7z",
        aliases: &["Intellivision"],
    },
    Platform {
        name: "Microsoft Xbox",
        extensions: ".iso, .xbe",
        aliases: &["Xbox"],
    },
    Platform {
        name: "Microsoft Xbox 360",
        extensions: ".iso, .god, .xex",
        aliases: &["Xbox 360"],
    },
    Platform {
        name: "Microsoft Xbox One",
        extensions: ".xvd, .xvc",
        aliases: &["Xbox One"],
    },
    Platform {
        name: "Microsoft Xbox Series X/S",
        extensions: ".xvd, .xvc",
        aliases: &["Xbox Series", "Xbox Series X", "Xbox Series S"],
    },
    Platform {
        name: "NEC PC Engine / TurboGrafx-16",
        extensions: ".pce, .zip, .7z",
        aliases: &["PC Engine", "TurboGrafx-16"],
    },
    Platform {
        name: "NEC PC Engine CD",
        extensions: ".cue, .chd, .iso",
        aliases: &["PC Engine CD", "TurboGrafx-CD"],
    },
    Platform {
        name: "NEC SuperGrafx",
        extensions: ".sgx, .pce, .zip, .7z",
        aliases: &["SuperGrafx"],
    },
    Platform {
        name: "Nintendo NES",
        extensions: ".nes, .zip, .7z",
        aliases: &["NES", "Nintendo Entertainment System"],
    },
    Platform {
        name: "Nintendo SNES",
        extensions: ".sfc, .smc, .zip, .7z",
        aliases: &[
            "SNES",
            "Super Nintendo",
            "Super Nintendo Entertainment System",
        ],
    },
    Platform {
        name: "Nintendo 64",
        extensions: ".z64, .n64, .v64, .zip, .7z",
        aliases: &["N64"],
    },
    Platform {
        name: "Nintendo GameCube",
        extensions: ".iso, .gcm, .rvz, .nkit.iso",
        aliases: &["GameCube"],
    },
    Platform {
        name: "Nintendo Wii",
        extensions: ".iso, .wbfs, .rvz",
        aliases: &["Wii"],
    },
    Platform {
        name: "Nintendo Wii U",
        extensions: ".wud, .wux, .wua, .rpx",
        aliases: &["Wii U"],
    },
    Platform {
        name: "Nintendo Switch",
        extensions: ".nsp, .xci",
        aliases: &[],
    },
    Platform {
        name: "Nintendo Switch 2",
        extensions: ".nsp, .xci",
        aliases: &[],
    },
    Platform {
        name: "Nintendo Game Boy",
        extensions: ".gb, .zip, .7z",
        aliases: &["Game Boy"],
    },
    Platform {
        name: "Nintendo Game Boy Color",
        extensions: ".gbc, .zip, .7z",
        aliases: &["Game Boy Color"],
    },
    Platform {
        name: "Nintendo Game Boy Advance",
        extensions: ".gba, .zip, .7z",
        aliases: &["Game Boy Advance"],
    },
    Platform {
        name: "Nintendo Virtual Boy",
        extensions: ".vb, .vboy, .zip, .7z",
        aliases: &["Virtual Boy"],
    },
    Platform {
        name: "Nintendo DS",
        extensions: ".nds, .zip, .7z",
        aliases: &[],
    },
    Platform {
        name: "Nintendo 3DS",
        extensions: ".3ds, .cci, .cxi, .cia, .zcci",
        aliases: &[],
    },
    Platform {
        name: "Nintendo Famicom Disk System",
        extensions: ".fds, .zip, .7z",
        aliases: &["Famicom Disk System"],
    },
    Platform {
        name: "3DO Interactive Multiplayer",
        extensions: ".iso, .cue, .chd",
        aliases: &["3DO", "Panasonic 3DO"],
    },
    Platform {
        name: "Philips CD-i",
        extensions: ".chd, .cue, .iso",
        aliases: &["CD-i"],
    },
    Platform {
        name: "Sega SG-1000",
        extensions: ".sg, .zip, .7z",
        aliases: &["SG-1000"],
    },
    Platform {
        name: "Sega Master System",
        extensions: ".sms, .zip, .7z",
        aliases: &["Master System"],
    },
    Platform {
        name: "Sega Mega Drive / Genesis",
        extensions: ".md, .bin, .gen, .smd, .zip, .7z",
        aliases: &["Genesis", "Mega Drive", "Sega Genesis", "Sega Mega Drive"],
    },
    Platform {
        name: "Sega Mega-CD / Sega CD",
        extensions: ".cue, .chd, .iso",
        aliases: &["Sega CD", "Mega-CD", "Sega Mega-CD"],
    },
    Platform {
        name: "Sega 32X",
        extensions: ".32x, .bin, .zip, .7z",
        aliases: &["32X"],
    },
    Platform {
        name: "Sega Saturn",
        extensions: ".cue, .chd, .iso",
        aliases: &["Saturn"],
    },
    Platform {
        name: "Sega Dreamcast",
        extensions: ".cdi, .gdi, .chd",
        aliases: &["Dreamcast"],
    },
    Platform {
        name: "Sega Game Gear",
        extensions: ".gg, .zip, .7z",
        aliases: &["Game Gear"],
    },
    Platform {
        name: "SNK Neo Geo",
        extensions: ".zip, .7z",
        aliases: &["Neo Geo"],
    },
    Platform {
        name: "SNK Neo Geo CD",
        extensions: ".cue, .chd, .iso",
        aliases: &["Neo Geo CD"],
    },
    Platform {
        name: "SNK Neo Geo Pocket",
        extensions: ".ngp, .zip, .7z",
        aliases: &["Neo Geo Pocket"],
    },
    Platform {
        name: "SNK Neo Geo Pocket Color",
        extensions: ".ngc, .zip, .7z",
        aliases: &["Neo Geo Pocket Color"],
    },
    Platform {
        name: "Sony PlayStation",
        extensions: ".iso, .bin, .cue, .chd, .pbp",
        aliases: &["PlayStation", "PS1", "PSX"],
    },
    Platform {
        name: "Sony PlayStation 2",
        extensions: ".iso, .bin, .chd, .gz",
        aliases: &["PlayStation 2", "PS2"],
    },
    Platform {
        name: "Sony PlayStation 3",
        extensions: ".iso, .pkg, .bin",
        aliases: &["PlayStation 3", "PS3"],
    },
    Platform {
        name: "Sony PlayStation 4",
        extensions: ".pkg, .bin",
        aliases: &["PlayStation 4", "PS4"],
    },
    Platform {
        name: "Sony PlayStation 5",
        extensions: ".pkg",
        aliases: &["PlayStation 5", "PS5"],
    },
    Platform {
        name: "Sony PSP",
        extensions: ".iso, .cso, .pbp",
        aliases: &["PSP", "PlayStation Portable", "Sony PlayStation Portable"],
    },
    Platform {
        name: "Sony PlayStation Vita",
        extensions: ".vpk",
        aliases: &["PS Vita", "PlayStation Vita", "Sony PS Vita"],
    },
    Platform {
        name: "PC",
        extensions: ".exe",
        aliases: &[],
    },
];
fn key(name: &str) -> String {
    name.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}
static NAMES: LazyLock<HashMap<String, &'static Platform>> = LazyLock::new(|| {
    let mut names = HashMap::new();
    for platform in DEFAULTS {
        for name in std::iter::once(&platform.name).chain(platform.aliases.iter()) {
            names.insert(key(name), platform);
        }
    }
    names
});
fn definition(name: &str) -> Option<&'static Platform> {
    NAMES.get(&key(name)).copied()
}
// Manifests from before the rename must remain recoverable, including offline restores.
pub(crate) fn equivalent(a: &str, b: &str) -> bool {
    let canonical = |name: &str| {
        definition(name).map_or_else(
            || name.replace('\\', "/").to_lowercase(),
            |p| p.name.to_lowercase(),
        )
    };
    canonical(a) == canonical(b)
}
fn update_associations(conn: &Connection, old: &str, new: &str) -> rusqlite::Result<()> {
    for table in ["games", "emulators"] {
        conn.execute(
            &format!("UPDATE {table} SET platform=?1 WHERE LOWER(TRIM(platform))=LOWER(TRIM(?2))"),
            (new, old),
        )?;
    }
    Ok(())
}

pub(crate) fn init(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS platforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, default_extensions TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS platform_catalog_versions(version INTEGER PRIMARY KEY);")?;
    // Old libraries may only have names on games/emulators. Keep their spelling
    // until migration, and use real extensions for recognized systems.
    let legacy = tx
        .prepare("SELECT platform FROM games UNION SELECT platform FROM emulators")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for old in legacy {
        let name = old.trim();
        if name.is_empty() {
            continue;
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM platforms WHERE LOWER(name)=LOWER(?1))",
            [name],
            |r| r.get(0),
        )?;
        if exists {
            continue;
        }
        let known = definition(name);
        if let Some(known) = known {
            let canonical: Option<String> = tx
                .query_row(
                    "SELECT name FROM platforms WHERE LOWER(name)=LOWER(?1)",
                    [known.name],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(canonical) = canonical {
                update_associations(&tx, name, &canonical)?;
                continue;
            }
        }
        tx.execute(
            "INSERT INTO platforms(name,default_extensions) VALUES (?1,?2)",
            (
                name,
                known.map_or(".iso, .zip, .7z, .bin", |p| p.extensions),
            ),
        )?;
    }
    let migrated: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM platform_catalog_versions WHERE version=1)",
        [],
        |r| r.get(0),
    )?;
    if !migrated {
        let saved = tx
            .prepare("SELECT id,name FROM platforms ORDER BY id")?
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, old) in saved {
            let Some(known) = definition(&old) else {
                continue;
            };
            if old == known.name {
                continue;
            }
            let collision: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM platforms WHERE LOWER(name)=LOWER(?1) AND id<>?2)",
                (known.name, id),
                |r| r.get(0),
            )?;
            // Two configured platforms must never be merged implicitly.
            if collision {
                continue;
            }
            tx.execute("UPDATE platforms SET name=?1 WHERE id=?2", (known.name, id))?;
            update_associations(&tx, &old, known.name)?;
        }
        for platform in DEFAULTS {
            tx.execute("INSERT INTO platforms(name,default_extensions) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM platforms WHERE LOWER(name)=LOWER(?1))", (platform.name,platform.extensions))?;
        }
        tx.execute(
            "INSERT INTO platform_catalog_versions(version) VALUES (1)",
            [],
        )?;
    }
    // Extend the previous built-in 3DS list, preserving custom filters.
    tx.execute("UPDATE platforms SET default_extensions='.3ds, .cci, .cxi, .cia, .zcci'
        WHERE LOWER(name) IN ('nintendo 3ds','3ds') AND default_extensions='.3ds, .cci, .cxi, .cia'", [])?;
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn library() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,platform TEXT,play_time INTEGER DEFAULT 0);
            CREATE TABLE emulators(id INTEGER PRIMARY KEY,platform TEXT);
            CREATE TABLE platforms(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,default_extensions TEXT NOT NULL,launch\u{0062}ox_platform TEXT);
            CREATE TABLE platform_details(platform_id INTEGER PRIMARY KEY,default_emulator_id INTEGER,box_3d TEXT);").unwrap();
        conn
    }
    #[test]
    fn adds_zcci_to_the_previous_default_without_replacing_custom_3ds_filters() {
        let conn=library();init(&conn).unwrap();
        conn.execute("UPDATE platforms SET default_extensions='.3ds, .cci, .cxi, .cia' WHERE name='Nintendo 3DS'",[]).unwrap();
        init(&conn).unwrap();
        let extensions:String=conn.query_row("SELECT default_extensions FROM platforms WHERE name='Nintendo 3DS'",[],|r|r.get(0)).unwrap();
        assert!(extensions.contains(".zcci"));
        conn.execute("UPDATE platforms SET default_extensions='.3ds, .custom' WHERE name='Nintendo 3DS'",[]).unwrap();
        init(&conn).unwrap();
        let custom:String=conn.query_row("SELECT default_extensions FROM platforms WHERE name='Nintendo 3DS'",[],|r|r.get(0)).unwrap();
        assert_eq!(custom,".3ds, .custom");
    }

    #[test]
    fn seeds_complete_brand_first_catalog_and_valid_extensions() {
        let conn = library();
        init(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM platforms", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, DEFAULTS.len() as i64);
        assert!(count >= 50);
        for name in [
            "Sony PlayStation 3",
            "Sony PlayStation 4",
            "Sony PlayStation 5",
            "Sony PlayStation Vita",
            "Nintendo Game Boy",
            "Nintendo Wii U",
            "Nintendo Switch 2",
            "Microsoft Xbox One",
            "Microsoft Xbox Series X/S",
            "Sega Saturn",
            "Sega Master System",
            "Sega Game Gear",
            "Atari 2600",
            "SNK Neo Geo CD",
        ] {
            let ext: String = conn
                .query_row(
                    "SELECT default_extensions FROM platforms WHERE name=?1",
                    [name],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(!ext.is_empty());
            assert!(ext.split(',').all(|e| e.trim().starts_with('.')));
        }
        let mut names = std::collections::HashSet::new();
        for p in DEFAULTS {
            assert!(names.insert(key(p.name)), "duplicate platform: {}", p.name);
        }
    }
    #[test]
    fn migration_preserves_ids_extensions_settings_and_statistics() {
        let conn = library();
        conn.execute_batch(
            "INSERT INTO platforms VALUES(7,'Wii','.rvz','Nintendo Wii');
            INSERT INTO games VALUES(10,'wii',123); INSERT INTO emulators VALUES(15,'Wii');
            INSERT INTO platform_details VALUES(7,15,'custom case');
            INSERT INTO platforms VALUES(8,'Sony Playstation 2','.iso',NULL);",
        )
        .unwrap();
        init(&conn).unwrap();
        let row: (String, String, String) = conn
            .query_row(
                "SELECT name,default_extensions,launch\u{0062}ox_platform FROM platforms WHERE id=7",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            ("Nintendo Wii".into(), ".rvz".into(), "Nintendo Wii".into())
        );
        for table in ["games", "emulators"] {
            let p: String = conn
                .query_row(&format!("SELECT platform FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(p, "Nintendo Wii");
        }
        assert_eq!(
            conn.query_row("SELECT play_time FROM games WHERE id=10", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            123
        );
        assert_eq!(
            conn.query_row(
                "SELECT default_emulator_id FROM platform_details WHERE platform_id=7",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            15
        );
        assert_eq!(
            conn.query_row("SELECT name FROM platforms WHERE id=8", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Sony PlayStation 2"
        );
    }
    #[test]
    fn deleted_defaults_and_customized_names_are_not_reinserted_on_restart() {
        let conn = library();
        init(&conn).unwrap();
        conn.execute_batch(
            "DELETE FROM platforms WHERE name='Sony PlayStation 5';
            UPDATE platforms SET name='My Wii',default_extensions='.mine' WHERE name='Nintendo Wii';
            INSERT INTO platforms(name,default_extensions) VALUES('My custom console','.custom');",
        )
        .unwrap();
        init(&conn).unwrap();
        init(&conn).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM platforms WHERE name IN ('Nintendo Wii','Sony PlayStation 5')",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(
            conn.query_row(
                "SELECT default_extensions FROM platforms WHERE name='My Wii'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            ".mine"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM platforms WHERE name='My custom console'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn conflicting_configured_platforms_are_never_merged_or_overwritten() {
        let conn = library();
        conn.execute_batch("INSERT INTO platforms VALUES(1,'SNES','.smc',NULL);
            INSERT INTO platforms VALUES(2,'Nintendo SNES','.sfc','Super Nintendo Entertainment System');
            INSERT INTO games VALUES(10,'SNES',20);INSERT INTO platform_details VALUES(1,NULL,'first');
            INSERT INTO platform_details VALUES(2,NULL,'second');").unwrap();
        init(&conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT name FROM platforms WHERE id=1", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "SNES"
        );
        assert_eq!(
            conn.query_row(
                "SELECT box_3d FROM platform_details WHERE platform_id=2",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "second"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM platforms WHERE name='Nintendo SNES'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
    }
    #[test]
    fn migration_rolls_back_when_an_association_cannot_be_renamed() {
        let conn = library();
        conn.execute_batch("INSERT INTO platforms VALUES(1,'Wii','.rvz',NULL);INSERT INTO emulators VALUES(1,'Wii');
            CREATE TRIGGER fail_migration BEFORE UPDATE ON emulators BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(init(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT name FROM platforms WHERE id=1", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Wii"
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM platforms", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        conn.execute_batch("DROP TRIGGER fail_migration;").unwrap();
        init(&conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT name FROM platforms WHERE id=1", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "Nintendo Wii"
        );
    }
    #[test]
    fn legacy_names_bind_to_existing_canonical_platform_without_creating_a_duplicate() {
        let conn = library();
        conn.execute_batch("INSERT INTO platforms VALUES(2,'Sony PlayStation 2','.chd',NULL);
            INSERT INTO games VALUES(10,'PlayStation 2',30); INSERT INTO emulators VALUES(1,'PlayStation 2');").unwrap();
        init(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM platforms WHERE LOWER(name)='playstation 2'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT platform FROM games", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "Sony PlayStation 2"
        );
    }
    #[test]
    fn manifests_recognize_legacy_platforms_without_collapsing_custom_names() {
        assert!(equivalent("SNES", "Nintendo SNES"));
        assert!(equivalent("PlayStation 2", "Sony PlayStation 2"));
        assert!(equivalent("Genesis", "Sega Mega Drive / Genesis"));
        assert!(equivalent("Custom Console", "custom console"));
        assert!(!equivalent("Custom-A", "Custom A"));
        assert!(!equivalent("Nintendo NES", "Nintendo SNES"));
        assert!(!equivalent("Nintendo Wii", "Nintendo Wii U"));
    }
}
