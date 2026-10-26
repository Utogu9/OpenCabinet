# OpenCabinet

El nombre del producto y de la ventana es **OpenCabinet**. El paquete npm,
el paquete Cargo, el ejecutable y el identificador Tauri usan `opencabinet`;
la biblioteca Rust se llama `opencabinet_lib`. Los módulos del frontend usan
el prefijo `OpenCabinet`. No hace falta crear otro proyecto ni renombrar el
directorio del repositorio para compilarlo.

El próximo build genera `opencabinet.exe` dentro del mismo `src-tauri/target/debug`
o `release`. Los binarios antiguos no se eliminan automáticamente. Las nuevas
instalaciones y paquetes usan el nombre nuevo.

Los datos de la biblioteca siguen en `data`, junto al ejecutable, o en la ruta
elegida desde Preferencias. Las nuevas bibliotecas usan `opencabinet.db` y
la ubicación se guarda en `opencabinet.config.json`. Los nombres históricos de la
base y de la configuración se reconocen mediante `profile_compat.rs`:

- La base existente se abre con su nombre anterior, sin copiarla ni separarla
  de los archivos WAL o journal de SQLite. Los backups anteriores siguen siendo
  válidos al seleccionar una biblioteca existente o trasladar los datos.
- La configuración anterior se copia al nombre nuevo al iniciar. Si ambos
  archivos existen, prevalece el nuevo. Un archivo nuevo dañado produce un error,
  sin regresar silenciosamente a una configuración anterior.
- Se reconoce el marcador anterior de traslados interrumpidos y se respeta el
  bloqueo de instancia anterior cuando existe.

En Windows, Tauri usa normalmente el identificador de la aplicación para elegir
la carpeta del perfil WebView2. Como ahora cambia a `opencabinet`, las instalaciones
nuevas usan su perfil nuevo. Si existe un perfil histórico bajo `%LOCALAPPDATA%`,
OpenCabinet lo reutiliza explícitamente: así mantiene el almacenamiento local y
las preferencias anteriores sin mover el perfil. Las preferencias conocidas se
copian del prefijo histórico a `opencabinet.*`, sin sobrescribir valores nuevos
ni borrar los viejos.
Esto incluye los límites de caché, sus rutas y los ajustes de manuales.

El perfil del navegador no es la biblioteca portable: las ROMs, imágenes, manuales,
catálogo de metadatos y caché de portadas siguen en sus ubicaciones configuradas.
Renombrar o mover manualmente el directorio del repositorio es opcional y conviene
hacerlo con la aplicación y los procesos de desarrollo cerrados. Las rutas absolutas
personalizadas siguen señalando a sus ubicaciones originales.
