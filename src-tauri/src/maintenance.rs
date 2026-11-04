//! On-demand storage accounting and a user-reviewed diagnostic export.
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }

#[derive(Default, Serialize)]
pub struct Usage { bytes: u64, files: u64, skipped: u64 }
impl Usage { fn add(&mut self, bytes: u64) { self.bytes += bytes; self.files += 1; } }
#[derive(Serialize)]
pub struct RetainedCollection { id: String, title: String, platform: String, usage: Usage }
#[derive(Serialize)]
pub struct StorageReport {
    directory: String, cache_directory: String, sections: BTreeMap<String, Usage>,
    retained: Vec<RetainedCollection>, skipped: u64,
}

// Do not follow links or Windows junctions during accounting or cleanup.
fn linked(meta: &fs::Metadata) -> bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return true; }
    }
    meta.file_type().is_symlink()
}
fn walk(root: &Path, mut visit: impl FnMut(&Path, u64)) -> u64 {
    let mut skipped=0; let mut pending=vec![root.to_path_buf()];
    while let Some(path)=pending.pop() {
        let meta=match fs::symlink_metadata(&path) {
            Ok(m)=>m, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>continue,
            Err(_)=>{skipped+=1;continue;}
        };
        if linked(&meta) { skipped+=1;continue; }
        if meta.is_file() { visit(&path,meta.len()); }
        else if meta.is_dir() {
            match fs::read_dir(&path) {
                Ok(entries)=>for entry in entries { match entry { Ok(e)=>pending.push(e.path()),Err(_)=>skipped+=1 } },
                Err(_)=>skipped+=1,
            }
        }
    }
    skipped
}
fn cache_root(root: &Path, custom: Option<&str>) -> Result<PathBuf> {
    let path=custom.filter(|s|!s.trim().is_empty()).map(PathBuf::from).unwrap_or_else(||root.join("cache"));
    if !path.is_absolute() { return Err(crate::i18n::text("msg.bba1ffc4e9").into()); }
    Ok(if path.exists() { path.canonicalize().map_err(err)? } else { path })
}
fn database(root: &Path) -> Result<Connection> {
    Connection::open_with_flags(crate::storage::database_path(root),OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}
fn report(root: &Path, custom: Option<&str>, conn: &Connection) -> Result<StorageReport> {
    let root=root.canonicalize().map_err(err)?;
    let cache=cache_root(&root,custom)?;
    let mut sections:BTreeMap<String,Usage>=["library","images","manuals","cache","backups","catalogs","emulators","other"].into_iter().map(|s|(s.into(),Usage::default())).collect();
    let mut folders:BTreeMap<PathBuf,Usage>=BTreeMap::new();
    let images=root.join("images");
    let mut skipped=walk(&root,|path,bytes| {
        let rel=path.strip_prefix(&root).unwrap();
        let first=rel.components().next().unwrap().as_os_str().to_string_lossy();
        let is_cache=["covers-v1","covers-v2","covers-v3"].iter().any(|version|path.starts_with(cache.join(version)));
        let section=if is_cache || first=="cache" { "cache" }
        else { match first.as_ref() {
            "images" if rel.components().any(|c|c.as_os_str()=="manuals")=>"manuals",
            "images"=>"images", "backups"=>"backups", "metadata"=>"catalogs", "emulators"=>"emulators",
            name if name.ends_with(".db")||name.ends_with(".db-wal")||name.ends_with(".db-shm")||name.ends_with(".json")=>"library",
            _=>"other"
        }};
        sections.get_mut(section).unwrap().add(bytes);
        let mut parent=path.parent();
        while let Some(dir)=parent.filter(|p|p.starts_with(&images)&&*p!=images) {
            folders.entry(dir.to_path_buf()).or_default().add(bytes); parent=dir.parent();
        }
    });
    if !cache.starts_with(&root) {
        // A custom cache folder may contain unrelated user files: count only
        // our own versioned subdirectories, never the whole chosen volume.
        for name in ["covers-v1","covers-v2","covers-v3"] {
            skipped+=walk(&cache.join(name),|_,bytes|sections.get_mut("cache").unwrap().add(bytes));
        }
    }
    let mut retained=Vec::new();
    let mut query=conn.prepare("SELECT c.id,c.directory,c.manifest FROM media_collections c WHERE NOT EXISTS(SELECT 1 FROM games g WHERE g.media_collection_id=c.id) ORDER BY c.id").map_err(err)?;
    let rows=query.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).map_err(err)?;
    for row in rows {
        let (id,dir,manifest)=row.map_err(err)?;
        let directory=match crate::media_library::directory(&root,&dir) { Ok(p)=>p,Err(_)=>{skipped+=1;continue;} };
        let meta:serde_json::Value=serde_json::from_str(&manifest).unwrap_or_default();
        retained.push(RetainedCollection { id,title:meta["title"].as_str().unwrap_or("").into(),platform:meta["platform"].as_str().unwrap_or("").into(),usage:folders.remove(&directory).unwrap_or_default() });
    }
    retained.sort_by(|a,b|a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(StorageReport { directory:root.to_string_lossy().into(),cache_directory:cache.to_string_lossy().into(),sections,retained,skipped })
}

#[tauri::command]
pub async fn get_storage_usage(cache_directory: Option<String>) -> Result<StorageReport> {
    tauri::async_runtime::spawn_blocking(move|| {
        let root=crate::storage::active_directory()?;
        report(&root,cache_directory.as_deref(),&database(&root)?)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn clear_thumbnail_cache(cache_directory: Option<String>) -> Result<Usage> {
    tauri::async_runtime::spawn_blocking(move|| {
        let root=cache_root(&crate::storage::active_directory()?,cache_directory.as_deref())?;
        crate::cover_cache::clear_managed(&root)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn open_retained_collection(app:tauri::AppHandle,id:String) -> Result<()> {
    let path=tauri::async_runtime::spawn_blocking(move|| {
        let root=crate::storage::active_directory()?; let conn=database(&root)?;
        let directory:Option<String>=conn.query_row("SELECT c.directory FROM media_collections c WHERE c.id=?1 AND NOT EXISTS(SELECT 1 FROM games g WHERE g.media_collection_id=c.id)",[id],|r|r.get(0)).optional().map_err(err)?;
        crate::media_library::directory(&root,&directory.ok_or_else(||crate::i18n::text("maintenance.collection_missing").to_string())?)
    }).await.map_err(err)??;
    crate::platform_runtime::open_path(&app,&path)
}

#[tauri::command]
pub fn diagnostic_system() -> serde_json::Value {
    serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"language":crate::i18n::locale(),"webview":if cfg!(target_os="linux"){"WebKitGTK"}else if cfg!(windows){"WebView2"}else{"WKWebView"}})
}
#[tauri::command]
pub async fn export_diagnostic_report(report:String) -> Result<bool> {
    if report.len()>512*1024 { return Err(crate::i18n::text("maintenance.invalid_report").into()); }
    let value:serde_json::Value=serde_json::from_str(&report).map_err(err)?;
    if value["format"]!="opencabinet-diagnostics-v1" { return Err(crate::i18n::text("maintenance.invalid_report").into()); }
    let Some(file)=rfd::AsyncFileDialog::new().set_file_name("OpenCabinet-diagnostics.json").add_filter("JSON",&["json"]).save_file().await else { return Ok(false); };
    tauri::async_runtime::spawn_blocking(move||fs::write(file.path(),report).map_err(err)).await.map_err(err)??;
    Ok(true)
}

pub(crate) fn clear_files(root: &Path) -> Result<Usage> {
    let mut result=Usage::default();
    for version in ["covers-v1","covers-v2","covers-v3"] {
        let mut failure=None;
        let skipped=walk(&root.join(version),|path,bytes| {
            let Some(name)=path.file_name().and_then(|s|s.to_str()).and_then(|s|s.strip_suffix(".webp")) else {return;};
            let parts:Vec<_>=name.split('-').collect();
            if parts.len()!=2 || parts.iter().any(|p|p.len()!=16||!p.bytes().all(|b|b.is_ascii_hexdigit())) {return;}
            if path.parent().and_then(|p|p.file_name()).and_then(|s|s.to_str())!=Some(parts[0]) {return;}
            match fs::remove_file(path) { Ok(())=>result.add(bytes),Err(e)=>failure=Some(err(e)) }
        });
        result.skipped+=skipped;
        if let Some(e)=failure {return Err(e);}
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files(PathBuf);
    impl Files {
        fn new()->Self {
            let root=std::env::current_dir().unwrap().join("target/maintenance-tests").join(format!("{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
            fs::create_dir_all(&root).unwrap();Self(root.canonicalize().unwrap())
        }
        fn write(&self,name:&str,bytes:&[u8]) {
            let path=self.0.join(name);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(path,bytes).unwrap();
        }
        fn conn(&self)->Connection {
            let conn=Connection::open_in_memory().unwrap();
            conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,media_collection_id TEXT);CREATE TABLE media_collections(id TEXT PRIMARY KEY,directory TEXT,manifest TEXT);").unwrap();conn
        }
    }
    impl Drop for Files {fn drop(&mut self){assert!(self.0.parent().unwrap().ends_with("maintenance-tests"));let _=fs::remove_dir_all(&self.0);}}
    #[test]
    fn counts_media_once_and_separates_retained_collections_from_active_games() {
        let files=Files::new();let conn=files.conn();
        for (path,length) in [("images/one/cover.webp",11),("images/one/manuals/book.cbz",22),("images/two/cover.webp",33),("cache/covers-v2/preview.webp",44),("backups/library.zip",55),("metadata/repository.db",66),("opencabinet.db",77)] {files.write(path,&vec![0;length]);}
        conn.execute("INSERT INTO media_collections VALUES('one','images/one',?1)",[r#"{"title":"Retained","platform":"PS2"}"#]).unwrap();
        conn.execute("INSERT INTO media_collections VALUES('two','images/two','{}')",[]).unwrap();
        conn.execute("INSERT INTO games VALUES(1,'two')",[]).unwrap();
        let usage=report(&files.0,None,&conn).unwrap();
        assert_eq!(usage.sections["images"].bytes,44);assert_eq!(usage.sections["manuals"].bytes,22);
        assert_eq!(usage.sections["cache"].bytes,44);assert_eq!(usage.sections["backups"].bytes,55);
        assert_eq!(usage.sections["catalogs"].bytes,66);assert_eq!(usage.sections["library"].bytes,77);
        assert_eq!(usage.sections.values().map(|v|v.bytes).sum::<u64>(),308);
        assert_eq!(usage.retained.len(),1);assert_eq!(usage.retained[0].title,"Retained");assert_eq!(usage.retained[0].usage.bytes,33);
        // Selecting the data directory as a custom cache cannot reclassify media.
        let custom=report(&files.0,Some(files.0.to_str().unwrap()),&conn).unwrap();assert_eq!(custom.sections["images"].bytes,44);
    }
    #[test]
    fn custom_cache_counts_only_managed_directories_without_double_counting() {
        let data=Files::new();let cache=Files::new();let conn=data.conn();
        data.write("cache/covers-v2/preview.webp",&[0;7]);cache.write("covers-v3/full/preview.webp",&[0;13]);cache.write("unrelated.iso",&[0;19]);
        let usage=report(&data.0,Some(cache.0.to_str().unwrap()),&conn).unwrap();assert_eq!(usage.sections["cache"].bytes,20);
        assert_eq!(usage.sections.values().map(|v|v.bytes).sum::<u64>(),20);
        assert!(cache_root(&data.0,Some("relative")).is_err());
    }
    #[test]
    fn cleaning_removes_only_generated_thumbnails_and_preserves_originals_and_unknown_files() {
        let files=Files::new();let name="0123456789abcdef-1111111111111111.webp";
        for prefix in ["covers-v2","covers-v3/full","covers-v3/inlay","covers-v3/manual-v1/auto"] {files.write(&format!("{prefix}/0123456789abcdef/{name}"),&[0;9]);}
        for path in ["covers-v3/cover.webp","covers-v3/0123456789abcdef/manifest.json","images/cover.webp","manuals/book.pdf"] {files.write(path,b"keep");}
        let removed=clear_files(&files.0).unwrap();assert_eq!(removed.files,4);assert_eq!(removed.bytes,36);
        for path in ["covers-v3/cover.webp","covers-v3/0123456789abcdef/manifest.json","images/cover.webp","manuals/book.pdf"] {assert_eq!(fs::read(files.0.join(path)).unwrap(),b"keep");}
        assert_eq!(clear_files(&files.0).unwrap().files,0);
    }
    #[cfg(unix)]
    #[test]
    fn accounting_and_cleanup_do_not_follow_symlinks_outside_the_cache() {
        let files=Files::new();let outside=Files::new();let conn=files.conn();
        outside.write("0123456789abcdef-1111111111111111.webp",b"keep");
        fs::create_dir_all(files.0.join("covers-v3")).unwrap();
        std::os::unix::fs::symlink(&outside.0,files.0.join("covers-v3/0123456789abcdef")).unwrap();
        assert_eq!(clear_files(&files.0).unwrap().files,0);
        assert!(outside.0.join("0123456789abcdef-1111111111111111.webp").exists());
        let usage=report(&files.0,None,&conn).unwrap();assert!(usage.skipped>0);assert_eq!(usage.sections.values().map(|v|v.bytes).sum::<u64>(),0);
    }
}
