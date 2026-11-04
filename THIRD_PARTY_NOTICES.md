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
| [webp](https://github.com/jaredforth/webp), [libwebp-sys](https://github.com/NoXF/libwebp-sys) and [libwebp](https://chromium.googlesource.com/webm/libwebp/) | Thumbnail encoding when the webview cannot encode WebP | webp: MIT OR Apache-2.0; bindings: MIT; libwebp: BSD-3-Clause |
| [image](https://github.com/image-rs/image) | Native Linux thumbnail decoding and resizing | MIT OR Apache-2.0 |

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

### Lucide interface icons

The local SVG icons in `src/assets/icons/` come from
[Lucide](https://github.com/lucide-icons/lucide), version 0.468.0. Their pinned
source revision and included icons are recorded in `sources.json`. The complete
upstream ISC/MIT notice is included alongside the SVGs in `LICENSE` and ships
with the application. These icons replace font-dependent emoji decorations.

### Native WebP encoder

The `webp` wrapper is used under its MIT license:

Copyright (c) 2020 Jared Forth

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The bundled libwebp codec carries this notice:

Copyright (c) 2010, Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name of Google nor the names of its contributors may be used
  to endorse or promote products derived from this software without specific
  prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## Bundled 3D models

### Dreamcast and PlayStation CD case

The shared Dreamcast and PlayStation case geometry in `src/models/dreamcast/case.bin` and
`case.json` is adapted from **Compact disc and case** by **effe**, released
under **Creative Commons Zero (CC0 / Public Domain)**. The original source
reference is <http://www.blendswap.com/blends/view/2841>. The supplied licensing
notice is preserved in
[src/models/dreamcast/LICENSE-CC0.txt](src/models/dreamcast/LICENSE-CC0.txt).
OpenCabinet's geometry conversion and the separate replacement textures are
described in the [asset notes](src/models/dreamcast/README.md).

### Nintendo Switch and Nintendo Switch 2 cases

The Switch geometry and materials in `src/models/switch/case.glb` are adapted
from **Nintendo Switch Game Card Case** by **Jacopo Visentin**:
<https://www.blendkit.com/asset-gallery-detail/8f414675-2cd9-4ff6-988d-dec118effbe1/>.
OpenCabinet converts the model to glTF and adapts its animation, artwork mapping
and materials. The Nintendo Switch 2 presentation reuses this geometry with
separate red shell and cartridge materials.
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

### Native Linux image decoding notices

The following components are used under their MIT or BSD license option.
Resolved versions and source checksums are recorded in Cargo.lock.

#### image 0.25.10

```text
MIT License

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

#### image-webp 0.2.4

```text
MIT License

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

#### moxcms 0.8.1

```text
Copyright (c) Radzivon Bartoshyk. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1.  Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.

2.  Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

3.  Neither the name of the copyright holder nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### pxfm 0.1.30

```text
Copyright (c) Radzivon Bartoshyk. All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1.  Redistributions of source code must retain the above copyright notice, this
    list of conditions and the following disclaimer.

2.  Redistributions in binary form must reproduce the above copyright notice,
    this list of conditions and the following disclaimer in the documentation
    and/or other materials provided with the distribution.

3.  Neither the name of the copyright holder nor the names of its
    contributors may be used to endorse or promote products derived from
    this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

#### gif 0.14.2

```text
The MIT License (MIT)

Copyright (c) 2015 nwin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### weezl 0.1.12

```text
The MIT License (MIT)

Copyright (c) HeroicKatora 2020

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### color_quant 1.1.0

```text
The MIT License (MIT)

Copyright (c) 2016 PistonDevelopers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### zune-core 0.5.3

```text
MIT License

Copyright (c) zune-image developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### zune-jpeg 0.5.15

```text
MIT License

Copyright (c) zune-image developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### byteorder-lite 0.1.0

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

#### quick-error 2.0.1

```text
Copyright (c) 2015 The quick-error Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
