# Caja de Dreamcast con Three.js

El visor usa WebGL para Dreamcast. Los otros formatos
conservan el visor anterior. El lateral, la pantalla completa y las vistas
previas comparten la selección del visor. Si WebGL o el modelo no están
disponibles, se utiliza el visor anterior.

`src/models/dreamcast/case.json` y `case.bin` contienen la geometría preparada
y versionada. Proviene de **Compact disc and case**, de **effe**, con licencia
CC0; se conserva su aviso original en `src/models/dreamcast/LICENSE-CC0.txt`.
Los créditos de la geometría y de las texturas están separados en el README
de esa carpeta y en `THIRD_PARTY_NOTICES.md`.

`npm run prepare:three` prepara la dependencia Three.js para funcionar sin
conexión y valida los archivos del modelo incluidos en el repositorio. También
se ejecuta antes de iniciar o compilar Tauri. Utiliza únicamente los recursos
preparados de `src/models/dreamcast`, sin consultar archivos de autoría ni
regenerar la geometría. Una distribución incompleta del modelo detiene la preparación
con un error en lugar de producir una aplicación sin sus recursos.

Los insertos de reemplazo `insert.webp` (negro) e `insert2.webp`
(blanco) se colocan en `src/models/dreamcast/`. Son imágenes estrechas completas:
se usan todas sus UV, sin el recorte del antiguo `insert.png`. El preparador
no las genera ni las sobrescribe, y ya no copia `insidecase.png`.
El inserto conserva la altura del papel y la proporción original de la imagen.
Su borde izquierdo queda fijo; el ancho que supere la columna acrílica se
extiende hacia el interior de la caja. El ajuste también respeta dimensiones
personalizadas y no modifica la geometría compartida entre visores.

Los OBJ 7, 9, 10 y 12 contienen la misma geometría; sólo se utiliza una copia.
La conversión conserva los conjuntos de base y tapa del OBJ, reconstruye los
materiales que faltaban y descarta el disco duplicado, triángulos degenerados y
caras que mezclan vértices de dos conjuntos. La geometría preparada ocupa
aproximadamente 1,41 MiB. Se conserva
en memoria una vez leída; no se vuelve a analizar OBJ al seleccionar juegos.

La pieza de contraportada tiene forma de U. Una contraportada desplegada,
incluidos ambos lomos, se reconoce por una proporción entre 1,215:1 y 1,40:1.
Su centro se aplica detrás y sus dos franjas laterales se pliegan sobre sus
respectivos lomos. Los laterales se invierten al pasar de la vista exterior a
las coordenadas de la caja. No se repite un mismo lomo en los dos lados.
Una contraportada recortada (~1,16:1) sigue usando la imagen de lomo separada.
Cada lateral tiene sus propias UV normalizadas, incluso si el modelo tiene
pliegues de distinta profundidad. Una cubierta completa conserva prioridad y se muestra mediante
ventanas UV sobre el mismo archivo. No se recortan ni modifican archivos de la
biblioteca. La portada disponible en caché se reemplaza por la original cuando
está lista. Las texturas del visor se limitan a 2048 píxeles por lado.

**Inlay (interior de la cubierta)** es una categoría de imágenes disponible en
Editar juego, galería, biblioteca y manifiestos. También puede descargarse si
la fuente ofrece ese tipo. Se conserva para cualquier consola; su aplicación
al modelo 3D está implementada aquí para Dreamcast.

En Dreamcast, el inlay cubre la cara interior del mismo papel de la contraportada,
incluido el fondo bajo el disco y el inserto debajo del acrílico fijo izquierdo.
Si es un escaneo desplegado, se pliegan también sus franjas laterales. Sus UV
crecen de izquierda a derecha mirando el interior, al contrario de la imagen
exterior. El inserto Dreamcast fijo de ejemplo se oculta sólo después de cargar
correctamente el inlay del juego. Sin inlay, o con un archivo ilegible, se
mantiene el fondo de papel blanco y se elige un inserto según la banda izquierda
de la portada: blanco únicamente si se reconoce una franja blanca continua y
distinta del dibujo; negro si es negra, de otro color, ambigua o no hay portada.
Ambos lomos interiores sin inlay toman también ese color. La detección lee
cuatro bloques de 2 × 2 píxeles al 1,5 % del ancho, a distintas alturas, sin
reducir la portada ni mezclar la franja curva con el dibujo. Tolera un bloque
ilegible y compara puntos interiores para descartar una imagen totalmente
blanca. Analiza primero la miniatura y luego la portada final;
en cubiertas completas sólo analiza la zona frontal. Si el manual sustituye la
portada, analiza su primera página. Un inlay válido siempre tiene prioridad y
conserva sus imágenes originales en el interior. Las pruebas utilizan los
recursos distribuidos y no requieren escaneos externos de referencia.

