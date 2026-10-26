//! Optional portable RetroArch and individual cores from Libretro's official buildbot.
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::ipc::Channel;

type Result<T> = std::result::Result<T, String>;
const BUILDBOT: &str = "https://buildbot.libretro.com";
fn cancelled_message() -> &'static str { crate::i18n::text("msg.637d4e8bdf") }
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    let columns = conn
        .prepare("PRAGMA table_info(emulators)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    if !columns.contains("retroarch_core_path") {
        conn.execute(
            "ALTER TABLE emulators ADD COLUMN retroarch_core_path TEXT",
            [],
        )?;
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS retroarch_settings (id INTEGER PRIMARY KEY CHECK(id=1), executable_path TEXT NOT NULL);")
}

#[derive(Default, Clone)]
pub struct RetroArchJobs(Arc<Mutex<Option<Arc<Job>>>>);
struct Job {
    id: String,
    directory: PathBuf,
    cancelled: AtomicBool,
    gate: Mutex<()>,
    signal: tokio::sync::Notify,
}
struct Operation {
    job: Arc<Job>,
    state: RetroArchJobs,
}
impl RetroArchJobs {
    pub fn busy(&self) -> bool {
        self.0.lock().map(|v| v.is_some()).unwrap_or(true)
    }
    fn start(&self, root: &Path, id: String) -> Result<Operation> {
        if id.is_empty() || id.len() > 100 {
            return Err(crate::i18n::text("msg.46a6c490fa").into());
        }
        let mut state = self.0.lock().map_err(err)?;
        if state.is_some() {
            return Err(crate::i18n::text("msg.aadbdc3f3c").into());
        }
        // Never use the caller's operation identifier as a filesystem path.
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos();
        let directory = root
            .join("metadata/retroarch-staging")
            .join(unique.to_string());
        let job = Arc::new(Job {
            id,
            directory,
            cancelled: AtomicBool::new(false),
            gate: Mutex::new(()),
            signal: tokio::sync::Notify::new(),
        });
        *state = Some(job.clone());
        Ok(Operation {
            job,
            state: self.clone(),
        })
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.job.directory);
        if let Ok(mut state) = self.state.0.lock() {
            if state
                .as_ref()
                .is_some_and(|job| Arc::ptr_eq(job, &self.job))
            {
                *state = None;
            }
        }
    }
}
impl Job {
    fn prepare(&self) -> Result<()> {
        self.check()?;
        fs::create_dir_all(&self.directory).map_err(err)
    }
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(cancelled_message().into())
        } else {
            Ok(())
        }
    }
    fn progress(
        &self,
        channel: &Channel<Progress>,
        phase: &str,
        processed: u64,
        total: Option<u64>,
    ) {
        let _ = channel.send(Progress {
            operation_id: self.id.clone(),
            phase: phase.into(),
            processed,
            total,
        });
    }
}
#[derive(Serialize)]
pub struct Progress {
    operation_id: String,
    phase: String,
    processed: u64,
    total: Option<u64>,
}
#[tauri::command]
pub fn cancel_retroarch_operation(
    operation_id: String,
    jobs: tauri::State<'_, RetroArchJobs>,
) -> Result<()> {
    if let Some(job) = jobs
        .0
        .lock()
        .map_err(err)?
        .as_ref()
        .filter(|job| job.id == operation_id)
        .cloned()
    {
        let _gate = job.gate.lock().map_err(err)?;
        job.cancelled.store(true, Ordering::Release);
        job.signal.notify_one();
    }
    Ok(())
}

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("OpenCabinet/0.1 (RetroArch integration)")
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("Demasiadas redirecciones")
            } else if attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(|host| {
                    host == "buildbot.libretro.com" || host == "raw.libretro.com"
                })
            {
                attempt.follow()
            } else {
                attempt.error(crate::i18n::text("msg.8ee79db4be"))
            }
        }))
        .build()
        .map_err(err)
}
fn download(
    job: &Job,
    url: &str,
    path: &Path,
    limit: u64,
    phase: &str,
    channel: &Channel<Progress>,
) -> Result<()> {
    job.check()?;
    let client = client()?;
    tauri::async_runtime::block_on(async {
        let mut response = tokio::select! {
            _ = job.signal.notified() => return Err(cancelled_message().into()),
            response = client.get(url).send() => response.map_err(|e| crate::i18n::i18n_format!("msg.0b0858210c", e = e))?.error_for_status().map_err(err)?,
        };
        let total = response.content_length();
        if total.is_some_and(|n| n > limit) {
            return Err(crate::i18n::text("msg.2202296dae").into());
        }
        let mut file = File::create(path).map_err(err)?;
        let mut size = 0;
        let mut last = Instant::now();
        job.progress(channel, phase, 0, total);
        loop {
            job.check()?;
            let chunk = tokio::select! {
                _ = job.signal.notified() => return Err(cancelled_message().into()),
                chunk = response.chunk() => chunk.map_err(err)?,
            };
            let Some(bytes) = chunk else {
                break;
            };
            job.check()?;
            size += bytes.len() as u64;
            if size > limit {
                return Err(crate::i18n::text("msg.2202296dae").into());
            }
            file.write_all(&bytes).map_err(err)?;
            if last.elapsed() > Duration::from_millis(120) {
                job.progress(channel, phase, size, total);
                last = Instant::now();
            }
        }
        job.check()?;
        file.sync_all().map_err(err)?;
        job.progress(channel, phase, size, Some(size));
        Ok(())
    })
}
fn valid_core_id(id: &str) -> bool {
    id.ends_with("_libretro")
        && id.len() <= 100
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
fn parse_index(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| {
            line.trim()
                .strip_suffix(".dll.zip")
                .filter(|s| valid_core_id(s))
                .map(str::to_owned)
        })
        .collect()
}
fn settings(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once('=')?;
            let value = value.trim();
            let value = if let Some(value) = value.strip_prefix('"') {
                value.rsplit_once('"')?.0
            } else {
                value.split('#').next()?.trim()
            };
            Some((key.trim().to_owned(), value.replace("\\\"", "\"")))
        })
        .collect()
}
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Core {
    pub id: String,
    pub name: String,
    pub systems: Vec<String>,
    pub description: String,
    pub firmware: Vec<String>,
    pub info: String,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub path: String,
}
fn parse_info(id: &str, text: String) -> Core {
    let values = settings(&text);
    let firmware = (0..values
        .get("firmware_count")
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0)
        .min(100))
        .filter(|n| {
            values
                .get(&format!("firmware{n}_opt"))
                .is_some_and(|s| s == "false")
        })
        .filter_map(|n| values.get(&format!("firmware{n}_desc")).cloned())
        .collect();
    Core {
        id: id.into(),
        name: values
            .get("display_name")
            .cloned()
            .unwrap_or_else(|| id.into()),
        systems: values
            .get("database")
            .or_else(|| values.get("systemname"))
            .map(|s| s.split('|').map(str::to_owned).collect())
            .unwrap_or_default(),
        description: values.get("description").cloned().unwrap_or_default(),
        firmware,
        info: text,
        installed: false,
        path: String::new(),
    }
}
fn parse_catalog(index: &str, archive: &Path) -> Result<Vec<Core>> {
    let available = parse_index(index);
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(err)?).map_err(err)?;
    if zip.len() > 5000 {
        return Err(crate::i18n::text("msg.ee4495dbb1").into());
    }
    let mut cores = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        let Some(id) = entry
            .name()
            .map_err(err)?
            .strip_suffix(".info")
            .filter(|id| available.contains(*id))
            .map(str::to_owned)
        else {
            continue;
        };
        if entry.size() > 128 * 1024 {
            return Err(crate::i18n::text("msg.bedfcfe3ad").into());
        }
        let mut text = String::new();
        entry.read_to_string(&mut text).map_err(err)?;
        cores.push(parse_info(&id, text));
    }
    if cores.is_empty() {
        return Err(
            crate::i18n::text("msg.61c4801214")
                .into(),
        );
    }
    cores.sort_by_key(|core| core.name.to_lowercase());
    Ok(cores)
}
fn machine(path: &Path) -> Result<&'static str> {
    let mut file =
        File::open(path).map_err(|e| crate::i18n::i18n_format!("msg.93cf037b47", path.display(), e = e))?;
    let mut header = [0u8; 64];
    file.read_exact(&mut header).map_err(err)?;
    if &header[..2] != b"MZ" {
        return Err(crate::i18n::text("msg.feaab66bb6").into());
    }
    let offset = u32::from_le_bytes(header[60..64].try_into().unwrap());
    file.seek(SeekFrom::Start(offset as u64)).map_err(err)?;
    let mut pe = [0u8; 6];
    file.read_exact(&mut pe).map_err(err)?;
    if &pe[..4] != b"PE\0\0" {
        return Err(crate::i18n::text("msg.feaab66bb6").into());
    }
    match u16::from_le_bytes([pe[4], pe[5]]) {
        0x8664 => Ok("x86_64"),
        0x14c => Ok("x86"),
        _ => Err(
            crate::i18n::text("msg.f462a37bd9").into(),
        ),
    }
}
fn default_arch() -> &'static str {
    if cfg!(target_pointer_width = "64") {
        "x86_64"
    } else {
        "x86"
    }
}
pub(crate) fn directories(executable: &Path) -> (PathBuf, PathBuf) {
    let parent = executable.parent().unwrap_or(Path::new("."));
    let cfg = fs::read_to_string(parent.join("retroarch.cfg"))
        .map(|s| settings(&s))
        .unwrap_or_default();
    let resolve = |key, fallback| {
        let value = cfg
            .get(key)
            .filter(|s| !s.is_empty() && s.as_str() != "default")
            .map(String::as_str)
            .unwrap_or(fallback);
        if let Some(relative) = value
            .strip_prefix(":/")
            .or_else(|| value.strip_prefix(":\\"))
        {
            parent.join(relative)
        } else if Path::new(value).is_absolute() {
            PathBuf::from(value)
        } else {
            parent.join(value)
        }
    };
    (
        resolve("libretro_directory", "cores"),
        resolve("libretro_info_path", "info"),
    )
}
fn cache_path(root: &Path, arch: &str) -> PathBuf {
    root.join(format!("metadata/retroarch-cores-{arch}.json"))
}
fn catalog(
    root: &Path,
    arch: &str,
    refresh: bool,
    job: &Job,
    channel: &Channel<Progress>,
) -> Result<Vec<Core>> {
    let cache = cache_path(root, arch);
    if !refresh {
        if let Ok(cores) = fs::read(&cache)
            .map_err(err)
            .and_then(|bytes| serde_json::from_slice::<Vec<Core>>(&bytes).map_err(err))
        {
            if !cores.is_empty() && cores.iter().all(|c| valid_core_id(&c.id)) {
                return Ok(cores);
            }
        }
    }
    let index = job.directory.join("cores.index");
    let info = job.directory.join("info.zip");
    download(
        job,
        &format!("{BUILDBOT}/nightly/windows/{arch}/latest/.index"),
        &index,
        1024 * 1024,
        crate::i18n::text("msg.794c2b5030"),
        channel,
    )?;
    download(
        job,
        &format!("{BUILDBOT}/assets/frontend/info.zip"),
        &info,
        16 * 1024 * 1024,
        crate::i18n::text("msg.ddda19fea4"),
        channel,
    )?;
    let cores = parse_catalog(&fs::read_to_string(index).map_err(err)?, &info)?;
    let staged = job.directory.join("catalog.json");
    fs::write(&staged, serde_json::to_vec(&cores).map_err(err)?).map_err(err)?;
    let _gate = job.gate.lock().map_err(err)?;
    job.check()?;
    fs::rename(staged, cache).map_err(err)?;
    Ok(cores)
}
fn executable_setting(conn: &Connection, root: &Path) -> Result<Option<String>> {
    let saved: Option<String> = conn
        .query_row(
            "SELECT executable_path FROM retroarch_settings WHERE id=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if saved.as_ref().is_some_and(|s| Path::new(s).is_file()) {
        return Ok(saved);
    }
    let managed = root.join("emulators/RetroArch/retroarch.exe");
    if managed.is_file() {
        return Ok(Some(managed.to_string_lossy().into_owned()));
    }
    let candidates = conn
        .prepare("SELECT executable_path FROM emulators ORDER BY rowid")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(candidates.into_iter().find(|s| {
        Path::new(s)
            .file_name()
            .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("retroarch.exe"))
            && Path::new(s).is_file()
    }))
}
fn remember(conn: &Connection, executable: &str) -> Result<()> {
    conn.execute("INSERT INTO retroarch_settings VALUES (1,?1) ON CONFLICT(id) DO UPDATE SET executable_path=excluded.executable_path", [executable]).map_err(err)?;
    Ok(())
}
#[derive(Serialize)]
pub struct Status {
    executable_path: Option<String>,
    managed_directory: String,
}
#[tauri::command]
pub async fn get_retroarch_status() -> Result<Status> {
    tauri::async_runtime::spawn_blocking(|| {
        let root = super::data_directory().map_err(err)?;
        let conn = super::get_db_connection().map_err(err)?;
        Ok(Status {
            executable_path: executable_setting(&conn, &root)?,
            managed_directory: root
                .join("emulators/RetroArch")
                .to_string_lossy()
                .into_owned(),
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn get_retroarch_cores(
    executable_path: Option<String>,
    refresh: bool,
    operation_id: String,
    on_progress: Channel<Progress>,
    jobs: tauri::State<'_, RetroArchJobs>,
) -> Result<Vec<Core>> {
    let root = super::data_directory().map_err(err)?;
    let operation = jobs.start(&root, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        operation.job.prepare()?;
        let executable = executable_path
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .map(Path::new);
        let arch = executable
            .map(machine)
            .transpose()?
            .unwrap_or(default_arch());
        let mut cores = catalog(&root, arch, refresh, &operation.job, &on_progress)?;
        if let Some(exe) = executable {
            let (directory, _) = directories(exe);
            for core in &mut cores {
                let path = directory.join(format!("{}.dll", core.id));
                core.installed = path.is_file();
                core.path = path.to_string_lossy().into_owned();
            }
        }
        operation.job.check()?;
        Ok(cores)
    })
    .await
    .map_err(err)?
}

fn safe_relative(name: &str) -> Result<PathBuf> {
    let normalized = name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized.split('/').any(|part| {
            part == ".." || part.contains(':') || part.ends_with('.') || part.ends_with(' ')
        })
    {
        return Err(crate::i18n::text("msg.400b288974").into());
    }
    let path = PathBuf::from(normalized);
    if path.components().any(|c| {
        !matches!(
            c,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    }) {
        return Err(crate::i18n::text("msg.400b288974").into());
    }
    Ok(path)
}
fn latest_version(html: &str) -> Result<String> {
    html.split("href=")
        .skip(1)
        .filter_map(|part| {
            let quote = part.chars().next()?;
            if quote != '\'' && quote != '"' {
                return None;
            }
            let href = part[1..].split(quote).next()?.trim_end_matches('/');
            let value = href.rsplit('/').next()?;
            let numbers = value
                .split('.')
                .map(str::parse::<u32>)
                .collect::<std::result::Result<Vec<_>, _>>()
                .ok()?;
            (numbers.len() == 3).then_some((numbers, value.to_owned()))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, v)| v)
        .ok_or_else(|| "No se pudo encontrar la versión estable de RetroArch.".into())
}
fn extract_portable(
    archive: &Path,
    destination: &Path,
    job: &Job,
    channel: &Channel<Progress>,
) -> Result<PathBuf> {
    let mut reader =
        sevenz_rust::SevenZReader::open(archive, sevenz_rust::Password::empty()).map_err(err)?;
    let total = reader.archive().files.len();
    if total > 100_000 {
        return Err("El paquete tiene demasiados archivos.".into());
    }
    let mut bytes = 0u64;
    let mut count = 0u64;
    let mut executables = Vec::new();
    reader
        .for_each_entries(|entry, source| {
            let mut extract = || -> Result<()> {
                job.check()?;
                let relative = safe_relative(entry.name())?;
                if entry.windows_attributes() & 0x400 != 0 || entry.is_anti_item() {
                    return Err("El paquete contiene un enlace o una entrada no admitida.".into());
                }
                bytes = bytes
                    .checked_add(entry.size())
                    .filter(|n| *n <= 4 * 1024 * 1024 * 1024)
                    .ok_or("El paquete descomprimido supera el límite permitido.")?;
                let path = destination.join(&relative);
                // The portable download must not silently install all available cores.
                let bundled_core = relative
                    .components()
                    .any(|p| p.as_os_str().eq_ignore_ascii_case("cores"))
                    && relative.to_string_lossy().ends_with("_libretro.dll");
                if entry.is_directory() {
                    fs::create_dir_all(&path).map_err(err)?;
                } else if !bundled_core {
                    fs::create_dir_all(path.parent().unwrap()).map_err(err)?;
                    let mut target = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&path)
                        .map_err(err)?;
                    let mut buffer = [0u8; 65536];
                    let mut written = 0;
                    loop {
                        job.check()?;
                        let n = source.read(&mut buffer).map_err(err)?;
                        if n == 0 {
                            break;
                        }
                        written += n as u64;
                        if written > entry.size() {
                            return Err("Tamaño de archivo inválido.".into());
                        }
                        target.write_all(&buffer[..n]).map_err(err)?;
                    }
                    if written != entry.size() {
                        return Err("Archivo incompleto en el paquete.".into());
                    }
                    if path
                        .file_name()
                        .is_some_and(|n| n.eq_ignore_ascii_case("retroarch.exe"))
                    {
                        executables.push(path);
                    }
                } else {
                    std::io::copy(source, &mut std::io::sink()).map_err(err)?;
                }
                count += 1;
                if count % 100 == 0 {
                    job.progress(channel, "Preparando RetroArch", count, Some(total as u64));
                }
                Ok(())
            };
            extract().map(|_| true).map_err(sevenz_rust::Error::other)
        })
        .map_err(err)?;
    if executables.len() != 1 {
        return Err("El paquete no contiene una instalación válida de RetroArch.".into());
    }
    let exe = executables.remove(0);
    machine(&exe)?;
    Ok(exe.parent().unwrap().to_owned())
}
#[tauri::command]
pub async fn install_retroarch(
    operation_id: String,
    on_progress: Channel<Progress>,
    jobs: tauri::State<'_, RetroArchJobs>,
) -> Result<String> {
    let root = super::data_directory().map_err(err)?;
    let operation = jobs.start(&root, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        operation.job.prepare()?;
        let job = &operation.job;
        let target = root.join("emulators/RetroArch");
        if target.exists() { if target.join("retroarch.exe").is_file() { return Ok(target.join("retroarch.exe").to_string_lossy().into_owned()); } return Err("La carpeta de RetroArch ya existe y está incompleta. Selecciona una instalación existente o revisa esa carpeta.".into()); }
        let index = job.directory.join("stable.html");
        download(job, &format!("{BUILDBOT}/stable/"), &index, 2*1024*1024, "Buscando versión estable", &on_progress)?;
        let version = latest_version(&fs::read_to_string(index).map_err(err)?)?;
        let archive = job.directory.join("RetroArch.7z");
        download(job, &format!("{BUILDBOT}/stable/{version}/windows/{}/RetroArch.7z", default_arch()), &archive, 512*1024*1024, "Descargando RetroArch", &on_progress)?;
        let extracted = job.directory.join("portable"); fs::create_dir(&extracted).map_err(err)?;
        let source = extract_portable(&archive, &extracted, job, &on_progress)?;
        if machine(&source.join("retroarch.exe"))? != default_arch() { return Err("El paquete no coincide con la arquitectura solicitada.".into()); }
        let _gate = job.gate.lock().map_err(err)?; job.check()?;
        fs::create_dir_all(target.parent().unwrap()).map_err(err)?;
        fs::rename(source, &target).map_err(err)?;
        let executable = target.join("retroarch.exe").to_string_lossy().into_owned();
        remember(&super::get_db_connection().map_err(err)?, &executable)?;
        Ok(executable)
    }).await.map_err(err)?
}
fn extract_core(archive: &Path, id: &str, destination: &Path, arch: &str, job: &Job) -> Result<()> {
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(err)?).map_err(err)?;
    if zip.len() > 20 {
        return Err("Paquete de núcleo inválido.".into());
    }
    let filename = format!("{id}.dll");
    let mut found = false;
    for i in 0..zip.len() {
        job.check()?;
        let mut entry = zip.by_index(i).map_err(err)?;
        let entry_name = entry.name().map_err(err)?.into_owned();
        safe_relative(&entry_name)?;
        if entry_name != filename {
            continue;
        }
        if found || entry.size() > 512 * 1024 * 1024 {
            return Err("Paquete de núcleo inválido.".into());
        }
        found = true;
        let mut target = File::create(destination).map_err(err)?;
        let mut buffer = [0u8; 65536];
        let mut bytes = 0;
        loop {
            job.check()?;
            let n = entry.read(&mut buffer).map_err(err)?;
            if n == 0 {
                break;
            }
            bytes += n as u64;
            if bytes > 512 * 1024 * 1024 {
                return Err("Núcleo demasiado grande.".into());
            }
            target.write_all(&buffer[..n]).map_err(err)?;
        }
        target.sync_all().map_err(err)?;
    }
    if !found || machine(destination)? != arch {
        return Err(
            "El paquete no contiene el núcleo esperado o su arquitectura es incorrecta.".into(),
        );
    }
    Ok(())
}
#[tauri::command]
pub async fn install_retroarch_core(
    executable_path: String,
    core_id: String,
    operation_id: String,
    on_progress: Channel<Progress>,
    jobs: tauri::State<'_, RetroArchJobs>,
) -> Result<String> {
    let root = super::data_directory().map_err(err)?;
    let operation = jobs.start(&root, operation_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        operation.job.prepare()?;
        if !valid_core_id(&core_id) {
            return Err("Identificador de núcleo inválido.".into());
        }
        let job = &operation.job;
        let executable = Path::new(&executable_path);
        let arch = machine(executable)?;
        let cores = catalog(&root, arch, false, job, &on_progress)?;
        let core = cores
            .iter()
            .find(|c| c.id == core_id)
            .ok_or("El núcleo no está en el catálogo de Libretro. Actualiza la lista.")?;
        let (directory, info_directory) = directories(executable);
        let target = directory.join(format!("{core_id}.dll"));
        if target.is_file() {
            if machine(&target)? != arch {
                return Err(
                    "El núcleo instalado tiene una arquitectura diferente a RetroArch.".into(),
                );
            }
            return Ok(target.to_string_lossy().into_owned());
        }
        let archive = job.directory.join("core.zip");
        download(
            job,
            &format!("{BUILDBOT}/nightly/windows/{arch}/latest/{core_id}.dll.zip"),
            &archive,
            256 * 1024 * 1024,
            "Descargando núcleo",
            &on_progress,
        )?;
        let staged = job.directory.join("core.dll");
        extract_core(&archive, &core_id, &staged, arch, job)?;
        let _gate = job.gate.lock().map_err(err)?;
        job.check()?;
        fs::create_dir_all(&directory)
            .map_err(|e| format!("No se puede escribir en la carpeta de núcleos: {e}"))?;
        fs::create_dir_all(&info_directory).map_err(err)?;
        let info = info_directory.join(format!("{core_id}.info"));
        let mut created_info = false;
        // A .part is next to its destination, so publication is a single rename even on another drive.
        let partial = directory.join(format!(
            ".{core_id}-{}.part",
            job.directory.file_name().unwrap().to_string_lossy()
        ));
        // Persist ownership before copying, including for an external RetroArch
        // that has not yet been registered as an emulator in the library.
        fs::write(job.directory.join("core-partial.json"), serde_json::to_vec(&partial).map_err(err)?).map_err(err)?;
        let result = (|| -> Result<()> {
            fs::copy(&staged, &partial).map_err(err)?;
            if !info.exists() {
                fs::write(&info, &core.info).map_err(err)?;
                created_info = true;
            }
            if target.exists() {
                return Err(
                    "El núcleo fue instalado por otra operación. Vuelve a cargar la lista.".into(),
                );
            }
            fs::rename(&partial, &target).map_err(err)
        })();
        let _ = fs::remove_file(partial);
        if result.is_err() && created_info {
            let _ = fs::remove_file(info);
        }
        result?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(err)?
}

pub fn validate_configuration(executable: &str, arguments: &str, core: Option<&str>) -> Result<()> {
    if let Some(core) = core {
        if core.trim().is_empty() || !Path::new(core).is_absolute() {
            return Err("Selecciona un núcleo instalado de RetroArch.".into());
        }
        let arch = machine(Path::new(executable))?;
        if machine(Path::new(core))? != arch {
            return Err("RetroArch y el núcleo deben ser de la misma arquitectura.".into());
        }
        if super::shlex_split(arguments)
            .iter()
            .any(|s| s == "-L" || s == "--libretro" || s.starts_with("--libretro="))
        {
            return Err("El núcleo se agrega automáticamente. Quita -L / --libretro de los argumentos adicionales.".into());
        }
    }
    Ok(())
}
pub fn remember_configuration(
    conn: &Connection,
    executable: &str,
    core: Option<&str>,
) -> Result<()> {
    if core.is_some() {
        remember(conn, executable)?;
    }
    Ok(())
}
#[cfg(test)]
fn launch_core(conn: &Connection, platform: &str) -> Result<Option<String>> {
    let id = super::platform_details::default_emulator(conn, platform)?.ok_or("No hay un emulador configurado para esta plataforma.")?;
    launch_core_for_emulator(conn, id)
}

pub fn launch_core_for_emulator(conn: &Connection, emulator_id: i64) -> Result<Option<String>> {
    // Old libraries/test fixtures without the optional column retain their original launch behavior.
    let columns = conn
        .prepare("PRAGMA table_info(emulators)")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(err)?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(err)?;
    if !columns.contains("retroarch_core_path") {
        return Ok(None);
    }
    conn.query_row("SELECT retroarch_core_path FROM emulators WHERE rowid=?1", [emulator_id], |r| r.get(0)).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Sandbox(PathBuf);
    impl Sandbox {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "opencabinet-ra-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn operation(&self) -> Operation {
            let operation = RetroArchJobs::default()
                .start(&self.0, "fixture".into())
                .unwrap();
            operation.job.prepare().unwrap();
            operation
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn channel() -> Channel<Progress> {
        Channel::new(|_| Ok(()))
    }
    fn pe(machine: u16) -> Vec<u8> {
        let mut bytes = vec![0u8; 80];
        bytes[..2].copy_from_slice(b"MZ");
        bytes[60..64].copy_from_slice(&64u32.to_le_bytes());
        bytes[64..68].copy_from_slice(b"PE\0\0");
        bytes[68..70].copy_from_slice(&machine.to_le_bytes());
        bytes
    }
    fn archive(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }
    #[test]
    fn catalog_intersects_actual_downloads_and_preserves_multi_system_firmware() {
        let sandbox = Sandbox::new();
        let path = sandbox.0.join("info.zip");
        archive(&path, &[("snes9x_libretro.info", b"display_name = \"Snes9x\"\ndatabase = \"SNES|Sufami Turbo\"\nfirmware_count = 2\nfirmware0_opt = \"false\"\nfirmware0_desc = \"Required.bin\"\nfirmware1_opt = \"true\"\nfirmware1_desc = \"Optional.bin\""), ("absent_libretro.info", b"display_name = \"Unavailable\"")]);
        let cores = parse_catalog(
            "snes9x_libretro.dll.zip\n../evil_libretro.dll.zip\nmissing_libretro.dll.zip\n",
            &path,
        )
        .unwrap();
        assert_eq!(cores.len(), 1);
        assert_eq!(cores[0].systems, ["SNES", "Sufami Turbo"]);
        assert_eq!(cores[0].firmware, ["Required.bin"]);
        assert!(parse_catalog("absent.dll.zip", &path).is_err());
    }
    #[test]
    fn stable_versions_sort_numerically_and_reject_untrusted_components() {
        assert_eq!(latest_version("<a href=\"1.9.9/\">a</a><a href='/stable/1.22.2/'>b</a><a href='1.22.1/'>c</a><a href='nightly/'>x</a>").unwrap(), "1.22.2");
        assert!(latest_version("<html>Service unavailable</html>").is_err());
        for name in [
            "../outside.exe",
            "C:/outside.exe",
            "\\\\server\\share",
            "a/../../b",
            "file.dll:stream",
            "a./file",
        ] {
            assert!(safe_relative(name).is_err(), "{name}");
        }
        assert_eq!(
            safe_relative("RetroArch-Win64/retroarch.exe").unwrap(),
            PathBuf::from("RetroArch-Win64/retroarch.exe")
        );
    }
    #[test]
    fn existing_config_honors_custom_core_and_info_directories() {
        let sandbox = Sandbox::new();
        let exe = sandbox.0.join("retroarch.exe");
        fs::write(
            sandbox.0.join("retroarch.cfg"),
            "libretro_directory = \":/my cores\"\nlibretro_info_path = \"custom info\"\n",
        )
        .unwrap();
        assert_eq!(
            directories(&exe),
            (sandbox.0.join("my cores"), sandbox.0.join("custom info"))
        );
        fs::write(
            sandbox.0.join("retroarch.cfg"),
            "libretro_directory = \"default\"\n",
        )
        .unwrap();
        assert_eq!(directories(&exe).0, sandbox.0.join("cores"));
    }
    #[test]
    fn core_zip_requires_expected_dll_correct_architecture_and_valid_paths() {
        let sandbox = Sandbox::new();
        let operation = sandbox.operation();
        let zip = sandbox.0.join("core.zip");
        let target = sandbox.0.join("core.dll");
        let dll = pe(0x8664);
        archive(&zip, &[("snes9x_libretro.dll", &dll)]);
        extract_core(&zip, "snes9x_libretro", &target, "x86_64", &operation.job).unwrap();
        assert_eq!(fs::read(&target).unwrap(), dll);
        assert!(extract_core(&zip, "snes9x_libretro", &target, "x86", &operation.job).is_err());
        archive(&zip, &[("wrong_libretro.dll", &dll)]);
        assert!(extract_core(&zip, "snes9x_libretro", &target, "x86_64", &operation.job).is_err());
        archive(&zip, &[("../snes9x_libretro.dll", &dll)]);
        assert!(extract_core(&zip, "snes9x_libretro", &target, "x86_64", &operation.job).is_err());
        archive(&zip, &[("snes9x_libretro.dll", b"not a DLL")]);
        assert!(extract_core(&zip, "snes9x_libretro", &target, "x86_64", &operation.job).is_err());
        assert!(
            !sandbox
                .0
                .parent()
                .unwrap()
                .join("snes9x_libretro.dll")
                .exists()
        );
    }
    #[test]
    fn migration_retains_manual_emulators_and_core_configuration_survives_reopening() {
        let sandbox = Sandbox::new();
        let database = sandbox.0.join("library.db");
        let conn = Connection::open(&database).unwrap();
        conn.execute_batch("CREATE TABLE emulators(id INTEGER PRIMARY KEY, name TEXT, platform TEXT, executable_path TEXT, arguments TEXT); INSERT INTO emulators VALUES(1,'RetroArch manual','SNES','retroarch.exe','-L old.dll %ROM%');").unwrap();
        init_schema(&conn).unwrap();
        init_schema(&conn).unwrap();
        assert_eq!(launch_core(&conn, "snes").unwrap(), None);
        conn.execute(
            "UPDATE emulators SET retroarch_core_path=?1 WHERE id=1",
            ["C:/RetroArch/cores/snes9x_libretro.dll"],
        )
        .unwrap();
        remember(&conn, "C:/RetroArch/retroarch.exe").unwrap();
        drop(conn);
        let conn = Connection::open(database).unwrap();
        assert_eq!(
            launch_core(&conn, "SNES").unwrap().unwrap(),
            "C:/RetroArch/cores/snes9x_libretro.dll"
        );
        assert_eq!(
            conn.query_row("SELECT arguments FROM emulators", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "-L old.dll %ROM%"
        );
    }
    #[test]
    fn cancellation_cleans_staging_blocks_work_and_does_not_cancel_later_operations() {
        let sandbox = Sandbox::new();
        let jobs = RetroArchJobs::default();
        let operation = jobs.start(&sandbox.0, "first".into()).unwrap();
        let staging = operation.job.directory.clone();
        operation.job.prepare().unwrap();
        fs::write(staging.join("partial"), b"partial").unwrap();
        assert!(jobs.busy());
        assert!(jobs.start(&sandbox.0, "second".into()).is_err());
        operation.job.cancelled.store(true, Ordering::Release);
        assert_eq!(operation.job.check().unwrap_err(), cancelled_message());
        drop(operation);
        assert!(!staging.exists());
        assert!(!jobs.busy());
        let next = jobs.start(&sandbox.0, "second".into()).unwrap();
        assert!(next.job.check().is_ok());
    }
    #[test]
    fn cached_catalog_is_usable_offline_and_invalid_cache_is_not_silently_accepted() {
        let sandbox = Sandbox::new();
        let operation = sandbox.operation();
        let cache = cache_path(&sandbox.0, "x86_64");
        fs::write(
            &cache,
            serde_json::to_vec(&vec![parse_info(
                "snes9x_libretro",
                "display_name = \"Snes9x\"".into(),
            )])
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            catalog(&sandbox.0, "x86_64", false, &operation.job, &channel()).unwrap()[0].name,
            "Snes9x"
        );
        operation.job.cancelled.store(true, Ordering::Release);
        assert!(catalog(&sandbox.0, "x86_64", true, &operation.job, &channel()).is_err());
        assert_eq!(
            serde_json::from_slice::<Vec<Core>>(&fs::read(&cache).unwrap())
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn automatic_launch_passes_core_and_rom_as_individual_arguments_and_counts_a_session() {
        let sandbox = Sandbox::new();
        let exe = sandbox.0.join("Retro Arch.exe");
        let core = sandbox.0.join("core with spaces.dll");
        fs::write(&exe, pe(0x8664)).unwrap();
        fs::write(&core, pe(0x8664)).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT,play_time INTEGER DEFAULT 0); INSERT INTO games(id,title,platform,rom_path) VALUES(1,'Reviewed title','SNES','C:/Games/Game with spaces.sfc'); CREATE TABLE emulators(id INTEGER PRIMARY KEY,name TEXT,platform TEXT,executable_path TEXT,arguments TEXT);").unwrap();
        super::super::init_game_metadata(&conn).unwrap();
        init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO emulators VALUES(1,'RA','SNES',?1,'%ROM%',?2)",
            (
                exe.to_string_lossy().as_ref(),
                core.to_string_lossy().as_ref(),
            ),
        )
        .unwrap();
        let (result, ()) = super::super::launch_game_record(&conn, 1, |path, args, _| {
            assert_eq!(Path::new(path), exe);
            assert_eq!(
                args,
                [
                    "-L",
                    core.to_str().unwrap(),
                    "C:/Games/Game with spaces.sfc"
                ]
            );
            Ok(())
        })
        .unwrap();
        assert_eq!(result.stats.session_count, 1);
        assert!(
            validate_configuration(
                exe.to_str().unwrap(),
                "-L old.dll %ROM%",
                Some(core.to_str().unwrap())
            )
            .is_err()
        );
        fs::write(&core, pe(0x14c)).unwrap();
        assert!(
            validate_configuration(exe.to_str().unwrap(), "%ROM%", Some(core.to_str().unwrap()))
                .is_err()
        );
    }
    #[test]
    fn mocked_download_rejects_http_errors_and_over_size_payloads() {
        use std::net::TcpListener;
        for (status, body, limit) in [
            ("503 Service Unavailable", b"down".as_slice(), 100),
            ("200 OK", b"oversize".as_slice(), 2),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/fixture", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 4096];
                let _ = socket.read(&mut request);
                let _ = write!(
                    socket,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(body);
            });
            let sandbox = Sandbox::new();
            let operation = sandbox.operation();
            assert!(
                download(
                    &operation.job,
                    &url,
                    &operation.job.directory.join("download"),
                    limit,
                    "Fixture",
                    &channel()
                )
                .is_err()
            );
            server.join().unwrap();
        }
    }
    #[test]
    #[ignore = "Uses previously downloaded official catalog fixtures from OPENCABINET_RETROARCH_FIXTURES"]
    fn real_libretro_catalog_smoke() {
        let root = PathBuf::from(
            std::env::var("OPENCABINET_RETROARCH_FIXTURES")
                .expect("Set OPENCABINET_RETROARCH_FIXTURES"),
        );
        let cores = parse_catalog(
            &fs::read_to_string(root.join("retroarch-cores.index")).unwrap(),
            &root.join("retroarch-info.zip"),
        )
        .unwrap();
        assert!(
            cores.iter().any(|c| c.id == "snes9x_libretro"
                && c.systems.iter().any(|s| s.contains("Super Nintendo")))
        );
        println!(
            "{} official downloadable cores, SNES metadata verified",
            cores.len()
        );
    }
    #[test]
    #[ignore = "Downloads and extracts official portable RetroArch and one core; no executables are run"]
    fn real_portable_and_core_download_smoke() {
        let sandbox = Sandbox::new();
        let operation = sandbox.operation();
        let job = &operation.job;
        let index = job.directory.join("index.html");
        download(
            job,
            &format!("{BUILDBOT}/stable/"),
            &index,
            2 * 1024 * 1024,
            "Index",
            &channel(),
        )
        .unwrap();
        let version = latest_version(&fs::read_to_string(index).unwrap()).unwrap();
        let archive = job.directory.join("RetroArch.7z");
        download(
            job,
            &format!(
                "{BUILDBOT}/stable/{version}/windows/{}/RetroArch.7z",
                default_arch()
            ),
            &archive,
            512 * 1024 * 1024,
            "RetroArch",
            &channel(),
        )
        .unwrap();
        let destination = job.directory.join("extracted");
        fs::create_dir(&destination).unwrap();
        let installation = extract_portable(&archive, &destination, job, &channel()).unwrap();
        assert_eq!(
            machine(&installation.join("retroarch.exe")).unwrap(),
            default_arch()
        );
        let core = job.directory.join("core.zip");
        download(
            job,
            &format!(
                "{BUILDBOT}/nightly/windows/{}/latest/snes9x_libretro.dll.zip",
                default_arch()
            ),
            &core,
            256 * 1024 * 1024,
            "Snes9x",
            &channel(),
        )
        .unwrap();
        let dll = job.directory.join("snes9x.dll");
        extract_core(&core, "snes9x_libretro", &dll, default_arch(), job).unwrap();
        println!(
            "Official RetroArch {version} portable and Snes9x extracted and validated successfully"
        );
    }
}
