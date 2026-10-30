# Releases y actualizaciones de escritorio

El repositorio previsto es `Utogu9/OpenCabinet`. La app consulta en segundo plano:

`https://github.com/Utogu9/OpenCabinet/releases/latest/download/latest.json`

**Acerca de → Buscar actualizaciones** permite repetir la consulta. Si hay una
versión más reciente, **Actualizar y reiniciar** descarga el instalador, verifica
su firma y lo ejecuta. No se instala nada automáticamente al abrir la app.
Si GitHub no está disponible o todavía no hay releases, la biblioteca sigue funcionando.

## Configuración inicial del repositorio

1. Subí el proyecto a `Utogu9/OpenCabinet` y habilitá GitHub Actions.
2. En **Settings → Secrets and variables → Actions**, creá el secret
   **`TAURI_SIGNING_PRIVATE_KEY`**, con el contenido completo del archivo local
   `.private/updater/opencabinet.key`. Nunca lo publiques en Git ni en issues.
3. La clave generada inicialmente no tiene contraseña. Si usás una clave cifrada,
   configurá también **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**.
4. Hacé un backup seguro de la clave privada: las versiones instaladas solo aceptan
   actualizaciones firmadas con su clave correspondiente. La clave pública ya está
   en `src-tauri/tauri.conf.json`; esa sí debe versionarse.

`.private/` está excluida de Git y no se copia a los paquetes. No se necesita un
token personal: el workflow usa `GITHUB_TOKEN` con permiso `contents: write`.
Las políticas del repositorio deben permitir ese permiso.

## Publicar una versión

Los commits normales y los pull requests no publican versiones. El disparador es
subir una etiqueta `v...`. Antes deben coincidir las versiones de:

- `package.json`;
- `package-lock.json`, raíz y `packages[""]`;
- `src-tauri/tauri.conf.json`;
- `src-tauri/Cargo.toml` y la entrada `opencabinet` de `src-tauri/Cargo.lock`.

Por ejemplo, después de ajustar esas versiones a `0.2.1`, probar y hacer el commit:

```sh
git push origin main
git tag v0.2.1
git push origin v0.2.1
```

Actualizá `.github/release-notes.md` con los cambios antes de crear la etiqueta;
su texto se usa en la Release y en el visor de novedades de la app.

El workflow `.github/workflows/release-windows.yml` ejecuta las pruebas, compila
Windows x64 y Linux x86_64 en trabajos separados, y firma el instalador y el AppImage.
Un único trabajo reúne los paquetes y el índice de actualización de ambas plataformas
antes de subir todos los archivos a un borrador.
**Publica automáticamente ese borrador solo después de completar las subidas**.
También puede ejecutarse manualmente desde Actions indicando una etiqueta existente.

Los tags con sufijo, como `v0.2.1-beta.1`, generan prereleases y no se ofrecen por
el canal estable. Las releases estables se marcan como `latest`. Publicá las
versiones estables en orden creciente para que ese canal siempre apunte a la más reciente.

Una ejecución fallida puede reintentarse mientras la Release siga en borrador.
Las versiones ya publicadas no se sobrescriben. Actions conserva una copia de
los paquetes durante 14 días.

## Archivos de cada Release

- `OpenCabinet_v<versión>_windows_x64_setup.exe`: instalador NSIS.
- El mismo archivo con extensión `.exe.sig`: firma de actualización.
- `OpenCabinet_v<versión>_linux_x86_64.AppImage` y su `.sig`: aplicación Linux y firma.
- `latest.json`: versión, notas, fecha, URL y firma para Windows x64 y Linux x86_64.
- `OpenCabinet_v<versión>_windows_x64_portable.zip`: ejecutable y avisos de licencia.
- `SHA256SUMS.txt`: hashes de los seis archivos de distribución anteriores.

No se incluyen bibliotecas personales, juegos, catálogos, credenciales ni imágenes.
La firma del updater es independiente de un certificado Authenticode de Windows:
SmartScreen todavía puede advertir que el editor no está verificado.

## Instalación y datos

La actualización se instala en la carpeta del ejecutable actual. Conserva `data`
y `opencabinet.config.json`, incluida la ubicación alternativa de datos.
El instalador NSIS registra la app en Windows; usar la actualización integrada
desde un ZIP portable pasa a usar ese instalador en la misma carpeta. Para seguir
siendo estrictamente portable, reemplazá manualmente los archivos con el ZIP nuevo.

No se permite actualizar mientras haya partidas, importaciones o descargas
activas, ni una mudanza de datos pendiente de reinicio. Durante la descarga e
instalación, el diálogo impide iniciar otras tareas desde la biblioteca.
Los fallos de descarga o firma permiten reintentar y no reemplazan el ejecutable.

El portable necesita Microsoft Edge WebView2 Runtime. El instalador lo prepara
si falta. La instalación integrada está habilitada en builds de distribución
Windows x64 y AppImage de Linux x86_64 con permiso de escritura; en desarrollo se
puede consultar, pero no instalar actualizaciones. Linux conserva su configuración
y biblioteca en las carpetas XDG del usuario, fuera del AppImage.

El workflow `linux-check.yml` valida las ramas y pull requests sin publicar releases.
Sus artefactos permiten probar Linux antes de crear una etiqueta. Ver [Linux](linux.md).

Para compilar localmente los paquetes firmados en PowerShell:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path .private/updater/opencabinet.key).Path
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run build
```

Si cambia el repositorio, actualizá el endpoint en la configuración antes de
publicar la primera versión. Para probar el circuito completo hacen falta dos
versiones firmadas con la misma clave y una Release accesible en GitHub; los tests
locales simulan la UI y validan el empaquetado sin publicar ni instalar nada.

Referencias: [updater de Tauri](https://v2.tauri.app/plugin/updater/),
[workflows de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[Releases con GitHub CLI](https://cli.github.com/manual/gh_release_create).