Se mantienen apertura, giro libre, bloqueos de ejes, rueda, teclado, zoom,
delante/detrás y pantalla completa. Un PDF disponible aporta la portada del
manual y permite abrir el lector existente al pulsar sobre él con la caja
abierta. Mientras está cerrada sólo se prepara la primera página. Al abrirse
se prepara una única imagen adicional para la contraportada del manual: la
última página en un PDF normal, o la mitad opuesta de la primera hoja en un
escaneo por pliegos. Se conserva para las aperturas siguientes y se libera al
cambiar de juego. El resto de las páginas sigue perteneciendo al lector bajo demanda.

El inlay y la primera página del manual también pueden aparecer desde la
[caché de vistas previas](cover-cache.md) antes de sus originales. Las imágenes
prestadas por la caché se copian antes de usarse como textura, para que una
expulsión del LRU no vacíe la caja. Las respuestas atrasadas respetan tanto la
selección actual como la prioridad de una original ya cargada. La miniatura
del PDF nunca sustituye el objeto del manual que necesita el lector.

El conjunto del manual (portada, contraportada y páginas) se desplaza hacia la
izquierda hasta alinear su centro con el del disco, unos 2 mm en este modelo.
Es una corrección del modelo, independiente del tamaño del visor y del zoom.

Las superficies impresas usan sus colores sRGB sin iluminación difusa ni
tonemapping. El acrílico conserva iluminación y reflejos, con opacidad base de
0,035 para evitar que sus capas blanqueen los escaneos. El disco conserva su
material anterior. La comparación en navegador con un PDF de color uniforme
dio RGB original `(153, 26, 51)` y RGB visible `(147, 30, 53)` bajo el acrílico.

## Lectura del relieve interior

La luz ambiente se reduce y una luz lateral de apoyo recorta los cantos. El
acrílico combina reflexión de Fresnel con refracción del dibujo que tiene
detrás, usando un índice de refracción de 1,49. Las paredes y los desniveles
moldeados desvían la imagen más que las láminas planas: su recorrido óptico
varía entre 0,65 y 1,95 mm según la normal local. No es un contorno luminoso.
La reflexión cambia con el ángulo de observación y toma el color del entorno.
Las láminas planas mezclan muy poca imagen refractada, conservando la nitidez
y los colores de la impresión original. Los colores de caja personalizados
se aplican como absorción del material. El cálculo se hace en el shader de la
GPU, sin recorrer caras en JavaScript ni modificar el modelo.

Algunas caras interiores del OBJ tienen normales opuestas a su orientación
geométrica. Orientar la normal de la interfaz óptica hacia la cámara antes de
calcular Fresnel y refracción; de lo contrario se vuelven completamente
reflectantes y ocultan la impresión con una superficie gris. Las franjas
estriadas conservan su material y su mapa de relieve independientes.

