# Validación V9

## Preflight

| Comprobación | Resultado |
|---|---|
| Rama de partida | `main` limpio |
| Baseline local/remoto | `4a0025f327c07d40bc104f614220a5e863a69165` |
| Tag V8 | resolvía exactamente al baseline |
| Rama V9 | `v9/astra-diseno-asistido`, creada desde V8 |
| Divergencia inicial | 0/0 |
| Trabajo V9 previo | ninguno |

## Evidencia de desarrollo

Los 23 tests V9 rápidos cubren cambio efectivo tras resolver V8, revisión exacta sin
campos Frankenstein, prospectiva por punto, ampacidad, determinismo por orden, cambio
combinado, Pareto, presupuesto/cancelación, transacción, stale/tamper, roundtrip e
informes seguros. El navegador usa interacción visible; los hooks QA observan únicamente
proyecto y persistencia.

El fixture V9 se añadió al final de la biblioteca para no convertir el índice de un
ejemplo en contrato. Cuatro QA históricos que dependían accidentalmente del índice se
volvieron a ejecutar: cámara, mazo, picking y piloto, 4/4 suites y 63 comprobaciones.

## Campaña final local sobre el candidato

| Frontera | Comando | Resultado | Duración |
|---|---|---|---:|
| Tipos + unitarias | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json`, `node node_modules/typescript/bin/tsc`, `node --test 'dist/test/*.test.js'` | 1412/1412; 0 fail; 0 skipped | 102,77 s total; tests 77,919 s |
| Build QA | `node node_modules/vite/bin/vite.js build app --mode qa` | 398 módulos | 7,73 s |
| Diseño asistido V9 | `node qa/todas.mjs diseno-asistido-v9` | 1/1 suite; 16 comprobaciones; 0 JS errors | 142,22 s |
| Texto hostil focal | `node qa/texto-hostil.mjs` (dos ejecuciones) | 21/21 comprobaciones por ejecución; 0 skips | 27,12 s; 28,02 s |
| Histórico | `node qa/todas.mjs --gate` | 13/13 suites; 267 comprobaciones | 715 s |
| Fusión/picking | `node qa/cables-fusion.mjs` | 0 fusiones; 59/59 frontal; 186/186 semántico; 61/61 sin fantasmas | 474,93 s |
| Fixture puerta | `node qa/fixture-puerta.mjs` | 21 comprobaciones | 39,84 s |
| Componentes + multiproyecto | `node qa/todas.mjs componentes-personalizados multiproyecto` | 2/2 suites; 86 comprobaciones | 788,01 s |
| V7 + V8 | `node qa/todas.mjs ingenieria- datos-tecnicos-` | 6/6 suites; 161 comprobaciones | 1390,09 s |
| Entrega reproducible | `node herramientas/verificar-entrega.mjs` | ambas copias frescas e idénticas LF/CRLF | 8,59 s |
| HTML offline | `node qa/empaquetado.mjs` | V2–V9 verde; 0 JS errors; 0 HTTP externo | 459,49 s |

Suites V6/simulación/física también quedaron verdes: accionamientos 1:05, motor 3:29,
red 0:43, física eléctrica 4:53 y simulación industrial 11:02. Automatización se
repitió después de corregir una comparación QA no atómica y terminó 29/29 en 209,49 s.

Desglose V7/V8: catálogo 15/15 en 4:33; importación 55/55 en 4:30; ingeniería técnica
47/47 en 8:06; documentación 2:09; escenarios 1:34; validación 2:17. Ninguna aserción,
timeout, error JS ni skipped inesperado quedó silenciado.

## Hallazgos del propio harness

- Dos unitarias dependían del orden/tamaño incidental de fixtures; ahora buscan la
  precondición eléctrica o el contrato lazy exacto.
- `qa:cables-fusion` podía terminar 0/0 si no reabría un ejemplo. Ahora abre por título,
  espera el montaje y exige rutas antes de medir.
- La QA de automatización leía PLC y actuador en ticks diferentes mientras el PID seguía
  integrando. Ahora compara una instantánea atómica del mismo resultado.
- El candidato remoto `e9e264f` dejó seis jobs verdes, pero `texto-hostil` preparaba el
  escenario con pulsaciones y relojes sin verificar el documento copiado. El fixture ahora
  se abre por título, exige identidad nueva y contenido real, y cualquier aparato o riel
  ausente falla explícitamente en vez de convertir cobertura en un skip.
- En el primer candidato posterior, el HTML offline superó bytes, arranque, persistencia,
  trabajo y descargas; después Playwright esperó una navegación residual al abrir la
  biblioteca V3. Las aperturas V3–V7 ahora separan `click` y estado visible con
  `noWaitAfter`; el recorrido offline V2–V9 completo volvió a pasar localmente.

No se relajó una aserción de producto para obtener verde.

## Rendimiento observado

`node herramientas/medir-diseno-v9.mjs`: 10.000 productos, 30.003 planes estimados y
25 evaluados. Catálogo 944,50 ms; snapshot 1049,10 ms; filtro/índice 785,64 ms;
generación perezosa 0,91 ms; evaluación 336,58 ms; ranking 0,48 ms; serialización
73,69 ms. JSON 3.524.779 bytes, HTML 85.091 bytes y heap final aproximado 125,7 MiB.
Son mediciones de desarrollo, no un SLA ni un catálogo certificado.

## Aprobación remota

La publicación se aprueba solo si el commit al que resuelve `tablerostudio-v9` coincide
con `main`, sus siete jobs de **Pruebas** están verdes y el artifact HTML extraído
coincide con `ENTREGA.md`. La anotación del tag conserva run/attempt, Pages y SHA final;
así no se crea un commit posterior solo para escribir su propio identificador.
