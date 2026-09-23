# Evidencia funcional — matriz inicial

Estados: `YA_EXISTE_POR_VERIFICAR`, `PENDIENTE`, `EN_CURSO`, `IMPLEMENTADO`, `VERIFICADO`, `BLOQUEADO_EXTERNO`. «Existe» describe código o antecedente; no implica aceptación de todo el flujo.

| Flujo | Reutilización acreditable | Brecha principal | Evidencia a producir | Estado |
|---|---|---|---|---|
| FLU-01 · proyecto durable | `gestor-documentos`, repositorio IndexedDB, snapshots, QA multiproyecto V9 | estado visible de revisión/error y búsqueda cotidiana | dos documentos independientes, copia, error de almacenamiento y reapertura desde UI | EN_CURSO |
| FLU-02 · componente propio | definiciones con perfiles, assets SHA-256, snapshot de instancia y QA contactor | asistente reversible, montaje/puertos completos y vínculo técnico versionado | dos proyectos, edición de definición, imagen independiente, importación limpia | EN_CURSO |
| FLU-03 · esquema/tablero | `esquema-svg`, `esquema-pdf`, topología del proyecto | edición diaria multihoja sin segunda conectividad | edición desde esquema, cruce no conectado, undo, PDF | PENDIENTE |
| FLU-04 · simular/analizar | motores V2–V9 y QA industrial/física/Ingeniería | cobertura de casos objetivo y oráculos independientes | SIM-01…10, calidad de datos y límites | YA_EXISTE_POR_VERIFICAR |
| FLU-05 · propuesta V9 | `src/diseno-asistido`, preview/aplicación transaccional | integración y vigencia en nuevos flujos | BASE conservada, invalidación y decisión aplicada | YA_EXISTE_POR_VERIFICAR |
| FLU-06 · montaje/cables | escena Three.js, edición/canaletas/mazo existentes | anclaje, XYZ manual fiel, ruta única/migración y 3D profesional | fixtures V9, drag real, colisiones informativas, densidad | PENDIENTE |
| FLU-07 · revisión/documentos | exportadores, dossier, Ingeniería | paquete coherente y revisión obsoleta visible | identidad/cantidades, PDF renderizado, CSV/HTML hostil | PENDIENTE |
| FLU-08 · CAD/instalación | `app/mundo*`, extractor y derivado existente | pipeline trazable, unidad/Z, vínculos y derechos | manifiesto y QA sintético; original privado local | PENDIENTE |

## Activos y entorno de partida

- DWG privado: 22.657.062 bytes, cabecera `AC1032`, SHA-256 `7d2e1adefee31d4917d0cc6aba7f033b2ff7d89e7d378ebe04295ec04a47d1de`; inspección de contenido geométrico y licencia pendientes. No copiar al árbol público.
- `datos/cubierta.json` existente dice derivar de `Cubierta.dxf`, informa alturas supuestas, pero no identifica hash/revisión del original ni derechos. La relación con el DWG actual es `NO VERIFICADA`.
- Referencia de pruebas V9: 1412 unitarias, gate histórico 13/267 y entrega offline reportados para `4c2924c`; no son resultados del candidato funcional nuevo.
- Candidato M1 antes de checkpoint: typecheck y compilación TypeScript verdes; 1419/1419 tests unitarios en 60,9 s, 0 fallos y 0 omitidos. Build QA de Vite: 399 módulos, 5,85 s. `qa/flujo-m1.mjs`: 6/6 comprobaciones, 0 errores JS, ~18,4 s; `qa/componentes-personalizados.mjs`: recorrido completo de borrador, búsqueda/filtro, contactor, portabilidad y equivalencia eléctrica verde, 0 errores JS. Se usó Chromium instalado explícitamente, sin instalar dependencias. Esta evidencia deberá repetirse si cambia la frontera probada.
- Hallazgo y corrección M1: al copiar un ejemplo, la revisión inicial almacenada no contenía los números de conductor que ya se mostraban en el editor después del montaje. La creación ahora numera el candidato antes de persistirlo; el test de gestor exige equivalencia entre primera revisión y vista. El QA de copia conserva todos los campos declarados del ejemplo y comprueba identidad/contenido durable sin rechazar defaults legítimos añadidos por el cargador.
- Riesgo CMP-06 identificado (pendiente de cerrar con pruebas): una instancia conserva `{definicionId, revision}` y una copia profunda de su función, pero la biblioteca sobreescribe la definición vigente por ID. El exportador anterior empaquetaba esa definición vigente, aunque el proyecto referenciara una revisión anterior, o ninguna tras borrar la ficha. La simulación de la instancia no cambia, pero su procedencia/portabilidad puede quedar inconsistente; no se declara «reutilización versionada» verificada todavía.
- Perfil de rendimiento M0 (medición asistida, una ejecución): Windows 10.0.26200, i5-14400/16 hilos, 15,7 GB RAM; Chromium 153.0.8010.12, 1440×900, DPR 1, render SwiftShader (GPU física no verificada). En «Arranque estrella-triángulo» (17 aparatos, 61 conductores): editor interactivo 1,364 s, abrir ejemplo con confirmación visible 9,336 s, heap JS 20,5→112,3 MB, 30 cuadros mediana 8,1 ms y peor 9,4 ms, validación visible 6,284 s, 0 errores JS. No es R1 (30/100), ni p95 estadístico de apertura/drag. Selección, drag y guardado aún requieren muestras. El Chromium instalado no coincide con la revisión pedida por Playwright 1.61.1 y se indicó ejecutable explícito; no se instaló otra versión.

## Selección por impacto

- M1: modelo/persistencia/componentes/assets y QA multiproyecto/componentes, más entrega offline al tocar portabilidad.
- M2: esquema, IDs, bornes, conectividad, simulación y QA esquema/dossier.
- M3: documentos, Ingeniería, impresión/PDF, entrega y texto hostil.
- M4: motores de simulación, física, PLC e Ingeniería; QA industrial/automatización/física/equipos.
- M5–M6: geometría, picking, edición, canaletas, puerta, persistencia, longitudes, Ingeniería/V9 y QA visual/fusión.
- M7: mundo/planta, fixtures CAD sintéticos, seguridad de imports y prueba privada local separada.
- M8–M9: recorridos integrados, accesibilidad/teclado, offline, CI, artifacts y revisión visual/humana pendiente.

Si un cambio cruza identidad, conectividad, anclajes, longitudes o el resolver técnico, ampliar la prueba en esa frontera; no limitarse a la suite del archivo editado.
