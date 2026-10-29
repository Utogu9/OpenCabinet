use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS play_sessions(id INTEGER PRIMARY KEY,game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,rom_path TEXT NOT NULL,started_at TEXT NOT NULL,last_checkpoint TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'running');CREATE INDEX IF NOT EXISTS play_sessions_game ON play_sessions(game_id,id DESC);CREATE TRIGGER IF NOT EXISTS remove_play_sessions AFTER DELETE ON games BEGIN DELETE FROM play_sessions WHERE game_id=OLD.id;END;")
}
pub fn recover(conn: &Connection) -> rusqlite::Result<()> {
    init(conn)?;
    conn.execute("UPDATE play_sessions SET ended_at=last_checkpoint,state='interrupted' WHERE state='running'",[])?;
    Ok(())
}
pub fn begin(conn: &Connection, id: i32, path: &str, started: &str) -> rusqlite::Result<()> {
    conn.execute("INSERT INTO play_sessions(game_id,rom_path,started_at,last_checkpoint) VALUES(?1,?2,?3,?3)",params![id,path,started])?;
    Ok(())
}
pub fn checkpoint(conn: &Connection, id: i32, elapsed: i64, running: bool) -> rusqlite::Result<()> {
    conn.execute("UPDATE play_sessions SET duration_seconds=max(duration_seconds,?1),last_checkpoint=strftime('%Y-%m-%dT%H:%M:%fZ','now'),ended_at=CASE WHEN ?2 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END,state=CASE WHEN ?2 THEN 'running' ELSE 'finished' END WHERE id=(SELECT id FROM play_sessions WHERE game_id=?3 AND state='running' ORDER BY id DESC LIMIT 1)",params![elapsed,running,id])?;
    Ok(())
}
pub fn atomic<T>(
    conn: &Connection,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("SAVEPOINT session_record")
        .map_err(|e| e.to_string())?;
    match action() {
        Ok(result) => {
            conn.execute_batch("RELEASE session_record")
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK TO session_record;RELEASE session_record");
            Err(error)
        }
    }
}
#[derive(Serialize, Debug)]
pub struct Session {
    id: i64,
    game_id: i32,
    title: String,
    rom_path: String,
    started_at: String,
    ended_at: Option<String>,
    duration_seconds: i64,
    state: String,
}

