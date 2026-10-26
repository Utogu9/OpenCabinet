# Limpieza de descargas interrumpidas

Al iniciar, después de resolver la ubicación de los datos y completar un traslado
pendiente, OpenCabinet limpia las carpetas de operaciones interrumpidas en
`data/metadata/staging` (metadatos) y `data/metadata/retroarch-staging` (RetroArch).
Se ejecuta antes de que se puedan iniciar nuevas descargas. Solo reconoce las
subcarpetas con identificadores numéricos que genera la aplicación.

Los núcleos de RetroArch se copian primero a un archivo
`.<núcleo>_libretro-<operación>.part` junto al destino. Las operaciones nuevas
guardan previamente su ruta en `core-partial.json`, dentro de su carpeta temporal,
para poder limpiar también instalaciones externas todavía no registradas. La
limpieza comprueba que el nombre corresponda a esa operación. Para los restos de
versiones anteriores, revisa las carpetas de núcleos de las instalaciones de
RetroArch registradas y la instalación administrada por OpenCabinet, respetando
`libretro_directory` en `retroarch.cfg`.

No borra catálogos finales ni sus copias de recuperación, ROMs, imágenes,
manifiestos, manuales, caché persistente, emuladores instalados ni núcleos `.dll`.
Los archivos desconocidos y los enlaces o junctions se conservan. Cada descenso
recursivo comprueba que la ruta resuelta siga dentro de la carpeta temporal.

Los errores no impiden abrir la aplicación: se registran y los restos se vuelven
a revisar en el siguiente inicio. Si falla la limpieza de una copia externa con
recibo, se conserva la carpeta de la operación para poder reintentarlo.

Esta limpieza es independiente de `target/debug/deps` e `incremental`, que son
artefactos de compilación de Rust y no se distribuyen con la aplicación final.
