# Respuesta a la auditoría de TableroStudio

**Para:** quien firmó `AUDITORIACODEX20260808.md`
**De:** Claude (Opus 5), trabajando con Diego sobre `zziggurat/programa-`, rama `main`
**Estado:** los 14 hallazgos, cerrados y verificados

---

## 1. En dos líneas

La auditoría acertó en casi todo. De 14 hallazgos, **los 14 se confirmaron reproduciéndolos**, y
tres resultaron más graves de lo descrito. Ninguno se dio por bueno sin verlo fallar primero.

Pero la auditoría también **se quedó corta en cuatro sitios** y **erró el diagnóstico en dos**, y
eso está detallado abajo, porque es la parte de la que se aprende algo. Además aparecieron cuatro
fallos que no estaban en el informe, dos de ellos introducidos por mis propios arreglos y cazados
por las pruebas.

---

## 2. El método, porque condiciona la lectura de todo lo demás

Regla única: **una prueba que pasa contra el código viejo no demuestra nada.**

Para cada hallazgo:

1. Reproducirlo primero, con datos reales de la obra (no inventados para la ocasión).
2. Escribir la prueba y **verla fallar** contra el código anterior.
3. Arreglar.
4. Verla pasar, y volver a ejecutar la anterior para confirmar que el fallo era el que se creía.

Esto cambió el resultado tres veces: en **P1-10** descubrí que mi primera prueba pasaba también sin
el arreglo (no reproducía nada); en **P2-05** descarté el hallazgo por error y tuve que rectificar;
y en **P1-08** la medición previa cambió por completo qué había que hacer.

Cuando una prueba no conseguía reproducir el fallo descrito, **no se ajustó la prueba hasta que
pasara**: se investigó hasta entender por qué, y en dos casos la conclusión fue que el alcance
descrito en la auditoría era mayor que el real. Eso también está abajo.

---

## 3. Hallazgo por hallazgo

### P0-01 · Un autoguardado ilegible se pisaba sin avisar — **confirmado**

`cargarInicial()` era un `try { … } catch { return proyectoNuevo(); }`. Daba igual el motivo
—almacén bloqueado, JSON a medias, o un proyecto guardado con una versión más nueva—: siempre se
abría un tablero vacío y el primer `recalcular()` escribía encima.

Comprobado: un autosave de versión 999 llamado «MI TABLERO IMPORTANTE» quedaba convertido en
«Tablero nuevo» al recargar, sin copia de ninguna clase.

Ahora se distingue el motivo (acceso / JSON / esquema / versión), el guardado queda **congelado**
mientras haya algo ilegible, y se ofrece descargar el original o descartarlo explícitamente.

`qa/recuperacion.mjs` · commit `7efb693`

### P0-02 · Capas: el puente quedaba debajo de la Planta 3D — **confirmado, y mayor**

La auditoría señalaba el puente. Al mirarlo resultó que **no era un z-index suelto sino una escala
de capas que no existía**: `#mundo` estaba en 70, por encima de todos los modales (46), del diálogo
bloqueante (50) **y del toast (60)**. O sea que un aviso de «no se pudo guardar» tampoco se habría
visto.

Se introdujo una escala documentada —herramienta 40, ventana 60, diálogo 70, aviso 80— y
`qa/capas.mjs` comprueba lo único que importa: que el clic llegue.

`qa/capas.mjs` · commit `468dde9`

### P1-01 · Texto del usuario convertido en HTML — **confirmado, y quedaba un sitio**

Se escaparon los puntos de inyección y se amplió `escaparHtml` a `"` y `'` (dentro de un atributo,
una comilla no rompe el texto: lo cierra).

`qa/texto-hostil.mjs` encontró después **un sitio que seguía abierto** y que no estaba en el
informe: el listado de rutas de cable (`#lista-cables`), donde un marcado hostil metía seis
`<img src=x onerror=…>`. Es exactamente para lo que sirve una prueba con texto hostil de verdad.

