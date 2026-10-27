//! Platform images are published on the public website, not in Metadata.zip.
use super::*;

const SITE: &str = crate::catalog_compat::SITE;
pub(super) const PLATFORM_IMAGES: &str = crate::catalog_compat::PLATFORM_IMAGE_BASE;
const MAX_PAGE: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(super) struct WebPlatform {
    pub(super) name: String,
    pub(super) slug: String,
}

pub(super) struct PlatformImport {
    id: i32,
    source: String,
    batch: Option<StagedBatch>,
    error: Option<String>,
}

// Only attributes and short text of known tags are used; scripts are never executed.
fn tags(html: &str) -> impl Iterator<Item = (&str, HashMap<String, String>, &str)> {
    html.split('<').skip(1).filter_map(|part| {
        let (content, text) = part.split_once('>')?;
        let name = content.split_whitespace().next()?.trim_end_matches('/');
        let element = quick_xml::events::BytesStart::from_content(content, name.len());
        let attrs = element
            .html_attributes()
            .flatten()
            .filter_map(|attr| {
                let key = std::str::from_utf8(attr.key.as_ref())
                    .ok()?
                    .to_ascii_lowercase();
                let value = attr.unescape_value().ok()?.into_owned();
                Some((key, value))
            })
            .collect();
        Some((name, attrs, text))
    })
}

