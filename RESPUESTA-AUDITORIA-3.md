# Respuesta a la tercera auditoría de TableroStudio

Para el auditor. Los veinte hallazgos, uno por uno, con lo que se hizo, dónde está y **con qué
prueba se comprueba que estaba roto antes**.

La regla que se ha seguido en toda la ronda es la misma de la anterior, y es la que importa:

> **Una prueba que pasa contra el código viejo no demuestra nada.** Cada arreglo se reprodujo
> primero con los números del informe, se arregló después, y se comprobó por último quitando el
> arreglo y viendo fallar la prueba.

Ese último paso encontró tres errores míos en esta ronda —una prueba que medía el andamiaje, otra
que nunca llegó a pulsar el botón que decía pulsar, y una que se cumplía sola— y están contados
donde tocan, sin adornos.

---

## 1. Resumen

| Prioridad | Hallazgos | Cerrados con prueba | Declarados (opción del propio informe) | Empezados |
|---|---|---|---|---|
| P0 | 1 | 1 | — | — |
| P1 | 7 | 7 | — | — |
| P2 | 9 | 7 | 2 | — |
| P3 | 3 | 2 | — | 1 |
| **Total** | **20** | **17** | **2** | **1** |

Los dos «declarados» son TS3-P2-08 (Pasear táctil) y TS3-P2-09 (editor en móvil). El informe daba
dos salidas para cada uno —implementarlo o declararlo y no presentarlo como algo que funciona— y se
ha tomado la segunda, a conciencia y con la razón escrita en el código. El «empezado» es TS3-P3-01,
que es explícitamente una ruta incremental: se han movido las dos familias que el propio informe
pedía primero.

Commits de esta ronda, del primero al último:

```
046e958  El codec declara TODO lo que tira, y con eso el autosave deja de perderse
8e40a68  Una salida analógica da voltios, y la fuente que se elige aguanta lo que dice
a28be94  Sinks que quedaban, plantilla en cuarentena y el portapapeles por el codec
23f76ac  Las ventanas del editor se manejan con el teclado, y el QA sirve un solo directorio
ab004c3  Abrir un tablero mueve proyecto, historial y guardado a la vez, o no mueve ninguno
8f0e58d  Pasear pide teclado y el editor pide ancho: las dos cosas se dicen en vez de fingirse
6af182f  Un aspa del plano es UNA pieza, no dos diagonales: 129 cajas eran 48 accesorios
f04bedc  Pegar también es todo o nada, y el coste de arrancar deja de ser una opinión
```

---

## 2. La sonda dirigida del informe, otra vez

Las doce comprobaciones del apartado 11, contra el código de ahora:

```
OK  el cargador rechaza o repara un borne de conductor inexistente
OK  el cargador normaliza o descarta congelado="false"
OK  los textos de aparato se validan antes de alimentar la BOM
OK  las opciones de numeración se reconstruyen campo a campo
OK  las opciones de ruteo inválidas no producen longitudes NaN
OK  el cargador rechaza SVG también en dossier y logo
OK  quitar una imagen inválida DECLARA un arreglo (P0)
OK  una AO forzada no se convierte en retorno binario de 24 V
OK  la fuente de «todas» cubre la corriente declarada
OK  los ids duplicados de conductor se rechazan
OK  hay un tope de tamaño de colecciones
OK  un borne fantasma no crea un potencial

0 de 12 fallan
```

---

## 3. P0 — pérdida silenciosa de trabajo

### TS3-P0-01 · Un saneamiento no registrado vuelve a pisar el autosave

El diagnóstico era exacto: el cargador tiraba cosas sin decirlo, y como no había `arreglos` el
guardado no se congelaba y el primer `recalcular()` reemplazaba el original.

El arreglo no fue añadir un `arreglos.push` donde faltaba —eso lo habría vuelto a pasar en el
siguiente campo que se añadiera— sino invertir la carga de la prueba. `src/modelo/cargar.ts` lleva
ahora una lista de `diagnosticos` con la RUTA de lo que se quitó, y todo lo que se descarta pasa
por `oQuitado()`, que anota. La prueba es paramétrica sobre **los 31 campos** de `Dispositivo`
(`test/cargar.test.ts`): cada campo envenenado tiene que quedar **conservado, rechazado o
declarado**, y «declarado» significa que aparece su ruta en `diagnosticos`. Un campo nuevo que se
añada mañana y se sanee en silencio hace fallar la prueba sin que nadie tenga que acordarse.

