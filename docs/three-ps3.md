# PS3 case geometry

`three-ps3-viewer.js` uses the shared legacy-to-Three.js adapter with the PS3
profile: rounded Blu-ray shell, recessed sleeve, raised header, transparent
manual retainers, disc cradle, hub and opening recess. Geometry is compiled
once per page and reused; there is no external model asset.

The transparent molding uses haze and grazing reflections without screen-space
refraction. This keeps nearby paper and disc artwork from appearing reflected
or displaced onto unrelated pieces. Its materials and geometry are separate
from the matte PS2 case.

The inlay reverses the same continuous sleeve geometry, including the spine
folds. Its UV layout is the reverse of the outside wrap, preserving readable
inside text. Without an inlay the paper reverse is white. An absent spine image
leaves the hinge clear instead of creating a white strip. The raised Blu-ray
mark uses the user's downloaded console artwork, just like the legacy viewer.

The PDF/CBZ booklet, controls, fullscreen and couch mode use the shared viewer.
Relief shadows use only the molded walls as casters, so clear flat panels do
not cast an opaque rectangle over the inlay. Shadow maps follow the existing
pose-change and GPU-context lifecycle.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-ps3-browser.test.cjs
```
