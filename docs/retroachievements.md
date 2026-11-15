# RetroAchievements

Connect an account under **Options → Preferences → RetroAchievements** using a
username and personal **Web API key**. The key is available in the account's
[application settings](https://retroachievements.org/settings?tab=applications).
Each OpenCabinet user profile has its own connection. This is the official
[Web API](https://api-docs.retroachievements.org/), rather than the separate
emulator Connect API. OpenCabinet never requests the account password.

The right sidebar displays completed/available achievements, hardcore completions,
and an expandable list with descriptions, badges and points. Refresh is available
in the section header. It also refreshes after the selected game's session ends.
**Themes** can hide or reorder the entire section.

## Game matching

The console and a unique normalized title identify an achievement set. Ambiguous
matches require choosing a game using the section's link button. That chooser
can also disable association or restore automatic matching. The association is
stored against the actual regional edition, not the merged library entry; the
default regional edition is displayed in the sidebar.

Matching titles does **not** verify a ROM hash or guarantee that a particular
dump is supported. The emulator performs that verification. Configure and sign
in to RetroAchievements in the emulator separately. OpenCabinet neither unlocks
achievements nor starts RetroAchievements gameplay sessions.

## Storage and requests

System game lists are cached in SQLite for seven days. Progress is cached per
RetroAchievements account and game for five minutes and remains visible offline.
Selecting games first reads cached progress, then refreshes missing/stale data in
the background after a short navigation debounce. Manual refreshes have a
ten-second minimum interval when cached progress exists. Requests are serialized,
spaced apart, time-limited, and sent with the OpenCabinet user agent. No full
library scan occurs on startup.

Keys are stored separately under `credentials/` in the active data folder,
outside the backup and diagnostic export allowlists. Windows encrypts them using
DPAPI for the current Windows user. Linux restricts the directory/files to the
current user (`0700`/`0600`); the file is not encrypted there. Keys never enter
browser storage, manifests, API error messages or SQLite. Moving data on the same
machine preserves credentials; restoring a backup requires connecting again.

The account API's stable ULID is used for progress where available. Disconnecting
removes the saved key. Cached progress and manually selected game associations
contain no credentials and can remain in library backups.