`qa/texto-hostil.mjs` · commit `fb7f67c`

### P1-02 · El archivo importado no se validaba en profundidad — **confirmado**

El cargador comprobaba bien el primer nivel pero lo de dentro pasaba con un `as`. Medido, cargando
y ejecutando los motores:

| entrada | consecuencia |
|---|---|
| `bornes: ["1", 2, null]` | `TypeError: Cannot read properties of null (reading 'id')` — la aplicación se cae entera al primer recálculo |
| `canaleta.ancho: null` | el ruteo devuelve longitudes `NaN`, sin avisar |

La regla aplicada es la misma siempre —lo que no es número no entra— pero **la consecuencia se
eligió según lo que significa el dato**, que es donde estaba el criterio:

- **Rieles y canaletas se completan** con una medida razonable. Un riel sin largo se pone del ancho
  de la placa: así se ve y se arrastra, en vez de desaparecer sin explicación.
- **Las colocaciones se descartan y se cuentan.** Una colocación dice dónde va montado un aparato
  real; ponerla «más o menos» sería dibujar un tablero que no existe. El aparato queda sin colocar
  y el DRC lo canta, que es justo lo que hay que arreglar a mano.
- **Los datos eléctricos se quedan sin declarar.** Un `corrienteNominal: "diez amperios"` no rompe
  el dibujo, pero el DRC lo compara con la sección del cable y comparar con un texto sale siempre
  falso: el aviso de «cable insuficiente» no aparece y el tablero se monta con un hilo que no
  aguanta. Sin declarar, el programa ya sabe decirlo.
- **El trazado de un cable se limpia punto a punto.** Una coordenada no numérica sale `NaN` en la
  geometría del tubo, y en Three.js eso no es un cable torcido: es un cable que **desaparece** de
  la pantalla mientras sigue contando en la lista de conductores y en el dossier.
- **Una placa de 10⁹ mm ya no se abre.** Manda la cámara al infinito y deja la pantalla en negro.

**Aquí apareció un agujero que la auditoría no vio:** el arreglo de P1-03 validaba los recuadros
de la ventana «Datos del proyecto», pero **un archivo podía traer `iccPresuntaKA: "mucha"` por
detrás**. Ese número decide si las protecciones aguantan un cortocircuito. Se cerró en el mismo
trabajo, junto con `proyecto.datos`, que alimenta el cajetín del plano y podía imprimir un
`[object Object]` en un documento que se firma.

13 pruebas en `test/cargar.test.ts`. Contra el cargador anterior fallan 11.
Commits `e635a98` y `6a4e331`

### P1-03 · Un campo en blanco se declaraba como 0 — **confirmado, y peor de lo que parecía**

Yo mismo dije al principio que «no rompe nada». **Me equivoqué y lo rectifiqué**: un campo de
temperatura ambiente en blanco daba **7,6 °C interiores en vez de 42,6** en el balance térmico. El
veredicto salía tranquilizador sin motivo, que es peor que un error visible.

`qa/datos-proyecto.mjs` · commit `83323b8`

### P1-04 · Los atajos actuaban sobre el tablero oculto — **confirmado**

Comprobado en el navegador: con la **Planta 3D** abierta —que ocupa la pantalla entera— `Ctrl+Z`
deshacía un cambio del tablero sin que se notara nada, y `Supr` abría un «¿Eliminar -Q1 y sus
cables?» sobre el plano de la cubierta, preguntando por un aparato que no se estaba mirando. Con la
ventana de **Inicio** delante, igual. Y corrigiendo el **texto del dossier** —bloques
`contenteditable`, o sea `<div>` y no `<input>`— `Supr` para borrar una letra abría esa misma
pregunta.

De paso salió un fallo que no estaba en el informe: **el diálogo de confirmación no se podía cerrar
con Escape**, porque sus teclas cuelgan de él mismo y no enfocaba nada al abrirse.

`qa/atajos-a-ciegas.mjs` · commit `16e0520`

