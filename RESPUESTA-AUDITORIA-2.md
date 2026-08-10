# Respuesta a la segunda auditoría de TableroStudio

**Fecha:** 10 de agosto de 2026
**Documento contestado:** «Segunda auditoría integral de TableroStudio»
**Alcance:** los 14 puntos reverificados, los 12 hallazgos nuevos P0/P1, los 13 P2 y el P3.

---

## 1. En dos líneas

La auditoría es buena y estaba en lo cierto. Todo lo que se pudo reproducir, reprodujo — **hasta
los identificadores exactos**: los tres avisos R6 falsos salieron `P7`, `P35` y `P36`, sobre las
máquinas `UMA-1-335`, `UMA-1-334` y `UMA-1-326`. Eso no se acierta leyendo por encima.

Se han cerrado **el P0, los doce P1, los trece P2 y el P3**, con una excepción declarada
(TS2-P2-11) y una que se documenta en vez de cambiarse, con su motivo (TS2-P2-12).

La observación de fondo del informe —«varias pruebas concluyen más de lo que realmente cubren»—
es correcta, y trabajando en esto se ha vuelto a cumplir tres veces más, **conmigo**. Está contado
en la sección 5, sin adornos, porque es la parte más útil de todo este documento.

---

## 2. El método, otra vez

El mismo de la vez anterior, y por el mismo motivo: **una prueba que pasa contra el código roto no
prueba nada**. Para cada punto:

1. Reproducirlo contra el build actual, y anotar el número que sale.
2. Arreglarlo.
3. Escribir la prueba.
4. **Revertir el arreglo y volver a correr la prueba.** Si sigue en verde, la prueba no sirve y se
   tira.

El paso 4 es el que ha hecho el trabajo. Tres veces dio verde con el defecto dentro.

---

## 3. Los 14 puntos reverificados

| Punto | Veredicto de la auditoría | Estado ahora |
|---|---|---|
| P0-01 Recuperación del autosave | Parcial | **Cerrado** — ver TS2-P0-01 |
| P0-02 Capas | Cerrado | Sin cambios |
| P1-01 Texto→HTML | Parcial | **Cerrado** — ver TS2-P1-05 |
| P1-02 Validación profunda | Parcial | **Cerrado** — ver TS2-P1-01 |
| P1-03 Blanco como 0 | Cerrado, con defecto nuevo | **Cerrado** — ver TS2-P1-06 |
| P1-04 Atajos | Cerrado | Sin cambios |
| P1-05 Zoom Planta | Cerrado, con falso positivo | **Falso positivo corregido** — TS2-P2-10 |
| P1-06 Planta → tablero | Parcial | **Cerrado** — ver TS2-P1-03 y P1-04 |
| P1-08 Persistencia | **No cerrado** | **Cerrado** — ver TS2-P1-02 |
| P1-10 Duplicar/pegar | Cerrado | Sin cambios |
| P1-11 Dependencias | Cerrado para web | **Cerrado también en escritorio** — TS2-P1-12 |
| P2-05 Solapes del cajetín | Parcial | **Cerrado** — ver TS2-P1-10 |
| P2-15 Fórmulas CSV | Cerrado | Sin cambios |
| P2-16 Nombres de archivo | Cerrado | Sin cambios |

---

## 4. Hallazgo por hallazgo

### TS2-P0-01 · El autosave reparado se pisaba — **confirmado**

Reproducido exactamente como decía el informe: un cable con los dos extremos inexistentes entra,
sale con cero cables y `arreglos = ["1 cable(s) sueltos sin aparato en un extremo"]`, **no lanza**,
y el `recalcular()` de arranque lo guarda encima.

El diagnóstico del informe es el correcto y señala la raíz: se cubrió el camino que LANZA y no el
que REPARA, que es el que se usa a diario.

Lo que se hizo: `cargarInicial()` conserva el `ResultadoCarga` completo; con `arreglos.length > 0`
el guardado se congela igual que ante un archivo ilegible; se dice **qué** se quitó; se ofrece
descargar el original entero —dentro está lo que se quitó— y solo al aceptar vuelve a guardar.

`qa/recuperacion.mjs` cubría tres casos, los tres de los que lanzan. Ahora son cuatro. Y su cartel
final decía «P0-01 ARREGLADO»; ahora dice lo que demuestra: *«el guardado anterior no se pisa en
ninguno de los 4 casos»*. La observación del informe sobre ese cartel era justa.

