# Caja de Nintendo Switch con Three.js

El visor carga `case.glb` y `case.json` desde `src/models/switch/`.
Comparte los controles y la selección de imágenes entre el lateral, la pantalla
completa y la vista previa de configuración. Si el modelo o WebGL no están
disponibles, se utiliza el visor CSS.

## Modelo y animación

La geometría conserva las dos articulaciones de la caja. La tapa y su unión
giran juntas; el cartucho permanece unido a la base. El papel y el film usan
25 poses de deformación sincronizadas con los huesos, calculadas después del
suavizado del modelo. Three.js interpola estas poses en la GPU para mantener
la forma de los pliegues al abrir y cerrar la caja.

El archivo glTF usa metros y el visor convierte sus medidas a milímetros.
El grosor óptico respeta esa escala: 0,55 mm para el plástico y 0,08 mm para
el film. El film mantiene la misma respuesta óptica en portada, lomo y
contraportada, sin aplicar el refuerzo de dispersión de los relieves rígidos.

## Imágenes y controles

El exterior utiliza una cubierta completa cuando está disponible; en su
ausencia, compone portada, lomo y contraportada. El inlay sustituye el interior
impreso y `cart_front` proporciona la etiqueta del cartucho. Sin esas imágenes
se utiliza papel blanco o un título de reserva, según la superficie.

Se mantienen apertura, giro con arrastre, rueda para zoom, teclado, vistas
delantera y trasera y bloqueo de ejes mediante el menú contextual. Este visor
todavía no incorpora un manual físico ni acceso al lector desde el modelo.

## Carga y rendimiento

`npm run prepare:three` prepara Three.js y detecta si están disponibles los
dos archivos del modelo. Compilar y ejecutar OpenCabinet no requiere Blender
ni los archivos originales de creación.

El binario se conserva en memoria para reutilizarlo. Cada visor mantiene su
propia animación, geometría y materiales. Los límites de cinco poses se
calculan al cargar; girar la caja no recorre todos sus vértices. Solo se
renderiza cuando cambia la vista o durante una animación.

Las texturas se limitan a 2048 píxeles por lado. Las vistas previas disponibles
se reemplazan por las imágenes originales al terminar su carga. Cambiar de
juego descarta las respuestas anteriores; cerrar el visor libera sus
texturas, geometría, esqueletos y contexto WebGL.
