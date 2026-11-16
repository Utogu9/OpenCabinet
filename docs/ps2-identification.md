# PS2 serial identification

OpenCabinet checks the contents of PS2 `.iso` and `.iso.gz` images when matching
import candidates against OpenCabinet-BDD. It reads the ISO 9660 directory and
`SYSTEM.CNF`, then normalizes the executable named by `BOOT2`. For example,
`cdrom0:\SLUS_209.98;1` becomes `SLUS-20998`.

A matching catalog serial takes priority over the reviewed title, original
filename and filename region. If the serial cannot be read or is absent from
the catalog, the existing filename/title search remains available. Explicit
manual searches and selected catalog associations retain their existing behavior.
The same reader is available when existing games need a new automatic image
match. No emulator, BIOS, mounting, keys or full-disc hash is needed.

## Compressed images and PCSX2 indexes

For `Game.iso.gz`, OpenCabinet looks for `Game.iso.gz.pindex.tmp` beside it. The
existing PCSX2 `PCSX2.index.gzip.v1|` format provides compressed/uncompressed
offsets, the bit position and a 32 KiB history window. Both packed 32-bit and
64-bit headers are supported. Pointer fields in the header are ignored; they
are never dereferenced. Index sizes, ranges, checkpoint ordering, modification
dates and the gzip's uncompressed-size footer are checked before use.

An indexed read resumes raw DEFLATE with the recorded bits and history. The
decoder must preserve the bit position: shifting the input to byte zero would
break alignment when a later stored block occurs. The low-level `zlib-rs` API is
pinned to the supported version for this reason; no C zlib installation is used.

Missing, outdated or malformed indexes fall back to ordinary gzip reads.
OpenCabinet never creates, rewrites or deletes the user's `.pindex.tmp`, ISO or
gzip files. The existing index format is documented by the upstream
[PCSX2 reader](https://github.com/PCSX2/pcsx2/blob/master/pcsx2/CDVD/GzippedFileReader.cpp)
and its [checkpoint definitions](https://github.com/PCSX2/pcsx2/blob/master/pcsx2/CDVD/zlib_indexed.h).
OpenCabinet's implementation reads that format independently.

## Limits and caching

The serial is cached in the library's `ps2_disc_identities` table. The cache
includes file path, size, modification timestamp and the index's presence,
size and timestamp. Changing either source invalidates the cached result.
Unavailable or read-only caches do not prevent importing.

Each inspection has a three-second budget, checks import cancellation, and
limits inflated output to 256 MiB across its reads. Without an index, reaching
metadata stored far into a large gzip may exceed those limits and fall back to
filename matching. Directory and configuration-file reads are bounded too.
Only metadata is inspected; this is not a full image integrity check.

A product serial is not an exact dump identity. Modified games, reprints and
some revisions can retain the same serial, so this cannot reliably distinguish
every hack, Greatest Hits release or disc revision.