**Verificación:** 3 comprobaciones nuevas fallan contra el `main.ts` anterior.

---

### TS2-P1-01 · El cargador dejaba pasar lo que revienta los motores — **confirmado**

Los cuatro casos del informe, medidos:

```
puentes: {}                → carga, 0 arreglos → TypeError: object is not iterable
puentesInternos: [null]    → carga, 0 arreglos → TypeError: object null is not iterable
puentes: [null]            → carga, 0 arreglos → TypeError: Cannot read properties of null
puentesInternos: "hola"    → carga, 0 arreglos → TypeError: .map is not a function
```

Se reconstruyen ahora, campo a campo: `puentes`, `puentesInternos`, `terminales`,
`rangoRegulacionA`, `rangoSonda`, `temporizacion`, `rasgosFrente`, `posicion`, `rol`, `imagen`,
`curvaDisparo`, `claseDiferencial` — y los bornes, que también iban por spread.

**Y la comprobación que impide que vuelva:** `test/cargar.test.ts` lee la interfaz `Dispositivo`
de `tipos.ts` y exige que todo campo estructurado tenga lector en `leerDispositivos`. Al
escribirla cazó **dos que se me habían pasado**: `tipo` y `clase` entraban sin validar. Un
`tipo` cualquiera dejaba un aparato sin familia —sin símbolo, sin regla de DRC, sin
comportamiento— dibujado en la placa como si estuviera bien.

Las otras dos partes del hallazgo, también:

- **La importación es atómica.** `proyecto = abierto` se hacía antes de que el recálculo
  terminase; si fallaba, el aviso decía «no se pudo abrir» mientras la pantalla enseñaba
  exactamente eso, con el anterior ya perdido. Ahora vuelve lo que había.
- **Las plantillas pasan por el mismo cargador que un archivo.** Eran un `JSON.parse` con un cast.
  Y si no se puede leer, se dice y **no se toca** el tablero que hay en pantalla.

**Verificación:** 5 pruebas de núcleo fallan contra el `cargar.ts` anterior.

---

### TS2-P1-02 · Mutaciones que no se autoguardaban — **confirmado, las cinco**

Color de cable, profundidad Z de una imagen, crear una unión, quitarla con doble clic y
arrastrarla. Las cinco cierran ahora con `marcarSucio()`.

El informe acertaba también en el diagnóstico de por qué no se veía: `qa/se-guarda-solo.mjs`
comprueba catorce datos y ninguno de esos tres.

Al escribir la prueba salieron dos cosas que valen más que el arreglo:

1. **El sitio del guion importaba.** Puesto en medio, el color y la unión sobrevivían a la
   recarga *aunque el arreglo estuviera quitado*: los arrastraba un paso posterior que sí
   guardaba. El fallo real solo se ve si no se hace nada más antes de cerrar — que es
   exactamente lo que pasa cuando uno le cambia el color a un cable y se va. Ahora ese bloque es
   lo último.
2. **El color se ponía a «verde», que no es una opción de esa lista.** Un `<select>` ignora un
   valor que no tiene, así que se comparaba «sin color» contra «sin color». Verde, y sin probar
   nada. Ahora se elige de la propia lista y se comprueba que el modelo cambió.

La unión se crea con un **doble clic de verdad** sobre el cable. La sonda solo dice dónde cae el
cable en pantalla, tomándolo del recorrido real que dibuja la escena; el manejador que corre es el
mismo que el de quien está trabajando. Esto va directamente por la crítica del informe en
TS2-P2-04, que es la misma idea.

**Y una comprobación estática**, `test/persistencia.test.ts`: todo bloque que llama a `capturar()`
tiene que guardar ahí mismo o a un salto. Escribirla llevó tres intentos, y los tres fallos están
en la sección 5 porque son instructivos.

**Verificación:** la suite falla con «antes azul · después negro» y «antes 1 · después 0» al
quitar las cinco líneas.

---

### TS2-P1-03 · El mando del PLC no llegaba al campo — **confirmado de punta a punta**

Medido antes de tocar nada, forzando `DO1` y `AO1`:

```
vivos en a1: a1::24V~, a1::24V COM
vivos en x0: 0 · en x1: 0 · en m1: 0
```

