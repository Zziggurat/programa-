# Evidencia de validación V8

## Cierre del presupuesto global de V8

Reanudación verificada: main/origin `054e36b8c0a621bf7d1ca8e042dcbb0e2bb9f5d8`,
limpio,0/0; V7 intacto, V8 sin tag. [Run34197538052](https://github.com/Zziggurat/programa-/actions/runs/34197538052)
terminó5/6verde: unit1382/build1:47job; V6 15:26; V7 12:52; histórico13/13,
263checks38:30QA/39:17job; offline67checks13:23job. No acredita el SHA siguiente.

Único rojo, job101968600584: catálogo15checks7:32 e importación55checks7:47 verdes;
ingeniería33checks alcanzados a600s,0JS, sin aserción funcional fallida previamente.
`setTimeout(10*60000)` interno cerró Chromium mientras esperaba Biblioteca; después
se registró `Target page, context or browser has been closed`. El supervisor externo
era720s, no el causante. Dos errores registrados son timeout y cierre derivado, no
dos defectos funcionales. Se conserva el run rojo, no se convierte en117 aprobadas.

Presupuesto **total** de ingeniería18min: proyección indicativa600×47/33≈855s,
margen≈26%; no es una medición de duración completa ni un SLA. Catálogo/importación
12min dejan margen sobre452/467s. Política central en `qa/lib/presupuestos-v8.mjs`;
supervisores de árbol14/14/20min permiten cierre antes del kill. JobV8 50min cubre
los tres máximos externos y preparación. Otros jobs/gate histórico12min inalterados.
Los timeouts de cada acción30s/navegación60s y las117 aserciones no cambian.
Cada check conserva marcador y añade número, segundos acumulados e intervalo;
el runner transmite stdout V8 en vivo, incluso cuando la suite pasa.
Tres tests del harness verifican límites específicos, override explícito/invalidación
y reloj de progreso. No se modifica producto, física, render, fixture ni bytes HTML.

Focal terminal con `QA_V8_CAPTURAS=1 node qa/todas.mjs datos-tecnicos-`:
**3/3,117comprobaciones,6:36,exit0**,0fallos/timeouts/skipped/JS.
Catálogo15/59,217s; importación55/87,97s; ingeniería47/246,7s.
Log `%TEMP%/tablerostudio-v8-presupuesto-final.log`; capturas de catálogo, comparación,
portable e informe pantalla/impresión conservadas. Typecheckapp/tsc verdes;
`node --test dist/test/qa-presupuestos-v8.test.js`:3/3,0fail/cancel/skip/todo.
Los logs distinguen el tramo local lento51s entre checks de una acción atascada;
ninguna acción individual agotó su plazo. Los HTML conservan SHA-256 del manifiesto.

La aprobación final requiere los seis jobs del SHA señalado por `tablerostudio-v8^{}`.
Su anotación registra run final, Pages y hash descargado; no mezclar los pases antiguos.

## Aprobación del candidato y cierre público

**dc5edff269a6b70a57fe57b2b2b72191ba251864**: [Pruebas34193274343](https://github.com/Zziggurat/programa-/actions/runs/34193274343),
attempt1, terminado **success,6/6jobs**. Histórico13/13,263checks,29:51QA/30:39job.
V8 3/3,117checks,12:55QA/13:37job; V6 32checks/16:19job; V7 44checks/13:32job;
unit1382/1382 (200más netos que V7), buildQA4,22s; offline67checks/27:00job.
Cero fallos/timeouts/skipped inesperados/erroresJS en este candidato. ArtifactHTML
descargado y comparado byte a byte con Git y ambas copias locales.

La publicación final se verifica por `tablerostudio-v8^{}` y la anotación de ese tag:
incluye el CI del main integrado y evidencia Pages/artifact. **Sin tag no dar por
terminado ese paso.** Después del candidato cambian solo documentación y sincronización
QA de descargas, no producto; no se ocultan
los cuatro runs previos rechazados ni el diagnóstico adicional CPU×4 rojo descritos abajo.

## Resumen local definitivo

| Frontera | Evidencia terminal vigente | Duración |
|---|---|---|
| npm test (incluye typecheck y compilación) | 1382/1382; 0 fallos, cancelados, skipped o todo | 77,897 s comando |
| Build QA / producción | 392 / 394 módulos; ambas correctas | 6,69 / 17,93 s |
| Catálogo V8 | 15 comprobaciones | 1:18 |
| Importación/portabilidad V8 | 55 comprobaciones | 1:48 |
| Ingeniería/revisiones V8 | 47 comprobaciones, capturas estáticas renovadas | 2:37 |
| Ingeniería V7 | documentación, escenarios y validación verdes | 0:56 / 0:44 / 1:08 |
| Equipos V6 | accionamientos, motor, red verdes | 1:52 / 2:33 / 0:51 |
| Física V5 / simulación / automatización | verdes, incluido disparo entre ticks | 2:20 / 5:45 / 1:29 |
| Fusión / fixture puerta | verdes, sin cambios en picking/routing | 2:59 / 0:17 |
| Multiproyecto / componentes | verdes | 1:41 / 7:11 |
| Histórico | 13 fronteras verdes por agregado + focal, no 13/13 del primer intento | 12:42 agregado; focales 0:47 y 2:12 |
| Stress dirigido | 3 tamaños; 0 fallos | 10,78 s |
| entrega:check | bytes actuales; LF/CRLF idénticos | 22,24 s compilación |
| file:// V2–V8 | 67 comprobaciones; copia propia y descargas exigidas; 0JS/HTTP externo | 4:35 |

La campaña renovada de 9 suites terminó 9/9,345 comprobaciones,25:07. No sumar sus
comprobaciones a las filas anteriores: son evidencia solapada. Se cubrieron 30 suites
de navegador distintas entre histórico, especializadas, V8 y offline. Los fallos originales,
intentos invalidados y correcciones permanecen abajo; no se presentan como ejecuciones verdes.
CI se acredita exclusivamente por run/SHA terminal, no por este resumen local.

## Entorno inicial

El registro que sigue es cronológico: conserva rojos, interrupciones y pendientes de
checkpoints anteriores, aunque se hayan resuelto después. Para el estado vigente usa el
resumen superior, el último run/SHA terminal registrado y ESTADO.md; no un pase aislado.

2026-09-07: Windows/PowerShell, Node 24.19.0, npm 11.6.2 localizado en
bootstrap local existente; playwright-core 1.61.1, package-lock.json canónico.
Baseline a65cc0c, main/origin/tag V7 coincidentes, árbol limpio. No AGENTS.md aplicable encontrado.

## Evidencia heredada (no ejecutada nuevamente)

Cierre V7: 1182/1182, CI 33757125762 verde. Build 4FE91DB16B.
Esta evidencia acredita V7; no acredita cambios V8 futuros.

## Evidencia nueva

Preflight y diff-check inicial: correctos.
Focal baseline: typecheck app + tsc + node --test dist/test/ingenieria-*.test.js dist/test/fisica-v6-motor.test.js dist/test/repositorio-proyectos.test.js dist/test/gestor-documentos.test.js: 112/112, 0 fallos/skipped; 5,340 s Node.

Incremento a25cfc9: 8 regresiones nuevas de ingeniería, 69/69 ingeniería (6,989 s), typecheck/compilación verdes. Mutación controlada suma→máximo produjo rojo en oráculo 0,08+0,08 >0,1 A; retirada antes de commit.

Gestor candidatos, aún sin integrar UI: 33/33 (0,172 s), 13 casos nuevos, typecheck verde. Incluye fallos/quota/cancelación/stale/sesión/reapertura. Compensación posterior a commit conserva contenido mediante nueva revisión; no promete retroceder el sobre.

Pendiente: contratos V8, integración, UI, seguridad, stress y campaña final. Ninguna suite navegador V8 aún ejecutada.
# Integración V8 en desarrollo

- Typecheck app + compilación TypeScript: verdes.
- Focal `node --test dist/test/datos-tecnicos-*.test.js`:142/142;0fail/skip/cancel;372,7ms (último pase, sin tiempos de compilación).
- Build QA:392 módulos,5,99sVite;7,55s comando. No es paquete final.
- Campaña npm test parcial anterior:1265tests/1264PASS/1FAIL/0skip,53,71sNode; fallo exclusivo expectativa seis stores→siete. Corregida la expectativa; pendiente repetición completa.
- Stress100/1000/10000 productos y300bindings:3/3,12,18s. Importar+verificar p95:16,7/131,8/1155,8ms; resolver300 p95:30,5/37,5/37,6ms. Proyecto congelado máximo397177B, independiente de biblioteca1000→10000. El import UI ahora cede entre lotes de hashes; medir nuevamente al cierre.
- Mutaciones temporales rechazadas y retiradas: suma de corrientes→máximo, multiplicación factores→suma, interpolación LOG_LOG→LINEAR, elección Icn/Icu/Ics→Icu fija.
- Nuevos rojos reales cerrados: override de familia incompatible, canal PLC fantasma, selección de archivo inválido que conservaba candidato anterior, datos legacy recuperados con revisión rota, tarjetas de protección que leían datos originales en vez de efectivos.

La evidencia final de navegador/paquete/CI sigue pendiente. No confundir estos focales con campaña de entrega.

## Reanudación y cierre de la frontera parcialmente editada

- Log recuperado `tablerostudio-v8-unit-bloque-b.log`:1345/1345;0fail/skip/cancel;127894,4ms. Supera el rojo anterior de stores. No es evidencia final después de cambios posteriores.
- No procesos node-test/QA activos; último QA ingeniería no dejó resultado terminal recuperable. Su ejecución no se acredita.
- QA importación anterior:54/55;0JS/timeouts reportados,240s incluyendo limpieza. El caso de identidad observaba montaje antes de publicar el documento: ahora espera éxito visible; misma aserción mantenida, pendiente repetir.
- Reanudación: `tsc --noEmit -p tsconfig.app.json`, `tsc` verdes. Frontera protecciones+equipos+ValidationEngine47/47,236ms. Ampliación `node --test dist/test/ingenieria-*.test.js dist/test/datos-tecnicos-*.test.js`:213/213;0fail/skip/cancel;6222ms.
- El respaldo remoto es checkpoint de desarrollo, no V8 terminada. Main/entregable final todavía no se publican.

## Integración UI y candidato actual

- Backup normal confirmado: cf6ce24 en origin/v8/astra-datos-tecnicos; main a65cc0c sin cambios.
- Revisión de mapeos/equipos/empaquetador:41/41,0fail/skip,456,7ms. Commit e4d981e rechaza fuente heterogénea y burden AI multicanal ambiguos.
- QA ingeniería inicial41/41,347s,0JS/timeout/skip, bundle BcVoIw83. Se añadió después Undo/Redo al QA y captura de informe: pendiente candidato final.
- QA catálogo primera ejecución: dos fallos de sincronización/selector del propio QA (apertura asíncrona y dos botones Biblioteca); corregidos sin retirar aserciones. Repetición15/15,89,196s,0JS/timeout/skip, bundle h7a6Ex99.
- Capturas inspeccionadas realmente: ficha escritorio1440×960 y estrecha640×900 en qa-v8-catalogo-IrnXrz; comparación/tablas legibles en qa-v8-importacion-l8dcpu/02-comparacion.png. No acredita todavía reporte impreso final.
- QA importación inicial45checks alcanzados,1timeout a240s,0JS (log tablerostudio-v8-qa-importacion-retoma.log).
- Diagnóstico serial con trace y límite480s:55/55,334,49s (recorrido332,88;limpieza1,61),0JS/timeout/skip. Trace acciones-1/2.zip en qa-v8-importacion-Fagugt.55clics acumulan173s; no polling infinito. La segunda escena permanecía renderizando al crear destino limpio (clics8–9s). Ahora se cierra al terminar reapertura; todas las comparaciones permanecen. Límite8min basado en medición, no ocultación de rojo; supervisor12min conserva limpieza de árbol.
- `npm ci` real18s,49paquetes. Lock sin cambios; audit completo2dev heredadas, auditproducción0; análisis en SEGURIDAD.md.
- `npm test` final candidato5cdc6e5:1350/1350,0fail/cancel/skip,67874msNode,85,342scomando. Log tablerostudio-v8-unit-final.log. Incluye typecheckapp y compilación.
- QA V8 agregado en ejecución; log tablerostudio-v8-qa-final.log. No contabilizar terminado antes de exit terminal.
- Revisión posterior1bc67fc: conductor con dato pendiente no produce resultado resistivo usando default legacy; diagnóstico/rama NO_MODELADO.52/52 runtime+V5,0fail/skip,2120ms. Invalida el pase completo1350 para ese incremento; se renovará.
- QA agregado h7a6Ex99: catálogo1:24 e importación4:09 verdes; reducción frente a334s por cierre de escena innecesaria sin reducir cobertura. Ingeniería aún pendiente de exit.
- Pages baseline: configuraciónmain:/docs, portada HTTP404. Se añadió índice de documentación/descarga; validación remota200 pendiente hasta publicar.
- Agregado h7a6Ex99 terminó2/3,13:20: catálogo15checks1:24 e importación55checks4:09 verdes. Ingeniería43checks alcanzados,1fallo de API QA `Please use browser.newContext()` al capturar informe,466,3s;0JS/timeouts/skipped. Corregido contexto explícito, límite10min basado en duración ampliada y captura. No se eliminó evidencia de Undo/Redo. Repetición focal pendiente.
- Renovación tras1bc67fc: npm test1351/1351,0fail/cancel/skip,68955msNode/81,844scomando. BuildQA9SAqeOQ5,392módulos,6,37s.
- Stress serial final:3/3,0fallos,12,76s. p95import100/1000/10000=21,1/156,9/1654,4ms; resolver300p50/p95=30,4/36,3;40,9/42,5;47,9/52,0ms. Proyecto223357/397177/397177B. Son mediciones locales, no presupuesto de performance garantizado. Informe externo tablerostudio-v8-stress-1788834164338.json.
- Ejecución actual: `node qa/todas.mjs datos-tecnicos-ingenieria` sobre9SAqeOQ5, log tablerostudio-v8-ingenieria-final-2.log. CI todavía no acredita el candidato.

## Cierre de presentación y regresiones históricas

- Ingeniería final43/43,9:17,exit0,0JS/timeouts/skipped,9SAqeOQ5. Capturas reales mostraron columnas técnicas estrechas y residuos float; corregidos solo formato HTML/mensajes, sin redondear ecuaciones ni JSON/CSV.
- Frontera `tsc` + documentación12/12,0fallos/skipped,489,9ms. Primer pase detectó residuos float en la explicación Ib/In/Iz; se corrigió el mensaje generado, no el comparador ni su tolerancia.
- `herramientas/verificar-informe-v8.mjs`: informe público desde fixture y motor reales, sin dependencias HTTP ni JS errors. PDF A4 de4páginas71982B; cuatro páginas renderizadas con Poppler e inspeccionadas visualmente. Archivo externo qa-v8-informe-a4-R7IzEi. Tablas técnicas/ampacidad/condiciones sin recortes ni solapamientos. No se acredita una impresora física ni Excel.
- Captura inicial de ese comando con flags SwiftShader falló en Page.captureScreenshot; el informe no usa WebGL. Se eliminan esos flags únicamente del comprobador documental, con Chromium normal captura/PDF correctos. No altera navegador 3D.
- Gate histórico original11/13,12:42,252checks reportados,9SAqeOQ5. Rojos conservados en tablerostudio-v8-historico-final.log: abrir-atomico (preparación tras Nuevo con espera fija500ms) y se-guarda-solo (nombre durante transición de copia; ancho830sí se aplicó).
- Se mantiene bloqueo transaccional de producto. QA espera identidad/confirmación pública; abrir-atomico ahora limpia navegador/servidor también en excepción. Focal abrir-atomico verde0:47 (log tablerostudio-v8-historico-focal.log); primer autoguardado diagnóstico rojo1:15, log conserva nombre de copia. Tras esperar confirmación visible, autoguardado7/7,2:12,exit0 (tablerostudio-v8-autoguardado-final.log). Ninguna aserción retirada. Las13fronteras históricas quedan verdes por agregado+focal, no se presenta el agregado original como verde.
- Build posterior de presentación:392módulos,6,44s,index-46qzRhcg.js. Campaña especializada13suites en curso, log tablerostudio-v8-especializadas-final.log. Este cambio de presentación no invalida picking/cables/identidad ni autoría/imports ya probados; ingeniería documental se ejecuta sobre el bundle nuevo.

## Revisión independiente y correcciones finales

- Revisión ingeniería: reproducción real230→400V conservando vínculo230 producía PASS falso; supresión de rango analógico producía TypeError. Se corrigieron ambas fronteras, no solo las pruebas.
- Revisión seguridad:40combinaciones de espacios/rutas/campos rechazadas sin cambiar contenido firmado. Formulario alterado después de preview (también durante await) invalida generación/huella y exige recalcular; QA visible ampliado.
- Contexto de corte y seguridad:51/51,0fail/skip,543,9ms, log tablerostudio-v8-revision-focal.log. Incluye nominal conectado, AC/DC,1P fase-referencia/2P entre fases, orden y preservación.
- Analogía/runtime/evidencia disparo:44/44,0fail/skip,331,7ms, log tablerostudio-v8-revision-analogica-disparo.log.21casos analógicos retirando únicamente contrato no resoluble, canal vecino continúa; evento despejado sobrevive20ticks sin energizar red y desaparece al retirar/cambiar ensayo.
- Primer intento de compilar los tests nuevos detectó nombre erróneo `controladorId`; corregido a contrato real `dispositivoId`, sin retirar comparación.
- Agregación común monofásica: reproducción15A+15A/In25A daba dos PASS. Corrección/regresión de suma única, ausencia, orden y frontera multifase23/23,804,9ms, log tablerostudio-v8-demanda-compartida.log. Trifásica compartida no evaluable se declara indeterminada, no una suma escalar ficticia.
- Full renovado tras correcciones de analogía/disparo/contexto:1378/1378,0fail/cancel/skip,61421msNode, log tablerostudio-v8-unit-final-3.log. Posterior regla compartida requiere full final adicional. BuildCfUfls6e,392módulos6,69s.

## Campaña especializada e incidente de toolchain

Agregado46qzRhcg terminó8/13,23:09,206checksreportados (tablerostudio-v8-especializadas-final.log):

- automatizacion-plc2:41, cables-fusion4:13, componentes-personalizados7:11, equipos-v6-accionamientos1:52, equipos-v6-motor2:33, equipos-v6-red0:51, fixture-puerta0:17, ingenieria-documentacion: pases terminales.
- fisica-electrica23/26,154,6s,3fallos del mismo defecto: evidencia Icc/selectividad/despejada perdida al avanzar un tick. No fue tolerancia ni selector. Corrección de resultado runtime y prueba de dos avances visibles del reloj, manteniendo aserciones.
- ingenieria-escenarios, ingenieria-validacion, multiproyecto y simulacion-industrial no pudieron arrancar por ERR_MODULE_NOT_FOUND. Durante la campaña, un revisor invocó por error `pnpm exec`, cuyo shim inició una instalación y alteró node_modules. No se acredita ejecución de esas suites ni compilación del revisor.
- package.json/package-lock intactos; se retiraron exclusivamente los dos archivos nuevos pnpm-lock.yaml/pnpm-workspace.yaml tras comprobar Git. Sin reset/clean ni pérdida de código. `npm ci` real restauró49paquetes11s,exit0; log tablerostudio-v8-npm-ci-restauracion.log. Dependencias nuevamente canónicas antes del full1378/buildCfUfls6e. No se usa pnpm para cierre.

Campaña renovadaCfUfls6e (9suites) en tablerostudio-v8-cierre-revisiones-qa.log terminó exit0:
**9/9,345comprobaciones,25:07,0fallos/timeouts/skipped/erroresJS**.
Automatización1:29; catálogo15checks1:18; importación55checks3:36; ingenieríaV8 47checks7:08;
física2:20; escenarios0:44; validación1:08; multiproyecto1:41; simulaciónindustrial5:45.
Incluye cambios de formulario después del preview y quitar override antes de aplicar.
Las fronteras de fusión/puerta y componentes sin datos V8 no quedan invalidadas por contexto
de capacidad/contrato analógico condicionado. La suma común posterior tiene focal23/23 y
se incluye en el full definitivo y bundle de producción.

## Frontera de empaquetado

Primera compilación producción correcta (394módulos,17,93s), empaquetado rechazó CSS con
prefijo `./assets/`; no era un fallo de producto servido ni se dio por verde. Corrección6ff50c8
acepta únicamente prefijos locales equivalentes y mantiene rechazo de URLs/traversal.
Regresión1/1,164ms; BuildID C72A570F34 generado. Reconstrucción independiente de entrega
correcta22,24sVite: ambosHTML actuales, LF/CRLFidénticos. SHA/tamaño en ENTREGA.md.

## Candidato definitivo local

- `npm test`: **1379/1379**,0fail/cancel/skip/todo,62,552sNode/74,326scomando.
  Log tablerostudio-v8-unit-final-4.log. Incluye typecheckapp/tsc, demanda compartida y empaquetador.
  ReferenciaV7 1182:197testsnetos añadidos; ninguna prueba retirada. Ajustes legacy de expectativa
  de stores y contrato de protección, no exclusiones de cobertura.
- Stress renovado tras resolver final: **3/3**,0fallos,10,78s;100/1000/10000productos,300bindings,
  5muestras. Importp95 21,5/142,3/1341,6ms; resolverp50/p95 30,8/34,3;40,8/43,3;39,7/42,1ms.
  Proyecto223357/397177/397177B. Informe externo tablerostudio-v8-stress-1788839769223.json.
  No regresión atribuible frente a baseline local; variación CPU no es garantía de SLA ni
  una medida de virtualización de10000filas en navegador.
- `node qa/todas.mjs empaquetado`: **66/66,5:22**,exit0; V2–V8 conservados,0fail/skip/timeout,
  0erroresJS y0peticionesHTTPexternas. Log tablerostudio-v8-offline-final.log.
  Captura real qa/_salida/empaquetado.png inspeccionada: laboratorio, documentación y Build
  C72A570F34 visibles. No aprobación humana/Excel/impresora física inferida de esta inspección.
- InventarioCim después del smoke:0procesos propios QA/node/Chromium restantes.

## CI candidato

Pushnormal1459078 en ramaV8 confirmado. Run34185617560,attempt1: failure **antes de jobs**,
no tests ejecutados. Anotación pública: `.github/workflows/qa.yml` línea82 usa `runner.temp`
en env de job, contexto no disponible allí. Se mueve TMPDIR al env del paso QA, donde está
permitido; QA_V8_CAPTURAS constante y path de artifact se conservan. No cambia producto,
bundle ni evidencia local. Fuente: [anotación de Actions](https://github.com/Zziggurat/programa-/actions/runs/34185617560)
y [contextos admitidos](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability).

Run corregido34185765365,attempt1,4dcb650: jobs independientes, instalación npmci real.
Unit/build verde1:23; equiposV6 verde9:57; IngenieríaV7 verde12:37 (QA3/3,44checks,11:57).
Resto pendiente de terminal. Advertencia heredada de wrappers checkout/setup-node@v4 que
Actions ejecuta con Node24 por deprecaciónNode20: mantenimiento del toolchain, no cambio
del runtime de producto fijado24.19.0 ni permiso para habilitar Node inseguro.

Entregableoffline del mismo run: verde19:48. Reconstrucción actualC72A570F34; smoke66checks,
0JS/HTTPexterno; log tablerostudio-v8-ci-offline-candidato.log. Artifact
`TableroStudio-4dcb65077dff2e28c311ca080f86fa2ed7c5c5e6` descargado mediante gh a temporal
externo0a3e120ff9a949bdaab21e9c462c40da. **HTML extraído**,3308535B,
SHA2564b091b41761ab32e6758cf66342a74597e05f929cc8dbcd2e110cbe0d4f7822c idéntico a local.
No se utilizó hash del ZIP como prueba del HTML.

### Rojo V8 en CI y diagnóstico dirigido

Job101933659824 terminó rojo22:41: catálogo15checks3:50verde; importación48checks agotó
8min; ingeniería23checks agotó10min.0JS en ambos; los timeouts se conservan como rojos,
no como cobertura completada. Log tablerostudio-v8-ci-datos-rojo.log y artifactQA-V8 descargado
en temporal33bb76fbabc441459810064c3de9d553. Importación avanzó hasta reapertura y borrado
global; ingeniería hasta restaurar instalación/criterios: no hay un único selector atascado.

Diagnóstico local sobre mismos controles del laboratorio, cuatro clics por tamaño:
1440×1000=10,911s;960×720=6,666s;800×600=5,251s. Primera alternativa ratón→teclado
solo mejoró~10% y se descartó. El coste es sensible al área de la escena rasterizada;
no se atribuye a competencia entre jobs de CI alojados por separado.
`qa/_perf-formularios-v8.mjs` es diagnóstico manual, NO gate ni regresión funcional.

Se ajustan solo importación e ingeniería a800×600 durante formularios. Se conservan todos
los clics/aserciones/timeouts. Capturas de importación vuelven temporalmente a1440×960;
las documentales1440×1000. Catálogo mantiene escritorio/estrecha originales y offline
mantiene su ventana original. No cambian renderer, resolución interna, producto ni HTML.
Focal local compacto en tablerostudio-v8-qa-compacto.log: **2/2,102/102,4:56,exit0**.
Importación55/55=1:48 (antes3:36); ingeniería47/47=3:08 (antes7:08).0fail/timeout/skip/JS;
buildQACx2U8aN6,392módulos5,73s, producto idéntico al HTMLC72A570F34 ya entregado.
Captura comparación1440px inspeccionada; inventarioCim sin QA/Chromium propios al cerrar.
HashHTML nuevamente comprobado, intacto. Pendiente demostrar mejora en CI, no acreditada
por la sola medición local.

### Histórico remoto y preparación transaccional

CI34185765365 terminó36:45job histórico,12/13suites,261checks; rojo exclusivo mazo-puerta:
holgura90 no guardada y lazo151→151. Amarres, trenza y entradas posteriores sí pasaron.
Log tablerostudio-v8-ci-historico-rojo.log. El helper mirar esperaba chip oculto+600ms, pero
`aplicarEstructura → capturar → sePuedeEditar` rechaza cambios durante operación documental.
Ocultar el chip ocurre al montar; la confirmación del marcador activo termina después.

Helpers mirar/entorno esperan ahora confirmación pública de copia guardada, no una pausa fija.
Sin alterar guardas de integridad ni geometría. La suite mazo añade finally para cerrar también
en error. Focal mazo17checks1:13verde;2tests de contrato82,85ms prueban que chip oculto no
libera la espera y que ausencia de confirmación rechaza. Se renuevan full y fusión por el helper.
Run candidato previo concluye **4/6jobsverdes**, dosrojosdocumentados; no se declara aprobado.

Full renovado después de los dos tests del helper: **1381/1381**,0fail/skip/cancel/todo;
64,532sNode/76,781scomando, log tablerostudio-v8-unit-final-5.log. Ahora199testsnetos sobre1182.
No cambia bundle ni se invalida entrega/stress por tests y sincronización de preparación QA.
Fusión renovada tras helper:19checks2:57,exit0,0fallos/timeout/skip; log fusion-helper.
Incluye las mismas exigencias de selección frontal/semántica y ausencia de fusiones.

### Confirmación efímera en Windows/CI

Candidatocfd807a,run34188581519: Unit/build verde1:43; offline rojo4:23 al esperar20s que
el toast de copia siguiera visible. Log tablerostudio-v8-ci-offline-rojo-2.log. El toast se
oculta a3200ms (`dialogos.ts`); consultar visibilidad después del montaje es una carrera.
El HTML sigue reproduciéndose con SHA correcto; no se clasifica este rojo como empaquetado roto.

Se observa DOM público con MutationObserver **antes del clic**, sin alterar producto/modelo
ni notificaciones. Exige una nueva publicación visible del texto, no acepta una anterior;
conserva la observación después de ocultarse. Espera mantiene su límite20/30s tras montaje;
observador/timer/handle se liberan en finally. Helpercompartido único para mirar/entorno.
Regresión rápida3/3,87,68ms incluyendo mensaje anterior/expirado. Se renuevan full y
offline/mazo/fusión; no declarar cerrado hasta terminal. No se aumentan límites ni se cambian aserciones físicas.

Full posterior al observador:1382/1382,0fail/skip/cancel/todo,65,845sNode/77,897scomando;
log unit-final-6.200testsnetos sobreV7. Fusión renovada2:59verde; offline/mazo en curso.

Agregado observador terminó3/3,102checks,9:40: fusión2:59,offline5:29,mazo1:11;0fail/timeout/skip/JS.
También se aplica observación previa a las copias propias de ingenieríaV8 y smokeV8, conservando
sus clics reales. Focal final de esas dos llamadas en observador-vertical-final.log, pendiente.

CI34188581519 confirma mejora de tamaño de ventana: **V8 3/3,117checks,20:03QA**,20:56job;
catálogo5:18,importación5:27,ingeniería9:18.0timeouts/erroresJS/skipped, sin ampliar límites.
V6verde16:13,V7verde13:11; histórico todavía en curso. Offline rojo conocido de toast,
no declarar runcompletoverde. Log de V8 tablerostudio-v8-ci-datos-verde-2.log.

Run34188581519 terminó5/6jobsverdes: histórico13/13,263checks,29:38QA/30:23job; mazo2:35.
Único rojo remanente: toast efímero offline ya corregido en candidato local siguiente.
Focal final de copiasV8: **2/2,113checks,7:43**, ingeniería47checks2:47 y offline66checks4:56.
0fail/timeout/skip/JS; log observador-vertical-final. FocalNode3/3,89,28ms; no producto
modificado después del full1382. InventarioCim sin procesos propios restantes.

### Reapertura del diagnóstico offline (candidato daab691)

Run34190593360 vuelve a fallar offline4:40: el observador previo tampoco recibió la
confirmación. Por tanto, la explicación anterior de toast expirado **no explica por sí
sola el fallo remoto**. No acreditar el cierre por los pases locales anteriores.
Se añade historial acotado del DOM/notificaciones y errores JS al fallo, sin aceptar
confirmaciones distintas ni alterar el producto.

Diagnóstico local con `QA_CPU_RATE=4 node qa/empaquetado.mjs` reproduce otra carrera:
el helper opcional devuelve false antes de confirmar la carga; la prueba continúa,
falla al añadir y exporta luego el ejemplo original de17 aparatos
con `esEjemplo:true`. No es evidencia de una copia correcta. El recorrido ahora espera la
explicación (publicada después de finalizar mostrarEjemplo), exige copia y nombre propio;
la adición espera su resultado DOM en lugar de600ms. Sin aumentar el timeout de copia.
Este experimento no sustituye ni rebaja el gate normal. Resultado focal pendiente.

La repetición con carga confirmada falló a112,98s de recorrido: copia aún no montada
tras20s, sin erroresJS. Se aisló la operación con `_perf-copia-offline.mjs` (CPU×4,
ventana1440×900, mismo HTML), sin ejecutar el resto del smoke: **carga33,470s,
copia47,065s**, terminó con nombre propio correcto. No loop ni excepción ocultada.
Se adopta60s únicamente para copias offline, margen sobre medición, sin ampliar el
timeout global del gate ni debilitar identidad/edición/persistencia. Se repite la
frontera ralentizada y normal antes de confirmar.

El mismo CI34190593360 terminó V8rojo19:20job: **47 comprobaciones de ingeniería
pasaron**, pero `Page.captureScreenshot` no pudo capturar `informe-pantalla.png`.
No fue un timeout ni un fallo de validación eléctrica (117checksdelagregado).
El informe estático pasa ahora a un Chromium sin SwiftShader después de cerrar
el visor3D; conserva captura de pantalla e impresión. Es el método ya verificado
para la inspección A4 local; pendiente su regresión y CI, no se omite la captura.

La repetición CPU×4 con margen60s confirma copia/nombre, pero termina roja162,01s
por timeout30s del clic de inserción del catálogo,0erroresJS. Es diagnóstico de estrés
artificial, no un pase ni una condición de rendimiento mínimo prometida. No se modifica
el renderer ni se amplían otros plazos para ocultarlo. La frontera documental aislada
sí terminó (47,065s). Se ejecuta a continuación el gate normal offline+ingeniería.
Corrección de lectura:13 elementos DOM no acreditan un tablero previo; la lista depende
del espacio visible. La evidencia inequívoca de falta de copia fue `esEjemplo:true`
en el archivo exportado, no la diferencia13/17 por sí sola.

Focal normal posterior: **2/2,114 comprobaciones,7:28**, ingeniería47checks2:37,
offline67checks4:51,0fallos/timeouts/skips/JS. Log offline-informe-final; proceso71420
exit0. Capturas reales `qa-v8-informe-ivuYET/informe-{pantalla,impresion}.png` inspeccionadas,
legibles; PDF A4 de4páginas previamente acreditado se conserva. Focalhelper3/3,76,45ms.
InventarioCim sin QA/Chromium propios; ambosHTML conservan el SHA del manifiesto.
Commits08afb65 (capturaestática) y c9b320e (preparación/copia/diagnóstico). CIrenovado pendiente.

Run34190593360 terminó4/6verde, sin cancelaciones. Histórico13/13,263checks,
37:37QA/38:18job; V6 16:20,V7 13:27,unit/build1:23. Rojosoffline/capturaarriba.
Nuevo candidato dc5edff publicado normal: run34193274343,attempt1, pendiente de terminar.

Unit/build de ese candidato: **1382/1382**,0fallos/skipped,54,966sNode; buildQA4,22s,
job1:26. Log ci-unit-candidato-4. El resto de jobs todavía no se acredita por este pase.

V8 del candidato34193274343: **3/3,117checks,12:55QA/13:37job**;
catálogo3:21,importación3:31,ingeniería6:04.0fallos/timeouts/skips/JS.
V7 también verde13:32job. Artifact QA-V8 del SHA exacto descargado en
`%TEMP%/tablerostudio-v8-ci-evidencia-260d1256d69341bd9dde15d8956d8690`;
captura remota de informe y ficha estrecha inspeccionadas. Se generaron ambas
capturas del informe sin SwiftShader; no se saltó evidencia visual para pasar.

Offline de ese candidato: **67 comprobaciones, TODO OK**,27:00job; copia propia
confirmada,0erroresJS/HTTP externo. Log ci-offline-progreso-4. Artifact HTML del SHA
dc5edff descargado en `%TEMP%/tablerostudio-v8-html-candidato-936706ad00164495a9f305defac43fab`:
3308535bytes, SHA-256 `4b091b41761ab32e6758cf66342a74597e05f929cc8dbcd2e110cbe0d4f7822c`,
idéntico al manifiesto/blobsGit/ambas copias locales. No se aumentó el límite30min
del job. V6verde16:19 (32checks); V7verde13:32 (44checks). Histórico aún pendiente.

## Verificación del main integrado: navegación espuria tras descarga

Mainb6867cc,run34195775596: Pages34195773796 verde para el mismoSHA, HTTP200 y
descarga pública HTML con hash correcto. Unit1382/1382,0fallos/cancelados/skipped,
74,039sNode; buildQA5,26s. **Offline rojo9:11job**: Guardar ejecutó el clic, pero
Playwright esperó una navegación programada hasta agotar30s. Log ci-offline-main-rojo:
`click action done → waiting for scheduled navigations to finish`,0erroresJS.
No falló el nuevo contrato de copia ni la adición de aparato; ambos pasaron.

Se corrige exclusivamente QA: clics que producen archivos usan noWaitAfter, y la
espera obligatoria sigue siendo el evento download, saveAs/lectura y validación del
contenido/nombre. Se aplica al helper de descargas y las dos exportaciones V8 del
smoke offline. Sin omitir descargas ni aumentar plazos. No cambia producto/HTML.
El cierre público/tag sigue pendiente de la regresión renovada y CI del nuevoSHA.

Primer focal de Guardar:67/67,4:34,exit0. Se repite tras alinear también las dos
exportaciones V8 (portable e informe), pues ese cambio posterior afecta la evidencia
de ese helper. No repetir las suites de producto no afectadas por estos clics QA.

Focal definitivo con las tres acciones de descarga: **67/67,4:35,exit0**,
0fallos/timeouts/skips/JS/HTTP externo; log offline-descargas-unificadas.
No cambios de producto, assets ni HTML; el SHA del manifiesto se conserva.
Publicar el correctivo vuelve obsoleto el run34195775596: la concurrencia del workflow
puede cancelar sus jobs aún activos. Esa cancelación esperada no acredita esas suites;
la aprobación final requiere los seis jobs del nuevoSHA. El error original9:11 queda registrado.
