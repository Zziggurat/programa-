# Fase de usabilidad del editor 3D

Cuatro problemas encontrados usando el programa de verdad. Se atacaron en el orden pedido, y en
tres de los cuatro la causa resultó no ser la que parecía.

---

## 1. Parpadeo negro/blanco al mover la cámara

### Cómo se midió

`qa.medirMoteado` mueve la cámara **medio píxel** entre toma y toma y cuenta los píxeles que saltan
de claro a oscuro *en medio de una zona lisa*. Con un control obligatorio: con la cámara quieta el
contador tiene que dar **exactamente cero**. Da cero en los diecinueve aparatos del climatizador.
Sin ese control la medida no distingue un artefacto de la imagen moviéndose, que es el error que
invalidó la primera versión de esta prueba.

### La causa: el mismo fallo cuatro veces

Cuatro piezas distintas terminaban **exactamente** en el mismo plano que la superficie sobre la que
se montan. Dos superficies de colores distintos peleándose por la misma profundidad: en unos
píxeles gana una y en otros la otra, y cuál gana cambia al mover la cámara.

| pieza | dónde estaba | dónde está |
|---|---|---|
| placa frontal (`panelEmbutido`) | cara en `z` de la carcasa | sobresale 0,4 mm |
| ranura de la maneta | cara en `zNariz + 2,0`, igual que su resalte | hundida 0,35 mm |
| pocillo del borne (`borneTornillo`) | boca en `Z_BORNE` exacto | hundida 0,35 mm |
| pocillo del tornillo (`tornillo`) | boca en `z` exacto | hundida 0,35 mm |

Las dos últimas son las que más pesaban, porque las usa **casi todo el catálogo, una vez por borne
y una vez por tornillo**: el fallo aparecía multiplicado por el número de bornes del tablero. Por
eso las regletas eran con diferencia lo que más parpadeaba.

| aparato | antes | ahora |
|---|---|---|
| x2 (bornero) | 1667 | **28** |
| x1 (bornero) | 1157 | **35** |
| x0 (bornero) | 714 | **196** |
| f2 (relé) | 643 | **66** |
| q1 (disyuntor) | 345 | **12** |
| q2 (disyuntor) | 296 | **9** |
| km1 (contactor) | 141 | **6** |

### Lo que quedó descartado, con números

- **No es shadow acne.** Subir `normalBias` de 0,22 a 3,00 mm no mueve el contador (11939 → 11931).
- **No es el microtexto de la fase 3.** Esconder todos los planos del atlas tampoco (11939 → 12236).
- **No es el mapa de rugosidad de la pintura.** Quitarlo, dejar de repetirlo y subirle la
  anisotropía dan los tres el mismo número.
- **No es la precisión Z de la cámara.** `near = 25`, `far = 8000`, razón 320, con la cámara a
  934 mm de una escena de 812 × 816 × 202 mm. A la distancia de trabajo el buffer distingue unas
  dos milésimas de milímetro, y en el tope de alejamiento sigue distinguiendo cuatro veces menos
  que los 0,35 mm que se han movido las piezas.

### Aviso sobre la sonda `coplanares`

Encuentra todos los pares de caras que se solapan y están a menos de un pelo, sin renderizar nada.
Exige que las dos caras sean de **colores distintos**: dos piezas del mismo gris peleándose no
producen moteado, gane la que gane sale el mismo píxel. Aun así devuelve más de mil pares en los
cinco tableros y la mayoría no parpadea. Sirve para tener sospechosos, no culpables.

---

## 2. El lag al mover un cable

### Medido antes

Conducir el ratón desde Playwright mide sobre todo a Playwright: 147 segundos de los que la
aplicación solo usaba treinta milisegundos. La medida buena despacha los mismos eventos **dentro
de la página**, en un bucle apretado.

```
por cada movimiento del ratón
  5.215 ms en «reconstruir cables»   ← el 99,98 % del coste
  50,3 cables reconstruidos          ← para mover UNO
  50,3 TubeGeometry creadas
  0,93 repartos completos del router
mediana por evento 5.044,7 ms · p95 6.049,1 ms
```

