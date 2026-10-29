# Dreamcast case assets

`case.bin` and `case.json` contain the prepared geometry used by the WebGL
viewer. They are adapted from **Compact disc and case** by **effe**, released
under **Creative Commons Zero (CC0 / Public Domain)**.

- Original source: <http://www.blendswap.com/blends/view/2841>
- Original licensing notice: [LICENSE-CC0.txt](LICENSE-CC0.txt)
- CC0 information: <https://creativecommons.org/publicdomain/zero/1.0/>

OpenCabinet's conversion separates the lid, rear shell, booklet and disc,
defines their hinge and artwork coordinates, and removes duplicate geometry.
These prepared files are distributed with the application. Builds and tests
use them directly and do not load or convert the original authoring files.

`ribs-height.svg` is generated from OpenCabinet's original ridge pattern in
`src/assets/textures/cd-case-ribs.svg`, covered by the project's MIT license.

`insert.webp` and `insert2.webp` are replacement fallback strip images supplied
separately for OpenCabinet. They are not part of the original model's CC0
release. Console names and logos remain associated with their respective
rights holders; the model's CC0 notice does not license those marks.

The viewer uses the game's own inlay when available. Game covers, disc artwork
and PDF manuals are supplied by the user and are not included in this folder.
