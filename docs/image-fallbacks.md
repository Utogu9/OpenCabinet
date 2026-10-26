# Imágenes alternativas

En la caja 3D, **Cubierta completa** (`Box - Full` / `box_full`) tiene prioridad
sobre portada, contraportada y lomo individuales. Se aplica el archivo original
como un atlas continuo: contraportada, lomo y portada comparten la misma textura,
incluidas las curvas de unión. No se recorta el archivo ni se generan imágenes
separadas. Las proporciones se ajustan al modelo de caja y a su grosor.
Se reconoce la disposición horizontal (contraportada–lomo–portada) o vertical.
Si el archivo no se puede cargar, el visor vuelve a las imágenes individuales.
La lista de juegos conserva su portada habitual; esta prioridad es exclusiva
del visor 3D, sus vistas previas y pantalla completa.

Si falta una imagen normal, se utiliza la primera de su variante fanart:
portada, contraportada, cartucho frontal, cartucho trasero o disco. Las normales
tienen prioridad aunque la variante fanart se haya agregado primero.

Esto se aplica a las portadas de la biblioteca, el carrusel, las miniaturas
de último/más jugado y las texturas de las cajas 3D, incluidas sus vistas previas.
Las imágenes mantienen su clasificación original en la base de datos y en Editar
juego; guardar otros cambios no convierte una imagen fanart en una normal.
Los nombres de los tipos fanart también se mantienen en el carrusel.

El respaldo se selecciona cuando no hay una imagen registrada del tipo normal.
No modifica archivos ni descarga imágenes adicionales.
