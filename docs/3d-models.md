# Bundled 3D case models

The application loads pre-exported `src/models/<model>/case.glb` files. It does
not capture the legacy construction DOM or triangulate CSS faces when opening
viewers, entering couch mode, installing dependencies or building a release.
The GLBs include geometry, UVs, articulated groups, physical dimensions and
opening keyframes. Shared formats reuse one model: PS4/PS5, Xbox/Xbox 360,
Sega CD/Saturn, Dreamcast/PlayStation and the cardboard formats.

Each GLB is fetched and parsed once per application session. Viewers receive
private geometry, material and animation clones so retiring a viewer or
changing UVs cannot affect another one. Artwork, optical shaders, custom colors
and dimensions, and variable-size PDF/CBZ booklets remain dynamic. Downloaded
console emblems are still supplied by the user's library.

## Editing and re-exporting

The legacy source is retained in `src/game-box.js`, `src/dvd-case.js`,
`src/styles.css` and `src/three-legacy-geometry.js`. It also remains the fallback
when WebGL is unavailable. `scripts/model-sources/cardboard.js` preserves the
cardboard source, and `scripts/model-sources/dreamcast/` preserves the prepared
CC0 input used to export Dreamcast and PlayStation cases.

After changing construction geometry, explicitly regenerate the models:

```sh
npm run export:models
# Or export only selected formats:
npm run export:models -- ps2 psp
```

The exporter requires the development dependencies and Chromium. On Windows
it uses the usual Chrome installation. Set `OPENCABINET_CHROMIUM` to another
browser executable, or install Chromium with `npx playwright-core install chromium`.
It serves only the local project on a loopback address and exports through
Three.js's GLTFExporter; it downloads no models and reads no user library.

GLB coordinates use metres. `sourceUnits` records the millimetre source scale,
which the application restores for its existing controls and physical profiles.
Materials unsupported by glTF, such as contact-shadow receivers and additive
sleeve reflections, retain named bindings for the application's optical shaders.

`npm run prepare:three` validates the bundled artifacts without running the
exporter. Missing or incomplete models fail preparation. Commit regenerated
GLBs together with changes to their authoring code. Tests cover their structure,
viewer isolation, opening, artwork, manuals and couch-mode lifecycle.
