# El usuario define la geometría

Cinco quejas sobre el editor 3D de cables, todas de usarlo de verdad. Se pidió expresamente no dar
por buenos los diagnósticos y buscar las causas. En cuatro de las cinco la causa no estaba donde
parecía, y dos de ellas eran **la misma línea de código** vista desde sitios distintos.

El orden de prioridades que se pidió, y que es el que se ha seguido cuando había que elegir:

> control del usuario > precisión > selección fácil > estabilidad > rendimiento > automatización

---

## 1. «El sistema pelea contra el usuario»

### Lo que se midió primero

`qa/_fidelidad-punto.mjs` coloca un punto en cinco sitios incómodos a propósito y compara **tres**
cosas: lo que se pidió, lo que se **guardó** y por dónde pasa el cable **dibujado**.

| | guardado | dibujado |
|---|---|---|
| antes | hasta 11,2 mm | **hasta 154,9 mm** |
| ahora | hasta 11,2 mm, y las cinco veces anunciadas en la barra | hasta 21,0 mm, con un radio de curvatura de 22,0 mm |
| ahora, con las ayudas desactivadas (Alt) | **0,0 mm en los cinco** | |

Ese *154,9 mm* es la queja entera: uno coloca un punto y el cable aparece en otro sitio.

### La causa no era el router

Lo primero que se sospecha es el repartidor automático, y algo hacía: a un peinado sin `z` le
elegía capa por su cuenta. Eso se cerró con una regla clara —**un peinado con profundidad en todos
sus puntos se dibuja literal**, sin capas alternativas, sin buscar sitio en los ductos y sin el
suelo que levanta los cables por encima de las canaletas ajenas—. Pero el desvío seguía en 154,9 mm.

La causa real estaba en `tenderCable`, en la limpieza de «idas y vueltas inmediatas». Esa limpieza
existe por un buen motivo: encadenando tramos calculados por separado salen vértices donde el
recorrido avanza dos milímetros y retrocede, y ahí no hay radio que redondear. El problema es que
decidía **solo por el ángulo**, y con eso un temblor de dos milímetros y un rodeo de medio metro
son la misma cosa: «un pliegue de 170°».

Un punto colocado encima de un aparato —el cable sube 536 mm a buscarlo y vuelve a bajar 153—
entraba por esa puerta y **desaparecía del recorrido**. No había forma de que se quedara ahí.

Ahora se mide **cuánto sobresale** el vértice: si quitarlo desvía el camino menos de 3 mm es ruido;
si desvía más, es un rodeo, y un rodeo puede ser exactamente lo que alguien quiso.

### Lo demás que corregía en silencio, y ya no

| dónde | qué hacía | qué hace |
|---|---|---|
| `moverWaypoint` | sacaba el punto de encima del **bloque entero** de aparatos | avisa en rojo y no lo toca |
| al soltar | devolvía el punto al último sitio válido | lo deja donde se soltó y explica el problema |
| al mover un aparato | apartaba los puntos de cable que quedaban debajo | cuenta cuántos y avisa |
| cable contra cable | — | nunca hubo reposicionamiento aquí, y con la regla literal el router tampoco recoloca un peinado hecho a mano |

Lo único que se sigue imponiendo es el área de cableado, porque fuera de la placa y de la línea de
prensaestopas no hay tablero. Y quedan dos **ayudas**, que mueven poco, se dicen en la barra de
estado mientras pasan y se sueltan con **Alt**: alinear con el punto vecino (14 mm) y encajar en el
volumen libre de una canaleta.

---

## 2. Los puntos aparecían separados del cable

Los tiradores se dibujaban a una profundidad **fija** de 55 mm. Los cables corren a 66, a 95, o
metidos en una canaleta a 30. De frente la perspectiva no delata la diferencia; en cuanto la cámara
se mueve, la bolita se separa justo lo que dice la geometría.

Medido con `qa/_tirador-pegado.mjs`, que compara las dos reglas **en la misma pasada y desde la
misma cámara**, sobre un peinado con un punto al aire (z 76) y otro dentro de una canaleta (z 30):

| cámara | antes (z fija 55) | ahora (sobre el recorrido) |
|---|---|---|
| de frente | 8,1 px | 0,0 px |
| tres cuartos | 15,4 px | 0,0 px |
| lateral izquierdo | 18,1 px | 0,0 px |
| lateral derecho | 14,1 px | 0,0 px |
| cenital | 6,3 px | 0,0 px |
| muy de lado y cerca | 39,7 px | 0,0 px |

