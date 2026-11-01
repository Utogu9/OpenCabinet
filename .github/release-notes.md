## What's new in v0.2.2

- Add fullscreen couch mode with game and platform carousels, keyboard navigation and controller support.
- Replace emoji buttons with consistent SVG icons on Windows and Linux.
- Fix missing or mismatched library covers on Linux after importing games or rebuilding the grid.
- Prepare Linux disk thumbnails in Rust in the background and reuse cached artwork in couch mode.
- Reduce repaints during Linux cover hover animations while preserving zoom, reflection and selection effects.

## Novedades de v0.2.2

- Nuevo modo sofá en pantalla completa, con carruseles de juegos y consolas, navegación por teclado y soporte para mandos.
- Botones con iconos SVG en Windows y Linux, en reemplazo de los emojis.
- Corrección de portadas ausentes o asignadas a otro juego en Linux después de importar o reconstruir la grilla.
- Preparación de miniaturas de disco en segundo plano mediante Rust y reutilización de la caché en el modo sofá de Linux.
- Menos repintados al pasar el mouse sobre las portadas en Linux, conservando el zoom, el reflejo y los efectos de selección.

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
