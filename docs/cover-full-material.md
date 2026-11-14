# Acabado de cubiertas completas: `cover_full_material`

Este tipo de imagen es un mapa opcional de datos para una **Cubierta completa**
(`cover_full` en OpenCabinet-BDD, `box_full` internamente). Reúne relieve,
rugosidad e intensidad de reflejo en un solo archivo. No contiene el arte ni
reemplaza la imagen de la cubierta.

## Canales

Usar una imagen **RGBA de 8 bits por canal**:

| Canal | Propiedad | Valor 0 | Valor 255 |
| --- | --- | --- | --- |
| Rojo, R | Altura para bump | Más hundido | Más elevado |
| Verde, G | Rugosidad | Superficie lisa, reflejos definidos | Superficie mate, reflejos muy difusos |
| Azul, B | Reservado | Usar 0 | No se utiliza |
| Alfa, A | Intensidad especular | Sin reflejo añadido | Máxima intensidad del acabado |

El **alfa no hace transparente la carátula**. Guarda un dato independiente.
Aunque el editor de imágenes muestre una zona transparente, sus valores R y G
deben seguir existiendo.

El rojo es un **mapa de altura**, no un normal map RGB. Un rojo uniforme, por
ejemplo 128, no produce relieve; importan las diferencias entre píxeles.
La intensidad de bump está fijada en 0,12 unidades de la escena; no representa
desplazamiento real de la geometría ni modifica la silueta. Los cambios suaves
dan mejores resultados que los saltos bruscos de negro a blanco.

La rugosidad regula lo concentrado o difuso que es el reflejo; el alfa regula
su intensidad. Son controles independientes: una zona puede ser lisa y reflejar
poco, o rugosa y mantener un reflejo amplio.

## Correspondencia con la carátula

El mapa debe tener **el mismo encuadre, orientación y proporciones** que la
imagen `cover_full`: contraportada, lomo y portada deben ocupar exactamente
las mismas zonas en ambas imágenes. También se admiten cubiertas completas
verticales en las cajas que ya las soportan.

Conviene crearlo con las mismas dimensiones en píxeles. Otra resolución es
válida si conserva esas proporciones y posiciones. El visor limita el lado
mayor del mapa a 2048 píxeles, conservando su proporción.

No recortar, girar, añadir márgenes ni redimensionar un canal por separado.
Los ajustes de los lomos de CD y del atlas de las cajas se aplican también
al mapa. Cuando un manual reemplaza la portada de PS1/Dreamcast/Saturn, el
mapa de la cubierta no se aplica sobre la imagen del manual.

## Preparación

1. Preparar tres imágenes en escala de grises, todas con el encuadre de la
   cubierta: altura, rugosidad e intensidad especular.
2. Copiar altura al canal R, rugosidad al G e intensidad al A de una imagen
   RGBA nueva. Dejar B en 0.
3. Guardar conservando los valores numéricos de los canales, sin corrección de
   color, mezclarlos con un fondo ni premultiplicar RGB por alfa.

Ejemplos de valores para empezar a probar, no mediciones de un material real:

| Zona | R | G | B | A |
| --- | --- | --- | --- | --- |
| Papel plano y mate | 128 | 255 | 0 | 0 |
| Papel plano con brillo suave | 128 | 100 | 0 | 100 |
| Barniz brillante sobre un logotipo | 128 | 35 | 0 | 210 |
| Letras elevadas | Gradiente de 128 hacia 150 en el borde | Según su acabado | 0 | Según su acabado |

El mapa suele verse de colores extraños o parcialmente transparente al abrirlo
como una foto. Eso es normal: sus canales se interpretan por separado.

## Formato y exportación

**PNG RGBA sin pérdida es la opción más segura.** No usar JPEG, convertir a
RGB sin alfa, aplanar la transparencia ni aplicar optimizaciones que borren el
RGB de los píxeles transparentes. Tampoco aplicar ajustes sRGB/gamma al mapa:
OpenCabinet lo carga como datos lineales (`NoColorSpace`). La imagen de arte
de la cubierta sigue usando su interpretación de color habitual.

También se puede usar **WebP sin pérdida**, conservando el RGB oculto por alfa.
Con `cwebp`, usar ambos parámetros:

```sh
cwebp -lossless -exact cover_full_material.png -o cover_full_material.webp
```

`-lossless` por sí solo no garantiza conservar el RGB de las áreas con alfa
cero; para eso se necesita `-exact`.
[Documentación oficial de cwebp](https://developers.google.com/speed/webp/docs/cwebp).

## Uso en OpenCabinet y en el catálogo

En **Editar juego → Imágenes del juego**, agregar el archivo y asignarle
**Material de cubierta completa (relieve y reflejos)**. Debe existir también
una imagen de tipo **Cubierta completa**. Con varias variantes, elegir como
predeterminadas la cubierta y el mapa que correspondan entre sí.

En OpenCabinet-BDD, agregar `cover_full_material` al objeto `images` del juego,
igual que los otros tipos:

```json
{
  "cover_full": { "path": "GAME_ID/cover_full.webp" },
  "cover_full_material": { "path": "GAME_ID/cover_full_material.png" }
}
```

La categoría se admite en los catálogos JSON y SQLite, en la descarga individual,
por lotes y durante la importación. Sigue el mismo almacenamiento, créditos y
conservación en manifiestos que las demás imágenes. Los nombres numerados como
`cover_full_material2` se reconocen como variantes del mismo tipo.

El mapa se carga después de la imagen de la cubierta y funciona en los visores
Three.js del lateral, pantalla completa y modo sofá. Se reutiliza su textura
para los tres efectos. No se añade geometría ni otra pasada de dibujo para el
acabado, y sus recursos se liberan al cambiar de juego.

Con un mapa activo se sustituye el brillo uniforme de la película fina por
el acabado definido en él, conservando el acrílico estructural de las cajas.
El color del escaneo se mantiene; se añaden reflejos y una modulación suave
debida al relieve. El mapa no aparece como foto en el carrusel.

Sin cubierta completa, sin mapa, si falla su lectura o en el visor CSS de
respaldo, se conserva la visualización habitual. El relieve no genera sombras
geométricas ni permite reconstruir de forma automática el material real a
partir de una fotografía.
