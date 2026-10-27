# Copias de seguridad y archivos ausentes

En **Opciones → Preferencias → Datos de usuario → Copias de seguridad** se pueden
crear y restaurar archivos `.ocbackup`, abrir su carpeta y elegir si se realizan
copias automáticas. Se accede desde el menú lateral de Preferencias: **Copias de
seguridad** aparece con sangría debajo de **Datos de usuario**. Datos de usuario
conserva los ajustes de carpeta y caché; las copias tienen una página propia, sin
pestañas debajo del título ni ventana emergente. Se guardan en `backups`, dentro
de los datos activos. Durante una operación no se puede cerrar Preferencias.

Las automáticas están activadas inicialmente. Al iniciar y una vez por hora se
comprueba si pasaron 24 horas desde la última; si no hay partidas, importaciones,
descargas o traslado pendiente, se crea una copia liviana. Se conservan siete,
configurables entre 1 y 30. Solo se elimina una automática antigua después de
publicar otra correctamente. Las manuales no se eliminan automáticamente.

La copia liviana contiene una instantánea consistente de SQLite (incluidas las
escrituras confirmadas en WAL), biblioteca, estadísticas, emuladores configurados
y preferencias. La completa agrega las imágenes y manuales de las colecciones
administradas, incluidas las imágenes de consolas. No copia ROM, ejecutables,
binarios de emuladores, catálogos descargables ni cachés. Los medios enlazados
fuera de la carpeta administrada no se incluyen. Las copias locales no protegen
contra la pérdida de la unidad: se puede copiar el archivo a otro dispositivo.

Restaurar requiere confirmación y prepara una carpeta hermana nueva, con las
rutas administradas ajustadas. Se conserva la biblioteca anterior, se crea una
copia liviana de seguridad y se programa la activación usando el mecanismo de
cambio de datos existente. El botón de reiniciar queda disponible al terminar.
La copia liviana reutiliza los medios actuales; no resucita imágenes o manuales
eliminados. Las preferencias se aplican al reiniciar. Los binarios de emuladores
administrados se conservan desde la instalación actual cuando están disponibles.
El historial de copias original permanece en la carpeta de datos anterior y se
puede abrir mediante **Elegir archivo…**. Para volver a esa biblioteca, se puede
seleccionar su carpeta desde Datos de usuario.

Los ZIP se validan antes de activarlos: versión, estructura de biblioteca,
integridad de SQLite, rutas relativas, nombres repetidos y enlaces. No se
sobrescriben los datos activos. El trabajo ocurre fuera del hilo de interfaz y
las operaciones manuales muestran progreso. Los parciales de operaciones propias
interrumpidas se limpian al volver a arrancar. Antes de instalar una actualización
también se crea una copia liviana de seguridad.

## Disponibilidad del juego seleccionado

Al seleccionar un juego se comprueban únicamente sus archivos, discos y regiones;
no se recorre periódicamente la biblioteca. Si ninguno está disponible, el botón
de jugar se deshabilita, queda atenuado y muestra **Falta el archivo**. Si queda un
disco o región disponible, se permite abrir el selector habitual. Steam y Epic
se comprueban por su instalación local y cliente, no por la URI como si fuera una
ruta de archivo. Las respuestas tardías de una selección anterior se descartan.