---

## 4. P1 — los siete

### TS3-P1-01 · `ProjectCodec` no valida todo el contrato

Reescrito campo a campo. El aparato se construye desde una **lista blanca**, sin `spread`: lo que
no está en la lista no entra. Escalares por `cadena()`, `bandera()` y `numerico()`; `leerOpciones`
reconstruido campo a campo con `Object.fromEntries(...filter(v !== undefined))`, que además arregló
un detalle que sí importa: una clave presente con valor `undefined` no es lo mismo que una clave
ausente, y `assert.deepEqual` los distingue.

### TS3-P1-02 · Una salida analógica se simula como contacto de 24 V

`src/motores/simulacion.ts` distingue ahora las salidas analógicas (`esSalidaAnalogica`), les da un
rango por defecto de 0-10 V y devuelve `salidasAnalogicas: Map<borne, {voltios, referencia, rango,
supuesto}>`. Forzar una AO al 0 / 50 / 100 % da 0 / 5 / 10 V contra `AOC`, y el borne **no** sale
vivo a 24 V. Probado también al revés: forzar una AO no cierra ninguna DO, y forzar una DO no hace
aparecer una analógica de la nada (`test/planta.test.ts`).

### TS3-P1-03 · 37 A sobre una fuente rotulada de 2,5 A

Había un catálogo de una sola fuente y se le sobrescribía la corriente nominal con la carga. Ahora
hay `CATALOGO_FUENTES` (2,5 / 5 / 10 / 20 / 40 A), una reserva declarada de 1,25 y una elección de
verdad. `corrienteNominal` pasa a ser `fuente.amperios` —la placa, no el deseo— y cuando ninguna
fuente da la talla se dice en las notas en vez de rotular una mentira. Probado con 1, 3 y todas las
señales.

### TS3-P1-04 · Rutas de texto importado que se insertan como HTML

Cerradas las que quedaban. Y aquí va un error mío que conviene contar: la primera prueba hostil
apuntaba al **id de un borne**, que acaba en contenido de elemento y es inofensivo. El sink real
era el **id del riel**, que acaba dentro de un atributo. La prueba pasaba y no demostraba nada.
Corregida, y la razón está escrita en el archivo para que no vuelva a colarse.

### TS3-P1-05 · Política de imágenes fragmentada

Una sola puerta: `imagenAdmisible(dato)` en el codec, que devuelve `{ok:true}` o `{ok:false,
motivo}`. La usan el aparato, el logo del dossier y los bloques de imagen. SVG fuera en las tres.

### TS3-P1-06 · Una plantilla corrupta rompe la biblioteca

En cuarentena: la plantilla mala se aísla y las buenas siguen abriéndose. `qa/entradas-hostiles.mjs`
lo comprueba con **cinco plantillas buenas y la corrupta en medio** —no al final, que es donde no
demuestra nada— más cinco formas de portapapeles roto y un Ctrl+C/Ctrl+V de verdad.

### TS3-P1-07 · La cadena de `electron-builder` no debe publicar AppImage

`electron-builder` subido a `^26.15.0`; el lockfile resuelve `app-builder-lib` **26.15.3**, por
encima del advisory GHSA-7g7r-gx96-252g. `npm audit` en `desktop/` da **0 vulnerabilidades** en
todas las severidades. La construcción del AppImage la hace el workflow de CI; **no se ha
construido un AppImage en esta máquina** y no se afirma lo contrario (ver §8).

---

## 5. P2 — los nueve

### TS3-P2-01 · Portapapeles sin codec

Pasa por el codec. `{"aparatos":[null]}` ya no revienta con «Cannot read properties of null».

### TS3-P2-02 · Los modales del editor no heredan el gestor accesible

