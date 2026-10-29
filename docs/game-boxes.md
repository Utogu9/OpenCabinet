# Cajas 3D

**Editar juego → Caja 3D** permite definir un ajuste exclusivo para una edición:
tipo de caja, color, posición del lomo y dimensiones personalizadas. Inicialmente
usa la configuración de la consola. Desmarcar **Usar la configuración de la consola**
habilita los ajustes y su vista previa; se aplican al guardar. Cancelar no cambia
la caja. Volver a marcar la casilla elimina el ajuste propio al guardar.

Los campos automáticos heredan los de la consola. Un valor propio del juego tiene
prioridad sobre los ajustes regionales de la consola; también puede haber ajustes
regionales dentro del juego. Se guardan en `game_box_settings`, sin modificar los
de la consola ni los de otros juegos. La edición predeterminada de un grupo define
la caja visible, tanto en el lateral como a pantalla completa. Al conservar los
datos de un juego eliminado, se conserva también este ajuste en su manifiesto.

El panel derecho abre la caja 3D del juego seleccionado. «Fotos» conserva el
carrusel y su vista a pantalla completa. Arrastrar gira la caja alrededor de su
centro; las flechas del teclado también la giran. La rueda acerca o aleja
la caja. El botón ↺ alterna delante y detrás sin cambiar el zoom; después de
un giro manual primero vuelve delante. Inicio restablece la vista y el zoom.
El doble clic, Enter o el botón ⛶ abren la caja a pantalla completa.
Escape o ✕ cierran esa vista, conservando el giro y el zoom. Los botones permiten
alternar los lados y ajustar el tamaño también en pantalla completa.

Los visores de caja, imágenes y manuales usan la pantalla completa de la ventana
nativa de Tauri, cubriendo el monitor incluso cuando la app estaba maximizada.
La transición es directa; Tauri conserva y recupera el estado anterior
(maximizado o normal) sin restaurar la ventana antes de entrar. Las transiciones
se serializan para que cerrar un visor mientras abre el otro no restaure la
ventana antes de tiempo. El lector de manuales también entra en pantalla completa
al abrirse desde la caja del lateral. Cerrarlo vuelve a esa vista; si la caja ya
estaba ampliada, permanece en pantalla completa. En la vista previa del navegador,
las cajas e imágenes conservan la API web de pantalla completa.

En Windows, una corrección del cálculo del área cliente evita que tao reserve
espacio para la barra de tareas al entrar en pantalla completa desde una ventana
maximizada sin decoración. Se mantiene el rectángulo completo del monitor durante
esa transición, conservando el comportamiento habitual al maximizar y al salir.

El clic derecho dentro del visor permite **Movimiento libre**, **Bloquear eje X**
(girar de lado a lado) o **Bloquear eje Y** (inclinar arriba y abajo). El bloqueo
también se aplica a las flechas del teclado y conserva el zoom y la orientación
actuales. Se mantiene al cambiar de juego y al entrar en pantalla completa
durante esa sesión; no modifica la configuración guardada de la consola.

Se aplica `cover` al frente, `back_cover` detrás y `spine` al lomo. En las cajas
horizontales de SNES y Nintendo 64, el lomo se aplica arriba. Los escaneos de
lomos con otra orientación se rotan automáticamente. Las caras sin imagen o
con un archivo ilegible conservan el material y un título de referencia.

Las etiquetas sueltas de cartuchos se pueden cargar desde **Editar juego** como
**Etiqueta de cartucho (sticker)** (`cart_label`). La clasificación se conserva en
la base, la galería y los manifiestos de colecciones. Es un tipo de carga manual;
las descargas del catálogo siguen ofreciendo los tipos disponibles en su catálogo,
incluidos **Cartucho: frente**, **Cartucho: reverso** y **Cartucho 3D**.

## Proporciones

Las medidas son aproximaciones de ancho × alto × profundidad en milímetros.
Representan cajas habituales, no todas las variantes regionales, ediciones
especiales, cajas de varios discos o embalajes de cada juego.

