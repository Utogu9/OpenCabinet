# Couch mode

Open **Couch mode** from the menu bar, or press **F11**. It opens the library in
native fullscreen. Exit with the on-screen button, **Esc** or **F11**; the previous
window state is restored.

The bottom carousel contains platforms with games and their downloaded logos.
Platforms without a logo show their names. **All** combines the library. The game
carousel respects alphabetical and custom series ordering, and remembers the
selected game for each platform while switching between platforms.

Only the central game has a live 3D preview. Neighboring games use covers, including
available cached previews while the original artwork loads. Switch between covers
and 3D boxes with the on-screen button; the choice is remembered. Drag a 3D box
with the mouse to rotate it.

## Controls

| Action | Keyboard | Standard-layout controller |
| --- | --- | --- |
| Previous/next game or platform | Left/right | D-pad or left stick |
| Focus games/platforms | Up/down | D-pad or left stick |
| Choose or play | Enter or Space | A / bottom face button |
| Previous/next platform | Select a platform | LB/RB |
| Switch cover/3D preview | On-screen view button | X / left face button |
| Front/back of the 3D box | Drag with the mouse | Y / top face button |
| Back to platforms, then exit | Esc exits directly | B / right face button |
| Exit couch mode | Esc or F11 | Menu/Start |
| Search games | Search field or Ctrl+F | Keyboard input |

Press a controller button after opening the mode so the webview can detect it.
Controllers must have a standard mapping reported by the webview. Keyboard and
mouse remain available when a controller is disconnected.

Playing uses the same region, version and disc selectors as the desktop library.
Their buttons can also be navigated with the controller. Missing files are checked
for the selected game. Starting a game minimizes OpenCabinet; when its tracked
session ends, couch mode returns with that game selected. Controller input is
ignored while the window is not focused.
