# Xbox and Xbox 360 cases

Geometry is loaded from bundled GLBs exported offline. The legacy source is
preserved for editing; see [exporting models](3d-models.md).

Both platforms use `three-xbox-viewer.js` and one cached DVD geometry template.
The original Xbox uses a yellow-green tint and denser plastic; Xbox 360 uses
its lighter green tint and greater transparency. Switching between them updates
the materials while retaining the geometry and WebGL context.

The converted construction includes the centered 120 mm disc, circular release
hub without a PUSH label, four finger gaps, retaining annulus, flexible spine,
opening recess and DVD-style manual hooks. The booklet's extended mounts keep
the DVD positions and dimensions, independently of the transparent material.

The shared pipeline supplies reflective disc artwork, a thin glossy outer
sleeve, continuous inside artwork, unprinted paper fallbacks, PDF/CBZ manuals,
relief shadows, fullscreen and couch controls. A missing spine image leaves
the hinge clear. Platform/game color and size overrides remain supported.

The geometry is generated from the existing construction once per page; no
external model asset is needed. Other Xbox generations keep their current
viewer. WebGL failures retain the CSS fallback.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-xbox-browser.test.cjs
```