| Plataforma o formato | Dimensiones aproximadas |
| --- | --- |
| PS2, GameCube, Wii, Xbox, Xbox 360 y PC en DVD | 135 × 190 × 14 |
| PS3, PS4, PS5, Xbox One y Xbox Series | 135 × 171 × 14 |
| PlayStation y Dreamcast en CD | 142 × 125 × 10 |
| Caja CD PAL más gruesa | 142 × 125 × 17 |
| Sega CD / Saturn en caja alta | 142 × 209 × 21 |
| Switch | 104 × 170 × 11 |
| DS | 135 × 122 × 14; PAL: 20 de profundidad |
| 3DS | 135 × 122 × 12 |
| PSP | 99 × 168 × 14 |
| PS Vita | 105 × 135 × 12 |
| NES | 126 × 179 × 25 |
| SNES y Nintendo 64 | 178 × 128 × 32 |
| Super Famicom | 105 × 190 × 30 |
| Game Boy, Game Boy Color y GBA | 126 × 126 × 25 |
| GBA japonés horizontal | 135 × 86 × 23 |
| Genesis, Mega Drive y Master System | 135 × 190 × 25 |
| GameCube japonés | 107 × 149 × 17 |

Los nombres abreviados y los del catálogo se reconocen sin distinguir espacios,
acentos o mayúsculas. Las etiquetas regionales del nombre de la ROM permiten
elegir algunas variantes. La proporción de la portada distingue SNES occidental
de Super Famicom y cajas horizontales de Game Boy Advance. Para plataformas
desconocidas se usa un formato genérico adaptado a la portada.

