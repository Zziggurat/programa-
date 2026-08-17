# Overhaul visual 3D — fase 1

Qué se ha tocado del aspecto del tablero, por qué, y qué se ha dejado a propósito para
después. El criterio de toda la fase ha sido el mismo: **no cambiar colores, cambiar la
construcción del objeto**. Un aparato no deja de parecer una primitiva porque se le suba el
brillo; deja de parecerlo cuando tiene hombros, rehundidos, tabiques y piezas metidas unas
en otras.

## Cómo se ha mirado

`qa/_fotos-visual.mjs` saca once fotos desde ángulos calculados —general de frente, general
en diagonal, contactor, protección, relé/guardamotor, regleta, fusible, borne con cable,
carril y canaleta, mando de puerta, conjunto con tapa—. La cámara **no** se mueve
arrastrando el ratón: se pone con `qa.verDesde`, que es un ayudante nuevo del andamiaje de
QA. Arrastrando, cada foto costaba varios segundos y no caía dos veces en el mismo sitio;
así el juego entero sale en 90 s y el encuadre es idéntico entre pasadas, que es la única
forma de comparar un antes y un después de verdad.

`qa.bulto(id)` devuelve centro y radio de un aparato, para poder encuadrarlo sin escribir
coordenadas a mano que dejarían de valer al cambiar el ejemplo.

## Componentes

### Contactor

Era el peor y era el más importante. La armadura —el bloque móvil— se dibujaba como una
losa oscura de 12 mm **posada sobre** la nariz, más ancha que alta y con las esquinas
redondeadas. Eso no se lee como el bloque móvil de un contactor: se lee como una pantalla
pegada a una caja, y era lo primero que se veía de KM1, KM2 y KM3.

- La nariz llega ahora casi hasta el fondo declarado, y es ella la que marca el volumen.
- La armadura va **metida** en un pocillo rehundido, asomando milímetro y medio. Su cara
  vista va más **clara** que el bloque: con el rehundido en negro sobre gris oscuro lo que
  se leía era un agujero rectangular, y un plano que sale hacia la luz se ve más claro que
  el que lo rodea.
- Hombro achaflanado entre la nariz y las alas de bornes, para que no sea cubo sobre cubo.
- Nervios en los costados: de perfil, el flanco ya no es una losa lisa.
- Dos bahías de bloque auxiliar arriba, con sus pestañas. Es un detalle que solo tienen los
  contactores, así que es de lo que más ayuda a no confundirlo con nada.
- Los tabiques entre polos estaban **sobre el frontal**, donde en un contactor no hay nada
  que separar, mientras los tornillos quedaban en una explanada lisa. Ahora asoman entre
  tornillo y tornillo, que es donde de verdad aíslan.
- El portaetiquetas, blanco puro y a toda altura, se comía la cara. Es un rótulo, no la
  pieza principal.

### Modular (automático, diferencial)

- Termoplástico técnico en vez de plástico brillante: un cuadro entero de modulares
  brillantes es una fila de pastillas de jabón.
- Hombro de apoyo del destornillador, tabiques entre polos sobre las alas y juntas de polo
  cruzando el frontal **entero** (cortas, el aparato volvía a leerse como un bloque único).
- La maneta sale de un resalte, con una ranura **por polo** en vez de una banda negra de
  lado a lado que partía la cara en dos. Con estrías de agarre —que es lo que da la escala—
  y barra de acoplamiento en los multipolares: sin ella, tres manetas parecen tres aparatos.
- El reparto de la cara se pisaba a sí mismo: el rótulo y la mirilla caían casi en la misma
  ordenada, así que del rótulo solo asomaba una franja verde.

### Relé térmico

F2 y KT caían los dos en el mismo cuerpo translúcido de relé enchufable: un térmico y un
temporizador se veían idénticos. El discriminante limpio ya estaba en la ficha —un aparato
que declara rango de regulación es un térmico, porque se tara y eso se le ve por fuera— así
que no ha hecho falta tocar ningún identificador.

Modelo propio: rueda de reglaje con corona graduada e índice rojo, botones de rearme y
prueba rehundidos en su alojamiento, ventana de disparo marcada como mirilla (la simulación
ya la enrojece al saltar) y frontal embutido. En gris antracita: con el azul del relé
enchufable se quedaba de juguete.

Las marcas de la corona estaban en negro sobre el aro negro. Estaban dibujadas, pero no se
veía ni una, que para una escala es lo mismo que no tenerla.

### Temporizador

Se queda con el cuerpo de relé enchufable, que es lo que es, más un dial de tiempo con su
escala de seis marcas e índice. KT ya se distingue de un relé de maniobra a primera vista.

### Guardamotor

Plástico técnico, hombro achaflanado, frontal embutido y corona graduada de doce marcas
alrededor del mando. Sin ellas era un disco negro; con ellas se ve que es un aparato que se
acciona y que tiene posiciones.

### Portafusibles

