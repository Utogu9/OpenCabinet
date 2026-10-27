//! Ordered source files belonging to one library game. Never moves ROMs.
use crate::{RomCandidate, ScanPreview};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
pub fn key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Disc {
    #[serde(default)]
    pub id: Option<i64>,
    pub rom_path: String,
    pub label: String,
    #[serde(default)]
    pub number: Option<u32>,
    #[serde(default)]
    pub available: bool,
}

pub fn source(path: &str) -> Disc {
    let number = identify(path).map(|(_, number)| number);
    Disc {
        id: None,
        rom_path: path.into(),
        label: number.map(|n| crate::i18n::i18n_format!("msg.5a30ba957c", n = n)).unwrap_or_else(|| {
            Path::new(path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        }),
        number,
        available: false,
    }
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS game_discs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL,
        rom_path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        disc_number INTEGER, position INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_game_discs_game ON game_discs(game_id,position);
        CREATE TRIGGER IF NOT EXISTS remove_game_discs AFTER DELETE ON games
        BEGIN DELETE FROM game_discs WHERE game_id=OLD.id; END;",
    )?;
    let rows = conn.prepare("SELECT id,rom_path FROM games WHERE NOT EXISTS(SELECT 1 FROM game_discs WHERE game_id=games.id)")?
        .query_map([], |r| Ok((r.get::<_,i64>(0)?, r.get::<_,String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if rows.is_empty() {
        return Ok(());
    }
    // One commit for an old library, without opening any of its ROM files.
    let tx = conn.unchecked_transaction()?;
    for (id, path) in rows {
        let disc = source(&path);
        tx.execute("INSERT OR IGNORE INTO game_discs(game_id,rom_path,path_key,label,disc_number,position) VALUES (?1,?2,?3,?4,?5,0)",
            params![id,path,key(&path),disc.label,disc.number])?;
    }
    tx.commit()
}

pub fn all(conn: &Connection) -> Result<HashMap<i32, Vec<Disc>>> {
    let mut games = HashMap::<i32, Vec<Disc>>::new();
    if !exists(conn)? {
        return Ok(games);
    }
    let mut stmt = conn.prepare("SELECT game_id,id,rom_path,label,disc_number FROM game_discs ORDER BY game_id,position,id").map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i32>(0)?,
                Disc {
                    id: r.get(1)?,
                    rom_path: r.get(2)?,
                    label: r.get(3)?,
                    number: r.get(4)?,
                    available: false,
                },
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (id, disc) = row.map_err(err)?;
        games.entry(id).or_default().push(disc);
    }
    Ok(games)
}
fn exists(conn: &Connection) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='game_discs' AND type='table')",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}
pub fn read(conn: &Connection, id: i64) -> Result<Vec<Disc>> {
    if !exists(conn)? {
        return Ok(Vec::new());
    }
    conn.prepare("SELECT id,rom_path,label,disc_number FROM game_discs WHERE game_id=?1 ORDER BY position,id").map_err(err)?
        .query_map([id], |r| Ok(Disc { id:r.get(0)?, rom_path:r.get(1)?, label:r.get(2)?, number:r.get(3)?, available:false })).map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(err)
}
pub fn paths(conn: &Connection) -> Result<HashSet<String>> {
    let mut paths = conn
        .prepare("SELECT rom_path FROM games")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(err)?
        .map(|r| r.map(|p| key(&p)))
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(err)?;
    for discs in all(conn)?.into_values() {
        paths.extend(discs.into_iter().map(|d| key(&d.rom_path)));
    }
    Ok(paths)
}
pub fn owner(conn: &Connection, path: &str) -> Result<Option<i64>> {
    let primary = conn
        .query_row(
            "SELECT id FROM games WHERE lower(replace(rom_path,char(92),'/'))=?1",
            [key(path)],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if primary.is_some() || !exists(conn)? {
        return Ok(primary);
    }
    conn.query_row(
        "SELECT game_id FROM game_discs WHERE path_key=?1",
        [key(path)],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}
pub fn candidate_discs(candidate: &RomCandidate) -> Vec<Disc> {
    if candidate.discs.is_empty() {
        vec![source(&candidate.rom_path)]
    } else {
        candidate.discs.clone()
    }
}
pub fn validate_sources(discs: &[Disc], require_files: bool) -> Result<()> {
    if discs.is_empty() || discs.len() > 100 {
        return Err(crate::i18n::text("msg.30ef9e393d").into());
    }
    let mut paths = HashSet::new();
    for disc in discs {
        if disc.rom_path.trim().is_empty()
            || disc.label.trim().is_empty()
            || !paths.insert(key(&disc.rom_path))
        {
            return Err(crate::i18n::text("msg.423c3b803e").into());
        }
        if require_files && !Path::new(&disc.rom_path).is_file() {
            return Err(crate::i18n::i18n_format!(
                "msg.cc23ed2779",
                disc.rom_path
            ));
        }
    }
    Ok(())
}
pub fn replace(conn: &Connection, game: i64, discs: &[Disc]) -> Result<()> {
    validate_sources(discs, false)?;
    for disc in discs {
        if owner(conn, &disc.rom_path)?.is_some_and(|id| id != game) {
            return Err(crate::i18n::text("msg.4c9624f47a").into());
        }
    }
    // Keep surviving IDs stable so stale launch requests cannot select another file.
    let old = read(conn, game)?;
    conn.execute("DELETE FROM game_discs WHERE game_id=?1", [game])
        .map_err(err)?;
    for (position, disc) in discs.iter().enumerate() {
        let id = old
            .iter()
            .find(|d| key(&d.rom_path) == key(&disc.rom_path))
            .and_then(|d| d.id);
        conn.execute("INSERT INTO game_discs(id,game_id,rom_path,path_key,label,disc_number,position) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id,game,disc.rom_path,key(&disc.rom_path),disc.label.trim(),disc.number,position as i64]).map_err(err)?;
    }
    conn.execute(
        "UPDATE games SET rom_path=?1 WHERE id=?2",
        params![discs[0].rom_path, game],
    )
    .map_err(err)?;
    Ok(())
}
pub fn selected_path(
    conn: &Connection,
    game: i32,
    selected: Option<i64>,
    fallback: &str,
) -> Result<String> {
    let discs = read(conn, game as i64)?;
    if discs.is_empty() && selected.is_none() {
        return Ok(fallback.into());
    }
    let disc = if let Some(id) = selected {
        discs
            .iter()
            .find(|d| d.id == Some(id))
            .ok_or(crate::i18n::text("msg.5e0039ec6a"))?
    } else if discs.len() == 1 {
        &discs[0]
    } else {
        return Err(crate::i18n::text("msg.5ee312ef3e").into());
    };
    if (selected.is_some() || discs.len() > 1) && !Path::new(&disc.rom_path).is_file() {
        return Err(crate::i18n::i18n_format!("msg.e628b537ea", disc.label));
    }
    Ok(disc.rom_path.clone())
}

/// Returns an edition key with only the explicit Disc/Disk token removed.
pub fn identify(path: &str) -> Option<(String, u32)> {
    let stem = Path::new(path).file_stem()?.to_str()?;
    let lower = stem.to_lowercase();
    // A BIN track can contain both Disc N and Track N in its filename.
    // It is still a component of one CUE image, not another playable disc.
    if lower.split(['(', '[']).skip(1).any(|token| {
        token.split([')', ']']).next().is_some_and(|token| {
            token
                .trim()
                .strip_prefix("track ")
                .is_some_and(|n| n.trim().parse::<u32>().is_ok())
        })
    }) {
        return None;
    }
    for (start, ch) in lower.char_indices() {
        if ch != '(' && ch != '[' {
            continue;
        }
        let close = if ch == '(' { ')' } else { ']' };
        let end = start + lower[start..].find(close)?;
        let token = lower[start + 1..end].trim();
        let rest = token
            .strip_prefix("disc")
            .or_else(|| token.strip_prefix("disk"));
        if let Some(rest) = rest.filter(|s| s.starts_with(' ')) {
            let n: u32 = rest.trim().parse().ok()?;
            if n == 0 {
                return None;
            }
            let edition = format!("{} {}", &lower[..start], &lower[end + 1..])
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let folder = Path::new(path).parent()?.to_string_lossy();
            return Some((format!("{}|{}", key(&folder), edition), n));
        }
    }
    None
}

/// Ignore track files described by a CUE that the scanner will import instead.
pub fn cue_tracks(folder: &Path, extensions: &[String]) -> Result<HashSet<String>> {
    let mut tracks = HashSet::new();
    if !extensions.iter().any(|ext| ext == "cue") {
        return Ok(tracks);
    }
    for entry in std::fs::read_dir(folder).map_err(err)? {
        let path = entry.map_err(err)?.path();
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("cue"))
            || !path.is_file()
        {
            continue;
        }
        if std::fs::metadata(&path).map_err(err)?.len() > 1024 * 1024 {
            continue;
        }
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in body.lines() {
            let line = line.trim().trim_start_matches('\u{feff}');
            if !line
                .get(..5)
                .is_some_and(|head| head.eq_ignore_ascii_case("FILE "))
            {
                continue;
            }
            let rest = line[5..].trim();
            let file = if let Some(quoted) = rest.strip_prefix('"') {
                quoted.split('"').next()
            } else {
                rest.split_whitespace().next()
            };
            if let Some(file) = file.filter(|file| !file.is_empty()) {
                let track = folder.join(file);
                // Only suppress same-folder files; scanning is intentionally nonrecursive.
                if track.parent() == Some(folder) && track != path {
                    tracks.insert(key(&track.to_string_lossy()));
                }
            }
        }
    }
    Ok(tracks)
}
pub fn group(candidates: Vec<RomCandidate>) -> Vec<RomCandidate> {
    let mut groups = HashMap::<String, Vec<RomCandidate>>::new();
    let mut other = Vec::new();
    for c in candidates {
        if c.steam.is_none() && c.epic.is_none() {
            if let Some((key, _)) = identify(&c.rom_path) {
                groups.entry(key).or_default().push(c);
                continue;
            }
        }
        other.push(c);
    }
    for mut group in groups.into_values() {
        group.sort_by_key(|c| identify(&c.rom_path).unwrap().1);
        let numbers: HashSet<_> = group
            .iter()
            .map(|c| identify(&c.rom_path).unwrap().1)
            .collect();
        if numbers.len() != group.len() {
            other.extend(group);
            continue;
        }
        let mut game = group[0].clone();
        game.discs = group.iter().map(|c| source(&c.rom_path)).collect();
        other.push(game);
    }
    other.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then(a.rom_path.cmp(&b.rom_path))
    });
    other
}

pub fn suggest(conn: &Connection, preview: &mut ScanPreview, platform: &str) -> Result<()> {
    let mut editions = HashMap::<String, HashSet<i32>>::new();
    let mut stmt = conn
        .prepare(
            "SELECT id,rom_path FROM games WHERE lower(platform)=lower(?1) AND launch_directly=0",
        )
        .map_err(err)?;
    let games = stmt
        .query_map([platform], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    for (id, path) in games {
        let mut sources = read(conn, id as i64)?;
        if sources.is_empty() {
            sources.push(source(&path));
        }
        for disc in sources {
            if let Some((edition, _)) = identify(&disc.rom_path) {
                editions.entry(edition).or_default().insert(id);
            }
        }
    }
    for c in &mut preview.games {
        if let Some((edition, _)) = identify(&c.rom_path) {
            if let Some(ids) = editions.get(&edition).filter(|ids| ids.len() == 1) {
                c.existing_game_id = ids.iter().next().copied();
            }
        }
    }
    Ok(())
}

/// Called inside the import's final transaction. Attachment is explicitly confirmed in preview.
pub fn attach_candidate(
    conn: &Connection,
    c: &RomCandidate,
    platform: &str,
) -> Result<Option<i64>> {
    let Some(id) = c.existing_game_id else {
        return Ok(None);
    };
    let valid: bool = conn
        .query_row(
            "SELECT lower(platform)=lower(?2) AND launch_directly=0 FROM games WHERE id=?1",
            params![id, platform],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or(false);
    if !valid || c.steam.is_some() || c.epic.is_some() {
        return Err(
            crate::i18n::text("msg.1d1a935933")
                .into(),
        );
    }
    let mut discs = read(conn, id as i64)?;
    let additional = candidate_discs(c);
    validate_sources(&additional, true)?;
    for disc in additional {
        if owner(conn, &disc.rom_path)?.is_some() {
            return Err(crate::i18n::text("msg.08b27f765d").into());
        }
        discs.push(disc);
    }
    discs.sort_by_key(|d| d.number.unwrap_or(u32::MAX));
    replace(conn, id as i64, &discs)?;
    Ok(Some(id as i64))
}

#[tauri::command]
pub async fn prepare_disc_import(
    mut preview: ScanPreview,
    platform: String,
) -> Result<ScanPreview> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(err)?;
        suggest(&conn, &mut preview, &platform)?;
        Ok(preview)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn get_game_discs(id: i32) -> Result<Vec<Disc>> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = crate::get_db_connection().map_err(err)?;
        let mut discs = read(&conn, id as i64)?;
        for disc in &mut discs {
            disc.available = Path::new(&disc.rom_path).is_file();
        }
        Ok(discs)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn pick_disc_files() -> Result<Vec<Disc>> {
    Ok(rfd::AsyncFileDialog::new()
        .set_title(crate::i18n::text("msg.03a4b7596d"))
        .pick_files()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|f| source(&f.path().to_string_lossy()))
        .collect())
}

pub fn merge(
    conn: &mut Connection,
    root: &Path,
    ids: &[i32],
    primary: i32,
    ordered: &[Disc],
) -> Result<()> {
    if ids.iter().any(|id| crate::game_regions::expanded(conn,&[*id]).map(|members|members.len()>1).unwrap_or(true)) {
        return Err(crate::i18n::text("msg.60f67ab390").into());
    }
    let unique: HashSet<_> = ids.iter().copied().collect();
    if unique.len() < 2 || !unique.contains(&primary) {
        return Err(crate::i18n::text("msg.2c363ccbad").into());
    }
    let mut platform = None;
    let mut old_paths = HashSet::new();
    for id in &unique {
        let (p, direct): (String, bool) = conn
            .query_row(
                "SELECT platform,launch_directly FROM games WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        if direct
            || platform
                .as_ref()
                .is_some_and(|p0: &String| !p0.eq_ignore_ascii_case(&p))
        {
            return Err(crate::i18n::text("msg.6e90b1aa7b").into());
        }
        platform = Some(p);
        old_paths.extend(read(conn, *id as i64)?.iter().map(|d| key(&d.rom_path)));
    }
    validate_sources(ordered, false)?;
    if old_paths != ordered.iter().map(|d| key(&d.rom_path)).collect() {
        return Err(crate::i18n::text("msg.881ef04511").into());
    }
    crate::media_library::preserve_before_delete(conn, root, ids)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let mut seconds = 0i64;
    let mut sessions = 0i64;
    let mut last: Option<String> = None;
    for id in &unique {
        let (s, n, l): (i64, i64, Option<String>) = tx
            .query_row(
                "SELECT play_time_seconds,session_count,last_played FROM games WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        seconds = seconds
            .checked_add(s)
            .ok_or(crate::i18n::text("msg.5ee9b376fe"))?;
        sessions = sessions.checked_add(n).ok_or(crate::i18n::text("msg.698f2d633a"))?;
        last = last.max(l);
        tx.execute("DELETE FROM game_discs WHERE game_id=?1", [id])
            .map_err(err)?;
    }
    for id in &unique {
        if *id != primary {
            tx.execute("DELETE FROM games WHERE id=?1", [id])
                .map_err(err)?;
        }
    }
    replace(&tx, primary as i64, ordered)?;
    tx.execute("UPDATE games SET play_time_seconds=?1,play_time=?1/60,session_count=?2,last_played=?3 WHERE id=?4",params![seconds,sessions,last,primary]).map_err(err)?;
    let mut copies = crate::PendingImageCopies(Vec::new());
    crate::media_library::sync_game(&tx, root, primary as i64, &mut copies)?;
    tx.commit().map_err(err)?;
    copies.0.clear();
    crate::media_library::flush_logged(conn, root);
    Ok(())
}
#[tauri::command]
pub async fn merge_game_discs(
    ids: Vec<i32>,
    primary_id: i32,
    discs: Vec<Disc>,
    tracker: tauri::State<'_, crate::PlayTracker>,
) -> Result<()> {
    let guards = ids
        .iter()
        .copied()
        .collect::<HashSet<_>>()
        .into_iter()
        .map(|id| tracker.reserve(id))
        .collect::<Result<Vec<_>>>()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guards = guards;
        let mut conn = crate::get_db_connection().map_err(err)?;
        merge(
            &mut conn,
            &crate::data_directory().map_err(err)?,
            &ids,
            primary_id,
            &discs,
        )
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Files(std::path::PathBuf);
    impl Files {
        fn new() -> Self {
            static NEXT_FILES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "opencabinet-discs-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT_FILES.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn rom(&self, name: &str) -> String {
            let p = self.0.join(name);
            std::fs::write(&p, b"disc").unwrap();
            p.to_string_lossy().into_owned()
        }
    }
    impl Drop for Files {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE games(id INTEGER PRIMARY KEY,title TEXT,platform TEXT,rom_path TEXT UNIQUE,cover_path TEXT,play_time INTEGER DEFAULT 0,release_date TEXT,developer TEXT,publisher TEXT);
            CREATE TABLE platforms(id INTEGER PRIMARY KEY,name TEXT,default_extensions TEXT); INSERT INTO platforms VALUES(1,'PS1','.chd');
            CREATE TABLE emulators(id INTEGER PRIMARY KEY,name TEXT,platform TEXT,executable_path TEXT,arguments TEXT,retroarch_core_path TEXT);
            INSERT INTO emulators VALUES(1,'Emulator','PS1','emulator.exe','--disc \"%ROM%\"',NULL);") .unwrap();
        crate::init_game_metadata(&c).unwrap();
        crate::init_game_images(&c).unwrap();
        crate::platform_details::init_schema(&c).unwrap();
        crate::media_library::init_schema(&c).unwrap();
        init(&c).unwrap();
        c
    }
    fn candidate(path: &str) -> RomCandidate {
        RomCandidate { launch_directly: false,
            title: crate::clean_rom_title(Path::new(path).file_stem().unwrap().to_str().unwrap()),
            rom_path: path.into(),
            steam: None,
            epic: None,
            discs: vec![],
            existing_game_id: None,
        }
    }
    fn add(c: &Connection, path: &str) -> i64 {
        c.execute(
            "INSERT INTO games(title,platform,rom_path) VALUES('Reviewed title','PS1',?1)",
            [path],
        )
        .unwrap();
        let id = c.last_insert_rowid();
        replace(c, id, &[source(path)]).unwrap();
        id
    }
    #[test]
    fn groups_only_explicit_disc_numbers_in_same_folder_and_edition_in_numeric_order() {
        let paths = [
            "r/Xenogears (USA) (Disc 10).chd",
            "r/Xenogears (USA) (Disc 2).chd",
            "r/Xenogears (USA) (Disc 1).chd",
            "r/Xenogears (Europe) (Disc 1).chd",
            "r/Xenogears (USA) (Rev 1) (Disc 1).chd",
            "r/Xenogears (USA) (En,Fr) (Disc 1).chd",
            "else/Xenogears (USA) (Disc 1).chd",
            "r/Xenogears (USA) (Track 1).bin",
            "r/Xenogears 2 (Disc 1).chd",
        ];
        let games = group(paths.into_iter().map(candidate).collect());
        assert_eq!(games.len(), 7);
        let g = games.iter().find(|g| g.discs.len() == 3).unwrap();
        assert_eq!(
            g.discs
                .iter()
                .map(|d| d.number.unwrap())
                .collect::<Vec<_>>(),
            [1, 2, 10]
        );
        assert!(identify("r/Game [Disk 03].chd").is_some());
        assert!(identify("r/Game (Track 1).bin").is_none());
        let duplicates = group(vec![
            candidate("r/Game (Disc 1).cue"),
            candidate("r/Game (Disc 1).chd"),
            candidate("r/Game (Disc 2).cue"),
        ]);
        assert_eq!(
            duplicates.len(),
            3,
            "ambiguous copies of the same disc are never merged automatically"
        );
        assert!(identify("r/Game (Disc 1) (Track 01).bin").is_none());
    }

    #[test]
    fn cue_tracks_are_not_imported_as_discs_but_their_descriptors_are_grouped() {
        let files = Files::new();
        let conn = db();
        for n in [1, 2] {
            let track = format!("Game (USA) (Disc {n}) (Track 01).bin");
            files.rom(&track);
            std::fs::write(
                files.0.join(format!("Game (USA) (Disc {n}).cue")),
                format!("FILE \"{track}\" BINARY\n TRACK 01 MODE2/2352\n INDEX 01 00:00:00\n"),
            )
            .unwrap();
        }
        let preview = crate::discover_roms(&conn, files.0.to_str().unwrap(), None, |_| {}).unwrap();
        assert_eq!(preview.games.len(), 1);
        assert_eq!(preview.total_found, 2);
        assert_eq!(preview.games[0].discs.len(), 2);
        assert!(
            preview.games[0]
                .discs
                .iter()
                .all(|d| d.rom_path.ends_with(".cue"))
        );
    }

    #[test]
    fn editor_persists_labels_and_order_with_metadata_without_altering_history() {
        let files = Files::new();
        let mut conn = db();
        let a = files.rom("One.chd");
        let b = files.rom("Two.chd");
        let id = add(&conn, &a);
        conn.execute(
            "UPDATE games SET play_time_seconds=123,session_count=9 WHERE id=?1",
            [id],
        )
        .unwrap();
        let mut sources = vec![source(&b), source(&a)];
        sources[0].label = "Bonus disc".into();
        let details: crate::GameDetails = serde_json::from_value(
            serde_json::json!({"id":id,"title":"Edited title","platform":"PS1","discs":sources}),
        )
        .unwrap();
        let saved = crate::save_game_with_media(&mut conn, details, &files.0).unwrap();
        assert_eq!(saved.title, "Edited title");
        assert_eq!(saved.discs[0].label, "Bonus disc");
        assert_eq!(saved.rom_path, b);
        assert_eq!((saved.play_time_seconds, saved.session_count), (123, 9));
        assert!(Path::new(&a).is_file());
        let details: crate::GameDetails = serde_json::from_value(
            serde_json::json!({"id":id,"title":"Edited title","platform":"PS1","discs":[]}),
        )
        .unwrap();
        assert!(crate::save_game_with_media(&mut conn, details, &files.0).is_err());
        assert_eq!(read(&conn, id).unwrap().len(), 2);
    }

    #[test]
    fn retroarch_launch_adds_the_core_and_passes_the_chosen_disc_as_one_argument() {
        let files = Files::new();
        let conn = db();
        let a = files.rom("Game (Disc 1).chd");
        let b = files.rom("Game (Disc 2).chd");
        let id = add(&conn, &a);
        replace(&conn, id, &[source(&a), source(&b)]).unwrap();
        let exe = files.0.join("retroarch.exe");
        let core = files.0.join("core with spaces.dll");
        let mut pe = vec![0u8; 80];
        pe[..2].copy_from_slice(b"MZ");
        pe[60..64].copy_from_slice(&64u32.to_le_bytes());
        pe[64..68].copy_from_slice(b"PE\0\0");
        pe[68..70].copy_from_slice(&0x8664u16.to_le_bytes());
        std::fs::write(&exe, &pe).unwrap();
        std::fs::write(&core, &pe).unwrap();
        conn.execute("UPDATE emulators SET executable_path=?1,arguments='%ROM%',retroarch_core_path=?2 WHERE id=1",params![exe.to_string_lossy(),core.to_string_lossy()]).unwrap();
        let discs = read(&conn, id).unwrap();
        crate::launch_game_record_with_disc(&conn, id as i32, discs[1].id, |_, args, dir| {
            assert_eq!(
                args,
                &[
                    "-L".to_string(),
                    core.to_string_lossy().into_owned(),
                    b.clone()
                ]
            );
            assert_eq!(dir, Some(files.0.as_path()));
            Ok(())
        })
        .unwrap();
        crate::game_execution::save(&conn, id as i32, "PS1", &crate::game_execution::ExecutionOptions {
            emulator_id: Some(1), arguments: Some("--verbose \"%ROM%\"".into()),
        }).unwrap();
        crate::launch_game_record_with_disc(&conn, id as i32, discs[1].id, |_, args, _| {
            assert_eq!(args, &["-L".to_string(), core.to_string_lossy().into_owned(), "--verbose".into(), b.clone()]);
            Ok(())
        }).unwrap();
    }
    #[test]
    fn migration_is_idempotent_and_edits_preserve_ids_validate_ownership_and_delete_only_associations()
     {
        let files = Files::new();
        let c = db();
        let a = files.rom("A.chd");
        let b = files.rom("B.chd");
        let id = add(&c, &a);
        let old = read(&c, id).unwrap()[0].id;
        replace(&c, id, &[source(&a), source(&b)]).unwrap();
        init(&c).unwrap();
        assert_eq!(read(&c, id).unwrap().len(), 2);
        assert_eq!(read(&c, id).unwrap()[0].id, old);
        let second = add(&c, &files.rom("Other.chd"));
        assert!(replace(&c, second, &[source(&a)]).is_err());
        replace(&c, id, &[source(&b)]).unwrap();
        init(&c).unwrap();
        assert_eq!(read(&c, id).unwrap().len(), 1);
        assert!(Path::new(&a).is_file());
        c.execute("DELETE FROM games WHERE id=?1", [id]).unwrap();
        assert!(read(&c, id).unwrap().is_empty());
        assert!(Path::new(&b).is_file());
    }
    #[test]
    fn importing_group_retains_reviewed_title_rechecks_every_path_and_can_append_later_disc() {
        let f = Files::new();
        let mut c = db();
        let one = f.rom("Game (USA) (Disc 1).chd");
        let two = f.rom("Game (USA) (Disc 2).chd");
        let mut games = group(vec![candidate(&one), candidate(&two)]);
        games[0].title = "Manual correction".into();
        crate::import_roms(
            &mut c,
            ScanPreview {
                games,
                total_found: 2,
                skipped_count: 0,
            },
            "PS1",
            |_| {},
        )
        .unwrap();
        let id: i64 = c
            .query_row(
                "SELECT id FROM games WHERE title='Manual correction'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(read(&c, id).unwrap().len(), 2);
        let scan = crate::discover_roms(&c, f.0.to_str().unwrap(), None, |_| {}).unwrap();
        assert!(scan.games.is_empty());
        assert_eq!(scan.skipped_count, 2);
        let three = f.rom("Game (USA) (Disc 3).chd");
        let mut p = ScanPreview {
            games: group(vec![candidate(&three)]),
            total_found: 1,
            skipped_count: 0,
        };
        suggest(&c, &mut p, "PS1").unwrap();
        assert_eq!(p.games[0].existing_game_id, Some(id as i32));
        crate::import_roms(&mut c, p, "PS1", |_| {}).unwrap();
        assert_eq!(read(&c, id).unwrap().len(), 3);
        assert_eq!(
            c.query_row("SELECT count(*) FROM games", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            1
        );
        let invalid = f.rom("Missing (Disc 1).chd");
        let missing = f.rom("Missing (Disc 2).chd");
        let p = ScanPreview {
            games: group(vec![candidate(&invalid), candidate(&missing)]),
            total_found: 2,
            skipped_count: 0,
        };
        std::fs::remove_file(&missing).unwrap();
        assert!(crate::import_roms(&mut c, p, "PS1", |_| {}).is_err());
        assert!(owner(&c, &invalid).unwrap().is_none());
    }
    #[test]
    fn launch_uses_chosen_disc_and_rejects_missing_foreign_and_unspecified_discs_without_sessions()
    {
        let f = Files::new();
        let c = db();
        let a = f.rom("Game (Disc 1).chd");
        let b = f.rom("Game (Disc 2).chd");
        let id = add(&c, &a);
        replace(&c, id, &[source(&a), source(&b)]).unwrap();
        let discs = read(&c, id).unwrap();
        assert!(
            crate::launch_game_record_with_disc(&c, id as i32, None, |_, _, _| Ok(())).is_err()
        );
        assert!(
            crate::launch_game_record_with_disc(&c, id as i32, Some(999), |_, _, _| Ok(()))
                .is_err()
        );
        let (result, ()) =
            crate::launch_game_record_with_disc(&c, id as i32, discs[1].id, |exe, args, _| {
                assert_eq!(exe, "emulator.exe");
                assert_eq!(args, &["--disc".to_string(), b.clone()]);
                Ok(())
            })
            .unwrap();
        assert_eq!(result.stats.session_count, 1);
        std::fs::remove_file(&b).unwrap();
        assert!(
            crate::launch_game_record_with_disc(&c, id as i32, discs[1].id, |_, _, _| Ok(()))
                .is_err()
        );
        assert_eq!(
            c.query_row("SELECT session_count FROM games WHERE id=?1", [id], |r| r
                .get::<_, i32>(
                0
            ))
            .unwrap(),
            1
        );
    }
    #[test]
    fn merge_keeps_primary_metadata_sums_history_and_rolls_back_failed_deletion() {
        let f = Files::new();
        let mut c = db();
        let a = f.rom("Game (Disc 1).chd");
        let b = f.rom("Game (Disc 2).chd");
        let main = add(&c, &a);
        let secondary = add(&c, &b);
        c.execute("UPDATE games SET title='Keep this',play_time_seconds=61,session_count=2,last_played='2026-01-01T00:00:00Z' WHERE id=?1",[main]).unwrap();
        c.execute("UPDATE games SET play_time_seconds=120,session_count=3,last_played='2026-02-01T00:00:00Z' WHERE id=?1",[secondary]).unwrap();
        let ordered = [source(&a), source(&b)];
        c.execute_batch("CREATE TRIGGER fail_merge BEFORE DELETE ON games BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(
            merge(
                &mut c,
                &f.0,
                &[main as i32, secondary as i32],
                main as i32,
                &ordered
            )
            .is_err()
        );
        assert_eq!(read(&c, secondary).unwrap().len(), 1);
        c.execute_batch("DROP TRIGGER fail_merge").unwrap();
        merge(
            &mut c,
            &f.0,
            &[main as i32, secondary as i32],
            main as i32,
            &ordered,
        )
        .unwrap();
        let stats:(String,i64,i64,i64,String)=c.query_row("SELECT title,play_time_seconds,play_time,session_count,last_played FROM games WHERE id=?1",[main],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
        assert_eq!(
            stats,
            ("Keep this".into(), 181, 3, 5, "2026-02-01T00:00:00Z".into())
        );
        assert_eq!(read(&c, main).unwrap().len(), 2);
        assert!(Path::new(&b).is_file());
    }
}