Al abrir la caja, paredes y trabas proyectan sombras de contacto suaves sobre
el inlay y el reverso del manual, mediante
[ShadowMaterial](https://threejs.org/docs/pages/ShadowMaterial.html). Sólo se
usan sus caras elevadas y laterales como emisores de sombra: el papel y las
láminas transparentes completas no se convierten en obstáculos opacos.
Las superficies receptoras respetan la profundidad del disco, y la sombra del
manual se oculta al retirarlo. No se cambia la geometría visible del modelo.

El mapa de sombras es de 2048 × 2048 y se actualiza al girar, abrir o cambiar
las dimensiones de la caja. Se reutiliza al hacer zoom, redimensionar el visor
o terminar de cargar una imagen. Las sombras interiores se ocultan con la caja
cerrada y sus recursos se liberan al destruir el visor. No hay bucle en reposo.

Usar `PCFShadowMap` desde el primer cuadro; Three.js 0.186.1 ya no admite
`PCFSoftShadowMap`. Inicializar también el mapa de profundidad en ese cuadro,
aunque la caja esté cerrada y los emisores ocultos. Si se posterga hasta abrir,
los materiales pueden recibir una textura de reemplazo incompatible con el
muestreador PCF, provocando `GL_INVALID_OPERATION` y la desaparición del
acrílico. Repetir esa inicialización al restaurar el contexto WebGL. Al revisar
sombras, comprobar la transición animada de cerrada a abierta, además de la
pose abierta inicial, y revisar también las advertencias WebGL de la consola.

El visor dibuja cuando cambian la vista, las imágenes o el tamaño, y durante
la animación de apertura. No mantiene un bucle de renderizado en reposo. El
acrílico reutiliza el búfer de transmisión que ya necesitaba el centro del
disco, a media resolución. Sólo consulta una muestra por fragmento para la
refracción; las superficies planas conservan la impresión a resolución original.
Al cambiar a otra plataforma se libera el contexto WebGL; las respuestas
atrasadas no pueden reemplazar el juego seleccionado.

`tests/three-optics.test.cjs` comprueba en WebGL real que los relieves desvíen
un patrón sin sombras, que no se decolore la impresión y que las normales
invertidas no provoquen errores. Es opcional: requiere `playwright-core`, los
archivos preparados de Three.js y Chromium (ruta configurable mediante
`OPENCABINET_CHROMIUM`). No necesita los OBJ originales ni imágenes de juegos.

Los pliegues incorporan también una dispersión suave blanquecina, limitada a
las paredes moldeadas. Crece con el recorrido óptico del material y se acumula
al verse varias interfaces superpuestas. Usa iluminación indirecta con un
suelo ambiental tenue, sin depender de que un reflejo especular o una luz
directa coincida con el borde. No se aplica a las láminas planas sobre la
carátula. Es una aproximación local a las capas del plástico, no un trazado de
rayos entre todos los sólidos. La prueba WebGL verifica por separado este
efecto con reflejos y luces directas desactivados, incluyendo dos capas cercanas.

## Estriado del acrílico

El patrón propio `src/assets/textures/cd-case-ribs.svg` reemplaza la textura
de referencia, cuyos extremos negros producían una línea doble al repetirse.
Contiene 32 ciclos completos y sus extremos caen a mitad de una separación
clara: al unir copias se mantienen el grosor y el espaciado de todas las líneas.
Se prepara como `src/models/dreamcast/ribs-height.svg` y se usa como
[mapa de relieve](https://threejs.org/docs/pages/MeshStandardMaterial.html#bumpMap),
con espacio de color de datos (`NoColorSpace`), en las franjas del OBJ 11.
Se conservan sus UV originales y su pertenencia a la tapa móvil. El patrón
se repite ocho veces a lo largo de la franja para representar estrías finas.

Esas franjas tienen su propio material de acrílico, con relieve de 0,18 mm y
opacidad máxima de 0,22 (0,30 si el usuario eligió un color). El mismo patrón
modula la transparencia entre las estrías; sus tonos no se aplican como tinta.
El relieve cambia los reflejos al girar. La portada y los otros
materiales mantienen sus ajustes anteriores. No se añaden polígonos ni un
bucle de animación. La textura se libera al cerrar el visor y se vuelve a
preparar si cambia el archivo original.

El modelo no incluía sus archivos MTL: se recuperan el patrón y las UV del
original, con intensidad y repetición ajustadas para este visor.

La validación automatizada incluye selección del visor, cambios rápidos entre
plataformas, controles pendientes durante la carga, superficies UV y preparación
del modelo local. Se comprobó también el visor en Chrome con WebGL, incluidos
manuales, controles y reposo. El rendimiento percibido en WebView2 debe evaluarse
en la app; la prueba de navegador no mide los FPS del equipo del usuario.

## Articulación y separación de piezas

Se aplican las reglas ya documentadas en [Cajas 3D](game-boxes.md): la columna
acrílica izquierda queda unida a la contracaja. La tapa, sus bordes y sus dos
brazos de enganche forman un único conjunto móvil. Los dos lomos y el inserto
Dreamcast permanecen en la contracaja. No cortar los brazos por la posición de
sus caras: estando abierta la tapa, parte de cada brazo vuelve hacia la base.

En este OBJ concreto, los bloques de vértices de `model_7.obj`, contando desde
cero, son:

- `0–14624`: contracaja, incluida la columna izquierda;
- `14625–20988`: tapa completa, incluidos sus brazos y pernos;
- `20989–26632`: disco duplicado, descartado porque tiene sus propios OBJ.

El eje pasa por los centros de los pernos, en coordenadas originales
`X = -4.658462286`, `Y = -3.367492318`; es paralelo al eje Z original. No pasa
por el borde del manual ni por el extremo de la columna. La conversión cierra
la pose original una sola vez, girando la tapa alrededor de ese eje unos 43,12°.
La base no recibe ese giro. El formato preparado tiene versión 3.

En Three.js, Y apunta hacia arriba y Z hacia el observador. La pose cerrada
tiene rotación local de tapa igual a cero. Abrir gira alrededor de Y de `0` a
`-π`: a mitad de recorrido el extremo libre pasa **delante** de la bandeja.
Los puntos del eje permanecen inmóviles. Las coordenadas verticales del mouse
se invierten al convertirlas de pantalla a mundo; arrastrar hacia abajo debe
mover la cara observada hacia abajo, tanto en giro libre como con eje bloqueado.

La cámara usa un plano cercano de 10 mm para distinguir el papel y sus capas
adyacentes sin parpadeo por falta de precisión de profundidad. La comprobación
visual debe incluir la caja cerrada **de perfil**, una apertura a 90° y la
apertura completa; ver sólo el frente cerrado y la pose a 180° no permite
detectar un giro en sentido contrario.
