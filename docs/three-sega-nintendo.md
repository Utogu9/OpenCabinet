# Converted Sega and Nintendo cases

Mega Drive/Genesis, Wii, Wii U, GameCube, DS and 3DS use the shared Three.js
geometry adapter through `three-converted-viewer.js`. Geometry comes from
`game-box.js` and `dvd-case.js`; no external model files are required. The
construction DOM is removed after conversion and the resulting templates are
cached in memory, separately for regional shapes such as Japanese GameCube
and European DS cases.

Genesis, GameCube and DS use the same matte dark-gray shell material as PS2.
Wii and 3DS retain white plastic; Wii U uses solid blue plastic. The Genesis
cartridge uses neutral black plastic. Raised molding, cutouts, manual clips and security
catches are retained from each platform's construction. Optional console marks
use the downloaded platform artwork, including updates after a viewer opens.

Disc cases preserve the 120 mm DVD or 80 mm GameCube miniDVD, reflective disc
artwork and an outer sleeve film. Genesis and handheld cases use cartridge
geometry, preferring label images over cartridge photographs. Genesis expands
the artwork area when only a full cartridge photograph is available.

PDF/CBZ booklets retain their aspect ratio and use the existing reader and
manual controls. This includes square DS/3DS booklets and the original small
Genesis retaining tabs. The same lifecycle supports the sidebar, fullscreen
and couch mode. Conversion or WebGL failures retain the CSS fallback.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-converted-browser.test.cjs
```

The test covers all six families plus Japanese GameCube and European DS,
cartridge artwork replacement, optional marks, manual extraction, rendering at
small sizes, and GPU context retirement/restoration.
