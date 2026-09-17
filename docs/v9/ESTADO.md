# Estado V9

Actualizado: 2026-09-17.

## Estado durable

- Rama: `v9/astra-diseno-asistido`.
- Baseline: `4a0025f327c07d40bc104f614220a5e863a69165` (`tablerostudio-v8`, `origin/main`).
- V8 permanece intacta; V9 se implementa encima de sus contratos de datos técnicos, ingeniería y transacciones.
- Encargo maestro preservado en `docs/v9/ENCARGO.md`.

## Gates A0–E cerrados

La inspección dirigida confirmó y fijó dos fronteras:

1. V9 aplica sección sobre el campo legacy y, cuando existe vínculo técnico, mediante un `OVERRIDE` persistente explícito; la prueba comprueba el valor después de `resolverProyectoTecnico`.
2. La protección se sustituye por una revisión exacta completa y decisiones `CATALOGO` de esa ficha, sin conservar campos de otra revisión. Cada candidato ejecuta `ejecutarIngenieria` y usa `analisis.prospectiva` en el punto configurado.

El núcleo ya incluye snapshot reproducible, espacio de opciones por filas de ampacidad aplicables, BASE/sección/protección/combinados, estados honestos, Pareto, presupuesto, cancelación, preview transaccional, stale/tamper, persistencia de la decisión e informes HTML/JSON/CSV.

Gate activo: F — integrar el flujo visible en Ingeniería y el laboratorio versionado en la biblioteca de ejemplos.

## Procesos y pruebas

- `tsc` y `tsc --noEmit -p tsconfig.app.json`: verdes.
- `node --test dist/test/diseno-asistido-v9.test.js`: 12/12, 0 fallos, 0 skipped, 0 timeouts.
- No se reutiliza evidencia de tests anterior al cambio V9.
