//! Release regions come from catalog entries, independently of artwork regions.
use super::RepoEntry;

fn canonical(value: &str) -> Option<String> {
    let value=value.trim();
    let name=match value.to_ascii_uppercase().as_str() {
        ""|"UNKNOWN"|"UNK"|"N/A"=>return None,
        "ALL"|"WORLD"|"WORLDWIDE"|"WLD"|"ALL REGIONS"=>"World",
        "US"|"USA"|"NORTH AMERICA"=>"North America",
        "EU"|"EUR"|"EUROPE"=>"Europe",
        "JP"|"JPN"|"JAP"|"JAPAN"=>"Japan",
        "KR"|"KOR"|"KOREA"|"SOUTH KOREA"=>"Korea",
        "CN"|"CHN"|"CHINA"=>"China",
        "TW"|"TWN"|"TAIWAN"=>"Taiwan",
        "HK"|"HKG"|"HONG KONG"=>"Hong Kong",
        "AS"|"ASI"|"ASIA"=>"Asia",
        "AU"|"AUS"|"AUSTRALIA"=>"Australia",
        "BR"|"BRA"|"BRAZIL"=>"Brazil",
        _=>value,
    };
    Some(name.to_owned())
}

pub(super) fn from_entries(entries: &[RepoEntry]) -> Vec<String> {
    let mut regions=Vec::new();
    for entry in entries {
        let explicit=entry.region.as_deref().unwrap_or("");
        let mut values:Vec<String>=if canonical(explicit).is_some() {
            explicit.split([',','/',';','|']).filter_map(canonical).collect()
        } else {Vec::new()};
        if values.is_empty() {
            values.extend(super::rom_regions(&entry.name).into_iter().map(str::to_owned));
            values.extend(super::rom_regions(&entry.dat_name).into_iter().map(str::to_owned));
        }
        for region in values {if !regions.contains(&region){regions.push(region);}}
    }
    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_regions_do_not_depend_on_tags_in_the_title() {
        let entries:Vec<RepoEntry>=serde_json::from_str(r#"[
          {"name":"Switch Example","region":"ALL"},
          {"name":"Switch Example","region":"USA"},
          {"name":"Switch Example","region":"EUR/JPN"},
          {"name":"Switch Example","region":"us"}
        ]"#).unwrap();
        assert_eq!(from_entries(&entries),vec!["World","North America","Europe","Japan"]);
    }

    #[test]
    fn missing_regions_keep_existing_filename_tags_without_overriding_explicit_values() {
        for (json,expected) in [
            (r#"[{"name":"Game (USA)","dat_name":"Game (Europe)"}]"#,vec!["North America","Europe"]),
            (r#"[{"name":"Game (USA)","region":"JPN"}]"#,vec!["Japan"]),
            (r#"[{"name":"Game","region":"UNKNOWN"}]"#,vec![]),
            (r#"[{"name":"Game","region":"N/A"}]"#,vec![]),
            (r#"[{"name":"Game (Europe)","region":null}]"#,vec!["Europe"]),
            (r#"[{"name":"Game","region":"PAL"}]"#,vec!["PAL"]),
        ] {
            assert_eq!(from_entries(&serde_json::from_str::<Vec<RepoEntry>>(json).unwrap()),expected);
        }
    }
}
