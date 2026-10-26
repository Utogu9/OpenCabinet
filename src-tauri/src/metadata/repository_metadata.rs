//! Read optional repository facts without inventing missing dates or player counts.
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Default, Deserialize)]
pub(super) struct Record {
    #[serde(default)]
    pub labels: std::collections::HashMap<String, String>,
    #[serde(default)]
    short_descriptions: Value,
    #[serde(default)]
    fields: Value,
    #[serde(default)]
    sources: Value,
}

#[derive(Default, Serialize)]
pub(super) struct Fields {
    pub release_date: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub manufacturer: Option<String>,
    pub genre: Option<String>,
    pub game_mode: Option<String>,
    pub max_players: Option<i32>,
    pub description: Option<String>,
}

pub(super) fn localized(value: &Value, locale: &str) -> Option<String> {
    let language = locale.split('-').next().unwrap_or("en");
    [locale, language, "mul", "en", "es"]
        .into_iter()
        .find_map(|key| {
            value
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        })
}

impl Record {
    pub fn entity(&self) -> Option<&str> {
        self.sources["wikidata"]["wikidata_id"].as_str()
    }
    pub fn values(&self, locale: &str, platform: Option<&str>, regions: &[&str]) -> Fields {
        let statements = |key: &str| -> Vec<&Value> {
            self.fields[key]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|s| {
                    if s["rank"] == "deprecated" {
                        return false;
                    }
                    let scoped = s["qualifiers"]["P400"].as_array();
                    scoped.is_none_or(|list| {
                        platform.is_some_and(|id| {
                            list.iter().any(|v| v["datavalue"]["value"]["id"] == id)
                        })
                    })
                })
                .collect()
        };
        let list = |key: &str| {
            let mut result = Vec::new();
            for statement in statements(key) {
                let name = localized(&statement["labels"], locale).or_else(|| {
                    statement["value"]
                        .as_str()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_owned)
                });
                if let Some(name) = name {
                    if !result.contains(&name) {
                        result.push(name);
                    }
                }
            }
            (!result.is_empty()).then(|| result.join(", "))
        };
        let region_ids: Vec<&str> = regions
            .iter()
            .filter_map(|r| match *r {
                "North America" => Some("Q49"),
                "Europe" => Some("Q46"),
                "Japan" => Some("Q17"),
                "Spain" => Some("Q29"),
                "France" => Some("Q142"),
                "Germany" => Some("Q183"),
                _ => None,
            })
            .collect();
        let mut dates: Vec<(u8, String)> = statements("release_date")
            .into_iter()
            .filter_map(|s| {
                let value = &s["value"];
                if value["precision"].as_u64()? < 11 {
                    return None;
                }
                let time = value["time"].as_str()?.strip_prefix('+')?;
                let date = time.get(..10)?;
                let parts: Vec<_> = date.split('-').collect();
                if parts.len() != 3 || parts[0].len() != 4 {
                    return None;
                }
                let year = parts[0].parse::<u32>().ok()?;
                let month = parts[1].parse::<u32>().ok()?;
                let day = parts[2].parse::<u32>().ok()?;
                let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
                let days = match month {
                    2 => {
                        if leap {
                            29
                        } else {
                            28
                        }
                    }
                    4 | 6 | 9 | 11 => 30,
                    1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                    _ => return None,
                };
                if year == 0 || day == 0 || day > days {
                    return None;
                }
                let scope = s["qualifiers"]["P291"].as_array();
                let matched = scope.is_some_and(|list| {
                    list.iter().any(|v| {
                        let id = v["datavalue"]["value"]["id"].as_str().unwrap_or("");
                        region_ids.contains(&id)
                            || (regions.contains(&"North America") && id == "Q30")
                    })
                });
                // Prefer the requested region, then unqualified worldwide facts.
                // A known different region is not substituted for a known region.
                if !region_ids.is_empty() && scope.is_some() && !matched {
                    return None;
                }
                Some((if matched { 0 } else { 1 }, date.to_owned()))
            })
            .collect();
        dates.sort();
        let max_players = statements("max_players")
            .into_iter()
            .filter_map(|s| {
                s["value"]["amount"]
                    .as_str()
                    .and_then(|n| n.parse::<i32>().ok())
                    .or_else(|| s["value"].as_i64().and_then(|n| i32::try_from(n).ok()))
                    .filter(|n| *n > 0)
            })
            .max();
        Fields {
            release_date: dates.first().map(|(_, date)| date.clone()),
            developer: list("developer"),
            publisher: list("publisher"),
            manufacturer: list("manufacturer"),
            genre: list("genre"),
            game_mode: list("game_mode"),
            max_players,
            description: localized(&self.short_descriptions, locale),
        }
    }
}

