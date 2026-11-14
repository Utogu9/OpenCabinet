# PS2 cases with two discs

An emulated PlayStation 2 edition with exactly two associated source files uses
the regular PS2 case plus a removable-disc carrier snapped to its inner spine.
One source file uses the existing single-disc case. Editions from different
regions, native ports, other consoles and three-or-more-disc sets do not activate
this two-disc holder. Source ordering and disc labels follow **Edit game → Discs**.

The compartment walls beside the flexible spine are low, flush to each shell's
inner floor, so a tall divider does not project into the carrier. The outer case
rims, the spine's top/bottom closures and the carrier hinge keep their shape.
The overlapping closing lip is open along that same spine-side edge, preventing
a floating strip above the lowered wall; its other three sides remain intact.

The carrier is an original model based on the supplied
[open-case photograph](https://i.ebayimg.com/images/g/NhAAAOSwBMNme1kI/s-l1200.jpg)
and [detached-tray photograph](https://i.ebayimg.com/images/g/8SUAAOSwKgRmKV8c/s-l400.jpg).
Its matte plastic uses the existing PS2 material. The almost circular plate has
a narrow hinge rail, two projecting mounts in the centre of the inner spine,
raised retention arcs, finger gaps in those arcs and a central hub. The backing
between the rail and the circular dish is solid, without open windows.
As the spine unfolds, the upper disc shifts left, leaving part of the lower
disc visible at its right edge. Turning the carrier exposes the original disc below; it rests over the
opened lid rather than intersecting the booklet.

With the case open, click exposed carrier plastic or choose **Turn disc tray**
from its context menu. The menu identifies each disc separately. Both discs can
be taken out, rotated, examined and put back independently, including after the
carrier has changed sides. This also works in fullscreen and couch mode.
Closing the case returns the carrier to its closed position. Nothing changes
ROM associations, launch choices, statistics or the original artwork files.

Disc 1 sits on the hinged carrier; disc 2 sits in the fixed case underneath it.
Source IDs, labels, extraction and reinsertion follow those physical positions.
The first preferred `disc` image supplies disc 1 on the carrier. The next distinct
`disc` image in that edition's ordered image list supplies disc 2 in the fixed case.
If a second scan is unavailable, a placeholder shows the game and disc label;
the first scan is not duplicated. There is no inference that an alternate scan
represents a particular physical disc: order the images accordingly.

The static accessory lives in `src/models/ps2-disc-tray/case.glb` (~0.5 MB).
`scripts/model-sources/ps2-disc-tray.js` is its editable source. To rebuild it:

```sh
node scripts/export-models.mjs ps2-disc-tray
```

Release preparation validates the bundled GLB. Startup never runs the authoring
code: the accessory is loaded on demand, source data are cached, and a viewer
reuses its own meshes when switching games. The two disc surfaces reuse cloned
geometry from the existing PS2 model. Frame updates move the hinge and transform
cached bounds; they do not rebuild geometry or scan every vertex. Lighting keys
include carrier pose and disc visibility so their shadows stay current.
