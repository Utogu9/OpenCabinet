# PS2 case geometry

PS2 keep cases load `models/ps2/case.glb`, exported from the existing case
construction. It contains the batched triangles, curved normals, UVs and opening
rig. The viewer never captures the construction DOM or triangulates CSS faces.
The legacy source remains editable; see [exporting models](3d-models.md).

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
