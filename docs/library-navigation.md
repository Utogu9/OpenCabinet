# Vistas y categorías de la biblioteca

Debajo de **Buscar juegos…**, **Agrupar por** cambia la lista de la izquierda.
La vista inicial sigue siendo **Consolas**. **Todo** muestra todos los juegos y
el buscador se combina con el grupo seleccionado.

- **Categorías** muestra un árbol que se puede desplegar y contraer. Incluye
  Consolas, Portátiles y PC; PC contiene Steam, Epic Games y Windows (juegos
  manuales). Seleccionar una categoría incluye sus subcategorías, sin duplicar
  los juegos ni sus contadores. Las plataformas y categorías vacías se ocultan.
- **Desarrollador** y **Editor** usan los datos de cada juego. Los nombres
  separados por punto y coma se pueden consultar individualmente. Los datos
  ausentes tienen su propio grupo.
- **Fabricante** usa el fabricante de la consola, configurable en Editar
  consola. Si falta, utiliza la marca reconocida al principio de su nombre;
  los demás aparecen en Sin fabricante.
- **Fecha de lanzamiento** y **Año de lanzamiento** muestran primero los más
  recientes y dejan Sin fecha al final. También ordenan los juegos por fecha.
- **Horas de juego** y **Veces jugado** agrupan por rangos y ordenan los juegos
  por su tiempo o número de sesiones, de mayor a menor. Sin jugar aparece al
  final. Los grupos se actualizan cuando las estadísticas cruzan un rango.

**Opciones → Configurar categorías** permite crear, renombrar y eliminar categorías,
elegir su categoría superior y asignar plataformas, reglas automáticas o condiciones
por variables. Las reglas de consolas y portátiles utilizan las variables de la
consola; sus valores iniciales se deducen del nombre y pueden editarse. Las plataformas se
asocian por su identificador: cambiar su nombre no rompe la categoría.

En **Editar juego → Variables** y **Editar consola → Variables** se pueden agregar
pares nombre/valor. Los nombres usan letras minúsculas, números, punto, guion y
guion bajo, comenzando por una letra. Los valores pueden ser texto, números o
`yes`/`no`; las comparaciones también reconocen `sí`, `true` y `false`.
Los juegos muestran las variables heredadas de su consola y pueden sobrescribirlas.
Los valores automáticos o heredados sin modificar no se guardan como valores
propios, por lo que siguen los cambios futuros de la consola. Quitar un valor
lo desactiva para esa entidad. Las variables con valor `no` o `false` se ocultan;
las ausentes se consideran `no`. Los valores numéricos, incluido cero, y los textos
se conservan. Al agregar una variable aparece una lista de nombres ya utilizados
en juegos o consolas, junto a los nombres automáticos; también se puede escribir
un nombre nuevo. Las variables nuevas comienzan con el valor `yes`.

Quitar una variable heredada o automática conserva internamente una excepción
negativa cuando es necesaria para impedir que reaparezca. Esa excepción no se
muestra como variable existente. Las variables locales desactivadas que no
necesitan ocultar un valor heredado se omiten al guardar.

Las variables iniciales de consola son `portatil`, `pc` y `consola`. Si no hay
un valor explícito para `consola`, se calcula con las otras dos. Los juegos
también tienen `steam` y `epic`, inicialmente calculadas desde su origen real.
Cambiar estas variables modifica la clasificación, sin alterar los identificadores
de las tiendas, la ROM, el ejecutable ni los argumentos de lanzamiento.

Para una categoría **Favoritos portátiles**, elige **Condiciones por variables**,
**Todas las condiciones**, y agrega `Juego / favorito / Es igual a / yes` y
`Consola / portatil / Es igual a / yes`. También se pueden aceptar **Cualquiera
de las condiciones**, comparar texto, comprobar si una variable existe o usar
comparaciones numéricas. Las condiciones del juego incluyen las variables
heredadas; elegir Consola consulta exclusivamente el valor de esa consola.
Una variable ausente o desactivada cumple **Es igual a / no** y **No existe**,
pero no **Existe**. Las comparaciones de texto y numéricas requieren un valor
activo; por ejemplo, la ausencia de `puntos` no cumple **Mayor o igual / 0**.

Los cambios solo se aplican al guardar. Cancelar o Escape descartan el borrador.
Eliminar una categoría mueve sus subcategorías a la categoría superior que
tenía; conserva juegos, archivos y estadísticas. Los juegos sin asignación
siguen disponibles en Sin categoría y Todo. Una misma plataforma puede formar
parte de distintas categorías.

La configuración se guarda en `library_navigation` y los valores personalizados
en `entity_variables`, dentro de `opencabinet.db`. Las variables se guardan en la
misma transacción que los datos del juego o la consola. Se
conserva al reiniciar o trasladar la carpeta de datos. La carga se realiza junto
con la biblioteca, sin recorrer archivos de juegos ni imágenes. Se validan los
identificadores, los nombres repetidos dentro de un nivel y los ciclos entre
categorías antes de guardar.
