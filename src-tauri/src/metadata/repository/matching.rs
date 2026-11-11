//! Import matching uses indexed title, filename and serial lookups before fuzzy search.
use super::*;

fn title_key(value: &str) -> String {
    normalize(&crate::clean_rom_title(value)).split_whitespace()
        .filter(|word| !["the", "and"].contains(word)).collect::<String>()
}

pub(super) fn title_aliases(value: &str) -> Vec<String> {
    let mut aliases=vec![title_key(value)];
    // A short ROM name often omits a catalog's subtitle. Index those explicit
    // boundaries, but never truncate the user's query into a different sequel.
    for separator in [" - ", ": ", " starring "] {
        if let Some(index)=value.to_ascii_lowercase().find(separator) {
            let alias=title_key(&value[..index]);
            if alias.len()>=4 && !aliases.contains(&alias){aliases.push(alias);}
        }
    }
    aliases
}

pub(super) fn compatible_title(a:&str,b:&str)->bool {
    let words=|s:&str|normalize(&crate::clean_rom_title(s)).split_whitespace()
        .filter(|word|!["the","and"].contains(word)).map(str::to_owned).collect::<HashSet<_>>();
    let a=words(a);let b=words(b);
    let numbered=|words:&HashSet<String>|words.iter().filter(|word|word.chars().any(|c|c.is_ascii_digit())
        || ["i","ii","iii","iv","v","vi","vii","viii","ix","x"].contains(&word.as_str())).cloned().collect::<HashSet<_>>();
    // Only an added/omitted phrase is acceptable. Distinct subtitles or sequel
    // numbers are never replaced by a merely similar search result.
    a.intersection(&b).count()>=4 && (a.is_subset(&b)||b.is_subset(&a))
        && a.len().min(b.len())*3>=a.len().max(b.len())*2 && numbered(&a)==numbered(&b)
}

fn promote_title_equivalents(conn:&Connection,query:&str,results:&mut [SearchResult])->Result<()> {
    for result in results.iter_mut().filter(|r|!r.exact) {
        let json:String=conn.query_row("SELECT details FROM games WHERE id=?1",[result.game.id],|r|r.get(0)).map_err(err)?;
        let json:serde_json::Value=serde_json::from_str(&json).map_err(err)?;
        result.exact=compatible_title(query,&result.game.title)||json["_release_names"].as_array().into_iter().flatten()
            .filter_map(|v|v.as_str()).any(|name|compatible_title(query,name));
    }
    Ok(())
}

pub(super) fn release_rank(name: &str, requested: &str) -> (usize,u32) {
    let tags=|value:&str|value.split(['(', '[']).skip(1).filter_map(|part|part.split_once([')', ']']).map(|(tag,_)|normalize(tag))).collect::<Vec<_>>();
    let tags=tags(name);let wanted=|tag:&str|requested.to_ascii_lowercase().contains(tag);
    let special=tags.iter().filter(|tag|["beta","proto","sample","demo","sega ages","switch online","virtual console","mini","retro bit","collection","alt"]
        .iter().any(|marker|tag.contains(marker)&&!wanted(marker))).count();
    fn revision(value:&str)->u32 {
        value.to_ascii_lowercase().split('(').skip(1).filter_map(|s|s.split_once(')').map(|(tag,_)|tag.trim()))
            .find_map(|tag|tag.strip_prefix("rev").map(str::trim).and_then(|version|version.parse().ok()
                .or_else(||(version.len()==1&&version.as_bytes()[0].is_ascii_lowercase()).then(||(version.as_bytes()[0]-b'a'+1) as u32))))
            .unwrap_or(0)
    }
    (special,revision(name).abs_diff(revision(requested)))
}

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
    if catalog_is_repository(conn) {
        queries.extend([title_key(title),title_key(&original)]);
    }
    let mut seen = HashSet::new();
    for query in &queries {
        let key = normalize(query);
        if key.is_empty() || !seen.insert(key) { continue; }
        let results = exact_catalog_matches(conn, query, Some(platform))?;
        if !results.is_empty() { return Ok(results); }
    }
    let mut results = search_catalog(conn, title, platform)?;
    if catalog_is_repository(conn){promote_title_equivalents(conn,title,&mut results)?;}
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
            .prepare("SELECT k.source_key,g.details FROM repository_keys k JOIN games g ON g.id=k.id WHERE k.id=?1")
            .map_err(err)?;
        for result in &mut results {
            let (key,details): (String,String) = statement
                .query_row([result.game.id], |row| Ok((row.get(0)?,row.get(1)?)))
                .map_err(err)?;
            result.source_key = Some(key.rsplit('/').next().unwrap_or(&key).to_owned());
            let json:serde_json::Value=serde_json::from_str(&details).map_err(err)?;
            result.regions=json["_regions"].as_array().into_iter().flatten()
                .filter_map(|value|value.as_str().map(str::to_owned)).collect();
        }
    }
    Ok(results)
}

pub(in crate::metadata) fn shortest_match(candidates: &[SearchResult], ids: &[i64]) -> Option<i64> {
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
    fn equivalent_titles_handle_articles_conjunctions_spacing_and_subtitles_without_dropping_sequel_numbers() {
        for (rom,catalog) in [
            ("Adventures of Batman and Robin, The", "The Adventures of Batman & Robin"),
            ("Wolf Child", "Wolfchild"),
            ("Quack Shot Starring Donald Duck", "QuackShot Starring Donald Duck"),
            ("Battle Mania - Dai Gin Jou", "Battle Mania Daiginjou"),
            ("M.U.S.H.A", "MUSHA - Metallic Uniframe Super Hybrid Armor"),
        ] {assert!(title_aliases(catalog).contains(&title_key(rom)),"{rom}");}
        assert!(compatible_title("ESWAT Cyber Police - City Under Siege","ESWAT - City under Siege (USA, Europe) (Rev A)"));
        assert!(compatible_title("Nigel Mansell's World Championship","Nigel Mansell's World Championship Racing (USA)"));
        assert!(!compatible_title("Sonic and Knuckles & Sonic 2","Sonic & Knuckles"));
        assert!(!compatible_title("Phantasy Star - The End of the Millenium","Phantasy Star II"));
        assert!(!compatible_title("The Legend of Zelda - Ocarina of Time","The Legend of Zelda - Majora's Mask"));
        assert!(!compatible_title("Street Fighter II - Champion Edition","Street Fighter III - Champion Edition"));
        assert!(!title_aliases("Game II - Subtitle").contains(&title_key("Game")));
    }

    #[test]
    fn ordinary_releases_are_preferred_to_unrequested_betas_samples_reissues_and_other_revisions() {
        for tag in ["Beta", "Sample", "Proto", "Sega Ages", "Retro-Bit", "Mega Drive Mini"] {
            assert!(release_rank("Game (USA)","Game (U)")<release_rank(&format!("Game (USA) ({tag})"),"Game (U)"));
        }
        assert!(release_rank("Game (USA) (Rev A)","Game (U) (REV01)")<release_rank("Game (USA)","Game (U) (REV01)"));
        assert!(release_rank("Game (USA)","Game (U) (REV00)")<release_rank("Game (USA) (Rev 1)","Game (U) (REV00)"));
    }

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
