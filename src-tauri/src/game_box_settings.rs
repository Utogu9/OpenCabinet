use crate::platform_details::BoxSettings;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use std::collections::HashMap;

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS game_box_settings(game_id INTEGER PRIMARY KEY, settings TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS remove_game_box_settings AFTER DELETE ON games
        BEGIN DELETE FROM game_box_settings WHERE game_id=OLD.id; END;")
}

// Missing means leave unchanged; explicit null means use the platform again.
pub fn deserialize_patch<'de, D: serde::Deserializer<'de>>(input: D) -> Result<Option<Option<BoxSettings>>, D::Error> {
    Option::<BoxSettings>::deserialize(input).map(Some)
}

pub fn save(conn: &Connection, id: i32, value: Option<&BoxSettings>) -> Result<(), String> {
    if let Some(settings) = value {
        settings.validate()?;
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO game_box_settings(game_id,settings) VALUES (?1,?2) ON CONFLICT(game_id) DO UPDATE SET settings=excluded.settings", (id,json))
            .map_err(|e| e.to_string())?;
    } else { conn.execute("DELETE FROM game_box_settings WHERE game_id=?1", [id]).map_err(|e|e.to_string())?; }
    Ok(())
}

pub fn all(conn: &Connection) -> Result<HashMap<i32, BoxSettings>, String> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_box_settings')", [], |r|r.get(0)).map_err(|e|e.to_string())?;
    if !exists { return Ok(HashMap::new()); }
    let values = conn.prepare("SELECT game_id,settings FROM game_box_settings").map_err(|e|e.to_string())?
        .query_map([], |r|Ok((r.get::<_,i32>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e|e.to_string())?;
    values.into_iter().map(|(id,json)| serde_json::from_str(&json).map(|v|(id,v)).map_err(|e|e.to_string())).collect()
}

pub fn read(conn: &Connection, id: i32) -> Result<Option<BoxSettings>, String> {
    let json: Option<String> = conn.query_row("SELECT settings FROM game_box_settings WHERE game_id=?1",[id], |r|r.get(0)).optional().map_err(|e|e.to_string())?;
    json.map(|json|serde_json::from_str(&json).map_err(|e|e.to_string())).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn multiple_posters_keep_pairing_order_folds_and_portable_image_references() {
        let conn=Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1);").unwrap();init(&conn).unwrap();
        let data=serde_json::json!({"posters":[{"id":"second","name":"Map","front":"new-front.png","back":"images/one/back2.webp","settings":{"columns":3,"rows":4,"rotation":90}},{"id":"first","front":"images/one/front.webp"}]});
        let mut settings:BoxSettings=serde_json::from_value(data).unwrap();
        settings.remap_poster_image("new-front.png","images/one/copied.png");save(&conn,1,Some(&settings)).unwrap();
        let saved=serde_json::to_value(read(&conn,1).unwrap()).unwrap();
        assert_eq!(saved["posters"][0]["front"],"images/one/copied.png");assert_eq!(saved["posters"][0]["settings"]["rows"],4);assert_eq!(saved["posters"][1]["id"],"first");
        for invalid in [serde_json::json!({"posters":[{"id":"a","settings":{"rows":9}}]}),serde_json::json!({"posters":[{"id":"a"},{"id":"a"}]}),serde_json::json!({"posters":[{"id":""}]})] {
            let invalid:BoxSettings=serde_json::from_value(invalid).unwrap();assert!(save(&conn,1,Some(&invalid)).is_err());
        }
        assert_eq!(serde_json::to_value(read(&conn,1).unwrap()).unwrap(),saved);
    }
    #[test]
    fn game_poster_options_validate_and_persist_independently_of_box_style() {
        let conn=Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1);").unwrap();init(&conn).unwrap();
        let data=serde_json::json!({"poster":{"columns":3,"rows":2,"rotation":90,"corner":"bottom_right","first_side":"back","fold_order":"columns_first"}});
        let settings:BoxSettings=serde_json::from_value(data.clone()).unwrap();save(&conn,1,Some(&settings)).unwrap();
        let saved=serde_json::to_value(read(&conn,1).unwrap()).unwrap();assert_eq!(saved["poster"],data["poster"]);assert!(saved["base"]["model"].is_null());
        for (field,value) in [("columns",serde_json::json!(9)),("rotation",serde_json::json!(45)),("corner",serde_json::json!("middle")),("first_side",serde_json::json!("invalid")),("fold_order",serde_json::json!("invalid"))] {
            let mut invalid=data.clone();invalid["poster"][field]=value;let invalid:BoxSettings=serde_json::from_value(invalid).unwrap();assert!(save(&conn,1,Some(&invalid)).is_err());
        }
        assert_eq!(serde_json::to_value(read(&conn,1).unwrap()).unwrap()["poster"],data["poster"]);
    }
    #[test]
    fn poster_folds_validate_persist_and_keep_existing_box_settings_compatible() {
        let conn=Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1);").unwrap();init(&conn).unwrap();
        let old:BoxSettings=serde_json::from_str(r#"{"base":{"model":"dvd"}}"#).unwrap();old.validate().unwrap();
        let settings:BoxSettings=serde_json::from_value(serde_json::json!({"base":{"poster_columns":3,"poster_rows":2},"regions":{"japan":{"poster_columns":2,"poster_rows":4}}})).unwrap();
        save(&conn,1,Some(&settings)).unwrap();
        let saved=serde_json::to_value(read(&conn,1).unwrap()).unwrap();assert_eq!(saved["base"]["poster_columns"],3);assert_eq!(saved["regions"]["japan"]["poster_rows"],4);
        for value in [0,9]{let invalid:BoxSettings=serde_json::from_value(serde_json::json!({"base":{"poster_columns":value}})).unwrap();assert!(save(&conn,1,Some(&invalid)).is_err());}
        assert!(serde_json::from_value::<BoxSettings>(serde_json::json!({"base":{"poster_rows":1.5}})).is_err());
    }
    #[test]
    fn disc_reverse_finishes_validate_persist_and_keep_older_settings_compatible() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1);").unwrap();init(&conn).unwrap();
        let old:BoxSettings=serde_json::from_str(r#"{"base":{"model":"dvd"}}"#).unwrap();old.validate().unwrap();
        for finish in ["silver","black","blue","gold"] {
            let settings:BoxSettings=serde_json::from_value(serde_json::json!({"base":{"disc_finish":finish},"regions":{"japan":{"disc_finish":"blue"}}})).unwrap();
            save(&conn,1,Some(&settings)).unwrap();
            let saved=serde_json::to_value(read(&conn,1).unwrap()).unwrap();
            assert_eq!(saved["base"]["disc_finish"],finish);assert_eq!(saved["regions"]["japan"]["disc_finish"],"blue");
        }
        let invalid:BoxSettings=serde_json::from_str(r#"{"base":{"disc_finish":"unknown"}}"#).unwrap();
        assert!(save(&conn,1,Some(&invalid)).is_err());
        assert_eq!(serde_json::to_value(read(&conn,1).unwrap()).unwrap()["base"]["disc_finish"],"gold");
    }
    #[test]
    fn game_box_patches_validate_reset_and_keep_omitted_settings() {
        let conn=Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY);INSERT INTO games VALUES(1),(2);").unwrap();init(&conn).unwrap();
        let settings:BoxSettings=serde_json::from_str(r##"{"base":{"color":"#ff1010","model":"dvd"},"regions":{}}"##).unwrap();
        save(&conn,1,Some(&settings)).unwrap();assert!(read(&conn,2).unwrap().is_none());
        assert_eq!(serde_json::to_value(read(&conn,1).unwrap()).unwrap()["base"]["color"],"#ff1010");
        let invalid:BoxSettings=serde_json::from_str(r#"{"base":{"model":"custom","width":0}}"#).unwrap();
        assert!(save(&conn,1,Some(&invalid)).is_err());assert!(read(&conn,1).unwrap().is_some());
        #[derive(Deserialize)]
        struct Patch { #[serde(default,deserialize_with="deserialize_patch")] box3d:Option<Option<BoxSettings>> }
        assert!(serde_json::from_str::<Patch>("{}").unwrap().box3d.is_none());
        assert!(matches!(serde_json::from_str::<Patch>(r#"{"box3d":null}"#).unwrap().box3d,Some(None)));
        conn.execute("DELETE FROM games WHERE id=1",[]).unwrap();assert!(read(&conn,1).unwrap().is_none());
        save(&conn,2,Some(&settings)).unwrap();save(&conn,2,None).unwrap();assert!(read(&conn,2).unwrap().is_none());
    }
}
