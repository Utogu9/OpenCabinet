# Personal library and insights

**Tools → Statistics** shows all-time playtime, session counts and game counts,
with charts by platform, region, month and most-played game. Regional entries
count as one library game, while their playtime remains included. Monthly charts
use recorded session dates in local time; older totals without dated sessions
are not assigned invented dates.

**Tools → Library report** checks for absent game files, covers, logos, back covers,
manuals, catalog matches and emulator configurations. Checks run only when the
report is requested or refreshed. Search and platform/issue filters operate on
those results. Games can be edited or relocated from the report.

Each game has a personal status, favorite flag, rating and notes. These are
available through the game context menu, the editor's **Personal** category and
the details sidebar. Personal fields are shared by grouped regional editions and
are independent from downloaded catalog metadata. Custom category conditions can
use `status`, `favorite` and `rating`; status codes are `unplayed`, `planned`,
`playing`, `completed` and `abandoned`.

When several images share a type, the editor offers a small star to choose the
default. This preserves the image type and updates its order, which is used by
the grid, gallery and box viewers. Manuals have the same choice when more than
one is available. Changes take effect on saving the editor. Personal data and
manual preferences are included in media manifests and library backups.

# Interrupted imports

Once an accepted import starts downloading media, it writes a durable receipt
inside its owned staging directory. It includes reviewed titles, matches,
selected files, recovery choices and resolved source URLs. Completed files have
separate completion markers written after the download has been flushed and
validated. Partial files are downloaded again; a file header alone does not make
an interrupted transfer complete.

Closing the application preserves these receipts. On the next launch, a notice
points to **Tools → Pending downloads**, where an import can be resumed or
discarded. A resumed import allows retrying failed downloads, finishing with the
available media, or pausing and closing its window. Explicitly cancelling an
ordinary import discards its pending work. A successful database commit retires
the receipt. Existing ROMs and installed games are never removed by discarding
an import.

Startup cleanup retains valid import receipts instead of sweeping their files.
Receipt paths are checked and reconstructed inside the active data folder;
automatic backups continue to be lightweight. Resumption applies to game imports,
not unsaved image-download drafts in the game editor. The selected metadata
source must match the source used when the pending import began.
