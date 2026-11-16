//! Bounded PSF metadata parsing shared by extracted PlayStation games.
use super::{invalid, u32le, Budget};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};

pub(super) const MAX_SFO: usize = 1024 * 1024;

pub(super) fn component(
    directory: &Path,
    name: &str,
    directory_entry: bool,
) -> io::Result<Option<PathBuf>> {
    let expected = directory.join(name);
    match fs::metadata(&expected) {
        Ok(meta) if (directory_entry && meta.is_dir()) || (!directory_entry && meta.is_file()) => {
            return Ok(Some(expected))
        }
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    // Match the scanner's support for lower/mixed-case extracted folders on
    // Linux. Only inspect this known directory; never search the game tree.
    let mut found = None;
    for (index, entry) in fs::read_dir(directory)?.enumerate() {
        if index >= 256 {
            return Err(invalid());
        }
        let entry = entry?;
        if !entry.file_name().eq_ignore_ascii_case(name) {
            continue;
        }
        let kind = entry.file_type()?;
        if (directory_entry && kind.is_dir()) || (!directory_entry && kind.is_file()) {
            if found.is_some() {
                return Ok(None); // Ambiguous case variants on a case-sensitive filesystem.
            }
            found = Some(entry.path());
        }
    }
    Ok(found)
}

pub(super) fn title_id<'a>(bytes: &'a [u8], versions: &[u32]) -> io::Result<Option<&'a str>> {
    if bytes.len() < 20 || &bytes[..4] != b"\0PSF" || !versions.contains(&u32le(&bytes[4..8])?) {
        return Err(invalid());
    }
    let keys = u32le(&bytes[8..12])? as usize;
    let data = u32le(&bytes[12..16])? as usize;
    let count = u32le(&bytes[16..20])? as usize;
    if count > 1024 || keys < 20 + 16 * count || data < keys || data > bytes.len() {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    let mut title_id = None;
    for entry in bytes[20..20 + count * 16].chunks_exact(16) {
        let key = keys + u16::from_le_bytes([entry[0], entry[1]]) as usize;
        let format = u16::from_le_bytes([entry[2], entry[3]]);
        let length = u32le(&entry[4..8])? as usize;
        let capacity = u32le(&entry[8..12])? as usize;
        let offset = data
            .checked_add(u32le(&entry[12..16])? as usize)
            .ok_or_else(invalid)?;
        let key_bytes = bytes.get(key..data).ok_or_else(invalid)?;
        let end = key_bytes.iter().position(|&b| b == 0).ok_or_else(invalid)?;
        let key = &key_bytes[..end];
        if key.is_empty()
            || !seen.insert(key)
            || length > capacity
            || capacity == 0
            || offset
                .checked_add(capacity)
                .is_none_or(|end| end > bytes.len())
        {
            return Err(invalid());
        }
        if key == b"TITLE_ID" {
            if !matches!(format, 0x0204 | 0x0004) {
                return Err(invalid());
            }
            let value = &bytes[offset..offset + length];
            let end = value.iter().position(|&b| b == 0).unwrap_or(value.len());
            if value[end..].iter().any(|&b| b != 0) {
                return Err(invalid());
            }
            title_id = std::str::from_utf8(&value[..end]).ok().map(str::trim);
        }
    }
    Ok(title_id)
}

pub(super) fn read(path: &Path, budget: &mut Budget<'_>) -> io::Result<Vec<u8>> {
    budget.check()?;
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_SFO as u64 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.take((MAX_SFO + 1) as u64).read_to_end(&mut bytes)?;
    budget.check()?;
    if bytes.len() > MAX_SFO {
        return Err(invalid());
    }
    Ok(bytes)
}
