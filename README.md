# TableroStudio

Programa propio para diseñar tableros eléctricos, nacido del análisis del código fuente de
[QElectroTech](https://qelectrotech.org) (ver [`docs/analisis-qelectrotech.md`](docs/analisis-qelectrotech.md)).
El objetivo es superar a herramientas como EduVolt Designer con un núcleo más potente y
totalmente personalizable.

## Qué hace ya (núcleo v0.1)

El núcleo es una librería TypeScript **sin interfaz gráfica**, con un modelo de datos JSON y
ocho motores independientes y testeados:

| Motor | Archivo | Qué resuelve |
|---|---|---|
| Potenciales | `src/motores/potenciales.ts` | Clases de equivalencia de bornes conectados (union-find): la base de todo lo demás |
| Numeración IEC | `src/motores/numeracion.ts` | Designaciones IEC 81346 (`=función+ubicación-K1`) con plantillas, secuencias y congelamiento; numeración de conductores por potencial |
| Referencias cruzadas | `src/motores/referencias.ts` | Bobina ↔ contactos con posición `hoja.FilaColumna`, índice de dispositivos |
| DRC | `src/motores/drc.ts` | 8 reglas de detección de errores eléctricos: cortocircuitos, bornes sin conectar, designaciones duplicadas, exceso de conductores por borne, conflictos de tensión, esclavos huérfanos… |
| Listas de bornes | `src/motores/bornes.ts` | Plan de bornero de taller: borna, lado interno/externo, puentes, número de conductor |
| Ruteo de cables | `src/motores/ruteo.ts` | Ruteo automático por canaletas (Dijkstra sobre el grafo de ductos), longitudes reales en mm con reserva, ocupación de canaletas |
| Sincronización | `src/motores/sincronizacion.ts` | Esquema ↔ placa de montaje: faltantes, sobrantes, solapes, fuera de placa |
| Documentación | `src/motores/documentacion.ts` | BOM, lista de conductores, planes de borneros, informe HTML completo, exportación CSV |

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
npm test        # 22 tests de los motores
npm run ejemplo # genera la documentación de un tablero real en ejemplo/salida/
```

### Editor 3D (`app/`)

Configurador 3D completo del gabinete, al estilo de Schneider eDesign o WAGO Smart
Designer, conectado en vivo con los motores del núcleo:

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
- **Cableado desde la ficha del aparato**: elige borne origen, aparato y borne destino,
  sección y color → el cable se rutea por las canaletas al instante; también se
  pueden quitar cables uno a uno.
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
5. **v0.5 — Exportaciones**: PDF del dossier completo, DXF del gabinete
   (en `sources/createdxf.cpp` de QET hay una referencia de cómo escribir DXF a mano).
6. **v1.0 — Empaquetado** como aplicación de escritorio (Tauri/Electron).
