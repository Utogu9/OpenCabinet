# Archivos, carpetas de biblioteca e historial de sesiones

## Cambiar el archivo de un juego

Cuando falta el archivo, el botón de jugar queda gris y permite abrir el
selector para reemplazar su asociación. En un juego con regiones o varios
discos se elige qué archivo cambiar. No se mueven ni borran ROMs, imágenes o
manuales; se conservan el juego, sus datos y sus estadísticas.

En **Editar juego → Ejecución**, **Cambiar archivo del juego…** prepara el
cambio y lo aplica al guardar. En juegos con varios discos, el desplegable
permite elegir el disco; los demás archivos y sus etiquetas se conservan.
Cancelar la edición descarta el cambio. No se permite reemplazar un archivo
por otro ya asociado a otra entrada ni cambiar fuentes durante una partida.
Los ejecutables de juegos directos se reemplazan por otro `.exe`. Las
instalaciones de Steam y Epic se administran desde su propio lanzador.

## Buscar juegos nuevos en carpetas guardadas

El paso **Seleccionar carpeta de ROMs** tiene la casilla **Guardar este
directorio para buscar juegos nuevos**. Al escanear se guardan el directorio y
sus extensiones para esa consola, incluso si no se encontraron juegos nuevos.
La selección de consola y emulador conserva su funcionamiento habitual.

**Buscar juegos nuevos**, en el menú contextual de la consola, vuelve a escanear
una carpeta guardada. Si hay varias, permite elegir. Los juegos nuevos pasan
por la revisión e importación normales; los duplicados se omiten. Si falta un
emulador, se muestra la configuración antes de continuar.

**Editar consola → Carpetas de biblioteca** muestra los directorios guardados,
con acciones para buscar juegos nuevos o quitar el directorio de la lista.
Quitar un directorio no borra sus archivos ni los juegos importados.

## Historial de sesiones

El pequeño reloj junto al tiempo jugado, el menú contextual y **Editar juego →
Ejecución** abren el mismo historial. Cada fila muestra inicio, duración,
archivo ejecutado, juego/región y estado. Los resultados se cargan de cien en
cien y se pueden actualizar mientras hay una sesión en curso.

El historial respeta la preferencia de combinar estadísticas regionales; en el
editor, la vista separada corresponde a la región que se está editando. Los
registros se guardan en `play_sessions` dentro de la biblioteca y acompañan sus
copias de seguridad. Los checkpoints actualizan el tiempo acumulado y el
historial dentro de una misma transacción. Una interrupción de la app conserva
el último checkpoint y marca esa sesión como interrumpida en el siguiente
inicio. Unir entradas como discos conserva las sesiones de las secundarias.

Los registros empiezan con esta función: no se inventan sesiones individuales
a partir de los tiempos y contadores históricos existentes.

## Errores de RetroArch

Antes de iniciar se comprueba que exista el núcleo elegido. Cuando su ficha
`.info` está disponible, se consultan sus requisitos de sistema/BIOS y la
carpeta configurada en RetroArch. Solo se informa ausencia; no se certifica
que un archivo existente sea una BIOS válida. Los archivos opcionales se
omiten y no se exige tener simultáneamente todas las alternativas regionales.
Las configuraciones adicionales indicadas por argumentos evitan esta
comprobación preventiva cuando no se puede determinar su carpeta efectiva.

El inicio también activa el registro de RetroArch, salvo que el usuario haya
elegido su propio `--log-file`. Durante los primeros quince segundos, los
errores de carga se muestran en una ventana de diagnóstico aunque RetroArch
permanezca en su menú. Si se cierra con error, se muestran su estado de salida
y los detalles disponibles. Se conserva el último registro por juego en
`data/logs`; no se acumula un archivo nuevo por cada sesión.

La detección usa las [fichas oficiales de núcleos](https://github.com/libretro/libretro-core-info)
y el [registro documentado por Libretro](https://docs.libretro.com/guides/generating-retroarch-logs/).
Por ejemplo, la [ficha de LRPS2](https://github.com/libretro/libretro-core-info/blob/master/pcsx2_libretro.info)
indica una carpeta de BIOS y aclara que comprobar su existencia no valida sus
contenidos. Un registro que no incluya el motivo del fallo no permite atribuirlo
con certeza a archivos faltantes.
