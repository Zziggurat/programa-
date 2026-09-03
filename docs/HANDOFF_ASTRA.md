# TableroStudio — handoff técnico pre-Astra

## Identidad de la entrega

- Repositorio: `Zziggurat/programa-`
- Rama de entrega: `main`
- Baseline V7 publicado antes de esta estabilización: `56ed7953cdf12d41d40ee919130450fe2c58ad75`
- Checkpoint de producto tras el hotfix documental: `cad6c3a`
- Referencia inmutable de la entrega final: tag anotado `tablerostudio-v7` (resolver con `git rev-parse tablerostudio-v7^{}`)
- Build ID offline final: `4FE91DB16B`
- Fecha de cierre: 2026-09-02
- Estado esperado de Git al entregar: `main`, árbol limpio, `HEAD == origin/main`, sin divergencia
- CI esperado: Unit/TypeScript/Build, QA histórico, equipos V6, Ingeniería V7, entregable offline y Pages en verde

El hash exacto del commit que contiene este documento no puede escribirse dentro del propio commit
sin crear una autorreferencia inestable. El tag anotado anterior es la fuente de verdad del HEAD
final pre-Astra; el checkpoint `cad6c3a` identifica el producto ya corregido antes de añadir este
handoff y los binarios reproducibles.

## Capas V2–V7

- **V2 — electromecánica:** `src/motores/simulacion.ts` resuelve alimentación, contactos,
  contactores, motores, protecciones, fallos de runtime, transitorios y VFD. El contrato ejecutable
  viene de `src/modelo/comportamiento.ts`; no de la marca, el nombre, el ID ni la imagen.
- **V3 — instrumentación:** `src/modelo/senal-analogica.ts`, las secciones analógicas de
  `src/motores/simulacion.ts` y `src/fisica/analogicas.ts` conservan valor bruto, escalado, unidad,
  calidad y procedencia para 0–10 V y 4–20 mA, además de actuadores simplificados.
- **V4 — PLC:** `src/modelo/programa-plc.ts`, `src/motores/plc-compilador.ts` y
  `src/motores/plc-runtime.ts` implementan IR segura, imágenes E/S congeladas, publicación atómica,
  scheduler determinista, temporizadores, contadores, secuencias, alarmas, interlocks y PID V1.
- **V5 — PhysicsEngine:** `src/fisica/solver.ts` y `src/fisica/topologia-proyecto.ts` adaptan la
  topología conductiva y resuelven fasores/magnitudes. `conductores.ts`, `fallas.ts`,
  `protecciones.ts` y `analogicas.ts` añaden impedancia, pérdidas, Icc, curvas y lazos.
- **V6 — equipos y diagnóstico:** `src/fisica/motores.ts`, `variadores.ts`,
  `fallas-equipos.ts`, `trifasica.ts` y `src/diagnostico/*` profundizan equipos, residual,
  transformador, motor/VFD, desequilibrio, instrumentos y causalidad sin crear otra verdad física.
- **V7 — ingeniería y validación:** `src/ingenieria/*` descubre circuitos, ejecuta reglas,
  agrega potencia, compara escenarios y genera entregables a partir de una fotografía estática.

## Arquitectura V7: rutas y símbolos reales

| Responsabilidad | Ruta y símbolo principal |
|---|---|
| Configuración persistente V7 | `src/modelo/ingenieria.ts` — `ConfiguracionIngenieriaProyecto`, `leerConfiguracionIngenieria` |
| Circuito de ingeniería | `src/ingenieria/circuitos.ts` — `CircuitoIngenieria`, `descubrirCircuitos` |
| Orquestador | `src/ingenieria/engine.ts` — `ejecutarIngenieria`, `REGLAS_INGENIERIA_V7` |
| Contrato de reglas/issues | `src/ingenieria/validacion.ts` — `EngineeringRule`, `ResultadoReglaIngenieria`, `EngineeringIssue`, `validarIngenieria` |
| Conductores/ampacidad/alternativas | `src/ingenieria/conductores.ts` — `REGLA_CONDUCTORES`, `evaluarAlternativasSeccion` |
| Protecciones y coordinación | `src/ingenieria/protecciones.ts` — `REGLA_PROTECCIONES`, `datosCoordinacion` |
| Potencia y balance | `src/ingenieria/potencia.ts` — `resumirPotenciaIngenieria`, `REGLA_POTENCIA_Y_BALANCE` |
| Compatibilidad de equipos | `src/ingenieria/compatibilidad.ts` — `REGLA_COMPATIBILIDAD_EQUIPOS` |
| Escenarios | `src/ingenieria/escenarios.ts` — `proyectarEscenario`, `evaluarEscenarios`, `aplicarEscenarioTransaccional` |
| Documento técnico | `src/ingenieria/documentacion.ts` — `crearInformeIngenieriaV7`, serializadores JSON/HTML/CSV |
| CSV común | `src/modelo/csv.ts` — `aCSV`, `celdaSegura`, `BOM_UTF8` |
| UI de Ingeniería | `app/ui-ingenieria.ts` — `instalarIngenieria`, `contextoDisenoIngenieria` |
| Integración física | `src/fisica/topologia-proyecto.ts` — `simularFisicaProyecto`, `ResultadoFisicaElectrica` |