La causa que da el informe es la correcta: la simulación buscaba el común como `+24`/`+V` y este
DDC se llama `24V~` / `24V COM`, como se rotula uno de verdad.

Se hizo lo que recomienda —modelar por borne y no por rótulo—: una salida cierra contra **el común
de su familia** (`DO1`↔`DOC`, `AO3`↔`AOC`), que es el modelo real de un Excel. El `+24` de antes
queda de reserva para el LOGO! del catálogo, que sí lleva los relés comunados por dentro.

Y hacía falta una cosa más que el informe no menciona y que salió al probarlo: **el circuito de
mando no se cerraba por ninguna parte**. `DOC` es el terminal por el que entra la tensión que
conmutan los triacs, y el peine de retorno de los DO estaba atornillado a ese mismo `DOC`: ida y
vuelta en el mismo punto, así que la máquina no vería tensión entre sus dos bornas por mucho que
el controlador cerrase. Ahora `DOC` se alimenta del vivo de 24 V y el peine de los DO baja al
común de la fuente. Los `UIC`/`DIC`/`AOC` van declarados como puentes internos al común, que es lo
que son dentro del aparato.

Resultado, con las mismas tres máquinas:

```
forzando DO1:  a1::DO1 → x3::3 → m3::E     los tres vivos
ninguna otra E/S del controlador se mueve
```

**Verificación:** la prueba nueva de `test/planta.test.ts` falla contra los tres motores
anteriores.

---

### TS2-P1-04 · Tres R6 falsos en un tablero recién generado — **confirmado**

`P7`, `P35`, `P36`, exactamente los del informe. Instrumentado:

```
P7   tipo=PE   a1::GND (24 V) + g1::PE (24 V) + red::PE (220 V)
P35  tipo=L    g1::L lado=primario (24 V) + q1::2 (220 V)
P36  tipo=N    g1::N lado=primario (24 V) + q1::4 (220 V)
```

Las dos causas son de libro y las dos las señala el informe:

1. **Una fuente tiene dos tensiones.** Se colgaba `tensionNominal` del aparato a todos sus bornes,
   así que el primario de 220 se leía a 24.
2. **Un PE no tiene tensión de empleo.** Une la carcasa de un aparato de 220 con la masa de un
   controlador de 24 *porque para eso está*.

Se arregló el modelo, no la regla: `src/motores/tensiones.ts` calcula la tensión **por borne**.
Y la fuente del puente declaraba `tensionNominal: 24`, que es la de SALIDA: ahora declara 220 con
`tensionSecundariaV: 24`, que es la convención del propio catálogo.

Un DRC que avisa de lo que él mismo acaba de armar enseña a ignorar los avisos, y el día que salte
uno de verdad —una bobina de 24 alimentada a 220— ya nadie lo mira. La prioridad que le da el
informe es la acertada.

**Verificación:** R6 = 0 con 0, 1, 3 y 8 máquinas. La prueba falla contra el código anterior.

---

### TS2-P1-05 · La inyección DOM no estaba cerrada — **confirmado, cuatro rutas**

Cerradas: el buscador del catálogo (que era la del marcador `<em>`), el id de riel dentro de
`data-id="…"`, la fuente de un trozo del dossier dentro de `style`, y de paso el grupo del
catálogo, el número de hilo y los ids de borne de la lista de cables.

La fuente del dossier se comprueba **en los dos sitios**: el cargador solo deja pasar las tres que
el PDF sabe dibujar, y el editor lo vuelve a mirar al pintar. Un dato puede llegar por otro camino
—un pegado, una plantilla vieja— y la defensa no puede depender de que la otra funcione.

Dos matices, uno contra mí y otro sobre el informe:

- **Contra mí:** empecé probando con un id de BORNE, que va entre etiquetas. Ahí una comilla no
  hace nada, así que la prueba pasaba con el código roto y con el arreglado. El sitio importa: el
  fallo estaba en el atributo, no en el contenido. Queda escrito en la suite.
- **Sobre el informe:** el aviso de aparatos que no caben en la fila **no se escapa a propósito**.
  `avisar()` escribe con `textContent`; escapar ahí enseñaría `&lt;` en pantalla, que es el fallo
  contrario.

Sobre la CSP que se recomienda: hecha, y en el sitio que propone el informe —con hashes generados
al empaquetar—. Está en TS2-P1-12.

