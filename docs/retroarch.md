# RetroArch

En **Opciones → Configurar emuladores**, selecciona **RetroArch (núcleo automático)** como tipo. Elige una plataforma local y un núcleo; las opciones marcadas con ★ son recomendaciones de OpenCabinet entre los núcleos compatibles que están disponibles en Libretro. No se descarga toda la colección de núcleos.

## Una instalación compartida

**Examinar** permite utilizar un `retroarch.exe` existente. Se lee su arquitectura (Windows x86 o x64) y su `retroarch.cfg` para respetar las carpetas `libretro_directory` y `libretro_info_path`, incluidas rutas relativas `:/`. Debe ser una instalación en la que el usuario pueda escribir para descargar núcleos.

**Descargar RetroArch** es opcional: obtiene la última versión estable portátil del [servidor oficial de Libretro](https://buildbot.libretro.com/stable/) y la extrae en `data/emulators/RetroArch`. No abre un instalador ni ejecuta los archivos descargados. No reemplaza una instalación existente ni descarga el paquete completo de núcleos. El ejecutable se recuerda para poder reutilizarlo en otras plataformas. Los emuladores convencionales conservan su funcionamiento y sus argumentos actuales.

## Núcleos por consola

También está disponible desde **Herramientas → Buscar ROMs en carpeta**, en el paso **Emulador para la plataforma** cuando no hay un emulador configurado, o al elegir **Configurar nuevo emulador**. Selecciona **RetroArch (núcleo automático)**, reutiliza una instalación o descarga la versión portátil, elige el núcleo y pulsa **Guardar Emulador para esta Consola**. Una vez listo aparece en el selector y puedes continuar con la importación. Las plataformas personalizadas utilizan el nombre que escribiste y permiten seleccionar su equivalencia en Libretro. Durante una descarga se bloquean el cambio de consola y el escaneo; **Cancelar descarga** permite detenerla y reintentar sin registrar un emulador incompleto.

El catálogo combina el [índice oficial de descargas para Windows](https://buildbot.libretro.com/nightly/windows/x86_64/latest/.index) con las [fichas oficiales de núcleos](https://buildbot.libretro.com/assets/frontend/info.zip). Solo se ofrecen núcleos con una descarga disponible para la arquitectura elegida. La caché queda en `data/metadata` y permite reutilizar la lista sin conexión; **Actualizar lista de núcleos** vuelve a consultarla y conserva la anterior si falla.

Para nombres habituales como SNES, PS2 o Genesis se selecciona el sistema correspondiente automáticamente. Los nombres personalizados permiten elegir la equivalencia mediante **Sistema del catálogo Libretro**, sin renombrar la plataforma local. La lista ordena primero los núcleos recomendados y permite elegir otra opción compatible.

Al guardar se descarga únicamente el núcleo elegido, si no está instalado, desde el buildbot oficial. Los núcleos son las compilaciones que ofrece el actualizador de Libretro (nightly), mientras que la descarga de RetroArch es estable. Se validan el ZIP, el nombre del archivo y su arquitectura antes de publicar la DLL. Se instala su ficha `.info` si no existe. Los archivos ya instalados se reutilizan y no se actualizan automáticamente.

La ruta del núcleo se guarda en `emulators.retroarch_core_path`, separada de los argumentos adicionales. OpenCabinet genera `-L <ruta del núcleo>`, pasa la ROM como un único argumento y conserva la medición de sesiones y tiempo. Si los argumentos adicionales no incluyen `%ROM%`, añade la ROM al final. No se debe escribir `-L` manualmente en este modo. Las configuraciones anteriores con parámetros manuales se siguen abriendo como configuraciones manuales hasta que el usuario las cambie.

Algunos núcleos requieren BIOS o archivos adicionales: se muestran los requisitos declarados en su ficha, pero esos archivos se configuran en RetroArch por separado. Descargar el núcleo no garantiza que esos requisitos estén satisfechos ni que el equipo tenga el rendimiento necesario.

## Descargas y datos

Las consultas, descargas y extracciones se ejecutan fuera del hilo de la interfaz. El panel muestra progreso y permite cancelar. Cada operación tiene su identificador, por lo que se ignoran mensajes atrasados. Los paquetes se preparan en una carpeta temporal y se limpia al terminar o cancelar. El emulador no se registra hasta que el núcleo esté listo. Si se cancela la edición después de una descarga completa, la instalación queda disponible para reutilizarse.

Durante una descarga o la preparación de RetroArch, hacer clic en el fondo fuera del panel lo minimiza sin cancelar la operación. Aparece una ventanita con progreso y botón de cancelar, tanto desde Configurar emuladores como desde el importador. Puedes arrastrarla por su encabezado dentro de la app y pulsar **↗** para volver al mismo panel sin reiniciar la descarga. Su posición se conserva durante la ejecución y se ajusta al cambiar el tamaño de la app. Los errores y la finalización permanecen visibles hasta cerrar la ventanita o abrir la configuración.

Las rutas guardadas del ejecutable compartido y de los núcleos dentro de `data` se ajustan al trasladar la biblioteca. El reinicio para trasladar datos se bloquea mientras hay una descarga de RetroArch en curso.

## Validación

`npm.cmd test` incluye las pruebas de selección, equivalencias, recomendaciones, reutilización, errores, cancelación y respuestas atrasadas. `cargo test --manifest-path src-tauri/Cargo.toml --lib` incluye las pruebas de catálogo, ZIP, arquitectura, configuración, migración y ejecución.

Pruebas opcionales de integración (sin ejecutar RetroArch):

```powershell
# Consulta fixtures descargados: retroarch-cores.index y retroarch-info.zip.
$env:OPENCABINET_RETROARCH_FIXTURES = Join-Path $PWD 'target'
cargo test --manifest-path src-tauri/Cargo.toml --lib real_libretro_catalog_smoke -- --ignored --nocapture

# Descarga y extrae RetroArch portátil y Snes9x en una carpeta temporal.
cargo test --manifest-path src-tauri/Cargo.toml --lib real_portable_and_core_download_smoke -- --ignored --nocapture
```
