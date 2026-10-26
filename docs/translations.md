# Idiomas y traducciones

Los archivos editables están en `src/locales/`:

- `es-AR.json`: español de Argentina y catálogo de respaldo.
- `en-US.json`: inglés de Estados Unidos.

El idioma se elige en **Opciones → Preferencias → Inicio → Idioma**. Hay que guardar
y volver a abrir OpenCabinet para aplicarlo. Esto evita reconstruir ventanas,
visores o importaciones que están en curso. Las preferencias existentes continúan
en español de Argentina hasta elegir otro idioma.

## Agregar una traducción

1. Copiar `es-AR.json` con el nombre de la nueva etiqueta de idioma y región, por
   ejemplo `pt-BR.json`, `fr-FR.json` o `es-ES.json`.
2. Cambiar `_meta.locale` para que coincida con el nombre del archivo y escribir
   en `_meta.name` el nombre del idioma tal como lo leería su hablante, por ejemplo
   `Português (Brasil)`.
3. Traducir únicamente los valores de `messages`, manteniendo las claves.
   Las claves `msg.*` identifican mensajes estables; se puede encontrar uno
   buscando su texto en el archivo. No se deben renombrar al traducir.
4. Ejecutar `npm run prepare:locales` y `npm test`. Después compilar o iniciar
   la aplicación normalmente. El idioma aparecerá en el selector sin modificar
   la interfaz ni Rust.

Las traducciones se incluyen al compilar: los JSON del repositorio son la fuente,
no archivos de la biblioteca del usuario. `catalogs.js` es un archivo generado y
no se edita ni se versiona. Los comandos de desarrollo, compilación y postinstall
lo preparan automáticamente. La generación no reescribe archivos sin cambios.

## Variables y formatos

Hay que conservar todos los marcadores, aunque se puede cambiar su orden:

```json
"msg.628d3d3bc8": "Logo for {0}"
```

Los mensajes de JavaScript usan `{0}`, `{1}`, etc. Los de Rust pueden usar `{}`,
`{e}`, `{path}`, `{error}` u otros nombres y especificadores de formato. No hay que
traducir esos nombres, agregar llaves ni cambiar los identificadores. Los textos
que contienen etiquetas HTML deben conservar sus etiquetas y atributos; se traduce
el texto visible y los atributos accesibles. Nunca se agrega código ejecutable.

El inglés incluye todos los mensajes. Un idioma nuevo puede empezar incompleto:
si falta una clave, se usa es-AR para ese mensaje. Si el idioma elegido deja de
estar incluido, se vuelve a es-AR. Los nombres de los idiomas se muestran según
su propia metadata.

## Alcance

Se traducen etiquetas, botones, menús, ayudas, placeholders, textos accesibles,
estados de progreso, confirmaciones, visores y mensajes propios del backend.
Las fechas de la interfaz usan el idioma seleccionado y respetan la preferencia
independiente de 12 o 24 horas.

No se traducen títulos, nombres de plataformas y emuladores, descripciones,
metadata descargada, nombres o valores de variables del usuario, categorías
personalizadas, nombres de archivos, rutas ni marcas impresas en los modelos de
las cajas. Los errores propios del sistema operativo o de servicios externos se
conservan como llegan; el contexto que agrega OpenCabinet sí está traducido.

## Agregar textos durante el desarrollo

Para texto dinámico, agregar una clave en ambos catálogos y usar
`OpenCabinetI18n.t("clave", valor0, valor1)`. La interpolación conserva los valores
sin traducirlos. Los elementos estáticos usan `data-i18n="clave"` o atributos
como `data-i18n-placeholder="clave"` y `data-i18n-aria-label="clave"`.

En Rust se usa `i18n::text("clave")` o
`i18n::i18n_format!("clave", argumento, nombre = valor)`. Los argumentos capturados
deben pasarse explícitamente. El build descubre los formatos usados y genera las
ramas por idioma, para que el compilador compruebe sus argumentos. No se usan
textos traducidos como identificadores de archivos, campos de bases de datos o
tipos de imágenes de servicios externos.

Las pruebas verifican que los catálogos base estén completos, que conserven los
marcadores y que existan las claves usadas en la interfaz y en Rust. También
comprueban el respaldo de traducciones parciales y la persistencia del selector.