El gestor sale de `mundo-ui.ts` a **`app/ventanas.ts`**, y lo usan las dos herramientas. Se midió
antes y después con `qa/modales-teclado.mjs`, que comprueba seis cosas en cada ventana: el foco
entra, `role="dialog"` y `aria-modal`, nombre accesible, fondo `inert`, el tabulador da la vuelta en
los dos sentidos, Escape cierra y el foco vuelve.

```
contra el código de antes:   20 FALLOS
con el gestor puesto:         0
```

Faltaba **todo** en «Datos del proyecto», «Verificación eléctrica» y «Controlador a medida».

Y escribiendo esa prueba salieron dos cosas más, que son las que justifican escribirla:

1. **El foco no volvía a ningún sitio** al cerrar una ventana abierta desde un desplegable: el
   botón ya estaba en un `.lista` con `display:none`, y `focus()` sobre eso no hace nada, sin error
   ni aviso. El foco se quedaba en `<body>`. Ahora sube hasta lo que sí se ve y enfoca su
   disparador («Aprender ▾»).
2. **Una ventana cerrada por la espalda no se volvía a abrir nunca.** Si algo ponía `hidden = true`
   sin pasar por el gestor, la lista se quedaba con una ventana fantasma y `abrirVentana` la daba
   por abierta. Le pasó de verdad a `qa/datos-proyecto.mjs` en cuanto esa ventana entró en el
   gestor: tres comprobaciones que llevaban tiempo pasando empezaron a fallar. La lista se sanea
   contra el DOM, y la prueba lo reproduce a propósito.

De paso: `qa/datos-proyecto.mjs` pulsaba `pr-cancelar`, que **no existe**. El `?.` se lo tragaba y
la prueba nunca llegó a pulsar Cancelar ni una sola vez.

### TS3-P2-03 · La importación no es transaccional para historial/autosave

El informe pedía probarlo «inyectando un fallo después de `capturar` y antes del commit». Se añadió
la sonda `window.qa.romperProximoMontaje()` y se midió:

```
                     antes del arreglo      después
pila de deshacer          2 → 3              2 → 2
pila de REHACER           2 → 0              2 → 2      ← se perdía entera, sin decir nada
proyecto                 igual              igual, byte a byte
autosave                 pisado             intacto
```

El caso real no tiene nada de raro: llevas un rato trabajando, deshaces un par de cosas porque te
lo estás pensando, pruebas a abrir un archivo que está mal, y te quedas sin poder rehacer lo tuyo.

`reemplazarProyecto()` prueba primero y apunta después: monta y pinta con el guardado congelado, y
solo si sale bien toca el historial y escribe. Lo usan **las tres puertas de entrada**, no solo la
que señalaba el informe: abrir un ejemplo y abrir una plantilla tenían el mismo defecto y además ni
siquiera devolvían el proyecto anterior.

La prueba comprueba también el **camino bueno** —paso de deshacer, rehacer vaciado y guardado—,
porque una transacción que no apuntara nunca en el historial pasaría las cinco del fallo sin
despeinarse.

### TS3-P2-04 · Invariantes de identidad y límites globales

`TOPES` (1.000 aparatos, 5.000 conductores, 100 hojas, 40 MB de JSON) con `conTope()`; ids de
conductor duplicados y colocaciones duplicadas rechazados; y `bornesDe: Map<string, Set<string>>`
con `extremoValido()`, que es lo que impide que un borne fantasma llegue a los potenciales.

### TS3-P2-05 · La puerta de CI no ejecuta la regresión crítica

`.github/workflows/instaladores.yml` fija `npx --yes playwright@1.56.1 install --with-deps chromium`
—versión clavada, no flotante—, corre `npm run qa:auditoria` y sube el resultado de la auditoría de
dependencias como artefacto.

### TS3-P2-06 · Servidores QA duplicados con aislamiento insuficiente

Las **34 suites** llevaban la misma línea copiada, con `join(ROOT, p)` —que en Windows sale del
directorio con un `..`— y sin fijar host. Ahora todas usan `servidorDeQA()` de
`qa/lib/entorno.mjs`: `resolve` y comprobación de que el archivo resuelto sigue bajo la raíz, que
es la única que funciona porque `..` puede llegar codificado de varias formas, y escucha solo en
`127.0.0.1`. Comprobado con sockets crudos: `/index.html` → 200, `/../../package.json` → 403,
`/%2e%2e/%2e%2e/package.json` → 403.