`descubrirCircuitos` construye un grafo estable de bornes, conductores y pares internos del perfil.
Busca caminos desde fuentes/VFD hacia cargas, publica `INEQUIVOCA`, `AMBIGUA` o `SIN_FUENTE` y no
inventa una raíz cuando hay varias. `ejecutarIngenieria` ordena dispositivos y conductores por ID,
deriva circuitos, ejecuta PhysicsEngine sin reloj y pasa un único resultado a las reglas. El motor
normaliza, deduplica y ordena evidencia, entidades, datos faltantes e issues de forma determinista.

## Fuentes de verdad y fronteras de persistencia

### Persistido

- `Proyecto` en `src/modelo/tipos.ts`: topología eléctrica, equipos, bornes, conductores,
  configuración física declarada, perfiles funcionales explícitos, geometría y decisiones V7.
- `Proyecto.ingenieria`: únicamente criterios humanos del proyecto/circuito, nombres/tipos de
  circuito y lista explícita de conductores reasignables de fase.
- `programaPLC`, perfiles, terminales y parámetros técnicos declarados.
- `DocumentoProyecto`, revisiones, snapshots, metadata activa y recuperación en
  `src/persistencia/tipos.ts` y `src/persistencia/repositorio.ts`.
- Definiciones personales y assets por SHA-256. Una instancia colocada fotografía terminales,
  comportamiento y revisión mediante `src/componentes/personalizados.ts`.

### Derivado y no persistido

- `CircuitoIngenieria`, magnitudes, `ResultadoFisicaElectrica`, resultados de reglas, issues,
  potencia agregada, deltas de escenario e informes preparados.
- Estado dinámico de Energizar: contactos, motores, VFD, PLC, fuerzas, fallos, memoria térmica,
  reloj y diagnósticos de sesión.
- `app/ui-ingenieria.ts` conserva el análisis solo en memoria y lo invalida cuando cambia el
  proyecto. La UI presenta el snapshot; no recalcula ecuaciones.

V7 obtiene la física llamando una sola vez a `simularFisicaProyecto` dentro de
`ejecutarIngenieria`. `contextoDisenoIngenieria` define explícitamente la fotografía estática:
polos de protección/contactores y conexiones pasivas cerradas, sin avanzar tiempo ni copiar el
runtime de Energizar.

`ScenarioEngine` clona BASE con `structuredClone`, valida y ordena parches, ejecuta el mismo motor
sobre la copia y calcula deltas. Comparar nunca muta BASE. Aplicar crea otro candidato y solo lo
entrega después de confirmación; `aplicarEscenarioTransaccional` deja que el repositorio haga
rollback si falla la persistencia.

## Invariantes que no deben romperse

1. Imagen, marca, nombre, referencia e ID nunca deciden comportamiento eléctrico.
2. Un dato ausente no puede convertirse en un `PASS` inventado; `INDETERMINATE` es válido.
3. Toda cifra importante conserva procedencia: `CALCULADO`, `CONFIGURADO`, `ESTIMADO`,
   `INYECTADO` o `NO_MODELADO`/`NO_DISPONIBLE` según la capa.
4. VFD/motor y transformador primario/secundario no se contabilizan dos veces en potencia.
5. El análisis estático no avanza reloj, PLC, térmica ni transitorios.
6. Comparar escenarios no muta BASE; aplicar exige una acción explícita.
7. Curvas genéricas son modelos estimados, no curvas certificadas del fabricante.
8. Componentes personalizados con igual perfil ejecutan el mismo motor que los nativos.
9. El orden de arrays no puede cambiar resultados, informes ni escenarios.
10. CAD, 3D y routing no son el siguiente frente de Ingeniería.

## Regresiones históricas que no deben volver

- **Curva V5:** no extrapolar logarítmicamente más allá del último punto térmico antes del umbral
  instantáneo. Esa extrapolación generaba tiempos físicamente engañosos.
- **QA térmico V6:** no esperar con un timeout de pared menor que la ventana que publica la curva.
  El rotor bloqueado de Q1 (curva C, ≈6 In) usa 30,5 s simulados; la regresión debe confirmar
  primero fallo, sobreintensidad y región térmica, y después usar el acelerador público del reloj
  con un límite derivado de `tMaxS`. Un timeout ciego de 30 s fallaba de forma reproducible en CI.
- **Serialización opcional:** no materializar `electrica: undefined`; cambia la forma persistida y
  rompe roundtrips/determinismo aunque el valor aparente ser equivalente.
- **PDF offline:** al abrir el iframe/blob del dossier en Playwright no esperar una navegación que
  no existe; la carrera bloqueaba el gate de empaquetado.
