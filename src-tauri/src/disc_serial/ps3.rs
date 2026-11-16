//! Read the small PARAM.SFO beside a PS3 game's USRDIR, never the executable.
use super::{sfo, Budget, Identity};
use std::{
    io,
    path::{Path, PathBuf},
};

pub(super) fn game_directory(boot: &Path) -> Option<&Path> {
    if !boot.file_name()?.eq_ignore_ascii_case("EBOOT.BIN") {
        return None;
    }
    let usrdir = boot.parent()?;
    usrdir
        .file_name()?
        .eq_ignore_ascii_case("USRDIR")
        .then(|| usrdir.parent())
        .flatten()
}

pub(super) fn metadata_path(boot: &Path) -> io::Result<Option<PathBuf>> {
    let Some(directory) = game_directory(boot) else {
        return Ok(None);
    };
    sfo::component(directory, "PARAM.SFO", false)
}

fn parse(bytes: &[u8]) -> io::Result<Option<Identity>> {
    let Some(value) = sfo::title_id(bytes, &[0x101])? else {
        return Ok(None);
    };
    // SFO normally uses BLUS30581; catalogs often use BLUS-30581. Accept
    // separators seen in existing SFOs, without accepting PSP/PS4 title IDs.
    let compact: String = value.chars().filter(|&c| c != '-' && c != ' ').collect();
    let id = compact.as_bytes();
    if id.len() != 9
        || !id[..4].iter().all(u8::is_ascii_uppercase)
        || !id[4..].iter().all(u8::is_ascii_digit)
        || &id[4..] == b"00000"
        || !matches!(&id[..2], b"BC" | b"BL" | b"NP")
    {
        return Ok(None);
    }
    let region = match id[2] {
        b'U' => Some("North America"),
        b'E' => Some("Europe"),
        b'J' => Some("Japan"),
        b'K' => Some("Korea"),
        _ => None,
    };
    Ok(Some(Identity {
        serial: format!("{}-{}", &compact[..4], &compact[4..]),
        regions: region.into_iter().map(str::to_owned).collect(),
    }))
}

