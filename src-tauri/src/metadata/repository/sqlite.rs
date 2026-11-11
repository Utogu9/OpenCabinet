//! Read normalized repository catalogs without materializing the entire document.
use super::*;
use rusqlite::types::Value as SqlValue;

const HEADER: &[u8; 16] = b"SQLite format 3\0";
const TYPES: &[&str] = &[
    "null", "boolean", "integer", "real", "text", "record", "list", "map",
];
const MAX_ITEMS: usize = 1_000_000;

fn invalid() -> String {
    crate::i18n::text("source.invalid").into()
}
fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn reference(value: &SqlValue) -> Result<i64> {
    match value {
        SqlValue::Integer(id) if *id > 0 => Ok(*id),
        _ => Err(invalid()),
    }
}
fn table(conn: &Connection, name: &str) -> Result<()> {
    let valid:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1 AND type='table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%')",[name],|r|r.get(0)).map_err(err)?;
    if valid { Ok(()) } else { Err(invalid()) }
}

pub(super) enum Catalog {
    Json(RepoCatalog),
    Sqlite(Reader),
}
impl Catalog {
    pub fn open(file: &Path, job: &ImportJob) -> Result<Self> {
        use std::io::Read;
        let mut header = [0; 16];
        let count = File::open(file)
            .map_err(err)?
            .read(&mut header)
            .map_err(err)?;
        if count == 16 && &header == HEADER {
            Ok(Self::Sqlite(Reader::open(file, job)?))
        } else {
            Ok(Self::Json(
                serde_json::from_reader(BufReader::new(File::open(file).map_err(err)?))
                    .map_err(err)?,
            ))
        }
    }
    pub fn filename(&self) -> &'static str {
        if matches!(self, Self::Sqlite(_)) {
            "catalog.sqlite"
        } else {
            "catalog.json"
        }
    }
    pub fn system(&self) -> &str {
        match self {
            Self::Json(data) => &data.system,
            Self::Sqlite(data) => &data.system,
        }
    }
    pub fn version(&self) -> u32 {
        match self {
            Self::Json(data) => data.schema_version,
            Self::Sqlite(_) => 2,
        }
    }
    pub fn console(&self) -> &repository_metadata::Record {
        match self {
            Self::Json(data) => &data.console_metadata,
            Self::Sqlite(data) => &data.console,
        }
    }
    pub fn len(&self) -> usize {
        match self {
            Self::Json(data) => data.games.len(),
            Self::Sqlite(data) => data.games.len(),
        }
    }
    pub fn games(
        self,
        mut visit: impl FnMut(String, RepoGame, Option<&repository_metadata::Record>) -> Result<()>,
    ) -> Result<()> {
        match self {
            Self::Json(data) => {
                for (serial, game) in data.games {
                    let metadata = game
                        .metadata_id
                        .as_ref()
                        .and_then(|id| data.metadata.get(id));
                    visit(serial, game, metadata)?;
                }
            }
            Self::Sqlite(mut reader) => {
                let games = std::mem::take(&mut reader.games);
                for (serial, tag, value) in games {
                    reader.check()?;
                    let game: RepoGame =
                        serde_json::from_value(reader.decode(tag, value, 0)?).map_err(err)?;
                    let metadata = game
                        .metadata_id
                        .as_ref()
                        .and_then(|key| reader.metadata.get(key))
                        .cloned()
                        .map(|(tag, value)| {
                            reader.decode(tag, value, 0).and_then(|value| {
                                serde_json::from_value::<repository_metadata::Record>(value)
                                    .map_err(err)
                            })
                        })
                        .transpose()?;
                    visit(serial, game, metadata.as_ref())?;
                }
            }
        }
        Ok(())
    }
}