- **CSV/Excel:** `aCSV` debe conservar el BOM Unicode `U+FEFF`, que se serializa como bytes
  `EF BB BF`. Sin él, Excel Windows abre UTF-8 como página de códigos local (`Descripción` se veía
  como `DescripciÃ³n`). La neutralización de fórmulas y el separador `;` siguen intactos.

## Aceptación humana y cierre documental

La aceptación manual de V7 usó `Fixture V7 — proyecto sano` y confirmó descubrimiento inequívoco,
corriente/potencia coherentes, carga resistiva con PF≈1, 0 errores, 0 advertencias esperadas,
capacidad de corte declarada, curva genérica identificada como estimada, pérdidas sin doble conteo,
JSON/BOM/wiring/terminales coherentes y dossier PDF profesional. La Icc ausente quedó
`INDETERMINATE`, sin falsa certificación.

Hallazgos humanos y resolución final:

- Mojibake en BOM/wiring/terminales al abrirlos directamente con Excel Windows: **corregido** con
  BOM UTF-8 en el generador común y comprobación de bytes reales en unit y navegador.
- HTML técnico demasiado crudo: **corregido** con cabecera, metadata legible, secciones, tablas,
  zebra, alineación numérica, disclaimer y CSS `@page`/`@media print`, todo embebido y offline.
- `Fixture V7 — DO insuficiente`: DO máx. 0,10 A frente a bobina 0,18 A produce `FAIL` explícito,
  no `PASS` ni `INDETERMINATE`.
- `Fixture V7 — escenario de sección`: 2,5→4 mm² produce preview/deltas sin mutar BASE; aplicar
  requiere confirmación y cambia únicamente la copia editable elegida.

Regresiones principales: `test/ingenieria-fixtures-v7.test.ts`,
`test/ingenieria-documentacion.test.ts`, `test/ingenieria-escenarios.test.ts`,
`qa/ingenieria-validacion.mjs`, `qa/ingenieria-documentacion.mjs` y
`qa/ingenieria-escenarios.mjs`.

## Limitaciones honestas al cerrar V7

- No hay certificación normativa automática.
- Icc requiere impedancias/topología suficientes; sin ellas permanece no modelada.
- Icu/Icn/Ics pueden faltar y no se completan por heurística.
- Las curvas genéricas y coordinaciones derivadas de ellas son estimaciones de ingeniería.
- Fuentes múltiples o caminos equivalentes pueden dejar topología ambigua.
- No es SPICE; no modela EMT, arco, armónicos profundos, PWM ni torque electromagnético.
- `ScenarioEngine` compara alternativas declaradas; no optimiza ni elige por el usuario.
- El solver reconstruye topología y no tiene caché/Worker general todavía.
- El stress está validado con cientos de entidades, no con escala ilimitada.

## Misión recomendada para V8 (no iniciada)

**TABLEROSTUDIO V8 — Technical Data, Catalogs & Engineering Criteria.** El objetivo debe ser reducir
resultados `INDETERMINATE` aportando datos técnicos explícitos, versionados, trazables y
reproducibles, sin inventar información ni presentar conformidad normativa automática.

Preguntas que Astra debe investigar antes de diseñar:

- ¿Cuál es el modelo mínimo de `TechnicalCatalog` y de revisiones inmutables?
- ¿Cómo representa `TechnicalProduct` datos por variante sin acoplarlos al dibujo?
- ¿Cómo se conserva procedencia a nivel de campo, incluida fuente documental y revisión?
- ¿Cuál es la precedencia explícita entre dato del proyecto, subconjunto congelado y catálogo?
- ¿Cómo fija un proyecto una revisión para evitar el uso silencioso de `latest`?
- ¿Qué debe viajar en un paquete portable: subconjunto congelado, referencia de revisión o ambos?
- ¿Qué datasets de ampacidad y factores de corrección son admisibles y bajo qué jurisdicción?
- ¿Cómo se modela/versiona `EngineeringCriteriaProfile` sin convertirlo en una norma implícita?
- ¿Cómo muestra `ScenarioEngine` el impacto de actualizar una revisión antes de confirmar?

Principios obligatorios: **trazabilidad, reproducibilidad, corrección, datos faltantes honestos y
determinismo**. Nunca actualizar un proyecto por un cambio de catálogo sin confirmación. V8 no debe
derivar hacia CAD, 3D, routing, IEC 61131-3, marketplace, scraping de fabricantes, SPICE,
armónicos ni pricing.

## Reproducción del baseline

```bash
npm ci
npm test
npm run editor:build -- --mode qa
npm run qa:ingenieria
npm run empaquetar
npm run entrega:check
npm run qa:empaquetado
```

El gate general y las suites históricas permanecen en `package.json`; la lista exacta de jobs de
entrega está en `.github/workflows/qa.yml` y `.github/workflows/instaladores.yml`.