**Verificación:** 4 comprobaciones nuevas de `qa/texto-hostil.mjs` fallan contra el código anterior.

---

### TS2-P1-06 · Números inválidos anunciados como guardados — **confirmado**

Y con el agravante que señala el informe, que es el que de verdad importa: **R13 solo se ejecuta
si `icc > 0`**, así que un dedazo en la Icc apagaba la comprobación del poder de corte en
silencio, y el DRC seguía dando el visto bueno. Quien firma el tablero no tiene forma de
enterarse.

Ahora la ventana se queda abierta, el campo va con `aria-invalid`, se dice qué está mal y no se
toca el proyecto. En blanco sigue siendo «sin declarar», que es un dato legítimo.

`qa/datos-proyecto.mjs` daba por bueno que «999 °C» se volviera «sin declarar»: no estaba
comprobando el arreglo, **estaba fijando el defecto**. La observación del informe era exacta.
Reescrita.

**Una parte del criterio de aceptación no se puede cumplir, y conviene decirlo:** escribir `calor`
en el ambiente. Los cuatro campos son `type="number"` y el navegador vacía por su cuenta cualquier
cosa que no sea un número finito —`calor` y también `1e999`, comprobado— antes de que el programa
la vea. Por ese camino un texto llega siempre como campo en blanco. La rama «no es un número»
existe en el validador por si algún campo deja de ser `type="number"`, pero **no se puede
demostrar desde el navegador y no se finge que sí**. Lo que sí llega, y es lo que pasaba, es un
número fuera de rango: eso está probado con tres casos.

**Verificación:** 9 comprobaciones fallan contra el `main.ts` anterior.

---

### TS2-P1-07 · El parte de obra podía parecer guardado — **confirmado**

Escribir era un `catch {}` vacío y leer reemplazaba en silencio un parte ilegible por uno en
blanco. El informe da bien el porqué de la gravedad: es la parte del programa que se usa subido a
una azotea, donde lo apuntado no está en ningún otro sitio; y las imágenes del proyecto comparten
cupo, así que el día que se llene, se llena mientras alguien mide.

Ahora hay estado visible, el parte ilegible **no se pisa** y se puede descargar, y
`guardarLevantamiento()` devuelve si lo consiguió: vaciar las tiradas ya no confirma un borrado
que no se escribió.

---

### TS2-P1-08 · La Planta era inoperable por debajo de 900 px — **confirmado**

Había un `display: none` sobre el panel, el buscador y la cinta. Activar «Medir» ponía
`hidden = false` y no salía igual, porque esa regla pesa más; y el buscador reaparecía por otra
posterior. El informe describe bien la cascada contradiciéndose a sí misma.

Ahora no se esconde nada: los paneles son cajones que suben desde abajo y la barra se parte en dos
filas. Al probarlo salieron **tres problemas de mi propio arreglo**, los tres cazados por la suite:

1. El bloque responsive iba **antes** que las reglas base, así que perdía la cascada exactamente
   igual que el `display:none` que venía a sustituir.
2. El cajón de la cinta tapaba el lienzo: no quedaba cubierta que tocar mientras se mide.
3. Los tres cajones se apoyan en el mismo borde y se apilaban, con el de arriba comiéndose los
   toques del de abajo.

**Verificación:** `qa/planta-estrecha.mjs`, nueva, a 480×900, 360×800 y 800×1000. Comprueba que
todos los mandos caben, que Medir saca la cinta, y **que se guarda una tirada de verdad** —se
pulsa el botón y se cuenta la lista, no se mira un rectángulo—. 19 comprobaciones fallan contra el
código anterior.

Los controles táctiles para pasear **no se han hecho**. Están en la recomendación, no en el
criterio de aceptación, y no quería tocar el modelo de entrada sin poder probarlo en un táctil de
verdad.

---

### TS2-P1-09 · Los modales no bloqueaban el fondo — **confirmado**

Una ventana era un `hidden = false`. Con la guía abierta la H seguía plegando los paneles por
detrás, y en modo Pasear la W movía la cámara mientras se leía la ayuda. Ni `role="dialog"`, ni
`aria-modal`, ni foco inicial, ni trampa de tabulador, ni devolver el foco.

Se hizo lo que recomienda el informe: un gestor común que apaga el fondo con `inert`, suspende el
paseo, atrapa el Tab, cierra con Escape y devuelve el foco.

