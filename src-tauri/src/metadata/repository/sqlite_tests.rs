use super::tests::Sandbox;
use super::*;
use rusqlite::types::Value as SqlValue;
use serde_json::{Value, json};

// Small independent encoder for test documents in the public storage-v2 format.
// Production catalogs and network access are never required by these tests.
struct Fixture {
    conn: Connection,
    schemas: i64,
    texts: i64,
    lists: i64,
    maps: i64,
}
impl Fixture {
    fn text(&mut self, value: &str) -> i64 {
        self.texts += 1;
        self.conn
            .execute(
                "INSERT INTO texts VALUES(?1,?2)",
                params![self.texts, value],
            )
            .unwrap();
        self.texts
    }
    fn encode(&mut self, value: &Value, entity: &str) -> (i64, SqlValue) {
        match value {
            Value::Null => (0, SqlValue::Null),
            Value::Bool(v) => (1, (*v as i64).into()),
            Value::Number(v) => {
                if let Some(v) = v.as_i64() {
                    (2, v.into())
                } else {
                    (3, v.as_f64().unwrap().into())
                }
            }
            Value::String(v) => (4, self.text(v).into()),
            Value::Array(values) => {
                self.lists += 1;
                let id = self.lists;
                self.conn
                    .execute("INSERT INTO lists VALUES(?1,?2)", (id, values.len() as i64))
                    .unwrap();
                for (index, value) in values.iter().enumerate() {
                    let (tag, value) = self.encode(value, entity);
                    self.conn
                        .execute(
                            "INSERT INTO list_items VALUES(?1,?2,?3,?4)",
                            params![id, index as i64, tag, value],
                        )
                        .unwrap();
                }
                (6, id.into())
            }
            Value::Object(values) => {
                if [
                    "games",
                    "metadata",
                    "images",
                    "fields",
                    "labels",
                    "short_descriptions",
                    "descriptions",
                    "qualifiers",
                ]
                .contains(&entity)
                {
                    self.maps += 1;
                    let id = self.maps;
                    self.conn
                        .execute("INSERT INTO maps VALUES(?1,?2)", (id, values.len() as i64))
                        .unwrap();
                    for (key, value) in values {
                        let key_id = self.text(key);
                        let (tag, value) = self.encode(
                            value,
                            match entity {
                                "games" => "game",
                                "metadata" => "metadata_record",
                                "images" => "image",
                                _ => key,
                            },
                        );
                        self.conn
                            .execute(
                                "INSERT INTO map_items VALUES(?1,?2,?3,?4)",
                                params![id, key_id, tag, value],
                            )
                            .unwrap();
                    }
                    (7, id.into())
                } else {
                    let columns: Vec<_> = values
                        .iter()
                        .map(|(key, value)| {
                            let (tag, value) = self.encode(value, key);
                            (key.clone(), tag, value)
                        })
                        .collect();
                    self.schemas += 1;
                    let schema = self.schemas;
                    let table = format!("record_{schema}_test");
                    let id = (schema << 32) + 1;
                    self.conn
                        .execute(
                            "INSERT INTO record_schemas VALUES(?1,?2,?3)",
                            params![schema, table, entity],
                        )
                        .unwrap();
                    let quote = |key: &str| format!("\"{}\"", key.replace('"', "\"\""));
                    let declarations = columns
                        .iter()
                        .map(|(key, _, _)| format!(",{}", quote(key)))
                        .collect::<String>();
                    self.conn
                        .execute_batch(&format!(
                            "CREATE TABLE {table}(_row_id INTEGER PRIMARY KEY{declarations});"
                        ))
                        .unwrap();
                    for (index, (key, tag, _)) in columns.iter().enumerate() {
                        self.conn
                            .execute(
                                "INSERT INTO record_columns VALUES(?1,?2,?3,?4)",
                                params![
                                    schema,
                                    index as i64,
                                    key,
                                    [
                                        "null", "boolean", "integer", "real", "text", "record",
                                        "list", "map"
                                    ][*tag as usize]
                                ],
                            )
                            .unwrap();
                    }
                    let values = std::iter::once(SqlValue::Integer(id))
                        .chain(columns.into_iter().map(|(_, _, value)| value))
                        .collect::<Vec<_>>();
                    self.conn
                        .execute(
                            &format!(
                                "INSERT INTO {table} VALUES({})",
                                vec!["?"; values.len()].join(",")
                            ),
                            rusqlite::params_from_iter(values),
                        )
                        .unwrap();
                    (5, id.into())
                }
            }
        }
    }
}
fn write(file: &Path, value: &Value) {
    let conn = Connection::open(file).unwrap();
    conn.execute_batch("PRAGMA user_version=2;CREATE TABLE texts(id INTEGER PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE record_schemas(id INTEGER PRIMARY KEY,table_name TEXT NOT NULL,entity TEXT NOT NULL);CREATE TABLE record_columns(schema_id INTEGER,position INTEGER,name TEXT,value_type TEXT,PRIMARY KEY(schema_id,position));CREATE TABLE catalog_root(id INTEGER PRIMARY KEY,record_id INTEGER);CREATE TABLE maps(id INTEGER PRIMARY KEY,length INTEGER);CREATE TABLE map_items(map_id INTEGER,key_id INTEGER,value_type INTEGER,value,PRIMARY KEY(map_id,key_id));CREATE TABLE lists(id INTEGER PRIMARY KEY,length INTEGER);CREATE TABLE list_items(list_id INTEGER,position INTEGER,value_type INTEGER,value,PRIMARY KEY(list_id,position));").unwrap();
    let mut fixture = Fixture {
        conn,
        schemas: 0,
        texts: 0,
        lists: 0,
        maps: 0,
    };
    fixture.conn.execute_batch("BEGIN").unwrap();
    let (_, root) = fixture.encode(value, "catalog");
    fixture
        .conn
        .execute("INSERT INTO catalog_root VALUES(1,?1)", [root])
        .unwrap();
    fixture
        .conn
        .execute_batch("COMMIT;CREATE VIEW games AS SELECT id FROM maps;")
        .unwrap();
}

