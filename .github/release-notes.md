## What's new in v0.2.1

- OpenCabinet is now available for Linux x86_64 as an AppImage, built on Ubuntu 22.04.
- Import and launch native Linux games, installed Steam games from native or Flatpak installations, and Windows games through user-installed Wine or Proton with UMU.
- Download the Linux version of RetroArch and its cores, with session tracking and launch diagnostics.
- Keep Linux data and configuration in the user's XDG directories, with library relocation, backups, cached artwork and PDF/CBZ manuals.
- Register the AppImage's application icon and desktop launcher for Linux desktop integration.
- Publish signed Windows and Linux updates together through the app's updater.
- Group multiple recomp/decomp builds with the same original game and choose the version to play.

## Novedades de v0.2.1

- OpenCabinet ahora está disponible para Linux x86_64 como AppImage, compilado sobre Ubuntu 22.04.
- Importación y ejecución de juegos nativos de Linux, juegos instalados de Steam nativo o Flatpak y juegos de Windows mediante Wine o Proton con UMU instalados por el usuario.
- Descarga de RetroArch para Linux y sus núcleos, con seguimiento de sesiones y diagnóstico de lanzamientos.
- Datos y configuración en las carpetas XDG del usuario, con traslado de biblioteca, backups, caché de imágenes y manuales PDF/CBZ.
- Registro del icono y del lanzador del AppImage para integrarlo con el escritorio de Linux.
- Actualizaciones firmadas para Windows y Linux publicadas juntas, disponibles desde la app.
- Posibilidad de agrupar varias recompilaciones o decompilaciones con el mismo juego original y elegir qué versión ejecutar.

## Downloads / Descargas

- **`windows_x64_setup.exe`**: Windows x64 installer / Instalador para Windows x64.
- **`windows_x64_portable.zip`**: Extract into a writable folder and run `opencabinet.exe` / Extraé en una carpeta con permisos de escritura y ejecutá `opencabinet.exe`.
- **`linux_x86_64.AppImage`**: Linux x86_64 application. Ubuntu 22.04 or newer, or a compatible distribution. Make the file executable before opening it / Aplicación para Linux x86_64. Ubuntu 22.04 o posterior, o una distribución compatible. Dale permisos de ejecución antes de abrirla.
- **`SHA256SUMS.txt`**: File checksums / Sumas de comprobación de los archivos.
- **`latest.json`** / **`.sig`**: Update feed and signatures for both platforms / Catálogo y firmas de actualización para ambas plataformas.

The Windows portable build requires Microsoft Edge WebView2 Runtime. The installer
can install it if necessary. Epic Games import is currently Windows-only. Wine,
Proton and UMU must be installed separately on Linux. Updates are cryptographically
signed for the app's updater; Windows builds do not have an Authenticode certificate.

La versión portable de Windows necesita Microsoft Edge WebView2 Runtime. El
instalador puede instalarlo si hace falta. La importación de Epic Games sigue
siendo exclusiva de Windows. Wine, Proton y UMU se instalan por separado en Linux.
Las actualizaciones llevan una firma verificada por la app; las compilaciones de
Windows no tienen certificado Authenticode.

Games, ROMs, BIOS files, manuals and personal libraries are not included.
No se incluyen juegos, ROMs, BIOS, manuales ni bibliotecas personales.

Existing users can install this update from About → Update and restart.
Los usuarios pueden instalar esta actualización desde Acerca de → Actualizar y reiniciar.
