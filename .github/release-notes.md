## What's new in v0.5.0

- Move PlayStation 2/3/4/5, Xbox/360, Sega and Nintendo cases, PSP, cardboard boxes and generic DVD cases to Three.js with prebuilt GLB models.
- Add the red Nintendo Switch 2 case and improve plastic materials, cover reflections and disc highlights.
- Show Mega Drive/Genesis manuals inside their cases and display cached Dreamcast covers while original artwork loads.
- Download artwork for multiple games with up to four concurrent workers.
- Automatically discover artwork repository submodules and follow their main branches, preserving cached catalogs when offline.
- Show catalog regions in game matches, including Nintendo Switch editions.
- Add editable diagnostic reports from About → Logs, plus storage usage, thumbnail cache cleanup and retained collection review in Preferences.
- Keep storage scans optional and allow navigation while they run in the background.
- Verify that backups preserve session history and regional statistics, and that CBZ manuals with AVIF pages render correctly.
- Remove the duplicate blue keyboard focus outline from the game grid.

## Novedades de v0.5.0

- Cajas de PlayStation 2/3/4/5, Xbox/360, Sega y Nintendo, PSP, cartón y DVD genéricas convertidas a Three.js con modelos GLB preparados.
- Caja roja de Nintendo Switch 2 y mejoras en los materiales plásticos, reflejos de las carátulas y brillo de los discos.
- Manuales de Mega Drive/Genesis dentro de sus cajas y portadas cacheadas de Dreamcast mientras cargan las imágenes originales.
- Descarga de imágenes para varios juegos con hasta cuatro trabajadores simultáneos.
- Detección automática de submódulos del repositorio de imágenes, usando sus ramas main y conservando los catálogos locales sin conexión.
- Regiones del catálogo visibles en las coincidencias, incluidas las ediciones de Nintendo Switch.
- Diagnósticos editables desde Acerca de → Logs y gestión del almacenamiento, limpieza de miniaturas y revisión de colecciones conservadas en Preferencias.
- Cálculo de almacenamiento opcional que permite seguir navegando mientras trabaja en segundo plano.
- Verificación de la conservación de sesiones y estadísticas regionales en backups y de la lectura de manuales CBZ con páginas AVIF.
- Eliminación del doble borde de foco azul en la grilla al navegar con el teclado.

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
