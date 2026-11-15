//! Shared catalog with a transactional projection of the active user's personal
//! data. Existing launch/report/merge paths keep using the live tables; triggers
//! mirror every change into the owning profile, including session checkpoints.
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
type Result<T> = std::result::Result<T,String>;
fn err(e:impl std::fmt::Display)->String{e.to_string()}
#[derive(Serialize)]
pub struct Profile {pub id:i64,pub name:String}
#[derive(Serialize)]
pub struct Profiles {pub active:i64,pub profiles:Vec<Profile>}

pub fn init(conn:&Connection)->rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS user_profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL COLLATE NOCASE UNIQUE);
        CREATE TABLE IF NOT EXISTS user_profile_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),active INTEGER NOT NULL,switching INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS user_profile_migration(id INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS user_profile_keys(profile_id INTEGER PRIMARY KEY,identity TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS user_profile_games(profile_id INTEGER NOT NULL,game_id INTEGER NOT NULL,seconds INTEGER NOT NULL,sessions INTEGER NOT NULL,last_played TEXT,PRIMARY KEY(profile_id,game_id));
        CREATE TABLE IF NOT EXISTS user_profile_personal(profile_id INTEGER NOT NULL,game_id INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(profile_id,game_id));
        CREATE TABLE IF NOT EXISTS user_profile_sessions(profile_id INTEGER NOT NULL,id INTEGER NOT NULL,game_id INTEGER NOT NULL,rom_path TEXT NOT NULL,started_at TEXT NOT NULL,last_checkpoint TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(profile_id,id));
        INSERT OR IGNORE INTO user_profile_state VALUES(1,1,0);")?;
    conn.execute("INSERT OR IGNORE INTO user_profiles VALUES(1,?1)",[crate::i18n::text("profiles.default")])?;
    conn.execute("INSERT OR IGNORE INTO user_profile_keys VALUES(1,'default')",[])?;
    let ids=conn.prepare("SELECT id FROM user_profiles WHERE id<>1")?.query_map([],|r|r.get(0))?.collect::<rusqlite::Result<Vec<i64>>>()?;
    for id in ids{ensure_key(conn,id)?;}
    conn.execute_batch("INSERT OR IGNORE INTO user_profile_games SELECT (SELECT active FROM user_profile_state),id,play_time_seconds,session_count,last_played FROM games WHERE NOT EXISTS(SELECT 1 FROM user_profile_migration);
        INSERT OR IGNORE INTO user_profile_personal SELECT (SELECT active FROM user_profile_state),game_id,data FROM game_personal WHERE NOT EXISTS(SELECT 1 FROM user_profile_migration);
        INSERT OR IGNORE INTO user_profile_sessions SELECT (SELECT active FROM user_profile_state),id,game_id,rom_path,started_at,last_checkpoint,ended_at,duration_seconds,state FROM play_sessions WHERE NOT EXISTS(SELECT 1 FROM user_profile_migration);
        CREATE TRIGGER IF NOT EXISTS profile_game_insert AFTER INSERT ON games WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT OR REPLACE INTO user_profile_games VALUES((SELECT active FROM user_profile_state),NEW.id,NEW.play_time_seconds,NEW.session_count,NEW.last_played); END;
        CREATE TRIGGER IF NOT EXISTS profile_game_update AFTER UPDATE OF play_time_seconds,session_count,last_played ON games WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT OR REPLACE INTO user_profile_games VALUES((SELECT active FROM user_profile_state),NEW.id,NEW.play_time_seconds,NEW.session_count,NEW.last_played); END;
        -- An outer UPSERT overrides a trigger's OR REPLACE conflict policy.
        -- Recreate these triggers to upgrade existing libraries without changing their data.
        DROP TRIGGER IF EXISTS profile_personal_insert;
        DROP TRIGGER IF EXISTS profile_personal_update;
        CREATE TRIGGER profile_personal_insert AFTER INSERT ON game_personal WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT INTO user_profile_personal VALUES((SELECT active FROM user_profile_state),NEW.game_id,NEW.data)
            ON CONFLICT(profile_id,game_id) DO UPDATE SET data=excluded.data; END;
        CREATE TRIGGER profile_personal_update AFTER UPDATE ON game_personal WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT INTO user_profile_personal VALUES((SELECT active FROM user_profile_state),NEW.game_id,NEW.data)
            ON CONFLICT(profile_id,game_id) DO UPDATE SET data=excluded.data; END;
        CREATE TRIGGER IF NOT EXISTS profile_personal_delete AFTER DELETE ON game_personal WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            DELETE FROM user_profile_personal WHERE profile_id=(SELECT active FROM user_profile_state) AND game_id=OLD.game_id; END;
        CREATE TRIGGER IF NOT EXISTS profile_session_insert AFTER INSERT ON play_sessions WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT OR REPLACE INTO user_profile_sessions VALUES((SELECT active FROM user_profile_state),NEW.id,NEW.game_id,NEW.rom_path,NEW.started_at,NEW.last_checkpoint,NEW.ended_at,NEW.duration_seconds,NEW.state); END;
        CREATE TRIGGER IF NOT EXISTS profile_session_update AFTER UPDATE ON play_sessions WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            INSERT OR REPLACE INTO user_profile_sessions VALUES((SELECT active FROM user_profile_state),NEW.id,NEW.game_id,NEW.rom_path,NEW.started_at,NEW.last_checkpoint,NEW.ended_at,NEW.duration_seconds,NEW.state); END;
        CREATE TRIGGER IF NOT EXISTS profile_session_delete AFTER DELETE ON play_sessions WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
            DELETE FROM user_profile_sessions WHERE profile_id=(SELECT active FROM user_profile_state) AND id=OLD.id; END;
        CREATE TRIGGER IF NOT EXISTS profile_game_delete AFTER DELETE ON games BEGIN
            DELETE FROM user_profile_games WHERE game_id=OLD.id;
            DELETE FROM user_profile_personal WHERE game_id=OLD.id;
            DELETE FROM user_profile_sessions WHERE game_id=OLD.id; END;
        INSERT OR IGNORE INTO user_profile_migration VALUES(1);")
}
pub fn active(conn:&Connection)->i64 {conn.query_row("SELECT active FROM user_profile_state WHERE singleton=1",[],|r|r.get(0)).unwrap_or(1)}
pub fn key(conn:&Connection)->String {let id=active(conn);if id==1{return "default".into();}
    conn.query_row("SELECT identity FROM user_profile_keys WHERE profile_id=?1",[id],|r|r.get(0)).unwrap_or_else(|_|format!("unavailable-profile-{id}"))}
pub fn same_owner(conn:&Connection,owner:Option<&str>)->bool {key(conn)==owner.unwrap_or("default")}
fn ensure_key(conn:&Connection,id:i64)->rusqlite::Result<()> {
    let token=format!("{}-{}-{id}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    conn.execute("INSERT OR IGNORE INTO user_profile_keys VALUES(?1,?2)",params![id,token])?;Ok(())
}
pub fn list(conn:&Connection)->Result<Profiles> {
    let profiles=conn.prepare("SELECT id,name FROM user_profiles ORDER BY id").map_err(err)?.query_map([],|r|Ok(Profile{id:r.get(0)?,name:r.get(1)?})).map_err(err)?
        .collect::<rusqlite::Result<_>>().map_err(err)?;
    Ok(Profiles{active:active(conn),profiles})
}
pub fn switch(conn:&mut Connection,id:i64)->Result<Profiles> {
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
    if !tx.query_row("SELECT EXISTS(SELECT 1 FROM user_profiles WHERE id=?1)",[id],|r|r.get::<_,bool>(0)).map_err(err)?{return Err(crate::i18n::text("profiles.missing").into());}
    if id==active(&tx){return list(&tx);}
    ensure_key(&tx,id).map_err(err)?;
    tx.execute("UPDATE user_profile_state SET switching=1",[]).map_err(err)?;
    tx.execute("UPDATE games SET play_time_seconds=COALESCE((SELECT seconds FROM user_profile_games WHERE profile_id=?1 AND game_id=games.id),0),
        play_time=COALESCE((SELECT seconds/60 FROM user_profile_games WHERE profile_id=?1 AND game_id=games.id),0),
        session_count=COALESCE((SELECT sessions FROM user_profile_games WHERE profile_id=?1 AND game_id=games.id),0),
        last_played=(SELECT last_played FROM user_profile_games WHERE profile_id=?1 AND game_id=games.id)",[id]).map_err(err)?;
    tx.execute("DELETE FROM game_personal",[]).map_err(err)?;
    tx.execute("INSERT INTO game_personal SELECT game_id,data FROM user_profile_personal WHERE profile_id=?1",[id]).map_err(err)?;
    tx.execute("DELETE FROM play_sessions",[]).map_err(err)?;
    tx.execute("INSERT INTO play_sessions SELECT id,game_id,rom_path,started_at,last_checkpoint,ended_at,duration_seconds,state FROM user_profile_sessions WHERE profile_id=?1",[id]).map_err(err)?;
    tx.execute("UPDATE user_profile_state SET active=?1,switching=0",[id]).map_err(err)?;
    let result=list(&tx)?;tx.commit().map_err(err)?;Ok(result)
}
// Multidisc merging removes secondary records; preserve every other user's totals
// and history too. The live merge and its triggers handle the active profile.
pub fn merge(conn:&Connection,primary:i32,secondary:i32)->Result<()> {
    if conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='user_profiles')",[],|r|r.get::<_,bool>(0)).map_err(err)? {
        conn.execute("INSERT INTO user_profile_games SELECT profile_id,?1,seconds,sessions,last_played FROM user_profile_games WHERE game_id=?2 AND profile_id<>?3
            ON CONFLICT(profile_id,game_id) DO UPDATE SET seconds=seconds+excluded.seconds,sessions=sessions+excluded.sessions,
            last_played=CASE WHEN last_played IS NULL THEN excluded.last_played WHEN excluded.last_played IS NULL THEN last_played ELSE max(last_played,excluded.last_played) END",
            params![primary,secondary,active(conn)]).map_err(err)?;
        conn.execute("UPDATE user_profile_sessions SET game_id=?1 WHERE game_id=?2",params![primary,secondary]).map_err(err)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn get_user_profiles()->Result<Profiles>{tauri::async_runtime::spawn_blocking(||list(&crate::get_db_connection().map_err(err)?)).await.map_err(err)?}
#[tauri::command]
pub async fn save_user_profile(id:Option<i64>,name:String)->Result<Profiles>{
    let name=name.trim().to_owned();if name.is_empty()||name.chars().count()>80{return Err(crate::i18n::text("profiles.invalid").into());}
    tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;
        let other:Option<i64>=conn.query_row("SELECT id FROM user_profiles WHERE name=?1 COLLATE NOCASE",[&name],|r|r.get(0)).optional().map_err(err)?;
        if other.is_some()&&other!=id{return Err(crate::i18n::text("profiles.duplicate").into());}
        if let Some(id)=id {if conn.execute("UPDATE user_profiles SET name=?1 WHERE id=?2",params![name,id]).map_err(err)?==0{return Err(crate::i18n::text("profiles.missing").into());}}
        else {conn.execute("INSERT INTO user_profiles(name) VALUES(?1)",[name]).map_err(err)?;}
        list(&conn)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn switch_user_profile(id:i64,tracker:tauri::State<'_,crate::playtime::PlayTracker>)->Result<Profiles>{
    let tracker=tracker.inner().clone();tauri::async_runtime::spawn_blocking(move||tracker.while_idle(||switch(&mut crate::get_db_connection().map_err(err)?,id))).await.map_err(err)?
}
#[tauri::command]
pub async fn delete_user_profile(id:i64)->Result<Profiles>{tauri::async_runtime::spawn_blocking(move||{
    let mut conn=crate::get_db_connection().map_err(err)?;let tx=conn.transaction().map_err(err)?;
    if id==1||id==active(&tx){return Err(crate::i18n::text("profiles.cannotDelete").into());}
    for table in ["user_profile_games","user_profile_personal","user_profile_sessions"]{tx.execute(&format!("DELETE FROM {table} WHERE profile_id=?1"),[id]).map_err(err)?;}
    tx.execute("DELETE FROM user_profile_keys WHERE profile_id=?1",[id]).map_err(err)?;
    tx.execute("DELETE FROM user_profiles WHERE id=?1",[id]).map_err(err)?;let result=list(&tx)?;tx.commit().map_err(err)?;Ok(result)
}).await.map_err(err)?}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture()->Connection{
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT,play_time INTEGER DEFAULT 0,play_time_seconds INTEGER NOT NULL DEFAULT 0,session_count INTEGER NOT NULL DEFAULT 0,last_played TEXT);
            INSERT INTO games(id,title,platform,rom_path,play_time_seconds,session_count,last_played) VALUES(1,'Game','PS2','Game.iso',120,2,'2026-01-01');").unwrap();
        crate::library_features::init(&conn).unwrap();crate::session_history::init(&conn).unwrap();
        conn.execute("INSERT INTO game_personal VALUES(1,?1)",[r#"{"favorite":true,"rating":5,"status":"completed","notes":"Original notes"}"#]).unwrap();
        conn.execute_batch("INSERT INTO play_sessions VALUES(1,1,'Game.iso','2026-01-01','2026-01-01','2026-01-01',30,'finished')").unwrap();
        init(&conn).unwrap();conn.execute("INSERT INTO user_profiles VALUES(2,'Second')",[]).unwrap();conn
    }
    fn stats(conn:&Connection)->(i64,i64){conn.query_row("SELECT play_time_seconds,session_count FROM games WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap()}
    #[test]fn repeated_personal_edits_update_the_active_profile_and_survive_switching(){
        let mut conn=fixture();
        let mut value=crate::library_features::read(&conn,1).unwrap();
        for rating in [4,2,0,5]{
            value.rating=rating;crate::library_features::save(&conn,1,&value).unwrap();
            assert_eq!(crate::library_features::read(&conn,1).unwrap(),value);
        }
        switch(&mut conn,2).unwrap();
        let mut other=crate::library_features::Personal::default();
        for rating in [1,3]{
            other.rating=rating;other.favorite=true;other.notes="Second profile".into();
            crate::library_features::save(&conn,1,&other).unwrap();
        }
        switch(&mut conn,1).unwrap();assert_eq!(crate::library_features::read(&conn,1).unwrap(),value);
        switch(&mut conn,2).unwrap();assert_eq!(crate::library_features::read(&conn,1).unwrap(),other);
    }
    #[test]fn reinitialization_replaces_legacy_personal_triggers_without_losing_data(){
        let mut conn=fixture();
        conn.execute_batch("DROP TRIGGER profile_personal_insert;DROP TRIGGER profile_personal_update;
            CREATE TRIGGER profile_personal_insert AFTER INSERT ON game_personal WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
                INSERT OR REPLACE INTO user_profile_personal VALUES((SELECT active FROM user_profile_state),NEW.game_id,NEW.data); END;
            CREATE TRIGGER profile_personal_update AFTER UPDATE ON game_personal WHEN (SELECT switching FROM user_profile_state)=0 BEGIN
                INSERT OR REPLACE INTO user_profile_personal VALUES((SELECT active FROM user_profile_state),NEW.game_id,NEW.data); END;").unwrap();
        let original=crate::library_features::read(&conn,1).unwrap();
        init(&conn).unwrap();init(&conn).unwrap();
        assert_eq!(crate::library_features::read(&conn,1).unwrap(),original);
        let mut changed=original;changed.rating=2;
        crate::library_features::save(&conn,1,&changed).unwrap();
        switch(&mut conn,2).unwrap();switch(&mut conn,1).unwrap();
        assert_eq!(crate::library_features::read(&conn,1).unwrap(),changed);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM user_profile_personal WHERE profile_id=1 AND game_id=1",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]fn migrates_existing_data_and_keeps_personal_data_history_and_totals_isolated(){
        let mut conn=fixture();assert_eq!(active(&conn),1);assert_eq!(stats(&conn),(120,2));
        switch(&mut conn,2).unwrap();assert_eq!(stats(&conn),(0,0));assert_eq!(conn.query_row("SELECT COUNT(*) FROM play_sessions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(crate::library_features::read(&conn,1).unwrap(),crate::library_features::Personal::default());
        crate::library_features::save(&conn,1,&crate::library_features::Personal{status:"playing".into(),rating:1,notes:"Second user's notes".into(),favorite:false}).unwrap();
        crate::playtime::start_session(&conn,1).unwrap();let mut saved=0;
        crate::playtime::save_elapsed(&conn,1,70,&mut saved,false).unwrap();
        switch(&mut conn,1).unwrap();assert_eq!(stats(&conn),(120,2));assert!(crate::library_features::read(&conn,1).unwrap().favorite);
        assert_eq!(crate::session_history::read(&conn,1,false,0).unwrap().len(),1);
        switch(&mut conn,2).unwrap();assert_eq!(stats(&conn),(70,1));assert_eq!(crate::library_features::read(&conn,1).unwrap().rating,1);
        conn.execute("DELETE FROM play_sessions",[]).unwrap();conn.execute("UPDATE games SET play_time_seconds=0,session_count=0,last_played=NULL WHERE id=1",[]).unwrap();
        switch(&mut conn,1).unwrap();assert_eq!(stats(&conn),(120,2));switch(&mut conn,2).unwrap();assert_eq!(stats(&conn),(0,0));
    }
    #[test]fn backup_keeps_all_profiles_and_switching_is_blocked_during_a_session(){
        let conn=fixture();let tracker=crate::playtime::PlayTracker::default();let active_game=tracker.reserve(1).unwrap();
        assert!(tracker.while_idle(||Ok(())).is_err());drop(active_game);assert!(tracker.while_idle(||Ok(())).is_ok());
        let mut restored=Connection::open_in_memory().unwrap();
        rusqlite::backup::Backup::new(&conn,&mut restored).unwrap().run_to_completion(100,Duration::ZERO,None).unwrap();
        assert_eq!(list(&restored).unwrap().profiles.len(),2);switch(&mut restored,2).unwrap();assert_eq!(stats(&restored),(0,0));
        switch(&mut restored,1).unwrap();assert_eq!(stats(&restored),(120,2));
        assert!(same_owner(&restored,None));switch(&mut restored,2).unwrap();assert!(!same_owner(&restored,None));
    }
    #[test]fn multidisc_merge_preserves_other_profiles_and_catalog_deletion_cleans_all_owners(){
        let mut conn=fixture();conn.execute("INSERT INTO games(id,title,rom_path) VALUES(2,'Disc 2','Disc2.iso')",[]).unwrap();
        switch(&mut conn,2).unwrap();conn.execute("UPDATE games SET play_time_seconds=id*10,session_count=id",[]).unwrap();
        switch(&mut conn,1).unwrap();merge(&conn,1,2).unwrap();conn.execute("DELETE FROM games WHERE id=2",[]).unwrap();
        switch(&mut conn,2).unwrap();assert_eq!(stats(&conn),(30,3));
        conn.execute("DELETE FROM games WHERE id=1",[]).unwrap();assert_eq!(conn.query_row("SELECT COUNT(*) FROM user_profile_games",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    #[test]fn deleted_profile_ids_are_never_reused_and_reinitialization_keeps_the_active_projection(){
        let mut conn=fixture();conn.execute("DELETE FROM user_profiles WHERE id=2",[]).unwrap();
        conn.execute("INSERT INTO user_profiles(name) VALUES('New owner')",[]).unwrap();let next=conn.last_insert_rowid();assert!(next>2);
        switch(&mut conn,next).unwrap();init(&conn).unwrap();assert_eq!(active(&conn),next);assert_eq!(stats(&conn),(0,0));
        let owner=key(&conn);let mut other=fixture();other.execute("INSERT INTO user_profiles(name) VALUES('Another owner')",[]).unwrap();
        switch(&mut other,next).unwrap();assert!(!same_owner(&other,Some(&owner)),"numeric IDs must not authorize another library's personal data");
        switch(&mut conn,1).unwrap();assert_eq!(stats(&conn),(120,2));
    }
    use std::time::Duration;
}