### P1-05 · Zoom de la Planta 3D — **confirmado, mucho peor; y una parte del hallazgo era incorrecta**

Medido, empezando a 468 m del centro de una planta de 690 × 293 m:

| rueda hacia atrás | distancia de la cámara |
|---|---|
| 45 muescas | **4 783 329 m** |
| seguir girando | **48 919 424 134 m** |

El plano de fondo está en 2 208 m, así que mucho antes de eso la cubierta deja de dibujarse: **la
pantalla se queda negra sin decir nada**. Ahora `minDistance` = 5 m, `maxDistance` = lado × 1,6 y
`zoomToCursor`, que acerca a donde apunta el ratón en vez de al centro.

**Donde la auditoría se equivocó:** pedía añadir un botón de reencuadre. **Ya existía.** «🏙️ Vista
general» reencuadra cada vez que se pulsa, también estando ya en esa vista — comprobado: de 1 104 m
vuelve a 468. Lo que faltaba era que lo dijera, así que se documentó en su ayuda emergente y en la
guía en vez de añadir un botón redundante.

`qa/planta-zoom.mjs` · commit `62b51c7`

### P1-06 · El tablero armado desde la Planta no se energizaba — **confirmado**

Reproducido de punta a punta: se armaba un tablero con tres UMAs, se simulaba, y `red` y `q1`
recibían tensión pero **el PLC, los cuatro borneros y las tres máquinas quedaban muertos**.

La causa es de las que enseñan algo: la simulación deducía el secundario de una fuente **por el
nombre del borne**, buscando los ids `+V`/`S1` y `-V`/`S2`. Los aparatos del catálogo se llaman
así, pero el puente desde la Planta crea la fuente con `+24` y `0V` —que es como vienen rotuladas
las fuentes de 24 V CC de verdad—, de modo que su secundario sencillamente no existía. Ninguna
prueba lo veía porque todos los ejemplos usan aparatos del catálogo.

**Un id es un rótulo, no una declaración eléctrica.** Ahora el borne puede declarar su `lado`
—primario, secundario+ o secundario−— y la simulación lo usa; solo si nadie lo declara recurre al
id, para no romper los proyectos ya guardados.

Commit `88fd471`

### P1-08 · `commitProyecto()` — **confirmado en el síntoma, no en el remedio**

La auditoría lo planteaba en general y proponía un refactor: un `commitProyecto()` por el que
pasara todo cambio. Antes de mover la arquitectura justo debajo de lo que guarda el trabajo de
alguien, había que saber **si eso pasa de verdad y dónde**.

`qa/se-guarda-solo.mjs` no mira el código: hace un rato de trabajo corriente —sacar aparatos,
ponerle nombre y cliente al tablero, agrandar la placa, añadir un riel, corregir la ficha de un
aparato, tender un cable a clics, poner la empresa que firma el dossier— y luego **recarga la
página** y comprueba dato a dato qué sobrevivió.

De catorce cosas, trece sobrevivían. La que no: **todo lo del editor del dossier**. La empresa que
firma, el color, el papel, los apartados y su orden se perdían al recargar.

El motivo: `marcarSucio()` solo ponía la bandera y repintaba el indicador — no guardaba. El panel
del esquema no lo notaba porque después llama a `actualizarTodo()`, que sí guarda; el del dossier
no llama a nadie más. **Y lo peor era cómo se veía:** el indicador quedaba en «sin exportar», que
es el mismo aspecto que tiene un proyecto bien guardado pendiente de descargar. Uno cerraba la
pestaña convencido de que estaba a salvo.

Se arregló la causa concreta —`marcarSucio()` guarda; `capturar()` usa una variante que solo
señala, porque corre *antes* del cambio— en vez de hacer el refactor general. El hallazgo era
correcto; el remedio propuesto era desproporcionado para un solo punto de fuga.

`qa/se-guarda-solo.mjs` · commit `fe148d2`

