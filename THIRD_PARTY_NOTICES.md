# Third-party notices

OpenCabinet's original code is licensed under [MIT](LICENSE), copyright 2026
Utogu. That license does not replace the licenses of dependencies or externally
supplied content.

## Direct software dependencies

This is an overview of the directly declared dependencies. The resolved package
and crate versions are recorded in `package-lock.json` and `src-tauri/Cargo.lock`.
Those dependencies may include additional components with their own notices.

| Component | Purpose | Upstream license |
| --- | --- | --- |
| [Tauri](https://github.com/tauri-apps/tauri), its CLI, build tools and API | Desktop application framework | MIT OR Apache-2.0 |
| [Tauri opener plugin](https://github.com/tauri-apps/plugins-workspace) | Open files and locations using the operating system | MIT OR Apache-2.0 |
| [PDF.js](https://github.com/mozilla/pdf.js) | Local PDF manual rendering | Apache-2.0; bundled resources have additional notices |
| [Three.js](https://github.com/mrdoob/three.js) | WebGL 3D rendering | MIT |
| [rusqlite](https://github.com/rusqlite/rusqlite) | SQLite access | MIT |
| [SQLite](https://www.sqlite.org/copyright.html) | Library and catalog databases | Public domain |
| [serde](https://github.com/serde-rs/serde), [serde_json](https://github.com/serde-rs/json) | Serialization | MIT OR Apache-2.0 |
| [reqwest](https://github.com/seanmonstar/reqwest) | HTTP downloads | MIT OR Apache-2.0 |
| [Tauri updater plugin](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater) | Signed application updates | MIT OR Apache-2.0 |
| [Tokio](https://github.com/tokio-rs/tokio) | Asynchronous operations | MIT |
| [quick-xml](https://github.com/tafia/quick-xml) | XML parsing | MIT |
| [zip](https://github.com/zip-rs/zip2) | ZIP archives | MIT |
| [sevenz-rust](https://github.com/dyz1990/sevenz-rust) | 7z extraction | Apache-2.0 |
| [rfd](https://github.com/PolyMeilex/rfd) | Native file dialogs | MIT |
| [unicode-normalization](https://github.com/unicode-rs/unicode-normalization) | Title normalization | MIT OR Apache-2.0 |
| [winreg](https://github.com/gentoo90/winreg-rs) | Windows registry access | MIT |
| [windows-sys](https://github.com/microsoft/windows-rs) | Windows APIs | MIT OR Apache-2.0 |

Dependency source packages contain their authoritative license texts. Preserve
the required upstream notices when redistributing their code or binaries.

### PDF.js resources

`npm ci` runs `scripts/prepare-pdfjs.cjs`, which prepares the local PDF.js assets
under the ignored `src/vendor/pdfjs/` directory. It copies PDF.js's `LICENSE` and
preserves the resource directories and their notices, including:

- `cmaps/LICENSE`;
- `standard_fonts/LICENSE_FOXIT` and `standard_fonts/LICENSE_LIBERATION`;
- the `LICENSE_*` files in `wasm/`;
- `iccs/LICENSE`.

These files accompany the PDF resources in the static frontend. This source
repository does not include the generated vendor directory.

### Three.js resources

`scripts/prepare-three.mjs` prepares the pinned Three.js runtime and
`RoomEnvironment` helper under `src/vendor/three/`, including Three.js's MIT
`LICENSE`. These generated dependency files accompany the static frontend.

## Bundled 3D models

### Dreamcast CD case

The bundled Dreamcast case geometry in `src/models/dreamcast/case.bin` and
`case.json` is adapted from **Compact disc and case** by **effe**, released
under **Creative Commons Zero (CC0 / Public Domain)**. The original source
reference is <http://www.blendswap.com/blends/view/2841>. The supplied licensing
notice is preserved in
[src/models/dreamcast/LICENSE-CC0.txt](src/models/dreamcast/LICENSE-CC0.txt).
OpenCabinet's geometry conversion and the separate replacement textures are
described in the [asset notes](src/models/dreamcast/README.md).

### Nintendo Switch case

The Switch geometry and materials in `src/models/switch/case.glb` are adapted
from **Nintendo Switch Game Card Case** by **Jacopo Visentin**:
<https://www.blendkit.com/asset-gallery-detail/8f414675-2cd9-4ff6-988d-dec118effbe1/>.
The source is listed under a **Royalty Free** license; it is not covered by
OpenCabinet's MIT license. Separate permission to publish and redistribute
the adapted model with this open-source project is pending.

## Metadata, artwork and emulator downloads

- [OpenCabinet-BDD](https://github.com/Utogu9/OpenCabinet-BDD) supplies optional
  game and console metadata and artwork. Its catalog records and credits describe
  the sources, authors and available license information for individual resources.
- The structured Wikidata sample facts in the metadata test fixture are supplied
  under CC0. See [Wikidata's licensing policy](https://www.wikidata.org/wiki/Wikidata:Licensing).
- RetroArch and Libretro cores are optional downloads, obtained separately from
  their upstream distribution service. They retain their respective licenses;
  core licenses can differ. They are not included in this source repository.
- Games, ROMs, BIOS files, manuals and user-downloaded media are not included.
  Their copyright and trademark rights remain with their respective holders.
- Console markings in the 3D viewer generally come from user-saved console artwork.
  The Dreamcast model includes separate fallback strip images (`insert.webp` and
  `insert2.webp`); those were supplied separately and are not covered by the
  original geometry's CC0 notice. Console names and logos remain associated with
  their respective rights holders. The original console logo SVG files are not
  bundled in the application source.
  SVG fixtures used for rendering tests are synthetic geometric drawings.

OpenCabinet is independent of the platform, storefront and emulator projects it
supports. Product names identify compatibility and do not imply endorsement.
