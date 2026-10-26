//! User-defined library categories travel with the portable user database.
use std::collections::{HashMap, HashSet};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Category {
    id: String,
    name: String,
    parent_id: Option<String>,
    rule: String,
    platforms: Vec<i32>,
    #[serde(default)]
    conditions: Vec<Condition>,
    #[serde(default = "all_conditions")]
    match_mode: String,
}

fn all_conditions() -> String { "all".into() }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
struct Condition { scope: String, name: String, operator: String, value: String }

#[derive(Serialize)]
pub struct Navigation {
    // None means first use; an empty array is a deliberate user choice.
    categories: Option<Vec<Category>>,
    manufacturers: HashMap<String, String>,
    game_variables: HashMap<i32, crate::entity_variables::Variables>,
    platform_variables: HashMap<i32, crate::entity_variables::Variables>,
}

pub(super) fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS library_navigation (id INTEGER PRIMARY KEY CHECK(id=1), categories TEXT NOT NULL);")
}

fn validate(categories: &mut [Category]) -> Result<(), String> {
    if categories.len() > 200 { return Err(crate::i18n::text("msg.8ac2dff900").into()); }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for category in categories.iter_mut() {
        category.name = category.name.trim().to_string();
        if category.id.is_empty() || category.id.len() > 120 || !ids.insert(category.id.clone()) {
            return Err(crate::i18n::text("msg.fce6a2ab59").into());
        }
        if category.name.is_empty() || category.name.chars().count() > 80 {
            return Err(crate::i18n::text("msg.bbb0de203d").into());
        }
        if !names.insert((category.parent_id.clone(), category.name.to_lowercase())) {
            return Err(crate::i18n::text("msg.11b30bd76f").into());
        }
        if !["platforms", "consoles", "handhelds", "pc", "steam", "epic", "windows", "variables"].contains(&category.rule.as_str()) {
            return Err(crate::i18n::text("msg.c2b775a975").into());
        }
        if category.platforms.len() > 1000 || category.platforms.iter().any(|p| *p <= 0) {
            return Err(crate::i18n::text("msg.ab4102970b").into());
        }
        category.platforms.sort();
        category.platforms.dedup();
        if !["all","any"].contains(&category.match_mode.as_str()) || category.conditions.len() > 50
            || (category.rule == "variables" && category.conditions.is_empty()) {
            return Err(crate::i18n::text("msg.d5e79867ed").into());
        }
        for condition in &category.conditions {
            if !["game","platform"].contains(&condition.scope.as_str())
                || !crate::entity_variables::valid_name(&condition.name)
                || !["eq","neq","contains","exists","not_exists","gt","gte","lt","lte"].contains(&condition.operator.as_str())
                || condition.value.chars().count() > 500 {
                return Err(crate::i18n::text("msg.6ddb0ac721").into());
            }
        }
    }
    let parents: HashMap<_, _> = categories.iter().map(|c| (c.id.as_str(), c.parent_id.as_deref())).collect();
    for category in categories.iter() {
        let mut visited = HashSet::new();
        let mut current = Some(category.id.as_str());
        while let Some(id) = current {
            if !visited.insert(id) { return Err(crate::i18n::text("msg.0a1cca1f01").into()); }
            current = *parents.get(id).ok_or(crate::i18n::text("msg.6170f78d5f"))?;
        }
    }
    Ok(())
}

fn read(conn: &Connection) -> Result<Navigation, String> {
    let json: Option<String> = conn.query_row("SELECT categories FROM library_navigation WHERE id=1", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let categories = json.map(|s| serde_json::from_str(&s).map_err(|e| crate::i18n::i18n_format!("msg.096ab324b1", e = e))).transpose()?;
    let mut stmt = conn.prepare("SELECT p.name,d.manufacturer FROM platforms p JOIN platform_details d ON d.platform_id=p.id WHERE d.manufacturer IS NOT NULL AND TRIM(d.manufacturer)<>''").map_err(|e| e.to_string())?;
    let manufacturers = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?.collect::<rusqlite::Result<HashMap<_, _>>>().map_err(|e| e.to_string())?;
    Ok(Navigation { categories, manufacturers,
        game_variables: crate::entity_variables::all(conn,"game")?,
        platform_variables: crate::entity_variables::all(conn,"platform")?,
    })
}

fn save(conn: &mut Connection, mut categories: Vec<Category>) -> Result<Vec<Category>, String> {
    validate(&mut categories)?;
    let json = serde_json::to_string(&categories).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO library_navigation(id,categories) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET categories=excluded.categories", params![json]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(categories)
}

#[tauri::command]
pub async fn get_library_navigation() -> Result<Navigation, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        read(&conn)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_library_categories(categories: Vec<Category>) -> Result<Vec<Category>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = crate::get_db_connection().map_err(|e| e.to_string())?;
        save(&mut conn, categories)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn category(id: &str, parent: Option<&str>) -> Category {
        Category { id: id.into(), name: id.into(), parent_id: parent.map(str::to_string), rule: "platforms".into(), platforms: vec![1], conditions: vec![], match_mode: "all".into() }
    }
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn.execute_batch("CREATE TABLE platforms(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE platform_details(platform_id INTEGER,manufacturer TEXT); INSERT INTO platforms VALUES(1,'Sony Playstation 2'); INSERT INTO platform_details VALUES(1,'Sony');").unwrap();
        conn
    }
    #[test]
    fn nested_categories_survive_reload_and_empty_is_not_first_use() {
        let mut conn = database();
        assert!(read(&conn).unwrap().categories.is_none());
        let categories = vec![category("parent",None),category("child",Some("parent"))];
        save(&mut conn, categories.clone()).unwrap();
        assert_eq!(read(&conn).unwrap().categories.unwrap(), categories);
        assert_eq!(read(&conn).unwrap().manufacturers["Sony Playstation 2"], "Sony");
        save(&mut conn, vec![]).unwrap();
        assert_eq!(read(&conn).unwrap().categories, Some(vec![]));
    }
    #[test]
    fn variable_conditions_round_trip_and_reject_invalid_predicates_without_replacing_the_tree() {
        let mut conn = database();
        let mut custom = category("custom",None);
        custom.rule="variables".into();
        custom.conditions=vec![Condition {scope:"game".into(),name:"favorito".into(),operator:"eq".into(),value:"yes".into()}];
        save(&mut conn,vec![custom.clone()]).unwrap();
        assert_eq!(read(&conn).unwrap().categories.unwrap(),vec![custom.clone()]);
        let mut invalid=custom.clone();invalid.conditions.clear();assert!(save(&mut conn,vec![invalid]).is_err());
        let mut invalid=custom.clone();invalid.conditions[0].name="__proto__".into();assert!(save(&mut conn,vec![invalid]).is_err());
        assert_eq!(read(&conn).unwrap().categories.unwrap(),vec![custom]);
    }

    #[test]
    fn invalid_edits_preserve_the_saved_tree() {
        let mut conn = database();
        let original = vec![category("parent", None)];
        save(&mut conn, original.clone()).unwrap();
        for invalid in [
            vec![category("a",Some("b")),category("b",Some("a"))],
            vec![category("a",Some("missing"))],
            vec![category("a",Some("a"))],
            vec![category("a",None),category("a",None)],
        ] { assert!(save(&mut conn, invalid).is_err()); }
        let mut invalid = category("bad", None); invalid.rule = "unknown".into();
        assert!(save(&mut conn, vec![invalid]).is_err());
        assert_eq!(read(&conn).unwrap().categories.unwrap(), original);
    }
}
