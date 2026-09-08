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
Siguiente acción exacta: push normal de respaldo de la rama V8 (main permanece V7); después build actual y QA ingeniería/importación, terminar edición de fichas, offline, campaña y CI. No V9.
