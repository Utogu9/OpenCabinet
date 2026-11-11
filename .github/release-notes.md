## What's new in v0.6.0

- Remove discs from their cases and inspect the disc and case independently in the same 3D viewer, with animated extraction and reflective disc backs.
- Fix camera clipping after reinserting discs, independent zoom controls, and Dreamcast/PlayStation disc center holes and artwork.
- Use folded rear-cover spines on Sega CD/Saturn cases.
- Improve original ROM title and regional matching, including compact Genesis region tags, and use localized catalog labels as game titles.
- Support AVIF artwork imports, downloads and thumbnails.
- Delete managed manuals directly from Edit game → Manuals.
- Check for catalog updates automatically when importing with a catalog older than one week; this can be disabled in Preferences.
- Choose the default import region for filenames without region tags, with USA/North America as the default.
- Support normalized SQLite repository catalogs alongside JSON, including the new PlayStation and PlayStation 2 submodules.
- Configure release date formats and restore preferences to their defaults.
- Show a draggable progress panel while removing multiple games.
- Make PS3/PS4 EBOOT folder searches controllable through the extensions list.

## Novedades de v0.6.0

- Discos extraíbles para inspeccionar la caja y el disco de forma independiente en el mismo visor 3D, con animación de extracción y reversos reflectantes.
- Correcciones del recorte de cámara al reinsertar discos, del zoom independiente y del agujero central y el arte de los discos de Dreamcast/PlayStation.
- Uso de los lomos incluidos en la contraportada de las cajas de Sega CD/Saturn.
- Mejoras en las coincidencias por nombre original y región, incluidas las etiquetas compactas de Genesis, y uso de los títulos localizados del catálogo.
- Importación, descarga y miniaturas de imágenes AVIF.
- Eliminación de manuales administrados desde Editar juego → Manuales.
- Comprobación automática de actualizaciones al importar con un catálogo de más de una semana, desactivable en Preferencias.
- Región de importación configurable para archivos sin región reconocible, con USA/Norteamérica como valor inicial.
- Soporte de catálogos SQLite normalizados junto con JSON, incluidos los nuevos submódulos de PlayStation y PlayStation 2.
- Formatos de fecha de lanzamiento configurables y restauración de preferencias predeterminadas.
- Progreso flotante y arrastrable al eliminar varios juegos.
- Búsqueda de carpetas EBOOT de PS3/PS4 controlable desde la lista de extensiones.

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
