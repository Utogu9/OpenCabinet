# Colecciones de imágenes

Las imágenes de un juego pertenecen a una colección identificada por OpenCabinet,
independiente del registro del juego en `opencabinet.db`. Al borrar un juego se
confirma primero la eliminación y luego se elige conservar los datos, descartarlos
o cancelar. Conservar guarda esa colección, los archivos, su clasificación y las
estadísticas de cada región. Las ROMs de distintas regiones
mantienen selecciones independientes aunque compartan el mismo ID del catálogo.

## Archivos y respaldo

Las colecciones nuevas se guardan en `images/<identificador>/`, dentro de la
carpeta de datos activa. Cada una contiene `manifest.json` con:

- Versión de formato e identificador propio de OpenCabinet.
- Título, plataforma e ID opcional del catálogo.
- Ruta original de la ROM, nombre de archivo, tamaño y regiones reconocidas.
- Imágenes seleccionadas, sus tipos y su orden, con rutas relativas a la colección.
- Tiempo de juego, cantidad de sesiones, última fecha jugada y ajuste propio de caja 3D.
  Se actualizan al conservar los datos antes de eliminar el juego. También se crea
  una colección cuando solo hay estadísticas y ninguna imagen.

Las colecciones existentes pueden conservar carpetas como `images/42/`:
su identidad está en el manifiesto y no depende de ese número. Las imágenes
externas antiguas se copian a la carpeta administrada para hacer portátil el
respaldo. No se eliminan los originales. Los archivos que ya estaban huérfanos
antes de esta función se conservan, pero no pueden identificarse automáticamente.

Para recuperar **las imágenes, manuales y estadísticas conservadas**, restaurá la carpeta `images` completa
en la carpeta de datos activa de OpenCabinet y reiniciá la app, o iniciá una
importación para volver a indexarla. Es necesario conservar los manifiestos junto
a los archivos. No hace falta el antiguo `opencabinet.db`, ni conexión a internet.
La ubicación activa se puede consultar en Preferencias.

Los manifiestos antiguos sin estadísticas siguen funcionando. No se recuperan
datos descriptivos ni la agrupación entre regiones: cada edición recupera sus
estadísticas propias, sin duplicar los totales del grupo. Una recuperación manual
no sobrescribe las estadísticas de una entrada que ya tiene partidas registradas.
Para respaldar la biblioteca entera, conservá toda la carpeta de datos.

**Descartar datos** elimina los registros y las carpetas administradas de las
colecciones de las regiones del juego. No elimina ROMs ni archivos originales
externos. La limpieza se registra en la misma transacción que el borrado; si un
archivo está bloqueado, se reintenta al iniciar y la colección pendiente no vuelve
a ofrecerse para recuperación. Los archivos huérfanos antiguos sin colección
conocida no se identifican ni se eliminan por suposición.

## Manuales PDF

Cada colección puede incluir una subcarpeta `manuals/`, por ejemplo
`images/<identificador>/manuals/`. Desde el menú contextual de un juego se pueden
abrir su carpeta de imágenes y su carpeta de manuales. Se crean si no existen.

En **Editar juego → Manuales (PDF)** se pueden elegir varios documentos: se
copian al guardar los cambios y se mantienen sus originales. Cancelar descarta
la selección pendiente. Los documentos idénticos se omiten y los archivos de
igual nombre con contenido distinto reciben un sufijo, sin sobrescribir nada.
Los PDF guardados se abren con el lector predeterminado del sistema.

También se pueden colocar PDF directamente en esa carpeta; se detectan al
abrir el editor, volver desde el explorador o pulsar **Actualizar lista**. Solo
se muestran documentos con extensión y cabecera PDF válidas. Estos archivos ya
están guardados aunque se cancele la edición del juego.

Los manuales se conservan al borrar juegos, cambiar sus títulos y reimportarlos.
Restaurar `images/` con sus manifiestos también recupera los manuales, incluso
si la colección no tiene imágenes. Una colección que solo tiene manuales permite
descargar imágenes durante la reimportación.

## Al importar

Después de revisar los títulos aparece **Imágenes y manuales guardados**. Se propone una
colección libre cuando coincide de forma única la ruta y la plataforma original.
Si confirmás una coincidencia en el catálogo, también se busca por ese ID y por
nombre, tamaño y región del archivo, permitiendo mover la carpeta de ROMs.

Podés usar la propuesta, elegir otra colección o seleccionar **No recuperar
imágenes ni manuales guardados**. Una misma colección no puede asignarse a dos ROMs activas.
Los casos ambiguos o archivos renombrados requieren selección manual: un título
parecido no alcanza para asociar imágenes automáticamente.

El botón **Importar sin buscar datos** también utiliza las colecciones locales
elegidas. Al buscar en el catálogo, el juego conserva sus títulos revisados y puede
obtener metadatos, pero no descarga nuevas imágenes si la colección elegida ya
contiene imágenes. Las descargas posteriores siguen disponibles desde Editar juego.

Los archivos faltantes o inválidos producen un aviso; se recuperan los que estén
disponibles. Los manifiestos dañados, incompatibles o con rutas externas no se
usan. Los archivos ajenos a la colección no se borran.

## Consistencia

Al iniciar se carga primero el catálogo desde SQLite. La reconstrucción del
índice de colecciones y la publicación de manifiestos pendientes se ejecutan
después, en segundo plano, sin bloquear los menús ni volver a dibujar la lista
de juegos. El inicio no abre cada imagen para validar su cabecera. Las imágenes
disponibles se comprueban al revisar o vincular colecciones para recuperar;
las colecciones de juegos activos utilizan las asociaciones de la base.

SQLite conserva un índice reconstruible y una cola de manifiestos pendientes.
Cada edición guarda sus imágenes, asociación y nueva versión del manifiesto en
la misma transacción. Una transacción fallida no publica un manifiesto nuevo y
elimina las copias creadas por esa operación.

Después del commit se publica `manifest.json` mediante un archivo temporal y
se conserva el anterior como `manifest.previous`. Si falla la publicación,
la cola conserva el cambio y lo reintenta al iniciar o revisar las colecciones.
Antes de borrar juegos se exige que sus manifiestos hayan podido guardarse.
`manifest.next` permite recuperar una publicación interrumpida cuando no quedó
un manifiesto principal válido; no deben copiarse carpetas mientras se están
guardando cambios si se necesita un respaldo de ese instante exacto.
