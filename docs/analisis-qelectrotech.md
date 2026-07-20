# Análisis de QElectroTech (v0.8.1)

Este documento resume la arquitectura y la lógica de QElectroTech (QET) tras analizar su código
fuente (C++/Qt, ~235 archivos en `sources/`), con el objetivo de extraer las ideas útiles para
construir nuestro propio programa de diseño de tableros eléctricos (**TableroStudio**).

Las referencias a archivos apuntan al código de QET incluido en la raíz de este repositorio.

---

## 1. Arquitectura general

QET es una aplicación de escritorio Qt organizada en tres grandes capas:

| Capa | Qué hace | Código clave |
|---|---|---|
| Modelo de proyecto | Archivo `.qet` (XML) con folios, colección de símbolos embebida y propiedades | `sources/qetproject.h/.cpp` |
| Escena gráfica | Cada folio es una `QGraphicsScene` con elementos, conductores y textos | `sources/diagram.h`, `sources/qetgraphicsitem/` |
| Editores/UI | Editor de esquemas, editor de símbolos, editor de cajetines | `sources/qetdiagrameditor.*`, `sources/editor/`, `sources/titleblock/` |

Decisiones de diseño importantes que conviene imitar:

- **Todo el proyecto es un solo documento serializable** (XML). La colección de símbolos usada se
  embebe dentro del proyecto (`XmlElementCollection`), de modo que el archivo es portable y no
  depende de que otra máquina tenga instalada la misma librería de símbolos.
- **Deshacer/rehacer centralizado**: un `QUndoStack` por proyecto (`qetproject.h:177`); cada
  mutación es un comando (`sources/diagramcommands.*`, `sources/undocommand/`).
- **Identidad por UUID**: proyecto, elementos y terminales tienen `QUuid`, lo que permite enlaces
  robustos entre objetos (maestro↔esclavo, conductor↔terminal) que sobreviven a renombres.
- **Base de datos de proyección**: el proyecto mantiene una base SQLite en memoria
  (`sources/dataBase/projectdatabase.h`) que se repuebla con los datos de elementos y folios, y
  define vistas (`element_nomenclature_view`, `summary`) desde las cuales se generan la
  nomenclatura (BOM) y el sumario. Es decir: **la documentación se genera consultando una
  proyección tabular del modelo, no recorriendo la escena gráfica**. Esta idea es excelente y la
  adoptaremos.

## 2. El modelo de elementos (símbolos)

- La librería trae **7.279 símbolos** en archivos XML `.elmt` (`elements/`), con nombres
  multilingües, primitivas de dibujo (líneas, rectángulos, arcos, textos) y terminales.
- Cada elemento declara un `link_type` que define su comportamiento lógico
  (`sources/qetgraphicsitem/element.h:52`):
  - `Simple` — símbolo normal.
  - `Master` — p. ej. bobina de contactor: puede tener esclavos enlazados.
  - `Slave` — p. ej. contacto NA/NC: se enlaza a un maestro y hereda su etiqueta.
  - `NextReport`/`PreviousReport` — "reportes de folio": puntos de continuación de un conductor
    entre folios (origen/destino), implementados en `reportelement.h`.
  - `Terminale` — borne (punto de bornero), en `terminalelement.h`.
- Los elementos llevan un diccionario de información libre (`DiagramContext`) con claves
  estandarizadas (`sources/qetinformation.h`): `label`, `formula`, `manufacturer`,
  `manufacturer_reference`, `supplier`, `quantity`, `plant` (=instalación), `location` (+ubicación),
  `function`, etc. Estas claves alimentan la BOM y las variables de los cajetines.

**Lección**: separar *símbolo gráfico* de *rol lógico* (maestro/esclavo/borne/reporte) es lo que
habilita referencias cruzadas y listas automáticas. En TableroStudio el rol lógico será un campo
del dispositivo, no una propiedad del dibujo.

## 3. Conductores, terminales y potenciales

- `Terminal` (`sources/qetgraphicsitem/terminal.h`): punto de conexión con orientación, número y
  nombre; sabe qué conductores llegan a él (`conductors()`, `canBeLinkedTo()`).
- `Conductor` (`sources/qetgraphicsitem/conductor.h`): une exactamente dos terminales; calcula su
  **trazado ortogonal automático** (`updatePath()`, `sources/conductorsegment.*`,
  `sources/conductorprofile.*`) y permite modificarlo a mano guardando "perfiles".
- **Potenciales**: `relatedPotentialConductors()` (`conductor.h:128`) recorre el grafo de
  conductores —incluso a través de folios mediante los reportes y a través de bornes— para obtener
  todos los conductores que comparten el mismo potencial eléctrico. Se usa para:
  - propagar propiedades (sección, color, numeración) a todo el potencial
    (`setPropertyToPotential`);
  - numerar una sola vez cada potencial (la base de la numeración de cables).

**Lección**: el concepto central de un esquema no es "la línea dibujada" sino el **potencial**
(clase de equivalencia de terminales conectados). Nuestro núcleo lo calcula con un union-find y
todo lo demás (numeración de conductores, detección de cortocircuitos, listas de cables) se apoya
en él.

## 4. Numeración automática (elementos, conductores y folios)

Módulo `sources/autoNum/`:

- `NumerotationContext`: define una secuencia como lista de partes
  (tipo, valor, incremento): números `unit/ten/hundred`, variantes "por folio", prefijos, sufijos,
  texto libre.
