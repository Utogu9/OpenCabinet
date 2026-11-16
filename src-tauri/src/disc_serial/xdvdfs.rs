//! Read a named root executable from Xbox/Xbox 360 XDVDFS disc partitions.
use super::{invalid, u32le, Budget};
use std::{
    collections::HashSet,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
};

#[derive(Clone, Copy)]
pub(super) struct Span {
    pub(super) offset: u64,
    pub(super) size: u64,
}
pub(super) fn read(
    file: &mut File,
    span: Span,
    offset: u64,
    bytes: &mut [u8],
    budget: &mut Budget<'_>,
) -> io::Result<()> {
    budget.check()?;
    if offset
        .checked_add(bytes.len() as u64)
        .is_none_or(|end| end > span.size)
    {
        return Err(invalid());
    }
    file.seek(SeekFrom::Start(
        span.offset.checked_add(offset).ok_or_else(invalid)?,
    ))?;
    file.read_exact(bytes)?;
    budget.check()
}
pub(super) fn executable(
    file: &mut File,
    filename: &[u8],
    budget: &mut Budget<'_>,
) -> io::Result<Option<Span>> {
    let whole = Span {
        offset: 0,
        size: file.metadata()?.len(),
    };
    for base in [0, 0xfb20, 0x20600, 0x2080000, 0xfd90000, 0x18300000] {
        let offset = base + 32 * 2048;
        if offset + 32 > whole.size {
            continue;
        }
        let mut header = [0; 32];
        read(file, whole, offset, &mut header, budget)?;
        if &header[..20] != b"MICROSOFT*XBOX*MEDIA" {
            continue;
        }
        let root = Span {
            offset: base + u64::from(u32le(&header[20..24])?) * 2048,
            size: u64::from(u32le(&header[24..28])?),
        };
        if !(14..=4 * 1024 * 1024).contains(&root.size)
            || root
                .offset
                .checked_add(root.size)
                .is_none_or(|end| end > whole.size)
        {
            return Err(invalid());
        }
        let mut directory = vec![0; root.size as usize];
        read(file, root, 0, &mut directory, budget)?;
        let mut stack = vec![0usize];
        let mut visited = HashSet::new();
        let mut found = None;
        while let Some(offset) = stack.pop() {
            budget.check()?;
            if visited.len() >= 65536 || !visited.insert(offset) {
                return Err(invalid());
            }
            let entry = directory
                .get(offset..)
                .filter(|b| b.len() >= 14)
                .ok_or_else(invalid)?;
            let name = entry.get(14..14 + entry[13] as usize).ok_or_else(invalid)?;
            if entry[12] & 0x10 == 0 && name.eq_ignore_ascii_case(filename) {
                let span = Span {
                    offset: base + u64::from(u32le(&entry[4..8])?) * 2048,
                    size: u64::from(u32le(&entry[8..12])?),
                };
                if span.size < 24
                    || span
                        .offset
                        .checked_add(span.size)
                        .is_none_or(|end| end > whole.size)
                    || found.is_some()
                {
                    return Err(invalid());
                }
                found = Some(span);
            }
            for child in [
                u16::from_le_bytes([entry[0], entry[1]]),
                u16::from_le_bytes([entry[2], entry[3]]),
            ] {
                if child != 0 {
                    stack.push(child as usize * 4);
                }
            }
        }
        return Ok(found);
    }
    Ok(None)
}
