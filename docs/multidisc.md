# Juegos con varios discos

El importador agrupa nombres como `Game (USA) (Disc 1).chd` y `Game (USA) (Disc 2).chd` en una sola entrada. También reconoce `Disk` y corchetes. Conserva las diferencias de región, idioma, revisión y carpeta; una numeración duplicada se deja sin agrupar para evitar unir ediciones distintas. Las pistas `Track` no se interpretan como discos.

La revisión muestra los archivos agrupados y permite quitar discos o importarlos por separado. Si encuentra discos adicionales de una entrada existente, ofrece agregarlos mediante una casilla desmarcada inicialmente. Esta incorporación conserva sus datos e imágenes.

Los juegos de varios discos muestran un selector al jugar desde cualquier acceso. OpenCabinet pasa únicamente el archivo elegido al emulador, con los argumentos habituales y el núcleo de RetroArch configurado. El cambio de disco durante una partida sigue realizándose desde el emulador. No se generan M3U, ni se trasladan ROMs o partidas guardadas.

En **Editar juego → Discos** se pueden agregar archivos, etiquetarlos, ordenarlos y quitar asociaciones. Debe quedar al menos uno. El primero mantiene la ruta principal de compatibilidad. Los archivos faltantes permanecen registrados y se deshabilitan en el selector.

Para unir entradas antiguas, seleccionarlas y elegir **Unir como juego de varios discos** en su menú contextual. Solo se admiten juegos emulados de la misma plataforma sin sesiones activas. La entrada principal conserva su ID, metadatos, imágenes y manuales; se suman tiempos y sesiones y se conserva la fecha jugada más reciente. Las colecciones secundarias quedan disponibles para recuperación manual. No se elimina ningún archivo ROM.

Los discos se guardan en `game_discs`, con rutas únicas normalizadas, etiquetas y orden. Los juegos anteriores reciben una asociación inicial sin agrupación automática. Los manifiestos de medios incorporan un campo opcional `discs` con identidad de cada archivo, compatible con manifiestos previos. La recuperación puede reconocer cualquiera de los discos y mantiene las comprobaciones de plataforma, región y ambigüedad.
