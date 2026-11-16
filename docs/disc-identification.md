# Optical disc identification

Automatic OpenCabinet-BDD matching reads product identifiers before falling
back to the reviewed title and original filename. Manual searches and explicit
catalog selections keep their existing behavior. No emulator, BIOS, keys,
external CHD tool or full-disc hash is required. Source files are read only.

| Platform | Identifier | Supported containers |
| --- | --- | --- |
| PlayStation | `BOOT` executable in ISO 9660 `SYSTEM.CNF` | CUE/BIN, CHD, ISO, ISO.GZ |
| PlayStation 2 | `BOOT2` executable in ISO 9660 `SYSTEM.CNF` | CUE/BIN, CHD, ISO, ISO.GZ |
| Dreamcast | Product number and territory flags in the `IP.BIN` boot header | CUE/BIN, CHD |

For PlayStation, `cdrom:\SLUS_009.99;1` becomes `SLUS-00999`. `BOOT` and
`BOOT2` are deliberately distinct; selecting PS1 must not return a PS2 identity.
Discs without a recognizable product-coded boot executable use name matching.

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

Results, including missing identifiers, are cached in `disc_identities` with
separate keys for each platform. Changes to a source file invalidate its entry;
for CUE images, the signature includes every referenced data-track file.
The previous PS2 cache is retained and migrated automatically. Cache failures
do not prevent importing. Reads honor cancellation and the existing three-second
and decompression limits described in [PS2 identification](ps2-identification.md).

A product number is not an exact dump hash: revisions, modified releases and
some discs may share it. Unsupported or damaged images fall back to filenames;
the reader does not add GDI, CDI, parent-dependent CHD or disc-integrity scanning.
