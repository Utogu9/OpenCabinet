# PS2 serial identification

OpenCabinet checks the contents of PS2 `.iso`, `.iso.gz`, `.chd` and `.cue` images when matching
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

## CD images: CUE/BIN and CHD

For a `.cue`, the reader opens the referenced binary data track, respecting its
`INDEX 01` offset and sector layout. MODE1/2048, MODE1/2352, MODE2/2336 and
MODE2/2352 are supported. Stored pregaps are skipped; virtual `PREGAP` directives
do not advance the binary file. Additional audio tracks are not inspected.
Quoted filenames, relative paths and Unicode CUE files are supported.

For `.chd`, the embedded Rust CHD decoder reads the track metadata and only
decompresses the hunks needed for ISO directories and `SYSTEM.CNF`. CD sector
headers and subchannel data are excluded from the logical ISO view. CHD DVD
images with 2048-byte units are supported too. No `chdman` installation, temporary
extraction or conversion is required. Parent-dependent CHDs, unsupported track
layouts and unreadable images fall back to the existing name-based matching.

This PS2 path identifies `BOOT2` executables. The shared reader also supports
[PS1 and Dreamcast identification](disc-identification.md).

## Limits and caching

The serial is cached in the library's `disc_identities` table, keyed by path
and platform. Existing `ps2_disc_identities` entries are migrated automatically. The cache
includes file path, size, modification timestamp and the index's presence,
size and timestamp. Changing either source invalidates the cached result.
For CUE images, the signature also includes the referenced data-track path,
size and timestamp: replacing the BIN invalidates the cache even if the CUE
itself is unchanged. CHD signatures track the CHD file itself.
Unavailable or read-only caches do not prevent importing.

Each inspection has a three-second budget, checks import cancellation, and
limits inflated output to 256 MiB across its reads. Without an index, reaching
metadata stored far into a large gzip may exceed those limits and fall back to
filename matching. Directory and configuration-file reads are bounded too.
Only metadata is inspected; this is not a full image integrity check.

A product serial is not an exact dump identity. Modified games, reprints and
some revisions can retain the same serial, so this cannot reliably distinguish
every hack, Greatest Hits release or disc revision.
