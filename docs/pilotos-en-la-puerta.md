# Luces piloto montadas en la puerta

Primer sistema funcional de componentes de puerta, y la base sobre la que irán después los
pulsadores, los selectores, los instrumentos y el HMI. Por eso lo que importa no es la lente: son
las decisiones de arquitectura que quedan fijadas.

---

## 1. Un piloto de puerta es un aparato normal

El proyecto ya sabía qué es un piloto: `tipo: 'piloto'`, bornes X1/X2, en la lista de los que
**consumen**, y el simulador lo mete en `activos` cuando entre sus dos bornes hay una fase y un
retorno. Todo eso funcionaba ya para los pilotos de placa.

Aquí no se ha tocado nada de eso. Un piloto de puerta es el **mismo `Dispositivo`** con la **misma
`Colocacion`**, y lo único que cambia es un campo nuevo:

```ts
montaje?: 'placa' | 'puerta';   // por defecto, la placa
```

Con `puerta`, `x` e `y` se miden desde la esquina superior izquierda de la hoja, igual que en la
placa se miden desde la suya. El simulador, el DRC, los potenciales, el esquema, el dossier y el
guardado ni se enteran. **No hay ningún estado «encendido» guardado en ninguna parte.**

Es facilísimo hacer que una luz se encienda: se le pone un `encendido = true` y ya luce. Lo que
cuesta —y lo único que sirve— es que luzca por la misma razón por la que lo haría en el tablero.

## 2. Una sola pieza que atraviesa la chapa

El componente se coloca **una vez**, con su origen en la cara exterior de la puerta:

| | dónde |
|---|---|
| aro, lente, halo, rótulo | `z ≥ 0` — se ve con la puerta cerrada |
| cuerpo pasante, tuerca, portalámparas, terminales | `z < 0` — se ve al abrirla |

No hay dos posiciones que mantener sincronizadas porque **no hay dos objetos**: hay uno, y la chapa
pasa por en medio, igual que un piloto de verdad metido en su taladro de 22 mm. Y como cuelga de la
hoja, se abre con ella sin que nadie tenga que acordarse.

Hay una prueba que lo fija: se miran la lente (cara exterior) y el terminal X2 (cara interior), se
abre la puerta, y se exige que se hayan movido **más de 100 mm** y que la distancia entre las dos
**no haya cambiado ni una milésima**.

## 3. El registro plano de aparatos

Hasta ahora todos los aparatos colgaban del mismo grupo, así que recorrer sus hijos era lo mismo
que recorrer los aparatos del tablero. Con la puerta deja de serlo: un objeto solo puede tener un
padre, y el piloto tiene que colgar de la hoja para abrirse con ella.

Así que **la jerarquía la manda la física** —cada cosa cuelga de la superficie donde está
atornillada— y quien necesita recorrer «todos los aparatos» usa `escenario.aparatos`. La animación
de la simulación y la búsqueda por id preguntan ahí, y les da igual dónde esté montado cada uno.

## 4. El color es un parámetro

Rojo, verde, ámbar, azul y blanco salen del mismo constructor; lo único que cambia es el número.
`colorSenal` es dato del **aparato** —IEC 60073 le da significado a cada color— así que vive en el
modelo y sobrevive a guardar y abrir.

Apagado no es «el mismo color sin brillo»: se baja la luminosidad a un tercio conservando el tono,
para que un rojo apagado siga siendo inconfundiblemente rojo y no parezca encendido de día. Los
aparatos de placa que no declaran color apagado se comportan exactamente como antes.

| estado | lente R | lente S | lente T |
|---|---|---|---|
| apagado | `#822926` | `#906626` | `#284e82` |
| encendido | `#d8332c` | `#efa720` | `#2f7fd8` + emisión 1,15 + halo 0,34 |

**El halo no es una luz.** Es un disco aditivo de una malla, sin sombra y sin profundidad. Una luz
por piloto costaría un fragmento por píxel y por piloto, y encima iluminaría el interior del
armario, que es justo lo que no hace un LED de 20 mA.

