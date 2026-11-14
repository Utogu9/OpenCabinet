# Reversible covers

When a game's **Inlay** has loaded, right-click its 3D viewer and choose
**Reverse cover**. Choose **Restore original cover** to turn it back. These are
context-menu actions in the sidebar, fullscreen and couch mode; no toolbar
buttons are added.

The existing scans are reused without rewriting or mirroring their pixels.
The two sides exchange through a short fade, respecting reduced-motion settings.
Rotating or zooming the case, taking out a disc and reading a manual keep working.
No model geometry or download is created by reversing the paper.

DVD/Blu-ray-style wrappers exchange the outer print and the full inlay. The
inlay should be an upright scan of the complete reverse sheet, including the
spine. For PS1/Dreamcast the rear tray insert and its folded spines exchange
sides; the front booklet and its back remain unchanged. Tall Sega CD/Saturn
cases likewise retain the front booklet and reverse only the rear insert.
Missing inlay artwork hides the action rather than inventing an alternative.

The selection is stored per game/region as the optional `cover_reversed` boolean
in its `box_3d` configuration. Older settings remain valid. The SQLite record and
recoverable media manifest are synchronized using the existing transaction and
manifest journal, so backups and media recovery retain the choice. Changing it
does not change the library thumbnail or the default image preferences.

`cover_full_material` describes the original printed side. It is suspended
during the transition and while the inlay faces outward, then restored when
the original cover returns. Regular plastic and acrylic reflections remain.

Implementation: `src/three-reversible-cover.js` owns the transition and restores
original material maps on clear/disposal. Both Three.js viewers supply their
paper pairs; asynchronous high-resolution replacements update the proper side.
The retained CSS fallback does not expose this WebGL-only action.
