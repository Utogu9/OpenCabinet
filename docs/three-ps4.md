# PS4 and PS5 cases

Both platforms use `three-ps4-viewer.js` and the same cached geometry template.
The shared converter preserves the existing Blu-ray shell, disc cradle and
release hub, manual retainers, opening recess and articulated halves.

The blue translucent plastic uses the same optics as PS3, with greater body
opacity. PS4/PS5 retain their own corner profile and a sleeve spanning the front
and back without the PS3 header and raised Blu-ray mark. Game and platform
color/dimension overrides continue to apply.

Inlays use the reverse of the continuous outside sleeve geometry, including
the spine folds. Missing inlays show unprinted paper; absent spine artwork
leaves the hinge clear. PDF/CBZ booklets use the shared reader and lid sizing.
Controls, fullscreen, couch mode, shadow-map caching and context retirement
follow the existing viewer lifecycle.

Browser integration test (requires `playwright-core` and Chromium):

```sh
node --test tests/three-ps4-browser.test.cjs
```