El cajón era **macizo** y el cartucho cerámico lo atravesaba de parte a parte, asomando
cinco milímetros y medio por delante: un puro metido en un ladrillo. Ahora es un cajón hueco
de verdad —fondo, dos costados, dos topes y un marco frontal con su ventana— con el cartucho
dentro, sus dos casquillos metálicos y la uña de agarre estriada. Y su alojamiento rehundido
en el cuerpo, para que se vea como pieza desmontable.

### Regletas

- Las juntas entre módulos eran de 0,7 mm: a la distancia a la que se mira una regleta, una
  junta más fina que el píxel no separa nada. Ahora 1,4 mm.
- Pocillo del tornillo con su jaula de apriete metálica al fondo.
- Boca avellanada de entrada del conductor y ventana de numeración embutida.

### Mandos de puerta

La cara de la cabeza era **plana**, y de plana era de lo que más cantaba: un cilindro
cortado a escuadra no coge más que una mancha de luz uniforme, y un pulsador se leía como
una ficha de parchís.

Ahora lleva casquete esférico calculado a partir de la **flecha** que se quiere —dado el
radio de la cabeza y cuánto debe abombar, salen el radio de la esfera y el ángulo que hay que
cortar—. Puesto a ojo, con una esfera del radio de la cabeza, el polo se iba ocho milímetros
por delante de la profundidad declarada del aparato. La cabeza retrocede lo que abomba su
cúpula, así que el conjunto no ocupa más que antes, y la cúpula va como **hija** de la
cabeza: el pulsador se hunde 3,2 mm al accionarlo y una cúpula suelta se quedaría flotando.

Embellecedor negro entre la tuerca y la cabeza, tuerca en níquel mate —con brillo de cromo
el anillo blanco era lo primero que se veía del aparato— y, en el selector, maneta con caras
de agarre, flecha de posición y corona de tres marcas.

## Piezas comunes

### Tornillo

Es la pieza que más dice sobre la escala de un objeto, y estaba mal. El pocillo acababa justo
en la cara y la cabeza sobresalía de él, con la huella otro tanto por delante: lo que se veía
de cerca era un disco claro posado sobre un anillo oscuro con una rayita encima. A tamaño de
borna eso se lee como un **símbolo impreso**.

Ahora el pocillo es un hueco de 3 mm que muere en la cara, la cabeza queda cuatro décimas por
dentro y la huella se hunde en ella.

Y el borne de aparato usa **esa** primitiva. Antes se construía su propia cabeza aparte, así
que el tornillo de un contactor y el de una regleta no eran el mismo tornillo aunque en la
realidad lo sean.

### Punteras

Los diámetros estaban al revés: el tubo metálico salía **más gordo** que el hilo y el cuello
más gordo todavía, así que la punta engordaba en dos escalones y remataba en un tapón. En una
puntera de verdad el metal es el conductor desnudo —sin funda— y va más fino que el aislante;
el cuello es el único resalte. Ahora es además cónico, con lo que la transición
aislamiento → puntera → borne se lee de un tirón en vez de como tres cilindros a tope.

El cono mira al lado que toca en cada punta: la tangente de la curva apunta siempre en el
sentido del recorrido, así que sin invertirlo una de las dos punteras del hilo saldría con el
embudo al revés.

### Borne cableado

Era una perla gris flotando por delante del tornillo del aparato —que está modelado ahí
debajo, con su pocillo y su jaula— y tapándolo. De cerca, donde el terminal tenía que ser lo
más convincente del tablero, lo que se veía era una canica.

Ahora es un casquillo metálico bajo y ancho, del **mismo radio**, porque de ese radio depende
lo fácil que es pinchar un borne para cablear. El borne libre sigue siendo la bola naranja: no
es una pieza, es la invitación a pinchar, y desde lejos tiene que verse.

## Estructura

**Carril DIN.** El cincado no es un espejo: con la rugosidad anterior devolvía un reflejo
estrecho propio de un inoxidable pulido y se quedaba de cromo. Ahora tiene el brillo ancho y
algo sucio del zincado, que es lo que lo separa del plástico de los aparatos sin cambiarle el
color. Los taladros eran pastillas que sobresalían tres décimas por delante **y por detrás**
de la chapa; ahora son agujeros.

**Placa de montaje.** Era la superficie más grande del tablero y la que menos decía: una losa
de 3 mm con lustre metálico uniforme, o sea un plano. Ahora es chapa pintada mate con su
pliegue perimetral y los cuatro espárragos que la separan del fondo del armario. Baja de tono
a un 7035 de verdad —en gris muy claro quedaba al mismo valor que los modulares blancos y que
las tapas de canaleta— y coge grano de pintura al horno: ruido suave en el canal de
**rugosidad**, no en el color, porque en color saldría suciedad a manchas. Son 16 kB para toda
la placa.