pub fn read(
    conn: &Connection,
    id: i32,
    combine: bool,
    offset: usize,
) -> Result<Vec<Session>, String> {
    init(conn).map_err(|e| e.to_string())?;
    let ids = if combine {
        crate::game_regions::expanded(conn, &[id])?
    } else {
        vec![id]
    };
    let json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    conn.prepare("SELECT s.id,s.game_id,g.title,s.rom_path,s.started_at,s.ended_at,s.duration_seconds,s.state FROM play_sessions s JOIN games g ON g.id=s.game_id WHERE s.game_id IN (SELECT value FROM json_each(?1)) ORDER BY s.started_at DESC,s.id DESC LIMIT 100 OFFSET ?2").map_err(|e|e.to_string())?
        .query_map(params![json,offset.min(i64::MAX as usize) as i64],|r|Ok(Session{id:r.get(0)?,game_id:r.get(1)?,title:r.get(2)?,rom_path:r.get(3)?,started_at:r.get(4)?,ended_at:r.get(5)?,duration_seconds:r.get(6)?,state:r.get(7)?})).map_err(|e|e.to_string())?.collect::<rusqlite::Result<_>>().map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn get_play_sessions(
    game_id: i32,
    combine_regions: Option<bool>,
    offset: Option<usize>,
    tracker: tauri::State<'_, crate::playtime::PlayTracker>,
) -> Result<History, String> {
    let tracker=tracker.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        history(
            &crate::get_db_connection().map_err(|e| e.to_string())?,
            game_id,
            combine_regions.unwrap_or(true),
            offset.unwrap_or(0),
            &tracker,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug)]
pub struct History {
    sessions: Vec<Session>,
    play_time_seconds: i64,
    session_count: i64,
    is_running: bool,
}

fn scope(conn:&Connection,id:i32,combine:bool)->Result<Vec<i32>,String> {
    let exists:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",[id],|r|r.get(0)).map_err(|e|e.to_string())?;
    if !exists{return Err(crate::i18n::text("msg.66087bc5c8").into());}
    if combine {crate::game_regions::expanded(conn,&[id])} else {Ok(vec![id])}
}

pub fn history(conn:&Connection,id:i32,combine:bool,offset:usize,tracker:&crate::playtime::PlayTracker)->Result<History,String> {
    init(conn).map_err(|e|e.to_string())?;
    atomic(conn,||{
        let ids=scope(conn,id,combine)?;
        let json=serde_json::to_string(&ids).map_err(|e|e.to_string())?;
        let (seconds,count)=conn.query_row("SELECT COALESCE(SUM(play_time_seconds),0),COALESCE(SUM(session_count),0) FROM games WHERE id IN (SELECT value FROM json_each(?1))",[json],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        let members=serde_json::to_string(&crate::game_regions::expanded(conn,&[id])?).map_err(|e|e.to_string())?;
        let recorded_running:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM play_sessions WHERE state='running' AND game_id IN (SELECT value FROM json_each(?1)))",[members],|r|r.get(0)).map_err(|e|e.to_string())?;
        Ok(History {sessions:read(conn,id,combine,offset)?,play_time_seconds:seconds,session_count:count,
            is_running:recorded_running||tracker.is_running(crate::game_regions::owner(conn,id)?)})
    })
}

fn remove(conn:&Connection,id:i32,combine:bool,session:Option<i64>,tracker:&crate::playtime::PlayTracker)->Result<(),String> {
    init(conn).map_err(|e|e.to_string())?;
    let _reservation=tracker.reserve(crate::game_regions::owner(conn,id)?)?;
    atomic(conn,||{
        let ids=scope(conn,id,combine)?;
        let group=serde_json::to_string(&crate::game_regions::expanded(conn,&[id])?).map_err(|e|e.to_string())?;
        let running:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM play_sessions WHERE state='running' AND game_id IN (SELECT value FROM json_each(?1)))",[group],|r|r.get(0)).map_err(|e|e.to_string())?;
        if running{return Err(crate::i18n::text("sessions.stopFirst").into());}
        let changed=if let Some(session)=session {
            let (game,seconds,started):(i32,i64,String)=conn.query_row("SELECT game_id,duration_seconds,started_at FROM play_sessions WHERE id=?1",[session],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?
                .filter(|(game,_,_)|ids.contains(game)).ok_or_else(||crate::i18n::text("sessions.notFound").to_string())?;
            conn.execute("DELETE FROM play_sessions WHERE id=?1",[session]).map_err(|e|e.to_string())?;
            conn.execute("UPDATE games SET play_time_seconds=MAX(0,play_time_seconds-?1),play_time=MIN(2147483647,MAX(0,play_time_seconds-?1)/60),session_count=MAX(0,session_count-1),last_played=CASE WHEN last_played=?2 THEN (SELECT MAX(started_at) FROM play_sessions WHERE game_id=?3) ELSE last_played END WHERE id=?3",params![seconds.max(0),started,game]).map_err(|e|e.to_string())?;
            vec![game]
        }else {
            for game in &ids {
                conn.execute("DELETE FROM play_sessions WHERE game_id=?1",[game]).map_err(|e|e.to_string())?;
                conn.execute("UPDATE games SET play_time_seconds=0,play_time=0,session_count=0,last_played=NULL WHERE id=?1",[game]).map_err(|e|e.to_string())?;
            }
            ids
        };
        crate::media_library::sync_statistics(conn,&changed)?;
        Ok(())
    })
}

async fn remove_command(game_id:i32,combine:bool,session:Option<i64>,tracker:crate::playtime::PlayTracker)->Result<(),String> {
    tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(|e|e.to_string())?;
        let root=crate::data_directory().map_err(|e|e.to_string())?;
        remove(&conn,game_id,combine,session,&tracker)?;
        crate::media_library::flush_logged(&conn,&root);
        Ok(())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn delete_play_session(game_id:i32,session_id:i64,combine_regions:Option<bool>,tracker:tauri::State<'_,crate::playtime::PlayTracker>)->Result<(),String> {
    remove_command(game_id,combine_regions.unwrap_or(true),Some(session_id),tracker.inner().clone()).await
}

#[tauri::command]
pub async fn reset_play_sessions(game_id:i32,combine_regions:Option<bool>,tracker:tauri::State<'_,crate::playtime::PlayTracker>)->Result<(),String> {
    remove_command(game_id,combine_regions.unwrap_or(true),None,tracker.inner().clone()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,rom_path TEXT,play_time INTEGER DEFAULT 0,play_time_seconds INTEGER DEFAULT 0,session_count INTEGER DEFAULT 0,last_played TEXT);INSERT INTO games(id,title,rom_path) VALUES(1,'EU','eu.chd'),(2,'US','us.chd');").unwrap();
        c
    }
    fn finished(c:&Connection,id:i32,date:&str,seconds:i64) {
        init(c).unwrap();begin(c,id,"disc.chd",date).unwrap();checkpoint(c,id,seconds,false).unwrap();
        c.execute("UPDATE games SET play_time_seconds=play_time_seconds+?1,play_time=(play_time_seconds+?1)/60,session_count=session_count+1,last_played=?2 WHERE id=?3",params![seconds,date,id]).unwrap();
    }
    #[test]
    fn summary_includes_legacy_statistics_and_sessions_beyond_the_current_page() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();
        c.execute("UPDATE games SET play_time_seconds=3600,session_count=4 WHERE id=1",[]).unwrap();
        for _ in 0..105{finished(&c,1,"2026-10-29T12:00:00Z",61);}
        let first=history(&c,1,false,0,&tracker).unwrap();
        assert_eq!(first.sessions.len(),100);assert_eq!(first.play_time_seconds,10005);assert_eq!(first.session_count,109);assert!(!first.is_running);
        let next=history(&c,1,false,100,&tracker).unwrap();assert_eq!(next.sessions.len(),5);assert_eq!(next.play_time_seconds,first.play_time_seconds);
    }
    #[test]
    fn deleting_one_session_subtracts_only_its_totals_and_restores_the_previous_play_date() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();
        c.execute("UPDATE games SET play_time_seconds=3600,session_count=4 WHERE id=1",[]).unwrap();
        finished(&c,1,"2026-10-28T12:00:00Z",120);finished(&c,1,"2026-10-29T12:00:00Z",61);
        let rows=read(&c,1,false,0).unwrap();
        remove(&c,1,false,Some(rows[0].id),&tracker).unwrap();
        let page=history(&c,1,false,0,&tracker).unwrap();assert_eq!(page.play_time_seconds,3720);assert_eq!(page.session_count,5);assert_eq!(page.sessions.len(),1);
        let (minutes,last):(i64,String)=c.query_row("SELECT play_time,last_played FROM games WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(minutes,62);assert_eq!(last,"2026-10-28T12:00:00Z");
        assert!(remove(&c,1,false,Some(rows[0].id),&tracker).is_err());assert_eq!(history(&c,1,false,0,&tracker).unwrap().session_count,5);
    }
    #[test]
    fn removal_validates_session_ownership_and_resets_only_the_chosen_regional_scope() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();
        finished(&c,1,"2026-10-28T12:00:00Z",120);finished(&c,2,"2026-10-29T12:00:00Z",61);
        let foreign=read(&c,2,false,0).unwrap()[0].id;
        assert!(remove(&c,1,true,Some(foreign),&tracker).is_err());
        crate::game_regions::init(&c).unwrap();c.execute_batch("INSERT INTO game_regions VALUES(1,1,'Europe',0,1),(2,1,'USA',1,0)").unwrap();
        assert!(remove(&c,1,false,Some(foreign),&tracker).is_err());
        assert_eq!(history(&c,1,true,0,&tracker).unwrap().play_time_seconds,181);
        remove(&c,1,true,Some(foreign),&tracker).unwrap();assert_eq!(history(&c,2,false,0,&tracker).unwrap().session_count,0);
        finished(&c,2,"2026-10-29T15:00:00Z",90);
        remove(&c,2,false,None,&tracker).unwrap();assert_eq!(history(&c,1,true,0,&tracker).unwrap().session_count,1);
        finished(&c,2,"2026-10-29T16:00:00Z",180);
        remove(&c,2,true,None,&tracker).unwrap();
        for id in [1,2]{let page=history(&c,id,false,0,&tracker).unwrap();assert_eq!((page.play_time_seconds,page.session_count),(0,0));assert!(page.sessions.is_empty());
            assert!(c.query_row("SELECT last_played FROM games WHERE id=?1",[id],|r|r.get::<_,Option<String>>(0)).unwrap().is_none());}
    }
    #[test]
    fn running_games_block_both_history_actions_even_when_the_active_region_is_not_visible() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();
        finished(&c,1,"2026-10-28T12:00:00Z",120);let session=read(&c,1,false,0).unwrap()[0].id;
        {let _active=tracker.reserve(1).unwrap();assert!(remove(&c,1,false,Some(session),&tracker).is_err());assert!(remove(&c,1,false,None,&tracker).is_err());}
        crate::game_regions::init(&c).unwrap();c.execute_batch("INSERT INTO game_regions VALUES(1,1,'Europe',0,1),(2,1,'USA',1,0)").unwrap();
        crate::playtime::start_session(&c,2).unwrap();assert!(history(&c,1,false,0,&tracker).unwrap().is_running);
        assert!(remove(&c,1,false,Some(session),&tracker).is_err());recover(&c).unwrap();remove(&c,1,false,Some(session),&tracker).unwrap();
    }
    #[test]
    fn resetting_clears_legacy_totals_and_new_sessions_start_from_zero() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();
        c.execute("UPDATE games SET play_time_seconds=10000,play_time=166,session_count=20,last_played='2026-10-28T12:00:00Z' WHERE id=1",[]).unwrap();
        remove(&c,1,false,None,&tracker).unwrap();crate::playtime::start_session(&c,1).unwrap();
        let mut saved=0;let stats=crate::playtime::save_elapsed(&c,1,61,&mut saved,false).unwrap().unwrap();assert_eq!((stats.play_time_seconds,stats.session_count),(61,1));
        assert_eq!(read(&c,1,false,0).unwrap().len(),1);
    }
    #[test]
    fn manifest_statistics_are_updated_atomically_without_touching_media_and_failed_writes_roll_back() {
        let c=db();let tracker=crate::playtime::PlayTracker::default();crate::media_library::init_schema(&c).unwrap();
        finished(&c,1,"2026-10-28T12:00:00Z",120);let session=read(&c,1,false,0).unwrap()[0].id;
        c.execute("INSERT INTO media_collections VALUES('collection','folder',?1)",[r#"{"images":[{"path":"cover.webp"}],"manuals":["book.pdf"],"statistics":{"play_time_seconds":120,"session_count":1}}"#]).unwrap();
        c.execute("UPDATE games SET media_collection_id='collection' WHERE id=1",[]).unwrap();
        c.execute_batch("CREATE TRIGGER fail_history_manifest BEFORE INSERT ON media_manifest_outbox BEGIN SELECT RAISE(ABORT,'fixture');END;").unwrap();
        assert!(remove(&c,1,false,Some(session),&tracker).is_err());assert_eq!(read(&c,1,false,0).unwrap().len(),1);assert_eq!(history(&c,1,false,0,&tracker).unwrap().play_time_seconds,120);
        c.execute("DROP TRIGGER fail_history_manifest",[]).unwrap();remove(&c,1,false,None,&tracker).unwrap();
        let body:String=c.query_row("SELECT body FROM media_manifest_outbox WHERE id='collection'",[],|r|r.get(0)).unwrap();let body:serde_json::Value=serde_json::from_str(&body).unwrap();
        assert_eq!(body["statistics"]["play_time_seconds"],0);assert_eq!(body["statistics"]["session_count"],0);assert!(body["statistics"]["last_played"].is_null());
        assert_eq!(body["images"][0]["path"],"cover.webp");assert_eq!(body["manuals"][0],"book.pdf");
    }
    #[test]
    fn checkpoints_preserve_individual_sessions_actual_disc_and_region_totals() {
        let c = db();
        crate::playtime::start_session_path(&c, 1, "EU (Disc 2).chd").unwrap();
        let mut saved = 0;
        crate::playtime::save_elapsed(&c, 1, 5, &mut saved, true).unwrap();
        crate::playtime::save_elapsed(&c, 1, 12, &mut saved, false).unwrap();
        crate::playtime::start_session(&c, 1).unwrap();
        saved = 0;
        crate::playtime::save_elapsed(&c, 1, 20, &mut saved, false).unwrap();
        let rows = read(&c, 1, false, 0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].duration_seconds, 20);
        assert_eq!(rows[1].duration_seconds, 12);
        assert_eq!(rows[1].rom_path, "EU (Disc 2).chd");
        assert!(
            rows.iter()
                .all(|row| row.state == "finished" && row.ended_at.is_some())
        );
        assert_eq!(
            c.query_row(
                "SELECT play_time_seconds,session_count FROM games WHERE id=1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            )
            .unwrap(),
            (32, 2)
        );
        crate::game_regions::init(&c).unwrap();
        c.execute_batch("INSERT INTO game_regions VALUES(1,1,'Europe',0,1),(2,1,'USA',1,0)")
            .unwrap();
        crate::playtime::start_session(&c, 2).unwrap();
        assert_eq!(read(&c, 1, true, 0).unwrap().len(), 3);
        assert_eq!(read(&c, 2, false, 0).unwrap().len(), 1);
        recover(&c).unwrap();
        let interrupted = read(&c, 2, false, 0).unwrap();
        assert_eq!(interrupted[0].state, "interrupted");
        assert_eq!(interrupted[0].duration_seconds, 0);
    }
    #[test]
    fn a_failed_history_write_rolls_back_the_game_checkpoint_and_can_be_retried() {
        let c = db();
        crate::playtime::start_session(&c, 1).unwrap();
        c.execute_batch("CREATE TRIGGER fail_history BEFORE UPDATE ON play_sessions BEGIN SELECT RAISE(ABORT,'fixture');END;").unwrap();
        let mut saved = 0;
        assert!(crate::playtime::save_elapsed(&c, 1, 5, &mut saved, true).is_err());
        assert_eq!(saved, 0);
        assert_eq!(
            c.query_row("SELECT play_time_seconds FROM games WHERE id=1", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        c.execute("DROP TRIGGER fail_history", []).unwrap();
        crate::playtime::save_elapsed(&c, 1, 12, &mut saved, false).unwrap();
        assert_eq!(read(&c, 1, false, 0).unwrap()[0].duration_seconds, 12);
        c.execute("DELETE FROM games WHERE id=1", []).unwrap();
        assert!(read(&c, 1, false, 0).unwrap().is_empty());
    }
}
