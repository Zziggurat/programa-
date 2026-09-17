# Plan de entrega V9

Baseline: `tablerostudio-v8` / `4a0025f327c07d40bc104f614220a5e863a69165`.
Rama de trabajo: `v9/astra-diseno-asistido`.

## Gates

- [x] A0 — Frontera V8: demostrar cómo afectan realmente sección y protección al resolver técnico, prospectiva y validación.
- [x] A1 — Contratos V9: solicitud, snapshot congelado, cambios permitidos/bloqueados y resultado explicable.
- [x] A2 — Espacio de opciones: catálogo exacto, filas de ampacidad aplicables, identidad canónica y generación determinista acotada.
- [x] B — Evaluador común: BASE única, análisis V5–V8 completo, estados factible/inviable/indeterminado/error y cobertura honesta.
- [x] C — Ranking: dominancia de Pareto y preferencias lexicográficas visibles, sin puntuación opaca.
- [x] D — Sesión local: lotes cooperativos, progreso, cancelación, presupuesto y trazas reproducibles.
- [x] E — Aplicación: previsualización, validación de vigencia, operación transaccional, undo/redo y persistencia portable.
- [ ] F — Interfaz: flujo visible desde Ingeniería/incidencias, selección de objetivo, restricciones, resultados, comparación y aplicación.
- [ ] G — Fixture y datos: laboratorio pequeño `Diseño asistido V9 — conductor y protección`, sin inventar catálogo certificado.
- [ ] H — Informes e importación segura: HTML/JSON/CSV, evidencia, límites y rechazo de datos manipulados.
- [ ] I — QA y compatibilidad: pruebas rápidas, integración, navegador, offline y regresión V5–V8.
- [ ] J — Documentación, empaquetado y CI.
- [ ] K — Integración final, publicación y tag anotado `tablerostudio-v9`.

## Matriz de impacto

| Superficie | Riesgo V9 | Evidencia exigida |
|---|---:|---|
| Resolución técnica V8 | alto | el candidato modifica la revisión efectiva, no solo campos legacy |
| Prospectiva/protecciones | alto | punto de instalación correcto y capacidad de corte aplicable |
| Persistencia/portabilidad | alto | intención y decisión aplicada; no cachear resultados dinámicos |
| Transacciones/undo | alto | stale/tamper/rollback y una sola mutación coherente |
| UI Ingeniería | medio | uso humano sin hooks privados, responsive y cancelable |
| Simulación/3D/routing | bajo | ausencia de cambios funcionales no relacionados |

## Estrategia de validación

Durante desarrollo se ejecutarán `tsc` y pruebas focales. El gate completo se ejecutará al cerrar los bloques grandes y una sola campaña final cubrirá V9, V8, V7, V6, histórico, fusión, puerta, multiproyecto, componentes y offline.
