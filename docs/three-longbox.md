# Sega CD and Saturn cases

Sega CD, Mega CD and Saturn use the same `longbox` Three.js template through
`three-converted-viewer.js`. Its 142 x 209 x 21 mm construction and opening rig
are loaded from the bundled `models/longbox/case.glb`. Conversion is an explicit
offline step; see [exporting models](3d-models.md).

The interior tray and fixed ribbed hinge column use PS2's matte dark-gray
plastic. The lid, upper/lower rails and hinge ears use clear acrylic. The
smooth acrylic shares the optical shader and material settings used by the
PS1/Dreamcast viewer, with the printed spine windows excluded from relief
refraction. The upper/lower acrylic rails share PS1/Dreamcast's
`models/dreamcast/ribs-height.svg` as a repeating bump and alpha map, with a
0.85 mm ridge pitch. The black hinge column retains its separate molded pattern.

The lid and its rails rotate together around the existing jewel hinge until
their outside plane aligns with the rear shell. Both printed spines remain on
the stationary tray. The 120 mm CD stays centered within the usable tray area,
slightly below the middle of the tall case. The black insert's sidewalls and
skirts extend to the back cover so its unprinted reverse stays covered.

PDF/CBZ booklets fit beside the fixed column and support the shared reader.
When present, the booklet's first page supplies the external front insert and
its last page faces the inside. Extracting it leaves the acrylic lid clear.
The conversion retains the standard rotation, zoom, fullscreen, couch mode,
custom dimensions and color settings. Sega CD and Saturn reuse the same
prepared model when changing games. WebGL failures keep the CSS fallback.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-longbox-browser.test.cjs
```

It checks mixed materials, disc placement, both spines before and after opening,
hinge alignment, manual reading, cross-console model reuse and GPU restoration.
