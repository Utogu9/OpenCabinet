# Orden de grupos de juegos

En **Editar juego → Orden** se escribe un título por línea, de primero a último.
También se pueden agregar títulos desde el desplegable de la biblioteca. Por ejemplo:

```text
Gran Turismo 4
Gran Turismo 3
Gran Turismo 2
Gran Turismo
```

Al guardar, las entradas que coincidan se muestran juntas en ese orden. El bloque
ocupa el lugar donde aparecía el primero de sus juegos según el orden habitual de
la vista. Los demás juegos mantienen su orden relativo. Esto se aplica después de
filtrar por consola, categoría, búsqueda u otra agrupación: nunca añade a la vista
juegos que el filtro haya ocultado. La selección con Shift usa el orden visible.

Las coincidencias ignoran mayúsculas y espacios exteriores, y respetan los acentos.
Si hay varias entradas con el mismo título en distintas plataformas, todas reciben
la misma posición dentro del grupo y mantienen entre sí el orden normal de la vista.
Los títulos inexistentes aparecen señalados en la vista previa; se guardan para que
el orden se aplique cuando se importen juegos con esos nombres.

El orden es compartido: se puede editar la misma lista desde cualquier juego cuyo
título coincida. **Quitar orden del grupo** vacía el borrador; hay que guardar para
eliminar la regla. Cancelar conserva la configuración anterior. Un grupo admite
entre 2 y 200 títulos distintos de hasta 500 caracteres. Los solapamientos entre
grupos se rechazan para evitar reglas contradictorias.

Las reglas se guardan en `game_order_groups` dentro de la base de datos, junto con
la edición del juego en una misma transacción. No modifican títulos, plataformas,
archivos, imágenes ni estadísticas. Como se definen por título, también funcionan
con futuras importaciones; eliminar un juego no borra la regla. Renombrar un juego
puede hacer que deje de coincidir hasta actualizar la lista. En juegos agrupados
por regiones se usa el título visible de la región predeterminada.

Para respaldar estas reglas hay que conservar la base de datos. Restaurar solo las
colecciones de imágenes no restaura el orden de la biblioteca.
