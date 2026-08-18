# Fase 5 — refinamiento visual y UX

## Lo que encontré, y la causa raíz del punto 1

Pediste como prioridad 1 mejorar el **routing visual** alrededor de KM1/KM2/KM3. La auditoría dice
que ese síntoma no viene de donde parece, así que me detengo y lo explico antes de tocarlo.

### El dibujo no es una capa aparte del routing

En `construirCables()` está escrito, y es un invariante deliberado:

> «Los puntos vienen YA RESUELTOS en la ruta: son los mismos con los que el repartidor comprobó
> que este cable cabía ahí y **los mismos que miden las pruebas**. No hay dos.»

Es decir: **la geometría dibujada ES la geometría validada**. Las métricas que costó varias fases
ajustar —holgura de −1,82 mm, cero fusiones, cero invasiones de plástico, capacidad de canaleta—
se miden sobre esos mismos puntos. Si el dibujo se separa de ellos para «ordenar» el cableado,
deja de estar validado, y volvería justo la clase de fallo que ese comentario existe para impedir:
una cosa medida y otra distinta pintada.

### Y lo que se ve no es amontonamiento

Medido con `qa/_amontonamiento.mjs` sobre el estrella-triángulo:

| | |
|---|---|
| recorridos paralelos | 5 173 mm en 82 pares |
| **de verdad fundidos** (misma profundidad) | **10 mm en 2 pares** |

Los 5 163 mm restantes van a profundidades distintas —Δz de 14 a 68 mm—, que es exactamente lo
que el abanico 3D consiguió en su día y lo que hace un mazo real: conductores que corren juntos,
separados en Z. La densidad que se ve alrededor de los contactores no es un defecto de trazado:
son 52 conductores en una zona pequeña, y están tan ordenados como el solver sabe dejarlos.

### Qué habría hecho falta de verdad

Casi todo lo de tu lista —salidas ordenadas de borne, entrada perpendicular, uso de canaletas,
menos cruces, agrupar compatibles, separación entre paralelos, no cruzar la cara del aparato— **es
el router**, no el dibujo: es el abanico, la asignación de carriles y el reparto por profundidad.
Eso es lo que congelaste tras una decisión binaria explícita («esta es la última iteración
estructural de routing»), y abrirlo es una fase estructural con su propio presupuesto de
validación, no un pulido.

**Decisión: no lo he tocado.** Lo único del dibujo que sí podría refinarse sin romper el
invariante es el radio de curvatura (hoy Catmull-Rom por los nodos resueltos, así que la curvatura
depende de lo juntos que estén), y no compensa el riesgo por sí solo.

## Lo que sí cambié

### Hover de aparato (no existía)

Los cables y los bornes ya respondían al puntero; los aparatos no, así que al pasar por encima de
un contactor no había forma de saber que era clicable hasta pulsarlo. Se resuelve con el mismo
lenguaje que la selección —marco de aristas, como en un CAD— y **sin tocar ni un material**: el
hover es una respuesta al puntero, no un estado del tablero.

El aparato bajo el puntero sale de `elementoBajoElPuntero`, que es la misma función que decide qué
se selecciona al pulsar: con un criterio propio, el hover podría iluminar un aparato y el clic
elegir otro. El marco lleva `raycast` anulado.

### Realce de selección: 0,03, elegido mirando

Comparadas las tres en el mismo encuadre, con capturas:

| valor | qué pasa |
|---|---|
| 0 | KM1 queda idéntico a KM2 y KM3; solo lo marca el contorno, y en escena cargada hay que buscarlo |
| **0,03** | el material se mantiene —sigue siendo el mismo plástico negro— y aun así el ojo va solo |
| 0,06 | el contactor sale visiblemente azul frente a sus vecinos: se localiza, pero deja de ser el mismo material |

### Rótulos flotantes

- Por debajo de **200 mm** se apagan, con un tramo de transición para que no desaparezcan de
  golpe: a esa distancia la cámara está mirando la fila de bornes, que es justo lo que el cartel
  tapa, y quien ha llegado ahí ya sabe qué aparato es.
- El del aparato **seleccionado** baja al 35 %: el panel lateral ya enseña su referencia, su
  tensión, su posición y sus cables. Dos sitios diciendo lo mismo, y uno encima del propio
  aparato, es competir consigo mismo.

### Un derroche que había en el camino del ratón

`pointermove` lanzaba `cableBajoElPuntero` **dos veces** por movimiento —una para el resaltado y
otra para el cursor—, y con el hover iban a ser tres trazados de rayo por movimiento sobre una
escena de cincuenta cables. Ahora cada cosa se busca una vez y el hover solo se calcula cuando no
hay ni borne ni cable debajo: en el caso común —el ratón sobre el mazo— no se traza ni un rayo de
aparato. El hover sale más barato que antes de existir.

## Estados

| | señal |
|---|---|
| normal | nada |
| hover | contorno tenue (0,5 de opacidad), sin tocar el material |
| seleccionado | contorno firme + realce 0,03 + panel lateral |
| energizado | el conductor vivo brilla en **su** color |
| hover + energizado | contorno tenue sobre conductores encendidos: ninguno tapa al otro |
| seleccionado + energizado | contorno firme, rótulo al 35 %, conductores encendidos |

Comprobados los seis con `qa/_estados.mjs`, en el mismo encuadre.

## Rendimiento — lo que la medida deja decir y lo que no

Durante la medición encontré **10 Chromium huérfanos** vivos (uno al 214 % de CPU), restos de un
barrido cortado por tiempo. Con eso corriendo, las cifras no valían nada. Limpiado y con la
máquina en reposo:

| | fotograma (mediana) |
|---|---|
| Fase 4, **medida hoy en esta máquina** | 19,5 ms |
| Fase 5 | 23,7 / 23,0 / 20,5 ms |

Dos avisos honestos:

1. **Los 12,7 ms que reporté en la Fase 4 no son comparables**: se midieron con la máquina en otro
   estado. Solo vale comparar dentro de la misma sesión, y aun así la dispersión es de ±2 ms.
2. **Nada de esta fase corre por fotograma.** `qa.medirDibujado` llama al render 30 veces seguidas
   **sin mover el ratón**, así que el hover no entra siquiera en esa medida; lo único añadido al
   bucle son dos multiplicaciones por rótulo. La diferencia que se ve entre 19,5 y ~22 está dentro
   de la deriva de la máquina, no en el código.

## Pruebas

- **627** pruebas de Node en verde.
- Cinco tableros de la biblioteca: cero errores de JavaScript.
- Picking comprobado: agarra, selecciona, crea unión, arrastra y el cable se mueve.
- Los seis estados capturados y revisados.

## Deuda visual que sigue existiendo

- **Densidad del cableado alrededor de los contactores.** Es del router, no del dibujo, y está
  congelado. Abrirlo es una fase estructural.
- **Radio de curvatura** desigual: Catmull-Rom sobre los nodos resueltos, así que la curvatura
  depende de lo juntos que estén. Único punto del dibujo refinable sin romper el invariante.
- **Conductores claros al energizarse** tiran un poco a cálido. Mejorado dos veces (emisión al
  55 %, banda 0,22–0,50) pero no eliminado del todo.
- **Reparto de bornes par/impar** y **`qa/riel.mjs`**: deudas estructurales anteriores, sin tocar.