Referencias de tamaño: [fabricante Vinpower: DVD, Blu-ray y CD](https://www.vinpowerdigital.com/products/case-package-material),
[RetroProtection: protector de caja SNES](https://retroprotection.com/product/snes-box-protector/),
[PacSam: tamaños de protectores de juegos](https://www.pacsam.ca/en/retro-game-box-protectors/),
[Custom Game Cases: formato de reemplazo de Genesis](https://www.customgamecases.com/online-store/RED-SEGA-Genesis-Game-Case-100-Cases-p133073612).
Los protectores y los formatos de reemplazo sirven como orientación; pueden ser
mayores o distintos de las cajas originales.

## Configuración por consola

Clic derecho sobre la consola → **Editar consola** → **Cajas 3D de los juegos**.
El apartado incluye una vista previa que se puede girar. Permite elegir uno de
los formatos de la tabla, una caja personalizada con ancho, alto y profundidad
en milímetros, el color del material y la posición del lomo (izquierda o arriba).
Las medidas manuales admiten 20–500 mm de ancho y alto y 1–150 mm de profundidad.

**Automático** conserva la detección por consola, región y proporción de la
portada. Elegir un formato fijo impide que la proporción de la portada lo cambie.
El color automático corresponde al formato elegido; en el tipo Automático
conserva las diferencias regionales, como el azul de PS2 PAL.

**Configurar para** permite cambiar Todos los juegos o definir una excepción
para Europa, Norteamérica o Japón. Cada región usa la configuración general
hasta desmarcar **Usar la configuración de Todos los juegos**. Una excepción
reemplaza el ajuste general; su tipo Automático vuelve a la detección de esa
consola y región. Se leen las etiquetas entre paréntesis del nombre del archivo
ROM, sin usar nombres de carpetas. Si hay varias regiones, se usa la primera
reconocida; los archivos sin región reconocida usan el ajuste general.

**Restablecer este ajuste** devuelve el general a Automático, o quita la
excepción regional seleccionada. Los cambios se guardan junto con los demás
datos de la consola al pulsar **Guardar cambios**; Cancelar descarta el borrador.
Se conservan en `platform_details.box_3d` dentro de la base de datos y se aplican
al lateral y a pantalla completa. No cambian las imágenes ni las tarjetas del
listado de juegos.

## Apertura e interiores por consola

**Abrir caja** muestra el interior mediante una animación de tapa y lomo.
**Cerrar caja** lo vuelve a cerrar; la tecla **O**, con el visor enfocado,
alterna ambos estados. Se puede seguir girando y ampliando la caja abierta.
La pantalla completa conserva la apertura y las mismas imágenes cargadas.
Restablecer la vista o alternar delante/detrás cierran la caja; seleccionar otro juego
también empieza con la caja cerrada.

El formato DVD con lomo a la izquierda incluye un interior genérico: bandeja,
disco de 120 mm con agujero central, soporte del disco y trabas para el manual.
PS2 añade un soporte para memory card centrado, con cuatro esquinas de sujeción
y el emblema PlayStation dentro. El seguro del disco tiene tres brazos flexibles
alrededor de un botón triangular. Las dos trabas del manual tienen ancho
constante y un perfil curvo en profundidad: empiezan elevadas, bajan hacia el
manual y vuelven a subir en la punta. Se modelan como sólidos con grosor,
con recortes que siguen la silueta de cada traba y quedan casi tapados de frente.
Desde un ángulo dejan ver el reverso blanco de la carátula cuando hay una portada
asignada. Los recortes tienen paredes de corte y los garfios
mantienen su volumen al girar la caja. La bisagra DVD tiene una línea central
y puentes de plástico en sus extremos superior e inferior. Conserva los
colores regionales y los ajustes de color de la consola. Es una representación
aproximada, ya que existen distintas revisiones de las cajas originales.
Las cajas DVD, Blu-ray, CD, PSP, Switch, DS, 3DS, Genesis y GameCube japonés permiten
abrir el estuche. Las cajas de cartón conservan el visor cerrado.
NES, SNES, Nintendo 64, Game Boy y Master System tienen pliegues de 90°;
no se construyen interiores para estos modelos.

Las bandejas de discos incorporan un aro más grueso, con paredes internas,
externas, fondo y cierres en los extremos de cada recorte. Las curvas usan
96 segmentos y normales interpoladas. PS2, PS3, PS4/PS5, Wii y Xbox tienen
cuatro huecos enfrentados para los dedos; Wii U tiene dos arriba y uno más
ancho abajo. PSP usa un soporte con el contorno del UMD, sin aro ni botón de DVD.
Las trabas curvas del manual de PS2
se comparten con los demás modelos DVD; GameCube, DS y 3DS las desplazan hacia
el centro para dejar espacio al sistema de seguridad junto al borde del manual.
Las variantes se reconocen por la consola y conservan los ajustes regionales:

| Consola | Diferencias del modelo |
| --- | --- |
| PS2 | Disco bajo el soporte de memory card y botón triangular de tres brazos. |
| Wii | Disco centrado y marca Wii encima. |
| Wii U | Disco centrado, marca Nintendo, recorte de reciclaje en la tapa y dos enganches para una bandeja adicional, sin agregar esa bandeja. |
| Xbox | Disco centrado, sin texto encima, y plástico verde amarillento translúcido en bisagra, bordes y trabas. |
| Xbox 360 | Disco centrado y verde más claro, translúcido. |
| PS3 | Plástico casi incoloro, papel hundido bajo la franja superior, símbolo Blu-ray sobre «Blu-rayDisc» a la derecha; esquina superior izquierda redondeada, botón de tres brazos y trabas largas con lengüeta central para el manual. |
| PS4 / PS5 | Plástico azul translúcido, papel a toda altura, disco centrado y trabas largas. |
| PSP | Plástico claro, UMD de 60 mm dentro de su carcasa de contorno redondeado arriba y recortado abajo, soporte con enganches y una única traba central con lengüeta para el manual; sin texto UMD añadido. |
| GameCube | Mini-DVD de 80 mm más abajo, soporte superior con «Optional Memory Card Storage», logo completo debajo del disco y seguros junto al manual y al disco. Sin nervio central ni texto PUSH. |
| Nintendo DS | Interior negro, tarjeta en la parte inferior, logo vertical, trabas curvas del manual y seguros en ambos lados. |
| Nintendo 3DS | Interior blanco con cavidades rectangulares de esquinas redondeadas, tarjeta abajo, logo vertical y seguros similares a DS. |
| Switch | Plástico claro, tarjeta abajo con bolsillo alrededor salvo un hueco para el dedo a la derecha, dos pestañas con lengüeta encima y tapa izquierda libre. |
| Genesis / Mega Drive | Lateral de apertura hundido respecto de tapa y contratapa, labios finos a toda altura, cartucho girado 90°, marca SEGA grande orientada igual, soportes altos y finos, dos pequeñas trabas y cuatro topes laterales para el manual. |
| PlayStation | Inserto negro de nervaduras paralelas hundido bajo un acrílico fijo y saliente separado de la tapa; bandeja interior clara con disco hundido, botón sin texto y bordes estriados unidos a la tapa. |
| Dreamcast | Construcción CD similar, con banda Dreamcast clara u oscura según la esquina superior izquierda de la portada disponible. |
| Sega CD / Saturn | Caja CD alta, bandeja negra, disco de 120 mm algo más abajo del centro, rejilla izquierda expuesta sin acrílico encima y bordes superior e inferior que se abren con la tapa. |

En los estuches translúcidos se representa el reverso blanco del papel cuando
existe la imagen correspondiente. La transparencia y las marcas moldeadas son
aproximaciones mediante capas CSS, sin refracción física. Los cartuchos usan
**Etiqueta de cartucho**; si no existe, pueden mostrar **Cartucho: frente**.
PS1 y Dreamcast conservan los dos lomos al abrirse: ambos pertenecen a la
contracaja. El acrílico de la tapa abre junto con los bordes estriados de arriba
y abajo. Las paredes internas, externas y los rebordes tienen material; las
piezas translúcidas comparten el tinte del estuche. El recorte de reciclaje de
Wii U incluye paredes que dejan ver su grosor, y los enganches de una bandeja
adicional se mueven con el lomo, no con la contracaja.

La columna fija junto al lomo de PS1/Dreamcast ocupa toda la profundidad,
desde la contracaja hasta la altura de la tapa. Su rejilla o inserto Dreamcast
queda al fondo; sus laterales y extremos son acrílicos. La tapa y sus bordes
superior/inferior con rejilla comienzan al terminar esa columna. Los anclajes
lisos se enganchan por encima y debajo de ella; comparten un eje exterior que
permite abrir la tapa sin atravesar el bloque fijo. Sega CD/Saturn mantienen
una columna opaca, con rejilla expuesta arriba y pared negra hacia el disco;
sus bordes con rejilla sí se prolongan sobre la columna hasta los enganches.
Los discos, huecos y soportes se centran juntos en el espacio útil, excluyendo
la columna izquierda. La profundidad aproximada de las cajas altas se reduce
a 21 mm: [PacSam publica 21,6 mm para ese formato](https://www.pacsam.ca/en/retro-game-box-protectors/).
Las tapas CD abren 180° y ambas mitades apoyan sobre el mismo plano exterior:
la cara exterior del acrílico de la portada, una vez girada, coincide en altura
con la cara exterior de la contraportada. El eje pasa por los extremos de la
columna y biseca esos dos planos exteriores. Ni la bandeja elevada del disco
ni las placas interiores determinan la altura de apoyo del estuche abierto.
El frente de la columna queda justo por debajo del acrílico de la tapa para
que las dos piezas no se crucen durante el giro. Sus anclajes lisos abarcan
toda la profundidad de la columna fija y existen también con el estuche cerrado.
En PS1 y Dreamcast, la rejilla de los bordes superior e inferior termina antes
de esa columna. La bandeja negra plana de Sega CD/Saturn llega hasta los extremos
superior e inferior, sin bordes elevados. Su lateral derecho queda pegado al
lomo derecho, tapando el reverso blanco del papel en esa unión. La pared derecha
queda 0,25 mm hacia dentro del plano de la imagen del lomo, sin superficies
superpuestas que tapen esa imagen. Se extiende hacia la contraportada, desde el
suelo de la bandeja hasta su fondo; no recorre toda la profundidad del estuche.
La cara interna del lomo derecho conserva un revestimiento negro fino, separado
de la imagen exterior, para ocultar el reverso blanco sin volver a tapar el lomo.
Los extremos superior e inferior de la bandeja se cierran hacia abajo hasta
la propia contraportada (a 0,06 mm de su cara exterior), con paredes de seis caras
que ocultan el papel al mirar de lado. El fondo negro y la pared derecha también
llegan hasta allí, sin el espacio de aproximadamente 1,2 mm de la placa anterior.
El recorte circular también lleva paredes negras hasta el fondo del alojamiento,
incluidos los sectores detrás de los huecos para los dedos.

Cada imagen exterior tiene una cara posterior blanca con sus mismas dimensiones,
márgenes y posición, unida a la misma pieza. No se añade papel al lomo por tener
una portada: sin imagen del lomo, su plástico sigue transparente. Los márgenes
sin impresión, incluida la franja superior de PS3, tampoco se rellenan. Un
archivo ilegible deja de mostrar su reverso, salvo que aún se vea su miniatura.
Los estuches DVD/Blu-ray, PSP y Switch llevan un nervio longitudinal fino,
de sección redondeada de 0,6 mm, en el interior de la bisagra. GameCube tampoco lleva ese nervio.
Wii U no lo lleva: sus dos soportes tienen forma
de U, están orientados hacia el interior y dejan libre la ranura de la bandeja
adicional. El recorte de reciclaje incluye un reborde elevado y sus paredes.

PS1 y Dreamcast usan el propio manual como portada: si hay PDF, su primera
carilla reemplaza la imagen exterior bajo el acrílico. Solo se prepara esa
carilla al seleccionar el juego; al abrir la caja se muestran el grosor y la
hoja interior. El manual se puede sacar y leer con el lector habitual. PS2
y PSP conservan su librito dentro de la caja, también en el visor CSS.
PSP aplica además el inlay a las dos tapas y al lomo desde una única imagen;
funciona aunque falten las imágenes exteriores. Los otros modelos no incorporan PDF.

### Referencias visuales de estos interiores

Se consultaron fotografías de cajas reales, no solamente sus portadas:

- [Wii original](https://www.ebay.com.au/itm/143758313822) y [Wii U abierta](https://commons.wikimedia.org/wiki/File:Wii_U_game_case.png).
- [Xbox](https://www.ebay.com/itm/235509169647) y [Xbox 360](https://www.ebay.com/itm/112401882783).
- [PS3](https://www.ebay.com/itm/204747695095), [PS4/PS5](https://www.ebay.com/itm/285706413213) y [PSP](https://www.bradium.com.au/products/replacement-case-for-sony-psp-games).
- [GameCube](https://www.ebay.com/itm/197630892703) y [Switch](https://www.todojuegos.cl/Productos/NSWI/Caja-Juego-Repuesto-Original--1-unidad-/).
- [Nintendo DS abierta](https://retrogamefan.com/products/petz-rescue-endangered-paradise-for-nintendo-ds-good),
  [Nintendo 3DS original](https://www.ebay.com/itm/174944290747) y
  [estuche oficial de reemplazo 3DS](https://videogamesplus.ca/products/official-nintendo-3ds-replacement-case-nintendo-3ds).
- [Genesis abierta](https://retrogamefan.com/products/sonic-spinball-sega-genesis-good) y [detalles del estuche Genesis](https://www.bosnan.net/packaging/genesis-clamshell-case).
- [PlayStation](https://www.ebay.com/itm/126788293128), [Dreamcast](https://www.ricardo.ch/de/a/sonic-adventure-dreamcast-%28pal%29-1253231562/) y [caja alta Sega CD / Saturn](https://www.ebay.com/itm/315758226993).

Las marcas y símbolos de las cajas no se incluyen en `assets` ni en las pruebas.
Se utilizan únicamente las imágenes de consola que el usuario descarga y guarda
desde OpenCabinet-BDD. Estas son las equivalencias del catálogo:

| Símbolo del visor | Carpeta de consola | Archivo |
| --- | --- | --- |
| Blu-ray | Sony - PlayStation 3 | logo8.svg |
| GameCube completo | Nintendo - GameCube | logo2.svg |
| Símbolo GameCube | Nintendo - GameCube | logo3.svg |
| Nintendo 3DS | Nintendo - Nintendo 3DS | logo.svg |
| Nintendo DS | Nintendo - Nintendo DS | logo.svg |
| Nintendo | Nintendo - Wii U | logo9.svg |
| PlayStation | Sony - PlayStation 2 | logo2.svg |
| SEGA | Sega - Mega Drive - Genesis | logo9.svg |
| Wii | Nintendo - Wii | logo2.svg |

Los logos numerados se descargan como imágenes adicionales (`other`), sin
desplazar el logo principal de la consola. Se conserva su identificador de
origen en el nombre administrado bajo `images/platforms/<id>/`. El visor los
encuentra aunque cambie el nombre local de la consola o la ubicación de los
datos. No depende de una ruta absoluta ni descarga marcas al abrir una caja.
Si no se ha guardado una marca o se elimina su asociación, no se muestra ese
símbolo. La carga de la biblioteca y el guardado de la consola actualizan las
máscaras CSS de ambos modos del visor sin reconstruir la geometría.

Las marcas pertenecen a sus respectivos titulares. Las fotos de referencia no
se distribuyen con la aplicación. Existen revisiones de fábrica y variantes
regionales que difieren de estos modelos generales. Para los detalles de las
cajas CD también se consultó la [foto ampliada de Bradium](https://www.bradium.com.au/products/replacement-case-for-sony-ps1-games).

El disco utiliza la primera imagen clasificada como **Disco**, a resolución
original. Se carga al abrir la caja por primera vez y se reutiliza al cerrar,
abrir, hacer zoom o entrar a pantalla completa. Si falta la imagen o no puede
cargarse, aparece un disco genérico con el título del juego. Esta vista no
descarga imágenes ni modifica los archivos del juego.

`src/manual-reader.js` controla la lectura ampliada y su animación de extracción.
`src/dvd-case.js` define el interior y las dos bisagras; `src/game-box.js`
controla la animación, el encuadre y la vida de sus imágenes. La animación
respeta la preferencia del sistema para reducir el movimiento y se detiene
por completo cuando llega al estado abierto o cerrado.

El giro reutiliza la geometría y mide el visor solo cuando cambia de tamaño.
Las superficies interiores actualizan únicamente los parámetros de iluminación
que utilizan. Las curvas de las pestañas se subdividen según un error máximo
de 0,025 mm; las esquinas internas pequeñas usan menos caras con iluminación
interpolada. La portada del manual conserva una capa de imagen independiente
del sombreado, cuya opacidad cambia sin volver a pintar el PDF. La resolución
de esa imagen y la del lector ampliado se mantienen.

## Manuales dentro de las cajas de PS2

Al seleccionar un juego de PS2 se prepara en segundo plano un PDF de sus manuales
guardados, para tenerlo disponible al abrir la caja. Cambiar de juego cancela
la preparación anterior. Abrir la caja mientras se prepara reutiliza esa misma
lectura; no inicia otra descarga ni una segunda lectura del documento.
Si hay varios, aparece **Manual en la caja** para elegir cuál mostrar. Guardar
cambios en Editar juego actualiza el manual del visor. Solo se muestra un mensaje
si falla su lectura; la preparación es silenciosa y no se muestran sus páginas
ni medidas.

El PDF se representa como un librito cerrado bajo las dos pestañas. Solo se
renderiza la primera carilla como portada; el reverso apoyado contra la tapa
queda sin imagen. Se respeta la orientación de la portada. Su proporción determina el
ancho: se aprovecha la altura interior disponible, reduciendo ambas dimensiones
si el ancho no entra en la caja. El grosor se estima con la cantidad de carillas
y se limita para que entre en el estuche. Los cantos muestran capas de papel;
las pestañas se elevan según el grosor del manual y mantienen sus apoyos.

Es una estimación visual, no una medida física extraída del PDF. Si la primera
carilla tiene una proporción ancho/alto entre 1,05 y 1,70, se considera una
cubierta doble: contraportada a la izquierda y portada a la derecha. Solo se
dibuja la mitad derecha en la textura de la caja, sin generar una imagen completa
intermedia ni preparar otras páginas. La proporción de esa mitad determina el
tamaño del librito. No se quitan márgenes ni se modifica el archivo PDF.

La detección por proporciones es aproximada. **Portada del manual**, en el menú
de clic derecho sobre la caja 3D cuando hay un manual preparado, permite usar **Automático**, **Página
completa**, **Mitad derecha** o **Mitad izquierda**. La elección se conserva por
ruta del PDF en las preferencias locales de esta instalación.

Cuando la portada está dividida, el lector utiliza por defecto **Hojas de imprenta
(lados alternados)**. Cada página del PDF representa una cara de una hoja desmontada,
con dos carillas: `[N|1], [2|N-1], [N-2|3], [4|N-3]`, etc. Se reconstruye el
orden de lectura y se recorta cada mitad directamente al dibujarla. Por ejemplo,
cuatro escaneos `[8|1], [2|7], [6|3], [4|5]` se convierten en ocho carillas,
de la portada a la contraportada. Si se eligió **Mitad izquierda** como portada,
se intercambian los lados del recorte. El contador y los saltos del lector
utilizan los números de las carillas reconstruidas.

**Orden de lectura**, dentro del lector, permite elegir ese modo, **Hojas
escaneadas (sin alternar lados)** para escaneos `[N|1], [N-1|2], [N-2|3]`,
o **Páginas originales del PDF**. Los manuales con portada completa empiezan en
el modo original. La elección queda guardada por ruta del PDF. Se puede cambiar
de modo sin salir de pantalla completa; se cancela la lectura anterior y se
vuelve a la portada. No se detectan automáticamente otros órdenes de escaneo
ni páginas invertidas.
El PDF original permanece intacto en ambos modos.

Con la caja abierta se puede hacer clic sobre la portada del manual para sacarlo
y leerlo ampliado. Arrastrarlo sigue girando la caja; un arrastre no abre el lector.
También se puede usar **Leer manual** (📖) o la tecla **M** con el visor enfocado.
El lector abre el librito con dos carillas enfrentadas: la portada queda sola,
y las siguientes se emparejan como las caras de hojas de papel. Cada hoja gira
sobre el lomo con frente y reverso reales, dejando ver la siguiente por debajo;
no desaparece ni se reemplaza por una imagen espejada. También se puede pulsar
el borde exterior izquierdo o derecho para pasar la hoja.
El centro de las carillas no cambia de página. La rueda ajusta el zoom
alrededor del puntero; con el manual ampliado, arrastrar lo desplaza
vertical y horizontalmente sin pasar hojas. Los clics rápidos se encolan sin
interrumpir un giro en curso y las páginas se preparan antes de mover la hoja.
Permite avanzar con sus flechas, las teclas ←/→ o AvPág/RePág, saltar con Inicio/Fin o escribir el número de página.
Incluye zoom y ajuste a la ventana. **Volver a la caja** o **Esc** devuelve el
librito a su lugar sin cambiar la rotación ni el zoom de la caja. Funciona también
sobre el visor de caja en pantalla completa y respeta la reducción de movimiento.
El documento completo sigue disponible con **Abrir PDF** en Editar juego.
Los demás modelos de caja conservan su interior actual.

La lectura utiliza [PDF.js](https://mozilla.github.io/pdf.js/), distribuido con
la app bajo su licencia Apache 2.0. Funciona sin conexión, utiliza un worker
local para interpretar el PDF y solo renderiza la primera página,
con un máximo de 2048 píxeles por lado. Al terminar se libera el documento y
su worker; únicamente la textura de portada permanece en memoria mientras se muestra el juego.
Cambiar de juego o manual cancela la lectura anterior y libera esa textura.
El zoom y la pantalla completa de la caja reutilizan la misma imagen.
Al sacar el manual se abre una sesión de lectura independiente: el documento y
su worker se mantienen mientras se lee, y se dibujan únicamente las carillas
necesarias para la vista y el giro (hasta 3072 píxeles por lado). Se conservan
hasta cuatro carillas para volver atrás; las restantes se liberan y las
peticiones atrasadas se cancelan o descartan. Al cerrar el lector se destruye
la sesión y sus lienzos, conservando la portada de la caja. Cambiar de juego,
manual, modelo o cerrar la caja también cierra la lectura y cancela su trabajo.
No se generan archivos temporales ni se modifican los PDF originales. Los documentos dañados
o protegidos no impiden seguir usando la caja.

Para desarrollo, `npm install` prepara los recursos locales en
`src/vendor/pdfjs/`, una carpeta generada que no se versiona. Los comandos de
Tauri de desarrollo y compilación también ejecutan `npm run prepare:pdf`;
se puede ejecutar manualmente al servir `src/` con otra herramienta.

Referencias visuales: [interior completo de una caja PS2 original](https://www.ebay.com/itm/194955704785)
y [detalle del soporte y el lomo](https://www.ebay.com/itm/267132286195).
Se pueden agregar fotos propias en `references/ps2`; su README indica las
tomas útiles para futuros ajustes.
El símbolo PlayStation se resuelve desde las imágenes guardadas de PS2, según
la tabla anterior; no se incluye una copia en la aplicación.

## Renderizado

`src/game-box.js` compone las superficies con transformaciones CSS 3D. Las caras
se dimensionan según el tamaño visible y el zoom. Durante la apertura, tapa,
lomo y bandeja forman conjuntos rígidos: las bisagras mueven sus contenedores
sin redimensionar cientos de caras en cada cuadro. El encuadre solo reduce
el conjunto; nunca amplía una textura previamente rasterizada a menor tamaño.
Así, al ampliar la caja o entrar a pantalla completa,
el renderizador vuelve a dibujar las caras con la resolución necesaria en vez
de estirar una capa pequeña ya rasterizada. Se reutilizan las mismas imágenes,
incluidos los lomos girados, sin volver a descargarlas.

Las imágenes se decodifican de forma asíncrona y solo se conservan los elementos del juego
seleccionado. La rotación usa cuaterniones y captura del puntero. No hay un bucle
de animación permanente: se dibuja al interactuar, cargar imágenes o cambiar el
tamaño del panel. Actualizar los datos del mismo juego conserva la orientación.

Las carátulas de las cajas de plástico con funda conservan esquinas rectas: se
ajustan hacia dentro en los extremos expuestos para dejar libre el borde
redondeado del estuche. Su textura sigue alineada con el lomo y las curvas de
unión, incluida la contraportada. Las cajas CD conservan su tapa de acrílico y
su inserto independiente. El plástico inferior usa un acabado liso.
Las esquinas usan 24 segmentos por cuarto de círculo, y las uniones del lomo
16, con iluminación interpolada entre sus extremos para evitar bandas.
Las uniones curvas se conservan al abrir la caja, vinculadas a la tapa o a la
contracaja. Tienen reverso y tapas de cierre; un reborde material une el suelo
interior con las paredes para tapar las fisuras al girar. Genesis usa labios
continuos en U alrededor de la parte superior, el lado de apertura y la base;
sus bordes curvos son finos y no atraviesan la profundidad de la abertura.
La impresión de Genesis tiene el mismo alto en portada, lomo y contraportada.
El cuerpo hundido del lateral de apertura se une a la parte superior e inferior
con curvas de 3,2 mm de radio, separadas del labio exterior fino. El interior
del lomo conserva su material a toda altura, también con la caja cerrada.
Las caras rectas de esa abertura terminan en las tangentes de las curvas y no
reciben el recorte adicional de las esquinas del borde exterior.
El relieve SEGA interior ocupa 50 × 14 mm.

DS y 3DS muestran la imagen **Etiqueta de cartucho** o, en su defecto,
**Cartucho: frente**. La bandeja rodea la tarjeta y deja un hueco lateral para
extraerla. Las cavidades de 3DS tienen suelo hundido 0,65 mm y paredes curvas;
los recortes de las trabas no sustituyen la máscara de esas cavidades.
Estos interiores se construyen al abrir la caja y se reutilizan al girar o cerrar.
En GameCube, DS y 3DS, un nervio divisor continuo separa el sector de seguridad
del espacio del manual y del disco o tarjeta, en ambas mitades del estuche.
Los clips de seguridad se recortan contra el volumen interior de la muesca de
apertura: conservan sus bases y extremos no afectados, y los recortes mantienen
caras de cierre. También se respeta el solapamiento parcial en los extremos de
la muesca, incluidas las variantes regionales de caja.

La portada muestra una copia de la miniatura disponible en la caché del listado,
sin retirar ni modificar el bitmap compartido. El original tiene prioridad alta
y sustituye la miniatura al terminar su decodificación. Después se solicitan
contraportada y lomo; si falla la portada, se conservan la miniatura disponible
y la carga de las otras imágenes. Cambiar de juego descarta respuestas antiguas
y libera los lienzos de vista previa.

Las muescas laterales ocupan el 45 % de la altura en DVD/Blu-ray y el 60 % en
PSP, Switch, DS y 3DS. El detalle cerrado y la geometría de cada mitad abierta
comparten la misma configuración. Las paredes del rebaje, sus extremos y su
borde interior utilizan el plástico de la caja, con su transparencia y color.
El anillo que retiene el disco se recorta mediante dos límites verticales junto
al lomo y al rebaje; los cortes tienen paredes que cierran su volumen.

El modelo DS fino se ajusta a 14 mm, conservando 20 mm para la variante europea.
Referencias de dimensiones: [modelo fino de reemplazo](https://www.gamesmen.com.au/nintendo-ds-third-party-black-replacement-game-case)
y [caja europea de ZedLabz, 13,6 × 12,4 × 2 cm](https://www.zedlabz.com/collections/empty-game-cases/products/replacement-nintendo-ds-gba-retail-game-cartridge-case-25-pack-clear-zedlabz).
Son medidas de referencia: los ajustes manuales de consola o juego siguen
teniendo prioridad.

Las transformaciones se actualizan con los cuadros de la pantalla. La iluminación
se comparte entre normales iguales, omite caras ocultas y escribe solo valores
que cambiaron, con un máximo de 30 actualizaciones por segundo, incluso durante
un arrastre continuo. No espera a soltar el mouse ni a una pausa del movimiento.
Las caras de plástico con la misma orientación, ensamblaje y gradiente comparten
un nodo de iluminación sin transformación propia. Sus superficies permanecen en
el mismo espacio 3D y conservan sus posiciones y materiales. Esto permite
actualizar una sola vez los valores que antes se repetían por cada pieza.
Las curvas interiores solo actualizan las sombras de sus extremos; se omiten
los valores del punto medio y del reflejo exterior que no se utilizan allí.
Tampoco se construye el pseudo-elemento de reflejo exterior invisible en cada
pieza de plástico interior; el del disco se conserva. No se reduce la geometría
ni la resolución de las texturas. Al completar la iluminación pendiente el visor
vuelve a quedar inactivo.

La sección de la muesca abierta tiene un escalón rectangular, con un hombro y
paredes a 90°, en lugar de una rampa diagonal. El hombro mantiene el espesor del
plástico, incluyendo sus caras interiores.

Los reversos del papel se ocultan explícitamente cuando miran hacia atrás.
En cajas opacas el papel también se recorta a los huecos reales del plástico
(pestañas del manual y reciclaje); el resto está tapado por la carcasa y no se
envía como una gran superficie blanca que pueda interferir con la ordenación
de profundidad del navegador. Las cajas translúcidas conservan la hoja completa.