**Canaletas.** El cuerpo y la tapa eran dos grises casi iguales con la misma rugosidad, así
que el conjunto se leía como una sola pieza de plástico con muescas. Cuerpo de PVC seco y
oscuro, tapa más clara y satinada y, sobre todo, la tapa **monta** sobre el cuerpo: sobresale
un milímetro por cada lado, que es el reborde por el que se hace palanca con el
destornillador. Ese milímetro de vuelo es lo que devuelve la línea de sombra que separa las
dos piezas sin ningún truco de iluminación. La geometría funcional del ducto —dientes,
ranuras, cruces— no se ha tocado.

## Materiales

La biblioteca `M` de `dispositivos3d.ts` tiene ahora una entrada por familia física, y la
distinción se hace por **respuesta a la luz**, no por color:

| Familia | Uso | Cómo responde |
|---|---|---|
| `metal` | tornillos, jaulas, pinzas | brillo estrecho, metálico |
| `galvanizado` | carril DIN, casquillos, tuercas | metálico de brillo ancho y algo sucio |
| `pintado` | placa de montaje | pintura mate sobre metal, con grano |
| `aluminio` | radiadores | metálico mate |
| `cobre` | bobinados | metálico cálido |
| `tecnico` | carcasas de aparato | poliamida cargada: seca y mate |
| `plastico` | frontales, manetas, botones | satinado ajustable |
| `baquelita` | pocillos, ranuras, tabiques | muy mate, sin reflejo |
| `aislamiento` | PVC de conductor | satinado suave |
| `translucido` | mirillas, tapas, relé enchufable | translúcido |

## Rendimiento

Medido con `qa/coste-arranque.mjs` sobre el mismo contenedor —sin tarjeta gráfica, dibujando
por software— contra `eb914a6`, el commit anterior a la fase:

| | antes | después |
|---|---|---|
| primer tablero interactivo | 3 162 ms | 3 001 ms |
| abrir un ejemplo | 21 604 ms | 19 034 ms |
| fotograma, mediana | 9,6 ms | 11,5 ms |
| memoria en reposo | 15 MB | 15 MB |

El fotograma sube 1,9 ms —de 104 a 87 fotogramas por segundo teóricos— dibujando **por
software**; con tarjeta gráfica esa diferencia no se mide. El resto de cifras se mueven dentro
del ruido de la máquina (las dos primeras salen incluso más bajas, que es ruido, no mérito).

El bundle pasa de 2 501,6 kB a 2 505,2 kB —3,6 kB, un 0,14 %— y todo el detalle nuevo es
geometría paramétrica, no mallas importadas. Las piezas más caras que se han añadido son los
casquetes esféricos de los mandos (unos 200 triángulos cada uno, y solo hay uno por mando) y
la corona graduada del guardamotor (doce cajas). El resto son cajas y cilindros de los que ya
había. No se ha añadido ninguna textura salvo el grano de la placa, que son 64 × 64 píxeles
en escala de grises compartidos por todas las placas del programa.

## Un fallo de prueba que NO es de esta fase

`qa/riel.mjs` estaba rojo antes de empezar: reventaba en la primera comprobación porque la
sonda de `puntoDeEstructura` no encontraba el carril. Eso se ha arreglado (ver más arriba) y
la prueba avanza, pero deja al descubierto un fallo anterior que sigue rojo: la prueba baja el
carril r1 veinte milímetros «a una zona libre», y en el primer ejemplo esa zona no está libre.

    r1        y = 80
    q1        de y = 36 a y = 125 (89 mm de alto)
    canaleta  c1 de y = 140 a y = 180

Quedan **15 mm** entre el pie del aparato más alto del carril y la canaleta de abajo, y la
prueba empuja 20. El programa rechaza el movimiento y lo devuelve a su sitio, que es lo
correcto: la prueba pide un movimiento ilegal. Comprobado que pasa exactamente igual en
`eb914a6` con la misma corrección de sonda aplicada, así que no lo ha traído esta fase. No se
toca porque es trabajo del editor, no del aspecto, y aflojar la prueba sería taparlo.

## Lo que se ha dejado a propósito

- **Los cables.** Su acabado ya estaba ajustado para que el tubo coja la raya especular que
  dice que es redondo; subirle la rugosidad la borraría. Se han mejorado sus punteras, que es
  donde estaba el problema real.
- **El borne libre naranja.** Es interfaz, no pieza: cambiarlo tocaría el flujo de cableado.
- **La iluminación.** No se ha tocado, a propósito: el criterio era que la diferencia se
  notara **sin** cambiarla.
- **SSAO y postproceso.** Fase siguiente.
- **Los rótulos flotantes.** No se han rediseñado; sí se ha comprobado que ningún componente
  nuevo los tapa ni desplaza identificadores.

## Lo que merece una fase posterior

- La cara de la armadura del contactor sigue siendo un rectángulo limpio; con oclusión
  ambiental ganaría mucho más que con más geometría.
- Las regletas convencen de cerca, pero a media distancia diez bornas siguen leyéndose como
  una fila muy regular: les falta variación de tono entre módulos.
- El interior del armario (fondo y paredes) sigue siendo chapa translúcida sin detalle.
- El grano de pintura está solo en la placa; el gabinete y las canaletas podrían compartirlo.
