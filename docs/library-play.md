# Playlists, filtered random selection and launch actions

**Tools → Playlists** creates manual lists. Search and click games in the left
column to add them; the right column supports removal and up/down ordering.
Save explicitly. Removing a list or a member never deletes games or files.
The library's **Group by → Playlists** respects that order, and Couch Mode has
a playlist selector that preserves it across consoles. The game context menu
can add one or several selected games to a list. Lists live in the user database
and are included in its backups.

**Tools → Random game with filters**, and the random button in Couch Mode,
allow combining platform, playlist, personal status, genre, minimum players,
favorites and absence of recorded sessions. Unknown player counts do not match
a minimum-player filter. Running games are excluded. Reroll avoids the previous
result whenever another matching game exists. Selecting a result does not start
a session; launching still goes through version/disc selection.
In Couch Mode, LB/RB moves focus between filter controls; the D-pad changes
select/numeric values, A activates buttons or checkboxes and B closes the dialog.

**Edit game → Launch actions** configures ordered programs before and after a
session. Actions belong to the edition being edited, including native versions.
An argument occupies one line, without shell quoting. Supported substitutions:
`%ROM%` (the selected disc), `%GAME_DIR%`, `%GAME_TITLE%`. For Steam/Epic the ROM
value is the launch reference, not a local executable. The optional directory
sets the child process's working directory. Select an interpreter explicitly
to run scripts, passing the script as an argument.

Waiting actions must succeed within two minutes. A failed before action stops
launch without recording a session. Non-waiting actions start independently.
After actions start when the existing session tracker detects the game ending;
their failures appear through launch diagnostics without changing saved playtime.
Monitoring errors do not run after actions while the game's state is uncertain.
Actions run with the application's normal privileges, use structured arguments,
and are not inferred from downloaded metadata. Closing OpenCabinet prevents
further after-session actions; keep it running to execute them.