fn valid_slug(slug: &str) -> bool {
    slug.split('-')
        .next()
        .is_some_and(|id| id.parse::<u32>().is_ok())
        && slug
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

pub(super) fn parse_index(html: &str) -> Vec<WebPlatform> {
    let mut result = Vec::new();
    let mut slug: Option<String> = None;
    let mut name = None;
    for (tag, attrs, text) in tags(html) {
        match tag {
            "a" => {
                slug = attrs
                    .get("href")
                    .and_then(|href| href.strip_prefix("/platforms/games/"))
                    .filter(|value| valid_slug(value))
                    .map(str::to_owned);
                name = None;
            }
            "img" if slug.is_some() => {
                name = attrs.get("alt").cloned().filter(|s| !s.trim().is_empty());
            }
            "h5" if slug.is_some() && name.is_none() => {
                name = quick_xml::escape::unescape(text.trim())
                    .ok()
                    .map(|s| s.into_owned());
            }
            "/a" => {
                if let (Some(slug), Some(name)) = (slug.take(), name.take()) {
                    result.push(WebPlatform { name, slug });
                }
            }
            _ => (),
        }
    }
    result
}

pub(super) fn parse_images(html: &str) -> Vec<CatalogImage> {
    let mut images = Vec::new();
    let mut seen = HashSet::new();
    for (tag, attrs, _) in tags(html) {
        if tag != "a" || !attrs.contains_key("data-platformimageid") {
            continue;
        }
        let Some(url) = attrs
            .get("href")
            .and_then(|value| reqwest::Url::parse(value).ok())
        else {
            continue;
        };
        if url.scheme() != "https"
            || url.host_str() != Some(crate::catalog_compat::IMAGE_HOST)
            || url.query().is_some()
            || url.fragment().is_some()
        {
            continue;
        }
        let mut path = url.path().trim_start_matches('/').split('/');
        if !path
            .next()
            .is_some_and(|part| part.eq_ignore_ascii_case("Platforms"))
        {
            continue;
        }
        let Some(filename) = path.next().filter(|name| safe_image_name(name)) else {
            continue;
        };
        if path.next().is_some() || !seen.insert(filename.to_owned()) {
            continue;
        }
        let title = attrs
            .get("data-title")
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        let kind = if title.contains("logo") {
            "logo"
        } else if title.contains("device") || title.contains("hardware") {
            "screenshot"
        } else if title.contains("fanart") || title.contains("banner") || title.contains("artwork")
        {
            "artwork"
        } else {
            "other"
        };
        images.push(CatalogImage {
            filename: filename.to_owned(),
            kind: kind.into(),
            region: "World".into(),
            crc: String::new(),
        });
    }
    images
}

fn page(job: &ImportJob, client: &reqwest::Client, url: &str, filename: &str) -> Result<String> {
    let path = job.directory.join(filename);
    download(client, url, &path, MAX_PAGE, job, |_, _| ())?;
    fs::read_to_string(path).map_err(err)
}

fn web_platform(
    job: &ImportJob,
    client: &reqwest::Client,
    source: &str,
    site: &str,
) -> Result<WebPlatform> {
    let cache = job.root.join("metadata/platform-web-index.json");
    if fs::metadata(&cache)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.elapsed().ok())
        .is_some_and(|age| age < Duration::from_secs(86400))
    {
        if let Ok(values) = fs::read(&cache)
            .map_err(err)
            .and_then(|bytes| serde_json::from_slice::<Vec<WebPlatform>>(&bytes).map_err(err))
        {
            if let Some(platform) = values.into_iter().find(|value| {
                normalize(&value.name) == normalize(source) && valid_slug(&value.slug)
            }) {
                return Ok(platform);
            }
        }
    }
    let first = page(job, client, site, "platform-index.html")?;
    let page_count = first
        .split("pages:")
        .nth(1)
        .and_then(|value| {
            value
                .trim_start()
                .split(|ch: char| !ch.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1)
        .min(10);
    let mut values = parse_index(&first);
    for number in 2..=page_count {
        values.extend(parse_index(&page(
            job,
            client,
            &format!("{site}page/{number}"),
            "platform-index-next.html",
        )?));
    }
    if values.is_empty() {
        return Err(
            crate::i18n::text("msg.ec2091b495").into(),
        );
    }
    let _ = fs::write(cache, serde_json::to_vec(&values).map_err(err)?);
    values
        .into_iter()
        .find(|value| normalize(&value.name) == normalize(source))
        .ok_or_else(|| crate::i18n::text("msg.77d913ff22").into())
}

pub(super) fn prepare(
    job: &ImportJob,
    source: &str,
    options: &MediaOptions,
    site: &str,
) -> Result<StagedBatch> {
    prepare_with_counts(job, source, options, site).map(|(batch, _)| batch)
}

fn available_images(job: &ImportJob, source: &str, site: &str) -> Result<Vec<CatalogImage>> {
    let client = http_client()?;
    let available = if !job.personal_catalog && site == SITE {
        repository::console_images(job, source)?
    } else {
        let platform = web_platform(job, &client, source, site)?;
        let html = page(
            job,
            &client,
            &format!("{site}platforms/images/{}", platform.slug),
            "platform-images.html",
        )?;
        let available = parse_images(&html);
        if available.is_empty() && !html.contains("image-list") {
            return Err(crate::i18n::text("msg.6ff1f98397").into());
        }
        available
    };
    Ok(available)
}

fn image_counts(images: &[CatalogImage]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for image in images { *counts.entry(image.kind.clone()).or_insert(0) += 1; }
    counts
}

#[tauri::command]
pub async fn get_platform_image_types(
    job_id: String, source_platform: String, on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<HashMap<String, usize>> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        let _ = on_progress.send(job.progress("platform_images", 0, None, Some(source_platform.clone())));
        let images = available_images(&job, &source_platform, SITE)?;
        job.check()?;
        Ok(image_counts(&images))
    }).await.map_err(err)?
}

