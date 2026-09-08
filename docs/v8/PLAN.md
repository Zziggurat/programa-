# TableroStudio V8 — plan de ejecución

## Alcance y baseline

Encargo completo en [ENCARGO.md](ENCARGO.md). Baseline verificado: main/origin/main/tag V7
en a65cc0cbb304cb153d5aaa030a39ad7400438a03, árbol limpio, 0/0. Rama:
v8/astra-datos-tecnicos. Toolchain existente: Node 24.19.0, npm 11.6.2,
playwright-core 1.61.1, package-lock.json canónico.

Los gates son checkpoints, no pausas. Producto V2–V7 conservado. No V9 ni refactor global.

## Matriz de alcance antes de extender schemas

| Requisito | Módulo existente | Cambio V8 previsto | Prueba de aceptación |
|---|---|---|---|
| Catálogos/productos/revisiones | componentes/personalizados, persistencia | contratos técnicos independientes; identidad/revisión/hash inmutables | idempotencia, conflicto, variantes, dominio, hash |
| Procedencia/aplicabilidad | modelo/fisica, ingenieria/validacion | dato por campo; fuente declarada/revisión humana; resolución central | sintético preservado, cero/false, inaplicable, datos ausentes |
| Único dato efectivo | motores/simulacion, fisica/topologia-proyecto, ingenieria/engine | proyección pura de Proyecto para motores y documentos | legacy idéntico, equivalencia nativo/personalizado, no mutación |
| Vínculos/overrides | Proyecto, cargar, repositorio, gestor-documentos | referencias fijadas y subconjunto compartido; adopción explícita | escritura/cuota/cancelación/cambio proyecto/rollback |
| Portabilidad | repositorio.exportarPaquete/importarPaquete | snapshot técnico mínimo y dependencias transitivas | almacenamiento limpio/offline, borrado global, revisión independiente |
| Icn/Icu/Ics y curvas | ingenieria/protecciones, fisica/protecciones | entradas condicionadas; magnitud elegida por criterio | tensión/sistema incompatibles, Icc e Icu independientes |
| Icc prospectiva | fisica/fallas, ingenieria/protecciones | adaptador aislado solo si necesario; punto/contexto explícitos | ausencia red vs análisis pendiente; no fallo runtime persistido |
| Bobinas/PLC/analógicas | comportamiento, compatibilidad, fisica/analogicas | adaptación de campos soportados con condiciones y límites | sostenida/llamada, canal/grupo incompleto, burden/compliance |
| Motor/VFD/trafo/fuente | modelo/fisica, motores y topologia-proyecto | mapeos tipados a modelos ya existentes | valores de placa, balance, sin doble conteo |
| Ampacidad | ingenieria/conductores | tablas, lookup, factores permitidos, instalación por conductor | 30×0.94×0.80=22.56; dominio, duplicados, temperatura |
| Criterios | modelo/ingenieria, circuitos | perfiles fijados, overrides parciales, desactivación explícita | Ib=22/In=25/Iz=22.56 falla coordinación; cero/ausencia |
| Datos faltantes | validacion, ui-ingenieria Issue Center | issues técnicos y cobertura; acción resolver | MISSING/CONFLICT/OUT_OF_DOMAIN/UNVERIFIED/STALE |
| Comparar/adoptar revisión | escenarios, aplicarEscenarioTransaccional | preview técnico vinculado a hash BASE y candidato | PASS→FAIL, preview puro, stale/rollback |
| UI completa | ui-ingenieria, Mis Componentes, ventanas | Datos técnicos integrado; formularios ordinarios | buscar, publicar, vincular, overrides, instalación, criterios, revisar |
| Import/export seguro | cargar, personalizados, CSV/HTML | parser limitado y allowlist; manifest/hashes/deps | pollution, profundidad, no finitos, URLs, XSS, fórmulas |
| Informes | ingenieria/documentacion, csv | trazabilidad/revisiones/ampacidad/criterios/cobertura | snapshots reproducibles, BOM bytes, HTML offline/imprimible |
| Rendimiento | índices y repositorio existentes | índices explícitos y perfil dirigido | 100/1000/10000 productos, cientos de vínculos, p50/p95 |
| Entrega | qa/todas, workflows/qa, empaquetar | QA V8 separado, smoke file V8, CI y tag | campaña completa, HTML idénticos, artifact descargado/hash |

## Gates y dependencias

A0 revisión dirigida → A contratos/hashing → B resolver → C transacciones/portabilidad →
D integración física/ingeniería → E ampacidad → F criterios → G issues/cobertura →
H comparación → I UI/documentación completa → J seguridad/fixtures/stress/revisión →
K campaña final/entrega/CI/publicación.

Integrar pronto catálogo → vínculo → validación visible; completar después todos los recorridos.
Dos revisores independientes como máximo, sin ediciones simultáneas en fronteras centrales.

## Criterios de cierre

Todos los flujos de la sección 26 operables sin editar JSON. Matriz de casos sección 28 cubierta.
Campaña final sección 34 completa con exit terminal y bundle identificado. Nuevos artefactos
reproducibles, CI candidato/main y Pages verdes, tag V8 inmutable y handoff V8.
No aceptar resultados calculados a partir de datos sintéticos como selección certificada.