### P1-10 · Duplicar y pegar dejaban aparatos fantasma — **confirmado, con alcance menor del descrito**

Dos fallos distintos, los dos por tocar el proyecto antes de saber si el aparato cabía:

- **Duplicar** metía la copia en `proyecto.dispositivos` y hacía `capturar()` **antes** de buscarle
  sitio. Sin hueco, hacía `return` dejándola dentro: invisible en la placa, pero contada en la
  lista de materiales, en el DRC y en el archivo guardado. Un aparato que el cliente paga y que
  nadie monta.
- **Pegar** comprobaba el hueco del primero y pegaba todos con el mismo desfase. El que caía sobre
  un aparato ya montado, con su fila llena, se quedaba con `xLibreCercano(...) ?? col.x`:
  exactamente encima del otro, tapado por él, mientras el aviso decía «2 aparatos pegados».

**Precisión sobre el alcance:** la primera versión de mi prueba pasaba también sin el arreglo. Al
investigar por qué apareció el dato que la auditoría no menciona: **`buscarHueco` solo se rinde si
el gabinete no tiene ningún riel**; con un riel, por lleno que esté, siempre contesta poniendo el
aparato al final. O sea que el fantasma de *duplicar* exige un tablero con aparatos y **cero
rieles** — estado alcanzable (quitar un riel no borra los aparatos que tenía encima) pero mucho
más estrecho de lo que sugiere el informe. El de *pegar* sí es fácil de alcanzar.

La prueba monta las dos situaciones y **comprueba primero que el montaje es el que hace falta**,
para no dar un OK que no valdría. Contra el código anterior: 4 fallos.

`qa/sin-fantasmas.mjs` · commit `0f69aff`

### P1-11 · Dependencias con avisos — **confirmado, con la exposición real muy por debajo de la etiqueta**

`npm audit` daba 7 avisos, uno **crítico**. Mirado uno por uno en vez de por el color:

- De la docena de avisos de jsPDF, **la mayoría son de AcroForm, `addJS` y el módulo `html()`** —
  inyección de JavaScript en el PDF—. **Ese código no se ejecuta nunca aquí**: el dossier y el
  esquema se dibujan solo con primitivas vectoriales, `addImage` y autoTable. Los que sí podrían
  tocar son el ReDoS y las caídas por dimensiones raras de BMP/GIF, que entran por `addImage`; las
  imágenes las pone el propio usuario.
- vite, esbuild, postcss y nanoid son herramientas de construcción y **no viajan en el archivo que
  se entrega**. Verificado buscándolos dentro de `dist-final/TableroStudio.html`: cero.

Se actualizó igual (jsPDF 2.5.2 → 4.2.1, autoTable 3 → 5, vite 5 → 7) porque el arreglo salía
barato y hay cinco suites que generan el PDF y **lo leen por dentro**. Ninguna línea de `pdf.ts`,
`esquema-pdf.ts` ni `exportaciones.ts` tuvo que cambiar. Quedan 2 avisos, los dos fuera del
entregable.

Commit `4a12f75`

### P2-05 · Solapes en el cajetín — **confirmado, después de haberlo descartado por error**

**Aquí me equivoqué y conviene decirlo con claridad.** En la primera revisión di este punto por no
reproducible. Lo había probado con textos cortos.

Con los nombres que se escriben en esta obra salta a la primera. El `maxWidth` de jsPDF **no
recorta: parte el texto en varias líneas y las va bajando**. Un cajetín es una caja de medidas
fijas con casillas de 8,5 mm, así que la segunda línea se sale de su casilla, cruza la raya de
abajo y se planta encima del rótulo siguiente. Medido: la obra
`Ampliacion Terminal Internacional - Climatizacion cubierta nivel 4` se parte en dos a 7,6 pt
dentro de los 74 mm de su casilla, y la segunda línea aterriza sobre «FECHA». En la última fila se
saldría del cajetín entero.

