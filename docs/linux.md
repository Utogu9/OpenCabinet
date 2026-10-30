# Linux

OpenCabinet targets Linux **x86_64** as an AppImage. Windows builds remain supported.
Native Linux games, installed Steam libraries, emulators, Wine and Proton/UMU
are supported by the Linux implementation. Epic import is currently Windows-only.
AppImage builds and WebKitGTK smoke tests have been exercised in Ubuntu 22.04 and
26.04 on WSL2, including running the 22.04-built AppImage on 26.04. The native test
suite has also been run on 26.04. See the checklist below for testing graphics,
installed games and signed updates on a real Linux desktop.

## Running an AppImage

Download the Linux AppImage from a release or a Linux validation workflow artifact.
Extract the workflow artifact ZIP first, then grant the AppImage execute permission
in your file manager and open it. Keep it in a directory writable by your user
if you want to use the integrated updater.

On first launch, the AppImage registers its launcher and icon in the user's XDG
data directory so the desktop can identify the running application. Moving the
AppImage and opening it again updates this launcher. A custom user-created
`opencabinet.desktop` is preserved. The file manager's thumbnail for the AppImage
itself depends on the desktop's AppImage thumbnail support.

Some distributions require the FUSE 2 compatibility library to run AppImages.
Install the appropriate package for your distribution if the AppImage reports
that FUSE is missing. OpenCabinet does not require administrator permissions.

Linux uses WebKitGTK for the interface and WebGL for the Three.js boxes. A real
Linux desktop is the reference for graphics and performance. WSL and virtual
machines are useful for compilation and functional tests; their GPU behavior
does not establish native desktop performance.

## User data

- Bootstrap configuration: `$XDG_CONFIG_HOME/opencabinet/opencabinet.config.json`.
- Library and media: `$XDG_DATA_HOME/opencabinet`.
- If unset, the bases are `~/.config` and `~/.local/share`, respectively.
- Cached covers stay in the library's `cache` directory unless changed in Preferences.
- Managed compatibility prefixes use `compatibility/<edition-id>` inside the data directory.

Moving or updating the AppImage does not move the library. Data relocation,
backups, image collections and PDF/CBZ manuals use the same application controls
as Windows. Automatic backups contain the database and settings, not Wine/Proton
prefix contents. Back up prefixes separately when they contain save files.

Windows debug databases are not automatically copied or converted. Paths are
case-sensitive on Linux, so `Game.iso` and `game.iso` remain distinct files.

## Games and emulators

Native games and emulators can be executable binaries, AppImages or executable
scripts. Import the actual game file, not its installer. OpenCabinet does not
change permissions on user-selected files.

For Windows games, choose **Wine** or **Proton via UMU** during import, or in
**Edit game → Launch**. Select an installed runner and optionally an existing
prefix and working directory. Leaving the prefix blank creates an independent
managed prefix for that edition. Runner settings belong to each regional/recomp
version; play time and sessions retain their existing aggregation behavior.

Wine, Proton and `umu-run` must be installed separately. Select the Proton
directory containing its executable `proton` script. UMU may download its Steam
Linux Runtime on the first launch, but OpenCabinet does not download runner
versions. See the [UMU documentation](https://github.com/Open-Wine-Components/umu-launcher).

Steam import reads installed manifests from native and Flatpak installations,
including additional libraries in `libraryfolders.vdf`. Steam games launch through
their own client, which selects Proton where necessary. No Steam API key or
account password is requested.

RetroArch's optional downloader uses Libretro's official Linux AppImage package
and individual `.so` cores. System RetroArch installations may also be selected.
Downloaded cores and information files stay in the user's data directory instead
of writing into `/usr`. Firmware/BIOS files remain user-supplied.

## Building and testing

On Ubuntu 22.04, install the build dependencies:

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libssl-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
  libfuse2 xvfb webkit2gtk-driver libgl1-mesa-dri xdg-utils x11-utils \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-tools
```

On Ubuntu 26.04, the corresponding package names are `libfuse2t64` and
`webkitgtk-webdriver` instead of `libfuse2` and `webkit2gtk-driver`.

Install Rust 1.90 or newer and Node.js 22.13 or newer. Clone the project into
the Linux filesystem, particularly when using WSL, then run:

```sh
npm ci
npm run prepare:icons
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib --locked
npm run dev
```

To build a local AppImage without a signing key:

```sh
npm run build -- --target x86_64-unknown-linux-gnu --bundles appimage \
  --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
```

The Linux validation workflow also builds an unsigned test AppImage and runs
the application in WebKitGTK through `tauri-driver`, WebKitWebDriver and Xvfb.
It uses a temporary XDG profile, never a personal library. The software renderer
is enabled only for those headless CI tests, not in the distributed application.
The smoke test opens CSS and Three.js boxes, renders PDF/CBZ manuals, imports and
launches a harmless native script, and checks its session and working directory.
It also checks desktop file/URL opening without exposing AppImage-private libraries
to the desktop programs.

For the same WebDriver smoke test locally, build the debug application with
`--debug --no-bundle --target x86_64-unknown-linux-gnu`, install `tauri-driver`
with `cargo install tauri-driver --locked`, and run:

```sh
xvfb-run -a node scripts/linux-webdriver-smoke.cjs \
  src-tauri/target/x86_64-unknown-linux-gnu/debug/opencabinet
```

Before a Linux release, check on a real desktop:

- Import ROMs and native games with spaces, accents and differently cased paths.
- Launch Steam, an emulator, a Wine game and a Proton/UMU game; close each game
  and verify its individual session and grouped statistics.
- Exercise RetroArch installation, core installation, cancellation and missing firmware errors.
- Open boxes, manuals and fullscreen images on X11 and Wayland where available.
- Move the data folder, create/restore backups, and restart the application.
- Test a signed AppImage update between two private test versions using a
  temporary update feed and temporary key. Never change the public stable feed
  or production signing configuration for this test.
