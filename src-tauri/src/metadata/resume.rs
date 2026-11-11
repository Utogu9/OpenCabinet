//! Durable import receipts. Paths are regenerated inside the owned staging directory.
use super::*;
#[derive(Serialize, Deserialize)]
struct Receipt {version:u32, personal:bool, batch:StagedBatch, #[serde(default)] urls:HashMap<String,String>, #[serde(default)] root:Option<PathBuf>}
#[derive(Serialize)]
pub struct Pending {id:String,platform:String,games:usize,completed:usize,total:usize}
fn id_valid(id:&str)->bool{!id.is_empty()&&id.len()<=40&&id.bytes().all(|b|b.is_ascii_digit())}
fn stamp_path(path:&Path)->PathBuf {path.with_file_name(format!("{}.completed",path.file_name().unwrap_or_default().to_string_lossy()))}
fn read(directory:&Path,verify_files:bool)->Result<Receipt>{
    let file=directory.join("resume.json");
    if fs::symlink_metadata(directory).map_err(err)?.file_type().is_symlink()||fs::symlink_metadata(&file).map_err(err)?.file_type().is_symlink(){return Err(crate::i18n::text("resume.invalid").into());}
    if fs::metadata(&file).map_err(err)?.len()>64*1024*1024{return Err(crate::i18n::text("resume.invalid").into());}
    let mut receipt:Receipt=serde_json::from_reader(BufReader::new(File::open(file).map_err(err)?)).map_err(err)?;
    if receipt.version!=1||receipt.batch.games.len()!=receipt.batch.preview.games.len()||receipt.batch.games.len()>100_000||receipt.batch.tasks.len()>500_000{return Err(crate::i18n::text("resume.invalid").into());}
    if let (Some(previous),Some(current))=(&receipt.root,directory.parent().and_then(Path::parent).and_then(Path::parent)) {
        if previous!=current {
            let relocate=|candidate:&mut RomCandidate|{
                for path in std::iter::once(&mut candidate.rom_path).chain(candidate.discs.iter_mut().map(|disc|&mut disc.rom_path)){
                    if let Ok(relative)=Path::new(path).strip_prefix(previous){*path=current.join(relative).to_string_lossy().into_owned();}
                }
            };
            for game in &mut receipt.batch.games{relocate(&mut game.candidate);}
            for candidate in &mut receipt.batch.preview.games{relocate(candidate);}
        }
    }
    let canonical=directory.canonicalize().map_err(err)?;
    for task in &mut receipt.batch.tasks{
        if task.game_index>=receipt.batch.games.len()||!(safe_image_name(&task.image.filename)||safe_manual_name(&task.image.filename)){return Err(crate::i18n::text("resume.invalid").into());}
        task.path=directory.join(format!("{}-{}",task.game_index,task.image.filename));
        if verify_files&&task.path.exists()&&!task.path.canonicalize().map_err(err)?.starts_with(&canonical){return Err(crate::i18n::text("resume.invalid").into());}
        // A crash can happen after fsync and before updating the receipt.
        if verify_files {
        let stamp=fs::read_to_string(stamp_path(&task.path)).ok().and_then(|s|s.parse::<u64>().ok());
        task.done=stamp.is_some_and(|len|fs::metadata(&task.path).is_ok_and(|m|m.len()==len))&&validate_download(&task.path).is_ok();
        }
    }
    for (game,candidate)in receipt.batch.games.iter_mut().zip(&receipt.batch.preview.games){
        let mut identity=game.candidate.clone();identity.title=candidate.title.clone();
        if &identity!=candidate{return Err(crate::i18n::text("resume.invalid").into());}
        game.images.clear();game.manuals.clear();
    }
    Ok(receipt)
}
pub(crate) fn keep(directory:&Path)->bool {read(directory,false).is_ok()}
pub(super) fn clear_marker(job:&ImportJob,path:&Path)->Result<()> {
    if job.resume_directory.lock().map_err(err)?.is_some(){match fs::remove_file(stamp_path(path)){Ok(())=>{},Err(error)if error.kind()==std::io::ErrorKind::NotFound=>{},Err(error)=>return Err(err(error))}}
    Ok(())
}
pub(super) fn mark_complete(job:&ImportJob,path:&Path)->Result<()> {
    if job.resume_directory.lock().map_err(err)?.is_some(){
        let mut stamp=File::create(stamp_path(path)).map_err(err)?;
        write!(stamp,"{}",fs::metadata(path).map_err(err)?.len()).map_err(err)?;stamp.sync_all().map_err(err)?;
    }
    Ok(())
}
pub(super) fn checkpoint(job:&ImportJob,batch:&StagedBatch)->Result<()>{
    let origin=job.resume_directory.lock().map_err(err)?;
    let Some(directory)=origin.as_ref()else{return Ok(());};
    let file=directory.join("resume.json");let next=directory.join("resume.next.json");
    let mut output=File::create(&next).map_err(err)?;
    let urls=job.image_urls.lock().map_err(err)?;
    let selected:HashMap<_,_>=batch.tasks.iter().filter_map(|task|urls.get(&task.image.filename).map(|url|(task.image.filename.clone(),url.clone()))).collect();
    drop(urls);
    serde_json::to_writer(&mut output,&serde_json::json!({"version":1,"personal":job.personal_catalog,"batch":batch,"urls":selected,"root":job.root})).map_err(err)?;
    output.sync_all().map_err(err)?;drop(output);
    fs::rename(&next,&file).map_err(err)?;
    Ok(())
}
pub(super) fn begin(job:&ImportJob,batch:&StagedBatch)->Result<()>{
    for task in &batch.tasks {repository::image_url(job,IMAGE_BASE,&task.image.filename)?;}
    *job.resume_directory.lock().map_err(err)?=Some(job.directory.clone());checkpoint(job,batch)
}
pub(super) fn finish(job:&ImportJob){
    if let Ok(mut origin)=job.resume_directory.lock(){if let Some(directory)=origin.take(){let _=fs::remove_file(directory.join("resume.json"));if directory!=job.directory{let _=fs::remove_dir_all(directory);}}}
}
fn directory(root:&Path,id:&str)->Result<PathBuf>{
    if !id_valid(id){return Err(crate::i18n::text("resume.invalid").into());}
    let stage=root.join("metadata/staging");let directory=stage.join(id);
    if !directory.canonicalize().map_err(err)?.starts_with(stage.canonicalize().map_err(err)?){return Err(crate::i18n::text("resume.invalid").into());}
    Ok(directory)
}
#[tauri::command]
pub async fn get_pending_imports()->Result<Vec<Pending>>{
    tauri::async_runtime::spawn_blocking(||{
        let root=super::super::data_directory().map_err(err)?;let stage=root.join("metadata/staging");let mut result=Vec::new();
        if !stage.exists(){return Ok(result);}
        for entry in fs::read_dir(&stage).map_err(err)?{let entry=entry.map_err(err)?;let id=entry.file_name().to_string_lossy().into_owned();if !id_valid(&id){continue;}
            if let Ok(receipt)=directory(&root,&id).and_then(|dir|read(&dir,false)){result.push(Pending{id,platform:receipt.batch.platform,games:receipt.batch.games.len(),completed:receipt.batch.tasks.iter().filter(|t|t.done).count(),total:receipt.batch.tasks.len()});}
        }
        result.sort_by(|a,b|b.id.cmp(&a.id));Ok(result)
    }).await.map_err(err)?
}
#[derive(Serialize)]
pub struct Restored {job_id:String,platform:String,preview:ScanPreview}
#[tauri::command]
pub async fn restore_metadata_import(id:String,jobs:tauri::State<'_,MetadataJobs>)->Result<Restored>{
    let jobs=jobs.inner().clone();tauri::async_runtime::spawn_blocking(move||{
        let root=super::super::data_directory().map_err(err)?;let directory=directory(&root,&id)?;let receipt=read(&directory,true)?;
        if repository::personal(&root)!=receipt.personal{return Err(crate::i18n::text("resume.sourceChanged").into());}
        let job=jobs.start(root)?;
        *job.image_urls.lock().map_err(err)?=receipt.urls;
        *job.resume_directory.lock().map_err(err)?=Some(directory);
        let result=Restored{job_id:job.id.clone(),platform:receipt.batch.platform.clone(),preview:receipt.batch.preview.clone()};
        *job.staged.lock().map_err(err)?=Some(receipt.batch);Ok(result)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn discard_pending_import(id:String,jobs:tauri::State<'_,MetadataJobs>)->Result<()>{
    let jobs=jobs.inner().clone();tauri::async_runtime::spawn_blocking(move||{
        if jobs.has_active_job(){return Err(crate::i18n::text("msg.a37bbafd3c").into());}
        let root=super::super::data_directory().map_err(err)?;let directory=directory(&root,&id)?;read(&directory,false)?;
        fs::remove_dir_all(directory).map_err(err)
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn pause_metadata_import(job_id:String,jobs:tauri::State<'_,MetadataJobs>)->Result<()>{
    let jobs=jobs.inner().clone();let job=jobs.get(&job_id)?;job.cancel()?;
    tauri::async_runtime::spawn_blocking(move||{while job.busy.load(Ordering::Acquire){std::thread::sleep(Duration::from_millis(25));}
        let mut state=jobs.0.lock().map_err(err)?;if state.as_ref().is_some_and(|(id,_)|id==&job_id){*state=None;}Ok(())
    }).await.map_err(err)?
}

#[cfg(test)]
mod tests{
    use super::*;
    fn fixture()->(PathBuf,MetadataJobs,Arc<ImportJob>,StagedBatch){
        static SEQUENCE:AtomicUsize=AtomicUsize::new(0);
        let root=std::env::temp_dir().join(format!("opencabinet-resume-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),SEQUENCE.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir_all(&root).unwrap();let jobs=MetadataJobs::default();let job=jobs.start(root.clone()).unwrap();
        let candidate:RomCandidate=serde_json::from_value(serde_json::json!({"title":"Reviewed title","rom_path":root.join("Game.iso")})).unwrap();
        let preview=ScanPreview{games:vec![candidate.clone()],skipped_count:0,total_found:1};
        let mut prepared=candidate;prepared.title="Catalog title".into();
        let tasks=[("cover.png","cover"),("guide.pdf","manual")].into_iter().map(|(filename,kind)|DownloadTask{game_index:0,image:CatalogImage{ source: None,filename:filename.into(),kind:kind.into(),region:"World".into(),crc:String::new()},path:job.directory.join(format!("0-{filename}")),failure:None,done:false}).collect();
        let batch=StagedBatch{preview,platform:"PS2".into(),games:vec![PreparedGame{manual_sources:Default::default(),candidate:prepared,metadata:None,images:vec![],manuals:vec![],media_collection_id:None}],tasks};
        for task in &batch.tasks{job.image_urls.lock().unwrap().insert(task.image.filename.clone(),format!("https://example.invalid/{}",task.image.filename));}
        (root,jobs,job,batch)
    }
    #[test]
    fn receipts_survive_restart_keep_matches_and_do_not_accept_partial_files(){
        let(root,jobs,job,batch)=fixture();begin(&job,&batch).unwrap();checkpoint(&job,&batch).unwrap();
        fs::write(&batch.tasks[0].path,b"\x89PNG\r\n\x1a\n").unwrap();mark_complete(&job,&batch.tasks[0].path).unwrap();
        // This looks like a PDF but a crash prevented completion and fsync acknowledgement.
        fs::write(&batch.tasks[1].path,b"%PDF-1.7 partial").unwrap();
        let directory=job.directory.clone();drop(job);drop(jobs);
        assert!(keep(&directory));let restored=read(&directory,true).unwrap();
        assert!(restored.batch.tasks[0].done);assert!(!restored.batch.tasks[1].done);
        assert_eq!(restored.batch.games[0].candidate.title,"Catalog title");assert_eq!(restored.batch.preview.games[0].title,"Reviewed title");
        assert_eq!(restored.urls.len(),2);
        // The normal startup sweep keeps valid receipts, and removes unrelated scratch space.
        let abandoned=root.join("metadata/staging/123");fs::create_dir(&abandoned).unwrap();fs::write(abandoned.join("partial"),b"partial").unwrap();
        crate::temporary_files::cleanup(&root);assert!(directory.exists());assert!(!abandoned.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn receipts_rebase_download_paths_after_moving_data_and_explicit_cancel_removes_them(){
        let(root,jobs,job,batch)=fixture();begin(&job,&batch).unwrap();let old=job.directory.clone();drop(job);drop(jobs);
        let moved=root.with_extension("moved");fs::rename(&root,&moved).unwrap();
        let directory=moved.join(old.strip_prefix(&root).unwrap());let restored=read(&directory,true).unwrap();
        assert!(restored.batch.tasks.iter().all(|task|task.path.starts_with(&directory)));
        assert!(Path::new(&restored.batch.preview.games[0].rom_path).starts_with(&moved));
        let jobs=MetadataJobs::default();let job=jobs.start(moved.clone()).unwrap();*job.resume_directory.lock().unwrap()=Some(directory.clone());finish(&job);
        assert!(!directory.exists());drop(job);drop(jobs);fs::remove_dir_all(moved).unwrap();
    }
    #[test]
    fn invalid_receipts_and_path_traversal_are_rejected(){
        let(root,jobs,job,mut batch)=fixture();batch.tasks[0].image.filename="../outside.png".into();
        *job.resume_directory.lock().unwrap()=Some(job.directory.clone());checkpoint(&job,&batch).unwrap();assert!(!keep(&job.directory));
        assert!(directory(&root,"../outside").is_err());finish(&job);drop(job);drop(jobs);fs::remove_dir_all(root).unwrap();
    }
}
