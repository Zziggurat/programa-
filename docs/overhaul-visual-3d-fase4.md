# Overhaul visual 3D — fase 4: coherencia de producto

Última fase del overhaul. No añade geometría: corrige lo que todavía delataba un proyecto en
desarrollo. Coste medido: **12,7 ms** de fotograma contra 12,9 de la Fase 3 — dentro del ruido.

## Los tres defectos que más pesaban

### 1. Los cables energizados no encendían nada

No se ve leyendo el código de la animación, que hace lo correcto: al energizar sube la
**intensidad** del emissive de cada cable vivo según los amperios que lleva. El fallo estaba en el
otro extremo — el material del tubo nunca declaraba un **color** emissive, así que se quedaba en
negro, y una intensidad, por alta que sea, multiplica al negro y da negro.

El modo Energizar movía armaduras, palancas y mirillas, pero el cableado no se encendía. Estaba
así desde que se escribió.

Ahora se enciende **en su propio color**. Un cable marrón que al energizarse brillara en rojo o
en amarillo dejaría de ser identificable justo cuando más falta hace saber cuál es cuál. Costó
dos ajustes encontrados mirando capturas:

- la emisión es el color del conductor **rebajado al 55 %**;
- la banda de intensidad baja de 0,5–1,1 a **0,22–0,50**.

A plena potencia, un gris claro sumaba su propio valor sobre sí mismo, el mapeado de tonos lo
empujaba al hombro cálido y el hilo salía color crema. Con la banda corta, un cable oscuro sigue
dando un salto grande —parte de casi nada— y uno claro se aviva sin perder su color.

### 2. La selección tapaba justo lo que seleccionaba

Se bañaba el aparato **entero** en emisión azul a 0,4. Un contactor negro con su serigrafía, sus
tornillos y sus bornes se convertía en una mancha azul uniforme: al seleccionarlo se perdía de
vista la pieza que se acababa de elegir.

Ahora hay dos señales y ninguna tapa el objeto:

- un **marco de aristas** alrededor de su volumen, que es como marca la selección cualquier
  programa de CAD, y que dice dónde empieza y acaba el aparato sin cubrirle ni un tornillo;
- una emisión de **0,06**, que es todo lo que admite. Sobre un cuerpo casi negro no hay color base
  con el que competir, así que cualquier emisión manda: a 0,14 el aparato seguía saliendo azul
  entero.

La serigrafía queda excluida del realce: encenderla convierte los números en manchas de color
justo cuando el usuario se ha acercado a leerlos.

### 3. Colores de paleta de pantalla, no de material

El rojo, el azul y el verde de conductor estaban en tonos puros de interfaz. Al lado del marrón,
el negro y el gris —que sí eran tonos de material— cantaban: en el tablero del controlador los
hilos rojos parecían de otro programa. Un PVC rojo es un rojo profundo, no un rojo primario, y
esa es toda la diferencia entre «industrial» y «digital».

El código no cambia: cada color sigue significando lo mismo y se identifica igual de bien.

| | antes | ahora |
|---|---|---|
| rojo | `0xc62828` | `0xa8322e` |
| azul | `0x1565c0` | `0x1e5fa8` |
| verde/amarillo | `0x7cb342` | `0x74a23c` |
| borna PE | `0x3f9142` + `0xe4c437` | `0x3d8341` + `0xd6bb3c` |

El verde y el amarillo de protección siguen siendo inequívocos —para eso están normalizados— pero
la borna de tierra ya no es el objeto más llamativo del tablero.

## Jerarquía de estados

| estado | cómo se comunica |
|---|---|
| normal | nada |
| hover (cable) | emisión azul clara a 0,5 sobre el tubo |
| seleccionado | marco de aristas + emisión 0,06 + panel lateral |
| energizado | el conductor vivo brilla **en su color**, con su latido propio |

Los cuatro se capturan en el mismo encuadre con `qa/_estados.mjs`. Separados, cada estado parece
razonable y aun así pueden confundirse; puestos uno al lado de otro se ve en un segundo si la
jerarquía funciona.

## Chapa de tensión

Era de lo primero que miraba el ojo en la vista general, por delante del aparato que rotula. Se
mantiene el código de color —cada nivel el suyo— pero apagado un tercio hacia el gris: se lee al
buscarlo y no salta encima cuando no se busca.

## Cámara

`minDistance` baja de **220 a 130 mm**. El plano cercano está a 25 mm, así que no era él quien
impedía acercarse: era este tope. Con 220 mm no se podía poner la vista donde hace falta para
leer la numeración de un borne o ver un tornillo dentro de su pocillo —justo el detalle que las
tres fases anteriores se dedicaron a construir—. A 130 mm sigue habiendo cinco veces el plano
cercano de margen.

Lo demás se auditó y **no se tocó**, por estar ya bien: `antialias` activo, `devicePixelRatio`
con tope en 2, y una relación cercano/lejano de 25 a 8000 que no compromete la precisión de
profundidad.

## Validación

- **627** pruebas de Node en verde.
- Cinco tableros de la biblioteca: cero errores de JavaScript.
- Picking intacto. No se ha corrido `agarre.mjs` completo a propósito: esta fase no toca ni
  geometría ni raycast — el marco de selección lleva `raycast` anulado — y el camino de render
  sigue siendo el mismo de la Fase 2.
- Rendimiento: 12,7 ms contra 12,9 ms. Memoria en reposo 16 MB.

## Deudas que NO deben seguir persiguiéndose

- **El reparto de bornes en dos filas** (par/impar) coloca en un contactor `1/L1` junto a `4/T2` y
  `A1`. Eléctricamente no es el sitio de un aparato real, pero es el anclaje del que depende el
  routing. Es una tarea estructural independiente, no de aspecto.
- **`qa/riel.mjs`** sigue rojo: la prueba pide un movimiento de 20 mm donde solo hay 15 libres, y
  el programa lo rechaza correctamente. Es del editor.
- **Numeración de punteras.** Decidido y confirmado: no se hace. La información ya está en el
  cable, en los dos bornes y en el panel lateral; cien marcas más solo restarían limpieza.

## Lo que queda, si alguna vez se retoma

- No hay hover de **dispositivo**: solo lo tienen los cables y los bornes. Un aparato no responde
  al puntero hasta que se pulsa.
- La placa de montaje sigue siendo la superficie más plana en la vista general.
- La oclusión de contacto a escala de milímetro sigue sin existir; la vía razonable sería
  hornearla en la geometría de las piezas repetidas, no un pase a pantalla completa.