Todo lo demás era ruido: pantalla→mundo 0,05 ms, mover el punto 0,37 ms, handles 1,16 ms. No había
nada que micro-optimizar: había que dejar de hacer el trabajo entero en cada píxel.

### La separación

El editor manual y el router son dos problemas distintos aunque compartan geometría. Con el ratón
apretado hace falta una cosa: que el cable siga al cursor. Buscarle sitio en las canaletas, reservar
carriles, medirlo contra los otros cincuenta y uno y pasar el DRC es trabajo de cuando se suelta.

`rutaProvisional` tiende **un** cable por el peinado que el usuario tiene delante.
`construirUnCable` cambia solo su malla. Al soltar, `reconstruirCables` hace el reparto completo de
siempre: una vez.

| | antes | después |
|---|---|---|
| mediana por evento | 5.044,7 ms | **3,2 ms** |
| p95 | 6.049,1 ms | **4,4 ms** |
| cables por movimiento | 50,3 | **1** |
| repartos por movimiento | 0,93 | **0,03** |

### Había dos caminos y solo uno estaba bien

Una unión se puede coger por el tubo o por su esfera azul, y cada forma tenía su código. La del
tubo se fue quedando con lo bueno; la de la esfera seguía en dos dimensiones y reconstruyendo el
tablero entero. Y la esfera es justo por donde agarra la gente. Ahora las dos llaman a
`arrastrarUnion`.

---

## 3. Mover en profundidad

**X / Y / Z** durante el arrastre dejan el movimiento en ese eje; la misma tecla otra vez lo suelta.
Sin gizmo, sin modo que recordar, y funciona igual desde cualquier cámara. Con Z bloqueada se fuerza
el plano vertical aunque la cámara mire de frente: en el plano de la placa la profundidad no cambia
por definición, y parecería que la tecla está rota.

**El bloqueo es de verdad.** Al pulsar la tecla se apunta dónde está el punto, y los dos ejes que no
se editan vuelven a ese valor **después** del recorte al área, del alineado con los vecinos y del
encaje en la canaleta. Cualquiera de los tres podría mover una coordenada que el usuario acaba de
decir que no se toca; aplicarlo antes lo convertiría en una sugerencia.

---

## 4. Las canaletas eran un obstáculo, y son un sitio

`fueraDeLaHuella` teletransporta el punto fuera del **bloque entero** de aparatos, no de uno suelto:
acercarse a una fila de riel mandaba el punto al otro lado de la fila. Eso es la pared invisible, y
de paso hacía casi imposible meter un cable en una canaleta situada entre dos filas.

Ahora, mientras se arrastra, no se expulsa nada: el punto va donde va, el cable se pinta **rojo** si
el sitio no vale y la barra dice por qué. Al soltar se decide, y si no vale el punto vuelve al
último sitio que sí valía con su explicación. Ni pared invisible mientras se mueve, ni geometría
imposible guardada en silencio.

Quién dice si un sitio vale es `validezDelPunto`, y usa el **mismo criterio que el router**:
`invasionSolida` para los sólidos de la canaleta —fondo, zócalo, paredes, dientes, tapa— y
`canaletasQueContienen` para el hueco. No hay un segundo detector simplificado.

---

## Deudas

- **x0 (bornero) se queda en 196 por millón**, el único por encima de cien. Es la misma regleta que
  x1 y x2, con el mismo modelo, y esas bajaron a 35 y 28 con el mismo arreglo: lo que le pasa no
  viene del modelo sino de lo que tiene delante o detrás en ese sitio del tablero. Queda anotado.
- **Las capturas del cable dentro de la canaleta siguen sin ser concluyentes a la vista.** La prueba
  numérica es sólida —38 de los puntos del recorrido final caen dentro del volumen del ducto, a
  z entre 30 y 32 sobre un interior de 2 a 60— pero en la imagen el conductor se pierde entre sus
  vecinos. Es la misma deuda que quedó de la fase anterior y sigue sin cerrarse: haría falta un
  corte transversal del ducto con el conductor resaltado.
