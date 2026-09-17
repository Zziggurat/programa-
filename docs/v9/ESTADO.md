# Estado V9

Actualizado: 2026-09-17.

## Estado durable

- Rama: `v9/astra-diseno-asistido`.
- Baseline: `4a0025f327c07d40bc104f614220a5e863a69165` (`tablerostudio-v8`, `origin/main`).
- V8 permanece intacta; V9 se implementa encima de sus contratos de datos técnicos, ingeniería y transacciones.
- Encargo maestro preservado en `docs/v9/ENCARGO.md`.

## Gates A0–I cerrados

La inspección dirigida confirmó y fijó dos fronteras:

1. V9 aplica sección sobre el campo legacy y, cuando existe vínculo técnico, mediante un `OVERRIDE` persistente explícito; la prueba comprueba el valor después de `resolverProyectoTecnico`.
2. La protección se sustituye por una revisión exacta completa y decisiones `CATALOGO` de esa ficha, sin conservar campos de otra revisión. Cada candidato ejecuta `ejecutarIngenieria` y usa `analisis.prospectiva` en el punto configurado.

El núcleo ya incluye snapshot reproducible con algoritmo/Build ID y fronteras bloqueadas explícitas, espacio de opciones perezoso por filas de ampacidad aplicables, BASE/sección/protección/combinados, estados honestos, Pareto, presupuesto, cancelación, preview transaccional, stale/tamper, persistencia de la intención/decisión e informes HTML/JSON/CSV. Las opciones sin efecto, retiradas, incompatibles, sintéticas sin autorización o bloqueadas por una decisión conservada se excluyen con motivo.

El laboratorio versionado está en la biblioteca y la vista `Ingeniería → Diseño` permite seleccionar circuito/conductores, secciones, protección y revisiones exactas; muestra progreso/cancelación, cobertura, evidencia, ranking y preview. La prueba de navegador acreditó aplicación combinada, undo/redo, persistencia y reapertura.

Gate activo: J — revisión de seguridad/rendimiento y documentación de entrega; K queda reservado a campaña integrada, offline, CI, publicación y tag.

## Procesos y pruebas

- `tsc` y `tsc --noEmit -p tsconfig.app.json`: verdes.
- Pruebas V9 rápidas: 23/23, 0 fallos, 0 skipped, 1,056 s.
- Build QA: verde, 398 módulos, 8,02 s.
- `node qa/diseno-asistido-v9.mjs`: 16/16, 0 errores JS, 292,8 s.
- Medición sintética: 10.000 productos, universo estimado de 30.003 y evaluación limitada a 25; generación perezosa 0,94 ms y heap final aproximado de 105 MiB. Es una observación de desarrollo, no un SLA.
- No se reutiliza evidencia de tests anterior al cambio V9.
