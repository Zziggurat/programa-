# Evidencia de validación V8

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