pub(super) fn identity(boot: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let Some(path) = metadata_path(boot)? else {
        return Ok(None);
    };
    budget.check()?;
    parse(&sfo::read(&path, budget)?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::sfo::MAX_SFO;
    use crate::disc_serial::{cached_identity, identity_checked, init, tests::Files, System};
    use std::fs;

    pub fn sfo(id: &str) -> Vec<u8> {
        fields(&[
            ("CATEGORY", "DG"),
            ("TITLE", "Example title"),
            ("TITLE_ID", id),
        ])
    }
    pub fn fields(entries: &[(&str, &str)]) -> Vec<u8> {
        let keys: Vec<u8> = entries
            .iter()
            .flat_map(|(key, _)| key.bytes().chain([0]))
            .collect();
        let key_offset = 20 + entries.len() * 16;
        let data_offset = (key_offset + keys.len() + 3) & !3;
        let mut bytes = vec![0; data_offset];
        bytes[..4].copy_from_slice(b"\0PSF");
        for (offset, value) in [
            (4, 0x101),
            (8, key_offset as u32),
            (12, data_offset as u32),
            (16, entries.len() as u32),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        bytes[key_offset..key_offset + keys.len()].copy_from_slice(&keys);
        let mut key = 0u16;
        for (index, (name, value)) in entries.iter().enumerate() {
            let offset = (bytes.len() - data_offset) as u32;
            let entry = &mut bytes[20 + index * 16..36 + index * 16];
            entry[..2].copy_from_slice(&key.to_le_bytes());
            entry[2..4].copy_from_slice(&0x0204u16.to_le_bytes());
            let size = value.len() as u32 + 1;
            entry[4..8].copy_from_slice(&size.to_le_bytes());
            entry[8..12].copy_from_slice(&size.to_le_bytes());
            entry[12..16].copy_from_slice(&offset.to_le_bytes());
            bytes.extend_from_slice(value.as_bytes());
            bytes.push(0);
            key += name.len() as u16 + 1;
        }
        bytes
    }
    pub fn game(files: &Files, directory: &str, id: &str) -> PathBuf {
        let directory = files.0.join(directory);
        fs::create_dir_all(directory.join("USRDIR")).unwrap();
        fs::write(directory.join("PARAM.SFO"), sfo(id)).unwrap();
        let boot = directory.join("USRDIR/EBOOT.BIN");
        fs::write(&boot, b"not inspected executable").unwrap();
        boot
    }
    #[test]
    fn ps3_reads_only_the_adjacent_sfo_for_disc_and_installed_games() {
        let files = Files::new();
        for (directory, id, expected, regions) in [
            (
                "Wrong (Japan)/PS3_GAME",
                "BLUS30581",
                "BLUS-30581",
                vec!["North America"],
            ),
            (
                "installed/NPUB12345",
                "NPUB12345",
                "NPUB-12345",
                vec!["North America"],
            ),
            (
                "europe/PS3_GAME",
                "BLES-01234",
                "BLES-01234",
                vec!["Europe"],
            ),
            ("japan/PS3_GAME", "BLJM 12345", "BLJM-12345", vec!["Japan"]),
            ("asia/PS3_GAME", "BCAS20003", "BCAS-20003", vec![]),
        ] {
            let boot = game(&files, directory, id);
            let identity =
                identity_checked(boot.to_str().unwrap(), "Sony - PlayStation 3", &|| false)
                    .unwrap();
            assert_eq!(identity.serial, expected);
            assert_eq!(identity.regions, regions);
            assert!(
                identity_checked(boot.to_str().unwrap(), "Sony PlayStation 4", &|| false).is_none()
            );
        }
        for id in [
            "",
            "BLUS00000",
            "ULUS12345",
            "CUSA12345",
            "BLUS1234",
            "BLUS123456",
            "BLUS12X45",
        ] {
            assert!(parse(&sfo(id)).unwrap().is_none(), "{id}");
        }
        let boot = game(&files, "lower/ps3_game", "BLES01234");
        let sfo = boot.parent().unwrap().parent().unwrap().join("PARAM.SFO");
        fs::rename(&sfo, sfo.with_file_name("temporary")).unwrap();
        fs::rename(
            sfo.with_file_name("temporary"),
            sfo.with_file_name("param.sfo"),
        )
        .unwrap();
        assert_eq!(
            identity_checked(boot.to_str().unwrap(), "PS3", &|| false)
                .unwrap()
                .serial,
            "BLES-01234"
        );
        assert!(identity_checked(boot.to_str().unwrap(), "PS3", &|| true).is_none());
        let unrelated = files.write("EBOOT.BIN", b"not in USRDIR");
        assert!(identity_checked(unrelated.to_str().unwrap(), "PS3", &|| false).is_none());
    }
    #[test]
    fn ps3_rejects_truncated_overlapping_and_malformed_sfo_tables_without_panicking() {
        let valid = sfo("BLUS30581");
        for length in 0..valid.len() {
            assert!(parse(&valid[..length]).is_err(), "truncated at {length}");
        }
        for (offset, value) in [
            (4, 0x100u32),
            (8, 1),
            (12, u32::MAX),
            (16, u32::MAX),
            (20 + 32 + 4, u32::MAX),
            (20 + 32 + 8, 1),
            (20 + 32 + 12, u32::MAX),
        ] {
            let mut bad = valid.clone();
            bad[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
            assert!(parse(&bad).is_err(), "offset {offset}");
        }
        let mut duplicate = valid.clone();
        duplicate[20..22].copy_from_slice(&valid[52..54]);
        assert!(parse(&duplicate).is_err());
        let mut binary_id = valid.clone();
        binary_id[54..56].copy_from_slice(&0x0404u16.to_le_bytes());
        assert!(parse(&binary_id).is_err());
        let files = Files::new();
        let boot = game(&files, "oversized/PS3_GAME", "BLUS30581");
        fs::write(
            boot.parent().unwrap().parent().unwrap().join("PARAM.SFO"),
            vec![0; MAX_SFO + 1],
        )
        .unwrap();
        assert!(identity_checked(boot.to_str().unwrap(), "PS3", &|| false).is_none());
    }
    #[test]
    fn ps3_cache_follows_sfo_creation_changes_and_removal_without_modifying_eboot() {
        let files = Files::new();
        let boot = game(&files, "game/PS3_GAME", "BLUS30581");
        let sfo = boot.parent().unwrap().parent().unwrap().join("PARAM.SFO");
        let executable = fs::read(&boot).unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps3, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "BLUS-30581"
        );
        conn.execute(
            "UPDATE disc_identities SET identity='{\"serial\":\"cached\"}'",
            [],
        )
        .unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps3, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "cached"
        );
        // Different length makes invalidation deterministic even on coarse clocks.
        fs::write(&sfo, self::sfo("BLES-01234")).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps3, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "BLES-01234"
        );
        fs::remove_file(&sfo).unwrap();
        assert!(cached_identity(&boot, System::Ps3, Some(&conn), &|| false).is_none());
        fs::write(&sfo, self::sfo("BLJM12345")).unwrap();
        assert_eq!(
            cached_identity(&boot, System::Ps3, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "BLJM-12345"
        );
        assert_eq!(fs::read(&boot).unwrap(), executable);
    }
}
