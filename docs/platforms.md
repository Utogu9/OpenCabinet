# Consolas y emulador predeterminado

Haz clic derecho sobre una consola de la barra lateral izquierda y elige **Editar consola**. Se abre el mismo editor de datos e imágenes que el botón del panel derecho. El menú no cambia el juego o la consola seleccionados y no se ofrece sobre **Todo**.

En el editor, **Emulador predeterminado** muestra únicamente los emuladores registrados para esa consola. **Automático** usa el primero que se registró, como en las versiones anteriores. Una elección explícita se aplica al pulsar **Guardar cambios**; Cancelar descarta el borrador. Si no hay emuladores, el selector informa que falta configurarlos desde **Opciones → Configurar emuladores**.

La preferencia se guarda en la base de datos, en `platform_details.default_emulator_id`, y se conserva al reiniciar, renombrar la consola o trasladar la carpeta de datos. Se valida que el emulador exista y pertenezca a esa plataforma. Si se elimina o se mueve a otra consola, la preferencia vuelve a Automático; si no queda ninguno, se muestra **Sin configurar**.

La misma elección se usa al jugar desde el listado, el menú contextual y los botones del lateral, incluidos Último jugado, Más jugado y Aleatorio. Para RetroArch se utilizan el ejecutable, los argumentos y el núcleo de la misma configuración elegida. El lateral muestra el emulador efectivo y el importador lo preselecciona en su lista.

## Plataformas predeterminadas

Los nombres de consolas comienzan por la marca. PC y Arcade se conservan como
categorías generales. La lista incluye generaciones actuales y clásicas;
registrar una plataforma no instala ni configura un emulador.

Al actualizar, los nombres conocidos se normalizan una sola vez. Se mantienen
los identificadores, extensiones personalizadas, datos e imágenes de consola,
emulador predeterminado y asociaciones de juegos/emuladores. Las nuevas entradas
se incorporan sin sustituir las existentes. Los nombres personalizados se conservan.
Si dos plataformas configuradas ya representan el mismo sistema, se conservan
ambas para evitar una unión implícita y pérdida de ajustes.

La versión del catálogo impide reinsertar al reiniciar las plataformas que se
borren después de esta actualización. Las colecciones de imágenes antiguas
reconocen también los nombres anteriores durante la recuperación, sin exigir
reescribir todos los manifiestos al arrancar.

La fuente de la lista y sus extensiones está en `src-tauri/src/platform_defaults.rs`.
Los filtros siguen ordenados alfabéticamente y solo muestran plataformas con juegos.

### Catálogo

- Arcade
- Atari 2600
- Atari 5200
- Atari 7800
- Atari Jaguar
- Atari Lynx
- Bandai WonderSwan
- Bandai WonderSwan Color
- Coleco ColecoVision
- Mattel Intellivision
- Microsoft Xbox
- Microsoft Xbox 360
- Microsoft Xbox One
- Microsoft Xbox Series X/S
- NEC PC Engine / TurboGrafx-16
- NEC PC Engine CD
- NEC SuperGrafx
- Nintendo NES
- Nintendo SNES
- Nintendo 64
- Nintendo GameCube
- Nintendo Wii
- Nintendo Wii U
- Nintendo Switch
- Nintendo Switch 2
- Nintendo Game Boy
- Nintendo Game Boy Color
- Nintendo Game Boy Advance
- Nintendo Virtual Boy
- Nintendo DS
- Nintendo 3DS
- Nintendo Famicom Disk System
- 3DO Interactive Multiplayer
- Philips CD-i
- Sega SG-1000
- Sega Master System
- Sega Mega Drive / Genesis
- Sega Mega-CD / Sega CD
- Sega 32X
- Sega Saturn
- Sega Dreamcast
- Sega Game Gear
- SNK Neo Geo
- SNK Neo Geo CD
- SNK Neo Geo Pocket
- SNK Neo Geo Pocket Color
- Sony PlayStation
- Sony PlayStation 2
- Sony PlayStation 3
- Sony PlayStation 4
- Sony PlayStation 5
- Sony PSP
- Sony PlayStation Vita
- PC