#[test]
fn sqlite_and_json_keep_identical_matches_metadata_and_media_identities() {
    let files = Sandbox::new();
    let mut conn = files.catalog();
    let source = "Sony - PlayStation 2";
    let mut data: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/repository-metadata.json"
    ))
    .unwrap();
    let (serial, game) = data["games"]
        .as_object_mut()
        .unwrap()
        .iter_mut()
        .next()
        .unwrap();
    game["images"]["cover_front"] = json!({"kind":"cover_front","path":format!("{serial}/cover_front.avif"),"sources":[{"region":"US","uploader":"Scanner Name","file_page":"https://segaretro.org/File:Exact_scan.jpg","url":"https://segaretro.org/images/scan.jpg"}]});
    game["images"]["manual"] = json!({"path":format!("{serial}/manual.cbz")});
    game["images"]["screenshot"] = json!({"kind":"screenshot","path":format!("{serial}/screenshot.png"),"sources":[{"source":"Named_Snaps/Example (USA).png"}]});
    data["metadata"]["wikidata:Q975773"]["source_url"] = "https://www.wikidata.org/wiki/Q975773".into();
    let json = files.job.directory.join("input.json");
    fs::write(&json, serde_json::to_vec(&data).unwrap()).unwrap();
    insert_platform(&mut conn, &files.job, source, &json, |_| ()).unwrap();
    let filename: String = conn.query_row("SELECT filename FROM images WHERE kind='cover'",[],|r|r.get(0)).unwrap();
    let mut image = [CatalogImage { filename, kind:"cover".into(), region:"World".into(), crc:String::new(), source:None }];
    attach_image_sources(&conn,&mut image).unwrap();
    let origin = image[0].source.as_ref().unwrap();
    assert_eq!(origin.uploader.as_deref(),Some("Scanner Name"));
    assert_eq!(origin.url.as_deref(),Some("https://segaretro.org/File:Exact_scan.jpg"));
    let snap:String=conn.query_row("SELECT s.details FROM repository_image_sources s JOIN images i USING(filename) WHERE i.kind='screenshot'",[],|r|r.get(0)).unwrap();
    assert_eq!(crate::media_provenance::decode(Some(snap)).unwrap().url.as_deref(),Some("https://github.com/libretro-thumbnails/Sony_-_PlayStation_2/blob/master/Named_Snaps/Example%20%28USA%29.png"));
    let details: String = conn.query_row("SELECT details FROM games WHERE details LIKE '%Q975773%'",[],|r|r.get(0)).unwrap();
    assert_eq!(repository_metadata::read_game(&details).unwrap().source.unwrap().url.as_deref(),Some("https://www.wikidata.org/wiki/Q975773"));
    let snapshot = |conn: &Connection| {
        [
            "SELECT details FROM games ORDER BY id",
            "SELECT game_id||name||normalized FROM names ORDER BY game_id,name",
            "SELECT game_id||filename||kind||region||crc FROM images ORDER BY game_id,filename",
            "SELECT filename||url FROM image_urls ORDER BY filename",
            "SELECT filename||details FROM repository_image_sources ORDER BY filename",
            "SELECT details FROM repository_console_metadata ORDER BY name",
        ]
        .iter()
        .map(|sql| {
            conn.prepare(sql)
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        })
        .collect::<Vec<_>>()
    };
    let before = snapshot(&conn);
    let file = files.job.directory.join("input.sqlite");
    write(&file, &data);
    let original = fs::read(&file).unwrap();
    insert_platform(&mut conn, &files.job, source, &file, |_| ()).unwrap();
    assert_eq!(snapshot(&conn), before);
    assert_eq!(
        fs::read(file).unwrap(),
        original,
        "source SQLite stays read-only"
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM images WHERE filename LIKE '%.avif'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM images WHERE kind='manual'", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(catalog_filename(&conn, source), "catalog.sqlite");
    insert_platform(&mut conn, &files.job, source, &json, |_| ()).unwrap();
    assert_eq!(snapshot(&conn), before);
    assert_eq!(catalog_filename(&conn, source), "catalog.json");
}

