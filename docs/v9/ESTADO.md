# Estado V9

Actualizado: 2026-09-17.

## Estado durable

- Rama de desarrollo: `v9/astra-diseno-asistido`.
- Baseline: `4a0025f327c07d40bc104f614220a5e863a69165` (`tablerostudio-v8`).
- V8 permanece intacta; V9 reutiliza sus contratos de datos técnicos, Ingeniería,
  persistencia y transacciones.
- Encargo maestro preservado en `docs/v9/ENCARGO.md`.
- Gates A0–J cerrados localmente. Gate K se completa fuera del repositorio al exigir, para
  el mismo SHA: integración fast-forward en `main`, siete jobs verdes, artifact/Pages
  verificados y tag anotado `tablerostudio-v9`.

## Producto terminado

V9 aplica sección sobre el campo legacy y, cuando existe vínculo técnico, mediante un
`OVERRIDE` persistente explícito. La protección se sustituye por una revisión exacta
completa y decisiones `CATALOGO`; no conserva campos de otra revisión. Cada candidato usa
`ejecutarIngenieria` y la prospectiva V8 en el punto configurado.

El núcleo incluye snapshot reproducible con algoritmo/Build ID y fronteras bloqueadas,
espacio perezoso de opciones por filas de ampacidad aplicables, BASE/sección/protección/
combinados, estados honestos, Pareto, presupuesto, cancelación, preview transaccional,
stale/tamper, intención/decisión persistentes e informes HTML/JSON/CSV. Se excluyen con
motivo opciones sin efecto, retiradas, incompatibles, sintéticas no autorizadas o
bloqueadas por decisiones conservadas.

El laboratorio está versionado y la vista `Ingeniería → Diseño` permite seleccionar
circuito/conductores, secciones, protección y revisiones exactas; muestra progreso,
cancelación, cobertura, evidencia, ranking y preview. La prueba de navegador acredita
aplicación combinada, undo/redo, persistencia y reapertura. El flujo offline repite el
vertical slice desde el HTML entregado sin API ni red.

## Campaña local final

- TypeScript + unitarias: 1412/1412, 0 fallos, 0 skipped; 102,77 s total.
- Build QA: 398 módulos; 7,73 s.
- QA V9 visible: 1/1 suites, 16 comprobaciones, 0 errores JS; 142,22 s.
- Gate histórico: 13/13 suites, 267 comprobaciones; 715 s. La preparación de
  `texto-hostil` exige el ejemplo nominal, su copia persistente independiente y un
  fixture no vacío; pasó además dos veces de forma focal (27,12 s y 28,02 s).
- Fusión/picking: 59/59 frontal, 186/186 semántico, 61/61 sin fantasmas; 474,93 s.
- Puerta: 21 comprobaciones; 39,84 s.
- Componentes + multiproyecto: 2/2 suites, 86 comprobaciones; 788,01 s.
- V6/física/simulación: todas las suites verdes; la regresión de automatización final
  obtuvo 29/29 en 209,49 s.
- V7/V8: 6/6 suites, 161 comprobaciones; 1390,09 s.
- Empaquetado offline: V2–V9, sin errores JS ni solicitudes HTTP; 459,49 s.
- El recorrido offline se repitió tras aislar las aperturas de la biblioteca de una
  navegación residual de los downloads; V2–V9 volvió a quedar verde, sin cambiar los
  bytes del entregable.
- 0 fallos, 0 skipped inesperados, 0 timeouts y 0 procesos propios huérfanos.

La medición sintética de V9 usó 10.000 productos, universo estimado de 30.003 y 25
evaluaciones: catálogo 944,50 ms, snapshot 1049,10 ms, filtro/índice 785,64 ms,
generación perezosa 0,91 ms, evaluación 336,58 ms, ranking 0,48 ms, serialización
73,69 ms y heap final aproximado 125,7 MiB. Es observación de desarrollo, no SLA.

El manifiesto de bytes está en `ENTREGA.md` y la evidencia detallada en
`VALIDACION.md`. No se reutiliza evidencia de un SHA anterior para aprobar publicación.
