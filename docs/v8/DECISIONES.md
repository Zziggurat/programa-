# Decisiones V8

## D01 — Fuentes de verdad

El proyecto guarda decisiones/vínculos exactos y un subconjunto técnico congelado compartido.
Los catálogos globales almacenan revisiones inmutables; nunca se usa latest para evaluar.
El runtime y los resultados no entran en el documento técnico.

## D02 — Integración incremental

Resolver y proyección pura hacia los contratos existentes. No duplicar PhysicsEngine ni las reglas
de Ingeniería. Un proyecto sin V8 debe continuar por el recorrido legacy conservado.

## D03 — Datos de ensayo

Datasets sintéticos explícitos; hash prueba integridad, no autenticidad. El estado humano/documental
es independiente de lo declarado en un import. Sin descarga automática de fuentes documentales.

## D04 — Flujo Git

Rama V8 desde baseline; commits semánticos. Integración convencional autorizada al terminar,
con preflight de main remoto y checks. Nunca mover tag V7 ni usar force.
