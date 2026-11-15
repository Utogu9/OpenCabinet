# Soundtrack extras

**Edit game → Soundtracks** imports a local album or opens its OST folder. The
context menu's **Listen to soundtrack** opens the player. Selecting an audio
extra from the normal Play disc/version selector also opens this player instead
of the emulator. Listening never changes gameplay statistics or creates sessions.

Supported sources:

- Album folders inside `ost`, containing MP3, WAV, FLAC or M4A files directly,
  without needing a playlist. Album/artist/title tags and embedded artwork are
  read when present; the folder and filenames provide fallbacks. Disc and track
  tags determine song order, followed by numbered filenames (`2` before `10`).
  Separate subfolders can represent different discs. A valid audio playlist or
  CUE in the folder takes priority, so the album is not listed twice. The OST
  folder itself can also hold songs directly.
- `.m3u` / `.m3u8` referencing local MP3, WAV, FLAC or M4A files. Relative paths resolve
  against the playlist. `#EXTINF` titles take priority, followed by embedded tags
  and filenames. Remote URLs and nested playlists are not loaded.
- Audio-only `.cue` sheets with BIN/CDDA (`FILE … BINARY`), WAV, MP3 or FLAC
  sources (including encoded M4A sources). CUE titles, performers, indexes and multiple source files are read.
  `INDEX 00` pregaps are excluded from the preceding track. A CUE containing a
  data track stays a game, even if it also contains music. Standalone BIN, ISO,
  CHD, CCD/MDS files and physical audio drives are not handled by this player;
  use the original audio BIN/CUE or a local audio playlist.

Use one subfolder per album, for example:

```text
images/<collection-id>/ost/
  Original Soundtrack/
    Original Soundtrack.m3u
    01 - Opening.flac
    02 - Theme.flac
    cover.jpg
  Bonus CD/
    Bonus CD.cue
    Bonus CD.bin
    cover.webp
  Another Album/
    01 - Opening.m4a
    02 - Theme.m4a
    cover.jpg
```

The file picker copies referenced audio and artwork to the collection and
rewrites references as relative paths. Originals are kept intact. These additions
are saved immediately; they do not depend on the game editor's Save button.
Folders and files placed directly in the OST folder are discovered with **Refresh**.
Audio extras already associated through Discs or merged versions are discovered
as well. The playlist/CUE identifies an audio disc; its label alone does not.

Artwork uses `cover`, `folder`, `front` or `album` with JPG, PNG, WebP or AVIF,
or the folder's only image. Embedded artwork is used when available, otherwise
the game's cover. Song titles, artists and lengths are read locally with Lofty.
Playback uses the webview's audio support; a missing system codec produces a
player error rather than launching an emulator. Linux packages include Tauri's
media framework, but unusual local codec configurations can still affect playback.

The player supports a track list, seeking within each track, previous/next,
pause/stop, volume, shuffle and album repeat, using the application's white
outline icons. A compact player, by default at the end of the details sidebar, is available whenever the
selected game has an OST, even when automatic playback is disabled. It includes
the song title, elapsed/total time, seeking and all playback controls. Its header
can expand the player or detach the same controls into a draggable floating
player; the floating player's dock button returns it to the sidebar. All views
share one audio element and retain the track, position, volume and playback state.
Themes can reorder or hide this player like the other detail sections.
The sidebar player scrolls with the rest of the details. The expand button opens
the larger player; **Listen to soundtrack** also expands it when that game's OST
is already playing, without restarting the track. This includes merged editions.
Stop ends playback. Starting a game also stops playback.

**Preferences → Library → Automatically play soundtracks when selecting a game**
is off by default. It applies to the library and Couch Mode, waits briefly for
navigation to settle, and starts the first available album. New selections cancel
pending playback; it does not analyze every game's soundtrack at startup. If the
webview blocks automatic playback, use Play in the compact control/player.
Automatic playback stays docked and does not open either the expanded or floating
player. Explicitly played music can continue while browsing with autoplay off.

Managed OST folders remain with retained media collections and are included in
full backups, not lightweight automatic backups. Discs/playlists stored outside
the collection remain external references, like ROMs. Raw CDDA tracks are wrapped
in standard 44.1 kHz stereo 16-bit WAV files on demand in `data/cache/ost`; encoded
audio is played directly, with CUE boundaries applied by the player. This cache
can be removed when playback is stopped. Temporary imports/extractions use the
existing owned staging area and its startup cleanup. Parsed album metadata uses a
small RAM cache invalidated when the playlist or referenced files change.
