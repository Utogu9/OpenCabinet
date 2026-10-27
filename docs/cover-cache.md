# Caché de portadas

En **Opciones → Preferencias → Datos de usuario** se puede elegir entre:

- **Disco (predeterminado):** conserva miniaturas WebP con calidad del 90 % de hasta 320 × 400 píxeles en `data/cache/covers-v2`. Prepara todas las portadas de la biblioteca en segundo plano, sin límite de archivos. Prioriza la vista actual, con dos trabajos simultáneos y pausas durante el desplazamiento. Una caché adicional en RAM mantiene fluida la navegación; su límite es configurable y vale 400 miniaturas decodificadas por defecto.
- **Solo RAM:** no consulta ni escribe la caché en disco. Conserva el límite configurable de 1 a 2000 portadas (400 por defecto); al cerrar OpenCabinet se libera la memoria.

El campo **Máximo de miniaturas en RAM** está disponible en ambos modos, entre 1 y 2000. Cuenta portadas, cubiertas completas, inlays y vistas previas de manuales decodificadas, dentro de una misma caché compartida. Se aplica al guardar sin reiniciar. En modo disco no limita los archivos persistentes: se sigue preparando toda la biblioteca.

La carpeta de caché puede elegirse mediante **Examinar**. La ruta personalizada y el modo se guardan junto con las preferencias existentes. Una ruta vacía utiliza `cache` dentro de la carpeta de datos activa, por lo que sigue sus cambios de ubicación. Las preferencias se aplican al guardar, sin reiniciar. Se valida que la carpeta elegida permita escribir. Al cambiar de carpeta se vuelve a preparar la caché allí; la anterior se conserva y las imágenes originales no se mueven.

Cada nombre de miniatura incluye una clave de la ruta original y una versión calculada a partir de su tamaño y fecha de modificación con precisión de nanosegundos. En cada lectura desde disco se verifica la versión; si cambió, se genera una miniatura nueva y se retira la versión anterior de esa misma portada. Después de editar un juego también se invalida su miniatura en RAM. Las imágenes originales no se sobrescriben.

La decodificación, reducción y codificación WebP con calidad del 90 % se realizan en `cover-worker.js`. Los comandos Rust de `cover_cache.rs` ejecutan las consultas de archivos y escrituras fuera del hilo de interfaz. La miniatura se escribe primero en un temporal y se publica cuando está completa. Una escritura tardía se rechaza si cambió el original. Un archivo de caché dañado se regenera; un error de acceso permite seguir mostrando las portadas mediante RAM, con un aviso.

La caché es descartable: se puede borrar con OpenCabinet cerrado y se reconstruye sin descargar nuevamente las imágenes. No contiene datos de los juegos ni sustituye las colecciones de imágenes y sus manifiestos. Los cambios externos a una imagen ya retenida en RAM se reconocerán cuando vuelva a consultarse su caché en disco, por ejemplo al reiniciar la aplicación.

## Cubiertas completas y Caja 3D

El tipo `box_full` también se prepara en segundo plano en modo disco, en `cache/covers-v2/full`. Su vista previa conserva la imagen completa en WebP al 90 %, con un máximo de 1280 × 800 píxeles y sin aumentar imágenes pequeñas. Las miniaturas normales del listado mantienen el máximo de 320 × 400.

La Caja 3D usa inmediatamente la cubierta completa retenida en RAM. Si todavía no está allí, solicita su miniatura a la caché en disco con prioridad al seleccionar el juego. Esta vista previa envuelve todas las caras y curvas con las mismas coordenadas que la original: no se guardan ni generan archivos separados por cara. La original sustituye a la vista previa después de decodificarse. Si no hay una cubierta completa preparada, se conserva la miniatura de portada disponible mientras se carga.

En modo solo RAM se puede preparar la cubierta completa al seleccionar el juego sin escribir en disco. Las solicitudes y URL temporales del visor se liberan al cambiar de juego o cerrar el visor, y una respuesta atrasada no puede sustituir la imagen de otro juego ni una original ya cargada.

## Inlays y primera página de manuales de Dreamcast

En modo disco se preparan también todos los inlays de Dreamcast, incluidas las
variantes regionales. Se guardan en `covers-v2/inlay` con hasta 1280 × 800
píxeles. El visor aplica la vista previa al fondo y a los lomos con las mismas
UV de la original; después la sustituye por la imagen completa. Una vista
previa ya disponible no espera a que termine de cargarse la portada.

Los manuales se descubren en segundo plano después de mostrar la biblioteca.
Se procesa un PDF a la vez, únicamente su primera página y a un máximo de
800 píxeles por lado, con pausas al desplazar la biblioteca. El resultado WebP
se guarda bajo `covers-v2/manual-v1`, separado por modo de recorte: automático,
página completa, izquierda o derecha. El tamaño y la fecha de modificación
del PDF invalidan una miniatura antigua; cambiar el recorte utiliza otra
entrada. Un archivo dañado se vuelve a generar y un fallo de caché no impide
leer el manual.

Al seleccionar el juego, esa primera página aparece mientras PDF.js prepara
la versión definitiva. Si la preparación previa ya conoce el manual del juego,
el visor reutiliza inmediatamente sus píxeles en RAM o solicita la ruta conocida
de la miniatura en disco, sin esperar a consultar de nuevo la carpeta ni la
fecha del PDF. Esas comprobaciones siguen en paralelo. La portada del juego no
se muestra provisionalmente sobre el manual mientras se resuelve su carga;
queda como alternativa cuando no hay manual o su carga falla sin una vista previa.
Una selección sin caché reutiliza ese mismo render
para generar la miniatura: no abre dos veces el PDF para crear ambas versiones.
El resto de las páginas y la contraportada siguen cargándose bajo demanda.
En modo sólo RAM no se leen ni escriben estas carpetas, y las vistas previas
se preparan al seleccionar el juego. Se respetan la ubicación de caché elegida,
el presupuesto compartido de RAM y las cancelaciones al cambiar de juego.
