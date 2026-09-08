# Evidencia de validación V8

## Resumen local definitivo

| Frontera | Evidencia terminal vigente | Duración |
|---|---|---|
| npm test (incluye typecheck y compilación) | 1379/1379; 0 fallos, cancelados, skipped o todo | 74,326 s comando |
| Build QA / producción | 392 / 394 módulos; ambas correctas | 6,69 / 17,93 s |
| Catálogo V8 | 15 comprobaciones | 1:18 |
| Importación/portabilidad V8 | 55 comprobaciones | 3:36 |
| Ingeniería/revisiones V8 | 47 comprobaciones | 7:08 |
| Ingeniería V7 | documentación, escenarios y validación verdes | 0:56 / 0:44 / 1:08 |
| Equipos V6 | accionamientos, motor, red verdes | 1:52 / 2:33 / 0:51 |
| Física V5 / simulación / automatización | verdes, incluido disparo entre ticks | 2:20 / 5:45 / 1:29 |
| Fusión / fixture puerta | verdes, sin cambios en picking/routing | 4:13 / 0:17 |
| Multiproyecto / componentes | verdes | 1:41 / 7:11 |
| Histórico | 13 fronteras verdes por agregado + focal, no 13/13 del primer intento | 12:42 agregado; focales 0:47 y 2:12 |
| Stress dirigido | 3 tamaños; 0 fallos | 10,78 s |
| entrega:check | bytes actuales; LF/CRLF idénticos | 22,24 s compilación |
| file:// V2–V8 | 66 comprobaciones, 0 JS/HTTP externo | 5:22 |

La campaña renovada de 9 suites terminó 9/9,345 comprobaciones,25:07. No sumar sus
comprobaciones a las filas anteriores: son evidencia solapada. Se cubrieron 30 suites
de navegador distintas entre histórico, especializadas, V8 y offline. Los fallos originales,
intentos invalidados y correcciones permanecen abajo; no se presentan como ejecuciones verdes.
CI se acredita exclusivamente por run/SHA terminal, no por este resumen local.

## Entorno inicial

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
