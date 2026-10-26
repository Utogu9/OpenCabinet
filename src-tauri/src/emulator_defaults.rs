use serde::Serialize;

pub const ROM_ARGUMENT: &str = "\"%ROM%\"";

#[derive(Clone, serde::Deserialize, Serialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub arguments: String,
    pub source: String,
}

#[tauri::command]
pub fn get_emulator_argument_presets() -> Vec<Preset> {
    serde_json::from_str(include_str!("../../src/emulator-presets.json"))
        .expect("the built-in emulator presets must be valid")
}

pub fn recommended(name: &str, executable: &str) -> String {
    let stem = executable
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_lowercase();
    let name = name.to_lowercase();
    let presets = get_emulator_argument_presets();
    let matches = |text: &str, alias: &str| {
        text.starts_with(alias)
            && text[alias.len()..]
                .chars()
                .next()
                .is_none_or(|c| !c.is_ascii_alphabetic())
    };
    presets
        .iter()
        .find(|p| p.aliases.iter().any(|a| matches(&stem, a)))
        .or_else(|| {
            presets
                .iter()
                .find(|p| p.aliases.iter().any(|a| matches(name.trim(), a)))
        })
        .map_or_else(|| ROM_ARGUMENT.into(), |p| p.arguments.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_executable_before_display_name_and_preserves_quoted_rom() {
        assert_eq!(
            recommended("Mi emulador", r"C:\Emulators\pcsx2-qt.exe"),
            "-fullscreen -batch -- \"%ROM%\""
        );
        assert_eq!(
            recommended("PCSX2", "rpcs3.exe"),
            "--no-gui --fullscreen \"%ROM%\""
        );
        assert_eq!(
            recommended("PPSSPP", "PPSSPPWindows64.exe"),
            "--fullscreen \"%ROM%\""
        );
        assert_eq!(
            recommended("Emulador desconocido", "custom.exe"),
            ROM_ARGUMENT
        );
        assert_eq!(
            recommended("shadPS4", "shadps4.exe"),
            "--fullscreen true -g \"%ROM%\""
        );
        for preset in get_emulator_argument_presets() {
            assert!(preset.arguments.contains(ROM_ARGUMENT));
        }
    }
}
