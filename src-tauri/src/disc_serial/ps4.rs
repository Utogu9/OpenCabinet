//! Identify extracted PS4 games by sce_sys/param.sfo, without reading PKGs.
use super::{sfo, Budget, Identity};
use std::{
    io,
    path::{Path, PathBuf},
};

pub(super) fn game_directory(boot: &Path) -> Option<&Path> {
    boot.file_name()?
        .eq_ignore_ascii_case("eboot.bin")
        .then(|| boot.parent())
        .flatten()
}

pub(super) fn metadata_path(boot: &Path) -> io::Result<Option<PathBuf>> {
    let Some(directory) = game_directory(boot) else {
        return Ok(None);
    };
    let Some(system) = sfo::component(directory, "sce_sys", true)? else {
        return Ok(None);
    };
    sfo::component(&system, "param.sfo", false)
}

fn parse(bytes: &[u8]) -> io::Result<Option<Identity>> {
    let Some(value) = sfo::title_id(bytes, &[0x100, 0x101])? else {
        return Ok(None);
    };
    let compact: String = value.chars().filter(|&c| c != '-' && c != ' ').collect();
    let Some(number) = compact.strip_prefix("CUSA") else {
        return Ok(None);
    };
    if number.len() != 5 || !number.bytes().all(|b| b.is_ascii_digit()) || number == "00000" {
        return Ok(None);
    }
    Ok(Some(Identity {
        serial: format!("CUSA-{number}"),
        // PS4 product numbers do not encode a dependable territory. The exact
        // catalog release supplies it; never assume USA from the CUSA prefix.
        regions: Vec::new(),
    }))
}

pub(super) fn identity(boot: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let Some(path) = metadata_path(boot)? else {
        return Ok(None);
    };
    parse(&sfo::read(&path, budget)?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{cached_identity, identity_checked, init, ps3, tests::Files, System};
    use std::fs;

    pub fn game(files: &Files, directory: &str, id: &str) -> PathBuf {
        let directory = files.0.join(directory);
        fs::create_dir_all(directory.join("sce_sys")).unwrap();
        fs::write(directory.join("sce_sys/param.sfo"), ps3::tests::sfo(id)).unwrap();
        let boot = directory.join("eboot.bin");
        fs::write(&boot, b"executable is not read").unwrap();
        boot
    }
    #[test]
    fn ps4_reads_the_sibling_system_sfo_and_validates_ps4_ids_without_guessing_regions() {
        let files = Files::new();
        for id in ["CUSA12345", "CUSA-12345", "CUSA 12345"] {
            let boot = game(&files, "Wrong title (USA)", id);
            let identity =
                identity_checked(boot.to_str().unwrap(), "Sony - PlayStation 4", &|| false)
                    .unwrap();
            assert_eq!(identity.serial, "CUSA-12345");
            assert!(identity.regions.is_empty());
            assert!(identity_checked(boot.to_str().unwrap(), "PS3", &|| false).is_none());
            assert!(identity_checked(boot.to_str().unwrap(), "PS4", &|| true).is_none());
        }
        for id in [
            "",
            "BLUS30581",
            "ULUS12345",
            "NPUB12345",
            "PPSA12345",
            "CUSA00000",
            "CUSA1234",
            "CUSA123456",
            "CUSA12X45",
        ] {
            assert!(parse(&ps3::tests::sfo(id)).unwrap().is_none(), "{id}");
        }
        let mut old_version = ps3::tests::sfo("CUSA12345");
        old_version[4..8].copy_from_slice(&0x100u32.to_le_bytes());
        assert_eq!(parse(&old_version).unwrap().unwrap().serial, "CUSA-12345");
        old_version[4..8].copy_from_slice(&0x102u32.to_le_bytes());
        assert!(parse(&old_version).is_err());
        let valid = ps3::tests::sfo("CUSA12345");
        for length in 0..valid.len() {
            assert!(parse(&valid[..length]).is_err());
        }
        let boot = game(&files, "case variants", "CUSA12345");
        let directory = boot.parent().unwrap();
        fs::rename(directory.join("sce_sys"), directory.join("temporary")).unwrap();
        fs::rename(directory.join("temporary"), directory.join("SCE_SYS")).unwrap();
        fs::rename(
            directory.join("SCE_SYS/param.sfo"),
            directory.join("SCE_SYS/temporary"),
        )
        .unwrap();
        fs::rename(
            directory.join("SCE_SYS/temporary"),
            directory.join("SCE_SYS/PARAM.SFO"),
        )
        .unwrap();
        assert_eq!(
            identity_checked(boot.to_str().unwrap(), "PS4", &|| false)
                .unwrap()
                .serial,
            "CUSA-12345"
        );
    }
    #[test]
    fn ps4_cache_tracks_sfo_changes_and_keeps_playstation_platforms_separate() {
        let files = Files::new();
        let boot = game(&files, "game", "CUSA12345");
        let param = boot.parent().unwrap().join("sce_sys/param.sfo");
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps4, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "CUSA-12345"
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps4, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        assert!(cached_identity(&boot, System::Ps3, Some(&conn), &|| false).is_none());
        fs::write(&param, ps3::tests::sfo("CUSA-54321")).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps4, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "CUSA-54321"
        );
        fs::remove_file(&param).unwrap();
        assert!(cached_identity(&boot, System::Ps4, Some(&conn), &|| false).is_none());
        fs::write(&param, ps3::tests::sfo("CUSA23456")).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps4, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "CUSA-23456"
        );
        assert_eq!(fs::read(&boot).unwrap(), b"executable is not read");
    }
    #[test]
    fn ps3_and_ps4_pkg_paths_never_probe_nearby_metadata_or_executable_files() {
        let files = Files::new();
        let boot = game(&files, "game", "CUSA12345");
        let pkg = boot.with_file_name("Example (Europe).pkg");
        fs::write(&pkg, ps3::tests::sfo("CUSA12345")).unwrap();
        for platform in ["PS3", "PS4"] {
            assert!(
                identity_checked(pkg.to_str().unwrap(), platform, &|| panic!(
                    "PKGs must skip internal identification"
                ))
                .is_none()
            );
        }
        // Also skip PKGs placed in a valid PS3 USRDIR with an adjacent SFO.
        let ps3 = ps3::tests::game(&files, "disc/PS3_GAME", "BLUS30581");
        let pkg = ps3.with_file_name("Example.pkg");
        fs::write(&pkg, b"not opened").unwrap();
        assert!(identity_checked(pkg.to_str().unwrap(), "PS3", &|| panic!(
            "PKGs must be skipped"
        ))
        .is_none());
    }
}