**Verificación:** 7 comprobaciones, incluida la de la cámara: con la guía abierta, W durante 1,2 s
mueve **0,00 m**.

---

### TS2-P1-10 · El cajetín SVG solapaba — **confirmado, y el mecanismo importa**

Aquí pasó algo que merece contarse. `qa/profesional` pasaba en verde en esta máquina y la
auditoría veía 8 solapes por ejemplo. **Las dos cosas eran ciertas.** Medido sobre el plano
dibujado, con la fuente de este equipo:

```
CLIENTE 0,56 mm de aire    OBRA  0,56 mm
DIBUJÓ  0,13 mm de aire    FECHA 0,56 mm
```

Trece centésimas. La `J` de DIBUJÓ baja por debajo de la línea base y se come el hueco. `system-ui`
es Segoe UI en Windows y otra cosa aquí: con una fuente daba positivo por poco y con la otra,
negativo.

**Un plano que se lee bien en la máquina del que lo dibuja y se pisa en la del que lo monta es un
plano roto**, aunque la suite esté verde. Por eso el hallazgo es correcto y por eso el arreglo no
es mover un número: las alturas salen ahora de los cuerpos de letra, con el peor caso de
ascendente y descendente y una holgura declarada. Medido después: DIBUJÓ 0,74 · resto 1,17 ·
REV. 2,17.

El ancho también, que es la otra mitad que señala el informe: se recortaba por **cantidad de
caracteres** —44 letras sobre una casilla de 140 mm— y un nombre en mayúsculas ocupa casi el doble
que en minúsculas. Ahora se mide en milímetros contra la casilla real, y cuando el texto va
apretado, `textLength` lo mete dentro sea cual sea la fuente.

Y `qa/profesional` ya no pregunta solo «¿se solapan?»: **exige 0,6 mm de aire mínimo**. Ahí estaba
el agujero — con cero solapes la suite pasaba y el defecto seguía.

---

### TS2-P1-11 · Imágenes que rompen PDF, memoria y cuota — **confirmado**

Dos partes:

- **En la entrada:** una imagen solo entra si es PNG, JPEG o WebP —los que jsPDF dibuja— y con un
  tope de tamaño, porque el historial guarda 60 copias del proyecto. Un SVG, que el selector
  acepta como `image/*`, ya no llega al PDF.
- **En la salida:** `getImageProperties()` va con red en el bloque del dossier —el del logo ya la
  tenía—, así que una imagen que no se puede dibujar se salta, se dice en su sitio y el resto del
  documento sale. Y una imagen **más alta que la página se reduce**: antes se pasaba entera a la
  siguiente conservando la misma altura, o sea que seguía desbordándose, ahora en una página en
  blanco. Ese detalle del informe era exacto.

---

### TS2-P1-12 · Electron fuera de soporte y sin hardening — **confirmado**

Electron pasa de `^33` a `^43.3.0`, con `desktop/package-lock.json` para que las tres plataformas
construyan la misma aplicación: con `npm install` y sin lockfile cada una podía resolver una
versión distinta.

Se agradece especialmente que el informe **corrija a la auditoría anterior** en lo de Node
expuesto: `contextIsolation: true` estaba bien y el sandbox lo activa Electron por su cuenta desde
la 20. Añadido lo que faltaba: `will-navigate` bloqueado, `setWindowOpenHandler` denegando (un
enlace externo va al navegador del sistema), `will-attach-webview` denegado, y
`nodeIntegration: false` / `sandbox: true` declarados aunque sean el valor por defecto.

**La CSP** va dentro del HTML autocontenido, con el SHA-256 del propio bundle calculado al
empaquetar, así que protege igual abriendo el archivo suelto que dentro de la ventana de
escritorio. Montarla enseñó dos cosas, las dos cazadas por `qa/entrega.mjs` a la primera:

- con un hash en `style-src`, el `'unsafe-inline'` de esa directiva **se ignora**. Los `style="…"`
  de los elementos van por `style-src-attr`, que es otra directiva;
- la vista previa del dossier es el PDF en un `<iframe>` con URL `blob:`; con `default-src 'none'`
  se quedaba en blanco.

---

## 5. Los P2 y el P3

