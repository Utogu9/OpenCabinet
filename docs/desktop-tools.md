# Desktop shortcuts, controllers and user profiles

## Game shortcuts

Right-click a game in the catalog and choose **Create shortcut…**, then choose
where to save it. Windows creates a `.lnk`; Linux creates an executable `.desktop`
file. A desktop environment may require allowing the Linux launcher to run.

The icon uses the game's logo, preserving its proportions and transparency in a
square canvas. Another merged edition's logo is used when necessary; without a
logo the shortcut uses OpenCabinet's icon. Windows icons include 16, 24, 32, 48,
64, 128 and 256 pixel images. Generated icons are kept in `shortcut-icons` in the
active data directory, separately from disposable thumbnails.

Shortcuts run through OpenCabinet: version/disc selection, launch actions,
startup presentation, diagnostics and session statistics use the normal launch
flow. An already-running copy receives the request through a local file inbox;
the launcher does not open a second copy of the library. Requests identify both
the game and the library, so a link cannot accidentally launch a matching numeric
ID from a different library. They use the currently active user profile.

Moving the installed executable, deleting/reimporting its game, or moving its icon
folder can require recreating a shortcut. AppImage shortcuts refer to the actual
AppImage path rather than its temporary mount.

## Controller settings

**Preferences → Couch Mode controls** configures standard mapped controllers.
Actions can be reassigned among the face buttons, shoulders, triggers, stick
clicks, Select and Start. Assigning an occupied button exchanges its old action.
The D-pad and left stick keep their navigation role.

Select an action's assignment button, release any held controller buttons, then
press the desired button on the controller. Esc cancels without closing
Preferences; switching category, closing the window or leaving the application
also cancels listening. No dropdown or numeric button selection is required.

Navigation and rotation dead zones, rotation/panning and zoom sensitivity, initial
repeat delay and repeat interval are configurable. On-screen controller hints
follow the selected assignments. Preferences are saved and included in the
existing preference backup/reset system.

## Startup overrides

**Edit game → Launch** includes the loading presentation settings. By default a
game inherits **Preferences → Game startup**. Clear the inheritance checkbox to
disable the presentation or customize its color, background and timing for that
version. Re-enabling inheritance removes the override. See [game startup](game-startup.md).

## User profiles

Use **Options → User profiles** or its own Preferences category to create, rename,
switch and delete profiles. The active name appears in Options. The original
profile receives all existing personal data; new profiles start with empty
personal data and statistics, while seeing the same catalog.

Shared: games, files, images, manuals, emulators, launch settings, playlists,
categories and application preferences. Per profile: favorites, ratings, personal
notes, progress/status, play totals, last played dates and individual sessions,
including regional statistics. Changing profiles does not reset another user's
data. Deleting a shared game removes it for all users.

Switching is blocked during a game or library operation. Deleting a profile
requires confirmation and removes only that user's data. The original and active
profiles cannot be deleted. Profile IDs are never reused; retained personal data
also uses a stable identity so another library's numeric IDs cannot match it. Profiles organize
personal data; they are not operating-system accounts or access controls.

The database keeps a transactional projection of the active profile in the
existing game/personal/session tables. Triggers maintain each profile's own
records through play, edits, history deletion and resets. Switching restores that
projection in one transaction without copying media or rewriting all manifests.
Multidisc merges also preserve inactive profiles' statistics and sessions.

Automatic and manual database backups include every profile, not only the active
one. Retained media manifests identify the owner of the saved personal data;
recovering images under another profile does not import someone else's ratings
or play totals. Legacy manifests without an owner belong to the original profile.

Linux launcher quoting follows the [Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).

## Restoring preferences

**Restore defaults** first offers the current section or all preferences, then
asks for a second confirmation describing that scope. Restoring one section
applies only its defaults and keeps Preferences open; saved settings and unsaved
drafts in other sections remain untouched. Resetting the theme editor changes
only the draft's colors/layout, preserving its name and author until **Save theme**.

All-preference restoration retains the library, profiles, files, custom themes,
existing backups and active data location. Profiles and Storage have no resettable
settings, so their section-only option is disabled rather than removing data.
