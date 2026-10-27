# Preferencias

La ventana usa categorías a la izquierda: **Inicio**, **Biblioteca** y **Datos de usuario**. Cambiar de categoría conserva los cambios pendientes; Guardar aplica todas las secciones y Cancelar los descarta. Se pueden recorrer las categorías con las flechas arriba/abajo, Inicio y Fin. Al abrir la ventana se muestra Inicio.

El botón **Acerca de** de la barra de menú abre la información de OpenCabinet y su versión instalada. Tanto esta ventana como Preferencias pueden cerrarse con Escape.

**Iniciar la app maximizada** está activado de forma predeterminada y se aplica en el siguiente inicio. Al desactivarlo, OpenCabinet se abre en una ventana de tamaño normal.

**Mostrar solo las portadas** oculta el título y la plataforma debajo de las tarjetas, sin reservar ese espacio. Si falta una portada, se conserva el título dentro del recuadro. La identificación al pasar el mouse, la selección con Ctrl/Shift y el menú contextual siguen disponibles. La vista se aplica al guardar; de forma predeterminada se mantiene la vista con título y plataforma.

Ambas elecciones se guardan localmente junto con las preferencias de la biblioteca. Las configuraciones guardadas por versiones anteriores conservan el límite de caché y reciben los valores predeterminados de las nuevas opciones.

En **Opciones → Preferencias** se configura el máximo de portadas en caché (400 de forma predeterminada, entre 1 y 99999). La elección se guarda localmente y se aplica al guardar, también después de reiniciar.

Al seleccionar una plataforma, Todo o una búsqueda, OpenCabinet prepara miniaturas en orden alfabético hasta completar ese límite. Las portadas visibles tienen prioridad. Cuando hay más juegos que espacio disponible, se reemplazan las miniaturas menos usadas, priorizando conservar las visibles. La precarga no recorre indefinidamente toda la colección.

La caché conserva miniaturas decodificadas de hasta 320 × 400 píxeles en memoria durante la ejecución, compartidas entre plataformas y búsquedas. No modifica los originales ni las imágenes del panel de detalles. Un worker lee y reduce las portadas; si no está disponible o una imagen remota impide su lectura, se usa carga asíncrona de respaldo. Se preparan como máximo dos imágenes simultáneamente y las nuevas cargas se pausan durante el desplazamiento.

Al cambiar de vista se cancela el trabajo pendiente y se conservan las miniaturas ya preparadas. Al disminuir el límite se liberan las sobrantes. Los lienzos de las tarjetas fuera de vista se vacían; al regresar se dibujan desde la caché sin volver a leer el original, salvo que la miniatura haya sido reemplazada por el límite.

## Ubicación de los datos de usuario

En la sección **Datos de usuario**, **Examinar...** permite seleccionar una carpeta vacía o una biblioteca existente, como una copia de seguridad. La app comprueba la carpeta y muestra qué hará antes de guardar:

- **Carpeta vacía:** se trasladarán los datos actuales al reiniciar.
- **Biblioteca válida de OpenCabinet:** se abrirán sus datos al reiniciar, conservando la carpeta actual. No se copian ni mezclan los registros de ambas bibliotecas.
- **Otros archivos o una base de datos dañada/incompatible:** se informa el error y no se programa el cambio.

**Guardar** programa el cambio; el botón pasa a decir **Reiniciar y trasladar datos** o **Reiniciar y abrir biblioteca**, según corresponda. También se puede cerrar y abrir OpenCabinet manualmente. Mientras no se reinicie, la app sigue trabajando con la carpeta actual. **Mantener ubicación actual** y luego **Guardar** cancela un cambio pendiente; **Usar carpeta predeterminada** también comprueba si `data` junto al ejecutable ya contiene una biblioteca.

El archivo `opencabinet.config.json`, junto al ejecutable, guarda la ubicación activa y la operación pendiente. Los traslados programados por versiones anteriores siguen interpretándose como traslados. Por ejemplo, después de cambiar de ubicación:

```json
{
  "data_directory": "D:\\OpenCabinet\\data",
  "pending_move": null
}
```

Sin ese archivo se usa la carpeta `data` habitual. En desarrollo, tanto `data` como el archivo de configuración se encuentran junto al ejecutable de `target/debug`. La configuración debe permanecer junto al programa, por lo que esa ubicación debe permitir escribir el archivo al programar un cambio.

Para abrir una biblioteca existente se comprueba `opencabinet.db` en modo de solo lectura: debe pasar la verificación de integridad de SQLite y tener las tablas y columnas básicas de OpenCabinet. Se admiten versiones antiguas sin las tablas y los campos opcionales incorporados más tarde. No se exige disponer de las ROMs, los ejecutables o todas las imágenes para reconocer una biblioteca: pueden volver a configurarse o descargarse. La comprobación se repite al guardar y al reiniciar; si falla, se mantiene la ubicación anterior. Al activar esta opción solo cambia la ubicación configurada; las migraciones habituales de esquema se ejecutan al abrir la biblioteca, igual que en un inicio normal.

Para trasladar a una carpeta vacía, antes de abrir las bases de datos se copia toda la carpeta en un directorio temporal del destino, se verifican las bases SQLite y se ajustan las rutas absolutas que apuntaban al origen. Las rutas relativas siguen funcionando; las ROMs y los emuladores externos conservan sus ubicaciones. Se mantienen los títulos, los datos del catálogo, los tiempos de juego y las sesiones.

En un traslado, solo después de terminar se cambia el archivo de configuración y se elimina el origen. Si la preparación o el guardado del archivo de configuración falla, se conserva el origen y se informa el error desde Preferencias. Una copia publicada antes de un fallo del archivo de configuración se reconstruye al reintentar para incorporar los cambios posteriores hechos en el origen. Si únicamente falla la limpieza final, la app ya usa la copia completa y avisa que quedaron archivos en la ubicación anterior. Abrir una biblioteca existente nunca elimina la carpeta anterior.

No se sobrescriben carpetas ajenas. Para un traslado no se permiten destinos dentro del origen o que lo contengan; un destino que deje de estar vacío no se convierte automáticamente en otra operación al reiniciar. Una ubicación personalizada que desaparezca o un archivo de configuración inválido impide iniciar la app con una biblioteca nueva por error. Se bloquea una segunda instancia desde el mismo directorio del programa y el botón de reinicio espera que se cierren los juegos y se terminen o cancelen las operaciones de importación y descarga.
