//! Explicit user-configured programs; arguments never pass through a shell.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Actions {
    pub before: Vec<Action>,
    pub after: Vec<Action>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Action {
    pub executable: String,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub directory: String,
    #[serde(default)]
    pub wait: bool,
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS game_launch_actions(game_id INTEGER PRIMARY KEY,data TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_launch_actions AFTER DELETE ON games BEGIN DELETE FROM game_launch_actions WHERE game_id=OLD.id; END;")
}
pub fn validate(actions: &Actions) -> Result<(), String> {
    if actions.before.len() + actions.after.len() > 30
        || actions.before.iter().chain(&actions.after).any(|a| {
            a.executable.trim().is_empty()
                || a.executable.len() > 4096
                || a.directory.len() > 4096
                || a.arguments.len() > 100
                || a.arguments
                    .iter()
                    .any(|s| s.len() > 32768 || s.contains('\0'))
                || a.executable.contains('\0')
                || a.directory.contains('\0')
        })
    {
        return Err(crate::i18n::text("actions.invalid").into());
    }
    Ok(())
}
pub fn read(conn: &Connection, id: i32) -> Result<Actions, String> {
    init(conn).map_err(err)?;
    let data: Option<String> = conn
        .query_row(
            "SELECT data FROM game_launch_actions WHERE game_id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    data.map(|v| serde_json::from_str(&v).map_err(err))
        .transpose()
        .map(Option::unwrap_or_default)
}
pub fn save(conn: &Connection, id: i32, actions: &Actions) -> Result<(), String> {
    validate(actions)?;
    init(conn).map_err(err)?;
    conn.execute("INSERT INTO game_launch_actions VALUES(?1,?2) ON CONFLICT(game_id) DO UPDATE SET data=excluded.data",params![id,serde_json::to_string(actions).map_err(err)?]).map_err(err)?;
    Ok(())
}
#[tauri::command]
pub async fn get_game_launch_actions(game_id: i32) -> Result<Actions, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read(&crate::get_db_connection().map_err(err)?, game_id)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn choose_launch_action() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .set_title(crate::i18n::text("actions.program"))
        .pick_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned()))
}
fn substitute(value: &str, path: &str, title: &str) -> String {
    value
        .replace("%GAME_TITLE%", title)
        .replace(
            "%GAME_DIR%",
            Path::new(path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .as_deref()
                .unwrap_or(""),
        )
        .replace("%ROM%", path)
}
pub fn run(actions: &[Action], path: &str, title: &str) -> Result<(), String> {
    for action in actions {
        let executable = substitute(&action.executable, path, title);
        let mut command = Command::new(&executable);
        crate::platform_runtime::configure_child(&mut command);
        command
            .args(action.arguments.iter().map(|a| substitute(a, path, title)))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if !action.directory.trim().is_empty() {
            command.current_dir(substitute(&action.directory, path, title));
        }
        let result = (|| -> Result<(), String> {
            let mut child = command.spawn().map_err(err)?;
            if action.wait {
                let started = Instant::now();
                loop {
                    if let Some(status) = child.try_wait().map_err(err)? {
                        return if status.success() {
                            Ok(())
                        } else {
                            Err(status.to_string())
                        };
                    }
                    if started.elapsed() > Duration::from_secs(120) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(crate::i18n::text("actions.timeout").into());
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
            } else {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                Ok(())
            }
        })();
        result.map_err(|e| crate::i18n::i18n_format!("actions.failed", executable, e))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_roundtrips_and_cleans_deleted_games() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1)",
        )
        .unwrap();
        let a = Actions {
            before: vec![Action {
                executable: "tool".into(),
                arguments: vec!["%ROM%".into()],
                directory: String::new(),
                wait: true,
            }],
            after: vec![],
        };
        save(&conn, 1, &a).unwrap();
        assert!(read(&conn, 1).unwrap().before[0].wait);
        assert_eq!(
            substitute(
                "%GAME_TITLE%|%ROM%|%GAME_DIR%",
                "/games/one two.iso",
                "Title"
            ),
            "Title|/games/one two.iso|/games"
        );
        assert!(validate(&Actions {
            before: vec![Action {
                executable: "".into(),
                ..a.before[0].clone()
            }],
            after: vec![]
        })
        .is_err());
        conn.execute("DELETE FROM games", []).unwrap();
        assert!(read(&conn, 1).unwrap().before.is_empty());
    }
    #[test]
    fn reports_failed_processes() {
        let action = Action {
            executable: "opencabinet-definitely-missing-program".into(),
            arguments: vec![],
            directory: String::new(),
            wait: true,
        };
        assert!(run(&[action], "/games/game.iso", "Game").is_err());
    }
    #[test]
    fn waiting_actions_check_exit_status() {
        let (executable, prefix) = if cfg!(windows) {
            ("cmd.exe", vec!["/D", "/C"])
        } else {
            ("/bin/sh", vec!["-c"])
        };
        let action = |code| Action {
            executable: executable.into(),
            arguments: prefix
                .iter()
                .map(|s| s.to_string())
                .chain([format!("exit {code}")])
                .collect(),
            directory: String::new(),
            wait: true,
        };
        assert!(run(&[action(0), action(0)], "/games/game.iso", "Game").is_ok());
        assert!(run(&[action(7)], "/games/game.iso", "Game").is_err());
    }
}
