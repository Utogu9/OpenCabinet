//! Import matching uses indexed title, filename and serial lookups before fuzzy search.
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
            "bz2", "xz", "zst", "rar", "xiso", "zcci", "cci", "cxi", "pkg", "exe", "rom",
            "a26", "a52", "a78", "j64", "jag", "abs", "cof", "lnx", "ws", "wsc", "col",
            "int", "xvd", "xvc", "pce", "sgx", "wud", "wux", "wua", "rpx", "vb", "vboy",
            "fds", "sg", "sms", "32x", "gg", "ngp", "ngc", "vpk",
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
    let original = rom_name(path);
    let mut queries = if catalog_is_repository(conn) {
        // The repository indexes regional filenames; keep their disambiguation.
        vec![original.clone(), title.to_owned()]
    } else {
        vec![title.to_owned(), original.clone()]
    };
    // Serial filenames may use SLUS_209.98 instead of SLUS-20998.
    let serial: String = original.chars().filter(char::is_ascii_alphanumeric).collect();
    if let Some(index) = serial.find(|c: char| c.is_ascii_digit()) {
        let (prefix, number) = serial.split_at(index);
        if (2..=6).contains(&prefix.len()) && (4..=9).contains(&number.len()) && number.chars().all(|c| c.is_ascii_digit()) {
            queries.extend([serial.clone(), format!("{prefix} {number}")]);
        }
    }
    if !original.is_empty() { queries.push(crate::clean_rom_title(&original)); }
    let mut seen = HashSet::new();
    for query in &queries {
        let key = normalize(query);
        if key.is_empty() || !seen.insert(key) { continue; }
        let results = exact_catalog_matches(conn, query, Some(platform))?;
        if !results.is_empty() { return Ok(results); }
    }
    let results = search_catalog(conn, title, platform)?;
    if !results.is_empty() || original.is_empty() || normalize(&original) == normalize(title) {
        return Ok(results);
    }
    search_catalog(conn, &original, platform)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_names_preserve_tags_and_title_dots_while_removing_rom_extensions() {
        for (path, expected) in [
            ("C:/ROMs/Vol. 2 (USA) (En,Es).iso.gz", "Vol. 2 (USA) (En,Es)"),
            ("C:/ROMs/Example (Japan).pce.zip", "Example (Japan)"),
            ("C:/ROMs/Example (Europe).wua", "Example (Europe)"),
            ("C:/ROMs/SLUS_209.98.chd", "SLUS_209.98"),
            ("C:/Game/PS3_GAME/USRDIR/EBOOT.BIN", ""),
            ("steam://run/123", ""),
        ] {
            assert_eq!(rom_name(path), expected);
        }
    }
}
