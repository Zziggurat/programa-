# Campaña funcional hacia 1.0 — estado vigente

## Referencia y alcance

- Contrato: `docs/avance/TABLEROSTUDIO_MASTER_SPEC.md` (versión 1.0, 2026-09-22). El original aportado tenía SHA-256 `350ce427bcd0e4989a424def5334f664edeee90808a20a068def0bfe6e13bea8`.
- Baseline verificado: `main`, `origin/main` y `tablerostudio-v9` en `4c2924c4d12f4dc0982a7f0bf28d94e52b00366f`. Repositorio `Zziggurat/programa-`.
- Rama de desarrollo: `roadmap/1.0-functional`. `main` sigue como referencia estable. No publicar una versión 1.0 al terminar esta campaña.
- Estado terminal buscado: `FUNCTIONAL_COMPLETE`, antes de los encargos separados de arquitectura/datos y Project Breaker.

## Hitos

| Hito | Estado | Frontera actual |
|---|---|---|
| M0 · preparación | EN_CURSO | R1 sintético 30/100 en SwiftShader. Reconciliación de mallas 98→10 y tres cortes focales de rejilla conservan 5/5 hashes exactos; reparto Node R1+drag ~4,98 s en una medición reciente y −34,2 % pareado. Nuevo focal de navegador n=1: rutas 11,79→4,76 s entre candidatos distintos y drag host 24,43 s; no es p95 ni GPU física. R1 NO ACEPTADO. |
| M1 · flujo y componentes | EN_CURSO | Carcasa opcional seleccionable desde el asistente, recorte/escala visibles, ficha exacta, bornes/bloques, adopción A/B y portabilidad. Contrato integrado contactor A/B+PNG r2+paquete limpio probado; QA asistente 19/19, adopción 24/24, carcasa 15/15 y recorrido largo contactor+simulación+importación verde. Falta aceptación visual/humana y campaña M9; no se declara M1 aceptado. |
| M2 · esquema | EN_CURSO | Vista opt-in: activación legacy todo-o-nada con metadatos de hojas preservados, separación bobina/polos/aux del KM legacy por UI real, una sola red, undo/redo y reapertura (QA 5/5, 0 JS). Ya había desconexión real, selección, arrastre, borrado gráfico, referencias y pendientes. Faltan crear/conectar desde esquema, cruces, renumeración y aceptación multihoja completa; M2 NO aceptado. |
| M3 · documentación | EN_CURSO | Test multivista: 3 símbolos del KM y 1 aparato/BOM, 3 cables reales, 2 referencias del enlace interhoja. DOC-01 aún carece de procedencia uniforme en HTML/PDF; paquete DOC-02 y longitudes físicas M6 pendientes. |
| M4 · simulación práctica | EN_CURSO | SIM-03: fallo visible de boya, caída de KM y bomba parada (QA 9/9). SIM-10 sección declarada: cambio visible 2,5→6 mm² refresca física energizada y Undo/Redo, QA 8/8 sin JS. Ruta→física espera política de longitud M6; no aceptar SIM-10 completo ni los demás SIM por arrastre. |
| M5 · montaje/3D | PENDIENTE | Contratos de anclaje y calidad visual requieren evidencia nueva. |
| M6 · cables | PENDIENTE | Reconstrucción integral autorizada con migración; rutas manuales y topología deben preservarse. |
| M7 · CAD/mundo | PENDIENTE | DWG privado disponible; licencia/revisión del derivado publicado sin acreditar. |
| M8 · UX integrada | PENDIENTE | Consolidar recorridos, no abrir subsistemas duplicados. |
| M9 · cierre funcional | PENDIENTE | No iniciar hasta completar y verificar los flujos obligatorios. |

## Siguiente acción y recuperación

1. Perfilar el coste residual R1 de rutas y confirmar respuesta en GPU física; el focal de navegador n=1 sigue demasiado lento y no acredita UX aceptable.
2. M2: separar persistentemente conexión eléctrica de ruta física pendiente antes del gesto «conectar» del esquema; nunca contabilizar metros/materiales automáticos no diseñados.
3. M3 DOC-01: propagar ID/revisión confirmados a HTML y PDFs; DOC-02 requiere un paquete coherente, no otro motor de cálculo.
4. Cerrar evidencia M1 de producto y revisión humana de apariencia/montaje; no sustituirla por tests o capturas automatizadas.
5. M4: continuar SIM-01…10; la sección en vivo está cubierta, pero SIM-10 longitud de ruta espera la política de M6.

## Checkpoint de reanudación — 2026-09-23