### TS3-P2-07 · Las aspas siguen siendo geometría duplicada

Cuantificado: las **129 diagonales** de esta cubierta son **48 accesorios**.

```
38 aspas normales   2 diagonales cada una
 7 nudos            5 diagonales
 3 nudos            6 diagonales
```

Los nudos de cinco y seis son donde el plano encadena una transición con su compuerta: eso es UNA
pieza en la cubierta, no dos y media, así que el agrupado va por **componente conexa** y no por
parejas. Con eso, el visor dibuja una caja por accesorio, la leyenda dice «+ 48 piezas» en vez de
«+ 149 m en piezas» —para pedir material sirve cuántas hay, no cuántos metros de raya cruzada
dibujó el proyectista— y debajo de las cifras se dice de dónde salen:

> «Medido sobre el plano del proyectista (DXF): sirve para estimar y pedir con margen, no como
> as-built. Falta comprobarlo en la cubierta.»

Que es literalmente lo que pedía el informe: «rotular la métrica como estimación del DXF hasta
validarla contra obra».

### TS3-P2-08 · Pasear sin entrada táctil — **DECLARADO**

No se ha implementado el joystick virtual. Se ha tomado la otra salida del informe: en un equipo
solo táctil el botón queda **apagado** con la razón en su título, y si se llega por otro camino se
dice y no se entra. Un botón que se pulsa y no lleva a ninguna parte es peor que uno apagado que
explica por qué. Lo demás de la Planta —buscar, filtrar, ver la máquina y medir tiradas— sí sirve
en un teléfono, que es a lo que se sube a la cubierta, y la prueba lo verifica.

### TS3-P2-09 · El editor no define experiencia móvil — **DECLARADO**

Anchura mínima fijada y **dicha**: 1.024 px. Sale de la cuenta —306 + 300 px de paneles dejan menos
de 420 px de placa, y en 420 px no se coloca un aparato en un riel—. El aviso está en la ventana de
inicio, **donde se elige herramienta**, no cuando ya está el tablero abierto y tapado, y dice
además lo que sí funciona ahí.

Las dos se comprueban en `qa/planta-estrecha.mjs`, en un contexto táctil de verdad (390 × 844,
`hasTouch`, `isMobile`), que es lo que distingue `pointer: fine`.

---

## 6. P3

### TS3-P3-01 · `main.ts` sigue siendo el acoplamiento dominante — **EMPEZADO**

El informe decía «no hace falta reescribir el programa entero; empezar por importación/clipboard».
Eso es lo que se ha hecho, y solo eso:

- **importación** → `reemplazarProyecto()`, usado por abrir archivo, abrir ejemplo y abrir
  plantilla;
- **portapapeles** → `mutarProyecto()`, que es lo mismo para lo que edita el tablero abierto en vez
  de cambiarlo por otro (la cámara no se toca, y la selección la deja quien haga el cambio porque
  lo pegado tiene que quedar seleccionado).

Medido igual que la importación: sin la transacción, un pegado que falla a media lista dejaba **un
aparato de más** en el proyecto, un paso de más en el historial y ese estado a medias **ya escrito
en el navegador**.

`main.ts` sigue siendo grande. No se declara resuelto.

### TS3-P3-02 · Tamaño de entrega y coste de arranque — **MEDIDO**

`qa/coste-arranque.mjs` mide los cinco números que pedía el informe. En esta máquina, dibujando por
software:

| | |
|---|---|
| primer tablero interactivo | 6.297 ms |
| memoria en reposo | 17 MB |
| abrir un ejemplo | 25.226 ms |
| dibujar un fotograma (mediana) | 8,3 ms |
| dibujar un fotograma (el peor) | 26,9 ms |
| dossier en PDF | muy variable (ver abajo) |
| abrir la Planta | 8.550 ms |
| lo que añade la Planta | 37 MB |

Con dos avisos, que están en el archivo y no de adorno:

