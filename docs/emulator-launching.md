# Parámetros de emuladores e importación por carpetas

El menú contextual de un único juego emulado ofrece **Abrir emulador**. Abre
el ejecutable específico de ese juego o el predeterminado de su consola, sin
ROM, argumentos de partida ni núcleo de RetroArch. No registra tiempo, sesiones
ni última fecha jugada. No aparece para juegos directos, Steam, Epic, selecciones
múltiples ni consolas sin emulador. Se usa la carpeta del ejecutable como directorio
de trabajo y los errores de apertura se muestran en la aplicación.

Los emuladores nuevos muestran recomendaciones según el nombre del ejecutable
o, si no se reconoce, el nombre escrito. El ejecutable tiene prioridad. El
catálogo está en `src/emulator-presets.json`, compartido por Rust y el formulario.
Sin coincidencia se utiliza `"%ROM%"`.

| Emulador | Plantilla recomendada | Referencia |
| --- | --- | --- |
| PCSX2 actual | `-fullscreen -batch -- "%ROM%"` | [CLI oficial](https://pcsx2.net/docs/advanced/cli/) |
| DuckStation | `-fullscreen -batch -- "%ROM%"` | [Ayuda del ejecutable](https://github.com/stenzek/duckstation/blob/master/src/duckstation-qt/qthost.cpp) |
| Dolphin | `--batch --config Dolphin.Display.Fullscreen=True --exec "%ROM%"` | [Opciones oficiales](https://github.com/dolphin-emu/dolphin/blob/master/Source/Core/UICommon/CommandLineParse.cpp) |
| RetroArch | `--fullscreen "%ROM%"` | [CLI de Libretro](https://docs.libretro.com/guides/cli-intro/) |
| RPCS3 | `--no-gui --fullscreen "%ROM%"` | [Opciones oficiales](https://github.com/RPCS3/rpcs3/blob/master/rpcs3/rpcs3.cpp) |
| shadPS4 (ejecutable del emulador) | `--fullscreen true -g "%ROM%"` | [Uso oficial](https://github.com/shadps4-emu/shadPS4#usage-examples) |
| PPSSPP | `--fullscreen "%ROM%"` | [Inicio en Windows](https://github.com/hrydgard/ppsspp/blob/master/Windows/main.cpp) |
| Cemu | `-f -g "%ROM%"` | [Opciones oficiales](https://github.com/cemu-project/Cemu/blob/main/src/config/LaunchSettings.cpp) |
| melonDS actual | `--fullscreen "%ROM%"` | [CLI oficial](https://github.com/melonDS-emu/melonDS/blob/master/src/frontend/qt_sdl/CLI.cpp) |

Al elegir un ejecutable conocido se completa también el nombre oficial del
emulador, tanto en Configurar emuladores como durante la importación. Un nombre
escrito manualmente o ya guardado se conserva. El nombre y los argumentos
pueden personalizarse por separado, sin desactivar la recomendación del otro campo.

Las recomendaciones funcionan tanto en Configurar emuladores como al crear uno
durante una importación. Al editar parámetros manualmente deja de aplicarse la
sugerencia automática. Los emuladores ya guardados conservan sus parámetros;
**Usar parámetros recomendados** permite reemplazarlos explícitamente. Las
versiones antiguas o modificadas pueden necesitar otra plantilla, que sigue
siendo editable. El núcleo de RetroArch continúa agregándose automáticamente.

Al ejecutar, primero se divide la plantilla en argumentos y después se sustituye
`%ROM%`. Así una ruta con espacios sigue siendo un único argumento, incluso con
plantillas antiguas que no incluyeran comillas. No se utiliza una consola del sistema.

## PS3 y PS4

En **Importar juegos → Varios → PS3/PS4**, seleccionar el directorio que contiene
las carpetas de los juegos. Se comprueban únicamente estas rutas, sin distinguir
mayúsculas, en cada carpeta inmediata. No se hace una búsqueda recursiva. Ejemplos:

```text
Biblioteca/
  Mi juego de PS3/PS3_GAME/USRDIR/EBOOT.BIN
  Mi juego de PS4/eboot.bin
```

La revisión muestra «Mi juego de PS3» y «Mi juego de PS4», respectivamente.
En PS3 se exige `PS3_GAME/USRDIR/EBOOT.BIN`; una carpeta sin `PS3_GAME` se
descarta. En PS4 se exige `eboot.bin` en la raíz de la carpeta de juego; no se
busca más adentro. También se puede seleccionar directamente una carpeta de
juego válida, o elegir su EBOOT.BIN en la importación individual.
Los demás archivos `.bin` internos y `PS3_UPDATE` no se importan. No se siguen
enlaces simbólicos ni junctions. El escaneo funciona fuera del hilo de interfaz
y reutiliza la revisión de títulos, el catálogo, recuperación de medios y control
de duplicados por ruta que ya existían.

Este proceso registra ejecutables ya disponibles: no instala paquetes PKG ni
extrae imágenes ISO. Las extensiones configuradas para los archivos del directorio
principal conservan su comportamiento anterior. La búsqueda de EBOOT.BIN en PS3
y PS4 se realiza aunque una plataforma existente todavía no incluya `.bin` entre
sus extensiones guardadas.
