# Validación V9

## Preflight

| Comprobación | Resultado |
|---|---|
| Rama de partida | `main` limpio |
| HEAD local/remoto | `4a0025f327c07d40bc104f614220a5e863a69165` |
| Tag V8 | resuelve al baseline |
| Rama V9 | `v9/astra-diseno-asistido` creada desde V8 |
| Divergencia inicial | 0/0 |
| Trabajo V9 previo | ninguno |

## Evidencia por gate

### Checkpoint núcleo V9

| Comando | Resultado | Duración |
|---|---|---:|
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json` | verde | incluida en 18,9 s con `tsc --noEmit` |
| `node node_modules/typescript/bin/tsc` | verde | 7,8 s |
| `node --test dist/test/diseno-asistido-v9.test.js` | 12/12; 0 fallos; 0 skipped | 0,668 s |

Las pruebas cubren cambio efectivo tras resolver V8, revisión exacta sin Frankenstein, prospectiva por punto, ampacidad, determinismo por orden, combinados obligatorios, Pareto, presupuesto/cancelación, transacción, stale/tamper, roundtrip e informes seguros.

## Campaña final prevista

1. unitarias/TypeScript y build QA;
2. QA V9 focal y offline;
3. gates V8/V7/V6;
4. histórico, fusión, puerta, multiproyecto y componentes;
5. artifact, Pages, hash/bytes y tag anotado sobre el SHA final.
