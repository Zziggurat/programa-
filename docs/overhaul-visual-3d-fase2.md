# Overhaul visual 3D — fase 2: cómo la geometría recibe la luz

La Fase 1 mejoró **qué geometría existe**. Esta mejora **cómo se percibe**. No se ha
reconstruido ningún componente: todo lo que se ve aquí ya estaba modelado y no se veía.

## Lo que dijo la medida antes de tocar nada

Se añadió `qa.histograma` —lee el framebuffer y cuenta cuánto hay pegado al negro y cuánto al
blanco, más mediana y contraste— y `qa/_luz.mjs`, que lo mide en los mismos encuadres que las
fotos. Ajustar luces a ojo sobre capturas es como igualar un sonido girando el mando sin mirar
el vúmetro: se acaba compensando una cosa con otra.

| encuadre | negros muertos | blancos muertos | mediana | contraste |
|---|---|---|---|---|
| general de frente | 0 % | 0 % | 120 | 79,5 |
| general en diagonal | 0 % | 0 % | 87 | 80,2 |
| contactor | 0 % | 0 % | 145 | 64,2 |
| regleta | 0 % | 0 % | 173 | 53,9 |
| macro de un borne | 0 % | 0 % | **196** | 56,1 |
| lateral | 0 % | 0 % | 50 | 77 |

No había recorte. El problema era otro: **196 sobre 255 de mediana en el macro**. Eso no es
«claro», es todo amontonado contra el blanco, y sobre una cara así ningún bisel de medio
milímetro puede leerse porque no queda recorrido hacia arriba para que la luz lo marque.

## Los cuatro fallos que encontró la auditoría

### 1. La luz principal era frontal

Estaba en (500, 750, 900): la componente que más pesaba era la Z, o sea que venía casi desde
detrás de la cámara. **Una luz frontal ilumina por igual el fondo de un pocillo y el borde que
lo rodea**, así que aplasta exactamente lo que la Fase 1 se dedicó a construir: biseles,
hombros, rehundidos y tabiques. Ahora domina la altura y el lado, y la componente frontal es la
menor de las tres: la luz cruza las caras en vez de mirarlas de frente.

### 2. El entorno era la fuente dominante

`RoomEnvironment` a 0,55 más un hemisférico a 0,55: dos fuentes que reparten luz desde **todas**
las direcciones a la vez. Una fuente omnidireccional no puede producir sombra ni marcar un
canto; da color y quita relieve. Con las dos mandando no quedaba una sola cara del tablero en
penumbra, y sin penumbra no hay volumen. Bajan a 0,34 y 0,30: siguen haciendo falta —son lo que
hace que un metal refleje algo en vez de un vacío negro— pero como acompañamiento.

### 3. Canaletas y cables no proyectaban sombra. Ninguna

La canaleta es la pieza más grande del tablero después de la placa, va montada a ras de ella y
no dejaba ni una marca: por eso los ductos se veían pegados encima del fondo como una calcomanía
en vez de apoyados. Y cincuenta hilos cruzando por delante sin dejar rastro es lo que hacía que
el mazo pareciera dibujado **encima** de la foto en vez de tendido por delante.

Ahora ambos proyectan y reciben. Los dientes del ducto son lo que más gana: cada uno tapa al de
al lado desde la mayoría de los ángulos, así que con sombra propia la pared deja de ser un peine
plano.

### 4. Los pocillos estaban pintados de negro

Un alojamiento de tornillo se dibujaba en 0x0e1113 —negro de tinta— porque en la Fase 1 no había
luz capaz de oscurecer un hueco de tres milímetros, así que la oscuridad había que pintarla. El
precio es que un pocillo así no se lee como una cavidad: se lee como un **agujero recortado**,
sin fondo y sin el tornillo dentro. Era justo lo que se veía al acercarse a una regleta.

Ahora el alojamiento vuelve a ser el material que de verdad es —el mismo plástico, en penumbra—
y la profundidad la pone la iluminación. La ranura de la cabeza sí sigue oscura: eso no es una
cavidad ancha, es un corte estrecho donde de verdad no entra luz.

## Sombras

- `normalBias` de 0,7 a **0,22 mm**. Separa la muestra a lo largo de la normal, así que a 0,7 se
  comía los contactos más pequeños que ese desplazamiento: el tornillo en su pocillo, el diente
  contra su pared, la pinza sobre el labio del carril.
- `bias` de −0,00006 a −0,00004.
- El tronco de sombras era **cuadrado** aunque el tablero no lo es: se cogía `max(ancho, alto)`
  para los cuatro lados, así que en un tablero de 600 × 850 la quinta parte de los píxeles del
  mapa caía sobre aire a los costados. Con los dos semiejes por separado el contacto sale más
  fino **sin costar un milisegundo más** —medido—.
- El mapa se queda en 2048. Se probó 4096: costaba **+4,8 ms** para una ganancia que el tronco
  ajustado da gratis.

