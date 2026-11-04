//! A bounded global pool downloads games concurrently; SQLite commits stay on
//! the coordinator. Each game retains its regional order and new-image limits.
use super::*;
use std::collections::VecDeque;
use std::sync::mpsc;

struct Work {
    index: usize,
    id: i32,
    title: String,
    source: i64,
    existing: Vec<GameImage>,
    batch: StagedBatch,
}

enum Event {
    Progress(MetadataProgress),
    Finished(Work, Result<()>),
}

pub(super) fn download_images(
    conn: &mut Connection, catalog: &Connection, job: &ImportJob, ids: Vec<i32>,
    options: &MediaOptions, image_base: &str, mut progress: impl FnMut(MetadataProgress),
) -> Result<BulkImageReport> {
    options.validate()?;
    let mut seen=HashSet::new();
    let ids:Vec<_>=ids.into_iter().filter(|id|seen.insert(*id)).collect();
    if ids.len()<2 {return Err(crate::i18n::text("msg.36783a7fcc").into());}
    if !options.entries().iter().any(|(_,count)|*count>0) {return Err(crate::i18n::text("msg.c2af09131f").into());}
    let total=ids.len() as u64;
    let mut results:Vec<Option<BulkImageResult>>=(0..ids.len()).map(|_|None).collect();
    let mut pending=VecDeque::new();
    let mut processed=0;
    progress(job.progress("bulk_images",0,Some(total),None));
    // No SQLite connection crosses a worker boundary. Resolve matches, paths
    // and candidate order first; downloads stream directly into staging files.
    for (index,id) in ids.into_iter().enumerate() {
        if job.check().is_err(){break;}
        let title=conn.query_row("SELECT title FROM games WHERE id=?1",[id],|r|r.get::<_,String>(0))
            .optional().map_err(err)?.unwrap_or_else(||crate::i18n::i18n_format!("msg.ceaa5504bb",id=id));
        let prepared=(||{
            let (source,platform)=bulk_image_match(conn,catalog,id)?;
            let mut existing=super::super::read_game_images(conn,id)?;
            for image in &mut existing {image.path=super::super::resolve_image_path(&job.root,&image.path);}
            let batch=prepare_editor_images(conn,catalog,job,id,source,&platform,options,Some(&existing))?;
            Ok::<_,String>(Work{index,id,title:title.clone(),source,existing,batch})
        })();
        match prepared {
            Ok(work)=>pending.push_back(work),
            Err(message)=>{
                if job.check().is_err(){break;}
                results[index]=Some(BulkImageResult{game_id:id,title:title.clone(),added:0,message});
                processed+=1;
                progress(job.progress("bulk_images",processed,Some(total),Some(title)));
            }
        }
    }
    if !pending.is_empty()&&job.check().is_ok() {
        let client=http_client()?;
        let workers=IMAGE_DOWNLOAD_WORKERS.min(pending.len());
        let queue=Mutex::new(pending);
        std::thread::scope(|scope|{
            let (sender,receiver)=mpsc::channel();
            for _ in 0..workers {
                let sender=sender.clone();let (queue,client)=(&queue,&client);
                scope.spawn(move||{
                    while job.check().is_ok() {
                        let Some(mut work)=queue.lock().expect("bulk download queue poisoned").pop_front() else {break;};
                        let result=download_additional_images_with_client(&mut work.batch,options,&work.existing,job,image_base,client,|update|{
                            let _=sender.send(Event::Progress(update));
                        });
                        if sender.send(Event::Finished(work,result)).is_err(){break;}
                    }
                });
            }
            drop(sender);
            // Drain and join every worker, including after cancellation, before
            // the command releases its busy guard and staging can be removed.
            for event in receiver {
                if job.check().is_err(){continue;}
                match event {
                    Event::Progress(update)=>progress(update),
                    Event::Finished(work,outcome)=>{
                        let outcome=outcome.and_then(|_|{
                            let failures=download_report(&work.batch).failures.len();
                            let added=append_bulk_images(conn,job,work.id,&work.batch.games[0].images,Some(work.source))?;
                            let message=if failures>0 {crate::i18n::i18n_format!("msg.03050f8b4f",failures=failures)}
                                else if added==0 {crate::i18n::text("msg.cf21d4c4d5").into()}else {String::new()};
                            Ok((added,message))
                        });
                        if job.check().is_err()&&outcome.is_err(){continue;}
                        let (added,message)=outcome.unwrap_or_else(|message|(0,message));
                        let title=work.title;
                        results[work.index]=Some(BulkImageResult{game_id:work.id,title:title.clone(),added,message});
                        processed+=1;
                        progress(job.progress("bulk_images",processed,Some(total),Some(title)));
                    }
                }
            }
        });
    }
    let results:Vec<_>=results.into_iter().flatten().collect();
    Ok(BulkImageReport{image_count:results.iter().map(|r|r.added).sum(),results,cancelled:job.check().is_err()})
}