#[test]
fn missing_sqlite_falls_back_to_json_but_connection_errors_do_not() {
    let files = Sandbox::new();
    let file = files.job.directory.join("download");
    let mut urls = Vec::new();
    fetch_catalog_with("https://example.test/main/", &file, |url, file| {
        urls.push(url.to_owned());
        if url.ends_with("sqlite") {
            Ok(false)
        } else {
            fs::write(file, "json").map(|_| true).map_err(err)
        }
    })
    .unwrap();
    assert_eq!(urls.len(), 2);
    assert!(urls[0].ends_with("catalog.sqlite"));
    assert!(urls[1].ends_with("catalog.json"));
    urls.clear();
    assert!(
        fetch_catalog_with("https://example.test/", &file, |url, _| {
            urls.push(url.to_owned());
            Err("offline".into())
        })
        .is_err()
    );
    assert_eq!(urls.len(), 1);
    urls.clear();
    fetch_catalog_with("https://example.test/", &file, |url, _| {
        urls.push(url.to_owned());
        Ok(true)
    })
    .unwrap();
    assert_eq!(urls.len(), 1);
}

#[test]
fn invalid_sqlite_versions_cycles_and_missing_references_keep_the_old_catalog() {
    let files = Sandbox::new();
    let mut conn = files.catalog();
    let before: String = conn
        .query_row("SELECT group_concat(details) FROM games", [], |r| r.get(0))
        .unwrap();
    for change in [
        "PRAGMA user_version=99",
        "UPDATE catalog_root SET record_id=999",
        "UPDATE list_items SET value=999 WHERE value_type=5",
        "UPDATE list_items SET value_type=6,value=list_id",
    ] {
        let file = files
            .job
            .directory
            .join(format!("invalid-{}.sqlite", token(change)));
        write(&file, &serde_json::from_str(super::tests::FIXTURE).unwrap());
        Connection::open(&file)
            .unwrap()
            .execute_batch(change)
            .unwrap();
        assert!(
            insert_platform(&mut conn, &files.job, "Sony - PlayStation 2", &file, |_| ()).is_err(),
            "{change}"
        );
        assert_eq!(
            conn.query_row("SELECT group_concat(details) FROM games", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            before
        );
    }
    let file = files.job.directory.join("cancelled.sqlite");
    write(&file, &serde_json::from_str(super::tests::FIXTURE).unwrap());
    files.job.cancel().unwrap();
    assert!(insert_platform(&mut conn, &files.job, "Sony - PlayStation 2", &file, |_| ()).is_err());
}

#[test]
fn weekly_refresh_discovers_sqlite_after_json_disappears_and_keeps_its_revision() {
    let files = Sandbox::new();
    let conn = files.catalog();
    drop(conn);
    let source = "Sony - PlayStation 2";
    let file = files.job.directory.join("remote.sqlite");
    write(&file, &serde_json::from_str(super::tests::FIXTURE).unwrap());
    let mut urls = Vec::new();
    update_cached_platforms_with(&files.job,None,|_|(),|url,destination,_,_|{
        urls.push(url.to_owned());
        if url.contains("/commits?") {
            fs::write(destination,if url.contains("catalog.json"){"[]"}else{r#"[{"sha":"sqlite-one","commit":{"committer":{"date":"2099-01-01T00:00:00Z"}}}]"#}).map(|_|true).map_err(err)
        }else if url.ends_with("catalog.sqlite") {fs::copy(&file,destination).map(|_|true).map_err(err)}else{panic!("JSON must not be downloaded when SQLite is available")}
    }).unwrap();
    assert!(urls[0].contains("catalog.json"));
    assert!(urls[1].contains("catalog.sqlite"));
    let conn = open_catalog(&files.job.catalog_path()).unwrap();
    assert_eq!(catalog_filename(&conn, source), "catalog.sqlite");
    drop(conn);
    update_cached_platforms_with(
        &files.job,
        None,
        |_| (),
        |url, destination, _, _| {
            assert!(url.contains("/commits?") && url.contains("catalog.sqlite"));
            fs::write(destination, r#"[{"sha":"sqlite-one"}]"#)
                .map(|_| true)
                .map_err(err)
        },
    )
    .unwrap();
    // A corrupt newer SQLite never replaces the previously indexed catalog.
    let bytes = fs::read(files.job.catalog_path()).unwrap();
    assert!(
        update_cached_platforms_with(
            &files.job,
            None,
            |_| (),
            |url, destination, _, _| {
                fs::write(
                    destination,
                    if url.contains("/commits?") {
                        r#"[{"sha":"sqlite-two"}]"#
                    } else {
                        "SQLite format 3\0damaged"
                    },
                )
                .map(|_| true)
                .map_err(err)
            }
        )
        .is_err()
    );
    assert_eq!(fs::read(files.job.catalog_path()).unwrap(), bytes);
}
