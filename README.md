# TableroStudio

Programa propio para diseñar tableros eléctricos, nacido del análisis del código fuente de
[QElectroTech](https://qelectrotech.org) (ver [`docs/analisis-qelectrotech.md`](docs/analisis-qelectrotech.md)).
El objetivo es superar a herramientas como EduVolt Designer con un núcleo más potente y
totalmente personalizable.

## Qué hace ya (núcleo v0.1)

El núcleo es una librería TypeScript **sin interfaz gráfica**, con un modelo de datos JSON y
doce motores independientes y testeados:

| Motor | Archivo | Qué resuelve |
|---|---|---|
| Potenciales | `src/motores/potenciales.ts` | Clases de equivalencia de bornes conectados (union-find): la base de todo lo demás |
| Numeración IEC | `src/motores/numeracion.ts` | Designaciones IEC 81346 (`=función+ubicación-K1`) con plantillas, secuencias y congelamiento; numeración de conductores por potencial |
| Referencias cruzadas | `src/motores/referencias.ts` | Bobina ↔ contactos con la posición `hoja.columna` que sale del esquema realmente montado, índice de dispositivos |
| DRC | `src/motores/drc.ts` | 14 reglas de detección de errores eléctricos: cortocircuitos, designaciones duplicadas, exceso de conductores por borne, conflictos de tensión, esclavos huérfanos, coordinación protección↔sección, caída de tensión, puesta a tierra, llenado de canaleta, **poder de corte frente a la Icc presunta**, **calentamiento del armario**… |
| Listas de bornes | `src/motores/bornes.ts` | Plan de bornero de taller: borna, lado interno/externo, puentes, número de conductor |
| Ruteo de cables | `src/motores/ruteo.ts` | Ruteo automático por canaletas (Dijkstra sobre el grafo de ductos), longitudes reales en mm con reserva, ocupación de canaletas |
| Sincronización | `src/motores/sincronizacion.ts` | Esquema ↔ placa de montaje: faltantes, sobrantes, solapes, fuera de placa |
| Documentación | `src/motores/documentacion.ts` | BOM, lista de conductores, planes de borneros, informe HTML completo, exportación CSV |
| Terminales | `src/motores/terminales.ts` | Geometría de las borneras declaradas por ficha de datos: es la única fuente de verdad que comparten el modelo 3D y el anclaje de los cables |
| Ficha del tablero | `src/motores/ficha-tablero.ts` | Las cifras del conjunto: recuento de aparatos por familia, medidas de caja y placa, metros de riel y canaleta, cable por sección, ocupación de la placa |
| Simulación | `src/motores/simulacion.ts` | Energizar el tablero y verlo funcionar: contactos según el estado de cada mando, propagación de la tensión y iteración a punto fijo para que el enclavamiento de un contactor se sostenga |
| Balance térmico | `src/motores/termico.ts` | Temperatura interior del armario por el método simplificado de IEC 60890: disipación de cada aparato, superficie efectiva según el montaje y veredicto (natural / rejilla / ventilador / climatizador) |
| Apertura de archivo | `src/modelo/cargar.ts` | Validación real del proyecto que se abre, reparación de lo recuperable (cables huérfanos, colocaciones fantasma) y punto de enganche para migrar formatos antiguos |

## Cómo ver y probar el programa

**Opción A — sin instalar nada (un clic):** cada vez que avanza el desarrollo se publica
una versión jugable del editor 3D como página web en Claude:
<https://claude.ai/code/artifact/a0a740c7-1552-425c-a168-324a9f8fcdaf>
(se abre en el navegador; también aparece en la galería de *Artifacts* de claude.ai/code).

**Opción B — en tu PC (recomendada para desarrollo):**

1. Instala [Node.js LTS](https://nodejs.org/es) (botón verde, siguiente-siguiente).
2. Descarga este repositorio: botón verde **Code → Download ZIP** en GitHub (o
   `git clone https://github.com/Zziggurat/programa-.git`) y descomprímelo.
3. Abre una terminal **dentro de la carpeta** del proyecto (en Windows: clic derecho →
   "Abrir en Terminal") y ejecuta:

```bash
npm install     # una sola vez, descarga las dependencias
npm run editor  # arranca el editor 3D
```

4. La terminal te mostrará una dirección tipo `http://localhost:5173/` — ábrela en el
   navegador. Eso es el programa.

Otros comandos útiles:

```bash
npm test        # tests de los motores y de la geometría de cables
npm run qa      # pruebas automáticas sobre el editor 3D real (ver abajo)
npm run ejemplo # genera la documentación de un tablero real en ejemplo/salida/
```

### Pruebas automáticas del editor (`qa/`)

Además de los tests del núcleo, hay varias suites que manejan el editor 3D de verdad
(con un navegador) y comprueban lo que ve el usuario. `npm run qa` las encadena todas:

| Suite | Qué verifica |
|---|---|
| `npm run qa:cables` | Cero cables fantasma, cablear por clic, codos, uniones, arrastre, Supr y deshacer |
| `node qa/controladores.mjs` | Los doce controladores reales del catálogo y el diálogo «a medida»: huella, borneras en su sitio y cableado por terminal |
| `node qa/dossier.mjs` | Que el PDF describa el tablero que hay en pantalla, y que cambie cuando el tablero cambia |
| `npm run qa:agarre` | Que **todo** cable visible se pueda agarrar y mover, desde varios ángulos de cámara |
| `npm run qa:general` | Empezar de cero, catálogo, anclaje a riel, modos, DRC, guardar, dossier y PDF |
| `npm run qa:tablero` | Monta un tablero completo desde cero y mide el amontonamiento del cableado |
| `npm run qa:riel` | El riel arrastra sus aparatos, y si chocan vuelve todo a su sitio |
| `npm run qa:nuevas` | Biblioteca de ejemplos con su explicación y modo Visualización |
| `npm run qa:estres` | Decenas de operaciones al azar verificando los invariantes tras cada una |
| `npm run qa:energizar` | El modo Energizar: pulsar un pulsador arranca el motor, el enclavamiento lo sostiene al soltar, el paro lo tira y no vuelve solo |
| `npm run qa:empaquetado` | **El archivo que se entrega**: abre `dist-final/TableroStudio.html` con `file://`, sin servidor, y comprueba que arranca, que se puede trabajar y que salen el dossier y el proyecto guardado |

Se apoyan en una sonda que solo existe abriendo la página con `?qa=1`; en el uso normal
del programa no se define nada. La única que no la usa es `qa:empaquetado`: el build que se
entrega borra la sonda a propósito, así que esa suite comprueba todo por el DOM — exactamente
lo que ve el usuario. Va aparte de `npm run qa` porque reconstruye la aplicación en modo
entrega, sin el andamiaje de las pruebas.

### Editor 3D (`app/`)

Configurador 3D completo del gabinete, al estilo de Schneider eDesign o WAGO Smart
Designer, conectado en vivo con los motores del núcleo:

- **Tableros de ejemplo explicados** (botón «📚 Ejemplos»): arranque directo de motor,
  bomba de agua con boya de nivel y tablero de control con PLC a 24 V. Cada uno se abre
  armado y cableado, con una ficha que cuenta **qué hace**, **cómo funciona paso a paso**
  (la secuencia de maniobra real) y **en qué fijarse** en el 3D para estudiarlo. La ficha
  se puede volver a abrir cuando quieras con «📖 Cómo funciona».
- **Modo Visualización** (botón «👁️ Ver»): enseña el tablero **como quedaría montado de
  verdad** — envolvente de chapa opaca con la **puerta abierta**, tapas de canaleta puestas
  y sin rótulos flotantes ni ayudas de edición. Se ocultan los paneles laterales y no se
  puede tocar nada: solo mirar. Aquí la **cámara va suelta** y se puede dar toda la vuelta
  al tablero (mientras se edita, en cambio, la vista se mantiene por delante para que no se
  trabaje «desde atrás» con todo espejado). Ideal para enseñárselo al cliente.
- **Imágenes de referencia con profundidad**: botones «⬇️ Al fondo» y «⬆️ Al frente» para
  que la foto no quede tapada por un riel o una canaleta.
- **El riel manda sobre sus aparatos**: al mover un perfil DIN, **los aparatos anclados van
  con él**. Si en el sitio nuevo chocarían con otro aparato o se saldrían de la placa, se
  avisa en rojo durante el arrastre y al soltar **el riel y sus aparatos vuelven a su
  posición inicial**: nunca queda nada encimado.
- **Dos modos de trabajo** (conmutador en la barra superior):
  - 🔧 **Editor** — armar y modificar: añadir aparatos, arrastrarlos, editar la caja,
    la placa, los rieles y las canaletas.
  - 🔌 **Trabajo** — solo cablear y verificar; la estructura queda bloqueada para que
    nada se mueva por accidente. Se cambia de modo cuando quieras.
- **Deshacer / Rehacer** con Ctrl+Z / Ctrl+Y (y botones ↶ ↷ en la barra); historial
  de hasta 60 pasos que cubre añadir, mover, cablear, eliminar y editar la estructura.
- **«Ver tamaños»**: cotas acotadas en cm con código de color — caja (azul), placa
  (verde), rieles (amarillo), canaletas (naranja). En modo editor, **clic en una cota
  para cambiar esa medida** (p. ej. el largo de la caja de 100 a 90 cm).
- **Caja envolvente y placa con dimensiones independientes** (ancho/alto/profundidad de
  la caja; ancho/alto de la placa), como en un gabinete real.
- **Canaletas y rieles libres**: selecciónalos y arrástralos para moverlos, tira de las
  esferas de los extremos para alargarlos, o ajusta X/Y/largo/ancho en cm desde el panel.
  Ideal para replicar un tablero existente o dimensionar uno nuevo y saber los cm que
  necesitas antes de fabricarlo.
- **Imágenes de referencia cableables**: importa cualquier foto (un gabinete, un
  controlador Honeywell, un motor…), colócala y redimensiónala en la placa, marca sobre
  ella sus puntos de conexión (GND, L1, +24…) y cablea de forma puramente visual entre
  esos puntos y el resto del tablero — como en EduVolt Designer.

- **Catálogo de aparatos** (15 plantillas: disyuntores, diferencial, guardamotor,
  contactor, relés, variador, PLC, fuente, transformador, borneros, portafusible):
  un clic y el aparato se coloca en el primer hueco libre de un riel, con su
  designación IEC correlativa.
- **Cableado por clic en los bornes** (modo Trabajo), como en un tablero real: cada
  aparato muestra sus terminales como puntos naranjas; tocas uno y luego otro y el cable
  queda conectado. Mientras lo tiendes, una goma elástica lo sigue y **cada clic en un
  punto libre marca un codo** (estilo Tinkercad). Esc o clic derecho cancelan. No permite
  duplicar una conexión existente. También queda el formulario clásico como alternativa.
- **Cables ordenables, sin fantasmas**: todos los cables corren en tramos horizontales y
  verticales por un **corredor libre** (franja sin aparatos) y en un carril propio, así no
  se cruzan ni pasan por encima de los aparatos. Con el **clic izquierdo** se arrastran sus
  uniones, con el **clic derecho** se crea una unión nueva, con **doble clic** se quita y
  con **Supr** se borra el cable. «✨ Auto-ordenar» los devuelve al recorrido automático.
- **Los aparatos de campo entran por prensaestopas**: la acometida, los sensores y demás
  aparatos fuera del gabinete tienen su pasamuros rotulado en el borde inferior, de modo
  que **ningún cable queda invisible**: todos tienen un recorrido y un propósito.
- **Modelos 3D detallados por tipo**: palanca y mirilla en disyuntores, tornillos de
  borne, peines y LEDs en el PLC, aletas de disipación, núcleo y bobina del
  transformador, bloques individuales con borna de tierra en los borneros…
- **Canaletas ranuradas de PVC** con dientes y tapa translúcida; los cables entran por
  las ranuras justo donde conectan.
- **Estructura editable**: placa en cm, perfil de canaleta, y rieles/canaletas con
  posición y largo en mm — añadir, mover, quitar.
- **Arrastre con anclaje a riel** (también entre rieles), tecla Supr para eliminar,
  Esc para deseleccionar; todo se re-rutea y verifica al soltar.
- **Guardar / Abrir** proyecto como `.tablero.json`, autoguardado en el navegador,
  y verificación eléctrica en vivo en la barra superior.
- **Exportar a PDF** (botón «📄 Exportar PDF»): dossier técnico completo con portada,
  **lista de materiales (BOM)**, índice de dispositivos, lista de conductores con
  longitudes, referencias cruzadas, planes de borneros y verificación DRC. También hay
  «Dossier HTML» para la misma información en web.

## Enviar el programa (instalador / app)

- **Lo más fácil (sin instalar nada):** `npm run empaquetar` genera
  `dist-final/TableroStudio.html`, **un único archivo** que se abre con doble clic en
  cualquier navegador y funciona offline (incluida la exportación a PDF). Se puede copiar
  a cualquier PC. Ver [`desktop/LÉEME.txt`](desktop/LÉEME.txt).
- **App de escritorio con instalador** (Windows `.exe`, macOS `.dmg`, Linux `AppImage`):
  proyecto Electron en [`desktop/`](desktop/). Se construye con
  `cd desktop && npm install && npm run dist:win` (necesita Node.js), o automáticamente en
  la nube con el flujo de GitHub Actions [`.github/workflows/instaladores.yml`](.github/workflows/instaladores.yml)
  al subir una etiqueta `v*`.
- Iluminación PBR con sombras suaves y entorno de estudio.
- **Pensado para cualquiera**: tarjeta de bienvenida que guía el primer paso, guía rápida
  (botón ❓) que se abre en la primera visita, **cableado por clic** (elige el destino
  tocando el aparato en el 3D), botón **🏠 Centrar** para no perderse al girar la cámara.
  Ver el informe de pruebas en [`docs/qa-usabilidad.md`](docs/qa-usabilidad.md).

El proyecto de ejemplo (`ejemplo/tablero-ejemplo.ts`) modela un tablero de control típico:
acometida 220 V → interruptor automático → transformador 220/24 V → fusible → controlador,
relé comandado por el PLC, borneros de fuerza y control, sensor y electroválvula en campo,
y un gabinete de 400×600 mm con rieles DIN y canaletas.

## Controladores reales

Un catálogo no puede tener todos los controladores del mercado, y mucho menos modelados en
3D uno a uno. Aquí se modela la **clase** y cada equipo se describe con una **ficha de
datos** (`app/controladores.ts`): huella y fondo en mm, y qué bornera va en cada borde con
los rótulos serigrafiados del fabricante. Un único constructor 3D genérico dibuja cualquiera
de ellos, y el motor de terminales garantiza que el cable salga del terminal correcto.

Añadir un modelo nuevo son ~20 líneas de datos, no trabajo 3D. Vienen los doce equipos más
usados en automatización de edificios:

| Fabricante | Modelos |
|---|---|
| Honeywell | Spyder PUB6438S · CIPer Model 30 · ComfortPoint Open CP-SPC |
| Schneider Electric | SpaceLogic AS-P · SpaceLogic MP-C 18A · SE8350 |
| Siemens | Desigo PXC4.E16 · PXC5.E24 · DXR2.E18 |
| Johnson Controls | Metasys FEC2611 · FAC3611 · IOM3731 |

Cada ficha declara si sus medidas salen de la **hoja de datos del fabricante** o son
**nominales** (estimadas de su familia). El catálogo lo dice al pasar el ratón y el dossier
en PDF lo advierte por escrito: una medida supuesta es un tablero que no cierra.

Para un equipo que no esté en la lista, el botón **🧩 Controlador a medida** pide sus
medidas y los terminales de cada borde (admite rangos abreviados: `UI1-8` → UI1…UI8) y lo
dibuja igual, con sus borneras y listo para cablear.

## Diseño

- **Modelo puro** (`src/modelo/tipos.ts`): todo el proyecto es un objeto JSON serializable y
  versionable con git. Nada del núcleo depende de una librería gráfica (el error de QET que
  más nos costaría revertir después).
- **El potencial eléctrico es el concepto central**: numeración de conductores, detección de
  cortocircuitos y listas de cables se derivan de él.
- **Los documentos son consultas sobre el modelo** (idea tomada de la base SQLite de QET),
  nunca dibujos mantenidos a mano.
- **Esquema y gabinete comparten el mismo modelo**: la sincronización es una verificación,
  no una importación.

## Hoja de ruta

1. ~~v0.2 — Editor 3D del gabinete~~ ✔ primera versión en `app/` (falta: añadir/quitar
   aparatos desde un catálogo, mover entre rieles, editar canaletas, guardar el proyecto).
2. **v0.25 — Editor 2D de esquemas** (SVG): dibujar hojas, colocar símbolos, trazar
   conductores — el complemento eléctrico del editor 3D.
3. **v0.3 — Librería de símbolos**: conversor de los 7.279 símbolos `.elmt` de QElectroTech
   (XML, licencia libre) a SVG/JSON para no dibujar nada desde cero.
4. **v0.4 — Cables multiconductor y mangueras**: agrupar conductores de campo en cables
   `W`, calcular longitudes al campo con puntos de paso.
5. ~~v0.5 — Exportaciones~~ ✔ dossier PDF fiel al tablero (con plano de la placa a escala,
   balance térmico y placa de características IEC 61439), esquema en PDF/SVG con cajetín,
   rótulos de bornes y DXF de placa y esquema.
6. **v1.0 — Empaquetado** como aplicación de escritorio (Tauri/Electron). El archivo único
   `dist-final/TableroStudio.html` ya funciona sin servidor ni internet, y lo verifica
   `npm run qa:empaquetado`.

### Deuda técnica conocida

- `app/main.ts` pasa de las 3.900 líneas y concentra escena, interacción, paneles y diálogos.
  Partirlo en módulos no cambia nada de lo que se entrega —el empaquetado es un único archivo
  con `inlineDynamicImports`, así que dividir no reduce el bundle— pero sí el coste de tocarlo.
  Pendiente de hacer con la batería de QA en verde como red, no a última hora antes de entregar.
