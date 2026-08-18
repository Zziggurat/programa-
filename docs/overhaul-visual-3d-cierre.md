# Cierre del render 3D — fidelidad de color al energizar

Última pasada del overhaul visual. No es una fase nueva: es una auditoría con una sola pregunta
detrás, la que Diego llevaba viendo desde hacía tiempo sin que ninguna fase la arreglara.

> Un conductor gris energizado tiene que seguir viéndose GRIS. Uno marrón, MARRÓN. Energizar es un
> estado que se SUMA, no uno que sustituye la identidad cromática del conductor.

## La causa

No era la intensidad del emisivo. Estuve tres intentos calculando con el material que se construye
en `escena3d.ts` —`emissive: color × 0.55`— sin entender por qué los números no cuadraban: la
aritmética decía que un negro no podía llegar ni de lejos al amarillo que se veía en pantalla, y
sin embargo llegaba. La diferencia era de unas 75 veces.

Lo que pasaba es que **había dos sitios pintando el mismo material**:

| Quién | Qué hacía |
|---|---|
| `animacion-sim.ts` → `animarSimulacion` | modula `emissiveIntensity` cable a cable según la corriente |
| `ui-simulacion.ts` → `pintarSimulacion` | machacaba el **color** del emisivo con `0xffc83d` fijo a 0,85 |

El segundo se ejecuta después. Así que la intensidad afinada del primero acababa multiplicando un
ámbar genérico, y cualquier conductor con tensión viraba al amarillo. El comentario de
`animacion-sim.ts` ya decía «ahora el emissive es el color del PROPIO conductor» y hasta había
bajado la banda de intensidad para no quemar los claros: la intención estaba escrita, pero nunca
llegó a ejecutarse porque se sobrescribía a continuación.

Medido en el framebuffer, apagado → encendido, antes del arreglo:

| conductor | apagado | encendido | Δ tono |
|---|---|---|---|
| negro | 15,16,18 · tono 220° | 159,124,44 · tono 42° | −178° |
| gris | 114,121,128 · tono 210° | 173,161,138 · tono 39° | −171° |
| marrón | 54,34,29 · tono 12° | 144,107,45 · tono 38° | +26° |

Lo que destapó la causa no fue razonar mejor sobre el código, fue **medirlo**: la sonda
`qa.emisionCables` lee el `color`, el `emissive` y la `intensidad` reales de cada cable en
ejecución, y en un segundo enseñó `emissive=#ffc83d, intensidad 0.85` donde el código que yo estaba
leyendo prometía otra cosa.

El mismo barrido pintaba además **todas las mallas de cada aparato activo** con otro ámbar plano
(`0xffd54f` a 0,5): la carcasa del contactor se volvía amarilla, el plástico negro también, y KM1
metido parecía un objeto distinto de KM2 y KM3.

## La solución

Una sola función compartida, `emisionDeCable` en `animacion-sim.ts`, que usan los dos sitios:

- El emisivo es **el color del propio conductor**: mismo tono, misma saturación.
- Con **suelo** (luz 0,30), porque un negro casi puro multiplicado por cualquier intensidad sigue
  siendo negro y no habría forma de ver que tiene tensión.
- Con **techo** (luz 0,72), para que un claro no emita blanco y se coma su propio matiz.
- La **fuerza sube con lo claro que sea el conductor**, que es lo contrario de lo que parece. El
  primer reparto le daba más a los oscuros y, medido, dejaba el negro en luz 32 % —gris pizarra— y
  el gris en +3, que no se ve. Lo que se compara no es el material sino lo que sale por pantalla, y
  un conductor oscuro parte de casi cero: cualquier añadido lo multiplica.

Y se quitó el barrido de aparatos. No hacía falta reemplazarlo por nada: `animarSimulacion` ya
anima cada aparato pieza a pieza —armadura, palanca, mirilla, lente, LED, eje— que es lo que de
verdad comunica estado en un aparato real.

De los cables se enciende solo el tubo visible. Del cable cuelgan también el tubo grueso de agarre
(invisible) y las punteras de las puntas, y una puntera de plástico encendida no es un cable con
tensión.

## Cómo queda, medido

| conductor | apagado | energizado | Δ tono |
|---|---|---|---|
| negro | 14,16,18 · 210° | 38,43,51 · 217° | +7° |
| marrón | 107,75,62 · 17° | 138,92,75 · 16° | −1° |
| azul | 8,79,140 · 208° | 20,100,161 · 206° | −2° |
| gris | 148,153,157 · 207° | 161,166,172 · 213° | +6° |

El negro sube 11 puntos de luz: se distingue de un negro sin tensión y sigue siendo el conductor
más oscuro de la escena por un factor de cuatro respecto al gris. El PE nunca se enciende porque
**nunca está vivo**: es el conductor de protección, y eso no es una decisión de presentación sino
lo que dice la simulación.

## Lo que no se tocó

Ruteo, trayectorias, separación, radios, capas, canaletas, geometría, layout, bornes, arquitectura
de interacción, topología eléctrica, DRC, reglas de conexión, simulación, datos de aparatos,
esquema. La selección se queda en emisivo 0,03 con su marco, como se eligió en la fase 5.

Las chapas de tensión (24/220/380 V) no compiten con el estado energizado y no hubo que tocarlas:
son una textura estática, desaturada un 34 % hacia el gris, sin emisivo, y ningún pintor de la
simulación las mira. Tensión y energización siguen siendo dos conceptos distintos.

## Deudas que siguen abiertas

- **Los conductores claros dan poca señal al energizarse.** El gris sube 4–7 puntos de luz y ahí se
  queda: ya está alto en la curva del tone mapping y subirlo más lo lleva hacia el blanco, que es
  perder la identidad por el otro lado. Es un techo del pipeline, no un número mal puesto.
- **En un cable casi acromático el tono deja de significar nada.** En el ejemplo 0 el negro mide
  saturación 3 % y su «tono» salta 160° entre dos tomas: es ruido de una medida gris, no un viraje.
  Quien lea la tabla tiene que mirar la saturación antes que el tono.
- **Ningún tablero de ejemplo lleva un piloto**, así que la pareja «piloto apagado / encendido» no
  se puede fotografiar de lo que hay montado. El camino está verificado en código (la lente se
  enciende con `colorPropio` a 1,15) y la pareja equivalente que sí existe —la mirilla de una
  protección pasando de verde a rojo con la carcasa intacta— está en las capturas.
- Radio de curvatura, los 10 mm de cable fundido que quedan, las filas físicas de bornes (par/impar)
  y `qa/riel.mjs` siguen documentados y sin tocar, como se acordó.
