# Game startup screen

Preferences → Game startup controls an optional fullscreen loading presentation.
It appears after choosing a version/region and disc, before launch actions and
process creation. The shared launch flow also covers double-click, context menus,
console shortcuts, playlists and Couch Mode.

The logo appears at the upper left; disc artwork spins at the upper right, or a
cartridge/label is shown without rotation. The selected edition supplies artwork.
For multiple discs the selected disc uses the corresponding ordered disc image,
falling back to the first when there is no separate scan. No images are downloaded
to display the screen. Reduced-motion preferences disable rotation.

For merged games, a missing logo or disc/cartridge image falls back independently
to artwork from another edition in the same entry. The selected edition keeps
its title and any artwork it already has; another game's media is never borrowed.

The background uses the current theme color or a custom color. When enabled,
`fanart_background` artwork overlays that color; repository `background` entries
map to that existing category. Missing or failed images leave a usable color and
game title. This feature does not create another duplicate background category.

## Duration and readiness

- **Fixed**: 1–120 seconds, measured from successful process creation.
- **Automatic**: close after a stable, visible game/emulator window is observed
  for 1.2 seconds, or the configurable maximum wait (1–120 seconds, 5 by default) expires.
- Windows checks the launched process and descendants, ignores hidden, minimized,
  owned/tool or very small windows, and checks responsiveness. Window changes and
  resizes reset stability.
- Linux X11 uses the optional `xprop` utility to inspect the active window and its
  process. Native Wayland applications cannot be inspected this way. Steam/Epic
  launches can be handed to an existing client outside the launched process tree.
  Those cases use the maximum wait. Missing `xprop` also falls back to that timer.

This is a window-readiness heuristic. There is no generic signal proving that a
game or emulator has rendered gameplay or completed its own loading. Select a
fixed duration for applications whose startup window appears before content.

Esc, the dismiss button and Alt+F4 hide only the presentation. Launch failures and
session termination also hide it. A watchdog bounds pre-launch actions to 120
seconds of presentation time; it does not terminate those actions or the game.
The presentation does not change session accounting.

The independent, undecorated Tauri window stays on top without requesting focus,
on the library window's monitor. The main window retains its previous geometry
and fullscreen state. The lightweight overlay webview is reused and destroyed
when the library closes. Per-launch IDs isolate late callbacks and process exits
from later launches. Settings live in the existing backed-up preferences.

Implementation: `src/launch-screen.js`, `src/launch-screen-view.js`,
`src-tauri/src/launch_screen.rs`, `src-tauri/src/launch_window_probe.rs`.

References: [Tauri window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
and [Windows input-idle limitations](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-waitforinputidle).
