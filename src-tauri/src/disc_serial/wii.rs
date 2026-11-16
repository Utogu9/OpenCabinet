//! Read unencrypted Wii ID6 headers, without opening encrypted partitions.
use super::{Budget, Identity, invalid};
use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::Path,
};

const HEADER_SIZE: usize = 0x80;
const WII_MAGIC: [u8; 4] = [0x5d, 0x1c, 0x9e, 0xa3];

fn read_at(
    file: &mut File,
    offset: u64,
    bytes: &mut [u8],
    budget: &mut Budget<'_>,
) -> io::Result<()> {
    budget.check()?;
    if offset
        .checked_add(bytes.len() as u64)
        .is_none_or(|end| end > file.metadata().map(|m| m.len()).unwrap_or(0))
    {
        return Err(invalid());
    }
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(bytes)?;
    budget.check()
}
pub(super) fn identity(path: &Path, budget: &mut Budget<'_>) -> io::Result<Option<Identity>> {
    budget.check()?;
    let mut file = File::open(path)?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut header = [0; HEADER_SIZE];
    match extension.as_str() {
        "iso" => read_at(&mut file, 0, &mut header, budget)?,
        "rvz" => {
            let mut container = [0; 0x58];
            read_at(&mut file, 0, &mut container, budget)?;
            let u32be =
                |offset| u32::from_be_bytes(container[offset..offset + 4].try_into().unwrap());
            // RVZ preserves the first 128 disc bytes verbatim in wia_disc_t,
            // after the fixed 0x48-byte file header and four u32 fields.
            let size = u32be(0x0c) as u64;
            if &container[..4] != b"RVZ\x01"
                || u32be(4) < u32be(8)
                || u32be(8) > 0x01000000
                || u32be(8) == 0
                || size < 0x90
                || 0x48 + size > file.metadata()?.len()
                || u32be(0x48) != 2
            {
                return Err(invalid());
            }
            read_at(&mut file, 0x58, &mut header, budget)?;
        }
        "wbfs" => {
            let mut container = [0; 12];
            read_at(&mut file, 0, &mut container, budget)?;
            if &container[..4] != b"WBFS"
                || !(9..=16).contains(&container[8])
                || !(15..=31).contains(&container[9])
                || container[9] < container[8]
            {
                return Err(invalid());
            }
            let sector = 1u64 << container[8];
            let declared = u32::from_be_bytes(container[4..8].try_into().unwrap()) as u64 * sector;
            if declared < sector + HEADER_SIZE as u64 || file.metadata()?.len() > declared {
                return Err(invalid());
            }
            let mut slots = vec![0; sector as usize - 12];
            read_at(&mut file, 12, &mut slots, budget)?;
            // A ROM file has a single disc in slot zero. Values are occupancy
            // flags, not byte offsets. Do not pick an arbitrary game from a
            // multi-game WBFS filesystem. Split .wbf1 data is not needed here.
            if slots[0] == 0 || slots[1..].iter().any(|slot| *slot != 0) {
                return Err(invalid());
            }
            read_at(&mut file, sector, &mut header, budget)?;
        }
        _ => return Ok(None),
    }
    if header[0x18..0x1c] != WII_MAGIC
        || !header[..6]
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    {
        return Ok(None);
    }
    let serial = std::str::from_utf8(&header[..6])
        .map_err(|_| invalid())?
        .to_owned();
    // Only unambiguous territory codes: others can denote special releases
    // across countries. The full ID still remains available for matching.
    let region = match header[3] {
        b'E' => Some("North America"),
        b'J' => Some("Japan"),
        b'P' => Some("Europe"),
        b'K' => Some("Korea"),
        _ => None,
    };
    Ok(Some(Identity {
        serial,
        regions: region.into_iter().map(str::to_owned).collect(),
    }))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::disc_serial::{System, cached_identity, init, tests::Files};
    use rusqlite::Connection;
    use std::time::Instant;

    pub(crate) fn disc(id: &str) -> Vec<u8> {
        let mut bytes = vec![0; 0x100];
        bytes[..6].copy_from_slice(id.as_bytes());
        bytes[0x18..0x1c].copy_from_slice(&WII_MAGIC);
        bytes
    }
    pub(crate) fn rvz(disc: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; 0x48 + 0xdc];
        bytes[..4].copy_from_slice(b"RVZ\x01");
        bytes[4..8].copy_from_slice(&0x01000000u32.to_be_bytes());
        bytes[8..12].copy_from_slice(&0x00030000u32.to_be_bytes());
        bytes[12..16].copy_from_slice(&0xdcu32.to_be_bytes());
        bytes[0x48..0x4c].copy_from_slice(&2u32.to_be_bytes());
        bytes[0x58..0xd8].copy_from_slice(&disc[..0x80]);
        bytes
    }
    fn wbfs(disc: &[u8], shift: u8) -> Vec<u8> {
        let sector = 1usize << shift;
        let mut bytes = vec![0; sector * 2];
        bytes[..4].copy_from_slice(b"WBFS");
        bytes[4..8].copy_from_slice(&16u32.to_be_bytes());
        bytes[8] = shift;
        bytes[9] = 21;
        bytes[12] = 1;
        bytes[sector..sector + 0x100].copy_from_slice(disc);
        bytes
    }
    fn inspect(path: &Path) -> io::Result<Option<Identity>> {
        identity(
            path,
            &mut Budget {
                started: Instant::now(),
                inflated: 0,
                cancelled: &|| false,
            },
        )
    }
    #[test]
    fn iso_rvz_and_split_wbfs_headers_identify_without_decompression_or_filename_hints() {
        let files = Files::new();
        let data = disc("RMGE01");
        for (name, bytes) in [
            ("wrong title.iso", data.clone()),
            ("wrong title.rvz", rvz(&data)),
            ("wrong title.wbfs", wbfs(&data, 9)),
            ("sector4k.wbfs", wbfs(&data, 12)),
        ] {
            let path = files.write(name, &bytes);
            let id = inspect(&path).unwrap().unwrap();
            assert_eq!(id.serial, "RMGE01");
            assert_eq!(id.regions, ["North America"]);
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        for (id, region) in [
            ("RMGJ01", "Japan"),
            ("RMGP01", "Europe"),
            ("RMGK01", "Korea"),
        ] {
            let path = files.write("other.iso", &disc(id));
            assert_eq!(inspect(&path).unwrap().unwrap().regions, [region]);
        }
    }
    #[test]
    fn malformed_foreign_and_multigame_containers_fall_back_and_cache_invalidates() {
        let files = Files::new();
        let data = disc("RMGE01");
        let path = files.write("game.iso", &data);
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert_eq!(
            cached_identity(&path, System::Wii, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "RMGE01"
        );
        let mut replacement = disc("RMGP01");
        replacement.push(0);
        std::fs::write(&path, replacement).unwrap();
        assert_eq!(
            cached_identity(&path, System::Wii, Some(&conn), &|| false)
                .unwrap()
                .serial,
            "RMGP01"
        );
        assert!(cached_identity(&path, System::Wii, Some(&conn), &|| true).is_none());
        let mut cancelled = Budget {
            started: Instant::now(),
            inflated: 0,
            cancelled: &|| true,
        };
        assert_eq!(
            identity(&path, &mut cancelled).unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
        let mut gc = data.clone();
        gc[0x18..0x1c].fill(0);
        gc[0x1c..0x20].copy_from_slice(&0xc2339f3du32.to_be_bytes());
        assert!(inspect(&files.write("gc.iso", &gc)).unwrap().is_none());
        let mut invalid = data.clone();
        invalid[0] = b'/';
        assert!(
            inspect(&files.write("bad.iso", &invalid))
                .unwrap()
                .is_none()
        );
        for (index, offset, value) in [(0, 0, 0), (1, 8, 255), (2, 9, 255), (3, 12, 0), (4, 13, 1)]
        {
            let mut bad = wbfs(&data, 9);
            bad[offset] = value;
            assert!(inspect(&files.write(&format!("bad{index}.wbfs"), &bad)).is_err());
        }
        let mut bad = rvz(&data);
        bad[8] = 2;
        assert!(inspect(&files.write("future.rvz", &bad)).is_err());
        let mut bad = rvz(&data);
        bad[0x4b] = 1;
        assert!(inspect(&files.write("gc.rvz", &bad)).is_err());
        for name in ["truncated.iso", "truncated.rvz", "truncated.wbfs"] {
            assert!(inspect(&files.write(name, b"1234")).is_err());
        }
    }
}
