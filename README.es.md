# OpenCabinet

[English](README.md) · [Español](README.es.md)

<img src="src/assets/OpenCabinetLogo.webp" alt="Logo de OpenCabinet" width="96" />

OpenCabinet es una biblioteca y un lanzador de juegos de escritorio, desarrollado
con Tauri, Rust, SQLite y HTML/CSS/JavaScript.

Organizá tus juegos, configurá emuladores, descargá imágenes y explorá tu
colección mediante cajas 3D interactivas y manuales PDF y CBZ.

El proyecto está en desarrollo activo. Windows es la plataforma actualmente
soportada y probada; las demás plataformas de escritorio no fueron validadas.

## Funciones

- Importar juegos individuales, buscar ROMs en carpetas y detectar juegos de
  Steam y Epic Games instalados en el equipo.
- Configurar emuladores por consola, personalizar la ejecución de cada juego y
  preparar RetroArch con descargas opcionales del emulador y sus núcleos.
- Revisar los títulos detectados, agrupar discos o ediciones regionales y elegir
  qué ejecutar sin mover ni eliminar los archivos originales de los juegos.
- Explorar plataformas, categorías personalizadas y agrupaciones por metadatos,
  con búsqueda, selección múltiple y orden personalizado para las sagas.
- Descargar los datos e imágenes de juegos y consolas disponibles en
  [OpenCabinet-BDD](https://github.com/Utogu9/OpenCabinet-BDD), o agregar imágenes locales.
- Girar y ampliar cajas 3D, abrir los modelos compatibles, mostrar la imagen del
  disco y leer los manuales PDF y CBZ agregados por el usuario, página por página.
- Medir tiempo de juego, sesiones y última vez jugado, con estadísticas por
  región y totales de cada consola.

## Requisitos de desarrollo

- Windows con los [requisitos de Tauri 2](https://v2.tauri.app/start/prerequisites/):
  Microsoft C++ Build Tools con **Desarrollo para el escritorio con C++**, el SDK
  de Windows y Microsoft Edge WebView2 Runtime.
- [Rust](https://www.rust-lang.org/tools/install) 1.90 o posterior, con el
  toolchain MSVC en Windows.
- [Node.js](https://nodejs.org/) 22.13 o posterior, con npm.

Descargá o cloná este repositorio y ejecutá estos comandos desde su raíz:

```sh
npm ci
npm run dev
```

La instalación de dependencias prepara automáticamente las traducciones y los
archivos locales de PDF.js. `npm run dev` inicia la aplicación nativa de Tauri;
abrir `src/index.html` directamente no reemplaza la ejecución de la app.

En PowerShell de Windows podés usar `npm.cmd` si la política de ejecución impide
ejecutar `npm.ps1`.

## Primeros pasos

1. Abrí **Opciones → Configurar plataformas** y **Configurar emuladores** para
   revisar las consolas y sus parámetros de ejecución. El importador también
   permite configurar un emulador cuando una plataforma todavía no tiene uno.
2. Elegí **Herramientas → Importar juegos**, seleccioná el origen y seguí los
   pasos de revisión. La búsqueda de datos y descarga de imágenes es opcional.
3. Hacé clic derecho sobre un juego para editar sus datos, imágenes, manuales,
   discos y opciones de ejecución. Los manuales PDF y CBZ se agregan desde tus archivos.
4. Entrá en **Opciones → Preferencias** para elegir el idioma, la apariencia de
   la biblioteca, la caché y la ubicación de los datos.
5. Usá **Acerca de → Buscar actualizaciones** para consultar e instalar nuevas versiones.

No se incluyen ROMs, juegos de PC, BIOS ni manuales. Las importaciones de tiendas
detectan juegos instalados en este equipo; no descargan toda la biblioteca de
una cuenta.

## Datos de usuario

De forma predeterminada, la carpeta `data` junto al ejecutable guarda la base
SQLite, las imágenes administradas, los manuales, los catálogos y los emuladores
descargados.

Las ubicaciones de los datos y de la caché de portadas se configuran en
Preferencias. Los cambios de ubicación de datos se aplican al reiniciar la app.
El archivo `opencabinet.config.json`, junto al ejecutable, registra una ubicación
personalizada.

Hacé un backup de esta carpeta para conservar tu biblioteca, imágenes y estadísticas.

## Estructura y documentación

- `src/`: interfaz, visores 3D y traducciones.
- `src-tauri/src/`: comandos nativos, almacenamiento, importación y seguimiento de procesos.
- `tests/` y `src-tauri/tests/fixtures/`: pruebas automatizadas y datos de ejemplo.
- `scripts/`: preparación de traducciones, PDF.js e íconos de la aplicación.
- `docs/`: detalles de implementación y documentación de las funciones, en español.

Podés empezar por [importar juegos](docs/importing-games.md),
[datos e imágenes](docs/metadata-sources.md),
[cajas 3D y manuales](docs/game-boxes.md), [RetroArch](docs/retroarch.md),
[preferencias y datos](docs/preferences.md) y [traducciones](docs/translations.md).

## Colaborar

Podés contribuir con reportes de errores, traducciones y código. Al informar un
problema, indicá la versión de Windows, cómo reproducirlo y qué resultado esperabas.
Usá ejemplos sintéticos pequeños en lugar de subir tu biblioteca o archivos de juegos.

Ejecutá las pruebas correspondientes antes de proponer un cambio. Conservá los
datos existentes y evitá incluir archivos generados, rutas personales o imágenes
descargadas en los cambios.

## Licencia y créditos

El código original de OpenCabinet se publica bajo la [licencia MIT](LICENSE).

Las dependencias y los medios externos conservan sus propias licencias y derechos.
Consultá los [avisos de terceros](THIRD_PARTY_NOTICES.md). OpenCabinet es un proyecto
independiente; los nombres de productos y plataformas pertenecen a sus respectivos titulares.