fn prepare_with_counts(
    job: &ImportJob,
    source: &str,
    options: &MediaOptions,
    site: &str,
) -> Result<(StagedBatch, HashMap<String, usize>)> {
    options.validate()?;
    let available = available_images(job, source, site)?;
    let counts = image_counts(&available);
    // Console entries have stable source identities. Two identical SVG files
    // may serve different markings, so retain each selected catalog entry.
    let mut available=available;
    if !job.personal_catalog && site==SITE {for image in &mut available {image.crc.clear();}}
    let images = select_images(available, options, "");
    static NEXT_BATCH: AtomicUsize = AtomicUsize::new(0);
    let directory = job.directory.join(format!(
        "platform-images-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_nanos(),
        NEXT_BATCH.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory).map_err(err)?;
    let tasks = images
        .into_iter()
        .map(|image| DownloadTask {
            game_index: 0,
            path: directory.join(&image.filename),
            image,
            failure: None,
            done: false,
        })
        .collect();
    Ok((
        StagedBatch {
            preview: ScanPreview {
                games: vec![],
                total_found: 0,
                skipped_count: 0,
            },
            platform: source.into(),
            games: vec![PreparedGame {
                media_collection_id: None,
                candidate: RomCandidate { launch_directly: false, discs: Vec::new(), existing_game_id: None,
                    steam: None, epic: None,
                    title: crate::i18n::i18n_format!("msg.cfa8c71e2b", source = source),
                    rom_path: String::new(),
                },
                metadata: None,
                images: vec![],
            }],
            tasks,
        },
        counts,
    ))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PlatformMetadata {
    pub name: String,
    pub release_date: Option<String>,
    pub developer: Option<String>,
    pub manufacturer: Option<String>,
}

#[cfg(test)]
pub(super) fn catalog_has_platform_metadata(path: &Path) -> bool {
    open_catalog(path).and_then(|conn| conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='platform_metadata')", [], |row| row.get::<_,bool>(0),
    ).map_err(err)).unwrap_or(false)
}

#[cfg(test)]
pub(super) fn ensure_platform_metadata(
    job: &ImportJob,
    url: &str,
    mut progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    if !catalog_has_platform_metadata(&job.catalog_path()) {
        prepare_catalog(job, true, url, &mut progress)?;
    }
    job.check()
}

pub(super) fn platform_metadata(catalog: &Connection, source: &str) -> Result<PlatformMetadata> {
    if repository::is_repository_catalog(catalog) {
        let json:String=catalog.query_row("SELECT details FROM repository_console_metadata WHERE name=?1",[source],|r|r.get(0)).map_err(err)?;
        let values:serde_json::Value=serde_json::from_str(&json).map_err(err)?;
        let language=crate::i18n::locale().split('-').next().unwrap_or("en");
        return serde_json::from_value(values.get(language).unwrap_or(&values["en"]).clone()).map_err(err);
    }
    catalog.query_row("SELECT name,release_date,developer,manufacturer FROM platform_metadata WHERE name=?1", [source], |row| Ok(PlatformMetadata {
        name: row.get(0)?, release_date: row.get(1)?, developer: row.get(2)?, manufacturer: row.get(3)?,
    })).optional().map_err(err)?.ok_or_else(|| crate::i18n::text("msg.5c8018aaa8").into())
}

#[tauri::command]
pub async fn get_catalog_platform_metadata(
    job_id: String,
    source_platform: String,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
) -> Result<PlatformMetadata> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        // Older catalogs stored only platform names. Rebuild atomically once;
        // a failed download preserves the usable games catalog and local library.
        repository::prepare(&job,false, |value| {
            on_progress.send(value).ok();
        })?;
        repository::ensure_platform(&job,&source_platform,|value|{let _=on_progress.send(value);})?;
        platform_metadata(&open_catalog(&job.catalog_path())?, &source_platform)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct PlatformImageReport {
    #[serde(flatten)]
    report: EditorImageReport,
    published_counts: HashMap<String, usize>,
    already_present_count: usize,
    kept_logo: bool,
}

fn options() -> MediaOptions {
    MediaOptions {
        cover: 0,
        logo: 1,
        screenshot: 3,
        title_screen: 0,
        back_cover: 0,
        spine: 0,
        artwork: 0,
        other: 0,
        ..Default::default()
    }
}

