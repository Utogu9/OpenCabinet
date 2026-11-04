# PSP case geometry

PSP uses `three-psp-viewer.js` and `three-legacy-geometry.js` to convert the
existing case construction into cached Three.js geometry. It needs no external
model files, local model flags, authoring tools or downloaded model assets.

The original 99 x 168 x 14 mm dimensions, two-part opening, rounded corners,
finger recess and central manual clip are retained. The shell and raised
molding share a milky translucent finish over the continuous inlay; the outer
printed sleeve keeps its separate clear reflections. The UMD has an opaque
off-white housing, a clear window and reflective printed disc artwork.

The inlay remains a single texture, mapped across the inside of both panels
and the spine with readable text. Without it, the reverse of the outer paper
stays white and a missing spine image leaves the hinge clear. Full covers take
priority over separate front, spine and back images. Cached previews are used
while original artwork loads.

PDF/CBZ manuals fit inside the lid without stretching their pages. The front
loads on selection; the back loads lazily when opening. The booklet supports
the shared reader, stale-load cancellation and the single central retaining
clip. Rotation, zoom, axis locks, fullscreen and couch mode share the same
controller as the other converted cases. WebGL failures retain the CSS fallback.

The retired external PSP assets are not used or included in the source tree.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-psp-browser.test.cjs
```