| Punto | Estado |
|---|---|
| TS2-P2-01 Dos bucles WebGL | **Cerrado.** Solo dibuja la herramienta visible; contador de fotogramas en la sonda |
| TS2-P2-02 DXF con esquema obsoleto | **Cerrado.** Se monta siempre desde el proyecto actual |
| TS2-P2-03 Arrastrar a la hoja siguiente | **Cerrado.** El recorte era contra la hoja, no contra el plano |
| TS2-P2-04 Medir pierde el marcado | **Cerrado.** El mismo raycast resuelve punto y equipo |
| TS2-P2-05 `Medida.recta` | **Cerrado.** Con dos puntos coincidían, y por eso no se veía |
| TS2-P2-06 «Todas» | **Cerrado.** Ahora se llama «Todas con señales» |
| TS2-P2-07 `confirm()` nativo | **Cerrado.** Diálogo de la propia aplicación |
| TS2-P2-08 QA no portable | **Cerrado.** Ver abajo |
| TS2-P2-09 CI sin puerta | **Cerrado.** Trabajo `comprobar` del que dependen los tres de construcción |
| TS2-P2-10 Falso positivo del zoom | **Cerrado.** Ver abajo |
| TS2-P2-11 Piezas en aspa | **NO hecho.** Ver abajo |
| TS2-P2-12 El lazy-load | **Documentado, no cambiado.** Ver abajo |
| TS2-P2-13 Plantillas | **Cerrado.** Esquema, cargador, reencuadre y resultado del borrado |
| TS2-P3-01 Ids por reloj | **Cerrado.** `crypto.randomUUID()` |

**TS2-P2-08** merece una nota, porque el informe lo clasifica como P2 y en la práctica pesa más.
Las 34 suites llevaban clavada la ruta del Chromium de esta máquina, dos llamaban a `python3` por
su nombre exacto y una servía desde `/workspace/programa-`. Y `QA=1 vite build app` es sintaxis de
shell POSIX: en un `cmd` de Windows no pone la variable, así que allí se construía **sin sonda** y
las 34 fallaban a la vez. Todo eso sale ahora de `qa/lib/entorno.mjs`, y el modo va por
`--mode qa`, que es un argumento normal. No es comodidad: **el cajetín solapado se encontró
precisamente por correr la batería en Windows**. Una batería que solo se ejecuta en un sitio deja
de ver todo lo que depende del sistema.

**TS2-P2-10.** Confirmado: `seleccionar(t)` sin el segundo argumento, y `enfocar` vale `false` por
defecto. Ahora enfoca y se comprueba que la vista llega hasta la máquina. Al escribirlo me salió
«la vista mira a −53,−99 y la máquina está en 1571,475»: estaba convirtiendo las coordenadas del
plano a mano, y la escena está centrada y en metros. La sonda las da ya en coordenadas de escena.

**TS2-P2-11 — no hecho, y por qué.** Las métricas que da el informe son correctas y la crítica
también: son 129 cajas, una por recorrido, no una pieza por accesorio. Agrupar por componente
conexo es un trabajo de geometría que quiero hacer mirando el resultado en pantalla, y prefiero
dejarlo pendiente y declarado antes que entregarlo a medias. También me llevo la advertencia de
que **no deben presentarse como as-built**: son estimaciones heurísticas del DXF, y eso hay que
decirlo donde se leen los metros.

**TS2-P2-12 — documentado, no cambiado.** Tiene razón: el comentario decía que la Planta no se
paga al arrancar, y `inlineDynamicImports: true` está puesto a propósito. Pero está puesto porque
lo que se entrega es **un archivo único que se abre con doble clic en una obra sin instalar nada**,
y renunciar a eso para ganar tiempo de arranque sería cambiar la razón de ser del programa por una
métrica. Lo que sí se difiere es construir la escena, que es el trabajo caro. El comentario ahora
lo cuenta bien, que es lo que faltaba.

---

## 6. Lo que salió mal por mi parte

Tres veces escribí una prueba que pasaba **con el defecto dentro**. Las tres se descubrieron con
el paso 4 del método —revertir y volver a correr—, y las tres están escritas en el código:

1. **La comprobación de persistencia, primer intento.** Seguía la cadena de llamadas: si el
   manejador llamaba a `reconstruirCables()` y esa, cinco saltos más allá, tocaba algo que
   guardaba, se daba por bueno. En un archivo de cinco mil líneas eso conecta todo con todo.
