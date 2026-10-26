fn main() {
    // Windows embeds icon.ico as an executable resource. Cargo must rerun
    // the resource compiler when prepare:icons changes the generated artwork.
    println!("cargo:rerun-if-changed=icons");
    prepare_languages();
    tauri_build::build()
}

fn prepare_languages() {
    use std::{collections::BTreeMap, fs, path::PathBuf};
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../src/locales");
    println!("cargo:rerun-if-changed={}",root.display());
    let mut catalogs = BTreeMap::new();
    for entry in fs::read_dir(&root).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") || name == "native-formats.json" { continue; }
        let value: serde_json::Value = serde_json::from_slice(&fs::read(entry.path()).unwrap()).unwrap();
        let locale = value["_meta"]["locale"].as_str().expect("Locale metadata required").to_owned();
        let messages: BTreeMap<String,String> = serde_json::from_value(value["messages"].clone()).unwrap();
        catalogs.insert(locale,messages);
    }
    fn collect_formats(root: &std::path::Path, formats: &mut std::collections::BTreeSet<String>) {
        for entry in fs::read_dir(root).unwrap() {
            let path=entry.unwrap().path();
            if path.is_dir() { collect_formats(&path,formats); }
            else if path.extension().is_some_and(|extension|extension=="rs") {
                let source=fs::read_to_string(path).unwrap();
                for part in source.split("i18n_format!(").skip(1) {
                    if let Some(quoted)=part.trim_start().strip_prefix('"') {
                        if let Some(key)=quoted.split('"').next() { formats.insert(key.to_owned()); }
                    }
                }
            }
        }
    }
    println!("cargo:rerun-if-changed=src");
    let mut formats=std::collections::BTreeSet::new();
    collect_formats(&root.join("../../src-tauri/src"),&mut formats);
    let mut generated = String::from("pub static CATALOGS: &[(&str, &[(&str, &str)])] = &[\n");
    for (locale,messages) in &catalogs {
        generated.push_str(&format!("({locale:?}, &[\n"));
        for (key,value) in messages { generated.push_str(&format!("({key:?}, {value:?}),\n")); }
        generated.push_str("]),\n");
    }
    generated.push_str("];\nmacro_rules! i18n_format {\n");
    for key in formats {
        generated.push_str(&format!("({key:?} $(, $($args:tt)*)?) => {{ match $crate::i18n::locale() {{\n"));
        for (locale,messages) in &catalogs {
            if locale == "es-AR" { continue; }
            let text = messages.get(&key).unwrap_or(&catalogs["es-AR"][&key]);
            generated.push_str(&format!("{locale:?} => format!({text:?}, $($($args)*)?),\n"));
        }
        let text=&catalogs["es-AR"][&key];
        generated.push_str(&format!("_ => format!({text:?}, $($($args)*)?),\n}} }};\n"));
    }
    generated.push_str("}\n");
    fs::write(PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("languages.rs"),generated).unwrap();
}