## Oclusión ambiental: probada y descartada, con la medida delante

Se montó el pipeline completo (`EffectComposer` + `GTAOPass` + `OutputPass`). Dos hallazgos, y
el segundo es el que decide:

**1. El compositor rompía el color por su cuenta.** Con el pase de oclusión **quitado** —solo
`RenderPass` y `OutputPass`— la imagen salía exactamente igual de estropeada que con él: el
fondo aplastado a negro puro (**41,27 %** del lienzo por debajo de 12/255, contra 0 % sin
compositor) y toda la escena lavada. Es la firma de una conversión de espacio de color aplicada
dos veces, y arreglarla obliga a tocar cómo se pinta todo, incluidas la foto del dossier y el
alzado 2D.

**2. Y aun así no habría servido, porque la oclusión no aportaba nada medible.**

| | mediana | contraste |
|---|---|---|
| compositor **sin** GTAO | 62 | 81,5 |
| compositor **con** GTAO | 61 | 81,2 |

Eso es ruido. La razón es de escala: el radio útil aquí son unos milímetros —el pocillo de un
tornillo, la junta entre dos bornas— y a la distancia a la que se mira un tablero entero esos
milímetros ocupan una fracción de píxel, así que GTAO muestrea dentro de sí mismo y no encuentra
nada que ocluir. Subir el radio hasta que se note produce el halo oscuro alrededor de cada
aparato, que es justo el defecto que había que evitar.

Lo que la fase quería de la oclusión —que el tornillo se vea **dentro** de su pocillo— se
consiguió por otro camino y sin coste: quitando el negro pintado y bajando `normalBias`.

De la prueba queda una mejora que sí vale: las tres llamadas sueltas a `renderer.render` pasan
por un único `pintar()`. Cualquier cosa que se ponga entre la escena y el lienzo tiene que valer
para las tres, y con llamadas sueltas la foto del dossier salía por un camino distinto del de la
pantalla. El razonamiento completo queda escrito en el código para que nadie lo reintente a
ciegas.

## Resultado medido

| encuadre | mediana antes | mediana después |
|---|---|---|
| general de frente | 120 | 95 |
| general en diagonal | 87 | 62 |
| contactor | 145 | 125 |
| regleta | 173 | 143 |
| macro de un borne | 196 | **153** |
| lateral | 50 | 37 |

Negros muertos: **0,02 %** de media (máximo 0,06 % en el macro). Blancos muertos: **0 %**. Es
decir: la escena ha bajado a la zona media —donde el ojo distingue escalones— sin perder
información por ninguno de los dos extremos.

## Rendimiento

| | fotograma (mediana, por software) |
|---|---|
| A — Fase 1 | 11,5 ms |
| B — iluminación y sombras nuevas | **11,9 ms** |
| C — con compositor y GTAO | descartado |

**+0,4 ms**, dentro del ruido de la máquina. Las sombras de cable y canaleta cuestan del orden
de dos milisegundos y el tronco ajustado los devuelve. Sin tarjeta gráfica; en un equipo con GPU
la diferencia no se mide.

## Validación

- 620 tests de Node en verde.
- Cinco tableros de la biblioteca fotografiados: cero errores de JavaScript.
- Picking comprobado con `qa/_agarre-casos.mjs`: agarra, selecciona, crea unión, arrastra y el
  cable se mueve. **No** se ha vuelto a correr `agarre.mjs` completo a propósito: al descartar el
  compositor, el camino de render queda exactamente como estaba y esta fase no toca ni geometría
  ni raycast. Las banderas `castShadow`/`receiveShadow` no intervienen en la selección.
- Redimensionado comprobado a 1200 × 800 y 1600 × 1000 mientras el compositor estaba montado:
  lienzo y compositor coincidían en ambos tamaños. Al descartarlo, el asunto desaparece.

## Lo que sigue faltando

- La placa sigue siendo la superficie más plana del conjunto en la vista general: gana con las
  sombras que ahora recibe, pero de frente y en grande sigue leyéndose como un fondo.
- Los portaetiquetas blancos de los contactores son lo más brillante de la escena y tiran del ojo
  más de lo que merecen.
- La oclusión de contacto a escala de milímetro sigue sin existir. La vía razonable no es un pase
  a pantalla completa sino oclusión **horneada** en la propia geometría de las piezas repetidas
  (pocillos, juntas, dientes), que se calcularía una vez y no costaría nada por fotograma.

## Deuda anterior, no de esta fase

`qa/riel.mjs` sigue rojo. Está diagnosticado en `docs/overhaul-visual-3d.md`: la prueba baja el
carril veinte milímetros «a una zona libre» y en ese ejemplo solo hay quince entre el pie del
aparato más alto y la canaleta de abajo. El programa rechaza el movimiento, que es lo correcto.
Es comportamiento del editor y no se ha tocado.
