//! Repository-only matching. Keep distinct serials and prefer the original ROM name.
use super::*;

pub(super) fn rom_name(path: &str) -> String {
    if path.contains("://") {
        return String::new();
    }
    let mut name = path.rsplit(['/', '\\']).next().unwrap_or("").trim();
    // Preserve regions, languages, revisions, discs and dots within the title.
    while let Some((stem, extension)) = name.rsplit_once('.') {
        if ![
            "iso", "bin", "cue", "chd", "cso", "pbp", "gcm", "rvz", "wbfs", "nkit", "md", "gen",
            "smd", "sfc", "smc", "nes", "gba", "gbc", "gb", "n64", "z64", "v64", "nds", "3ds",
            "cia", "nsp", "xci", "xbe", "xex", "god", "cdi", "gdi", "v40", "zip", "7z", "gz",
            "bz2", "xz", "zst", "rar", "xiso", "zcci", "cci", "cxi", "pkg", "exe",
        ]
        .iter()
        .any(|known| extension.eq_ignore_ascii_case(known))
        {
            break;
        }
        name = stem.trim_end();
    }
    if name.eq_ignore_ascii_case("eboot") {
        String::new()
    } else {
        name.to_owned()
    }
}

pub(in crate::metadata) fn search_candidate(
    conn: &Connection,
    title: &str,
    platform: &str,
    path: &str,
) -> Result<Vec<SearchResult>> {
    if catalog_is_repository(conn) {
        let name = rom_name(path);
        let normalized = normalize(&name);
        if !normalized.is_empty() {
            let mut statement = conn
                .prepare(
                    "SELECT DISTINCT g.details FROM names n JOIN games g ON g.id=n.game_id
                 WHERE n.normalized=?1 AND g.platform=?2 ORDER BY g.id",
                )
                .map_err(err)?;
            let mut results = Vec::new();
            for json in statement
                .query_map(params![normalized, platform], |row| row.get::<_, String>(0))
                .map_err(err)?
            {
                results.push(SearchResult {
                    game: repository_metadata::read_game(&json.map_err(err)?)?,
                    exact: true,
                    source_key: None,
                });
            }
            if !results.is_empty() {
                return finish_search_results(conn, results);
            }
        }
    }
    search_catalog(conn, title, platform)
}

pub(in crate::metadata) fn finish_search_results(
    conn: &Connection,
    mut results: Vec<SearchResult>,
) -> Result<Vec<SearchResult>> {
    if catalog_is_repository(conn) {
        let mut statement = conn
            .prepare("SELECT source_key FROM repository_keys WHERE id=?1")
            .map_err(err)?;
        for result in &mut results {
            let key: String = statement
                .query_row([result.game.id], |row| row.get(0))
                .map_err(err)?;
            result.source_key = Some(key.rsplit('/').next().unwrap_or(&key).to_owned());
        }
    }
    Ok(results)
}

pub(super) fn shortest_match(candidates: &[SearchResult], ids: &[i64]) -> Option<i64> {
    candidates
        .iter()
        .filter(|candidate| ids.contains(&candidate.game.id))
        .filter_map(|candidate| {
            candidate
                .source_key
                .as_ref()
                .map(|key| (candidate.game.id, key))
        })
        .min_by(|(id_a, a), (id_b, b)| {
            a.len()
                .cmp(&b.len())
                .then_with(|| a.cmp(b))
                .then_with(|| id_a.cmp(id_b))
        })
        .map(|(id, _)| id)
}
