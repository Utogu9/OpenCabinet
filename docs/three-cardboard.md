# Cardboard cases

All built-in cardboard formats use `three-cardboard-viewer.js` and one unit
cuboid. The controller scales it to each physical profile without rebuilding
the model or WebGL context. All corners and folds remain exactly 90 degrees.

| Format | Width x height x depth (mm) | Default spine |
| --- | --- | --- |
| NES | 126 x 179 x 25 | Left |
| SNES | 178 x 128 x 32 | Top |
| Super Famicom | 105 x 190 x 30 | Left |
| Nintendo 64 | 178 x 128 x 32 | Top |
| Game Boy / Game Boy Advance | 126 x 126 x 25 | Left |
| Japanese GBA | 135 x 86 x 23 | Top |
| Master System | 135 x 190 x 25 | Left |
| Sega 32X | 135 x 190 x 25 | Left |

Existing format measurements are retained. The new 32X preset uses an
approximate Genesis-sized cardboard box; these measurements are not claimed
as an exact standard for every regional release. Explicit model, spine and
color settings still take precedence, including per-game and regional choices.
The preset can also be selected from the case editor and saved in the library.

Portrait SNES covers select Super Famicom dimensions, and landscape Game Boy
covers select Japanese GBA dimensions, as in the CSS viewer. Cached previews
can select the shape immediately; the original artwork updates it when ready.

Front, back and spine use their existing image classifications and fanart
fallbacks. Full covers remain a single texture folded through UV coordinates,
including vertical wraps for top-spine boxes. Missing images use the existing
title/color fallback. Unprinted faces use the profile's cardboard color, with
a subtle printed-surface reflection and no plastic case components.

These boxes stay closed: opening controls and manual loading are disabled.
Rotation, zoom, axis locks, fullscreen and couch mode use the shared controller.
WebGL failures retain the CSS fallback.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-cardboard-browser.test.cjs
```

It checks every format, actual rendered dimensions, square geometry, front/back
and spine UVs, model reuse, full covers, resident previews, overrides and GPU
retirement/restoration. The Rust storage test also covers the new 32X preset.
