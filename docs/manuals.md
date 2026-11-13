# Manuales PDF y CBZ

En el visor 3D, mantener presionado el botón central del mouse (la rueda) y
arrastrar desplaza la vista horizontal y verticalmente, sin girar los objetos
ni cambiar el zoom. Funciona también con el póster, manual o disco extraídos.
La tecla **Inicio / Home** vuelve a centrar la vista.

En los visores Three.js, un clic sobre el manual de una caja abierta lo saca
como un librito 3D, sin abrir el lector. También se puede usar **Sacar manual**
en el menú contextual, incluido Couch Mode. El manual pasa a primer plano;
la caja queda detrás y se puede seleccionar para intercambiar el foco.
El menú contextual también ofrece **Inspeccionar caja**, **Inspeccionar disco**
y **Inspeccionar manual** para cambiar el foco sin botones adicionales en el visor.
Disco y manual pueden permanecer fuera a la vez, con giro y zoom independientes.
El control principal de frente/dorso actúa sobre el objeto seleccionado.

Un clic sobre el manual ya extraído abre el lector; arrastrarlo sigue girando
el librito sin abrirlo. **Leer manual** también permite abrirlo directamente.
Al cerrarlo, un manual
que estaba extraído vuelve a su vista 3D y conserva su posición y orientación.
**Volver a guardar manual** lo devuelve a la caja; el disco permanece fuera
si ya se había extraído. La vista lado a lado también admite los tres objetos.
Se reutilizan las texturas de portada, contraportada y cantos de páginas del
manual existente; inspeccionarlo no carga sus páginas interiores.

Los tipos **Póster (frente)** y **Póster (dorso)** forman las dos caras de una
misma hoja plegada en el compartimento del manual. Al extraer el manual se
revela el póster, que se puede sacar con un clic o desde el menú contextual.
Fuera de la caja, **Desplegar póster** y **Plegar póster** animan sus pliegues;
el control principal de frente/dorso permite ver la otra cara. El foco, giro
y zoom son independientes de caja, disco y manual, también en Couch Mode.
Al guardarlo se pliega automáticamente; una cara sin imagen queda blanca.

En **Editar juego → Pósteres**, **Partes a lo ancho** y **Partes a lo alto**
definen una cuadrícula orientativa de 1 a 8 partes por dirección (2 × 2 por defecto).
Los ajustes son exclusivos de cada juego y no se heredan de la consola. La sección
muestra las imágenes del frente y del dorso, permite agregarlas o seleccionar otra
entre las disponibles, elegir la cara que queda afuera, girar la imagen y cambiar
la esquina y el orden de despliegue. Los pliegues antiguos guardados en el juego
se conservan al pasar a esta sección.
El tamaño plegado sigue la proporción del manual de esa caja. La última solapa
de cada dirección puede ser más corta y se ajusta la cantidad de dobleces si
hace falta para encajar. Al desplegarlo se conserva la proporción del escaneo,
sin estirarlo ni recortarlo; no supone conocer las medidas reales del póster.
La geometría está limitada a 8 × 8 partes: un escaneo de proporciones extremas
puede ocupar menos que el manual en una dirección. Las imágenes
se cargan únicamente al abrir la caja, y los escaneos originales no se modifican.

Cada manual guardado tiene un botón de papelera en **Editar juego → Manuales**.
Tras confirmar, borra la copia administrada y actualiza el manifiesto de la
colección; conserva el archivo de origen situado fuera de esa carpeta. Si era
el manual preferido, se vuelve a utilizar el primero disponible. Quitar un
manual pendiente de guardar solo lo retira del borrador.

Los manuales se agregan desde **Editar juego → Manuales** o copiando los archivos
en la carpeta `manuals` de su colección. Los originales elegidos en el editor
se copian al guardar. Los CBZ mantienen su extensión y participan en los mismos
manifiestos, copias de seguridad y recuperación de colecciones que los PDF.

También se pueden descargar desde OpenCabinet-BDD cuando el juego tenga manuales
publicados. **Editar juego → Manuales → Descargar manuales** permite buscar o
cambiar la coincidencia y agregar los PDF y CBZ al borrador. Hay que guardar los
cambios para conservarlos. Los archivos idénticos a manuales existentes se omiten.

Las descargas conservan el uploader y la página de origen cuando el catálogo
los incluye. En **Editar juego → Manuales** aparecen junto al nombre del archivo,
con el mismo formato de etiquetas que las imágenes. La etiqueta del sitio abre
el enlace exacto; el nombre del archivo se acorta antes que los créditos cuando
falta espacio. Los créditos se conservan al guardar, respaldar y recuperar la
colección, incluso si dos manuales distintos tenían el mismo nombre. Los
archivos agregados manualmente sin atribución no muestran créditos inventados.

Durante la importación, la casilla **Descargar manuales (PDF / CBZ)** aparece debajo
de los tipos de imagen. Es independiente de las imágenes y permite importar solo
manuales. La descarga comparte el progreso, la cancelación y el reintento de
archivos fallidos; los archivos se incorporan al guardar la importación, nunca
como imágenes del carrusel. Al recuperar una colección que ya conserva manuales,
se reutilizan los existentes sin volver a descargarlos.

Un CBZ es un ZIP de imágenes. OpenCabinet admite páginas JPEG, PNG, WebP, BMP,
GIF y AVIF, con los formatos que puede decodificar el WebView. Ordena los nombres
de archivos y subcarpetas con orden numérico: `1`, `2`, `10`. Ignora directorios,
archivos ocultos, metadatos como `ComicInfo.xml` y entradas fuera de la estructura
del archivo. No interpreta la información de lectura de ComicInfo.

El archivo permanece comprimido. Rust enumera sus entradas y lee cada imagen
solicitada fuera del hilo de interfaz; no extrae el manual a una carpeta temporal.
Cada imagen tiene un límite de 64 MB descomprimidos y se admiten hasta 20.000
entradas en el ZIP. Archivos dañados, entradas cifradas o métodos de compresión
no admitidos muestran un error. El índice de lectura comprueba que el archivo
no haya cambiado entre la apertura y la solicitud de una página.

La vista de la caja decodifica solo la primera imagen, reutilizando los ajustes
de recorte y la estimación de tamaño de los PDF. La caché de portadas de manuales
de Dreamcast también funciona con CBZ y se invalida al cambiar el archivo.
El lector conserva las animaciones, zoom, arrastre, modos de hojas plegadas y
orden de lectura. Las imágenes se liberan después de dibujarlas; el lector
mantiene su caché limitada de páginas visibles. Una decodificación que termina
después de cerrar o cambiar de manual se descarta.

**Abrir manual** en el editor utiliza el lector integrado para CBZ, sin depender
de una asociación de archivos instalada en Windows. Los PDF conservan su acción
de apertura externa desde ese botón. Dentro de las cajas, ambos formatos se
abren con el lector integrado.
