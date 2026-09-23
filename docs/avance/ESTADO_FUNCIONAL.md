# Campaña funcional hacia 1.0 — estado vigente

## Referencia y alcance

- Contrato: `docs/avance/TABLEROSTUDIO_MASTER_SPEC.md` (versión 1.0, 2026-09-22). El original aportado tenía SHA-256 `350ce427bcd0e4989a424def5334f664edeee90808a20a068def0bfe6e13bea8`.
- Baseline verificado: `main`, `origin/main` y `tablerostudio-v9` en `4c2924c4d12f4dc0982a7f0bf28d94e52b00366f`. Repositorio `Zziggurat/programa-`.
- Rama de desarrollo: `roadmap/1.0-functional`. `main` sigue como referencia estable. No publicar una versión 1.0 al terminar esta campaña.
- Estado terminal buscado: `FUNCTIONAL_COMPLETE`, antes de los encargos separados de arquitectura/datos y Project Breaker.

## Hitos

| Hito | Estado | Frontera actual |
|---|---|---|
| M0 · preparación | EN_CURSO | Censo focal y escena sintética R1 de 30 aparatos/100 conductores medidos con SwiftShader; evidencia en `EVIDENCIA_FUNCIONAL.md`. Rendimiento R1 NO ACEPTADO: drag p95 38,63 s y reapertura p95 34,6 s. Perfil causal corto detectó 98 tubos reconstruidos y 10,97 s en `pointerup`; falta optimización medida y GPU física. |
| M1 · flujo y componentes | EN_CURSO | Búsqueda/estado documental, historial y adopción explícita A/B 24/24. Asistente 19/19, montaje/arrastre 31/31, ficha V8 exacta y `.tscomp` V2; puertos con ID/rótulo separados y bloques físicos desde UI, QA visible 18/18. Falta cerrar CMP-04 de apariencia/plantillas y aceptación integral; no se acepta M1 todavía. |
| M2 · esquema | EN_CURSO | Primer corte: seleccionar/inspeccionar/desconectar un conductor real en SVG, con ejemplo solo lectura, cancelar, undo/redo y reapertura verificados. Faltan conexión desde esquema, representaciones múltiples de un dispositivo, hojas estables, cruces y referencias; M2 NO aceptado. |
| M3 · documentación | PENDIENTE | Reutilizar dossier e Ingeniería; integrar rutas físicas tras M6. |
| M4 · simulación práctica | PENDIENTE | Motores V2–V9 existentes; cerrar solo casos objetivo no acreditados. |
| M5 · montaje/3D | PENDIENTE | Contratos de anclaje y calidad visual requieren evidencia nueva. |
| M6 · cables | PENDIENTE | Reconstrucción integral autorizada con migración; rutas manuales y topología deben preservarse. |
| M7 · CAD/mundo | PENDIENTE | DWG privado disponible; licencia/revisión del derivado publicado sin acreditar. |
| M8 · UX integrada | PENDIENTE | Consolidar recorridos, no abrir subsistemas duplicados. |
| M9 · cierre funcional | PENDIENTE | No iniciar hasta completar y verificar los flujos obligatorios. |

## Siguiente acción y recuperación

1. Cerrar apariencia/plantillas CMP-04 y aceptación integral de M1 sin perder las regresiones de ficha técnica, puertos y portabilidad.
2. Diseñar una reducción focal de reconstrucción en `pointerup` R1; medir antes/después y exigir equivalencia de reparto, longitudes, picking, undo y persistencia. El perfil corto no acredita todavía rendimiento aceptable ni GPU física.
3. Ampliar M2 desde la topología única: representaciones múltiples del mismo aparato y hojas estables, sin inventar longitudes físicas. Mantener benchmark R1 completo fuera del gate y validar por separado en GPU física.

Esta campaña no incluye publicación automática del plano privado, arquitectura global, Project Breaker ni una release 1.0. Ninguna aceptación humana se presume realizada.
