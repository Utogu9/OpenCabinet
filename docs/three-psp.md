# Caja de PSP con Three.js

El visor usa `src/models/psp/case.glb` y `case.json`. El preparador detecta ambos
archivos; si no están disponibles, PSP utiliza su visor CSS. La selección del
backend es compartida por el lateral, la pantalla completa y la configuración
de cajas. Los recursos PSP se mantienen locales mientras se verifica su licencia.

El visor CSS alternativo también admite el manual y el inlay. Prepara solamente
la portada del PDF al seleccionar el juego, coloca el librito dentro de la tapa
y permite sacarlo para leerlo con el mismo lector. No reemplaza la carátula
exterior. El inlay se carga al abrir la caja: usa una sola imagen con ventanas
para la tapa, el lomo y el fondo del UMD, sin invertir los textos. Si la imagen
no se puede cargar, se conserva el interior sin impresión. Esta función no
requiere los archivos del modelo GLB.

El modelo preparado contiene las piezas de caja y UMD con las correcciones
de geometría, las UV y ambas articulaciones. La app y su preparación utilizan
únicamente los archivos de `src/models/psp`, sin consultar archivos de autoría
ni convertir geometría durante el inicio o la compilación.
El manifiesto conserva la referencia de origen y las firmas SHA-256 de los
archivos de autoría utilizados. Una exportación desde un único archivo Blender
no necesita enumerar los OBJ de la conversión anterior.
Se eliminan las líneas flotantes junto al lomo y los separadores añadidos bajo
ellas, ya que no forman parte de la caja real.
Las copias geométricas repetidas de carcasa, film y ventana UMD se omiten.
La apertura usa dos articulaciones de 90 grados; el UMD permanece en la base.
La orientación del modelo y las UV coinciden con las imágenes habituales de
la biblioteca. El film sigue la superficie del papel y se eliminan caras
degeneradas que atravesaban el interior de la caja.

La separación de las tapas deja libre el espacio interior: no genera superficies
de cierre en el plano central. Las dos pestañas de retención del UMD permanecen
completas en la base, incluso donde sobrepasan ese plano con la caja cerrada.
También se omiten las caras diagonales del original que conectaban el separador
del lomo con los bordes atravesando el espacio vacío.

Los contornos circulares del UMD tienen segmentos adicionales proyectados sobre
sus radios originales. Sus aristas llevan biseles de varios segmentos y normales
suavizadas con separación en bordes pronunciados. Así se redondea la geometría
manteniendo las aberturas y el perfil de la carcasa. El disco tiene materiales
independientes para la impresión y las superficies metálicas.
El UMD y su alojamiento moldeado tienen el extremo redondeado arriba y el
extremo más ancho abajo. La imagen impresa conserva su orientación de lectura.

La cubierta completa tiene prioridad sobre portada, lomo y contraportada
individuales. La imagen de tipo `disc` se aplica a la superficie impresa del UMD.
El interior del papel utiliza un inlay cuando está disponible; en su ausencia
se conserva el reverso blanco. Las texturas de ejemplo del modelo original no
se distribuyen ni se asignan a juegos de la biblioteca.
El plástico de la carcasa tiene un acabado blanquecino sobre el inlay; el film
que cubre las imágenes exteriores y la ventana del UMD permanecen transparentes.
Las UV del reverso del lomo mantienen la orientación de lectura del inlay
continuo cuando la caja está abierta.
La superficie plana del plástico del lomo utiliza su propio eje normal para
mantener el mismo acabado que las tapas, sin tratarla como un relieve brillante.

El manual PDF se coloca dentro de la tapa, respetando su proporción. Se prepara
la primera página al seleccionar el juego y la contraportada solo al abrir la
caja. Pulsar el manual abre el lector existente. Cambiar de juego cancela cargas
anteriores y libera las imágenes del manual.
Los manuales angostos aprovechan 170 mm de altura dentro de la tapa. Al abrir
el lector, el modo automático reconoce portadas individuales con páginas
interiores dobles y separa estas últimas en orden consecutivo. Esa detección
consulta únicamente sus dimensiones y no renderiza páginas por adelantado.

Switch y PSP comparten `three-gltf-box-viewer.js` para controles, carga de
imágenes, animaciones, materiales y liberación de recursos. Cada formato mantiene
su propio modelo y configuración. Las unidades ópticas respetan la conversión
de metros a milímetros y el visor solo renderiza cuando cambia la vista.