1. **La primera medida del frame time era mía y estaba mal.** Cronometraba el hueco entre llamadas
   de `requestAnimationFrame` y daba **1.814 ms por fotograma** —medio fotograma por segundo—, que
   no es lo que cuesta dibujar el tablero sino cada cuánto le da la gana al navegador llamarnos en
   una pestaña sin pantalla. Estaba midiendo el andamiaje y llamándolo rendimiento del programa.
   Cronometrando el render de verdad son **8,3 ms**.
2. **El tiempo del dossier baila muchísimo**: 7,4 s y 63,7 s en dos medidas seguidas sin tocar
   nada, porque el contenedor comparte CPU. El tope solo vigila que **termine**.

Los topes son de rotura, no objetivos. Poner un tope ajustado bajo dibujado por software sería
fabricar una prueba que falla sola los martes.

### TS3-P3-03 · Versionado y trazabilidad

`package.json` y `desktop/package.json` unificados en `1.0.0`. El empaquetador inyecta versión,
commit corto y fecha, y la guía los enseña:

```
TableroStudio 1.0.0 · build a28be94f · 2026-08-11
```

Es lo primero que hay que preguntarle a quien avisa de un fallo, y hasta ahora no había forma de
saberlo: el programa se pasa como un archivo HTML suelto por correo y por WhatsApp.

---

## 7. Los criterios de aceptación del apartado 11

| # | Qué pedía | Dónde |
|---|---|---|
| 1 | conductor con borne inexistente | `test/cargar.test.ts` |
| 2 | `congelado:"false"`, fabricante objeto, referencia array | `test/cargar.test.ts` (paramétrica, 31 campos) |
| 3 | `formatoDesignacion:false`, `reservaCable:"mucho"` | `test/cargar.test.ts` |
| 4 | ids duplicados y colecciones por encima del límite | `test/cargar.test.ts` |
| 5 | AO a 0/50/100 % y DO simultáneas | `test/planta.test.ts` |
| 6 | fuente para 1, 3 y todas con reserva declarada | `test/planta.test.ts` |
| 7 | SVG, data URL corrupta, imagen enorme, cuota agotada | `test/cargar.test.ts` + `qa/entradas-hostiles.mjs` |
| 8 | plantilla corrupta junto a válidas | `qa/entradas-hostiles.mjs` (la mala **en medio**) |
| 9 | portapapeles `{aparatos:[null]}` | `qa/entradas-hostiles.mjs` |
| 10 | cadenas importables por todas las vistas | `qa/texto-hostil.mjs` |
| 11 | Tab/Shift+Tab/Escape/foco en cada modal | `qa/modales-teclado.mjs` |
| 12 | fallo inyectado tras validar: proyecto, Undo, Redo y autosave iguales | `qa/abrir-atomico.mjs` (proyecto comparado **byte a byte**) |
| 13 | build AppImage y revisión del advisory | advisory revisado; el build lo hace CI — ver §8 |
| 14 | prueba en dispositivo táctil real si se declara soporte de Pasear | **no se declara soporte**: se declara lo contrario (§TS3-P2-08) |

---

## 8. Lo que NO se hizo, dicho claro

1. **No se construyó un AppImage en esta máquina.** El advisory sí se revisó: lockfile en
   `app-builder-lib 26.15.3` y `npm audit` limpio. El build lo ejecuta
   `.github/workflows/instaladores.yml`. Decir que el AppImage está probado sería afirmar algo que
   no he visto.
2. **No hay joystick virtual para Pasear** (TS3-P2-08) ni cajones móviles para el editor
   (TS3-P2-09). Se ha tomado la opción de declararlo, que el propio informe ofrece.
3. **`main.ts` sigue siendo grande** (TS3-P3-01). Se han movido las dos familias que el informe
   pedía primero; las demás no.
4. **Las cifras de coste no son de un equipo objetivo.** Salen de un contenedor sin tarjeta
   gráfica y con CPU compartida. Sirven para comparar entre versiones en la misma máquina, no como
   promesa de rendimiento.
5. **Los metros de instalación siguen siendo del plano, no de obra.** Ahora lo dice la propia
   pantalla.

---

## 9. Salida de los controles

La salida exacta de `npm ci`, `npm run check`, `npm test`, `npm run qa:auditoria`,
`npm run empaquetar`, `node qa/entrega.mjs` y `node qa/empaquetado.mjs` acompaña a este documento.