- Rama: `roadmap/1.0-functional`; `main` y `origin/main` permanecen en V9 `4c2924c`.
- Cortes nuevos y separados: `a955637` (carcasa/portabilidad), `6f04a10` (vistas esquemáticas), `5a98001` (recorte UI), `2ce0141` (edición de vistas). `6f4b222` (reconciliación de mallas) ya estaba respaldado en la rama remota.
- TypeScript app y core: verde en el estado combinado. Pruebas focales combinadas: 25/25, 0 omitidas. QA visible de recorte 8/8 en 128,8 s y QA de vistas 6/6, ambos sin errores JavaScript, con navegador/servidor cerrados. Build QA focal de los cortes: verde.
- **No se ejecutó campaña completa de pruebas ni CI sobre este nuevo HEAD.** Estas comprobaciones focales no equivalen a aceptación M1, M2, M0 ni `FUNCTIONAL_COMPLETE`.

Esta campaña no incluye publicación automática del plano privado, arquitectura global, Project Breaker ni una release 1.0. Ninguna aceptación humana se presume realizada.

## Checkpoint de continuidad — 2026-09-23, M0/M3/M4 focal

- Rama `roadmap/1.0-functional` respaldada en remoto hasta `49c9db4`; `main` continúa en V9. Nuevos commits: `6c7052a` corrige solo el gesto visible del benchmark, `806d8cc` invalida el resultado eléctrico tras cambiar sección y tras Undo/Redo, `49c9db4` prueba identidad documental multivista. No se promocionó a `main`.
- Benchmark R1 focal en el mismo fixture 30/100 (SHA `f860d627…`), Chromium 1243/SwiftShader, n=1: selección host 4,70 s, drag host 24,43 s, seis movimientos 16,76 s, `pointerup` canvas 4,83 s, reparto 4,76 s, 10/98 rutas y 10 mallas modificadas; picking y undo/redo verdes, 0 errores JS. El primer intento rojo fue espera implícita de navegación del arnés tras un clic ya recibido, no aserción funcional; el segundo cerró navegador/servidor. **R1 NO ACEPTADO**: no hay GPU física ni cuantiles representativos.
- SIM-10 sección en vivo: `qa/seccion-en-vivo-m4.mjs` usa ejemplo y copia visibles, cambia 2,5→6 mm² en el inspector con el circuito energizado, comprueba R `0,137928→0,05747 Ω` y Undo/Redo; 8/8, 0 JS, 35,5 s, browser/servidor cerrados. El primer recorrido descubrió que Undo restauraba documento pero no snapshot eléctrico; quedó corregido, no silenciado. El cálculo de longitud a partir de ruta física sigue pendiente.
- M3: `test/documentacion-multivista-m3.test.ts` comprueba tres vistas de un contactor, una identidad/BOM, tres conexiones, dos referencias gráficas del enlace interhoja y exactitud de terminales en Ingeniería; 1/1 focal. No demuestra todavía procedencia uniforme ni paquete documental único.
- App/core TypeScript verdes; batería integrada posterior a esos tres commits: 1530/1530 en 31,15 s, 0 fallos y 0 skipped. Build QA 409 módulos en 7,81 s. El gate histórico completo M9 no se ha ejecutado sobre este HEAD.

## Checkpoint de continuidad — 2026-09-23 noche

- Rama `roadmap/1.0-functional`; `main` permanece en V9. Cortes locales nuevos desde `962bcc5`: `9289fb9` carcasa UI, `d59c87f` salida abierta de sensor, `12a79f3` y `d1f2041` rejilla, `dec2567`/`4262b37` aceptación M1, `0712c8e` test visual, `b552b95`/`4072c0d` activación M2 y `7e0bdb1` test de rótulos. Registrar SHA de respaldo remoto tras el push de la rama; no promover a main.
- Typecheck app/core verdes; 1529/1529 pruebas en 25,57 s, 0 fallos/omitidas. Build QA: 409 módulos en 6,46 s. Primera pasada completa roja por test estático obsoleto de serigrafía, corregido sin cambiar producto; la repetición íntegra es la evidencia válida.
- QA M4 boya 9/9 en 29,64 s, 0 errores JS; QA M2 5/5, QA asistente 19/19, adopción 24/24 y carcasa 15/15, 0 errores JS. El recorrido largo `qa/componentes-personalizados.mjs` pasó `TODO OK`: contactos polo/NA/NC, 11 cables, guardado/reapertura, paquete en navegador limpio y equivalencia nativa hasta el contrato que el nativo declara; 0 errores JS. No se ejecutó todavía todo el gate histórico M9 sobre este HEAD.
- `qa/rejilla-equivalencia-r1.mjs`: 5/5 escenarios idénticos (28/23/59/98/98 rutas); R1+drag 4,98 s en Node en este equipo. La mejora de CPU no acredita respuesta de arrastre ni certifica comportamiento en GPU física. No queda ningún proceso QA intencionalmente en ejecución.