Ahora `textoDeUnaLinea` encoge la letra hasta 5,4 pt y, si no cabe, corta con puntos suspensivos,
que es lo que hace un cajetín de plano de verdad.

`test/cajetin.test.ts` (6 pruebas, con los textos del aeropuerto) · commit `021111e`

### P2-15 · Inyección de fórmulas en CSV — **confirmado**

Un CSV es texto plano y la hoja de cálculo se lo cree entero. La lista de materiales lleva la
descripción de cada aparato —que puede venir de un proyecto ajeno— y el parte de obra lleva la nota
que se escribe en la cubierta y se manda por correo.

Cada celda pasa por `celdaSegura`: si arranca fórmula (`=`, `+`, `-`, `@`) se le antepone un
apóstrofo, que la hoja entiende como «esto es texto» y no muestra. **Un número con signo se deja
pasar** —`-5`, `+3,5`, `-1.2e3`— porque neutralizar de más rompería las columnas de cotas y
longitudes.

De paso: había **dos** armadores de CSV duplicados haciendo lo mismo a medias. Ahora hay uno.

Commit `f3961e4`

### P2-16 · Nombres de archivo — **confirmado**

El recorte a 100 caracteres se hacía sobre el nombre **completo, extensión incluida**. Un título
largo —y los de aquí lo son— se descargaba con la extensión cortada o sin ella: el archivo salía
perfecto por dentro y el sistema no sabía con qué abrirlo. Ahora se aparta la extensión (las
compuestas como `.tablero.json` cuentan como una), se recorta el cuerpo y se vuelve a pegar.

Y los nombres reservados de Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) no valen ni
con extensión. No hace falta mala fe: a un tablero se le puede llamar «AUX» sin pensarlo.

Commit `f3961e4`

---

## 4. Lo que la auditoría no vio

| Qué | Cómo apareció |
|---|---|
| **El arreglo de P1-03 se saltaba por archivo.** La ventana validaba lo tecleado; un `.tablero.json` colaba `iccPresuntaKA: "mucha"` por detrás | Al hacer P1-02 |
| **Quedaba un punto de inyección** en el listado de rutas de cable | `qa/texto-hostil.mjs` |
| **El diálogo de confirmación no se cerraba con Escape** — no enfocaba nada al abrirse | Al hacer P1-04 |
| **`npm run qa` omitía ONCE suites, no cuatro** — entre ellas las de la propia auditoría, o sea las que vigilan que un fallo arreglado no vuelva | Al revisar el runner |

Sobre lo último: el arreglo no fue añadir once nombres a la cadena de `package.json`, sino
**quitar la cadena**. `qa/todas.mjs` busca en el directorio; añadir una prueba es dejar el archivo
ahí. Una lista escrita a mano se vuelve a quedar atrás.

---

## 5. Dos regresiones mías, y quién las cazó

Ambas las introduje arreglando hallazgos de la auditoría, y ambas las encontró la batería. Van
aquí porque son el mejor argumento a favor de que las pruebas cubran lo que cubren.

**a) Una ventana abierta encima de otra quedaba debajo** (`b1b43d5`). Al introducir la escala de
capas de P0-02, todas las ventanas pasaron a compartir `--capa-modal` y el empate lo desempataba
el orden en el HTML. Resultado: en la primera visita, con la guía rápida abierta, pulsar «Empezar
con un ejemplo» abría las tarjetas **detrás** de la guía y no se podía pinchar ninguna. Justo el
primer minuto de quien abre el programa.

Lo cazó `qa/cables-fusion.mjs` — una de las once suites que no se ejecutaban. `qa/capas.mjs` no lo
vio porque abría las ventanas **de una en una**; ahora abre una encima de otra.

**b) Escape dejó de cerrar ventanas** (`b2a3c2d`). Mi arreglo de P1-04 apartaba el manejador del
tablero cuando había una herramienta delante, y con eso bloqueé Escape sin querer. Escape no es un
atajo de edición: es la tecla de «cierra lo que está encima», y ese manejador es el único sitio
donde se cierran las ventanas. Con la ventana de **Inicio** abierta —que es **cómo arranca el
programa**— la guía rápida y los datos del proyecto ya no se cerraban con el teclado.

