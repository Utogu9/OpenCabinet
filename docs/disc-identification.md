# ROM and optical disc identification

Automatic OpenCabinet-BDD matching reads product identifiers before falling
back to the reviewed title and original filename. Manual searches and explicit
catalog selections keep their existing behavior. No emulator, BIOS, keys,
external CHD tool or full-disc hash is required. Source files are read only.

**Preferences → Game Metadata → Identify games by serial or product code**
controls internal identification globally. It defaults to enabled for new and
existing preferences. Disabling it skips both ROM inspection and cached internal
identities for all platforms, during import and automatic artwork matching;
title/filename lookup, explicit searches and saved catalog associations remain
available. Changes apply when saved, without restarting. Restoring metadata or
all preference defaults re-enables it. The setting is included in the existing
preference backups.

| Platform | Identifier | Supported containers |
| --- | --- | --- |
| PlayStation | `BOOT` executable in ISO 9660 `SYSTEM.CNF` | CUE/BIN, CHD, ISO, ISO.GZ |
| PlayStation 2 | `BOOT2` executable in ISO 9660 `SYSTEM.CNF` | CUE/BIN, CHD, ISO, ISO.GZ |
| PlayStation 3 | `TITLE_ID` in the adjacent `PARAM.SFO` | Extracted folders launched through `USRDIR/EBOOT.BIN` |
| PlayStation 4 | `TITLE_ID` in `sce_sys/param.sfo` | Extracted folders launched through `eboot.bin` |
| PSP | `DISC_ID` in `PSP_GAME/PARAM.SFO` or the PBP metadata section | ISO, CSO, CHD, PBP |
| Dreamcast | Product number and territory flags in the `IP.BIN` boot header | CUE/BIN, CHD |
| Saturn | Product number and area symbols in the `IP.BIN` boot header | CUE/BIN, CHD |
| Mega-CD / Sega CD | Product field following the disc system header | CUE/BIN, CHD |
| Wii | Six-byte game ID (`ID6`) in the unencrypted disc header | ISO, RVZ, WBFS |
| GameCube | Six-byte game ID (`ID6`) in the disc header | ISO, RVZ |
| Mega Drive / Genesis | Product code and revision in the ROM header | GEN, MD, BIN (linear dumps) |

For PlayStation, `cdrom:\SLUS_009.99;1` becomes `SLUS-00999`. `BOOT` and
`BOOT2` are deliberately distinct; selecting PS1 must not return a PS2 identity.
Discs without a recognizable product-coded boot executable use name matching.

