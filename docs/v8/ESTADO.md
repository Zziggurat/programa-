# Estado durable V8

Rama / baseline: v8/astra-datos-tecnicos / a65cc0cbb304cb153d5aaa030a39ad7400438a03.
Checkpoints existentes: a25cfc9 (ingeniería de perfiles/sumas); fb55b57 (candidatos documentales y rollback);5099464 (revisiones/adopción);9f6ad23 (cálculos condicionados);48e23a8 (snapshot runtime). Integración de ingeniería y cobertura cerrada en el siguiente checkpoint semántico.
Gate e incremento actual: A–H implementados en integración; I/J UI, seguridad, documentación y QA navegador en ejecución. No cierre final.
Trabajo pendiente de checkpoints: contratos/schema/hash/resolver/repositorio técnico, cálculo condicionado, motores consumidores, UI, QA y documentación.
Decisiones vigentes: npm/package-lock; máximo dos revisores; proyección pura común y snapshots runtime, referencias exactas congeladas; importación cooperativa cancelable.
Pruebas realmente ejecutadas: focal V8 142/142, 0 fallos/skipped (0,373 s, compilación aparte); baseline focal112/112; gestor33/33; mutaciones suma→máximo, producto→suma y LOG_LOG→LINEAR rechazadas y retiradas.
Campaña completa recuperada del log tablerostudio-v8-unit-bloque-b.log:1345/1345,0fail/skip/cancel,127894ms. Posterior a ese pase cambiaron ValidationEngine/protecciones y UI: evidencia completa NO vigente para el candidato final.
Reanudación: typecheck/tsc verdes; frontera protecciones/cobertura47/47 (236ms); ingeniería+datos técnicos213/213 (6222ms). Añadidas regresiones para Ics no usada que no invalida In/Icu y carga desconocida que no desaparece de la suma.
Pruebas pendientes: QA UI V8, campaña completa, paquete offline, CI/Pages y tag.
Proceso activo: ninguno al recuperar. Último typecheck y QA ingeniería no conservaron evidencia terminal recuperable; no se contabilizan verdes. QA importación anterior54/55, un rojo de sincronización de identidad (espera toast corregida, pendiente repetir). No quedan procesos QA/node-test activos.
Build QA V8 realizado:392 módulos, Vite5,99s (comando7,55s). No paquete producción V8 ni Build ID final todavía.
Run/attempt/job CI: ninguno V8.
Bloqueos: ninguno.
Respaldo realizado: cf6ce24 local == origin/v8/astra-datos-tecnicos. main remoto conserva a65cc0c. Push normal, no integración parcial.
Último QA ingeniería:41/41,0fallos/timeouts/skipped/JS,347s, build BcVoIw83. Posterior ajuste UI de foco/cambio documento y dos límites de mapeo requiere repetición focal de UI final.
QA importación con build vA3gR64j:45 comprobaciones alcanzadas,1timeout total a240s,0JS; no completó reapertura. Log tablerostudio-v8-qa-importacion-retoma.log. En diagnóstico serial con trace y límite operacional480s por variable, sin reducir aserciones. No aprobado aún.
Focal revisión de mapeos+empaquetador:41/41,0fallos/skipped,456,7ms. CSS modular se incorpora al paquete respetando cascada y CSP.
Checkpoints nuevos: e4d981e (mapeos ambiguos),38297b0 (informes/fixture),f841916 (CSS/CSP offline),5cdc6e5 (UI/adopción).
Candidato núcleo: npm ci real18s y npm test1350/1350,0fail/skip/cancel,85,342scomando. No cambios posteriores de producto por ahora.
QA catálogo15/15,89,196s; QA importación instrumentado55/55,334,49s. Se corrigió página WebGL anterior innecesaria y límite medido8min. Ver VALIDACION para el rojo original y diagnóstico.
Agregado anterior terminó rojo: catálogo/importación verdes, ingeniería43aserciones verdes pero fallo de API Playwright al crear pestaña de captura. Log tablerostudio-v8-qa-final.log,13:20total. No se presenta como gate verde.
Incremento posterior1bc67fc: PhysicsEngine marca conductor con datos técnicos pendientes como NO_MODELADO, sin rescatar valores genéricos. Frontera runtime+V5 52/52,0fail/skip,2,120s. Renovar npm test/build y frontera ingeniería para este cambio; catálogo/importación usan rutas no afectadas.
QA catálogo1:24 e importación4:09 verdes sobreh7a6Ex99 (rutas no afectadas por1bc67fc). Ingeniería usa ahora contexto explícito y límite10min basado en466smedidos con Undo/Redo; supervisor12min intacto.
Pages configurado main:/docs devuelve404 en portada. Añadido docs/index.md de entrega/documentación; comprobar200 tras publicar main.
Último núcleo renovado:1351/1351,0fail/cancel/skip,68955msNode,81,844scomando. Log tablerostudio-v8-unit-final-2.log. Build9SAqeOQ5,392módulos,6,37s.
Stress finalserial:3/3tamaños,0fallos,12,76s; informe tablerostudio-v8-stress-1788834164338.json. Proyecto397177B para1000y10000productos; resolver300p95hasta52ms.
Ingeniería final43/43,9:17,exit0,0JS/timeouts/skipped; log tablerostudio-v8-ingenieria-final-2.log sobre9SAqeOQ5. Captura real detectó columnas técnicas estrechas y residuos float en HTML; ajuste de presentación en curso (no cálculo). Frontera documentación12/12 verde,489,9ms.
Histórico9SAqeOQ5:11/13,12:42,252comprobaciones reportadas. Rojos abrir-atomico y se-guarda-solo por edición antes de finalizar transición documental. Primer focal abrir-atomico verde0:47; autoguardado conservó ancho830pero nombre de copia, se añade espera de confirmación pública sin retirar aserciones. Logs tablerostudio-v8-historico-final.log y tablerostudio-v8-historico-focal.log.
Autoguardado final7/7,2:12,exit0. Informe A4 real4páginas inspeccionadas sin recortes/solapamientos; comprobador público herramientas/verificar-informe-v8.mjs sin HTTP/JS. Commits be95ed2(presentación/A4) y b8600a6(QA espera documental), todavía locales.
Proceso actual: node qa/todas.mjs ingenieria- equipos-v6 fisica-electrica simulacion-industrial automatizacion-plc cables-fusion fixture-puerta multiproyecto componentes-personalizados, sesión53337, log tablerostudio-v8-especializadas-final.log. Build46qzRhcg,392módulos,6,44s. Primera suite automatizacion-plc verde2:41. Dos revisores de solo lectura reintentados, no contar revisión hasta respuesta.
Siguiente acción exacta: terminar campaña especializada sin repetir rutas verdes no afectadas; generar/verificar offline con smoke V8; CI/main/tag solo tras verde. No V9.
