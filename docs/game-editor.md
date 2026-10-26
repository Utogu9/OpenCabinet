# Editar juegos y su ejecución

El editor organiza sus campos en las secciones Detalles, Ejecución, Imágenes del juego, Manuales y Discos. Los cambios permanecen en el borrador al cambiar de sección y se aplican juntos al guardar. Las secciones se pueden recorrer con las flechas arriba/abajo, Inicio y Fin.

En **Ejecución** se muestran las rutas de los archivos asociados. Para cambiar sus asociaciones, usar Discos. El botón **Abrir ubicación de los archivos**, también disponible en el menú contextual de un juego, abre las carpetas correspondientes sin repetirlas cuando contienen varios discos. Para Steam y Epic Games abre la carpeta de instalación del juego.

El emulador se hereda de la consola por defecto. Se puede seleccionar otro de los registrados para esa misma plataforma y marcar **Usar parámetros propios para este juego** para reemplazar sus argumentos. Desmarcarlo vuelve a heredar los parámetros actuales del emulador. `%ROM%` representa el archivo elegido al jugar, también para juegos multidisco; conviene escribirlo entre comillas si se combina con otras opciones. RetroArch conserva la incorporación automática de su núcleo.

Los ejecutables de PC admiten parámetros propios sin emulador. Los juegos de Steam y Epic se inician mediante sus clientes y mantienen la configuración de esos clientes.

Las preferencias se guardan en `games.emulator_override_id` y `games.arguments_override`. Un valor nulo significa heredar. No se modifican los emuladores compartidos ni las estadísticas. Si se elimina el emulador elegido o se lo asigna a otra consola, el juego vuelve al emulador predeterminado; los parámetros propios permanecen guardados.
