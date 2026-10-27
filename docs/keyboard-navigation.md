# Navegación por teclado

**F1** abre la lista de atajos. También se puede consultar desde **Acerca de →
Atajos de teclado**. Se utiliza el color de foco existente; no se cambia el
contraste de la aplicación.

La biblioteca tiene un único punto de entrada con Tab. Las flechas desplazan el
foco y la selección según las filas reales del listado; Home y End van a los
extremos. Shift amplía un intervalo desde su ancla. Ctrl permite mover el foco
sin alterar la selección; Ctrl+Espacio agrega o quita el juego enfocado.
Ctrl+A selecciona todos los juegos visibles. Se conserva el juego enfocado si la
biblioteca vuelve a dibujarse, siempre que siga visible.

Con el foco en una carátula, Enter ejecuta el lanzamiento compartido (incluidos
los selectores de región y disco), F2 abre Editar y Supr utiliza la eliminación
existente, con sus confirmaciones. Mantener una tecla de acción no duplica
lanzamientos o eliminaciones. Shift+F10 o la tecla Menú abren el menú contextual.
Estos atajos no sustituyen los de los campos de texto.

En la lista lateral las flechas, Home y End cambian el foco. Enter o Espacio
activan el filtro o el botón de expandir categorías. Shift+F10 permite editar la
consola enfocada mediante su menú contextual. Los grupos contraídos no entran en
el recorrido del teclado.

Ctrl+F selecciona el buscador. Fuera de campos de texto, Ctrl+I abre el importador
y Ctrl+, abre Preferencias. F6 y Shift+F6 recorren búsqueda, lista lateral,
biblioteca y botón de jugar cuando están disponibles. F10 enfoca el menú superior;
Enter, Espacio y las flechas permiten abrirlo y recorrer las acciones habilitadas.
Escape lo cierra devolviendo el foco a su título.

Las ventanas HTML existentes reciben el foco al abrirse y limitan el recorrido
de Tab a sus controles visibles y habilitados. Al cerrarse se intenta devolver
el foco al control que las abrió. Los diálogos nativos HTML mantienen su manejo
de foco y Escape. Los accesos de la biblioteca no atraviesan ventanas abiertas.
El observador de cambios se limita a ventanas, menús y lista lateral: no vigila
las caras de las cajas 3D ni ejecuta recorridos en cada fotograma.