## 5. R / S / T en el estrella-triángulo

Tres pilotos en la puerta, uno por fase, colgados de las bornas de **entrada** de Q1 —el mismo
potencial que la acometida, así avisan aunque el general esté bajado, que es el trabajo de un piloto
de presencia— y protegidos por un **Q3 de 2 A** propio: un hilo de 1 mm² colgado de un automático de
16 A no lo protege nadie, y el DRC lo dijo en cuanto se intentó.

Medido: el peor par de conductores del tablero pasa de −2,80 a −3,00 mm de holgura. Tirándolos desde
el prensaestopas de la acometida se iba a −4,80, que es por lo que van desde la entrada de Q1.

## Validación, los diez casos

Ejecutados en el navegador, leyendo **lo que la escena dibuja** (la intensidad de emisión de cada
lente y la opacidad de su halo), no una variable de estado:

| | resultado |
|---|---|
| 1. tres pilotos R/S/T en la puerta | ✔ |
| 2. los tres apagados (sin energizar) | emisión 0 · halo 0 · lentes oscuras |
| 3. los tres encendidos | emisión 1,15 · halo 0,34 · lentes al color |
| 4. **se corta el hilo de la fase S** | **R encendido · S apagado · T encendido** |
| 5/6. puerta cerrada y abierta | ✔ — los pilotos viajan con la hoja |
| 7. vista frontal y lateral | ✔ |
| 8. guardar y recargar | 3 montajes en puerta, colores y encendido intactos |
| 9. cambio de estado eléctrico | **0 repartos del router · 0 cables reconstruidos · 0 TubeGeometry** en seis energizaciones |
| 10. z-fighting / clipping | 0 por millón, con el control de cámara quieta en 0 |

Y la selección, que es lo que hace usable una lente de 10 mm de radio:

| cámara | centro | 8 px fuera | 14 px fuera |
|---|---|---|---|
| de cerca | hs | hs | hs |
| de lejos | hs | hs | hs |
| de lado | hs | hs | ht (el de al lado, que a esa distancia ya está más cerca) |

## Un fallo que cazó el DRC

Al montar los tres pilotos, la verificación dio tres errores: *«f2 y hr se solapan en la placa»*.
Las coordenadas de la placa y las de la puerta se parecen —las dos se miden en milímetros desde una
esquina de arriba a la izquierda— pero son de sitios distintos, separados por el fondo del armario.
La regla de solapes las comparaba sin mirar dónde iba montado cada uno.

Arreglado en los dos sitios donde vivía —la revisión y el arrastre del editor— y con dos pruebas:
dos aparatos **exactamente** en las mismas coordenadas pero en superficies distintas no se estorban,
y dos en la misma sí siguen dando error. De paso, un componente de puerta se mide contra la
**puerta** (que es del tamaño del armario) y no contra la placa, que es más pequeña.

## Lo que falta, dicho

**Un conductor que llega a la puerta todavía no se dibuja.** Eléctricamente está completo —conduce,
sale en el esquema y en el dossier, y es lo que enciende estos pilotos—, pero su recorrido tiene que
salir de la placa y llegar a una pieza que gira sobre unas bisagras. En un tablero de verdad eso es
un mazo flexible que va al lado de las bisagras y deja seno para que la puerta abra; dibujarlo mal
—un cable recto tendido hasta la puerta cerrada— sería peor que no dibujarlo, porque se estiraría
por el aire en cuanto la puerta se abriera. `anclajeBorne` devuelve `undefined` para los aparatos de
puerta y el conductor simplemente no se tiende.

Tampoco hay editor visual de frontal: las posiciones se declaran en el proyecto. La arquitectura
está puesta para que lo haya —`puerta.colocar(objeto, cara, x, y)` es todo lo que hace falta— pero
el arrastre sobre la puerta es otro trabajo.
