//! Personal library data is independent from catalog metadata and regional editions.
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Personal {
    pub status: String,
    pub favorite: bool,
    pub rating: u8,
    pub notes: String,
}
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS game_personal(game_id INTEGER PRIMARY KEY,data TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_game_personal AFTER DELETE ON games BEGIN DELETE FROM game_personal WHERE game_id=OLD.id; END;
        CREATE TABLE IF NOT EXISTS game_manual_preferences(game_id INTEGER PRIMARY KEY,filename TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_manual_preference AFTER DELETE ON games BEGIN DELETE FROM game_manual_preferences WHERE game_id=OLD.id; END;")
}
pub fn validate(value: &Personal) -> Result<()> {
    if !["", "unplayed", "planned", "playing", "completed", "abandoned"].contains(&value.status.as_str()) || value.rating > 5 || value.notes.len() > 100_000 {
        return Err(crate::i18n::text("personal.invalid").into());
    }
    Ok(())
}
pub fn read(conn: &Connection, id: i32) -> Result<Personal> {
    init(conn).map_err(err)?;
    let data: Option<String> = conn.query_row("SELECT data FROM game_personal WHERE game_id=?1",[id],|r|r.get(0)).optional().map_err(err)?;
    data.map(|data|serde_json::from_str(&data).map_err(err)).transpose().map(Option::unwrap_or_default)
}
pub fn save(conn: &Connection, id: i32, value: &Personal) -> Result<()> {
    init(conn).map_err(err)?; validate(value)?;
    let owner = crate::game_regions::owner(conn,id)?;
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",[owner],|r|r.get(0)).map_err(err)?;
    if !exists {return Err(crate::i18n::text("msg.66087bc5c8").into());}
    conn.execute("INSERT INTO game_personal VALUES(?1,?2) ON CONFLICT(game_id) DO UPDATE SET data=excluded.data",params![owner,serde_json::to_string(value).map_err(err)?]).map_err(err)?;
    Ok(())
}
pub fn hydrate(conn: &Connection, games: &mut [crate::Game]) -> Result<()> {
    init(conn).map_err(err)?;
    let values: HashMap<i32,Personal> = conn.prepare("SELECT game_id,data FROM game_personal").map_err(err)?
        .query_map([],|r|Ok((r.get::<_,i32>(0)?,r.get::<_,String>(1)?))).map_err(err)?
        .map(|r|{let(id,data)=r.map_err(err)?;Ok((id,serde_json::from_str(&data).map_err(err)?))}).collect::<Result<_>>()?;
    for game in games {
        game.personal = values.get(&game.id).cloned().unwrap_or_default();
        for region in &mut game.regions {region.game.personal = game.personal.clone();}
    }
    Ok(())
}
#[tauri::command]
pub async fn set_game_personal(game_id:i32, personal:Personal) -> Result<Personal> {
    tauri::async_runtime::spawn_blocking(move||{
        let mut conn=crate::get_db_connection().map_err(err)?;
        let root=crate::data_directory().map_err(err)?;
        crate::media_library::init_schema(&conn)?;
        let tx=conn.transaction().map_err(err)?;
        save(&tx,game_id,&personal)?;
        let owner=crate::game_regions::owner(&tx,game_id)?;
        let mut copies=crate::PendingImageCopies(Vec::new());
        for id in crate::game_regions::expanded(&tx,&[owner])? {crate::media_library::sync_game(&tx,&root,id as i64,&mut copies)?;}
        tx.commit().map_err(err)?;copies.0.clear();crate::media_library::flush_logged(&conn,&root);
        Ok(personal)
    }).await.map_err(err)?
}
#[derive(Serialize)]
pub struct Bucket {pub name:String,pub seconds:i64,pub sessions:i64,pub games:usize}
#[derive(Serialize)]
pub struct Dashboard {pub total_games:usize,pub seconds:i64,pub sessions:i64,pub statuses:HashMap<String,usize>,pub platforms:Vec<Bucket>,pub months:Vec<Bucket>,pub regions:Vec<Bucket>,pub top_games:Vec<Bucket>,pub recorded_seconds:i64}
pub fn dashboard(conn:&Connection,games:&[crate::Game])->Result<Dashboard>{
    let mut report=Dashboard{total_games:games.len(),seconds:0,sessions:0,statuses:HashMap::new(),platforms:Vec::new(),months:Vec::new(),regions:Vec::new(),top_games:Vec::new(),recorded_seconds:0};
    let mut platforms:HashMap<String,Bucket>=HashMap::new();let mut regions:HashMap<String,Bucket>=HashMap::new();
    for game in games{
        report.seconds+=game.play_time_seconds;report.sessions+=game.session_count;
        *report.statuses.entry(if game.personal.status.is_empty(){"unplayed".into()}else{game.personal.status.clone()}).or_default()+=1;
        let bucket=platforms.entry(game.platform.clone()).or_insert(Bucket{name:game.platform.clone(),seconds:0,sessions:0,games:0});
        bucket.seconds+=game.play_time_seconds;bucket.sessions+=game.session_count;bucket.games+=1;
        report.top_games.push(Bucket{name:game.title.clone(),seconds:game.play_time_seconds,sessions:game.session_count,games:1});
        let versions:Vec<_>=if game.regions.is_empty(){vec![("".to_string(),game)]}else{game.regions.iter().map(|r|(r.label.clone(),r.game.as_ref())).collect()};
        for(label,edition)in versions{
            let region=crate::metadata::rom_regions(&edition.rom_path).first().map(|s|s.to_string()).unwrap_or(label);
            let bucket=regions.entry(region.clone()).or_insert(Bucket{name:region,seconds:0,sessions:0,games:0});
            bucket.seconds+=edition.play_time_seconds;bucket.sessions+=edition.session_count;bucket.games+=1;
        }
    }
    report.platforms=platforms.into_values().collect();report.regions=regions.into_values().collect();
    for list in [&mut report.platforms,&mut report.regions,&mut report.top_games]{list.sort_by(|a,b|b.seconds.cmp(&a.seconds).then(a.name.cmp(&b.name)));}
    report.top_games.truncate(20);
    // Only the recorded portion can be attributed to a calendar month. Do not invent dates for legacy totals.
    report.months=conn.prepare("SELECT strftime('%Y-%m',started_at,'localtime'),SUM(duration_seconds),COUNT(*),COUNT(DISTINCT game_id) FROM play_sessions WHERE date(started_at) IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 24").map_err(err)?
        .query_map([],|r|Ok(Bucket{name:r.get(0)?,seconds:r.get(1)?,sessions:r.get(2)?,games:r.get::<_,i64>(3)? as usize})).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
    report.recorded_seconds=conn.query_row("SELECT COALESCE(SUM(duration_seconds),0) FROM play_sessions",[],|r|r.get(0)).map_err(err)?;
    Ok(report)
}
#[tauri::command]
pub async fn get_library_dashboard()->Result<Dashboard>{
    tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;
        // Charts do not need the artwork, ROM lists or descriptions of the entire library.
        let mut games:Vec<crate::Game>=conn.prepare("SELECT id,title,platform,rom_path,play_time_seconds,session_count FROM games").map_err(err)?
            .query_map([],|row|Ok(crate::Game{id:row.get(0)?,title:row.get(1)?,platform:row.get(2)?,rom_path:row.get(3)?,play_time_seconds:row.get(4)?,session_count:row.get(5)?,..Default::default()})).map_err(err)?.collect::<rusqlite::Result<_>>().map_err(err)?;
        crate::game_regions::assemble(&conn,&mut games)?;hydrate(&conn,&mut games)?;dashboard(&conn,&games)
    }).await.map_err(err)?
}
#[derive(Serialize)]
pub struct Issue {pub id:i32,pub title:String,pub platform:String,pub issues:Vec<String>,pub missing_paths:Vec<String>}
#[tauri::command]
pub async fn get_library_report(tracker:tauri::State<'_,crate::playtime::PlayTracker>)->Result<Vec<Issue>>{
    let tracker=tracker.inner().clone();tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;
        let games=crate::read_library_games(&conn,&root,&tracker)?;
        let mut result=Vec::new();
        for game in games{
            let mut issues=Vec::new();let exists=|kinds:&[&str]|game.images.iter().any(|i|kinds.contains(&i.kind.as_str())&&std::path::Path::new(&i.path).is_file());
            for (kind,types) in [("cover",&["cover","fanart_cover","cover_reconstructed"][..]),("logo",&["logo"][..]),("back_cover",&["back_cover","fanart_back_cover"][..])]{if !exists(types){issues.push(kind.into());}}
            let edition=game.default_region_id.unwrap_or(game.id);
            let directory:Option<String>=conn.query_row("SELECT c.directory FROM games g LEFT JOIN media_collections c ON c.id=g.media_collection_id WHERE g.id=?1",[edition],|r|r.get(0)).map_err(err)?;
            let has_manual=directory.map(|dir|crate::media_library::directory(&root,&dir).and_then(|dir|crate::manuals::scan(&dir))).transpose()?.is_some_and(|v|!v.is_empty());
            if !has_manual{issues.push("manual".into());}
            if crate::metadata::repository::match_id(&conn,edition as i64,false).is_none() && crate::metadata::repository::match_id(&conn,edition as i64,true).is_none(){issues.push("catalog".into());}
            let versions:Vec<_>=if game.regions.is_empty(){vec![&game]}else{game.regions.iter().map(|r|r.game.as_ref()).collect()};
            let mut missing=Vec::new();
            for version in versions{
                let availability=crate::game_availability::inspect(&conn,version.id)?;
                if !availability.available&&(version.steam_app_id.is_some()||version.epic_app_id.is_some())&&!issues.iter().any(|s|s=="file"){issues.push("file".into());}
                missing.extend(availability.missing_paths);
                if !version.launch_directly&&version.steam_app_id.is_none()&&version.epic_app_id.is_none(){
                    let configured:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM emulators WHERE LOWER(platform)=LOWER(?1) AND (?2 IS NULL OR id=?2))",params![version.platform,version.execution.emulator_id],|r|r.get(0)).map_err(err)?;
                    if !configured&&!issues.iter().any(|s|s=="emulator"){issues.push("emulator".into());}
                }
            }
            missing.sort();missing.dedup();if !missing.is_empty()&&!issues.iter().any(|s|s=="file"){issues.push("file".into());}
            if !issues.is_empty(){result.push(Issue{id:game.id,title:game.title,platform:game.platform,issues,missing_paths:missing});}
        }
        Ok(result)
    }).await.map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn library()->Connection {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT);INSERT INTO games VALUES(1,'Main'),(2,'US');").unwrap();
        crate::game_regions::init(&conn).unwrap();init(&conn).unwrap();conn
    }
    #[test]
    fn personal_data_is_shared_by_editions_validated_and_transactional(){
        let mut conn=library();conn.execute_batch("INSERT INTO game_regions VALUES(1,1,'EU',0,1),(2,1,'USA',1,0)").unwrap();
        let original=Personal{status:"playing".into(),favorite:true,rating:4,notes:"My own notes <script>".into()};
        save(&conn,2,&original).unwrap();assert_eq!(read(&conn,1).unwrap(),original);
        let mut invalid=original.clone();invalid.rating=6;assert!(save(&conn,1,&invalid).is_err());
        invalid.status="unknown".into();invalid.rating=3;assert!(save(&conn,1,&invalid).is_err());
        {let tx=conn.transaction().unwrap();save(&tx,1,&Personal::default()).unwrap();}
        assert_eq!(read(&conn,1).unwrap(),original);assert!(save(&conn,999,&original).is_err());
    }
    fn game(id:i32,platform:&str,seconds:i64)->crate::Game {
        serde_json::from_value(serde_json::json!({"id":id,"title":format!("Game {id}"),"platform":platform,"rom_path":"Game (USA).iso","cover_path":null,"play_time":seconds/60,"release_date":null,"developer":null,"publisher":null,"images":[],"discs":[],"genre":null,"game_mode":null,"max_players":null,"description":null,"last_played":null,"play_time_seconds":seconds,"session_count":2,"is_running":false,"launch_directly":false,"steam_app_id":null,"epic_app_id":null})).unwrap()
    }
    #[test]
    fn dashboard_counts_one_library_entry_but_keeps_regional_time_and_legacy_totals(){
        let conn=library();crate::session_history::init(&conn).unwrap();
        conn.execute("INSERT INTO play_sessions(game_id,rom_path,started_at,last_checkpoint,duration_seconds,state) VALUES(1,'a','2026-10-12T12:00:00Z','2026-10-12T12:00:30Z',30,'finished')",[]).unwrap();
        let mut grouped=game(1,"PS1",300);grouped.regions=vec![crate::game_regions::Region{label:"USA".into(),game:Box::new(game(1,"PS1",100))},crate::game_regions::Region{label:"Europe".into(),game:Box::new(game(2,"PS1",200))}];
        grouped.session_count=4;grouped.personal.status="completed".into();
        let report=dashboard(&conn,&[grouped,game(3,"Dreamcast",50)]).unwrap();
        assert_eq!(report.total_games,2);assert_eq!(report.seconds,350);assert_eq!(report.sessions,6);assert_eq!(report.statuses["completed"],1);
        assert_eq!(report.months[0].seconds,30);assert_eq!(report.recorded_seconds,30);assert_eq!(report.platforms[0].seconds,300);
        assert_eq!(report.regions.iter().map(|b|b.seconds).sum::<i64>(),350);
    }
}
