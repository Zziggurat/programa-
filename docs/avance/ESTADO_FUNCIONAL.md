# Campaña funcional hacia 1.0 — estado vigente

## Referencia y alcance

- Contrato: `docs/avance/TABLEROSTUDIO_MASTER_SPEC.md` (versión 1.0, 2026-09-22). El original aportado tenía SHA-256 `350ce427bcd0e4989a424def5334f664edeee90808a20a068def0bfe6e13bea8`.
- Baseline verificado: `main`, `origin/main` y `tablerostudio-v9` en `4c2924c4d12f4dc0982a7f0bf28d94e52b00366f`. Repositorio `Zziggurat/programa-`.
- Rama de desarrollo: `roadmap/1.0-functional`. `main` sigue como referencia estable. No publicar una versión 1.0 al terminar esta campaña.
- Estado terminal buscado: `FUNCTIONAL_COMPLETE`, antes de los encargos separados de arquitectura/datos y Project Breaker.

## Hitos

| Hito | Estado | Frontera actual |
|---|---|---|
| M0 · preparación | EN_CURSO | Censo focal, medición inicial y helper de ejemplo/copia validados; falta medir selección/drag/guardado con suficientes muestras para p95 y cubrir el tablero de densidad R1. |
| M1 · flujo y componentes | EN_CURSO | Búsqueda en bibliotecas y preservación del borrador probadas con UI real. La copia de ejemplo ahora persiste la numeración visible de conductores desde la primera revisión. El asistente completo y contratos CMP restantes siguen pendientes. |
| M2 · esquema | PENDIENTE | Preservar conectividad común; inspeccionar editor SVG/PDF antes de ampliar. |
| M3 · documentación | PENDIENTE | Reutilizar dossier e Ingeniería; integrar rutas físicas tras M6. |
| M4 · simulación práctica | PENDIENTE | Motores V2–V9 existentes; cerrar solo casos objetivo no acreditados. |
| M5 · montaje/3D | PENDIENTE | Contratos de anclaje y calidad visual requieren evidencia nueva. |
| M6 · cables | PENDIENTE | Reconstrucción integral autorizada con migración; rutas manuales y topología deben preservarse. |
| M7 · CAD/mundo | PENDIENTE | DWG privado disponible; licencia/revisión del derivado publicado sin acreditar. |
| M8 · UX integrada | PENDIENTE | Consolidar recorridos, no abrir subsistemas duplicados. |
| M9 · cierre funcional | PENDIENTE | No iniciar hasta completar y verificar los flujos obligatorios. |

## Siguiente acción y recuperación

1. Cerrar los casos límite de navegación asíncrona en «Mis Componentes», repetir pruebas focales y fijar checkpoint semántico.
2. Completar mediciones M0 de selección/drag/guardado sin atribuir resultados de SwiftShader a GPU física.
3. Continuar M1 por consecuencias de cambios de perfil/terminal, versiones y portabilidad; no saltar directamente a M2.

Esta campaña no incluye publicación automática del plano privado, arquitectura global, Project Breaker ni una release 1.0. Ninguna aceptación humana se presume realizada.