2. **Segundo intento.** `pintarSeleccion()` son 470 líneas con manejadores anidados que sí
   guardan, y el salto pasaba por ahí. Hay que restar los cuerpos anidados: un `recalcular()`
   dentro de un `onclick` no se ejecuta al llamar a la función que lo engancha.
3. **Tercer intento, y el peor.** Había metido `senalarTrabajoSinExportar` en la lista de «esto
   guarda». No guarda: solo enciende el aviso. Y lo llama `capturar()`. O sea que **la regla se
   cumplía sola** para todo bloque que capturase.

Y dos más, del mismo tipo, ya contadas arriba: el color puesto a un valor que el `<select>` no
tiene, y el id de borne probado en el contenido en vez de en el atributo.

Lo apunto entero porque la observación central del informe —«varias pruebas concluyen más de lo
que realmente cubren»— no es un problema de la versión anterior: es un modo de fallo permanente de
este oficio, y la única defensa que he encontrado que funciona es revertir el arreglo y mirar si
la prueba se entera.

---

## 7. Sobre la arquitectura propuesta (§7 del informe)

El diagnóstico es correcto: la mutación, el historial, la persistencia, el cálculo derivado y el
render no tienen una frontera única, y de ahí salen las fugas de persistencia, la importación no
atómica, el doble render y la divergencia SVG/PDF. Es el mismo hilo detrás de cinco hallazgos
distintos, y eso no es casualidad.

No se ha introducido el `ProjectStore` transaccional. La razón, dicha sin rodeos: es un cambio que
toca todos los manejadores del editor a la vez, y este programa lo usa alguien para montar
tableros que van a una cubierta. Meter eso en la misma entrega que catorce arreglos verificados
convierte una entrega comprobable en una que hay que volver a comprobar entera.

Lo que sí se ha hecho, y va en esa dirección:

- **`ProjectCodec` único:** archivo, autosave y plantilla pasan ya por `cargarProyecto`. Falta el
  portapapeles.
- **Estado derivado sin efectos:** `tensiones.ts` es puro y lo comparten potenciales y simulación.
- **Render por herramienta:** hecho, con contador para comprobarlo.
- **Renderer seguro de UI:** los sinks conocidos, cerrados, y CSP con hashes en el entregable.
- **Modelo eléctrico por borne:** hecho para tensiones, lados y comunes, que era lo que fallaba.
- **La transacción:** en lugar del `store.transact`, hay una comprobación estática que exige que
  quien captura, guarde. Es menos elegante y no requiere reescribir nada; si algún día se hace el
  store, esa comprobación pasa a sobrar sola.

---

## 8. Estado de verificación

- **533 pruebas de núcleo** (`npm test`), 0 fallos. Nuevas para esta auditoría: `tensiones`,
  `persistencia`, `ids`, más las añadidas a `cargar`, `planta` y `arranque`.
- **35 suites de navegador**, con `planta-estrecha` nueva. Todas ejecutables en Windows y Linux
  sin apaños.
- **Puerta de CI:** typecheck, 533 pruebas, empaquetado y el archivo entregado abierto por
  `file://` antes de construir un solo instalador.
- **El archivo entregado** regenerado, con CSP, y comprobado abriéndolo sin servidor.

---

## 9. Una nota

La primera auditoría encontró cosas que importaban. Esta encontró que varias de mis respuestas
demostraban menos de lo que decían, y eso es más difícil y más útil. Lo de `qa/datos-proyecto`
fijando el defecto en vez de comprobar el arreglo es el ejemplo más claro y el que más me ha hecho
cambiar la forma de trabajar.

Dos cosas que devuelvo, con el mismo ánimo:

**El criterio de aceptación merece la misma comprobación que el hallazgo.** El caso de escribir
`calor` en un campo `type="number"` no es alcanzable por la interfaz; el navegador lo vacía antes.
Está bien pedirlo, pero conviene distinguir «esto debe rechazarse» de «esto se puede teclear».

**Y un hallazgo puede ser real aunque su reproducción no viaje.** El del cajetín es el mejor
ejemplo de esta auditoría: aquí no reproducía y en Windows sí, y no era un fallo del informe sino
la naturaleza del defecto. Decir en qué máquina y con qué fuente se midió —como hace el informe en
otros puntos— es lo que ha permitido encontrarlo en vez de descartarlo.
