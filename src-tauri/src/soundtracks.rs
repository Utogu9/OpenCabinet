//! Local, audio-only extras. Music never launches an emulator or records a play session.
use crate::{discs, game_regions, media_library};
use lofty::{file::{AudioFile, TaggedFileExt}, tag::Accessor};
use rusqlite::Connection;
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, io::{Read, Seek, SeekFrom, Write}, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, time::UNIX_EPOCH};
use tauri::Manager;
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
fn invalid() -> String { crate::i18n::text("ost.invalid").into() }
fn ext(path: &Path) -> String { path.extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase() }
fn audio(path: &Path) -> bool { matches!(ext(path).as_str(), "mp3"|"wav"|"flac"|"m4a") }
pub fn candidate(path: &Path) -> bool { matches!(ext(path).as_str(), "m3u"|"m3u8"|"cue") }
fn name(path: &Path) -> String { path.file_stem().unwrap_or_default().to_string_lossy().into_owned() }

#[derive(Clone, Debug, Serialize)]
pub struct Track {
    title: String, artist: String, duration: Option<f64>, available: bool,
    #[serde(skip)] file: PathBuf,
    #[serde(skip)] start: f64,
    #[serde(skip)] end: Option<f64>,
    #[serde(skip)] binary: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct Album { pub path: String, pub title: String, artist: String, cover: Option<String>, pub tracks: Vec<Track>, pub game_id: i32 }
#[derive(Serialize)]
pub struct Library { albums: Vec<Album>, warnings: Vec<String> }
#[derive(Serialize)]
pub struct Playback { path: String, start: f64, end: Option<f64> }

fn text(path: &Path) -> Result<String> {
    if fs::metadata(path).map_err(err)?.len()>2*1024*1024 { return Err(invalid()); }
    let bytes=fs::read(path).map_err(err)?;
    if bytes.len()>2*1024*1024 { return Err(invalid()); }
    if bytes.starts_with(&[0xff,0xfe]) { return Ok(String::from_utf16_lossy(&bytes[2..].chunks_exact(2).map(|b|u16::from_le_bytes([b[0],b[1]])).collect::<Vec<_>>())); }
    Ok(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').into())
}
fn resolve(parent: &Path, value: &str) -> Result<PathBuf> {
    let value=value.trim().trim_matches('"');
    if value.is_empty()||value.contains("://")||value.contains('\0') { return Err(invalid()); }
    // CUE/M3U authored on Windows commonly uses backslashes even on Linux.
    let value=if cfg!(windows){value.to_owned()}else{value.replace('\\',"/")};
    let path=PathBuf::from(value);
    Ok(if path.is_absolute(){path}else{parent.join(path)})
}
fn quoted(value: &str) -> Result<(String,String)> {
    let value=value.trim();
    if let Some(rest)=value.strip_prefix('"') {
        let end=rest.find('"').ok_or_else(invalid)?;
        Ok((rest[..end].into(),rest[end+1..].trim().into()))
    } else {
        let (first,rest)=value.split_once(char::is_whitespace).unwrap_or((value,""));
        Ok((first.into(),rest.trim().into()))
    }
}
fn timestamp(value: &str) -> Result<f64> {
    let v=value.split(':').map(str::parse::<u32>).collect::<std::result::Result<Vec<_>,_>>().map_err(err)?;
    if v.len()!=3||v[1]>=60||v[2]>=75 { return Err(invalid()); }
    Ok(v[0] as f64*60.0+v[1] as f64+v[2] as f64/75.0)
}
fn track(file: PathBuf) -> Track { Track {title:name(&file),artist:String::new(),duration:None,available:file.is_file(),file,start:0.0,end:None,binary:false} }
fn natural_order(a:&Path,b:&Path)->std::cmp::Ordering {
    let stable=a.cmp(b);
    let a=a.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    let b=b.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
    let (mut a,mut b)=(a.chars().peekable(),b.chars().peekable());
    while let (Some(x),Some(y))=(a.peek().copied(),b.peek().copied()) {
        let order=if x.is_ascii_digit()&&y.is_ascii_digit(){
            let (mut x,mut y)=(String::new(),String::new());
            while a.peek().is_some_and(|c|c.is_ascii_digit()){x.push(a.next().unwrap());}
            while b.peek().is_some_and(|c|c.is_ascii_digit()){y.push(b.next().unwrap());}
            let (x,y)=(x.trim_start_matches('0'),y.trim_start_matches('0'));
            x.len().cmp(&y.len()).then_with(||x.cmp(y))
        }else{a.next();b.next();x.cmp(&y)};
        if !order.is_eq(){return order;}
    }
    a.next().cmp(&b.next()).then(stable)
}
fn folder_album(path:&Path)->Result<Option<Album>> {
    let boundary=path.canonicalize().map_err(err)?;
    let files=fs::read_dir(path).map_err(err)?.take(10000).filter_map(|e|e.ok()).map(|e|e.path())
        .filter(|p|p.is_file()&&!p.file_name().is_some_and(|n|n.to_string_lossy().starts_with('.'))
            &&p.canonicalize().is_ok_and(|p|p.starts_with(&boundary))).collect::<Vec<_>>();
    let mut tracks=files.iter().filter(|p|audio(p)).cloned().map(track).collect::<Vec<_>>();
    if tracks.is_empty(){return Ok(None);}if tracks.len()>2000{return Err(invalid());}
    // Explicit playlists own the ordering and may intentionally exclude songs.
    if files.iter().any(|p|candidate(p)&&inspect(p).is_ok_and(|a|a.is_some())){return Ok(None);}
    tracks.sort_by(|a,b|natural_order(&a.file,&b.file));
    Ok(Some(Album{path:path.to_string_lossy().into(),title:path.file_name().unwrap_or_default().to_string_lossy().into(),artist:String::new(),cover:None,tracks,game_id:0}))
}
fn playlist(path: &Path, content: &str) -> Result<Option<Album>> {
    let mut tracks=Vec::new();let mut hint=None;
    for line in content.lines().map(str::trim).filter(|l|!l.is_empty()) {
        if let Some(value)=line.strip_prefix("#EXTINF:") { hint=value.split_once(',').map(|(_,s)|s.trim().to_owned()); continue; }
        if line.starts_with('#'){continue;}
        let file=resolve(path.parent().unwrap(),line)?;
        if !audio(&file) { return Ok(None); } // A ROM playlist is not a soundtrack.
        let mut t=track(file);if let Some(title)=hint.take().filter(|s|!s.is_empty()){t.title=title;}
        tracks.push(t);if tracks.len()>2000{return Err(invalid());}
    }
    Ok((!tracks.is_empty()).then(||Album{path:path.to_string_lossy().into(),title:name(path),artist:String::new(),cover:None,tracks,game_id:0}))
}
fn cue(path: &Path, content: &str) -> Result<Option<Album>> {
    let mut result=Album{path:path.to_string_lossy().into(),title:name(path),artist:String::new(),cover:None,tracks:vec![],game_id:0};
    let mut file=None;let mut binary=false;let mut indexed=Vec::new();let mut pregaps=Vec::new();
    for line in content.lines().map(str::trim) {
        let (cmd,value)=line.split_once(char::is_whitespace).unwrap_or((line,""));let value=value.trim();
        match cmd.to_ascii_uppercase().as_str() {
            "FILE"=>{let (filename,kind)=quoted(value)?;binary=kind.eq_ignore_ascii_case("BINARY");
                let resolved=resolve(path.parent().unwrap(),&filename)?;
                if !binary&&!audio(&resolved){return Err(invalid());}file=Some(resolved);},
            "TRACK"=>{let (_,kind)=value.split_once(char::is_whitespace).ok_or_else(invalid)?;
                if !kind.trim().eq_ignore_ascii_case("AUDIO"){return Ok(None);}
                let mut t=track(file.clone().ok_or_else(invalid)?);t.binary=binary;
                t.title=crate::i18n::i18n_format!("ost.track",result.tracks.len()+1);result.tracks.push(t);indexed.push(false);pregaps.push(None);
                if result.tracks.len()>2000{return Err(invalid());}},
            "TITLE"|"PERFORMER"=>{let title=value.trim_matches('"').to_owned();
                if let Some(t)=result.tracks.last_mut(){if cmd.eq_ignore_ascii_case("TITLE"){t.title=title}else{t.artist=title}}
                else if cmd.eq_ignore_ascii_case("TITLE"){result.title=title}else{result.artist=title}},
            "INDEX"=>{let (index,time)=value.split_once(char::is_whitespace).ok_or_else(invalid)?;
                if let Some(t)=result.tracks.last_mut(){if index=="01"{t.start=timestamp(time.trim())?;*indexed.last_mut().unwrap()=true;}
                    else if index=="00"{*pregaps.last_mut().unwrap()=Some(timestamp(time.trim())?);}}},
            _=>{}
        }
    }
    if indexed.iter().any(|v|!*v){return Err(invalid());}
    for i in 0..result.tracks.len() {
        if let Some(next)=result.tracks.get(i+1).filter(|n|n.file==result.tracks[i].file){
            let end=pregaps[i+1].unwrap_or(next.start);if end<=result.tracks[i].start{return Err(invalid());}result.tracks[i].end=Some(end);
        }
    }
    Ok((!result.tracks.is_empty()).then_some(result))
}
pub(crate) fn inspect(path: &Path) -> Result<Option<Album>> {
    if path.is_dir(){return folder_album(path);}
    if !candidate(path)||!path.is_file(){return Ok(None);}
    let content=text(path)?;if ext(path)=="cue"{cue(path,&content)}else{playlist(path,&content)}
}
fn signature(path: &Path) -> (u64,u128) {fs::metadata(path).map(|m|(m.len(),m.modified().unwrap_or(UNIX_EPOCH).duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos())).unwrap_or_default()}
fn key(value: impl std::hash::Hash) -> String {use std::hash::Hasher;let mut h=std::collections::hash_map::DefaultHasher::new();value.hash(&mut h);format!("{:016x}",h.finish())}
fn cover_in(path: &Path) -> Option<PathBuf> {
    let entries=fs::read_dir(path).ok()?.filter_map(|e|e.ok()).map(|e|e.path()).filter(|p|p.is_file()&&matches!(ext(p).as_str(),"jpg"|"jpeg"|"png"|"webp"|"avif")).collect::<Vec<_>>();
    for title in ["cover","folder","front","album"] {if let Some(p)=entries.iter().find(|p|name(p).eq_ignore_ascii_case(title)){return Some(p.clone());}}
    (entries.len()==1).then(||entries[0].clone())
}
type Cached = (Vec<(PathBuf,(u64,u128))>,Album);
static CACHE: OnceLock<Mutex<HashMap<PathBuf,Cached>>>=OnceLock::new();
fn enriched(path: &Path, root: &Path) -> Result<Option<Album>> {
    let mut album=match inspect(path)?{Some(a)=>a,None=>return Ok(None)};
    let directory=path.is_dir();
    let art=cover_in(if directory{path}else{path.parent().unwrap()});
    let mut files=vec![path.to_path_buf()];files.extend(album.tracks.iter().map(|t|t.file.clone()));files.extend(art.clone());
    let stamps=files.into_iter().map(|p|{let stamp=signature(&p);(p,stamp)}).collect::<Vec<_>>();
    let cache=CACHE.get_or_init(Default::default);
    if let Some((old,album))=cache.lock().map_err(err)?.get(path).filter(|(old,_)|*old==stamps){let _=old;return Ok(Some(album.clone()));}
    album.cover=art.map(|p|p.to_string_lossy().into());let mut details=HashMap::new();
    for t in &mut album.tracks {
        t.available=t.file.is_file();if !t.available{continue;}
        let full=if t.binary {Some(fs::metadata(&t.file).map_err(err)?.len() as f64/176400.0)}else{
            let parsed=details.entry(t.file.clone()).or_insert_with(||lofty::read_from_path(&t.file).ok());
            parsed.as_ref().map(|parsed|{
                if let Some(tag)=parsed.primary_tag().or_else(||parsed.first_tag()){
                    if ext(path)!="cue"{if let Some(title)=tag.title(){if t.title==name(&t.file){t.title=title.into_owned();}}}
                    if t.artist.is_empty(){t.artist=tag.artist().map(|s|s.into_owned()).unwrap_or_default();}
                    if album.artist.is_empty(){album.artist=tag.artist().map(|s|s.into_owned()).unwrap_or_default();}
                    if album.title==name(path)||(directory&&album.title==path.file_name().unwrap_or_default().to_string_lossy()){if let Some(title)=tag.album(){album.title=title.into_owned();}}
                    if album.cover.is_none(){if let Some(picture)=tag.pictures().first().filter(|p|p.data().len()<16*1024*1024){
                        let folder=root.join("cache/ost");
                        let extension=match picture.mime_type().map(|m|m.as_str()){Some("image/png")=>"png",Some("image/webp")=>"webp",Some("image/gif")=>"gif",_=>"jpg"};
                        if fs::create_dir_all(&folder).is_ok(){let art=folder.join(format!("{}.{extension}",key((&t.file,signature(&t.file)))));
                            if art.is_file()||fs::write(&art,picture.data()).is_ok(){album.cover=Some(art.to_string_lossy().into());}}
                    }}
                }
                parsed.properties().duration().as_secs_f64()
            })
        };
        t.end=t.end.or(full);t.duration=t.end.map(|end|(end-t.start).max(0.0));
        if full.is_some_and(|length|t.start>=length||t.end.is_some_and(|end|end>length+0.03)){t.available=false;}
    }
    if directory {
        album.tracks.sort_by_key(|t|{
            let tag=details.get(&t.file).and_then(|p|p.as_ref()).and_then(|p|p.primary_tag().or_else(||p.first_tag()));
            let number=tag.and_then(|t|t.track()).or_else(||name(&t.file).chars().take_while(|c|c.is_ascii_digit()).collect::<String>().parse().ok());
            (tag.and_then(|t|t.disk()).unwrap_or(1),number.unwrap_or(u32::MAX))
        });
    }
    let mut cache=cache.lock().map_err(err)?;if cache.len()>=64{cache.clear();}cache.insert(path.into(),(stamps,album.clone()));
    Ok(Some(album))
}
fn collection(conn:&Connection,root:&Path,id:i32)->Result<Option<PathBuf>> {
    let dir:Option<String>=conn.query_row("SELECT c.directory FROM games g LEFT JOIN media_collections c ON g.media_collection_id=c.id WHERE g.id=?1",[id],|r|r.get(0)).map_err(err)?;
    dir.map(|d|media_library::directory(root,&d)).transpose()
}
fn managed_folder(conn:&Connection,root:&Path,id:i32)->Result<PathBuf>{
    let tx=conn.unchecked_transaction().map_err(err)?;
    let (_,dir)=media_library::ensure_game(&tx,root,id as i64)?;
    let folder=media_library::directory(root,&dir)?.join("ost");fs::create_dir_all(&folder).map_err(err)?;
    let mut copies=crate::PendingImageCopies(vec![]);media_library::sync_game(&tx,root,id as i64,&mut copies)?;
    tx.commit().map_err(err)?;copies.0.clear();let warnings=media_library::flush(conn,root);
    if !warnings.is_empty(){return Err(warnings.join("; "));}Ok(folder)
}
// Reuse the existing owned download staging area and its interrupted-operation cleanup.
struct Stage(PathBuf);
impl Stage { fn new(root:&Path)->Result<Self>{let folder=root.join("metadata/staging");fs::create_dir_all(&folder).map_err(err)?;
    let path=folder.join(std::time::SystemTime::now().duration_since(UNIX_EPOCH).map_err(err)?.as_nanos().to_string());
    fs::create_dir(&path).map_err(err)?;Ok(Self(path))} }
impl Drop for Stage { fn drop(&mut self){let _=fs::remove_dir_all(&self.0);} }
fn sources(conn:&Connection,root:&Path,id:i32)->Result<Vec<(i32,PathBuf)>> {
    let mut paths=Vec::new();let mut seen=HashSet::new();
    for member in game_regions::expanded(conn,&[id])? {
        for disc in discs::read(conn,member as i64)? {let p=PathBuf::from(disc.rom_path);if candidate(&p)&&seen.insert(discs::key(&p.to_string_lossy())){paths.push((member,p));}}
        let primary:String=conn.query_row("SELECT rom_path FROM games WHERE id=?1",[member],|r|r.get(0)).map_err(err)?;
        let primary=PathBuf::from(primary);if candidate(&primary)&&seen.insert(discs::key(&primary.to_string_lossy())){paths.push((member,primary));}
        if let Some(folder)=collection(conn,root,member)?.map(|p|p.join("ost")).filter(|p|p.is_dir()) {
            let boundary=folder.canonicalize().map_err(err)?;let mut pending=vec![(folder,0)];
            while let Some((folder,depth))=pending.pop(){
                if folder_album(&folder)?.is_some()&&seen.insert(discs::key(&folder.to_string_lossy())){paths.push((member,folder.clone()));}
                for entry in fs::read_dir(folder).map_err(err)?.take(2000){let p=entry.map_err(err)?.path();
                if !p.canonicalize().is_ok_and(|p|p.starts_with(&boundary)){continue;}
                if p.file_name().is_some_and(|n|n.to_string_lossy().starts_with('.')){continue;}
                if p.is_dir()&&depth<2{pending.push((p,depth+1));}
                else if p.is_file()&&candidate(&p)&&seen.insert(discs::key(&p.to_string_lossy())){paths.push((member,p));}
                if paths.len()>=128{break;}
            }}
        }
    }
    paths.sort_by(|a,b|a.1.cmp(&b.1));Ok(paths)
}
fn library(conn:&Connection,root:&Path,id:i32)->Result<Library>{
    let mut out=Library{albums:vec![],warnings:vec![]};
    for (member,path) in sources(conn,root,id)? {match enriched(&path,root){Ok(Some(mut a))=>{a.game_id=member;out.albums.push(a);},Ok(None)=>{},Err(e)=>out.warnings.push(format!("{}: {e}",path.display()))}}
    Ok(out)
}
fn allowed_album(conn:&Connection,root:&Path,id:i32,path:&str)->Result<Album>{
    let expected=discs::key(path);let (member,path)=sources(conn,root,id)?.into_iter().find(|(_,p)|discs::key(&p.to_string_lossy())==expected).ok_or_else(invalid)?;
    let mut a=enriched(&path,root)?.ok_or_else(invalid)?;a.game_id=member;Ok(a)
}
fn prepare(t:&Track,root:&Path)->Result<Playback>{
    if !t.available{return Err(crate::i18n::text("ost.missing").into());}
    if !t.binary{return Ok(Playback{path:t.file.to_string_lossy().into(),start:t.start,end:t.end});}
    let offset=(t.start*75.0).round() as u64*2352;let end=t.end.ok_or_else(invalid)?;
    let length=(end*75.0).round() as u64*2352;
    let length=length.checked_sub(offset).filter(|n|*n>0&&*n<u32::MAX as u64-36).ok_or_else(invalid)?;
    let folder=root.join("cache/ost");fs::create_dir_all(&folder).map_err(err)?;
    let output=folder.join(format!("{}.wav",key((&t.file,signature(&t.file),offset,length))));
    if fs::metadata(&output).is_ok_and(|m|m.len()==length+44){return Ok(Playback{path:output.to_string_lossy().into(),start:0.0,end:None});}
    let stage=Stage::new(root)?;let temp=stage.0.join("track.wav.part");
    let result=(||{let mut source=fs::File::open(&t.file).map_err(err)?;source.seek(SeekFrom::Start(offset)).map_err(err)?;
        let mut file=fs::File::create(&temp).map_err(err)?;
        file.write_all(b"RIFF").map_err(err)?;file.write_all(&(length as u32+36).to_le_bytes()).map_err(err)?;file.write_all(b"WAVEfmt ").map_err(err)?;
        for v in [16u32,0x00020001,44100,176400,0x00100004]{file.write_all(&v.to_le_bytes()).map_err(err)?;}
        file.write_all(b"data").map_err(err)?;file.write_all(&(length as u32).to_le_bytes()).map_err(err)?;
        if std::io::copy(&mut source.take(length),&mut file).map_err(err)?!=length{return Err(invalid());}
        file.sync_all().map_err(err)?;drop(file);
        if output.exists(){fs::remove_file(&output).map_err(err)?;}fs::rename(&temp,&output).map_err(err)?;Ok(())})();
    if result.is_err(){let _=fs::remove_file(temp);}result?;
    Ok(Playback{path:output.to_string_lossy().into(),start:0.0,end:None})
}
#[tauri::command]
pub async fn get_game_soundtracks(id:i32,app:tauri::AppHandle)->Result<Library>{tauri::async_runtime::spawn_blocking(move||{
    let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;let result=library(&conn,&root,id)?;
    for a in &result.albums{if let Some(cover)=&a.cover{app.asset_protocol_scope().allow_file(cover).map_err(err)?;}}Ok(result)
}).await.map_err(err)?}
#[tauri::command]
pub async fn get_disc_soundtrack(id:i32,path:String,app:tauri::AppHandle)->Result<Option<Album>>{tauri::async_runtime::spawn_blocking(move||{
    let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;
    if !sources(&conn,&root,id)?.iter().any(|(_,p)|discs::key(&p.to_string_lossy())==discs::key(&path)){return Err(invalid());}
    let result=enriched(Path::new(&path),&root)?;
    if let Some(cover)=result.as_ref().and_then(|a|a.cover.as_ref()){app.asset_protocol_scope().allow_file(cover).map_err(err)?;}Ok(result)
}).await.map_err(err)?}
#[tauri::command]
pub async fn prepare_ost_track(id:i32,album:String,index:usize,app:tauri::AppHandle)->Result<Playback>{tauri::async_runtime::spawn_blocking(move||{
    let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;let album=allowed_album(&conn,&root,id,&album)?;
    let result=prepare(album.tracks.get(index).ok_or_else(invalid)?,&root)?;
    app.asset_protocol_scope().allow_file(&result.path).map_err(err)?;Ok(result)
}).await.map_err(err)?}
#[tauri::command]
pub async fn open_game_ost_folder(id:i32,app:tauri::AppHandle)->Result<()>{tauri::async_runtime::spawn_blocking(move||{
    let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;
    let folder=managed_folder(&conn,&root,id)?;crate::platform_runtime::open_path(&app,&folder)
}).await.map_err(err)?}
#[tauri::command]
pub async fn import_game_soundtrack(id:i32)->Result<bool>{
    let Some(file)=rfd::AsyncFileDialog::new().set_title(crate::i18n::text("ost.add")).add_filter("OST",&["m3u","m3u8","cue"]).pick_file().await else{return Ok(false)};
    let path=file.path().to_path_buf();tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;let root=crate::data_directory().map_err(err)?;import(&conn,&root,id,&path)?;Ok(true)
    }).await.map_err(err)?
}
fn import(conn:&Connection,root:&Path,id:i32,path:&Path)->Result<()> {
    let album=inspect(path)?.ok_or_else(invalid)?;
    if album.tracks.iter().any(|t|!t.available){return Err(crate::i18n::text("ost.missing").into());}
    let folder=managed_folder(conn,root,id)?;
    let serial=std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let staging=Stage::new(root)?;let stage=staging.0.clone();
    let result=(||{let mut files=HashMap::<PathBuf,String>::new();
        for t in &album.tracks{if !files.contains_key(&t.file){let name=format!("{:03}.{}",files.len()+1,ext(&t.file));fs::copy(&t.file,stage.join(&name)).map_err(err)?;files.insert(t.file.clone(),name);}}
        let mut content=String::new();
        if ext(path)=="cue"{for line in text(path)?.lines(){let trim=line.trim();let (cmd,value)=trim.split_once(char::is_whitespace).unwrap_or((trim,""));
            if cmd.eq_ignore_ascii_case("FILE"){let (source,kind)=quoted(value)?;let source=resolve(path.parent().unwrap(),&source)?;content.push_str(&format!("FILE \"{}\" {kind}\n",files.get(&source).ok_or_else(invalid)?));}
            else{content.push_str(line);content.push('\n');}}}
        else{content.push_str("#EXTM3U\n");for t in &album.tracks{content.push_str(&format!("#EXTINF:-1,{}\n{}\n",t.title.replace(['\r','\n']," "),files[&t.file]));}}
        let filename=format!("{}.{}",name(path).replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'],"_"),ext(path));fs::write(stage.join(filename),content).map_err(err)?;
        if let Some(cover)=cover_in(path.parent().unwrap()){fs::copy(&cover,stage.join(format!("cover.{}",ext(&cover)))).map_err(err)?;}
        fs::rename(&stage,folder.join(format!("album-{serial}"))).map_err(err)?;Ok(())})();
    if result.is_err(){let _=fs::remove_dir_all(&stage);}result
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files(PathBuf);
    impl Files {
        fn new()->Self {let path=std::env::current_dir().unwrap().join("target/ost-tests").join(format!("{}",std::time::SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));fs::create_dir_all(&path).unwrap();Self(path)}
        fn put(&self,path:&str,bytes:impl AsRef<[u8]>)->PathBuf{let path=self.0.join(path);fs::create_dir_all(path.parent().unwrap()).unwrap();fs::write(&path,bytes).unwrap();path}
        fn raw(&self,path:&str,seconds:u32)->PathBuf{self.put(path,vec![0x39;176400*seconds as usize])}
        fn wav(&self,path:&str)->PathBuf{let mut bytes=b"RIFF".to_vec();bytes.extend(176436u32.to_le_bytes());bytes.extend(b"WAVEfmt ");for v in [16u32,0x00020001,44100,176400,0x00100004]{bytes.extend(v.to_le_bytes());}bytes.extend(b"data");bytes.extend(176400u32.to_le_bytes());bytes.resize(176444,0);self.put(path,bytes)}
    }
    impl Drop for Files{fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn database()->Connection{
        let conn=Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT UNIQUE,cover_path TEXT,play_time INTEGER DEFAULT 0,release_date TEXT,developer TEXT,publisher TEXT); CREATE TABLE platforms(name TEXT); INSERT INTO platforms VALUES('PS2');").unwrap();
        crate::init_game_metadata(&conn).unwrap();crate::init_game_images(&conn).unwrap();media_library::init_schema(&conn).unwrap();discs::init(&conn).unwrap();game_regions::init(&conn).unwrap();conn
    }
    #[test]
    fn m3u_local_audio_unicode_missing_tracks_and_game_playlists(){let f=Files::new();f.wav("audio/One Song.wav");
        let p=f.put("album.m3u8","\u{feff}#EXTM3U\n#EXTINF:1,Custom song\naudio\\One Song.wav\n#EXTINF:-1,Missing\nmissing.flac\n");
        let a=enriched(&p,&f.0).unwrap().unwrap();assert_eq!(a.tracks.len(),2);assert_eq!(a.tracks[0].title,"Custom song");assert_eq!(a.tracks[0].duration,Some(1.0));assert!(!a.tracks[1].available);
        let games=f.put("game.m3u","Game Disc 1.chd\nGame Disc 2.chd");assert!(inspect(&games).unwrap().is_none());
        let remote=f.put("remote.m3u","https://example.com/song.mp3");assert!(inspect(&remote).is_err());
    }
    #[test]
    fn cue_only_audio_tracks_and_index00_boundaries(){let f=Files::new();f.raw("CD.bin",4);
        let p=f.put("CD.cue","TITLE \"Original soundtrack\"\nPERFORMER \"Composer\"\nFILE \"CD.bin\" BINARY\n TRACK 01 AUDIO\n TITLE \"First\"\n INDEX 01 00:00:00\n TRACK 02 AUDIO\n TITLE \"Second\"\n INDEX 00 00:01:00\n INDEX 01 00:02:00\n");
        let a=enriched(&p,&f.0).unwrap().unwrap();assert_eq!(a.title,"Original soundtrack");assert_eq!(a.artist,"Composer");assert_eq!(a.tracks[0].duration,Some(1.0));assert_eq!(a.tracks[1].duration,Some(2.0));
        let play=prepare(&a.tracks[1],&f.0).unwrap();let bytes=fs::read(&play.path).unwrap();assert_eq!(&bytes[..4],b"RIFF");assert_eq!(bytes.len(),352844);assert!(bytes[44..].iter().all(|b|*b==0x39));assert_eq!(play.start,0.0);
        assert_eq!(prepare(&a.tracks[1],&f.0).unwrap().path,play.path);
        assert_eq!(fs::read_dir(f.0.join("metadata/staging")).unwrap().count(),0);
        let p=f.put("game.cue","FILE \"CD.bin\" BINARY\nTRACK 01 MODE2/2352\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 00:01:00");assert!(inspect(&p).unwrap().is_none());
    }
    #[test]
    fn cue_multiple_audio_files_utf16_and_invalid_indexes(){let f=Files::new();f.wav("first.wav");f.wav("second.wav");
        let content="TITLE \"Two files\"\nFILE \"first.wav\" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nFILE \"second.wav\" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00";
        let bytes=std::iter::once(0xfeffu16).chain(content.encode_utf16()).flat_map(u16::to_le_bytes).collect::<Vec<_>>();let p=f.put("utf16.cue",bytes);
        let a=enriched(&p,&f.0).unwrap().unwrap();assert_eq!(a.tracks.iter().map(|t|t.duration).collect::<Vec<_>>(),[Some(1.0),Some(1.0)]);
        for line in ["INDEX 01 00:99:00","INDEX 01 00:00:75",""]{let p=f.put("bad.cue",format!("FILE \"first.wav\" WAVE\nTRACK 01 AUDIO\n{line}"));assert!(inspect(&p).is_err());}
    }
    #[test]
    fn imports_are_portable_preserve_originals_and_survive_game_removal(){let f=Files::new();let conn=database();let root=f.0.join("data");fs::create_dir_all(&root).unwrap();
        conn.execute("INSERT INTO games(id,title,platform,rom_path)VALUES(1,'Game','PS2','game.iso')",[]).unwrap();f.wav("original/one.wav");f.put("original/cover.webp",b"cover");let p=f.put("original/Soundtrack.m3u","#EXTM3U\none.wav");
        import(&conn,&root,1,&p).unwrap();let a=library(&conn,&root,1).unwrap();assert_eq!(a.albums.len(),1);assert!(a.albums[0].tracks[0].file.starts_with(&root));assert!(a.albums[0].cover.as_ref().unwrap().contains("cover.webp"));
        let folder=collection(&conn,&root,1).unwrap().unwrap();assert!(folder.join("manifest.json").exists());assert!(f.0.join("original/one.wav").exists());
        let moved=f.0.join("moved");fs::rename(&root,&moved).unwrap();let a=library(&conn,&moved,1).unwrap();assert!(a.albums[0].tracks[0].available);
        assert!(allowed_album(&conn,&moved,1,"not-attached.m3u").is_err());
        conn.execute("DELETE FROM games WHERE id=1",[]).unwrap();assert!(moved.join(folder.strip_prefix(&root).unwrap()).join("ost").exists());
    }
    #[test]
    fn merged_sources_include_soundtrack_discs_without_inventing_audio_for_data_discs(){let f=Files::new();let conn=database();let root=f.0.join("data");fs::create_dir_all(&root).unwrap();
        let p=f.put("disc.cue","FILE \"CD.bin\" BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00");f.raw("CD.bin",1);
        conn.execute("INSERT INTO games(id,title,platform,rom_path)VALUES(1,'Game','PS2','game.iso')",[]).unwrap();conn.execute("INSERT INTO games(id,title,platform,rom_path)VALUES(2,'OST','PS2',?1)",[p.to_string_lossy()]).unwrap();
        conn.execute("INSERT INTO game_regions VALUES(1,1,'Game',0,1)",[]).unwrap();conn.execute("INSERT INTO game_regions VALUES(2,1,'OST',1,0)",[]).unwrap();
        let albums=library(&conn,&root,1).unwrap().albums;assert_eq!(albums.len(),1);assert_eq!(albums[0].game_id,2);
        assert!(allowed_album(&conn,&root,1,&p.to_string_lossy()).is_ok());assert!(allowed_album(&conn,&root,2,&p.to_string_lossy()).is_ok());
        assert_eq!(conn.query_row("SELECT SUM(session_count) FROM games",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }
    #[test]
    fn album_cache_invalidates_when_referenced_audio_changes(){let f=Files::new();let p=f.put("album.cue","FILE \"CD.bin\" BINARY\nTRACK 01 AUDIO\nINDEX 01 00:00:00");f.raw("CD.bin",1);
        assert_eq!(enriched(&p,&f.0).unwrap().unwrap().tracks[0].duration,Some(1.0));f.raw("CD.bin",2);assert_eq!(enriched(&p,&f.0).unwrap().unwrap().tracks[0].duration,Some(2.0));
        fs::remove_file(f.0.join("CD.bin")).unwrap();assert!(!enriched(&p,&f.0).unwrap().unwrap().tracks[0].available);
    }
    #[test]
    fn folder_albums_use_numeric_filenames_artwork_and_invalidate_on_added_or_removed_songs(){
        let f=Files::new();let conn=database();let folder=f.0.join("images/one/ost/Album.2026");fs::create_dir_all(&folder).unwrap();
        conn.execute("INSERT INTO games(id,title,platform,rom_path,media_collection_id)VALUES(1,'Game','PS2','game.iso','one')",[]).unwrap();
        conn.execute("INSERT INTO media_collections VALUES('one','images/one','{}')",[]).unwrap();
        for n in [10,2,1]{f.wav(&format!("images/one/ost/Album.2026/Song {n}.wav"));}
        f.put("images/one/ost/Album.2026/cover.jpg",b"cover");f.put("images/one/ost/Album.2026/readme.txt",b"not audio");
        let albums=library(&conn,&f.0,1).unwrap().albums;assert_eq!(albums.len(),1);let a=&albums[0];assert_eq!(a.title,"Album.2026");
        assert_eq!(a.tracks.iter().map(|t|t.title.as_str()).collect::<Vec<_>>(),["Song 1","Song 2","Song 10"]);
        assert!(a.cover.as_ref().unwrap().ends_with("cover.jpg"));assert!(a.tracks.iter().all(|t|t.duration==Some(1.0)));
        let allowed=allowed_album(&conn,&f.0,1,&folder.to_string_lossy()).unwrap();assert!(prepare(&allowed.tracks[0],&f.0).unwrap().path.ends_with("Song 1.wav"));
        f.wav("images/one/ost/Album.2026/Song 3.wav");assert_eq!(enriched(&folder,&f.0).unwrap().unwrap().tracks.len(),4);
        fs::remove_file(folder.join("Song 2.wav")).unwrap();assert_eq!(enriched(&folder,&f.0).unwrap().unwrap().tracks.len(),3);
    }
    #[test]
    fn folder_albums_prioritize_disc_and_track_tags_without_changing_explicit_playlist_order(){
        use lofty::{tag::{Tag,TagType,TagExt},config::WriteOptions};
        let f=Files::new();
        for (filename,disc,number,title) in [("A.wav",2,1,"Disc 2 opening"),("B.wav",1,2,"Second song"),("C.wav",1,1,"First song")]{
            let path=f.wav(&format!("album/{filename}"));let mut tag=Tag::new(TagType::Id3v2);tag.set_disk(disc);tag.set_track(number);tag.set_title(title.into());tag.set_album("Tagged Album".into());
            tag.save_to_path(path,WriteOptions::default()).unwrap();
        }
        let folder=f.0.join("album");let a=enriched(&folder,&f.0).unwrap().unwrap();assert_eq!(a.title,"Tagged Album");
        assert_eq!(a.tracks.iter().map(|t|t.title.as_str()).collect::<Vec<_>>(),["First song","Second song","Disc 2 opening"]);
        let p=f.put("album/list.m3u","A.wav\nC.wav\nB.wav");assert!(inspect(&folder).unwrap().is_none());
        let a=enriched(&p,&f.0).unwrap().unwrap();assert_eq!(a.tracks[0].title,"Disc 2 opening");assert_eq!(a.tracks[1].title,"First song");
    }
    #[test]
    fn m4a_tags_duration_and_playlist_sources_are_supported(){
        let f=Files::new();let path=f.put("album/track.m4a",include_bytes!("../../tests/fixtures/soundtrack.m4a"));
        let a=enriched(path.parent().unwrap(),&f.0).unwrap().unwrap();assert_eq!(a.title,"Fixture OST");assert_eq!(a.tracks[0].title,"Test track");
        assert_eq!(a.tracks[0].artist,"OpenCabinet test");assert!(a.tracks[0].duration.is_some_and(|d|d>0.3&&d<0.5));assert!(a.tracks[0].available);
        let p=f.put("album/list.m3u","track.m4a");let a=inspect(&p).unwrap().unwrap();assert_eq!(a.tracks.len(),1);
    }
    #[test]
    #[ignore = "Optional local OST folder, supplied with OPENCABINET_OST_SAMPLE"]
    fn inspect_local_ost_folder_without_changing_its_files(){
        let f=Files::new();let path=PathBuf::from(std::env::var_os("OPENCABINET_OST_SAMPLE").expect("Set OPENCABINET_OST_SAMPLE to a local album folder"));
        let a=enriched(&path,&f.0).unwrap().unwrap();assert!(!a.tracks.is_empty());
        println!("Album: {} | Artist: {} | Tracks: {} | Cover: {}",a.title,a.artist,a.tracks.len(),a.cover.is_some());
        for (index,t) in a.tracks.iter().enumerate(){assert!(t.available);assert!(t.duration.is_some_and(|d|d>0.0));println!("{}: {} ({:.2} s)",index+1,t.title,t.duration.unwrap());}
    }
}