- `AssignVariables::formulaToLabel()` (`assignvariables.h:64`): evalúa **fórmulas con variables**
  tipo `%{label}`, `%{folio}`, `%{plant}`, `%{location}`, variables del cajetín y del proyecto,
  más las secuencias anteriores → produce la etiqueta final (p. ej. `-K12`, `=F1+A2-Q3`).
- El proyecto guarda varios contextos con nombre (`m_element_autonum`,
  `m_conductor_autonum`, `m_folio_autonum` en `qetproject.h`) y permite "congelar" etiquetas
  (`freezeLabel`) para que una renumeración masiva no toque lo ya aprobado.
- El prefijo por tipo de aparato sale de la categoría del símbolo
  (`elementPrefixForLocation()`), p. ej. contactores → `K`, disyuntores → `Q`.

**Lección**: fórmulas declarativas + secuencias con estado + congelamiento selectivo. Lo
replicamos, pero con soporte de primera clase para **IEC 81346** (designación
`=función+ubicación-producto`), que en QET existe solo a medias vía `plant`/`location`.

## 5. Referencias cruzadas (bobina ↔ contactos, folios)

- `CrossRefItem` (`sources/qetgraphicsitem/crossrefitem.h`): ítem gráfico bajo la bobina (maestro)
  que dibuja la tabla/cruz de contactos enlazados (NA, NC, temporizados, de potencia...) con la
  **posición folio-columna-fila** de cada esclavo (`elementPositionText()`); se reposiciona solo
  cuando algo se mueve y se actualiza cuando cambia el orden de folios.
- La posición se expresa como `folio-columna fila` (p. ej. `3-B2`) calculada contra la rejilla del
  borde del folio (`sources/borderproperties.*`, `sources/diagramposition.*`).
- Los reportes de folio (`reportelement.h`) son el equivalente para conductores: cada extremo
  muestra dónde continúa el potencial en el otro folio.

**Lección**: las referencias cruzadas son pura consecuencia del modelo de enlaces
(maestro↔esclavos, reporte↔reporte) + una función `posición → texto`. En nuestro núcleo son un
motor que consulta el modelo, y el dibujo es solo presentación.

## 6. Documentación (nomenclatura, sumario, exportaciones)

- La BOM ("nomenclatura") y el sumario de folios se generan desde las vistas SQL de
  `projectdatabase.cpp` y se exportan a CSV.
- Exportación gráfica: PNG/JPG/SVG (`sources/exportdialog.*`) y **DXF** escrito a mano
  (`sources/createdxf.*` — útil como referencia de cómo generar DXF sin librerías).
- Cajetines ("title blocks"): plantillas XML con celdas y variables (`sources/titleblock/`,
  `titleblockcell.*`) que se rellenan con la información del proyecto/folio.

## 7. Lo que QET 0.8 **no** tiene (y nuestro programa sí tendrá)

| Funcionalidad pedida | Estado en QET 0.8.1 |
|---|---|
| Detección automática de errores eléctricos (DRC) | ❌ No existe. Solo validación de XML. |
| Referencias cruzadas | ✔️ Sí (maestro/esclavo y reportes de folio). |
| Numeración según IEC | 🟡 Parcial: fórmulas y prefijos, sin modelo 81346 completo. |
| Listas de bornes | 🟡 En 0.8 los bornes son elementos sueltos; el editor de borneros llegó en 0.9. |
| Cálculo de longitudes de cable | ❌ Solo `Conductor::length()` en píxeles de esquema, sin significado físico. |
| Ruteo automático de cables | 🟡 Solo trazado ortogonal del esquema; nada físico (canaletas). |
| Sincronización esquema ↔ gabinete | ❌ El "plano de montaje" son símbolos-miniatura dibujados a mano (`elements/10_electric/98_graphics/99_assembly_plan/`), sin vínculo con el esquema. |
| Documentación técnica completa | 🟡 BOM y sumario por CSV; sin lista de cables ni plan de bornes. |

Justo en los huecos ❌/🟡 es donde TableroStudio puede superar a QET y acercarse a
(y superar a) EPLAN/EduVolt Designer.

## 8. Decisiones para TableroStudio derivadas del análisis

1. **Núcleo sin interfaz gráfica** (TypeScript puro): modelo + motores (numeración, potenciales,
   DRC, bornes, ruteo, sincronización, documentación) testeables por separado. La UI (editor
   gráfico web/Electron) se monta encima después. QET mezcla modelo y `QGraphicsScene`, lo que
   hace casi imposible reutilizar su lógica; nosotros evitamos ese error desde el día uno.
2. **El potencial como concepto central** (union-find), igual que
   `relatedPotentialConductors()` pero explícito y O(n·α(n)).
3. **Designaciones IEC 81346 nativas**: `=función +ubicación -clase+número`, con letras de clase
   según IEC 81346-2 y secuencias/congelamiento al estilo QET.
4. **Modelo físico real del gabinete**: placa de montaje, rieles DIN y canaletas como grafo de
   ruteo → longitudes de cable reales y ocupación de canaletas.
5. **Documentos como consultas sobre el modelo** (idea de la base SQLite de QET): BOM, lista de
   conductores, plan de bornes, índice de dispositivos; exportables a CSV/HTML.
6. **Formato de archivo JSON** versionado, con UUIDs, amigable con git.
7. Reutilizar a futuro la **librería de símbolos de QET** (7.279 `.elmt` XML, licencia libre):
   escribir un conversor `.elmt → SVG/JSON` en lugar de dibujar símbolos desde cero.
