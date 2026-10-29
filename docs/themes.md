# Themes

Open **Options → Preferences → Themes** to activate a bundled theme, import a
shared theme, or create your own. Editing a bundled theme creates a copy.

The editor opens its own navigation tab. Colors and layout are previewed live;
**Save and use theme** stores the changes. **Cancel editing**, closing Preferences,
or pressing Escape restores the active saved theme.

Available settings:

- Interface colors, including backgrounds, sidebars, text, accents and status colors.
- Order of the library, game list and details panels, plus sidebar widths.
- Cover size, spacing between games and corner radius.
- Order and visibility of logo, title/platform, media, launch actions, main details,
  information and description.
- Visibility of individual game and platform metadata fields.

The details divider continues working on either side of the game list. Dragging
it adjusts the current view; the theme's saved width is edited in its settings.

## Sharing and storage

**Export** saves a standalone `*.opencabinet-theme.json` file. **Import** adds it
as a new theme with a new local identifier, so importing never overwrites another
theme. No images, game files, credentials or absolute paths are needed.

Custom themes and the active selection are stored in `themes.json` in the active
user data folder. This file is included in both lightweight and full backups,
and moves with the user data folder. A local browser cache provides immediate
startup colors; the file in user data remains authoritative.

[Example theme](example.opencabinet-theme.json) is a complete editable file using
version 1 of the format. Colors use `#RRGGBB`. Panel and section lists contain
each supported slot exactly once; sections can be hidden with `visible: false`.
`hiddenFields` lists the metadata fields to omit. Unknown properties, unsupported
versions, duplicate slots and invalid dimensions are rejected. Themes cannot
include custom CSS, scripts or external resources.

Native saves use a temporary file and atomic replacement. Startup reconciles an
interrupted write without replacing an already valid library with partial data.
