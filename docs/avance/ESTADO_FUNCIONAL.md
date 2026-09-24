# Campaña funcional hacia 1.0 — estado vigente

## Referencia y alcance

- Contrato: `docs/avance/TABLEROSTUDIO_MASTER_SPEC.md` (versión 1.0, 2026-09-22). El original aportado tenía SHA-256 `350ce427bcd0e4989a424def5334f664edeee90808a20a068def0bfe6e13bea8`.
- Baseline verificado: `main`, `origin/main` y `tablerostudio-v9` en `4c2924c4d12f4dc0982a7f0bf28d94e52b00366f`. Repositorio `Zziggurat/programa-`.
- Rama de desarrollo: `roadmap/1.0-functional`. `main` sigue como referencia estable. No publicar una versión 1.0 al terminar esta campaña.
- Estado terminal buscado: `FUNCTIONAL_COMPLETE`, antes de los encargos separados de arquitectura/datos y Project Breaker.

## Hitos

| Hito | Estado | Frontera actual |
|---|---|---|
| M0 · preparación | EN_CURSO | R1 sintético 30/100 en SwiftShader. Reconciliación de mallas 98→10 y tres cortes focales de rejilla conservan 5/5 hashes exactos; reparto Node R1+drag ~4,98 s en una medición reciente y −34,2 % pareado en el último corte. No confundirlo con latencia de navegador: drag p95 histórico 38,63 s, reapertura 34,6 s. R1 NO ACEPTADO; faltan benchmark de interacción posterior y GPU física. |
| M1 · flujo y componentes | EN_CURSO | Carcasa opcional seleccionable desde el asistente, recorte/escala visibles, ficha exacta, bornes/bloques, adopción A/B y portabilidad. Contrato integrado contactor A/B+PNG r2+paquete limpio probado; QA asistente 19/19, adopción 24/24, carcasa 15/15 y recorrido largo contactor+simulación+importación verde. Falta aceptación visual/humana y campaña M9; no se declara M1 aceptado. |
| M2 · esquema | EN_CURSO | Vista opt-in: activación legacy todo-o-nada con metadatos de hojas preservados, separación bobina/polos/aux del KM legacy por UI real, una sola red, undo/redo y reapertura (QA 5/5, 0 JS). Ya había desconexión real, selección, arrastre, borrado gráfico, referencias y pendientes. Faltan crear/conectar desde esquema, cruces, renumeración y aceptación multihoja completa; M2 NO aceptado. |
| M3 · documentación | PENDIENTE | Reutilizar dossier e Ingeniería; integrar rutas físicas tras M6. |
| M4 · simulación práctica | EN_CURSO | SIM-03: ensayo visible de salida abierta de boya, caída de KM por cableado y bomba parada; QA 9/9, 0 JS, y test visual desde ResultadoSimulacion. Los demás SIM-01…10 no se aceptan por arrastre. SIM-10 ruta→física sigue pendiente de política de longitud M6; sección declarada ya afecta impedancia al recalcular. |
| M5 · montaje/3D | PENDIENTE | Contratos de anclaje y calidad visual requieren evidencia nueva. |
| M6 · cables | PENDIENTE | Reconstrucción integral autorizada con migración; rutas manuales y topología deben preservarse. |
| M7 · CAD/mundo | PENDIENTE | DWG privado disponible; licencia/revisión del derivado publicado sin acreditar. |
| M8 · UX integrada | PENDIENTE | Consolidar recorridos, no abrir subsistemas duplicados. |
| M9 · cierre funcional | PENDIENTE | No iniciar hasta completar y verificar los flujos obligatorios. |

## Siguiente acción y recuperación

1. Repetir benchmark R1 de navegador sobre el nuevo repartidor, separar handler/routing/render y mantener GPU física como validación pendiente; 5/5 rutas exactas no equivalen a UX aceptada.
2. Ampliar M2 desde las vistas ya activables: crear/editar conexiones mediante herramientas visibles, distinguir cruces y cerrar referencias/renumeración y exportación. No inventar longitudes físicas.
3. Cerrar evidencia M1 de producto y revisión humana de apariencia/montaje; no sustituirla por el contrato unitario ni por QA separado.
4. M4: continuar la matriz SIM-01…10 con casos focales. No conectar directamente malla visual con longitud eléctrica: SIM-10 espera la política de ruta/longitud de M6.

## Checkpoint de reanudación — 2026-09-23

- Rama: `roadmap/1.0-functional`; `main` y `origin/main` permanecen en V9 `4c2924c`.
- Cortes nuevos y separados: `a955637` (carcasa/portabilidad), `6f04a10` (vistas esquemáticas), `5a98001` (recorte UI), `2ce0141` (edición de vistas). `6f4b222` (reconciliación de mallas) ya estaba respaldado en la rama remota.
- TypeScript app y core: verde en el estado combinado. Pruebas focales combinadas: 25/25, 0 omitidas. QA visible de recorte 8/8 en 128,8 s y QA de vistas 6/6, ambos sin errores JavaScript, con navegador/servidor cerrados. Build QA focal de los cortes: verde.
- **No se ejecutó campaña completa de pruebas ni CI sobre este nuevo HEAD.** Estas comprobaciones focales no equivalen a aceptación M1, M2, M0 ni `FUNCTIONAL_COMPLETE`.

Esta campaña no incluye publicación automática del plano privado, arquitectura global, Project Breaker ni una release 1.0. Ninguna aceptación humana se presume realizada.

## Checkpoint de continuidad — 2026-09-23 noche

- Rama `roadmap/1.0-functional`; `main` permanece en V9. Cortes locales nuevos desde `962bcc5`: `9289fb9` carcasa UI, `d59c87f` salida abierta de sensor, `12a79f3` y `d1f2041` rejilla, `dec2567`/`4262b37` aceptación M1, `0712c8e` test visual, `b552b95`/`4072c0d` activación M2 y `7e0bdb1` test de rótulos. Registrar SHA de respaldo remoto tras el push de la rama; no promover a main.
- Typecheck app/core verdes; 1529/1529 pruebas en 25,57 s, 0 fallos/omitidas. Build QA: 409 módulos en 6,46 s. Primera pasada completa roja por test estático obsoleto de serigrafía, corregido sin cambiar producto; la repetición íntegra es la evidencia válida.
- QA M4 boya 9/9 en 29,64 s, 0 errores JS; QA M2 5/5, QA asistente 19/19, adopción 24/24 y carcasa 15/15, 0 errores JS. El recorrido largo `qa/componentes-personalizados.mjs` pasó `TODO OK`: contactos polo/NA/NC, 11 cables, guardado/reapertura, paquete en navegador limpio y equivalencia nativa hasta el contrato que el nativo declara; 0 errores JS. No se ejecutó todavía todo el gate histórico M9 sobre este HEAD.
- `qa/rejilla-equivalencia-r1.mjs`: 5/5 escenarios idénticos (28/23/59/98/98 rutas); R1+drag 4,98 s en Node en este equipo. La mejora de CPU no acredita respuesta de arrastre ni certifica comportamiento en GPU física. No queda ningún proceso QA intencionalmente en ejecución.
