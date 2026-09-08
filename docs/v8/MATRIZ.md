# Matriz de implementación y aceptación V8

Esta matriz identifica pruebas y fronteras. La evidencia terminal vigente está en
VALIDACION.md; «implementado» no equivale a campaña/entrega aprobada.

| Frontera / requisito | Implementación | Regresión / evidencia |
|---|---|---|
| Catálogos independientes de imagen/perfil | `src/datos-tecnicos/tipos.ts`, `campos.ts` | `datos-tecnicos-integridad.test.ts`, runtime equivalente nativo/importado |
| Revisión exacta, inmutable, hash canónico | `hash.ts`, `repositorio.ts` | Hash contra crypto, reordenación, dependencia/hash erróneo, import repetido y conflicto |
| Procedencia por campo y revisión humana separada | `schema.ts`, `resolver.ts`, `repositorio.ts` | Rechazo de revisión humana importada; ficha/CSV/HTML y reimport sintéticos; QA catálogo |
| Condiciones AC/DC/V/Hz/temperatura/ajuste/contexto | `condiciones.ts`, `resolver.ts` | Variantes ambiguas/inaplicables, ausencia, rangos y unidades |
| Precedencia/override/supresión | `resolver.ts`, `operaciones.ts` | Conservar, override, campo eliminado, quitar override y ausencia sin rescate |
| Proyecto legacy sin catálogo | Bypass explícito sin datos V8 | Tests V2–V7 y campaña histórica sin cambio de fixtures |
| Guardado atómico/rollback/identidad | `app/gestor-documentos.ts`, preparación de candidato en `main.ts` | `gestor-documentos.test.ts`, cuotas, stale, fallo de montaje; QA ingeniería Undo/Redo |
| Frozen mínimo y assets portables | repositorio/proyecto + `congelarSubconjunto` | `datos-tecnicos-operaciones/repository` tests; QA importación limpia y borrado global |
| Icc y capacidad de corte independientes | `ingenieria/prospectiva.ts`, `protecciones.ts` | Icc sin Icu y viceversa; Icn/Icu/Ics elegidas; Ics no usada; retorno real; ensayo aislado |
| Curvas condicionadas y runtime común | `curvas.ts`, integración física/runtime | Interpolación aritmética, límites, sin fallback genérico, tiempo simulado, mismo snapshot |
| PLC y bobina | `ingenieria/compatibilidad.ts`, resolver | Suma sostenida/llamada, grupos por IDs, desconocido distinto de cero, canal fantasma |
| Analógicas | mismo contrato físico V5 y compatibilidad | Burden/compliance/cable explícitos, dos fuentes ambiguas, AI multicanal no sobrescrita |
| Motor/VFD/fuente/transformador | proyección tipada a perfiles existentes | `datos-tecnicos-runtime.test.ts`; tensiones heterogéneas rechazadas; no duplicar fuentes |
| Ampacidad | `ampacidad.ts`, instalación por conductor | 30×0,94×0,80=22,56; tuple completo, cero/ausencia, no extrapolación/doble factor |
| Ib ≤ In ≤ Iz | `ingenieria/conductores.ts` | Ib22/In25/Iz22,56 falla; upstream por trayecto, no array; UI laboratorio Ib10 |
| Criterios versionados | `criterios.ts`, config por circuito/proyecto | Herencia y overrides parciales; cero/false; desactivación no oculta datos faltantes |
| Issue Center único | `ingenieria/datos-tecnicos.ts`, `validacion.ts`, UI ingeniería | MISSING/CONFLICT/aplicabilidad/fuente/STALE y cobertura por dependencia |
| Actualización explícita, preview puro | `operaciones.ts`, `ui-datos-tecnicos.ts` | BASE intacta/cancelación/confirmación; r1→r2 empeora; overrides preservados |
| Autoría y consulta visibles | `app/ui-datos-tecnicos.ts` | QA catálogo: borrador, editar, publicar, buscar, filtrar, exportar, foco y recarga |
| Datos faltantes y criterios visibles | mismo panel y rutas desde Ingeniería | QA ingeniería: instalación ausente, criterio desactivado, restaurar y validar |
| Seguridad de imports | `schema.ts`, `hash.ts`, import cancelable | Límites, pollution, enums, no finitos, URLs, manifest; QA hostil y válido→inválido |
| Informes únicos V7 ampliados | `ingenieria/documentacion.ts` | Snapshot determinista, HTML/CSV, hash/revisión/procedencia, BOM y fórmulas |
| Biblioteca grande y cientos de vínculos | índices + frozen compartido | `herramientas/medir-datos-tecnicos.mjs`,100/1000/10000,300bindings,p50/p95 |
| Offline/CSP/bytes de entrega | `app/empaquetar.mjs` | Test CSS/cascada/CSP; `entrega:check`; smoke file V2–V8 |
| CI/main/tag | workflows Pruebas/instaladores | Pendiente estados terminales del SHA final, Pages y artifact descargado |

## Defectos nuevos detectados y corregidos

- Identidad de candidato ligada a sesión/documento y compensación si falla el montaje.
- Suma de cargas PLC en lugar de elegir un elemento o máximo; desconocido no equivale a cero.
- Override de familia incompatible y canal PLC inexistente no pueden proyectarse.
- Una revisión rota no autoriza recuperar datos anteriores como si estuvieran resueltos.
- Parámetros físicos de conductor pendientes generan diagnóstico y rama NO_MODELADO.
- Tarjetas de protección utilizan la proyección efectiva, no los valores originales.
- Ics no utilizada no bloquea una evaluación independiente de In/Icu.
- Elegir archivo inválido después de válido invalida la confirmación previa.
- Cambio de documento limpia filtros/selecciones técnicas dependientes y previews.
- Modal usa el gestor central de foco/inercia; no mantiene otra pila de teclado.
- CSS modular se incluye en HTML offline y CSP manteniendo cascada.

## Límites, no funciones pendientes encubiertas

No certificación de datos/normas/selectividad; no autenticidad inferida de hashes.
Fuentes con tensiones heterogéneas requieren identificación de salida no modelada por un campo
nominal común. Impedancia AI individual multicanal no se proyecta sobre la común del equipo.
Icc prospectiva no soportada se declara como tal. Datos técnicos avanzados importables no
constituyen un editor universal de tablas normativas. No V9 ni física nueva fuera de estos adaptadores.
