# Importar juegos

El importador avanza por pantallas: origen, plataforma y emulador, archivos, revisión de títulos cuando corresponde, y datos e imágenes. **Continuar** valida la configuración antes de pedir los archivos. **Atrás** permite volver conservando la carpeta o el archivo elegido, salvo que se cambie la plataforma o el origen.

Al abrir el importador se precarga el resumen del catálogo local de metadatos en segundo plano, sin descargarlo ni abrir una sesión de importación. El resumen se reutiliza y se invalida cuando se reemplaza el catálogo.

En datos e imágenes, **Buscar coincidencias** aparece debajo de la plataforma equivalente del catálogo, con el progreso inmediatamente después y antes de los tipos de imagen. **Recuperar estadísticas, imágenes y manuales guardados** despliega las colecciones locales; la sección comienza plegada. La recuperación automática de coincidencias únicas sigue funcionando aunque no se despliegue.

El análisis de tipos de imagen deja disponibles las correcciones de coincidencias y descarta respuestas atrasadas. Una vez cargadas las opciones, se conservan mientras se corrigen otros juegos y se comprueban de nuevo al descargar e importar. Si aún no había coincidencias, se analizan los tipos al elegir la primera.

Los tipos iniciales son Portada, Logo, Captura de juego, Pantalla de título, Contraportada, Lomo y Disco, cuando estén disponibles. Las selecciones se guardan localmente para futuras importaciones y descargas, conservando también las elecciones de tipos que no aparezcan en un lote. Una importación completada muestra la ventana flotante en verde; los errores y cancelaciones no usan ese estado.

Abre **Herramientas → Importar juegos** y elige:

- **Un juego:** selecciona la plataforma y el archivo con Examinar. Para PC,
  elige el ejecutable `.exe` del juego; para una consola, el archivo de la ROM.
  Puedes corregir el título propuesto antes de continuar con datos e imágenes.
- **Varios juegos:** conserva el escaneo de una carpeta, las extensiones por
  plataforma, la configuración de emulador y la revisión de los títulos.
- **Steam instalado:** detecta las bibliotecas locales de Steam e importa sus
  juegos instalados, con revisión previa y búsqueda opcional de datos e imágenes.
  Los abre a través del cliente de Steam. Consulta [los detalles de Steam](steam.md).
- **Epic Games instalado:** detecta las instalaciones locales de Epic, con
  revisión previa y búsqueda opcional de datos e imágenes. Los abre mediante
  Epic Games Launcher. Consulta [los detalles de Epic Games](epic.md).

PC aparece en el selector aunque todavía no esté registrada. Se crea al continuar
una importación para esa plataforma, con `.exe` como extensión. También se
reconocen Windows, Microsoft Windows y PC (Windows). PC Engine y PC-98 siguen
siendo plataformas emuladas. Los juegos de PC fuera de Steam y Epic se eligen individualmente.

Los juegos individuales pasan por la misma búsqueda, selección de coincidencias
y descarga de imágenes del catálogo que una importación por carpeta. PC sugiere
Windows como plataforma equivalente. Puedes importar sin datos externos. Se
conservan el título revisado y la plataforma local, y los duplicados se omiten.

Importar registra la ubicación del archivo: no ejecuta ni copia el juego. Al
pulsar Jugar, un juego de PC abre su ejecutable directamente, sin argumentos y
con su carpeta como directorio de trabajo. No necesita un emulador. El modo se
guarda en `games.launch_directly` y se conserva al editar datos o renombrar la
plataforma. Los registros anteriores mantienen su modo de ejecución por emulador.

Las sesiones, la última vez jugado y el tiempo usan el seguimiento existente del
proceso iniciado. Si un ejecutable es un lanzador que abre otro proceso y se
cierra, se mide la duración de ese lanzador.

El selector nativo permite cancelar. Antes del guardado se comprueba nuevamente
que el archivo siga disponible; cualquier error en la transacción revierte los
registros y las imágenes administradas creadas durante esa importación.

## Formatos adicionales

Nintendo 3DS admite `.zcci`, incluido el selector de archivo individual y el
escaneo por carpetas. Las plataformas con la lista predeterminada anterior de
3DS incorporan esta extensión al iniciar; las listas personalizadas se conservan.

Los nombres de Xbox como `Halo (USA).xiso.iso` se importan como `Halo`. Se quitan
las dos extensiones reconocidas sin renombrar el archivo original, igual que
con otros formatos de extensiones compuestas.
