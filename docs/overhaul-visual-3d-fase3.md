# Overhaul visual 3D — fase 3: identidad industrial

La Fase 1 construyó mejores objetos. La Fase 2 hizo que la luz los revelara. Esta les pone la
**información** que llevan encima los aparatos de verdad: numeración de bornes, referencia,
calibre, rango de reglaje. Y quita de en medio los carteles flotantes que competían con ellos.

## La regla que gobierna toda la fase

**Nada de lo que se imprime está inventado.** Cada marca sale de un campo que el aparato tiene
relleno. Un simulador que enseña un calibre falso es peor que uno que no enseña ninguno, porque
quien lo lee no tiene forma de saber cuál de los dos números es de verdad.

Y resultó que el dato ya estaba: `Borne.id` **es** el identificador real —el mismo con el que el
cable dice a dónde va y con el que la simulación resuelve el circuito—. Por eso un contactor
imprime `1/L1 3/L2 5/L3 2/T1 4/T2 6/T3 A1 A2 13 14`, un térmico `95` y `96`, y la regleta
`U1 V1 W1 U2 V2 W2 PE`: es lo que el aparato declara tener.

| dato en pantalla | de dónde sale |
|---|---|
| numeración de cada borne | `Borne.id` |
| referencia (LC1D12, iC60N 3P C16, LRD14, RE22R1) | `Dispositivo.referencia` |
| calibre y curva (`C16`) | `corrienteNominal` + `curvaDisparo` |
| polos (`3P`) | `Dispositivo.polos` |
| sensibilidad (`30mA`) | `sensibilidadMA` |
| rango de reglaje (`7-10A`) | `rangoRegulacionA` |
| temporización (`6s`) | `temporizacion.segundos` |
| identificador del tablero (`-KM1`) | `designacion` |

## Un atlas, no cien texturas

Un tablero mediano tiene del orden de cien bornes. Una textura por rótulo son cien lienzos, cien
texturas y cien materiales. `app/marcas3d.ts` tiene **una** textura para todo el programa: una
rejilla donde cada texto distinto se dibuja una vez y se reutiliza —`A1` aparece en los tres
contactores del estrella-triángulo y ocupa una celda, no tres—.

Los glifos van blancos sobre transparente a propósito: el color lo pone el material, que
multiplica. Así la misma celda sirve para tinta oscura sobre carcasa clara y para tinta clara
sobre un contactor negro, sin duplicar nada. La tinta se elige por la **luminancia del cuerpo**,
no aparato por aparato, para que cualquier color nuevo —o uno que el usuario cambie desde el
editor— salga legible sin tocar código.

## Tres fallos que costaron encontrar

Los tres se localizaron midiendo, no mirando. `qa/_marcas.mjs` cuenta las marcas de la escena y
las compara con los bornes que declara cada aparato: decía «KM1: 10 bornes, 10 marcas» mientras
en pantalla no se veía ni una. Existían y estaban mal puestas.

1. **Enterradas.** Iban hacia el canto del aparato y quedaban dentro del reborde que remata el ala
   de bornes —geometría de la Fase 1—. Ahora van hacia dentro, que además es donde las lleva
   impresas un aparato real: entre el tornillo y la nariz, para que el cable no las tape.
2. **Se hacían sombra a sí mismas.** Una serigrafía no tiene espesor. A una décima de milímetro de
   la cara que rotula, con las banderas de sombra puestas, salían en gris sucio.
3. **El plano mapeaba la celda entera.** Un `A1` ocupa unos 26 píxeles de los 128 de su celda, así
   que el glifo salía a un quinto del tamaño pedido y rodeado de transparencia. Ahora las
   coordenadas de textura se recortan al rectángulo que el texto ocupa de verdad.

## Los rótulos flotantes

Un sprite conserva su tamaño en **milímetros de mundo**, así que al acercarse a un contactor su
rótulo crecía igual que el aparato: a la distancia a la que se miran los bornes, `-KM1` ocupaba
media pantalla y tapaba justo lo que se quería inspeccionar.

Ahora la escala se corrige por fotograma con la distancia —tamaño en pantalla constante, con tope
por arriba y por abajo— y de cerca se desvanece: si la cámara está encima de KM1, el usuario ya
sabe que es KM1. La chapa de tensión se va antes que el identificador, porque es información de
estado y va por detrás en la jerarquía.

No se han quitado. Siguen siendo perfectamente legibles desde la vista general, que es para lo
que sirven.

## Nivel de detalle por distancia

| distancia de cámara | qué se ve escrito |
|---|---|
| más de 900 mm | solo el identificador del tablero |
| 350 – 900 mm | además la referencia y las marcas de ajuste |
| menos de 350 mm | además la numeración de cada borne |

Se apaga con `visible` por grupos: la tarjeta ni siquiera los ve. No hay un solo elemento del DOM
implicado, ni un `document.querySelector` por fotograma.

## Rendimiento

| | fotograma (mediana, por software) |
|---|---|
| Fase 1 | 11,5 ms |
| Fase 2 | 11,9 ms |
| **Fase 3** | **12,9 ms** |

+1,0 ms sobre la Fase 2, con unas 120 marcas en el estrella-triángulo. La memoria en reposo pasa
de 16 a 18 MB, que es el atlas y las geometrías de los planos.

## Pruebas

- **627** pruebas de Node en verde (siete nuevas en `test/marcas-industriales.test.ts`).
- Las nuevas no miran píxeles: protegen la lógica. Que cada borne declarado tenga su punto y con
  **su** identificador, que la numeración de una regleta siga el orden de su definición, que el
  texto salga de `borne.id` y no de un contador, que una marca no le robe el clic a la pieza que
  rotula, que el atlas siga siendo una sola textura, y que solo lleve escala de tiempo el aparato
  que de verdad temporiza.
- Cinco tableros de la biblioteca: cero errores de JavaScript.
- Picking comprobado: agarra, selecciona, crea unión, arrastra y el cable se mueve.

Una aserción anterior se aflojó **lo justo**: ataba la llamada a `dibujarBornesReales` a su aridad
exacta y el argumento de tinta la rompía. Lo que hay que vigilar es que se le pase el aparato, no
cuántos argumentos lleva; tal como estaba, la prueba guardaba la firma en vez de la intención.

## Lo que no se ha tocado, y por qué

- **El reparto de bornes en dos filas** es por índice par/impar, así que en un contactor la fila de
  arriba mezcla `1/L1` con `4/T2` y `A1`. Eléctricamente ese no es el sitio que ocuparían en un
  aparato real —arriba la línea, abajo la carga—, pero es el anclaje del que depende el routing,
  que está congelado. Queda documentado como hallazgo, no corregido.
- **Los aparatos de campo** (motor, pulsadores de puerta, red) se construyen por otro camino y no
  llevan numeración. `qa/_marcas.mjs` los marca como incompletos a propósito: es información, no
  un fallo.
- **Numeración sobre las punteras.** Se ha dejado fuera. Cincuenta hilos con su número en cada
  punta son cien marcas más para leer una información que ya está en la lista de cables y en los
  dos bornes que une; el riesgo de convertir el mazo en una nube de cifras era mayor que la
  ganancia. La infraestructura está lista si se decide hacerlo.

## Lo que sigue faltando

- Los símbolos industriales (tierra, reset, test) siguen siendo geometría, no marcas.
- La regleta no tiene todavía tira portaetiquetas de verdad: el número va impreso sobre la carcasa.
- `qa/riel.mjs` sigue rojo como deuda anterior, diagnosticada en el informe de la Fase 1.
