# Decisiones V9

## D01 — Orquestador, no segundo solver

El diseño asistido llamará al resolver técnico, motor de ingeniería, prospectiva y validación existentes. No duplicará fórmulas eléctricas ni mantendrá un resultado paralelo.

## D02 — Snapshot exacto y reproducible

Cada sesión congela proyecto base, identidad/hash técnico, objetivo, restricciones y revisiones exactas permitidas. Nunca consulta implícitamente «la última» revisión mientras evalúa.

## D03 — Cambios efectivos y acotados

Los planes solo pueden alterar campos expresamente autorizados. Sección y protección se aplicarán mediante la configuración técnica V8 que consume el resolver; quedan bloqueados topología, posición, cableado y cualquier entidad fuera del objetivo.

## D04 — Generación determinista y perezosa

BASE se evalúa una vez. Las alternativas de sección, protección y combinación se enumeran con identidad semántica canónica, orden estable, deduplicación y presupuesto explícito; no se materializa un producto cartesiano ilimitado.

## D05 — Viabilidad y cobertura honestas

Los estados son `FACTIBLE`, `INVIABLE`, `INDETERMINADO` y `ERROR`. La cobertura de búsqueda se informa como exhaustiva, limitada, cancelada o errónea. Un dato ausente jamás equivale a cero ni a aprobado.

## D06 — Ranking explicable

Se usa dominancia de Pareto para métricas comparables y preferencias lexicográficas visibles como desempate. No habrá un score único opaco.

## D07 — Reusar la frontera transaccional

La aplicación revalidará identidad/hash y datos exactos justo antes de mutar. Reutilizará el gestor de documentos, undo/redo y persistencia; un proyecto de ejemplo deberá copiarse antes de aplicar.

## D08 — Resultado dinámico no persistente

Se persisten solicitud/decisión aplicada y trazabilidad mínima. El análisis calculado se recompone y no se incorpora como segunda verdad del proyecto.
