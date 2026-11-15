//! A separate, non-activating overlay: never resize or pin the library window.
//! Window readiness is a heuristic, not a claim that an emulator finished loading.
use serde::{Deserialize, Serialize};
use std::{sync::{Arc, Mutex}, time::{Duration, Instant}};
use tauri::{Emitter, Manager};

const LABEL: &str = "launch-screen";
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Settings {
    enabled: bool, use_theme_color: bool, color: String, use_background: bool,
    mode: String, seconds: f64, timeout_seconds: f64,
}
impl Settings {
    pub fn valid(&self) -> bool {
        matches!(self.mode.as_str(),"auto"|"fixed") && valid_color(&self.color)
            && self.seconds.is_finite() && (1.0..=120.0).contains(&self.seconds)
            && self.timeout_seconds.is_finite() && (1.0..=120.0).contains(&self.timeout_seconds)
    }
    fn limit(&self) -> Duration {
        Duration::from_secs_f64(if self.mode=="fixed" {self.seconds} else {self.timeout_seconds})
    }
}
fn valid_color(color:&str)->bool { color.len()==7&&color.starts_with('#')&&color[1..].bytes().all(|c|c.is_ascii_hexdigit()) }
#[derive(Clone, Deserialize, Serialize)]
pub struct Presentation {
    title:String, logo:Option<String>, background:Option<String>, media:Option<String>, spinning:bool,
    color:String, loading:String, dismiss:String, settings:Settings,
}
#[derive(Clone, Serialize)]
pub struct View { id:String, presentation:Presentation }
struct Session { view:View, rendered:bool, requested:Instant, spawned:Option<Instant>, process:Option<u32>, external:bool }
#[derive(Default, Clone)]
pub struct LaunchScreen(Arc<Mutex<Option<Session>>>);