struct Shape {
    table: String,
    entity: String,
    columns: Vec<(String, usize)>,
}
pub(super) struct Reader {
    conn: Connection,
    shapes: HashMap<i64, Shape>,
    texts: HashMap<i64, String>,
    cancelled: Arc<AtomicBool>,
    system: String,
    console: repository_metadata::Record,
    games: Vec<(String, usize, SqlValue)>,
    metadata: HashMap<String, (usize, SqlValue)>,
    remaining: usize,
}
impl Reader {
    fn open(file: &Path, job: &ImportJob) -> Result<Self> {
        let conn = Connection::open_with_flags(file, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(err)?;
        conn.execute_batch("PRAGMA trusted_schema=OFF;PRAGMA query_only=ON;")
            .map_err(err)?;
        let cancelled = job.cancelled.clone();
        conn.progress_handler(10_000, Some(move || cancelled.load(Ordering::Acquire)))
            .map_err(err)?;
        if conn
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .map_err(err)?
            != 2
        {
            return Err(invalid());
        }
        // Catalogs may expose convenience views; read only their real storage
        // tables, never SQL supplied by those views or virtual tables.
        for name in [
            "texts",
            "record_schemas",
            "record_columns",
            "catalog_root",
            "maps",
            "map_items",
            "lists",
            "list_items",
        ] {
            table(&conn, name)?;
        }
        let schemas = conn
            .prepare("SELECT id,table_name,entity FROM record_schemas LIMIT 1025")
            .map_err(err)?
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if schemas.len() > 1024 {
            return Err(invalid());
        }
        let mut shapes = HashMap::new();
        for (id, table, entity) in schemas {
            if id <= 0 || !table.starts_with(&format!("record_{id}_")) {
                return Err(invalid());
            }
            self::table(&conn, &table)?;
            let columns=conn.prepare("SELECT name,value_type FROM record_columns WHERE schema_id=?1 ORDER BY position LIMIT 257").map_err(err)?
                .query_map([id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
            if columns.len() > 256 {
                return Err(invalid());
            }
            let columns = columns
                .into_iter()
                .map(|(name, kind)| {
                    TYPES
                        .iter()
                        .position(|known| *known == kind)
                        .map(|kind| (name, kind))
                        .ok_or_else(invalid)
                })
                .collect::<Result<Vec<_>>>()?;
            shapes.insert(
                id,
                Shape {
                    table,
                    entity,
                    columns,
                },
            );
        }
        conn.set_prepared_statement_cache_capacity(128);
        let root: i64 = conn
            .query_row("SELECT record_id FROM catalog_root WHERE id=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut reader = Self {
            conn,
            shapes,
            texts: HashMap::new(),
            cancelled: job.cancelled.clone(),
            system: String::new(),
            console: Default::default(),
            games: Vec::new(),
            metadata: HashMap::new(),
            remaining: 10_000_000,
        };
        let header = reader.record(root, 0)?;
        let mut header: HashMap<_, _> = header
            .into_iter()
            .map(|(name, tag, value)| (name, (tag, value)))
            .collect();
        let (tag, value) = header.remove("schema_version").ok_or_else(invalid)?;
        if reader.decode(tag, value, 0)?.as_u64() != Some(2) {
            return Err(invalid());
        }
        let (tag, value) = header.remove("system").ok_or_else(invalid)?;
        reader.system = reader
            .decode(tag, value, 0)?
            .as_str()
            .ok_or_else(invalid)?
            .to_owned();
        let (tag, value) = header.remove("games").ok_or_else(invalid)?;
        if tag != 7 {
            return Err(invalid());
        }
        reader.games = reader.map(reference(&value)?)?;
        if let Some((tag, value)) = header.remove("metadata") {
            if tag != 7 {
                return Err(invalid());
            }
            reader.metadata = reader
                .map(reference(&value)?)?
                .into_iter()
                .map(|(key, tag, value)| (key, (tag, value)))
                .collect();
        }
        if let Some((tag, value)) = header.remove("console_metadata") {
            reader.console = serde_json::from_value(reader.decode(tag, value, 0)?).map_err(err)?;
        }
        Ok(reader)
    }
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(cancelled_message().into())
        } else {
            Ok(())
        }
    }
    fn text(&mut self, id: i64) -> Result<String> {
        if let Some(value) = self.texts.get(&id) {
            return Ok(value.clone());
        }
        let value: String = self
            .conn
            .prepare_cached("SELECT value FROM texts WHERE id=?1")
            .map_err(err)?
            .query_row([id], |r| r.get(0))
            .map_err(err)?;
        if value.len() > 16 * 1024 * 1024 {
            return Err(invalid());
        }
        if self.texts.len() >= 16_384 {
            self.texts.clear();
        }
        self.texts.insert(id, value.clone());
        Ok(value)
    }
    fn map(&mut self, id: i64) -> Result<Vec<(String, usize, SqlValue)>> {
        let length: i64 = self
            .conn
            .prepare_cached("SELECT length FROM maps WHERE id=?1")
            .map_err(err)?
            .query_row([id], |r| r.get(0))
            .map_err(err)?;
        if !(0..=MAX_ITEMS as i64).contains(&length) {
            return Err(invalid());
        }
        let rows = self
            .conn
            .prepare_cached(
                "SELECT key_id,value_type,value FROM map_items WHERE map_id=?1 ORDER BY key_id",
            )
            .map_err(err)?
            .query_map([id], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, u8>(1)? as usize,
                    r.get::<_, SqlValue>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        if rows.len() != length as usize {
            return Err(invalid());
        }
        rows.into_iter()
            .map(|(key, tag, value)| Ok((self.text(key)?, tag, value)))
            .collect()
    }
    fn record(&mut self, id: i64, depth: usize) -> Result<Vec<(String, usize, SqlValue)>> {
        if depth > 64 {
            return Err(invalid());
        }
        let shape = self.shapes.get(&(id >> 32)).ok_or_else(invalid)?;
        let keep = |name: &str| match shape.entity.as_str() {
            "catalog" => [
                "schema_version",
                "system",
                "games",
                "metadata",
                "console_metadata",
            ]
            .contains(&name),
            "game" => ["entries", "images", "metadata_id"].contains(&name),
            "entries" | "release" => ["name", "dat_name", "region"].contains(&name),
            "image" => ["path", "kind", "sha256", "sources"].contains(&name),
            _ => ![
                "references",
                "compression",
                "source_provenance",
                "imported_keys",
                "database",
                "databases",
                "properties",
                "alias_chain",
            ]
            .contains(&name),
        };
        let columns: Vec<_> = shape
            .columns
            .iter()
            .filter(|(name, _)| keep(name))
            .cloned()
            .collect();
        let sql = format!(
            "SELECT {} FROM {} WHERE _row_id=?1",
            if columns.is_empty() {
                "_row_id".into()
            } else {
                columns
                    .iter()
                    .map(|(name, _)| quote(name))
                    .collect::<Vec<_>>()
                    .join(",")
            },
            quote(&shape.table)
        );
        let values = self
            .conn
            .prepare_cached(&sql)
            .map_err(err)?
            .query_row([id], |row| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, _)| row.get::<_, SqlValue>(i))
                    .collect::<rusqlite::Result<Vec<_>>>()
            })
            .map_err(err)?;
        Ok(columns
            .into_iter()
            .zip(values)
            .map(|((name, tag), value)| (name, tag, value))
            .collect())
    }
    fn decode(&mut self, tag: usize, value: SqlValue, depth: usize) -> Result<serde_json::Value> {
        use serde_json::Value;
        self.check()?;
        if depth > 64 || self.remaining == 0 {
            return Err(invalid());
        }
        self.remaining -= 1;
        Ok(match tag {
            0 => Value::Null,
            1 => match value {
                SqlValue::Integer(v) if v == 0 || v == 1 => Value::Bool(v == 1),
                _ => return Err(invalid()),
            },
            2 => match value {
                SqlValue::Integer(v) => v.into(),
                _ => return Err(invalid()),
            },
            3 => match value {
                SqlValue::Real(v) => serde_json::Number::from_f64(v).ok_or_else(invalid)?.into(),
                SqlValue::Integer(v) => v.into(),
                _ => return Err(invalid()),
            },
            4 => self.text(reference(&value)?)?.into(),
            5 => {
                let fields = self.record(reference(&value)?, depth + 1)?;
                let mut object = serde_json::Map::new();
                for (name, tag, value) in fields {
                    object.insert(name, self.decode(tag, value, depth + 1)?);
                }
                Value::Object(object)
            }
            6 => {
                let id = reference(&value)?;
                let length: i64 = self
                    .conn
                    .prepare_cached("SELECT length FROM lists WHERE id=?1")
                    .map_err(err)?
                    .query_row([id], |r| r.get(0))
                    .map_err(err)?;
                if !(0..=MAX_ITEMS as i64).contains(&length) {
                    return Err(invalid());
                }
                let rows=self.conn.prepare_cached("SELECT value_type,value FROM list_items WHERE list_id=?1 ORDER BY position").map_err(err)?.query_map([id],|r|Ok((r.get::<_,u8>(0)? as usize,r.get::<_,SqlValue>(1)?))).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
                if rows.len() != length as usize {
                    return Err(invalid());
                }
                Value::Array(
                    rows.into_iter()
                        .map(|(tag, value)| self.decode(tag, value, depth + 1))
                        .collect::<Result<_>>()?,
                )
            }
            7 => {
                let fields = self.map(reference(&value)?)?;
                let mut object = serde_json::Map::new();
                for (name, tag, value) in fields {
                    object.insert(name, self.decode(tag, value, depth + 1)?);
                }
                Value::Object(object)
            }
            _ => return Err(invalid()),
        })
    }
}
