# Caché de portadas

En **Opciones → Preferencias → Datos de usuario** se puede elegir entre:

- **Disco (predeterminado):** conserva miniaturas WebP con calidad del 90 % de hasta 320 × 400 píxeles en `data/cache/covers-v2`. Prepara todas las portadas de la biblioteca en segundo plano, sin límite de archivos. Prioriza la vista actual, con dos trabajos simultáneos y pausas durante el desplazamiento. Una caché adicional en RAM mantiene fluida la navegación; su límite es configurable y vale 400 miniaturas decodificadas por defecto.
- **Solo RAM:** no consulta ni escribe la caché en disco. Conserva el límite configurable de 1 a 2000 portadas (400 por defecto); al cerrar OpenCabinet se libera la memoria.

El campo **Máximo de miniaturas en RAM** está disponible en ambos modos, entre 1 y 2000. Cuenta portadas y cubiertas completas decodificadas y se aplica al guardar sin reiniciar. En modo disco no limita los archivos persistentes: todas las portadas y cubiertas completas se siguen preparando y conservando allí.

La carpeta de caché puede elegirse mediante **Examinar**. La ruta personalizada y el modo se guardan junto con las preferencias existentes. Una ruta vacía utiliza `cache` dentro de la carpeta de datos activa, por lo que sigue sus cambios de ubicación. Las preferencias se aplican al guardar, sin reiniciar. Se valida que la carpeta elegida permita escribir. Al cambiar de carpeta se vuelve a preparar la caché allí; la anterior se conserva y las imágenes originales no se mueven.

Cada nombre de miniatura incluye una clave de la ruta original y una versión calculada a partir de su tamaño y fecha de modificación con precisión de nanosegundos. En cada lectura desde disco se verifica la versión; si cambió, se genera una miniatura nueva y se retira la versión anterior de esa misma portada. Después de editar un juego también se invalida su miniatura en RAM. Las imágenes originales no se sobrescriben.

La decodificación, reducción y codificación WebP con calidad del 90 % se realizan en `cover-worker.js`. Los comandos Rust de `cover_cache.rs` ejecutan las consultas de archivos y escrituras fuera del hilo de interfaz. La miniatura se escribe primero en un temporal y se publica cuando está completa. Una escritura tardía se rechaza si cambió el original. Un archivo de caché dañado se regenera; un error de acceso permite seguir mostrando las portadas mediante RAM, con un aviso.

La caché es descartable: se puede borrar con OpenCabinet cerrado y se reconstruye sin descargar nuevamente las imágenes. No contiene datos de los juegos ni sustituye las colecciones de imágenes y sus manifiestos. Los cambios externos a una imagen ya retenida en RAM se reconocerán cuando vuelva a consultarse su caché en disco, por ejemplo al reiniciar la aplicación.

## Cubiertas completas y Caja 3D

El tipo `box_full` también se prepara en segundo plano en modo disco, en `cache/covers-v2/full`. Su vista previa conserva la imagen completa en WebP al 90 %, con un máximo de 1280 × 800 píxeles y sin aumentar imágenes pequeñas. Las miniaturas normales del listado mantienen el máximo de 320 × 400.

La Caja 3D usa inmediatamente la cubierta completa retenida en RAM. Si todavía no está allí, solicita su miniatura a la caché en disco con prioridad al seleccionar el juego. Esta vista previa envuelve todas las caras y curvas con las mismas coordenadas que la original: no se guardan ni generan archivos separados por cara. La original sustituye a la vista previa después de decodificarse. Si no hay una cubierta completa preparada, se conserva la miniatura de portada disponible mientras se carga.

En modo solo RAM se puede preparar la cubierta completa al seleccionar el juego sin escribir en disco. Las solicitudes y URL temporales del visor se liberan al cambiar de juego o cerrar el visor, y una respuesta atrasada no puede sustituir la imagen de otro juego ni una original ya cargada.
