# Juegos con variantes regionales

Para agrupar ediciones ya importadas, selecciona varias entradas emuladas de la misma plataforma y elige **Unir regiones del mismo juego** en su menú contextual. Revisa las etiquetas de región y elige la entrada principal. No se agrupan automáticamente juegos por tener títulos parecidos.

Las etiquetas iniciales se deducen de los marcadores entre paréntesis o corchetes del nombre de archivo, por ejemplo `(USA)`, `[Europe]` o `(Japan, USA)`. Se pueden corregir antes de unir y posteriormente desde **Editar juego → Regiones**. No se supone que los títulos iguales sean necesariamente la misma edición.

Cada región conserva su identificador de juego, sus discos ordenados, datos, configuración de ejecución, colección de imágenes y manuales. Sus registros se agrupan mediante `game_regions`, sin mover ni eliminar ROMs, medios ni manifiestos. La biblioteca presenta solamente la entrada principal y suma los tiempos y sesiones de sus regiones. Se conserva la última fecha de juego más reciente. Se pueden incorporar más regiones seleccionando un grupo y otras entradas; la agrupación se realiza en una transacción y se rechaza si alguno de sus juegos está ejecutándose.

En **Editar juego → Regiones** se elige la región predeterminada, que determina el título, la fecha de lanzamiento, desarrollador, editor, género, modo de juego, jugadores, descripción y variables usados en la biblioteca, además de la portada del listado, las imágenes del lateral, el modelo regional de la Caja 3D y el manual. Los datos ausentes se muestran vacíos, sin tomar los de otra región. Cambiar la predeterminada no sobrescribe ninguna edición ni cambia el identificador estable del grupo. El editor abre inicialmente los datos de la región predeterminada; los botones **Editar esta región** permiten acceder a las otras ediciones. Antes de cambiar a otra región hay que guardar o cancelar los cambios pendientes. Los apartados Imágenes, Manuales, Discos y Ejecución corresponden a la región que se está editando. Las regiones agrupadas mantienen una misma plataforma.

Todos los accesos a **Jugar** pasan por el mismo flujo:

1. Si hay varias regiones, elegir una. La predeterminada se identifica y recibe el foco. Las regiones sin ningún archivo disponible se deshabilitan.
2. Si esa región tiene varios discos, elegir uno de sus discos ordenados.
3. Ejecutar con la configuración de esa edición y registrar la sesión solamente después de iniciar correctamente el proceso.

Cancelar cualquiera de los selectores no inicia una sesión. La elección para jugar no cambia la región predeterminada. El backend verifica que tanto la región como el disco pertenezcan al juego solicitado y que el archivo exista. El cambio de disco durante la partida sigue realizándose desde el emulador.

Las estadísticas se guardan en la región ejecutada, compartidas entre sus discos. **Opciones → Preferencias → Biblioteca → Mostrar estadísticas de varias regiones juntas** está activado por defecto: suma los tiempos y sesiones y muestra la fecha más reciente. Al desactivarlo, la biblioteca muestra solamente los tiempos, sesiones y última fecha de la región predeterminada. La preferencia se recuerda al reiniciar y no modifica las estadísticas guardadas. Las actualizaciones durante una partida incluyen los valores de cada región y sus totales; una sesión en cualquier región bloquea otro lanzamiento del grupo en ambos modos.

La configuración regional persiste en SQLite; el traslado de datos conserva las asociaciones porque estas usan identificadores y las rutas continúan en las tablas existentes. Eliminar la entrada de la biblioteca retira sus regiones y discos asociados; las colecciones de imágenes y manuales se conservan mediante el mecanismo habitual. Los manifiestos por sí solos recuperan las colecciones, no la agrupación regional de SQLite.
