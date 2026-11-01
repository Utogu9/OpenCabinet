## What's new in v0.3.0

- Add cartridge label artwork and prioritize it over complete cartridge photos in supported 3D models.
- Rotate the selected couch-mode box with the controller's right analog stick.
- Drag the console carousel with the mouse without selecting text, and keep long game titles on one line.
- Improve selection glows and allow zoomed 3D boxes to extend above the interface.
- Keep the last nine cover previews and prepared 3D boxes per console in RAM for faster return navigation.
- Prepare spine artwork independently and improve cached-to-original image transitions.
- Preserve WebGL contexts within a shared budget and keep the last complete frame visible during restoration, avoiding white boxes when switching models.

## Novedades de v0.3.0

- Nuevo tipo de imagen para las etiquetas de cartuchos, con prioridad sobre las fotos del cartucho completo en los modelos 3D compatibles.
- Rotación de la caja seleccionada en modo sofá con el stick analógico derecho del joystick.
- Desplazamiento del carrusel de consolas arrastrando con el mouse, sin seleccionar texto, y títulos largos en un único renglón.
- Mejoras en el brillo de selección y cajas que pueden sobresalir sobre la interfaz al hacer zoom.
- Conservación en RAM de las últimas nueve portadas y cajas 3D preparadas por consola para volver a ellas más rápido.
- Preparación independiente de las imágenes del lomo y mejores transiciones entre imágenes cacheadas y originales.
- Conservación de contextos WebGL dentro de un límite compartido y de la última imagen completa durante su restauración, evitando cajas blancas al cambiar de modelo.

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
