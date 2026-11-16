//! Bounded ZArchive v1 metadata and random-access reads of selected blocks.
//! Implements the documented on-disk layout independently; no archive extraction.
use super::{be32, be64, invalid, read, Budget, Span};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

const BLOCK: usize = 65536;
pub(super) struct Archive {
    file: File,
    data: Span,
    records: Span,
    names: Span,
    tree: Span,
    cached: Option<(u64, Vec<u8>)>,
}
impl Archive {
    pub(super) fn open(path: &Path, budget: &mut Budget<'_>) -> io::Result<Self> {
        budget.check()?;
        let mut file = File::open(path)?;
        let whole = Span {
            offset: 0,
            size: file.metadata()?.len(),
        };
        if whole.size < 144 {
            return Err(invalid());
        }
        let mut footer = [0; 144];
        read(&mut file, whole, whole.size - 144, &mut footer, budget)?;
        if be64(&footer[128..136])? != whole.size
            || be32(&footer[136..140])? != 0x61bf3a01
            || be32(&footer[140..])? != 0x169f52d6
        {
            return Err(invalid());
        }
        let sections = footer[..96]
            .chunks_exact(16)
            .map(|bytes| {
                Ok(Span {
                    offset: be64(&bytes[..8])?,
                    size: be64(&bytes[8..])?,
                })
            })
            .collect::<io::Result<Vec<_>>>()?;
        for span in &sections {
            if span
                .offset
                .checked_add(span.size)
                .is_none_or(|end| end > whole.size - 144)
            {
                return Err(invalid());
            }
        }
        let mut ranges = sections
            .iter()
            .filter(|span| span.size != 0)
            .copied()
            .collect::<Vec<_>>();
        ranges.sort_by_key(|span| span.offset);
        if ranges
            .windows(2)
            .any(|pair| pair[0].offset + pair[0].size > pair[1].offset)
            || sections[0].size == 0
            || sections[1].size == 0
            || sections[1].size % 40 != 0
            || sections[3].size < 16
            || sections[3].size % 16 != 0
        {
            return Err(invalid());
        }
        Ok(Self {
            file,
            data: sections[0],
            records: sections[1],
            names: sections[2],
            tree: sections[3],
            cached: None,
        })
    }
    fn is_executable_name(&mut self, offset: u32, budget: &mut Budget<'_>) -> io::Result<bool> {
        let mut offset = u64::from(offset);
        let mut byte = [0];
        read(&mut self.file, self.names, offset, &mut byte, budget)?;
        offset += 1;
        let mut length = u16::from(byte[0] & 0x7f);
        if byte[0] & 0x80 != 0 {
            read(&mut self.file, self.names, offset, &mut byte, budget)?;
            offset += 1;
            length |= u16::from(byte[0]) << 7;
        }
        if offset
            .checked_add(u64::from(length))
            .is_none_or(|end| end > self.names.size)
        {
            return Err(invalid());
        }
        if length != 11 {
            return Ok(false);
        }
        let mut name = [0; 11];
        read(&mut self.file, self.names, offset, &mut name, budget)?;
        Ok(name.eq_ignore_ascii_case(b"default.xex"))
    }
    pub(super) fn executable(&mut self, budget: &mut Budget<'_>) -> io::Result<Option<Span>> {
        let mut root = [0; 16];
        read(&mut self.file, self.tree, 0, &mut root, budget)?;
        if be32(&root[..4])? & 0x80000000 != 0 {
            return Err(invalid());
        }
        let start = u64::from(be32(&root[4..8])?);
        let count = u64::from(be32(&root[8..12])?);
        if start == 0
            || count > 65536
            || start
                .checked_add(count)
                .is_none_or(|end| end > self.tree.size / 16)
        {
            return Err(invalid());
        }
        let mut entries = vec![0; (count * 16) as usize];
        read(&mut self.file, self.tree, start * 16, &mut entries, budget)?;
        let mut found = None;
        for entry in entries.chunks_exact(16) {
            budget.check()?;
            let name = be32(&entry[..4])?;
            if name & 0x80000000 == 0 || !self.is_executable_name(name & 0x7fffffff, budget)? {
                continue;
            }
            let high = be32(&entry[12..16])?;
            let offset = u64::from(be32(&entry[4..8])?) | (u64::from(high & 0xffff) << 32);
            let size = u64::from(be32(&entry[8..12])?) | (u64::from(high & 0xffff0000) << 16);
            let capacity = (self.records.size / 40)
                .checked_mul(16 * BLOCK as u64)
                .ok_or_else(invalid)?;
            if found.is_some()
                || size < 24
                || offset.checked_add(size).is_none_or(|end| end > capacity)
            {
                return Err(invalid());
            }
            found = Some(Span { offset, size });
        }
        Ok(found)
    }
    fn block(&mut self, index: u64, budget: &mut Budget<'_>) -> io::Result<()> {
        budget.check()?;
        if self
            .cached
            .as_ref()
            .is_some_and(|(cached, _)| *cached == index)
        {
            return Ok(());
        }
        let mut record = [0; 40];
        read(
            &mut self.file,
            self.records,
            (index / 16).checked_mul(40).ok_or_else(invalid)?,
            &mut record,
            budget,
        )?;
        let mut offset = be64(&record[..8])?;
        let slot = (index % 16) as usize;
        let size =
            |i: usize| u64::from(u16::from_be_bytes([record[8 + 2 * i], record[9 + 2 * i]])) + 1;
        for i in 0..slot {
            offset = offset.checked_add(size(i)).ok_or_else(invalid)?;
        }
        let mut compressed = vec![0; size(slot) as usize];
        read(&mut self.file, self.data, offset, &mut compressed, budget)?;
        budget.account(BLOCK)?;
        let bytes = if compressed.len() == BLOCK {
            compressed
        } else {
            // ZArchive frames always produce exactly 64 KiB. Limit the match
            // window before the decoder allocates from an untrusted header.
            let decoder = ruzstd::decoding::StreamingDecoder::new_with_max_window_size(
                compressed.as_slice(),
                BLOCK as u64,
            )
            .map_err(|_| invalid())?;
            let mut bytes = Vec::with_capacity(BLOCK);
            decoder.take(BLOCK as u64 + 1).read_to_end(&mut bytes)?;
            if bytes.len() != BLOCK {
                return Err(invalid());
            }
            bytes
        };
        budget.check()?;
        self.cached = Some((index, bytes));
        Ok(())
    }
    pub(super) fn read(
        &mut self,
        file: Span,
        offset: u64,
        mut bytes: &mut [u8],
        budget: &mut Budget<'_>,
    ) -> io::Result<()> {
        if offset
            .checked_add(bytes.len() as u64)
            .is_none_or(|end| end > file.size)
        {
            return Err(invalid());
        }
        let mut offset = file.offset.checked_add(offset).ok_or_else(invalid)?;
        while !bytes.is_empty() {
            self.block(offset / BLOCK as u64, budget)?;
            let start = (offset % BLOCK as u64) as usize;
            let count = bytes.len().min(BLOCK - start);
            let data = &self.cached.as_ref().ok_or_else(invalid)?.1;
            bytes[..count].copy_from_slice(&data[start..start + count]);
            bytes = &mut bytes[count..];
            offset += count as u64;
        }
        budget.check()
    }
}