pub(super) fn prepare_auto(
    conn: &Connection,
    platform: &str,
    source: &str,
) -> Result<Option<PlatformImport>> {
    let first: bool = conn
        .query_row(
            "SELECT NOT EXISTS(SELECT 1 FROM games WHERE LOWER(platform)=LOWER(?1))",
            [platform],
            |r| r.get(0),
        )
        .map_err(err)?;
    if !first {
        return Ok(None);
    }
    let id = conn
        .query_row(
            "SELECT id FROM platforms WHERE LOWER(name)=LOWER(?1)",
            [platform],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(Some(PlatformImport {
        id,
        source: source.into(),
        batch: None,
        error: None,
    }))
}

pub(super) fn download_auto(
    job: &ImportJob,
    report: &mut DownloadReport,
    progress: impl FnMut(MetadataProgress),
) -> Result<()> {
    download_auto_from(job, report, progress, SITE, PLATFORM_IMAGES)
}

pub(super) fn download_auto_from(
    job: &ImportJob,
    report: &mut DownloadReport,
    mut progress: impl FnMut(MetadataProgress),
    site: &str,
    image_base: &str,
) -> Result<()> {
    let mut state = job.platform_import.lock().map_err(err)?;
    let Some(platform) = state.as_mut() else {
        return Ok(());
    };
    progress(job.progress("platform_images", 0, None, Some(platform.source.clone())));
    let outcome = (|| {
        if platform.batch.is_none() {
            platform.batch = Some(prepare(job, &platform.source, &options(), site)?);
        }
        let batch = platform.batch.as_mut().unwrap();
        download_batch(batch, job, image_base, |mut value| {
            value.phase = "platform_images";
            progress(value);
        })
    })();
    job.check()?;
    platform.error = None;
    match outcome {
        Ok(result) => {
            report.image_count += result.image_count;
            report.failures.extend(result.failures);
        }
        Err(message) => {
            platform.error = Some(message.clone());
            report.failures.push(ImageFailure {
                title: crate::i18n::i18n_format!("msg.492f1b00a5", platform.source),
                kind: "other".into(),
                message,
            });
        }
    }
    Ok(())
}

pub(super) fn commit_auto(
    conn: &Connection,
    job: &ImportJob,
    copies: &mut super::super::PendingImageCopies,
    summary: &mut ImportSummary,
) -> Result<()> {
    let state = job.platform_import.lock().map_err(err)?;
    let Some(platform) = state.as_ref() else {
        return Ok(());
    };
    if platform.error.is_some() {
        summary.failed_image_count += 1;
    }
    let Some(batch) = platform.batch.as_ref() else {
        return Ok(());
    };
    super::super::platform_details::init_schema(conn).map_err(err)?;
    let mut existing = super::super::platform_details::read(conn, platform.id, &job.root)?.images;
    let mut position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM platform_images WHERE platform_id=?1",
            [platform.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    for (index, image) in batch.games[0].images.iter().enumerate() {
        job.check()?;
        if image.kind == "logo" && existing.iter().any(|old| old.kind == "logo")
            || existing
                .iter()
                .any(|old| identical_images(Path::new(&old.path), Path::new(&image.path)))
        {
            continue;
        }
        let extension = super::super::image_extension(Path::new(&image.path))?;
        let filename=repository::retained_console_filename(Path::new(&image.path))
            .map(|name|format!("catalog-{}-{index}-{name}",job.id))
            .unwrap_or_else(||format!("catalog-{}-{index}.{extension}",job.id));
        let relative=format!("images/platforms/{}/{filename}",platform.id);
        let destination = job.root.join(&relative);
        fs::create_dir_all(destination.parent().unwrap()).map_err(err)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(err)?;
        copies.0.push(destination.clone());
        std::io::copy(&mut File::open(&image.path).map_err(err)?, &mut output).map_err(err)?;
        output.sync_all().map_err(err)?;
        conn.execute(
            "INSERT INTO platform_images(platform_id,path,kind,position) VALUES (?1,?2,?3,?4)",
            params![platform.id, relative, image.kind, position],
        )
        .map_err(err)?;
        existing.push(GameImage {
            path: destination.to_string_lossy().into_owned(),
            kind: image.kind.clone(),
        });
        position += 1;
        summary.image_count += 1;
    }
    summary.failed_image_count += batch
        .tasks
        .iter()
        .filter(|task| task.failure.is_some())
        .count();
    Ok(())
}

#[tauri::command]
pub async fn download_platform_images(
    job_id: String,
    platform_id: i32,
    source_platform: String,
    options: MediaOptions,
    existing_images: Vec<GameImage>,
    on_progress: Channel<MetadataProgress>,
    jobs: tauri::State<'_, MetadataJobs>,
    app: tauri::AppHandle,
) -> Result<PlatformImageReport> {
    let job = jobs.get(&job_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _busy = job.enter()?;
        let conn = super::super::get_db_connection().map_err(err)?;
        super::super::platform_details::read(&conn, platform_id, &job.root)?;
        let catalog = open_catalog(&job.catalog_path())?;
        let exists: bool = catalog
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM platforms WHERE name=?1)",
                [&source_platform],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err(crate::i18n::text("msg.41e6cd6fe2").into());
        }
        let name:String=conn.query_row("SELECT name FROM platforms WHERE id=?1",[platform_id],|r|r.get(0)).map_err(err)?;
        repository::record_platform(&conn,&name,&source_platform,job.personal_catalog)?;
        drop(conn);
        drop(catalog);
        on_progress
            .send(job.progress("platform_images", 0, None, None))
            .ok();
        let kept_logo = existing_images.iter().any(|image| image.kind == "logo");
        let (mut batch, published_counts) =
            prepare_with_counts(&job, &source_platform, &options, SITE)?;
        download_batch(&mut batch, &job, PLATFORM_IMAGES, |mut value| {
            value.phase = "platform_images";
            on_progress.send(value).ok();
        })?;
        let mut report = editor_image_report(&batch, &existing_images, &job)?;
        // Keep distinct catalog identities even when their bytes coincide,
        // and re-adopt old copies whose managed names lost that identity.
        for image in &batch.games[0].images {
            if let Some(identity)=repository::retained_console_filename(Path::new(&image.path)) {
                if !report.images.iter().any(|saved|saved.path==image.path)
                    && !existing_images.iter().any(|old|identical_images(Path::new(&old.path),Path::new(&image.path))
                        && repository::retained_console_filename(Path::new(&old.path)).as_ref()==Some(&identity)) {
                    report.images.push(image.clone());
                }
            }
        }
        retain_primary_logo(&mut report.images, &existing_images);
        for image in &report.images {
            app.asset_protocol_scope()
                .allow_file(&image.path)
                .map_err(err)?;
        }
        let already_present_count = batch.games[0].images.len() - report.images.len();
        Ok(PlatformImageReport {
            report,
            published_counts,
            already_present_count,
            kept_logo,
        })
    })
    .await
    .map_err(err)?
}

