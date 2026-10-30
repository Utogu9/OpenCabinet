//! Regional editions keep their own game/media identities and ordered discs.
use crate::{
    Game,
    playtime::{PlayStatistics, PlayTracker},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Region {
    pub label: String,
    pub game: Box<Game>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Label {
    pub id: i32,
    pub label: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Settings {
    pub parent_id: i32,
    pub default_id: i32,
    pub labels: Vec<Label>,
}
#[derive(Clone)]
struct Row {
    parent: i32,
    id: i32,
    label: String,
    default: bool,
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS game_regions (
        game_id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL, label TEXT NOT NULL,
        position INTEGER NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS idx_game_regions_parent ON game_regions(parent_id,position);
        CREATE TRIGGER IF NOT EXISTS remove_game_regions AFTER DELETE ON games
        BEGIN DELETE FROM game_regions WHERE game_id=OLD.id OR parent_id=OLD.id; END;",
    )
}
fn rows(conn: &Connection) -> Result<Vec<Row>> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_regions')",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !exists {
        return Ok(Vec::new());
    }
    conn.prepare("SELECT parent_id,game_id,label,is_default FROM game_regions ORDER BY parent_id,position,game_id").map_err(err)?
        .query_map([], |r|Ok(Row { parent:r.get(0)?,id:r.get(1)?,label:r.get(2)?,default:r.get(3)? })).map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}
pub fn owner(conn: &Connection, id: i32) -> Result<i32> {
    Ok(rows(conn)?
        .iter()
        .find(|r| r.id == id)
        .map(|r| r.parent)
        .unwrap_or(id))
}
pub fn expanded(conn: &Connection, ids: &[i32]) -> Result<Vec<i32>> {
    let rows = rows(conn)?;
    let roots: HashSet<_> = ids
        .iter()
        .map(|id| {
            rows.iter()
                .find(|r| r.id == *id)
                .map(|r| r.parent)
                .unwrap_or(*id)
        })
        .collect();
    let mut result: HashSet<_> = roots.clone();
    result.extend(
        rows.iter()
            .filter(|r| roots.contains(&r.parent))
            .map(|r| r.id),
    );
    let mut result: Vec<_> = result.into_iter().collect();
    result.sort();
    Ok(result)
}
pub fn assemble(conn: &Connection, games: &mut Vec<Game>) -> Result<()> {
    let rows = rows(conn)?;
    if rows.is_empty() {
        return Ok(());
    }
    let wanted: HashSet<_> = rows.iter().map(|row| row.id).collect();
    let by_id: HashMap<_, _> = games
        .iter()
        .filter(|g| wanted.contains(&g.id))
        .map(|g| (g.id, g.clone()))
        .collect();
    for game in games.iter_mut() {
        let members: Vec<_> = rows.iter().filter(|r| r.parent == game.id).collect();
        if members.is_empty() {
            continue;
        }
        game.regions = members
            .iter()
            .filter_map(|r| {
                by_id.get(&r.id).map(|g| Region {
                    label: r.label.clone(),
                    game: Box::new(g.clone()),
                })
            })
            .collect();
        game.default_region_id = members
            .iter()
            .find(|r| r.default)
            .map(|r| r.id)
            .or(Some(game.id));
        // Present the selected edition without changing the group's stable identity
        // or any of the independently persisted regional records.
        if let Some(selected) = game.default_region_id.and_then(|id| by_id.get(&id)) {
            let id = game.id;
            let regions = std::mem::take(&mut game.regions);
            let default = game.default_region_id;
            let running = game.is_running;
            *game = selected.clone();
            game.id = id;
            game.regions = regions;
            game.default_region_id = default;
            game.is_running = running;
        }
        game.play_time_seconds = game.regions.iter().map(|r| r.game.play_time_seconds).sum();
        game.play_time = (game.play_time_seconds / 60).min(i32::MAX as i64) as i32;
        game.session_count = game.regions.iter().map(|r| r.game.session_count).sum();
        game.last_played = game
            .regions
            .iter()
            .filter_map(|r| r.game.last_played.clone())
            .max();
    }
    games.retain(|g| !rows.iter().any(|r| r.id == g.id && r.parent != g.id));
    games.sort_by_key(|g| g.title.to_lowercase());
    Ok(())
}
pub fn selected(conn: &Connection, parent: i32, selected: Option<i32>) -> Result<i32> {
    let all = rows(conn)?;
    if all.iter().any(|r| r.id == parent && r.parent != parent) {
        return Err(crate::i18n::text("msg.672eb5ac78").into());
    }
    let members: Vec<_> = all.iter().filter(|r| r.parent == parent).collect();
    if members.is_empty() {
        if selected.is_some_and(|id| id != parent) {
            return Err(crate::i18n::text("msg.2adef8997f").into());
        }
        return Ok(parent);
    }
    let id = selected.ok_or(crate::i18n::text("msg.b987825324"))?;
    if !members.iter().any(|r| r.id == id) {
        return Err(crate::i18n::text("msg.2adef8997f").into());
    }
    Ok(id)
}
pub fn save(conn: &Connection, editing: i32, settings: &Settings) -> Result<()> {
    let all = rows(conn)?;
    let parent = all
        .iter()
        .find(|r| r.id == editing)
        .map(|r| r.parent)
        .ok_or(crate::i18n::text("msg.5e3861ed1b"))?;
    let expected: HashSet<_> = all
        .iter()
        .filter(|r| r.parent == parent)
        .map(|r| r.id)
        .collect();
    let supplied: HashSet<_> = settings.labels.iter().map(|r| r.id).collect();
    if settings.parent_id != parent
        || expected != supplied
        || supplied.len() != settings.labels.len()
        || !expected.contains(&settings.default_id)
    {
        return Err(crate::i18n::text("msg.770c1fcd08").into());
    }
    for label in &settings.labels {
        if label.label.trim().is_empty() || label.label.chars().count() > 100 {
            return Err(crate::i18n::text("msg.20b6c68482").into());
        }
        conn.execute("UPDATE game_regions SET label=?1,is_default=(game_id=?2) WHERE game_id=?3 AND parent_id=?4",params![label.label.trim(),settings.default_id,label.id,parent]).map_err(err)?;
    }
    Ok(())
}
pub fn validate_platform(conn: &Connection, id: i32, platform: &str) -> Result<()> {
    for member in expanded(conn, &[id])? {
        let current: String = conn
            .query_row("SELECT platform FROM games WHERE id=?1", [member], |r| {
                r.get(0)
            })
            .map_err(err)?;
        if member != id && !current.eq_ignore_ascii_case(platform) {
            return Err(crate::i18n::text("msg.151e4fd5ac").into());
        }
    }
    Ok(())
}
pub fn statistics(
    conn: &Connection,
    parent: i32,
    mut stats: PlayStatistics,
) -> Result<PlayStatistics> {
    let members = expanded(conn, &[parent])?;
    if members.len() == 1 {
        return Ok(stats);
    }
    let running_id = stats.id;
    stats.id = parent;
    stats.play_time_seconds = 0;
    stats.session_count = 0;
    stats.last_played = None;
    stats.region_statistics.clear();
    for id in members {
        let (seconds, sessions, last): (i64, i64, Option<String>) = conn
            .query_row(
                "SELECT play_time_seconds,session_count,last_played FROM games WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        stats.play_time_seconds += seconds;
        stats.session_count += sessions;
        stats.last_played = stats.last_played.max(last.clone());
        stats.region_statistics.push(PlayStatistics {
            id,
            play_time_seconds: seconds,
            session_count: sessions,
            last_played: last,
            is_running: id == running_id && stats.is_running,
            region_statistics: Vec::new(),
        });
    }
    Ok(stats)
}
pub fn merge(conn: &mut Connection, ids: &[i32], primary: i32, labels: &[Label]) -> Result<()> {
    merge_entries(conn,ids,primary,labels,false)
}
pub fn merge_recomp(conn:&mut Connection,ids:&[i32],primary:i32,labels:&[Label])->Result<()> {
    if ids.len()!=2 || ids.iter().map(|id|owner(conn,*id)).collect::<Result<HashSet<_>>>()?.len()!=2 {
        return Err(crate::i18n::text("recomp.invalidMerge").into());
    }
    merge_entries(conn,ids,primary,labels,true)
}
fn merge_entries(conn:&mut Connection,ids:&[i32],primary:i32,labels:&[Label],recomp:bool)->Result<()> {
    init(conn).map_err(err)?;
    if ids.iter().copied().collect::<HashSet<_>>().len() < 2 {
        return Err(crate::i18n::text("msg.36783a7fcc").into());
    }
    let members = expanded(conn, ids)?;
    if !members.contains(&primary) {
        return Err(crate::i18n::text("msg.feef766b0c").into());
    }
    let supplied: HashSet<_> = labels.iter().map(|l| l.id).collect();
    if supplied != members.iter().copied().collect() || supplied.len() != labels.len() {
        return Err(crate::i18n::text("msg.fea12e8628").into());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut platform = None;
    let mut direct_count=0;
    for id in &members {
        let (p, direct, path): (String, bool, String) = tx
            .query_row(
                "SELECT platform,launch_directly,rom_path FROM games WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if (direct && (!recomp || !crate::entity_variables::truth(crate::entity_variables::read(&tx,"game",*id)?.get("recomp"))))
            || crate::steam::app_id(&path).is_some()
            || crate::epic::app_id(&path).is_some()
            || platform
                .as_ref()
                .is_some_and(|old: &String| !old.eq_ignore_ascii_case(&p))
        {
            return Err(
                crate::i18n::text("msg.8974c5f39a").into(),
            );
        }
        platform = Some(p);
        direct_count+=usize::from(direct);
        tx.execute("DELETE FROM game_regions WHERE game_id=?1", [id])
            .map_err(err)?;
    }
    if recomp && (direct_count!=1 || direct_count==members.len()) {
        return Err(crate::i18n::text("recomp.invalidMerge").into());
    }
    for (position, label) in labels.iter().enumerate() {
        if label.label.trim().is_empty() || label.label.chars().count() > 100 {
            return Err(crate::i18n::text("msg.20b6c68482").into());
        }
        tx.execute("INSERT INTO game_regions(game_id,parent_id,label,position,is_default) VALUES (?1,?2,?3,?4,?5)",params![label.id,primary,label.label.trim(),position as i64,label.id==primary]).map_err(err)?;
    }
    tx.commit().map_err(err)
}
#[tauri::command]
pub async fn merge_game_regions(
    ids: Vec<i32>,
    primary_id: i32,
    labels: Vec<Label>,
    tracker: tauri::State<'_, PlayTracker>,
) -> Result<()> {
    let tracker = tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = crate::get_db_connection().map_err(err)?;
        let _reservations = expanded(&conn, &ids)?
            .into_iter()
            .map(|id| tracker.reserve(id))
            .collect::<Result<Vec<_>>>()?;
        merge(&mut conn, &ids, primary_id, &labels)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn merge_game_recomp(ids:Vec<i32>,primary_id:i32,labels:Vec<Label>,tracker:tauri::State<'_,PlayTracker>)->Result<()> {
    let tracker=tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move||{
        let mut conn=crate::get_db_connection().map_err(err)?;
        let _reservations=expanded(&conn,&ids)?.into_iter().map(|id|tracker.reserve(id)).collect::<Result<Vec<_>>>()?;
        merge_recomp(&mut conn,&ids,primary_id,&labels)
    }).await.map_err(err)?
}