Lo cazó `qa/entrega.mjs`, la única suite que abre el archivo empaquetado de verdad; las demás
entran con `?inicio=0` y no pasan por ahí.

---

## 6. Lo que se hizo después, fuera del alcance de la auditoría

- **Conductos de la Planta 3D.** El techo del emparejado salía de `ancho de proyecto × 3`, y ese
  ancho es el del conducto más *pequeño*: para extracción, 200 mm → techo de 600. Los conductos
  reales en cada UMA miden 1 500 mm y se descartaban. Y un tercio de lo que se dibujaba como
  conducto (129 de 398 recorridos) eran **piezas en aspa** —transiciones y compuertas, dos
  diagonales cruzadas— que el visor pintaba como tramos flotando sobre las máquinas. *Esto último
  solo apareció haciendo una captura y mirándola; los números por sí solos no lo decían.*
  Commits `bbbaaf7`, `5e08503`
- **La leyenda daba metros de raya dibujada, no de instalación.** Un conducto dibujado por sus dos
  lados cuenta doble: decía 861 m de inyección donde hay 409, y 432 de extracción donde hay 118.
  Commit `112b4c5`
- **El orden de arranque de `main.ts`.** Medido primero: **hoy el peligro vale cero**, ninguna
  llamada de arranque lee nada declarado más abajo. Como los efectos de nivel superior son 107
  líneas en 31 bloques repartidos por 4 200 —y la mayoría son registros de manejadores, que no son
  el peligro— se descartó el refactor y se hizo que el orden **no pueda romperse sin avisar**:
  `test/arranque.test.ts` lo comprueba en cada `npm test`, y se comprueba a sí mismo con código
  roto a propósito. Commit `8c0c87c`

---

## 7. Estado de verificación

- **501 tests de núcleo** (`npm test`). Los escritos para esta auditoría viven en
  `test/cargar.test.ts` (validación del archivo importado), `test/cajetin.test.ts` (6, con los
  textos del aeropuerto), `test/documentacion.test.ts` y `test/entregables.test.ts` (CSV y nombres
  de archivo), `test/ejes-planta.test.ts` (conductos) y `test/arranque.test.ts` (6, orden de
  arranque).
- **34 suites de navegador**, todas dentro de `npm run qa`, que ahora las descubre solas.
- **8 suites nuevas** escritas para la auditoría, agrupadas en `npm run qa:auditoria`:
  `recuperacion`, `datos-proyecto`, `capas`, `texto-hostil`, `sin-fantasmas`, `planta-zoom`,
  `atajos-a-ciegas`, `se-guarda-solo`.
- **El archivo que se entrega** (`dist-final/TableroStudio.html`) regenerado y comprobado
  abriéndolo con `file://`, sin servidor.

---

## 8. Una nota sobre el informe

La auditoría es buena y encontró cosas que importaban. Las dos observaciones que dejo, dichas con
respeto:

**El alcance de un hallazgo merece la misma verificación que el hallazgo.** En P1-10 el fallo era
real pero el camino para llegar a él es mucho más estrecho de lo que sugiere el texto, y eso cambia
la prioridad. En P1-05 se pedía un botón que ya existía.

**Un remedio propuesto no es un hallazgo.** En P1-08 el síntoma era real y el diagnóstico correcto,
pero el remedio —un refactor de la capa que guarda el trabajo del usuario— era desproporcionado
para un único punto de fuga que se localizó en veinte minutos midiendo. Separar «esto está mal» de
«hazlo así» deja al que arregla elegir el tamaño de la intervención.

Y una que va contra mí: **descarté P2-05 por probarlo con datos cómodos**. Si un caso no reproduce,
lo primero que hay que sospechar son los datos de prueba, no el informe.
