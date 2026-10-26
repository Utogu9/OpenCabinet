//! Classification variables are separate from execution/source information.
use std::collections::{BTreeMap, HashMap};
use rusqlite::{Connection, OptionalExtension};
pub type Variables = BTreeMap<String, String>;

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS entity_variables (
        entity TEXT NOT NULL CHECK(entity IN ('game','platform')), entity_id INTEGER NOT NULL,
        name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(entity,entity_id,name));")?;
    for (table, entity) in [("games", "game"), ("platforms", "platform")] {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)", [table], |r|r.get(0))?;
        if exists {
            conn.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS remove_{entity}_variables AFTER DELETE ON {table}
                BEGIN DELETE FROM entity_variables WHERE entity='{entity}' AND entity_id=OLD.id; END;"))?;
        }
    }
    Ok(())
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.as_bytes()[0].is_ascii_lowercase()
        && name.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_.-".contains(&c))
        && !["constructor", "prototype"].contains(&name)
}

pub fn save(conn: &Connection, entity: &str, id: i32, variables: &Variables) -> Result<(), String> {
    if variables.len() > 100 || variables.iter().any(|(key,value)| !valid_name(key) || value.chars().count() > 500) {
        return Err(crate::i18n::text("msg.3da552c337").into());
    }
    init_schema(conn).map_err(|e|e.to_string())?;
    conn.execute("DELETE FROM entity_variables WHERE entity=?1 AND entity_id=?2", (entity,id)).map_err(|e|e.to_string())?;
    for (name,value) in variables {
        conn.execute("INSERT INTO entity_variables(entity,entity_id,name,value) VALUES(?1,?2,?3,?4)", (entity,id,name,value.trim())).map_err(|e|e.to_string())?;
    }
    Ok(())
}

pub fn all(conn: &Connection, entity: &str) -> Result<HashMap<i32, Variables>, String> {
    let exists: Option<i32> = conn.query_row("SELECT 1 FROM sqlite_master WHERE name='entity_variables'", [], |r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let mut result = HashMap::new();
    if exists.is_none() { return Ok(result); }
    let mut stmt = conn.prepare("SELECT entity_id,name,value FROM entity_variables WHERE entity=?1 ORDER BY entity_id,name").map_err(|e|e.to_string())?;
    for row in stmt.query_map([entity], |r| Ok((r.get::<_,i32>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(|e|e.to_string())? {
        let (id,name,value) = row.map_err(|e|e.to_string())?;
        result.entry(id).or_insert_with(Variables::new).insert(name,value);
    }
    Ok(result)
}

pub fn read(conn: &Connection, entity: &str, id: i32) -> Result<Variables, String> {
    Ok(all(conn,entity)?.remove(&id).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn variables_are_transactional_independent_of_launch_sources_and_removed_with_their_owner() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,rom_path TEXT); CREATE TABLE platforms(id INTEGER PRIMARY KEY); INSERT INTO games VALUES(1,'steam://rungameid/10'); INSERT INTO platforms VALUES(1);").unwrap();
        init_schema(&conn).unwrap();
        let vars = Variables::from([("steam".into(),"no".into()),("favorito".into(),"yes".into())]);
        { let tx=conn.transaction().unwrap(); save(&tx,"game",1,&vars).unwrap(); tx.commit().unwrap(); }
        assert_eq!(read(&conn,"game",1).unwrap(),vars);
        assert_eq!(conn.query_row("SELECT rom_path FROM games", [], |r|r.get::<_,String>(0)).unwrap(),"steam://rungameid/10");
        { let tx=conn.transaction().unwrap(); save(&tx,"game",1,&Variables::new()).unwrap(); }
        assert_eq!(read(&conn,"game",1).unwrap(),vars);
        let invalid=Variables::from([("Nombre inválido".into(),"x".into())]);
        assert!(save(&conn,"game",1,&invalid).is_err());
        assert_eq!(read(&conn,"game",1).unwrap(),vars);
        save(&conn,"platform",1,&vars).unwrap();
        conn.execute("DELETE FROM games",[]).unwrap();
        assert!(read(&conn,"game",1).unwrap().is_empty());
        assert_eq!(read(&conn,"platform",1).unwrap(),vars);
    }
}
