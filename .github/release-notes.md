## What's new in v0.3.1

- Support Nintendo Switch and Sega Dreamcast catalogs hosted in OpenCabinet-BDD submodules.
- Read catalogs and artwork from each repository's `main` branch instead of its pinned submodule commit.
- Migrate saved artwork URLs when a platform moves to a separate repository, preserving existing catalog matches and offline access.
- Read Switch catalog metadata, descriptions, original filenames and artwork regions.
- Treat an absent optional console-artwork catalog as no available artwork rather than a download failure.

## Novedades de v0.3.1

- Soporte para los catálogos de Nintendo Switch y Sega Dreamcast alojados como submódulos de OpenCabinet-BDD.
- Lectura de catálogos e imágenes desde la rama `main` de cada repositorio, en lugar del commit fijado en el submódulo.
- Actualización de las URLs guardadas cuando una plataforma cambia de repositorio, conservando las coincidencias existentes y el uso sin conexión.
- Lectura de metadatos, descripciones, nombres originales y regiones de imágenes del catálogo de Switch.
- La ausencia de un catálogo opcional de imágenes de consola se considera como falta de imágenes disponibles, sin producir un error de descarga.

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
