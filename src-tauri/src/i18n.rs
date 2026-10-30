use std::sync::atomic::{AtomicUsize, Ordering};
include!(concat!(env!("OUT_DIR"), "/languages.rs"));
pub(crate) use i18n_format;
static LANGUAGE: AtomicUsize = AtomicUsize::new(usize::MAX);

pub fn locale() -> &'static str {
    CATALOGS.get(LANGUAGE.load(Ordering::Relaxed)).map(|entry|entry.0).unwrap_or_else(|| {
        // Native fixtures assert Spanish messages independently of the runner's locale.
        #[cfg(test)]
        { "es-AR" }
        #[cfg(not(test))]
        { system_locale() }
    })
}
fn default_locale(language: &str) -> &'static str {
    let primary = language.split(['-', '_', '.', '@']).next().unwrap_or("");
    if primary.eq_ignore_ascii_case("es") { "es-AR" } else { "en-US" }
}
fn system_locale() -> &'static str {
    #[cfg(windows)]
    {
        let mut name = [0u16; 85];
        // Windows writes the current user's locale, including the terminating NUL.
        let length = unsafe { windows_sys::Win32::Globalization::GetUserDefaultLocaleName(name.as_mut_ptr(), name.len() as i32) };
        if length > 1 { return default_locale(&String::from_utf16_lossy(&name[..length as usize - 1])); }
    }
    #[cfg(not(windows))]
    for variable in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(language) = std::env::var(variable) {
            if !language.is_empty() { return default_locale(&language); }
        }
    }
    "en-US"
}
pub fn set_locale(code: &str) -> Result<(), String> {
    let index=CATALOGS.iter().position(|entry|entry.0==code).ok_or_else(||text("language.invalid").to_owned())?;
    LANGUAGE.store(index,Ordering::Relaxed);Ok(())
}
pub fn text(key: &str) -> &'static str {
    lookup(locale(),key).or_else(||lookup("es-AR",key)).unwrap_or("[missing translation]")
}
fn lookup(code: &str, key: &str) -> Option<&'static str> {
    let entries=CATALOGS.iter().find(|entry|entry.0==code)?.1;
    entries.binary_search_by_key(&key, |entry|entry.0).ok().map(|index|entries[index].1)
}
pub fn initialize() {
    let _ = set_locale(system_locale());
    let root=crate::storage::active_directory().ok().or_else(|| {
        let (program, default_directory)=crate::platform_runtime::locations().ok()?;
        let current=program.join("opencabinet.config.json");
        let config=if current.exists() { current } else { program.join(crate::profile_compat::CONFIG_FILE) };
        let configured=std::fs::read(config).ok().and_then(|bytes|serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value|value["data_directory"].as_str().map(std::path::PathBuf::from));
        Some(configured.unwrap_or(default_directory))
    });
    if let Some(root)=root {
        if let Ok(bytes)=std::fs::read(root.join("language.json")) {
            if let Ok(code)=serde_json::from_slice::<String>(&bytes) { let _=set_locale(&code); }
        }
    }
}
#[tauri::command]
pub fn set_ui_language(language: String) -> Result<(), String> { set_locale(&language) }

#[tauri::command]
pub fn save_ui_language(language: String) -> Result<(), String> {
    if !CATALOGS.iter().any(|entry|entry.0==language) { return Err(text("language.invalid").into()); }
    let root=crate::storage::active_directory()?;
    let temporary=root.join(format!(".language-{}-{}.tmp",std::process::id(),std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map_err(|error|error.to_string())?.as_nanos()));
    let bytes=serde_json::to_vec(&language).map_err(|error|error.to_string())?;
    let result=(|| {
        use std::io::Write;
        let mut file=std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary)?;
        file.write_all(&bytes)?;file.sync_all()?;drop(file);
        std::fs::rename(&temporary,root.join("language.json"))
    })();
    if result.is_err() { let _=std::fs::remove_file(temporary); }
    result.map_err(|error|error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_fixture_language_is_independent_of_the_host() {
        assert_eq!(locale(), "es-AR");
    }
    #[test]
    fn system_language_maps_all_spanish_variants_and_defaults_other_languages_to_english() {
        for code in ["es", "es-AR", "es-ES", "ES-mx", "es_CL.UTF-8"] { assert_eq!(default_locale(code), "es-AR"); }
        for code in ["en-US", "pt-BR", "fr", "", "est"] { assert_eq!(default_locale(code), "en-US"); }
    }
    #[test]
    fn native_catalogs_include_english_and_spanish_without_changing_library_values() {
        assert_eq!(lookup("en-US","language.invalid"),Some("Select an available language."));
        assert_eq!(lookup("es-AR","language.invalid"),Some("Selecciona un idioma disponible."));
        assert!(lookup("missing","language.invalid").is_none());
        assert!(lookup("en-US","missing.key").is_none());
        for (code,entries) in CATALOGS {
            assert!(entries.windows(2).all(|pair|pair[0].0<pair[1].0),"{code}");
            assert!(entries.iter().all(|(_,value)|!value.is_empty()),"{code}");
        }
    }
}