pub(super) fn read_game(json: &str) -> super::Result<super::CatalogGame> {
    read_game_locale(json, crate::i18n::locale())
}
fn read_game_locale(json: &str, locale: &str) -> super::Result<super::CatalogGame> {
    let value: Value = serde_json::from_str(json).map_err(super::err)?;
    let language = locale.split('-').next().unwrap_or("en");
    serde_json::from_value(
        value
            .get("_localized")
            .and_then(|v| v.get(language).or_else(|| v.get("en")))
            .unwrap_or(&value)
            .clone(),
    )
    .map_err(super::err)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn respects_localization_platform_region_and_date_precision_without_inventing_players() {
        let record:Record=serde_json::from_value(serde_json::json!({
            "short_descriptions":{"en":"A racing game","es":"Un juego de carreras"},
            "fields":{
                "developer":[{"labels":{"mul":"Studio"},"value":{"id":"Q1"}},{"rank":"deprecated","labels":{"en":"Wrong"}}],
                "genre":[{"labels":{"en":"Racing","es":"Carreras"}}],
                "game_mode":[{"labels":{"en":"Cooperative","es":"Cooperativo"}}],
                "max_players":[],
                "release_date":[
                    {"value":{"time":"+1999-00-00T00:00:00Z","precision":9}},
                    {"value":{"time":"+2000-01-02T00:00:00Z","precision":11},"qualifiers":{"P400":[{"datavalue":{"value":{"id":"OTHER"}}}]}},
                    {"value":{"time":"+2001-01-02T00:00:00Z","precision":11},"qualifiers":{"P291":[{"datavalue":{"value":{"id":"Q17"}}}]}},
                    {"value":{"time":"+2002-01-02T00:00:00Z","precision":11},"qualifiers":{"P291":[{"datavalue":{"value":{"id":"Q30"}}}]}},
                    {"value":{"time":"+2003-02-30T00:00:00Z","precision":11}}
                ]
            }
        })).unwrap();
        let us = record.values("en-US", Some("PS2"), &["North America"]);
        let jp = record.values("es-AR", Some("PS2"), &["Japan"]);
        assert_eq!(us.release_date.as_deref(), Some("2002-01-02"));
        assert_eq!(jp.release_date.as_deref(), Some("2001-01-02"));
        assert_eq!(us.developer.as_deref(), Some("Studio"));
        assert_eq!(jp.genre.as_deref(), Some("Carreras"));
        assert_eq!(us.description.as_deref(), Some("A racing game"));
        assert_eq!(us.max_players, None);
        assert_eq!(Record::default().values("en", None, &[]).release_date, None);
    }
    #[test]
    fn reads_both_languages_after_reopening_and_keeps_plain_personal_records_compatible() {
        let json=serde_json::json!({"id":-1000000000001i64,"title":"Reviewed title","platform":"PS2",
            "_localized":{"es":{"id":-1000000000001i64,"title":"Reviewed title","platform":"PS2","genre":"Carreras"},
            "en":{"id":-1000000000001i64,"title":"Reviewed title","platform":"PS2","genre":"Racing"}}}).to_string();
        assert_eq!(
            read_game_locale(&json, "es-AR").unwrap().genre.as_deref(),
            Some("Carreras")
        );
        assert_eq!(
            read_game_locale(&json, "en-US").unwrap().genre.as_deref(),
            Some("Racing")
        );
        let personal = r#"{"id":1,"title":"Local title","platform":"Local platform","description":"Untouched"}"#;
        assert_eq!(
            read_game_locale(personal, "es-AR")
                .unwrap()
                .description
                .as_deref(),
            Some("Untouched")
        );
    }
}
