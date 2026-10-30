//! Signed updates from the configured release feed. Nothing is installed without a user action.
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};
use tauri::{ipc::Channel, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct AppUpdates {
    busy: AtomicBool,
    available: Mutex<Option<Update>>,
}

struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl AppUpdates {
    fn begin(&self) -> Result<Operation<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| crate::i18n::text("update.busy").to_owned())?;
        Ok(Operation(&self.busy))
    }
}

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: String,
    install_allowed: bool,
    install_unavailable_reason: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn supported_install() -> bool {
    if cfg!(debug_assertions) {return false;}
    if cfg!(all(windows,target_arch="x86_64")){return true;}
    if cfg!(all(target_os="linux",target_arch="x86_64")) {
        return std::env::var_os("APPIMAGE").map(std::path::PathBuf::from).is_some_and(|path|appimage_writable(&path));
    }
    false
}

fn appimage_writable(path:&std::path::Path)->bool {
    let Ok(path)=path.canonicalize()else{return false};
    if !path.is_file(){return false;}
    let Some(parent)=path.parent()else{return false};
    // An executing AppImage may reject opening its ELF for writing (ETXTBSY).
    // The updater replaces it through its parent directory instead.
    let token=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let probe=parent.join(format!(".opencabinet-update-probe-{}-{token}",std::process::id()));
    let Ok(file)=std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)else{return false};
    drop(file);std::fs::remove_file(probe).is_ok()
}

fn ensure_idle(app: &tauri::AppHandle) -> Result<(), String> {
    if crate::backups::busy() || app.state::<crate::PlayTracker>().has_active_sessions()
        || app
            .state::<crate::metadata::MetadataJobs>()
            .has_active_job()
        || app.state::<crate::retroarch::RetroArchJobs>().busy()
        || crate::storage::has_pending_directory()?
    {
        return Err(crate::i18n::text("update.finishTasks").into());
    }
    Ok(())
}

#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdates>,
) -> Result<Option<UpdateInfo>, String> {
    let _operation = state.begin()?;
    // Drop a stale offer if this check fails. Never accept update URLs or signatures from the UI.
    *state.available.lock().map_err(|e| e.to_string())? = None;
    let builder = app.updater_builder().timeout(Duration::from_secs(120));
    #[cfg(windows)]
    let builder = {
        // NSIS requires /D to be the last argument, without quotes, including for paths with spaces.
        // Update in place so portable data and the data-directory bootstrap stay beside the executable.
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let directory = exe
            .parent()
            .ok_or_else(|| crate::i18n::text("update.releaseOnly").to_owned())?;
        builder.installer_arg(format!("/D={}", directory.display()))
    };
    let update = builder
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("{} {e}", crate::i18n::text("update.checkFailed")))?;
    let info = update.as_ref().map(|update| UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        install_allowed: supported_install(),
        install_unavailable_reason: if cfg!(target_os="linux")&&!cfg!(debug_assertions)&&!supported_install(){Some(crate::i18n::text("linux.updateReadOnly").into())}else{None},
    });
    *state.available.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppUpdates>,
    version: String,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    let _operation = state.begin()?;
    if !supported_install() {
        if cfg!(target_os="linux")&&!cfg!(debug_assertions){return Err(crate::i18n::text("linux.updateReadOnly").into());}
        return Err(crate::i18n::text("update.releaseOnly").into());
    }
    ensure_idle(&app)?;
    let update = state
        .available
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .filter(|update| update.version == version)
        .cloned()
        .ok_or_else(|| crate::i18n::text("update.checkAgain").to_owned())?;
    let mut downloaded = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    let bytes = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                if last.elapsed() >= Duration::from_millis(100) {
                    let _ = on_progress.send(Progress {
                        phase: "downloading",
                        downloaded,
                        total,
                    });
                    last = Instant::now();
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("{} {e}", crate::i18n::text("update.downloadFailed")))?;
    // Download verifies the signature; install verifies it again. Interrupted downloads stay in RAM.
    ensure_idle(&app)?;
    tauri::async_runtime::spawn_blocking(crate::backups::safety_snapshot)
        .await.map_err(|e| e.to_string())??;
    ensure_idle(&app)?;
    on_progress
        .send(Progress {
            phase: "installing",
            downloaded: bytes.len() as u64,
            total: Some(bytes.len() as u64),
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{} {e}", crate::i18n::text("update.installFailed")))?;
    // The Windows plugin exits only after successfully launching the installer, which restarts the app.
    #[cfg(target_os="linux")]
    app.restart();
    #[cfg(not(target_os="linux"))]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_operations_fail_and_errors_release_the_guard() {
        let state = AppUpdates::default();
        let first = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(first);
        assert!(state.begin().is_ok());
    }
    #[cfg(target_os="linux")]
    #[test]
    fn running_appimage_can_be_replaced_without_opening_its_executable_for_writing(){
        let root=std::env::temp_dir().join(format!("opencabinet-update-test-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();let path=root.join("Test.AppImage");std::fs::copy("/bin/sleep",&path).unwrap();
        let mut child=std::process::Command::new(&path).arg("5").spawn().unwrap();
        let allowed=appimage_writable(&path);child.kill().unwrap();child.wait().unwrap();
        assert!(allowed);assert_eq!(std::fs::read_dir(&root).unwrap().count(),1);std::fs::remove_file(path).unwrap();std::fs::remove_dir(root).unwrap();
    }
}