La misma causa explicaba el segundo síntoma: **crear una unión** proyectaba el clic sobre un plano
horizontal a 52 mm y buscaba el tramo más cercano *en planta*. Con la cámara inclinada esa
proyección cae donde el plano corta el rayo, que no es donde está el cable; y en planta dos tramos
que se cruzan están a distancia cero, así que la unión entraba en el tramo equivocado y el cable
daba un tirón. Ahora la unión nace en el punto 3D del recorrido que hay bajo el puntero, con su
profundidad, y entra en el sitio que le toca del peinado por su posición **a lo largo** del cable.

---

## 3. «Hago clic exactamente sobre el cable y no lo encuentra»

El agarre era un tubo invisible de radio fijo **en milímetros** alrededor del cable. Nueve
milímetros a treinta centímetros de la cámara son decenas de píxeles; los mismos nueve milímetros
al fondo del tablero, o vistos de canto, son uno o dos. La zona sensible se encogía justo cuando
más falta hacía. Y dependía de que el rayo del ratón cortara una malla, así que una canaleta por
delante lo dejaba inservible.

Ahora se proyecta el **recorrido real** del cable a la pantalla y se mide la distancia del puntero
a esa polilínea **en píxeles**: 12 px, iguales de cerca y de lejos.

`qa/_acierto-clic.mjs` apunta al eje de cada uno de los 52 conductores, en cinco puntos de su
recorrido, redondea a píxeles enteros y pregunta qué encuentra el editor ahí. En la misma pasada le
pregunta lo mismo al método anterior.

| cámara | encontraba antes | encuentra ahora | tapado por otro | no encuentra nada |
|---|---|---|---|---|
| de frente, encuadre normal | 52,7 % | 81,5 % | 18,5 % | 0,0 % |
| de frente pero lejos | 51,2 % | 79,2 % | 19,6 % | 0,0 % |
| tres cuartos | 45,8 % | 81,9 % | 18,1 % | 0,0 % |
| lateral, la placa de canto | 26,5 % | 63,8 % | 36,2 % | 0,0 % |
| cenital | 34,2 % | 74,2 % | 25,8 % | 0,0 % |
| **en total (1300 clics)** | **42,1 %** | **76,2 %** | 23,6 % | **0,0 %** |

Las dos últimas columnas son las que cierran la queja. En **cero** casos el editor se queda sin
encontrar nada, que es literalmente el fallo del que se partía. Cuando no sale el cable al que se
apuntaba, sale otro que está **delante** en ese píxel: es lo que se está viendo ahí y de quien es
el clic. Las tres columnas de la derecha suman 99,8 %; el 0,2 % que falta son empates de menos de
un milímetro de profundidad entre dos cables que se tocan.

Con la tolerancia en píxeles, el tubo de agarre invisible sobra: son 52 `TubeGeometry` menos que
construir y subir a la tarjeta en cada reconstrucción de la escena.

Los tiradores llevan el mismo trato: se siguen dibujando pequeños —no se toca el aspecto— pero su
zona sensible es de 16 px mire desde donde mire la cámara.

---

## 4. Rendimiento

Medido en el estrella-triángulo, 52 conductores, **en la misma ejecución**.

Arrastrando una unión:

```
30 movimientos · mediana 2,1 ms · p95 5,1 ms
1 cable reconstruido por movimiento · 0,03 repartos del router por movimiento
```

Paseando el ratón por encima sin apretar, que es lo que pasa el resto del tiempo (`qa/_perfil-hover`):

```
buscar el CABLE bajo el puntero (nuevo, en píxeles)   0,365 ms por movimiento
buscar el APARATO bajo el puntero (el rayo de antes)  1,402 ms por movimiento
total: mediana 0,6 ms · p95 7,7 ms
```

El método nuevo cuesta la cuarta parte que el trazado de rayo que ya había. El cuello de botella
del *hover* es el otro, y queda apuntado como lo que es: medido, no supuesto.

---

## Lo que no se ha tocado

El **router automático** sigue igual: los cables que nadie ha editado se reparten exactamente como
antes, con toda su validación. La regla literal solo se aplica a un peinado cuyos puntos tienen
todos profundidad, y eso solo pasa cuando el usuario ha tocado ese cable.

Holgura del peor par de cada maqueta, antes y después de la corrección del pliegue:

| maqueta | antes | ahora |
|---|---|---|
| arranque directo | −0,46 mm | −0,46 mm |
| estrella-triángulo | −2,80 mm | −2,80 mm |
| PLC 24 V | +0,50 mm | +0,50 mm |
| climatizador (UMA) | −2,82 mm | **−2,00 mm** |
