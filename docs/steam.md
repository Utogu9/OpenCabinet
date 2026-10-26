# Juegos instalados de Steam (Windows)

Abre **Herramientas → Importar juegos → Steam instalado**. La plataforma local
se propone como PC o Windows. Pulsa **Buscar juegos instalados de Steam**.

OpenCabinet detecta el cliente desde el Registro de Windows y las ubicaciones
habituales. Si Steam está en otra carpeta, usa **Examinar** o escribe la carpeta
que contiene `steam.exe`. Se leen `steamapps/libraryfolders.vdf` y, si existe,
`config/libraryfolders.vdf`, incluidos formatos antiguos de la lista de bibliotecas.

Solo se consideran los manifiestos `appmanifest_<AppID>.acf` de esas bibliotecas.
Se comprueban el AppID, el estado instalado y la existencia de su carpeta en
`steamapps/common`. Las descargas sin una instalación completa y las carpetas
sin manifiesto no se importan. No se recorren ejecutables de subcarpetas.
Se omiten componentes compartidos conocidos, como Steamworks Common
Redistributables. Una aplicación instalada que no sea un juego puede aparecer
en la revisión; puedes quitarla con la papelera.

La lista aparece incluso cuando se encuentra un solo juego. Permite corregir
los títulos y quitar juegos antes de continuar. Después se ofrece la misma
búsqueda de metadatos e imágenes del catálogo, con Windows como equivalencia
propuesta. También se puede importar sin datos externos. No se solicita cuenta,
contraseña ni API key, ni se descarga el catálogo completo de Steam.

Cada juego se guarda con un enlace estable `steam://run/<AppID>` y la ruta del
cliente en `games.steam_client_path`. Repetir la importación omite los AppID ya
registrados, incluso si aparecen en otra biblioteca o cambias su título. Al
jugar, se localiza nuevamente el manifiesto entre las bibliotecas actuales del
cliente y se ejecuta `steam.exe -applaunch <AppID>`. Steam gestiona el inicio,
los parámetros configurados en su cliente y la cuenta que tenga iniciada.
OpenCabinet no modifica ni elimina los archivos de Steam. Quitar un juego de
OpenCabinet elimina su registro local y conserva su instalación.

El inventario refleja lo instalado en el equipo, no la titularidad de la cuenta
actual. Puede incluir instalaciones compartidas o de otras cuentas; Steam
comprueba el acceso al abrirlas.

## Sesiones y tiempo

La sesión y la última vez jugado se registran al pedir la ejecución. El tiempo
se mide con el estado `Running` del AppID en
`HKCU\Software\Valve\Steam\Apps\<AppID>`, nunca por la duración de `steam.exe`.
Se esperan hasta dos minutos para observar el inicio y no se suma esa espera.
Si Steam no comunica el estado del juego, la sesión termina sin inventar tiempo
de juego. Este estado depende del cliente de Steam y puede cambiar entre versiones.

## Integridad y validación

Las bibliotecas desconectadas y los manifiestos dañados se muestran en los
detalles del resultado; las demás bibliotecas siguen procesándose. Se valida
nuevamente cada instalación antes del guardado. Si desaparece un juego o falla
la transacción, se revierten los registros y las copias nuevas de imágenes de
esa importación. El cliente de Steam y sus manifiestos solo se leen.

Las pruebas usan bibliotecas temporales con varios discos simulados, listas VDF
antiguas y actuales, escapes, archivos inválidos, instalaciones incompletas,
duplicados, movimientos entre bibliotecas, desinstalaciones durante la revisión,
datos e imágenes simulados del catálogo y estados de ejecución controlados.
No ejecutan un cliente de Steam ni juegos reales.

Referencias de la investigación:

- [Valve: instalación y titularidad de aplicaciones](https://partner.steamgames.com/doc/api/ISteamApps#BIsAppInstalled).
- [Valve: ejecución de juegos mediante Steam](https://partner.steamgames.com/doc/api/ISteamApps#GetLaunchCommandLine).
- [Playnite: detección local de la instalación de Steam](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/SteamLibrary/Steam.cs).
- [Lutris: lectura de la configuración local de bibliotecas](https://github.com/lutris/lutris/blob/master/lutris/util/steam/config.py).
