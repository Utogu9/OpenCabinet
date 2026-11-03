# Couch mode

Open **Couch mode** from the menu bar, or press **F11**. It opens the library in
native fullscreen. Exit with the on-screen button, **Esc** or **F11**; the previous
window state is restored.

The bottom carousel contains platforms with games and their downloaded logos.
Platforms without a logo show their names. **All** combines the library. The game
carousel respects alphabetical and custom series ordering, and remembers the
selected game for each platform while switching between platforms.
The last nine games around that selection keep their cover and full-cover
previews decoded in RAM for each visited platform, including **All**. Switching
platforms or closing couch mode does not discard these reservations. Moving
within a platform replaces its reserved window; removed games or changed image
paths release obsolete reservations. These per-platform minimums can exceed
the general RAM LRU limit. Disk caching still supplies images after restarting
the application.
Drag the bottom platform rail with the mouse to scroll it, or swipe on a
touchscreen. Dragging does not select text or activate a platform; a normal
click still selects it.

Switch between covers and 3D boxes with the on-screen button; the choice is
remembered and applies to every visible game. Covers retain their full opacity
and brightness, including neighboring games. Available cached previews appear
while artwork loads. In box mode, the selected box loads first, followed by its
neighbors, including one extra box on either side to prepare for navigation (up
to nine boxes). The selected box is enlarged. Neighboring covers are smaller
and tilt around their own centers to preserve their proportions. Drag the
selected box with the mouse to rotate it. A ring of up to nine viewers remains
attached while navigating. Three.js keeps its model and renderer; legacy cases
reuse their molded geometry when the case style matches, replacing the printed
sheets rather than rebuilding all faces. Box mode never displays flat covers as
a loading fallback: an unprinted 3D case remains visible while artwork loads.
Cached artwork is applied first, followed by the original image, with at most
two original downloads/decodes at a time. Canceled jobs do not start afterward.
The decoded original fades over the cached image on covers and legacy cases;
the preview stays underneath until the transition completes. Three.js uploads
the replacement before switching maps and retires the old texture after drawing
the replacement frame. Carousel focus uses a subtle background glow.
Cases share a consistent visible height and receive no extra perspective tilt
from the carousel; neighbors only become smaller with distance. Manual zoom and
rotation reset when the selection changes.
Zoomed boxes can extend beyond their individual cards and the game carousel,
drawing above the rest of the interface without moving its layout. Three.js
includes extra drawing area around the zoomed box, retaining the original
framing and pixel density. Neighboring viewers keep their normal render size.
Model preparation keeps progressing while a direction is held, prioritizing
the current selection and leaving a
short gap between model updates. Every job checks the latest visible games;
navigation does not reset a debounce timer or apply obsolete results. Existing
compatible boxes apply RAM artwork immediately, using the same preview cache
as cover mode. Plastic color changes reuse the molded geometry. A resident front
cover can fill the case while its preferred full wrap is being prepared.
Separate spine artwork has its own worker decoder and a single preparation
slot, independent of original cover downloads. It keeps its aspect ratio and
is bounded to 2048 pixels on the longest edge. Changing games cancels obsolete
work and releases its prepared pixels. Applying a spine in the glTF viewer
updates only the outside atlas, retaining the other GPU textures. If workers
are unavailable, asynchronous image loading remains available as a fallback.
Each visited platform keeps its last window of up to nine prepared viewers and
their artwork in RAM throughout the couch-mode session. Returning to a platform
reuses those models instead of reconstructing them. Inactive viewers pause,
including when switching to covers or starting a game. WebGL contexts for older
platforms are kept resident within a shared context budget. Older contexts can
be released while retaining their scenes, texture sources and a frozen frame,
so visiting several platforms does not exhaust the browser's context limit or
show an untextured scene during restoration. Closing
couch mode disposes every cached viewer. Cover sizing depends
on aspect ratio and available space, so low-resolution images fill the same
space as their larger equivalents. The nearest neighbors leave more room around
the selected game; farther neighbors are grouped more tightly.

## Controls

| Action | Keyboard | Standard-layout controller |
| --- | --- | --- |
| Previous/next game or platform | Left/right | D-pad or left stick |
| Focus games/platforms | Up/down | D-pad or left stick |
| Choose or play | Enter or Space | A / bottom face button |
| Previous/next platform | Select a platform | LB/RB |
| Switch cover/3D preview | On-screen view button | X / left face button |
| Rotate the selected 3D box | Drag with the mouse | Right stick |
| Open/close the selected case | Right-click menu or O | R3 / right-stick click |
| Read the manual in an open case | Click the booklet or M | L3 / left-stick click |
| Zoom the case or manual | Mouse wheel | RT/R2 zoom in; LT/L2 zoom out |
| Front/back of the 3D box | Home resets the front | Y / top face button |
| Back to platforms, then exit | Esc exits directly | B / right face button |
| Exit couch mode | Esc or F11 | Menu/Start |
| Search games | Search field or Ctrl+F | Keyboard input |

Press a controller button after opening the mode so the webview can detect it.
Controllers must have a standard mapping reported by the webview. Keyboard and
mouse remain available when a controller is disconnected.
The right stick rotates only the selected box in 3D view, without pressing R3.
Both axes respond proportionally to the stick, with a dead zone to avoid drift.
Rotation pauses in dialogs, while searching, during launches and when the app
loses focus. Existing axis locks apply, and changing games resets the rotation.

The manual reader uses left/right or LB/RB to turn pages and the right stick to
pan an enlarged booklet. B or L3 returns to the open case; Escape and the return
button also work. Manuals load when opening the selected case, not for every
neighboring model. Both legacy and Three.js cases use the same reader.

Playing uses the same region, version and disc selectors as the desktop library.
Their buttons can also be navigated with the controller. Missing files are checked
for the selected game. Starting a game minimizes OpenCabinet; when its tracked
session ends, couch mode returns with that game selected. Controller input is
ignored while the window is not focused.
