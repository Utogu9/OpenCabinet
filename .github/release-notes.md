## What's new in v0.8.1

- Identify supported ROMs and disc images by their internal serial or product code before falling back to title and filename matching.
- Add identification for PlayStation and PlayStation 2 ISO, CHD and CUE images, including compressed PS2 ISO.GZ files and existing index sidecars.
- Recognize Dreamcast, Sega Saturn and Sega CD CHD/CUE images, Wii ISO/RVZ/WBFS images, GameCube ISO/RVZ images and Mega Drive/Genesis ROMs.
- Use embedded regional information to improve catalog matching, and cache identification results to avoid repeated reads of unchanged files.
- Add a global preference to disable serial and product-code matching for all platforms. Identification is enabled by default.

## Novedades de v0.8.1

- Identificación de ROMs e imágenes de disco compatibles por su serial o código de producto interno, antes de recurrir al título y al nombre del archivo.
- Soporte para imágenes ISO, CHD y CUE de PlayStation y PlayStation 2, incluidos los archivos ISO.GZ de PS2 y sus índices existentes.
- Identificación de CHD/CUE de Dreamcast, Sega Saturn y Sega CD; ISO/RVZ/WBFS de Wii; ISO/RVZ de GameCube; y ROMs de Mega Drive/Genesis.
- Uso de la región interna para mejorar las coincidencias con el catálogo, con caché de resultados para evitar volver a leer archivos sin cambios.
- Nueva preferencia global para desactivar la búsqueda por serial y código de producto en todas las plataformas. Está activada por defecto.

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
