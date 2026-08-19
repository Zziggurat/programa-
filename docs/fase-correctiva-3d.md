# Fase correctiva 3D — parpadeo, cableado manual en 3D y geometría de curvas

Tres defectos encontrados usando el programa de verdad. Se estudiaron por separado porque tenían
causas distintas, y dos de las tres no eran la que yo daba por hecha.

---

## 1. Parpadeo de superficies al mover la cámara

### Cómo se midió

Lo primero fue dejar de discutir si «parpadea un poco». `qa.medirMoteado` mueve la cámara muy poco
entre toma y toma y cuenta los píxeles que saltan de claro a oscuro **en medio de una zona lisa**.
Ese matiz es lo que hace que la medida sirva: un píxel de borde cambia porque la geometría se ha
movido, y eso no es un artefacto.

La primera versión daba 20.000 por millón en **todas** las configuraciones, incluidas las que
deberían haberlo arreglado. El fallo era mío: con un paso de medio grado la imagen se desplaza
varios píxeles, así que lo que estaba midiendo era el movimiento. Se arregló con dos cosas:

- un paso de 0,0004 rad (0,023°), que a la distancia de trabajo es **menos de medio píxel**;
- un **control de cámara quieta** que tiene que dar exactamente cero. Da cero.

Sin ese control, cualquier número de esta sección sería una opinión con formato de tabla.

### Lo que quedó descartado, con números

| zona | tal cual | sesgo de sombra 0,22 → 3,00 | sin serigrafía |
|---|---|---|---|
| q1 (disyuntor) | 3823 | 3867 | 3823 |
| f2 (relé) | 11939 | 11931 | 12236 |
| km1 (contactor) | 2454 | 2469 | 2690 |

- **No es shadow acne.** Separar la muestra a lo largo de la normal trece veces más no mueve el
  número. Si el negro viniera del mapa de sombras, con 3 mm de sesgo no podría sobrevivir.
- **No es el atlas de microtexto.** Esconder todos los planos de serigrafía tampoco lo mueve. La
  Fase 3 no introdujo esto.
- **No es la precisión del buffer de profundidad.** `near = 25`, `far = 8000`, razón 320, con la
  cámara a 934 mm de una escena de 812 × 816 × 202 mm. Una fase anterior ya subió el `near` de 1 mm
  a 25 mm justo por este motivo y dejó escrito por qué.
- **No es el mapa de rugosidad de la pintura.** Quitarlo, dejar de repetirlo y subirle la
  anisotropía dan el mismo número.

### Lo que sí era

Dos superficies **exactamente coplanares**, en dos sitios distintos, y las dos con la misma forma
de fallo: una pieza clara y una oscura terminando en el mismo plano. En unos píxeles gana una y en
otros la otra, y cuál gana cambia al mover la cámara. Eso es exactamente «manchas negras sobre
superficies claras».

Se encontraron escondiendo las mallas del aparato de una en una y volviendo a medir, con un control
previo que comprueba que la palanca manda (esconder el aparato entero tiene que dar cero; lo da).

**1. La placa frontal, a ras de su carcasa.** `panelEmbutido` dejaba la cara del panel exactamente
en la misma `z` donde acaba la cara del cuerpo. Le pasaba a los cuatro aparatos que la usan:
disyuntor, guardamotor, relé térmico y contactor. En el relé, el cuerpo terminaba en z = 68,00 y la
placa en 67,95: **cinco centésimas de milímetro**.

**2. La ranura de la maneta, a ras de su resalte.** El collar claro que rodea la maneta terminaba en
`zNariz + 2,0` y el fondo oscuro de la ranura, también.

Los dos se arreglaron moviendo la pieza a donde de verdad está, no con `polygonOffset` global: la
placa sobresale 0,4 mm de su carcasa —lo que sobresale una placa moldeada real— y el fondo de la
ranura se hunde 0,35 mm, porque el fondo de un hueco está por detrás de la cara que lo rodea. A la
distancia de trabajo el buffer distingue unas dos milésimas de milímetro, y en el tope de
alejamiento sigue distinguiendo cuatro veces menos que ese desplazamiento.

| zona | antes | tras la placa | tras la ranura |
|---|---|---|---|
| f2 (relé) | 11939 | 0 | 0 |
| km1 (contactor) | 2454 | 0 | 0 |
| q1 (disyuntor) | 3823 | 3431 | **147** |
| **total** | **20301** | 3431 | **147** |

### Lo que queda, y por qué se deja

147 por millón es el 0,015 % de los píxeles, frente al 2 % del principio. Preguntándole al rayo qué
hay en esos píxeles, todos caen en dos sitios: donde un cable cruza por delante del disyuntor, y
donde cinco caras del propio disyuntor se apilan en veintiséis milímetros de rayo. O sea,
**siluetas y geometría fina**, no dos caras compitiendo por la misma profundidad. Eso es cómo se
comporta el antialiasing cuando la cámara se mueve medio píxel, y perseguirlo sería perseguir el
suavizado de bordes.

### Un aviso sobre la sonda `coplanares`

Busca todos los pares de caras que se solapan y están a menos de un pelo, sin renderizar nada, y en
los cinco tableros encuentra **2.066**. La inmensa mayoría **no parpadea**: una pieza pequeña
apoyada sobre una cara tiene la caja alineada y no compite con nadie. Sirve para tener sospechosos,
no culpables. Quien decide sigue siendo la medida.

---

## 2. El cableado manual era 2D

### La limitación, y dónde estaba de verdad

