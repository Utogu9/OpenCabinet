# Diagnóstico y almacenamiento

**Acerca de → Logs** muestra un informe editable antes de elegir
dónde guardarlo en JSON. Incluye la versión, el sistema, el motor web, el renderer
WebGL, las dimensiones de la ventana, algunas preferencias de caché e idioma y
hasta 50 errores recientes de la sesión actual. Los errores se guardan únicamente
en memoria; no se crea un registro permanente ni se envía información a un servidor.
Las rutas y URLs habituales se ocultan. Conviene revisar la vista previa antes de
compartirla, ya que los mensajes de terceros pueden contener otros datos privados.
El archivo exportado contiene exactamente la vista previa, con las modificaciones
que se hayan realizado en ella.

**Preferencias → Datos de usuario → Almacenamiento** calcula los tamaños únicamente
al pulsar Calcular almacenamiento. Se puede cambiar de sección o cerrar Preferencias
mientras termina en segundo plano. El recorrido se ejecuta fuera del hilo de
interfaz y no sigue enlaces ni junctions. Se muestran por separado la biblioteca,
imágenes, manuales, caché, backups, catálogos, emuladores y otros archivos.
La caché personalizada también se cuenta si está fuera de la carpeta de datos;
en ese caso solo se recorren sus subcarpetas administradas de miniaturas.

La limpieza pide confirmación y elimina únicamente archivos WebP con los nombres
generados por la caché dentro de sus carpetas versionadas. No borra originales,
manuales, estadísticas ni backups. Las miniaturas ya decodificadas pueden seguir
en RAM y la precarga puede volver a generar archivos según se necesiten.

Las colecciones conservadas son las que el índice ya no asocia con ningún juego,
incluidas sus versiones regionales. Sus tamaños forman parte de los totales:
no se suman dos veces. Se puede abrir su carpeta para inspeccionarla; esta pantalla
no elimina esas colecciones ni modifica sus manifiestos.
