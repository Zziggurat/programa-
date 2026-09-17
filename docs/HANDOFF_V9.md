# TableroStudio V9 — diseño asistido determinista

## Estado de entrega

V9 parte de `tablerostudio-v8` (`4a0025f327c07d40bc104f614220a5e863a69165`).
La entrega final se identifica por el tag anotado `tablerostudio-v9`; debe resolver al
mismo commit que `main` y a una ejecución de siete jobs verdes. Consulta el
[manifiesto](v9/ENTREGA.md), la [validación](v9/VALIDACION.md), la
[matriz](v9/MATRIZ.md), el [recorrido](v9/USO.md) y las [decisiones](v9/DECISIONES.md).

## Arquitectura

`src/diseno-asistido/tipos.ts` define solicitud, snapshot, referencias exactas, cambios,
estados, cobertura y trazabilidad. `core.ts` congela la BASE, filtra el universo declarado,
genera candidatos perezosos y ejecuta el motor común V8. `sesion.ts` añade lotes,
presupuesto, progreso y cancelación. `documentacion.ts` produce/valida HTML, JSON y CSV;
un informe importado nunca se autoaplica.

`app/ui-ingenieria.ts` contiene el flujo humano de Diseño. Aplicar pasa por las operaciones
transaccionales existentes y vuelve a comprobar vigencia e integridad; preview no muta,
fallo conserva BASE y una aplicación combinada es una sola entrada de undo/redo. El
proyecto persiste intención y decisión, no métricas dinámicas del solver.

El laboratorio sintético está en `ejemplo/diseno-asistido-v9.ts`; se localiza por identidad,
no por posición. `qa/diseno-asistido-v9.mjs` cubre el vertical slice visible y
`qa/lib/diseno-asistido-offline.mjs` lo repite sobre el HTML autónomo.

## Contratos que no deben romperse

1. V9 solo cambia sección y una revisión de protección dentro de la frontera declarada.
2. BASE se evalúa con el mismo motor que cualquier candidato y puede ser la recomendación.
3. Las revisiones son exactas; no usar «latest» ni mezclar campos de dos fichas.
4. Ausencia de datos produce `INDETERMINADO`, nunca cero o un default oculto.
5. `LIMITADA`/`CANCELADA` no afirma inexistencia de otras soluciones ni óptimo global.
6. Pareto y preferencias son visibles; no introducir una puntuación opaca.
7. La procedencia sintética sigue siendo sintética tras aplicar, guardar o exportar.
8. Snapshot/hash prueban integridad y reproducibilidad, no autenticidad ni certificación.
9. Importar un informe valida límites/allowlist/hash y reevalúa; jamás reproduce una
   mutación antigua sobre otro proyecto.
10. Imagen, marca y texto visible no deciden semántica eléctrica.

## Comandos de mantenimiento

- `npm test` — TypeScript y pruebas rápidas completas.
- `npm run editor:build -- --mode qa` — build del editor para QA.
- `npm run qa:diseno` / `npm run qa:diseno:run` — vertical slice V9.
- `npm run qa:diseno:stress` — catálogo sintético 10.000, evaluación acotada.
- `npm run empaquetar`, `npm run entrega:check`, `npm run qa:empaquetado` — entrega.
- `npm run qa` y los gates especializados — compatibilidad histórica.

## Límites y backlog

V9 no rediseña topología, cargas, rutas, PE, geometría ni criterios. No demuestra
compatibilidad mecánica de una protección si faltan dimensiones/terminales, no certifica
norma/selectividad/fabricación y no consulta catálogos externos. `EXHAUSTIVA` solo se
refiere al universo finito declarado; el estrés medido no es un SLA.

Backlog explícito: datos documentales aportados con derecho de uso, compatibilidad mecánica
rica, estrategias de búsqueda para universos mayores y optimización del visor por separado.
No se inició V10.
