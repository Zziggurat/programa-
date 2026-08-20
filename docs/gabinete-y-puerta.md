# El armario y su puerta

El proyecto dibujaba muy bien el interior de un tablero —placa, carriles, canaletas, aparatos y
cableado— y muy mal el tablero. Lo que había alrededor eran cuatro paredes translúcidas de dos
milímetros y una puerta de adorno clavada a 0,62 π que solo aparecía en Visualización y no se podía
cerrar. El conjunto se leía como una plancha con cosas encima.

Ahora hay envolvente: **fondo, laterales, techo, suelo, marco perimetral, junta, bisagras, cierre
de cuarto de vuelta y una puerta que gira**. Vive en `app/gabinete3d.ts`, separada de `escena3d`.

---

## Las tres reglas del módulo

### 1. Paramétrico, no una maqueta

Todo sale de `cajaDe(gabinete)` —ancho, alto y profundidad— y de media docena de espesores. Lo que
**no** escala es la chapa: la de un armario de dos metros es la misma de 2 mm que la de uno de
cuarenta centímetros. Un modelo que escalara entero saldría con paredes de un centímetro y se
leería como un juguete ampliado. Hay una prueba que lo fija: entre un armario de 400 × 500 × 150 y
otro de 1.200 × 2.000 × 300, la caja envolvente crece exactamente lo que crece el armario.

El número de bisagras también sale del tamaño: dos hasta un metro de alto, tres por encima.

### 2. Las piezas se solapan, nunca se tocan a tope

Dos caras que mueren en el mismo plano es la definición del z-fighting, y este proyecto acaba de
gastar dos fases quitando exactamente eso de los aparatos. Un armario es una caja de cajas: montado
«a tope», como sale de forma natural, lo habría reintroducido entero de una tacada.

Así que cada pieza se **mete** unos milímetros dentro de la siguiente, que además es como está hecho
de verdad —la chapa se pliega y se solapa, no se apoya canto contra canto—. El reparto en
profundidad, con todo relativo al canto delantero `zBoca`:

| plano | qué hay |
|---|---|
| `Z_FONDO_INTERIOR − 3` | cara exterior del fondo |
| `Z_FONDO_INTERIOR` | cara interior del fondo; la placa va delante, sobre sus espárragos |
| `zBoca − 12` | cara trasera del marco, metida dentro del cuerpo |
| `zBoca − 5` | cara delantera del marco: el asiento de la junta |
| `zBoca` | canto delantero de laterales, techo y suelo (los 2 mm que se ven) |
| `zBoca + 1` | cara interior de la puerta cerrada |
| `zBoca + 16` | cara exterior de la puerta |

Y los marcos y el suelo van de **una pieza con su hueco**, no de cuatro tiras: cuatro tiras se
solapan en las esquinas compartiendo sus caras de arriba y de abajo, que es la misma receta otra vez.

Medido sobre tres tableros (300 × 400, 600 × 600 y 600 × 700), abierto y cerrado: **cero por millón**
de moteado, con el control de cámara quieta en cero. Y el barrido de los 19 aparatos del climatizador
sigue dando cero con el armario montado alrededor.

### 3. La puerta es una entidad, no un adorno

```
envolvente
├── cuerpo            fondo, laterales, techo, suelo, marco
└── puerta.pivote     ← el eje de bisagra: girar ESTO abre y cierra
     └── puerta.hoja  piel, retorno, junta, cierre
          ├── puerta.frente     ← cara exterior (z local = fondo de la hoja)
          └── puerta.interior   ← cara interior (z local = 0)
```

Los dos grupos de montaje están **vacíos**, y ese es el objetivo. Cuando lleguen los pilotos, los
pulsadores, los selectores y los cuerpos de aparato con sus bornes, se cuelgan de ahí y ya viajan
con la puerta: no habrá que tocar `gabinete3d` para que se abran con ella.

