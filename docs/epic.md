# Juegos instalados de Epic Games (Windows)

Abre **Herramientas → Importar juegos → Epic Games instalado** y pulsa
**Buscar juegos instalados de Epic Games**. Se propone tu plataforma PC o Windows.
No necesitas conectar tu cuenta ni proporcionar una API key a OpenCabinet.

Se leen los archivos `.item` de
`%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests`. Estas instalaciones pueden
estar en distintos discos. Si no se detecta esa carpeta, usa **Examinar** para
seleccionar la carpeta de manifiestos. El cliente se localiza mediante el protocolo
registrado en Windows o sus ubicaciones habituales en Archivos de programa.

Solo se incluyen instalaciones con carpeta y ejecutable presentes, excluyendo
instalaciones incompletas, motores de Unreal, plugins y complementos que no
pueden ejecutarse por separado. Los archivos dañados se informan sin interrumpir
la lectura de los demás. El inventario refleja este equipo, no todos los juegos
comprados de una cuenta. Epic verifica el acceso al abrir cada juego.

La revisión aparece incluso para un solo resultado: puedes corregir títulos o
quitar juegos. Después se ofrece la búsqueda habitual de datos e imágenes del
catálogo, con Windows como equivalencia sugerida. También puedes importar sin
datos externos. El título revisado y la plataforma local se conservan siempre.

Cada juego se guarda con su URI oficial
`com.epicgames.launcher://apps/<Namespace>%3A<CatalogItemId>%3A<AppName>?action=launch&silent=true`.
Los duplicados se omiten aunque cambies el título. Se guardan las rutas del
cliente y del manifiesto en `games.epic_client_path` y `games.epic_manifest_path`.
Al jugar se vuelve a buscar la instalación, incluyendo manifiestos reemplazados
en la misma carpeta y cambios de ubicación registrados por Epic.

OpenCabinet pasa la URI al cliente de Epic como un único argumento, sin ejecutar
los comandos arbitrarios del manifiesto. Epic gestiona la cuenta, autenticación,
parámetros y lanzadores adicionales. Las instalaciones se validan de nuevo antes
de guardar; un error revierte los registros y las imágenes nuevas de esa operación.
Eliminar un juego de OpenCabinet conserva su instalación y sus archivos de Epic.

## Tiempo de juego

La sesión y la última vez jugado se registran al solicitar la ejecución. El tiempo
se mide observando procesos cuya ruta pertenece a la carpeta del juego, usando
consultas de Windows sin elevar permisos. Se excluyen clientes, servicios comunes
de antitrampas, desinstaladores y reportadores de errores. El cliente de Epic
puede permanecer abierto sin sumar tiempo. Hay hasta dos minutos para detectar
el juego y cinco segundos de tolerancia durante el relevo entre ejecutables.

La espera inicial no suma tiempo. Juegos que se ejecuten exclusivamente fuera de
su carpeta, procesos protegidos o lanzadores especiales pueden no ser detectados;
en ese caso no se inventa tiempo. Un proceso auxiliar desconocido que permanezca
en la carpeta puede prolongar la medición hasta que se cierre.

Las pruebas usan manifiestos, ejecutables y respuestas del catálogo simulados.
Comprueban duplicados, instalaciones incompletas, cambios de ubicación,
desinstalaciones durante la revisión, conservación de los datos de ejecución y
reversión ante errores de guardado. No ejecutan Epic ni juegos reales.

Referencias:

- [Epic Games: protocolo oficial de activación y ejecución](https://assets-unreal2-epic-prod-us2.s3.dualstack.us-east-1.amazonaws.com/original/4X/f/c/4/fc4342c50e1a0abf34943e019ee90bacccc62950.pdf).
- [Playnite: lectura de los manifiestos locales de Epic](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/EpicLibrary/EpicLauncher.cs).
- [Playnite: clasificación de instalaciones y seguimiento por carpeta](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/EpicLibrary/EpicLibrary.cs).
- [Microsoft: enumeración de procesos](https://learn.microsoft.com/en-us/windows/win32/toolhelp/taking-a-snapshot-and-viewing-processes).
- [Microsoft: consulta de la ruta de un proceso](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew).
