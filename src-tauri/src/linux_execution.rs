//! Optional per-edition Linux launch settings. Runners remain user-managed.
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    #[default]
    Native,
    Wine,
    Proton,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Options {
    pub mode: Mode,
    pub runner_path: Option<String>,
    pub umu_path: Option<String>,
    pub prefix: Option<String>,
    pub working_directory: Option<String>,
}
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS game_linux_execution(game_id INTEGER PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'native',runner_path TEXT,umu_path TEXT,prefix TEXT,working_directory TEXT);
        CREATE TRIGGER IF NOT EXISTS remove_linux_execution AFTER DELETE ON games BEGIN DELETE FROM game_linux_execution WHERE game_id=OLD.id; END;")
}
pub fn all(conn: &Connection) -> Result<BTreeMap<i32, Options>, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_linux_execution')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Ok(BTreeMap::new());
    }
    conn.prepare("SELECT game_id,mode,runner_path,umu_path,prefix,working_directory FROM game_linux_execution").map_err(|e|e.to_string())?
        .query_map([],|r|Ok((r.get(0)?,Options{mode:match r.get::<_,String>(1)?.as_str(){"wine"=>Mode::Wine,"proton"=>Mode::Proton,_=>Mode::Native},runner_path:r.get(2)?,umu_path:r.get(3)?,prefix:r.get(4)?,working_directory:r.get(5)?}))).map_err(|e|e.to_string())?
        .collect::<rusqlite::Result<BTreeMap<_,_>>>().map_err(|e|e.to_string())
}
pub fn read(conn: &Connection, id: i32) -> Result<Option<Options>, String> {
    Ok(all(conn)?.remove(&id))
}
pub fn save(conn: &Connection, id: i32, options: Option<&Options>) -> Result<(), String> {
    init(conn).map_err(|e| e.to_string())?;
    let Some(options) = options else {
        conn.execute("DELETE FROM game_linux_execution WHERE game_id=?1", [id])
            .map_err(|e| e.to_string())?;
        return Ok(());
    };
    let direct: bool = conn
        .query_row("SELECT launch_directly FROM games WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("Unknown game")?;
    if cfg!(target_os = "linux") {
        if !direct {
            return Err(crate::i18n::text("linux.directOnly").into());
        }
        validate(options)?;
    }
    conn.execute("INSERT INTO game_linux_execution(game_id,mode,runner_path,umu_path,prefix,working_directory) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(game_id) DO UPDATE SET mode=excluded.mode,runner_path=excluded.runner_path,umu_path=excluded.umu_path,prefix=excluded.prefix,working_directory=excluded.working_directory",
        rusqlite::params![id,match options.mode {Mode::Native=>"native",Mode::Wine=>"wine",Mode::Proton=>"proton"},options.runner_path,options.umu_path,options.prefix,options.working_directory]).map_err(|e|e.to_string())?;
    Ok(())
}
fn absolute(value: &Option<String>) -> Result<(), String> {
    if value.as_ref().is_some_and(|v| !Path::new(v).is_absolute()) {
        Err(crate::i18n::text("linux.absolutePath").into())
    } else {
        Ok(())
    }
}
pub fn validate(options: &Options) -> Result<(), String> {
    for value in [
        &options.runner_path,
        &options.umu_path,
        &options.prefix,
        &options.working_directory,
    ] {
        absolute(value)?;
    }
    if let Some(path) = &options.working_directory {
        if !Path::new(path).is_dir() {
            return Err(crate::i18n::text("linux.workingMissing").into());
        }
    }
    if options
        .prefix
        .as_ref()
        .is_some_and(|p| Path::new(p).exists() && !Path::new(p).is_dir())
    {
        return Err(crate::i18n::text("linux.prefixInvalid").into());
    }
    match options.mode {
        Mode::Native => Ok(()),
        Mode::Wine => {
            if options
                .runner_path
                .as_ref()
                .is_some_and(|p| crate::platform_runtime::executable(Path::new(p)))
            {
                Ok(())
            } else {
                Err(crate::i18n::text("linux.wineMissing").into())
            }
        }
        Mode::Proton => {
            if !options
                .runner_path
                .as_ref()
                .is_some_and(|p| crate::platform_runtime::executable(&Path::new(p).join("proton")))
            {
                return Err(crate::i18n::text("linux.protonMissing").into());
            }
            if umu(options).is_none() {
                return Err(crate::i18n::text("linux.umuMissing").into());
            }
            Ok(())
        }
    }
}
fn umu(options: &Options) -> Option<PathBuf> {
    options
        .umu_path
        .as_ref()
        .map(PathBuf::from)
        .filter(|p| crate::platform_runtime::executable(p))
        .or_else(|| crate::platform_runtime::find_program("umu-run"))
}
pub struct Plan {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub directory: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub prefix: Option<PathBuf>,
}
pub fn plan(
    root: &Path,
    id: i32,
    game: &str,
    args: &[String],
    options: &Options,
) -> Result<Plan, String> {
    validate(options)?;
    let game = Path::new(game);
    if !game.is_absolute() || !game.is_file() {
        return Err(crate::i18n::text("linux.fileMissing").into());
    }
    let mut plan = Plan {
        executable: game.into(),
        args: args.to_vec(),
        directory: options
            .working_directory
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| game.parent().unwrap().into()),
        environment: BTreeMap::new(),
        prefix: None,
    };
    if options.mode == Mode::Native {
        if crate::platform_runtime::is_windows_executable(game) {
            return Err(crate::i18n::text("linux.chooseRunner").into());
        }
        if !crate::platform_runtime::executable(game) {
            return Err(crate::i18n::text("linux.notExecutable").into());
        }
        return Ok(plan);
    }
    let prefix = options
        .prefix
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("compatibility").join(id.to_string()));
    plan.prefix = Some(prefix.clone());
    plan.environment
        .insert("WINEPREFIX".into(), prefix.to_string_lossy().into_owned());
    plan.args.insert(0, game.to_string_lossy().into_owned());
    if options.mode == Mode::Wine {
        plan.executable = PathBuf::from(options.runner_path.as_ref().unwrap());
    } else {
        plan.executable = umu(options).unwrap();
        plan.environment
            .insert("PROTONPATH".into(), options.runner_path.clone().unwrap());
        plan.environment
            .insert("GAMEID".into(), format!("umu-opencabinet-{id}"));
        plan.environment.insert("STORE".into(), "none".into());
    }
    Ok(plan)
}
#[derive(Serialize)]
pub struct Runners {
    wine: Vec<String>,
    proton: Vec<String>,
    umu: Option<String>,
}
#[tauri::command]
pub async fn get_linux_runners() -> Runners {
    tauri::async_runtime::spawn_blocking(|| {
        let mut wine = Vec::new();
        let mut proton = Vec::new();
        if cfg!(target_os = "linux") {
            for name in ["wine", "wine64"] {
                if let Some(path) = crate::platform_runtime::find_program(name) {
                    let value = path.to_string_lossy().into_owned();
                    if !wine.contains(&value) {
                        wine.push(value);
                    }
                }
            }
            let mut roots = crate::steam::linux_roots();
            for root in crate::steam::linux_roots() {
                roots.extend(crate::steam::library_roots(&root));
            }
            let mut directories = Vec::new();
            for root in roots {
                directories.push(root.join("steamapps/common"));
                directories.push(root.join("compatibilitytools.d"));
            }
            if let Ok(data) = crate::platform_runtime::xdg("XDG_DATA_HOME", ".local/share") {
                directories.extend([
                    data.join("Steam/compatibilitytools.d"),
                    data.join("lutris/runners/wine"),
                ]);
            }
            for directory in directories {
                if let Ok(entries) = std::fs::read_dir(directory) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.join("proton").is_file() {
                            let value = path.to_string_lossy().into_owned();
                            if !proton.contains(&value) {
                                proton.push(value);
                            }
                        } else if crate::platform_runtime::executable(&path.join("bin/wine")) {
                            wine.push(path.join("bin/wine").to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
        wine.sort();
        wine.dedup();
        proton.sort();
        proton.dedup();
        Runners {
            wine,
            proton,
            umu: crate::platform_runtime::find_program("umu-run")
                .map(|p| p.to_string_lossy().into_owned()),
        }
    })
    .await
    .unwrap_or(Runners {
        wine: Vec::new(),
        proton: Vec::new(),
        umu: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn execution_settings_round_trip_and_delete_with_the_edition() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,launch_directly INTEGER);INSERT INTO games VALUES(1,1),(2,1);").unwrap();
        save(&conn, 1, Some(&Options::default())).unwrap();
        assert!(read(&conn, 1).unwrap().is_some());
        assert!(read(&conn, 2).unwrap().is_none());
        conn.execute("DELETE FROM games WHERE id=1", []).unwrap();
        assert!(all(&conn).unwrap().is_empty());
    }
    #[test]
    fn relative_paths_are_rejected() {
        assert!(absolute(&Some("relative/prefix".into())).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native_wine_and_umu_keep_arguments_prefixes_and_editions_separate() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "opencabinet-linux-launch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let (runner, umu, native, windows, proton) = (
            root.join("wine test"),
            root.join("umu test"),
            root.join("native game"),
            root.join("Windows game.exe"),
            root.join("Proton Local"),
        );
        for path in [&runner, &umu, &native] {
            std::fs::write(
                path,
                b"#!/bin/sh\nprintf '%s\\n' \"$WINEPREFIX\" \"$PROTONPATH\" \"$@\"\n",
            )
            .unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::create_dir(&proton).unwrap();
        std::fs::copy(&runner, proton.join("proton")).unwrap();
        std::fs::write(&windows, b"MZ").unwrap();
        let args = vec!["--profile".into(), "A space; $(touch forbidden)".into()];
        let wine = Options {
            mode: Mode::Wine,
            runner_path: Some(runner.to_string_lossy().into()),
            ..Default::default()
        };
        let first = plan(&root, 1, windows.to_str().unwrap(), &args, &wine).unwrap();
        let second = plan(&root, 2, windows.to_str().unwrap(), &args, &wine).unwrap();
        assert_ne!(first.prefix, second.prefix);
        assert_eq!(first.args[0], windows.to_str().unwrap());
        assert_eq!(&first.args[1..], args);
        let output = std::process::Command::new(&first.executable)
            .args(&first.args)
            .envs(&first.environment)
            .output()
            .unwrap();
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("$(touch forbidden)"));
        assert!(!root.join("forbidden").exists());
        let options = Options {
            mode: Mode::Proton,
            runner_path: Some(proton.to_string_lossy().into()),
            umu_path: Some(umu.to_string_lossy().into()),
            ..Default::default()
        };
        let launch = plan(&root, 3, windows.to_str().unwrap(), &args, &options).unwrap();
        assert_eq!(launch.executable, umu);
        assert_eq!(launch.environment["PROTONPATH"], proton.to_str().unwrap());
        assert!(
            plan(
                &root,
                1,
                windows.to_str().unwrap(),
                &args,
                &Options::default()
            )
            .is_err()
        );
        assert!(
            plan(
                &root,
                1,
                native.to_str().unwrap(),
                &args,
                &Options::default()
            )
            .is_ok()
        );
        std::fs::set_permissions(&native, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(
            plan(
                &root,
                1,
                native.to_str().unwrap(),
                &args,
                &Options::default()
            )
            .is_err()
        );
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