#[tauri::command]
pub async fn show_launch_screen(app:tauri::AppHandle, presentation:Presentation) -> Result<String,String> {
    if !presentation.settings.valid()||!valid_color(&presentation.color) {return Err("Invalid launch screen settings".into());}
    let id=format!("{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let state=app.state::<LaunchScreen>().inner().clone();
    {
        let mut current=state.0.lock().map_err(|e|e.to_string())?;
        if current.is_some(){return Err(crate::i18n::text("launchScreen.busy").into());}
        *current=Some(Session{view:View{id:id.clone(),presentation:presentation.clone()},rendered:false,
            requested:Instant::now(),spawned:None,process:None,external:false});
    }
    let result=(||->Result<(),String>{
        // Limit the asset scope to specific local files, including externally stored images.
        for path in [&presentation.logo,&presentation.background,&presentation.media].into_iter().flatten() {
            if std::path::Path::new(path).is_absolute() {app.asset_protocol_scope().allow_file(path).map_err(|e|e.to_string())?;}
        }
        if app.get_webview_window(LABEL).is_none() {
            let mut builder=tauri::WebviewWindowBuilder::new(&app,LABEL,tauri::WebviewUrl::App("launch-screen.html".into()))
                .title("OpenCabinet").decorations(false).resizable(false).skip_taskbar(true)
                .focused(false).always_on_top(true).visible(false);
            if let Some(monitor)=app.get_webview_window("main").and_then(|w|w.current_monitor().ok().flatten()) {
                let scale=monitor.scale_factor();let pos=monitor.position();let size=monitor.size();
                builder=builder.position(pos.x as f64/scale,pos.y as f64/scale)
                    .inner_size(size.width as f64/scale,size.height as f64/scale);
            }
            builder.fullscreen(true).build().map_err(|e|e.to_string())?;
        } else if let Some(window)=app.get_webview_window(LABEL) {
            if let Some(monitor)=app.get_webview_window("main").and_then(|w|w.current_monitor().ok().flatten()) {
                // Reposition the hidden overlay if the library moved monitors since last launch.
                window.set_fullscreen(false).map_err(|e|e.to_string())?;
                window.set_position(*monitor.position()).map_err(|e|e.to_string())?;
                window.set_fullscreen(true).map_err(|e|e.to_string())?;
            }
        }
        app.emit_to(LABEL,"launch-screen-changed",()).map_err(|e|e.to_string())?;
        Ok(())
    })();
    if let Err(error)=result {finish(&app,&id);return Err(error);}
    let ready_state=state.clone();let ready_id=id.clone();
    let rendered=tauri::async_runtime::spawn_blocking(move || {
        // Never hold the main launch hostage to a broken or slow webview.
        for _ in 0..100 {
            let status=ready_state.0.lock().ok().and_then(|s|s.as_ref().filter(|s|s.view.id==ready_id).map(|s|s.rendered));
            match status {Some(true)=>return true,None=>return false,_=>std::thread::sleep(Duration::from_millis(20))}
        }
        false
    }).await.map_err(|e|e.to_string())?;
    if !rendered {finish(&app,&id);return Err("Launch screen did not become ready".into());}
    let watch_app=app.clone();let watch_id=id.clone();
    tauri::async_runtime::spawn_blocking(move||watch(watch_app,state,watch_id));
    Ok(id)
}

#[tauri::command]
pub fn launch_screen_presentation(window:tauri::WebviewWindow, state:tauri::State<'_,LaunchScreen>) -> Option<View> {
    if window.label()!=LABEL {return None;}
    state.0.lock().ok()?.as_ref().map(|s|s.view.clone())
}
#[tauri::command]
pub async fn launch_screen_rendered(app:tauri::AppHandle, window:tauri::WebviewWindow, id:String) -> Result<(),String> {
    if window.label()!=LABEL {return Err("Invalid launch screen window".into());}
    let main=app.clone();
    app.run_on_main_thread(move||{
        let state=main.state::<LaunchScreen>();let Ok(mut guard)=state.0.lock() else{return};
        if let Some(session)=guard.as_mut().filter(|s|s.view.id==id) {
            let _=window.set_always_on_top(true);
            session.rendered=window.show().is_ok();
        }
    }).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn dismiss_launch_screen(app:tauri::AppHandle,id:String) {finish(&app,&id);}
fn finish(app:&tauri::AppHandle,id:&str) {
    let main=app.clone();let id=id.to_owned();
    // Serialize native changes on the UI thread. Never hold a mutex on a worker
    // while waiting for that thread: another IPC request could need the same lock.
    let _=app.run_on_main_thread(move||{
        let state=main.state::<LaunchScreen>();let Ok(mut current)=state.0.lock() else{return};
        if current.as_ref().is_none_or(|s|s.view.id!=id){return;}
        if let Some(window)=main.get_webview_window(LABEL) {let _=window.hide();let _=window.set_always_on_top(false);}
        *current=None;
        let _=main.emit_to("main","launch-screen-closed",id);
    });
}
pub fn spawned(app:&tauri::AppHandle,id:Option<&str>,pid:u32,external:bool) {
    let Some(id)=id else{return};let state=app.state::<LaunchScreen>();
    if let Ok(mut current)=state.0.lock() {
        if let Some(session)=current.as_mut().filter(|s|s.view.id==id) {
            session.spawned=Some(Instant::now());session.process=Some(pid);session.external=external;
        }
    }
}
pub fn ended(app:&tauri::AppHandle,id:Option<&str>) {if let Some(id)=id{finish(app,id);}}
pub fn dismiss_current(app:&tauri::AppHandle) {
    let id=app.state::<LaunchScreen>().0.lock().ok().and_then(|s|s.as_ref().map(|s|s.view.id.clone()));
    if let Some(id)=id{finish(app,&id);}
}

// Require one stable, visible, responding window; ignore tool windows and
// transient splash-sized surfaces. No portable API reveals "game finished loading".
#[derive(Default)]
struct Readiness { candidate:Option<(u64,Instant)> }
impl Readiness {
    fn ready(&mut self,window:Option<u64>,now:Instant)->bool {
        match (self.candidate,window) {
            (Some((old,since)),Some(id)) if old==id=>now.duration_since(since)>=Duration::from_millis(1200),
            (_,Some(id))=>{self.candidate=Some((id,now));false},
            (_,None)=>{self.candidate=None;false}
        }
    }
}
fn watch(app:tauri::AppHandle,state:LaunchScreen,id:String) {
    let mut probe=super::launch_window_probe::Probe::new();let mut readiness=Readiness::default();
    loop {
        std::thread::sleep(Duration::from_millis(200));
        let snapshot=state.0.lock().ok().and_then(|s|s.as_ref().filter(|s|s.view.id==id)
            .map(|s|(s.spawned,s.process,s.external,s.view.presentation.settings.clone(),s.requested)));
        let Some((start,pid,external,settings,requested))=snapshot else{return};
        let close=if let Some(start)=start {
            start.elapsed()>=settings.limit() || (settings.mode=="auto" && !external
                && readiness.ready(pid.and_then(|pid|probe.window(pid)),Instant::now()))
        } else {requested.elapsed()>=Duration::from_secs(120)};
        if close {finish(&app,&id);return;}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_a_stable_window_and_resets_after_splashes_or_disappearance() {
        let now=Instant::now();let mut state=Readiness::default();
        assert!(!state.ready(None,now));assert!(!state.ready(Some(1),now));
        assert!(!state.ready(Some(2),now+Duration::from_secs(1)));
        assert!(!state.ready(None,now+Duration::from_secs(2)));
        assert!(!state.ready(Some(2),now+Duration::from_secs(3)));
        assert!(!state.ready(Some(2),now+Duration::from_millis(4199)));
        assert!(state.ready(Some(2),now+Duration::from_millis(4200)));
    }
    #[test]
    fn validates_bounded_times_and_uses_the_selected_timer() {
        let mut settings:Settings=serde_json::from_value(serde_json::json!({"enabled":true,"useThemeColor":true,
            "color":"#14161e","useBackground":true,"mode":"auto","seconds":8,"timeoutSeconds":5})).unwrap();
        assert!(settings.valid());assert_eq!(settings.limit(),Duration::from_secs(5));
        settings.mode="fixed".into();assert_eq!(settings.limit(),Duration::from_secs(8));
        settings.seconds=f64::NAN;assert!(!settings.valid());settings.seconds=121.0;assert!(!settings.valid());
        assert!(!valid_color("red;script"));
    }
}
