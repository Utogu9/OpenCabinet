//! Desktop links launch through OpenCabinet, including an already-running copy.
//! A small local request inbox uses the existing OS instance lock; no public port.
use serde::{Deserialize,Serialize};
use std::{fs,io::Write,path::{Path,PathBuf},sync::Mutex,collections::VecDeque,time::{Duration,SystemTime,UNIX_EPOCH}};
use tauri::{Emitter,Manager};
type Result<T>=std::result::Result<T,String>;
fn err(e:impl std::fmt::Display)->String{e.to_string()}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Request {game_id:i32,library_id:String}
#[derive(Default)]
pub struct Requests(Mutex<VecDeque<Request>>);
impl Requests {pub fn new(request:Option<Request>)->Self{Self(Mutex::new(request.into_iter().collect()))}}
fn timestamp()->u128{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()}
pub fn arguments(args:impl IntoIterator<Item=String>)->Result<Option<Request>> {
    let args:Vec<_>=args.into_iter().collect();let Some(at)=args.iter().position(|v|v=="--launch-game")else{return Ok(None)};
    let id=args.get(at+1).and_then(|v|v.parse::<i32>().ok()).filter(|id|*id>0).ok_or_else(||crate::i18n::text("shortcuts.invalid").to_string())?;
    let library=args.iter().position(|v|v=="--library-id").and_then(|at|args.get(at+1)).filter(|v|!v.is_empty()&&v.len()<100&&v.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'))
        .ok_or_else(||crate::i18n::text("shortcuts.invalid").to_string())?;
    Ok(Some(Request{game_id:id,library_id:library.clone()}))
}
pub fn identity(conn:&rusqlite::Connection)->Result<String>{
    conn.execute_batch("CREATE TABLE IF NOT EXISTS shortcut_library_identity(id TEXT PRIMARY KEY)").map_err(err)?;
    conn.execute("INSERT INTO shortcut_library_identity(id) SELECT ?1 WHERE NOT EXISTS(SELECT 1 FROM shortcut_library_identity)",[format!("{}-{}",timestamp(),std::process::id())]).map_err(err)?;
    conn.query_row("SELECT id FROM shortcut_library_identity LIMIT 1",[],|r|r.get(0)).map_err(err)
}
fn inbox()->Result<PathBuf>{Ok(crate::platform_runtime::locations()?.0.join("shortcut-requests"))}
fn enqueue(directory:&Path,request:&Request)->Result<()> {
    fs::create_dir_all(directory).map_err(err)?;
    let stem=format!("{}-{}",timestamp(),std::process::id());let temporary=directory.join(format!("{stem}.tmp"));
    let mut file=fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(err)?;
    file.write_all(&serde_json::to_vec(request).map_err(err)?).map_err(err)?;file.sync_all().map_err(err)?;drop(file);
    fs::rename(temporary,directory.join(format!("{stem}.json"))).map_err(err)
}
pub fn forward(request:&Request)->Result<bool>{
    let program=crate::platform_runtime::locations()?.0;let lock=program.join(".opencabinet-instance.lock");
    if !lock.is_file(){return Ok(false);}
    let file=fs::OpenOptions::new().read(true).write(true).open(lock).map_err(err)?;
    match file.try_lock(){Ok(())=>Ok(false),Err(std::fs::TryLockError::WouldBlock)=>{enqueue(&inbox()?,request)?;Ok(true)},Err(e)=>Err(err(e))}
}
pub fn start(app:tauri::AppHandle){
    std::thread::spawn(move||loop{
        std::thread::sleep(Duration::from_millis(500));
        let Ok(directory)=inbox()else{continue};let Ok(entries)=fs::read_dir(&directory)else{continue};
        let mut paths=entries.flatten().map(|e|e.path()).filter(|p|{
            if p.extension().is_some_and(|v|v=="tmp")&&fs::metadata(p).ok().and_then(|m|m.modified().ok()).and_then(|t|t.elapsed().ok()).is_some_and(|age|age>Duration::from_secs(60)){let _=fs::remove_file(p);}
            p.extension().is_some_and(|v|v=="json")
        }).collect::<Vec<_>>();paths.sort();
        for path in paths.into_iter().take(32){
            let request=fs::metadata(&path).ok().filter(|m|m.len()<=2048&&m.modified().ok().and_then(|t|t.elapsed().ok()).is_some_and(|age|age<Duration::from_secs(60)))
                .and_then(|_|fs::read(&path).ok()).and_then(|bytes|serde_json::from_slice::<Request>(&bytes).ok());
            let _=fs::remove_file(path);
            if let Some(request)=request {if let Ok(mut queue)=app.state::<Requests>().0.lock(){if queue.len()<16{queue.push_back(request);}}let _=app.emit_to("main","shortcut-request-available",());}
        }
    });
}
#[tauri::command]
pub async fn take_shortcut_requests(state:tauri::State<'_,Requests>)->Result<Vec<i32>>{
    let requests=state.0.lock().map_err(err)?.drain(..).collect::<Vec<_>>();if requests.is_empty(){return Ok(vec![]);}
    tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;let identity=identity(&conn)?;let mut ids=vec![];
        for request in requests {
            if request.library_id!=identity {return Err(crate::i18n::text("shortcuts.otherLibrary").into());}
            if !conn.query_row("SELECT EXISTS(SELECT 1 FROM games WHERE id=?1)",[request.game_id],|r|r.get::<_,bool>(0)).map_err(err)?{return Err(crate::i18n::text("shortcuts.missing").into());}
            ids.push(crate::game_regions::owner(&conn,request.game_id)?);
        }
        Ok(ids)
    }).await.map_err(err)?
}
#[derive(Deserialize)]
pub struct IconFrame {size:u16,png:Vec<u8>}
fn game_title(conn:&rusqlite::Connection,id:i32)->Result<String>{
    conn.query_row("SELECT title FROM games WHERE id=COALESCE((SELECT game_id FROM game_regions WHERE parent_id=?1 AND is_default=1 LIMIT 1),?1)",[id],|r|r.get(0)).map_err(err)
}
fn valid_frame(frame:&IconFrame)->bool{
    [16,24,32,48,64,128,256].contains(&frame.size)&&frame.png.len()>=24&&frame.png.len()<=1_048_576
        &&frame.png[..8]==[137,80,78,71,13,10,26,10]&&frame.png[12..16]==*b"IHDR"
        &&u32::from_be_bytes(frame.png[16..20].try_into().unwrap())==frame.size as u32
        &&u32::from_be_bytes(frame.png[20..24].try_into().unwrap())==frame.size as u32
}
#[cfg(any(windows,test))]
fn ico(frames:&[IconFrame])->Vec<u8>{
    let mut bytes=vec![0,0,1,0];bytes.extend_from_slice(&(frames.len()as u16).to_le_bytes());let mut offset=6+16*frames.len();
    for frame in frames {bytes.extend_from_slice(&[frame.size as u8,frame.size as u8,0,0,1,0,32,0]);
        bytes.extend_from_slice(&(frame.png.len()as u32).to_le_bytes());bytes.extend_from_slice(&(offset as u32).to_le_bytes());offset+=frame.png.len();}
    for frame in frames{bytes.extend_from_slice(&frame.png);}bytes
}
fn filename(title:&str)->String{let name:String=title.chars().filter(|c|!c.is_control()).map(|c|if "<>:\"/\\|?*".contains(c){'_'}else{c}).take(100).collect();let name=name.trim().trim_end_matches('.');if name.is_empty(){"OpenCabinet game".into()}else{name.into()}}
#[cfg(any(not(windows),test))]
fn desktop_value(value:&str)->String{value.replace('\\',"\\\\").replace('\n',"\\n").replace('\r',"\\r")}
#[cfg(any(not(windows),test))]
fn exec_quote(value:&str)->String{
    let quoted=value.replace('\\',"\\\\").replace('"',"\\\"").replace('`',"\\`").replace('$',"\\$").replace('%',"%%");
    format!("\"{}\"",desktop_value(&quoted))
}
#[cfg(any(not(windows),test))]
fn desktop(title:&str,executable:&Path,id:i32,library:&str,icon:&Path)->String{
    format!("[Desktop Entry]\nVersion=1.0\nType=Application\nName={}\nExec={} --launch-game {id} --library-id {}\nIcon={}\nTerminal=false\nCategories=Game;\nStartupWMClass=opencabinet\n",
        desktop_value(title),exec_quote(&executable.to_string_lossy()),exec_quote(library),desktop_value(&icon.to_string_lossy()))
}
#[cfg(windows)]
fn windows_link(destination:&Path,executable:&Path,arguments:&str,icon:&Path)->Result<()> {
    let config=serde_json::json!({"destination":destination,"target":executable,"arguments":arguments,"icon":icon});
    let script="$c=$env:OPENCABINET_SHORTCUT|ConvertFrom-Json;$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($c.destination);$s.TargetPath=$c.target;$s.Arguments=$c.arguments;$s.IconLocation=$c.icon+',0';$s.WorkingDirectory=[IO.Path]::GetDirectoryName($c.target);$s.Save()";
    let mut command=std::process::Command::new("powershell.exe");crate::platform_runtime::configure_child(&mut command);
    let result=command.args(["-NoProfile","-NonInteractive","-Command",script]).env("OPENCABINET_SHORTCUT",config.to_string()).output().map_err(err)?;
    if !result.status.success(){return Err(crate::i18n::i18n_format!("shortcuts.failed",String::from_utf8_lossy(&result.stderr)));}Ok(())
}
#[tauri::command]
pub async fn create_game_shortcut(game_id:i32,icon_frames:Option<Vec<IconFrame>>)->Result<Option<String>>{
    tauri::async_runtime::spawn_blocking(move||{
        let conn=crate::get_db_connection().map_err(err)?;let title=game_title(&conn,game_id)?;
        let library=identity(&conn)?;let frames=icon_frames.unwrap_or_default();
        if frames.len()>7||frames.iter().any(|f|!valid_frame(f)){return Err(crate::i18n::text("shortcuts.invalidIcon").into());}
        let extension=if cfg!(windows){"lnk"}else{"desktop"};
        let Some(destination)=rfd::FileDialog::new().set_title(crate::i18n::text("shortcuts.create")).set_file_name(format!("{}.{extension}",filename(&title))).add_filter(crate::i18n::text("shortcuts.create"),&[extension]).save_file()else{return Ok(None)};
        let icons=crate::data_directory().map_err(err)?.join("shortcut-icons");fs::create_dir_all(&icons).map_err(err)?;
        #[cfg(windows)]
        let icon_bytes=if frames.is_empty(){include_bytes!("../icons/icon.ico").to_vec()}else{ico(&frames)};
        #[cfg(not(windows))]
        let icon_bytes=frames.iter().max_by_key(|f|f.size).map(|f|f.png.clone()).unwrap_or_else(||include_bytes!("../icons/128x128@2x.png").to_vec());
        use std::hash::{Hash,Hasher};let mut hash=std::collections::hash_map::DefaultHasher::new();icon_bytes.hash(&mut hash);
        let icon=icons.join(format!("{game_id}-{:x}.{}",hash.finish(),if cfg!(windows){"ico"}else{"png"}));fs::write(&icon,icon_bytes).map_err(err)?;
        let executable=std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|p|p.is_absolute()).unwrap_or(std::env::current_exe().map_err(err)?);
        #[cfg(windows)] {
            windows_link(&destination,&executable,&format!("--launch-game {game_id} --library-id {library}"),&icon)?;
        }
        #[cfg(not(windows))] {
            fs::write(&destination,desktop(&title,&executable,game_id,&library,&icon)).map_err(err)?;
            #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&destination,fs::Permissions::from_mode(0o755)).map_err(err)?;}
        }
        Ok(Some(destination.to_string_lossy().into_owned()))
    }).await.map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]fn shortcut_names_follow_the_default_merged_edition(){
        let conn=rusqlite::Connection::open_in_memory().unwrap();conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT);INSERT INTO games VALUES(1,'Original title'),(2,'Regional title');
            CREATE TABLE game_regions(game_id INTEGER,parent_id INTEGER,is_default INTEGER);INSERT INTO game_regions VALUES(1,1,0),(2,1,1)").unwrap();
        assert_eq!(game_title(&conn,1).unwrap(),"Regional title");conn.execute("DELETE FROM game_regions",[]).unwrap();assert_eq!(game_title(&conn,1).unwrap(),"Original title");
    }
    #[test]fn validates_requests_and_quotes_desktop_paths_without_shell_expansion(){
        assert!(arguments(["--launch-game","7","--library-id","library-1"].map(str::to_owned)).unwrap().is_some());
        for args in [vec!["--launch-game","-1"],vec!["--launch-game","1","--library-id","bad id"]]{assert!(arguments(args.into_iter().map(str::to_owned)).is_err());}
        let text=desktop("Title\nInjected=bad",Path::new("/Games/100%/$game.AppImage"),7,"lib-1",Path::new("/Icons/a.png"));
        assert!(text.contains("Title\\nInjected=bad"));assert!(text.contains("100%%/\\\\$game.AppImage"));assert!(text.contains("--launch-game 7"));
    }
    #[test]fn ico_has_correct_offsets_and_256_pixel_entry(){
        let frame=IconFrame{size:256,png:include_bytes!("../icons/128x128@2x.png").to_vec()};assert!(valid_frame(&frame));
        let png=frame.png.clone();let bytes=ico(&[frame]);assert_eq!(&bytes[..6],&[0,0,1,0,1,0]);assert_eq!(bytes[6],0);assert_eq!(&bytes[22..],png);
    }
    #[cfg(windows)]
    #[test]fn windows_shortcut_keeps_target_arguments_and_custom_icon(){
        let root=std::env::temp_dir().join(format!("opencabinet-links-{}",timestamp()));fs::create_dir_all(&root).unwrap();
        let destination=root.join("Game link.lnk");let icon=root.join("Game logo.ico");fs::write(&icon,include_bytes!("../icons/icon.ico")).unwrap();
        let target=std::env::current_exe().unwrap();windows_link(&destination,&target,"--launch-game 7 --library-id library-1",&icon).unwrap();
        let mut command=std::process::Command::new("powershell.exe");crate::platform_runtime::configure_child(&mut command);
        let output=command.args(["-NoProfile","-NonInteractive","-Command","$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:OC_TEST_LINK);@{target=$s.TargetPath;arguments=$s.Arguments;icon=$s.IconLocation}|ConvertTo-Json -Compress"])
            .env("OC_TEST_LINK",&destination).output().unwrap();
        assert!(output.status.success());let value:serde_json::Value=serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(Path::new(value["target"].as_str().unwrap()),target);assert_eq!(value["arguments"],"--launch-game 7 --library-id library-1");
        assert!(value["icon"].as_str().unwrap().starts_with(&*icon.to_string_lossy()));
        fs::remove_file(destination).unwrap();fs::remove_file(icon).unwrap();fs::remove_dir(root).unwrap();
    }
}
