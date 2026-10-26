# Fuentes de datos e imágenes

La fuente predeterminada es [OpenCabinet-BDD](https://github.com/Utogu9/OpenCabinet-BDD).
No requiere cuentas. Se consulta su índice de plataformas y se descarga únicamente
el `catalog.json` de las plataformas necesarias. Cada catálogo queda indexado en
SQLite para reutilizarlo sin nuevas descargas. El botón de actualizar catálogo
renueva el índice e invalida las plataformas preparadas; estas vuelven a
descargarse cuando se necesitan.

El repositorio proporciona imágenes, nombres de ediciones e identificadores
comerciales, y fichas opcionales de metadatos compartidas mediante `metadata_id`.
Al importar ROMs se busca primero su nombre original, conservando región,
idiomas, revisión y disco, y quitando las extensiones conocidas. Si no coincide,
se busca por el título revisado. Los resultados muestran su ID comercial;
si varios IDs coinciden exactamente con el nombre original, se prefiere el más
corto, manteniendo las demás opciones disponibles. Este comportamiento es
exclusivo de OpenCabinet-BDD y no cambia la búsqueda de los catálogos personales.

Completar datos utiliza los desarrolladores, editores, géneros, modos, cantidades
de jugadores, fechas y descripciones breves disponibles. Se prefiere el idioma
de la app, con alternativas en inglés o español; no se traduce automáticamente.
Los campos ausentes conservan los valores del editor. Las fechas sin día preciso
no se convierten en fechas inventadas. Se descartan afirmaciones obsoletas y de
otras plataformas y se prioriza la región de la edición cuando está indicada.
Los recuentos de jugadores no se deducen de los modos de juego. En la importación
se conservan el título revisado y la plataforma local.

`console_metadata` completa fecha, desarrollador y fabricante de las consolas.
Sus imágenes se consultan en `console_artwork.json`; los logos SVG se conservan
como vectores estáticos, con validación antes de guardarlos. Las descargas usan
la misma revisión, guardado o cancelación del editor de consola y se intentan
automáticamente al importar juegos para una consola nueva. Los índices anteriores
de imágenes se actualizan por plataforma cuando se utilizan por primera vez con
esta versión; las actualizaciones posteriores siguen siendo manuales.

Las fichas de ejemplo de las pruebas proceden de los datos estructurados CC0 de
Wikidata publicados en OpenCabinet-BDD. El SVG de prueba es un dibujo geométrico
sintético, sin marcas de consolas.

El logo principal de consola (`logo.svg`, o su alternativa raster) conserva el
tipo `logo`. Las variantes y símbolos `logo2`, `logo3`, etc. se ofrecen como
`other` para poder descargarlos juntos sin sustituir el logo principal.
Los tipos disponibles se muestran con casillas y su cantidad. Por defecto se descarga
una imagen por tipo seleccionado; la opción de descargar todas incluye todas
las variantes seleccionadas. En el editor, `other` se presenta como «Otros y
logos alternativos». Los logos adicionales conservan el logo principal actual.
Los nombres administrados conservan el identificador de origen de cada descarga;
las marcas del visor 3D se resuelven desde esas imágenes guardadas, sin incluir
los SVG de las marcas en la aplicación. La equivalencia completa se documenta
en [las cajas 3D](game-boxes.md).

Las búsquedas usan títulos completos, sus versiones sin etiquetas y los
identificadores comerciales. Una coincidencia exacta única puede proponerse
automáticamente. Si hay varias ediciones exactas, se intenta distinguirlas por
el nombre original del archivo y por su región; los casos ambiguos requieren
revisión. Los resultados muestran la edición para que se pueda elegir otra.

Los tipos de imagen se traducen a las categorías existentes de OpenCabinet;
por ejemplo, `cover_front` corresponde a portada. Los sufijos numéricos son
variantes del mismo tipo. Se conservan los controles de una o todas las imágenes,
las prioridades regionales, los cuatro trabajadores de descarga, los reintentos
y la cancelación. Solo se solicitan los archivos de las coincidencias y tipos
seleccionados. Las rutas del repositorio se validan y codifican antes de formar
URLs HTTPS bajo el repositorio oficial.

## Catálogo personal

**Opciones → Preferencias → Datos de juegos** permite seleccionar un catálogo
personal compatible en ZIP o SQLite, o volver a OpenCabinet-BDD. La selección es un borrador hasta
guardar las preferencias. Al importar se valida la integridad y estructura de la
base, se copia a la carpeta de datos administrada y se activa únicamente después
de completar la copia. El archivo original se abre en lectura y no se modifica.
Una importación fallida conserva la selección y el catálogo anteriores.
El ZIP se procesa directamente: los documentos se leen de forma progresiva y
se construye un índice SQLite interno, sin extraer entradas del archivo a rutas
del sistema ni modificar el ZIP original. Se limita el tamaño del archivo y de
los documentos descomprimidos y se rechazan catálogos vacíos, incompletos o
incompatibles. La lectura, indexación y validación se ejecutan fuera del hilo de
interfaz y envían avance a Preferencias mientras se guarda la selección.

La aplicación no proporciona instrucciones para obtener catálogos personales.
No se descargan ni actualizan automáticamente. Un archivo guardado por una
versión anterior tampoco los activa: se requiere una selección explícita.
Los textos de la interfaz identifican esta fuente como catálogo personal.
No se puede cambiar la fuente mientras exista una operación de búsqueda o
descarga activa, para evitar mezclar sesiones y respuestas atrasadas.

## Persistencia y recuperación

- `metadata/source.json` guarda la selección de fuente.
- `metadata/opencabinet.db` contiene el índice reconstruible del repositorio.
- `metadata/personal.db` contiene la copia del catálogo seleccionado.
- Las preparaciones e importaciones usan carpetas propias en `metadata/staging`,
  cubiertas por la limpieza de operaciones interrumpidas al iniciar.
- Las coincidencias y equivalencias de plataformas del repositorio se guardan
  aparte de las referencias anteriores. Sus identificadores son deterministas,
  distinguen plataforma y edición y caben exactamente en un número de JavaScript.
- Los manifiestos incluyen opcionalmente la referencia de imágenes del
  repositorio, manteniendo la lectura de manifiestos anteriores y la recuperación
  de colecciones tras perder la base de datos.

Cambiar de fuente no borra imágenes, manuales, estadísticas ni datos de juegos.
Las imágenes de consolas siguen admitiendo archivos locales y las imágenes
publicadas en el índice de consola del repositorio.

## Compatibilidad de nombres

Los módulos y comandos de la aplicación usan nombres neutrales bajo `metadata`.
La fixture XML se llama `metadata-catalog.xml`. Los campos nuevos de intercambio
usan `catalog_id` (o `catalogId` para la edición). Los manifiestos y solicitudes
anteriores siguen leyéndose mediante alias, sin modificar las columnas SQLite
existentes ni perder sus asociaciones. La comprobación al iniciar reconoce las
dos variantes del identificador para evitar volver a guardar todas las
colecciones en cada arranque. Los valores del protocolo externo se centralizan
en `catalog_compat.rs`; las cadenas históricas de SQLite y de serialización usan
escapes equivalentes, sin modificar sus valores en ejecución. La fixture usa
una raíz XML neutral; el lector acepta también la raíz histórica. La aplicación
conserva así la compatibilidad de los archivos aportados por el usuario.

Las pruebas cubren variantes, regiones, rutas inválidas, cancelación, actualización
fallida, selección de catálogo, reversión ante errores y recuperación desde
manifiestos. La prueba opcional del catálogo real usa una copia descargada dentro
de `target`, sin tocar la biblioteca activa.