No estaba en la interacción: estaba en el **modelo**. `Conductor.trazado` era `{x, y}[]`, sin
profundidad. El repartidor cogía esos puntos y los ponía todos a la misma capa expuesta:

```ts
const zc = Z_EXPUESTO + capa * SEPARACION_CAPAS;
...conductor.trazado!.map((q) => ({ x: q.x, y: q.y, z: zc }))
```

De ahí salen las tres cosas que Diego no podía hacer: un cable peinado a mano no podía entrar en
una canaleta, no podía cambiar de plano a mitad de camino, y no podía separarse en profundidad de
su vecino. El motor sabía hacer las tres; el editor no sabía pedirlas.

Y encima, el arrastre proyectaba **siempre** sobre un plano paralelo a la placa. De frente eso es
lo correcto. Desde una cámara lateral ese plano se ve de canto: el rayo del ratón lo corta casi en
paralelo, así que un píxel de movimiento desplazaba el punto decenas de milímetros, y la
profundidad —lo único que se quiere tocar desde el lateral— estaba clavada por definición.

### El modelo de interacción

Una sola regla, y vale para cualquier cámara: **se arrastra sobre el plano que más de frente le
quede al ojo.**

| cámara | plano | qué se edita |
|---|---|---|
| mirando la placa | el de la placa | X/Y, la profundidad no se toca |
| lateral o cenital | uno vertical | profundidad y un eje |

Con eso la vista lateral deja de servir solo para mirar y pasa a ser la herramienta natural para
decir «este tramo va más adentro»: te pones de lado y arrastras. Sin gizmos, sin modos que
aprender, sin una segunda interfaz. Y **Mayúsculas** fuerza el plano vertical desde cualquier
vista, para cuando no se quiere mover la cámara.

El umbral es 0,55 (≈57° respecto a la placa): por encima la cámara todavía mira la placa lo
bastante de frente como para que X/Y sea preciso; por debajo el plano empieza a verse de canto.

### Meterlo dentro de la canaleta

`encajarEnCanaleta` mete el punto en el **volumen útil** —entre las dos paredes y por debajo de la
tapa, descontando el radio del conductor— y se engancha a una ranura si hay una cerca, que es por
donde entra un cable de verdad. Reutiliza el `Tramo` que ya comparten el dibujo y el router: no hay
un segundo modelo de canaletas.

Y el router deja de expulsarlo. `sueloMin` levanta los cables por encima de todo ducto que no sea
suyo —y hace bien: un conductor que cruza una canaleta por fuera pasa por encima de los dientes, no
a través— pero si el usuario dijo explícitamente que ese tramo va DENTRO, ese ducto deja de ser un
obstáculo **para ese cable**. Sin esto, el punto salía disparado al soltar el ratón.

Medido sobre el estrella-triángulo, metiendo un cable a mano en la canaleta `c1` (x=30, largo=540,
alto=60): **38 de los 82 puntos del recorrido final** caen dentro del volumen del ducto, a z entre
30 y 32. No es un truco de visibilidad: al poner la tapa el cable queda tapado porque lo tapa la
tapa.

### Compatibilidad

La `z` es **opcional**. Un punto que nunca se ha tocado en profundidad sigue sin tenerla y lo sigue
colocando el repartidor, exactamente como antes, así que los proyectos guardados se abren y se ven
igual. Hay una prueba dedicada a eso, porque un cambio de sitio silencioso en el trabajo ya
guardado sería peor que el problema que se venía a arreglar.

---

## 3. El codo pinzado

### Recorrido o malla

Lo primero era separarlas, porque son dos arreglos distintos y el ruteo está congelado. Medido
sobre casos sintéticos: los puntos del recorrido eran razonables y **la sección del tubo nunca se
estrechaba** (2,20 de 2,20 pedido en todos los casos). `TubeGeometry` no estaba estrujando nada. La
deformación nacía al redondear.

### La causa

`redondear3D` medía la longitud de los segmentos con `hypot(dx, dy)` —sin la z— y luego aplicaba
esa fracción al vector completo, profundidad incluida. Mientras todos los cables corrían por
delante del tablero no se notaba. Desde que entran y salen de las canaletas hay codos que son un
cambio **puro** de profundidad: para aquella cuenta medían cero, se saltaban el redondeo entero y
el tubo giraba noventa grados de golpe.

| caso | giro máximo antes | ahora |
|---|---|---|
| 90 grados | 18,9° | 18,9° (sin cambio) |
| segmento corto | 36,9° | 18,9° |
| cambio de profundidad | **90,0°** | 18,9° |
| entrada a canaleta | 32,5° | 17,7° |

Tres correcciones más, todas en la construcción de la geometría: los pasos del arco se reparten por
ángulo en vez de seis fijos; los puntos del arco se protegen del filtro de colinealidad (con
tolerancia de 0,15 mm, un arco de tres milímetros cabía entero dentro de ella y el codo volvía a
ser una esquina); y se colapsan los nodos separados menos de 1,5 mm antes de redondear.

Ese último umbral salió de medir, no de elegirlo. Peor par de cada tablero (holgura negativa = dos
tubos metidos uno en otro):

| | 0,5 mm | **1,5 mm** | 3,0 mm |
|---|---|---|---|
| arranque directo | −0,46 | −0,46 | +0,92 |
| estrella-triángulo | −5,10 | **−2,80** | −5,80 |
| climatizador | −2,82 | −2,82 | −3,18 |

Con 0,5 se queda corto y con 3,0 empieza a tirar nodos que sí dicen algo. De paso, el peor par de
todos los tableros **mejora** respecto a lo que había: era −3,37 mm y queda en −2,82.