For PlayStation 3, the reader follows the selected `USRDIR/EBOOT.BIN` to
`../PARAM.SFO`: usually `PS3_GAME/PARAM.SFO`, or the installed game's root.
It reads the SFO's `TITLE_ID` without opening or executing EBOOT. For example,
`BLUS30581` becomes `BLUS-30581`; catalogs using either spelling are supported.
Known territory prefixes supply regional hints; unknown territories remain
unknown. The binary PSF header, entry tables, string types and bounds are
validated, with a 1 MiB file limit. Only the adjacent directory is examined,
including lower/mixed-case SFO filenames on Linux; no recursive asset search
is performed. See the format definitions in
[RPCS3's SFO reader](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/Loader/PSF.cpp).
OpenCabinet implements an independent, bounded reader.

PS3 results have their own cache namespace and include the SFO's path, size
and modification time in their signature. Adding, changing or removing the
SFO invalidates a cached result even if EBOOT is unchanged. Missing, damaged
or unmatched metadata falls back to the reviewed title and filename. The
global serial-matching preference also controls this reader. This adds folder
support, not PS3 ISO or PKG parsing, and requires no keys or RPCS3 installation.

PlayStation 4 reads `sce_sys/param.sfo` relative to the selected `eboot.bin`.
It shares the bounded SFO parser, accepting PSF versions 1.0 and 1.1 and
validating PS4 `CUSA` identifiers separately from PS3. `CUSA12345` and
`CUSA-12345` catalog keys are both supported. The numeric identifier does not
encode a dependable territory, so region information comes from the catalog,
not an assumption that CUSA means USA. Path components support lower/mixed
case without recursively searching the game. See
[shadPS4's SFO reader](https://github.com/shadps4-emu/shadPS4/blob/main/src/core/file_format/psf.cpp).
The PS4 cache has a separate namespace and tracks SFO creation, changes and
removal, just like PS3. Disabling serial matching skips both readers.

PS3 and PS4 `.pkg` files are deliberately excluded from this folder-based
identification. They keep existing title/filename matching even when a valid
SFO or EBOOT is nearby. The reader does not unpack or decrypt packages.

PSP uses `DISC_ID`, not PS3/PS4's `TITLE_ID`. The shared SFO parser reads it
from `PSP_GAME/PARAM.SFO` inside an ISO 9660 disc, or the first metadata
section of a PBP. `ULUS10001` becomes `ULUS-10001`; compact catalog keys are
also supported. Recognized territory prefixes provide regional hints, while
unknown territories remain unknown. Only PSP game categories `UG` and `EG`
are accepted, with PSP product prefixes, excluding normal homebrew, UMD video,
PS1 Classics and PS3/PS4 identifiers. Modified games may still share identifiers.

CSO versions 0/1 support stored and raw-DEFLATE frames, including zero
`header_size`, aligned index offsets and larger frames. The reader fetches
only the required index entries and frames, caching the most recent frame.
There is no full-image conversion or index allocation. Frame size is bounded
to 1 MiB, logical image size to 8 GiB, alignment to 20 bits, and decompression
uses the shared time/output budgets. Unsupported CSO variants fall back to
name matching. CHD uses the existing bounded optical reader. PBP checks its
section offsets and reads at most 1 MiB of SFO metadata without decrypting or
opening its executable payload. Missing, malformed or unknown identifiers
keep title/filename matching. PSP identities use a separate cache namespace
and the global serial-matching preference. The default PSP import extensions
are unchanged; CHD identification is available when that extension is selected.
See PPSSPP's [disc reader](https://github.com/hrydgard/ppsspp/blob/master/Core/FileSystems/BlockDevices.cpp),
[PBP layout](https://github.com/hrydgard/ppsspp/blob/master/Core/ELF/PBPReader.cpp)
and [SFO loading](https://github.com/hrydgard/ppsspp/blob/master/Core/PSPLoaders.cpp).
OpenCabinet implements its own metadata-only readers and requires no keys.

Dreamcast headers start with `SEGA SEGAKATANA ` and carry a ten-byte product
number at offset `0x40`, plus territory flags at `0x30`. The reader examines
data-track starts, skipping audio. This handles the low-density data area,
audio and high-density game area of GD-ROM CHDs, as well as CUE data tracks
following audio. CHD tracks have four-frame alignment; stored pregaps and
GD-ROM padding are accounted for without decompressing the intervening audio.
The header layout and track conventions can be checked in
[Flycast's header definition](https://github.com/flyinghead/flycast/blob/master/core/reios/reios.h)
and [CHD reader](https://github.com/flyinghead/flycast/blob/master/core/imgread/chd.cpp).
OpenCabinet implements its own bounded metadata reader.

Dreamcast catalog keys can differ from the boot product number: for example,
`MK-51035` may appear as `51035` for USA or `MK-51035-50` for Europe.
Matching considers these packaging variants and filters known regional
conflicts using the header's `J`, `U` and `E` flags. It never reduces arbitrary
third-party product numbers to digits alone. Multiple compatible releases
remain subject to the existing region and ambiguity rules.

Saturn shares the bounded Sega data-track reader, using its own
`SEGA SEGASATURN ` signature. Its ten-byte product number starts at `0x20`
and its sixteen-byte territory field at `0x40`, unlike Dreamcast. `J`, `U`
and `E` flags restrict known Japanese, North American and European matches;
unrecognized territory codes do not invent a region. Numeric Sega catalog
keys and `MK-` packaging variants use the same matching rules as Dreamcast,
without applying them to other platforms. A Dreamcast header is not accepted
as Saturn. The header fields can be checked against
[Yabause's disc-header reader](https://github.com/Yabause/yabause/blob/master/yabause/src/cs2.c).
Only the required CHD hunks are decoded; no conversion, BIOS or external tool
is needed. Saturn results use their own cache namespace.

Mega-CD/Sega CD uses a `SEGADISCSYSTEM` signature and a Mega Drive-style
product field at `0x180`. The reader removes the `GM`/`AI` program-type prefix
and spacing, preserving the product and revision (for example,
`GM MK-4401 -00` becomes `MK-4401-00`). Catalog lookup also tries the product
without its two-digit revision, numeric Sega keys such as `4401`, and regional
packaging suffixes such as `4427-50` and `T-125045-50`. These transformations
are restricted to Sega CD, not applied to other platforms' identifiers.

Recognized regional security-code markers at `0x20B` distinguish USA (`0x7A`),
Japan (`0xA1`) and Europe (`0x64`). Other values use explicit `J`/`U`/`E`
territory flags at `0x1F0`; an unknown marker alone does not imply USA. Blank,
all-zero or non-product headers fall back to names. See the product and region
fields in [Genesis Plus GX's header reader](https://github.com/ekeeke/Genesis-Plus-GX/blob/master/core/loadrom.c).
OpenCabinet reads these fields independently; it does not run the security
code or require a BIOS. The cache namespace is separate from Saturn and Dreamcast.

Wii identification reads only the disc header: ID6 at offset `0x00`, validated
against the Wii magic at `0x18`. RVZ preserves the first 128 disc bytes in its
unencrypted container header; WBFS stores a disc-header copy in its disc-info
area. Neither format requires decompressing game data, decrypting partitions,
supplying keys or installing Dolphin. See Dolphin's
[RVZ format specification](https://github.com/dolphin-emu/dolphin/blob/master/docs/WiaAndRvz.md)
and [WBFS reader](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/DiscIO/WbfsBlob.cpp)
for the container layouts. OpenCabinet reads these layouts independently.

The Wii catalog may identify a disc by its printed product code rather than
ID6: `RMGE01` corresponds to product codes beginning with `RVL-RMGE-`, such as
`RVL-RMGE-USA`. A direct ID6 key is preferred when available. Product-code
variants retain the existing ambiguity rules; revisions and modified games
may share an ID. Digital title IDs are not inferred from these disc IDs.

Single-game WBFS files are supported, including the first file of a split
`.wbfs`/`.wbf1` set: its identifier is in the main file. Multi-game WBFS
filesystems are not treated as one game. Container signatures, bounds and
RVZ compatibility versions are checked; GameCube headers are rejected in the
Wii reader. This is identification, not a container-integrity check.

GameCube shares the bounded ISO/RVZ header reader, but uses its own magic
at `0x1C` and RVZ disc type `1` (Wii uses type `2`). A Wii file cannot be
identified as GameCube merely by selecting that platform. Catalog product
codes such as `DL-DOL-GAFE-USA` or `DOL-GAFE-USA` are looked up from `GAFE01`,
preserving the regional character and preferring an exact ID6 key when present.
Each platform has a separate cache entry. Disc number and revision do not
change ID6, so discs of one game may share an ID; existing multi-disc handling
and catalog ambiguity rules still apply.

The reused Datel `DTLX01` identifier is excluded from automatic GameCube
matching because it does not identify a unique product. See
[Dolphin's GameCube identification notes](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/DiscIO/VolumeGC.cpp).

Mega Drive/Genesis cartridges also have product codes. The reader examines
only the first 512 bytes of a linear ROM: console signature at `0x100`,
product/revision at `0x180` and territory at `0x1F0`. Recognized `GM`, `GK`,
`MK` and `AI` program-type prefixes and spaces are removed where appropriate.
`GM MK-1042 -00` becomes `MK-1042-00`; `MK 00001019-00` becomes
`00001019-00`. A header with no separate type, such as `MK-1136`, keeps
that product code. `T-081096 00` is normalized to `T-081096-00`.
Leading zeroes and revision digits are preserved, matching the repository's
actual cartridge identifiers without applying Sega CD's revision-removal rules.

Territories can be `J`/`U`/`E` combinations or hexadecimal bitmasks (`1` Japan,
`4` North America, `8` Europe). Recognized country names are also accepted;
unrecognized values leave the region unknown. Word-byte-swapped linear dumps
are recognized without changing the source file. Interleaved SMD archives and
32X/Sega CD headers are not treated as Genesis ROMs.

These are product codes, not unique serial numbers for individual cartridges.
Blank, malformed and generic zero/one product codes are excluded: catalog
entries such as `00000000-00` and `00000001-00` combine unrelated prototypes
or games. Missing or unsuitable codes use the existing filename/title matching.
The header layout and region masks are documented in
[Genesis Plus GX's header reader](https://github.com/ekeeke/Genesis-Plus-GX/blob/master/core/loadrom.c).
OpenCabinet reads those fields independently and never executes ROM code.
Genesis results use the existing cache table with a separate `megadrive` key.

Results, including missing identifiers, are cached in `disc_identities` with
separate keys for each platform. Changes to a source file invalidate its entry;
for CUE images, the signature includes every referenced data-track file.
The previous PS2 cache is retained and migrated automatically. Cache failures
do not prevent importing. Reads honor cancellation and the existing three-second
and decompression limits described in [PS2 identification](ps2-identification.md).

A product number is not an exact dump hash: revisions, modified releases and
some discs may share it. Unsupported or damaged images fall back to filenames;
the reader does not add GDI, CDI, parent-dependent CHD or disc-integrity scanning.
