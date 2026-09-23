# Campaña funcional hacia 1.0 — estado vigente

## Referencia y alcance

- Contrato: `docs/avance/TABLEROSTUDIO_MASTER_SPEC.md` (versión 1.0, 2026-09-22). El original aportado tenía SHA-256 `350ce427bcd0e4989a424def5334f664edeee90808a20a068def0bfe6e13bea8`.
- Baseline verificado: `main`, `origin/main` y `tablerostudio-v9` en `4c2924c4d12f4dc0982a7f0bf28d94e52b00366f`. Repositorio `Zziggurat/programa-`.
- Rama de desarrollo: `roadmap/1.0-functional`. `main` sigue como referencia estable. No publicar una versión 1.0 al terminar esta campaña.
- Estado terminal buscado: `FUNCTIONAL_COMPLETE`, antes de los encargos separados de arquitectura/datos y Project Breaker.

## Hitos

| Hito | Estado | Frontera actual |
|---|---|---|
| M0 · preparación | EN_CURSO | Censo focal y escena sintética R1 de 30 aparatos/100 conductores medidos con SwiftShader; evidencia en `EVIDENCIA_FUNCIONAL.md`. Rendimiento R1 NO ACEPTADO: drag p95 histórico 38,63 s y reapertura p95 34,6 s. La reconciliación posterior reduce 98→10 tubos para 10 rutas cambiadas, pero `pointerup` sigue ~11,85 s: ~11,79 s son del repartidor global. Falta optimización de routing medida y GPU física. |
| M1 · flujo y componentes | EN_CURSO | Búsqueda/estado documental, historial y adopción explícita A/B 24/24. Asistente, montaje, ficha V8 exacta, puertos y bloques físicos desde UI. Carcasa paramétrica versionada en modelo/render/paquetes; recorte y escala visibles con PNG derivado, bornes u/v fijos y QA 8/8. Falta exponer la elección de carcasa en el asistente y cerrar aceptación integral; no se acepta M1 todavía. |
| M2 · esquema | EN_CURSO | Desconexión de conductor real verificada. Modelo opt-in de hojas estables y vistas múltiples por aparato sin duplicar red; selección, arrastre, undo/redo, borrado solo gráfico, referencias y pendientes visibles con QA focal 6/6. Faltan creación/conexión desde esquema, cruces, renumeración, herramientas diarias y aceptación multihoja completa; M2 NO aceptado. |
| M3 · documentación | PENDIENTE | Reutilizar dossier e Ingeniería; integrar rutas físicas tras M6. |
| M4 · simulación práctica | PENDIENTE | Motores V2–V9 existentes; cerrar solo casos objetivo no acreditados. |
| M5 · montaje/3D | PENDIENTE | Contratos de anclaje y calidad visual requieren evidencia nueva. |
| M6 · cables | PENDIENTE | Reconstrucción integral autorizada con migración; rutas manuales y topología deben preservarse. |
| M7 · CAD/mundo | PENDIENTE | DWG privado disponible; licencia/revisión del derivado publicado sin acreditar. |
| M8 · UX integrada | PENDIENTE | Consolidar recorridos, no abrir subsistemas duplicados. |
| M9 · cierre funcional | PENDIENTE | No iniciar hasta completar y verificar los flujos obligatorios. |

## Siguiente acción y recuperación

1. Exponer la elección de carcasa paramétrica ya versionada en el asistente y cerrar CMP-04/M1 con su aceptación integral; preservar recorte, ficha técnica, puertos y portabilidad.
2. Diagnosticar y reducir el coste del reparto global R1 conservando ocupación/carriles y rutas deterministas; la reconciliación de mallas ya reduce geometrías, pero no acredita latencia aceptable. Mantener benchmark completo fuera del gate y validar aparte en GPU física.
3. Ampliar M2 desde las vistas múltiples ya persistidas: crear/editar conexiones mediante herramientas visibles, distinguir cruces y cerrar referencias/renumeración y exportación. No inventar longitudes físicas.
4. M4 tiene una brecha focal identificada para SIM-03: la prueba actual cubre boya y bomba normales, pero no falla de sensor y reposo seguro. No se implementó ni se declaró aceptado en este checkpoint.

## Checkpoint de reanudación — 2026-09-23

- Rama: `roadmap/1.0-functional`; `main` y `origin/main` permanecen en V9 `4c2924c`.
- Cortes nuevos y separados: `a955637` (carcasa/portabilidad), `6f04a10` (vistas esquemáticas), `5a98001` (recorte UI), `2ce0141` (edición de vistas). `6f4b222` (reconciliación de mallas) ya estaba respaldado en la rama remota.
- TypeScript app y core: verde en el estado combinado. Pruebas focales combinadas: 25/25, 0 omitidas. QA visible de recorte 8/8 en 128,8 s y QA de vistas 6/6, ambos sin errores JavaScript, con navegador/servidor cerrados. Build QA focal de los cortes: verde.
- **No se ejecutó campaña completa de pruebas ni CI sobre este nuevo HEAD.** Estas comprobaciones focales no equivalen a aceptación M1, M2, M0 ni `FUNCTIONAL_COMPLETE`.

Esta campaña no incluye publicación automática del plano privado, arquitectura global, Project Breaker ni una release 1.0. Ninguna aceptación humana se presume realizada.