```ts
puerta.colocar(lente,  'frente',   150, 200);   // la lente, por fuera
puerta.colocar(cuerpo, 'interior', 150, 200);   // su cuerpo, por dentro
puerta.haciaDentro(cuerpo);                     // construido mirando al frente, se le da la vuelta
```

Las dos caras usan las **mismas x, y** a propósito: una lente y el cuerpo que la lleva son el mismo
taladro, y tener que acordarse de espejar la X para el interior es la clase de detalle que se olvida
una vez y descuadra el montaje entero.

`test/puerta-gabinete.test.ts` fija el contrato antes de que haya nada colgando:

- lo montado en las dos caras comparte `x` e `y` y está separado exactamente por el fondo de la hoja;
- al abrir, dos testigos —uno en cada cara— se mueven **más de 100 mm** y su distancia no cambia ni
  una milésima: la puerta es un sólido rígido;
- el lado de las bisagras cambia el eje y el signo del giro, y las dos versiones abren hacia el frente.

---

## El suelo lleva su hueco pasacables

Por el suelo del armario entran los cables de campo, y la escena ya dibujaba los prensaestopas y los
tubos que bajan de ellos hasta el motor, los sensores y las válvulas. Con el suelo cerrado, todo eso
**atravesaba la chapa**: no se notaba mientras las paredes eran translúcidas, y en cuanto la
envolvente pasó a ser opaca quedó a la vista.

Se resuelve como en un armario de verdad: un hueco en el suelo y una **placa pasacables**
desmontable —con sus cuatro tornillos— que lo tapa, con los prensaestopas montados sobre ella.

Dónde va el hueco lo calcula `escena3d`, no la envolvente: los prensaestopas los reparte
`xEntradaCampo` a partir del ancho de la placa y del número de aparatos de campo, así que es quien
sabe dónde caen. La envolvente no sabe nada de aparatos, y no tiene por qué.

---

## Cómo se maneja

- La puerta arranca **abierta** y se conserva el estado: la escena se vuelve a montar cada vez que
  se mueve un aparato o un carril, y una puerta que se abriera sola en cada uno de esos momentos
  sería un tic.
- Botón **«Cerrar la puerta» / «Abrir la puerta»** en el panel de Vista, con una animación de 0,38 s
  con arranque y frenada suaves, montada sobre el bucle de dibujo que ya existe: ni un
  `requestAnimationFrame` nuevo, ni física para girar una chapa.
- Casilla **«Armario»** para esconderlo entero, igual que las tapas de las canaletas.
- En **Visualización** se deja abierta a propósito: ahí los paneles laterales están escondidos, así
  que el botón no se alcanza, y dejar al usuario delante de una caja cerrada que no puede abrir sería
  encerrarle fuera de su propio tablero.
- Con la puerta cerrada se **apagan los rótulos de designación**. Se dibujan sin comprobar
  profundidad —a propósito, para que se lean aunque pase un cable por delante—, y con una chapa
  delante flotaban sobre ella. No se les cambia el material: se apagan mientras la puerta tape lo
  que rotulan.

## La envolvente no se pincha

Sus mallas quedan **fuera del trazado de rayos** (`raycast` anulado). Ni pueden robar un clic que iba
para un cable, ni cuestan tiempo en cada movimiento del ratón —donde buscar el aparato bajo el
puntero ya era la etapa más cara del `pointermove`, con 1,4 ms medidos en un tablero de 52 cables—.

## Lo que no se ha tocado

Ruteo, waypoints, picking de cables, bloqueo de ejes, canaletas, snapping, energización y
conexiones. Comprobado en la misma sesión: los 20 pasos de la prueba de aceptación del editor pasan
—incluido el bloqueo de eje exacto, (94,430) → (94,430) mientras la profundidad iba de 92 a 57—, y
los cinco tableros dan picking 8/8 y la misma energización de antes, sin errores de JavaScript.
