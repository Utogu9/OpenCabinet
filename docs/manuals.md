# Manuales PDF y CBZ

Los manuales se agregan desde **Editar juego → Manuales** o copiando los archivos
en la carpeta `manuals` de su colección. Los originales elegidos en el editor
se copian al guardar. Los CBZ mantienen su extensión y participan en los mismos
manifiestos, copias de seguridad y recuperación de colecciones que los PDF.

Un CBZ es un ZIP de imágenes. OpenCabinet admite páginas JPEG, PNG, WebP, BMP,
GIF y AVIF, con los formatos que puede decodificar el WebView. Ordena los nombres
de archivos y subcarpetas con orden numérico: `1`, `2`, `10`. Ignora directorios,
archivos ocultos, metadatos como `ComicInfo.xml` y entradas fuera de la estructura
del archivo. No interpreta la información de lectura de ComicInfo.

El archivo permanece comprimido. Rust enumera sus entradas y lee cada imagen
solicitada fuera del hilo de interfaz; no extrae el manual a una carpeta temporal.
Cada imagen tiene un límite de 64 MB descomprimidos y se admiten hasta 20.000
entradas en el ZIP. Archivos dañados, entradas cifradas o métodos de compresión
no admitidos muestran un error. El índice de lectura comprueba que el archivo
no haya cambiado entre la apertura y la solicitud de una página.

La vista de la caja decodifica solo la primera imagen, reutilizando los ajustes
de recorte y la estimación de tamaño de los PDF. La caché de portadas de manuales
de Dreamcast también funciona con CBZ y se invalida al cambiar el archivo.
El lector conserva las animaciones, zoom, arrastre, modos de hojas plegadas y
orden de lectura. Las imágenes se liberan después de dibujarlas; el lector
mantiene su caché limitada de páginas visibles. Una decodificación que termina
después de cerrar o cambiar de manual se descarta.

**Abrir manual** en el editor utiliza el lector integrado para CBZ, sin depender
de una asociación de archivos instalada en Windows. Los PDF conservan su acción
de apertura externa desde ese botón. Dentro de las cajas, ambos formatos se
abren con el lector integrado.