// A console has one display logo. Additional downloads are retained as alternate
// artwork instead of blocking them or replacing the user's existing logo.
fn retain_primary_logo(images: &mut [GameImage], existing: &[GameImage]) {
    let mut has_logo = existing.iter().any(|image| image.kind == "logo");
    for image in images {
        if image.kind == "logo" {
            if has_logo { image.kind = "other".into(); }
            has_logo = true;
        }
    }
}

#[cfg(test)]
mod download_options_tests {
    use super::*;
    #[test]
    fn additional_logos_are_kept_without_replacing_the_primary() {
        let image = |path: &str| GameImage { path: path.into(), kind: "logo".into() };
        let mut images = vec![image("logo.webp"),image("logo9.webp")];
        retain_primary_logo(&mut images, &[]);
        assert_eq!(images[0].kind,"logo");
        assert_eq!(images[1].kind,"other");
        let mut images = vec![image("logo.webp"),image("logo9.webp")];
        retain_primary_logo(&mut images, &[image("existing.webp")]);
        assert!(images.iter().all(|image|image.kind=="other"));
    }
    #[test]
    fn checked_console_types_default_to_one_and_can_download_all() {
        let images = vec![
            CatalogImage{filename:"logo.webp".into(),kind:"logo".into(),region:"World".into(),crc:String::new()},
            CatalogImage{filename:"logo9.webp".into(),kind:"other".into(),region:"World".into(),crc:String::new()},
            CatalogImage{filename:"logo2.svg".into(),kind:"other".into(),region:"World".into(),crc:String::new()},
        ];
        let counts=image_counts(&images);
        assert_eq!(counts["logo"],1);assert_eq!(counts["other"],2);
        let options=MediaOptions{selected_types:Some(vec!["logo".into(),"other".into()]),..Default::default()};
        assert_eq!(select_images(images.clone(),&options,"").len(),2);
        assert_eq!(select_images(images,&MediaOptions{download_all:true,..options},"").len(),3);
    }
}
