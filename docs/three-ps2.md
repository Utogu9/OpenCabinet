# PS2 case geometry

PS2 keep cases use Three.js with geometry converted from the existing case
construction. `three-legacy-geometry.js` consumes the millimetre-sized faces
produced by `game-box.js` and `dvd-case.js`; there is no external model asset.

The adapter resolves the CSS polygons, rounded shapes and SVG cutouts into
triangles. It batches pieces by material and moving half, smooths the normals
of curved strips, and uses the existing hinge transforms for opening. The
compiled geometry is retained in memory and cloned for subsequent viewers.
The temporary construction DOM is removed before the first rendered frame.

Cover, back cover and spine share a continuous texture atlas. Full-cover images
use the same UV layout. Artwork uses cached previews while originals load.
Plastic, sleeve reflections, disc artwork and the physical booklet remain
separate materials. Manual dimensions and page loading use the existing reader.
Custom dimensions and regional plastic colors still follow the case settings.

The matte shell receives soft shadows from its raised molding, including the
disc cradle and memory-card catches. Shadow maps update with case rotation,
opening and booklet changes; zoom and artwork uploads reuse them. GPU context
retirement releases the maps and recreates them on resume. An overlapping inner
closing lip blocks views through the seam without filling the finger recess.

`three-ps2-viewer.js` connects the adapter to the shared Three.js controls,
fullscreen and couch-mode lifecycle. Related conversions share this adapter;
see the PS3, PS4, Xbox and [Sega/Nintendo cases](three-sega-nintendo.md) notes.
The router falls back to the CSS case if WebGL or conversion fails.

Run the browser integration test with `playwright-core` and Chromium available:

```sh
node --test tests/three-ps2-browser.test.cjs
```

Each family supplies its own material and artwork mappings while reusing the
construction and triangle conversion.
